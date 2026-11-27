import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, Platform } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import ModalShell from '../../components/ModalShell';
import ConfirmDialog from '../../components/ConfirmDialog';
import CustomerFormModal from '../../components/CustomerFormModal';
import SalesDetailModal from '../../components/SalesDetailModal';
import FgStockCardModal from '../../components/FgStockCardModal';
import { NotificationBell } from '../../components/NotificationCenter';
import { Panel } from '../../components/SalesBits';
import { ErrorBox, InfoBox, todayStr } from '../../components/FormBits';
import useLayout from '../../hooks/useLayout';
import { DATE_RE, nextKey, num } from '../../productionUtils';
import { profitColor, r2 } from './salesUtils';
import printInvoice from './printInvoice';
import { COLORS, SHADOW, fmt, money } from '../../theme';

// New Sales Entry: one invoice, many products / SKUs.
// Customer + invoice details, product table (Product -> Packing -> Qty -> Rate -> Amount), live invoice summary.
// On save the server reduces finished goods stock, writes a stock-card row per line and stores the actual cost per pack.
// GET /sales/lookups  ->  { customers, skus }      POST /sales  ->  { id, invoice_no, total_amount }
const blankLine = () => ({ key: nextKey(), product_id: null, rate_id: null, qty: '', rate: '' });
const PAYMENTS = [{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'BANK', label: 'Bank transfer' }, { value: 'CREDIT', label: 'Credit' }];
const money2 = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maskDate = (t) => {
  const d = String(t || '').replace(/[^0-9]/g, '').slice(0, 8);
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
};

// ---- small building blocks (module level, so inputs keep focus while typing) ----
function MiniSelect({ value, options, onChange, placeholder = 'Select', title = 'option', error, disabled, style }) {
  const [open, setOpen] = useState(false);
  const sel = options.find((o) => o.value === value);
  return (
    <>
      <Pressable disabled={disabled} onPress={() => setOpen(true)} accessibilityRole="button"
        style={({ hovered }) => [s.box, error && s.boxErr, disabled && { opacity: 0.55 }, hovered && !disabled && { borderColor: COLORS.primary }, style]}>
        <Text style={[s.boxText, !sel && { color: '#A39890', fontWeight: '500' }]} numberOfLines={1}>{sel ? (sel.short ?? sel.label) : placeholder}</Text>
        <MCI name="chevron-down" size={19} color={COLORS.textSoft} />
      </Pressable>
      <ModalShell visible={open} onDismiss={() => setOpen(false)} title={`Select ${title}`} icon="format-list-bulleted" maxWidth={440} noPad>
        <View style={{ paddingVertical: 6 }}>
          {options.length === 0 && <Text style={s.optEmpty}>No options available</Text>}
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable key={String(o.value)} onPress={() => { onChange(o.value); setOpen(false); }}
                style={({ hovered }) => [s.opt, on && { backgroundColor: COLORS.primarySoft }, hovered && !on && { backgroundColor: COLORS.greyBg }]}>
                <Text style={[s.optText, on && { color: COLORS.primary, fontWeight: '800' }]}>{o.label}</Text>
                {on && <MCI name="check-circle" size={20} color={COLORS.primary} />}
              </Pressable>
            );
          })}
        </View>
      </ModalShell>
    </>
  );
}

function Box({ value, onChange, numeric, digits, error, align = 'right', editable = true, placeholder, maxLength, style }) {
  const handle = (t) => {
    if (numeric) {
      let x = t.replace(/[^0-9.]/g, '');
      const i = x.indexOf('.');
      if (i !== -1) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
      return onChange(x);
    }
    if (digits) return onChange(t.replace(/[^0-9]/g, ''));
    return onChange(t);
  };
  return (
    <TextInput value={value} onChangeText={handle} editable={editable} placeholder={placeholder} placeholderTextColor="#B5ABA3" maxLength={maxLength}
      keyboardType={numeric ? 'decimal-pad' : digits ? 'number-pad' : 'default'}
      style={[s.box, s.input, { textAlign: align }, error && s.boxErr, !editable && s.boxRO, style]} />
  );
}

