import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, Switch, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS, fmt } from '../theme';
import { todayStr, DATE_RE, num, r3 } from '../productionUtils';

// Counter check: a counter may differ from Total packets by this share before a warning shows (warnings never block submit)
const COUNTER_TOLERANCE = 0.02;
const tol = (n) => Math.max(1, Math.ceil(n * COUNTER_TOLERANCE));

const EMPTY = { batch_id: null, packing_rate_id: null, machine_id: null, packing_date: todayStr(), target_weight: '', overall_weight_kg: '',
  total_bag_count: '', rejected_bag_count: '0', auger_count: '', puller_count: '', production_count: '', remarks: '', close_batch: false };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// Packing entry: one run = one pack size from one batch. Accepted packets go into finished goods stock.
export default function PackingFormModal({ visible, onDismiss, onSaved }) {
  const [lk, setLk] = useState(null);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ ...EMPTY, packing_date: todayStr() }); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    api.get('/packing/lookups')
      .then((r) => setLk(r.data.data))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [visible]);

  const batch = lk?.batches.find((b) => b.id === f.batch_id);
  const rate = lk?.rates.find((r) => r.id === f.packing_rate_id);
  const batchOptions = (lk?.batches || []).map((b) => ({ value: b.id, label: `${b.batch_no} · ${b.product_name}` }));
  const rateOptions = (lk?.rates || []).filter((r) => !batch || r.product_id === batch.product_id)
    .map((r) => ({ value: r.id, label: `${r.sku_code} · ${r.packing_size_label} · MRP ₹${fmt(r.mrp)}` }));
  const machineOptions = (lk?.machines || []).map((m) => ({ value: m.id, label: `${m.machine_code} · ${m.machine_name}` }));

  const pickBatch = (id) => setF((p) => ({ ...p, batch_id: id, packing_rate_id: null, target_weight: '' }));
  const pickRate = (id) => {
    const r = lk.rates.find((x) => x.id === id);
    setF((p) => ({ ...p, packing_rate_id: id, target_weight: r ? String(r.weight_grams) : '' }));
  };

  const total = Math.floor(num(f.total_bag_count));
  const rejected = Math.floor(num(f.rejected_bag_count));
  const accepted = Math.max(total - rejected, 0);
  const packG = rate ? Number(rate.weight_grams) : 0;
  const totalKg = r3((total * packG) / 1000);            // packets x pack size: this is what "left in batch" uses
  const overallKg = r3(num(f.overall_weight_kg));       // typed by the user: recorded only, never used for "left in batch"
  const avgG = total > 0 && overallKg > 0 ? Math.round(((overallKg * 1000) / total) * 100) / 100 : 0;
  const remaining = batch && Number(batch.current_output_kg) > 0 ? r3(Number(batch.current_output_kg) - Number(batch.packed_kg)) : null;
  const after = remaining === null ? null : r3(remaining - totalKg);

  // ---- counter cross-check ----
  const aug = Math.floor(num(f.auger_count));
  const pul = Math.floor(num(f.puller_count));
  const prd = Math.floor(num(f.production_count));
  const notes = [];
  if (total > 0) {
    [['Auger', aug], ['Puller', pul], ['Production', prd]].forEach(([name, c]) => {
      if (c > 0 && Math.abs(c - total) > tol(total)) notes.push(`${name} count (${fmt(c)}) differs from Total packets (${fmt(total)}) by ${fmt(Math.abs(c - total))}.`);
    });
  }
  const augOverPrd = aug > 0 && prd > 0 && aug - prd > tol(prd);
  if (augOverPrd) notes.push(`Auger count is ${fmt(aug - prd)} higher than production count: doses were delivered without a finished pouch (spill or jam).`);
  if (pul > 0 && aug > 0 && pul - aug > tol(aug)) notes.push(`Puller count is ${fmt(pul - aug)} higher than auger count: some pouches may be empty.`);
  const suggestRejected = aug > 0 && prd > 0 && aug > prd && total > 0 ? Math.min(aug - prd, total) : 0;   // hint only, any gap
  const showSuggest = suggestRejected > 0 && suggestRejected !== rejected;
  // ---- end counter cross-check ----

  const validate = () => {
    const e = {};
    if (!f.batch_id) e.batch_id = 'Select a batch';
    if (!f.packing_rate_id) e.packing_rate_id = 'Select a pack size';
    if (!f.machine_id) e.machine_id = 'Select a machine';
    if (!DATE_RE.test(f.packing_date)) e.packing_date = 'Use YYYY-MM-DD';
    if (!(overallKg > 0)) e.overall_weight_kg = 'Enter the overall weight of the packets (kg)';
    else if (packG > 0 && avgG > 0 && (avgG < packG * 0.5 || avgG > packG * 1.5)) e.overall_weight_kg = `That is ${fmt(avgG)} g per packet but the pack size is ${fmt(packG)} g. Check the weight`;
    if (!(total > 0)) e.total_bag_count = 'Enter the total packets';
    if (rejected > total) e.rejected_bag_count = 'Cannot be more than total packets';
    if (after !== null && after < -0.001) e.total_bag_count = `Only ${fmt(remaining)} kg is left in this batch`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const ask = () => { if (validate()) setConfirm(true); };   // check the form, then ask "are you sure?"

  const save = async () => {
    setConfirm(false);
    setSaving(true); setErr('');
    try {
      await api.post('/packing', {
        batch_id: f.batch_id, packing_rate_id: f.packing_rate_id, machine_id: f.machine_id, packing_date: f.packing_date,
        overall_weight_kg: f.overall_weight_kg, total_bag_count: f.total_bag_count,
        rejected_bag_count: f.rejected_bag_count || 0, auger_count: f.auger_count, puller_count: f.puller_count,
        production_count: f.production_count, remarks: f.remarks.trim(), close_batch: f.close_batch,
      });
      setSaving(false);
      onSaved && onSaved(f.close_batch);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const noBatches = lk && !lk.batches.length;

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="package-variant-closed" maxWidth={680}
      title="Packing Entry" subtitle="One entry = one pack size from one batch"
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={ask} loading={saving} disabled={saving || loading || noBatches} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">Submit Packing</Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          {noBatches && (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '700' }}>No batch is waiting at the packing stage. Finish blending first.</Text>
            </View>
          )}
          <Label>BATCH & MACHINE</Label>
          <FormRow>
            <SelectField label="Batch *" value={f.batch_id} options={batchOptions} onChange={pickBatch} error={errors.batch_id} />
            <SelectField label="Pack size *" value={f.packing_rate_id} options={rateOptions} onChange={pickRate} error={errors.packing_rate_id} />
          </FormRow>
          {remaining !== null && (
            <Text style={{ color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginBottom: 10 }}>Left to pack in this batch: {fmt(remaining)} kg{batch && Number(batch.runs_done) > 0 ? `  •  ${batch.runs_done} earlier ${Number(batch.runs_done) === 1 ? 'entry' : 'entries'} (${fmt(batch.bags_done)} packets)` : ''}</Text>
          )}
          <FormRow>
            <SelectField label="Packing machine *" value={f.machine_id} options={machineOptions} onChange={set('machine_id')} error={errors.machine_id} />
            <FormField label="Packing date * (YYYY-MM-DD)" value={f.packing_date} onChangeText={set('packing_date')} error={errors.packing_date} maxLength={10} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>WEIGHT & PACKETS</Label>
          <FormRow>
            <FormField label="Target weight per packet (g)" numeric value={f.target_weight} disabled
              hint={rate ? `Pack size: ${fmt(rate.weight_grams)} g` : 'Select a pack size'} />
            <FormField label="Overall packet weight (kg) *" numeric value={f.overall_weight_kg} onChangeText={set('overall_weight_kg')}
              error={errors.overall_weight_kg} hint="Weight of all the packets of this run together" />
          </FormRow>
          <FormRow>
            <FormField label="Total packets *" digits value={f.total_bag_count} onChangeText={set('total_bag_count')} error={errors.total_bag_count} />
            <FormField label="Rejected packets" digits value={f.rejected_bag_count} onChangeText={set('rejected_bag_count')} error={errors.rejected_bag_count} />
          </FormRow>
          <View style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontWeight: '700' }}>Accepted packets: {fmt(accepted)}   |   Packed: {fmt(totalKg)} kg</Text>
            {avgG > 0 && (
              <Text style={{ color: COLORS.grey, marginTop: 3, fontSize: 12.5, fontWeight: '600' }}>
                Overall weight {fmt(overallKg)} kg = {fmt(avgG)} g per packet (for record only)
              </Text>
            )}
            {after !== null && (
              <Text style={{ color: after < -0.001 ? COLORS.danger : COLORS.grey, marginTop: 3, fontSize: 12.5, fontWeight: '600' }}>
                Left in batch after this entry: {fmt(after)} kg
              </Text>
            )}
          </View>

          <Label style={{ marginTop: 6 }}>MACHINE COUNTERS (OPTIONAL)</Label>
          <FormRow>
            <FormField label="Auger count" digits value={f.auger_count} onChangeText={set('auger_count')} />
            <FormField label="Puller count" digits value={f.puller_count} onChangeText={set('puller_count')} />
            <FormField label="Production count" digits value={f.production_count} onChangeText={set('production_count')} />
          </FormRow>
          {(notes.length > 0 || showSuggest) && (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '800', fontSize: 12.5, marginBottom: 3 }}>{notes.length > 0 ? 'Please check the counters' : 'Counter hint'}</Text>
              {notes.slice(0, 4).map((n, i) => (
                <Text key={i} style={{ color: COLORS.warn, fontSize: 12.5, fontWeight: '600', marginTop: 2 }}>• {n}</Text>
              ))}
              {showSuggest && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: COLORS.warn, fontSize: 12.5, fontWeight: '600', flex: 1 }}>About {fmt(suggestRejected)} packets may have been rejected.</Text>
                  <Button compact mode="outlined" onPress={() => set('rejected_bag_count')(String(suggestRejected))} textColor={COLORS.warn}
                    style={{ borderRadius: 8, borderColor: COLORS.warn }}>Use {fmt(suggestRejected)}</Button>
                </View>
              )}
            </View>
          )}
          <FormField label="Remarks" value={f.remarks} onChangeText={set('remarks')} maxLength={255} />

          {after !== null && total > 0 && after <= 0.05 && !f.close_batch && (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 10, marginTop: 4 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '700', fontSize: 12.5 }}>
                Nothing is left in this batch after this entry. Turn on "Last packing run" to complete the batch, otherwise it stays open.
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.greenBg, borderRadius: 14, padding: 14, marginTop: 4 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>Last packing run for this batch</Text>
              <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 1 }}>Turn on to mark the batch as completed{after > 0.001 ? ` (${fmt(after)} kg left over will be counted as wastage)` : ''}</Text>
            </View>
            <Switch value={f.close_batch} onValueChange={set('close_batch')} color={COLORS.green} />
          </View>

          <View style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginTop: 12 }}>
            <Text style={{ fontWeight: '800', color: COLORS.text, marginBottom: 6 }}>BATCH WEIGHT</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: COLORS.grey, fontWeight: '600' }}>Initial weight (at batching)</Text>
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{batch && Number(batch.batching_kg) > 0 ? `${fmt(batch.batching_kg)} kg` : '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.grey, fontWeight: '600' }}>Final weight (packed, this entry)</Text>
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{overallKg > 0 ? `${fmt(overallKg)} kg` : '—'}</Text>
            </View>
          </View>

          <ConfirmDialog visible={confirm} busy={saving} title="Submit packing?" confirmText="Yes, submit"
            message={`Batch ${batch?.batch_no || ''}: ${fmt(total)} packets of ${rate?.sku_code || ''} (${fmt(accepted)} accepted, ${fmt(rejected)} rejected). ${fmt(accepted)} packets will be added to finished goods.${f.close_batch ? ` This also completes the batch, and the ${fmt(Math.max(after || 0, 0))} kg not packed will be counted as wastage.` : ''}`}
            onConfirm={save} onCancel={() => setConfirm(false)} />

          {!!err && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 12 }}>
              <MCI name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}