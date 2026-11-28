import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import BatchingEntryModal from '../../components/BatchingEntryModal';
import BatchMaterialEditModal from '../../components/BatchMaterialEditModal';
import { materialBadge, materialStage, canEditMaterial, canDeleteMaterial, stageSummary, ROAST_MODE_TEXT, PROCESS_MODE_TEXT } from '../../batchMaterialStatus';
import WeightImageViewer from '../../components/WeightImageViewer';
import ConfirmDialog from '../../components/ConfirmDialog';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { ErrorBox } from '../../components/FormBits';
import { badgeFor, stageLabel } from './BatchListScreen';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS, fmt } from '../../theme';

// Columns of the weighed-materials table. `flex` columns stretch to fill the card, the others have a fixed width.
const SHEET_COLS = [
  { key: 'date', label: 'DATE', w: 96 },
  { key: 'code', label: 'CODE', w: 92 },
  { key: 'name', label: 'MATERIAL NAME', flex: 1, min: 150 },
  { key: 'bags', label: 'BAGS', w: 64, center: true },
  { key: 'wt', label: 'WEIGHT', w: 112 },
  { key: 'qty', label: 'WEIGHED QTY', w: 112 },
  { key: 'img', label: 'PHOTO', w: 72, center: true },
  { key: 'status', label: 'STATUS', w: 200 },
  { key: 'act', label: 'ACTIONS', w: 84, center: true },
];
const colStyle = (c) => (c.flex ? { flex: c.flex, minWidth: c.min } : { width: c.w });
const COL = Object.fromEntries(SHEET_COLS.map((c) => [c.key, c]));
const cs = (k) => [colStyle(COL[k]), COL[k].center && { alignItems: 'center' }];
const ct = (k) => (COL[k].center ? { textAlign: 'center' } : null);

// small grey pill with an icon: date, total, machine, process
const MetaChip = ({ icon, text }) => (
  <View style={s.metaChip}>
    <MCI name={icon} size={14} color={COLORS.grey} />
    <Text style={s.metaChipText} numberOfLines={1}>{text}</Text>
  </View>
);

