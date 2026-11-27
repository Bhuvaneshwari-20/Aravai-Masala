import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl, StyleSheet, Alert, Platform } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import StartBatchModal from '../../components/StartBatchModal';
import PageToolbar from '../../components/PageToolbar';
import StatCard from '../../components/StatCard';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, ChevronDot, toneOf, useCardCols } from '../../components/InfoCard';
import { COLORS, SHADOW, fmt } from '../../theme';

export const STATUS = {
  IN_PROGRESS: { label: 'IN PROGRESS', color: COLORS.ok, bg: COLORS.okBg },
  ON_HOLD: { label: 'ON HOLD', color: COLORS.warn, bg: COLORS.warnBg },
  COMPLETED: { label: 'COMPLETED', color: COLORS.grey, bg: COLORS.greyBg },
  CANCELLED: { label: 'CANCELLED', color: COLORS.danger, bg: COLORS.dangerBg },
  OPEN: { label: 'OPEN', color: COLORS.grey, bg: COLORS.greyBg },
};

// Process (stage) a batch is currently in. Order: Batching -> Roasting -> Blending -> Grinding -> Final Blending -> Packing
export const stageLabel = (st) => String(st || '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Stage text for a batch. In PARALLEL roasting mode, Filtering runs alongside Roasting, so show both.
export const stageText = (b) => (b.roasting_mode === 'PARALLEL' && b.current_stage === 'ROASTING'
  ? 'Filtering + Roasting'
  : stageLabel(b.current_stage));

// What the card badge shows: the running process while the batch is IN_PROGRESS, else the status (Hold / Completed / Cancelled)
export const badgeFor = (b) => (b.status === 'IN_PROGRESS' && b.current_stage && b.current_stage !== 'COMPLETED'
  ? { label: stageText(b).toUpperCase(), color: COLORS.ok, bg: COLORS.okBg }
  : STATUS[b.status] || STATUS.OPEN);

// status pill of the desktop table: In Progress (yellow) / Completed (green) / On Hold (orange) / Cancelled (red) / Open (grey)
const PILL = { IN_PROGRESS: ['warn', 'In Progress'], COMPLETED: ['ok', 'Completed'], ON_HOLD: ['warn', 'On Hold'], CANCELLED: ['danger', 'Cancelled'], OPEN: ['grey', 'Open'] };

const count = (params) => api.get('/batches', { params: { ...params, limit: 1 } }).then((r) => r.data.data.total);

// Yes / No confirmation that works on web (window.confirm) and on phones (Alert)
const confirmDelete = (message) => new Promise((resolve) => {
  if (Platform.OS === 'web') { resolve(window.confirm(message)); return; }
  Alert.alert('Delete batch', message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) });
});

