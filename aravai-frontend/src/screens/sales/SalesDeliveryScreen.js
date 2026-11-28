import React, { useCallback, useRef, useState } from 'react';
import { View, ScrollView, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import ModalShell from '../../components/ModalShell';
import SelectField from '../../components/SelectField';
import FormField from '../../components/FormField';
import { KpiGrid, KV, SoftBtn } from '../../components/SalesBits';
import { ErrorBox, ModalFooter, todayStr } from '../../components/FormBits';
import { printHtml } from '../../printDoc';
import useLayout from '../../hooks/useLayout';
import { DATE_RE, num } from '../../productionUtils';
import { niceDate, PAY_MODES, payText } from './salesUtils';
import { COLORS, SHADOW, fmt, money } from '../../theme';

// Sales Delivery (dispatch): one invoice -> one or more deliveries. Stock is already issued when the invoice was saved,
// so a delivery records what left, in which vehicle / courier, and when the customer received it.
//   GET /sales/deliveries  ·  GET /sales/deliveries/pending-invoices  ·  POST /sales/deliveries  ·  PUT /sales/deliveries/:id/status
const MODES = [
  { value: 'OWN_VEHICLE', label: 'Own vehicle' }, { value: 'TRANSPORT', label: 'Transport / lorry' },
  { value: 'COURIER', label: 'Courier' }, { value: 'CUSTOMER_PICKUP', label: 'Customer pickup' },
];
const modeText = (m) => (MODES.find((x) => x.value === m) || {}).label || m || '-';
const STATUS = { DISPATCHED: { tone: 'warn', text: 'In transit' }, DELIVERED: { tone: 'ok', text: 'Delivered' }, CANCELLED: { tone: 'danger', text: 'Cancelled' } };
const FILTERS = [{ value: '', label: 'All' }, { value: 'DISPATCHED', label: 'In transit' }, { value: 'DELIVERED', label: 'Delivered' }, { value: 'CANCELLED', label: 'Cancelled' }];
const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PAGE = 30;

/* ---------------------------------------------------------------- new delivery form ---------------------------------------------------------------- */
function DeliveryFormModal({ visible, presetInvoiceId, onDismiss, onSaved }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [invoiceId, setInvoiceId] = useState(null);
  const [qty, setQty] = useState({});
  const [date, setDate] = useState(todayStr());
  const [mode, setMode] = useState('OWN_VEHICLE');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [mobile, setMobile] = useState('');
  const [lr, setLr] = useState('');
  const [address, setAddress] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const pick = useCallback((list, id) => {
    setInvoiceId(id);
    const inv = list.find((x) => x.invoice_id === id);
    const q = {}; (inv ? inv.items : []).forEach((it) => { q[it.invoice_item_id] = String(it.remaining); });
    setQty(q); setAddress(inv && inv.address ? inv.address : ''); setErrors({});
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    setErr(''); setErrors({}); setDate(todayStr()); setMode('OWN_VEHICLE'); setVehicle(''); setDriver(''); setMobile(''); setLr(''); setRemarks('');
    setLoading(true);
    api.get('/sales/deliveries/pending-invoices').then((r) => {
      const list = r.data.data.items || [];
      setPending(list);
      const first = presetInvoiceId && list.some((x) => x.invoice_id === presetInvoiceId) ? presetInvoiceId : null;
      if (first) pick(list, first); else { setInvoiceId(null); setQty({}); setAddress(''); }
    }).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false));
  }, [visible, presetInvoiceId, pick]);

  const inv = pending.find((x) => x.invoice_id === invoiceId) || null;
  const invoiceOptions = pending.map((x) => ({ value: x.invoice_id, label: `${x.invoice_no} · ${x.customer_name} · ${fmt(x.remaining_packs)} packs left` }));
  const items = inv ? inv.items : [];
  const sendPacks = items.reduce((a, it) => a + Math.floor(num(qty[it.invoice_item_id])), 0);
  const sendKg = items.reduce((a, it) => a + (Math.floor(num(qty[it.invoice_item_id])) * (it.remaining ? it.remaining_kg / it.remaining : 0)), 0);

  const validate = () => {
    const e = {};
    if (!inv) e.invoice = 'Select the invoice';
    if (!DATE_RE.test(date)) e.date = 'Use YYYY-MM-DD';
    else if (date > todayStr()) e.date = 'Date cannot be in the future';
    else if (inv && date < String(inv.invoice_date).slice(0, 10)) e.date = 'Before the invoice date';
    if (mode === 'OWN_VEHICLE' && !vehicle.trim()) e.vehicle = 'Enter the vehicle no';
    if (mobile.trim() && !/^\d{10}$/.test(mobile.trim())) e.mobile = '10 digits';
    const lines = {};
    items.forEach((it) => {
      const q = Math.floor(num(qty[it.invoice_item_id]));
      if (q > it.remaining) lines[it.invoice_item_id] = `Only ${fmt(it.remaining)} left`;
    });
    if (Object.keys(lines).length) e.lines = lines;
    if (inv && sendPacks <= 0) e.lines = { ...(e.lines || {}), _all: 'Enter the packs to deliver' };
    setErrors(e);
    return !e.invoice && !e.date && !e.vehicle && !e.mobile && !e.lines;
  };

  const save = async () => {
    setErr('');
    if (!validate()) return;
    setSaving(true);
    try {
      const r = await api.post('/sales/deliveries', {
        invoice_id: invoiceId, delivery_date: date, transport_mode: mode, vehicle_no: vehicle.trim() || undefined, driver_name: driver.trim() || undefined,
        driver_mobile: mobile.trim() || undefined, lr_no: lr.trim() || undefined, delivery_address: address.trim() || undefined, remarks: remarks.trim() || undefined,
        items: items.map((it) => ({ invoice_item_id: it.invoice_item_id, qty: Math.floor(num(qty[it.invoice_item_id])) })).filter((x) => x.qty > 0),
      });
      onSaved(r.data.data);
    } catch (e) { setErr(errMsg(e)); }
    setSaving(false);
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} title="New Delivery" subtitle="Dispatch packs of a sales invoice" icon="truck-delivery-outline" maxWidth={640} busy={saving}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={loading || !inv} label="Save & Dispatch" icon="truck-fast-outline" />}>
      {loading ? <LoadingView rows={2} /> : (
        <View>
          {pending.length === 0 && !err ? <Text style={s.none}>Every invoice has been fully dispatched. Save a sales invoice first.</Text> : (
            <>
              <SelectField label="Invoice *" value={invoiceId} options={invoiceOptions} onChange={(v) => pick(pending, v)} error={errors.invoice} />
              {!!inv && (
                <View style={s.box}>
                  <Text style={s.boxTitle}>{inv.customer_name}</Text>
                  <Text style={s.boxSub}>{`${inv.invoice_no} · ${niceDate(inv.invoice_date)}`}</Text>
                  {items.map((it) => (
                    <View key={it.invoice_item_id} style={s.line}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.lineTitle} numberOfLines={1}>{`${it.product_name} · ${it.packing_size_label}`}</Text>
                        <Text style={s.lineSub}>{`${it.sku_code} · billed ${fmt(it.qty)} · sent ${fmt(it.sent)} · left ${fmt(it.remaining)} (${fmt(it.remaining_kg)} kg)`}</Text>
                        {!!(errors.lines || {})[it.invoice_item_id] && <Text style={s.err}>{errors.lines[it.invoice_item_id]}</Text>}
                      </View>
                      <View style={{ width: 96 }}>
                        <FormField label="Packs" digits value={qty[it.invoice_item_id] ?? ''} onChangeText={(t) => setQty((p) => ({ ...p, [it.invoice_item_id]: t }))} error={(errors.lines || {})[it.invoice_item_id]} />
                      </View>
                    </View>
                  ))}
                  {!!(errors.lines || {})._all && <Text style={s.err}>{errors.lines._all}</Text>}
                  <Text style={s.total}>{`Dispatching ${fmt(sendPacks)} packs · ${fmt(Math.round(sendKg * 1000) / 1000)} kg`}</Text>
                </View>
              )}
              <FormField label="Delivery date (YYYY-MM-DD) *" value={date} onChangeText={setDate} error={errors.date} />
              <SelectField label="Transport *" value={mode} options={MODES} onChange={setMode} />
              {mode !== 'CUSTOMER_PICKUP' && <FormField label={mode === 'OWN_VEHICLE' ? 'Vehicle no *' : 'Vehicle no'} value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" error={errors.vehicle} />}
              <FormField label={mode === 'CUSTOMER_PICKUP' ? 'Picked up by' : 'Driver name'} value={driver} onChangeText={setDriver} />
              <FormField label="Driver / contact mobile" digits maxLength={10} value={mobile} onChangeText={setMobile} error={errors.mobile} />
              {(mode === 'TRANSPORT' || mode === 'COURIER') && <FormField label="LR / courier / docket no" value={lr} onChangeText={setLr} />}
              <FormField label="Delivery address" multiline value={address} onChangeText={setAddress} />
              <FormField label="Remarks" value={remarks} onChangeText={setRemarks} />
            </>
          )}
          <ErrorBox text={err} />
        </View>
      )}
    </ModalShell>
  );
}

