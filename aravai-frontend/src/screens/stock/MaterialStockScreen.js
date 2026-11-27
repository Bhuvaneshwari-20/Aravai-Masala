import MaterialTraceModal from '../../components/MaterialTraceModal';
import ModalShell from '../../components/ModalShell';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet, Pressable, useWindowDimensions, TextInput, Platform } from 'react-native';
import Svg, { Line, Rect, Path, Circle, Text as SvgText } from 'react-native-svg';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialReceiptModal from '../../components/MaterialReceiptModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, RoundBtn, toneOf, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FilterChips from '../../components/FilterChips';
import { COLORS, fmt, GRADIENT } from '../../theme';
// Material Stock Card page = 2 tabs:
//   Materials - stock card of each material. "Material Receipt" button adds stock (vendor, invoice, material, quantity).
//               Pencil = edit that material's saved receipt (vendor, invoice no, quantity, date fetched into the form), trash = delete
//   Overview  - stock overview of each material (used this month, days of stock, status). Tap -> material trace

const FONT = 'Plus Jakarta Sans, Inter, system-ui, sans-serif';
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('pjs-font')) {
  const l = document.createElement('link');
  l.id = 'pjs-font'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
  document.head.appendChild(l);
}
const HEAD = ['#0B1B2E', '#10253D', '#17406B'];   // navy (same family as the sidebar)
const ACCENT = '#0E7A3E';
const TABS = [
  { value: 'materials', label: 'Materials' },
  { value: 'overview', label: 'Overview' },
];
const STATE = {
  OK: { label: 'OK', color: COLORS.ok, bg: COLORS.okBg },
  LOW: { label: 'LOW', color: COLORS.warn, bg: COLORS.warnBg },
  OUT: { label: 'OUT', color: COLORS.danger, bg: COLORS.dangerBg },
  SOON: { label: 'RUNNING OUT', color: COLORS.warn, bg: COLORS.warnBg },
};

const SORTS = [
  { value: 'name', label: 'Name A-Z' },
  { value: 'urgent', label: 'Most urgent' },
  { value: 'stock_low', label: 'Stock: low to high' },
  { value: 'stock_high', label: 'Stock: high to low' },
  { value: 'days', label: 'Days left' },
  { value: 'used', label: 'Most used' },
];
const STATE_RANK = { OUT: 0, LOW: 1, SOON: 2, OK: 3 };
const inKg = (i) => (String(i.unit).toUpperCase() === 'GRAM' ? i.current_stock / 1000 : i.current_stock);
const sortItems = (items, key) => {
  const a = [...items];
  const byName = (x, y) => String(x.material_name).localeCompare(String(y.material_name));
  switch (key) {
    case 'urgent': return a.sort((x, y) => (STATE_RANK[x.state] - STATE_RANK[y.state]) || byName(x, y));
    case 'stock_low': return a.sort((x, y) => (inKg(x) - inKg(y)) || byName(x, y));
    case 'stock_high': return a.sort((x, y) => (inKg(y) - inKg(x)) || byName(x, y));    case 'days': return a.sort((x, y) => ((x.days_of_stock ?? Infinity) - (y.days_of_stock ?? Infinity)) || byName(x, y)); // no usage = last
    case 'used': return a.sort((x, y) => (y.used_month - x.used_month) || byName(x, y));
    default: return a.sort(byName);
  }
};

/* ---------------------------------------------------------------- Materials tab */
function MaterialsPane({ search, addTick }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const [lowOnly, setLowOnly] = useState(false);
  const [receipt, setReceipt] = useState({ open: false, materialId: null, edit: false }); // edit = opened from a card's pencil (loads that material's saved receipt)
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = usePagedList('/materials', { search: search || undefined, active: 'true', received: 'true', low_stock: lowOnly ? 'true' : undefined }); // received = only materials that have a Material Receipt
  // "Material Receipt" button in the page header
  useEffect(() => { if (addTick > 0) setReceipt({ open: true, materialId: null, edit: false }); }, [addTick]);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));


    // the table pages by itself, so keep fetching until every material is loaded
  useEffect(() => {
    if (list.hasMore && !list.loading && !list.loadingMore) list.loadMore();
  }, [list.items.length, list.hasMore, list.loading, list.loadingMore]);
  const canEdit = can('stock', 'edit');
  const canDelete = can('material', 'delete');
  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/materials/${del.id}`); setDel(null); toast('Material deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };
  const cols = [
    { label: 'S.NO', render: (r, i) => tx(i + 1) },
    { label: 'Material Name', flex: 2, render: (r) => (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[s.td, { fontWeight: '800', color: '#222', flexShrink: 1 }]} numberOfLines={1}>{r.material_name}</Text>
      </View>
    ) },
    { label: 'Material Code', render: (r) => tx(r.material_code) },
    { label: 'Place', render: (r) => tx(r.place || '-') },
    { label: 'Unit', render: (r) => tx(r.unit) },
    { label: 'Current Stock', align: 'right', render: (r) => (
      <View style={{ alignItems: 'flex-end' }}>
        <View style={[s.curPill, { backgroundColor: r.is_low_stock ? COLORS.dangerBg : '#D9F4E3' }]}>
          <Text style={[s.curText, { color: r.is_low_stock ? COLORS.danger : '#1B5E20' }]}>{fmt(r.current_stock)} {String(r.unit).toLowerCase()}</Text>
        </View>
      </View>
    ) },
    { label: 'Stock Status', align: 'center', render: (r) => {
      const t = r.is_low_stock ? { label: 'Low Stock', icon: 'alert-circle', fg: '#B91C1C', bg: '#FEE2E2' } : { label: 'In Stock', icon: 'check-circle-outline', fg: '#15803D', bg: '#DCFCE7' };
      return (
        <View style={{ alignItems: 'center' }}>
          <View style={[s.stPill, { backgroundColor: t.bg }]}><MCI name={t.icon} size={14} color={t.fg} /><Text style={[s.stText, { color: t.fg }]}>{t.label}</Text></View>
        </View>
      );
    } },
    { label: 'Action', align: 'center', render: (r) => (
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        {canEdit && <ActBtn icon="pencil-outline" color="#475569" bg="#F1F5F9" label={`Edit receipt of ${r.material_name}`} onPress={() => setReceipt({ open: true, materialId: r.id, edit: true })} />}
        {canDelete && <ActBtn icon="trash-can-outline" color="#DC2626" bg="#FDEBEC" label={`Delete ${r.material_name}`} onPress={() => setDel(r)} />}
      </View>
    ) },
  ];

    // Low stock view is read-only: no edit / delete buttons
  const shownCols = lowOnly ? cols.filter((c) => c.label !== 'Action') : cols;
  return (
    <View style={{ flex: 1 }}>
      <Container>
        <View style={{ paddingHorizontal: 23 }}>
          <FilterChips value={lowOnly ? 'low' : 'all'} onChange={(v) => setLowOnly(v === 'low')}
            options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }]} />
        </View>
      </Container>
      
            <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}>
            <View style={s.panel}>
              <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, marginHorizontal: -14, marginTop: -14, marginBottom: 14 }} />
              <DataTable columns={shownCols} rows={list.items} empty="No materials found" />
                          </View>
          </ScrollView>
        )}
      </Container>
            <ConfirmDialog visible={!!del} busy={busy} title="Delete material?"
        message={`${del?.material_name || ''} (${del?.material_code || ''}) and its stock entries${Number(del?.current_stock) > 0 ? ` (current stock ${fmt(del.current_stock)} ${del.unit || ''})` : ''} will be permanently deleted. This cannot be undone. A material already used in production or in a recipe cannot be deleted.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
      <MaterialReceiptModal visible={receipt.open} materialId={receipt.materialId} editReceipt={receipt.edit} onDismiss={() => setReceipt({ open: false, materialId: null, edit: false })}
        onSaved={(r) => { setReceipt({ open: false, materialId: null, edit: false }); list.reload(); toast(r.edited ? `Receipt updated. Balance ${fmt(r.closing_stock)} ${r.unit}` : (r.low_stock_alert || `Received. Balance ${fmt(r.closing_stock)} ${r.unit}`)); }} />
    </View>
  );
}

