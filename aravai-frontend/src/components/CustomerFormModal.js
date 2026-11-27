import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { ErrorBox, ModalFooter } from './FormBits';
import { CUSTOMER_TYPES } from '../screens/sales/salesUtils';

// Quick add of a Customer / Agency from the New Sales Entry page.
export default function CustomerFormModal({ visible, onDismiss, onSaved }) {
  const [f, setF] = useState({ name: '', customer_type: 'CUSTOMER', phone: '', city: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ name: '', customer_type: 'CUSTOMER', phone: '', city: '' }); setErrors({}); setErr(''); setSaving(false);
  }, [visible]);

  const save = async () => {
    const e = {};
    if (!f.name.trim()) e.name = 'Enter the name';
    if (f.phone && !/^[0-9+\-\s]{7,15}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/sales/customers', { name: f.name.trim(), customer_type: f.customer_type, phone: f.phone.trim(), city: f.city.trim() });
      setSaving(false); onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="account-plus" maxWidth={460}
      title="Add Customer / Agency" subtitle="Used on sales invoices"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Add" />}>
      <View>
        <FormField label="Name *" value={f.name} onChangeText={set('name')} error={errors.name} />
        <SelectField label="Type *" value={f.customer_type} options={CUSTOMER_TYPES} onChange={set('customer_type')} />
        <FormRow>
          <FormField label="Phone" value={f.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" maxLength={15} />
          <FormField label="City" value={f.city} onChangeText={set('city')} />
        </FormRow>
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