/* ---------------------------------------------------------------- one delivery ---------------------------------------------------------------- */
function DeliveryDetailModal({ id, canEdit, onDismiss, onChanged }) {
  const { toast } = useUi();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(null);      // null | 'deliver' | 'cancel'
  const [receivedBy, setReceivedBy] = useState('');
  const [reason, setReason] = useState('');
  const [payMode, setPayMode] = useState('CASH');   // how the customer paid when the goods were handed over
  const [paid, setPaid] = useState('');
  const [payRef, setPayRef] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (id == null) return;
    setD(null); setErr(''); setMode(null); setReceivedBy(''); setReason(''); setPayMode('CASH'); setPaid(''); setPayRef('');
    api.get(`/sales/deliveries/${id}`).then((r) => setD(r.data.data)).catch((e) => setErr(errMsg(e)));
  }, [id]);

  const submit = async () => {
    setErr('');
    if (mode === 'cancel' && !reason.trim()) return setErr('Enter the cancel reason');
    const credit = payMode === 'CREDIT';
    if (mode === 'deliver' && !credit) {
      if (!(num(paid) > 0)) return setErr('Enter the amount collected, or choose Credit if nothing was paid');
      if (num(paid) > Number(d.delivery_amount || 0) + 0.009) return setErr(`Amount collected cannot be more than the delivery value (${money(d.delivery_amount)})`);
    }
    setBusy(true);
    try {
      await api.put(`/sales/deliveries/${id}/status`, mode === 'deliver' ? { status: 'DELIVERED', received_by: receivedBy.trim() || undefined, payment_mode: payMode, amount_collected: credit ? 0 : num(paid), payment_ref: payRef.trim() || undefined } : { status: 'CANCELLED', reason: reason.trim() });
      toast(mode === 'deliver' ? 'Marked as delivered' : 'Delivery cancelled');
      onChanged();
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const challan = () => {
    if (!d) return;
    const rows = (d.items || []).map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)} · ${esc(it.packing_size_label)}</td><td>${esc(it.sku_code)}</td><td style="text-align:right">${fmt(it.qty)}</td><td style="text-align:right">${fmt(it.kg)}</td></tr>`).join('');
    const body = `<div class="head"><div class="co">ARAVAI MASALA<small>Delivery Challan</small></div><div class="doc"><b>${esc(d.delivery_no)}</b><div>${esc(niceDate(d.delivery_date))}</div></div></div>`
      + `<h3>Customer</h3><div>${esc(d.customer_name)}${d.mobile ? ` · ${esc(d.mobile)}` : ''}</div><div>${esc(d.delivery_address || '')}</div>`
      + `<h3>Invoice</h3><div>${esc(d.invoice_no)}</div>`
      + `<h3>Transport</h3><div>${esc(modeText(d.transport_mode))}${d.vehicle_no ? ` · ${esc(d.vehicle_no)}` : ''}${d.driver_name ? ` · ${esc(d.driver_name)}` : ''}${d.driver_mobile ? ` · ${esc(d.driver_mobile)}` : ''}${d.lr_no ? ` · LR ${esc(d.lr_no)}` : ''}</div>`
      + `<h3>Items</h3><table><tr><th>#</th><th>Product</th><th>SKU</th><th style="text-align:right">Packs</th><th style="text-align:right">Kg</th></tr>${rows}</table>`
      + `<h3>Total</h3><div style="font-size:16px"><b>${fmt(d.total_qty)} packs · ${fmt(d.total_kg)} kg</b></div>`
      + `<div style="margin-top:48px;display:flex;justify-content:space-between"><div>Dispatched by</div><div>Received by (sign)</div></div>`;
    if (!printHtml(`Delivery-${d.delivery_no}`, body)) toast('Printing is available in the web app');
  };

  const st = d ? (STATUS[d.status] || STATUS.DISPATCHED) : null;
  const open = d && d.status === 'DISPATCHED' && canEdit;
  return (
    <ModalShell visible={id != null} onDismiss={onDismiss} title={d ? d.delivery_no : 'Delivery'} subtitle={d ? `${d.customer_name} · ${d.invoice_no}` : undefined} icon="truck-delivery-outline" maxWidth={600} busy={busy}
      footer={d ? (
        mode ? <ModalFooter onCancel={() => { setMode(null); setErr(''); }} onSave={submit} saving={busy} label={mode === 'deliver' ? 'Confirm delivered' : 'Cancel delivery'} color={mode === 'deliver' ? COLORS.ok : COLORS.danger} />
          : (
            <View style={s.footRow}>
              <SoftBtn icon="printer-outline" label="Challan" onPress={challan} />
              {open && <SoftBtn icon="close-circle-outline" label="Cancel" tone={COLORS.danger} onPress={() => setMode('cancel')} />}
              {open && <SoftBtn icon="check-circle-outline" label="Mark delivered" tone={COLORS.ok} filled onPress={() => { setMode('deliver'); setPaid(String(d.delivery_amount || '')); setPayMode('CASH'); }} />}
            </View>
          )
      ) : null}>
      {!d && !err ? <LoadingView rows={2} /> : !d ? <ErrorBox text={err} /> : (
        <View>
          <View style={{ marginBottom: 10 }}><Badge tone={st.tone} text={st.text} /></View>
          <KV label="Delivery date" value={niceDate(d.delivery_date)} />
          <KV label="Transport" value={modeText(d.transport_mode)} />
          {!!d.vehicle_no && <KV label="Vehicle no" value={d.vehicle_no} />}
          {!!d.driver_name && <KV label="Driver / contact" value={`${d.driver_name}${d.driver_mobile ? ` · ${d.driver_mobile}` : ''}`} />}
          {!!d.lr_no && <KV label="LR / docket no" value={d.lr_no} />}
          {!!d.delivery_address && <KV label="Address" value={d.delivery_address} />}
          {d.status === 'DELIVERED' && <KV label="Received" value={`${d.received_by || '-'}${d.delivered_at ? ` · ${niceDate(String(d.delivered_at).slice(0, 10))}` : ''}`} color={COLORS.ok} />}
          {d.status === 'DELIVERED' && (
            <>
              <KV label="Payment received" value={d.payment_mode ? `${payText(d.payment_mode)}${d.payment_mode === 'CREDIT' ? '' : ` · ${money(d.amount_collected)}`}` : 'Not recorded'} color={d.payment_mode && d.payment_mode !== 'CREDIT' ? COLORS.ok : COLORS.warn} />
              {!!d.payment_ref && <KV label="Payment ref" value={d.payment_ref} />}
              {Number(d.delivery_amount) - Number(d.amount_collected) > 0.009 && <KV label="Balance to collect" value={money(Number(d.delivery_amount) - Number(d.amount_collected))} color={COLORS.warn} bold />}
            </>
          )}
          {d.status === 'CANCELLED' && <KV label="Cancel reason" value={d.cancel_reason || '-'} color={COLORS.danger} />}
          {!!d.remarks && <KV label="Remarks" value={d.remarks} />}
          <Text style={s.sec}>ITEMS</Text>
          {(d.items || []).map((it) => (
            <View key={it.id} style={s.itemRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.lineTitle} numberOfLines={1}>{`${it.product_name} · ${it.packing_size_label}`}</Text>
                <Text style={s.lineSub}>{it.sku_code}</Text>
              </View>
              <Text style={s.itemQty}>{`${fmt(it.qty)} packs · ${fmt(it.kg)} kg`}</Text>
            </View>
          ))}
          <KV label="Total" value={`${fmt(d.total_qty)} packs · ${fmt(d.total_kg)} kg`} bold />
          <KV label="Delivery value" value={money(d.delivery_amount)} bold />
          {mode === 'deliver' && (
            <View style={{ marginTop: 10 }}>
              <FormField label="Received by (name)" value={receivedBy} onChangeText={setReceivedBy} />
              <Text style={s.sec}>PAYMENT COLLECTED AT DELIVERY</Text>
              <SelectField label="Paid by" value={payMode} options={PAY_MODES} onChange={(v) => { setPayMode(v); if (v === 'CREDIT') setPaid('0'); else if (!num(paid)) setPaid(String(d.delivery_amount || '')); }} />
              {payMode !== 'CREDIT' && <FormField label="Amount collected (₹)" value={paid} onChangeText={setPaid} numeric hint={`Delivery value ${money(d.delivery_amount)}`} />}
              {payMode !== 'CREDIT' && payMode !== 'CASH' && <FormField label="Reference / UTR no (optional)" value={payRef} onChangeText={setPayRef} maxLength={60} />}
            </View>
          )}
          {mode === 'cancel' && <FormField label="Cancel reason *" value={reason} onChangeText={setReason} />}
          <ErrorBox text={err} />
        </View>
      )}
    </ModalShell>
  );
}

