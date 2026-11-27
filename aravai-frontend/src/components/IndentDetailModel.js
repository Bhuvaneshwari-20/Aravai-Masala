import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import ModalShell from './ModalShell';
import FormField from './FormField';
import Badge from './Badge';
import { COLORS } from '../theme';

export const STATUS_TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'grey' };
const d10 = (d) => (d ? String(d).slice(0, 10) : '');
const qty = (n) => String(Number(Number(n).toFixed(3)));
const Row = ({ k, v }) => (!v ? null : (
  <View style={{ flexDirection: 'row', marginBottom: 6 }}>
    <Text style={{ width: 120, color: COLORS.grey, fontSize: 13 }}>{k}</Text>
    <Text style={{ flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '600' }}>{v}</Text>
  </View>
));

// One indent.
// Manager: Approve / Reject (reason needed).
// The person who raised it (or Super Admin): Edit + Delete while pending, only Re-edit after approval.
export default function IndentDetailModal({ visible, id, onDismiss, onChanged, onEdit }) {
  const { can, user, viewAs } = useAuth();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!visible || !id) return;
    setD(null); setRemark(''); setErr(''); setConfirmDel(false); setLoading(true);
    api.get(`/indents/${id}`).then((r) => setD(r.data.data)).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, id]);

  const act = async (what) => {
    if (what === 'reject' && !remark.trim()) { setErr('Enter the reason for rejecting'); return; }
    setBusy(true); setErr('');
    try {
      await (what === 'delete' ? api.delete(`/indents/${id}`) : api.patch(`/indents/${id}/${what}`, { remark: remark.trim() }));
      setBusy(false); onChanged && onChanged(what);
    } catch (e) { setErr(errMsg(e)); setBusy(false); setConfirmDel(false); }
  };

  const pending = d?.status === 'PENDING';
  const role = viewAs?.role_name || user?.role_name;
  const canDecide = pending && role === 'Manager' && can('purchase', 'approve');
  const mine = !!d && (d.requested_by === user?.id || user?.role_name === 'Super Admin');
  const canChange = !canDecide && mine && can('purchase', 'edit');
  const canEdit = canChange && (pending || d?.status === 'APPROVED');   // approved -> re-edit
  const canDelete = canChange && pending;                               // delete only before approval

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={busy} icon="file-document-outline" maxWidth={640}
      title={d?.indent_no || 'Indent'} subtitle={d ? `Raised by ${d.requested_by_name || '-'} on ${d10(d.indent_date)}` : ''}
      footer={d && (canDecide || canEdit) ? (
        <View style={{ flexDirection: 'row' }}>
          {canDelete && <Button mode="outlined" onPress={() => (confirmDel ? act('delete') : setConfirmDel(true))} disabled={busy} textColor={COLORS.danger} style={{ borderRadius: 10, borderColor: COLORS.danger, marginRight: 10 }} icon="delete-outline">{confirmDel ? 'Tap again to delete' : 'Delete'}</Button>}
          {canEdit && <Button mode="outlined" onPress={() => onEdit && onEdit(d)} disabled={busy} textColor={COLORS.primary} style={{ borderRadius: 10, borderColor: COLORS.primary }} icon="pencil-outline">{pending ? 'Edit' : 'Re-edit'}</Button>}
          {canDecide && <Button mode="outlined" onPress={() => act('reject')} disabled={busy} textColor={COLORS.danger} style={{ borderRadius: 10, borderColor: COLORS.danger, marginRight: 10 }} icon="close">Reject</Button>}
          {canDecide && <Button mode="contained" onPress={() => act('approve')} loading={busy} disabled={busy} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">Approve</Button>}
        </View>
      ) : null}>
      {loading && <View style={{ padding: 40 }}><ActivityIndicator color={COLORS.primary} /></View>}
      {!!err && <Text style={{ color: COLORS.danger, marginBottom: 8 }}>{err}</Text>}
      {d && (
        <View>
          <View style={{ marginBottom: 10 }}><Badge tone={STATUS_TONE[d.status] || 'grey'} text={d.status} /></View>
          <Row k="Remarks" v={d.remarks} />
          <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginVertical: 8 }}>MATERIALS</Text>
          {d.items.map((i, n) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ width: 24, color: COLORS.grey, fontWeight: '800' }}>{n + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: COLORS.text }}>{i.material_name}</Text>
                {!!i.specification && <Text style={{ color: COLORS.grey, fontSize: 12 }}>{i.specification}</Text>}
                <Text style={{ color: COLORS.grey, fontSize: 12 }}>Stock {qty(i.available_qty)} {i.unit} · Need by {d10(i.required_date)}</Text>
              </View>
              <Text style={{ fontWeight: '900', color: COLORS.text }}>{qty(i.required_qty)} {i.unit}</Text>
            </View>
          ))}
          {d.status !== 'PENDING' && d.decided_by_name ? (
            <View style={{ marginTop: 12 }}>
              <Row k={d.status === 'CANCELLED' ? 'Cancelled by' : d.status === 'APPROVED' ? 'Approved by' : 'Rejected by'} v={`${d.decided_by_name} · ${d10(d.decided_at)}`} />
              <Row k="Remark" v={d.decision_remark} />
            </View>
          ) : null}
          {canDecide && <View style={{ marginTop: 14 }}><FormField label="Remark (compulsory when rejecting)" value={remark} onChangeText={setRemark} multiline maxLength={500} /></View>}
        </View>
      )}
    </ModalShell>
  );
}