import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import useLayout from '../hooks/useLayout';
import { useAuth } from '../AuthContext';
import { ErrorBox, ModalFooter, Label } from './FormBits';
import { COLORS, fmt } from '../theme';

const r3 = (n) => Math.round(n * 1000) / 1000;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One material row, laid out like the paper "ARAVAI BATCHING PROCESS PLAN" sheet:
// MATERIAL CODE | MATERIAL NAME | NO OF BAGS | WEIGHT | WEIGHED QTY   (Done by / Checked by are picked once for the sheet)
// Lives outside the modal component so the inputs keep focus while typing.
function SheetRow({ item, row, errors, wide, onChange }) {
  const cell = (flex) => ({ flex, marginRight: 10 });
  const bags = <FormField label="No of bags" digits value={row.bags || ''} onChangeText={(t) => onChange('bags', t)} error={errors.bags} />;
  const wt = <FormField label="Weight (kg/bag)" numeric value={row.wt || ''} onChangeText={(t) => onChange('wt', t)} error={errors.wt} />;
  const qty = <FormField label="Weighed qty (kg)" numeric value={row.qty || ''} onChangeText={(t) => onChange('qty', t)} error={errors.qty} />;
  return (
    <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginBottom: 10, backgroundColor: '#FFFDF9' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ backgroundColor: COLORS.greyBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: COLORS.grey }}>{item.material_code}</Text>
        </View>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.text }}>{item.material_name}</Text>
        <Text style={{ fontSize: 12, color: COLORS.grey, fontWeight: '700' }}>Stock {fmt(item.current_stock)} kg</Text>
      </View>
      {wide ? (
        <View style={{ flexDirection: 'row' }}>
          <View style={cell(1)}>{bags}</View>
          <View style={cell(1)}>{wt}</View>
          <View style={{ flex: 1 }}>{qty}</View>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row' }}>
            <View style={cell(1)}>{bags}</View>
            <View style={{ flex: 1 }}>{wt}</View>
          </View>
          {qty}
        </View>
      )}
    </View>
  );
}

// New batch (follows the Aravai batching sheet): date, product -> its recipe materials -> bags / weight / weighed qty
// for each -> done by + checked by -> save.  Saving closes BATCHING; the batch continues at ROASTING.
export default function StartBatchModal({ visible, onDismiss, onSaved }) {
  const { user } = useAuth();
  const { isWide } = useLayout();
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), visible);
  const staff = useOptions('/batches/staff', {}, (u) => ({ value: u.id, label: `${u.full_name} (${u.role_name})` }), visible);
  const [date, setDate] = useState(today());
  const [productId, setProductId] = useState(null);
  const [doneBy, setDoneBy] = useState(null);
  const [checkedBy, setCheckedBy] = useState(null);
  const [recipe, setRecipe] = useState(null); // { id, ingredients: [...] }
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [rows, setRows] = useState({}); // material_id -> { bags, wt, qty, touched }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (visible) {
      setDate(today()); setProductId(null); setRecipe(null); setRows({}); setErrors({}); setErr(''); setSaving(false);
      setDoneBy(user?.id || null); setCheckedBy(null);
    }
  }, [visible]); // eslint-disable-line

  useEffect(() => {
    setRecipe(null); setRows({}); setErrors({});
    if (!visible || !productId) return undefined;
    let live = true;
    (async () => {
      setLoadingRecipe(true); setErr('');
      try {
        const l = (await api.get('/recipes', { params: { product_id: productId, active: 'true', limit: 1 } })).data.data.items;
        if (!l.length) { if (live) setErr('This product has no active recipe. Create the recipe first.'); }
        else {
          const r = (await api.get(`/recipes/${l[0].id}`)).data.data;
          if (live) setRecipe(r);
        }
      } catch (e) { if (live) setErr(errMsg(e)); }
      if (live) setLoadingRecipe(false);
    })();
    return () => { live = false; };
  }, [productId, visible]);

  // bags x weight fills "weighed qty" until the user types a weighed qty by hand
  const change = (id) => (k, t) => setRows((p) => {
    const cur = { ...(p[id] || {}), [k]: t };
    if (k === 'qty') cur.touched = true;
    else if (!cur.touched) {
      const q = (Number(cur.bags) || 0) * (Number(cur.wt) || 0);
      cur.qty = q > 0 ? String(r3(q)) : '';
    }
    return { ...p, [id]: cur };
  });

  const total = useMemo(() => r3(Object.values(rows).reduce((a, x) => a + (Number(x.qty) || 0), 0)), [rows]);

  const save = async () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Use YYYY-MM-DD';
    if (!productId) e.product = 'Select the product';
    if (!doneBy) e.doneBy = 'Select who weighed';
    if (!checkedBy) e.checkedBy = 'Select who checked';
    else if (checkedBy === doneBy) e.checkedBy = 'Must be a different person';
    if (recipe) {
      recipe.ingredients.forEach((i) => {
        const x = rows[i.material_id] || {};
        const k = `m${i.material_id}`;
        const any = x.qty || x.bags || x.wt;
        if (!any) return;
        if (!x.qty || !(Number(x.qty) > 0)) e[`${k}qty`] = 'Enter weighed qty';
        else if (Number(x.qty) > Number(i.current_stock)) e[`${k}qty`] = `Only ${fmt(i.current_stock)} kg in stock`;
        if (x.bags && Number(x.bags) < 1) e[`${k}bags`] = 'At least 1 bag';
      });
      if (!(total > 0)) e.total = 'Enter the quantity for at least one material';
    }
    setErrors(e);
    if (Object.keys(e).length || !recipe) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/batches', { product_id: productId, recipe_id: recipe.id, production_date: date, done_by: doneBy, checked_by: checkedBy,
        ingredients: recipe.ingredients.map((i) => {
          const x = rows[i.material_id] || {};
          return { material_id: i.material_id, no_of_bags: x.bags || undefined, weight_per_bag: x.wt || undefined, weighed_qty: x.qty || 0 };
        }) });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="scale-balance" maxWidth={820} title="New Batch"
      subtitle="Aravai Batching Process Plan"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={!recipe} label="Save Batch" />}>
      <View>
        <FormField label="Date (YYYY-MM-DD) *" value={date} onChangeText={setDate} error={errors.date} maxLength={10} />
        <SelectField label="Product *" value={productId} options={products} onChange={setProductId} error={errors.product} />
        {loadingRecipe && <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} />}
        {!!recipe && (
          <View>
            <Label style={{ marginTop: 6 }}>MATERIALS</Label>
            {recipe.ingredients.map((i) => {
              const k = `m${i.material_id}`;
              return <SheetRow key={i.material_id} item={i} row={rows[i.material_id] || {}} wide={isWide} onChange={change(i.material_id)}
                errors={{ bags: errors[`${k}bags`], wt: errors[`${k}wt`], qty: errors[`${k}qty`] }} />;
            })}
            <View style={{ backgroundColor: total > 0 ? COLORS.okBg : COLORS.warnBg, borderRadius: 10, padding: 10, marginBottom: 14 }}>
              <Text style={{ fontWeight: '800', color: total > 0 ? COLORS.ok : COLORS.warn }}>Total weighed {fmt(total)} kg</Text>
            </View>
            <Label>SIGN-OFF</Label>
            <SelectField label="Done by *" value={doneBy} options={staff} onChange={setDoneBy} error={errors.doneBy} />
            <SelectField label="Checked by *" value={checkedBy} options={staff} onChange={setCheckedBy} error={errors.checkedBy} />
          </View>
        )}
        <ErrorBox text={errors.total || err} />
      </View>
    </ModalShell>
  );
}
