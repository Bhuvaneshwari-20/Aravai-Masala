import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import Badge from './Badge';
import { COLORS } from '../theme';

export const STATUS_TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger', CANCELLED: 'grey' };
const d10 = (d) => (d ? String(d).slice(0, 10) : '');
const qty = (n) => String(Number(Number(n).toFixed(3)));
const Row = ({ k, v }) => (!v ? null : (
  <View style={{ flexDirection: 'row', marginBottom: 6 }}>
    <Text style={{ width: 130, color: COLORS.grey, fontSize: 13 }}>{k}</Text>
    <Text style={{ flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '600' }}>{v}</Text>
  </View>
));

// View only. Edit / Delete / Re-edit / Approve / Reject are in the Action column of the list.
export default function IndentDetailModal({ visible, id, onDismiss }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !id) return;
    setD(null); setErr(''); setLoading(true);
    api.get(`/indents/${id}`).then((r) => setD(r.data.data)).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, id]);

  const re = Number(d?.re_edit_status || 0);   // 0 none, 1 requested, 2 allowed

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="file-document-outline" maxWidth={640}
      title={d?.indent_no || 'Indent'} subtitle={d ? `Raised by ${d.requested_by_name || '-'} on ${d10(d.indent_date)}` : ''}>
      {loading && <View style={{ padding: 40 }}><ActivityIndicator color={COLORS.primary} /></View>}
      {!!err && <Text style={{ color: COLORS.danger, marginBottom: 8 }}>{err}</Text>}
      {d && (
        <View>
          <View style={{ marginBottom: 10 }}><Badge tone={STATUS_TONE[d.status] || 'grey'} text={d.status} /></View>
          <Row k="Remarks" v={d.remarks} />
          {d.status === 'APPROVED' && re === 1 ? <Row k="Re-edit requested" v={d.re_edit_remark || 'Yes'} /> : null}
          {d.status === 'APPROVED' && re === 2 ? <Row k="Re-edit" v="Allowed by Manager" /> : null}
          <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginVertical: 8 }}>MATERIALS</Text>
          {d.items.map((i, n) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ width: 24, color: COLORS.grey, fontWeight: '800' }}>{n + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: COLORS.text }}>{i.material_name}</Text>
                {!!i.specification && <Text style={{ color: COLORS.grey, fontSize: 12 }}>{i.specification}</Text>}
                <Text style={{ color: COLORS.grey, fontSize: 12 }}>Stock {qty(i.available_qty)} {i.unit} · To buy {qty(Math.max(0, Number(i.required_qty) - Number(i.available_qty)))} {i.unit} · Need by {d10(i.required_date)}</Text>
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
        </View>
      )}
    </ModalShell>
  );
}