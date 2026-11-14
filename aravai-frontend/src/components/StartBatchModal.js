import React, { useEffect, useMemo, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import FormRow from './FormRow';
import useOptions from '../hooks/useOptions';
import useLayout from '../hooks/useLayout';
import { useAuth } from '../AuthContext';
import WeightImageVerify from './WeightImageVerify';
import { ErrorBox, ModalFooter } from './FormBits';
import { COLORS, fmt } from '../theme';

const r3 = (n) => Math.round(n * 1000) / 1000;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Compact sheet-style table, like the paper "ARAVAI BATCHING PROCESS PLAN":
// CODE | MATERIAL NAME | NO OF BAGS | WEIGHT | WEIGHED QTY   (Done by / Checked by are picked once below)
// Lives outside the modal component so the inputs keep focus while typing.
const COL = { code: 78, bags: 78, wt: 92, qty: 104, filter: 64, photo: 64 };

function Cell({ value, onChange, placeholder, digits, error, width }) {
  const clean = (t) => {
    if (digits) return t.replace(/[^0-9]/g, '');
    let x = t.replace(/[^0-9.]/g, '');
    const i = x.indexOf('.');
    return i === -1 ? x : x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
  };
  return (
    <TextInput value={value || ''} onChangeText={(t) => onChange(clean(t))} placeholder={placeholder} placeholderTextColor="#B8A99C"
      keyboardType={digits ? 'number-pad' : 'decimal-pad'} textAlign="center"
      style={[t.cell, { width }, !!error && { borderColor: COLORS.danger, backgroundColor: COLORS.dangerBg }]} />
  );
}

// Tick box used for the per-material "Filter" column (and the select-all in the header)
function FilterBox({ on, onPress, size = 24 }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <MCI name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={size} color={on ? COLORS.primary : COLORS.grey} />
    </Pressable>
  );
}

function SheetHeader({ wide, allFilter, onToggleAll }) {
  if (!wide) return null;
  return (
    <View style={t.head}>
      <Text style={[t.th, { width: COL.code }]}>CODE</Text>
      <Text style={[t.th, { flex: 1 }]}>MATERIAL NAME</Text>
      <Text style={[t.th, { width: COL.bags, textAlign: 'center' }]}>NO OF BAGS</Text>
      <Text style={[t.th, { width: COL.wt, textAlign: 'center' }]}>WEIGHT (KG)</Text>
      <Text style={[t.th, { width: COL.qty, textAlign: 'center' }]}>WEIGHED QTY</Text>
      <View style={{ width: COL.filter, alignItems: 'center' }}>
        <Text style={t.th}>FILTER</Text>
        <FilterBox on={allFilter} onPress={onToggleAll} size={18} />
      </View>
      <Text style={[t.th, { width: COL.photo, textAlign: 'center' }]}>PHOTO</Text>
    </View>
  );
}

// Weighing machine photo button of one material row: upload icon (not checked) / green tick (MATCH or verified) / red or amber alert
function PhotoBtn({ photo, onPress }) {
  const st = photo && photo.status;
  const name = photo && photo.passed ? 'check-circle' : st ? 'alert-circle' : 'image-plus';
  const color = photo && photo.passed ? COLORS.ok : st === 'MISMATCH' ? COLORS.danger : st === 'UNREADABLE' ? COLORS.warn : COLORS.primary;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Weighing machine photo">
      <MCI name={name} size={26} color={color} />
    </Pressable>
  );
}

