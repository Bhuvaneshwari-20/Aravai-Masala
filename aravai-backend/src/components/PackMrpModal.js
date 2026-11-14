import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import { ErrorBox, ModalFooter } from './FormBits';

// Change MRP of one pack size. The backend keeps the old value in the rate history.
export default function PackMrpModal({ visible, product, pack, onDismiss, onSaved }) {
  const [mrp, setMrp] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible && pack) { setMrp(String(pack.mrp)); setErr(''); setSaving(false); } }, [visible, pack]);

  const save = async () => {
    if (!mrp || Number(mrp) <= 0) return setErr('Enter a valid MRP');
    setSaving(true); setErr('');
    try {
      await api.put(`/products/${product.id}/packs/${pack.id}`, { mrp });
      setSaving(false); onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="currency-inr" maxWidth={420}
      title="Change MRP" subtitle={pack ? `${product?.product_name} - ${pack.packing_size_label}` : ''}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Update MRP" />}>
      <View>
        <FormField label="New MRP (₹) *" numeric value={mrp} onChangeText={setMrp} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
