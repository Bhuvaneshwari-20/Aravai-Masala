import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const EMPTY = () => ({
  roast_date: today(), machine_id: null, code_no: '', input_weight: '', output_weight: '',
  temp_before: '', std_temp: '', temp_after: '', start_time: '', end_time: '', incharge_id: 0, remarks: '',
});
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// typing 0930 -> 09:30 ;  20261102 -> 2026-11-02
const fmtTime = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };
const fmtDate = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };

// Add (no item) or Edit (item) a roasting register entry, as a popup.
// Running hours, wastage and Loss % are calculated here (preview) and again by the server (saved value).
export default function RoastingFormModal({ visible, item, onDismiss, onSaved }) {
  const isEdit = !!item;
  const [f, setF] = useState(EMPTY());
  const [machines, setMachines] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [incharges, setIncharges] = useState([{ value: 0, label: '— None —' }]);
  const [alertAt, setAlertAt] = useState(12);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(''); setSaving(false); setLoading(true);
    if (item) {
      setF({
        roast_date: item.roast_date, machine_id: item.machine_id, code_no: item.code_no,
        input_weight: String(item.input_weight ?? ''), output_weight: item.output_weight == null ? '' : String(item.output_weight),
        temp_before: item.temp_before == null ? '' : String(item.temp_before),
        std_temp: item.std_temp == null ? '' : String(item.std_temp),
        temp_after: item.temp_after == null ? '' : String(item.temp_after),
        start_time: item.start_time ? item.start_time.slice(11, 16) : '',
        end_time: item.end_time ? item.end_time.slice(11, 16) : '',
        incharge_id: item.incharge_id || 0, remarks: item.remarks || '',
      });
    } else setF(EMPTY());
    api.get('/roasting/options').then((r) => {
      const d = r.data.data;
      setMachines(d.machines.map((m) => ({ value: m.id, label: `${m.machine_code} · ${m.machine_name}` })));
      setRecipes((d.recipes || []).map((r) => ({ value: r.recipe_no, label: `${r.recipe_no} · ${r.product_name}` })));
      setIncharges([{ value: 0, label: '— None —' }, ...d.incharges.map((u) => ({ value: u.id, label: u.full_name }))]);
      setAlertAt(d.loss_alert_percent);
    }).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, item]); // eslint-disable-line

  // recipe codes for the dropdown (an old free-text code is kept visible when editing)
  const codeOptions = useMemo(() => (f.code_no && !recipes.some((r) => r.value === f.code_no)
    ? [{ value: f.code_no, label: f.code_no }, ...recipes] : recipes), [recipes, f.code_no]);

  // live preview of the calculated columns
  const calc = useMemo(() => {
    const inp = Number(f.input_weight); const out = Number(f.output_weight);
    let hours = null; let loss = null;
    if (TIME_RE.test(f.start_time) && TIME_RE.test(f.end_time)) {
      const [sh, sm] = f.start_time.split(':').map(Number); const [eh, em] = f.end_time.split(':').map(Number);
      const mins = eh * 60 + em - (sh * 60 + sm);
      if (mins > 0) hours = Math.round((mins / 60) * 100) / 100;
    }
    if (inp > 0 && f.output_weight !== '' && out > 0 && out <= inp) loss = Math.round(((inp - out) / inp) * 10000) / 100;
    return { hours, loss };
  }, [f]);

  const validate = () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.roast_date)) e.roast_date = 'Use YYYY-MM-DD';
    if (!f.machine_id) e.machine_id = 'Select a machine';
    if (!f.code_no.trim()) e.code_no = 'Select the recipe code';
    if (!(Number(f.input_weight) > 0)) e.input_weight = 'Enter I/P weight';
    if (f.output_weight !== '' && !(Number(f.output_weight) > 0)) e.output_weight = 'Enter a valid O/P weight';
    if (Number(f.output_weight) > Number(f.input_weight)) e.output_weight = 'O/P cannot be more than I/P';
    if (!TIME_RE.test(f.start_time)) e.start_time = 'Use HH:MM (24 hour)';
    if (f.end_time && !TIME_RE.test(f.end_time)) e.end_time = 'Use HH:MM (24 hour)';
    if (f.end_time && TIME_RE.test(f.end_time) && TIME_RE.test(f.start_time) && calc.hours === null) e.end_time = 'End must be after start';
    if ((f.output_weight !== '') !== !!f.end_time) e.end_time = 'Enter both O/P weight and End time, or leave both empty';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      const body = { ...f, code_no: f.code_no.trim().toUpperCase(), incharge_id: f.incharge_id || null };
      if (isEdit) await api.put(`/roasting/${item.id}`, body); else await api.post('/roasting', body);
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const high = calc.loss !== null && calc.loss > alertAt;

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="fire" maxWidth={720}
      title={isEdit ? 'Edit Roasting Entry' : 'Add Roasting Entry'} subtitle={isEdit ? item.code_no : 'Same fields as the paper register'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || loading} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
            {isEdit ? 'Update Entry' : 'Save Entry'}
          </Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          <Label>BATCH</Label>
          <FormRow>
            <FormField label="Date * (YYYY-MM-DD)" value={f.roast_date} onChangeText={(t) => set('roast_date')(fmtDate(t))} error={errors.roast_date} keyboardType="number-pad" maxLength={10} />
            <SelectField label="Machine *" value={f.machine_id} options={machines} onChange={set('machine_id')} error={errors.machine_id} />
          </FormRow>
          <SelectField label="Recipe code *" value={f.code_no || null} options={codeOptions} onChange={set('code_no')} error={errors.code_no} />

          <Label style={{ marginTop: 6 }}>WEIGHT</Label>
          <FormRow>
            <FormField label="I/P (Kg) *" numeric value={f.input_weight} onChangeText={set('input_weight')} error={errors.input_weight} />
            <FormField label="O/P (Kg)" numeric value={f.output_weight} onChangeText={set('output_weight')} error={errors.output_weight} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>TEMPERATURE (°C)</Label>
          <FormRow>
            <FormField label="Before roasting" numeric value={f.temp_before} onChangeText={set('temp_before')} />
            <FormField label="STD temp" numeric value={f.std_temp} onChangeText={set('std_temp')} />
            <FormField label="After roasting" numeric value={f.temp_after} onChangeText={set('temp_after')} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>TIME (24 hour, e.g. 0930)</Label>
          <FormRow>
            <FormField label="Start time *" value={f.start_time} onChangeText={(t) => set('start_time')(fmtTime(t))} error={errors.start_time} keyboardType="number-pad" maxLength={5} />
            <FormField label="End time" value={f.end_time} onChangeText={(t) => set('end_time')(fmtTime(t))} error={errors.end_time} keyboardType="number-pad" maxLength={5} />
          </FormRow>

          {/* calculated by the system */}
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <View style={{ flex: 1, backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginRight: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.grey }}>RUNNING HOURS</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: COLORS.text }}>{calc.hours === null ? '–' : `${calc.hours} hrs`}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: high ? COLORS.dangerBg : COLORS.greyBg, borderRadius: 12, padding: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: high ? COLORS.danger : COLORS.grey }}>LOSS %{high ? '  · HIGH' : ''}</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: high ? COLORS.danger : COLORS.text }}>{calc.loss === null ? '–' : `${calc.loss} %`}</Text>
            </View>
          </View>

          <Label style={{ marginTop: 4 }}>SIGN-OFF</Label>
          <SelectField label="Incharge" value={f.incharge_id} options={incharges} onChange={set('incharge_id')} />
          <FormField label="Remarks" multiline value={f.remarks} onChangeText={set('remarks')} maxLength={255} />

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