export default function BatchDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const { toast } = useUi();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [weigh, setWeigh] = useState(null);       // ingredient being weighed
  const [viewImg, setViewImg] = useState(null);   // ingredient whose weighing machine photo is open
  const [editMat, setEditMat] = useState(null);       // ingredient being edited
  const [delMat, setDelMat] = useState(null);         // ingredient waiting for delete confirmation
  const [confirmDone, setConfirmDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setB((await api.get(`/batches/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn, okMsg) => {
    setBusy(true); setErr('');
    try { await fn(); await load(); if (okMsg) toast(okMsg); return true; } catch (e) { setErr(errMsg(e)); return false; } finally { setBusy(false); }
  };

  if (error && !b) return <EmptyView error={error} onRetry={load} />;
  if (!b) return <LoadingView />;

  const st = badgeFor(b);
  const plan = b.plan;
  const batchingOpen = b.status === 'IN_PROGRESS' && b.current_stage === 'BATCHING';
  const batchingDone = b.current_stage !== 'BATCHING';
  // Edit (add a material) is possible on a running batch until Roasting starts. The server checks the roasting entries again.
  // Add / edit / delete a material is possible on a running batch while it is at Batching, Filtering or Roasting. The server checks every material again.
  const canEdit = can('batching', 'edit') && b.status === 'IN_PROGRESS' && ['BATCHING', 'FILTERING', 'ROASTING'].includes(b.current_stage);
  const doneMats = plan ? plan.ingredients.filter((i) => i.is_done) : [];
  const summary = stageSummary(doneMats);
  const pairNames = [...new Set(doneMats.filter((i) => i.roast_partner_id && i.roast_partner_name).map((i) => [i.material_name, i.roast_partner_name].sort().join(' + ')))];

  const machineName = plan && (plan.ingredients.find((i) => i.weighing_machine_name) || {}).weighing_machine_name;
  const doneRows = plan ? plan.ingredients.filter((i) => i.is_done) : [];
  const pendingRows = plan ? plan.ingredients.filter((i) => !i.is_done) : [];
  const showProgress = !batchingOpen && doneMats.length > 0 && b.status !== 'COMPLETED';

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }}>
      <Container>
        {/* ---------- header card ---------- */}
        <View style={s.head}>
          <View style={s.headTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title}>{b.batch_no}</Text>
              <Text style={s.sub}>{b.product_name}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text></View>
          </View>
          <View style={s.metaRow}>
            <MetaChip icon="calendar-month-outline" text={String(b.production_date).slice(0, 10)} />
            <MetaChip icon="scale-balance" text={`Total ${fmt(b.planned_qty_kg)} kg`} />
            {!!machineName && <MetaChip icon="scale" text={machineName} />}
            <MetaChip icon={b.process_mode === 'SIMULTANEOUS' ? 'call-split' : 'arrow-right-bold-outline'} text={b.process_mode === 'SIMULTANEOUS' ? 'Simultaneous' : 'Sequential'} />
            {b.status !== 'COMPLETED' && b.status !== 'CANCELLED' && <MetaChip icon="progress-clock" text={`Now: ${stageLabel(b.current_stage)}`} />}
          </View>
          {b.status === 'ON_HOLD' && <Text style={s.hold}>On hold: {b.hold_reason}</Text>}
          {(can('batching', 'approve') && b.status === 'ON_HOLD') && (
            <View style={s.btns}>
              {/* Hold and Add Material buttons removed. Batches that are already on hold can still be resumed. */}
              {can('batching', 'approve') && b.status === 'ON_HOLD' && (
                <Button mode="contained" icon="play" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy}
                  onPress={() => run(() => api.patch(`/batches/${id}/resume`), 'Batch resumed')}>Resume</Button>)}
            </View>
          )}
        </View>

        {!!plan && (
          <View style={s.section}>
            <View style={s.secHead}>
              <Text style={s.secTitle}>BATCHING</Text>
              <Text style={s.progress}>{batchingOpen ? `${plan.done_count} of ${plan.ingredients.length} materials weighed  •  ` : `${plan.done_count} materials  •  `}{fmt(plan.total_weighed_kg)} kg{plan.total_required_kg != null ? ` of ${fmt(plan.total_required_kg)} kg` : ''}</Text>
            </View>

            {/* where the materials are now (filtering / roasting) - the batch stage follows these */}
            {showProgress && (
              <View style={s.note}>
                <MCI name="information-outline" size={18} color={COLORS.green} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  {!!summary && <Text style={s.noteTitle}>{summary}</Text>}
                  {!!PROCESS_MODE_TEXT[b.process_mode] && <Text style={s.noteText}>{PROCESS_MODE_TEXT[b.process_mode]}</Text>}
                  {pairNames.length > 0 && <Text style={s.noteText}>{`Roasting pairs: ${pairNames.join('  |  ')}`}</Text>}
                  {!PROCESS_MODE_TEXT[b.process_mode] && !!b.roasting_mode && !!ROAST_MODE_TEXT[b.roasting_mode] && <Text style={s.noteText}>{ROAST_MODE_TEXT[b.roasting_mode]}</Text>}
                  {doneMats.some((i) => materialStage(i) === 'FILTERING') && <Text style={s.noteText}>Materials waiting for filtering go to roasting only after their filtering is completed.</Text>}
                </View>
              </View>
            )}

            {/* Sheet: same information as the paper "ARAVAI BATCHING PROCESS PLAN" */}
            {doneRows.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tableScroll} contentContainerStyle={{ minWidth: '100%' }}>
                <View style={{ flex: 1, minWidth: 940 }}>
                  <View style={[s.tr, s.trHead]}>
                    {SHEET_COLS.map((c) => <Text key={c.key} style={[s.th, colStyle(c), c.center && { textAlign: 'center' }]} numberOfLines={1}>{c.label}</Text>)}
                  </View>
                  {doneRows.map((i, n) => {
                    const mb = materialBadge(i);
                    return (
                      <View key={i.material_id} style={[s.tr, n === doneRows.length - 1 && { borderBottomWidth: 0 }]}>
                        <Text style={[s.td, colStyle(COL.date)]}>{String(i.entry_date || '').slice(0, 10)}</Text>
                        <View style={colStyle(COL.code)}><View style={s.codePill}><Text style={s.codeText}>{i.material_code}</Text></View></View>
                        <Text style={[s.td, s.tdName, colStyle(COL.name)]} numberOfLines={2}>{i.material_name}</Text>
                        <Text style={[s.td, ct('bags'), colStyle(COL.bags)]}>{i.no_of_bags}</Text>
                        <Text style={[s.td, colStyle(COL.wt)]}>{i.bag_lines && i.bag_lines.length > 1 ? i.bag_lines.map((l) => `${fmt(l.weight_per_bag)} kg × ${l.bags}`).join('\n') : `${fmt(i.weight_per_bag)} kg`}</Text>
                        <Text style={[s.td, s.tdQty, colStyle(COL.qty)]}>{fmt(i.weighed_qty)} kg</Text>
                        <View style={cs('img')}>
                          {i.weight_image
                            ? <Pressable onPress={() => setViewImg(i)} hitSlop={6} accessibilityLabel={`View photo of ${i.material_name}`} style={s.viewBtn}><MCI name="image-outline" size={15} color={COLORS.primary} /><Text style={s.viewBtnText}>View</Text></Pressable>
                            : <Text style={[s.td, { color: COLORS.grey, paddingRight: 0 }]}>-</Text>}
                        </View>
                        <View style={[colStyle(COL.status), { paddingRight: 8 }]}>
                          <View style={[s.chip, { backgroundColor: mb.bg }]}><Text style={[s.chipText, { color: mb.color }]} numberOfLines={1}>{mb.label}</Text></View>
                        </View>
                        <View style={[colStyle(COL.act), { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }]}>
                          {canEdit && canEditMaterial(i) && (
                            <Pressable onPress={() => setEditMat(i)} hitSlop={6} accessibilityLabel={`Edit ${i.material_name}`} style={[s.iconBtn, { backgroundColor: COLORS.primarySoft }]}><MCI name="pencil-outline" size={18} color={COLORS.primary} /></Pressable>)}
                          {canEdit && canDeleteMaterial(i) && (
                            <Pressable onPress={() => { setErr(''); setDelMat(i); }} hitSlop={6} accessibilityLabel={`Delete ${i.material_name}`} style={[s.iconBtn, { backgroundColor: COLORS.dangerBg }]}><MCI name="trash-can-outline" size={18} color={COLORS.danger} /></Pressable>)}
                          {canEdit && !(canEditMaterial(i) || canDeleteMaterial(i)) && <MCI name="lock-outline" size={18} color={COLORS.grey} />}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            {/* materials not weighed yet (only while Batching is open) */}
            {batchingOpen && pendingRows.length > 0 && (
              <View style={{ marginTop: 14 }}>
                <Text style={s.secTitle}>YET TO WEIGH</Text>
                {pendingRows.map((i) => (
                  <View key={i.material_id} style={s.ing}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ingName}>{i.material_name}</Text>
                      <Text style={s.small}>{i.material_code}{i.required_kg != null ? `  •  Required ${fmt(i.required_kg)} kg` : ''}</Text>
                      {i.stock_short && <Text style={[s.small, { color: COLORS.danger }]}>Stock {fmt(i.stock_kg != null ? i.stock_kg : i.current_stock)} kg is not enough</Text>}
                    </View>
                    {can('batching', 'create') && (
                      <Button mode="contained" compact buttonColor={COLORS.primary} style={{ borderRadius: 10 }} onPress={() => setWeigh(i)}>Weigh</Button>)}
                  </View>
                ))}
              </View>
            )}

            {batchingOpen && can('batching', 'edit') && (
              <Button mode="contained" icon="check-all" buttonColor={COLORS.green} style={{ borderRadius: 12, marginTop: 14 }}
                disabled={!plan.can_complete || busy} onPress={() => setConfirmDone(true)}>Complete Batching</Button>)}
            {batchingOpen && !plan.can_complete && <Text style={s.small}>Weigh every ingredient to complete batching.</Text>}
            <ErrorBox text={err} />

            {batchingDone && b.current_stage !== 'COMPLETED' && (
              <View style={s.done}>
                <MCI name="check-circle" size={22} color={COLORS.ok} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.doneTitle}>Batching complete</Text>
                  <Text style={s.doneText}>{fmt(b.current_output_kg)} kg handed to the next stage  •  Next: {stageLabel(b.current_stage)}</Text>
                  {b.current_stage === 'FILTERING' && <Text style={s.doneText}>Open Filtering from the menu to record it. The filtered materials then move to Roasting.</Text>}
                </View>
              </View>
            )}
          </View>
        )}
      </Container>

      <BatchingEntryModal visible={!!weigh} batch={b} ingredient={weigh} onDismiss={() => setWeigh(null)}
        onSaved={(r) => { setWeigh(null); load(); toast(r.stock.low_stock_alert || 'Weighing saved'); }} />

      <BatchMaterialEditModal visible={!!editMat} batch={b} ingredient={editMat} onDismiss={() => setEditMat(null)}
        onSaved={(r) => { setEditMat(null); load(); toast((r && r.low_stock_alerts && r.low_stock_alerts[0]) || 'Material updated'); }} />

      <ConfirmDialog visible={!!delMat} busy={busy} title={delMat ? `Delete ${delMat.material_name}?` : ''}
        message={delMat ? (doneMats.length <= 1
          ? 'A batch needs at least one material. Delete is not possible for the only material of this batch.'
          : `${fmt(delMat.weighed_qty)} kg of ${delMat.material_name} will be removed from this batch and given back to stock. The batch weight goes down by the same quantity.`) : ''}
        confirmText="Delete" onCancel={() => setDelMat(null)}
        onConfirm={async () => {
          if (doneMats.length <= 1) { setDelMat(null); return; }
          const m = delMat; setDelMat(null);
          await run(() => api.delete(`/batches/${id}/materials/${m.material_id}`), `${m.material_name} removed from the batch`);
        }} />

      <WeightImageViewer visible={!!viewImg} batchId={b.id} ingredient={viewImg} onDismiss={() => setViewImg(null)} />

      <ConfirmDialog visible={confirmDone} title="Complete batching?" message={`${fmt(plan?.total_weighed_kg)} kg will move to the next stage. You cannot add more weighing after this.`}
        confirmText="Complete" onCancel={() => setConfirmDone(false)}
        onConfirm={async () => { setConfirmDone(false); await run(() => api.post(`/batches/${id}/batching/complete`), 'Batching completed'); }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { backgroundColor: '#fff', margin: 12, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  headTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, letterSpacing: -0.2 },
  sub: { fontSize: 15, fontWeight: '700', color: COLORS.textSoft, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  metaChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5, marginRight: 8, marginBottom: 6, maxWidth: '100%' },
  metaChipText: { marginLeft: 6, fontSize: 12.5, fontWeight: '700', color: COLORS.textSoft },
  hold: { color: COLORS.warn, fontWeight: '800', marginTop: 8 },
  btns: { flexDirection: 'row', marginTop: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.line },
  btn: { borderRadius: 10, marginRight: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  section: { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  secHead: { marginBottom: 12 },
  secTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey },
  progress: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginTop: 4 },
  note: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: COLORS.greenBg, borderRadius: 12, padding: 12, marginBottom: 12 },
  noteTitle: { fontSize: 13.5, fontWeight: '800', color: COLORS.green },
  noteText: { fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft, marginTop: 2, lineHeight: 18 },
  tableScroll: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12 },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingVertical: 11, paddingHorizontal: 10 },
  trHead: { backgroundColor: COLORS.greyBg, borderBottomWidth: 0, paddingVertical: 10 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey, paddingRight: 8 },
  td: { fontSize: 14, color: COLORS.text, fontWeight: '600', paddingRight: 8 },
  tdName: { fontWeight: '800', fontSize: 14.5 },
  tdQty: { fontWeight: '900' },
  codePill: { alignSelf: 'flex-start', backgroundColor: COLORS.greyBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  codeText: { fontSize: 11.5, fontWeight: '900', color: COLORS.textSoft },
  viewBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  viewBtnText: { marginLeft: 4, fontSize: 12, fontWeight: '800', color: COLORS.primary },
  chip: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  iconBtn: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginHorizontal: 3 },
  ing: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  ingName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  small: { fontSize: 12.5, color: COLORS.grey, fontWeight: '600', marginTop: 2 },
  done: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: COLORS.okBg, borderRadius: 12, padding: 14, marginTop: 14 },
  doneTitle: { color: COLORS.ok, fontWeight: '900', fontSize: 15 },
  doneText: { color: COLORS.textSoft, marginTop: 3, fontWeight: '600', fontSize: 13 },
});