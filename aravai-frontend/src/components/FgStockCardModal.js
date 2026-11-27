import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import ModalShell from './ModalShell';
import usePagedList from '../hooks/usePagedList';
import { niceDate } from '../screens/sales/salesUtils';
import { COLORS, fmt } from '../theme';

// Finished Goods stock card of one SKU - same paper-card layout as the Material Card:
// S.NO, DATE, PURPOSE, ISSUE, RECEIVED, BALANCE. Production (packing) = received, sales = issue, returns = received.
//   sku = { packing_rate_id, product_name, packing_size_label, sku_code, stock_packs }
function Body({ sku }) {
  const ledger = usePagedList(`/sales/stock-card/${sku.packing_rate_id}`, {});
  return (
    <View>
      <View style={s.head}>
        <View>
          <Text style={s.balLabel}>BALANCE</Text>
          <Text style={s.bal}>{fmt(sku.stock_packs)} <Text style={s.unit}>packs</Text></Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.balLabel}>SKU</Text>
          <Text style={s.sku}>{sku.sku_code}</Text>
        </View>
      </View>

      <View style={[s.row, s.thead]}>
        <Text style={[s.th, { width: 26 }]}>#</Text>
        <Text style={[s.th, { width: 82 }]}>DATE</Text>
        <Text style={[s.th, { flex: 1 }]}>PURPOSE</Text>
        <Text style={[s.th, s.num]}>ISSUE</Text>
        <Text style={[s.th, s.num]}>RCVD</Text>
        <Text style={[s.th, s.num]}>BAL</Text>
      </View>
      {ledger.loading && <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>}
      {!ledger.loading && !ledger.items.length && <Text style={s.empty}>{ledger.error || 'No stock entries yet'}</Text>}
      {ledger.items.map((item) => (
        <View key={item.id} style={[s.row, s.line]}>
          <Text style={[s.td, { width: 26 }]}>{item.s_no}</Text>
          <Text style={[s.td, { width: 82 }]}>{niceDate(item.txn_date)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.td} numberOfLines={2}>{item.purpose || item.txn_type}</Text>
            {!!item.reference_no && <Text style={s.ref} numberOfLines={1}>{item.reference_no}</Text>}
          </View>
          <Text style={[s.td, s.num, Number(item.issue) > 0 && { color: COLORS.danger }]}>{Number(item.issue) > 0 ? fmt(item.issue) : '-'}</Text>
          <Text style={[s.td, s.num, Number(item.received) > 0 && { color: COLORS.ok }]}>{Number(item.received) > 0 ? fmt(item.received) : '-'}</Text>
          <Text style={[s.td, s.num, { fontWeight: '800' }]}>{fmt(item.balance)}</Text>
        </View>
      ))}
      {ledger.hasMore && (
        <Button mode="text" textColor={COLORS.primary} loading={ledger.loadingMore} onPress={ledger.loadMore} style={{ marginTop: 8 }}>Load more</Button>
      )}
    </View>
  );
}

export default function FgStockCardModal({ visible, sku, onDismiss }) {
  if (!visible || !sku) return null;
  return (
    <ModalShell visible onDismiss={onDismiss} icon="warehouse" maxWidth={640} title="Finished Goods Stock Card"
      subtitle={`${sku.product_name} · ${sku.packing_size_label}`}>
      <Body sku={sku} />
    </ModalShell>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FCFAF7', borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginBottom: 12 },
  balLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: COLORS.grey },
  bal: { fontSize: 26, fontWeight: '900', color: COLORS.text },
  unit: { fontSize: 14, color: COLORS.grey, fontWeight: '700' },
  sku: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  thead: { backgroundColor: COLORS.greyBg, paddingVertical: 8, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  th: { fontSize: 11, fontWeight: '900', color: COLORS.grey, letterSpacing: 0.6 },
  line: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  td: { fontSize: 12.5, color: COLORS.text, fontWeight: '600' },
  ref: { fontSize: 11, color: COLORS.grey, marginTop: 1 },
  num: { width: 52, textAlign: 'right' },
  empty: { textAlign: 'center', color: COLORS.grey, padding: 28 },
});