function DateBox({ value, onChange, error, max }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date', value: value || '', max, onChange: (e) => onChange(e.target.value || ''),
      style: { width: '100%', height: 46, boxSizing: 'border-box', padding: '0 14px', fontSize: 14.5, fontFamily: 'inherit', fontWeight: 600, color: COLORS.text, backgroundColor: '#fff', borderRadius: 12, outline: 'none', border: `1.5px solid ${error ? COLORS.danger : COLORS.border}` },
    });
  }
  return <Box align="left" value={value} onChange={(t) => onChange(maskDate(t))} placeholder="YYYY-MM-DD" maxLength={10} digits={false} error={error} />;
}

function Field({ label, req, error, children, style }) {
  return (
    <View style={[{ marginBottom: 6 }, style]}>
      <Text style={s.label}>{label}{req ? <Text style={{ color: COLORS.danger }}> *</Text> : null}</Text>
      {children}
      {!!error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

function Btn({ icon, label, onPress, filled, tone = COLORS.primary, loading, disabled, style }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered, pressed }) => [s.btn, { borderColor: tone }, filled && { backgroundColor: tone }, hovered && !filled && { backgroundColor: `${tone}12` }, (disabled || loading) && { opacity: 0.6 }, pressed && { opacity: 0.85 }, filled && SHADOW.sm, style]}>
      {loading ? <ActivityIndicator size={16} color={filled ? '#fff' : tone} /> : !!icon && <MCI name={icon} size={18} color={filled ? '#fff' : tone} />}
      <Text style={[s.btnText, { color: filled ? '#fff' : tone }]}>{label}</Text>
    </Pressable>
  );
}

function SumRow({ label, value, color, bold }) {
  return (
    <View style={s.sumRow}>
      <Text style={s.sumLabel}>{label}</Text>
      <Text style={[s.sumValue, bold && { fontWeight: '900' }, color && { color }]}>{value}</Text>
    </View>
  );
}

