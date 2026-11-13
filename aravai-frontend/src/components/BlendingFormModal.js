import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS, fmt } from '../theme';
import { todayStr, nowHHmm, DATE_RE, TIME_RE, num, r3, nextKey } from '../productionUtils';

const GROUND = 'GROUND';
const newLine = () => ({ key: nextKey(), material_id: null, no_of_bags: '', weight_per_bag: '', ingredient_weight: '' });
const initial = (uid) => ({ batch_id: null, recipe_id: null, machine_id: null, entry_date: todayStr(), start_time: nowHHmm(),
  mixing_duration_min: '', output_weight: '', done_by: uid, checked_by: null, remarks: '' });
const effWeight = (l) => num(l.ingredient_weight) || r3(num(l.no_of_bags) * num(l.weight_per_bag));
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// One read-only ingredient row: weight is fetched from the batch, mixing % is calculated.
function IngredientRow({ i, name, weight, pct }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12,
      borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
      <Text style={{ width: 26, color: COLORS.grey, fontWeight: '700' }}>{i + 1}</Text>
      <Text style={{ flex: 1, color: COLORS.text, fontWeight: '700' }}>{name}</Text>
      <Text style={{ width: 90, textAlign: 'right', color: COLORS.text, fontWeight: '700' }}>{fmt(weight)} kg</Text>
      <Text style={{ width: 72, textAlign: 'right', color: COLORS.primary, fontWeight: '800' }}>{pct.toFixed(2)}%</Text>
    </View>
  );
}

