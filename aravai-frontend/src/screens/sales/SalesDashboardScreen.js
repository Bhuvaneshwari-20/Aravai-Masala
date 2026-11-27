import React, { useCallback, useRef, useState } from 'react';
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import TrendChart from '../../components/SalesCharts';
import SalesDetailModal from '../../components/SalesDetailModal';
import FgStockCardModal from '../../components/FgStockCardModal';
import { SoftBtn } from '../../components/SalesBits';
import { NotificationBell } from '../../components/NotificationCenter';
import { printHtml } from '../../printDoc';
import useLayout from '../../hooks/useLayout';
import { monthLabel, monthOf, monthStart, monthEnd, niceDate, shortDay } from './salesUtils';
import { COLORS, SHADOW, fmt } from '../../theme';

// Sales Dashboard: month KPIs, 14-day sales trend, stock status, top selling products, recent invoices.
// GET /sales/dashboard  (see SALES_INTEGRATION.md for the response shape)
const inr = (v) => `₹ ${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function Kpi({ icon, ghost, tint, bg, label, value, hint }) {
  return (
    <LinearGradient colors={['#FFFFFF', bg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.kpi, SHADOW.sm]}>
      <View style={[s.kpiIcon, { backgroundColor: `${tint}26` }]}><MCI name={icon} size={26} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.kpiLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.kpiValue} numberOfLines={1}>{value}</Text>
        {!!hint && <Text style={[s.kpiHint, { color: tint }]} numberOfLines={1}>{hint}</Text>}
      </View>
      <MCI name={ghost} size={60} color={`${tint}30`} style={s.ghost} />
    </LinearGradient>
  );
}

function Card({ icon, title, children, style, right }) {
  return (
    <View style={[s.card, SHADOW.sm, style]}>
      <View style={s.cardHead}>
        <MCI name={icon} size={21} color={COLORS.primary} />
        <Text style={s.cardTitle} numberOfLines={1}>{title}</Text>
        {!!right && <View style={{ marginLeft: 'auto' }}>{right}</View>}
      </View>
      {children}
    </View>
  );
}

function Donut({ data, size = 150, stroke = 24, title, sub }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const sum = data.reduce((a, d) => a + d.value, 0) || 1;
  let acc = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={COLORS.line} strokeWidth={stroke} fill="none" />
        {data.map((d) => {
          const len = (d.value / sum) * circ;
          const el = len > 0 ? (
            <Circle key={d.name} cx={size / 2} cy={size / 2} r={r} stroke={d.color} strokeWidth={stroke} fill="none"
              strokeDasharray={`${Math.max(len - 2, 0)} ${circ}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          ) : null;
          acc += len;
          return el;
        })}
      </Svg>
      <View style={s.donutCenter} pointerEvents="none">
        <Text style={s.donutTitle}>{title}</Text>
        <Text style={s.donutSub}>{sub}</Text>
      </View>
    </View>
  );
}

