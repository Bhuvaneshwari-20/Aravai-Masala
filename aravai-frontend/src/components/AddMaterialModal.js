import React, { useEffect, useState } from 'react';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import SelectField from './SelectField';
import { ErrorBox, InfoBox, ModalFooter } from './FormBits';

// "+ Add Material" inside New Batch: pick a material that already exists in Material Master.
// It is added to this product's recipe (the backend saves a new recipe version), then onAdded() lets
// the batch screen reload the recipe so the material shows up at once.
// Uses the /batches/recipe-materials endpoints, so a batching user needs no recipe permission.
export default function AddMaterialModal({ visible, productId, productName, onDismiss, onAdded }) {
  const [options, setOptions] = useState([]); // KG materials that are not in the recipe yet
  const [loading, setLoading] = useState(false);
  const [materialId, setMaterialId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return undefined;
    setMaterialId(null); setError(''); setErr(''); setSaving(false); setOptions([]);
    if (!productId) return undefined;
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const rows = (await api.get('/batches/recipe-materials', { params: { product_id: productId } })).data.data || [];
        if (live) setOptions(rows.map((m) => ({ value: m.id, label: `${m.material_name} (${m.material_code})` })));
      } catch (e) { if (live) setErr(errMsg(e)); }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [visible, productId]);

  const save = async () => {
    if (!productId) return setError('Select the product first');
    if (!materialId) return setError('Select a material');
    setError(''); setSaving(true); setErr('');
    try {
      await api.post('/batches/recipe-materials', { product_id: productId, material_id: materialId });
      setSaving(false);
      onAdded && onAdded({ material_id: materialId });
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="plus-circle-outline" maxWidth={480} title="Add Material"
      subtitle={productName ? `For ${productName}` : 'Add to this recipe'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={loading} label="Add to Batch" />}>
      <SelectField label="Material *" value={materialId} options={options} onChange={(v) => { setMaterialId(v); setError(''); }} error={error} />
      {!loading && !err && options.length === 0 && <InfoBox text="Every material is already in this recipe." />}
      <InfoBox tone="ok" text="The material is added to this product's recipe (a new recipe version is created). Earlier batches keep their old recipe." />
      <ErrorBox text={err} />
    </ModalShell>
  );
}
