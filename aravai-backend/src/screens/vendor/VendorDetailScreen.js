import React, { useCallback, useState } from 'react';
import { View, ScrollView, Linking } from 'react-native';
import { Text, Snackbar } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import VendorFormModal from '../../components/VendorFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { DetailHeader, InfoCard, ActionBtn, Pill } from '../../components/DetailLayout';
import { COLORS, colorFor, money } from '../../theme';
import { STATUS_STYLE } from './VendorListScreen';

const STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

export default function VendorDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const [v, setV] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null); // status waiting for confirmation
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/vendors/${id}`);
      setV(r.data.data); setError('');
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const call = () => Linking.openURL(`tel:${v.mobile}`).catch(() => setMsg('Unable to place a call from this device'));

  const changeStatus = async () => {
    setBusy(true);
    try {
      const r = await api.patch(`/vendors/${id}/status`, { status: target });
      setV(r.data.data); setTarget(null); setMsg(`Status changed to ${r.data.data.status}`);
    } catch (e) { setTarget(null); setMsg(errMsg(e)); }
    setBusy(false);
  };

  if (loading) return <LoadingView />;
  if (error || !v) return <EmptyView error={error || 'Vendor not found'} onRetry={() => { setLoading(true); load(); }} />;
  const st = STATUS_STYLE[v.status];
  const c = colorFor(v.vendor_name);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <DetailHeader color={c} tile={<Text style={{ fontSize: 28, fontWeight: '900', color: c }}>{v.vendor_name.trim().charAt(0).toUpperCase()}</Text>}
          title={v.vendor_name} subtitle={v.vendor_code}
          pills={<Pill text={v.status} color={st.color} bg={st.bg} />}
          actions={(
            <>
              {!!v.mobile && <ActionBtn outline icon="phone" label={`Call ${v.mobile}`} onPress={call} />}
              {can('vendor', 'edit') && <ActionBtn icon="pencil" label="Edit" onPress={() => setEditing(true)} />}
            </>
          )} />

        <InfoCard title="COMPANY" rows={[
          { icon: '🔖', label: 'Ref no', value: v.ref_no },
          { icon: '🧮', label: 'Account name', value: v.account_name },
          { icon: '📂', label: 'Account group', value: v.account_group },
          { icon: '💰', label: 'Opening balance', value: money(v.opening_balance) },
          { icon: '🧑‍💼', label: 'MD name', value: v.md_name },
          { icon: '💳', label: 'Payment terms', value: v.payment_terms },
          { icon: '🕒', label: 'Created', value: v.created_at },
        ]} />

        <InfoCard title="CONTACT" rows={[
          { icon: '👤', label: 'Contact person', value: v.contact_person },
          { icon: '📱', label: 'Mobile', value: v.mobile },
          { icon: '☎️', label: 'Landline', value: v.landline },
          { icon: '💬', label: 'SMS number', value: v.sms },
          { icon: '✉️', label: 'Email', value: v.email },
        ]} />

        <InfoCard title="ADDRESS" rows={[
          { icon: '📍', label: 'Address', value: v.address },
          { icon: '🏘️', label: 'Place', value: v.place },
          { icon: '🛣️', label: 'Street', value: v.street },
          { icon: '🏙️', label: 'City', value: v.city },
          { icon: '🗺️', label: 'State', value: v.state },
          { icon: '📮', label: 'Pin code', value: v.pin_code },
        ]} />

        <InfoCard title="TAX & BANK" rows={[
          { icon: '🧾', label: 'GST number', value: v.gst_number },
          { icon: '🪪', label: 'PAN number', value: v.pan_no },
          { icon: '🏦', label: 'Bank name', value: v.bank_name },
          { icon: '🏢', label: 'Bank branch', value: v.bank_branch },
          { icon: '🔢', label: 'Bank account no', value: v.bank_account_no },
          { icon: '🔑', label: 'IFSC code', value: v.ifsc_code },
        ]} />

        <InfoCard title="MATERIALS SUPPLIED" rows={[
          { icon: '📦', label: 'Group · Material', value: (v.materials || []).map((m) => `${m.category_name} · ${m.material_name}`).join('\n') },
        ]} />

        {can('vendor', 'edit') && (
          <View style={{ maxWidth: 900, width: '100%', alignSelf: 'center', paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }}>CHANGE STATUS</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {STATUSES.filter((x) => x !== v.status).map((x) => (
                <View key={x} style={{ marginRight: 8 }}>
                  <ActionBtn outline icon="swap-horizontal" label={`Mark as ${x}`} color={STATUS_STYLE[x].color} onPress={() => setTarget(x)} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <VendorFormModal visible={editing} id={id} onDismiss={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(); setMsg('Vendor updated'); }} />
      <ConfirmDialog visible={!!target} busy={busy} title="Change status?"
        message={`${v.vendor_name} (${v.vendor_code}) - ${v.status} -> ${target}`}
        confirmText="Yes, change" onConfirm={changeStatus} onCancel={() => setTarget(null)} />
      <Snackbar visible={!!msg} onDismiss={() => setMsg('')} duration={3000}>{msg}</Snackbar>
    </View>
  );
}
