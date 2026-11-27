import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const HEAD = ['#7F1212', '#B01E1E', '#D1451F'];
const VIEWS = [{ value: 'batch', label: 'Batch Wastage' }, { value: 'fill', label: 'Overfill / Underfill' }];
const dmy = (d) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; };
const T = (t, extra) => <Text style={[s.td, extra]} numberOfLines={1}>{t}</Text>;
const pill = (label, fg, bg) => <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillText, { color: fg }]}>{label}</Text></View>;

const BATCH_COLS = [
  { label: 'S.NO', flex: 0.5, render: (r, i) => T(i + 1) },
  { label: 'Batch No', flex: 1.3, render: (r) => T(r.batch_no, { fontWeight: '800', color: '#222' }) },
  { label: 'Product', flex: 1.6, render: (r) => T(r.product_name) },
  { label: 'Status', flex: 1, center: true, render: (r) => (r.status === 'COMPLETED' ? pill('Completed', '#15803D', '#DCFCE7') : pill('In progress', '#92600A', '#FEF3C7')) },
  { label: 'Blended', flex: 1, right: true, render: (r) => T(`${fmt(r.output_kg)} kg`) },
  { label: 'Packed', flex: 1, right: true, render: (r) => T(`${fmt(r.packed_kg)} kg`) },
  { label: 'Rejected', flex: 1, right: true, render: (r) => T(`${fmt(r.rejected_kg)} kg`, r.rejected_kg > 0 && { color: '#B91C1C', fontWeight: '800' }) },
  { label: 'Left unpacked', flex: 1.1, right: true, render: (r) => T(`${fmt(r.unpacked_kg)} kg`, r.unpacked_kg > 0 && { color: '#B91C1C', fontWeight: '800' }) },
  { label: 'Total wastage', flex: 1.1, right: true, render: (r) => T(`${fmt(r.wastage_kg)} kg`, { color: '#B91C1C', fontWeight: '800' }) },
];
const FILL_COLS = [
  { label: 'S.NO', flex: 0.5, render: (r, i) => T(i + 1) },
  { label: 'Packing Date', flex: 1.1, render: (r) => T(dmy(r.packing_date)) },
  { label: 'Batch No', flex: 1.3, render: (r) => T(r.batch_no, { fontWeight: '800', color: '#222' }) },
  { label: 'Product', flex: 1.5, render: (r) => T(r.product_name) },
  { label: 'Pack', flex: 0.8, render: (r) => T(r.pack || '-') },
  { label: 'Packets', flex: 0.8, right: true, render: (r) => T(fmt(r.packets)) },
  { label: 'Fill', flex: 1.5, center: true, render: (r) => (r.fill === 'OVER' ? pill(`Overfill +${fmt(r.fill_kg)} kg`, '#92600A', '#FEF3C7')
    : r.fill === 'UNDER' ? pill(`Underfill -${fmt(Math.abs(r.fill_kg))} kg`, '#B91C1C', '#FEE2E2') : pill('Exact', '#15803D', '#DCFCE7')) },
];

