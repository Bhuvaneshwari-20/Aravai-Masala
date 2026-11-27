import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet, Pressable } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PackingFormModal from '../../components/PackingFormModal';
import PackingDetailModal from '../../components/PackingDetailModal';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import ConfirmDialog from '../../components/ConfirmDialog';
import { COLORS, fmt } from '../../theme';

// Packing, shown like Blending / Grinding: one card per batch + status chips + History tab.
// The Packing Entry form and its workflow are NOT changed: one entry = one pack size from one batch, as before.
// Open a batch -> its packing entries -> "New packing entry" opens the same form with that batch already selected.
const STATUS = {
  PENDING: { label: 'PENDING', color: COLORS.grey, bg: COLORS.greyBg, icon: 'timer-sand-empty' },
  IN_PROGRESS: { label: 'IN PROGRESS', color: COLORS.primary, bg: `${COLORS.primary}14`, icon: 'package-variant' },
  WAITING: { label: 'WAITING', color: COLORS.warn, bg: COLORS.warnBg, icon: 'clock-outline' },
  COMPLETED: { label: 'COMPLETED', color: COLORS.ok, bg: COLORS.okBg, icon: 'check-circle-outline' },
  CANCELLED: { label: 'CANCELLED', color: COLORS.danger, bg: COLORS.dangerBg, icon: 'close-circle-outline' },
};
const dmy = (d) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '–'); };
const CHIP_LABEL = { IN_PROGRESS: 'In progress', PENDING: 'Pending', WAITING: 'Waiting', COMPLETED: 'Completed' };
const accentOf = (k) => (k === 'COMPLETED' ? COLORS.ok : k === 'IN_PROGRESS' ? COLORS.primary : k === 'WAITING' ? COLORS.warn : COLORS.border);

function Chip({ st }) {
  return (
    <View style={[s.chip, { backgroundColor: st.bg }]}>
      <MCI name={st.icon} size={13} color={st.color} />
      <Text style={[s.chipText, { color: st.color }]}>{st.label}</Text>
    </View>
  );
}
const Row = ({ icon, label, value, strong, color }) => (
  <View style={s.row}>
    <MCI name={icon} size={15} color={COLORS.grey} />
    <Text style={s.rowLabel}>{label}</Text>
    <Text style={[s.rowValue, strong && { fontWeight: '900' }, color && { color }]} numberOfLines={1}>{value}</Text>
  </View>
);
const Stat = ({ label, value, strong, color, wide }) => (
  <View style={[s.statWrap, wide && { width: '100%' }]}>
    <View style={s.stat}>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={[s.statValue, strong && { fontWeight: '900' }, color && { color }]} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);
const StatGrid = ({ children }) => <View style={s.statGrid}>{children}</View>;
const ProgressBar = ({ pct, color }) => <View style={s.pbTrack}><View style={[s.pbFill, { width: `${Math.max(Math.min(pct, 100), 0)}%`, backgroundColor: color }]} /></View>;
const pctOf = (g) => (g.output_kg > 0 ? Math.round((g.packed_kg / g.output_kg) * 100) : 0);

