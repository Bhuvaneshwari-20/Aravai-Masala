import React, { useCallback, useRef, useState } from 'react';
import { View, ScrollView, Pressable, RefreshControl, Linking, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg, getToken } from '../../api';
import { API_URL } from '../../config';
import { useUi } from '../../ui';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import SelectField from '../../components/SelectField';
import TrendChart from '../../components/SalesCharts';
import { Panel, KpiGrid, SoftBtn } from '../../components/SalesBits';
import useLayout from '../../hooks/useLayout';
import { monthLabel, monthOf, recentMonths, shiftMonth, shortDay, profitColor } from './salesUtils';
import { COLORS, fmt, money } from '../../theme';

// Monthly Sales & Profit Report.
//   Stock flow:  Opening + Production received + Returned (resalable) - Sold (+/- corrections) = Closing
//   Money:       Gross sales - returns = Net sales;   Net sales - production & packing cost of the packs sold = Estimated profit
// GET /sales/reports/monthly?month=YYYY-MM[&product_id=]     CSV: GET /sales/reports/monthly.csv?month=&token=
const MONTHS = recentMonths(36);
const COLS = [
  { k: 'name', label: 'Product · SKU', w: 200, left: true },
  { k: 'opening_packs', label: 'Opening', w: 82 },
  { k: 'produced_packs', label: 'Production', w: 92 },
  { k: 'sold_packs', label: 'Sold', w: 78 },
  { k: 'returned_packs', label: 'Returned', w: 86 },
  { k: 'closing_packs', label: 'Closing', w: 82 },
  { k: 'gross_sales', label: 'Gross sales', w: 118, money: true },
  { k: 'net_sales', label: 'Net sales', w: 118, money: true },
  { k: 'production_cost', label: 'Prod. cost', w: 118, money: true },
  { k: 'estimated_profit', label: 'Est. profit', w: 118, money: true, profit: true },
];
const TABLE_W = COLS.reduce((a, c) => a + c.w, 0);
// month-wise table (last 12 months up to the chosen month): stock flow in packs + kg and the money columns. Tap a month to open it.
const MCOLS = [
  { k: 'label', label: 'Month', w: 96, left: true },
  { k: 'opening_stock', label: 'Opening', w: 82 },
  { k: 'production_received', label: 'Production', w: 92 },
  { k: 'production_kg', label: 'Prod. kg', w: 86 },
  { k: 'packs_sold', label: 'Sold', w: 78 },
  { k: 'sold_kg', label: 'Sold kg', w: 86 },
  { k: 'packs_returned', label: 'Returned', w: 86 },
  { k: 'closing_stock', label: 'Closing', w: 82 },
  { k: 'invoices', label: 'Invoices', w: 82 },
  { k: 'gross_sales', label: 'Gross sales', w: 118, money: true },
  { k: 'net_sales', label: 'Net sales', w: 118, money: true },
  { k: 'estimated_profit', label: 'Est. profit', w: 118, money: true, profit: true },
];
const MTABLE_W = MCOLS.reduce((a, c) => a + c.w, 0);

