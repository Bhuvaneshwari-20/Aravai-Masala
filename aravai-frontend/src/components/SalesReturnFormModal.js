import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import DateField from './DateField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { ErrorBox, InfoBox, Label, ModalFooter, todayStr } from './FormBits';
import useOptions from '../hooks/useOptions';
import { DATE_RE, num } from '../productionUtils';
import { CONDITIONS, RETURN_REASONS, RETURN_STATUS, RETURN_TYPES, niceDate, r2 } from '../screens/sales/salesUtils';
import { COLORS, fmt, money } from '../theme';

// Sales Return: pick the invoice, then enter the returned packs per SKU line.
// The server updates finished goods stock when this is saved:
//   RESALABLE lines -> packs come back into stock (stock card: "Sales return")
//   DAMAGED lines   -> recorded, but NOT added to saleable stock
//   REPLACEMENT + Completed -> the same packs are issued again from stock
export default function SalesReturnFormModal({ visible, onDismiss, onSaved }) {
  const invoices = useOptions('/sales', {}, (i) => ({ value: i.id, label: `${i.invoice_no} · ${i.customer_name} · ${niceDate(i.sale_date)}` }), visible);
  const [saleId, setSaleId] = useState(null);
  const [sale, setSale] = useState(null);
  const [lines, setLines] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [type, setType] = useState('REFUND');
  const [status, setStatus] = useState('PENDING');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSaleId(null); setSale(null); setLines([]); setDate(todayStr()); setType('REFUND'); setStatus('PENDING'); setRemarks('');
    setErrors({}); setErr(''); setSaving(false);
  }, [visible]);

  const pickInvoice = async (id) => {
    setSaleId(id); setSale(null); setLines([]); setErr(''); setErrors({}); setLoading(true);
    try {
      const d = (await api.get(`/sales/${id}`)).data.data;
      setSale(d);
      setLines((d.items || []).filter((it) => Number(it.returnable_qty) > 0).map((it) => ({
        item_id: it.id, name: `${it.product_name} · ${it.packing_size_label}`, sku: it.sku_code, rate: Number(it.rate),
        sold: Number(it.quantity), max: Number(it.returnable_qty), qty: '', reason: null, condition: 'RESALABLE',
      })));
    } catch (e) { setErr(errMsg(e)); }
    setLoading(false);
  };
  const setLine = (i, k, v) => setLines((p) => p.map((l, x) => (x === i ? { ...l, [k]: v } : l)));

  const used = lines.filter((l) => Math.floor(num(l.qty)) > 0);
  const totalPacks = used.reduce((a, l) => a + Math.floor(num(l.qty)), 0);
  const totalValue = r2(used.reduce((a, l) => a + Math.floor(num(l.qty)) * l.rate, 0));
  const addBack = used.filter((l) => l.condition === 'RESALABLE').reduce((a, l) => a + Math.floor(num(l.qty)), 0);

  const save = async () => {
    const e = { lines: {} };
    if (!saleId) e.sale = 'Select the invoice';
    if (!DATE_RE.test(date)) e.date = 'Use YYYY-MM-DD';
    else if (sale && date < String(sale.sale_date).slice(0, 10)) e.date = 'Cannot be before the invoice date';
    if (saleId && !used.length) e.none = 'Enter the returned packs for at least one item';
    lines.forEach((l, i) => {
      const q = Math.floor(num(l.qty));
      const le = {};
      if (q > l.max) le.qty = `Only ${fmt(l.max)} can be returned`;
      if (q > 0 && !l.reason) le.reason = 'Select the reason';
      if (Object.keys(le).length) e.lines[i] = le;
    });
    setErrors(e);
    if (e.sale || e.date || e.none || Object.keys(e.lines).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/sales/returns', {
        sale_id: saleId, return_date: date, return_type: type, status, remarks: remarks.trim(),
        items: used.map((l) => ({ sale_item_id: l.item_id, quantity: Math.floor(num(l.qty)), reason: l.reason, condition: l.condition })),
      });
      setSaving(false); onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="keyboard-return" maxWidth={720}
      title="New Sales Return" subtitle="Stock is updated automatically when you save"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={loading || !lines.length} label="Save Return" />}>
      <View>
        <SelectField label="Invoice *" value={saleId} options={invoices} onChange={pickInvoice} error={errors.sale} />
        {loading && <View style={{ padding: 24 }}><ActivityIndicator color={COLORS.primary} /></View>}
        {!!sale && !loading && !lines.length && <InfoBox text="Every pack of this invoice has already been returned." />}

        {lines.length > 0 && (
          <View>
            <FormRow>
              <DateField label="Return date *" value={date} onChangeText={setDate} error={errors.date} />
              <SelectField label="Return type *" value={type} options={RETURN_TYPES} onChange={setType} />
              <SelectField label="Status *" value={status} options={RETURN_STATUS} onChange={setStatus} />
            </FormRow>

            <Label style={{ marginTop: 6 }}>RETURNED ITEMS</Label>
            {lines.map((l, i) => {
              const le = errors.lines?.[i] || {};
              return (
                <View key={l.item_id} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 10 }}>
                  <Text style={{ fontWeight: '800', color: COLORS.text, fontSize: 14 }}>{l.name}</Text>
                  <Text style={{ color: COLORS.grey, fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 10 }}>
                    {`${l.sku}  •  Sold ${fmt(l.sold)}  •  Can return ${fmt(l.max)}  •  ${money(l.rate)} per pack`}
                  </Text>
                  <FormRow>
                    <FormField label="Returned packs" digits value={l.qty} onChangeText={(v) => setLine(i, 'qty', v)} error={le.qty} />
                    <SelectField label="Reason" value={l.reason} options={RETURN_REASONS} onChange={(v) => setLine(i, 'reason', v)} error={le.reason} />
                  </FormRow>
                  <SelectField label="Condition" value={l.condition} options={CONDITIONS} onChange={(v) => setLine(i, 'condition', v)} />
                </View>
              );
            })}
            {!!errors.none && <Text style={{ color: COLORS.danger, fontWeight: '700', marginBottom: 8 }}>{errors.none}</Text>}

            <FormField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} multiline />

            <View style={{ backgroundColor: '#FCFAF7', borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12 }}>
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{`${fmt(totalPacks)} packs  •  ${type === 'REFUND' ? 'Refund' : 'Replacement'} value ${money(totalValue)}`}</Text>
              <Text style={{ color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 4 }}>
                {`${fmt(addBack)} resalable packs will be added back to finished goods stock.`}
                {type === 'REPLACEMENT' && status === 'COMPLETED' ? ` ${fmt(totalPacks)} replacement packs will be issued from stock.` : ''}
              </Text>
            </View>
          </View>
        )}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
