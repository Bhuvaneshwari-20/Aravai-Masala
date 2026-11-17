import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, InfoBox, ModalFooter } from './FormBits';
import { COLORS, fmt } from '../theme';

const r3 = (n) => Math.round(n * 1000) / 1000;

// Edit batch = add one more material to this batch (a material left out earlier, or one that is not in the recipe at all).
// Stock of the material goes down and the batch weight goes up by the weighed qty.
export default function BatchEditModal({ visible, batch, onDismiss, onSaved }) {
  const materials = useOptions('/materials', { active: 'true' },
    (m) => ({ value: m.id, label: m.material_name, unit: m.unit, stock: m.current_stock }), visible);
  const [materialId, setMaterialId] = useState(null);
  const [f, setF] = useState({ no_of_bags: '', weight_per_bag: '', weighed_qty: '', touched: false });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setMaterialId(null); setF({ no_of_bags: '', weight_per_bag: '', weighed_qty: '', touched: false });
    setErrors({}); setErr(''); setSaving(false);
  }, [visible]);

  // materials already in this batch (recipe + added earlier) cannot be added again
  const options = useMemo(() => {
    const used = new Set(((batch && batch.plan && batch.plan.ingredients) || []).filter((i) => i.is_done).map((i) => i.material_id));
    return materials.filter((m) => m.unit === 'KG' && !used.has(m.value));
  }, [materials, batch]);
  const picked = options.find((o) => o.value === materialId);

  const setField = (k) => (t) => setF((p) => {
    const cur = { ...p, [k]: t };
    if (k === 'weighed_qty') cur.touched = true;
    else if (!cur.touched) { const q = (Number(cur.no_of_bags) || 0) * (Number(cur.weight_per_bag) || 0); cur.weighed_qty = q > 0 ? String(r3(q)) : ''; }
    return cur;
  });

  const save = async () => {
    const e = {};
    if (!materialId) e.material = 'Select the material';
    if (!f.weighed_qty || !(Number(f.weighed_qty) > 0)) e.weighed_qty = 'Enter weighed quantity';
    else if (picked && Number(f.weighed_qty) > Number(picked.stock)) e.weighed_qty = `Only ${fmt(picked.stock)} kg in stock`;
    if (f.no_of_bags && Number(f.no_of_bags) < 1) e.no_of_bags = 'At least 1 bag';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post(`/batches/${batch.id}/extra-material`, {
        material_id: materialId, weighed_qty: f.weighed_qty,
        no_of_bags: f.no_of_bags || undefined, weight_per_bag: f.weight_per_bag || undefined,
      });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="pencil" title="Edit Batch" subtitle={batch ? `${batch.batch_no}  •  Add a material` : ''}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Add Material" />}>
      <View>
        <InfoBox text="Adds one more material to this batch. Its stock goes down and the batch weight goes up by the weighed quantity." />
        <SelectField label="Material *" value={materialId} options={options} onChange={setMaterialId} error={errors.material} />
        {!!picked && <Text style={{ color: COLORS.grey, fontWeight: '600', marginBottom: 8 }}>Stock {fmt(picked.stock)} kg</Text>}
        <FormRow>
          <FormField label="No of bags" digits value={f.no_of_bags} onChangeText={setField('no_of_bags')} error={errors.no_of_bags} />
          <FormField label="Weight per bag (kg)" numeric value={f.weight_per_bag} onChangeText={setField('weight_per_bag')} />
        </FormRow>
        <FormField label="Weighed quantity (kg) *" numeric value={f.weighed_qty} onChangeText={setField('weighed_qty')} error={errors.weighed_qty} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}