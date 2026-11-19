import React, { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter, Label, todayStr } from './FormBits';
import { COLORS, money } from '../theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Add a pack size (pack = null) or edit one (pack given): MRP with its "from date" and Active / Inactive.
// The gram of an existing pack is fixed (it is part of the SKU). A changed MRP is stored as a NEW MRP entry by the backend
// (the earlier MRP ends the day before), so the MRP history is never lost.
export default function PackFormModal({ visible, product, pack, onDismiss, onSaved }) {
  const isEdit = !!pack;
  const grams = useOptions('/grams', {}, (g) => ({ value: g.weight_grams, label: g.label }), visible);
  const used = new Set((product?.packs || []).map((p) => Number(p.weight_grams)));
  const freeGrams = grams.filter((g) => !used.has(Number(g.value)));
  const [weight, setWeight] = useState(null);
  const [mrp, setMrp] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(''); setSaving(false);
    if (pack) { setWeight(pack.weight_grams); setMrp(String(pack.mrp)); setFrom(pack.mrp_from || todayStr()); setActive(pack.is_active !== false); }
    else { setWeight(null); setMrp(''); setFrom(todayStr()); setActive(true); }
  }, [visible, pack]);

  const save = async () => {
    const e = {};
    if (!isEdit && !weight) e.w = 'Select the pack size';
    if (!mrp || Number(mrp) <= 0) e.m = 'Enter a valid MRP';
    if (!DATE_RE.test(from)) e.f = 'Use YYYY-MM-DD';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      if (isEdit) await api.put(`/products/${product.id}/packs/${pack.id}`, { mrp, effective_from: from, is_active: active });
      else await api.post(`/products/${product.id}/packs`, { weight_grams: weight, mrp, effective_from: from });
      setSaving(false); onSaved && onSaved(isEdit);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  const hist = pack?.mrp_history || [];
  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'package-variant-closed-plus'} maxWidth={460}
      title={isEdit ? `Edit ${pack?.packing_size_label || 'pack size'}` : 'Add Pack Size'} subtitle={product?.product_name}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={isEdit ? 'Update' : 'Add Pack Size'} />}>
      <View>
        {!isEdit && <SelectField label="Pack size *" value={weight} options={freeGrams} onChange={setWeight} error={errors.w} />}
        {!isEdit && !freeGrams.length && grams.length > 0 && <Text style={{ color: COLORS.grey, fontSize: 12.5 }}>All pack sizes in the Grams master are already added to this product.</Text>}
        <FormField label="MRP (₹) *" numeric value={mrp} onChangeText={setMrp} error={errors.m} />
        <FormField label="MRP from date (YYYY-MM-DD) *" value={from} onChangeText={setFrom} error={errors.f} maxLength={10} />
        {isEdit && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ fontWeight: '700', color: COLORS.text }}>Active</Text>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: COLORS.ok }} />
          </View>
        )}
        {isEdit && hist.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Label>MRP HISTORY</Label>
            {hist.map((h) => (
              <Text key={h.id} style={{ color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginBottom: 2 }}>
                {`${money(h.mrp)}  •  ${h.effective_from} ${h.effective_to ? `to ${h.effective_to}` : 'onwards'}${h.status === 'CURRENT' ? '  (running)' : h.status === 'UPCOMING' ? '  (upcoming)' : ''}`}
              </Text>
            ))}
          </View>
        )}
        {isEdit && <Text style={{ color: COLORS.grey, fontSize: 12.5, marginTop: 10 }}>To change the price, enter the new MRP with its from date. The old MRP ends the day before and stays in the history.</Text>}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}