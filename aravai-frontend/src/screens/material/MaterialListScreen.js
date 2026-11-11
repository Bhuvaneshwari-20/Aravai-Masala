import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialFormModal from '../../components/MaterialFormModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt, categoryStyle, padGrid } from '../../theme';

function MaterialCard({ item, index, onPress }) {
  const cs = categoryStyle(item.category_name);
  const cur = Number(item.current_stock) || 0;
  const min = Number(item.minimum_stock) || 0;
  const pct = min > 0 ? Math.max(0.04, Math.min(1, cur / (min * 2))) : 1;
  const low = !!item.is_low_stock;
  const bar = low ? COLORS.danger : COLORS.ok;
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} to={0.98} style={[s.card, !item.is_active && { opacity: 0.6 }]}>
        <View style={[s.stripe, { backgroundColor: cs.color }]} />
        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <View style={[s.tile, { backgroundColor: `${cs.color}1F` }]}><Text style={{ fontSize: 24 }}>{cs.icon}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{item.material_name}</Text>
              <View style={s.metaRow}>
                <Text style={s.code}>{item.material_code}</Text>
                <View style={[s.cat, { backgroundColor: `${cs.color}1A` }]}><Text style={[s.catText, { color: cs.color }]}>{item.category_name}</Text></View>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {low && <View style={[s.badge, { backgroundColor: COLORS.dangerBg }]}><Text style={[s.badgeText, { color: COLORS.danger }]}>LOW STOCK</Text></View>}
              {!item.is_active && <View style={[s.badge, { backgroundColor: COLORS.greyBg }]}><Text style={[s.badgeText, { color: COLORS.grey }]}>INACTIVE</Text></View>}
            </View>
          </View>
          {!!item.specifications?.length && <Text style={s.specs} numberOfLines={1}>📝  {item.specifications.join('  •  ')}</Text>}
          <View style={s.stockRow}>
            <Text style={s.stockLabel}>Stock</Text>
            <Text style={[s.stockVal, low && { color: COLORS.danger }]}>{fmt(cur)} <Text style={s.unit}>{item.unit}</Text></Text>
            <Text style={s.min}>Min {fmt(min)}</Text>
          </View>
          <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: bar }]} /></View>
        </View>
      </PressableScale>
    </FadeIn>
  );
}

export default function MaterialListScreen({ navigation, route }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const [showForm, setShowForm] = useState(false);
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (route.params?.openAdd) { setShowForm(true); navigation.setParams({ openAdd: undefined }); }
  }, [route.params?.openAdd]); // eslint-disable-line
  const lowOnly = !!route.params?.lowOnly; // still supported if another screen opens this pre-filtered
  const dSearch = useDebounce(search, 400);

  const list = usePagedList('/materials', {
    search: dSearch || undefined,
    low_stock: lowOnly ? 'true' : undefined,
  });

  // refresh list when coming back from Add/Edit/Detail (skip the very first focus)
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="package-variant" title="All Materials" count={list.total} noun="material" search={search} onSearch={setSearch}
        placeholder="Search name / code / specification" addLabel="Add Material" onAdd={can('material', 'create') ? () => setShowForm(true) : null} />

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <FlatList
            key={listCols}
            numColumns={listCols}
            data={padGrid(list.items, listCols)}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📦" message="No materials found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item, index }) => item.pad
              ? <View style={{ flex: 1, marginHorizontal: 12 }} />
              : <MaterialCard item={item} index={index} onPress={() => navigation.navigate('MaterialDetail', { id: item.id })} />}
          />
        )}
      </Container>
      <MaterialFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); toast('Material added'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 5 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  code: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginRight: 8 },
  cat: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  catText: { fontSize: 11, fontWeight: '800' },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  specs: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 10 },
  stockRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14 },
  stockLabel: { color: COLORS.grey, fontSize: 12, fontWeight: '700', marginRight: 8 },
  stockVal: { flex: 1, fontSize: 17, fontWeight: '900', color: COLORS.text },
  unit: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  min: { color: COLORS.grey, fontSize: 12, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.greyBg, marginTop: 8, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
