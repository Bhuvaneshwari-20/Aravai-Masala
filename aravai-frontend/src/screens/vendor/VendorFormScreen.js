import React, { useEffect, useState } from 'react';
import { ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Button, Snackbar } from 'react-native-paper';
import api, { errMsg } from '../../api';
import FormField from '../../components/FormField';
import SelectField from '../../components/SelectField';
import Section from '../../components/Section';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS } from '../../theme';

const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'].map((x) => ({ value: x, label: x }));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function VendorFormScreen({ route, navigation }) {
  const id = route.params?.id;
  const isEdit = !!id;
  const [loading, setLoading] = useState(isEdit);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState({
    vendor_name: '', contact_person: '', mobile: '', email: '', address: '',
    gst_number: '', payment_terms: '', status: 'ACTIVE',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    if (!isEdit) return;
    setLoading(true); setLoadErr('');
    try {
      const r = (await api.get(`/vendors/${id}`)).data.data;
      setF({
        vendor_name: r.vendor_name, contact_person: r.contact_person || '', mobile: r.mobile || '',
        email: r.email || '', address: r.address || '', gst_number: r.gst_number || '',
        payment_terms: r.payment_terms || '', status: r.status,
      });
    } catch (e) { setLoadErr(errMsg(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!f.vendor_name.trim()) e.vendor_name = 'Vendor name is required';
    if (!/^[0-9]{10}$/.test(f.mobile)) e.mobile = 'Mobile exactly 10 digits irukkanum';
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Invalid email format';
    if (f.gst_number.trim() && !GST_RE.test(f.gst_number.trim().toUpperCase())) e.gst_number = 'GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { ...f, vendor_name: f.vendor_name.trim(), email: f.email.trim(), gst_number: f.gst_number.trim().toUpperCase() };
      if (isEdit) {
        await api.put(`/vendors/${id}`, body);
        navigation.goBack();
      } else {
        const r = await api.post('/vendors', body);
        navigation.replace('VendorDetail', { id: r.data.data.id });
      }
    } catch (e) { setMsg(errMsg(e)); setSaving(false); }
  };

  if (loading) return <LoadingView />;
  if (loadErr) return <EmptyView error={loadErr} onRetry={load} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Container maxWidth={720}>
        <Section title="Company" icon="🏭" delay={0}>
        <FormField label="Vendor name *" value={f.vendor_name} onChangeText={set('vendor_name')} error={errors.vendor_name} />
        <FormField label="Address" multiline value={f.address} onChangeText={set('address')} />
        </Section>

        <Section title="Contact" icon="📞" delay={120}>
        <FormField label="Contact person" value={f.contact_person} onChangeText={set('contact_person')} />
        <FormField label="Mobile *" digits maxLength={10} value={f.mobile} onChangeText={set('mobile')} error={errors.mobile} />
        <FormField label="Email" value={f.email} onChangeText={set('email')} error={errors.email}
          keyboardType="email-address" autoCapitalize="none" />
        </Section>

        <Section title="Business" icon="🧾" delay={240}>
        <FormField label="GST number" value={f.gst_number} onChangeText={(t) => set('gst_number')(t.toUpperCase())} error={errors.gst_number}
          maxLength={15} autoCapitalize="characters" />
        <FormField label="Payment terms" value={f.payment_terms} onChangeText={set('payment_terms')} hint="e.g. 30 days credit / Advance" />
        <SelectField label="Status" value={f.status} options={STATUSES} onChange={set('status')} />
        </Section>
        <Button mode="contained" onPress={save} loading={saving} disabled={saving} contentStyle={{ paddingVertical: 8 }}
          buttonColor={COLORS.primary} style={{ marginTop: 4, borderRadius: 16 }}>{isEdit ? 'Update' : 'Save'}</Button>
        </Container>
      </ScrollView>
      <Snackbar visible={!!msg} onDismiss={() => setMsg('')} duration={4000}
        action={{ label: 'OK', onPress: () => setMsg('') }}>{msg}</Snackbar>
    </KeyboardAvoidingView>
  );
}
