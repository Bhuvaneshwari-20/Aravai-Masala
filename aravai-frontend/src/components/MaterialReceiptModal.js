import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter, todayStr } from './FormBits';

// Step A1: Store Incharge enters a material receipt (vendor, invoice/challan no, material, quantity, date).
export default function MaterialReceiptModal({ visible, materialId, onDismiss, onSaved }) {
  const materials = useOptions('/materials', { active: 'true' }, (m) => ({ value: m.id, label: `${m.material_name} (${m.unit})` }), visible);
  const vendors = useOptions('/vendors', { status: 'ACTIVE' }, (x) => ({ value: x.id, label: x.vendor_name }), visible);
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ material_id: materialId || null, vendor_id: null, reference_no: '', quantity: '', txn_date: todayStr(), remarks: '' });
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, materialId]);

  const save = async () => {
    const e = {};
    if (!f.vendor_id) e.vendor_id = 'Select the vendor';
    if (!f.reference_no.trim()) e.reference_no = 'Invoice / challan number is required';
    if (!f.material_id) e.material_id = 'Select the material';
    if (!f.quantity || Number(f.quantity) <= 0) e.quantity = 'Enter the received quantity';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.txn_date)) e.txn_date = 'Use YYYY-MM-DD';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/stock/receipts', { ...f, reference_no: f.reference_no.trim(), remarks: f.remarks.trim() });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="truck-delivery" title="Material Receipt" subtitle="Stock is added to the raw material card"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Receipt" />}>
      <View>
        <SelectField label="Vendor *" value={f.vendor_id} options={vendors} onChange={set('vendor_id')} error={errors.vendor_id} />
        <FormField label="Invoice / challan no *" value={f.reference_no || ''} onChangeText={set('reference_no')} error={errors.reference_no} maxLength={50} />
        <SelectField label="Material *" value={f.material_id} options={materials} onChange={set('material_id')} error={errors.material_id} disabled={!!materialId} />
        <FormRow>
          <FormField label="Quantity received *" numeric value={f.quantity || ''} onChangeText={set('quantity')} error={errors.quantity} />
          <FormField label="Date (YYYY-MM-DD) *" value={f.txn_date || ''} onChangeText={set('txn_date')} error={errors.txn_date} maxLength={10} />
        </FormRow>
        <FormField label="Remarks" value={f.remarks || ''} onChangeText={set('remarks')} maxLength={255} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
