import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator, Chip } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'].map((x) => ({ value: x, label: x }));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMPTY = {
  vendor_name: '', ref_no: '', account_name: '', account_group: '', opening_balance: '', md_name: '',
  contact_person: '', mobile: '', landline: '', sms: '', email: '',
  address: '', place: '', street: '', city: '', state: '', pin_code: '',
  gst_number: '', pan_no: '', payment_terms: '', status: 'ACTIVE',
  bank_name: '', bank_branch: '', bank_account_no: '', ifsc_code: '',
  material_ids: [],
};
const TEXT_KEYS = Object.keys(EMPTY).filter((k) => k !== 'material_ids' && k !== 'opening_balance');
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// the materials endpoint caps a page at 100 rows, so read every page
async function fetchAllMaterials() {
  const all = [];
  for (let page = 1; page <= 50; page += 1) {
    const d = (await api.get('/materials', { params: { limit: 100, page } })).data.data;
    all.push(...d.items);
    if (page >= d.total_pages) break;
  }
  return all;
}

// Add (no id) or Edit (id) vendor, as a popup on the same page.
export default function VendorFormModal({ visible, id, onDismiss, onSaved }) {
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [code, setCode] = useState('');
  const [materials, setMaterials] = useState([]);
  const [matSearch, setMatSearch] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setUpper = (k) => (t) => set(k)(t.toUpperCase());
  const toggleMaterial = (mid) => setF((p) => ({
    ...p, material_ids: p.material_ids.includes(mid) ? p.material_ids.filter((x) => x !== mid) : [...p.material_ids, mid],
  }));

  useEffect(() => {
    if (!visible) return;
    setF(EMPTY); setCode(''); setErrors({}); setErr(''); setSaving(false); setMatSearch(''); setLoading(true);
    (async () => {
      try {
        setMaterials(await fetchAllMaterials());
        if (isEdit) {
          const r = (await api.get(`/vendors/${id}`)).data.data;
          setCode(r.vendor_code);
          const next = { ...EMPTY };
          TEXT_KEYS.forEach((k) => { next[k] = r[k] ?? EMPTY[k]; });
          next.opening_balance = r.opening_balance === null || r.opening_balance === undefined ? '' : String(r.opening_balance);
          next.material_ids = (r.materials || []).map((m) => m.id);
          setF(next);
        }
      } catch (e) { setErr(errMsg(e)); }
      setLoading(false);
    })();
  }, [visible, id]); // eslint-disable-line

  const shownMaterials = useMemo(() => {
    const q = matSearch.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.material_name.toLowerCase().includes(q) || (m.category_name || '').toLowerCase().includes(q));
  }, [materials, matSearch]);

  const validate = () => {
    const e = {};
    if (!f.vendor_name.trim()) e.vendor_name = 'Vendor name is required';
    if (!/^[0-9]{10}$/.test(f.mobile)) e.mobile = 'Mobile must be exactly 10 digits';
    if (f.sms.trim() && !/^[0-9]{10}$/.test(f.sms.trim())) e.sms = 'SMS number must be exactly 10 digits';
    if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Invalid email format';
    if (f.pin_code.trim() && !/^[0-9]{6}$/.test(f.pin_code.trim())) e.pin_code = 'Pin code must be 6 digits';
    if (f.gst_number.trim() && !GST_RE.test(f.gst_number.trim().toUpperCase())) e.gst_number = 'GSTIN must be 15 characters (e.g. 33ABCDE1234F1Z5)';
    if (f.pan_no.trim() && !PAN_RE.test(f.pan_no.trim().toUpperCase())) e.pan_no = 'PAN must be 10 characters (e.g. ABCDE1234F)';
    if (f.ifsc_code.trim() && !IFSC_RE.test(f.ifsc_code.trim().toUpperCase())) e.ifsc_code = 'IFSC must be 11 characters (e.g. SBIN0001234)';
    if (f.bank_account_no.trim() && !/^[0-9]{9,18}$/.test(f.bank_account_no.trim())) e.bank_account_no = 'Account number must be 9 to 18 digits';
    if (f.opening_balance !== '' && (isNaN(Number(f.opening_balance)) || Number(f.opening_balance) < 0)) e.opening_balance = 'Enter a valid number (0 or more)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      const body = { ...f };
      TEXT_KEYS.forEach((k) => { body[k] = String(f[k]).trim(); });
      body.gst_number = body.gst_number.toUpperCase();
      body.pan_no = body.pan_no.toUpperCase();
      body.ifsc_code = body.ifsc_code.toUpperCase();
      body.opening_balance = f.opening_balance || 0;
      if (isEdit) await api.put(`/vendors/${id}`, body); else await api.post('/vendors', body);
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'store'} maxWidth={720}
      title={isEdit ? 'Edit Vendor' : 'Add Vendor'} subtitle={isEdit ? code : 'Fill in the details and save'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || loading} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
            {isEdit ? 'Update Vendor' : 'Save Vendor'}
          </Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          <Label>COMPANY</Label>
          <FormRow>
            <FormField label="Vendor name *" value={f.vendor_name} onChangeText={set('vendor_name')} error={errors.vendor_name} />
            <FormField label="Ref no" value={f.ref_no} onChangeText={set('ref_no')} maxLength={30} />
          </FormRow>
          <FormRow>
            <FormField label="Account name" value={f.account_name} onChangeText={set('account_name')} />
            <FormField label="Account group" value={f.account_group} onChangeText={set('account_group')} />
          </FormRow>
          <FormRow>
            <FormField label="MD name" value={f.md_name} onChangeText={set('md_name')} />
            <FormField label="Opening balance (₹)" numeric value={f.opening_balance} onChangeText={set('opening_balance')} error={errors.opening_balance} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>CONTACT</Label>
          <FormRow>
            <FormField label="Contact person" value={f.contact_person} onChangeText={set('contact_person')} />
            <FormField label="Mobile *" digits maxLength={10} value={f.mobile} onChangeText={set('mobile')} error={errors.mobile} />
          </FormRow>
          <FormRow>
            <FormField label="Landline" value={f.landline} onChangeText={set('landline')} maxLength={20} keyboardType="phone-pad" />
            <FormField label="SMS number" digits maxLength={10} value={f.sms} onChangeText={set('sms')} error={errors.sms} />
          </FormRow>
          <FormField label="Email" value={f.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" />

          <Label style={{ marginTop: 6 }}>ADDRESS</Label>
          <FormField label="Address" multiline value={f.address} onChangeText={set('address')} />
          <FormRow>
            <FormField label="Place" value={f.place} onChangeText={set('place')} />
            <FormField label="Street" value={f.street} onChangeText={set('street')} />
          </FormRow>
          <FormRow>
            <FormField label="City" value={f.city} onChangeText={set('city')} />
            <FormField label="State" value={f.state} onChangeText={set('state')} />
          </FormRow>
          <FormField label="Pin code" digits maxLength={6} value={f.pin_code} onChangeText={set('pin_code')} error={errors.pin_code} />

          <Label style={{ marginTop: 6 }}>BUSINESS</Label>
          <FormRow>
            <FormField label="GST number" value={f.gst_number} onChangeText={setUpper('gst_number')} error={errors.gst_number} maxLength={15} autoCapitalize="characters" />
            <FormField label="PAN number" value={f.pan_no} onChangeText={setUpper('pan_no')} error={errors.pan_no} maxLength={10} autoCapitalize="characters" />
          </FormRow>
          <FormRow>
            <FormField label="Payment terms" value={f.payment_terms} onChangeText={set('payment_terms')} hint="e.g. 30 days credit / Advance" />
            <SelectField label="Status" value={f.status} options={STATUSES} onChange={set('status')} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>BANK DETAILS</Label>
          <FormRow>
            <FormField label="Bank name" value={f.bank_name} onChangeText={set('bank_name')} />
            <FormField label="Bank branch" value={f.bank_branch} onChangeText={set('bank_branch')} />
          </FormRow>
          <FormRow>
            <FormField label="Bank account no" digits maxLength={18} value={f.bank_account_no} onChangeText={set('bank_account_no')} error={errors.bank_account_no} />
            <FormField label="IFSC code" value={f.ifsc_code} onChangeText={setUpper('ifsc_code')} error={errors.ifsc_code} maxLength={11} autoCapitalize="characters" />
          </FormRow>

          <Label style={{ marginTop: 6 }}>MATERIALS SUPPLIED  ({f.material_ids.length} selected)</Label>
          <FormField label="Search material / category" value={matSearch} onChangeText={setMatSearch} />
          {materials.length === 0 ? (
            <Text style={{ color: COLORS.grey, marginBottom: 10 }}>No materials yet. Add materials in Material Master first.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
              {shownMaterials.map((m) => {
                const on = f.material_ids.includes(m.id);
                return (
                  <Chip key={m.id} selected={on} showSelectedOverlay={false} selectedColor="#fff" onPress={() => toggleMaterial(m.id)}
                    style={{ marginRight: 8, marginBottom: 8, backgroundColor: on ? COLORS.primary : '#fff', borderWidth: 1, borderColor: on ? COLORS.primary : '#EADBD1' }}
                    textStyle={{ color: on ? '#fff' : COLORS.text, fontWeight: '600' }}>
                    {m.category_name} · {m.material_name}{m.is_active ? '' : ' (inactive)'}
                  </Chip>
                );
              })}
              {shownMaterials.length === 0 && <Text style={{ color: COLORS.grey }}>No match</Text>}
            </View>
          )}

          {!!err && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 8 }}>
              <MCI name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}