/* ---------------------------------------------------------------- Overview tab */
function Stat({ icon, color, value, label }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: `${color}1A` }]}><MCI name={icon} size={20} color={color} /></View>
      <View><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>
    </View>
  );
}

function OverviewCard({ item, index, onPress }) {
  const st = STATE[item.state] || STATE.OK;
  return (
    <InfoCard index={index} icon="package-variant" color={st.color} value={item.material_name} size="md"
      caption={`${item.material_code} · ${item.category_name}`}
      right={<ChevronDot />} onPress={onPress}
      footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
      <InfoStats items={[
        { label: 'STOCK', value: `${fmt(item.current_stock)} ${item.unit}`, color: item.state === 'OUT' || item.state === 'LOW' ? COLORS.danger : undefined },
        { label: 'USED THIS MONTH', value: `${fmt(item.used_month)} ${item.unit}` },
        { label: 'DAYS OF STOCK', value: item.days_of_stock === null ? '-' : `${item.days_of_stock} days`, color: item.state === 'SOON' ? COLORS.warn : undefined },
        { label: 'ROASTING LOSS', value: item.roast_loss_pct === null ? '-' : `${item.roast_loss_pct}%` },
      ]} />
    </InfoCard>
  );
}

/* ---------------------------------------------------------------- Overview tab (Stock Tracking dashboard) */
const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];
const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const periodFrom = (p) => {
  const d = new Date();
  if (p === 'month') { d.setDate(1); return isoDay(d); }
  if (p === '30') { d.setDate(d.getDate() - 30); return isoDay(d); }
  return undefined; // all time
};
const presetRange = (k) => {
  const to = isoDay(new Date());
  if (k === 'today') return [to, to];
  if (k === '7') { const d = new Date(); d.setDate(d.getDate() - 6); return [isoDay(d), to]; }
  if (k === 'month') { const d = new Date(); d.setDate(1); return [isoDay(d), to]; }
  return ['', ''];
};

