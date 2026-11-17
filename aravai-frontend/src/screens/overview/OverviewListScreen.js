import React, { useCallback, useRef, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoStats, ChevronDot, toneOf, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const TABS = [{ value: 'materials', label: 'Materials' }, { value: 'batches', label: 'Batch Trace' }];
const FILTERS = [
  { value: 'ALL', label: 'All' }, { value: 'LOW', label: 'Low stock' },
  { value: 'OUT', label: 'Out of stock' }, { value: 'SOON', label: 'Running out soon' },
];
const STATE = {
  OK: { label: 'OK', color: COLORS.ok, bg: COLORS.okBg },
  LOW: { label: 'LOW', color: COLORS.warn, bg: COLORS.warnBg },
  OUT: { label: 'OUT', color: COLORS.danger, bg: COLORS.dangerBg },
  SOON: { label: 'RUNNING OUT', color: COLORS.warn, bg: COLORS.warnBg },
};
const STAGE = (x) => String(x || '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function Stat({ icon, color, value, label }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: `${color}1A` }]}><MCI name={icon} size={20} color={color} /></View>
      <View><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>
    </View>
  );
}

function MaterialCard({ item, index, onPress }) {
  const st = STATE[item.state] || STATE.OK;
  return (
    <InfoCard index={index} icon="package-variant" color={st.color} value={item.material_name} size="md"
      caption={`${item.material_code} · ${item.category_name}`}
      right={<ChevronDot />} onPress={onPress}
      footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
      <InfoStats items={[
        { label: 'STOCK', value: `${fmt(item.current_stock)} ${item.unit}`, color: item.state === 'OUT' || item.state === 'LOW' ? COLORS.danger : undefined },
        { label: 'USED THIS MONTH', value: `${fmt(item.used_month)} ${item.unit}` },
        { label: 'DAYS OF STOCK', value: item.days_of_stock === null ? '-' : `${item.days_of_stock} days`, color: item.state === 'SOON' ? COLORS.warn : undefined },
        { label: 'ROASTING LOSS', value: item.roast_loss_pct === null ? '-' : `${item.roast_loss_pct}%` },
      ]} />
    </InfoCard>
  );
}

function BatchCard({ item, index, onPress }) {
  return (
    <InfoCard index={index} icon="timeline-text-outline" color={COLORS.primary} value={item.batch_no} size="md" caption={item.product_name}
      right={<ChevronDot />} onPress={onPress}
      footer={<Badge tone="grey" text={item.status === 'COMPLETED' ? 'COMPLETED' : STAGE(item.current_stage).toUpperCase()} />}>
      <InfoStats per={3} items={[
        { label: 'DATE', value: String(item.production_date).slice(0, 10) },
        { label: 'TOTAL', value: `${fmt(item.planned_qty_kg)} kg` },
        { label: 'MATERIALS', value: String(item.material_count) },
      ]} />
    </InfoCard>
  );
}

// Material Overview: stock summary per material (tap -> material trace) and batch trace (tap -> materials used + recipe vs actual)
export default function OverviewListScreen({ navigation }) {
  const grid = useCardCols({ min: 280, phoneMin: 280 });
  const [tab, setTab] = useState('materials');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const dSearch = useDebounce(search, 400);

  // materials tab
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reqId = useRef(0);
  const loadMaterials = useCallback(async (refresh) => {
    const id = ++reqId.current;
    if (refresh) setRefreshing(true);
    try {
      const r = await api.get('/material-overview/summary', { params: { search: dSearch || undefined, filter: filter === 'ALL' ? undefined : filter } });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) setRefreshing(false);
  }, [dSearch, filter]);
  useFocusEffect(useCallback(() => { if (tab === 'materials') loadMaterials(); }, [tab, loadMaterials]));

  // batch trace tab
  const batches = usePagedList('/material-overview/batches', { search: dSearch || undefined });

  const sm = data?.summary;
  const items = data?.items || [];

  return (
    <View style={s.wrap}>
      <PageToolbar icon="magnify" title="Material Overview" subtitle={tab === 'materials' && sm ? `${sm.total} materials` : 'Trace materials through batches'}
        search={search} onSearch={setSearch} placeholder={tab === 'materials' ? 'Search material' : 'Search batch no / product'} />
      <Container><FilterChips options={TABS} value={tab} onChange={setTab} /></Container>

      {tab === 'materials' ? (
        <Container fill>
          {error && !data ? <EmptyView error={error} onRetry={() => loadMaterials()} /> : !data ? <LoadingView /> : (
            <CardList {...grid} key={`m${grid.cols}`} data={items} keyExtractor={(i) => String(i.id)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadMaterials(true)} colors={[COLORS.primary]} />}
              ListHeaderComponent={(
                <View style={{ marginHorizontal: -(grid.pad - grid.gap / 2) }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stats}>
                    <Stat icon="package-variant" color="#0E7490" value={sm.total} label="Materials" />
                    <Stat icon="alert-circle" color={COLORS.warn} value={sm.low} label="Low stock" />
                    <Stat icon="close-circle" color={COLORS.danger} value={sm.out} label="Out of stock" />
                    <Stat icon="clock-alert-outline" color="#7C3AED" value={sm.soon} label={`Out within ${sm.soon_days} days`} />
                    <Stat icon="weight-kilogram" color={COLORS.ok} value={`${fmt(sm.used_month_kg)} kg`} label="Used this month (KG)" />
                  </ScrollView>
                  <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
                </View>
              )}
              ListEmptyComponent={<EmptyView icon="📦" message="No materials match" />}
              renderItem={(item, i) => <MaterialCard item={item} index={i} onPress={() => navigation.navigate('OverviewMaterial', { id: item.id })} />} />
          )}
        </Container>
      ) : (
        <Container fill>
          {batches.loading ? <LoadingView /> : batches.error && !batches.items.length ? <EmptyView error={batches.error} onRetry={batches.reload} /> : (
            <CardList {...grid} key={`b${grid.cols}`} data={batches.items} keyExtractor={(i) => String(i.id)}
              refreshControl={<RefreshControl refreshing={batches.refreshing} onRefresh={batches.refresh} colors={[COLORS.primary]} />}
              onEndReached={batches.loadMore} onEndReachedThreshold={0.4}
              ListEmptyComponent={<EmptyView icon="⚖️" message="No batches yet" />}
              ListFooterComponent={batches.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
              renderItem={(item, i) => <BatchCard item={item} index={i} onPress={() => navigation.navigate('OverviewBatch', { id: item.id })} />} />
          )}
        </Container>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  stats: { paddingHorizontal: 12, paddingVertical: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10 },
  statIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  statValue: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  statLabel: { fontSize: 11.5, fontWeight: '700', color: COLORS.grey },
});
