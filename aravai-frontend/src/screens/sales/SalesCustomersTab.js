import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import ModalShell from '../../components/ModalShell';
import CustomerFormModal from '../../components/CustomerFormModal';
import { Panel, KV, SoftBtn } from '../../components/SalesBits';
import { MiniSelect, Btn } from '../../components/SalesInputs';
import useLayout from '../../hooks/useLayout';
import { CUSTOMER_TYPES, TYPE_STYLE, typeLabel, niceDate } from './salesUtils';
import { COLORS, fmt, money } from '../../theme';

// Customers / Agencies master: search (name, code, phone, city), type + status filters, paging, view and edit.
// GET /sales/customers?search=&type=&active=&page=&limit=   POST /sales/customers   PUT /sales/customers/:id
const TYPE_FILTER = [{ value: '', label: 'All Types' }, ...CUSTOMER_TYPES];
const STATUS_FILTER = [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }, { value: '', label: 'All' }];
const PER_PAGE = [5, 10, 20, 50].map((n) => ({ value: n, label: `${n} per page` }));

function TypePill({ type }) {
  const c = TYPE_STYLE[type] || TYPE_STYLE.CUSTOMER;
  return <View style={[s.pill, { backgroundColor: c.bg }]}><Text style={[s.pillText, { color: c.fg }]} numberOfLines={1}>{typeLabel(type)}</Text></View>;
}
function StatusPill({ on }) {
  return <View style={[s.pill, { backgroundColor: on ? COLORS.okBg : COLORS.greyBg }]}><Text style={[s.pillText, { color: on ? COLORS.ok : COLORS.grey }]}>{on ? 'Active' : 'Inactive'}</Text></View>;
}

function PageBtn({ icon, label, on, disabled, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label || icon}
      style={({ hovered }) => [s.pg, on && s.pgOn, disabled && { opacity: 0.4 }, hovered && !on && !disabled && { borderColor: COLORS.primary }]}>
      {icon ? <MCI name={icon} size={18} color={on ? '#fff' : COLORS.text} /> : <Text style={[s.pgText, on && { color: '#fff' }]}>{label}</Text>}
    </Pressable>
  );
}

