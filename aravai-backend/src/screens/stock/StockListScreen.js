import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialReceiptModal from '../../components/MaterialReceiptModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FilterChips from '../../components/FilterChips';
import { COLORS, fmt, padGrid } from '../../theme';

// Raw material stock: one card per material. Tap = Material Card (ledger). "+" = new material receipt.
export default function StockListScreen({ navigation }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/materials', { search: dSearch || undefined, active: 'true', low_stock: lowOnly ? 'true' : undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="clipboard-list" title="Material Stock" count={list.total} noun="material" search={search} onSearch={setSearch}
        placeholder="Search name / code" addLabel="Material Receipt" onAdd={can('stock', 'create') ? () => setShowReceipt(true) : null} />
      <Container>
        <FilterChips value={lowOnly ? 'low' : 'all'} onChange={(v) => setLowOnly(v === 'low')}
          options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <FlatList key={listCols} numColumns={listCols} data={padGrid(list.items, listCols)} keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🗂️" message="No materials found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => item.pad ? <View style={{ flex: 1, marginHorizontal: 12 }} /> : (
              <PressableScale style={s.card} to={0.98} onPress={() => navigation.navigate('StockCard', { id: item.id })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{item.material_name}</Text>
                  <Text style={s.code}>{item.material_code}{item.place ? `  •  ${item.place}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.qty, item.is_low_stock && { color: COLORS.danger }]}>{fmt(item.current_stock)} <Text style={s.unit}>{item.unit}</Text></Text>
                  {item.is_low_stock
                    ? <Text style={s.low}>LOW  (min {fmt(item.minimum_stock)})</Text>
                    : <Text style={s.min}>min {fmt(item.minimum_stock)}</Text>}
                </View>
              </PressableScale>
            )} />
        )}
      </Container>
      <MaterialReceiptModal visible={showReceipt} onDismiss={() => setShowReceipt(false)}
        onSaved={(r) => { setShowReceipt(false); list.reload(); toast(r.low_stock_alert || `Received. Balance ${fmt(r.closing_stock)} ${r.unit}`); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 6, padding: 14,
    borderWidth: 1, borderColor: COLORS.border },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  code: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 3 },
  qty: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  unit: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  min: { color: COLORS.grey, fontSize: 12, fontWeight: '600', marginTop: 2 },
  low: { color: COLORS.danger, fontSize: 11, fontWeight: '900', marginTop: 2 },
});
