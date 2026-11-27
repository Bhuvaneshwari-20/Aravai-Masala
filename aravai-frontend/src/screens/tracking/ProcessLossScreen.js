import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet, Pressable, Platform, TextInput } from 'react-native';
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

const HEAD = ['#0B1B2E', '#10253D', '#17406B'];
const PROCESSES = [
  { value: 'ALL', label: 'All' }, { value: 'BATCHING', label: 'Batching' }, { value: 'FILTERING', label: 'Filtering' },
  { value: 'ROASTING', label: 'Roasting' }, { value: 'GRINDING', label: 'Grinding' }, { value: 'BLENDING', label: 'Blending' },
  { value: 'PACKING', label: 'Packing' },
];
const STATUS = { DONE: { label: 'Done', fg: '#15803D', bg: '#DCFCE7' }, CURRENT: { label: 'Pending', fg: '#92600A', bg: '#FEF3C7' } };
const COLS = [
  { label: 'S.NO', flex: 0.5 }, { label: 'Batch No', flex: 1.3 }, { label: 'Product', flex: 1.5 }, { label: 'Process', flex: 1.1 },
  { label: 'Completed On', flex: 1.5 },
  { label: 'Input', flex: 1, right: true }, { label: 'Output', flex: 1, right: true }, { label: 'Loss', flex: 1, right: true },
  { label: 'Loss %', flex: 0.8, right: true }, { label: 'Status', flex: 1, center: true },
];
const box = (c) => ({ flex: c.flex, paddingHorizontal: 4, textAlign: c.right ? 'right' : c.center ? 'center' : 'left' });
const kg = (n) => (n === null || n === undefined ? '-' : `${fmt(n)} kg`);


const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (v) => {
  if (!v) return '-';
  const t = String(v).replace('T', ' ');
  const d = t.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '-';
  const date = `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const tm = t.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(tm) || tm === '00:00') return date;   // date only (e.g. packing date)
  let h = Number(tm.slice(0, 2)); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${date}, ${String(h).padStart(2, '0')}:${tm.slice(3)} ${ap}`;
};

const ACCENT = '#0E7A3E';

const FONT = 'Plus Jakarta Sans, Inter, system-ui, sans-serif';
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('pjs-font')) {
  const l = document.createElement('link');
  l.id = 'pjs-font'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
  document.head.appendChild(l);
}


