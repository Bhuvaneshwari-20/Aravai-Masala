import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import BatchingEntryModal from '../../components/BatchingEntryModal';
import WeightImageViewer from '../../components/WeightImageViewer';
import ConfirmDialog from '../../components/ConfirmDialog';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { ErrorBox, ModalFooter } from '../../components/FormBits';
import { badgeFor, stageLabel } from './BatchListScreen';
import { isBatchMachineLocked, batchMachineLabel } from '../../batchMachineLock';
import { COLORS, fmt } from '../../theme';

const SHEET_COLS = [
  { key: 'date', label: 'DATE', w: 100 }, { key: 'code', label: 'MATERIAL CODE', w: 110 }, { key: 'name', label: 'MATERIAL NAME', w: 220 },
  { key: 'bags', label: 'NO OF BAGS', w: 90 }, { key: 'wt', label: 'WEIGHT', w: 110 }, { key: 'qty', label: 'WEIGHED QTY', w: 120 },
  { key: 'by', label: 'DONE BY', w: 120 }, { key: 'chk', label: 'CHECKED BY', w: 120 }, { key: 'img', label: 'PHOTO', w: 80 },
];

export default function BatchDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const { toast } = useUi();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [weigh, setWeigh] = useState(null);       // ingredient being weighed
  const [viewImg, setViewImg] = useState(null);   // ingredient whose weighing machine photo is open
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');
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

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }}>
      <Container>
        <View style={s.head}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.title}>{b.batch_no}</Text>
            <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text></View>
          </View>
          <Text style={s.sub}>{b.product_name}</Text>
          <Text style={s.meta}>Total {fmt(b.planned_qty_kg)} kg  •  {String(b.production_date).slice(0, 10)}</Text>
          {b.status !== 'COMPLETED' && b.status !== 'CANCELLED' && <Text style={s.meta}>Current process: {stageLabel(b.current_stage)}</Text>}
          {isBatchMachineLocked(b) && (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 10, marginTop: 8 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '800' }}>🔒 Weighing machine locked: {batchMachineLabel(b)}</Text>
              <Text style={{ color: COLORS.warn, fontWeight: '600', fontSize: 12, marginTop: 2 }}>All materials of this batch must be weighed on this machine. It is released when the batch is completed.</Text>
            </View>
          )}
          {b.status === 'ON_HOLD' && <Text style={s.hold}>On hold: {b.hold_reason}. The lock stays on, no other batch can start.</Text>}
          <View style={s.btns}>
            {can('batching', 'approve') && b.status === 'IN_PROGRESS' && (
              <Button mode="outlined" icon="pause" textColor={COLORS.warn} style={[s.btn, { borderColor: COLORS.warn }]} onPress={() => { setReason(''); setErr(''); setHoldOpen(true); }}>Hold</Button>)}
            {can('batching', 'approve') && b.status === 'ON_HOLD' && (
              <Button mode="contained" icon="play" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy}
                onPress={() => run(() => api.patch(`/batches/${id}/resume`), 'Batch resumed')}>Resume</Button>)}
          </View>
        </View>

        {!!plan && (
          <View style={s.section}>
            <Text style={s.secTitle}>BATCHING</Text>
            <Text style={s.progress}>{batchingOpen ? `${plan.done_count} of ${plan.ingredients.length} materials weighed  •  ` : `${plan.done_count} materials  •  `}{fmt(plan.total_weighed_kg)} kg{plan.total_required_kg != null ? ` of ${fmt(plan.total_required_kg)} kg` : ''}</Text>

            {/* Sheet: same columns as the paper "ARAVAI BATCHING PROCESS PLAN" */}
            {plan.ingredients.some((i) => i.is_done) && (
              <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginTop: 6 }}>
                <View style={{ minWidth: 1060 }}>
                  <View style={[s.tr, s.trHead]}>
                    {SHEET_COLS.map((c) => <Text key={c.key} style={[s.th, { width: c.w }]}>{c.label}</Text>)}
                  </View>
                  {plan.ingredients.filter((i) => i.is_done).map((i) => (
                    <View key={i.material_id} style={s.tr}>
                      <Text style={[s.td, { width: 100 }]}>{String(i.entry_date || '').slice(0, 10)}</Text>
                      <Text style={[s.td, { width: 110, fontWeight: '800' }]}>{i.material_code}</Text>
                      <Text style={[s.td, { width: 220, fontWeight: '800' }]}>{i.material_name}</Text>
                      <Text style={[s.td, { width: 90 }]}>{i.no_of_bags}</Text>
                      <Text style={[s.td, { width: 110 }]}>{fmt(i.weight_per_bag)} kg</Text>
                      <Text style={[s.td, { width: 120, fontWeight: '800' }]}>{fmt(i.weighed_qty)} kg</Text>
                      <Text style={[s.td, { width: 120 }]}>{i.done_by_name || '-'}</Text>
                      <Text style={[s.td, { width: 120 }]}>{i.checked_by_name || '-'}</Text>
                      {i.weight_image
                        ? <Pressable style={{ width: 80 }} onPress={() => setViewImg(i)}><Text style={[s.td, { color: COLORS.primary, fontWeight: '800' }]}>View</Text></Pressable>
                        : <Text style={[s.td, { width: 80 }]}>-</Text>}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
            {plan.ingredients.some((i) => i.weighing_machine_name) && (
              <Text style={s.small}>Weighing machine: {plan.ingredients.find((i) => i.weighing_machine_name).weighing_machine_name}</Text>)}

            {batchingOpen && plan.ingredients.filter((i) => !i.is_done).map((i) => (
              <View key={i.material_id} style={s.ing}>
                <View style={{ flex: 1 }}>
                  <Text style={s.ingName}>⏳ {i.material_code}  {i.material_name}</Text>
                  {i.required_kg != null && <Text style={s.small}>Required {fmt(i.required_kg)} kg</Text>}
                  {i.stock_short && <Text style={[s.small, { color: COLORS.danger }]}>Stock {fmt(i.current_stock)} kg is not enough</Text>}
                </View>
                {can('batching', 'create') && (
                  <Button mode="contained" compact buttonColor={COLORS.primary} style={{ borderRadius: 10 }} onPress={() => setWeigh(i)}>Weigh</Button>)}
              </View>
            ))}

            {batchingOpen && can('batching', 'edit') && (
              <Button mode="contained" icon="check-all" buttonColor={COLORS.green} style={{ borderRadius: 12, marginTop: 14 }}
                disabled={!plan.can_complete || busy} onPress={() => setConfirmDone(true)}>Complete Batching</Button>)}
            {batchingOpen && !plan.can_complete && <Text style={s.small}>Weigh every ingredient to complete batching.</Text>}
            <ErrorBox text={err} />

            {batchingDone && b.current_stage !== 'COMPLETED' && (
              <View style={s.done}>
                <Text style={s.doneTitle}>Batching complete</Text>
                <Text style={s.doneText}>{fmt(b.current_output_kg)} kg handed to the next stage.</Text>
                <Text style={s.doneText}>Next process: {stageLabel(b.current_stage)}.{b.current_stage === 'FILTERING' ? ' Open Filtering from the menu to record it; the batch then moves to Roasting.' : ''}</Text>
              </View>
            )}
          </View>
        )}
      </Container>

      <BatchingEntryModal visible={!!weigh} batch={b} ingredient={weigh} onDismiss={() => setWeigh(null)}
        onSaved={(r) => { setWeigh(null); load(); toast(r.stock.low_stock_alert || 'Weighing saved'); }} />

      <WeightImageViewer visible={!!viewImg} batchId={b.id} ingredient={viewImg} onDismiss={() => setViewImg(null)} />

      <ConfirmDialog visible={confirmDone} title="Complete batching?" message={`${fmt(plan?.total_weighed_kg)} kg will move to the next stage. You cannot add more weighing after this.`}
        confirmText="Complete" onCancel={() => setConfirmDone(false)}
        onConfirm={async () => { setConfirmDone(false); await run(() => api.post(`/batches/${id}/batching/complete`), 'Batching completed'); }} />

      <ModalShell visible={holdOpen} onDismiss={() => setHoldOpen(false)} busy={busy} icon="pause-circle" maxWidth={440} title="Put batch on hold"
        footer={<ModalFooter onCancel={() => setHoldOpen(false)} saving={busy} label="Hold Batch" icon="pause" color={COLORS.warn}
          onSave={async () => {
            if (!reason.trim()) return setErr('Reason is required');
            if (await run(() => api.patch(`/batches/${id}/hold`, { reason: reason.trim() }), 'Batch on hold')) setHoldOpen(false);
          }} />}>
        <View>
          <FormField label="Reason *" value={reason} onChangeText={setReason} maxLength={255} />
          <ErrorBox text={err} />
        </View>
      </ModalShell>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { backgroundColor: '#fff', margin: 12, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 4 },
  meta: { color: COLORS.grey, fontWeight: '600', marginTop: 4 },
  hold: { color: COLORS.warn, fontWeight: '800', marginTop: 8 },
  btns: { flexDirection: 'row', marginTop: 12 },
  btn: { borderRadius: 10, marginRight: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  section: { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  secTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey },
  progress: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginTop: 6, marginBottom: 6 },
  ing: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ingName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  small: { fontSize: 12.5, color: COLORS.grey, fontWeight: '600', marginTop: 2 },
  done: { backgroundColor: COLORS.okBg, borderRadius: 12, padding: 12, marginTop: 14 },
  doneTitle: { color: COLORS.ok, fontWeight: '900', fontSize: 15 },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 6 },
  trHead: { backgroundColor: COLORS.greyBg, borderRadius: 8, borderBottomWidth: 0 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  td: { fontSize: 14, color: COLORS.text, fontWeight: '600', paddingRight: 8 },
  doneText: { color: COLORS.text, marginTop: 3, fontWeight: '600' },
});