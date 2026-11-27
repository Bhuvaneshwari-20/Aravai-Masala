import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Platform, RefreshControl, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useUi } from '../../ui';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import SelectField from '../../components/SelectField';
import SalesDetailModal from '../../components/SalesDetailModal';
import Badge from '../../components/Badge';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { KpiGrid } from '../../components/SalesBits';
import { printHtml } from '../../printDoc';
import useLayout from '../../hooks/useLayout';
import printInvoice from './printInvoice';
import { monthOf, monthStart, monthEnd, shiftMonth } from './salesUtils';
import { COLORS, SHADOW, fmt, money } from '../../theme';

// Sales History: filters -> KPI cards -> invoice table (view / print per row) -> page numbers.
//   GET /sales?from&to&customer_id&status&page&limit -> { items, total, total_pages, summary }
const PAGE_SIZE = 10;
const ALL = null;
const TABS = [
  { value: 'all', label: 'All Invoices' },
  { value: 'month', label: 'This Month' },
  { value: 'last', label: 'Last Month' },
  { value: 'year', label: 'This Year' },
];
const STATUS = [
  { value: ALL, label: 'All Status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const tabDates = (k) => {
  const cur = monthOf();
  if (k === 'month') return { from: monthStart(cur), to: monthEnd(cur) };
  if (k === 'last') { const l = shiftMonth(cur, -1); return { from: monthStart(l), to: monthEnd(l) }; }
  if (k === 'year') { const y = new Date().getFullYear(); return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  return { from: '', to: '' };
};
const dmy = (d) => { if (!d) return '-'; const [y, m, x] = String(d).slice(0, 10).split('-'); return `${x}-${m}-${y}`; };
const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const m2 = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statusOf = (r) => (r.status === 'CANCELLED' ? { tone: 'danger', text: 'Cancelled' } : { tone: 'ok', text: 'Active' });

// date input: native date picker on web, typed YYYY-MM-DD elsewhere
function DateBox({ label, value, onChange }) {
  return (
    <View style={s.fieldBox}>
      <Text style={s.fLabel}>{label}</Text>
      {Platform.OS === 'web'
        ? React.createElement('input', {
          type: 'date', value: value || '', onChange: (e) => onChange(e.target.value || ''),
          style: { width: '100%', height: 44, boxSizing: 'border-box', padding: '0 12px', fontSize: 14.5, fontFamily: 'inherit', fontWeight: 600, color: COLORS.text, backgroundColor: '#fff', borderRadius: 12, outline: 'none', border: `1.5px solid ${COLORS.border}` },
        })
        : <TextInput value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" maxLength={10} style={s.nativeDate} placeholderTextColor="#B5ABA3" />}
    </View>
  );
}

function Btn({ icon, label, onPress, filled, tone = COLORS.primary, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered, pressed }) => [s.btn, { borderColor: tone }, filled && { backgroundColor: tone }, hovered && !filled && { backgroundColor: `${tone}12` }, disabled && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}>
      <MCI name={icon} size={18} color={filled ? '#fff' : tone} />
      <Text style={[s.btnText, { color: filled ? '#fff' : tone }]}>{label}</Text>
    </Pressable>
  );
}

export default function SalesHistoryScreen() {
  const { toast } = useUi();
  const { isWide, isPhone, pad } = useLayout();
  const [tab, setTab] = useState('all');
  // draft = what is typed in the filter boxes; applied = what the table uses (Search button copies draft -> applied)
  const [draft, setDraft] = useState({ ...tabDates('all'), customerId: ALL, status: ALL });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, total_pages: 1, summary: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  const first = useRef(true);

  useEffect(() => { api.get('/sales/lookups').then((r) => setCustomers(r.data.data.customers || [])).catch(() => {}); }, []);
  const customerOptions = [{ value: ALL, label: 'All Customers' }, ...customers.map((c) => ({ value: c.id, label: c.name }))];

  const query = useCallback((f) => ({
    from: f.from || undefined, to: f.to || undefined, customer_id: f.customerId || undefined, status: f.status || 'ALL',
  }), []);

  const load = useCallback(async (mode) => {
    const id = ++reqId.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await api.get('/sales', { params: { ...query(applied), page, limit: PAGE_SIZE } });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) { setLoading(false); setRefreshing(false); }
  }, [applied, page, query]);

  useEffect(() => { load('initial'); }, [load]);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } load('silent'); }, [load]));

  const search = () => {
    if (draft.from && draft.to && draft.from > draft.to) return toast('From date is after the To date');
    setTab(null); setPage(1); setApplied(draft);
    return undefined;
  };
  const reset = () => { const d = { ...tabDates('all'), customerId: ALL, status: ALL }; setTab('all'); setDraft(d); setApplied(d); setPage(1); };
  const pickTab = (k) => { const d = { ...draft, ...tabDates(k) }; setTab(k); setDraft(d); setApplied(d); setPage(1); };

  // every row of the current filter (for Export / Print)
  const fetchAll = async () => {
    const rows = [];
    for (let p = 1; p <= 200; p += 1) {
      const d = (await api.get('/sales', { params: { ...query(applied), page: p, limit: 100 } })).data.data;
      rows.push(...d.items);
      if (p >= d.total_pages) break;
    }
    return rows;
  };

  const exportExcel = async () => {
    if (Platform.OS !== 'web') return toast('Export is available in the web app');
    setBusy(true);
    try {
      const rows = await fetchAll();
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['#', 'Invoice No', 'Date', 'Customer / Agency', 'Items', 'Packs', 'Gross (Rs)', 'Returns (Rs)', 'Net Amount (Rs)', 'Status'];
      const lines = rows.map((r, i) => [i + 1, r.invoice_no, dmy(r.sale_date), r.customer_name, r.item_count, r.total_packs, r.total_amount, r.returned_amount, r.net_amount, statusOf(r).text].map(q).join(','));
      const blob = new Blob([`﻿${[head.map(q).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `Sales-History-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
    return undefined;
  };

  const printList = async () => {
    if (Platform.OS !== 'web') return toast('Printing is available in the web app');
    setBusy(true);
    try {
      const rows = await fetchAll();
      const tr = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.invoice_no)}</td><td>${esc(dmy(r.sale_date))}</td><td>${esc(r.customer_name)}</td>`
        + `<td class="r">${fmt(r.item_count)}</td><td class="r">${fmt(r.total_packs)}</td><td class="r">${m2(r.total_amount)}</td><td class="r">${m2(r.returned_amount)}</td><td class="r">${m2(r.net_amount)}</td><td>${statusOf(r).text}</td></tr>`).join('');
      const period = applied.from || applied.to ? `${dmy(applied.from)} to ${dmy(applied.to)}` : 'All dates';
      const body = `<div class="head"><div class="co">ARAVAI MASALA<small>Sales History</small></div><div class="doc"><b>SALES INVOICES</b><div>${esc(period)}</div></div></div>`
        + `<table><tr><th>#</th><th>Invoice No</th><th>Date</th><th>Customer / Agency</th><th class="r">Items</th><th class="r">Packs</th><th class="r">Gross (₹)</th><th class="r">Returns (₹)</th><th class="r">Net (₹)</th><th>Status</th></tr>${tr}</table>`;
      if (!printHtml('Sales-History', body)) toast('Printing is available in the web app');
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
    return undefined;
  };

  const printOne = async (id) => {
    try { if (!(await printInvoice(id))) toast('Printing is available in the web app'); } catch (e) { toast(errMsg(e)); }
  };

  const sum = data.summary || {};
  const kpis = [
    { icon: 'file-document-outline', color: '#2E9E5B', value: fmt(sum.invoices), label: 'Total Invoices' },
    { icon: 'package-variant-closed', color: '#2F7DE1', value: fmt(sum.packs), label: 'Total Packs' },
    { icon: 'currency-inr', color: '#F2A900', value: money(sum.gross), label: 'Gross Sales' },
    { icon: 'keyboard-return', color: COLORS.danger, value: money(sum.returns), label: 'Total Returns' },
    { icon: 'trending-up', color: '#7C3AED', value: money(sum.net), label: 'Net Sales' },
  ];

  const total = data.total || 0;
  const pages = Math.max(data.total_pages || 1, 1);
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const nums = [];
  for (let p = 1; p <= pages; p += 1) if (p === 1 || p === pages || Math.abs(p - page) <= 1 || (page <= 3 && p <= 4)) nums.push(p);
  const pageBtns = [];
  nums.forEach((p, i) => { if (i && p - nums[i - 1] > 1) pageBtns.push('…'); pageBtns.push(p); });

  const COL = { no: 44, inv: 150, date: 110, cust: 230, items: 70, packs: 80, gross: 120, ret: 110, net: 130, st: 130, act: 96 };
  const tableMin = Object.values(COL).reduce((a, b) => a + b, 0);
  const Th = ({ w, children, right, center }) => <Text style={[s.th, { width: w }, right && { textAlign: 'right' }, center && { textAlign: 'center' }]}>{children}</Text>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}>
      <PageToolbar icon="history" title="Sales History" subtitle="View, search and manage all sales invoices." hideSearch />
      <Container>
        {/* filters */}
        <View style={[s.card, SHADOW.sm, { marginHorizontal: pad }]}>
          <View style={[s.filterRow, !isWide && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <DateBox label="From Date" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
            <DateBox label="To Date" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
            <View style={[s.fieldBox, { flex: 1.4 }]}>
              <SelectField label="Customer / Agency" value={draft.customerId} options={customerOptions} onChange={(v) => setDraft((d) => ({ ...d, customerId: v }))} />
            </View>
            <View style={s.fieldBox}>
              <SelectField label="Status" value={draft.status} options={STATUS} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
            </View>
            <View style={s.filterBtns}>
              <Btn icon="magnify" label="Search" filled onPress={search} />
              <Btn icon="refresh" label="Reset" onPress={reset} />
            </View>
          </View>
        </View>

        {/* KPI cards */}
        <View style={{ marginTop: 12 }}><KpiGrid items={kpis} min={190} phoneMin={150} /></View>

        {/* table */}
        <View style={[s.card, SHADOW.sm, { marginHorizontal: pad, marginTop: 12 }]}>
          <View style={[s.tableTop, isPhone && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={s.tabs}>
              {TABS.map((t) => (
                <Pressable key={t.value} onPress={() => pickTab(t.value)} style={[s.tab, tab === t.value && s.tabOn]}>
                  <Text style={[s.tabText, tab === t.value && { color: '#fff' }]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.topBtns}>
              <Btn icon="file-excel-outline" label="Export Excel" tone={COLORS.ok} onPress={exportExcel} disabled={busy} />
              <Btn icon="printer-outline" label="Print" onPress={printList} disabled={busy} />
            </View>
          </View>

          {loading ? <LoadingView rows={5} /> : error && !data.items.length ? <EmptyView error={error} onRetry={() => load('initial')} /> : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View style={{ minWidth: tableMin }}>
                  <View style={s.thead}>
                    <Th w={COL.no}>#</Th><Th w={COL.inv}>Invoice No</Th><Th w={COL.date}>Date</Th><Th w={COL.cust}>Customer / Agency</Th>
                    <Th w={COL.items} right>Items</Th><Th w={COL.packs} right>Packs</Th><Th w={COL.gross} right>Gross (₹)</Th>
                    <Th w={COL.ret} right>Returns (₹)</Th><Th w={COL.net} right>Net Amount (₹)</Th><Th w={COL.st}>Status</Th><Th w={COL.act} center>Action</Th>
                  </View>
                  {data.items.length === 0 && <EmptyView icon="🧾" message="No sales found for these filters" />}
                  {data.items.map((r, i) => {
                    const st = statusOf(r);
                    return (
                      <View key={r.id} style={[s.tr, i % 2 === 1 && { backgroundColor: '#FCFAF7' }]}>
                        <Text style={[s.td, { width: COL.no }]}>{(page - 1) * PAGE_SIZE + i + 1}</Text>
                        <Pressable style={{ width: COL.inv }} onPress={() => setDetailId(r.id)}><Text style={[s.td, s.link]} numberOfLines={1}>{r.invoice_no}</Text></Pressable>
                        <Text style={[s.td, { width: COL.date }]}>{dmy(r.sale_date)}</Text>
                        <Text style={[s.td, { width: COL.cust }]} numberOfLines={1}>{r.customer_name}</Text>
                        <Text style={[s.td, s.num, { width: COL.items }]}>{fmt(r.item_count)}</Text>
                        <Text style={[s.td, s.num, { width: COL.packs }]}>{fmt(r.total_packs)}</Text>
                        <Text style={[s.td, s.num, { width: COL.gross }]}>{m2(r.total_amount)}</Text>
                        <Text style={[s.td, s.num, { width: COL.ret }]}>{m2(r.returned_amount)}</Text>
                        <Text style={[s.td, s.num, { width: COL.net, fontWeight: '800' }]}>{m2(r.net_amount)}</Text>
                        <View style={{ width: COL.st }}><Badge tone={st.tone} text={st.text} /></View>
                        <View style={[s.actions, { width: COL.act }]}>
                          <Pressable onPress={() => setDetailId(r.id)} hitSlop={8} accessibilityLabel="View invoice" style={s.actBtn}><MCI name="eye-outline" size={20} color={COLORS.text} /></Pressable>
                          <Pressable onPress={() => printOne(r.id)} hitSlop={8} accessibilityLabel="Print invoice" style={s.actBtn}><MCI name="printer-outline" size={20} color={COLORS.text} /></Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={[s.footer, isPhone && { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={s.showing}>{`Showing ${from} to ${to} of ${fmt(total)} entries`}</Text>
                <View style={s.pager}>
                  <PageBtn icon="chevron-double-left" disabled={page <= 1} onPress={() => setPage(1)} />
                  <PageBtn icon="chevron-left" disabled={page <= 1} onPress={() => setPage(page - 1)} />
                  {pageBtns.map((p, i) => (p === '…'
                    ? <Text key={`g${i}`} style={s.gap}>…</Text>
                    : <Pressable key={p} onPress={() => setPage(p)} style={[s.pg, p === page && s.pgOn]}><Text style={[s.pgText, p === page && { color: '#fff' }]}>{p}</Text></Pressable>))}
                  <PageBtn icon="chevron-right" disabled={page >= pages} onPress={() => setPage(page + 1)} />
                  <PageBtn icon="chevron-double-right" disabled={page >= pages} onPress={() => setPage(pages)} />
                </View>
              </View>
            </>
          )}
        </View>
      </Container>
      <SalesDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
    </ScrollView>
  );
}

function PageBtn({ icon, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.pg, { backgroundColor: 'transparent' }, disabled && { opacity: 0.35 }]}>
      <MCI name={icon} size={20} color={COLORS.textSoft} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  filterRow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldBox: { flex: 1, minWidth: 150, marginRight: 12, marginBottom: 4 },
  fLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  nativeDate: { height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 12, fontWeight: '600', color: COLORS.text, backgroundColor: '#fff' },
  filterBtns: { flexDirection: 'row', marginBottom: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 44, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1.5, marginRight: 10, backgroundColor: '#fff' },
  btnText: { fontWeight: '800', fontSize: 14, marginLeft: 7 },
  tableTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 4, marginBottom: 6 },
  tab: { paddingHorizontal: 16, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: COLORS.primaryDark },
  tabText: { fontWeight: '800', fontSize: 14, color: COLORS.text },
  topBtns: { flexDirection: 'row', marginBottom: 6 },
  thead: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 10, height: 46, paddingHorizontal: 8 },
  th: { fontSize: 13, fontWeight: '800', color: COLORS.text, paddingHorizontal: 8 },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  td: { fontSize: 13.5, color: COLORS.text, paddingHorizontal: 8 },
  num: { textAlign: 'right' },
  link: { fontWeight: '800', color: COLORS.primary },
  actions: { flexDirection: 'row', justifyContent: 'center' },
  actBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.greyBg, marginHorizontal: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 14 },
  showing: { fontSize: 13.5, color: COLORS.text, marginBottom: 6 },
  pager: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pg: { minWidth: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginHorizontal: 3, backgroundColor: COLORS.greyBg },
  pgOn: { backgroundColor: COLORS.primaryDark },
  pgText: { fontWeight: '800', color: COLORS.text },
  gap: { marginHorizontal: 6, color: COLORS.grey, fontWeight: '800' },
});