export default function WastageScreen() {
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const [view, setView] = useState('batch');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { const r = await api.get('/wastage', { params: { search: dSearch || undefined } }); setData(r.data.data); setError(''); }
    catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [dSearch]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { setPage(1); }, [view, dSearch, pageSize]);

  const cols = view === 'batch' ? BATCH_COLS : FILL_COLS;
  const rows = useMemo(() => (data ? (view === 'batch' ? data.batches : data.fills) : []), [data, view]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const box = (c) => ({ flex: c.flex, paddingHorizontal: 4, alignItems: c.right ? 'flex-end' : c.center ? 'center' : 'flex-start' });

  return (
    <View style={s.wrap}>
      <PageToolbar icon="delete-sweep-outline" title="Wastage & Fill Report" subtitle="Batch wastage and packet overfill / underfill"
        search={search} onSearch={setSearch} placeholder="Search batch / product" />
      <Container>
        <View style={{ paddingHorizontal: 23 }}><FilterChips options={VIEWS} value={view} onChange={setView} /></View>
      </Container>
      <Container fill>
        {data === null && !error ? <LoadingView /> : data === null ? <EmptyView error={error} onRetry={() => load()} /> : (
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
            <View style={s.kpis}>
              <View style={[s.kpi, { backgroundColor: '#FDE2E2' }]}><Text style={s.kpiLabel}>Total wastage</Text><Text style={[s.kpiValue, { color: '#B91C1C' }]}>{fmt(data.summary.wastage_kg)} kg</Text></View>
              <View style={[s.kpi, { backgroundColor: '#FEF3C7' }]}><Text style={s.kpiLabel}>Overfill (packing)</Text><Text style={[s.kpiValue, { color: '#92600A' }]}>{fmt(data.summary.overfill_kg)} kg</Text></View>
              <View style={[s.kpi, { backgroundColor: '#FEE2E2' }]}><Text style={s.kpiLabel}>Underfill (packing)</Text><Text style={[s.kpiValue, { color: '#B91C1C' }]}>{fmt(data.summary.underfill_kg)} kg</Text></View>
            </View>
            <View style={s.panel}>
              <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, marginHorizontal: -14, marginTop: -14, marginBottom: 14 }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}>
                <View style={{ flex: 1, minWidth: 1000 }}>
                  <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tHead}>
                    {cols.map((c) => <Text key={c.label} numberOfLines={1} style={[s.th, { flex: c.flex, paddingHorizontal: 4, textAlign: c.right ? 'right' : c.center ? 'center' : 'left' }]}>{c.label}</Text>)}
                  </LinearGradient>
                  {rows.length === 0 ? <Text style={s.empty}>{view === 'batch' ? 'No batch has wastage' : 'No packing entries yet'}</Text>
                    : slice.map((r, idx) => (
                      <View key={r.id ?? r.batch_id} style={s.tRow}>
                        {cols.map((c) => <View key={c.label} style={box(c)}>{c.render(r, (cur - 1) * pageSize + idx)}</View>)}
                      </View>
                    ))}
                </View>
              </ScrollView>
              <View style={s.pgBar}>
                <View style={s.pgLeft}>
                  <Text style={s.pgText}>Show</Text>
                  <FilterChips options={[{ value: 10, label: '10' }, { value: 25, label: '25' }, { value: 50, label: '50' }, { value: 100, label: '100' }]} value={pageSize} onChange={setPageSize} style={{ marginHorizontal: 8 }} />
                  <Text style={s.pgText}>entries</Text>
                </View>
                <Text style={s.pgText}>{rows.length ? `Showing ${(cur - 1) * pageSize + 1} to ${Math.min(cur * pageSize, rows.length)} of ${rows.length} entries` : 'Showing 0 entries'}</Text>
                <View style={s.pgLeft}>
                  <Pressable disabled={cur <= 1} onPress={() => setPage(cur - 1)} style={[s.pgBtn, cur <= 1 && s.off]}><MCI name="chevron-left" size={18} color={COLORS.text} /><Text style={s.pgBtnText}>Previous</Text></Pressable>
                  <Text style={[s.pgText, { marginHorizontal: 10 }]}>Page {cur} of {totalPages}</Text>
                  <Pressable disabled={cur >= totalPages} onPress={() => setPage(cur + 1)} style={[s.pgBtn, cur >= totalPages && s.off]}><Text style={s.pgBtnText}>Next</Text><MCI name="chevron-right" size={18} color={COLORS.text} /></Pressable>
                </View>
              </View>
            </View>
          </ScrollView>
        )}
      </Container>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 6 },
  kpi: { flex: 1, minWidth: 200, borderRadius: 14, padding: 14, margin: 6 },
  kpiLabel: { fontSize: 12.5, fontWeight: '700', color: '#3A3A4A' },
  kpiValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  panel: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, overflow: 'hidden' },
  tHead: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10 },
  th: { fontSize: 11.5, fontWeight: '800', color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase' },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F0ECF2' },
  td: { fontSize: 13.5, fontWeight: '600', color: '#3A3A4A' },
  empty: { textAlign: 'center', color: COLORS.grey, fontWeight: '600', padding: 24 },
  pill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '800' },
  pgBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 6 },
  pgLeft: { flexDirection: 'row', alignItems: 'center' },
  pgText: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft },
  pgBtn: { flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff' },
  off: { opacity: 0.4 },
  pgBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.text },
});