export default function SalesReportScreen() {
  const { toast } = useUi();
  const { isWide, isPhone, pad } = useLayout();
  const [month, setMonth] = useState(monthOf());
  const [productId, setProductId] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  const load = useCallback(async (mode) => {
    const id = ++reqId.current;
    if (mode === 'refresh') setRefreshing(true); else if (mode !== 'silent') setLoading(true);
    try {
      const r = await api.get('/sales/reports/monthly', { params: { month, product_id: productId || undefined } });
      if (id !== reqId.current) return;
      setD(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) { setLoading(false); setRefreshing(false); }
  }, [month, productId]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { load(first.current ? 'initial' : 'silent'); first.current = false; }, [load]));

  const pickMonth = (m) => { setLoading(true); setMonth(m); };
  const pickProduct = (v) => { setLoading(true); setProductId(v); };

  const t = d?.totals || {};
  const rows = d?.rows || [];
  const productOptions = [{ value: null, label: 'All products' }, ...(d?.products || []).map((p) => ({ value: p.id, label: p.product_name }))];
  const margin = Number(t.net_sales) > 0 ? Math.round((Number(t.estimated_profit) / Number(t.net_sales)) * 1000) / 10 : null;
  // stock that moved for reasons other than production / sales / returns (manual corrections) - shown so the flow always adds up
  const adj = d ? Number(t.closing_packs) - (Number(t.opening_packs) + Number(t.produced_packs) + Number(t.returned_packs) - Number(t.sold_packs)) : 0;

  const exportCsv = () => {
    const url = `${API_URL}/sales/reports/monthly.csv?month=${month}${productId ? `&product_id=${productId}` : ''}&token=${getToken()}`;
    Linking.openURL(url).catch(() => toast('Could not open the CSV'));
  };

  const flow = d ? [
    { icon: 'package-down', color: '#475569', value: fmt(t.opening_packs), label: 'Opening Stock', hint: 'Packs on 1st' },
    { icon: 'factory', color: '#B45309', value: fmt(t.produced_packs), label: 'Production Received', hint: 'Packed this month' },
    { icon: 'cart-arrow-up', color: COLORS.green, value: fmt(t.sold_packs), label: 'Total Packs Sold', hint: 'Invoiced' },
    { icon: 'keyboard-return', color: COLORS.danger, value: fmt(t.returned_packs), label: 'Returned Packs', hint: 'Resalable, back in stock' },
    { icon: 'warehouse', color: '#0E7490', value: fmt(t.closing_packs), label: 'Closing Stock', hint: adj ? `Incl. ${adj > 0 ? '+' : ''}${fmt(adj)} correction` : 'Packs at month end' },
  ] : [];
  const money6 = d ? [
    { icon: 'cash-multiple', color: COLORS.green, value: money(t.gross_sales), label: 'Gross Sales' },
    { icon: 'chart-line', color: COLORS.primary, value: money(t.net_sales), label: 'Net Sales', hint: `Returns ${money(t.returns_amount)}` },
    { icon: 'factory', color: '#B45309', value: money(t.production_cost), label: 'Production Cost', hint: 'Production + packing' },
    { icon: 'trending-up', color: Number(t.estimated_profit) < 0 ? COLORS.danger : COLORS.ok, value: money(t.estimated_profit), label: 'Estimated Profit', hint: margin === null ? undefined : `${fmt(margin)}% of net sales` },
  ] : [];

  const daily = (d?.daily || []).map((x) => ({ label: shortDay(x.date), values: [Number(x.gross) || 0, Number(x.net) || 0, Number(x.profit) || 0] }));
  const yearly = (d?.months || []).map((x) => ({ label: monthLabel(x.month, true), values: [Number(x.net) || 0, Number(x.profit) || 0] }));
  const SER3 = [{ name: 'Gross sales', color: COLORS.green }, { name: 'Net sales', color: COLORS.primary }, { name: 'Est. profit', color: COLORS.accent }];

  return (
    <View style={s.wrap}>
      <PageToolbar icon="chart-bar" title="Monthly Sales & Profit" subtitle={`Stock flow, sales and estimated profit · ${monthLabel(month)}`} hideSearch />
      <Container fill>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}>
          {/* filters */}
          <View style={{ paddingHorizontal: pad, paddingTop: 8 }}>
            <View style={s.filters}>
              <View style={s.monthRow}>
                <Pressable onPress={() => pickMonth(shiftMonth(month, -1))} style={s.arrow} accessibilityLabel="Previous month"><MCI name="chevron-left" size={22} color={COLORS.text} /></Pressable>
                <View style={{ flex: 1 }}><SelectField label="Month" value={month} options={MONTHS} onChange={pickMonth} /></View>
                <Pressable onPress={() => month < monthOf() && pickMonth(shiftMonth(month, 1))} disabled={month >= monthOf()} style={[s.arrow, month >= monthOf() && { opacity: 0.35 }]} accessibilityLabel="Next month"><MCI name="chevron-right" size={22} color={COLORS.text} /></Pressable>
              </View>
              <View style={[{ flex: 1 }, isWide && { marginLeft: 12 }]}><SelectField label="Product" value={productId} options={productOptions} onChange={pickProduct} /></View>
              <View style={[s.exportWrap, isPhone && { alignSelf: 'flex-end' }]}><SoftBtn icon="download" label="CSV" onPress={exportCsv} tone={COLORS.green} /></View>
            </View>
          </View>

          {loading ? <LoadingView rows={3} /> : !d ? <EmptyView error={error} onRetry={() => load('initial')} /> : (
            <View>
              <Text style={s.section}>STOCK FLOW (PACKS)</Text>
              <KpiGrid items={flow} min={190} phoneMin={150} />
              <Text style={s.section}>SALES & PROFIT</Text>
              <KpiGrid items={money6} min={230} phoneMin={150} />

              <View style={{ paddingHorizontal: pad }}>
                <Text style={s.formula}>Closing = Opening + Production + Returned - Sold{adj ? ' ± stock corrections' : ''}.  Profit = Net sales - actual production & packing cost of the packs sold.</Text>

                <View style={isWide ? { flexDirection: 'row' } : null}>
                  <Panel title="Daily sales" icon="chart-line" style={[{ marginTop: 12 }, isWide && { flex: 1, marginRight: 12 }]}>
                    <TrendChart type="line" data={daily} series={SER3} height={isWide ? 240 : 200} />
                  </Panel>
                  <Panel title="Last 12 months" icon="chart-bar" style={[{ marginTop: 12 }, isWide && { flex: 1 }]}>
                    <TrendChart type="bar" data={yearly} series={[{ name: 'Net sales', color: COLORS.primary }, { name: 'Est. profit', color: COLORS.accent }]} height={isWide ? 240 : 200} />
                  </Panel>
                </View>

                <Panel title="SKU-wise report" icon="table" style={{ marginTop: 12 }} bodyStyle={{ padding: 0 }}
                  right={<Text style={s.hint}>{`${rows.length} SKU${rows.length === 1 ? '' : 's'}`}</Text>}>
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View style={{ minWidth: TABLE_W }}>
                      <View style={[s.tr, s.thead]}>
                        {COLS.map((c) => <Text key={c.k} style={[s.th, { width: c.w }, c.left ? { textAlign: 'left' } : null]}>{c.label.toUpperCase()}</Text>)}
                      </View>
                      {rows.length === 0 && <Text style={s.empty}>No stock or sales in this month</Text>}
                      {rows.map((r) => (
                        <View key={r.packing_rate_id} style={s.tr}>
                          {COLS.map((c) => {
                            if (c.k === 'name') {
                              return (
                                <View key={c.k} style={{ width: c.w }}>
                                  <Text style={[s.td, { textAlign: 'left', fontWeight: '800' }]} numberOfLines={1}>{r.product_name}</Text>
                                  <Text style={s.sub}>{`${r.packing_size_label} · ${r.sku_code}`}</Text>
                                </View>
                              );
                            }
                            const v = r[c.k];
                            const missing = c.k === 'production_cost' && (v === null || v === undefined);
                            return (
                              <Text key={c.k} style={[s.td, { width: c.w }, c.profit && { color: profitColor(v), fontWeight: '900' }, missing && { color: COLORS.grey }]}>
                                {missing ? 'n/a' : c.money ? money(v) : fmt(v)}
                              </Text>
                            );
                          })}
                        </View>
                      ))}
                      {rows.length > 0 && (
                        <View style={[s.tr, s.tfoot]}>
                          {COLS.map((c) => (
                            <Text key={c.k} style={[s.td, { width: c.w, fontWeight: '900' }, c.k === 'name' && { textAlign: 'left' }, c.profit && { color: profitColor(t[c.k]) }]}>
                              {c.k === 'name' ? 'TOTAL' : c.money ? money(t[c.k]) : fmt(t[c.k])}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  </ScrollView>
                </Panel>
                <Panel title="Month-wise sales & stock" icon="calendar-month-outline" style={{ marginTop: 12 }} bodyStyle={{ padding: 0 }}
                  right={<Text style={s.hint}>Tap a month to open it</Text>}>
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View style={{ minWidth: MTABLE_W }}>
                      <View style={[s.tr, s.thead]}>
                        {MCOLS.map((c) => <Text key={c.k} style={[s.th, { width: c.w }, c.left ? { textAlign: 'left' } : null]}>{c.label.toUpperCase()}</Text>)}
                      </View>
                      {(d.month_wise || []).length === 0 && <Text style={s.empty}>No month data</Text>}
                      {[...(d.month_wise || [])].reverse().map((r) => (
                        <Pressable key={r.month} onPress={() => pickMonth(r.month)} style={({ hovered }) => [s.tr, r.month === month && { backgroundColor: COLORS.primarySoft }, hovered && { backgroundColor: COLORS.greyBg }]}>
                          {MCOLS.map((c) => (
                            <Text key={c.k} style={[s.td, { width: c.w }, c.left && { textAlign: 'left', fontWeight: '900' }, c.profit && { color: profitColor(r[c.k]), fontWeight: '900' }]} numberOfLines={1}>
                              {c.left ? r[c.k] : c.money ? money(r[c.k]) : fmt(r[c.k])}
                            </Text>
                          ))}
                        </Pressable>
                      ))}
                      {(d.month_wise || []).length > 0 && (
                        <View style={[s.tr, s.tfoot]}>
                          {MCOLS.map((c) => {
                            const mt = d.month_wise_totals || {};
                            const v = c.k === 'label' ? 'TOTAL' : mt[c.k === 'opening_stock' ? 'opening_stock' : c.k];
                            return (
                              <Text key={c.k} style={[s.td, { width: c.w, fontWeight: '900' }, c.left && { textAlign: 'left' }, c.profit && { color: profitColor(v) }]} numberOfLines={1}>
                                {c.left ? v : c.money ? money(v) : fmt(v)}
                              </Text>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </ScrollView>
                </Panel>
                {!!d.cost_note && <Text style={s.formula}>{d.cost_note}</Text>}
              </View>
            </View>
          )}
        </ScrollView>
      </Container>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 12, paddingBottom: 4 },
  monthRow: { flexDirection: 'row', alignItems: 'flex-start', minWidth: 260, flexGrow: 1, flexBasis: 260 },
  arrow: { width: 38, height: 52, alignItems: 'center', justifyContent: 'center' },
  exportWrap: { height: 56, justifyContent: 'center', paddingLeft: 4, marginBottom: 4 },
  section: { fontSize: 11.5, fontWeight: '900', letterSpacing: 1.3, color: COLORS.grey, marginLeft: 28, marginTop: 16, marginBottom: 2 },
  formula: { marginTop: 12, color: COLORS.grey, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  hint: { color: COLORS.grey, fontSize: 12, fontWeight: '700' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  thead: { backgroundColor: COLORS.greyBg, paddingVertical: 9 },
  tfoot: { backgroundColor: '#FCFAF7', borderBottomWidth: 0, borderTopWidth: 1.5, borderTopColor: COLORS.border },
  th: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.7, color: COLORS.grey, textAlign: 'right', paddingRight: 10 },
  td: { fontSize: 13, fontWeight: '700', color: COLORS.text, textAlign: 'right', paddingRight: 10 },
  sub: { fontSize: 11, color: COLORS.grey, fontWeight: '600', marginTop: 1 },
  empty: { textAlign: 'center', color: COLORS.grey, padding: 26, fontWeight: '600' },
});
