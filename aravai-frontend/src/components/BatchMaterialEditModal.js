import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import { ErrorBox, InfoBox, ModalFooter } from './FormBits';
import { materialStage } from '../batchMaterialStatus';
import { COLORS, fmt } from '../theme';

const r3 = (n) => Math.round(n * 1000) / 1000;

// Edit one weighed material of a batch: bags, weight per bag, weighed quantity and the Filter tick.
// The stock of the material is corrected by the server (old quantity is given back, new quantity is taken).
export default function BatchMaterialEditModal({ visible, batch, ingredient, onDismiss, onSaved }) {
  const [f, setF] = useState({ no_of_bags: '', weight_per_bag: '', weighed_qty: '', touched: false, needs_filtering: false });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !ingredient) return;
    setF({
      no_of_bags: ingredient.no_of_bags == null ? '' : String(ingredient.no_of_bags),
      weight_per_bag: ingredient.weight_per_bag == null ? '' : String(ingredient.weight_per_bag),
      weighed_qty: ingredient.weighed_qty == null ? '' : String(ingredient.weighed_qty),
      touched: true, needs_filtering: !!ingredient.needs_filtering,
    });
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, ingredient]);

  if (!ingredient) return null;
  const multi = (ingredient.bag_lines || []).length > 1; // several bag sizes: bags / weight are edited by deleting and re-weighing, only the filter tick is changed here
  const stage = materialStage(ingredient);
  const stock = (ingredient.stock_kg != null ? Number(ingredient.stock_kg) : Number(ingredient.current_stock || 0)) + Number(ingredient.weighed_qty || 0); // stock + what this weighing already took

  const setField = (k) => (t) => setF((p) => {
    const cur = { ...p, [k]: t };
    if (k === 'weighed_qty') cur.touched = true;
    else if (!cur.touched) { const q = (Number(cur.no_of_bags) || 0) * (Number(cur.weight_per_bag) || 0); cur.weighed_qty = q > 0 ? String(r3(q)) : ''; }
    return cur;
  });
  // changing bags or weight recalculates the weighed quantity again
  const setBagField = (k) => (t) => setF((p) => {
    const cur = { ...p, [k]: t };
    const q = (Number(cur.no_of_bags) || 0) * (Number(cur.weight_per_bag) || 0);
    if (q > 0) cur.weighed_qty = String(r3(q));
    return cur;
  });

  const save = async () => {
    const e = {};
    if (!multi) {
      if (!(Number(f.no_of_bags) >= 1)) e.no_of_bags = 'Enter number of bags';
      if (!(Number(f.weight_per_bag) > 0)) e.weight_per_bag = 'Enter weight per bag';
      if (!(Number(f.weighed_qty) > 0)) e.weighed_qty = 'Enter weighed quantity';
      else if (Number(f.weighed_qty) > stock + 0.0005) e.weighed_qty = `Only ${fmt(stock)} kg available`;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const body = { needs_filtering: !!f.needs_filtering };
      if (!multi) Object.assign(body, { no_of_bags: f.no_of_bags, weight_per_bag: f.weight_per_bag, weighed_qty: f.weighed_qty });
      const r = await api.put(`/batches/${batch.id}/materials/${ingredient.material_id}`, body);
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  const canToggleFilter = stage === 'FILTERING' || stage === 'READY_FOR_ROASTING';

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="pencil" title={`Edit ${ingredient.material_name}`}
      subtitle={`${batch ? batch.batch_no : ''}  •  ${ingredient.material_code}`}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Changes" />}>
      <View>
        <InfoBox text="Stock of this material is corrected automatically: the old quantity is given back and the new quantity is taken." />
        {multi && <InfoBox text="This material was weighed in more than one bag size. Only the Filter option can be changed here. To change the quantity, delete the material and add it again." />}
        {!multi && (
          <View>
            <FormRow>
              <FormField label="No of bags *" digits value={f.no_of_bags} onChangeText={setBagField('no_of_bags')} error={errors.no_of_bags} />
              <FormField label="Weight per bag (kg) *" numeric value={f.weight_per_bag} onChangeText={setBagField('weight_per_bag')} error={errors.weight_per_bag} />
            </FormRow>
            <FormField label="Weighed quantity (kg) *" numeric value={f.weighed_qty} onChangeText={setField('weighed_qty')} error={errors.weighed_qty} />
          </View>
        )}
        {canToggleFilter && (
          <Pressable onPress={() => setF((p) => ({ ...p, needs_filtering: !p.needs_filtering }))} accessibilityRole="checkbox" accessibilityState={{ checked: f.needs_filtering }}
            style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: f.needs_filtering ? COLORS.primary : COLORS.border, borderRadius: 12, padding: 12, marginTop: 4, backgroundColor: f.needs_filtering ? `${COLORS.primary}0D` : '#fff' }}>
            <MCI name={f.needs_filtering ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={f.needs_filtering ? COLORS.primary : COLORS.grey} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontWeight: '800', color: COLORS.text }}>Filter this material</Text>
              <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 2 }}>Ticked: it must finish Filtering before it can go to Roasting.</Text>
            </View>
          </Pressable>
        )}
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