function SheetRow({ item, row, errors, wide, onChange, filter, onToggleFilter, photo, panel, onTogglePhoto, onPhoto, canManual }) {
  const inputs = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Cell width={COL.bags} digits placeholder="Bags" value={row.bags} onChange={(x) => onChange('bags', x)} error={errors.bags} />
      <Text style={t.x}>×</Text>
      <Cell width={COL.wt} placeholder="kg/bag" value={row.wt} onChange={(x) => onChange('wt', x)} error={errors.wt} />
      <Text style={t.x}>=</Text>
      <Cell width={COL.qty} placeholder="Qty kg" value={row.qty} onChange={(x) => onChange('qty', x)} error={errors.qty} />
    </View>
  );
  const box = <FilterBox on={filter} onPress={onToggleFilter} />;
  const camBtn = <PhotoBtn photo={photo} onPress={onTogglePhoto} />;
  return (
    <View style={[t.row, filter && t.rowOn]}>
      <View style={[t.rowMain, !wide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={[{ flexDirection: 'row', alignItems: 'center' }, wide ? { flex: 1 } : { marginBottom: 6 }]}>
          <View style={t.code}><Text style={t.codeText}>{item.material_code}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={t.name} numberOfLines={1}>{item.material_name}</Text>
            <Text style={t.stock}>Stock {fmt(item.current_stock)} kg</Text>
          </View>
          {!wide && <View style={{ alignItems: 'center', marginLeft: 8 }}><Text style={t.thSmall}>FILTER</Text>{box}</View>}
          {!wide && <View style={{ alignItems: 'center', marginLeft: 8 }}><Text style={t.thSmall}>PHOTO</Text>{camBtn}</View>}
        </View>
        {inputs}
        {wide && <View style={{ width: COL.filter, alignItems: 'center' }}>{box}</View>}
        {wide && <View style={{ width: COL.photo, alignItems: 'center' }}>{camBtn}</View>}
      </View>
      {!!(errors.bags || errors.wt || errors.qty || errors.photo) && <Text style={t.err}>{errors.qty || errors.bags || errors.wt || errors.photo}</Text>}
      {/* kept mounted once opened, so a verified photo is not lost when the panel is closed */}
      {panel !== undefined && (
        <View style={panel === 'open' ? { marginTop: 8 } : { display: 'none' }}>
          <WeightImageVerify batchId={null} materialId={item.material_id} enteredWeight={row.qty} required uploadOnly canManual={canManual} error={errors.photo} onChange={onPhoto} />
        </View>
      )}
    </View>
  );
}

const t = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 4 },
  th: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  row: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 7, paddingHorizontal: 4 },
  rowOn: { backgroundColor: `${COLORS.primary}0D`, borderRadius: 8 },
  thSmall: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, color: COLORS.grey },
  rowMain: { flexDirection: 'row', alignItems: 'center' },
  code: { width: COL.code - 8, marginRight: 8, backgroundColor: COLORS.greyBg, borderRadius: 6, paddingVertical: 3, alignItems: 'center' },
  codeText: { fontSize: 11.5, fontWeight: '900', color: COLORS.grey },
  name: { fontSize: 14.5, fontWeight: '800', color: COLORS.text },
  stock: { fontSize: 11, fontWeight: '600', color: COLORS.grey },
  cell: { height: 38, borderWidth: 1, borderColor: '#E3D3C8', borderRadius: 8, backgroundColor: '#fff', fontSize: 14, fontWeight: '700', color: COLORS.text, paddingHorizontal: 6, outlineStyle: 'none' },
  x: { width: 16, textAlign: 'center', color: COLORS.grey, fontWeight: '800' },
  err: { color: COLORS.danger, fontSize: 11.5, fontWeight: '700', marginTop: 3, marginLeft: 4 },
  fcheck: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginTop: 4, backgroundColor: '#fff' },
  fcheckOn: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}0D` },
});

// New batch (follows the Aravai batching sheet): date, product -> its recipe materials -> bags / weight / weighed qty
// for each -> done by + checked by -> save.  Saving closes BATCHING; the batch continues at ROASTING.
export default function StartBatchModal({ visible, onDismiss, onSaved }) {
  const { user, can } = useAuth();
  const { isWide } = useLayout();
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), visible);
  const machines = useOptions('/batches/weighing-machines', {}, (m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}${m.locked_batch_no ? `  (in use: ${m.locked_batch_no})` : ''}`, lockedBatch: m.locked_batch_no || '' }), visible);
  const staff = useOptions('/batches/staff', {}, (u) => ({ value: u.id, label: `${u.full_name} (${u.role_name})` }), visible);
  const [date, setDate] = useState(today());
  const [productId, setProductId] = useState(null);
  const [doneBy, setDoneBy] = useState(null);
  const [checkedBy, setCheckedBy] = useState(null);
  const [machineId, setMachineId] = useState(null);
  const [filterIds, setFilterIds] = useState({}); // material_id -> true when that material must be filtered
  const [recipe, setRecipe] = useState(null); // { id, ingredients: [...] }
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [rows, setRows] = useState({}); // material_id -> { bags, wt, qty, touched }
  const [photos, setPhotos] = useState({}); // material_id -> { imageId, passed, status } weighing machine photo check
  const [panels, setPanels] = useState({}); // material_id -> 'open' | 'closed' (undefined = photo panel never opened)
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (visible) {
      setDate(today()); setProductId(null); setRecipe(null); setRows({}); setPhotos({}); setPanels({}); setErrors({}); setErr(''); setSaving(false);
      setDoneBy(user?.id || null); setCheckedBy(null); setMachineId(null); setFilterIds({});
    }
  }, [visible]); // eslint-disable-line

  useEffect(() => {
    setRecipe(null); setRows({}); setPhotos({}); setPanels({}); setErrors({}); setFilterIds({});
    setLoadingRecipe(false); // a cancelled request never clears the spinner itself
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

  const togglePhoto = (id) => () => setPanels((p) => ({ ...p, [id]: p[id] === 'open' ? 'closed' : 'open' }));
  const onPhoto = (id) => (st) => setPhotos((p) => ((p[id] && p[id].imageId === st.imageId && p[id].passed === st.passed && p[id].status === st.status) ? p : { ...p, [id]: st }));

  const toggleFilter = (id) => () => setFilterIds((p) => ({ ...p, [id]: !p[id] }));
  const allFilter = !!recipe && recipe.ingredients.length > 0 && recipe.ingredients.every((i) => filterIds[i.material_id]);
  const toggleAllFilter = () => setFilterIds(() => {
    if (allFilter || !recipe) return {};
    return Object.fromEntries(recipe.ingredients.map((i) => [i.material_id, true]));
  });
  // only materials that are actually weighed count (blank qty = not used in this batch)
  const filterNames = recipe ? recipe.ingredients.filter((i) => filterIds[i.material_id] && Number(rows[i.material_id]?.qty) > 0).map((i) => i.material_name) : [];
  const needsFiltering = filterNames.length > 0;

  const save = async () => {
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Use YYYY-MM-DD';
    if (!productId) e.product = 'Select the product';
    if (!doneBy) e.doneBy = 'Select who weighed';
    if (!machineId) e.machine = 'Select the weighing machine';
    else if (machines.find((o) => o.value === machineId)?.lockedBatch) e.machine = `This machine is locked to batch ${machines.find((o) => o.value === machineId).lockedBatch}. Choose another machine.`;
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
      // every weighed material needs its weighing machine photo to MATCH (or be verified manually) - checked again by the server
      if (machineId) {
        const missing = recipe.ingredients.filter((i) => Number(rows[i.material_id]?.qty) > 0 && !(photos[i.material_id] && photos[i.material_id].passed));
        if (missing.length) {
          e.photo = `Weighing machine photo is not verified for: ${missing.map((i) => i.material_name).join(', ')}`;
          missing.forEach((i) => { e[`m${i.material_id}photo`] = 'Verify the weight with the weighing machine photo'; });
          setPanels((p) => ({ ...p, ...Object.fromEntries(missing.map((i) => [i.material_id, 'open'])) }));
        }
      }
    }
    setErrors(e);
    if (Object.keys(e).length || !recipe) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post('/batches', { product_id: productId, recipe_id: recipe.id, production_date: date, done_by: doneBy, checked_by: checkedBy, weighing_machine_id: machineId, needs_filtering: needsFiltering,
        ingredients: recipe.ingredients.map((i) => {
          const x = rows[i.material_id] || {};
          return { material_id: i.material_id, no_of_bags: x.bags || undefined, weight_per_bag: x.wt || undefined, weighed_qty: x.qty || 0, needs_filtering: !!filterIds[i.material_id],
            weight_image_id: photos[i.material_id] && photos[i.material_id].passed ? photos[i.material_id].imageId : undefined };
        }) });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="scale-balance" maxWidth={760} title="New Batch"
      subtitle="Aravai Batching Process Plan"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={!recipe} label="Save Batch" />}>
      <View>
        <FormRow>
          <FormField label="Date (YYYY-MM-DD) *" value={date} onChangeText={setDate} error={errors.date} maxLength={10} />
          <SelectField label="Product *" value={productId} options={products} onChange={setProductId} error={errors.product} />
          <SelectField label="Weighing machine *" value={machineId} options={machines} onChange={setMachineId} error={errors.machine} />
        </FormRow>
        <Text style={{ fontSize: 12, color: COLORS.grey, fontWeight: '600', marginTop: -6, marginBottom: 12 }}>The machine is locked to the batch when the first weight is saved. Every other material of this batch must be weighed on it.</Text>
        {loadingRecipe && <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} />}
        {!!recipe && (
          <View>
            <SheetHeader wide={isWide} allFilter={allFilter} onToggleAll={toggleAllFilter} />
            {recipe.ingredients.map((i) => {
              const k = `m${i.material_id}`;
              return <SheetRow key={i.material_id} item={i} row={rows[i.material_id] || {}} wide={isWide} onChange={change(i.material_id)}
                filter={!!filterIds[i.material_id]} onToggleFilter={toggleFilter(i.material_id)}
                errors={{ bags: errors[`${k}bags`], wt: errors[`${k}wt`], qty: errors[`${k}qty`], photo: errors[`${k}photo`] }}
                photo={photos[i.material_id]} panel={panels[i.material_id]} onTogglePhoto={togglePhoto(i.material_id)} onPhoto={onPhoto(i.material_id)} canManual={can('batching', 'approve')} />;
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: total > 0 ? COLORS.okBg : COLORS.warnBg, borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 14 }}>
              <Text style={{ fontWeight: '800', color: total > 0 ? COLORS.ok : COLORS.warn }}>Total weighed</Text>
              <Text style={{ fontWeight: '900', fontSize: 16, color: total > 0 ? COLORS.ok : COLORS.warn }}>{fmt(total)} kg</Text>
            </View>
            <FormRow>
              <SelectField label="Done by *" value={doneBy} options={staff} onChange={setDoneBy} error={errors.doneBy} />
              <SelectField label="Checked by *" value={checkedBy} options={staff} onChange={setCheckedBy} error={errors.checkedBy} />
            </FormRow>

            {/* Filtering is not done here. Ticked materials send the batch to the Filtering menu before Roasting. */}
            <View style={[t.fcheck, needsFiltering && t.fcheckOn]}>
              <MCI name={needsFiltering ? 'filter-variant' : 'arrow-right-bold-circle-outline'} size={24} color={needsFiltering ? COLORS.primary : COLORS.grey} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontWeight: '800', color: COLORS.text }}>{needsFiltering ? `Filtering required (${filterNames.length})` : 'No filtering'}</Text>
                <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 2 }}>
                  {needsFiltering ? `${filterNames.join(', ')}. After saving, this batch goes to Filtering first, then Roasting.`
                    : 'Tick the Filter box on a material to filter it. Nothing ticked: this batch goes straight to Roasting.'}
                </Text>
              </View>
            </View>
          </View>
        )}
        <ErrorBox text={errors.total || errors.photo || err} />
      </View>
    </ModalShell>
  );
}