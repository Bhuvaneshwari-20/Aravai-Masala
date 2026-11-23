import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import AddMaterialModal from './AddMaterialModal';
import FormField from './FormField';
import SelectField from './SelectField';
import FormRow from './FormRow';
import useOptions from '../hooks/useOptions';
import useLayout from '../hooks/useLayout';
import WeightImageVerify from './WeightImageVerify';
import { ErrorBox, InfoBox, ModalFooter } from './FormBits';
import { COLORS, fmt } from '../theme';
import { REQUIRE_WEIGHT_PHOTO } from '../config';

const r3 = (n) => Math.round(n * 1000) / 1000;
const lineQty = (b, w) => (Number(b) || 0) * (Number(w) || 0);
// weighed qty of a material = first line + the extra bag-size lines
const sumQty = (cur) => lineQty(cur.bags, cur.wt) + (cur.extra || []).reduce((a, l) => a + lineQty(l.bags, l.wt), 0);
const recalc = (cur) => {
  if (!cur.touched || (cur.extra || []).length) { const q = sumQty(cur); cur.qty = q > 0 ? String(r3(q)) : ''; }
  return cur;
};
// weighing is in kg; a GRAM material keeps its stock in grams
const stockKg = (i) => Number(i.current_stock || 0) / (String(i.unit || '').toUpperCase() === 'GRAM' ? 1000 : 1);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Compact sheet-style table, like the paper "ARAVAI BATCHING PROCESS PLAN":
// CODE | MATERIAL NAME | NO OF BAGS | WEIGHT | WEIGHED QTY   (Done by / Checked by are picked once below)
// Lives outside the modal component so the inputs keep focus while typing.
const COL = { code: 92, bags: 92, wt: 108, qty: 124, filter: 72, photo: 72 };

function Cell({ value, onChange, placeholder, digits, error, width, readOnly }) {
  const clean = (t) => {
    if (digits) return t.replace(/[^0-9]/g, '');
    let x = t.replace(/[^0-9.]/g, '');
    const i = x.indexOf('.');
    return i === -1 ? x : x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
  };
  return (
    <TextInput value={value || ''} onChangeText={(t) => onChange(clean(t))} placeholder={placeholder} placeholderTextColor="#B8A99C"
      keyboardType={digits ? 'number-pad' : 'decimal-pad'} textAlign="center" editable={!readOnly}
      style={[t.cell, { width }, readOnly && { backgroundColor: COLORS.greyBg }, !!error && { borderColor: COLORS.danger, backgroundColor: COLORS.dangerBg }]} />
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
  const stale = !!(photo && photo.stale);
  const name = photo && photo.passed ? 'check-circle' : (st || stale) ? 'alert-circle' : 'image-plus';
  const color = photo && photo.passed ? COLORS.ok : (st === 'MISMATCH' || (photo && photo.machineStatus === 'MISMATCH')) ? COLORS.danger : (st === 'UNREADABLE' || stale) ? COLORS.warn : COLORS.primary;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="Weighing machine photo">
      <MCI name={name} size={26} color={color} />
    </Pressable>
  );
}

