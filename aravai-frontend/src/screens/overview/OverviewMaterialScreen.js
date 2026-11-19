import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from 'react-native';
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
import { COLORS, RADIUS, SHADOW, fmt, categoryStyle } from '../../theme';

/* ------------------------------------------------------------------ helpers */
const num = (x) => Number(x || 0);
const r3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;
const LEDGER_LIMIT = 100; // the API returns at most this many movements
const LIST_LIMIT = 50; // ...and at most this many batches / roasting entries

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
  const parts = [x.purpose, x.grn_no ? `GRN ${x.grn_no}` : '', x.agency_supplier, x.reference_no === x.batch_no ? '' : x.reference_no]
    .map((p) => (p === null || p === undefined ? '' : String(p).trim())).filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

// Received - issued does not always equal the stock: vendor returns and stock corrections are not part of "issued".
// The difference is worked out here so the picture always adds up to the real current stock.
export function stockFlow(m, t) {
  const received = num(t.received);
  const issued = num(t.issued);
  const current = num(m.current_stock);
  let other = r3(current - (received - issued));
  if (Math.abs(other) < EPS) other = 0;
  return { received, issued, current, other };
}

// Share of the total used by one batch, 0-100
export const sharePct = (qty, total) => (total > 0 ? Math.round((num(qty) / total) * 1000) / 10 : 0);

/* --------------------------------------------------------------- small parts */
function Kpi({ icon, label, value, unit, sub, tone = COLORS.text, accent, subTone }) {
  return (
    <View style={[s.kpi, accent && { borderTopColor: accent, borderTopWidth: 3 }]}>
      <View style={s.kpiTop}>
        <Text style={s.kpiLabel}>{label}</Text>
        <MCI name={icon} size={18} color={accent || COLORS.grey} />
      </View>
      <Text style={[s.kpiValue, { color: tone }]}>{value}{!!unit && <Text style={s.kpiUnit}> {unit}</Text>}</Text>
      {!!sub && <Text style={[s.kpiSub, subTone && { color: subTone, fontWeight: '800' }]} numberOfLines={2}>{sub}</Text>}
    </View>
  );
}

function Mini({ label, value, tone }) {
  return (
    <View style={s.mini}>
      <Text style={s.miniLabel}>{label}</Text>
      <Text style={[s.miniValue, tone && { color: tone }]}>{value}</Text>
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
    <View style={s.thead}>
      {cols.map((c) => <Text key={c.key} style={[s.th, { flex: c.flex, textAlign: c.right ? 'right' : 'left' }]}>{c.label}</Text>)}
    </View>
  );
}

function BatchChip({ no, onPress }) {
  return (
    <PressableScale to={0.97} onPress={onPress} style={s.chip}>
      <MCI name="link-variant" size={13} color={COLORS.primary} />
      <Text style={s.chipText}>{no}</Text>
    </PressableScale>
  );
}