function DateBox({ label, value, onChange, min, max }) {
  return (
    <View style={s.dBox}>
      <Text style={s.dLabel}>{label}</Text>
      {Platform.OS === 'web'
        ? React.createElement('input', {
          type: 'date', value: value || '', min, max, title: label, onChange: (e) => onChange(e.target.value || ''),
style: { height: 42, boxSizing: 'border-box', border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '0 12px', fontSize: 14, fontFamily: FONT, color: COLORS.text, backgroundColor: '#fff', outline: 'none' },
        })
        : <TextInput value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" maxLength={10} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, height: 42, width: 120, paddingHorizontal: 10, color: COLORS.text }} />}
    </View>
  );
}

export default function ProcessLossScreen() {
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const [proc, setProc] = useState('ALL');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);


  const [dFrom, setDFrom] = useState('');   // typed in the boxes
  const [dTo, setDTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' }); // used for the data, set when "Show" is clicked
  const showDates = () => setApplied({ from: dFrom, to: dTo });
  const clearDates = () => { setDFrom(''); setDTo(''); setApplied({ from: '', to: '' }); };

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try {
      const r = await api.get('/tracking/process-weights', { params: { search: dSearch || undefined, from: applied.from || undefined, to: applied.to || undefined } });      setData(r.data.data.items || []); setError('');
    } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [dSearch, applied]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { setPage(1); }, [proc, dSearch, pageSize, applied]);

  const rows = useMemo(() => (data || []).filter((r) => proc === 'ALL' || r.process === proc), [data, proc]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = rows.slice((cur - 1) * pageSize, cur * pageSize);

  return (
    <View style={s.wrap}>
      <PageToolbar icon="chart-line-variant" title="Process Yield & Loss" subtitle="Input, output and loss of every batch process"
        search={search} onSearch={setSearch} placeholder="Search batch / product" />
      <Container>
        <View style={{ paddingHorizontal: 23 }}><FilterChips options={PROCESSES} value={proc} onChange={setProc} /></View>
      </Container>
            <Container>
        <View style={s.fBar}>
          <DateBox label="Batch From" value={dFrom} onChange={setDFrom} max={dTo || undefined} />
          <DateBox label="Batch To" value={dTo} onChange={setDTo} min={dFrom || undefined} />
          <Pressable onPress={showDates} style={s.showBtn}>
            <MCI name="magnify" size={17} color="#fff" /><Text style={s.showText}>Show</Text>
          </Pressable>
          {(dFrom || dTo || applied.from || applied.to) ? <Pressable onPress={clearDates} style={s.fClear}><Text style={s.fClearText}>Clear</Text></Pressable> : null}
        </View>
      </Container>
      <Container fill>
        {data === null && !error ? <LoadingView /> : data === null ? <EmptyView error={error} onRetry={() => load()} /> : (
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
            <View style={s.panel}>
              <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, marginHorizontal: -14, marginTop: -14, marginBottom: 14 }} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}>
                <View style={{ flex: 1, minWidth: 1000 }}>
                  <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tHead}>
                    {COLS.map((c) => <Text key={c.label} numberOfLines={1} style={[s.th, box(c)]}>{c.label}</Text>)}
                  </LinearGradient>
                  {rows.length === 0 ? <Text style={s.empty}>No process data found</Text> : slice.map((r, idx) => {
                    const st = STATUS[r.status] || STATUS.DONE;
                    const lossy = Number(r.loss_kg) > 0;
                    const lossStyle = lossy ? { color: '#B91C1C', fontWeight: '800' } : null;
                    return (
                      <View key={r.id} style={s.tRow}>
                        <Text style={[s.td, box(COLS[0])]}>{(cur - 1) * pageSize + idx + 1}</Text>
                        <Text style={[s.td, box(COLS[1]), { fontWeight: '800', color: '#222' }]} numberOfLines={1}>{r.batch_no}</Text>
                        <Text style={[s.td, box(COLS[2])]} numberOfLines={1}>{r.product_name}</Text>
                        <Text style={[s.td, box(COLS[3]), { fontWeight: '700' }]}>{r.process_label}</Text>
                        <Text style={[s.td, box(COLS[4]), r.status === 'CURRENT' && { color: COLORS.grey }]} numberOfLines={1}>{r.status === 'CURRENT' ? 'In progress' : when(r.completed_at)}</Text>
                        <Text style={[s.td, box(COLS[5])]}>{kg(r.in_kg)}</Text>
                        <Text style={[s.td, box(COLS[6])]}>{kg(r.out_kg)}</Text>
                        <Text style={[s.td, box(COLS[7]), lossStyle]}>{kg(r.loss_kg)}</Text>
                        <Text style={[s.td, box(COLS[8]), lossStyle]}>{r.loss_pct === null || r.loss_pct === undefined ? '-' : `${fmt(r.loss_pct)}%`}</Text>
                        <View style={{ flex: COLS[9].flex, alignItems: 'center' }}>
                          <View style={[s.pill, { backgroundColor: st.bg }]}><Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text></View>
                        </View>
                      </View>
                      
                    );
                  })}
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
    fBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', paddingHorizontal: 23, paddingTop: 10 },
  dBox: { marginRight: 10, marginBottom: 6 },
  showBtn: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: ACCENT, marginRight: 10, marginBottom: 6 },
  fClear: { marginRight: 10, marginBottom: 6, height: 42, justifyContent: 'center' },

  dLabel: { fontSize: 11.5, fontWeight: '800', color: '#3A3A4A', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4, fontFamily: FONT },
  showText: { color: '#fff', fontSize: 14, fontWeight: '800', marginLeft: 6, fontFamily: FONT },
  fClearText: { color: ACCENT, fontWeight: '800', fontSize: 13, fontFamily: FONT },

});