export default function SalesEntryScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const nav = useNavigation();
  const { isWide, isPhone, pad } = useLayout();
  const [lk, setLk] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(todayStr());
  const [customerId, setCustomerId] = useState(null);
  const [payment, setPayment] = useState(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([blankLine()]);
  const [errors, setErrors] = useState({ lines: {} });
  const [confirm, setConfirm] = useState(false);
  const [printAfter, setPrintAfter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);          // saved invoice { id, invoice_no, total_amount }
  const [addCust, setAddCust] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [stockSku, setStockSku] = useState(null);

  // stock changes whenever packing / sales happen elsewhere, so lookups reload each time the page gets focus (form is kept)
  const loadLookups = useCallback(async () => {
    try { setLk((await api.get('/sales/lookups')).data.data); setLoadErr(''); } catch (e) { setLoadErr(errMsg(e)); }
  }, []);
  useFocusEffect(useCallback(() => { loadLookups(); }, [loadLookups]));

  const skus = lk?.skus || [];
  const customers = lk?.customers || [];
  const customerOptions = customers.map((c) => ({ value: c.id, label: `${c.name}${c.customer_type === 'AGENCY' ? ' · Agency' : ''}${c.city ? ` · ${c.city}` : ''}`, short: c.name }));
  const cust = customers.find((c) => c.id === customerId) || null;
  const productOptions = [];
  skus.forEach((x) => { if (!productOptions.some((p) => p.value === x.product_id)) productOptions.push({ value: x.product_id, label: x.product_name }); });
  const skuOptions = (pid) => skus.filter((x) => x.product_id === pid)
    .map((x) => ({ value: x.packing_rate_id, short: x.packing_size_label, label: `${x.packing_size_label} · ${x.sku_code} · stock ${fmt(x.stock_packs)}` }));

  const setLine = (key, patch) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key, pid) => setLine(key, { product_id: pid, rate_id: null, rate: '' });
  const pickSku = (key, rid) => {
    const x = skus.find((k) => k.packing_rate_id === rid);
    // default selling rate = the SKU's selling rate (last used for this SKU / customer if the server sends it), else its MRP; always editable
    setLine(key, { rate_id: rid, rate: x ? String(x.selling_rate ?? x.mrp ?? '') : '' });
  };
  const removeLine = (key) => setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== key) : p));

  // ---- live figures ----
  const wanted = {};
  lines.forEach((l) => { if (l.rate_id) wanted[l.rate_id] = (wanted[l.rate_id] || 0) + Math.floor(num(l.qty)); });
  const calc = lines.map((l) => {
    const x = skus.find((k) => k.packing_rate_id === l.rate_id);
    const qty = Math.floor(num(l.qty));
    const rate = num(l.rate);
    const amount = r2(qty * rate);
    const cost = x && x.cost_per_pack !== null && x.cost_per_pack !== undefined ? Number(x.cost_per_pack) : null;
    return { x, qty, rate, amount, cost, profit: cost === null ? null : r2(amount - qty * cost) };
  });
  const totalPacks = calc.reduce((a, c) => a + c.qty, 0);
  const gross = r2(calc.reduce((a, c) => a + c.amount, 0));
  const costed = calc.filter((c) => c.cost !== null && c.qty > 0);
  const estProfit = r2(costed.reduce((a, c) => a + (c.amount - c.qty * c.cost), 0));
  const missingCost = calc.some((c) => c.qty > 0 && c.x && c.cost === null);
  const filled = lines.filter((l) => l.rate_id && Math.floor(num(l.qty)) > 0).length;

  const validate = () => {
    const e = { lines: {} };
    if (!customerId) e.customer = 'Select the customer / agency';
    if (!invoiceNo.trim()) e.invoiceNo = 'Enter the invoice no';
    else if (!/^[A-Za-z0-9][A-Za-z0-9/\-_.]*$/.test(invoiceNo.trim())) e.invoiceNo = 'Letters, numbers and - / _ . only';
    if (!DATE_RE.test(date)) e.date = 'Use YYYY-MM-DD';
    else if (date > todayStr()) e.date = 'Date cannot be in the future';
    lines.forEach((l, i) => {
      const c = calc[i];
      const le = {};
      if (!l.product_id) le.product = 'Select the product';
      else if (!l.rate_id) le.sku = 'Select the pack size';
      if (l.rate_id && !(c.qty > 0)) le.qty = 'Enter the packs';
      else if (c.x && wanted[l.rate_id] > Number(c.x.stock_packs)) le.qty = `Only ${fmt(c.x.stock_packs)} packs in stock`;
      if (l.rate_id && !(c.rate > 0)) le.rate = 'Enter the rate';
      if (Object.keys(le).length) e.lines[i] = le;
    });
    setErrors(e);
    return !e.customer && !e.invoiceNo && !e.date && Object.keys(e.lines).length === 0;
  };
  const ask = (print) => { setErr(''); if (validate()) { setPrintAfter(!!print); setConfirm(true); } };

  const save = async () => {
    setConfirm(false); setSaving(true); setErr('');
    try {
      const r = await api.post('/sales', {
        invoice_no: invoiceNo.trim(), sale_date: date, customer_id: customerId, payment_mode: payment || undefined, notes: notes.trim(),
        items: lines.map((l) => ({ packing_rate_id: l.rate_id, quantity: Math.floor(num(l.qty)), rate: num(l.rate) })),
      });
      const inv = r.data.data;
      setDone(inv); toast(`Invoice ${inv.invoice_no} saved`); loadLookups();
      if (printAfter) {
        try { if (!(await printInvoice(inv.id))) toast('Printing is available in the web app'); } catch (e) { toast(errMsg(e)); }
      }
    } catch (e) { setErr(errMsg(e)); }
    setSaving(false);
  };

  const reset = () => { setDone(null); setInvoiceNo(''); setLines([blankLine()]); setNotes(''); setCustomerId(null); setPayment(null); setDate(todayStr()); setErrors({ lines: {} }); setErr(''); };

  // ---- views ----
  const successView = done && (
    <View style={s.doneCard}>
      <View style={s.doneIcon}><MCI name="check-bold" size={34} color="#fff" /></View>
      <Text style={s.doneTitle}>Invoice {done.invoice_no} saved</Text>
      <Text style={s.doneSub}>{`${money(done.total_amount)} · finished goods stock updated`}</Text>
      <View style={s.doneBtns}>
        <Btn icon="receipt" label="View invoice" onPress={() => setViewId(done.id)} style={s.doneBtn} />
        <Btn icon="printer-outline" label="Print" onPress={async () => { try { if (!(await printInvoice(done.id))) toast('Printing is available in the web app'); } catch (e) { toast(errMsg(e)); } }} style={s.doneBtn} />
        <Btn icon="history" label="Sales history" onPress={() => nav.navigate('SalesHistory')} style={s.doneBtn} />
        <Btn icon="plus" label="New entry" filled onPress={reset} style={s.doneBtn} />
      </View>
    </View>
  );

  // one product row (called as a function, not a component, so typing never loses focus)
  const lineRow = (l, i) => {
    const c = calc[i];
    const le = errors.lines?.[i] || {};
    const belowCost = c.cost !== null && c.rate > 0 && c.rate < c.cost;
    const aboveMrp = !!c.x && c.rate > Number(c.x.mrp) && Number(c.x.mrp) > 0;
    const msg = le.product || le.sku || le.qty || le.rate
      || (belowCost ? `Rate is below the actual cost of ${money(c.cost)} per pack: this line sells at a loss.` : aboveMrp ? `Rate is above the MRP of ${money(c.x.mrp)}.` : '');
    const msgErr = !!(le.product || le.sku || le.qty || le.rate);
    return (
      <View key={l.key} style={[s.tr, i === lines.length - 1 && { borderBottomWidth: 0 }]}>
        <View style={s.trLine}>
          <Text style={[s.td, { width: 34 }]}>{i + 1}</Text>
          <View style={s.cProduct}><MiniSelect value={l.product_id} options={productOptions} onChange={(v) => pickProduct(l.key, v)} placeholder="Select product" title="product" error={le.product} /></View>
          <View style={s.cPack}><MiniSelect value={l.rate_id} options={skuOptions(l.product_id)} onChange={(v) => pickSku(l.key, v)} placeholder="Pack" title="pack size" error={le.sku} disabled={!l.product_id} /></View>
          <View style={s.cQty}><Box digits value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} placeholder="0" error={le.qty} align="center" /></View>
          <View style={s.cNum}><Box numeric value={l.rate} onChange={(v) => setLine(l.key, { rate: v })} placeholder="0.00" error={le.rate} /></View>
          <View style={s.cNum}><Box editable={false} value={c.x && c.x.mrp !== null && c.x.mrp !== undefined ? money2(c.x.mrp) : ''} onChange={() => {}} placeholder="-" /></View>
          <Text style={[s.td, s.cAmt, { fontWeight: '900' }]} numberOfLines={1}>{money2(c.amount)}</Text>
          <View style={s.cAct}>
            {c.x && <Pressable onPress={() => setStockSku(c.x)} hitSlop={6} accessibilityLabel="Stock card" style={s.iconBtn}><MCI name="warehouse" size={18} color={COLORS.textSoft} /></Pressable>}
            <Pressable onPress={() => removeLine(l.key)} disabled={lines.length < 2} accessibilityLabel={`Remove item ${i + 1}`} hitSlop={6} style={[s.iconBtn, lines.length < 2 && { opacity: 0.35 }]}>
              <MCI name="trash-can-outline" size={20} color={COLORS.danger} />
            </Pressable>
          </View>
        </View>
        {(!!msg || !!c.x) && (
          <Text style={[s.rowNote, msgErr ? { color: COLORS.danger } : msg ? { color: COLORS.warn } : null]}>
            {msg || `Available: ${fmt(c.x.stock_packs)} packs${c.x.mrp ? ` · MRP ${money(c.x.mrp)}` : ''}`}
          </Text>
        )}
      </View>
    );
  };

  const customerPanel = (
    <Panel title="Customer Details" icon="account" style={isWide ? { width: 360, marginLeft: 14, alignSelf: 'stretch' } : { marginTop: 12 }}>
      {!cust ? (
        <View style={s.custEmpty}>
          <MCI name="account-search-outline" size={34} color="#CDBFB5" />
          <Text style={s.custEmptyText}>Select a customer to see the details here</Text>
        </View>
      ) : (
        <View>
          <Text style={s.custName} numberOfLines={2}>{cust.name}</Text>
          <View style={s.custTags}>
            <View style={s.tag}><Text style={s.tagText}>{cust.customer_type === 'AGENCY' ? 'Agency' : 'Customer'}</Text></View>
            {!!cust.customer_code && <Text style={s.custCode}>{cust.customer_code}</Text>}
          </View>
          {!!cust.contact_person && <View style={s.custRow}><MCI name="account-outline" size={19} color={COLORS.textSoft} /><Text style={s.custText}>{cust.contact_person}</Text></View>}
          {!!cust.address && <View style={s.custRow}><MCI name="map-marker-outline" size={19} color={COLORS.textSoft} /><Text style={s.custText}>{cust.address}</Text></View>}
          {!!cust.mobile && <View style={s.custRow}><MCI name="phone-outline" size={19} color={COLORS.textSoft} /><Text style={s.custText}>{cust.mobile}</Text></View>}
          {!!cust.gst_number && <View style={s.custRow}><MCI name="card-account-details-outline" size={19} color={COLORS.textSoft} /><Text style={s.custText}>{`GST : ${cust.gst_number}`}</Text></View>}
          {!cust.contact_person && !cust.address && !cust.mobile && !cust.gst_number && <Text style={s.custNone}>No address, phone or GST saved for this customer.</Text>}
        </View>
      )}
    </Panel>
  );

  const summaryPanel = (
    <Panel title="Invoice Summary" icon="clipboard-text-outline" style={isWide ? { width: 360, marginLeft: 14, alignSelf: 'stretch' } : { marginTop: 12 }}>
      <SumRow label="Total Items" value={fmt(filled)} bold />
      <SumRow label="Total Qty" value={fmt(totalPacks)} bold />
      <SumRow label="Subtotal" value={money(gross)} bold />
      {costed.length > 0 && <SumRow label="Estimated Profit" value={money(estProfit)} color={profitColor(estProfit)} bold />}
      <View style={s.grand}>
        <Text style={s.grandLabel}>Grand Total</Text>
        <Text style={s.grandValue} numberOfLines={1}>{money(gross)}</Text>
      </View>
      {missingCost && costed.length > 0 && <Text style={s.small}>Profit counts only the SKUs that have a cost recorded.</Text>}
      <ErrorBox text={err} />
    </Panel>
  );

  const row = isWide ? { flexDirection: 'row', alignItems: 'flex-start' } : null;
  const three = { flexDirection: isPhone ? 'column' : 'row' };

  return (
    <View style={s.wrap}>
      <Container fill>
        {!lk && !loadErr ? <LoadingView rows={3} /> : !lk ? <EmptyView error={loadErr} onRetry={loadLookups} /> : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 16, paddingBottom: 60 }}>
            {/* header */}
            <View style={s.head}>
              <View style={s.headIcon}><MCI name="cart-outline" size={isPhone ? 26 : 32} color={COLORS.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.h1, isPhone && { fontSize: 22 }]} numberOfLines={1}>New Sales Entry</Text>
                <Text style={s.h1sub} numberOfLines={2}>Create a new sales invoice with products, packing and pricing.</Text>
              </View>
              <NotificationBell />
            </View>

            {done ? successView : (
              <View>
                {/* customer + customer details */}
                <View style={row}>
                  <Panel title="Customer & Invoice Details" icon="storefront-outline" style={isWide ? { flex: 1, minWidth: 0 } : null}>
                    <Field label="Customer / Agency" req error={errors.customer}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MiniSelect value={customerId} options={customerOptions} onChange={(v) => { setCustomerId(v); setErrors((p) => ({ ...p, customer: undefined })); }}
                          placeholder="Select customer / agency" title="customer / agency" error={errors.customer} style={{ flex: 1 }} />
                        <Btn icon="plus" label={isPhone ? 'Add' : 'Add Customer'} filled onPress={() => setAddCust(true)} style={{ marginLeft: 12 }} />
                      </View>
                    </Field>
                    <View style={[three, { marginTop: 8 }]}>
                      <Field label="Invoice No" req error={errors.invoiceNo} style={s.third}><Box align="left" value={invoiceNo} onChange={(t) => { setInvoiceNo(t); setErrors((p) => ({ ...p, invoiceNo: undefined })); }} placeholder="Enter invoice no" maxLength={30} error={errors.invoiceNo} /></Field>
                      <Field label="Invoice Date" req error={errors.date} style={s.third}><DateBox value={date} onChange={setDate} error={errors.date} max={todayStr()} /></Field>
                      <Field label="Payment Type" style={s.third}><MiniSelect value={payment} options={PAYMENTS} onChange={setPayment} placeholder="Select" title="payment type" /></Field>
                    </View>
                  </Panel>
                  {customerPanel}
                </View>

                {/* products + summary */}
                <View style={[row, { marginTop: 12 }]}>
                  <Panel title="Add Products" icon="package-variant-closed" style={isWide ? { flex: 1, minWidth: 0 } : null}
                    right={<Text style={s.hint}>{`${lines.length} line${lines.length === 1 ? '' : 's'}`}</Text>}>
                    {!skus.length && <InfoBox text="No pack sizes found. Add the product pack sizes in Product & MRP first." />}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
                      <View style={{ flex: 1, minWidth: 800 }}>
                        <View style={s.thead}>
                          <Text style={[s.th, { width: 34 }]}>#</Text>
                          <Text style={[s.th, s.cProduct]}>Product / SKU <Text style={s.star}>*</Text></Text>
                          <Text style={[s.th, s.cPack]}>Packing <Text style={s.star}>*</Text></Text>
                          <Text style={[s.th, s.cQty, { textAlign: 'center' }]}>Qty <Text style={s.star}>*</Text></Text>
                          <Text style={[s.th, s.cNum, { textAlign: 'right' }]}>Rate (₹)</Text>
                          <Text style={[s.th, s.cNum, { textAlign: 'right' }]}>MRP (₹)</Text>
                          <Text style={[s.th, s.cAmt, { textAlign: 'right' }]}>Amount (₹)</Text>
                          <Text style={[s.th, s.cAct, { textAlign: 'center' }]}>Action</Text>
                        </View>
                        {lines.map(lineRow)}
                      </View>
                    </ScrollView>
                    <Pressable onPress={() => setLines((p) => [...p, blankLine()])} accessibilityRole="button"
                      style={({ hovered }) => [s.addLine, hovered && { backgroundColor: COLORS.primarySoft }]}>
                      <MCI name="plus-circle-outline" size={20} color={COLORS.primary} />
                      <Text style={s.addLineText}>Add Another Product</Text>
                    </Pressable>
                  </Panel>
                  {summaryPanel}
                </View>

                {/* notes + actions */}
                <View style={[s.bottom, SHADOW.sm, { flexDirection: isWide ? 'row' : 'column', alignItems: isWide ? 'flex-end' : 'stretch' }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.notesHead}><MCI name="note-text-outline" size={19} color={COLORS.textSoft} /><Text style={s.notesTitle}>Notes (Optional)</Text></View>
                    <TextInput value={notes} onChangeText={setNotes} maxLength={255} multiline placeholder="Add notes, delivery instructions, etc..." placeholderTextColor="#B5ABA3" style={s.notes} />
                  </View>
                  <View style={[s.actions, isWide ? { marginLeft: 20 } : { marginTop: 14 }]}>
                    <Btn label="Clear" onPress={reset} disabled={saving} />
                    <Btn icon="content-save-outline" label="Save Invoice" onPress={() => ask(false)} loading={saving && !printAfter} disabled={saving || !can('sales_entry', 'create')} />
                    <Btn icon="printer-outline" label="Save & Print" filled onPress={() => ask(true)} loading={saving && printAfter} disabled={saving || !can('sales_entry', 'create')} />
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </Container>

      <ConfirmDialog visible={confirm} busy={saving} title="Save this invoice?" confirmText={printAfter ? 'Save & Print' : 'Save Invoice'}
        message={`${cust ? cust.name : ''} · ${fmt(totalPacks)} packs · ${money(gross)}. Finished goods stock will be reduced automatically.`}
        onConfirm={save} onCancel={() => setConfirm(false)} />
      <CustomerFormModal visible={addCust} onDismiss={() => setAddCust(false)}
        onSaved={(c) => { setAddCust(false); loadLookups(); if (c?.id) setCustomerId(c.id); toast('Customer added'); }} />
      <SalesDetailModal visible={viewId !== null} id={viewId} onDismiss={() => setViewId(null)} />
      <FgStockCardModal visible={!!stockSku} sku={stockSku} onDismiss={() => setStockSku(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  h1: { fontSize: 28, fontWeight: '900', color: COLORS.text },
  h1sub: { fontSize: 13.5, color: COLORS.textSoft, fontWeight: '600', marginTop: 2 },
  hint: { color: COLORS.grey, fontSize: 12, fontWeight: '700' },

  label: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  err: { color: COLORS.danger, fontSize: 12, fontWeight: '700', marginTop: 4 },
  star: { color: COLORS.danger },
  third: { flex: 1, marginRight: 12 },

  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 12 },
  boxErr: { borderColor: COLORS.danger },
  boxRO: { backgroundColor: COLORS.greyBg, color: COLORS.textSoft },
  boxText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: COLORS.text, marginRight: 6 },
  input: { fontSize: 14.5, fontWeight: '700', color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 13 },
  optText: { fontSize: 15, color: COLORS.text, fontWeight: '600', flex: 1, marginRight: 8 },
  optEmpty: { textAlign: 'center', color: COLORS.grey, padding: 24 },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 18, marginLeft: 10 },
  btnText: { marginLeft: 7, fontSize: 14, fontWeight: '800' },

  thead: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 8 },
  th: { fontSize: 12.5, fontWeight: '800', color: COLORS.text },
  tr: { paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  trLine: { flexDirection: 'row', alignItems: 'center' },
  td: { fontSize: 14, color: COLORS.text, fontWeight: '600' },
  cProduct: { flex: 1.6, minWidth: 160, marginRight: 8 },
  cPack: { flex: 1, minWidth: 120, marginRight: 8 },
  cQty: { width: 84, marginRight: 8 },
  cNum: { width: 104, marginRight: 8 },
  cAmt: { width: 108, textAlign: 'right', marginRight: 8 },
  cAct: { width: 76, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  rowNote: { marginLeft: 34, marginTop: 5, fontSize: 12, fontWeight: '700', color: COLORS.grey },
  addLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.primary, marginTop: 14, backgroundColor: '#fff' },
  addLineText: { marginLeft: 8, color: COLORS.primary, fontWeight: '800', fontSize: 14.5 },

  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
  sumLabel: { fontSize: 14.5, fontWeight: '600', color: COLORS.text },
  sumValue: { fontSize: 14.5, fontWeight: '800', color: COLORS.text },
  grand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.primarySoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginTop: 10 },
  grandLabel: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  grandValue: { fontSize: 18, fontWeight: '900', color: COLORS.primaryDark, flexShrink: 1, marginLeft: 8 },
  small: { color: COLORS.warn, fontSize: 12, fontWeight: '700', marginTop: 8, lineHeight: 17 },

  custName: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  custTags: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 6 },
  tag: { backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 2 },
  tagText: { fontSize: 11.5, fontWeight: '800', color: COLORS.primary },
  custCode: { marginLeft: 10, fontSize: 12, fontWeight: '700', color: COLORS.grey },
  custRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7 },
  custText: { flex: 1, marginLeft: 12, fontSize: 14.5, fontWeight: '600', color: COLORS.text, lineHeight: 20 },
  custNone: { color: COLORS.grey, fontWeight: '600', fontSize: 13, marginTop: 6 },
  custEmpty: { alignItems: 'center', paddingVertical: 26 },
  custEmptyText: { marginTop: 8, color: COLORS.grey, fontWeight: '600', textAlign: 'center' },

  bottom: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginTop: 12 },
  notesHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  notesTitle: { marginLeft: 8, fontSize: 14.5, fontWeight: '700', color: COLORS.text },
  notes: { minHeight: 56, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: COLORS.text, outlineStyle: 'none' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', marginLeft: -10 },

  doneCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, padding: 32, marginTop: 10 },
  doneIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.ok, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { marginTop: 16, fontSize: 22, fontWeight: '900', color: COLORS.text },
  doneSub: { marginTop: 4, color: COLORS.grey, fontWeight: '600' },
  doneBtns: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 22 },
  doneBtn: { margin: 5, marginLeft: 5 },
});