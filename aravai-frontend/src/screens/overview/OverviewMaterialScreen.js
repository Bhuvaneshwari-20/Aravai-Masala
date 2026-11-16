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

const LEDGER_COLS = [
  { key: 'date', label: 'DATE', w: 96 }, { key: 'type', label: 'TYPE', w: 120 }, { key: 'in', label: 'IN', w: 90 },
  { key: 'out', label: 'OUT', w: 90 }, { key: 'bal', label: 'BALANCE', w: 100 }, { key: 'batch', label: 'BATCH', w: 130 }, { key: 'note', label: 'PURPOSE / REF', w: 240 },
];
const TYPE = { OPENING: 'Opening', INWARD: 'Received', ISSUE: 'Issued', ADJUSTMENT_IN: 'Adjust +', ADJUSTMENT_OUT: 'Adjust -' };

function Total({ label, value, color, sub }) {
  return (
    <View style={s.total}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={[s.totalValue, color && { color }]}>{value}</Text>
      {!!sub && <Text style={s.totalSub}>{sub}</Text>}
    </View>
  );
}

// One material: batches it went into, its roasting loss, and the stock in/out ledger linked to batch numbers
export default function OverviewMaterialScreen({ route, navigation }) {
  const { id } = route.params;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { setD((await api.get(`/material-overview/materials/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error && !d) return <EmptyView error={error} onRetry={() => load()} />;
  if (!d) return <LoadingView />;
  const { material: m, totals: t } = d;
  const low = m.current_stock <= m.minimum_stock;
  const openBatch = (batchId) => batchId && navigation.navigate('OverviewBatch', { id: batchId });

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
      <Container>
        <View style={s.card}>
          <Text style={s.title}>{m.material_name}</Text>
          <Text style={s.meta}>{m.material_code} · {m.category_name}{m.place ? ` · ${m.place}` : ''}</Text>
        </View>

        <View style={s.totals}>
          <Total label="CURRENT STOCK" value={`${fmt(m.current_stock)} ${m.unit}`} color={low ? COLORS.danger : undefined} sub={`Minimum ${fmt(m.minimum_stock)}${low ? ' · LOW' : ''}`} />
          <Total label="RECEIVED (ALL TIME)" value={`${fmt(t.received)} ${m.unit}`} />
          <Total label="ISSUED (ALL TIME)" value={`${fmt(t.issued)} ${m.unit}`} />
          <Total label="USED IN BATCHES" value={`${fmt(t.used_in_batches_kg)} kg`} sub={`${t.batch_count} batch${t.batch_count === 1 ? '' : 'es'}`} />
          <Total label="ROASTING LOSS" value={t.roast_loss_pct === null ? '-' : `${t.roast_loss_pct}%`} color={t.roast_loss_alert ? COLORS.danger : undefined}
            sub={t.roast_entries ? `${fmt(t.roast_loss_kg)} kg of ${fmt(t.roast_input_kg)} kg${t.roast_loss_alert ? ' · HIGH' : ''}` : 'No roasting entries'} />
        </View>

        <View style={s.card}>
          <Text style={s.sec}>BATCHES USING THIS MATERIAL</Text>
          {d.batches.length === 0 ? <Text style={s.muted}>Not used in any batch yet.</Text> : d.batches.map((b) => (
            <PressableScale key={b.batch_id} to={0.99} onPress={() => openBatch(b.batch_id)} style={s.line}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineMain}>{b.batch_no}</Text>
                <Text style={s.lineSub} numberOfLines={1}>{b.product_name} · {String(b.production_date).slice(0, 10)}</Text>
              </View>
              <Text style={s.lineQty}>{fmt(b.qty)} kg</Text>
            </PressableScale>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.sec}>ROASTING LOSS PER BATCH</Text>
          {d.roasting.length === 0 ? <Text style={s.muted}>No completed roasting entries for this material.</Text> : d.roasting.map((r) => (
            <View key={r.id} style={s.line}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineMain}>{r.batch_no}</Text>
                <Text style={s.lineSub}>{String(r.roast_date).slice(0, 10)} · {fmt(r.input_weight)} → {fmt(r.output_weight)} kg</Text>
              </View>
              <Text style={[s.lineQty, r.loss_alert && { color: COLORS.danger }]}>{r.loss_percent === null ? '-' : `${r.loss_percent}%`}{r.loss_alert ? '  HIGH' : ''}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.sec}>STOCK LEDGER (LATEST 100)</Text>
          {d.ledger.length === 0 ? <Text style={s.muted}>No stock entries.</Text> : (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ minWidth: 870 }}>
                <View style={[s.tr, s.trHead]}>{LEDGER_COLS.map((c) => <Text key={c.key} style={[s.th, { width: c.w }]}>{c.label}</Text>)}</View>
                {d.ledger.map((x) => (
                  <View key={x.id} style={s.tr}>
                    <Text style={[s.td, { width: 96 }]}>{String(x.txn_date).slice(0, 10)}</Text>
                    <Text style={[s.td, { width: 120, fontWeight: '800' }]}>{TYPE[x.txn_type] || x.txn_type}</Text>
                    <Text style={[s.td, { width: 90, color: COLORS.ok, fontWeight: '800' }]}>{num(x.inward_qty) ? fmt(x.inward_qty) : ''}</Text>
                    <Text style={[s.td, { width: 90, color: COLORS.danger, fontWeight: '800' }]}>{num(x.despatch_qty) ? fmt(x.despatch_qty) : ''}</Text>
                    <Text style={[s.td, { width: 100, fontWeight: '800' }]}>{fmt(x.closing_stock)}</Text>
                    <View style={{ width: 130 }}>
                      {x.batch_no ? <PressableScale to={0.97} onPress={() => openBatch(x.batch_id)}><Text style={[s.td, { color: COLORS.primary, fontWeight: '900' }]}>{x.batch_no}</Text></PressableScale> : <Text style={s.td}>-</Text>}
                    </View>
                    <Text style={[s.td, { width: 240 }]} numberOfLines={1}>{x.purpose || x.grn_no || x.agency_supplier || x.reference_no || '-'}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </Container>
    </ScrollView>
  );
}
const num = (x) => Number(x || 0);

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', margin: 12, marginBottom: 0, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  meta: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 4 },
  muted: { color: COLORS.grey, fontWeight: '600' },
  sec: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 10 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginTop: 6 },
  total: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, margin: 6, minWidth: 150, flexGrow: 1 },
  totalLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  totalValue: { fontSize: 19, fontWeight: '900', color: COLORS.text, marginTop: 3 },
  totalSub: { fontSize: 11, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  lineMain: { fontSize: 14.5, fontWeight: '900', color: COLORS.text },
  lineSub: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  lineQty: { fontSize: 14.5, fontWeight: '900', color: COLORS.text },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 9, paddingHorizontal: 6 },
  trHead: { backgroundColor: COLORS.greyBg, borderRadius: 8, borderBottomWidth: 0 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  td: { fontSize: 13.5, color: COLORS.text, fontWeight: '600', paddingRight: 8 },
});