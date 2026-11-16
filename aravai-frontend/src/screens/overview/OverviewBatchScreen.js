import React, { useCallback, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const COLS = [
  { key: 'mat', label: 'MATERIAL', w: 210 }, { key: 'rp', label: 'RECIPE %', w: 84 }, { key: 'exp', label: 'RECIPE KG', w: 94 },
  { key: 'act', label: 'ACTUAL KG', w: 94 }, { key: 'diff', label: 'DIFFERENCE', w: 130 }, { key: 'loss', label: 'ROAST LOSS', w: 96 }, { key: 'flag', label: 'CHECK', w: 120 },
];
const FLAG = {
  OVER: { color: COLORS.danger, bg: COLORS.dangerBg }, UNDER: { color: COLORS.warn, bg: COLORS.warnBg },
  'NOT IN RECIPE': { color: COLORS.danger, bg: COLORS.dangerBg }, 'NOT WEIGHED': { color: COLORS.warn, bg: COLORS.warnBg },
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

// Reverse trace: which materials went into this batch (and so into its finished goods) + recipe vs actual weighed
export default function OverviewBatchScreen({ route, navigation }) {
  const { id } = route.params;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { setD((await api.get(`/material-overview/batches/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error && !d) return <EmptyView error={error} onRetry={() => load()} />;
  if (!d) return <LoadingView />;
  const { batch: b, totals: t } = d;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
      <Container>
        <View style={s.card}>
          <Text style={s.title}>{b.batch_no}</Text>
          <Text style={s.product}>{b.product_name}{b.recipe_no ? `  ·  ${b.recipe_no}` : ''}</Text>
          <Text style={s.meta}>Production date {String(b.production_date).slice(0, 10)}</Text>
          <PressableScale to={0.97} onPress={() => navigation.navigate('TrackingDetail', { id: b.id })} style={s.link}>
            <Text style={s.linkText}>Open batch timeline</Text>
          </PressableScale>
        </View>

        <View style={s.totals}>
          <Total label="TOTAL WEIGHED" value={`${fmt(t.weighed_kg)} kg`} />
          <Total label="MATERIALS USED" value={String(t.materials)} />
          <Total label="NEEDS CHECK" value={String(t.flagged)} color={t.flagged ? COLORS.danger : COLORS.ok} sub={`Over ${t.variance_limit}% from recipe`} />
        </View>

        <View style={s.card}>
          <Text style={s.sec}>MATERIALS USED - RECIPE vs ACTUAL</Text>
          <Text style={s.note}>Recipe kg = recipe % applied to this batch's total weighed quantity.</Text>
          {d.materials.length === 0 ? <Text style={s.muted}>No materials weighed for this batch yet.</Text> : (
            <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: 8 }}>
              <View style={{ minWidth: 830 }}>
                <View style={[s.tr, s.trHead]}>{COLS.map((c) => <Text key={c.key} style={[s.th, { width: c.w }]}>{c.label}</Text>)}</View>
                {d.materials.map((m) => {
                  const f = m.flag ? FLAG[m.flag] : null;
                  const over = m.diff_kg !== null && m.diff_kg > 0;
                  return (
                    <PressableScale key={m.material_id} to={0.99} onPress={() => navigation.navigate('OverviewMaterial', { id: m.material_id })} style={s.tr}>
                      <View style={{ width: 210, paddingRight: 8 }}>
                        <Text style={[s.td, { fontWeight: '900' }]} numberOfLines={1}>{m.material_name}</Text>
                        <Text style={s.tdSub}>{m.material_code}</Text>
                      </View>
                      <Text style={[s.td, { width: 84 }]}>{m.recipe_pct === null ? '-' : `${m.recipe_pct}%`}</Text>
                      <Text style={[s.td, { width: 94 }]}>{m.expected_kg === null ? '-' : fmt(m.expected_kg)}</Text>
                      <Text style={[s.td, { width: 94, fontWeight: '900' }]}>{fmt(m.actual_kg)}</Text>
                      <Text style={[s.td, { width: 130, color: f ? f.color : COLORS.text, fontWeight: '800' }]}>
                        {m.diff_kg === null ? '-' : `${over ? '+' : ''}${fmt(m.diff_kg)} kg${m.diff_pct !== null ? ` (${over ? '+' : ''}${m.diff_pct}%)` : ''}`}
                      </Text>
                      <Text style={[s.td, { width: 96, color: m.roast_loss_alert ? COLORS.danger : COLORS.text, fontWeight: m.roast_loss_alert ? '900' : '600' }]}>
                        {m.roast_loss_pct === null ? '-' : `${m.roast_loss_pct}%`}
                      </Text>
                      <View style={{ width: 120 }}>
                        {f ? <View style={[s.pill, { backgroundColor: f.bg }]}><Text style={[s.pillText, { color: f.color }]}>{m.flag}</Text></View> : <Text style={[s.td, { color: COLORS.ok }]}>OK</Text>}
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.sec}>FINISHED GOODS FROM THIS BATCH</Text>
          {d.packed.length === 0 ? <Text style={s.muted}>Nothing packed yet.</Text> : d.packed.map((p, i) => (
            <View key={i} style={s.line}>
              <Text style={s.lineMain}>{p.sku_code || p.packing_size_label || 'Pack'}</Text>
              <Text style={s.lineQty}>{p.bags} bags OK · {p.rejected} rejected · {fmt(p.kg)} kg</Text>
            </View>
          ))}
        </View>
      </Container>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', margin: 12, marginBottom: 0, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  product: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  meta: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 3 },
  link: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: COLORS.greyBg, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  linkText: { fontSize: 13, fontWeight: '900', color: COLORS.primary },
  muted: { color: COLORS.grey, fontWeight: '600' },
  note: { color: COLORS.grey, fontSize: 12, fontWeight: '600' },
  sec: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginTop: 6 },
  total: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, margin: 6, minWidth: 150, flexGrow: 1 },
  totalLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  totalValue: { fontSize: 19, fontWeight: '900', color: COLORS.text, marginTop: 3 },
  totalSub: { fontSize: 11, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 6 },
  trHead: { backgroundColor: COLORS.greyBg, borderRadius: 8, borderBottomWidth: 0 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  td: { fontSize: 13.5, color: COLORS.text, fontWeight: '600', paddingRight: 8 },
  tdSub: { fontSize: 11, color: COLORS.grey, fontWeight: '700' },
  pill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  lineMain: { fontSize: 14.5, fontWeight: '900', color: COLORS.text },
  lineQty: { fontSize: 13.5, fontWeight: '700', color: COLORS.grey },
});