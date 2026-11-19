import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import AddUnitBox from './AddUnitBox';
import useOptions from '../hooks/useOptions';
import { useAuth } from '../AuthContext';
import { ErrorBox, InfoBox, Label, ModalFooter, todayStr } from './FormBits';
import { ActivityIndicator } from 'react-native-paper';
import { COLORS } from '../theme';

// Step A1: Store Incharge enters a material receipt (vendor, invoice/challan no, material, quantity, date).
// editReceipt + materialId = the pencil on a stock card: the latest receipt of that material is fetched and filled in, and saving updates it.
// A new material has no unit: it is picked here (Unit field) with the material's first stock. New units can be added in the UNITS section.
export default function MaterialReceiptModal({ visible, materialId, editReceipt, onDismiss, onSaved }) {
  const { can } = useAuth();
  const materials = useOptions('/materials', { active: 'true' }, (m) => ({ value: m.id, label: m.unit ? `${m.material_name} (${m.unit})` : m.material_name, unit: m.unit || '' }), visible);
  const unitOpts = useOptions('/materials/units', {}, (u) => ({ value: u.unit_name, label: u.unit_name }), visible);
  const [newUnits, setNewUnits] = useState([]); // units added in this popup
  const unitChoices = [...unitOpts, ...newUnits.filter((u) => !unitOpts.some((o) => o.value === u)).map((u) => ({ value: u, label: u }))];
  const vendors = useOptions('/vendors', { status: 'ACTIVE' }, (x) => ({ value: x.id, label: x.vendor_name }), visible);
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [unitMsg, setUnitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [receiptId, setReceiptId] = useState(null); // set = editing that receipt
  const [noReceipt, setNoReceipt] = useState(false);
  const unit = materials.find((o) => o.value === f.material_id)?.unit;
  const needsUnit = !!f.material_id && !unit; // material has no unit yet -> the unit is chosen here, with its first stock
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ material_id: materialId || null, vendor_id: null, reference_no: '', quantity: '', txn_date: todayStr(), remarks: '', unit: '' });
    setErrors({}); setErr(''); setSaving(false); setUnitMsg(''); setReceiptId(null); setNoReceipt(false);
    if (!editReceipt || !materialId) { setLoading(false); return undefined; }
    // pencil: fetch what is already saved in this material's Material Receipt
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const r = (await api.get(`/stock/receipts/latest/${materialId}`)).data.data;
        if (!live) return;
        if (!r) setNoReceipt(true);
        else {
          setReceiptId(r.id);
          setF({ material_id: r.material_id, vendor_id: r.vendor_id, reference_no: r.reference_no || '', quantity: String(r.quantity ?? ''), txn_date: r.txn_date || todayStr(), remarks: r.remarks || '' });
        }
      } catch (x) { if (live) setErr(errMsg(x)); }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [visible, materialId, editReceipt]); // eslint-disable-line

  const save = async () => {
    const e = {};
    if (!f.vendor_id) e.vendor_id = 'Select the vendor';
    if (!f.reference_no.trim()) e.reference_no = 'Invoice / challan number is required';
    if (!f.material_id) e.material_id = 'Select the material';
    if (needsUnit && !f.unit) e.unit = 'Select the unit';
    const qn = Number(f.quantity);
    // editing an existing receipt may set it to 0; a NEW receipt needs more than 0
    if (f.quantity === '' || f.quantity == null || !Number.isFinite(qn) || qn < 0 || (!receiptId && qn === 0)) e.quantity = 'Enter the received quantity';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.txn_date)) e.txn_date = 'Use YYYY-MM-DD';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const body = { ...f, unit: needsUnit ? f.unit : undefined, quantity: Number(f.quantity), reference_no: f.reference_no.trim(), remarks: (f.remarks || '').trim() };
      const r = receiptId ? await api.put(`/stock/receipts/${receiptId}`, body) : await api.post('/stock/receipts', body);
      setSaving(false);
      onSaved && onSaved({ ...r.data.data, edited: !!receiptId });
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="truck-delivery" title={receiptId ? 'Edit Material Receipt' : 'Material Receipt'}
      subtitle={receiptId ? 'Latest receipt of this material' : 'Stock is added to the raw material card'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={loading} label={receiptId ? 'Update Receipt' : 'Save Receipt'} />}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
      <View>
        {noReceipt && <InfoBox text="No receipt entered for this material yet. Saving will add its first receipt." />}
        <SelectField label="Vendor *" value={f.vendor_id} options={vendors} onChange={set('vendor_id')} error={errors.vendor_id} />
        <FormField label="Invoice / challan no *" value={f.reference_no || ''} onChangeText={set('reference_no')} error={errors.reference_no} maxLength={50} />
        <SelectField label="Material *" value={f.material_id} options={materials} onChange={set('material_id')} error={errors.material_id} disabled={!!materialId} />
        {needsUnit && (
          <View>
            <InfoBox text="This material has no unit yet. Choose its unit now - it is fixed after the first stock is added." />
            <SelectField label="Unit *" value={f.unit || null} options={unitChoices} onChange={set('unit')} error={errors.unit} />
          </View>
        )}
        <FormRow>
          <FormField label={`Quantity received${(unit || f.unit) ? ` (${unit || f.unit})` : ''} *`} numeric value={f.quantity || ''} onChangeText={set('quantity')} error={errors.quantity} />
          <FormField label="Date (YYYY-MM-DD) *" value={f.txn_date || ''} onChangeText={set('txn_date')} error={errors.txn_date} maxLength={10} />
        </FormRow>
        <FormField label="Remarks" value={f.remarks || ''} onChangeText={set('remarks')} maxLength={255} />

        {(can('stock', 'create') || can('material', 'create')) && (
          <View>
            <Label style={{ marginTop: 6 }}>UNITS</Label>
            <AddUnitBox onAdded={(u) => { setNewUnits((l) => [...l, u]); if (needsUnit) set('unit')(u); setUnitMsg(needsUnit ? `Unit ${u} added and selected.` : `Unit ${u} added. You can choose it when a material gets its first stock.`); }} />
            <InfoBox tone="ok" text={unitMsg} />
          </View>
        )}
        <ErrorBox text={err} />
      </View>
      )}
    </ModalShell>
  );
}