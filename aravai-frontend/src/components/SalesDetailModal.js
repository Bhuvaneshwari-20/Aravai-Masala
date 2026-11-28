import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import Badge from './Badge';
import { KV } from './SalesBits';
import { ErrorBox, Label } from './FormBits';
import { niceDate, payText, profitColor, statusText, statusTone, typeLabel } from '../screens/sales/salesUtils';
import { COLORS, fmt, money } from '../theme';

// Invoice details: items, totals (gross / returns / net / estimated profit), returns made against it,
// and the finished-goods stock movements it caused (Material-Card style: issue / received / balance).
export default function SalesDetailModal({ visible, id, onDismiss }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || id === null || id === undefined) return;
    setD(null); setErr(''); setLoading(true);
    api.get(`/sales/${id}`).then((r) => setD(r.data.data)).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, id]);

  const items = d?.items || [];
  const returns = d?.returns || [];
  const moves = d?.stock_moves || [];

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="receipt" maxWidth={720}
      title={d ? d.invoice_no : 'Invoice'} subtitle={d ? `${d.customer_name} · ${niceDate(d.sale_date)}` : undefined}>
      {loading && <View style={{ padding: 50 }}><ActivityIndicator color={COLORS.primary} /></View>}
      <ErrorBox text={err} />
      {!!d && (
        <View>
          <View style={s.metaRow}>
            <Badge tone="primary" text={typeLabel(d.customer_type)} />
            {Number(d.returned_amount) > 0 && <Badge tone="warn" text={`Returned ${money(d.returned_amount)}`} style={{ marginLeft: 8 }} />}
          </View>
          {!!d.notes && <Text style={s.notes}>{d.notes}</Text>}

          <Label style={{ marginTop: 14 }}>ITEMS</Label>
          <View style={s.table}>
            {items.map((it, i) => (
              <View key={it.id} style={[s.row, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={2}>{it.product_name} · {it.packing_size_label}</Text>
                  <Text style={s.sub}>{`${it.sku_code}  •  ${fmt(it.quantity)} × ${money(it.rate)}`}{Number(it.returned_qty) > 0 ? `  •  ${fmt(it.returned_qty)} returned` : ''}</Text>
                </View>
                <Text style={s.amt}>{money(it.amount)}</Text>
              </View>
            ))}
          </View>

          <View style={s.totals}>
            <KV label="Gross sales" value={money(d.gross_amount)} />
            <KV label="Sales returns" value={`- ${money(d.returned_amount)}`} color={Number(d.returned_amount) > 0 ? COLORS.danger : undefined} />
            <KV label="Net sales" value={money(d.net_amount)} bold />
            <KV label="Estimated cost" value={d.cost_amount === null || d.cost_amount === undefined ? 'Not available' : money(d.cost_amount)} />
            <KV label="Estimated profit" value={d.profit === null || d.profit === undefined ? '-' : money(d.profit)} color={profitColor(d.profit)} bold />
            <KV label="Collected at delivery" value={money(d.collected_amount || 0)} color={Number(d.collected_amount) > 0 ? COLORS.ok : undefined} />
            <KV label="Balance to collect" value={money(d.balance_amount ?? d.net_amount)} color={Number(d.balance_amount ?? d.net_amount) > 0.009 ? COLORS.warn : COLORS.ok} bold />
          </View>

          {(d.deliveries || []).length > 0 && (
            <View>
              <Label style={{ marginTop: 16 }}>DELIVERY & PAYMENT</Label>
              {d.deliveries.map((x) => (
                <View key={x.id} style={s.ret}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name}>{x.delivery_no}</Text>
                    <Text style={s.sub}>{`${niceDate(x.delivery_date)}  •  ${fmt(x.total_qty)} packs  •  ${x.status === 'DELIVERED' ? 'Delivered' : x.status === 'CANCELLED' ? 'Cancelled' : 'In transit'}`}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {x.status === 'DELIVERED' && x.payment_mode
                      ? <><Text style={s.amt}>{x.payment_mode === 'CREDIT' ? 'Credit' : money(x.amount_collected)}</Text><Text style={s.sub}>{payText(x.payment_mode)}</Text></>
                      : <Text style={s.sub}>{x.status === 'DELIVERED' ? 'Payment not recorded' : 'Payment at delivery'}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}

          {returns.length > 0 && (
            <View>
              <Label style={{ marginTop: 16 }}>RETURNS AGAINST THIS INVOICE</Label>
              {returns.map((r) => (
                <View key={r.id} style={s.ret}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{r.return_no}</Text>
                    <Text style={s.sub}>{`${niceDate(r.return_date)}  •  ${fmt(r.total_packs)} packs`}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.amt}>{money(r.refund_amount)}</Text>
                    <Badge tone={statusTone(r.status)} text={statusText(r.return_type, r.status)} style={{ marginTop: 4 }} />
                  </View>
                </View>
              ))}
            </View>
          )}

          {moves.length > 0 && (
            <View>
              <Label style={{ marginTop: 16 }}>FINISHED GOODS STOCK MOVEMENT</Label>
              <View style={[s.table, { paddingBottom: 2 }]}>
                <View style={[s.row, s.thead]}>
                  <Text style={[s.th, { flex: 1 }]}>PURPOSE</Text>
                  <Text style={[s.th, s.num]}>ISSUE</Text>
                  <Text style={[s.th, s.num]}>RCVD</Text>
                  <Text style={[s.th, s.num]}>BAL</Text>
                </View>
                {moves.map((m, i) => (
                  <View key={m.id} style={[s.row, i === moves.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.td} numberOfLines={2}>{m.purpose || m.txn_type}</Text>
                      <Text style={s.sub} numberOfLines={1}>{`${niceDate(m.txn_date)}  •  ${m.sku_code}`}</Text>
                    </View>
                    <Text style={[s.td, s.num, Number(m.issue) > 0 && { color: COLORS.danger }]}>{Number(m.issue) > 0 ? fmt(m.issue) : '-'}</Text>
                    <Text style={[s.td, s.num, Number(m.received) > 0 && { color: COLORS.ok }]}>{Number(m.received) > 0 ? fmt(m.received) : '-'}</Text>
                    <Text style={[s.td, s.num, { fontWeight: '800' }]}>{fmt(m.balance)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  notes: { marginTop: 10, color: COLORS.textSoft, fontSize: 13.5, lineHeight: 19 },
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  thead: { backgroundColor: COLORS.greyBg, paddingVertical: 7 },
  th: { fontSize: 11, fontWeight: '900', color: COLORS.grey, letterSpacing: 0.6 },
  name: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 11.5, color: COLORS.grey, fontWeight: '600', marginTop: 2 },
  amt: { fontSize: 14, fontWeight: '900', color: COLORS.text, marginLeft: 10 },
  td: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  num: { width: 58, textAlign: 'right' },
  totals: { marginTop: 14, backgroundColor: '#FCFAF7', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 8 },
  ret: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 10, marginBottom: 6 },
});