const dayLabel = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${pad2(d.getDate())} ${d.toLocaleString('en-US', { month: 'short' })}`; };
const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

// stock ledger of one material -> one point per day (stock in, stock out, closing stock)
const buildSeries = (ledger, from, to) => {
    const byDay = new Map();
  [...(ledger || [])].reverse().forEach((t) => {
    const day = String(t.txn_date).slice(0, 10);
    if (from && day < from) return;
        if (to && day > to) return;
    const e = byDay.get(day) || { day, inn: 0, out: 0, closing: 0 };
    if (t.txn_type !== 'OPENING') e.inn += Number(t.inward_qty) || 0;
    e.out += Number(t.despatch_qty) || 0;
    e.closing = Number(t.closing_stock) || 0;
    byDay.set(day, e);
  });
  return [...byDay.values()];
};

function KpiCard({ icon, color, tint, label, value, sub, subColor }) {
  return (
    <LinearGradient colors={['#FFFFFF', tint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.kpi}>
      <View style={[s.kpiIconBox, { backgroundColor: `${color}22` }]}><MCI name={icon} size={30} color={color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.kpiLabel}>{label}</Text>
        <Text style={s.kpiValue} numberOfLines={1}>{value}</Text>
        <Text style={[s.kpiSub, { color: subColor || COLORS.grey }]} numberOfLines={1}>{sub}</Text>
      </View>
    </LinearGradient>
  );
}
// "% vs last month" text + colour (upGood = true when an increase is good news, e.g. stock in)
const vsLast = (cur, prev, upGood) => {
  if (!prev) return { text: cur > 0 ? 'new this month' : 'no movement', color: COLORS.grey };
  const p = Math.round(((cur - prev) / prev) * 100);
  const good = upGood ? p >= 0 : p <= 0;
  return { text: `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs last month`, color: good ? '#15803D' : '#B91C1C' };
};
const kgOf = (i, qty) => (String(i.unit).toUpperCase() === 'GRAM' ? qty / 1000 : qty);



// Stock alerts: 'low' = at or below the material's minimum stock (or out of stock)
//               'warn' = above the minimum but within ALERT_FACTOR x minimum (minimum 10 kg -> warns from 30 kg down to 10 kg)
const ALERT_FACTOR = 3;
const alertLevel = (i) => {
  const min = Number(i.minimum_stock) || 0;
  const st = Number(i.current_stock) || 0;
  if (st <= 0 || (min > 0 && st <= min)) return 'low';
  if (min > 0 && st <= min * ALERT_FACTOR) return 'warn';
  return null;
};


function Legend({ color, label }) {
  return <View style={s.legend}><View style={[s.legendDot, { backgroundColor: color }]} /><Text style={s.legendText}>{label}</Text></View>;
}

function MovementChart({ rows, unit }) {
  const [w, setW] = useState(0);
  const [hv, setHv] = useState(null); // hovered / tapped day
  const H = 250, L = 56, R = 16, T = 14, B = 36;
  
  const n = rows.length;
  const h = hv !== null && rows[hv] ? hv : null;
  let body = null;
  if (w > 0 && n) {
    const top = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.inn, r.out, r.closing))));
    const pw = w - L - R, ph = H - T - B;
    const x = (i) => L + (pw / n) * (i + 0.5);
    const y = (v) => T + ph - (v / top) * ph;
    const bw = Math.max(3, Math.min(14, pw / n / 3));
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.closing)}`).join(' ');
    const area = `${line} L${x(n - 1)},${T + ph} L${x(0)},${T + ph} Z`;
    const every = Math.max(1, Math.ceil(n / 7));
    body = (
      <>
        <Svg width={w} height={H}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <React.Fragment key={f}>
              <Line x1={L} x2={w - R} y1={y(top * f)} y2={y(top * f)} stroke="#E2D8CE" strokeWidth={1} />
              <SvgText x={L - 8} y={y(top * f) + 5} fontSize={13} fontWeight="700" fontFamily="Inter, Arial, sans-serif" fill={COLORS.text} textAnchor="end">{fmt(top * f)}</SvgText>

            </React.Fragment>
          ))}
          {h !== null && <Rect x={L + (pw / n) * h} y={T} width={pw / n} height={ph} fill="#2563EB" fillOpacity={0.07} />}
          <Path d={area} fill="#2563EB" fillOpacity={0.1} />
          {rows.map((r, i) => (
            <React.Fragment key={r.day}>
              <Rect x={x(i) - bw - 1} y={y(r.inn)} width={bw} height={Math.max(0, T + ph - y(r.inn))} fill="#34C38F" rx={2} />
              <Rect x={x(i) + 1} y={y(r.out)} width={bw} height={Math.max(0, T + ph - y(r.out))} fill="#F46A6A" rx={2} />
              {i % every === 0 || i === n - 1 ? <SvgText x={x(i)} y={H - 10} fontSize={13} fontWeight="700" fontFamily="Inter, Arial, sans-serif" fill={COLORS.text} textAnchor="middle">{dayLabel(r.day)}</SvgText> : null}
                          </React.Fragment>
          ))}
          <Path d={line} stroke="#2563EB" strokeWidth={2} fill="none" />
          {rows.map((r, i) => <Circle key={`c${r.day}`} cx={x(i)} cy={y(r.closing)} r={i === h ? 5.5 : 3.5} fill={i === h ? '#2563EB' : '#fff'} stroke="#2563EB" strokeWidth={2} />)}
        </Svg>

        {/* invisible hover / tap zones, one per day */}
        {rows.map((r, i) => (
          <Pressable key={`z${r.day}`} onHoverIn={() => setHv(i)} onHoverOut={() => setHv(null)} onPress={() => setHv(i === hv ? null : i)}
            style={{ position: 'absolute', left: L + (pw / n) * i, top: T, width: pw / n, height: ph }} />
        ))}

        {h !== null && (
          <View pointerEvents="none" style={[s.tip, { top: T + 4, left: x(h) > w / 2 ? x(h) - 182 : x(h) + 14 }]}>
            <Text style={s.tipDate}>{dayLabel(rows[h].day)}</Text>
            <View style={s.tipRow}><View style={[s.legendDot, { backgroundColor: '#34C38F' }]} /><Text style={s.tipText}>Stock In: <Text style={s.tipVal}>{fmt(rows[h].inn)} {unit}</Text></Text></View>
            <View style={s.tipRow}><View style={[s.legendDot, { backgroundColor: '#F46A6A' }]} /><Text style={s.tipText}>Stock Out: <Text style={s.tipVal}>{fmt(rows[h].out)} {unit}</Text></Text></View>
            <View style={s.tipRow}><View style={[s.legendDot, { backgroundColor: '#2563EB' }]} /><Text style={s.tipText}>Closing: <Text style={s.tipVal}>{fmt(rows[h].closing)} {unit}</Text></Text></View>
          </View>
        )}
      </>
    );
  }
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ minHeight: H, justifyContent: 'center' }}>
      {n ? body : <Text style={s.muted}>No stock movement in this period</Text>}
    </View>
  );
}



/* ---- tabs above the table + generic paged table (Stock In / Out / History) ---- */
const VIEWS = [
  { value: 'overview', label: 'Material Overview', icon: 'view-grid-outline', color: '#0E7A3E' },
  { value: 'in', label: 'Stock In', icon: 'tray-arrow-down', color: '#2563EB' },
  { value: 'out', label: 'Stock Out', icon: 'logout', color: '#DC2626' },
  { value: 'inhist', label: 'Stock In History', icon: 'file-document-outline', color: '#16A34A' },
  { value: 'outhist', label: 'Stock Out History', icon: 'file-document-outline', color: '#DC2626' },
];

// Stock Overview columns: header and rows both use this list, so they always line up
const OV_COLS = [
  { key: 'sno', label: 'S.NO', flex: 0.5 },
  { key: 'name', label: 'Material Name', flex: 1.8 },
  { key: 'code', label: 'Material Code', flex: 1 },
  { key: 'open', label: 'Opening Stock', flex: 1, right: true },
  { key: 'in', label: 'Total Stock In', flex: 1, right: true },
  { key: 'out', label: 'Total Stock Out', flex: 1, right: true },
  { key: 'cur', label: 'Current Stock', flex: 1.1, right: true },
  { key: 'status', label: 'Stock Status', flex: 1.2, center: true },
  { key: 'act', label: 'Action', flex: 0.7, center: true },
];
const ovBox = (c) => ({ flex: c.flex, paddingHorizontal: 4 });
const ovText = (c) => ({ ...ovBox(c), textAlign: c.right ? 'right' : c.center ? 'center' : 'left' });