// ---------- desktop table ----------
const COL = { idx: { width: 60 }, no: { flex: 1.4 }, product: { flex: 1.6 }, qty: { flex: 1 }, stage: { flex: 1.4 }, status: { flex: 1.2 }, view: { width: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' } };

function TableHead({ showActions }) {
  return (
    <View style={[t.row, t.head]}>
      <Text style={[t.th, COL.idx]}>S.No</Text>
      <Text style={[t.th, COL.no]}>Batch No.</Text>
      <Text style={[t.th, COL.product]}>Product</Text>
      <Text style={[t.th, COL.qty]}>Qty</Text>
      <Text style={[t.th, COL.stage]}>Current Stage</Text>
      <Text style={[t.th, COL.status]}>Status</Text>
      <Text style={[t.th, { width: 100, textAlign: 'right', paddingRight: 0 }]}>{showActions ? 'View / Del' : 'View'}</Text>
    </View>
  );
}

function TableRow({ item, index, onOpen, onDelete }) {
  const running = item.status === 'IN_PROGRESS' || item.status === 'ON_HOLD';
  const [tone, label] = PILL[item.status] || PILL.OPEN;
  return (
    <Pressable onPress={onOpen} style={({ hovered }) => [t.row, t.body, hovered && { backgroundColor: '#FDF8F3' }]}>
      <Text style={[t.idx, COL.idx]}>{index + 1}</Text>
      <View style={COL.no}><Text style={t.no} numberOfLines={1}>{item.batch_no}</Text></View>
      <View style={[COL.product, { paddingRight: 10 }]}><Text style={t.cell} numberOfLines={1}>{item.product_name}</Text></View>
      <View style={COL.qty}><Text style={t.cell} numberOfLines={1}>{fmt(item.planned_qty_kg)} kg</Text></View>
      <View style={COL.stage}><Text style={t.cell} numberOfLines={1}>{running || item.status === 'COMPLETED' ? stageText(item) : '–'}</Text></View>
      <View style={COL.status}><Badge tone={tone} text={label} /></View>
      <View style={COL.view}>
        <View style={t.eye}><MCI name="eye-outline" size={18} color={COLORS.primary} /></View>
        {!!onDelete && (
          <Pressable onPress={onDelete} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Delete batch ${item.batch_no}`} style={t.del}>
            <MCI name="trash-can-outline" size={18} color={COLORS.danger} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export default function BatchListScreen({ navigation }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { isWide, isPhone, pad } = useLayout();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [showStart, setShowStart] = useState(false);
  const [active, setActive] = useState(null);
  const [counts, setCounts] = useState({});
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/batches', { search: dSearch || undefined });
  const canDelete = can('batching', 'delete');

  const loadActive = useCallback(async () => {
    try { setActive((await api.get('/batches/active')).data.data); } catch (e) { /* banner is optional */ }
  }, []);
  const loadCounts = useCallback(() => {
    Promise.allSettled([count({}), count({ status: 'IN_PROGRESS' }), count({ status: 'COMPLETED' }), count({ status: 'ON_HOLD' }), count({ status: 'OPEN' })]).then((r) => {
      const v = (i) => (r[i].status === 'fulfilled' ? r[i].value : undefined);
      setCounts({ all: v(0), running: v(1), done: v(2), pending: v(3) === undefined && v(4) === undefined ? undefined : (v(3) || 0) + (v(4) || 0) });
    });
  }, []);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    loadActive(); loadCounts();
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload, loadActive, loadCounts]));

  const open = (item) => navigation.navigate('BatchDetail', { id: item.id });

  // delete a batch after confirmation, then refresh list / banner / counts
  const deletingRef = useRef(false);
  const remove = async (item) => {
    if (deletingRef.current) return;
    if (!(await confirmDelete(`Delete batch ${item.batch_no}? Its materials go back to stock. This cannot be undone.`))) return;
    deletingRef.current = true;
    try {
      await api.delete(`/batches/${item.id}`);
      toast(`Batch ${item.batch_no} deleted`);
      list.reload(); loadActive(); loadCounts();
    } catch (e) { toast(errMsg(e)); }
    deletingRef.current = false;
  };

  const empty = <EmptyView icon="⚖️" message="No batches yet" />;
  const footer = list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null;

  return (
    <View style={s.wrap}>
      <PageToolbar icon="scale-balance" title="Batch Management" desc="Create and track production batches" count={list.total} noun="batch" search={search} onSearch={setSearch}
        placeholder="Search batch no / product" addLabel="New Batch" onAdd={can('batching', 'create') ? () => setShowStart(true) : null}>
        {!isPhone && (
          <View style={s.stats}>
            <StatCard icon="layers-triple-outline" color="#E8942A" value={counts.all === undefined ? undefined : fmt(counts.all)} label="Total Batches" />
            <View style={{ width: 12 }} />
            <StatCard icon="progress-clock" color="#F2A900" value={counts.running === undefined ? undefined : fmt(counts.running)} label="In Progress" />
            <View style={{ width: 12 }} />
            <StatCard icon="check-circle" color="#2E9E5B" value={counts.done === undefined ? undefined : fmt(counts.done)} label="Completed" />
            <View style={{ width: 12 }} />
            <StatCard icon="arrow-up-circle" color="#D93B3B" value={counts.pending === undefined ? undefined : fmt(counts.pending)} label="Pending" />
          </View>
        )}
      </PageToolbar>

      {!!active && (
        <Container>
          <PressableScale to={0.98} style={s.banner} onPress={() => navigation.navigate('BatchDetail', { id: active.id })}>
            <Text style={s.bannerTitle}>Active batch: {active.batch_no}</Text>
            <Text style={s.bannerSub}>{active.product_name}  •  {active.status === 'ON_HOLD' ? 'ON HOLD' : 'Running'}  •  Process: {stageText(active)}</Text>
            <Text style={s.bannerHint}>Tap to open.</Text>
          </PressableScale>
        </Container>
      )}

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : isWide ? (
          <View style={[s.table, SHADOW.sm, { marginHorizontal: pad }]}>
            <TableHead showActions={canDelete} />
            <FlatList
              data={list.items}
              keyExtractor={(i) => String(i.id)}
              refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { list.refresh(); loadActive(); loadCounts(); }} colors={[COLORS.primary]} />}
              onEndReached={list.loadMore} onEndReachedThreshold={0.4}
              ListEmptyComponent={empty}
              ListFooterComponent={footer}
              renderItem={({ item, index }) => <TableRow item={item} index={index} onOpen={() => open(item)} onDelete={canDelete ? () => remove(item) : null} />}
            />
          </View>
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { list.refresh(); loadActive(); loadCounts(); }} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={empty}
            ListFooterComponent={footer}
            renderItem={(item, i) => {
              const st = badgeFor(item);
              const running = item.status === 'IN_PROGRESS' || item.status === 'ON_HOLD';
              return (
                <InfoCard index={i} icon="scale-balance" color={COLORS.primary} value={item.batch_no} size="md"
                  caption={`${item.product_name}  •  ${fmt(item.planned_qty_kg)} kg`}
                  right={<ChevronDot />} onPress={() => open(item)}
                  footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
                  <InfoLine icon="calendar-blank-outline" text={String(item.production_date).slice(0, 10)} />
                  <InfoLine icon="progress-clock" text={`Process: ${running ? stageText(item) : st.label.charAt(0) + st.label.slice(1).toLowerCase()}`} />
                </InfoCard>
              );
            }} />
        )}
      </Container>

      <StartBatchModal visible={showStart} onDismiss={() => setShowStart(false)}
        onSaved={(b) => { setShowStart(false); list.reload(); loadActive(); loadCounts(); toast(`Batch ${b.batch_no} saved - next: ${b.roasting_mode === 'PARALLEL' ? 'Filtering + Roasting' : stageLabel(b.current_stage)}`); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  stats: { flexDirection: 'row', marginTop: 14 },
  table: { flex: 1, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', marginTop: 8, marginBottom: 20 },
  banner: { backgroundColor: COLORS.primaryDark, borderRadius: 16, marginHorizontal: 12, marginTop: 10, marginBottom: 6, padding: 14 },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  bannerSub: { color: '#FFD9A0', fontWeight: '700', marginTop: 3 },
  bannerHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },
});

const t = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  head: { height: 44, backgroundColor: '#FBF8F4', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  body: { minHeight: 56, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  th: { fontSize: 13, fontWeight: '800', color: COLORS.text, paddingRight: 12 },
  idx: { fontSize: 13, fontWeight: '700', color: COLORS.textSoft },
  no: { fontSize: 14.5, fontWeight: '800', color: COLORS.text },
  cell: { fontSize: 14, fontWeight: '600', color: COLORS.textSoft },
  eye: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  del: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});