import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import api, { errMsg } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog';
import SelectField from '../../components/SelectField';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import DateField from '../../components/DateField';
import Container from '../../components/Container';
import useOptions from '../../hooks/useOptions';
import useLayout from '../../hooks/useLayout';
import { todayStr } from '../../components/FormBits';
import { dateOf, timeOf, who } from '../../components/RecipeTimeline';
import FadeIn from '../../components/FadeIn';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, GRADIENT, SHADOW, money, fmt } from '../../theme';

/* =====================================================================================================
 * Products & Recipes - two simple steps on one page
 *   1. Product & MRP : name + gram + MRP  ->  table of products
 *   2. Recipe        : pick a product, add materials with quantity (kg)  ->  save  ->  recipe shown below
 * Same API as before: /products, /products/:id/packs, /recipes, /grams, /materials.
 * ===================================================================================================== */

const nice = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}` : String(d || '');
};

const cleanNum = (t) => {
  let x = String(t).replace(/[^0-9.]/g, '');
  const i = x.indexOf('.');
  if (i !== -1) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
  return x;
};

/* ---------- small building blocks ---------- */
function SectionTitle({ n, title, sub }) {
  return (
    <View style={s.secHead}>
      <View style={s.secDot}><Text style={s.secNum}>{n}</Text></View>
      <View>
        <Text style={s.secTitle}>{title}</Text>
        <Text style={s.secSub}>{sub}</Text>
      </View>
      <View style={s.secLine} />
    </View>
  );
}

function Input({ label, value, onChangeText, numeric, error, editable = true, hint, style }) {
  return (
    <View style={[s.field, style]}>
      <FormField label={label} value={value} onChangeText={onChangeText} numeric={numeric} error={error} hint={hint} disabled={!editable} maxLength={numeric ? 12 : 120} />
    </View>
  );
}

function Btn({ label, icon, onPress, busy, kind = 'primary', disabled, full }) {
  const primary = kind === 'primary';
  const soft = kind === 'soft';
  const dark = primary;
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button"
      style={({ hovered, pressed }) => [s.btn, primary ? s.btnPrimary : soft ? s.btnSoft : s.btnGhost, full && { alignSelf: 'stretch' },
        hovered && (primary ? { backgroundColor: COLORS.primaryDark } : { backgroundColor: soft ? '#F6DCDC' : COLORS.greyBg }), pressed && { opacity: 0.88 }, (busy || disabled) && { opacity: 0.55 }]}>
      {busy ? <ActivityIndicator size={16} color={dark ? '#fff' : COLORS.primary} /> : !!icon && <MCI name={icon} size={18} color={dark ? '#fff' : soft ? COLORS.primary : COLORS.text} />}
      <Text style={[s.btnText, !dark && { color: soft ? COLORS.primary : COLORS.text }]}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({ icon, color, bg, onPress, label }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ hovered }) => [s.iconBtn, { backgroundColor: bg }, hovered && { opacity: 0.75 }]}>
      <MCI name={icon} size={15} color={color} />
    </Pressable>
  );
}

/* ---------- screen ---------- */
export default function ProductsRecipesView({ mode = 'product' }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { pad, contentWidth } = useLayout();
  const canCreateProduct = can('product', 'create');
  const canEditProduct = can('product', 'edit');
  const canDeleteProduct = can('product', 'delete');
  const canViewRecipe = mode === 'recipe' && can('recipe', 'view'); // recipe data / UI only on the Ingredients screen
  const canCreateRecipe = can('recipe', 'create');
  const canEditRecipe = can('recipe', 'edit');

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = (await api.get('/products', { params: { limit: 100, include: canViewRecipe ? 'recipe' : undefined } })).data.data;
      setProducts(d.items || []); setLoadErr('');
    } catch (e) { setLoadErr(errMsg(e)); }
    setLoading(false);
  }, [canViewRecipe]);
  useEffect(() => { load(); }, [load]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } load(); }, [load]));

  /* ======== Step 1 : Product & MRP ======== */
  const grams = useOptions('/grams', {}, (g) => ({ value: g.weight_grams, label: g.label }), true);
  const [name, setName] = useState('');
  const [size, setSize] = useState('');       // pack size number
  const [unitSel, setUnitSel] = useState('g'); // 'g' | 'kg'
  const [mrp, setMrp] = useState('');
  const [mrpFrom, setMrpFrom] = useState(todayStr()); // MRP applies from this date (older MRP ends the day before)
  const [editing, setEditing] = useState(null); // { product, pack } -> only the MRP can be changed
  const [pModal, setPModal] = useState(false);
  const [pErr, setPErr] = useState({});
  const [pBusy, setPBusy] = useState(false);
  const [delPack, setDelPack] = useState(null); // { product, pack }
  const [delBusy, setDelBusy] = useState(false);

  const sameName = useMemo(() => {
    const n = name.trim().toLowerCase();
    return n ? products.find((p) => p.product_name.trim().toLowerCase() === n) || null : null;
  }, [name, products]);

  const resetProductForm = () => { setName(''); setSize(''); setUnitSel('g'); setMrp(''); setMrpFrom(todayStr()); setEditing(null); setPErr({}); };

  const startEdit = (product, pack) => {
    setEditing({ product, pack }); setName(product.product_name); const w = Number(pack.weight_grams); if (w >= 1000) { setSize(String(Number((w / 1000).toFixed(3)))); setUnitSel('kg'); } else { setSize(String(w)); setUnitSel('g'); }
    setMrp(String(pack.mrp)); setMrpFrom(todayStr()); setPErr({}); setPModal(true);
  };

  const weightGrams = () => { const n = Number(size); return unitSel === 'kg' ? Math.round(n * 1000 * 100) / 100 : Math.round(n * 100) / 100; };

  const saveProduct = async () => {
    const e = {};
    const w = weightGrams();
    if (!name.trim() || (!editing && !sameName)) e.name = 'Select the product (products are added in Ingredients)';
    if (!editing && (!size || !(w > 0))) e.size = 'Enter the size';
    if (!mrp || Number(mrp) <= 0) e.mrp = 'Enter the MRP';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mrpFrom)) e.from = 'Select the date';
    if (!editing && sameName && (sameName.packs || []).some((p) => Number(p.weight_grams) === w)) e.size = 'This product already has this size. Tap it to change the MRP.';
    setPErr(e);
    if (Object.keys(e).length) return;
    setPBusy(true);
    try {
      if (editing) {
        await api.put(`/products/${editing.product.id}/packs/${editing.pack.id}`, { mrp, effective_from: mrpFrom });
        toast('MRP updated');
      } else {
        // the size must exist in the sizes list (grams master) - add it silently when it is new
        if (!grams.some((g) => Number(g.value) === w)) {
          try { await api.post('/grams', { weight_grams: w }); } catch (x) {
            const st = x.response && x.response.status;
            if (st !== 409 && st !== 403) throw x; // 409 = size already exists, 403 = no permission on sizes: the product call below reports it if the size is really missing
          }
        }
        await api.post(`/products/${sameName.id}/packs`, { weight_grams: w, mrp, effective_from: mrpFrom });
        toast(`${size}${unitSel} added to ${sameName.product_name}`);
      }
      resetProductForm(); setPModal(false); await load();
    } catch (x) { toast(x.response ? errMsg(x) : x.message); }
    setPBusy(false);
  };

  const removePack = async () => {
    setDelBusy(true);
    try { await api.delete(`/products/${delPack.product.id}/packs/${delPack.pack.id}`); setDelPack(null); resetProductForm(); setPModal(false); toast('Deleted'); await load(); }
    catch (x) { setDelPack(null); toast(errMsg(x)); }
    setDelBusy(false);
  };

  /* ======== Step 2 : Recipe ======== */
  const materials = useOptions('/materials', { active: 'true' }, (m) => ({ value: m.id, label: m.material_name, unit: m.unit }), canViewRecipe);
  const [productId, setProductId] = useState(null);
  const [rows, setRows] = useState([]);          // [{ material_id, name, qty }]
  const [matId, setMatId] = useState(null);
  const [qty, setQty] = useState('');
  const [rErr, setRErr] = useState({});
  const [rBusy, setRBusy] = useState(false);
  const [rModal, setRModal] = useState(false);

  const product = products.find((p) => p.id === productId) || null;
  const rec = product ? product.current_recipe || null : null;
  const recKey = rec ? rec.id : 0;
  const productOptions = useMemo(() => products.filter((p) => p.is_active !== false).map((p) => ({ value: p.id, label: p.product_name })), [products]);
  const matOptions = useMemo(() => materials.filter((m) => (m.unit === 'KG' || m.unit === 'GRAM') && !rows.some((r) => r.material_id === m.value)), [materials, rows]);

  // load the saved recipe of the chosen product into the table
  useEffect(() => {
    setRows(rec ? rec.ingredients.map((i) => ({ material_id: i.material_id, name: i.material_name, qty: Number(i.quantity_kg) ? String(Number(i.quantity_kg)) : '' })) : []);
    setMatId(null); setQty(''); setRErr({});
  }, [productId, recKey]); // eslint-disable-line

  const addRow = () => {
    const e = {};
    if (!matId) e.mat = 'Select a material';
    if (!qty || Number(qty) <= 0) e.qty = 'Enter the quantity';
    setRErr(e);
    if (Object.keys(e).length) return;
    const m = materials.find((x) => x.value === matId);
    setRows((r) => [...r, { material_id: matId, name: m.label, qty }]);
    setMatId(null); setQty('');
  };
  const setRowQty = (id, v) => setRows((r) => r.map((x) => (x.material_id === id ? { ...x, qty: cleanNum(v) } : x)));
  const dropRow = (id) => setRows((r) => r.filter((x) => x.material_id !== id));

  const saveRecipe = async () => {
    const e = {};
    if (!productId) e.product = 'Select the product';
    else if (!rows.length) e.rows = 'Add at least one material';
    else {
      const bad = rows.find((r) => !r.qty || Number(r.qty) <= 0);
      if (bad) e.rows = `Enter the quantity for ${bad.name}`;
    }
    setRErr(e);
    if (Object.keys(e).length) return;
    const body = { ingredients: rows.map((r) => ({ material_id: r.material_id, quantity_kg: r.qty })) };
    setRBusy(true);
    try {
      if (rec) {
        await api.put(`/recipes/${rec.id}`, body);
      } else {
        const created = (await api.post('/recipes', { product_id: productId, ...body })).data.data;
        // older backend builds ignore the quantity on create: set it with one update so the quantities are never lost
        const saved = new Map((created.ingredients || []).map((i) => [i.material_id, Number(i.quantity_kg || 0)]));
        if (rows.some((r) => saved.get(r.material_id) !== Number(r.qty))) await api.put(`/recipes/${created.id}`, body);
      }
      toast('Recipe saved');
      setRModal(false); setProductId(null);
      await load();
    } catch (x) { toast(errMsg(x)); }
    setRBusy(false);
  };

  const [q, setQ] = useState('');
  const openRecipe = (p) => { setProductId(p ? p.id : null); setRErr({}); setRModal(true); };
  const closeRecipe = () => { if (rBusy) return; setRModal(false); setProductId(null); };
  const openAddProduct = () => { resetProductForm(); setPModal(true); };
  const closeProduct = () => { if (pBusy) return; setPModal(false); resetProductForm(); };

  const wide = contentWidth >= 900;
  const twoCols = contentWidth >= 1000;
  const canWriteRecipe = rec ? canEditRecipe : canCreateRecipe;
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? products.filter((p) => p.product_name.toLowerCase().includes(n) || String(p.product_code).toLowerCase().includes(n)) : products;
  }, [products, q]);
  const withRecipe = products.filter((p) => p.current_recipe).length;
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const showRecipes = mode === 'recipe' && canViewRecipe;
  const recipeCards = shown.filter((p) => p.is_active !== false);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 18, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Container>
        {/* ---------- hero ---------- */}
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, SHADOW.md]}>
          <View style={s.heroBlob1} /><View style={s.heroBlob2} />
          <View style={[s.heroRow, !wide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={s.heroIcon}><MCI name="shaker-outline" size={28} color="#fff" /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.heroTitle}>{mode === 'recipe' ? 'Ingredients' : 'Product & MRP'}</Text>
                <Text style={s.heroSub}>{mode === 'recipe' ? 'Add the raw materials and quantity used to make each product.' : 'Add products with their size and MRP.'}</Text>
              </View>
            </View>
            <View style={[s.heroStats, !wide && { marginTop: 16 }]}>
              <View style={s.heroStat}><Text style={s.heroNum}>{products.length}</Text><Text style={s.heroLbl}>Products</Text></View>
              {mode === 'product' && <View style={s.heroStat}><Text style={s.heroNum}>{products.reduce((a, p) => a + (p.packs || []).length, 0)}</Text><Text style={s.heroLbl}>Sizes</Text></View>}
              {canViewRecipe && <View style={s.heroStat}><Text style={s.heroNum}>{withRecipe}</Text><Text style={s.heroLbl}>With recipe</Text></View>}
              {canViewRecipe && <View style={s.heroStat}><Text style={s.heroNum}>{products.length - withRecipe}</Text><Text style={s.heroLbl}>Pending</Text></View>}
            </View>
          </View>
        </LinearGradient>

        {/* ---------- toolbar : search + add button ---------- */}
        <View style={s.toolbar}>
          <View style={s.searchBox}>
            <MCI name="magnify" size={19} color={COLORS.grey} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search products..." placeholderTextColor="#B2A69C" style={s.searchInput} />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={10}><MCI name="close-circle" size={17} color={COLORS.grey} /></Pressable>}
          </View>
          {mode === 'product' && canCreateProduct && <View style={{ marginLeft: 12 }}><Btn icon="plus" label="Add Size & MRP" onPress={openAddProduct} /></View>}
          {mode === 'recipe' && canCreateRecipe && <View style={{ marginLeft: 12 }}><Btn icon="plus" label="Add Recipe" onPress={() => openRecipe(null)} /></View>}
        </View>

        {!!loadErr && <Text style={s.error}>{loadErr}</Text>}
        {loading && <View style={{ padding: 40 }}><ActivityIndicator color={COLORS.primary} /></View>}
        {!loading && !shown.length && (mode === 'product' || showRecipes) && (
          <View style={s.emptyBox}><MCI name="package-variant" size={40} color="#D8CCC0" /><Text style={s.emptyTitle}>{q ? 'No match' : 'No products yet'}</Text><Text style={s.emptySub}>{q ? 'Try another name.' : mode === 'recipe' ? 'Add products first in Product & MRP.' : 'Add a product in Ingredients first, then add its size and MRP here.'}</Text></View>
        )}

        {/* ================= PRODUCTS TAB ================= */}
        {mode === 'product' && (
          <View style={s.grid}>
            {shown.map((p, i) => (
              <FadeIn key={p.id} delay={Math.min(i, 8) * 45} from={12} style={[s.pCard, SHADOW.sm, twoCols ? { width: '48.8%' } : { width: '100%' }]}>
                <View style={s.pTop}>
                  <View style={[s.avatar, { backgroundColor: tint(p.id) }]}><Text style={s.avatarText}>{p.product_name.trim().charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                    <Text style={s.pName} numberOfLines={1}>{p.product_name}</Text>
                    <Text style={s.pCode}>{p.product_code}</Text>
                  </View>
                  {canViewRecipe && <Text style={[s.pill, p.current_recipe ? s.pillOk : s.pillWarn]}>{p.current_recipe ? '● Recipe added' : '● No recipe'}</Text>}
                </View>
                <View style={s.chips}>
                  {(p.packs || []).map((k) => (
                    <Pressable key={k.id} disabled={!canEditProduct} onPress={() => startEdit(p, k)} accessibilityLabel={`Edit MRP of ${p.product_name} ${k.packing_size_label}`}
                      style={({ hovered }) => [s.chip, hovered && canEditProduct && { backgroundColor: '#F6DCDC' }]}>
                      <Text style={s.chipG}>{k.packing_size_label}</Text>
                      <Text style={s.chipM}>{money(k.mrp)}</Text>
                    </Pressable>
                  ))}
                  {!(p.packs || []).length && <Text style={s.pCode}>No size added</Text>}
                </View>
                {canEditProduct && <Text style={s.tip}>Tap a size to change its MRP / see history</Text>}
              </FadeIn>
            ))}
          </View>
        )}

        {/* ================= RECIPES TAB ================= */}
        {showRecipes && (
          <View style={s.grid}>
            {recipeCards.map((p, i) => {
              const r = p.current_recipe;
              const ing = r ? r.ingredients : [];
              return (
                <FadeIn key={p.id} delay={Math.min(i, 8) * 45} from={12} style={[s.pCard, SHADOW.sm, twoCols ? { width: '48.8%' } : { width: '100%' }, !r && s.pCardDash]}>
                  <View style={s.pTop}>
                    <View style={[s.avatar, { backgroundColor: tint(p.id) }]}><MCI name="book-open-variant" size={22} color={COLORS.primary} /></View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                      <Text style={s.pName} numberOfLines={1}>{p.product_name}</Text>
                      <Text style={s.pCode}>{r ? `${p.product_code} · v${r.version_no} · ${ing.length} materials` : p.product_code}</Text>
                    </View>
                    <Text style={[s.pill, r ? s.pillOk : s.pillWarn]}>{r ? `● v${r.version_no} Latest` : '● Incomplete'}</Text>
                  </View>
                  {r ? (
                    <View style={s.mTable}>
                      {ing.slice(0, 5).map((m, k) => (
                        <View key={m.id || k} style={[s.mRow, k > 0 && { borderTopWidth: 1, borderTopColor: COLORS.line }]}>
                          <Text style={s.mName} numberOfLines={1}>{m.material_name}</Text>
                          <Text style={s.mQty}>{Number(m.quantity_kg) ? `${fmt(Number(m.quantity_kg))} kg` : '-'}</Text>
                        </View>
                      ))}
                      {ing.length > 5 && <Text style={s.more}>{`+ ${ing.length - 5} more materials`}</Text>}
                    </View>
                  ) : (
                    <Text style={[s.pCode, { marginTop: 14, marginBottom: 4 }]}>No recipe yet. Add the materials used to make this product.</Text>
                  )}
                  {(r ? canEditRecipe : canCreateRecipe) && (
                    <Pressable onPress={() => openRecipe(p)} accessibilityRole="button" style={({ hovered }) => [s.pLink, !r && { backgroundColor: COLORS.primarySoft }, hovered && { backgroundColor: '#F3D5D5' }]}>
                      <MCI name={r ? 'pencil-outline' : 'plus'} size={16} color={COLORS.primary} />
                      <Text style={s.pLinkText}>{r ? 'Edit recipe' : 'Create recipe'}</Text>
                    </Pressable>
                  )}
                </FadeIn>
              );
            })}
          </View>
        )}
      </Container>

      {/* ---------- Add / Edit product popup ---------- */}
      <ModalShell visible={pModal && mode === 'product'} onDismiss={closeProduct} busy={pBusy} icon={editing ? 'pencil' : 'tag-plus-outline'} maxWidth={480}
        title={editing ? 'Edit MRP' : 'Add Size & MRP'}
        subtitle={editing ? `${editing.product.product_name} · ${editing.pack.packing_size_label}` : 'Select the product, then its size and MRP'}
        footer={(
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {!!editing && canDeleteProduct && <Pressable onPress={() => setDelPack(editing)} style={s.delLink}><MCI name="trash-can-outline" size={16} color={COLORS.danger} /><Text style={s.delText}>Delete</Text></Pressable>}
            <View style={{ flex: 1 }} />
            <Btn kind="ghost" label="Cancel" onPress={closeProduct} disabled={pBusy} />
            <View style={{ marginLeft: 10 }}><Btn label={editing ? 'Update MRP' : 'Save'} icon="check" onPress={saveProduct} busy={pBusy} /></View>
          </View>
        )}>
        <View>
          {!!editing && <Text style={s.editNote}>Enter the new MRP and the date it starts. The old price stays in the history.</Text>}
          <Text style={s.secLabel}>PRODUCT</Text>
          {editing
            ? <Input label="Product *" value={name} onChangeText={setName} editable={false} />
            : <SelectField label="Product *" value={sameName ? sameName.id : null} options={productOptions}
                onChange={(id) => { const p = products.find((x) => x.id === id); setName(p ? p.product_name : ''); setPErr((x) => ({ ...x, name: '' })); }} error={pErr.name} />}

          <Text style={[s.secLabel, { marginTop: 8 }]}>PACK SIZE</Text>
          <View style={s.sizeRow}>
            <Input label="Size *" value={size} onChangeText={setSize} numeric error={pErr.size} editable={!editing} style={{ flex: 1, marginRight: 12 }} />
            <View style={[s.unitSwitch, !!editing && { opacity: 0.55 }]}>
              {['g', 'kg'].map((u) => (
                <Pressable key={u} disabled={!!editing} onPress={() => setUnitSel(u)} accessibilityRole="button" style={[s.unitOpt, unitSel === u && s.unitOptOn]}>
                  <Text style={[s.unitOptText, unitSel === u && { color: '#fff' }]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Text style={[s.secLabel, { marginTop: 8 }]}>PRICE</Text>
          <View style={s.sizeRow}>
            <Input label="MRP (₹) *" value={mrp} onChangeText={setMrp} numeric error={pErr.mrp} style={{ flex: 1, marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <DateField label="Applies from *" value={mrpFrom} onChangeText={setMrpFrom} error={pErr.from}
                hint={editing ? 'Old MRP ends the day before.' : undefined} />
            </View>
          </View>
          {!editing && !!(size && mrp) && (
            <View style={s.preview}>
              <MCI name="tag-outline" size={16} color={COLORS.primary} />
              <Text style={s.previewText} numberOfLines={1}>{`${name || 'Product'} · ${size} ${unitSel} · ₹ ${mrp}`}</Text>
            </View>
          )}
          {!!editing && !!(editing.pack.mrp_history || []).length && (
            <View style={s.hist}>
              <Text style={s.histTitle}>MRP history</Text>
              {[...editing.pack.mrp_history].reverse().map((h) => (
                <View key={h.id} style={s.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.histMrp}>{money(h.mrp)}</Text>
                    <Text style={s.histDate}>{`${nice(h.effective_from)} → ${h.effective_to ? nice(h.effective_to) : 'onwards'}`}</Text>
                  </View>
                  <Text style={[s.histTag, h.status === 'CURRENT' ? s.pillOk : h.status === 'UPCOMING' ? s.pillWarn : s.histPast]}>{h.status === 'CURRENT' ? 'Running' : h.status === 'UPCOMING' ? 'Upcoming' : 'Past'}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ModalShell>

      {/* ---------- Add / Edit recipe popup ---------- */}
      <ModalShell visible={rModal && mode === 'recipe'} onDismiss={closeRecipe} busy={rBusy} icon="book-plus-outline" maxWidth={640}
        title={rec ? 'Edit Recipe' : 'Create Recipe'}
        subtitle={product ? `${product.product_name}${rec ? ` · now v${rec.version_no}` : ''}` : 'Select a product and add its materials'}
        footer={(
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={s.totalInline}>{`Total ${fmt(total)} kg`}</Text>
            <View style={{ flex: 1 }} />
            <Btn kind="ghost" label="Cancel" onPress={closeRecipe} disabled={rBusy} />
            {!!product && canWriteRecipe && <View style={{ marginLeft: 10 }}><Btn label="Save Recipe" icon="check" onPress={saveRecipe} busy={rBusy} /></View>}
          </View>
        )}>
        <View>
          <SelectField label="Product *" value={productId} options={productOptions} onChange={setProductId} error={rErr.product} />
          {!!product && canWriteRecipe && (
            <View style={s.addBox}>
              <SelectField label="Raw material" value={matId} options={matOptions} onChange={setMatId} error={rErr.mat} />
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Input label="Quantity" value={qty} onChangeText={setQty} numeric error={rErr.qty} style={{ flex: 1, marginRight: 10 }} />
                <Input label="Unit" value="kg" onChangeText={() => {}} editable={false} style={{ width: 80, marginRight: 10 }} />
                <View style={{ marginTop: 4 }}><Btn kind="soft" icon="plus" label="Add" onPress={addRow} /></View>
              </View>
            </View>
          )}
          {!!product && !canWriteRecipe && <Text style={s.editNote}>You can only view this recipe.</Text>}
          {!!product && (
            <View style={[s.table, { marginTop: 14 }]}>
              <View style={s.trHead}>
                <Text style={[s.th, { width: 32 }]}>#</Text>
                <Text style={[s.th, { flex: 2 }]}>Material</Text>
                <Text style={[s.th, { flex: 1 }]}>Quantity</Text>
                <Text style={[s.th, { width: 32 }]}>Unit</Text>
                <Text style={[s.th, { width: 38 }]} />
              </View>
              {!rows.length && <Text style={s.empty}>No materials yet. Add them above.</Text>}
              {rows.map((r, i) => (
                <View key={r.material_id} style={s.tr}>
                  <Text style={[s.td, { width: 32, color: COLORS.grey }]}>{i + 1}</Text>
                  <Text style={[s.td, { flex: 2, fontWeight: '800' }]} numberOfLines={1}>{r.name}</Text>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    {canWriteRecipe
                      ? <TextInput value={r.qty} onChangeText={(t) => setRowQty(r.material_id, t)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#B2A69C" style={s.cellInput} />
                      : <Text style={s.td}>{r.qty ? fmt(Number(r.qty)) : '-'}</Text>}
                  </View>
                  <Text style={[s.td, { width: 32, color: COLORS.grey }]}>kg</Text>
                  <View style={{ width: 38, alignItems: 'center' }}>
                    {canWriteRecipe && <IconBtn icon="close" color={COLORS.danger} bg={COLORS.dangerBg} label={`Remove ${r.name}`} onPress={() => dropRow(r.material_id)} />}
                  </View>
                </View>
              ))}
            </View>
          )}
          {!!rErr.rows && <Text style={s.error}>{rErr.rows}</Text>}
        </View>
      </ModalShell>

      <ConfirmDialog visible={!!delPack} busy={delBusy} title="Delete this size?"
        message={delPack ? `${delPack.pack.packing_size_label} of ${delPack.product.product_name} and its MRP history will be deleted. Sizes already used in packing or stock cannot be deleted.` : ''}
        confirmText="Delete" onConfirm={removePack} onCancel={() => setDelPack(null)} />
    </ScrollView>
  );
}

const TINTS = ['#FBE3E3', '#FFF0D6', '#E3F1EE', '#EAE6F8', '#E6F0FB', '#F6E6F1'];
const tint = (id) => TINTS[Number(id) % TINTS.length];

const s = StyleSheet.create({
  secLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 },
  sizeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  preview: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 6 },
  previewText: { flex: 1, marginLeft: 8, fontSize: 13.5, fontWeight: '800', color: COLORS.text },
  unitSwitch: { flexDirection: 'row', height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: '#E6DBD0', overflow: 'hidden', backgroundColor: '#FBF8F4', marginTop: 6 },
  unitOpt: { width: 52, alignItems: 'center', justifyContent: 'center' },
  unitOptOn: { backgroundColor: COLORS.primary },
  unitOptText: { fontSize: 15, fontWeight: '900', color: COLORS.textSoft },
  hist: { marginTop: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, backgroundColor: '#FBF8F4' },
  histTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1, color: COLORS.grey, marginBottom: 6 },
  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.line },
  histMrp: { fontSize: 15, fontWeight: '900', color: COLORS.text },
  histDate: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  histTag: { fontSize: 11.5, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  histPast: { color: COLORS.grey, backgroundColor: COLORS.greyBg },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
  tab: { flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 18, borderRadius: 15, marginRight: 10 },
  tabOn: { backgroundColor: COLORS.primary, ...SHADOW.sm },
  tabOff: { backgroundColor: COLORS.primarySoft },
  tabText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: COLORS.primaryDark },
  tabCount: { minWidth: 26, height: 22, borderRadius: 11, backgroundColor: 'rgba(176,30,30,0.12)', alignItems: 'center', justifyContent: 'center', marginLeft: 10, paddingHorizontal: 7 },
  tabCountText: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  toolbar: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 16 },
  pCardDash: { borderStyle: 'dashed', backgroundColor: '#FCFAF7' },
  tip: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  mTable: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginTop: 14, marginBottom: 12, overflow: 'hidden' },
  mRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  mName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.text },
  mQty: { fontSize: 13.5, fontWeight: '800', color: COLORS.textSoft, marginLeft: 10 },
  more: { fontSize: 12, fontWeight: '800', color: COLORS.primary, padding: 8, textAlign: 'center', backgroundColor: '#FAF6F1' },
  totalInline: { fontSize: 14, fontWeight: '900', color: COLORS.ok },
  addBox: { backgroundColor: '#FBF8F4', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 4 },
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, overflow: 'hidden' },
  hero: { borderRadius: 26, padding: 24, marginBottom: 6, overflow: 'hidden' },
  heroBlob1: { position: 'absolute', right: -50, top: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroBlob2: { position: 'absolute', right: 120, bottom: -90, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.06)' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  heroTitle: { fontSize: 26, fontWeight: '900', color: '#fff' },
  heroSub: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.82)', marginTop: 3 },
  heroStats: { flexDirection: 'row' },
  heroStat: { minWidth: 92, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 10, alignItems: 'center' },
  heroNum: { fontSize: 24, fontWeight: '900', color: '#fff' },
  heroLbl: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  secHead: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 14 },
  secDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  secNum: { color: '#fff', fontSize: 16, fontWeight: '900' },
  secTitle: { fontSize: 21, fontWeight: '900', color: COLORS.text },
  secSub: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  secLine: { flex: 1, height: 1.5, backgroundColor: COLORS.border, marginLeft: 16 },

  split: {},
  formCard: { backgroundColor: '#fff', borderRadius: 22, padding: 20, borderWidth: 1.5, borderColor: COLORS.border },
  formHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  formIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  formTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  editNote: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft, backgroundColor: COLORS.primarySoft, borderRadius: 12, padding: 10, marginBottom: 12 },
  field: { marginBottom: 2 },
  delLink: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  delText: { marginLeft: 6, fontSize: 13, fontWeight: '800', color: COLORS.danger },

  btn: { height: 50, borderRadius: 16, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: COLORS.primary, ...SHADOW.sm },
  btnSoft: { backgroundColor: COLORS.primarySoft },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border },
  btnText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: '#fff' },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },

  searchBox: { flexDirection: 'row', alignItems: 'center', height: 50, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14, marginBottom: 16 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14.5, fontWeight: '600', color: COLORS.text, height: 46 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  pCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1.5, borderColor: COLORS.border },
  pCardSel: { borderColor: COLORS.primary },
  pTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '900', color: COLORS.primary },
  pName: { fontSize: 16.5, fontWeight: '900', color: COLORS.text },
  pCode: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  pill: { fontSize: 11.5, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden', marginLeft: 8 },
  pillOk: { color: COLORS.ok, backgroundColor: COLORS.okBg },
  pillWarn: { color: COLORS.warn, backgroundColor: COLORS.warnBg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  chip: { backgroundColor: '#FAF6F1', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 8, alignItems: 'center', minWidth: 72 },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipG: { fontSize: 13, fontWeight: '900', color: COLORS.text },
  chipM: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary, marginTop: 1 },
  pLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 12, backgroundColor: '#FAF6F1', marginTop: 4 },
  pLinkText: { marginHorizontal: 8, fontSize: 13.5, fontWeight: '800', color: COLORS.primary },

  paper: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1.5, borderColor: COLORS.border, overflow: 'hidden', minHeight: 260 },
  paperHead: { flexDirection: 'row', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  paperTitle: { fontSize: 19, fontWeight: '900', color: COLORS.text },
  recMeta: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  totalBox: { backgroundColor: COLORS.okBg, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', marginLeft: 12 },
  totalNum: { fontSize: 20, fontWeight: '900', color: COLORS.ok },
  totalLbl: { fontSize: 11, fontWeight: '800', color: COLORS.ok },
  trHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4EFE9', paddingHorizontal: 18, paddingVertical: 10 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: COLORS.grey, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 9, borderTopWidth: 1, borderTopColor: COLORS.line },
  td: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  cellInput: { height: 38, borderWidth: 1.5, borderColor: '#E6DBD0', borderRadius: 10, paddingHorizontal: 10, fontSize: 14, fontWeight: '700', color: COLORS.text, backgroundColor: '#fff', maxWidth: 160 },
  paperFoot: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.line, flexDirection: 'row', justifyContent: 'flex-end' },
  emptyBox: { alignItems: 'center', padding: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  emptySub: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 3, textAlign: 'center' },
  empty: { textAlign: 'center', color: COLORS.grey, fontSize: 13.5, fontWeight: '600', padding: 26 },
  error: { color: COLORS.danger, fontSize: 13, fontWeight: '700', marginTop: 8 },
});