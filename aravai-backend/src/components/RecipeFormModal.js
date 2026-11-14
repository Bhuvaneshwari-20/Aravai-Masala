import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, IconButton } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter, Label } from './FormBits';
import { COLORS } from '../theme';

// Recipe = product + the materials used. No quantities here (they are weighed in Batching).
// Saving always creates a NEW version; older versions of the product are switched off by the backend.
export default function RecipeFormModal({ visible, onDismiss, onSaved }) {
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), visible);
  const materials = useOptions('/materials', { active: 'true' }, (m) => ({ value: m.id, label: m.material_name, unit: m.unit }), visible);
  const kgMaterials = useMemo(() => materials.filter((m) => m.unit === 'KG'), [materials]);
  const [productId, setProductId] = useState(null);
  const [rows, setRows] = useState([null]); // material ids
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setProductId(null); setRows([null]); setErrors({}); setErr(''); setSaving(false);
  }, [visible]);

  const save = async () => {
    const e = {};
    if (!productId) e.product = 'Select the product';
    rows.forEach((m, i) => { if (!m) e[`m${i}`] = 'Select material'; });
    const ids = rows.filter(Boolean);
    if (new Set(ids).size !== ids.length) e.dup = 'A material is added twice';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      await api.post('/recipes', { product_id: productId, ingredients: ids.map((id) => ({ material_id: id })) });
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="book-plus" title="New Recipe" subtitle="Product and its materials"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Recipe" />}>
      <View>
        <SelectField label="Product *" value={productId} options={products} onChange={setProductId} error={errors.product} />
        <Label style={{ marginTop: 6 }}>MATERIALS (KG)</Label>
        {rows.map((m, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <SelectField label="Material *" value={m} options={kgMaterials} onChange={(v) => setRows((r) => r.map((x, j) => (j === i ? v : x)))} error={errors[`m${i}`]} />
            </View>
            {rows.length > 1 && <IconButton icon="close" size={20} iconColor={COLORS.danger} style={{ marginTop: 10 }} onPress={() => setRows((x) => x.filter((_, j) => j !== i))} />}
          </View>
        ))}
        <Button mode="outlined" icon="plus" onPress={() => setRows((r) => [...r, null])} textColor={COLORS.green}
          style={{ borderRadius: 10, borderColor: COLORS.green, alignSelf: 'flex-start', marginTop: 4 }}>Add material</Button>
        <ErrorBox text={errors.dup || err} />
      </View>
    </ModalShell>
  );
}
