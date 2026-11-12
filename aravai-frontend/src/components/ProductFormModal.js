import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter, Label, todayStr } from './FormBits';
import { COLORS, money } from '../theme';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const newPack = () => ({ weight_grams: null, mrp: '', from: todayStr(), existing: false });

// Add (no product) or Edit (product) : name and pack sizes.
// Gram comes from the Grams master. Every MRP has a "from date"; the older MRP ends the day before.
export default function ProductFormModal({ visible, product, onDismiss, onSaved }) {
  const isEdit = !!product;
  const grams = useOptions('/grams', {}, (g) => ({ value: g.weight_grams, label: g.label }), visible);
  const [name, setName] = useState('');
  const [packs, setPacks] = useState([newPack()]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(''); setSaving(false);
    if (product) {
      setName(product.product_name);
      setPacks(product.packs.map((p) => ({ id: p.id, weight_grams: p.weight_grams, mrp: String(p.mrp), from: p.mrp_from || todayStr(),
        orig_mrp: String(p.mrp), orig_from: p.mrp_from || todayStr(), history: p.mrp_history || [], existing: true })));
    } else { setName(''); setPacks([newPack()]); }
  }, [visible, product]);

  const setPack = (i, k, v) => setPacks((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    const e = {};
    if (!name.trim()) e.name = 'Product name is required';
    if (!packs.length) e.dup = 'Add at least one gram with MRP';
    packs.forEach((p, i) => {
      if (!p.weight_grams) e[`w${i}`] = 'Select the gram';
      if (!p.mrp || Number(p.mrp) <= 0) e[`m${i}`] = 'Enter MRP';
      if (!DATE_RE.test(p.from)) e[`f${i}`] = 'Use YYYY-MM-DD';
    });
    const ws = packs.map((p) => p.weight_grams).filter(Boolean);
    if (new Set(ws).size !== ws.length) e.dup = 'Same gram added twice';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      if (isEdit) {
        await api.put(`/products/${product.id}`, { product_name: name.trim(), category: product.category || '' }); // category field removed from the form; keep the stored value
        for (const p of packs) {
          if (p.existing) {
            if (p.mrp !== p.orig_mrp || p.from !== p.orig_from) await api.put(`/products/${product.id}/packs/${p.id}`, { mrp: p.mrp, effective_from: p.from });
          } else {
            await api.post(`/products/${product.id}/packs`, { weight_grams: p.weight_grams, mrp: p.mrp, effective_from: p.from });
          }
        }
      } else {
        await api.post('/products', { product_name: name.trim(),
          packs: packs.map((p) => ({ weight_grams: p.weight_grams, mrp: p.mrp, effective_from: p.from })) });
      }
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'tag-plus'} title={isEdit ? 'Edit Product' : 'Add Product'}
      subtitle={isEdit ? product?.product_code : 'Product with gram, MRP and from date'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={isEdit ? 'Update Product' : 'Save Product'} />}>
      <View>
        <Label>PRODUCT</Label>
        <FormField label="Product name *" value={name} onChangeText={setName} error={errors.name} maxLength={120} />
        <Label style={{ marginTop: 6 }}>GRAM, MRP & FROM DATE</Label>
        {packs.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <FormRow>
                <SelectField label="Gram *" value={p.weight_grams} options={grams} onChange={(v) => setPack(i, 'weight_grams', v)}
                  disabled={p.existing} error={errors[`w${i}`]} />
                <FormField label="MRP (₹) *" numeric value={p.mrp} onChangeText={(t) => setPack(i, 'mrp', t)} error={errors[`m${i}`]} />
              </FormRow>
              <FormField label="From date (YYYY-MM-DD) *" value={p.from} onChangeText={(t) => setPack(i, 'from', t)} error={errors[`f${i}`]} maxLength={10} />
              {!!p.history?.length && p.history.map((h) => (
                <Text key={h.id} style={{ color: COLORS.grey, fontSize: 12, fontWeight: '600' }}>
                  {money(h.mrp)}  •  {h.effective_from} {h.effective_to ? `to ${h.effective_to}` : 'onwards'}{h.status === 'CURRENT' ? '  (running)' : h.status === 'UPCOMING' ? '  (upcoming)' : ''}
                </Text>
              ))}
            </View>
            {(packs.length > 1 && !p.existing) && <IconButton icon="close" size={20} iconColor={COLORS.danger} style={{ marginTop: 10 }}
              onPress={() => setPacks((x) => x.filter((_, j) => j !== i))} />}
          </View>
        ))}
        <Button mode="outlined" icon="plus" onPress={() => setPacks((p) => [...p, newPack()])} textColor={COLORS.green}
          style={{ borderRadius: 10, borderColor: COLORS.green, alignSelf: 'flex-start', marginTop: 6 }}>Add gram</Button>
        {isEdit && <Text style={{ color: COLORS.grey, fontSize: 12.5, marginTop: 10 }}>To change a price, enter the new MRP with its from date. The old MRP ends the day before.</Text>}
        {!grams.length && <Text style={{ color: COLORS.danger, fontSize: 12.5, marginTop: 8 }}>No grams found. Add them first in Masters → Grams.</Text>}
        <ErrorBox text={errors.dup || err} />
      </View>
    </ModalShell>
  );
}