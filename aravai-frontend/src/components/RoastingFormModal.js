import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import TimeField from './TimeField';
import WeighingMachineInfo from './WeighingMachineInfo';
import { materialStage } from '../batchMaterialStatus';
import { COLORS } from '../theme';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY = () => ({
  roast_date: today(), machine_id: null, code_no: '', material_id: null, batch_id: null, input_weight: '', output_weight: '',
  temp_before: '', std_temp: '', temp_after: '', start_time: '', end_time: '', remarks: '',
});
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// typing 20261102 -> 2026-11-02
const fmtDate = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };

// running hours between two HH:MM values (null when either is missing or end is not after start)
const hoursBetween = (s, e) => {
  if (!TIME_RE.test(s || '') || !TIME_RE.test(e || '')) return null;
  const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : null;
};

// Add (no item) or Edit (item) a roasting register entry, as a popup.
// Add mode: ONE form, MANY materials - every material has its own I/P, O/P, Loss %, Start time, End time and Running hours.
// Running hours, wastage and Loss % are calculated here (preview) and again by the server (saved value).
export default function RoastingFormModal({ visible, item, onDismiss, onSaved }) {
  const isEdit = !!item;
  const [f, setF] = useState(EMPTY());
  const [machines, setMachines] = useState([]);
  const [batchList, setBatchList] = useState([]); // batches (from Batching) waiting at Roasting, each with its recipe
  const [materialRows, setMaterialRows] = useState([]); // materials weighed in the selected batch
  const [loadingMat, setLoadingMat] = useState(false);
  const [batErr, setBatErr] = useState(''); // real error when the batch list / material list could not be loaded
  const [matErr, setMatErr] = useState('');
  const [blocked, setBlocked] = useState([]); // materials of the batch that are still waiting for Filtering: they cannot be roasted yet
  const [alertAt, setAlertAt] = useState(12);
  const keyRef = useRef(0);
  const blankRow = () => { keyRef.current += 1; return { key: keyRef.current, material_id: null, input_weight: '', output_weight: '', start_time: '', end_time: '' }; };
  const [rows, setRows] = useState(() => [blankRow()]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(''); setSaving(false); setLoading(true); setRows([blankRow()]);
    if (item) {
      setF({
        roast_date: item.roast_date, machine_id: item.machine_id, code_no: item.code_no,
        material_id: item.material_id || null, batch_id: item.batch_id || null,
        input_weight: String(item.input_weight ?? ''), output_weight: item.output_weight == null ? '' : String(item.output_weight),
        temp_before: item.temp_before == null ? '' : String(item.temp_before),
        std_temp: item.std_temp == null ? '' : String(item.std_temp),
        temp_after: item.temp_after == null ? '' : String(item.temp_after),
        start_time: item.start_time ? item.start_time.slice(11, 16) : '',
        end_time: item.end_time ? item.end_time.slice(11, 16) : '',
        remarks: item.remarks || '',
      });
    } else setF(EMPTY());
    api.get('/roasting/options').then((r) => {
      const d = r.data.data;
      setMachines(d.machines.map((m) => ({ value: m.id, label: `${m.machine_code} · ${m.machine_name}` })));
      if (!item && d.machines.length === 1) setF((p) => ({ ...p, machine_id: d.machines[0].id })); // only one roasting machine -> pre-select
      setAlertAt(d.loss_alert_percent);
    }).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, item]); // eslint-disable-line

  // Batch codes (from Batching) waiting at the Roasting stage
  useEffect(() => {
    if (!visible) return undefined;
    let off = false;
    api.get('/roasting/batch-options', { params: { current_batch_id: item?.batch_id || undefined } })
      .then((r) => { if (!off) { setBatchList(r.data.data.items); setBatErr(''); } })
      .catch((e) => { if (!off) { setBatchList([]); setBatErr(errMsg(e)); } });
    return () => { off = true; };
  }, [visible, item]);

  // Batch selected -> the materials of that batch load automatically
  useEffect(() => {
    if (!visible || !f.batch_id) { setMaterialRows([]); setBlocked([]); setMatErr(''); return undefined; }
    let off = false; setLoadingMat(true); setMatErr('');
    api.get('/roasting/batch-materials', { params: { batch_id: f.batch_id, exclude_id: item?.id || undefined, current_material_id: item?.material_id || undefined } })
      .then((r) => {
        if (off) return;
        const all = r.data.data.items;
        // a material that is ticked for Filtering can only be roasted after its Filtering is completed (the server checks this again)
        setMaterialRows(all.filter((m) => materialStage(m) !== 'FILTERING'));
        setBlocked(all.filter((m) => materialStage(m) === 'FILTERING'));
      })
      .catch((e) => { if (!off) { setMaterialRows([]); setBlocked([]); setMatErr(errMsg(e)); } })
      .finally(() => { if (!off) setLoadingMat(false); });
    return () => { off = true; };
  }, [visible, f.batch_id, item]);

  // Pick the batch -> recipe is filled from the batch; material and I/P are chosen next
  const onBatch = (id) => {
    const b = batchList.find((x) => x.batch_id === id);
    setF((p) => ({ ...p, batch_id: id, code_no: b ? (b.recipe_no || '') : '', material_id: null, input_weight: '' }));
    setRows([blankRow()]);
  };
  const onMaterial = (id) => {
    const m = materialRows.find((x) => x.material_id === id);
    setF((p) => ({ ...p, material_id: id, input_weight: m ? String(m.remaining_qty) : p.input_weight })); // I/P = weight from Batching
  };
  const batchOpts = useMemo(() => batchList.map((b) => ({ value: b.batch_id, label: `${b.batch_no} · ${b.product_name}` })), [batchList]);
  const materialOpts = useMemo(() => materialRows.map((m) => ({ value: m.material_id, label: `${m.material_name} · ${m.remaining_qty} kg` })), [materialRows]);
  const pickedMaterial = materialRows.find((m) => m.material_id === f.material_id);
  const leftKg = materialRows.length ? materialRows[0].batch_left_kg : null; // weight handed over to Roasting
  const usedByOthers = (key) => rows.filter((r) => r.key !== key).reduce((a, r) => a + (Number(r.input_weight) || 0), 0);
  const totalIn = rows.reduce((a, r) => a + (Number(r.input_weight) || 0), 0);
  const overBatch = !isEdit && leftKg != null && totalIn > leftKg + 0.0005;
  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const pickRowMaterial = (key, id) => {
    const m = materialRows.find((x) => x.material_id === id);
    const cap = m ? (leftKg == null ? m.remaining_qty : Math.max(Math.min(m.remaining_qty, leftKg - usedByOthers(key)), 0)) : 0;
    setRow(key, { material_id: id, input_weight: m ? String(Math.round(cap * 1000) / 1000) : '' });
  };
  // a material can be chosen in one row only
  const rowOpts = (key) => materialOpts.filter((o) => !rows.some((r) => r.key !== key && r.material_id === o.value));
  const rowLoss = (r) => {
    const i = Number(r.input_weight); const o = Number(r.output_weight);
    return i > 0 && r.output_weight !== '' && o > 0 && o <= i ? Math.round(((i - o) / i) * 10000) / 100 : null;
  };
  // batch is still at Roasting but every material is already roasted (entries saved earlier without the tick)
  const nothingToRoast = !isEdit && !!f.batch_id && !loadingMat && !matErr && materialRows.length === 0 && blocked.length === 0;
  // only filtered-pending materials are left: nothing can be roasted until Filtering is done (and the batch must NOT be sent on)
  const waitingOnly = !isEdit && !!f.batch_id && !loadingMat && !matErr && materialRows.length === 0 && blocked.length > 0;
  const sendToGrinding = async () => {
    setSaving(true); setErr('');
    try { await api.post('/roasting/finish', { batch_id: f.batch_id }); setSaving(false); onSaved && onSaved(false); } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const pickedBatch = batchList.find((b) => b.batch_id === f.batch_id);
  // The machine is the weighing machine chosen in Batching (older batches without one still pick a roasting machine)
  const batchMachine = pickedBatch && pickedBatch.weighing_machine_id && (!isEdit || String(item.machine_id) === String(pickedBatch.weighing_machine_id)) ? pickedBatch : null;
  const recipeLabel = pickedBatch ? pickedBatch.product_name : f.code_no;
  // live preview of the calculated columns
  const calc = useMemo(() => {
    let inp = Number(f.input_weight); let out = Number(f.output_weight);
    let hasOut = f.output_weight !== '';
    let hours = null;
    if (!isEdit) { // add mode: totals of all material rows
      const done = rows.filter((r) => Number(r.input_weight) > 0 && Number(r.output_weight) > 0 && Number(r.output_weight) <= Number(r.input_weight));
      inp = done.reduce((a, r) => a + Number(r.input_weight), 0); out = done.reduce((a, r) => a + Number(r.output_weight), 0); hasOut = done.length > 0;
      const hs = rows.map((r) => hoursBetween(r.start_time, r.end_time)).filter((h) => h !== null);
      hours = hs.length ? Math.round(hs.reduce((a, h) => a + h, 0) * 100) / 100 : null;
    } else hours = hoursBetween(f.start_time, f.end_time);
    let loss = null;
    if (inp > 0 && hasOut && out > 0 && out <= inp) loss = Math.round(((inp - out) / inp) * 10000) / 100;
    return { hours, loss, inp: Math.round(inp * 1000) / 1000, out: Math.round(out * 1000) / 1000 };
  }, [f, rows, isEdit]);

  const validate = () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.roast_date)) e.roast_date = 'Use YYYY-MM-DD';
    if (!batchMachine && !f.machine_id) e.machine_id = 'Select a machine';
    if ((!isEdit || item.batch_id) && !f.batch_id) e.batch_id = 'Select the batch code';
    // single Material box exists only when editing one entry; in Add mode every row is checked below
    if (isEdit && item.batch_id && f.batch_id && !f.material_id) e.material_id = 'Select the material';
    if (!f.batch_id && !f.code_no.trim()) e.code_no = 'Select the batch code';
    if (isEdit) {
      if (!(Number(f.input_weight) > 0)) e.input_weight = 'Enter I/P weight';
      if (f.output_weight !== '' && !(Number(f.output_weight) > 0)) e.output_weight = 'Enter a valid O/P weight';
      if (Number(f.output_weight) > Number(f.input_weight)) e.output_weight = 'O/P cannot be more than I/P';
      if (!TIME_RE.test(f.start_time)) e.start_time = 'Use HH:MM (24 hour)';
      if (f.end_time && !TIME_RE.test(f.end_time)) e.end_time = 'Use HH:MM (24 hour)';
      if (f.end_time && TIME_RE.test(f.end_time) && TIME_RE.test(f.start_time) && hoursBetween(f.start_time, f.end_time) === null) e.end_time = 'End must be after start';
      if ((f.output_weight !== '') !== !!f.end_time) e.end_time = 'Enter both O/P weight and End time, or leave both empty';
    } else {
      rows.forEach((r) => {
        const m = materialRows.find((x) => x.material_id === r.material_id);
        if (!r.material_id) e[`m${r.key}`] = 'Select the material';
        if (!(Number(r.input_weight) > 0)) e[`i${r.key}`] = 'Enter I/P';
        else if (m && Number(r.input_weight) > m.remaining_qty + 0.0005) e[`i${r.key}`] = `Max ${m.remaining_qty} kg`;
        if (!(Number(r.output_weight) > 0)) e[`o${r.key}`] = 'Enter O/P';
        else if (Number(r.output_weight) > Number(r.input_weight)) e[`o${r.key}`] = 'More than I/P';
        if (!TIME_RE.test(r.start_time)) e[`s${r.key}`] = 'Enter start time';
        if (!TIME_RE.test(r.end_time)) e[`e${r.key}`] = 'Enter end time';
        else if (TIME_RE.test(r.start_time) && hoursBetween(r.start_time, r.end_time) === null) e[`e${r.key}`] = 'End must be after start';
      });
      if (overBatch) e.batch_total = `Total I/P ${Math.round(totalIn * 1000) / 1000} kg is more than the ${leftKg} kg handed over to Roasting`;
    }
    setErrors(e);
    const n = Object.keys(e).length;
    setErr(n ? `Please fix ${n} highlighted field${n > 1 ? 's' : ''}: ${Object.values(e)[0]}` : '');
    return n === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      const body = { ...f, code_no: f.code_no.trim().toUpperCase(), machine_id: batchMachine ? batchMachine.weighing_machine_id : f.machine_id };
      if (isEdit) await api.put(`/roasting/${item.id}`, body);
      else {
        // one request, many materials: each row carries its own I/P, O/P and start/end time
        await api.post('/roasting', {
          ...body, material_id: undefined, input_weight: undefined, output_weight: undefined, start_time: undefined, end_time: undefined,
          materials: rows.map((r) => ({ material_id: r.material_id, input_weight: r.input_weight, output_weight: r.output_weight, start_time: r.start_time, end_time: r.end_time })),
        });
      }
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const high = calc.loss !== null && calc.loss > alertAt;

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="fire" maxWidth={720}
      title={isEdit ? 'Edit Roasting Entry' : 'Add Roasting Entry'} subtitle={isEdit ? `${item.batch_no ? `${item.batch_no} · ` : ''}${item.material_name || ''}` : 'Batch code → add all materials of the batch'}
      footer={(
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Text numberOfLines={3} style={{ flex: 1, marginRight: 12, color: COLORS.danger, fontWeight: '700', fontSize: 12 }}>{err}</Text>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || loading || nothingToRoast || waitingOnly} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
            {isEdit ? 'Update Entry' : 'Save Roasting'}
          </Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          <Label>BATCH</Label>
          <FormRow>
            <FormField label="Date * (YYYY-MM-DD)" value={f.roast_date} onChangeText={(t) => set('roast_date')(fmtDate(t))} error={errors.roast_date} keyboardType="number-pad" maxLength={10} />
            <SelectField label="Batch code *" value={f.batch_id} options={batchOpts} onChange={onBatch} error={errors.batch_id || errors.code_no} />
          </FormRow>
          {!batchOpts.length && (
            <Text style={{ fontSize: 12, color: COLORS.danger, marginBottom: 8 }}>
              {batErr ? `Could not load the batches: ${batErr}` : 'No batch is waiting for Roasting. Complete Batching (and Filtering, if ticked) first.'}
            </Text>
          )}
          <FormRow>
            <FormField label="Recipe (from batch)" value={recipeLabel} editable={false} />
            {isEdit ? (
              <SelectField label="Material *" value={f.material_id} options={materialOpts} onChange={onMaterial} error={errors.material_id}
                disabled={!f.batch_id || loadingMat} />
            ) : <View style={{ flex: 1 }} />}
          </FormRow>
          <FormRow>
            {batchMachine ? <WeighingMachineInfo batch={batchMachine} label="MACHINE (FROM BATCHING)" /> : <SelectField label="Machine *" value={f.machine_id} options={machines} onChange={set('machine_id')} error={errors.machine_id} />}
            <View style={{ flex: 1 }} />
          </FormRow>

          {isEdit ? (
            <View>
              <Label style={{ marginTop: 6 }}>WEIGHT</Label>
              <FormRow>
                <FormField label="I/P (Kg) *" numeric value={f.input_weight} onChangeText={set('input_weight')} error={errors.input_weight} />
                <FormField label="O/P (Kg)" numeric value={f.output_weight} onChangeText={set('output_weight')} error={errors.output_weight} />
              </FormRow>
              {!!pickedMaterial && (
                <Text style={{ fontSize: 12, color: COLORS.grey, marginBottom: 8 }}>
                  Weighed in Batching: {pickedMaterial.weighed_qty} kg{pickedMaterial.filtered_qty != null ? ` · After filtering: ${pickedMaterial.filtered_qty} kg` : ''} · Already roasted: {pickedMaterial.roasted_qty} kg · Available: {pickedMaterial.remaining_qty} kg
                </Text>
              )}
            </View>
          ) : (
            <View>
              <Label style={{ marginTop: 6 }}>MATERIALS (each with its own I/P, O/P, Loss % and time)</Label>
              {!!matErr && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <MCI name="alert-circle" size={16} color={COLORS.danger} />
                  <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>Could not load the materials of this batch: {matErr}</Text>
                </View>
              )}
              {blocked.length > 0 && (
                <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: COLORS.warn, fontWeight: '800' }}>Waiting for Filtering: {blocked.map((m) => m.material_name).join(', ')}</Text>
                  <Text style={{ color: COLORS.warn, fontSize: 12, marginTop: 4 }}>
                    {waitingOnly ? 'Nothing in this batch can be roasted yet. Complete Filtering first.' : 'These materials cannot be roasted until their Filtering is completed. The other materials can be roasted now.'}
                  </Text>
                </View>
              )}
              {waitingOnly ? null : nothingToRoast ? (
                <View style={{ backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
                  <Text style={{ color: COLORS.text, fontWeight: '700' }}>Every material of this batch is already roasted.</Text>
                  <Text style={{ color: COLORS.grey, fontSize: 12, marginTop: 4, marginBottom: 8 }}>The batch is still waiting at Roasting. Send it on to Grinding.</Text>
                  <Button mode="contained" icon="arrow-right-bold" onPress={sendToGrinding} loading={saving} disabled={saving} buttonColor={COLORS.primary} style={{ borderRadius: 10, alignSelf: 'flex-start' }}>Send batch to Grinding</Button>
                </View>
              ) : (
                <View>
                  {rows.map((r, idx) => {
                    const m = materialRows.find((x) => x.material_id === r.material_id);
                    const loss = rowLoss(r);
                    const hi = loss !== null && loss > alertAt;
                    const hrs = hoursBetween(r.start_time, r.end_time);
                    return (
                      <View key={r.key} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 10, marginBottom: 10 }}>
                        <SelectField label={`Material ${idx + 1} *`} value={r.material_id} options={rowOpts(r.key)} onChange={(id) => pickRowMaterial(r.key, id)}
                          error={errors[`m${r.key}`]} disabled={!f.batch_id || loadingMat} />
                        <FormRow>
                          <FormField label="I/P (Kg) *" numeric value={r.input_weight} onChangeText={(t) => setRow(r.key, { input_weight: t })} error={errors[`i${r.key}`]} />
                          <FormField label="O/P (Kg) *" numeric value={r.output_weight} onChangeText={(t) => setRow(r.key, { output_weight: t })} error={errors[`o${r.key}`]} />
                          <View style={{ flex: 1, backgroundColor: hi ? COLORS.dangerBg : COLORS.greyBg, borderRadius: 12, padding: 10, marginBottom: 12, justifyContent: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: hi ? COLORS.danger : COLORS.grey }}>LOSS %{hi ? ' · HIGH' : ''}</Text>
                            <Text style={{ fontSize: 17, fontWeight: '900', color: hi ? COLORS.danger : COLORS.text }}>{loss === null ? '–' : `${loss} %`}</Text>
                          </View>
                        </FormRow>
                        <FormRow>
                          <TimeField label="Start time *" value={r.start_time} onChangeText={(t) => setRow(r.key, { start_time: t })} error={errors[`s${r.key}`]} />
                          <TimeField label="End time *" value={r.end_time} onChangeText={(t) => setRow(r.key, { end_time: t })} error={errors[`e${r.key}`]} min={r.start_time} />
                          <View style={{ flex: 1, backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 10, marginBottom: 12, justifyContent: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.grey }}>RUNNING HRS</Text>
                            <Text style={{ fontSize: 17, fontWeight: '900', color: COLORS.text }}>{hrs === null ? '–' : `${hrs} h`}</Text>
                          </View>
                        </FormRow>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 12, color: COLORS.grey, flex: 1 }}>
                            {m ? `Weighed ${m.weighed_qty} kg${m.filtered_qty != null ? ` · after filtering ${m.filtered_qty} kg` : ''} · available ${m.remaining_qty} kg` : ' '}
                          </Text>
                          {rows.length > 1 && (
                            <Pressable onPress={() => removeRow(r.key)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <MCI name="delete-outline" size={18} color={COLORS.danger} />
                              <Text style={{ color: COLORS.danger, fontWeight: '700', marginLeft: 2 }}>Remove</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  <Button mode="outlined" icon="plus" onPress={addRow} disabled={!f.batch_id || loadingMat || rows.length >= materialOpts.length}
                    textColor={COLORS.primary} style={{ borderRadius: 10, borderColor: COLORS.border, alignSelf: 'flex-start', marginBottom: 12 }}>Add another material</Button>
                  <Text style={{ fontSize: 12, color: COLORS.grey, marginBottom: overBatch ? 2 : 8 }}>
                    Total I/P {calc.inp} kg · Total O/P {calc.out} kg. Materials you do not add here go on to Grinding as they are.
                  </Text>
                  {overBatch && (
                    <Text style={{ fontSize: 12, color: COLORS.danger, fontWeight: '700', marginBottom: 8 }}>
                      Total I/P {Math.round(totalIn * 1000) / 1000} kg is more than the {leftKg} kg handed over to Roasting for this batch.
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          <Label style={{ marginTop: 6 }}>TEMPERATURE (°C)</Label>
          <FormRow>
            <FormField label="Before roasting" numeric value={f.temp_before} onChangeText={set('temp_before')} />
            <FormField label="STD temp" numeric value={f.std_temp} onChangeText={set('std_temp')} />
            <FormField label="After roasting" numeric value={f.temp_after} onChangeText={set('temp_after')} />
          </FormRow>

          {isEdit && (
            <View>
              <Label style={{ marginTop: 6 }}>TIME</Label>
              <FormRow>
                <TimeField label="Start time *" value={f.start_time} onChangeText={set('start_time')} error={errors.start_time} />
                <TimeField label="End time" value={f.end_time} onChangeText={set('end_time')} error={errors.end_time} min={f.start_time} />
              </FormRow>
            </View>
          )}

          {/* calculated by the system */}
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <View style={{ flex: 1, backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginRight: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.grey }}>{isEdit ? 'RUNNING HOURS' : 'TOTAL RUNNING HOURS'}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.text }}>{calc.hours === null ? '–' : `${calc.hours} hrs`}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: high ? COLORS.dangerBg : COLORS.greyBg, borderRadius: 12, padding: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: high ? COLORS.danger : COLORS.grey }}>{isEdit ? 'LOSS %' : 'TOTAL LOSS %'}{high ? '  · HIGH' : ''}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: high ? COLORS.danger : COLORS.text }}>{calc.loss === null ? '–' : `${calc.loss} %`}</Text>
            </View>
          </View>

          <FormField label="Remarks" multiline value={f.remarks} onChangeText={set('remarks')} maxLength={255} />
          {!isEdit && !nothingToRoast && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginBottom: 8 }}>
              <MCI name="information-outline" size={20} color={COLORS.grey} />
              <Text style={{ flex: 1, marginLeft: 10, fontSize: 12, color: COLORS.grey }}>Saving finishes Roasting for this batch and sends it to Grinding. No tick is needed.</Text>
            </View>
          )}

          {!!err && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 8 }}>
              <MCI name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}