/* ---------------------------------------------------------------- screen ---------------------------------------------------------------- */
export default function SalesDeliveryScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const route = useRoute();
  const nav = useNavigation();
  const canRef = useRef(can);
  canRef.current = can;
  const { isWide, pad } = useLayout();
  const [data, setData] = useState({ items: [], total: 0, summary: {} });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState(false);
  const [preset, setPreset] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const reqId = useRef(0);

  const load = useCallback(async (mode) => {
    const id = ++reqId.current;
    if (mode === 'refresh') setRefreshing(true); else if (mode !== 'silent') setLoading(true);
    try {
      const r = await api.get('/sales/deliveries', { params: { status: status || undefined, search: search.trim() || undefined, limit, page: 1 } });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) { setLoading(false); setRefreshing(false); }
  }, [status, search, limit]);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    load(first.current ? 'initial' : 'silent'); first.current = false;
    // opened from an invoice ("Deliver" button): navigate('SalesDelivery', { invoiceId })
    const inv = route.params && route.params.invoiceId;
    if (inv && canRef.current('sales_delivery', 'create')) { setPreset(Number(inv)); setForm(true); nav.setParams({ invoiceId: undefined }); }
  }, [load, route.params, nav]));

  const sm = data.summary || {};
  const kpis = [
    { icon: 'clock-outline', color: COLORS.warn, value: fmt(sm.pending_invoices), label: 'Invoices to dispatch', hint: 'Packs not sent yet' },
    { icon: 'truck-fast-outline', color: '#2F80ED', value: fmt(sm.in_transit), label: 'In transit' },
    { icon: 'check-circle-outline', color: COLORS.ok, value: fmt(sm.delivered), label: 'Delivered' },
    { icon: 'close-circle-outline', color: COLORS.danger, value: fmt(sm.cancelled), label: 'Cancelled' },
  ];

  return (
    <View style={s.wrap}>
      <PageToolbar icon="truck-delivery-outline" title="Sales Delivery" subtitle="Dispatch sales invoices and confirm delivery to the customer."
        search={search} onSearch={(t) => { setSearch(t); setLimit(PAGE); }} placeholder="Search delivery, invoice, customer, vehicle"
        addLabel="New Delivery" onAdd={can('sales_delivery', 'create') ? () => { setPreset(null); setForm(true); } : undefined} />
      <Container fill>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 50 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}>
          <KpiGrid items={kpis} min={200} phoneMin={150} />
          <View style={[s.chips, { paddingHorizontal: pad }]}>
            {FILTERS.map((f) => {
              const on = status === f.value;
              return (
                <Pressable key={f.label} onPress={() => { setStatus(f.value); setLimit(PAGE); }} style={[s.chip, on && s.chipOn]} accessibilityRole="button">
                  <Text style={[s.chipText, on && { color: '#fff' }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? <LoadingView rows={4} /> : error && !data.items.length ? <EmptyView error={error} onRetry={() => load('initial')} /> : (
            <View style={{ paddingHorizontal: pad }}>
              {data.items.length === 0 && <EmptyView icon="🚚" message="No deliveries found" />}
              {data.items.map((x) => {
                const st = STATUS[x.status] || STATUS.DISPATCHED;
                return (
                  <Pressable key={x.id} onPress={() => setDetailId(x.id)} style={({ hovered }) => [s.card, SHADOW.sm, hovered && { borderColor: COLORS.primary }]}>
                    <View style={[s.cardTop, !isWide && { flexWrap: 'wrap' }]}>
                      <View style={{ flex: 1, minWidth: 180 }}>
                        <Text style={s.cNo} numberOfLines={1}>{x.delivery_no}</Text>
                        <Text style={s.cSub} numberOfLines={1}>{`${niceDate(x.delivery_date)} · Invoice ${x.invoice_no}`}</Text>
                      </View>
                      <Badge tone={st.tone} text={st.text} />
                    </View>
                    <Text style={s.cCust} numberOfLines={1}>{x.customer_name}</Text>
                    <View style={s.cMeta}>
                      <View style={s.metaItem}><MCI name="package-variant-closed" size={15} color={COLORS.textSoft} /><Text style={s.metaText}>{`${fmt(x.total_qty)} packs · ${fmt(x.total_kg)} kg`}</Text></View>
                      <View style={s.metaItem}><MCI name="truck-outline" size={15} color={COLORS.textSoft} /><Text style={s.metaText} numberOfLines={1}>{`${modeText(x.transport_mode)}${x.vehicle_no ? ` · ${x.vehicle_no}` : ''}`}</Text></View>
                      {!!x.driver_name && <View style={s.metaItem}><MCI name="account-outline" size={15} color={COLORS.textSoft} /><Text style={s.metaText} numberOfLines={1}>{x.driver_name}</Text></View>}
                    </View>
                  </Pressable>
                );
              })}
              {data.items.length < data.total && (
                <View style={{ alignItems: 'center', marginTop: 12 }}><SoftBtn icon="chevron-down" label={`Load more (${data.items.length} of ${data.total})`} onPress={() => setLimit((l) => l + PAGE)} /></View>
              )}
            </View>
          )}
        </ScrollView>
      </Container>

      <DeliveryFormModal visible={form} presetInvoiceId={preset} onDismiss={() => setForm(false)}
        onSaved={(r) => { setForm(false); toast(`Delivery ${r.delivery_no} saved`); load('silent'); setDetailId(r.id); }} />
      <DeliveryDetailModal id={detailId} canEdit={can('sales_delivery', 'edit')} onDismiss={() => setDetailId(null)} onChanged={() => { setDetailId(null); load('silent'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', marginRight: 8, marginBottom: 6 },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, fontWeight: '800', color: COLORS.text },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cNo: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  cSub: { fontSize: 12.5, color: COLORS.textSoft, fontWeight: '600', marginTop: 2 },
  cCust: { fontSize: 14.5, fontWeight: '800', color: COLORS.text, marginTop: 8 },
  cMeta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16, marginTop: 2, maxWidth: 260 },
  metaText: { fontSize: 12.5, color: COLORS.textSoft, fontWeight: '700', marginLeft: 5, flexShrink: 1 },
  box: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: '#FCFAF7' },
  boxTitle: { fontSize: 15, fontWeight: '900', color: COLORS.text },
  boxSub: { fontSize: 12.5, color: COLORS.textSoft, fontWeight: '600', marginBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.line },
  lineTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  lineSub: { fontSize: 12, color: COLORS.textSoft, fontWeight: '600', marginTop: 1 },
  total: { fontSize: 13.5, fontWeight: '900', color: COLORS.primary, marginTop: 8 },
  err: { fontSize: 12, color: COLORS.danger, fontWeight: '700', marginTop: 2 },
  none: { fontSize: 14, color: COLORS.textSoft, fontWeight: '600', paddingVertical: 20, textAlign: 'center' },
  sec: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginTop: 14, marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  itemQty: { fontSize: 13, fontWeight: '800', color: COLORS.text, marginLeft: 10 },
  footRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', flex: 1 },
});