function SheetRow({ item, row, errors, wide, onChange, onLine, onAddLine, onRemoveLine, onRemoveMaterial, canRemove, filter, onToggleFilter, photo, panel, onTogglePhoto, onPhoto }) {
  const extra = row.extra || [];
  const inputs = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Cell width={COL.bags} digits placeholder="Bags" value={row.bags} onChange={(x) => onChange('bags', x)} error={errors.bags} />
      <Text style={t.x}>×</Text>
      <Cell width={COL.wt} placeholder="kg/bag" value={row.wt} onChange={(x) => onChange('wt', x)} error={errors.wt} />
      <Text style={t.x}>=</Text>
      <Cell width={COL.qty} placeholder="Qty kg" value={extra.length > 0 ? (lineQty(row.bags, row.wt) > 0 ? String(r3(lineQty(row.bags, row.wt))) : '') : row.qty} onChange={(x) => onChange('qty', x)} error={errors.qty} readOnly={extra.length > 0} />
    </View>
  );
  const tail = wide ? COL.filter + COL.photo : 32;
  const box = <FilterBox on={filter} onPress={onToggleFilter} />;
  const camBtn = <PhotoBtn photo={photo} onPress={onTogglePhoto} />;
  return (
    <View style={[t.row, filter && t.rowOn]}>
      <View style={[t.rowMain, !wide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={[{ flexDirection: 'row', alignItems: 'center' }, wide ? { flex: 1 } : { marginBottom: 6 }]}>
          <View style={t.code}><Text style={t.codeText}>{item.material_code}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={t.name} numberOfLines={1}>{item.material_name}</Text>
            <Text style={t.stock}>Stock {fmt(stockKg(item))} kg</Text>
          </View>
          {!wide && <View style={{ alignItems: 'center', marginLeft: 8 }}><Text style={t.thSmall}>FILTER</Text>{box}</View>}
          {!wide && <View style={{ alignItems: 'center', marginLeft: 8 }}><Text style={t.thSmall}>PHOTO</Text>{camBtn}</View>}
        </View>
        {inputs}
        {wide && <View style={{ width: COL.filter, alignItems: 'center' }}>{box}</View>}
        {wide && <View style={{ width: COL.photo, alignItems: 'center' }}>{camBtn}</View>}
      </View>
      {/* more bag sizes of the same material: 10 kg x 3 = 30, then 5 kg x 4 = 20 -> weighed qty 50 */}
      {extra.map((l, n) => (
        <View key={n} style={t.extraRow}>
          <Cell width={COL.bags} digits placeholder="Bags" value={l.bags} onChange={(x) => onLine(n, 'bags', x)} error={errors.lines && !(Number(l.bags) >= 1)} />
          <Text style={t.x}>×</Text>
          <Cell width={COL.wt} placeholder="kg/bag" value={l.wt} onChange={(x) => onLine(n, 'wt', x)} error={errors.lines && !(Number(l.wt) > 0)} />
          <Text style={t.x}>=</Text>
          <View style={[t.lineQty, { width: COL.qty }]}><Text style={t.lineQtyText}>{fmt(lineQty(l.bags, l.wt))}</Text></View>
          <Pressable onPress={() => onRemoveLine(n)} hitSlop={8} accessibilityLabel="Remove bag size" style={{ width: tail, alignItems: 'center' }}>
            <MCI name="close-circle" size={20} color={COLORS.danger} />
          </Pressable>
        </View>
      ))}
      <View style={[{ flexDirection: 'row', alignItems: 'center' }, wide ? { alignSelf: 'flex-end', marginRight: tail } : { alignSelf: 'flex-start' }]}>
        {canRemove && (
          <Pressable onPress={onRemoveMaterial} hitSlop={6} style={[t.addLine, { marginRight: 14 }]} accessibilityLabel="Remove this material from the batch">
            <MCI name="trash-can-outline" size={14} color={COLORS.danger} />
            <Text style={[t.addLineText, { color: COLORS.danger }]}>Remove material</Text>
          </Pressable>
        )}
        <Pressable onPress={onAddLine} hitSlop={6} style={t.addLine}>
          <MCI name="plus" size={14} color={COLORS.green} />
          <Text style={t.addLineText}>Add bag size</Text>
        </Pressable>
      </View>
      {extra.length > 0 && <Text style={t.matTotal}>{`Total ${item.material_name}: ${fmt(Number(row.qty) || 0)} kg`}</Text>}
      {!!(errors.bags || errors.wt || errors.qty || errors.photo) && <Text style={t.err}>{errors.qty || errors.bags || errors.wt || errors.photo}</Text>}
      {/* kept mounted once opened, so a verified photo is not lost when the panel is closed */}
      {panel !== undefined && (
        <View style={panel === 'open' ? { marginTop: 8 } : { display: 'none' }}>
          <WeightImageVerify key={item.material_id} batchId={null} materialId={item.material_id} enteredWeight={row.qty} required={REQUIRE_WEIGHT_PHOTO} error={errors.photo} onChange={onPhoto} />
        </View>
      )}
    </View>
  );
}

const t = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 4 },
  th: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  row: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 12, paddingHorizontal: 6 },
  rowOn: { backgroundColor: `${COLORS.primary}0D`, borderRadius: 8 },
  thSmall: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, color: COLORS.grey },
  rowMain: { flexDirection: 'row', alignItems: 'center' },
  code: { width: COL.code - 8, marginRight: 8, backgroundColor: COLORS.greyBg, borderRadius: 6, paddingVertical: 3, alignItems: 'center' },
  codeText: { fontSize: 11.5, fontWeight: '900', color: COLORS.grey },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  stock: { fontSize: 11, fontWeight: '600', color: COLORS.grey },
  cell: { height: 44, borderWidth: 1, borderColor: '#E3D3C8', borderRadius: 8, backgroundColor: '#fff', fontSize: 15, fontWeight: '700', color: COLORS.text, paddingHorizontal: 6, outlineStyle: 'none' },
  x: { width: 16, textAlign: 'center', color: COLORS.grey, fontWeight: '800' },
  err: { color: COLORS.danger, fontSize: 11.5, fontWeight: '700', marginTop: 3, marginLeft: 4 },
  extraRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 6 },
  lineQty: { height: 44, borderWidth: 1, borderColor: '#E3D3C8', borderRadius: 8, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  lineQtyText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  matTotal: { alignSelf: 'flex-end', marginTop: 4, marginRight: 4, fontSize: 12.5, fontWeight: '900', color: COLORS.ok },
  addLine: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingVertical: 2 },
  addLineText: { fontSize: 12, fontWeight: '800', color: COLORS.green, marginLeft: 3 },
  fcheck: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginTop: 4, backgroundColor: '#fff' },
  fcheckOn: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}0D` },
  choice: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: '#fff' },
  choiceOn: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}0D` },
  choiceErr: { borderColor: COLORS.danger },
  choiceTitle: { fontWeight: '800', color: COLORS.text, fontSize: 14 },
  choiceText: { fontSize: 12, color: COLORS.grey, marginTop: 2, lineHeight: 17 },
  pill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginTop: 4 },
  addMat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.green, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 12 },
  addMatText: { marginLeft: 8, fontSize: 14, fontWeight: '800', color: COLORS.green },
  removed: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 },
  undo: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginTop: 4 },
});

