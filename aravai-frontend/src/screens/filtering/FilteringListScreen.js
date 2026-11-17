import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, useCardCols } from '../../components/InfoCard';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import FilteringFormModal from '../../components/FilteringFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const TABS = [{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }];
const hhmm = (dt) => (dt ? String(dt).slice(11, 16) : '–');

// big pill at the bottom of a pending card
const ActionPill = ({ hold }) => (
  <View style={[s.pill, hold && { backgroundColor: COLORS.warnBg }]}>
    <MCI name={hold ? 'pause-circle-outline' : 'filter-variant-plus'} size={17} color={hold ? COLORS.warn : '#fff'} />
    <Text style={[s.pillText, hold && { color: COLORS.warn }]}>{hold ? 'On hold' : 'Record filtering'}</Text>
  </View>
);

function PendingCard({ item, index, onPress }) {
  const hold = item.status === 'ON_HOLD';
  return (
    <InfoCard index={index} icon="filter-variant" color={hold ? COLORS.warn : COLORS.primary}
      value={fmt(item.input_kg)} unit="KG" caption="Input weight to filter"
      right={<Badge tone={hold ? 'warn' : 'ok'} text={hold ? 'ON HOLD' : 'WAITING'} />}
      onPress={onPress}
      bottom={<ActionPill hold={hold} />}>
      <Text style={s.batch} numberOfLines={1}>{item.batch_no}</Text>
      <InfoLine icon="tag-outline" text={`${item.product_name}${item.recipe_no ? ` · ${item.recipe_no}` : ''}`} />
      <InfoLine icon="calendar-blank-outline" text={String(item.production_date).slice(0, 10)} />
      {!!item.filter_materials && <InfoLine icon="filter-outline" color={COLORS.primary} lines={2} text={`To filter: ${item.filter_materials}`} />}
      {hold && !!item.hold_reason && <InfoLine icon="alert-circle-outline" color={COLORS.warn} lines={2} text={item.hold_reason} />}
    </InfoCard>
  );
}

function DoneCard({ item, index }) {
  const high = Number(item.loss_percent) > 5;
  return (
    <InfoCard index={index} icon="filter-check-outline" color={high ? COLORS.danger : COLORS.ok}
      value={fmt(item.output_weight)} unit="KG" caption="Output after filtering"
      right={<Badge tone="ok" text={`${item.stages} STAGE${item.stages > 1 ? 'S' : ''}`} />}
      footer={<Badge tone={high ? 'danger' : 'ok'} text={`Loss ${item.loss_percent}%`} />}>
      <Text style={s.batch} numberOfLines={1}>{item.batch_no}</Text>
      <InfoLine icon="tag-outline" text={item.product_name} />
      <InfoStats items={[
        { label: 'I/P (KG)', value: fmt(item.input_weight) },
        { label: 'NEXT', value: item.current_stage === 'ROASTING' ? 'Roasting' : item.current_stage },
        { label: 'DATE', value: String(item.filter_date).slice(0, 10) },
        { label: 'TIME', value: `${hhmm(item.start_time)} – ${hhmm(item.end_time)}` },
      ]} />
      <InfoLine icon="account-outline" lines={2}
        text={`By ${item.done_by_name}${item.checked_by && item.checked_by !== item.done_by ? ` · Checked: ${item.checked_by_name}` : ''}`} />
    </InfoCard>
  );
}

export default function FilteringListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 280, phoneMin: 280 });
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ open: false, batch: null });
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/filtering', { tab, search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const open = (item) => {
    if (!can('filtering', 'create')) return toast('You can view this batch but not record filtering');
    if (item.status === 'ON_HOLD') return toast('This batch is on hold. Resume it first');
    setForm({ open: true, batch: item });
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="filter-variant" title="Filtering" count={list.total} noun={tab === 'pending' ? 'pending batch' : 'record'}
        search={search} onSearch={setSearch} placeholder="Search batch no / product" />
      <Container><FilterChips options={TABS} value={tab} onChange={setTab} /></Container>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} key={`${tab}-${grid.cols}`} data={list.items}
            keyExtractor={(i) => String(i.id ?? i.batch_id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🧺" message={tab === 'pending'
              ? 'No batches waiting for filtering. Tick the Filter box on a material when creating a batch.' : 'No filtering records yet.'} />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, index) => (tab === 'pending'
              ? <PendingCard item={item} index={index} onPress={() => open(item)} />
              : <DoneCard item={item} index={index} />)}
          />
        )}
      </Container>

      <FilteringFormModal visible={form.open} batch={form.batch} onDismiss={() => setForm({ open: false, batch: null })}
        onSaved={(r) => { setForm({ open: false, batch: null }); list.reload(); toast(`${r.batch_no} filtered - sent to Roasting`); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  batch: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10 },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 13.5, marginLeft: 6 },
});