/* ------------------------------ batch card (list) ------------------------------ */
function BatchCard({ g, canAdd, onForm, onPage, canClose, onClose }) {
    const accent = accentOf(g.status);
  const tint = accent === COLORS.border ? COLORS.primary : accent;
  const leftover = g.status === 'COMPLETED' && g.left_kg > 0.001;
  return (
    <Pressable onPress={canAdd ? onForm : onPage} accessibilityRole="button" accessibilityLabel={canAdd ? `Add packing entry for ${g.batch_no}` : `Open batch ${g.batch_no}`}
      style={({ hovered }) => [s.bcard, { borderColor: accent }, hovered && s.bcardHover]}>
      <View style={s.head}>
        <View style={[s.bIcon, { backgroundColor: `${tint}14` }]}><MCI name="package-variant-closed" size={24} color={tint} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bNo} numberOfLines={1}>{g.batch_no}</Text>
          <Text style={s.sub} numberOfLines={1}>{g.product_name}</Text>
        </View>
        <MCI name="chevron-right" size={24} color={COLORS.grey} />
      </View>
      <View style={s.tags}>
        <View style={s.tag}><MCI name="layers-outline" size={12} color={COLORS.grey} />
          <Text style={s.tagText}>{g.runs} packing entr{g.runs === 1 ? 'y' : 'ies'}</Text></View>
        {!!g.sizes && <View style={s.tag}><MCI name="weight-gram" size={12} color={COLORS.grey} /><Text style={s.tagText}>{g.sizes}</Text></View>}
        {g.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
      </View>
      <View style={s.statRow}><Chip st={STATUS[g.status]} /></View>
      <View style={{ marginTop: 10 }}>
        <ProgressBar pct={pctOf(g)} color={tint} />
        <Text style={s.pbText}>{g.status === 'WAITING' ? g.reason : `${fmt(g.packed_kg)} of ${fmt(g.output_kg)} kg packed`}</Text>
      </View>
      <Row icon="weight-kilogram" label="Blended quantity" value={`${fmt(g.output_kg)} kg`} strong />
      {g.status === 'COMPLETED'
        ? <Row icon="check-all" label={leftover ? 'Left unpacked' : 'Packing'} value={leftover ? `${fmt(g.left_kg)} kg` : 'Done'} color={leftover ? COLORS.warn : COLORS.ok} strong />
        : <Row icon="package-down" label="Left to pack" value={`${fmt(g.left_kg)} kg`} strong />}
      {g.runs > 0 && <Row icon="package-variant" label="Packets" value={`${fmt(g.accepted_bags)} accepted · ${fmt(g.rejected_bags)} rejected`} color={g.rejected_bags ? COLORS.danger : undefined} />}
<View style={s.foot}>
  {canAdd && (
    <View style={s.addHint}><MCI name="plus-circle-outline" size={16} color={COLORS.green} /><Text style={s.addHintText}>Tap to add a packing entry</Text></View>
  )}
    {canClose && (
    <Pressable onPress={g.can_complete ? onClose : undefined} disabled={!g.can_complete} hitSlop={8} style={[s.closeBtn, !g.can_complete && { opacity: 0.45 }]}>
      <MCI name="check-circle-outline" size={16} color={COLORS.warn} />
      <Text style={s.closeText}>
        {g.can_complete ? `Complete batch · ${fmt(g.left_kg)} kg as wastage` : `Complete batch (enabled when less than ${fmt(g.min_pack_g)} g is left)`}
      </Text>
    </Pressable>
  )}
  {g.runs > 0 && (
    <Pressable onPress={onPage} hitSlop={8} style={s.viewLinkRow}>
      <Text style={s.viewText}>View packing entries</Text><MCI name="chevron-right" size={18} color={COLORS.primary} />
    </Pressable>
  )}
</View>
    </Pressable>
  );
}

