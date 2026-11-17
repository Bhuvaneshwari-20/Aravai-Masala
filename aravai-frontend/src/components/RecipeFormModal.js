import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text, Chip } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import SelectField from './SelectField';
import MultiSelectField from './MultiSelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter, Label } from './FormBits';
import { COLORS } from '../theme';

// Recipe = product + the materials used. No quantities here (they are weighed in Batching).
// One product = one recipe. If the product already has a recipe, its materials are shown and only NEW materials are added to it.
export default function RecipeFormModal({ visible, onDismiss, onSaved }) {
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), visible);
  const materials = useOptions('/materials', { active: 'true' }, (m) => ({ value: m.id, label: m.material_name, unit: m.unit }), visible);
  const [productId, setProductId] = useState(null);
  const [existing, setExisting] = useState(null); // current recipe of the selected product (if any)
  const kgMaterials = useMemo(() => {
    const have = new Set((existing?.ingredients || []).map((i) => i.material_id));
    return materials.filter((m) => m.unit === 'KG' && !have.has(m.value));
  }, [materials, existing]);
  const [picked, setPicked] = useState([]); // selected material ids (multi-select)
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setProductId(null); setExisting(null); setPicked([]); setErrors({}); setErr(''); setSaving(false);
  }, [visible]);

  // when a product is picked, look up its existing recipe so we add to it instead of creating a duplicate
  useEffect(() => {
    setExisting(null); setPicked([]);
    if (!productId) return undefined;
    let live = true;
    (async () => {
      try {
        const list = (await api.get('/recipes', { params: { product_id: productId, limit: 20 } })).data.data.items || [];
        const rec = list.find((x) => x.is_active) || list[0];
        if (!rec) return;
        const full = (await api.get(`/recipes/${rec.id}`)).data.data;
        if (live) setExisting(full);
      } catch (x) { if (live) setErr(errMsg(x)); }
    })();
    return () => { live = false; };
  }, [productId]);

  const save = async () => {
    const e = {};
    if (!productId) e.product = 'Select the product';
    if (!picked.length) e.materials = 'Select at least one material';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      await api.post('/recipes', { product_id: productId, ingredients: picked.map((id) => ({ material_id: id })) });
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="book-plus"
      title={existing ? 'Add Materials' : 'New Recipe'} subtitle={existing ? 'Recipe already exists for this product' : 'Product and its materials'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={existing ? 'Add to Recipe' : 'Save Recipe'} />}>
      <View>
        <SelectField label="Product *" value={productId} options={products} onChange={setProductId} error={errors.product} />
        {!!existing && (
          <View style={{ marginBottom: 10 }}>
            <Label>ALREADY IN RECIPE</Label>
            <Text style={{ color: COLORS.textSoft, fontSize: 13.5, fontWeight: '600' }}>
              {existing.ingredients.map((i) => i.material_name).join('  •  ')}
            </Text>
          </View>
        )}
        <Label style={{ marginTop: 6 }}>{existing ? 'ADD MATERIALS (KG)' : 'MATERIALS (KG)'}</Label>
        <MultiSelectField label="Materials *" values={picked} options={kgMaterials} onChange={setPicked} error={errors.materials} />
        {picked.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
            {kgMaterials.filter((m) => picked.includes(m.value)).map((m) => (
              <Chip key={String(m.value)} onClose={() => setPicked((p) => p.filter((x) => x !== m.value))}
                style={{ marginRight: 8, marginBottom: 8, backgroundColor: COLORS.primarySoft }}>{m.label}</Chip>
            ))}
          </View>
        )}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}