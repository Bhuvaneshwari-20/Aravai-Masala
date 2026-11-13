import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PackingFormModal from '../../components/PackingFormModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const Chip = ({ label, value, color }) => (
  <View style={s.chip}>
    <Text style={s.chipLabel}>{label}</Text>
    <Text style={[s.chipVal, color && { color }]}>{value}</Text>
  </View>
);

export default function PackingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/packing', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload])); // eslint-disable-line

  return (
    <View style={s.wrap}>
      <PageToolbar icon="package-variant-closed" title="Packing" count={list.total} noun="packing run" search={search} onSearch={setSearch}
        placeholder="Search batch / product / pack" addLabel="New Packing" onAdd={can('packing', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📫" message="No packing entries yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => (
              <View style={s.card}>
                <View style={s.top}>
                  <Text style={s.batch}>{item.batch_no}</Text>
                  <Text style={s.product} numberOfLines={1}>{item.product_name} · {item.packing_size_label}</Text>
                </View>
                <Text style={s.meta}>{item.packing_date}  •  {item.sku_code}  •  {item.machine_name}  •  {item.operator_name}</Text>
                <View style={s.chips}>
                  <Chip label="Total bags" value={fmt(item.total_bag_count)} />
                  <Chip label="Accepted" value={fmt(item.accepted_bag_count)} color={COLORS.ok} />
                  <Chip label="Rejected" value={fmt(item.rejected_bag_count)} color={item.rejected_bag_count ? COLORS.danger : undefined} />
                  <Chip label="Packed" value={`${fmt(item.total_packing_weight)} kg`} />
                </View>
              </View>
            )}
          />
        )}
      </Container>
      <PackingFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={(closed) => { setShowForm(false); list.reload(); toast(closed ? 'Packing saved. Batch completed' : 'Packing saved'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 6, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  top: { flexDirection: 'row', alignItems: 'center' },
  batch: { fontSize: 16, fontWeight: '900', color: COLORS.text, marginRight: 10 },
  product: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.primary },
  meta: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 6 },
  chips: { flexDirection: 'row', marginTop: 12 },
  chip: { flex: 1, backgroundColor: COLORS.bg, borderRadius: 10, padding: 8, marginRight: 8 },
  chipLabel: { color: COLORS.grey, fontSize: 11, fontWeight: '800' },
  chipVal: { color: COLORS.text, fontSize: 15, fontWeight: '900', marginTop: 2 },
});