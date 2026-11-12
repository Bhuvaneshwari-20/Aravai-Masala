import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import BatchingEntryModal from '../../components/BatchingEntryModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { ErrorBox, ModalFooter } from '../../components/FormBits';
import { badgeFor, stageLabel } from './BatchListScreen';
import { COLORS, fmt } from '../../theme';

export default function BatchDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const { toast } = useUi();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [weigh, setWeigh] = useState(null);       // ingredient being weighed
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

            {plan.ingredients.filter((i) => i.is_done || batchingOpen).map((i) => (
              <View key={i.material_id} style={s.ing}>
                <View style={{ flex: 1 }}>
                  <Text style={s.ingName}>{i.is_done ? '✅ ' : '⏳ '}{i.material_name}</Text>
                  {i.required_kg != null && <Text style={s.small}>Required {fmt(i.required_kg)} kg</Text>}
                  {i.is_done ? (
                    <Text style={s.small}>
                      Quantity {fmt(i.weighed_qty)} kg  •  by {i.done_by_name}{i.checked_by_name ? `, checked ${i.checked_by_name}` : ''}
                      {Number(i.variance_kg) !== 0 ? `  •  ${i.variance_kg > 0 ? '+' : ''}${fmt(i.variance_kg)} kg vs recipe` : ''}
                    </Text>
                  ) : (i.stock_short && <Text style={[s.small, { color: COLORS.danger }]}>Stock {fmt(i.current_stock)} kg is not enough</Text>)}
                </View>
                {!i.is_done && batchingOpen && can('batching', 'create') && (
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
                <Text style={s.doneText}>Next process: {stageLabel(b.current_stage)}. This step will be available in the next phase.</Text>
              </View>
            )}
          </View>
        )}
      </Container>

      <BatchingEntryModal visible={!!weigh} batch={b} ingredient={weigh} onDismiss={() => setWeigh(null)}
        onSaved={(r) => { setWeigh(null); load(); toast(r.stock.low_stock_alert || 'Weighing saved'); }} />

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
  doneText: { color: COLORS.text, marginTop: 3, fontWeight: '600' },
});
