import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, Image, Pressable, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import SelectField from '../../components/SelectField';
import FormField from '../../components/FormField';
import FormRow from '../../components/FormRow';
import ModalShell from '../../components/ModalShell';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { ErrorBox } from '../../components/FormBits';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import useOptions from '../../hooks/useOptions';
import { W_STATUS_OPTIONS, wStatus, fmtW, imageUri, DATE_RE } from '../../weighing';
import { COLORS, padGrid } from '../../theme';

const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');
const ALL = { value: null, label: 'All' };
const blank = { machine_id: null, operator_id: null, item: null, batch_no: '', from: '', to: '', status: '' };

const Line = ({ k, v, bold }) => (
  <View style={d.line}><Text style={d.k}>{k}</Text><Text style={[d.v, bold && { fontWeight: '900' }]}>{v || '-'}</Text></View>
);

// Detail + review of one transaction: big photo, values, audit trail, admin actions.
function DetailModal({ id, onDismiss, onChanged }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view'); // view | manual | reject
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [big, setBig] = useState(false);

  const load = useCallback(async () => {
    try { setT((await api.get(`/weighing/transactions/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
  }, [id]);
  useEffect(() => { setT(null); setMode('view'); setErr(''); setBig(false); if (id) load(); }, [id, load]);

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); await load(); setMode('view'); setReason(''); toast(okMsg); onChanged(); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const manual = () => {
    const e = {};
    if (reason.trim().length < 5) e.reason = 'Give a reason (at least 5 characters)';
    setErrors(e);
    if (Object.keys(e).length) return;
    run(() => api.post(`/weighing/transactions/${id}/manual-verify`, { reason: reason.trim() }), 'Manual verification saved');
  };
  const reject = () => {
    if (reason.trim().length < 5) return setErrors({ reason: 'Give a reason (at least 5 characters)' });
    setErrors({});
    run(() => api.post(`/weighing/transactions/${id}/reject`, { reason: reason.trim() }), 'Transaction rejected');
  };

  const img = t && imageUri(t);
  const st = t && wStatus(t.status);
  const failed = t && (t.status === 'MISMATCH' || t.status === 'UNREADABLE');
  const canAct = t && can('weighing_review', 'approve');

  return (
    <ModalShell visible={!!id} onDismiss={onDismiss} busy={busy} icon="scale-balance" maxWidth={640} title={t ? t.txn_no : 'Weighing'} subtitle={t ? `${t.machine_code} • ${t.machine_name}` : ''}>
      {error && !t ? <EmptyView error={error} onRetry={load} /> : !t ? <ActivityIndicator style={{ margin: 30 }} color={COLORS.primary} /> : (
        <View>
          <View style={[d.badge, { backgroundColor: st.bg }]}><Text style={[d.badgeText, { color: st.color }]}>{st.label}</Text></View>
          {!!img && (
            <Pressable onPress={() => setBig(!big)}>
              <Image source={{ uri: img }} style={[d.img, big && { height: 480 }]} resizeMode="contain" />
              <Text style={d.tap}>Tap the photo to {big ? 'shrink' : 'enlarge'}</Text>
            </Pressable>)}
          <Line k="Operator" v={t.operator_name} />
          <Line k={t.item_type === 'MATERIAL' ? 'Material' : 'Product'} v={t.item_name} />
          <Line k="Batch" v={t.batch_no} />
          <Line k="Entered weight" v={fmtW(t.entered_weight, t.unit)} bold />
          <Line k="Image detected weight" v={t.detected_weight == null ? 'Not read' : fmtW(t.detected_weight, t.unit)} bold />
          <Line k="Difference" v={t.difference == null ? '-' : fmtW(Math.abs(t.difference), t.unit)} />
          <Line k="Tolerance" v={t.tolerance == null ? '-' : fmtW(t.tolerance, t.unit)} />
          {t.verification_method === 'MANUAL' && <Line k="Verified" v={`Manually by ${t.reviewed_by_name || 'admin'}: ${t.review_reason || ''}`} />}
          <Line k="Date & time" v={when(t.created_at)} />

          {!!(t.history && t.history.length) && (
            <View style={{ marginTop: 14 }}>
              <Text style={d.sec}>HISTORY</Text>
              {t.history.map((h, i) => (
                <View key={i} style={d.hist}>
                  <Text style={d.histMain}>{h.action}{h.by_name ? `  •  ${h.by_name}` : ''}</Text>
                  <Text style={d.histSub}>{when(h.at)}{h.note ? `  •  ${h.note}` : ''}</Text>
                </View>
              ))}
            </View>)}

          {mode === 'manual' && (
            <View style={d.form}>
              <Text style={d.sec}>MANUAL VERIFICATION</Text>
              <Text style={d.help}>Check the photo yourself. Only verify if it shows the entered weight ({fmtW(t.entered_weight, t.unit)}). Your name and reason are saved in the audit history.</Text>
              <FormField label="Reason *" value={reason} onChangeText={setReason} error={errors.reason} maxLength={255} />
            </View>)}
          {mode === 'reject' && (
            <View style={d.form}>
              <Text style={d.sec}>REJECT TRANSACTION</Text>
              <FormField label="Reason *" value={reason} onChangeText={setReason} error={errors.reason} maxLength={255} />
            </View>)}
          <ErrorBox text={err} />

          {canAct && t.status !== 'REJECTED' && t.status !== 'VERIFIED' && (
            <View style={d.actions}>
              {mode === 'view' ? (
                <>
                  {t.has_image && (failed || t.status === 'IMAGE_UPLOADED') && (
                    <Button mode="outlined" icon="refresh" textColor={COLORS.text} style={d.btn} loading={busy} disabled={busy}
                      onPress={() => run(() => api.post(`/weighing/transactions/${id}/reverify`, {}, { timeout: 60000 }), 'Verification run again')}>Re-run OCR</Button>)}
                  {t.has_image && failed && (
                    <Button mode="outlined" icon="pencil" textColor={COLORS.primary} style={[d.btn, { borderColor: COLORS.primary }]} onPress={() => { setErrors({}); setMode('manual'); }}>Manual verify</Button>)}
                  <Button mode="contained" icon="close-circle" buttonColor={COLORS.danger} style={d.btn} onPress={() => { setErrors({}); setReason(''); setMode('reject'); }}>Reject</Button>
                </>
              ) : (
                <>
                  <Button mode="outlined" textColor={COLORS.text} style={[d.btn, { borderColor: COLORS.border }]} disabled={busy} onPress={() => { setMode('view'); setErrors({}); }}>Cancel</Button>
                  <Button mode="contained" icon="check" buttonColor={mode === 'reject' ? COLORS.danger : COLORS.green} style={d.btn} loading={busy} disabled={busy}
                    onPress={mode === 'manual' ? manual : reject}>{mode === 'manual' ? 'Save verification' : 'Confirm reject'}</Button>
                </>
              )}
            </View>)}
        </View>
      )}
    </ModalShell>
  );
}

// Admin: every weighing transaction with filters, photo and review.
export default function WeighingReviewScreen() {
  const { listCols, isPhone } = useLayout();
  const [f, setF] = useState(blank);
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState(null);
  const dBatch = useDebounce(f.batch_no, 400);
  const dFrom = useDebounce(f.from, 400);
  const dTo = useDebounce(f.to, 400);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const machines = useOptions('/machines', {}, (m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}` }));
  const staff = useOptions('/batches/staff', {}, (u) => ({ value: u.id, label: u.full_name }));
  const products = useOptions('/products', {}, (p) => ({ value: `P:${p.id}`, label: `Product: ${p.product_name}` }));
  const materials = useOptions('/materials', {}, (m) => ({ value: `M:${m.id}`, label: `Material: ${m.material_name}` }));
  const items = useMemo(() => [ALL, ...products, ...materials], [products, materials]);

  const params = useMemo(() => ({
    machine_id: f.machine_id || undefined,
    operator_id: f.operator_id || undefined,
    product_id: f.item && f.item.startsWith('P:') ? f.item.slice(2) : undefined,
    material_id: f.item && f.item.startsWith('M:') ? f.item.slice(2) : undefined,
    batch_no: dBatch.trim() || undefined,
    date_from: DATE_RE.test(dFrom) ? dFrom : undefined,
    date_to: DATE_RE.test(dTo) ? dTo : undefined,
    status: f.status || undefined,
  }), [f.machine_id, f.operator_id, f.item, f.status, dBatch, dFrom, dTo]);
  const list = usePagedList('/weighing/transactions', params);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const activeFilters = Object.keys(params).filter((k) => params[k] !== undefined).length;
  const dateErr = (v) => (v && !DATE_RE.test(v) ? 'Use YYYY-MM-DD' : undefined);

  return (
    <View style={s.wrap}>
      <PageToolbar icon="clipboard-check-outline" title="Weighing Review" count={list.total} noun="transaction" search={f.batch_no} onSearch={set('batch_no')}
        placeholder="Search batch number" />
      <Container>
        <FilterChips value={f.status} onChange={set('status')} options={W_STATUS_OPTIONS}>
          <Pressable style={[s.filterBtn, activeFilters > 0 && { borderColor: COLORS.primary }]} onPress={() => setShowFilters(!showFilters)}>
            <MCI name="filter-variant" size={16} color={COLORS.primary} />
            <Text style={s.filterText}>{showFilters ? 'Hide filters' : `Filters${activeFilters ? ` (${activeFilters})` : ''}`}</Text>
          </Pressable>
        </FilterChips>
        {showFilters && (
          <View style={s.filters}>
            <FormRow>
              <SelectField label="Machine" value={f.machine_id} options={[ALL, ...machines]} onChange={set('machine_id')} />
              <SelectField label="Operator" value={f.operator_id} options={[ALL, ...staff]} onChange={set('operator_id')} />
            </FormRow>
            <SelectField label="Product / Material" value={f.item} options={items} onChange={set('item')} />
            <FormRow>
              <FormField label="From (YYYY-MM-DD)" value={f.from} onChangeText={set('from')} error={dateErr(f.from)} maxLength={10} />
              <FormField label="To (YYYY-MM-DD)" value={f.to} onChangeText={set('to')} error={dateErr(f.to)} maxLength={10} />
            </FormRow>
            <Button compact icon="filter-remove" textColor={COLORS.primary} onPress={() => setF(blank)}>Clear all filters</Button>
          </View>)}
      </Container>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <FlatList key={listCols} numColumns={listCols} data={padGrid(list.items, listCols)} keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🧾" message="No weighing transactions found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => {
              if (item.pad) return <View style={{ flex: 1, marginHorizontal: 12 }} />;
              const st = wStatus(item.status);
              const img = imageUri(item);
              return (
                <View style={{ flex: 1 }}>
                  <PressableScale to={0.98} style={s.card} onPress={() => setOpen(item.id)}>
                    {img ? <Image source={{ uri: img }} style={s.thumb} /> : <View style={[s.thumb, s.noThumb]}><MCI name="image-off" size={24} color={COLORS.grey} /></View>}
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={s.name} numberOfLines={1}>{item.machine_code}  •  {item.machine_name}</Text>
                      <Text style={s.line} numberOfLines={1}>{item.operator_name}  •  {item.item_name || '-'}{item.batch_no ? `  •  ${item.batch_no}` : ''}</Text>
                      <Text style={s.weights}>Entered {fmtW(item.entered_weight, item.unit)}   Image {item.detected_weight == null ? '-' : fmtW(item.detected_weight, item.unit)}</Text>
                      <Text style={s.line}>Diff {item.difference == null ? '-' : fmtW(Math.abs(item.difference), item.unit)}  •  {when(item.created_at)}</Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{isPhone ? st.label.split(' ')[0] : st.label}</Text></View>
                  </PressableScale>
                </View>
              );
            }} />
        )}
      </Container>

      <DetailModal id={open} onDismiss={() => setOpen(null)} onChanged={() => list.silentReload()} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  filterBtn: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 19, borderWidth: 1, borderColor: '#EADBD1', backgroundColor: '#fff', paddingHorizontal: 14 },
  filterText: { marginLeft: 6, fontWeight: '800', color: COLORS.primary },
  filters: { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 6, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, marginHorizontal: 12, marginVertical: 7, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  thumb: { width: 72, height: 72, borderRadius: 12, marginRight: 12, backgroundColor: '#1d1210' },
  noThumb: { backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  line: { color: COLORS.grey, fontSize: 13, fontWeight: '600', marginTop: 3 },
  weights: { color: COLORS.text, fontSize: 13.5, fontWeight: '800', marginTop: 3 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
});

const d = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10 },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  img: { width: '100%', height: 240, borderRadius: 14, backgroundColor: '#1d1210' },
  tap: { textAlign: 'center', color: COLORS.grey, fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  k: { color: COLORS.grey, fontWeight: '700' },
  v: { color: COLORS.text, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  sec: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 },
  help: { color: COLORS.grey, fontWeight: '600', marginBottom: 8 },
  hist: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  histMain: { color: COLORS.text, fontWeight: '800', fontSize: 13 },
  histSub: { color: COLORS.grey, fontSize: 12, marginTop: 1 },
  form: { marginTop: 14, backgroundColor: COLORS.bg, borderRadius: 14, padding: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
  btn: { borderRadius: 10, marginRight: 8, marginBottom: 8 },
});
