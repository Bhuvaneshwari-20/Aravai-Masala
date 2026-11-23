import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet, TextInput, Pressable, Platform } from 'react-native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import StockBar from '../../components/StockBar';
import FilterChips from '../../components/FilterChips';
import useLayout from '../../hooks/useLayout';
import { COLORS, RADIUS, SHADOW, fmt, categoryStyle, GRADIENT } from '../../theme';
import { LinearGradient } from 'expo-linear-gradient';
/* ------------------------------------------------------------------ helpers */
const FONT = 'Plus Jakarta Sans, Inter, system-ui, sans-serif';
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('pjs-font')) {
  const l = document.createElement('link');
  l.id = 'pjs-font'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
  document.head.appendChild(l);
}

const num = (x) => Number(x || 0);
const r3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;
const LEDGER_LIMIT = 100; // the API returns at most this many movements

const niceDate = (d) => {
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(t.getTime()) ? String(d).slice(0, 10) : t.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// How each kind of stock movement is shown
const MOVE = {
  OPENING: { label: 'Opening stock', icon: 'flag-outline', color: COLORS.grey, bg: COLORS.greyBg },
  INWARD: { label: 'Received', icon: 'arrow-down-bold-circle', color: COLORS.ok, bg: COLORS.okBg },
  ISSUE: { label: 'Issued', icon: 'arrow-up-bold-circle', color: COLORS.danger, bg: COLORS.dangerBg },
  ADJUSTMENT_IN: { label: 'Correction (added)', icon: 'plus-circle', color: COLORS.warn, bg: COLORS.warnBg },
  ADJUSTMENT_OUT: { label: 'Correction (reduced)', icon: 'minus-circle', color: COLORS.warn, bg: COLORS.warnBg },
};
const ISSUE_KIND = {
  PRODUCTION: { label: 'Issued to production' },
  SAMPLE: { label: 'Issued as sample' },
  WASTAGE: { label: 'Written off as wastage', color: COLORS.warn, bg: COLORS.warnBg },
  RETURN_TO_VENDOR: { label: 'Returned to vendor', color: COLORS.warn, bg: COLORS.warnBg },
  OTHER: { label: 'Issued (other)' },
};

// One ledger row -> label, colour, direction and quantity. Direction comes from which quantity column is filled.
export function describeMove(x) {
  const base = MOVE[x.txn_type] || { label: x.txn_type, icon: 'circle-outline', color: COLORS.grey, bg: COLORS.greyBg };
  const m = x.txn_type === 'ISSUE' && ISSUE_KIND[x.issue_type] ? { ...base, ...ISSUE_KIND[x.issue_type] } : base;
  const inQty = num(x.inward_qty);
  const outQty = num(x.despatch_qty);
  const dir = inQty > 0 ? 'in' : outQty > 0 ? 'out' : 'none';
  return { ...m, dir, qty: dir === 'in' ? inQty : outQty };
}

// Reference / supplier / purpose shown once each, without repeating the batch number that already has its own link
export function moveNote(x) {
  const clean = (p) => (p === null || p === undefined ? '' : String(p).trim());
  // issued to a batch: show the product, the batch and what was done, without repeating the batch number
  if (x.batch_no) {
    const p = clean(x.purpose);
    const prefix = `Batch ${x.batch_no} - `;
    const stage = p.startsWith(prefix) ? p.slice(prefix.length) : (p === `Batch ${x.batch_no}` ? '' : p);
    return [x.product_name ? `Product ${x.product_name}` : '', `Batch ${x.batch_no}`, stage].filter(Boolean).join(' · ');
  }
  const parts = [x.purpose, x.grn_no ? `GRN ${x.grn_no}` : '', x.agency_supplier, x.reference_no]
    .map(clean).filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

// Received - issued does not always equal the stock: vendor returns and stock corrections are not part of "issued".
// The difference is worked out here so the picture always adds up to the real current stock.
export function stockFlow(m, t) {
  const opening = num(t.opening_balance);
  const received = num(t.received_qty);
  const fixIn = num(t.correction_in);
  const issued = num(t.issued);
  const returned = num(t.returned_qty);
  const fixOut = num(t.correction_out);
  const current = num(m.current_stock);
  const totalIn = r3(opening + received + fixIn);
  let gap = r3(current - (totalIn - issued - returned - fixOut)); // should be 0; not 0 means the stock register and history disagree
  if (Math.abs(gap) < EPS) gap = 0;
  return { opening, received, fixIn, issued, returned, fixOut, current, totalIn, gap };
}

/* --------------------------------------------------------------- small parts */
function Kpi({ icon, label, value, unit, sub, tone = COLORS.text, accent, bg, subTone }) {
  return (
    <View style={[s.kpi, accent && { borderTopColor: accent, borderTopWidth: 3 }, bg && { backgroundColor: bg, borderColor: `${accent}33` }]}>
      <View style={s.kpiTop}>
        <Text style={s.kpiLabel}>{label}</Text>
        <MCI name={icon} size={18} color={accent || COLORS.grey} />
      </View>
      <Text style={[s.kpiValue, { color: tone }]}>{value}{!!unit && <Text style={s.kpiUnit}> {unit}</Text>}</Text>
      {!!sub && <Text style={[s.kpiSub, subTone && { color: subTone, fontWeight: '800' }]} numberOfLines={2}>{sub}</Text>}
    </View>
  );
}

function Empty({ icon, text }) {
  return (
    <View style={s.empty}>
      <MCI name={icon} size={30} color={COLORS.border} />
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

function Note({ children }) {
  return <Text style={s.note}>{children}</Text>;
}

function Head({ cols }) {
  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.thead}>
      {cols.map((c) => <Text key={c.key} style={[s.th, { flex: c.flex, textAlign: c.right ? 'right' : 'left' }]}>{c.label}</Text>)}
    </LinearGradient>
  );
}

/* ------------------------------------------------------------------- screen */
// One material: current stock, how it moved, which batches used it and what roasting cost
// the old full page still works; it just uses the shared component
export default function OverviewMaterialScreen({ route }) {
  return <MaterialTrace id={route.params.id} />;
}

// embedded = shown inside a popup (the popup does the scrolling)
export function MaterialTrace({ id, embedded }) {
    const { contentWidth, isPhone } = useLayout();
  const wide = contentWidth >= 760;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [dirFilter, setDirFilter] = useState('all');
  const [search, setSearch] = useState('');
    const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, dirFilter]);   // back to page 1 when searching or switching All / In / Out
  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { setD((await api.get(`/material-overview/materials/${id}`)).data.data); setError(''); setUpdated(new Date()); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [id]);
    useEffect(() => { load(); }, [load]);

  const ledger = useMemo(() => (d ? d.ledger.map((x) => ({ x, mv: describeMove(x) })) : []), [d]);
  const shownLedger = useMemo(() => {
    const unit = d ? d.material.unit : '';
    const term = search.trim().toLowerCase();
    return ledger.filter(({ x, mv }) => {
      if (dirFilter !== 'all' && mv.dir !== dirFilter) return false;
      if (!term) return true;
      const sign = mv.dir === 'in' ? '+' : mv.dir === 'out' ? '-' : '';
      const text = [
        niceDate(x.txn_date), String(x.txn_date).slice(0, 10),            // Date
        mv.label,                                                         // Transaction
        moveNote(x),                                                      // Details
        mv.dir === 'none' ? '' : `${sign}${fmt(mv.qty)} ${unit}`, String(mv.qty),   // Quantity
        `${fmt(x.closing_stock)} ${unit}`, String(x.closing_stock),       // Closing balance
      ].join(' ').toLowerCase();
      return text.includes(term);
    });
  }, [ledger, dirFilter, search, d]);

  if (error && !d) return <EmptyView error={error} onRetry={() => load()} />;
  if (!d) return <LoadingView />;

  const { material: m, totals: t } = d;
  const unit = m.unit;
  const cat = categoryStyle(m.category_name);
  const out = m.current_stock <= 0;
  const low = m.current_stock <= m.minimum_stock;
  const stockColor = low ? COLORS.danger : COLORS.green;
  const flow = stockFlow(m, t);
  const outOther = r3(flow.returned + flow.fixOut);
  const flowTotal = r3(flow.current + flow.issued + outOther);
  const segs = [
    { key: 'stock', label: 'In stock', value: flow.current, color: stockColor },
    { key: 'issued', label: 'Issued', value: flow.issued, color: COLORS.accent },
    { key: 'other', label: 'Returned / corrected out', value: outOther, color: COLORS.grey },
  ];
  const refresh = () => load(true);

  /* ---- Stock history ---- */
  const dateLabel = dirFilter === 'in' ? 'Stock in date' : dirFilter === 'out' ? 'Stock out date' : 'Date';
  const stockCols = [
    { key: 'date', label: dateLabel, flex: 1.3 }, { key: 'type', label: 'Transaction', flex: 1.7 }, { key: 'ref', label: 'Details', flex: 2.2 },
    { key: 'qty', label: 'Quantity', flex: 1.2, right: true }, { key: 'bal', label: 'Closing balance', flex: 1.3, right: true },
  ];

    const totalPages = Math.max(Math.ceil(shownLedger.length / pageSize), 1);
  const curPage = Math.min(page, totalPages);
  const from = (curPage - 1) * pageSize;
  const pageRows = shownLedger.slice(from, from + pageSize);
  const pager = (
    <View style={s.pager}>
      <View style={s.pagerRow}>
        <Text style={s.pagerText}>Show</Text>
        <FilterChips value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} style={{ marginHorizontal: 8 }}
          options={[10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))} />
        <Text style={s.pagerText}>entries</Text>
      </View>
      <View style={s.pagerRow}>
        <Text style={s.pagerText}>{from + 1}-{Math.min(from + pageSize, shownLedger.length)} of {shownLedger.length}</Text>
        <Pressable onPress={() => curPage > 1 && setPage(curPage - 1)} accessibilityLabel="Previous page" style={[s.pageBtn, curPage <= 1 && { opacity: 0.4 }]}>
          <MCI name="chevron-left" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={s.pagerText}>{curPage} / {totalPages}</Text>
        <Pressable onPress={() => curPage < totalPages && setPage(curPage + 1)} accessibilityLabel="Next page" style={[s.pageBtn, curPage >= totalPages && { opacity: 0.4 }]}>
          <MCI name="chevron-right" size={20} color={COLORS.text} />
        </Pressable>
      </View>
    </View>
  );
  const stockTab = (
    <View>
       <View style={[s.tabHead, s.headRow]}>
        <FilterChips value={dirFilter} onChange={setDirFilter} style={{ flexGrow: 1, flexBasis: 240, marginBottom: -4 }}
          options={[
            { value: 'all', label: 'All', count: ledger.length },
            { value: 'in', label: 'Stock in', count: ledger.filter((r) => r.mv.dir === 'in').length },
            { value: 'out', label: 'Stock out', count: ledger.filter((r) => r.mv.dir === 'out').length },
          ]} />
        <View style={[s.searchBox, isPhone ? { flexBasis: '100%' } : { width: 280 }]}>
          <MCI name="magnify" size={18} color={COLORS.grey} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search date, details, quantity..." placeholderTextColor={COLORS.grey} style={s.searchInput} />
          {!!search && (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search" hitSlop={8}>
              <MCI name="close-circle" size={18} color={COLORS.grey} />
            </Pressable>
          )}
        </View>
      </View>
      {shownLedger.length === 0 ? <Empty icon="clipboard-text-outline" text={ledger.length ? 'No movements match your search.' : 'No stock entries yet.'} /> : (
        <View>
          {wide && <Head cols={stockCols} />}
                  {pageRows.map(({ x, mv }) => {
            const note = moveNote(x);
            const sign = mv.dir === 'in' ? '+' : mv.dir === 'out' ? '−' : '';
            const qtyColor = mv.dir === 'in' ? COLORS.ok : mv.dir === 'out' ? COLORS.danger : COLORS.grey;
            const typeCell = (
              <View style={s.typeRow}>
                <View style={[s.dot, { backgroundColor: mv.bg }]}><MCI name={mv.icon} size={16} color={mv.color} /></View>
                <Text style={[s.typeText, { color: mv.color }]} numberOfLines={1}>{mv.label}</Text>
              </View>
            );
            const detail = (
              <View style={{ alignItems: 'flex-start' }}>
                {!!note && <Text style={s.td} numberOfLines={2}>{note}</Text>}
                {!note && <Text style={s.tdMuted}>-</Text>}
              </View>
            );
            if (wide) {
              return (
                <View key={x.id} style={s.tr}>
                  <Text style={[s.td, { flex: 1.1 }]}>{niceDate(x.txn_date)}</Text>
                  <View style={{ flex: 1.7, paddingRight: 8 }}>{typeCell}</View>
                  <View style={{ flex: 2.2, paddingRight: 8 }}>{detail}</View>
                  <Text style={[s.td, s.num, { flex: 1.2, color: qtyColor, fontWeight: '900' }]}>{mv.dir === 'none' ? '-' : `${sign}${fmt(mv.qty)} ${unit}`}</Text>
                  <Text style={[s.td, s.num, { flex: 1.3, fontWeight: '900' }]}>{fmt(x.closing_stock)} {unit}</Text>
                </View>
              );
            }
            return (
              <View key={x.id} style={s.card2}>
                <View style={s.rowBetween}>{typeCell}<Text style={[s.qtyBig, { color: qtyColor }]}>{mv.dir === 'none' ? '-' : `${sign}${fmt(mv.qty)} ${unit}`}</Text></View>
                <View style={[s.rowBetween, { marginTop: 6 }]}>
                  <Text style={s.tdMuted}>{niceDate(x.txn_date)}</Text>
                  <Text style={s.tdMuted}>Balance <Text style={s.strong}>{fmt(x.closing_stock)} {unit}</Text></Text>
                </View>
                {!!note && <View style={{ marginTop: 6 }}>{detail}</View>}
              </View>
            );
          })}
        </View>
      )}
            {shownLedger.length > 0 && pager}
      {ledger.length >= LEDGER_LIMIT && <Note>Showing the latest {LEDGER_LIMIT} movements. Totals above include everything.</Note>}
    </View>
  );

  const Wrap = embedded ? View : ScrollView;
  const wrapProps = embedded ? {} : {
    style: s.wrap, contentContainerStyle: { paddingBottom: 60 },
    refreshControl: <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[COLORS.primary]} />,
  };
  return (
    <Wrap {...wrapProps}>
      <Container>
        {/* identity */}
        <View style={[s.card, s.headCard]}>
          <View style={[s.avatar, { backgroundColor: `${cat.color}14` }]}><Text style={s.avatarIcon}>{cat.icon}</Text></View>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Text style={s.title} numberOfLines={2}>{m.material_name}</Text>
            <View style={s.metaRow}>
              <View style={s.metaChip}><MCI name="barcode" size={14} color={COLORS.grey} /><Text style={s.metaText}>{m.material_code}</Text></View>
              <View style={s.metaChip}><MCI name="shape-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{m.category_name}</Text></View>
              {!!m.place && <View style={s.metaChip}><MCI name="map-marker-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{m.place}</Text></View>}
            </View>
          </View>
          <View style={s.headRight}>
            <Badge tone={out ? 'danger' : low ? 'warn' : 'ok'} text={out ? 'Out of stock' : low ? 'Low stock' : 'In stock'} />
            <PressableScale to={0.95} hover={1.03} onPress={refresh} style={s.refresh}>
              <MCI name="refresh" size={15} color={COLORS.primary} />
              <Text style={s.refreshText}>{refreshing ? 'Updating' : updated ? `Open at ${updated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}</Text>
            </PressableScale>
          </View>
        </View>

        {/* key numbers */}
        <View style={s.kpis}>
          <Kpi icon="warehouse" accent="#16A34A" bg="#E8F8EE" label="Available stock" value={fmt(m.current_stock)} unit={unit} tone={low ? COLORS.danger : COLORS.text}
            sub={`Minimum ${fmt(m.minimum_stock)} ${unit}${out ? ' · out of stock' : low ? ' · reorder now' : ''}`} subTone={low ? COLORS.danger : undefined} />
          <Kpi icon="flag-outline" accent="#7C3AED" bg="#F1EAFE" label="Opening stock" value={fmt(flow.opening)} unit={unit} sub="Balance before the first entry" />
          <Kpi icon="arrow-down-bold-circle-outline" accent="#2563EB" bg="#E8F0FE" label="Total received" value={fmt(flow.received)} unit={unit}
            sub={flow.fixIn > 0 ? `From vendors · plus ${fmt(flow.fixIn)} ${unit} added by corrections` : 'Material receipts from vendors'} />
          <Kpi icon="arrow-up-bold-circle-outline" accent="#DC2626" bg="#FDEBEC" label="Total issued" value={fmt(flow.issued)} unit={unit} sub="Production, samples, wastage" />          
           </View>

        

        {/* stock movement */}
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          <View style={s.secRow}>
            <Text style={s.sec}>Stock movement</Text>
<Text style={s.secSide}>{shownLedger.length} entr{shownLedger.length === 1 ? 'y' : 'ies'}</Text>
          </View>
          <View style={{ padding: isPhone ? 12 : 16 }}>{stockTab}</View>
        </View>
        </Container>
    </Wrap>
  );
}

/* ------------------------------------------------------------------- styles */
const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: COLORS.surface, marginHorizontal: 12, marginTop: 12, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, ...SHADOW.sm },
  headCard: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  avatar: { width: 56, height: 56, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarIcon: { fontSize: 28 },
  title: { fontSize: 24, fontWeight: '900', color: COLORS.text },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginRight: -8 },
  metaChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8, marginBottom: 4 },
  metaText: { fontSize: 12.5, fontWeight: '700', color: COLORS.textSoft, marginLeft: 5 },
  headRight: { alignItems: 'flex-end', marginLeft: 'auto' },
  refresh: { flexDirection: 'row', alignItems: 'center', marginTop: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 10, paddingVertical: 5 },
  refreshText: { fontSize: 12, fontWeight: '800', color: COLORS.primary, marginLeft: 5 },

  kpis: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, marginTop: 6 },
  kpi: { flexGrow: 1, flexBasis: 170, minWidth: 150, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 14, margin: 6, ...SHADOW.sm },
  kpiTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiLabel: { fontSize: 12.5, fontWeight: '800', color: COLORS.grey },
  kpiValue: { fontSize: 26, fontWeight: '900', marginTop: 6, fontVariant: ['tabular-nums'] },
  kpiUnit: { fontSize: 14, fontWeight: '800', color: COLORS.grey },
  kpiSub: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 4 },

  sec: { fontSize: 15, fontWeight: '900', color: COLORS.text },
  secSide: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey },
  stack: { flexDirection: 'row', height: 18, borderRadius: 9, overflow: 'hidden', marginTop: 14 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 28, marginBottom: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendLabel: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  legendVal: { fontSize: 15, fontWeight: '900', color: COLORS.text, fontVariant: ['tabular-nums'] },
  legendPct: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  gauge: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.line },
  gaugeLabel: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey },
  gaugeHint: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 6 },

  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabHead: { marginBottom: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
 
    pager: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  pagerRow: { flexDirection: 'row', alignItems: 'center' },
  pagerText: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey },
  pageBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface, paddingHorizontal: 12, marginLeft: 8 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13.5, fontWeight: '600', color: COLORS.text, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) },

  thead: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10 },
  th: { fontSize: 11.5, fontWeight: '800', color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: FONT },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F0ECF2' },
  td: { fontSize: 13.5, fontWeight: '600', color: '#3A3A4A', paddingRight: 8, fontFamily: FONT },
tdMuted: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, fontFamily: FONT },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '900', color: COLORS.text },
  typeRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
 typeText: { fontSize: 14, fontWeight: '900', color: COLORS.text, flexShrink: 1, fontFamily: FONT },
   dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyBig: { fontSize: 15, fontWeight: '900', color: COLORS.text, marginLeft: 10, fontVariant: ['tabular-nums'] },
  card2: { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: COLORS.line },



  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyText: { fontSize: 13.5, fontWeight: '600', color: COLORS.grey, marginTop: 8, textAlign: 'center' },
  note: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 12 },
});