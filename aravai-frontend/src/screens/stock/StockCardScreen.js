import React, { useCallback, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialReceiptModal from '../../components/MaterialReceiptModal';
import StockMoveModal from '../../components/StockMoveModal';
import usePagedList from '../../hooks/usePagedList';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

// Material Card = the paper card on screen: S.NO, DATE, PURPOSE, ISSUE, RECEIVED, BALANCE, SIGN
export default function StockCardScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const { toast } = useUi();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'receipt' | 'issue' | 'adjust'
  const ledger = usePagedList(`/stock/card/${id}`, {});

  const loadMaterial = useCallback(async () => {
    try { setM((await api.get(`/materials/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { loadMaterial(); }, [loadMaterial]));

  const done = (r, text) => {
    setModal(null); loadMaterial(); ledger.reload();
    toast(r?.low_stock_alert || text);
  };

  if (error && !m) return <EmptyView error={error} onRetry={loadMaterial} />;
  if (!m) return <LoadingView />;
  const low = !!m.is_low_stock;

  const header = (
    <View>
      <View style={s.head}>
        <Text style={s.title}>{m.material_name}</Text>
        <Text style={s.sub}>{m.material_code}{m.place ? `  •  ${m.place}` : ''}</Text>
        <View style={s.balRow}>
          <View>
            <Text style={s.balLabel}>BALANCE</Text>
            <Text style={[s.bal, low && { color: COLORS.danger }]}>{fmt(m.current_stock)} <Text style={s.unit}>{m.unit}</Text></Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.balLabel}>MINIMUM</Text>
            <Text style={s.min}>{fmt(m.minimum_stock)} {m.unit}</Text>
          </View>
        </View>
        {low && <Text style={s.alert}>⚠️ Low stock. Please arrange material.</Text>}
        <View style={s.btns}>
          {can('stock', 'create') && <Button mode="contained" icon="truck-delivery" buttonColor={COLORS.green} style={s.btn} onPress={() => setModal('receipt')}>Receive</Button>}
          {can('stock', 'create') && <Button mode="contained" icon="arrow-up-bold-box" buttonColor={COLORS.primary} style={s.btn} onPress={() => setModal('issue')}>Issue</Button>}
          {can('stock', 'edit') && <Button mode="outlined" icon="scale-unbalanced" textColor={COLORS.text} style={[s.btn, { borderColor: COLORS.border }]} onPress={() => setModal('adjust')}>Correction</Button>}
        </View>
      </View>
      <View style={[s.row, s.thead]}>
        <Text style={[s.th, { width: 30 }]}>#</Text>
        <Text style={[s.th, { width: 78 }]}>DATE</Text>
        <Text style={[s.th, { flex: 1 }]}>PURPOSE</Text>
        <Text style={[s.th, s.num]}>ISSUE</Text>
        <Text style={[s.th, s.num]}>RCVD</Text>
        <Text style={[s.th, s.num]}>BAL</Text>
      </View>
    </View>
  );

  return (
    <View style={s.wrap}>
      <Container fill>
        <FlatList data={ledger.items} keyExtractor={(i) => String(i.id)} ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={ledger.refreshing} onRefresh={() => { ledger.refresh(); loadMaterial(); }} colors={[COLORS.primary]} />}
          onEndReached={ledger.loadMore} onEndReachedThreshold={0.4}
          ListEmptyComponent={ledger.loading ? <LoadingView /> : <EmptyView icon="🗂️" message="No entries yet" />}
          ListFooterComponent={ledger.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
          renderItem={({ item }) => (
            <View style={[s.row, s.line]}>
              <Text style={[s.td, { width: 30 }]}>{item.s_no}</Text>
              <Text style={[s.td, { width: 78 }]}>{String(item.txn_date).slice(0, 10)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.td} numberOfLines={2}>{item.purpose || item.txn_type}</Text>
                <Text style={s.ref} numberOfLines={1}>{[item.reference_no, item.sign].filter(Boolean).join('  •  ')}</Text>
              </View>
              <Text style={[s.td, s.num, Number(item.issue) > 0 && { color: COLORS.danger }]}>{Number(item.issue) > 0 ? fmt(item.issue) : '-'}</Text>
              <Text style={[s.td, s.num, Number(item.received) > 0 && { color: COLORS.ok }]}>{Number(item.received) > 0 ? fmt(item.received) : '-'}</Text>
              <Text style={[s.td, s.num, { fontWeight: '800' }]}>{fmt(item.balance)}</Text>
            </View>
          )} />
      </Container>

      <MaterialReceiptModal visible={modal === 'receipt'} materialId={m.id} onDismiss={() => setModal(null)}
        onSaved={(r) => done(r, `Received. Balance ${fmt(r.closing_stock)} ${r.unit}`)} />
      <StockMoveModal visible={modal === 'issue' || modal === 'adjust'} mode={modal} material={m} onDismiss={() => setModal(null)}
        onSaved={(r) => done(r, `Saved. Balance ${fmt(r.closing_stock)} ${r.unit}`)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { backgroundColor: '#fff', margin: 12, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  sub: { color: COLORS.grey, fontWeight: '600', marginTop: 3 },
  balRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  balLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: COLORS.grey },
  bal: { fontSize: 26, fontWeight: '900', color: COLORS.text },
  unit: { fontSize: 14, color: COLORS.grey, fontWeight: '700' },
  min: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  alert: { color: COLORS.danger, fontWeight: '800', marginTop: 10 },
  btns: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  btn: { borderRadius: 10, marginRight: 8, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  thead: { backgroundColor: COLORS.greyBg, paddingVertical: 8, marginHorizontal: 12, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  th: { fontSize: 11, fontWeight: '900', color: COLORS.grey, letterSpacing: 0.6 },
  line: { backgroundColor: '#fff', paddingVertical: 10, marginHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  td: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  ref: { fontSize: 11, color: COLORS.grey, marginTop: 1 },
  num: { width: 64, textAlign: 'right' },
});
