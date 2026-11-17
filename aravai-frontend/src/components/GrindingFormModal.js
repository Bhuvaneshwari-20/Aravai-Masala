import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { Button, Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import TimeField from './TimeField';
import WeighingMachineInfo from './WeighingMachineInfo';
import { COLORS } from '../theme';

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const EMPTY = () => ({
  date: today(), product: '', batch_id: '', machine_id: '', batch_code: '', mesh_size: '', mesh_id: '',
  ip_wt: '', op_wt: '', sieved: 'NO', start_time: '', end_time: '', finish_grinding: true,
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
  const meshRef = useRef([]); // always the latest list (also right after a new mesh is added)
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const pickBatch = (id) => {
    const b = batches.find((x) => x.id === id);
    if (!b) return;
    setF((p) => ({ ...p, batch_id: b.id, batch_code: b.batch_no, product: b.product_name, ip_wt: String(b.available_kg) })); // I/P = roasted weight
  };

  const pickMesh = (id) => {
    const m = meshRef.current.find((x) => x.id === id);
    if (m) setF((p) => ({ ...p, mesh_id: m.id, mesh_size: String(m.mesh_size) }));
  };
  const addMesh = async (name) => {
    try {
      const r = await api.post('/grinding/meshes', { mesh_size: name });
      const m = r.data?.data || r.data;
      meshRef.current = [...meshRef.current, m];
      setMeshes(meshRef.current);
      return { value: m.id, label: `${m.mesh_size} mm` };
    } catch (e) { throw new Error(errMsg(e)); }
  };

  useEffect(() => { if (visible) { setF(EMPTY()); setErrors({}); setSaving(false); setErr(''); } }, [visible]);

  useEffect(() => {
    if (!visible) return;
    api.get('/grinding/batches')
      .then((r) => setBatches(r.data?.data || r.data || []))
      .catch((e) => setErr(errMsg(e)));
    api.get('/grinding/meshes')
      .then((r) => { const list = r.data?.data || r.data || []; meshRef.current = list; setMeshes(list); })
      .catch((e) => setErr(errMsg(e)));
    api.get('/grinding/machines')
      .then((r) => {
        const list = r.data?.data || r.data || [];
        setMachines(list);
        if (list.length === 1) setF((p) => ({ ...p, machine_id: list[0].id }));
      })
      .catch((e) => setErr(errMsg(e)));
  }, [visible]);

  const ip = Number(f.ip_wt), op = Number(f.op_wt);
  const lossKgNum = f.ip_wt && f.op_wt && ip > 0 ? ip - op : null;
  const loss = lossKgNum !== null ? ((lossKgNum / ip) * 100).toFixed(2) : '';
  const lossKg = lossKgNum !== null ? lossKgNum.toFixed(3) : '';
  const lossG = lossKgNum !== null ? (lossKgNum * 1000).toFixed(0) : '';
  // The machine is the weighing machine chosen in Batching (older batches without one still pick a grinding machine)
  const availKg = (() => { const b = batches.find((x) => x.id === f.batch_id); return b ? Number(b.available_kg) : null; })();
  const leftKg = availKg !== null && ip > 0 ? Math.round((availKg - ip) * 1000) / 1000 : null; // roasted weight not fed to grinding
  const gBatchMachine = (() => { const b = batches.find((x) => x.id === f.batch_id); return b && b.weighing_machine_id ? b : null; })();

  const validate = () => {
    const e = {};
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(f.date)) e.date = 'Use DD/MM/YYYY';
    if (!f.batch_id) e.batch_code = 'Select a batch';
    if (!gBatchMachine && !f.machine_id) e.machine_id = 'Select a machine';
    if (!f.mesh_id) e.mesh_size = 'Select the mesh size';
    if (!f.ip_wt || ip <= 0) e.ip_wt = 'Enter input weight';
    else if (availKg !== null && ip > availKg + 0.001) e.ip_wt = `Cannot be more than ${availKg} kg (weight from Roasting)`;
    if (!f.op_wt) e.op_wt = 'Enter output weight';
    else if (op <= 0) e.op_wt = 'O/P must be more than 0';
    else if (ip > 0 && op > ip) e.op_wt = 'O/P cannot be more than I/P';
    if (f.finish_grinding && leftKg !== null && leftKg > 0.001) e.ip_wt = `${leftKg} kg is not ground yet. Enter I/P ${availKg} kg, or untick "Grinding finished"`;
    if (!TIME_RE.test(f.start_time)) e.start_time = 'Select the start time';
    if (!TIME_RE.test(f.end_time)) e.end_time = 'Select the end time';
    else if (TIME_RE.test(f.start_time) && f.end_time <= f.start_time) e.end_time = 'End time must be after start time';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      await api.post('/grinding', { ...f, machine_id: gBatchMachine ? gBatchMachine.weighing_machine_id : f.machine_id, ip_time: f.start_time, op_time: f.end_time });
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
            options={batches.map((b) => ({ value: b.id, label: `${b.batch_no} · ${b.product_name}` }))}
            onChange={pickBatch} error={errors.batch_code} />
        </FormRow>
        <FormRow>
          <FormField label="Product" value={f.product} editable={false} />
          <SelectField label="Mesh size (mm) *" value={f.mesh_id || null}
            options={meshes.map((m) => ({ value: m.id, label: `${m.mesh_size} mm` }))}
            onChange={pickMesh} error={errors.mesh_size} onCreate={addMesh} createLabel="Add new mesh size (mm)" />
        </FormRow>
        <FormRow>
          <FormField label="I/P weight (kg) *" numeric value={f.ip_wt} onChangeText={set('ip_wt')} error={errors.ip_wt}
            hint={availKg !== null ? `From Roasting: ${availKg} kg` : undefined} />
          <FormField label="O/P weight (kg) *" numeric value={f.op_wt} onChangeText={set('op_wt')} error={errors.op_wt} />
        </FormRow>
        <FormRow>
          <TimeField label="Start time *" value={f.start_time} onChangeText={set('start_time')} error={errors.start_time} />
          <TimeField label="End time *" value={f.end_time} onChangeText={set('end_time')} error={errors.end_time} min={f.start_time} />
        </FormRow>
        <FormRow>
          {gBatchMachine ? <WeighingMachineInfo batch={gBatchMachine} label="MACHINE (FROM BATCHING)" /> : !f.batch_id ? (
            <FormField label="Machine (from batching)" value="Select the batch code first" editable={false} />
          ) : (
            <SelectField label="Grinding machine *" value={f.machine_id}
              options={machines.map((m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}` }))}
              onChange={set('machine_id')} error={errors.machine_id} />
          )}
          <SelectField label="Sieved" value={f.sieved} options={YESNO} onChange={set('sieved')} />
        </FormRow>
        <FormRow>
          <FormField label="Loss %" value={loss} editable={false} />
          <FormField label="Loss (kg)" value={lossKg} editable={false} />
        </FormRow>
        <FormRow>
          <FormField label="Loss (g)" value={lossG} editable={false} />
          <View style={{ flex: 1 }} />
        </FormRow>
        {!batches.length && (
          <Text style={{ fontSize: 12, color: COLORS.danger, marginBottom: 8 }}>
            No batch is waiting for Grinding. Finish Roasting first (tick "Roasting finished for this batch").
          </Text>
        )}
        <Pressable onPress={() => setF((p) => ({ ...p, finish_grinding: !p.finish_grinding }))}
          style={{ flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: f.finish_grinding ? COLORS.primary : COLORS.border }}>
          <MCI name={f.finish_grinding ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={f.finish_grinding ? COLORS.primary : COLORS.grey} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ fontWeight: '800', color: COLORS.text }}>Grinding finished for this batch</Text>
            <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 2 }}>
              {f.finish_grinding ? 'After saving, this batch goes to Blending.' : 'Not ticked: more grinding runs can be added for this batch.'}
            </Text>
          </View>
        </Pressable>
        {!!err && <Text style={{ color: COLORS.danger, fontWeight: '600' }}>{err}</Text>}
      </View>
    </ModalShell>
  );
}