export default function SalesCustomersTab({ active, onChanged }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { isPhone } = useLayout();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');     // debounced q
  const [type, setType] = useState('');
  const [status, setStatus] = useState('1');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ open: false, customer: null });
  const [view, setView] = useState(null);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true);
    try {
      const r = await api.get('/sales/customers', { params: { search: search || undefined, type: type || undefined, active: status === '' ? undefined : status, page, limit } });
      if (my === seq.current) { setData(r.data.data); setErr(''); }
    } catch (e) { if (my === seq.current) setErr(errMsg(e)); }
    if (my === seq.current) setBusy(false);
  }, [search, type, status, page, limit]);
  useEffect(() => { if (active) load(); }, [active, load]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const pages = data?.total_pages || 1;
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);
  // up to 5 page numbers around the current page
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);

  const saved = () => { setForm({ open: false, customer: null }); load(); onChanged && onChanged(); toast('Customer saved'); };

  return (
    <View>
      <Panel title="Customers / Agencies" icon="account-group"
        right={can('sales_entry', 'create') ? <Btn icon="plus" label="Add Customer" filled onPress={() => setForm({ open: true, customer: null })} style={{ marginLeft: 0, height: 42 }} /> : null}>
        {/* filters */}
        <View style={[s.filters, isPhone && { flexDirection: 'column' }]}>
          <View style={[s.search, !isPhone && { flex: 1 }]}>
            <MCI name="magnify" size={20} color={COLORS.textSoft} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search by customer name, phone or city..." placeholderTextColor="#B5ABA3" style={s.searchInput} />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><MCI name="close-circle" size={18} color={COLORS.grey} /></Pressable>}
          </View>
          <View style={[s.fWrap, isPhone && { marginLeft: 0, marginTop: 10 }]}>
            <Text style={s.fLabel}>Type</Text>
            <MiniSelect value={type} options={TYPE_FILTER} onChange={(v) => { setType(v); setPage(1); }} title="type" />
          </View>
          <View style={[s.fWrap, isPhone && { marginLeft: 0, marginTop: 10 }]}>
            <Text style={s.fLabel}>Status</Text>
            <MiniSelect value={status} options={STATUS_FILTER} onChange={(v) => { setStatus(v); setPage(1); }} title="status" />
          </View>
          <Pressable onPress={load} accessibilityLabel="Refresh" style={({ hovered }) => [s.refresh, isPhone && { marginLeft: 0, marginTop: 10, alignSelf: 'flex-start' }, hovered && { borderColor: COLORS.primary }]}>
            <MCI name="refresh" size={22} color={COLORS.primary} />
          </Pressable>
        </View>

        {/* table */}
        {!data && !err ? <LoadingView rows={3} /> : !data ? <EmptyView error={err} onRetry={load} /> : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
              <View style={{ flex: 1, minWidth: 940, opacity: busy ? 0.6 : 1 }}>
                <View style={s.thead}>
                  <Text style={[s.th, s.cNo]}>#</Text>
                  <Text style={[s.th, s.cCode]}>Customer Code</Text>
                  <Text style={[s.th, s.cName]}>Customer / Agency Name</Text>
                  <Text style={[s.th, s.cType]}>Type</Text>
                  <Text style={[s.th, s.cMob]}>Mobile</Text>
                  <Text style={[s.th, s.cCity]}>City</Text>
                  <Text style={[s.th, s.cGst]}>GSTIN</Text>
                  <Text style={[s.th, s.cStat]}>Status</Text>
                  <Text style={[s.th, s.cAct, { textAlign: 'center' }]}>Actions</Text>
                </View>
                {items.length === 0 && <Text style={s.none}>{search || type ? 'No customer matches your search.' : 'No customers yet. Tap "Add Customer" to create the first one.'}</Text>}
                {items.map((c, i) => (
                  <View key={c.id} style={[s.tr, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={[s.td, s.cNo]}>{from + i}</Text>
                    <Text style={[s.td, s.cCode]} numberOfLines={1}>{c.customer_code}</Text>
                    <Text style={[s.td, s.cName, { fontWeight: '800' }]} numberOfLines={2}>{c.customer_name}</Text>
                    <View style={s.cType}><TypePill type={c.customer_type} /></View>
                    <Text style={[s.td, s.cMob]} numberOfLines={1}>{c.mobile || '-'}</Text>
                    <Text style={[s.td, s.cCity]} numberOfLines={1}>{c.city || '-'}</Text>
                    <Text style={[s.td, s.cGst]} numberOfLines={1}>{c.gst_number || '-'}</Text>
                    <View style={s.cStat}><StatusPill on={!!c.is_active} /></View>
                    <View style={[s.cAct, { flexDirection: 'row', justifyContent: 'center' }]}>
                      <Pressable onPress={() => setView(c)} accessibilityLabel={`View ${c.customer_name}`} style={s.act}><MCI name="eye-outline" size={19} color={COLORS.text} /></Pressable>
                      {can('sales_entry', 'edit') && (
                        <Pressable onPress={() => setForm({ open: true, customer: c })} accessibilityLabel={`Edit ${c.customer_name}`} style={[s.act, { backgroundColor: COLORS.primarySoft, marginLeft: 8 }]}>
                          <MCI name="pencil-outline" size={18} color={COLORS.primary} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* paging */}
            <View style={[s.foot, isPhone && { flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={s.showing}>{total ? `Showing ${from} to ${to} of ${fmt(total)} customer${total === 1 ? '' : 's'}` : 'No customers'}</Text>
              <View style={[s.pager, isPhone && { marginTop: 10 }]}>
                <View style={{ width: 140, marginRight: 12 }}><MiniSelect value={limit} options={PER_PAGE} onChange={(v) => { setLimit(v); setPage(1); }} title="page size" /></View>
                <PageBtn icon="chevron-double-left" disabled={page <= 1} onPress={() => setPage(1)} />
                <PageBtn icon="chevron-left" disabled={page <= 1} onPress={() => setPage(page - 1)} />
                {nums.map((n) => <PageBtn key={n} label={String(n)} on={n === page} onPress={() => setPage(n)} />)}
                <PageBtn icon="chevron-right" disabled={page >= pages} onPress={() => setPage(page + 1)} />
                <PageBtn icon="chevron-double-right" disabled={page >= pages} onPress={() => setPage(pages)} />
              </View>
            </View>
          </>
        )}
      </Panel>

      <CustomerFormModal visible={form.open} customer={form.customer} onDismiss={() => setForm({ open: false, customer: null })} onSaved={saved} />

      <ModalShell visible={!!view} onDismiss={() => setView(null)} icon="account-outline" maxWidth={480}
        title={view ? view.customer_name : 'Customer'} subtitle={view ? view.customer_code : undefined}
        footer={view && can('sales_entry', 'edit') ? <SoftBtn icon="pencil-outline" label="Edit" filled onPress={() => { const c = view; setView(null); setForm({ open: true, customer: c }); }} /> : null}>
        {!!view && (
          <View>
            <View style={{ flexDirection: 'row', marginBottom: 10 }}><TypePill type={view.customer_type} /><View style={{ width: 8 }} /><StatusPill on={!!view.is_active} /></View>
            <KV label="Contact person" value={view.contact_person || '-'} />
            <KV label="Mobile" value={view.mobile || '-'} />
            <KV label="City" value={view.city || '-'} />
            <KV label="GSTIN" value={view.gst_number || '-'} />
            <KV label="Address" value={view.address || '-'} />
            <KV label="Invoices" value={fmt(view.invoice_count || 0)} />
            <KV label="Total sales" value={money(view.total_sales || 0)} bold />
            {!!view.created_at && <KV label="Added on" value={niceDate(String(view.created_at).slice(0, 10))} />}
          </View>
        )}
      </ModalShell>
    </View>
  );
}

const s = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 14 },
  search: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 12, marginTop: 20 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14.5, fontWeight: '600', color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  fWrap: { width: 200, marginLeft: 14 },
  fLabel: { fontSize: 12.5, fontWeight: '700', color: COLORS.text, marginBottom: 5 },
  refresh: { width: 46, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginLeft: 14 },

  thead: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10 },
  th: { fontSize: 12.5, fontWeight: '800', color: COLORS.text },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  td: { fontSize: 13.5, color: COLORS.text, fontWeight: '600' },
  none: { textAlign: 'center', color: COLORS.grey, fontWeight: '600', paddingVertical: 30 },
  cNo: { width: 34 },
  cCode: { width: 104 },
  cName: { flex: 1.5, minWidth: 150, marginRight: 8 },
  cType: { width: 110 },
  cMob: { width: 110 },
  cCity: { width: 100 },
  cGst: { width: 150 },
  cStat: { width: 84 },
  cAct: { width: 90 },
  act: { width: 34, height: 34, borderRadius: 9, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11.5, fontWeight: '800' },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  showing: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  pager: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pg: { minWidth: 38, height: 38, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginLeft: 6, paddingHorizontal: 6 },
  pgOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pgText: { fontSize: 14, fontWeight: '800', color: COLORS.text },
});