const fmtDate = (iso) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`); return `${pad2(d.getDate())} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`; };
const tx = (text, extra) => <Text style={[s.td, extra]} numberOfLines={1}>{text}</Text>;
const qtyPill = (text, fg) => <Text style={[s.td, { color: fg, fontWeight: '800' }]} numberOfLines={1}>{text}</Text>;
const COLS_IN = [
  { label: 'S.NO', render: (r, i) => tx(i + 1) },
  { label: 'Last Stock In Date', render: (r) => tx(r.last_in_date ? fmtDate(r.last_in_date) : '-') },
  { label: 'Material Name', render: (r) => tx(r.material_name, { fontWeight: '700' }) },
  { label: 'Material Code', render: (r) => tx(r.material_code) },
  { label: 'Total Stock In', align: 'right', render: (r) => tx(`${fmt(r.total_in)} ${r.unit}`) },
  { label: 'Current Stock', align: 'right', render: (r) => tx(`${fmt(r.current_stock)} ${r.unit}`) },
];
const COLS_OUT = [
  { label: 'S.NO', render: (r, i) => tx(i + 1) },
  { label: 'Last Stock Out Date', render: (r) => tx(r.last_out_date ? fmtDate(r.last_out_date) : '-') },
  { label: 'Material Name', render: (r) => tx(r.material_name, { fontWeight: '700' }) },
  { label: 'Material Code', render: (r) => tx(r.material_code) },
  { label: 'Total Stock Out', align: 'right', render: (r) => tx(`${fmt(r.total_out)} ${r.unit}`) },
  { label: 'Current Stock', align: 'right', render: (r) => tx(`${fmt(r.current_stock)} ${r.unit}`) },
];
const COLS_INHIST = [
  { label: 'S.NO', render: (r, i) => tx(i + 1) },
  { label: 'Stock In Date', render: (r) => tx(fmtDate(r.txn_date)) },
  { label: 'Invoice No', render: (r) => tx(r.grn_no || r.reference_no || '-') },
  { label: 'Material Name', render: (r) => tx(r.material_name, { fontWeight: '700' }) },
  { label: 'Material Code', render: (r) => tx(r.material_code) },
  { label: 'Stock In', align: 'right', render: (r) => qtyPill(`+${fmt(r.inward_qty)} ${r.unit}`, '#15803D', '#DCFCE7') },
  { label: 'Balance', align: 'right', render: (r) => tx(`${fmt(r.closing_stock)} ${r.unit}`) },
  { label: 'Supplier', padL: 28, render: (r) => tx(r.agency_supplier || '-') },
];
const COLS_OUTHIST = [
  { label: 'S.NO', render: (r, i) => tx(i + 1) },
  { label: 'Stock Out Date', render: (r) => tx(fmtDate(r.txn_date)) },
  { label: 'Material Name', render: (r) => tx(r.material_name, { fontWeight: '700' }) },
  { label: 'Material Code', render: (r) => tx(r.material_code) },
  { label: 'Stock Out', align: 'right', render: (r) => qtyPill(`-${fmt(r.despatch_qty)} ${r.unit}`, '#B91C1C', '#FEE2E2') },
  { label: 'Balance', align: 'right', render: (r) => tx(`${fmt(r.closing_stock)} ${r.unit}`) },
  { label: 'Batch', padL: 28, render: (r) => tx(r.batch_no || '-') },
  { label: 'Purpose', flex: 2, render: (r) => {
    const p = r.purpose || '-';
    const text = r.batch_no && r.product_name ? p.replace(r.batch_no, `${r.batch_no} (${r.product_name})`) : p;
    return <Text style={s.td}>{text}</Text>;
  } },
];

function DataTable({ columns, rows, loading, empty }) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [rows.length, pageSize]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, totalPages);
  const slice = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const cell = (c) => ({ flex: c.flex || (c.label === 'S.NO' ? 0.5 : 1), paddingLeft: c.padL || 4, paddingRight: 4 });  
  
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}>
        <View style={{ flex: 1, minWidth: 900 }}>
          <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tHead}>
            {columns.map((c) => <Text key={c.label} numberOfLines={1} style={[s.th, cell(c), { textAlign: c.align || 'left' }]}>{c.label}</Text>)}
          </LinearGradient>
          {loading ? <ActivityIndicator style={{ margin: 30 }} color={COLORS.primary} />
            : rows.length === 0 ? <Text style={[s.muted, { padding: 24 }]}>{empty}</Text>
            : slice.map((r, idx) => (
              <View key={r.id ?? idx} style={s.tRow}>
                {columns.map((c) => {
                  const el = c.render(r, (cur - 1) * pageSize + idx);
                  return React.cloneElement(el, { key: c.label, style: [cell(c), el.props.style, { textAlign: c.align || 'left' }] });
                })}
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
          <Pressable disabled={cur <= 1} onPress={() => setPage(cur - 1)} style={[s.pgBtn, cur <= 1 && s.pgBtnOff]}><MCI name="chevron-left" size={18} color={COLORS.text} /><Text style={s.pgBtnText}>Previous</Text></Pressable>
          <Text style={[s.pgText, { marginHorizontal: 10 }]}>Page {cur} of {totalPages}</Text>
          <Pressable disabled={cur >= totalPages} onPress={() => setPage(cur + 1)} style={[s.pgBtn, cur >= totalPages && s.pgBtnOff]}><Text style={s.pgBtnText}>Next</Text><MCI name="chevron-right" size={18} color={COLORS.text} /></Pressable>
        </View>
      </View>
    </View>
  );
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
        : <TextInput value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" maxLength={10} style={[s.fInput, { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, height: 42, width: 120, paddingHorizontal: 10 }]} />}
    </View>
  );
}


const statusOf = (i) => {
  if (i.state === 'OUT') return { label: 'Out of Stock', icon: 'close-circle', fg: '#B91C1C', bg: '#FEE2E2' };
  if (i.state === 'LOW') return { label: 'Low Stock', icon: 'alert-circle', fg: '#B91C1C', bg: '#FEE2E2' };
  if (i.state === 'SOON' || alertLevel(i) === 'warn') return { label: 'Running Low', icon: 'alert', fg: '#92600A', bg: '#FEF3C7' };
  return { label: 'In Stock', icon: 'check-circle-outline', fg: '#15803D', bg: '#DCFCE7' };
};

function ActBtn({ icon, color, bg, onPress, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginHorizontal: 3 }}>
      <MCI name={icon} size={17} color={color} />
    </Pressable>
  );
}

function Ring({ pct, size = 46, stroke = 6, color = '#16A34A' }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} style={{ marginRight: 10 }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="#E5E7EB" strokeWidth={stroke} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
    </Svg>
  );
}

function HealthStat({ icon, color, value, label }) {
  return (
    <View style={s.healthStat}>
      <View style={[s.healthDot, { backgroundColor: `${color}22` }]}><MCI name={icon} size={24} color={color} /></View>
      <View><Text style={s.healthNum}>{value}</Text><Text style={s.healthLabel}>{label}</Text></View>
    </View>
  );
}

// icon by material name: first matching word wins; anything else falls back to the letter badge
const MAT_ICONS = [
  { re: /chil+i|chilly|mirch/i, icon: 'chili-hot', color: '#DC2626', bg: '#FEE2E2' },
  { re: /pepper|milagu/i, icon: 'seed', color: '#1F2937', bg: '#E5E7EB' },
  { re: /cardamom|elaichi|elakkai/i, icon: 'seed-outline', color: '#15803D', bg: '#DCFCE7' },
  { re: /cinnamon|pattai|dalchini/i, icon: 'bamboo', color: '#92400E', bg: '#FDE9D2' },
  { re: /clove|lavang|kirambu/i, icon: 'flower', color: '#78350F', bg: '#F3E3D3' },
  { re: /turmeric|haldi|manjal/i, icon: 'carrot', color: '#D97706', bg: '#FEF3C7' },
  { re: /ginger|inji|adrak/i, icon: 'sprout', color: '#B45309', bg: '#FDEBD0' },
  { re: /coriander|dhania|malli|curry leaf|mint|fenugreek|methi/i, icon: 'leaf', color: '#16A34A', bg: '#DCFCE7' },
  { re: /cumin|jeera|seeragam|fennel|saunf|mustard|sombu|kadugu|seed/i, icon: 'seed', color: '#A16207', bg: '#FEF3C7' },
  { re: /asafoetida|hing|perungayam/i, icon: 'grain', color: '#CA8A04', bg: '#FEF9C3' },
  { re: /tomato/i, icon: 'food-apple', color: '#DC2626', bg: '#FEE2E2' },
  { re: /rice|wheat|flour|rava|dal|gram/i, icon: 'grain', color: '#B45309', bg: '#FEF3C7' },
];
const matIcon = (name) => MAT_ICONS.find((m) => m.re.test(String(name || '')));

function MaterialIcon({ name }) {
  const m = matIcon(name);
  if (m) return <View style={[s.avatar, { backgroundColor: m.bg }]}><MCI name={m.icon} size={18} color={m.color} /></View>;
  return <View style={s.avatar}><Text style={s.avatarText}>{String(name || '?').charAt(0).toUpperCase()}</Text></View>;
}

function OverviewPane({ search, navigation }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const [period, setPeriod] = useState('all');
    const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selId, setSelId] = useState(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [trace, setTrace] = useState(null);
  const [traceId, setTraceId] = useState(null);
  
  // all-time totals for the cards (ignores From / To)
  const [allSm, setAllSm] = useState(null);
  useEffect(() => {
    api.get('/material-overview/summary', { params: { search: search || undefined } })
      .then((r) => setAllSm(r.data.data.summary))
      .catch(() => {});
  }, [search]);

    const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('overview');
  const [tSearch, setTSearch] = useState('');

  const [alertOpen, setAlertOpen] = useState(false); // stock alerts popup  // each tab keeps its own dates: boxes = what is typed, applied = what "Show" confirmed
  const [boxes, setBoxes] = useState({});
  const [applied, setApplied] = useState({});
  const dFrom = boxes[view]?.from || '';
  const dTo = boxes[view]?.to || '';
  const setDFrom = (v) => setBoxes((d) => ({ ...d, [view]: { ...d[view], from: v } }));
  const setDTo = (v) => setBoxes((d) => ({ ...d, [view]: { ...d[view], to: v } }));
  const showDates = () => setApplied((d) => ({ ...d, [view]: { from: dFrom, to: dTo } }));
  const clearDates = () => { setBoxes((d) => ({ ...d, [view]: {} })); setApplied((d) => ({ ...d, [view]: {} })); };
  useEffect(() => { setPage(1); }, [search, period, pageSize, tSearch]); 
  
  const ranged = view !== 'overview'; 
   const qFrom = ranged && applied[view]?.from ? applied[view].from : periodFrom(period);
  const qTo = ranged && applied[view]?.to ? applied[view].to : undefined;
    const [hist, setHist] = useState({ loading: false, rows: [] });
  useEffect(() => {
    if (view !== 'inhist' && view !== 'outhist') return undefined;
    let alive = true;
    setHist({ loading: true, rows: [] });
    api.get('/material-overview/transactions', { params: { type: view === 'inhist' ? 'IN' : 'OUT', from: qFrom, to: qTo, search: search || undefined } })
      .then((r) => { if (alive) setHist({ loading: false, rows: r.data.data.items || [] }); })
      .catch(() => { if (alive) setHist({ loading: false, rows: [] }); });
    return () => { alive = false; };
  }, [view, qFrom, qTo, search]);
  const reqId = useRef(0);
  const load = useCallback(async (refresh) => {
    const id = ++reqId.current;
    if (refresh) setRefreshing(true);
    try {
      const r = await api.get('/material-overview/summary', { params: { search: search || undefined, from: qFrom, to: qTo } });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
        } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) setRefreshing(false);
  }, [search, qFrom, qTo]);
    useFocusEffect(useCallback(() => { load(); }, [load]));




  const items = data?.items || [];
  const sm = data?.summary;

  const q = tSearch.trim().toLowerCase();
  const hit = (r) => !q || String(r.material_name).toLowerCase().includes(q) || String(r.material_code).toLowerCase().includes(q);
  const tItems = items.filter(hit);
  const totalPages = Math.max(1, Math.ceil(tItems.length / pageSize));
  const curPage = Math.min(page, totalPages);
  
  const pageItems = tItems.slice((curPage - 1) * pageSize, curPage * pageSize);
  const inRows = tItems.filter((i) => i.total_in > 0).sort((a, b) => b.total_in - a.total_in);
  const outRows = tItems.filter((i) => i.total_out > 0).sort((a, b) => b.total_out - a.total_out);
  const histRows = hist.rows.filter(hit);
    const sel = items.find((i) => i.id === selId) || items[0];
  const selectedId = sel?.id;

  if (error && !data) return <Container fill><EmptyView error={error} onRetry={() => load()} /></Container>;
  if (!data) return <Container fill><LoadingView /></Container>;

  const unit = sel?.unit || '';
  const pill = (st) => (st === 'OUT' || st === 'LOW' ? { bg: COLORS.dangerBg, fg: COLORS.danger } : st === 'SOON' ? { bg: COLORS.warnBg, fg: COLORS.warn } : { bg: '#D9F4E3', fg: '#1B5E20' });
  const curView = VIEWS.find((v) => v.value === view);
  const tot = allSm || sm;

    const inStockCount = Math.max(0, (tot.total || 0) - (tot.low || 0) - (tot.out || 0));
  const avail = tot.total ? Math.round((inStockCount / tot.total) * 100) : 0;
    const vsIn = vsLast(sm.in_cur_kg, sm.in_prev_kg, true);
  const vsOut = vsLast(sm.out_cur_kg, sm.out_prev_kg, false);
  const lowCount = sm.low + sm.out;
    const lowItems = items.filter((i) => alertLevel(i) === 'low');
  const warnItems = items.filter((i) => alertLevel(i) === 'warn');
  const topUsed = [...items].filter((i) => i.used_month > 0).sort((a, b) => kgOf(b, b.used_month) - kgOf(a, a.used_month)).slice(0, 5);
  const maxUsed = topUsed.length ? kgOf(topUsed[0], topUsed[0].used_month) : 1;
  return (
    <Container fill>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}>
       
        {/* KPI cards */}
           <View style={s.kpiRow}>
          <KpiCard icon="package-variant" color="#16A34A" tint="#DDF5E6" label="Current Stock" value={`${fmt(tot.stock_kg)} kg`} sub={`${tot.total} materials`} />
          <KpiCard icon="tray-arrow-down" color="#2563EB" tint="#DCE8FD" label="Total Stock In" value={`${fmt(tot.in_kg)} kg`} sub="all time" />
          <KpiCard icon="tray-arrow-up" color="#DC2626" tint="#FDE0E0" label="Total Stock Out" value={`${fmt(tot.out_kg)} kg`} sub="all time" />
          <KpiCard icon="swap-horizontal" color="#D97706" tint="#FFEFC9" label="Transactions" value={fmt(tot.txn_total)} sub="all time" />
          <KpiCard icon="alert-outline" color="#C026D3" tint="#F6E3FA" label="Low Stock" value={String(lowCount)} sub={lowCount > 0 ? 'Needs reorder' : 'All good'} subColor={lowCount > 0 ? '#B91C1C' : '#15803D'} />
        </View>

  {/* material table */}
  
        <View style={s.panel}>
          
          <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, marginHorizontal: -14, marginTop: -14, marginBottom: 14 }} />
               <View style={s.tabsRow}>
            <View style={s.pills}>
                          {VIEWS.map((v) => {
                const on = view === v.value;
                return (
                  <Pressable key={v.value} onPress={() => setView(v.value)} style={[s.tabPill, on && s.tabPillOn]}>
                    <MCI name={v.icon} size={17} color={on ? '#fff' : v.color} />
                    <Text style={[s.tabPillText, on && { color: '#fff' }]}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[s.fSearch, { marginLeft: 0, width: 260 }]}>
              <MCI name="magnify" size={18} color={COLORS.grey} />
              <TextInput value={tSearch} onChangeText={setTSearch} placeholder="Search material / code..." placeholderTextColor={COLORS.grey} style={s.fInput} />
              {tSearch ? <Pressable onPress={() => setTSearch('')}><MCI name="close-circle" size={16} color={COLORS.grey} /></Pressable> : null}
            </View>
          </View>
          {view !== 'overview' && (
            <View style={s.fBar}>
              <DateBox label="From" value={dFrom} onChange={setDFrom} max={dTo || undefined} />
              <DateBox label="To" value={dTo} onChange={setDTo} min={dFrom || undefined} />
              <Pressable onPress={showDates} style={s.showBtn}>
                <MCI name="magnify" size={17} color="#fff" /><Text style={s.showText}>Show</Text>
              </Pressable>
              {(dFrom || dTo) ? <Pressable onPress={clearDates} style={s.fClear}><Text style={s.fClearText}>Clear</Text></Pressable> : null}
            </View>
          )}
          
                              {/* STOCK OVERVIEW (unga existing table, same-a dhaan) */}
          {view === 'overview' && (<>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}>
              <View style={{ flex: 1, minWidth: 900 }}>
                          <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tHead}>
                  {OV_COLS.map((c) => <Text key={c.key} numberOfLines={1} style={[s.th, ovText(c)]}>{c.label}</Text>)}
                </LinearGradient>
                {tItems.length === 0 ? <Text style={[s.muted, { padding: 24 }]}>No materials match</Text> : pageItems.map((i, idx) => {
                  const stt = statusOf(i);
                  const pc = alertLevel(i) === 'warn' && i.state === 'OK' ? { bg: COLORS.warnBg, fg: COLORS.warn } : pill(i.state);
                  const u = String(i.unit).toLowerCase();
                  return (
                    <View key={i.id} style={s.tRow}>
                      <Text style={[s.td, ovText(OV_COLS[0])]}>{(curPage - 1) * pageSize + idx + 1}</Text>
                      <View style={[ovBox(OV_COLS[1]), { flexDirection: 'row', alignItems: 'center' }]}>
                        <Text style={[s.td, { fontWeight: '800', color: '#222', flexShrink: 1 }]} numberOfLines={1}>{i.material_name}</Text>
                      </View>
                      <Text style={[s.td, ovText(OV_COLS[2])]} numberOfLines={1}>{i.material_code}</Text>
                      <Text style={[s.td, ovText(OV_COLS[3])]}>{fmt(i.opening_stock)} {u}</Text>
                      <Text style={[s.td, ovText(OV_COLS[4])]}>{fmt(i.total_in)} {u}</Text>
                      <Text style={[s.td, ovText(OV_COLS[5])]}>{fmt(i.total_out)} {u}</Text>
                      <View style={[ovBox(OV_COLS[6]), { alignItems: 'flex-end' }]}>
                        <View style={[s.curPill, { backgroundColor: pc.bg }]}><Text style={[s.curText, { color: pc.fg }]}>{fmt(i.current_stock)} {u}</Text></View>
                      </View>
                      <View style={[ovBox(OV_COLS[7]), { alignItems: 'center' }]}>
                        <View style={[s.stPill, { backgroundColor: stt.bg }]}><MCI name={stt.icon} size={14} color={stt.fg} /><Text style={[s.stText, { color: stt.fg }]}>{stt.label}</Text></View>
                      </View>
                      <View style={[ovBox(OV_COLS[8]), { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}>
                        <ActBtn icon="eye-outline" color="#2563EB" bg="#E8F0FE" label={`View ${i.material_name}`} onPress={() => setTraceId(i.id)} />
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
            <Text style={s.pgText}>
              {tItems.length ? `Showing ${(curPage - 1) * pageSize + 1} to ${Math.min(curPage * pageSize, tItems.length)} of ${tItems.length} entries` : 'Showing 0 entries'}            </Text>
            <View style={s.pgLeft}>
              <Pressable disabled={curPage <= 1} onPress={() => setPage(curPage - 1)} style={[s.pgBtn, curPage <= 1 && s.pgBtnOff]}><MCI name="chevron-left" size={18} color={COLORS.text} /><Text style={s.pgBtnText}>Previous</Text></Pressable>
              <Text style={[s.pgText, { marginHorizontal: 10 }]}>Page {curPage} of {totalPages}</Text>
              <Pressable disabled={curPage >= totalPages} onPress={() => setPage(curPage + 1)} style={[s.pgBtn, curPage >= totalPages && s.pgBtnOff]}><Text style={s.pgBtnText}>Next</Text><MCI name="chevron-right" size={18} color={COLORS.text} /></Pressable>
            </View>
          </View>
          <Text style={s.unitNote}>Quantities are in each material's own unit (KG / GRAM). KPI cards above are totalled in kg.</Text>
          </>)}

          {/* OTHER TABS */}
                            {view === 'in' && <DataTable columns={COLS_IN} rows={inRows} empty="No stock in for this period" />}
          {view === 'out' && <DataTable columns={COLS_OUT} rows={outRows} empty="No stock out for this period" />}
          {view === 'inhist' && <DataTable columns={COLS_INHIST} rows={histRows} loading={hist.loading} empty="No stock in entries" />}
          {view === 'outhist' && <DataTable columns={COLS_OUTHIST} rows={histRows} loading={hist.loading} empty="No stock out entries" />}
        </View>
      </ScrollView>
      <MaterialTraceModal visible={!!traceId} id={traceId} onDismiss={() => setTraceId(null)} />
      <ModalShell visible={alertOpen} onDismiss={() => setAlertOpen(false)} title="Stock alerts" subtitle={`${lowItems.length + warnItems.length} materials need attention`}
        icon="alert-circle" color="#DC2626" maxWidth={760} noPad>
        <View style={{ padding: 16 }}>
          <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tHead}>
            <Text style={[s.th, ovText({ flex: 0.5 })]}>S.NO</Text>
            <Text style={[s.th, ovText({ flex: 2 })]}>Material Name</Text>
            <Text style={[s.th, ovText({ flex: 1.2 })]}>Material Code</Text>
            <Text style={[s.th, ovText({ flex: 1, right: true })]}>Current Stock</Text>
            <Text style={[s.th, ovText({ flex: 1, right: true })]}>Minimum</Text>
            <Text style={[s.th, ovText({ flex: 1.4, right: true })]}>Status</Text>
          </LinearGradient>
          {[...lowItems.map((i) => ({ i, k: 'low' })), ...warnItems.map((i) => ({ i, k: 'warn' }))].map(({ i, k }, idx) => {
            const st = Number(i.current_stock) || 0;
            const tone = k === 'low' ? { bg: COLORS.dangerBg, fg: COLORS.danger } : { bg: COLORS.warnBg, fg: COLORS.warn };
            const label = st <= 0 ? 'Out of stock' : k === 'low' ? 'Low stock' : 'Running low';
            return (
              <Pressable key={i.id} onPress={() => { setAlertOpen(false); setTraceId(i.id); }}
                style={({ hovered }) => [s.tRow, hovered && { backgroundColor: COLORS.primarySoft }]}>
                <Text style={[s.td, ovText({ flex: 0.5 })]}>{idx + 1}</Text>
                <Text style={[s.td, ovText({ flex: 2 }), { fontWeight: '800', color: '#222' }]} numberOfLines={1}>{i.material_name}</Text>
                <Text style={[s.td, ovText({ flex: 1.2 })]} numberOfLines={1}>{i.material_code}</Text>
                <Text style={[s.td, ovText({ flex: 1, right: true }), { color: tone.fg, fontWeight: '800' }]}>{fmt(st)} {i.unit}</Text>
                <Text style={[s.td, ovText({ flex: 1, right: true })]}>{fmt(i.minimum_stock)} {i.unit}</Text>
                <View style={[ovBox({ flex: 1.4 }), { alignItems: 'flex-end' }]}>
                  <View style={[s.alertPill, { backgroundColor: tone.bg }]}><Text style={[s.alertPillText, { color: tone.fg }]}>{label}</Text></View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ModalShell>   
    </Container>
  );
}

/* ---------------------------------------------------------------- Page */
export default function MaterialStockScreen({ navigation }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('materials');
  const [search, setSearch] = useState('');
  const [addTick, setAddTick] = useState(0);
  const dSearch = useDebounce(search, 400);

  const placeholder = 'Search name / code';
  return (
    <View style={s.wrap}>
      <PageToolbar icon="clipboard-list" title="Material Stock and Tracking" subtitle={tab === 'overview' ? 'Stock overview of every material' : 'Stock of every material'}
        search={search} onSearch={setSearch} placeholder={placeholder}
        addLabel={tab === 'materials' ? 'Material Receipt' : undefined}
        onAdd={tab === 'materials' && can('stock', 'create') ? () => setAddTick((n) => n + 1) : null} />
      <Container><View style={{ paddingHorizontal: 23 }}><FilterChips options={TABS} value={tab} onChange={setTab} /></View></Container>
            {tab === 'materials' && <MaterialsPane search={dSearch} addTick={addTick} />}
      {tab === 'overview' && <OverviewPane search={dSearch} navigation={navigation} />}
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
  sortRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  sortLabel: { fontSize: 12.5, fontWeight: '800', color: COLORS.grey, marginRight: 10 },

  // Overview dashboard
kpiRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 4, marginBottom: 14 },  kpi: { flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#F0E6E6', paddingVertical: 14, paddingHorizontal: 14, margin: 6, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  kpiIconBox: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  kpiLabel: { fontSize: 12.5, fontWeight: '700', color: '#3A3A4A', fontFamily: FONT },
  kpiValue: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginTop: 2, fontFamily: FONT },
  kpiSub: { fontSize: 12, fontWeight: '600', marginTop: 2, fontFamily: FONT },
  health: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', marginHorizontal: 6, marginTop: 6, marginBottom: 12 },
  healthLeft: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 18, minWidth: 260 },
  healthIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  healthTitle: { fontSize: 18, fontWeight: '800', color: '#fff', fontFamily: FONT },
  healthSub: { fontSize: 12, color: '#FBE3E3', fontFamily: FONT },
  healthStat: { flex: 1, minWidth: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: '#F0ECF2' },
  healthDot: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  healthNum: { fontSize: 22, fontWeight: '800', color: COLORS.text, fontFamily: FONT },
  healthLabel: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, fontFamily: FONT },

  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  vTab: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 16, marginRight: 10, marginBottom: 6, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff', outlineStyle: 'none' },
  vTabOn: { backgroundColor: '#9A1C1C', borderColor: '#9A1C1C', shadowColor: '#9A1C1C', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  vTabText: { marginLeft: 8, fontSize: 13.5, fontWeight: '700', color: '#2B2B35', fontFamily: FONT },
    exportBtn: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: ACCENT },

  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FBECEC', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { fontSize: 14, fontWeight: '800', color: ACCENT, fontFamily: FONT },
  stPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999 },
  stText: { fontSize: 12, fontWeight: '800', marginLeft: 5, fontFamily: FONT },  useRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  useName: { width: 110, fontSize: 13.5, fontWeight: '600', color: COLORS.text },
  useTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: COLORS.greyBg, marginHorizontal: 10, overflow: 'hidden' },
  useFill: { height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  useVal: { width: 80, textAlign: 'right', fontSize: 13.5, fontWeight: '700', color: COLORS.text },  midRow: { marginTop: 8, marginBottom: 12 },
  panel: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, overflow: 'hidden' },
  panelTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text, flexShrink: 1, marginRight: 10 },
  picker: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 10, marginBottom: 10 },
  pickIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  pickName: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  pickCode: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey },
  pickList: { maxHeight: 220, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: 10 },
  pickItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12 },
  pickItemText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  sumRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10 },
  sumLabel: { flex: 1, marginLeft: 10, fontSize: 14.5, fontWeight: '600', color: COLORS.text },
  sumVal: { fontSize: 14.5, fontWeight: '700', color: COLORS.text },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft },
  muted: { textAlign: 'center', color: COLORS.grey, fontWeight: '600' },

  // tables (gradient header, plain rows)
  tHead: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10 },
  th: { fontSize: 11.5, fontWeight: '800', color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: FONT },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F0ECF2' },
  td: { fontSize: 13.5, fontWeight: '600', color: '#3A3A4A', fontFamily: FONT },
  num: { flex: 1, textAlign: 'right' },
  curPill: { minWidth: 76, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center' },
  curText: { fontSize: 13.5, fontWeight: '800' },
  unitNote: { fontSize: 11.5, color: COLORS.grey, marginTop: 10 },

  // chart tooltip
  tip: { position: 'absolute', width: 168, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 10, elevation: 4, shadowColor: '#2B1B14', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  tipDate: { fontSize: 13, fontWeight: '900', color: COLORS.text, marginBottom: 6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  tipText: { fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft },
  tipVal: { fontWeight: '900', color: COLORS.text },

  // pager
  pgBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 6 },
  pgLeft: { flexDirection: 'row', alignItems: 'center' },
  pgText: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft, fontFamily: FONT },
  pgBtn: { flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff' },
  pgBtnOff: { opacity: 0.4 },
  pgBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.text, fontFamily: FONT },

  // pill tabs
  vTabs: { marginBottom: 14, flexGrow: 0 },
  vTab: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 16, marginRight: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', outlineStyle: 'none' },
  vTabOn: { backgroundColor: '#E8F0FE', borderColor: '#2563EB' },
  vTabText: { marginLeft: 8, fontSize: 14, fontWeight: '800', color: COLORS.textSoft, fontFamily: FONT },

  // section header (icon + title + "Choose the period.")
  secHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF5F8', marginHorizontal: -14, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3E8EE', marginBottom: 16 },
  secIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFE4EC', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  secTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, fontFamily: FONT },
  secSub: { fontSize: 12.5, fontWeight: '500', color: COLORS.grey, fontFamily: FONT },

  // filter row: From | To | Show | Clear | Search
  fBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 },
    dBox: { marginRight: 10, marginBottom: 6 },
  dLabel: { fontSize: 11.5, fontWeight: '800', color: '#3A3A4A', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4, fontFamily: FONT },
    showBtn: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 18, borderRadius: 12, backgroundColor: ACCENT, marginRight: 10, marginBottom: 6 },
  showText: { color: '#fff', fontSize: 14, fontWeight: '800', marginLeft: 6, fontFamily: FONT },
  fClear: { marginRight: 10, marginBottom: 6, height: 42, justifyContent: 'center' },
    fClearText: { color: ACCENT, fontWeight: '800', fontSize: 13, fontFamily: FONT },
  fSearch: { flexDirection: 'row', alignItems: 'center', width: 300, maxWidth: '100%', height: 42, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff', marginBottom: 6, marginLeft: 'auto' },
    fInput: { flex: 1, fontSize: 14, color: COLORS.text, outlineStyle: 'none', outlineWidth: 0, fontFamily: FONT },

  alertStrip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 6, marginTop: 4, marginBottom: 2 },
  alertText: { flex: 1, marginLeft: 10, fontSize: 13.5, fontWeight: '700', fontFamily: FONT },
  alertBtn: { marginLeft: 12, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#fff' },
  alertBtnText: { fontSize: 13, fontWeight: '800', fontFamily: FONT },
  alertPill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999 },
  alertPillText: { fontSize: 12, fontWeight: '800', fontFamily: FONT },


    tabPill: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 16, marginRight: 10, marginBottom: 6, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', outlineStyle: 'none' },
  tabPillOn: { backgroundColor: '#9A1C1C', borderColor: '#9A1C1C', shadowColor: '#9A1C1C', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  tabPillText: { marginLeft: 8, fontSize: 13.5, fontWeight: '700', color: '#2B2B35', fontFamily: FONT },
});