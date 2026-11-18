import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import TimeField from './TimeField';
import WeighingMachineInfo from './WeighingMachineInfo';
import { ErrorBox, ModalFooter, Label, todayStr } from './FormBits';
import { COLORS, fmt } from '../theme';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
let rowKey = 0;
const newRow = (material_id = null) => ({ key: ++rowKey, material_id, out: '', start: '', end: '' });
// typing 20261102 -> 2026-11-02
const fmtDate = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };
// running hours between two HH:MM values (null when missing or end is not after start)
const hoursBetween = (s, e) => {
  if (!TIME_RE.test(s || '') || !TIME_RE.test(e || '')) return null;
  const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? r2(mins / 60) : null;
};

function Box({ label, value, color, bg, flex = 1 }) {
  return (
    <View style={{ flex, backgroundColor: bg || COLORS.greyBg, borderRadius: 12, padding: 12, marginRight: 8, marginBottom: 8, minWidth: 100, justifyContent: 'center' }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: color || COLORS.grey }}>{label}</Text>
      <Text style={{ fontSize: 19, fontWeight: '900', color: color || COLORS.text }}>{value}</Text>
    </View>
  );
}

// Filtering entry for one batch (the batch had materials ticked "Filter" in Batching).
// Pick a material from the dropdown -> its I/P (weighed in Batching) fills in automatically; enter the O/P and the Start / End time of THAT material.
// "Add material" adds another row. Totals (I/P, O/P, wastage, loss %) are calculated from all rows.
// A batch with no material list (old entries) keeps the single I/P / O/P boxes and one shared time. Saving moves the batch to ROASTING.
export default function FilteringFormModal({ visible, batch, onDismiss, onSaved }) {
  const [f, setF] = useState({});
  const [lines, setLines] = useState([]); // [{ key, material_id, out, start, end }]
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const mats = (batch && batch.materials) || [];
  const perMaterial = mats.length > 0;
  const byId = useMemo(() => new Map(mats.map((m) => [m.material_id, m])), [mats]);

  useEffect(() => {
    if (!visible || !batch) return;
    setF({ date: todayStr(), stages: Number(batch.recipe_stages) > 0 ? Number(batch.recipe_stages) : 1, output: '', start: '', end: '', remarks: '' });
    // only one material to filter -> pre-select it
    setLines([newRow(batch.materials && batch.materials.length === 1 ? batch.materials[0].material_id : null)]);
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, batch]); // eslint-disable-line

  const input = Number(batch?.input_kg || 0);
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const used = new Set(lines.map((l) => l.material_id).filter(Boolean));
  const optionsFor = (line) => mats.filter((m) => m.material_id === line.material_id || !used.has(m.material_id))
    .map((m) => ({ value: m.material_id, label: `${m.material_name} · I/P ${fmt(m.input_weight)} kg` }));
  const canAdd = perMaterial && lines.length < mats.length;

  // per row + totals (preview; the server calculates again)
  const calc = useMemo(() => {
    if (!perMaterial) {
      const out = Number(f.output);
      if (!(out > 0) || out > input) return { rows: [], totIn: input, totOut: null, waste: null, loss: null };
      return { rows: [], totIn: input, totOut: out, waste: r3(input - out), loss: r2(((input - out) / input) * 100) };
    }
    const rows = lines.map((l) => {
      const m = byId.get(l.material_id);
      const out = Number(l.out);
      const ok = !!m && l.out !== '' && out > 0 && out <= m.input_weight;
      return { ...l, m, ip: m ? m.input_weight : null, ok, waste: ok ? r3(m.input_weight - out) : null, loss: ok ? r2(((m.input_weight - out) / m.input_weight) * 100) : null, outN: ok ? out : 0, hrs: hoursBetween(l.start, l.end) };
    });
    const totIn = r3(rows.reduce((a, r) => a + (r.ip || 0), 0));
    const done = rows.filter((r) => r.ok);
    const doneIn = r3(done.reduce((a, r) => a + r.ip, 0));
    const totOut = done.length ? r3(done.reduce((a, r) => a + r.outN, 0)) : null;
    const waste = done.length ? r3(doneIn - totOut) : null;
    return { rows, totIn, totOut, waste, loss: done.length && doneIn > 0 ? r2((waste / doneIn) * 100) : null };
  }, [perMaterial, lines, byId, f.output, input]);

  const save = async () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Use YYYY-MM-DD';
    if (perMaterial) {
      lines.forEach((l) => {
        const m = byId.get(l.material_id);
        if (!m) e[`mat_${l.key}`] = 'Select the material';
        else if (l.out === '' || !(Number(l.out) > 0)) e[`out_${l.key}`] = 'Enter O/P weight';
        else if (Number(l.out) > m.input_weight) e[`out_${l.key}`] = `Cannot be more than I/P (${fmt(m.input_weight)} kg)`;
        if (!TIME_RE.test(l.start || '')) e[`st_${l.key}`] = 'Enter start time';
        if (!TIME_RE.test(l.end || '')) e[`en_${l.key}`] = 'Enter end time';
        else if (TIME_RE.test(l.start || '') && hoursBetween(l.start, l.end) === null) e[`en_${l.key}`] = 'End must be after start';
      });
    } else {
      if (!(Number(f.output) > 0)) e.output = 'Enter O/P weight';
      else if (Number(f.output) > input) e.output = `Cannot be more than I/P (${fmt(input)} kg)`;
      if (!TIME_RE.test(f.start || '')) e.start = 'Use HH:MM (24 hour)';
      if (!TIME_RE.test(f.end || '')) e.end = 'Use HH:MM (24 hour)';
      else if (TIME_RE.test(f.start || '') && f.end <= f.start) e.end = 'End time must be after start time';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const body = { batch_id: batch.batch_id, filter_date: f.date, stages: f.stages, remarks: f.remarks || undefined };
      if (perMaterial) {
        // header time = earliest start .. latest end of all materials (so the current server still works)
        const starts = lines.map((l) => l.start).sort(); const ends = lines.map((l) => l.end).sort();
        body.start_time = starts[0]; body.end_time = ends[ends.length - 1];
        body.materials = lines.map((l) => ({ material_id: l.material_id, output_weight: l.out, start_time: l.start, end_time: l.end }));
      } else {
        body.start_time = f.start; body.end_time = f.end; body.output_weight = f.output;
      }
      const r = await api.post('/filtering', body);
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  const high = calc.loss !== null && calc.loss > 5;
  const notChosen = perMaterial ? mats.filter((m) => !used.has(m.material_id)) : [];

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="filter-variant" maxWidth={640}
      title="Filtering" subtitle={batch ? `${batch.batch_no} · ${batch.product_name}` : ''}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Filtering" />}>
      <View>
        <Label>FILTERING</Label>
        <WeighingMachineInfo batch={batch} />
        <FormField label="Date * (YYYY-MM-DD)" value={f.date || ''} onChangeText={(t) => set('date')(fmtDate(t))} error={errors.date} keyboardType="number-pad" maxLength={10} />

        {perMaterial ? (
          <>
            <Label style={{ marginTop: 6 }}>MATERIALS FILTERED (each with its own time)</Label>
            {calc.rows.map((r, i) => (
              <View key={r.key} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <SelectField label={`Material ${i + 1} *`} value={r.material_id} options={optionsFor(r)} error={errors[`mat_${r.key}`]}
                      onChange={(id) => setLine(r.key, { material_id: id, out: '' })} />
                  </View>
                  {lines.length > 1 && (
                    <Pressable onPress={() => setLines((ls) => ls.filter((l) => l.key !== r.key))} hitSlop={8}
                      style={{ marginLeft: 8, marginTop: 8, width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center' }}>
                      <MCI name="trash-can-outline" size={20} color={COLORS.danger} />
                    </Pressable>
                  )}
                </View>
                <FormRow>
                  <FormField label="O/P (Kg) *" numeric value={r.out} error={errors[`out_${r.key}`]} editable={!!r.m}
                    onChangeText={(t) => setLine(r.key, { out: t })} />
                  <Box label="LOSS %" value={r.loss === null ? '–' : `${r.loss} %`} color={r.loss !== null && r.loss > 5 ? COLORS.danger : undefined}
                    bg={r.loss !== null && r.loss > 5 ? COLORS.dangerBg : undefined} />
                </FormRow>
                <FormRow>
                  <TimeField label="Start time *" value={r.start} onChangeText={(t) => setLine(r.key, { start: t })} error={errors[`st_${r.key}`]} />
                  <TimeField label="End time *" value={r.end} onChangeText={(t) => setLine(r.key, { end: t })} error={errors[`en_${r.key}`]} min={r.start} />
                  <Box label="RUNNING HRS" value={r.hrs === null ? '–' : `${r.hrs} h`} />
                </FormRow>
              </View>
            ))}

            {canAdd && (
              <Pressable onPress={() => setLines((ls) => [...ls, newRow()])}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary, borderRadius: 12, paddingVertical: 11, marginBottom: 14 }}>
                <MCI name="plus" size={20} color={COLORS.primary} />
                <Text style={{ color: COLORS.primary, fontWeight: '900', marginLeft: 6 }}>Add material</Text>
              </Pressable>
            )}

            <Label style={{ marginTop: 2 }}>TOTAL</Label>
            <View style={{ flexDirection: 'row' }}>
              <Box label="TOTAL LOSS %" value={calc.loss === null ? '–' : `${calc.loss} %`} color={high ? COLORS.danger : undefined} bg={high ? COLORS.dangerBg : undefined} />
            </View>
            {notChosen.length > 0 && (
              <Text style={{ fontSize: 12, color: COLORS.grey, marginBottom: 10 }}>
                Not added: {notChosen.map((m) => m.material_name).join(', ')}. These go to Roasting without filtering. Other materials of the batch also go straight to Roasting.
              </Text>
            )}
          </>
        ) : (
          <>
            <Label style={{ marginTop: 6 }}>WEIGHT</Label>
            <FormRow>
              <Box label="I/P (KG) - FROM BATCHING" value={fmt(input)} />
              <FormField label="O/P (Kg) *" numeric value={f.output || ''} onChangeText={set('output')} error={errors.output} />
            </FormRow>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <Box label="WASTAGE" value={calc.waste === null ? '–' : `${calc.waste} kg`} />
              <Box label="LOSS %" value={calc.loss === null ? '–' : `${calc.loss} %`} color={high ? COLORS.danger : undefined} bg={high ? COLORS.dangerBg : undefined} />
            </View>
            <Label style={{ marginTop: 4 }}>TIME</Label>
            <FormRow>
              <TimeField label="Start time *" value={f.start || ''} onChangeText={set('start')} error={errors.start} />
              <TimeField label="End time *" value={f.end || ''} onChangeText={set('end')} error={errors.end} min={f.start} />
            </FormRow>
          </>
        )}

        <FormField label="Remarks" multiline value={f.remarks || ''} onChangeText={set('remarks')} maxLength={255} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}