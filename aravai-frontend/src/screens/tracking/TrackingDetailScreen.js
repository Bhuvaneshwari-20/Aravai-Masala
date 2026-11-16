import React, { useCallback, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const dt = (x) => (x ? String(x).slice(0, 16).replace('T', ' ') : '-');
const STEP_STYLE = {
  DONE: { icon: 'check-circle', color: COLORS.ok, bg: COLORS.okBg, label: 'DONE' },
  CURRENT: { icon: 'progress-clock', color: '#0E7490', bg: '#E0F2F7', label: 'IN PROGRESS' },
  PENDING: { icon: 'checkbox-blank-circle-outline', color: COLORS.grey, bg: COLORS.greyBg, label: 'PENDING' },
  SKIPPED: { icon: 'minus-circle-outline', color: COLORS.grey, bg: COLORS.greyBg, label: 'NOT NEEDED' },
};

function Total({ label, value, color, sub }) {
  return (
    <View style={s.total}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={[s.totalValue, color && { color }]}>{value}</Text>
      {!!sub && <Text style={s.totalSub}>{sub}</Text>}
    </View>
  );
}

// Horizontal tracker: Batching ✔ → Filtering ✔ → Roasting ● → Grinding ○ ...
function Tracker({ steps }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4, alignItems: 'center' }}>
      {steps.map((st, i) => {
        const ss = st.on_hold ? { ...STEP_STYLE.CURRENT, icon: 'pause-circle', color: COLORS.warn, label: 'ON HOLD' } : STEP_STYLE[st.status];
        return (
          <View key={st.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center', width: 82 }}>
              <MCI name={ss.icon} size={28} color={ss.color} />
              <Text style={[s.trackLabel, { color: st.status === 'PENDING' ? COLORS.grey : COLORS.text }]}>{st.label}</Text>
            </View>
            {i < steps.length - 1 && <MCI name="arrow-right" size={16} color={COLORS.border} />}
          </View>
        );
      })}
    </ScrollView>
  );
}

// Weighed 145 -> after each step: how many kg are left, and how much was lost there
function WeightFlow({ steps, weighed }) {
  const rows = steps.filter((st) => st.out_kg !== null);
  if (!rows.length || !weighed) return <Text style={s.muted}>Weight flow appears after batching is complete.</Text>;
  const worst = rows.filter((r) => r.loss_pct !== null).sort((a, b) => b.loss_pct - a.loss_pct)[0];
  return (
    <View>
      {rows.map((st) => {
        const w = Math.max(Math.min((st.out_kg / weighed) * 100, 100), 2);
        const hot = !!st.loss_alert;
        return (
          <View key={st.key} style={s.flowRow}>
            <Text style={s.flowName}>{st.label}</Text>
            <View style={{ flex: 1 }}>
              <View style={s.flowTrack}><View style={[s.flowBar, { width: `${w}%`, backgroundColor: hot ? COLORS.danger : COLORS.primary }]} /></View>
              <Text style={s.flowKg}>
                {fmt(st.out_kg)} kg
                {st.loss_kg ? <Text style={{ color: hot ? COLORS.danger : COLORS.warn, fontWeight: '800' }}>{`   -${fmt(st.loss_kg)} kg (${st.loss_pct}%)${hot ? '  HIGH' : ''}`}</Text> : null}
              </Text>
            </View>
          </View>
        );
      })}
      {!!worst && worst.loss_kg > 0 && (
        <View style={s.worst}><MCI name="alert-circle" size={16} color={COLORS.warn} />
          <Text style={s.worstText}>Highest loss: {worst.label} - {fmt(worst.loss_kg)} kg ({worst.loss_pct}%)</Text></View>
      )}
    </View>
  );
}

