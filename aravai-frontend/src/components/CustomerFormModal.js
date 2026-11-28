import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { ErrorBox, ModalFooter } from './FormBits';
import { CUSTOMER_TYPES } from '../screens/sales/salesUtils';

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const blank = { name: '', customer_type: 'CUSTOMER', contact_person: '', mobile: '', city: '', gst: '', address: '', active: 'ACTIVE' };

// Add (customer = null) or edit (customer = row of GET /sales/customers) a Customer / Agency.
export default function CustomerFormModal({ visible, customer, onDismiss, onSaved }) {
  const edit = !!customer;
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF(customer ? {
      name: customer.customer_name || '', customer_type: customer.customer_type || 'CUSTOMER', contact_person: customer.contact_person || '',
      mobile: customer.mobile || '', city: customer.city || '', gst: customer.gst_number || '', address: customer.address || '',
      active: customer.is_active ? 'ACTIVE' : 'INACTIVE',
    } : blank);
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, customer]);

  const save = async () => {
    const e = {};
    if (!f.name.trim()) e.name = 'Enter the name';
    if (f.mobile && !/^[0-9]{10}$/.test(f.mobile.trim())) e.mobile = 'Mobile must be 10 digits';
    if (f.gst && !GST_RE.test(f.gst.trim().toUpperCase())) e.gst = 'GST number is not valid';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    const body = {
      customer_name: f.name.trim(), customer_type: f.customer_type, contact_person: f.contact_person.trim(), mobile: f.mobile.trim(),
      city: f.city.trim(), gst_number: f.gst.trim().toUpperCase(), address: f.address.trim(),
    };
    try {
      let r;
      if (edit) r = await api.put(`/sales/customers/${customer.id}`, { ...body, email: customer.email || '', is_active: f.active === 'ACTIVE' });
      else r = await api.post('/sales/customers', body);
      setSaving(false); onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={edit ? 'account-edit-outline' : 'account-plus'} maxWidth={520}
      title={edit ? 'Edit Customer / Agency' : 'Add Customer / Agency'} subtitle={edit ? customer.customer_code : 'Used on sales invoices'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={edit ? 'Save changes' : 'Add'} />}>
      <View>
        <FormField label="Name *" value={f.name} onChangeText={set('name')} error={errors.name} maxLength={150} />
        <FormRow>
          <SelectField label="Type *" value={f.customer_type} options={CUSTOMER_TYPES} onChange={set('customer_type')} />
          <FormField label="Contact person" value={f.contact_person} onChangeText={set('contact_person')} maxLength={100} />
        </FormRow>
        <FormRow>
          <FormField label="Mobile" value={f.mobile} onChangeText={set('mobile')} error={errors.mobile} digits maxLength={10} />
          <FormField label="City" value={f.city} onChangeText={set('city')} maxLength={80} />
        </FormRow>
        <FormField label="GSTIN" value={f.gst} onChangeText={(t) => set('gst')(t.toUpperCase())} error={errors.gst} maxLength={15} autoCapitalize="characters" />
        <FormField label="Address" value={f.address} onChangeText={set('address')} multiline maxLength={500} />
        {edit && <SelectField label="Status" value={f.active} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} onChange={set('active')} />}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
