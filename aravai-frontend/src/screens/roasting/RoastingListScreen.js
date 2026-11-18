import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, toneOf, useCardCols } from '../../components/InfoCard';
import PageToolbar from '../../components/PageToolbar';
import RoastingFormModal from '../../components/RoastingFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const STATUS = {
  COMPLETED: { color: COLORS.ok, bg: COLORS.okBg, label: 'COMPLETED' },
  IN_PROGRESS: { color: COLORS.warn, bg: COLORS.warnBg, label: 'IN PROGRESS' },
  REJECTED: { color: COLORS.danger, bg: COLORS.dangerBg, label: 'REJECTED' },
};
// where the batch is now (the badge shows this, not the status of the roasting entry)
const STAGE = {
  BATCHING: { color: COLORS.warn, bg: COLORS.warnBg, label: 'AT BATCHING' },
  FILTERING: { color: COLORS.warn, bg: COLORS.warnBg, label: 'AT FILTERING' },
  ROASTING: { color: COLORS.warn, bg: COLORS.warnBg, label: 'AT ROASTING' },
  GRINDING: { color: COLORS.green, bg: COLORS.greenBg, label: 'AT GRINDING' },
  BLENDING: { color: COLORS.green, bg: COLORS.greenBg, label: 'AT BLENDING' },
  PACKING: { color: COLORS.green, bg: COLORS.greenBg, label: 'AT PACKING' },
  COMPLETED: { color: COLORS.ok, bg: COLORS.okBg, label: 'BATCH COMPLETED' },
};
const badgeFor = (item) => {
  if (item.status === 'REJECTED') return STATUS.REJECTED;
  if (item.batch_status === 'ON_HOLD') return { color: COLORS.danger, bg: COLORS.dangerBg, label: 'ON HOLD' };
  if (item.batch_status === 'CANCELLED') return { color: COLORS.danger, bg: COLORS.dangerBg, label: 'BATCH CANCELLED' };
  if (item.batch_stage && STAGE[item.batch_stage]) return STAGE[item.batch_stage];
  return STATUS[item.status] || STATUS.IN_PROGRESS; // old entries without a batch
};
const hhmm = (dt) => (dt ? dt.slice(11, 16) : '–');

const ORANGE = '#EA580C';

function RoastCard({ item, index, onPress }) {
  const st = badgeFor(item);
  return (
    <InfoCard index={index} icon="fire" color={item.loss_alert ? COLORS.danger : ORANGE} value={item.code_no} size="md"
      caption={item.batch_no ? `${item.batch_no} · ${item.material_code} ${item.material_name}` : undefined}
      sub={`${item.roast_date} · ${item.machine_name}`}
      right={<ChevronDot />} onPress={onPress}
      footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
      <InfoStats items={[
        { label: 'I/P (KG)', value: fmt(item.input_weight) },
        { label: 'O/P AFTER ROASTING (KG)', value: item.output_weight == null ? '–' : fmt(item.output_weight) },
        { label: 'LOSS %', value: item.loss_percent == null ? '–' : `${item.loss_percent}%`, color: item.loss_alert ? COLORS.danger : undefined },
        { label: 'TIME', value: `${hhmm(item.start_time)} – ${hhmm(item.end_time)}${item.running_hours != null ? `  (${item.running_hours} h)` : ''}` },
      ]} />
      <InfoLine icon="thermometer" text={`Temp (before / std / after): ${item.temp_before ?? '–'} / ${item.std_temp ?? '–'} / ${item.temp_after ?? '–'}`} lines={2} />
    </InfoCard>
  );
}

export default function RoastingListScreen({ navigation, route }) {
  const { can, user } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ open: false, item: null });
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/roasting', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const openItem = (item) => {
    if (!can('roasting', 'edit')) return toast('You can view this entry but not edit it');
       if (item.status === 'COMPLETED') return toast('Saved roasting entries are locked and cannot be edited');
    setForm({ open: true, item });
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="fire" title="Roasting" count={list.total} noun="record" search={search} onSearch={setSearch}
        placeholder="Search batch no / material / code no / machine" addLabel="Add Entry"
        onAdd={can('roasting', 'create') ? () => setForm({ open: true, item: null }) : null} />

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🔥" message="No roasting entries yet. Tap Add Entry." />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, index) => <RoastCard item={item} index={index} onPress={() => openItem(item)} />}
          />
        )}
      </Container>

      <RoastingFormModal visible={form.open} item={form.item} onDismiss={() => setForm({ open: false, item: null })}
               onSaved={(edited, r) => {
          setForm({ open: false, item: null }); list.reload();
          toast(edited ? 'Roasting entry updated'
            : r && r.batch_moved ? 'Roasting saved - batch sent to Grinding'
              : 'Roasting saved - add the remaining materials later');
        }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
});