function Step({ st, last }) {
  const ss = st.on_hold ? { ...STEP_STYLE.CURRENT, icon: 'pause-circle', color: COLORS.warn, bg: COLORS.warnBg, label: 'ON HOLD' } : STEP_STYLE[st.status];
  const hasNums = st.in_kg !== null || st.out_kg !== null;
  return (
    <View style={s.stepRow}>
      <View style={{ alignItems: 'center', width: 36 }}>
        <MCI name={ss.icon} size={26} color={ss.color} />
        {!last && <View style={[s.line, { backgroundColor: st.status === 'DONE' ? COLORS.ok : COLORS.border }]} />}
      </View>
      <View style={[s.stepBody, st.status === 'PENDING' && { opacity: 0.6 }]}>
        <View style={s.stepHead}>
          <Text style={s.stepTitle}>{st.label}</Text>
          <View style={[s.pill, { backgroundColor: ss.bg }]}><Text style={[s.pillText, { color: ss.color }]}>{ss.label}</Text></View>
        </View>

        {(st.started_at || st.ended_at || st.operator) && (
          <Text style={s.meta}>
            {st.started_at ? `Started ${dt(st.started_at)}` : ''}{st.ended_at ? `  ·  Finished ${dt(st.ended_at)}` : ''}
            {st.operator ? `${st.started_at || st.ended_at ? '  ·  ' : ''}By ${st.operator}` : ''}
          </Text>
        )}

        {hasNums && (
          <View style={s.nums}>
            {st.in_kg !== null && <View style={s.num}><Text style={s.numLabel}>INPUT</Text><Text style={s.numVal}>{fmt(st.in_kg)} kg</Text></View>}
            {st.out_kg !== null && <View style={s.num}><Text style={s.numLabel}>OUTPUT</Text><Text style={s.numVal}>{fmt(st.out_kg)} kg</Text></View>}
            {st.loss_pct !== null && (
              <View style={s.num}><Text style={s.numLabel}>LOSS</Text>
                <Text style={[s.numVal, st.loss_alert && { color: COLORS.danger }]}>{fmt(st.loss_kg)} kg · {st.loss_pct}%</Text></View>
            )}
          </View>
        )}
        {st.loss_alert && <Text style={s.alert}>Roasting loss is above the limit</Text>}

        {st.lines.map((l, i) => (
          <View key={i} style={s.line2}>
            <Text style={s.lineLabel} numberOfLines={1}>{l.label}</Text>
            <Text style={[s.lineValue, l.alert && { color: COLORS.danger }]}>{l.value}{l.alert ? '  HIGH' : ''}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function TrackingDetailScreen({ route }) {
  const { id } = route.params;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { setD((await api.get(`/tracking/batches/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error && !d) return <EmptyView error={error} onRetry={() => load()} />;
  if (!d) return <LoadingView />;

  const { batch: b, steps, totals: t } = d;
  const hold = b.status === 'ON_HOLD';
  const done = b.status === 'COMPLETED';

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
      <Container>
        <View style={s.card}>
          <View style={s.headRow}>
            <Text style={s.title}>{b.batch_no}</Text>
            <View style={[s.pill, { backgroundColor: hold ? COLORS.warnBg : done ? COLORS.okBg : '#E0F2F7' }]}>
              <Text style={[s.pillText, { color: hold ? COLORS.warn : done ? COLORS.ok : '#0E7490' }]}>{hold ? 'ON HOLD' : done ? 'COMPLETED' : String(b.current_stage).toUpperCase()}</Text>
            </View>
          </View>
          <Text style={s.product}>{b.product_name}{b.recipe_no ? `  ·  ${b.recipe_no}` : ''}</Text>
          <Text style={s.meta}>Production date {String(b.production_date).slice(0, 10)}</Text>
          {hold && <Text style={[s.alert, { marginTop: 8 }]}>On hold: {b.hold_reason}</Text>}
          <View style={{ marginTop: 12 }}><Tracker steps={steps} /></View>
        </View>

        <View style={s.totals}>
          <Total label="WEIGHED" value={t.weighed_kg !== null ? `${fmt(t.weighed_kg)} kg` : '-'} />
          <Total label="IN PROCESS" value={`${fmt(b.current_output_kg)} kg`} />
          <Total label="WASTAGE" value={`${fmt(t.wastage_kg)} kg`} color={t.wastage_kg > 0 ? COLORS.warn : undefined} />
          <Total label="PACKED" value={t.packed_kg !== null ? `${fmt(t.packed_kg)} kg` : '-'} sub={t.packed_kg !== null ? `${t.accepted_bags} bags OK · ${t.rejected_bags} rejected` : undefined} />
          <Total label="YIELD" value={t.yield_pct !== null ? `${t.yield_pct}%` : '-'} color={t.yield_pct !== null ? COLORS.ok : undefined} sub="packed ÷ weighed" />
        </View>

        <View style={s.card}>
          <Text style={s.sec}>WEIGHT FLOW</Text>
          <WeightFlow steps={steps} weighed={t.weighed_kg} />
        </View>

        <View style={s.card}>
          <Text style={s.sec}>TIMELINE</Text>
          {steps.map((st, i) => <Step key={st.key} st={st} last={i === steps.length - 1} />)}
        </View>
      </Container>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', margin: 12, marginBottom: 0, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  product: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  meta: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 3 },
  pill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  alert: { color: COLORS.danger, fontWeight: '800', fontSize: 12.5, marginTop: 6 },
  muted: { color: COLORS.grey, fontWeight: '600' },
  sec: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 10 },
  trackLabel: { fontSize: 11.5, fontWeight: '800', marginTop: 3 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginTop: 6 },
  total: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, margin: 6, minWidth: 130, flexGrow: 1 },
  totalLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  totalValue: { fontSize: 19, fontWeight: '900', color: COLORS.text, marginTop: 3 },
  totalSub: { fontSize: 11, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  flowRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  flowName: { width: 84, fontSize: 13, fontWeight: '800', color: COLORS.text, paddingTop: 1 },
  flowTrack: { height: 12, backgroundColor: COLORS.greyBg, borderRadius: 6, overflow: 'hidden' },
  flowBar: { height: 12, borderRadius: 6 },
  flowKg: { fontSize: 12.5, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  worst: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 10, marginTop: 2 },
  worstText: { color: COLORS.warn, fontWeight: '800', fontSize: 13, marginLeft: 6, flex: 1 },
  stepRow: { flexDirection: 'row' },
  line: { width: 2, flex: 1, minHeight: 24, marginVertical: 2 },
  stepBody: { flex: 1, paddingBottom: 18 },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  nums: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  num: { backgroundColor: COLORS.greyBg, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, marginRight: 8, marginBottom: 6 },
  numLabel: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  numVal: { fontSize: 14, fontWeight: '900', color: COLORS.text, marginTop: 1 },
  line2: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  lineLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.text, marginRight: 8 },
  lineValue: { fontSize: 13, fontWeight: '700', color: COLORS.grey },
});