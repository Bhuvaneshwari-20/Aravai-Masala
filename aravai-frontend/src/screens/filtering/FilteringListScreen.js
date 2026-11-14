import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import PressableScale from '../../components/PressableScale';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import FilteringFormModal from '../../components/FilteringFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, padGrid, fmt } from '../../theme';

const TABS = [{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }];
const hhmm = (dt) => (dt ? String(dt).slice(11, 16) : '–');

function Cell({ label, value, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cellValue, color && { color }]}>{value}</Text>
    </View>
  );
}

function PendingCard({ item, index, onPress }) {
  const hold = item.status === 'ON_HOLD';
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} to={0.98} style={s.card}>
        <View style={[s.stripe, { backgroundColor: hold ? COLORS.warn : COLORS.primary }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={{ flex: 1 }}>
              <Text style={s.code}>{item.batch_no}</Text>
              <Text style={s.sub} numberOfLines={1}>{item.product_name}{item.recipe_no ? ` · ${item.recipe_no}` : ''}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: hold ? COLORS.warnBg : COLORS.okBg }]}>
              <Text style={[s.badgeText, { color: hold ? COLORS.warn : COLORS.ok }]}>{hold ? 'ON HOLD' : 'WAITING'}</Text>
            </View>
          </View>
          <View style={s.row}>
            <Cell label="I/P (Kg)" value={fmt(item.input_kg)} />
            <Cell label="BATCH DATE" value={String(item.production_date).slice(0, 10)} />
          </View>
          {!!item.filter_materials && <Text style={s.mats} numberOfLines={2}>To filter: {item.filter_materials}</Text>}
          <Text style={s.foot}>{hold ? `On hold${item.hold_reason ? `: ${item.hold_reason}` : ''}` : 'Tap to record filtering'}</Text>
        </View>
      </PressableScale>
    </FadeIn>
  );
}

function DoneCard({ item, index }) {
  const high = Number(item.loss_percent) > 5;
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <View style={s.card}>
        <View style={[s.stripe, { backgroundColor: high ? COLORS.danger : COLORS.ok }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={{ flex: 1 }}>
              <Text style={s.code}>{item.batch_no}</Text>
              <Text style={s.sub} numberOfLines={1}>{String(item.filter_date).slice(0, 10)} · {item.product_name}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: COLORS.okBg }]}><Text style={[s.badgeText, { color: COLORS.ok }]}>{item.stages} STAGE{item.stages > 1 ? 'S' : ''}</Text></View>
          </View>
          <View style={s.row}>
            <Cell label="I/P (Kg)" value={fmt(item.input_weight)} />
            <Cell label="O/P (Kg)" value={fmt(item.output_weight)} />
            <Cell label="LOSS %" value={`${item.loss_percent}%`} color={high ? COLORS.danger : undefined} />
          </View>
          <View style={s.row}>
            <Cell label="TIME" value={`${hhmm(item.start_time)} – ${hhmm(item.end_time)}`} />
            <Cell label="NEXT" value={item.current_stage === 'ROASTING' ? 'Roasting' : item.current_stage} />
          </View>
          <Text style={s.foot} numberOfLines={1}>By {item.done_by_name} · Checked: {item.checked_by_name}</Text>
        </View>
      </View>
    </FadeIn>
  );
}

export default function FilteringListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
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
          <FlatList
            key={`${tab}-${listCols}`}
            numColumns={listCols}
            data={padGrid(list.items, listCols)}
            keyExtractor={(i, idx) => (i.pad ? `pad-${idx}` : String(i.id ?? i.batch_id))}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🧺" message={tab === 'pending'
              ? 'No batches waiting for filtering. Tick the Filter box on a material when creating a batch.' : 'No filtering records yet.'} />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item, index }) => {
              if (item.pad) return <View style={{ flex: 1, marginHorizontal: 12 }} />;
              return tab === 'pending'
                ? <PendingCard item={item} index={index} onPress={() => open(item)} />
                : <DoneCard item={item} index={index} />;
            }}
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
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 5 },
  body: { flex: 1, padding: 14 },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  code: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  sub: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  row: { flexDirection: 'row', marginTop: 10 },
  cellLabel: { fontSize: 10, fontWeight: '800', color: COLORS.grey, letterSpacing: 0.5 },
  cellValue: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginTop: 2 },
  mats: { marginTop: 8, color: COLORS.primary, fontSize: 12.5, fontWeight: '800' },
  foot: { marginTop: 10, color: COLORS.grey, fontSize: 12, fontWeight: '600' },
});