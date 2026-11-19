import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, ScrollView, TextInput, RefreshControl, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import useDebounce from '../../hooks/useDebounce';
import useOptions from '../../hooks/useOptions';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import SelectField from '../../components/SelectField';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const STAGE_COLOR = {
  BATCHING: '#14B8A6', FILTERING: '#0891B2', ROASTING: '#F97316', GRINDING: '#64748B',
  BLENDING: '#D946EF', PACKING: '#06B6D4', COMPLETED: '#22C55E',
};
const VIEW_CHIPS = [{ value: 'board', label: 'Board' }, { value: 'timeline', label: 'Timeline' }];
const STAGE_ORDER = ['BATCHING', 'FILTERING', 'ROASTING', 'GRINDING', 'BLENDING', 'PACKING', 'COMPLETED'];
const dayLabel = (d) => {
  if (!d) return 'No date';
  const t = new Date(`${d}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};
const STATUS_CHIPS = [
  { value: 'ALL', label: 'All' }, { value: 'RUNNING', label: 'Running' },
  { value: 'HOLD', label: 'On hold' }, { value: 'STUCK', label: 'Stuck' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtDate = (t) => { const d = t.replace(/[^0-9]/g, '').slice(0, 8); return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };
// 53 -> "2d 5h", 5 -> "5h"
const since = (h) => (h === null || h === undefined ? '' : h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`);

function Stat({ icon, color, value, label }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: `${color}1A` }]}><MCI name={icon} size={20} color={color} /></View>
      <View>
        <Text style={s.statValue}>{value}</Text>
        <Text style={s.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function BatchCard({ item, color, onPress }) {
  const done = item.stage === 'COMPLETED';
  return (
    <PressableScale to={0.98} onPress={onPress} style={[s.card, item.stuck && s.cardStuck, item.on_hold && s.cardHold]}>
      <View style={s.cardTop}>
        <Text style={s.batchNo}>{item.batch_no}</Text>
        {item.on_hold && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>HOLD</Text></View>}
        {item.stuck && <View style={[s.tag, { backgroundColor: COLORS.dangerBg }]}><Text style={[s.tagText, { color: COLORS.danger }]}>STUCK</Text></View>}
      </View>
      <Text style={s.product} numberOfLines={1}>{item.product_name}</Text>
      <View style={s.cardBottom}>
        <Text style={[s.kg, { color }]}>{fmt(item.kg)} kg</Text>
        {!done && item.hours_in_stage !== null && (
          <View style={s.timeRow}>
            <MCI name="clock-outline" size={13} color={item.stuck ? COLORS.danger : COLORS.grey} />
            <Text style={[s.timeText, item.stuck && { color: COLORS.danger }]}>{since(item.hours_in_stage)} here</Text>
          </View>
        )}
      </View>
      {item.on_hold && !!item.hold_reason && <Text style={s.reason} numberOfLines={1}>{item.hold_reason}</Text>}
    </PressableScale>
  );
}

// Timeline view: newest batch first, grouped by production date. A dot + line on the left, the batch card on the right,
// and a small stage tracker (done / current / waiting) so the whole journey of a batch is visible at a glance.
function TimelineView({ columns, onOpen }) {
  const groups = useMemo(() => {
    const all = columns.flatMap((c) => c.items).sort((a, b) => b.id - a.id);
    const map = new Map();
    all.forEach((it) => { const k = it.production_date || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(it); });
    return [...map.entries()];
  }, [columns]);
  if (!groups.length) return <Text style={s.empty}>No batches</Text>;
  return (
    <View style={s.tl}>
      {groups.map(([date, items]) => (
        <View key={date || 'none'}>
          <Text style={s.tlDay}>{dayLabel(date)}</Text>
          {items.map((it, i) => {
            const color = it.stuck ? COLORS.danger : it.on_hold ? COLORS.warn : (STAGE_COLOR[it.stage] || COLORS.grey);
            const at = STAGE_ORDER.indexOf(it.stage);
            const done = it.stage === 'COMPLETED';
            const last = i === items.length - 1;
            return (
              <View key={it.id} style={s.tlRow}>
                <View style={s.tlRail}>
                  <View style={[s.tlDot, { backgroundColor: done ? COLORS.ok : color }]}>{done && <MCI name="check" size={11} color="#fff" />}</View>
                  {!last && <View style={s.tlLine} />}
                </View>
                <PressableScale to={0.99} onPress={() => onOpen(it)} style={[s.tlCard, last && { marginBottom: 6 }, it.stuck && s.cardStuck, it.on_hold && s.cardHold]}>
                  <View style={s.cardTop}>
                    <Text style={s.batchNo}>{it.batch_no}</Text>
                    {it.on_hold && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>HOLD</Text></View>}
                    {it.stuck && <View style={[s.tag, { backgroundColor: COLORS.dangerBg }]}><Text style={[s.tagText, { color: COLORS.danger }]}>STUCK</Text></View>}
                    <View style={[s.tag, { backgroundColor: `${STAGE_COLOR[it.stage] || COLORS.grey}22` }]}>
                      <Text style={[s.tagText, { color: STAGE_COLOR[it.stage] || COLORS.grey }]}>{done ? 'COMPLETED' : it.stage}</Text>
                    </View>
                  </View>
                  <Text style={s.product} numberOfLines={1}>{it.product_name}</Text>
                  <View style={s.steps}>
                    {STAGE_ORDER.slice(0, 6).map((st, k) => (
                      <View key={st} style={[s.step, { backgroundColor: k < at || done ? COLORS.ok : k === at ? color : COLORS.border }]} />
                    ))}
                  </View>
                  <View style={s.cardBottom}>
                    <Text style={[s.kg, { color }]}>{fmt(it.kg)} kg</Text>
                    {!done && it.hours_in_stage !== null && (
                      <View style={s.timeRow}>
                        <MCI name="clock-outline" size={13} color={it.stuck ? COLORS.danger : COLORS.grey} />
                        <Text style={[s.timeText, it.stuck && { color: COLORS.danger }]}>{since(it.hours_in_stage)} in {it.stage.toLowerCase()}</Text>
                      </View>
                    )}
                  </View>
                  {it.on_hold && !!it.hold_reason && <Text style={s.reason} numberOfLines={1}>{it.hold_reason}</Text>}
                </PressableScale>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// "Which batch is where": Board = one column per stage, Timeline = batches down a time line. Tap a batch for its full timeline.
export default function TrackingBoardScreen({ navigation }) {
  const { isPhone } = useLayout();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [stage, setStage] = useState('ALL');
  const [view, setView] = useState('board');
  const [productId, setProductId] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const dSearch = useDebounce(search, 400);
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }));
  const productOptions = useMemo(() => [{ value: 'ALL', label: 'All products' }, ...products], [products]);

  const params = useMemo(() => ({
    search: dSearch || undefined,
    product_id: productId !== 'ALL' ? productId : undefined,
    from: DATE_RE.test(from) ? from : undefined,
    to: DATE_RE.test(to) ? to : undefined,
  }), [dSearch, productId, from, to]);

  const reqId = useRef(0);
  const load = useCallback(async (mode) => {
    const id = ++reqId.current;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await api.get('/tracking/board', { params });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) setRefreshing(false);
  }, [params]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // status + stage filters are applied here on the board that was loaded
  const columns = useMemo(() => {
    if (!data) return [];
    const keep = (it) => {
      if (status === 'RUNNING') return it.stage !== 'COMPLETED';
      if (status === 'HOLD') return it.on_hold;
      if (status === 'STUCK') return it.stuck;
      return true;
    };
    return data.columns
      .filter((c) => stage === 'ALL' || c.stage === stage)
      .map((c) => { const items = c.items.filter(keep); return { ...c, items, count: items.length, total_kg: Math.round(items.reduce((a, x) => a + x.kg, 0) * 1000) / 1000 }; });
  }, [data, status, stage]);

  const stageChips = useMemo(() => [{ value: 'ALL', label: 'All stages' }, ...(data ? data.columns.map((c) => ({ value: c.stage, label: c.label })) : [])], [data]);
  const sm = data?.summary;
  const colW = isPhone ? 250 : 275;

  return (
    <View style={s.wrap}>
      <PageToolbar icon="map-marker-path" title="Batch Tracking" subtitle={sm ? `${sm.running} running · ${fmt(sm.running_kg)} kg in process` : 'Loading...'}
        search={search} onSearch={setSearch} placeholder="Search batch no / product" />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}>
        {error && !data ? <EmptyView error={error} onRetry={() => load()} /> : !data ? <LoadingView /> : (
          <>
            <Container>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stats}>
                <Stat icon="progress-clock" color="#0E7490" value={sm.running} label="In progress" />
                <Stat icon="check-circle" color={COLORS.ok} value={sm.completed_this_month} label="Completed this month" />
                <Stat icon="pause-circle" color={COLORS.warn} value={sm.on_hold} label="On hold" />
                <Stat icon="alert-circle" color={COLORS.danger} value={sm.stuck} label={`Stuck (>${sm.stuck_hours}h)`} />
                <Stat icon="weight-kilogram" color="#7C3AED" value={`${fmt(sm.running_kg)} kg`} label="In process now" />
              </ScrollView>

              <FilterChips options={VIEW_CHIPS} value={view} onChange={setView} />
              <FilterChips options={STATUS_CHIPS} value={status} onChange={setStatus} />
              <FilterChips options={stageChips} value={stage} onChange={setStage} />

              <View style={[s.filters, isPhone && { flexDirection: 'column' }]}>
                <View style={{ flex: 1, minWidth: 200 }}><SelectField label="Product" value={productId} options={productOptions} onChange={setProductId} /></View>
                <View style={s.dateBox}>
                  <Text style={s.dateLabel}>FROM</Text>
                  <TextInput value={from} onChangeText={(t) => setFrom(fmtDate(t))} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.grey} keyboardType="number-pad" maxLength={10} style={s.dateInput} />
                </View>
                <View style={s.dateBox}>
                  <Text style={s.dateLabel}>TO</Text>
                  <TextInput value={to} onChangeText={(t) => setTo(fmtDate(t))} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.grey} keyboardType="number-pad" maxLength={10} style={s.dateInput} />
                </View>
              </View>
            </Container>

            {view === 'timeline' ? (
              <Container><TimelineView columns={columns} onOpen={(it) => navigation.navigate('TrackingDetail', { id: it.id })} /></Container>
            ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.board}>
              {columns.map((c) => {
                const color = STAGE_COLOR[c.stage] || COLORS.grey;
                return (
                  <View key={c.stage} style={[s.col, { width: colW }]}>
                    <View style={[s.colHead, { borderTopColor: color }]}>
                      <Text style={s.colTitle}>{c.label}</Text>
                      <View style={[s.count, { backgroundColor: `${color}22` }]}><Text style={[s.countText, { color }]}>{c.count}</Text></View>
                    </View>
                    <Text style={s.colKg}>{fmt(c.total_kg)} kg</Text>
                    {c.items.length === 0 ? <Text style={s.empty}>No batches</Text> : c.items.map((it) => (
                      <BatchCard key={it.id} item={it} color={color} onPress={() => navigation.navigate('TrackingDetail', { id: it.id })} />
                    ))}
                  </View>
                );
              })}
            </ScrollView>
            )}
          </>
        )}
      </ScrollView>
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
  filters: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, marginTop: 6 },
  dateBox: { marginLeft: 10, marginBottom: 4, minWidth: 140 },
  dateLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey, marginBottom: 4 },
  dateInput: { height: 48, borderWidth: 1, borderColor: '#E3D3C8', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 14, fontWeight: '700', color: COLORS.text, outlineStyle: 'none' },
  board: { paddingHorizontal: 12, paddingTop: 12, alignItems: 'flex-start' },
  col: { backgroundColor: '#F6EFE7', borderRadius: 16, padding: 10, marginRight: 12 },
  colHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 4, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  colTitle: { fontSize: 14.5, fontWeight: '900', color: COLORS.text },
  count: { borderRadius: 10, minWidth: 26, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 13, fontWeight: '900' },
  colKg: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginVertical: 8, marginLeft: 4 },
  empty: { textAlign: 'center', color: COLORS.grey, fontWeight: '600', paddingVertical: 18 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8 },
  cardStuck: { borderColor: COLORS.danger, backgroundColor: '#FFF8F7' },
  cardHold: { borderColor: COLORS.warn, backgroundColor: '#FFFBF5' },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  batchNo: { flex: 1, fontSize: 15, fontWeight: '900', color: COLORS.text },
  tag: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 6 },
  tagText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  product: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey, marginTop: 3 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  kg: { fontSize: 16, fontWeight: '900' },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginLeft: 3 },
  tl: { paddingHorizontal: 12, paddingTop: 14 },
  tlDay: { fontSize: 11.5, fontWeight: '900', letterSpacing: 1.1, color: COLORS.grey, marginBottom: 10, marginTop: 4, marginLeft: 2 },
  tlRow: { flexDirection: 'row' },
  tlRail: { width: 28, alignItems: 'center' },
  tlDot: { width: 18, height: 18, borderRadius: 9, marginTop: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: COLORS.bg },
  tlLine: { flex: 1, width: 2, backgroundColor: COLORS.border, marginTop: 2 },
  tlCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 12, marginLeft: 6 },
  steps: { flexDirection: 'row', marginTop: 10 },
  step: { flex: 1, height: 5, borderRadius: 3, marginRight: 4 },
  reason: { marginTop: 6, fontSize: 11.5, fontWeight: '700', color: COLORS.warn },
});