// Top of the "packing entries of this batch" page.
function BatchHeader({ g, onBack }) {
  const accent = accentOf(g.status);
  const tint = accent === COLORS.border ? COLORS.primary : accent;
  return (
    <View style={[s.bh, { borderLeftColor: tint }]}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to all batches"
        style={({ hovered }) => [s.bhBack, hovered && { backgroundColor: COLORS.primarySoft }]}>
        <MCI name="arrow-left" size={20} color={COLORS.primary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <Text style={s.bhNo} numberOfLines={1}>{g.batch_no}</Text>
        <Text style={s.sub} numberOfLines={1}>{g.product_name}  •  {fmt(g.output_kg)} kg blended  •  {fmt(g.left_kg)} kg left</Text>
        <View style={s.tags}><Chip st={STATUS[g.status]} /></View>
        <ProgressBar pct={pctOf(g)} color={tint} />
        <Text style={s.pbText}>{fmt(g.packed_kg)} of {fmt(g.output_kg)} kg packed</Text>
      </View>
    </View>
  );
}

/* ------------------------------ packing entries (unchanged cards) ------------------------------ */
function EntryCard({ item, onOpen }) {
  const st = STATUS[item.status] || STATUS.COMPLETED;
  return (
    <View style={[s.card, { borderLeftWidth: 5, borderLeftColor: st.color }]}>
      <View style={s.head}>
        <View style={[s.mIcon, { backgroundColor: st.bg }]}><MCI name={st.icon} size={22} color={st.color} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.mat} numberOfLines={1}>{item.packing_size_label}  ·  {item.sku_code}</Text>
          <Text style={s.sub} numberOfLines={1}>{item.batch_no}  •  {item.product_name}</Text>
        </View>
        <Chip st={st} />
      </View>
      <StatGrid>
        <Stat label="MACHINE" value={item.machine_name || '–'} wide />
        <Stat label="PACKING DATE" value={dmy(item.packing_date)} />
        {item.packing_code ? <Stat label="PACKING CODE" value={item.packing_code} strong /> : null}
        <Stat label="TOTAL PACKETS" value={fmt(item.total_bag_count)} />
        <Stat label="ACCEPTED" value={fmt(item.accepted_bag_count)} color={COLORS.ok} strong />
        <Stat label="REJECTED" value={fmt(item.rejected_bag_count)} color={item.rejected_bag_count ? COLORS.danger : undefined} />
        <Stat label="PACKED" value={`${fmt(item.total_packing_weight)} kg`} strong />
        {item.use_by_date ? <Stat label="USE BY" value={dmy(item.use_by_date)} /> : null}
      </StatGrid>
      <Text style={s.byLine}>Packed by {item.operator_name}</Text>
      <Pressable onPress={() => onOpen(item.id)} style={s.viewLink}><Text style={s.viewText}>View full details</Text><MCI name="chevron-right" size={18} color={COLORS.primary} /></Pressable>
    </View>
  );
}

function EntriesList({ batchId, search, onOpen, emptyText, full }) {
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const list = usePagedList('/packing', { search: search || undefined, batch_id: batchId || undefined });
  if (list.loading) return <LoadingView />;
  if (list.error && !list.items.length) return <EmptyView error={list.error} onRetry={list.reload} />;
  return (
    <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
      onEndReached={list.loadMore} onEndReachedThreshold={0.4}
      ListEmptyComponent={<EmptyView icon="📫" message={emptyText} />}
      ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
      renderItem={(item, i) => {
        if (full) return <EntryCard item={item} onOpen={onOpen} />;
        const packed = Number(item.batch_packed_kg) || 0;
        const left = Math.max(Number(item.batch_output_kg) - packed, 0);
        const closed = item.batch_status === 'COMPLETED';            // user closed the batch
        const done = closed || (packed > 0 && left <= 0.001);        // closed, or everything packed
        const leftover = done && left > 0.001;                       // closed but masala was left
        return (
          <InfoCard index={i} icon="package-variant-closed" color="#B45309" value={item.batch_no} size="md"
            caption={`${item.product_name} · ${item.packing_size_label}`}
            right={<ChevronDot />} onPress={() => onOpen(item.id)}
            footer={done ? <Badge tone={leftover ? 'warn' : 'ok'} text={leftover ? `Packing done · ${fmt(left)} kg left` : 'Packing done'} /> : null}>
            <InfoStats items={[
              { label: 'TOTAL PACKETS', value: fmt(item.total_bag_count) },
              { label: 'ACCEPTED', value: fmt(item.accepted_bag_count), color: COLORS.ok },
              { label: 'REJECTED', value: fmt(item.rejected_bag_count), color: item.rejected_bag_count ? COLORS.danger : undefined },
              { label: 'PACKED', value: `${fmt(item.total_packing_weight)} kg` },
            ]} />
            <InfoLine icon="calendar-blank-outline" text={`${item.packing_date}  •  ${item.sku_code}`} />
            <InfoLine icon="cog-outline" text={item.machine_name} />
            <InfoLine icon="account-outline" text={item.operator_name} />
          </InfoCard>
        );
      }} />
  );
}

