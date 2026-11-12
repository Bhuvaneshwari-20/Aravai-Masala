import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { ErrorBox, ModalFooter, Label } from './FormBits';
import { todayStr } from './FormBits';
import { COLORS } from '../theme';

const ISSUE_TYPES = ['PRODUCTION', 'SAMPLE', 'WASTAGE', 'RETURN_TO_VENDOR', 'OTHER'].map((t) => ({ value: t, label: t.replace(/_/g, ' ') }));
const DIRECTIONS = [{ value: 'IN', label: 'Add to stock (found extra)' }, { value: 'OUT', label: 'Reduce stock (short / damaged)' }];

// Step A3: store issue or stock correction, both written to the Material Card.
// mode = 'issue' | 'adjust'
export default function StockMoveModal({ visible, mode, material, onDismiss, onSaved }) {
  const isIssue = mode === 'issue';
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ quantity: '', txn_date: todayStr(), purpose: '', issue_type: 'OTHER', direction: 'OUT', reason: '' });
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, mode]);

  const save = async () => {
    const e = {};
    if (!f.quantity || Number(f.quantity) <= 0) e.quantity = 'Enter a quantity';
    if (isIssue && !f.purpose.trim()) e.purpose = 'Purpose is required';
    if (!isIssue && !f.reason.trim()) e.reason = 'Reason is required';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.txn_date)) e.txn_date = 'Use YYYY-MM-DD';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const body = isIssue
        ? { material_id: material.id, quantity: f.quantity, txn_date: f.txn_date, purpose: f.purpose.trim(), issue_type: f.issue_type }
        : { material_id: material.id, quantity: f.quantity, txn_date: f.txn_date, direction: f.direction, reason: f.reason.trim() };
      const r = await api.post(isIssue ? '/stock/issues' : '/stock/adjustments', body);
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isIssue ? 'arrow-up-bold-box' : 'scale-unbalanced'}
      title={isIssue ? 'Issue Material' : 'Stock Correction'} subtitle={material ? `${material.material_name} - balance ${material.current_stock} ${material.unit}` : ''}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={isIssue ? 'Issue' : 'Apply Correction'} color={isIssue ? COLORS.primary : COLORS.green} />}>
      <View>
        {!isIssue && <SelectField label="Correction type *" value={f.direction} options={DIRECTIONS} onChange={set('direction')} />}
        {isIssue && <SelectField label="Issue type *" value={f.issue_type} options={ISSUE_TYPES} onChange={set('issue_type')} />}
        <FormRow>
          <FormField label={`Quantity (${material?.unit || ''}) *`} numeric value={f.quantity || ''} onChangeText={set('quantity')} error={errors.quantity} />
          <FormField label="Date (YYYY-MM-DD) *" value={f.txn_date || ''} onChangeText={set('txn_date')} error={errors.txn_date} maxLength={10} />
        </FormRow>
        {isIssue
          ? <FormField label="Purpose *" value={f.purpose || ''} onChangeText={set('purpose')} error={errors.purpose} maxLength={255} />
          : <FormField label="Reason *" value={f.reason || ''} onChangeText={set('reason')} error={errors.reason} maxLength={255} />}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