export default function SalesDashboardScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const nav = useNavigation();
  const { isWide, isPhone, pad } = useLayout();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [stockSku, setStockSku] = useState(null);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try { setD((await api.get('/sales/dashboard')).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setRefreshing(false);
  }, []);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { load(first.current ? 'initial' : 'silent'); first.current = false; }, [load]));

  const go = (screen) => nav.navigate(screen);
  const m = (d?.month && typeof d.month === 'object') ? d.month : {};
  const t = d?.today || {};
  const cur = d?.month_key || monthOf();

  // print one invoice (web): fetch the full invoice and print a clean page from a hidden frame
  const printInvoice = async (id) => {
    try {
      const x = (await api.get(`/sales/${id}`)).data.data;
      const items = x.items || [];
      const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)} · ${esc(it.packing_size_label)}</td><td>${esc(it.sku_code)}</td>`
        + `<td style="text-align:right">${fmt(it.quantity)}</td><td style="text-align:right">${inr(it.rate)}</td><td style="text-align:right">${inr(it.amount)}</td></tr>`).join('');
      const total = x.total_amount ?? items.reduce((a, it) => a + Number(it.amount || 0), 0);
      const body = `<div class="head"><div class="co">ARAVAI MASALA<small>Sales Invoice</small></div><div class="doc"><b>${esc(x.invoice_no)}</b><div>${esc(niceDate(x.sale_date))}</div></div></div>`
        + `<h3>Customer</h3><div>${esc(x.customer_name)}</div><h3>Items</h3>`
        + `<table><tr><th>#</th><th>Product</th><th>SKU</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>${rows}</table>`
        + `<h3>Total</h3><div style="font-size:16px"><b>${inr(total)}</b></div>`;
      if (!printHtml(`Invoice-${x.invoice_no}`, body)) toast('Printing is available in the web app');
    } catch (e) { toast(errMsg(e)); }
  };

  // ---- panels data ----
  const trend = (Array.isArray(d?.trend) ? d.trend : []).map((x) => ({ label: shortDay(x.date), values: [Number(x.gross) || 0] }));

  const stock = d?.stock || [];
  const lowCount = stock.filter((r) => Number(r.stock_packs) < Number(r.low_stock_packs || 20)).length;
  const okCount = stock.length - lowCount;
  const pct = (v) => (stock.length ? Math.round((v / stock.length) * 100) : 0);
  const stockStatus = [
    { name: 'In Stock', value: okCount, color: COLORS.primary },
    { name: 'Low Stock', value: lowCount, color: '#F2B300' },
  ];

  const top = d?.top_skus || [];
  const topMax = Math.max(1, ...top.map((r) => Number(r.amount) || 0));

  const kpis = d ? [
    { icon: 'cart-outline', ghost: 'chart-line', tint: '#16A05A', bg: '#DDF5E6', label: 'Total Sales (₹)', value: inr(m.gross_sales), hint: `Net ${inr(m.net_sales)}` },
    { icon: 'file-document-outline', ghost: 'file-document-outline', tint: '#2F80ED', bg: '#E1EEFD', label: 'Total Invoices', value: fmt(m.invoices), hint: `${fmt(t.invoices)} today` },
    { icon: 'package-variant-closed', ghost: 'truck-outline', tint: '#E0A100', bg: '#FFF2CC', label: 'Packs Sold', value: fmt(m.packs_sold), hint: `${fmt(t.packs)} today` },
    { icon: 'timer-sand', ghost: 'keyboard-return', tint: '#D93B5A', bg: '#FDE3E8', label: 'Pending Returns', value: fmt(d.pending_returns), hint: `${fmt(m.returned_packs)} packs returned` },
  ] : [];

  const cols = { flexDirection: isWide ? 'row' : 'column', marginHorizontal: isWide ? -6 : 0 };
  const colGap = isWide ? { marginHorizontal: 6 } : null;

  return (
    <View style={s.wrap}>
      <Container fill>
        {!d && !error ? <LoadingView rows={4} /> : !d ? <EmptyView error={error} onRetry={() => load('initial')} /> : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}>
            <View style={{ paddingHorizontal: pad, paddingTop: 16 }}>

              {/* header */}
              <View style={[s.head, !isWide && { flexWrap: 'wrap' }]}>
                <View style={s.headL}>
                  <View style={s.headIcon}><MCI name="storefront-outline" size={isPhone ? 26 : 32} color={COLORS.primary} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.h1, isPhone && { fontSize: 22 }]} numberOfLines={1}>Sales Dashboard</Text>
                    <Text style={s.h1sub} numberOfLines={2}>Track sales, returns and stock movements in one place.</Text>
                  </View>
                </View>
                <View style={s.headR}>
                  <View style={s.datePill}>
                    <MCI name="calendar-month-outline" size={18} color={COLORS.textSoft} />
                    <Text style={s.dateText} numberOfLines={1}>{`${niceDate(monthStart(cur))} – ${niceDate(monthEnd(cur))}`}</Text>
                    <MCI name="chevron-down" size={18} color={COLORS.textSoft} />
                  </View>
                  <View style={{ marginLeft: 10 }}><NotificationBell /></View>
                </View>
              </View>

              {/* KPI row */}
              <View style={s.kpiRow}>
                {kpis.map((k) => (
                  <View key={k.label} style={{ width: isWide ? '25%' : '50%', padding: 6 }}><Kpi {...k} /></View>
                ))}
              </View>

              {/* trend + stock status + top products */}
              <View style={cols}>
                <Card icon="chart-box-outline" title="Sales Trend" style={[colGap, { flex: isWide ? 1.5 : undefined }]}>
                  <TrendChart type="bar" highlight="max" hideLegend data={trend} series={[{ name: 'Gross sales', color: COLORS.primary }]} height={isWide ? 230 : 210} />
                </Card>

                <Card icon="chart-donut" title="Stock Status" style={[colGap, { flex: isWide ? 1 : undefined }]}>
                  {stock.length === 0 ? <Text style={s.empty}>No finished goods in stock</Text> : (
                    <View style={s.donutRow}>
                      <Donut data={stockStatus} title={String(stock.length)} sub="SKUs" />
                      <View style={{ flex: 1, minWidth: 150, marginLeft: 18 }}>
                        {stockStatus.map((x) => (
                          <View key={x.name} style={s.legend}>
                            <View style={[s.legendDot, { backgroundColor: x.color }]} />
                            <Text style={[s.legendText, { flex: 1 }]} numberOfLines={1}>{x.name}</Text>
                            <Text style={s.legendPct}>{`${x.value} (${pct(x.value)}%)`}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </Card>

                <Card icon="cube-outline" title="Top Selling Products" style={[colGap, { flex: isWide ? 1.2 : undefined }]}>
                  {top.length === 0 && <Text style={s.empty}>No sales this month</Text>}
                  {top.map((r) => (
                    <View key={r.packing_rate_id} style={s.topRow}>
                      <Text style={s.topName} numberOfLines={1}>{`${r.product_name} · ${r.packing_size_label}`}</Text>
                      <View style={s.track}><View style={[s.fill, { width: `${Math.max(((Number(r.amount) || 0) / topMax) * 100, 4)}%` }]} /></View>
                      <Text style={s.topAmt} numberOfLines={1}>{inr(r.amount)}</Text>
                    </View>
                  ))}
                </Card>
              </View>

              {/* recent invoices */}
              <Card icon="text-box-outline" title="Recent Sales Invoices" style={{ marginTop: 12 }}
                right={isWide ? (
                  <View style={s.actions}>
                    {can('sales_entry', 'create') && <SoftBtn icon="plus" label="New Invoice" onPress={() => go('SalesEntry')} />}
                    {can('sales_return', 'create') && <SoftBtn icon="keyboard-return" label="Sales Return" onPress={() => go('SalesReturn')} />}
                    <SoftBtn icon="chart-bar" label="Monthly Report" onPress={() => go('SalesReport')} />
                  </View>
                ) : null}>
                {!isWide && (
                  <View style={[s.actions, { marginLeft: -8, marginBottom: 10 }]}>
                    {can('sales_entry', 'create') && <SoftBtn icon="plus" label="New Invoice" onPress={() => go('SalesEntry')} />}
                    {can('sales_return', 'create') && <SoftBtn icon="keyboard-return" label="Sales Return" onPress={() => go('SalesReturn')} />}
                    <SoftBtn icon="chart-bar" label="Monthly Report" onPress={() => go('SalesReport')} />
                  </View>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
                  <View style={{ flex: 1, minWidth: 760 }}>
                    <View style={s.thead}>
                      <Text style={[s.th, { width: 34 }]}>#</Text>
                      <Text style={[s.th, { flex: 1 }]}>Invoice No</Text>
                      <Text style={[s.th, { flex: 1 }]}>Date</Text>
                      <Text style={[s.th, { flex: 2 }]}>Customer</Text>
                      <Text style={[s.th, { flex: 1.2, textAlign: 'right' }]}>Total Amount (₹)</Text>
                      <Text style={[s.th, { flex: 1.3, textAlign: 'center' }]}>Status</Text>
                      <Text style={[s.th, { width: 90, textAlign: 'center' }]}>Action</Text>
                    </View>
                    {(d.recent || []).length === 0 && <Text style={s.empty}>No sales yet</Text>}
                    {(d.recent || []).map((r, i, arr) => {
                      const returned = Number(r.total_amount) - Number(r.net_amount ?? r.total_amount) > 0.005;
                      return (
                        <View key={r.id} style={[s.trow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                          <Text style={[s.td, { width: 34 }]}>{i + 1}</Text>
                          <Text style={[s.td, s.bold, { flex: 1 }]} numberOfLines={1}>{r.invoice_no}</Text>
                          <Text style={[s.td, { flex: 1 }]} numberOfLines={1}>{niceDate(r.sale_date)}</Text>
                          <Text style={[s.td, { flex: 2 }]} numberOfLines={1}>{r.customer_name}</Text>
                          <Text style={[s.td, { flex: 1.2, textAlign: 'right' }]} numberOfLines={1}>{inr(r.total_amount)}</Text>
                          <View style={{ flex: 1.3, alignItems: 'center' }}>
                            <Badge tone={returned ? 'warn' : 'ok'} text={returned ? 'Partly Returned' : 'Completed'} />
                          </View>
                          <View style={s.actCell}>
                            <Pressable onPress={() => setDetailId(r.id)} hitSlop={8} accessibilityLabel="View invoice" style={s.actBtn}><MCI name="eye-outline" size={20} color={COLORS.textSoft} /></Pressable>
                            <Pressable onPress={() => printInvoice(r.id)} hitSlop={8} accessibilityLabel="Print invoice" style={s.actBtn}><MCI name="printer-outline" size={20} color={COLORS.textSoft} /></Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </Card>

              {/* finished goods stock (tap a SKU for its stock card) */}
              <Card icon="warehouse" title="Finished goods stock" style={{ marginTop: 12 }} right={<Text style={s.hint}>Tap a SKU for its stock card</Text>}>
                {stock.length === 0 && <Text style={s.empty}>No finished goods in stock</Text>}
                {stock.map((r, i, arr) => (
                  <Pressable key={r.packing_rate_id} onPress={() => setStockSku(r)}
                    style={({ hovered }) => [s.line, i === arr.length - 1 && { borderBottomWidth: 0 }, hovered && { backgroundColor: COLORS.primarySoft }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.lineTitle} numberOfLines={1}>{r.product_name} · {r.packing_size_label}</Text>
                      <Text style={s.lineSub}>{r.sku_code}</Text>
                    </View>
                    <Badge tone={Number(r.stock_packs) <= 0 ? 'danger' : Number(r.stock_packs) < Number(r.low_stock_packs || 20) ? 'warn' : 'ok'} text={`${fmt(r.stock_packs)} packs`} />
                    <MCI name="chevron-right" size={18} color="#9AAAA0" style={{ marginLeft: 6 }} />
                  </Pressable>
                ))}
              </Card>

              <Text style={s.note}>
                {d.cost_note || 'Estimated profit = net sales - cost of the packs sold (production cost + packing material cost per pack, from actual batches).'}
              </Text>
            </View>
          </ScrollView>
        )}
      </Container>
      <SalesDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
      <FgStockCardModal visible={!!stockSku} sku={stockSku} onDismiss={() => setStockSku(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headL: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, marginRight: 12 },
  headIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  h1: { fontSize: 28, fontWeight: '900', color: COLORS.text },
  h1sub: { fontSize: 13.5, color: COLORS.textSoft, fontWeight: '600', marginTop: 2 },
  headR: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  datePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, height: 44 },
  dateText: { marginHorizontal: 10, fontSize: 13.5, fontWeight: '700', color: COLORS.text },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 4 },
  kpi: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', minHeight: 92 },
  kpiIcon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  kpiLabel: { fontSize: 12.5, color: COLORS.text, fontWeight: '700' },
  kpiValue: { fontSize: 22, fontWeight: '900', color: COLORS.text, marginTop: 1 },
  kpiHint: { fontSize: 11.5, fontWeight: '800', marginTop: 1 },
  ghost: { position: 'absolute', right: 10, bottom: 6 },

  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text, marginLeft: 9, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },

  donutRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', paddingVertical: 10 },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  donutTitle: { fontSize: 26, fontWeight: '900', color: COLORS.text },
  donutSub: { fontSize: 12.5, color: COLORS.text, fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  legendDot: { width: 11, height: 11, borderRadius: 6, marginRight: 8 },
  legendText: { fontSize: 13.5, color: COLORS.text, fontWeight: '600' },
  legendPct: { fontSize: 13.5, color: COLORS.textSoft, fontWeight: '700', marginLeft: 8 },

  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  topName: { flex: 1.3, fontSize: 13.5, fontWeight: '700', color: COLORS.text, marginRight: 10 },
  track: { flex: 1.2, height: 9, borderRadius: 5, backgroundColor: '#E4EEE8', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: COLORS.primary },
  topAmt: { width: 96, textAlign: 'right', fontSize: 13.5, fontWeight: '800', color: COLORS.text, marginLeft: 10 },

  thead: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EDF2EE', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10 },
  th: { fontSize: 12.5, fontWeight: '800', color: COLORS.text },
  trow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  td: { fontSize: 13.5, color: COLORS.text, fontWeight: '600' },
  bold: { fontWeight: '900' },
  actCell: { width: 90, flexDirection: 'row', justifyContent: 'center' },
  actBtn: { paddingHorizontal: 7, paddingVertical: 2 },

  line: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  lineTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  lineSub: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  empty: { textAlign: 'center', color: COLORS.grey, padding: 22, fontWeight: '600' },
  hint: { color: COLORS.grey, fontSize: 12, fontWeight: '600' },
  note: { marginTop: 14, color: COLORS.grey, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
});