// Blending entry: header (batch, machine, time, output) + ingredient rows. One submit saves everything.
export default function BlendingFormModal({ visible, onDismiss, onSaved }) {
  const { user } = useAuth();
  const [lk, setLk] = useState(null);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(initial(user?.id));
  const [lines, setLines] = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setLine = (i) => (k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    if (!visible) return;
    setF(initial(user?.id)); setLines([]); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    api.get('/blending/lookups')
      .then((r) => setLk(r.data.data))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [visible]); // eslint-disable-line

  const batch = lk?.batches.find((b) => b.id === f.batch_id);
  const batchOptions = (lk?.batches || []).map((b) => ({ value: b.id, label: `${b.batch_no} · ${b.product_name}` }));
  const machineOptions = (lk?.machines || []).map((m) => ({ value: m.id, label: `${m.machine_code} · ${m.machine_name}` }));
  const recipeOptions = (lk?.recipes || []).filter((r) => !batch || r.product_id === batch.product_id)
    .map((r) => ({ value: r.id, label: `${r.recipe_no} (v${r.version_no})` }));
  const userOptions = (lk?.users || []).map((u) => ({ value: u.id, label: u.full_name }));
  const checkedOptions = [{ value: 0, label: '— None —' }, ...userOptions];
   const materialOptions = useMemo(() => (lk?.materials || []).map((m) => ({ value: m.id, label: `${m.material_code} · ${m.material_name}` })), [lk]);
  const pickBatch = (id) => {
    const b = lk.batches.find((x) => x.id === id);
    setF((p) => ({ ...p, batch_id: id, recipe_id: b?.recipe_id || null }));
    const mats = (lk.batch_materials || []).filter((m) => m.batch_id === id);
    setLines(mats.map((m) => ({ ...newLine(), material_id: m.material_id, material_name: m.material_name, ingredient_weight: String(m.qty) })));
  };

  const totalIn = r3(lines.reduce((s, l) => s + effWeight(l), 0));
  const out = num(f.output_weight);                      // typed by the user
  const wastage = r3(totalIn - out);
  const lossPct = totalIn > 0 && out > 0 ? (wastage / totalIn) * 100 : 0;

  const validate = () => {
    const e = {};
    if (!f.batch_id) e.batch_id = 'Select a batch';
    if (!f.recipe_id) e.recipe_id = 'Select a recipe';
    if (!f.machine_id) e.machine_id = 'Select a machine';
    if (!DATE_RE.test(f.entry_date)) e.entry_date = 'Use YYYY-MM-DD';
    if (!TIME_RE.test(f.start_time)) e.start_time = 'Use HH:mm (24 hour)';
    if (f.mixing_duration_min !== '' && Number(f.mixing_duration_min) < 0) e.mixing_duration_min = 'Enter minutes';
    if (f.batch_id && !lines.length) e.batch_id = 'This batch has no ingredient weights';
    if (!(out > 0)) e.output_weight = 'Enter the total blended weight';
    else if (out > totalIn + 0.01) e.output_weight = `Cannot be more than total ingredients (${fmt(totalIn)} kg)`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const ask = () => { if (validate()) setConfirm(true); };   // check the form, then ask "are you sure?"

  const save = async () => {
    setConfirm(false);
    setSaving(true); setErr('');
    try {
      await api.post('/blending', {
        batch_id: f.batch_id, recipe_id: f.recipe_id, machine_id: f.machine_id, entry_date: f.entry_date, start_time: f.start_time,
        mixing_duration_min: f.mixing_duration_min === '' ? null : f.mixing_duration_min, output_weight: f.output_weight,
        done_by: f.done_by, checked_by: f.checked_by || null, remarks: f.remarks.trim(),
        ingredients: lines.map((l) => ({ material_id: l.material_id, no_of_bags: l.no_of_bags || 0,
          weight_per_bag: l.weight_per_bag || 0, ingredient_weight: l.ingredient_weight || 0 })),
      });
      setSaving(false);
      onSaved && onSaved();
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const noBatches = lk && !lk.batches.length;

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="blender" maxWidth={720}
      title="Blending Entry" subtitle="Record the ingredients and the blended output"
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={ask} loading={saving} disabled={saving || loading || noBatches} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">Submit Blending</Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          {noBatches && (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '700' }}>No batch is waiting at the blending stage.</Text>
            </View>
          )}
          <Label>BATCH DETAILS</Label>
          <FormRow>
            <SelectField label="Batch *" value={f.batch_id} options={batchOptions} onChange={pickBatch} error={errors.batch_id} />
            <SelectField label="Recipe *" value={f.recipe_id} options={recipeOptions} onChange={set('recipe_id')} error={errors.recipe_id} />
          </FormRow>
          <FormRow>
            <SelectField label="Blending machine *" value={f.machine_id} options={machineOptions} onChange={set('machine_id')} error={errors.machine_id} />
            <FormField label="Date * (YYYY-MM-DD)" value={f.entry_date} onChangeText={set('entry_date')} error={errors.entry_date} maxLength={10} />
          </FormRow>
          <FormRow>
            <FormField label="Start time * (HH:mm)" value={f.start_time} onChangeText={set('start_time')} error={errors.start_time} maxLength={5} />
            <FormField label="Mixing duration (min)" digits value={f.mixing_duration_min} onChangeText={set('mixing_duration_min')} error={errors.mixing_duration_min} />
          </FormRow>
          <FormRow>
            <SelectField label="Done by" value={f.done_by} options={userOptions} onChange={set('done_by')} />
            <SelectField label="Checked by" value={f.checked_by} options={checkedOptions} onChange={set('checked_by')} />
          </FormRow>

          <Label style={{ marginTop: 6 }}>INGREDIENTS (FROM BATCH)</Label>
          {!f.batch_id ? (
            <Text style={{ color: COLORS.grey, marginBottom: 14 }}>Select a batch to load its ingredients.</Text>
          ) : !lines.length ? (
            <View style={{ backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: COLORS.warn, fontWeight: '700' }}>No ingredient weights found for this batch (it needs batching weights or a recipe).</Text>
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: '#FFFDF9', marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <Text style={{ width: 26 }} />
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '900', color: COLORS.grey }}>MATERIAL</Text>
                <Text style={{ width: 90, textAlign: 'right', fontSize: 11, fontWeight: '900', color: COLORS.grey }}>WEIGHT</Text>
                <Text style={{ width: 72, textAlign: 'right', fontSize: 11, fontWeight: '900', color: COLORS.grey }}>MIX %</Text>
              </View>
              {lines.map((l, i) => (
                <IngredientRow key={l.key} i={i} name={l.material_name} weight={effWeight(l)}
                  pct={totalIn > 0 ? (effWeight(l) / totalIn) * 100 : 0} />
              ))}
              <View style={{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FFF3E0', borderBottomLeftRadius: 13, borderBottomRightRadius: 13 }}>
                <Text style={{ width: 26 }} />
                <Text style={{ flex: 1, fontWeight: '900', color: COLORS.text }}>Total</Text>
                <Text style={{ width: 90, textAlign: 'right', fontWeight: '900', color: COLORS.text }}>{fmt(totalIn)} kg</Text>
                <Text style={{ width: 72, textAlign: 'right', fontWeight: '900', color: COLORS.primary }}>100.00%</Text>
              </View>
            </View>
          )}

          <Label style={{ marginTop: 6 }}>BLENDED OUTPUT</Label>
          <FormField label="Total blended weight (kg) *" numeric value={f.output_weight} onChangeText={set('output_weight')}
            error={errors.output_weight} hint={totalIn > 0 ? `Maximum ${fmt(totalIn)} kg (total ingredients)` : undefined} />
          <View style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontWeight: '700' }}>Total ingredients: {fmt(totalIn)} kg   |   Blended: {fmt(out)} kg</Text>
            <Text style={{ color: wastage < 0 ? COLORS.danger : COLORS.grey, marginTop: 3, fontSize: 12.5, fontWeight: '600' }}>
              Wastage: {fmt(wastage)} kg ({lossPct.toFixed(2)}% loss)
            </Text>
          </View>
          <FormField label="Remarks" value={f.remarks} onChangeText={set('remarks')} maxLength={255} />

          <ConfirmDialog visible={confirm} busy={saving} title="Submit blending?" confirmText="Yes, submit"
            message={`Batch ${batch?.batch_no || ''}: ${fmt(out)} kg blended from ${fmt(totalIn)} kg of ingredients. The batch will move to packing, and this entry cannot be edited after submitting.`}
            onConfirm={save} onCancel={() => setConfirm(false)} />

          {!!err && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 4 }}>
              <MCI name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}