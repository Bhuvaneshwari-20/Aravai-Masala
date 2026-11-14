import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const EMPTY = () => ({
  date: today(), product: '', batch_id: '', machine_id: '', batch_code: '', mesh_size: '',
  ip_wt: '', op_wt: '', sieved: 'NO', ip_time: '', op_time: '', sign: '',
});
const YESNO = [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export default function GrindingFormModal({ visible, onDismiss, onSaved }) {
  const [f, setF] = useState(EMPTY());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [batches, setBatches] = useState([]);
  const [machines, setMachines] = useState([]);
  const [meshes, setMeshes] = useState([]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const pickBatch = (id) => {
    const b = batches.find((x) => x.id === id);
    if (!b) return;
    setF((p) => ({ ...p, batch_id: b.id, batch_code: b.batch_no, product: b.product_name }));
  };

  useEffect(() => { if (visible) { setF(EMPTY()); setErrors({}); setSaving(false); setErr(''); } }, [visible]);

  useEffect(() => {
    if (!visible) return;
    api.get('/grinding/batches')
      .then((r) => setBatches(r.data?.data || r.data || []))
      .catch((e) => setErr(errMsg(e)));
    api.get('/grinding/machines')
      .then((r) => {
        const list = r.data?.data || r.data || [];
        setMachines(list);
        if (list.length === 1) setF((p) => ({ ...p, machine_id: list[0].id }));
      })
      .catch((e) => setErr(errMsg(e)));
    api.get('/grinding/meshes')
      .then((r) => setMeshes(r.data?.data || r.data || []))
      .catch((e) => setErr(errMsg(e)));
  }, [visible]);

  const ip = Number(f.ip_wt), op = Number(f.op_wt);
  const lossKgNum = f.ip_wt && f.op_wt && ip > 0 ? ip - op : null;
  const loss = lossKgNum !== null ? ((lossKgNum / ip) * 100).toFixed(2) : '';
  const lossKg = lossKgNum !== null ? lossKgNum.toFixed(3) : '';
  const lossG = lossKgNum !== null ? (lossKgNum * 1000).toFixed(0) : '';

  const validate = () => {
    const e = {};
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(f.date)) e.date = 'Use DD/MM/YYYY';
    if (!f.batch_id) e.batch_code = 'Select a batch';
    if (!f.machine_id) e.machine_id = 'Select a machine';
    if (!f.mesh_size) e.mesh_size = 'Select a mesh size';
    if (!f.ip_wt || ip <= 0) e.ip_wt = 'Enter input weight';
    if (!f.op_wt) e.op_wt = 'Enter output weight';
    if (!TIME_RE.test(f.ip_time)) e.ip_time = 'Use HH:MM (24h)';
    if (!TIME_RE.test(f.op_time)) e.op_time = 'Use HH:MM (24h)';
    if (!f.sign.trim()) e.sign = 'Operator sign is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      await api.post('/grinding', f);
      setSaving(false);
      onSaved && onSaved();
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="mortar-pestle" maxWidth={720}
      title="Grinding Entry" subtitle="Fill in the details and save"
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">Save Entry</Button>
        </View>
      )}>
      <View>
        <FormRow>
          <FormField label="Date *" value={f.date} onChangeText={set('date')} error={errors.date} />
          <SelectField label="Batch code *" value={f.batch_id}
            options={batches.map((b) => ({ value: b.id, label: b.batch_no }))}
            onChange={pickBatch} error={errors.batch_code} />
        </FormRow>
        <FormRow>
          <FormField label="Product" value={f.product} editable={false} />
          <SelectField label="Mesh size (mm) *" value={f.mesh_size}
            options={meshes.map((m) => ({ value: m.mesh_size, label: m.mesh_size }))}
            onChange={set('mesh_size')} error={errors.mesh_size} />
        </FormRow>
        <FormRow>
          <FormField label="I/P weight (kg) *" numeric value={f.ip_wt} onChangeText={set('ip_wt')} error={errors.ip_wt} />
          <FormField label="O/P weight (kg) *" numeric value={f.op_wt} onChangeText={set('op_wt')} error={errors.op_wt} />
        </FormRow>
        <FormRow>
          <FormField label="I/P time *" value={f.ip_time} onChangeText={set('ip_time')} error={errors.ip_time} hint="HH:MM, e.g. 10:00" maxLength={5} />
          <FormField label="O/P time *" value={f.op_time} onChangeText={set('op_time')} error={errors.op_time} hint="HH:MM, e.g. 11:30" maxLength={5} />
        </FormRow>
        <FormRow>
          <SelectField label="Grinding machine *" value={f.machine_id}
            options={machines.map((m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}` }))}
            onChange={set('machine_id')} error={errors.machine_id} />
          <SelectField label="Sieved" value={f.sieved} options={YESNO} onChange={set('sieved')} />
        </FormRow>
        <FormRow>
          <FormField label="Loss %" value={loss} editable={false} hint="Auto: (I/P − O/P) ÷ I/P × 100" />
          <FormField label="Loss (kg)" value={lossKg} editable={false} hint="Auto: I/P − O/P" />
        </FormRow>
        <FormRow>
          <FormField label="Loss (g)" value={lossG} editable={false} hint="Auto: kg × 1000" />
          <View style={{ flex: 1 }} />
        </FormRow>
        <FormField label="Operator sign *" value={f.sign} onChangeText={set('sign')} error={errors.sign} />
        {!!err && <Text style={{ color: COLORS.danger, fontWeight: '600' }}>{err}</Text>}
      </View>
    </ModalShell>
  );
}