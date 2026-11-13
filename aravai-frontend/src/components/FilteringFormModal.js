import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { useAuth } from '../AuthContext';
import { ErrorBox, ModalFooter, Label, todayStr } from './FormBits';
import { COLORS, fmt } from '../theme';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STAGE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: n === 1 ? '1 stage' : `${n} stages` }));
// typing 0930 -> 09:30 ; 20261102 -> 2026-11-02
const fmtTime = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };
const fmtDate = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };

// Filtering entry for one batch (the batch was ticked "Filtering required" in Batching).
// I/P weight comes from the batch (weight handed over by batching). Saving moves the batch to ROASTING with the O/P weight.
export default function FilteringFormModal({ visible, batch, onDismiss, onSaved }) {
  const { user } = useAuth();
  const staff = useOptions('/filtering/staff', {}, (u) => ({ value: u.id, label: `${u.full_name} (${u.role_name})` }), visible);
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible || !batch) return;
    setF({ date: todayStr(), stages: Number(batch.recipe_stages) > 0 ? Number(batch.recipe_stages) : 1, output: '', start: '', end: '',
      doneBy: user?.id || null, checkedBy: null, remarks: '' });
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, batch]); // eslint-disable-line

  const input = Number(batch?.input_kg || 0);
  const calc = useMemo(() => {
    const out = Number(f.output);
    if (!(out > 0) || out > input) return { waste: null, loss: null };
    return { waste: Math.round((input - out) * 1000) / 1000, loss: Math.round(((input - out) / input) * 10000) / 100 };
  }, [f.output, input]);

  const save = async () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Use YYYY-MM-DD';
    if (!f.stages) e.stages = 'Select stages';
    if (!(Number(f.output) > 0)) e.output = 'Enter O/P weight';
    else if (Number(f.output) > input) e.output = `Cannot be more than I/P (${fmt(input)} kg)`;
    if (!TIME_RE.test(f.start || '')) e.start = 'Use HH:MM (24 hour)';
    if (!TIME_RE.test(f.end || '')) e.end = 'Use HH:MM (24 hour)';
    else if (TIME_RE.test(f.start || '') && f.end <= f.start) e.end = 'End must be after start';
    if (!f.doneBy) e.doneBy = 'Select who filtered';
    if (!f.checkedBy) e.checkedBy = 'Select who checked';
    else if (f.checkedBy === f.doneBy) e.checkedBy = 'Must be a different person';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/filtering', { batch_id: batch.batch_id, filter_date: f.date, stages: f.stages, output_weight: f.output,
        start_time: f.start, end_time: f.end, done_by: f.doneBy, checked_by: f.checkedBy, remarks: f.remarks || undefined });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  const high = calc.loss !== null && calc.loss > 5;

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="filter-variant" maxWidth={640}
      title="Filtering" subtitle={batch ? `${batch.batch_no} · ${batch.product_name}` : ''}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save & Send to Roasting" />}>
      <View>
        <Label>FILTERING</Label>
        <FormRow>
          <FormField label="Date * (YYYY-MM-DD)" value={f.date || ''} onChangeText={(t) => set('date')(fmtDate(t))} error={errors.date} keyboardType="number-pad" maxLength={10} />
          <SelectField label="Filtering stages *" value={f.stages || null} options={STAGE_OPTIONS} onChange={set('stages')} error={errors.stages} />
        </FormRow>

        <Label style={{ marginTop: 6 }}>WEIGHT</Label>
        <FormRow>
          <View style={{ flex: 1, backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginBottom: 16, justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.grey }}>I/P (KG) - FROM BATCHING</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.text }}>{fmt(input)}</Text>
          </View>
          <FormField label="O/P (Kg) *" numeric value={f.output || ''} onChangeText={set('output')} error={errors.output} />
        </FormRow>
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          <View style={{ flex: 1, backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginRight: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.grey }}>WASTAGE</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.text }}>{calc.waste === null ? '–' : `${calc.waste} kg`}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: high ? COLORS.dangerBg : COLORS.greyBg, borderRadius: 12, padding: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: high ? COLORS.danger : COLORS.grey }}>LOSS %</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: high ? COLORS.danger : COLORS.text }}>{calc.loss === null ? '–' : `${calc.loss} %`}</Text>
          </View>
        </View>

        <Label style={{ marginTop: 4 }}>TIME (24 hour, e.g. 0930)</Label>
        <FormRow>
          <FormField label="Start time *" value={f.start || ''} onChangeText={(t) => set('start')(fmtTime(t))} error={errors.start} keyboardType="number-pad" maxLength={5} />
          <FormField label="End time *" value={f.end || ''} onChangeText={(t) => set('end')(fmtTime(t))} error={errors.end} keyboardType="number-pad" maxLength={5} />
        </FormRow>

        <Label style={{ marginTop: 4 }}>SIGN-OFF</Label>
        <FormRow>
          <SelectField label="Done by *" value={f.doneBy || null} options={staff} onChange={set('doneBy')} error={errors.doneBy} />
          <SelectField label="Checked by *" value={f.checkedBy || null} options={staff} onChange={set('checkedBy')} error={errors.checkedBy} />
        </FormRow>
        <FormField label="Remarks" multiline value={f.remarks || ''} onChangeText={set('remarks')} maxLength={255} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}