// short list of names: "Asafoetida, Black Pepper" / "A, B and 2 more"
const nameList = (items) => {
  const n = items.map((i) => i.material_name);
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
};

// Shown in the New Batch form as soon as a material is ticked for Filtering: the processing condition of the batch.
//  SEQUENTIAL   : each filtered material goes Filtering -> "Proceed to Roasting?" -> Roasting -> Grinding
//  SIMULTANEOUS : Filtering and Roasting of the material run independently (own card, own machine, own timer) -> Grinding after both
function RoastChoice({ filterItems, directItems, value, onChange }) {
  const opts = [
    { key: 'SEQUENTIAL', icon: 'arrow-right-bold-circle-outline', title: 'Sequential (Filtering first)',
      text: `Batching → Filtering → confirm "Proceed to Roasting?" → Roasting → Grinding. ${nameList(filterItems)} can be roasted only after it is filtered and you confirm.${directItems.length ? ` ${nameList(directItems)} can start Roasting straight away.` : ''}` },
    { key: 'SIMULTANEOUS', icon: 'call-split', title: 'Simultaneous (Filtering + Roasting)',
      text: `Filtering and Roasting run independently for ${nameList(filterItems)}, each with its own card, machine and timer. The material goes to Grinding only after both are completed.` },
  ];
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.text }}>Processing condition</Text>
      <Text style={{ fontSize: 12.5, color: COLORS.grey, marginTop: 2 }}>How should Filtering and Roasting work for this batch?</Text>
      {opts.map((o) => {
        const on = value === o.key;
        return (
          <TouchableOpacity key={o.key} activeOpacity={0.7} onPress={() => onChange(o.key)} accessibilityLabel={o.title}
            style={[t.choice, on && t.choiceOn]}>
            <MCI name={on ? 'radiobox-marked' : 'radiobox-blank'} size={24} color={on ? COLORS.primary : COLORS.grey} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={t.choiceTitle}>{o.title}</Text>
              <Text style={t.choiceText}>{o.text}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// latest active recipe version of a product (null when there is none)
const fetchRecipe = async (productId) => {
  const l = (await api.get('/recipes', { params: { product_id: productId, active: 'true', limit: 1 } })).data.data.items;
  if (!l.length) return null;
  return (await api.get(`/recipes/${l[0].id}`)).data.data;
};

// New batch (follows the Aravai batching sheet): date, product -> its recipe materials -> bags / weight / weighed qty
// for each -> done by + checked by -> save.  Saving closes BATCHING; the batch continues at FILTERING and/or ROASTING.
export default function StartBatchModal({ visible, onDismiss, onSaved }) {
  const { isWide } = useLayout();
  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), visible);
  // any active weighing machine can be chosen, also one that was used for an earlier batch (no "in use" lock)
  const machines = useOptions('/batches/weighing-machines', {}, (m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}`, code: m.machine_code, name: m.machine_name }), visible);
  const [date, setDate] = useState(today());
  const [productId, setProductId] = useState(null);
  const [machineId, setMachineId] = useState(null);
  const [filterIds, setFilterIds] = useState({}); // material_id -> true when that material must be filtered
  const [removed, setRemoved] = useState({}); // material_id -> true when the material is left out of this batch
  const [roastMode, setRoastMode] = useState('SEQUENTIAL'); // processing condition: 'SEQUENTIAL' | 'SIMULTANEOUS' (shown when a material is ticked for Filtering)
  const [recipe, setRecipe] = useState(null); // { id, ingredients: [...] }
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [rows, setRows] = useState({}); // material_id -> { bags, wt, qty, touched }
  const [photos, setPhotos] = useState({}); // material_id -> { imageId, passed, status } weighing machine photo check
  const [panels, setPanels] = useState({}); // material_id -> 'open' | 'closed' (undefined = photo panel never opened)
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // double-tap guard: a second Save press while the first request runs must not create a second batch (stock would be deducted twice)
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false); // "Add Material" popup

  useEffect(() => {
    if (visible) {
      setAddOpen(false);
      setDate(today()); setProductId(null); setRecipe(null); setRows({}); setPhotos({}); setPanels({}); setErrors({}); setErr(''); setSaving(false); savingRef.current = false;
      setMachineId(null); setFilterIds({}); setRemoved({}); setRoastMode('SEQUENTIAL');
    }
  }, [visible]); // eslint-disable-line

  useEffect(() => {
    setRecipe(null); setRows({}); setPhotos({}); setPanels({}); setErrors({}); setFilterIds({}); setRemoved({}); setRoastMode('SEQUENTIAL');
    setLoadingRecipe(false); // a cancelled request never clears the spinner itself
    if (!visible || !productId) return undefined;
    let live = true;
    (async () => {
      setLoadingRecipe(true); setErr('');
      try {
        const r = await fetchRecipe(productId);
        if (!r) { if (live) setErr('This product has no active recipe. Create the recipe first.'); }
        else if (live) setRecipe(r);
      } catch (e) { if (live) setErr(errMsg(e)); }
      if (live) setLoadingRecipe(false);
    })();
    return () => { live = false; };
  }, [productId, visible]);

  // bags x weight fills "weighed qty" until the user types a weighed qty by hand
  const change = (id) => (k, t) => setRows((p) => {
    const cur = { ...(p[id] || {}), [k]: t };
    if (k === 'qty') cur.touched = true;
    else recalc(cur);
    return { ...p, [id]: cur };
  });
  // extra bag sizes (3 x 10 kg + 4 x 5 kg = 50 kg)
  const addLine = (id) => () => setRows((p) => {
    const cur = { ...(p[id] || {}), extra: [...((p[id] || {}).extra || []), { bags: '', wt: '' }] };
    return { ...p, [id]: recalc(cur) };
  });
  const changeLine = (id) => (n, k, t) => setRows((p) => {
    const cur = { ...(p[id] || {}), extra: ((p[id] || {}).extra || []).map((l, j) => (j === n ? { ...l, [k]: t } : l)) };
    return { ...p, [id]: recalc(cur) };
  });
  const removeLine = (id) => (n) => setRows((p) => {
    const cur = { ...(p[id] || {}), extra: ((p[id] || {}).extra || []).filter((_, j) => j !== n) };
    if (!cur.extra.length) cur.touched = false;
    return { ...p, [id]: recalc(cur) };
  });

  const total = useMemo(() => r3(Object.entries(rows).reduce((a, [id, x]) => a + (removed[id] ? 0 : (Number(x.qty) || 0)), 0)), [rows, removed]);

  const togglePhoto = (id) => () => setPanels((p) => ({ ...p, [id]: p[id] === 'open' ? 'closed' : 'open' }));
  const onPhoto = (id) => (st) => {
    setPhotos((p) => ((p[id] && p[id].imageId === st.imageId && p[id].passed === st.passed && p[id].status === st.status && p[id].machineStatus === st.machineStatus && !!p[id].hasPhoto === !!st.hasPhoto && !!p[id].stale === !!st.stale) ? p : { ...p, [id]: st }));
    if (st.stale) setPanels((p) => (p[id] === 'open' ? p : { ...p, [id]: 'open' })); // weighed qty changed (e.g. bag size added): ask for the photo check again
  };

  // The weight read from the photo is only compared with the weighed qty; it never replaces it.
  // QR scanning / machine identification on the photo is switched off (MACHINE_QR_ENABLED in config.js); the machine chosen above is only stored with the batch.

  // materials that are part of this batch (a material can be removed with "Remove material")
  const active = recipe ? recipe.ingredients.filter((i) => !removed[i.material_id]) : [];
  const removedItems = recipe ? recipe.ingredients.filter((i) => removed[i.material_id]) : [];
  const removeMaterial = (id) => () => {
    setRemoved((p) => ({ ...p, [id]: true }));
    setFilterIds((p) => ({ ...p, [id]: false }));
    setRows((p) => { const n = { ...p }; delete n[id]; return n; });
    setPhotos((p) => { const n = { ...p }; delete n[id]; return n; });
    setErrors({});
  };
  const restoreMaterial = (id) => () => setRemoved((p) => ({ ...p, [id]: false }));

  // A material was added to the product recipe (the server saves a NEW recipe version; earlier batches keep the recipe version
  // they were made with, so the new material never shows up in them). Reload the recipe but keep everything typed so far.
  const onMaterialAdded = async () => {
    setAddOpen(false);
    try {
      const r = await fetchRecipe(productId);
      if (r) setRecipe(r);
    } catch (e) { setErr(errMsg(e)); }
  };

  const toggleFilter = (id) => () => { setFilterIds((p) => ({ ...p, [id]: !p[id] })); setRoastMode('SEQUENTIAL'); };
  const allFilter = active.length > 0 && active.every((i) => filterIds[i.material_id]);
  const toggleAllFilter = () => { setRoastMode('SEQUENTIAL'); setFilterIds(() => (allFilter || !recipe ? {} : Object.fromEntries(active.map((i) => [i.material_id, true])))); };
  // Every material of the batch is weighed, so every one of them counts here
  const filterItems = active.filter((i) => filterIds[i.material_id]);
  const directItems = active.filter((i) => !filterIds[i.material_id]);
  const filterNames = filterItems.map((i) => i.material_name);
  const needsFiltering = filterItems.length > 0;
  // some materials are filtered and some are not -> the user decides: roast the others now, or wait for the filtering
  const mixed = filterItems.length > 0 && directItems.length > 0;
  // Materials whose weighing machine photo weight is not a MATCH yet. A photo is needed for every material when
  // REQUIRE_WEIGHT_PHOTO is on; when it is off a photo is optional, but one that was taken (even a stale / failed / unchecked one) must be a MATCH.
  const photoPending = active.filter((i) => {
    const p = photos[i.material_id];
    const ok = !!(p && p.passed && String(p.materialId) === String(i.material_id));
    return !ok && (REQUIRE_WEIGHT_PHOTO || !!(p && (p.imageId || p.stale || p.hasPhoto)));
  });
  // Save Batch stays clickable for the other fields so that every empty / wrong one is highlighted when it is pressed,
  // but it is locked until QR and weight verification have passed for the materials above.
  const canSave = !!recipe && active.length > 0 && photoPending.length === 0;

  const save = async (modeArg) => {
    if (savingRef.current) return; // already saving: ignore the second tap
    const e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Use YYYY-MM-DD';
    if (!productId) e.product = 'Select the product';
    if (!machineId) e.machine = 'Select the weighing machine';
    if (recipe) {
      if (!active.length) e.total = 'A batch needs at least one material';
      // every material of the batch must be completely filled: bags, kg/bag and weighed qty
      active.forEach((i) => {
        const x = rows[i.material_id] || {};
        const k = `m${i.material_id}`;
        const multi = (x.extra || []).length > 0;
        if (!(Number(x.bags) >= 1)) e[`${k}bags`] = 'Enter number of bags';
        if (!(Number(x.wt) > 0)) e[`${k}wt`] = 'Enter weight per bag';
        if (!x.qty || !(Number(x.qty) > 0)) e[`${k}qty`] = 'Enter weighed qty';
        else if (Number(x.qty) > stockKg(i) + 0.0005) e[`${k}qty`] = `Only ${fmt(stockKg(i))} kg in stock`;
        if (multi && (x.extra || []).some((l) => !(Number(l.bags) >= 1) || !(Number(l.wt) > 0))) { e[`${k}qty`] = 'Fill bags and kg/bag in every bag size line'; e[`${k}lines`] = true; }
      });
      if (!e.total && !(total > 0)) e.total = 'Enter the quantity for every material';
      // the photo weight must be a MATCH with the weighed qty - checked again by the server
      {
        const missing = photoPending;
        if (missing.length) {
          e.photo = `Weight MATCH with the weighing machine photo is needed for: ${missing.map((i) => i.material_name).join(', ')}`;
          missing.forEach((i) => { e[`m${i.material_id}photo`] = 'Verify the weighed qty with the weighing machine photo (MATCH needed)'; });
          setPanels((p) => ({ ...p, ...Object.fromEntries(missing.map((i) => [i.material_id, 'open'])) }));
        }
      }
    }
    setErrors(e);
    if (Object.keys(e).length || !recipe) return;
    const pm = needsFiltering ? (typeof modeArg === 'string' ? modeArg : roastMode) || 'SEQUENTIAL' : 'SEQUENTIAL';
    const finalMode = !needsFiltering ? 'DIRECT' : pm === 'SIMULTANEOUS' ? 'PARALLEL' : 'AFTER_FILTERING';
    savingRef.current = true; setSaving(true); setErr('');
    try {
      const r = await api.post('/batches', { product_id: productId, recipe_id: recipe.id, production_date: date, weighing_machine_id: machineId, needs_filtering: needsFiltering,
        // DIRECT = nothing filtered | AFTER_FILTERING = roast only after filtering | PARALLEL = unfiltered materials roast now, filtered ones roast after their filtering
        roasting_mode: finalMode, process_mode: pm,
        ingredients: active.map((i) => {
          const x = rows[i.material_id] || {};
          const multi = (x.extra || []).length > 0;
          return { material_id: i.material_id, no_of_bags: multi ? undefined : (x.bags || undefined), weight_per_bag: multi ? undefined : (x.wt || undefined), weighed_qty: x.qty || 0,
            bag_lines: multi ? [{ bags: x.bags, weight: x.wt }, ...x.extra].map((l) => ({ bags: Number(l.bags), weight: Number(l.wt) })) : undefined, needs_filtering: !!filterIds[i.material_id],
            weight_image_id: photos[i.material_id] && photos[i.material_id].passed && String(photos[i.material_id].materialId) === String(i.material_id) ? photos[i.material_id].imageId : undefined };
        }) });
      setSaving(false); savingRef.current = false;
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); savingRef.current = false; }
  };

  return (
    <View>

    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="scale-balance" maxWidth={1000} title="New Batch"
      subtitle="Aravai Batching Process Plan"
      footer={<ModalFooter onCancel={onDismiss} onSave={() => save()} saving={saving} disabled={!canSave} label="Save Batch" />}>
      <View>
        <FormRow>
          <FormField label="Date (YYYY-MM-DD) *" value={date} onChangeText={setDate} error={errors.date} maxLength={10} />
          <SelectField label="Product *" value={productId} options={products} onChange={setProductId} error={errors.product} />
          <SelectField label="Weighing machine *" value={machineId} options={machines} onChange={setMachineId} error={errors.machine} />
        </FormRow>
        {loadingRecipe && (
          <View style={{ alignItems: 'center', margin: 16 }}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={{ color: COLORS.grey, fontWeight: '600', marginTop: 6 }}>Loading recipe…</Text>
          </View>)}
        {!!recipe && (
          <View>
            <SheetHeader wide={isWide} allFilter={allFilter} onToggleAll={toggleAllFilter} />
            {active.map((i) => {
              const k = `m${i.material_id}`;
              return <SheetRow key={i.material_id} item={i} row={rows[i.material_id] || {}} wide={isWide} onChange={change(i.material_id)}
                onLine={changeLine(i.material_id)} onAddLine={addLine(i.material_id)} onRemoveLine={removeLine(i.material_id)}
                onRemoveMaterial={removeMaterial(i.material_id)} canRemove={active.length > 1}
                filter={!!filterIds[i.material_id]} onToggleFilter={toggleFilter(i.material_id)}
                errors={{ bags: errors[`${k}bags`], wt: errors[`${k}wt`], qty: errors[`${k}qty`], lines: errors[`${k}lines`], photo: errors[`${k}photo`] }}
                photo={photos[i.material_id]} panel={panels[i.material_id]} onTogglePhoto={togglePhoto(i.material_id)} onPhoto={onPhoto(i.material_id)} />;
            })}
            {/* a material that is not in the recipe yet (e.g. Salt): added to the recipe as a new version, used from this batch onwards */}
            <Pressable onPress={() => setAddOpen(true)} style={t.addMat} accessibilityRole="button" accessibilityLabel="Add material">
              <MCI name="plus-circle-outline" size={20} color={COLORS.green} />
              <Text style={t.addMatText}>Add Material</Text>
            </Pressable>
            {removedItems.length > 0 && (
              <View style={t.removed}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.grey, marginRight: 6, marginTop: 4 }}>Left out of this batch:</Text>
                {removedItems.map((i) => (
                  <Pressable key={i.material_id} onPress={restoreMaterial(i.material_id)} style={t.undo} accessibilityLabel={`Add ${i.material_name} back`}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.text }}>{i.material_name}</Text>
                    <MCI name="undo-variant" size={14} color={COLORS.primary} style={{ marginLeft: 5 }} />
                  </Pressable>
                ))}
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: total > 0 ? COLORS.okBg : COLORS.warnBg, borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 14 }}>
              <Text style={{ fontWeight: '800', color: total > 0 ? COLORS.ok : COLORS.warn }}>Total weighed</Text>
              <Text style={{ fontWeight: '900', fontSize: 16, color: total > 0 ? COLORS.ok : COLORS.warn }}>{fmt(total)} kg</Text>
            </View>

            {photoPending.length > 0 && <InfoBox text={`Save Batch unlocks when the weight read from the weighing machine photo is a MATCH with the weighed qty. Pending: ${photoPending.map((i) => i.material_name).join(', ')}`} />}

            {/* Filtering is not done here. Ticked materials go to the Filtering menu; the others can go to Roasting. */}
            <View style={[t.fcheck, needsFiltering && t.fcheckOn]}>
              <MCI name={needsFiltering ? 'filter-variant' : 'arrow-right-bold-circle-outline'} size={24} color={needsFiltering ? COLORS.primary : COLORS.grey} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontWeight: '800', color: COLORS.text }}>{needsFiltering ? `${filterNames.length} of ${active.length} materials need filtering` : 'No filtering needed'}</Text>
                <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 2 }}>
                  {!needsFiltering ? 'Tick the Filter box for a material that needs filtering. If you tick nothing, roasting starts directly.'
                    : `${filterNames.join(', ')} will go to the Filtering cards. Choose the processing condition below.`}
                </Text>
              </View>
            </View>

            {needsFiltering && <RoastChoice filterItems={filterItems} directItems={directItems} value={roastMode} onChange={setRoastMode} />}
          </View>
        )}
        <ErrorBox text={errors.total || errors.photo || err} />
      </View>
    </ModalShell>
    <AddMaterialModal visible={visible && addOpen} productId={productId} productName={(products.find((o) => o.value === productId) || {}).label}
      onDismiss={() => setAddOpen(false)} onAdded={onMaterialAdded} />
    </View>
  );
}