/* ------------------------------ the board ------------------------------ */
export default function PackingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const canAct = can('packing', 'create');
  const grid = useCardCols({ min: 320, phoneMin: 280 });
  const [tab, setTab] = useState('queue');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selBatch, setSelBatch] = useState(null);       // batch opened (null = list of batches)
  const [formBatch, setFormBatch] = useState(undefined); // undefined = form closed, null = open with no batch, number = open with that batch
  const [detailId, setDetailId] = useState(null);       // packing entry opened in the details view
  const [bump, setBump] = useState(0);                  // re-loads the entries lists after a save


    const [closeFor, setCloseFor] = useState(null);       // batch the user wants to complete (leftover = wastage)
  const [closing, setClosing] = useState(false);
  const load = useCallback(async (quiet) => {
    try {
      const r = await api.get('/packing/queue', { params: { search: dSearch || undefined } });
      setData(r.data.data); setError('');
    } catch (e) { if (!quiet) setError(errMsg(e)); }
  }, [dSearch]);
  useEffect(() => { setData(null); load(false); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));
  useEffect(() => { const t = setInterval(() => load(true), 20000); return () => clearInterval(t); }, [load]);   // other users' changes

  const batchList = useMemo(() => (data ? data.items.filter((g) => status === 'ALL' || g.status === status) : []), [data, status]);
  const detail = selBatch && data ? data.items.find((g) => g.batch_id === selBatch) || null : null;
  useEffect(() => { if (selBatch && data && !data.items.some((g) => g.batch_id === selBatch)) setSelBatch(null); });   // batch left the board: back to the list
  const chips = [{ value: 'ALL', label: `All${data ? ` (${data.counts.ALL})` : ''}` }].concat(
    ['PENDING', 'IN_PROGRESS', 'WAITING', 'COMPLETED'].map((k) => ({ value: k, label: `${CHIP_LABEL[k]}${data ? ` (${data.counts[k]})` : ''}` })));
  // more can be packed: tapping the batch card opens the Packing Entry form with that batch already selected
  const canAddTo = (g) => canAct && (g.status === 'PENDING' || g.status === 'IN_PROGRESS') && g.left_kg > 0.001;



    const canCloseBatch = (g) => canAct && g.status === 'IN_PROGRESS' && g.left_kg > 0.001;
  const closeNow = async () => {
    setClosing(true);
    try {
      await api.post(`/packing/batches/${closeFor.batch_id}/close`);
      setCloseFor(null); setBump((n) => n + 1); load(true);
      toast('Batch completed. Packing done');
    } catch (e) { setCloseFor(null); toast(errMsg(e)); }
    setClosing(false);
  };

  // after a save the batch page opens, so the new entry is shown right away with its full details
  const saved = (closed) => {
    const bid = formBatch;
    setFormBatch(undefined); setBump((n) => n + 1); load(true);
    if (bid) { setSelBatch(bid); setStatus('ALL'); }
    toast(closed ? 'Packing saved. Batch completed' : 'Packing saved');
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="package-variant-closed" title="Packing" count={tab === 'queue' ? (detail ? undefined : batchList.length) : undefined} noun={tab === 'queue' && !detail ? 'batch' : undefined}

        search={search} onSearch={setSearch} placeholder="Search batch / product / pack" />
      <Container>
        <View style={{ paddingHorizontal: 23 }}>
          <FilterChips options={[{ value: 'queue', label: 'Batches' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
          {tab === 'queue' && detail && <BatchHeader g={detail} onBack={() => { setSelBatch(null); setStatus('ALL'); }} />}
          {tab === 'queue' && !detail && <FilterChips options={chips} value={status} onChange={setStatus} />}
        </View>
      </Container>
      <Container fill>
        {tab === 'history' ? <EntriesList key={`h${bump}`} search={dSearch} onOpen={setDetailId} emptyText="No packing entries yet" />
          : !data && !error ? <LoadingView />
            : error && !data ? <EmptyView error={error} onRetry={() => load(false)} />
              : detail ? (
                // ----- packing entries of the opened batch -----
                <EntriesList key={`e${detail.batch_id}-${bump}`} batchId={detail.batch_id} onOpen={setDetailId} full
                  emptyText="No packing entries for this batch yet" />
              ) : (
                // ----- one card per batch -----
                <CardList {...grid} key={`batches-${status}-${grid.cols}`} data={batchList} keyExtractor={(g) => `b${g.batch_id}`}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListEmptyComponent={<EmptyView icon="📫" message={`No batches ${status === 'ALL' ? 'yet' : 'with this status'}. Batches appear here after Blending.`} />}
                  renderItem={(g) => <BatchCard g={g} canAdd={canAddTo(g)} canClose={canCloseBatch(g)} onClose={() => setCloseFor(g)} onForm={() => setFormBatch(g.batch_id)} onPage={() => { setSelBatch(g.batch_id); setStatus('ALL'); }} />} />              
              )}
      </Container>

      <PackingDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
      <PackingFormModal visible={formBatch !== undefined} initialBatchId={formBatch || null} onDismiss={() => setFormBatch(undefined)} onSaved={saved} />
          <ConfirmDialog visible={!!closeFor} busy={closing} title="Complete this batch?" confirmText="Yes, complete"
        message={closeFor ? `${closeFor.batch_no}: ${fmt(closeFor.left_kg)} kg powder is left. It will be counted as wastage and the batch will be marked as packing completed.` : ''}
        onConfirm={closeNow} onCancel={() => setCloseFor(null)} />
    
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center' },
  bcard: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, padding: 16, marginBottom: 4,
    shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  bcardHover: { backgroundColor: COLORS.bg },
  bIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  bNo: { fontSize: 19, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4, marginLeft: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: 2 },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginBottom: 4 },
  tagText: { fontSize: 11, fontWeight: '800', color: COLORS.grey, marginLeft: 4 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 2 },
  pbTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.greyBg, overflow: 'hidden' },
  pbFill: { height: 8, borderRadius: 4 },
  pbText: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { marginLeft: 7, fontSize: 12.5, fontWeight: '700', color: COLORS.grey, width: 132 },
  rowValue: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.text, textAlign: 'right' },
  bh: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border, borderLeftWidth: 6,
    padding: 14, marginHorizontal: 12, marginTop: 4, marginBottom: 6 },
  bhBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  bhNo: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 4,
    shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  mIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  mat: { fontSize: 17, fontWeight: '900', color: COLORS.text, letterSpacing: -0.1 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginTop: 6 },
  statWrap: { width: '50%', padding: 4 },
  stat: { backgroundColor: '#FAF7F3', borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, paddingVertical: 9, paddingHorizontal: 11, minHeight: 56, justifyContent: 'center' },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: COLORS.grey },
  statValue: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginTop: 3 },
  byLine: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 8, marginLeft: 2 },
foot: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.line },
viewLinkRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 6 },
  addHint: { flexDirection: 'row', alignItems: 'center' },
  addHintText: { marginLeft: 5, fontSize: 12.5, fontWeight: '800', color: COLORS.green },
  viewLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  viewText: { color: COLORS.primary, fontWeight: '800', fontSize: 13 },
    closeBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  closeText: { marginLeft: 5, fontSize: 12.5, fontWeight: '800', color: COLORS.warn },

});