function tabButton(t, on, onPress) {
  return (
    <Pressable key={t.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={({ hovered }) => [s.tab, on && s.tabOn, !on && hovered && s.tabHover]}>
      <MCI name={t.icon} size={17} color={on ? COLORS.primary : COLORS.grey} />
      <Text style={[s.tabText, on && { color: COLORS.primary }]}>{t.label}</Text>
      <View style={[s.tabCount, on && { backgroundColor: COLORS.primarySoft }]}>
        <Text style={[s.tabCountText, on && { color: COLORS.primary }]}>{t.count}</Text>
      </View>
    </Pressable>
  );
}

const STATUS_TONE = (v) => (/complet|done|closed|packed/i.test(v || '') ? 'ok' : /cancel|reject/i.test(v || '') ? 'danger' : 'grey');
const pretty = (v) => String(v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/* ------------------------------------------------------------------- screen */
// One material: current stock, how it moved, which batches used it and what roasting cost
export default function OverviewMaterialScreen({ route, navigation }) {
  const { id } = route.params;
  const { contentWidth, isPhone } = useLayout();
  const wide = contentWidth >= 760;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [tab, setTab] = useState('stock');
  const [dirFilter, setDirFilter] = useState('all');

  const load = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    try { setD((await api.get(`/material-overview/materials/${id}`)).data.data); setError(''); setUpdated(new Date()); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ledger = useMemo(() => (d ? d.ledger.map((x) => ({ x, mv: describeMove(x) })) : []), [d]);
  const shownLedger = useMemo(() => ledger.filter((r) => dirFilter === 'all' || r.mv.dir === dirFilter), [ledger, dirFilter]);

  if (error && !d) return <EmptyView error={error} onRetry={() => load()} />;
  if (!d) return <LoadingView />;

  const { material: m, totals: t } = d;
  const unit = m.unit;
  const cat = categoryStyle(m.category_name);
  const out = m.current_stock <= 0;
  const low = m.current_stock <= m.minimum_stock;
  const stockColor = low ? COLORS.danger : COLORS.green;
  const flow = stockFlow(m, t);
  const flowTotal = flow.current + flow.issued + Math.max(-flow.other, 0);
  const segs = [
    { key: 'stock', label: 'In stock', value: flow.current, color: stockColor },
    { key: 'issued', label: 'Issued', value: flow.issued, color: COLORS.accent },
    { key: 'other', label: 'Returns and corrections', value: Math.max(-flow.other, 0), color: COLORS.grey },
  ];
  const openBatch = (batchId) => batchId && navigation.navigate('OverviewBatch', { id: batchId });
  const refresh = () => load(true);

  const batchesCapped = d.batches.length >= LIST_LIMIT;
  const roastCapped = d.roasting.length >= LIST_LIMIT;
  const batchTotal = d.batches.reduce((a, b) => a + num(b.qty), 0);
  const maxBatch = d.batches.reduce((a, b) => Math.max(a, num(b.qty)), 0);
  const roastOut = r3(Math.max(num(t.roast_input_kg) - num(t.roast_loss_kg), 0));
  const limit = num(t.roast_loss_limit) || 12;

  const tabs = [
    { key: 'stock', label: 'Stock history', icon: 'swap-vertical', count: ledger.length },
    { key: 'batch', label: 'Batch tracking', icon: 'package-variant-closed', count: `${t.batch_count}${batchesCapped ? '+' : ''}` },
    { key: 'roast', label: 'Roasting loss', icon: 'fire', count: t.roast_entries },
  ];

  /* ---- Stock history ---- */
  const stockCols = [
    { key: 'date', label: 'Date', flex: 1.1 }, { key: 'type', label: 'Transaction', flex: 1.7 }, { key: 'ref', label: 'Details', flex: 2.2 },
    { key: 'qty', label: 'Quantity', flex: 1.2, right: true }, { key: 'bal', label: 'Closing balance', flex: 1.3, right: true },
  ];
  const stockTab = (
    <View>
      <View style={s.tabHead}>
        <FilterChips value={dirFilter} onChange={setDirFilter} style={{ marginBottom: -4 }}
          options={[
            { value: 'all', label: 'All', count: ledger.length },
            { value: 'in', label: 'Stock in', count: ledger.filter((r) => r.mv.dir === 'in').length },
            { value: 'out', label: 'Stock out', count: ledger.filter((r) => r.mv.dir === 'out').length },
          ]} />
      </View>
      {shownLedger.length === 0 ? <Empty icon="clipboard-text-outline" text={ledger.length ? 'No movements of this kind.' : 'No stock entries yet.'} /> : (
        <View>
          {wide && <Head cols={stockCols} />}
          {shownLedger.map(({ x, mv }) => {
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
                {!!x.batch_no && <BatchChip no={x.batch_no} onPress={() => openBatch(x.batch_id)} />}
                {!note && !x.batch_no && <Text style={s.tdMuted}>-</Text>}
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
                {(!!note || !!x.batch_no) && <View style={{ marginTop: 6 }}>{detail}</View>}
              </View>
            );
          })}
        </View>
      )}
      {ledger.length >= LEDGER_LIMIT && <Note>Showing the latest {LEDGER_LIMIT} movements. Totals above include everything.</Note>}
    </View>
  );

  /* ---- Batch tracking ---- */
  const batchCols = [
    { key: 'batch', label: 'Batch', flex: 1.5 }, { key: 'prod', label: 'Product', flex: 2 }, { key: 'date', label: 'Production date', flex: 1.3 },
    { key: 'status', label: 'Status', flex: 1.4 }, { key: 'qty', label: 'Material used', flex: 1.2, right: true }, { key: 'share', label: 'Share of total', flex: 1.8 },
  ];
  const batchTab = (
    <View>
      {d.batches.length === 0 ? <Empty icon="package-variant" text="This material has not been used in any batch yet." /> : (
        <View>
          <View style={s.miniRow}>
            <Mini label="Batches" value={`${t.batch_count}${batchesCapped ? '+' : ''}`} />
            <Mini label="Total used" value={`${fmt(t.used_in_batches_kg)} kg`} />
            <Mini label="Average per batch" value={`${fmt(r3(batchTotal / d.batches.length))} kg`} />
            <Mini label="Largest batch" value={`${fmt(maxBatch)} kg`} />
          </View>
          {wide && <Head cols={batchCols} />}
          {d.batches.map((b) => {
            const pct = sharePct(b.qty, batchTotal);
            const bar = (
              <View style={s.shareRow}>
                <View style={s.track}><View style={[s.fill, { width: `${Math.max(pct, 2)}%`, backgroundColor: COLORS.primary }]} /></View>
                <Text style={s.sharePct}>{pct}%</Text>
              </View>
            );
            const status = <Badge tone={STATUS_TONE(b.status)} text={pretty(b.status) || '-'} />;
            if (wide) {
              return (
                <PressableScale key={b.batch_id} to={0.995} hover={1} onPress={() => openBatch(b.batch_id)} style={s.tr}>
                  <Text style={[s.td, s.link, { flex: 1.5 }]}>{b.batch_no}</Text>
                  <Text style={[s.td, { flex: 2 }]} numberOfLines={1}>{b.product_name}</Text>
                  <Text style={[s.td, { flex: 1.3 }]}>{niceDate(b.production_date)}</Text>
                  <View style={{ flex: 1.4, paddingRight: 8 }}>{status}{!!b.current_stage && <Text style={s.tdSub}>{pretty(b.current_stage)}</Text>}</View>
                  <Text style={[s.td, s.num, { flex: 1.2, fontWeight: '900' }]}>{fmt(b.qty)} kg</Text>
                  <View style={{ flex: 1.8 }}>{bar}</View>
                </PressableScale>
              );
            }
            return (
              <PressableScale key={b.batch_id} to={0.99} hover={1} onPress={() => openBatch(b.batch_id)} style={s.card2}>
                <View style={s.rowBetween}><Text style={[s.typeText, { color: COLORS.primary }]}>{b.batch_no}</Text><Text style={s.qtyBig}>{fmt(b.qty)} kg</Text></View>
                <Text style={[s.tdMuted, { marginTop: 3 }]} numberOfLines={1}>{b.product_name} · {niceDate(b.production_date)}</Text>
                <View style={[s.rowBetween, { marginTop: 8 }]}><View style={{ flex: 1, marginRight: 10 }}>{bar}</View>{status}</View>
              </PressableScale>
            );
          })}
        </View>
      )}
      {batchesCapped && <Note>Showing the latest {LIST_LIMIT} batches that used this material.</Note>}
    </View>
  );

  /* ---- Roasting loss ---- */
  const roastCols = [
    { key: 'batch', label: 'Batch', flex: 1.5 }, { key: 'date', label: 'Roast date', flex: 1.3 }, { key: 'in', label: 'Input', flex: 1, right: true },
    { key: 'out', label: 'Output', flex: 1, right: true }, { key: 'waste', label: 'Wastage', flex: 1, right: true }, { key: 'loss', label: 'Loss', flex: 1.9 },
  ];
  const roastTab = (
    <View>
      {d.roasting.length === 0 ? <Empty icon="fire-off" text="No completed roasting entries for this material." /> : (
        <View>
          <View style={s.miniRow}>
            <Mini label="Roasting input" value={`${fmt(t.roast_input_kg)} kg`} />
            <Mini label="Roasting output" value={`${fmt(roastOut)} kg`} />
            <Mini label="Wastage" value={`${fmt(t.roast_loss_kg)} kg`} tone={t.roast_loss_alert ? COLORS.danger : undefined} />
            <Mini label={`Average loss (limit ${limit}%)`} value={t.roast_loss_pct === null ? '-' : `${t.roast_loss_pct}%`} tone={t.roast_loss_alert ? COLORS.danger : COLORS.ok} />
          </View>
          {wide && <Head cols={roastCols} />}
          {d.roasting.map((r) => {
            const waste = r.wastage_weight === null || r.wastage_weight === undefined ? Math.max(num(r.input_weight) - num(r.output_weight), 0) : num(r.wastage_weight);
            const pct = r.loss_percent === null || r.loss_percent === undefined ? null : num(r.loss_percent);
            const col = r.loss_alert ? COLORS.danger : COLORS.ok;
            const bar = pct === null ? <Text style={s.tdMuted}>-</Text> : (
              <View style={s.shareRow}>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${Math.max(Math.min(pct / (limit * 2), 1) * 100, 3)}%`, backgroundColor: col }]} />
                  <View style={s.limitMark} />
                </View>
                <Text style={[s.sharePct, { color: col }]}>{pct}%</Text>
                {r.loss_alert && <Badge tone="danger" text="High" dot={false} style={{ marginLeft: 6 }} />}
              </View>
            );
            if (wide) {
              return (
                <View key={r.id} style={s.tr}>
                  <Text style={[s.td, { flex: 1.5, fontWeight: '900' }]}>{r.batch_no}</Text>
                  <Text style={[s.td, { flex: 1.3 }]}>{niceDate(r.roast_date)}</Text>
                  <Text style={[s.td, s.num, { flex: 1 }]}>{fmt(r.input_weight)} kg</Text>
                  <Text style={[s.td, s.num, { flex: 1 }]}>{fmt(r.output_weight)} kg</Text>
                  <Text style={[s.td, s.num, { flex: 1, fontWeight: '900' }]}>{fmt(waste)} kg</Text>
                  <View style={{ flex: 1.9, paddingLeft: 12 }}>{bar}</View>
                </View>
              );
            }
            return (
              <View key={r.id} style={s.card2}>
                <View style={s.rowBetween}><Text style={s.typeText}>{r.batch_no}</Text><Text style={s.tdMuted}>{niceDate(r.roast_date)}</Text></View>
                <Text style={[s.td, { marginTop: 6 }]}>{fmt(r.input_weight)} kg in → {fmt(r.output_weight)} kg out · <Text style={s.strong}>{fmt(waste)} kg lost</Text></Text>
                <View style={{ marginTop: 8 }}>{bar}</View>
              </View>
            );
          })}
          <Note>The marker on each bar is the {limit}% alert limit.{roastCapped ? ` Showing the latest ${LIST_LIMIT} entries; the summary above covers all ${t.roast_entries}.` : ''}</Note>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[COLORS.primary]} />}>
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
              <Text style={s.refreshText}>{refreshing ? 'Updating' : updated ? `Updated ${updated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}</Text>
            </PressableScale>
          </View>
        </View>

        {/* key numbers */}
        <View style={s.kpis}>
          <Kpi icon="warehouse" accent={stockColor} label="Available stock" value={fmt(m.current_stock)} unit={unit} tone={low ? COLORS.danger : COLORS.text}
            sub={`Minimum ${fmt(m.minimum_stock)} ${unit}${out ? ' · out of stock' : low ? ' · reorder now' : ''}`} subTone={low ? COLORS.danger : undefined} />
          <Kpi icon="arrow-down-bold-circle-outline" label="Total received" value={fmt(t.received)} unit={unit} sub="All time, including opening stock" />
          <Kpi icon="arrow-up-bold-circle-outline" label="Total issued" value={fmt(t.issued)} unit={unit} sub="Production, samples, wastage" />
          <Kpi icon="package-variant-closed" label="Used in batches" value={fmt(t.used_in_batches_kg)} unit="kg" sub={`${t.batch_count}${batchesCapped ? '+' : ''} batch${t.batch_count === 1 ? '' : 'es'}`} />
          <Kpi icon="fire" label="Roasting loss" value={t.roast_loss_pct === null ? '-' : `${t.roast_loss_pct}%`} tone={t.roast_loss_alert ? COLORS.danger : COLORS.text}
            sub={t.roast_entries ? `${fmt(t.roast_loss_kg)} of ${fmt(t.roast_input_kg)} kg${t.roast_loss_alert ? ' · high' : ''}` : 'No roasting entries'} subTone={t.roast_loss_alert ? COLORS.danger : undefined} />
        </View>

        {/* stock picture */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.sec}>Where the stock went</Text>
            <Text style={s.secSide}>{fmt(flow.received)} {unit} received</Text>
          </View>
          {flowTotal > 0 ? (
            <View style={s.stack}>
              {segs.filter((g) => g.value > 0).map((g) => <View key={g.key} style={{ flex: g.value, backgroundColor: g.color, borderRightWidth: 2, borderRightColor: COLORS.surface }} />)}
            </View>
          ) : <View style={[s.stack, { backgroundColor: COLORS.greyBg }]} />}
          <View style={s.legend}>
            {segs.filter((g) => g.key !== 'other' || g.value > 0).map((g) => (
              <View key={g.key} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: g.color }]} />
                <View>
                  <Text style={s.legendLabel}>{g.label}</Text>
                  <Text style={s.legendVal}>{fmt(g.value)} {unit}<Text style={s.legendPct}>  {flowTotal > 0 ? Math.round((g.value / flowTotal) * 100) : 0}%</Text></Text>
                </View>
              </View>
            ))}
          </View>
          {flow.other > 0 && <Note>{fmt(flow.other)} {unit} more is in stock than the received and issued totals explain. Check recent corrections.</Note>}
          <View style={s.gauge}>
            <View style={s.rowBetween}>
              <Text style={s.gaugeLabel}>Stock level against minimum</Text>
              <Text style={[s.gaugeLabel, { color: low ? COLORS.danger : COLORS.ok, fontWeight: '900' }]}>{fmt(m.current_stock)} / {fmt(m.minimum_stock)} {unit}</Text>
            </View>
            {num(m.minimum_stock) > 0
              ? <StockBar current={m.current_stock} minimum={m.minimum_stock} low={low} height={8} style={{ marginTop: 8 }} />
              : <Text style={s.tdMuted}>No minimum level is set for this material.</Text>}
            {num(m.minimum_stock) > 0 && <Text style={s.gaugeHint}>The line in the middle marks the minimum stock.</Text>}
          </View>
        </View>

        {/* tabs */}
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={{ paddingHorizontal: isPhone ? 6 : 10 }}>
            {tabs.map((tb) => tabButton(tb, tab === tb.key, () => setTab(tb.key)))}
          </ScrollView>
          <View style={{ padding: isPhone ? 12 : 16 }}>
            {tab === 'stock' ? stockTab : tab === 'batch' ? batchTab : roastTab}
          </View>
        </View>
      </Container>
    </ScrollView>
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

  tabs: { borderBottomWidth: 1, borderBottomColor: COLORS.border, flexGrow: 0 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, marginHorizontal: 2, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: COLORS.primary },
  tabHover: { backgroundColor: COLORS.greyBg },
  tabText: { fontSize: 14, fontWeight: '800', color: COLORS.textSoft, marginLeft: 7 },
  tabCount: { marginLeft: 8, minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.greyBg },
  tabCountText: { fontSize: 11, fontWeight: '900', color: COLORS.grey },
  tabHead: { marginBottom: 6 },

  miniRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 10 },
  mini: { flexGrow: 1, flexBasis: 140, backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, paddingVertical: 10, paddingHorizontal: 12, margin: 5 },
  miniLabel: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  miniValue: { fontSize: 18, fontWeight: '900', color: COLORS.text, marginTop: 2, fontVariant: ['tabular-nums'] },

  thead: { flexDirection: 'row', backgroundColor: COLORS.greyBg, borderRadius: RADIUS.sm, paddingVertical: 9, paddingHorizontal: 10 },
  th: { fontSize: 12, fontWeight: '800', color: COLORS.grey },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  td: { fontSize: 13.5, fontWeight: '600', color: COLORS.text, paddingRight: 8 },
  tdSub: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 3 },
  tdMuted: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  link: { color: COLORS.primary, fontWeight: '900' },
  strong: { fontWeight: '900', color: COLORS.text },
  typeRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  typeText: { fontSize: 14, fontWeight: '900', color: COLORS.text, flexShrink: 1 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyBig: { fontSize: 15, fontWeight: '900', color: COLORS.text, marginLeft: 10, fontVariant: ['tabular-nums'] },
  card2: { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: COLORS.line },

  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: COLORS.primarySoft, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, marginTop: 4 },
  chipText: { fontSize: 12, fontWeight: '900', color: COLORS.primary, marginLeft: 5 },

  shareRow: { flexDirection: 'row', alignItems: 'center' },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: COLORS.greyBg, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  limitMark: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(43,27,20,0.3)' },
  sharePct: { fontSize: 12.5, fontWeight: '900', color: COLORS.text, marginLeft: 8, minWidth: 40, fontVariant: ['tabular-nums'] },

  empty: { alignItems: 'center', paddingVertical: 36 },
  emptyText: { fontSize: 13.5, fontWeight: '600', color: COLORS.grey, marginTop: 8, textAlign: 'center' },
  note: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 12 },
});