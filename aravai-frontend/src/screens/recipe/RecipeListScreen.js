import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import api, { errMsg } from '../../api';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useOptions from '../../hooks/useOptions';
import useLayout from '../../hooks/useLayout';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import ConfirmDialog from '../../components/ConfirmDialog';
import { COLORS, SHADOW } from '../../theme';

/* =====================================================================================================
 * Ingredients / Recipe (product-wise)
 *   The product is CREATED here (just the name). Its size + MRP are added later in Product & MRP (product dropdown).
 *   Product  = e.g. "Chicken Masala"
 *   Ingredients of that product = the raw materials it is made from (Red Chilli, Cumin Seeds, Salt ...)
 * No quantities here - they are weighed in Batching.
 * APIs (no backend change):
 *   GET  /products?include=recipe        products with their current ingredient list
 *   GET  /recipes?product_id=  /recipes/:id
 *   POST /products {product_name}        new product (name only)
 *   POST /recipes                        first ingredient list of a product
 *   PUT  /recipes/:id                    full new list (saved as a new version, old version is kept)
 *   GET  /materials                      ingredients can ONLY be picked from Material Master (KG materials) - none are created here
 * ===================================================================================================== */
const TINTS = ['#FBE3E3', '#FFF0D6', '#E3F1EE', '#EAE6F8', '#E6F0FB', '#F6E6F1'];
const tint = (id) => TINTS[Number(id) % TINTS.length];
const norm = (t) => String(t || '').trim().replace(/\s+/g, ' ');
const usable = (m) => m.unit === 'KG' || m.unit === 'GRAM'; // materials a recipe can use
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const SHOW = 8; // ingredient chips shown on a product card

export default function IngredientListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { pad, contentWidth } = useLayout();
  const navigation = useNavigation();
  // 'recipe' is in the Masters menu group, so the role check passes. (The old 'ingredient' module is in no group any more,
  // which is why Add Recipe / Edit ingredients disappeared.)
  const canCreate = can('recipe', 'create');
  const canEdit = can('recipe', 'edit');
  const canDelete = can('product', 'delete') && can('recipe', 'delete'); // deleting removes the product AND its recipe
  const canNewProduct = can('product', 'create');

  /* ---------- product list ---------- */
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 350);
  const list = usePagedList('/products', { search: dq || undefined, active: 'true', include: 'recipe' });
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } list.silentReload(); }, [list.silentReload])); // eslint-disable-line

  /* ---------- delete product (with its whole recipe) ---------- */
  const [del, setDel] = useState(null);          // product about to be deleted
  const [delBusy, setDelBusy] = useState(false);
  const removeProduct = async () => {
    setDelBusy(true);
    try { await api.delete(`/products/${del.id}`, { params: { with_recipe: 'true' } }); toast('Product deleted'); list.silentReload(); }
    catch (e) { toast(errMsg(e)); }
    setDel(null); setDelBusy(false);
  };

  /* ---------- popup ---------- */
  const [modal, setModal] = useState(false);
  const [presetProduct, setPresetProduct] = useState(null);
  const [pname, setPname] = useState('');          // product name typed (or fixed when opened from a card)
  const [rec, setRec] = useState(null);            // current (latest) recipe of the chosen product
  const [loadingRec, setLoadingRec] = useState(false);
  const [items, setItems] = useState([]);          // [{ material_id|null, name }]
  const [txt, setTxt] = useState('');
  const [materials, setMaterials] = useState([]);  // all active materials [{ id, name, unit, stock }]
  const [matsLoaded, setMatsLoaded] = useState(false);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);

  const products = useOptions('/products', { active: 'true' }, (p) => ({ value: p.id, label: p.product_name }), modal);
  const matched = presetProduct ? products.find((p) => p.value === presetProduct) : products.find((p) => same(p.label, pname));
  const productId = matched ? matched.value : null;   // null = a new product (created on save)
  const productName = matched ? matched.label : norm(pname);

  const open = (p) => {
    setPresetProduct(p ? p.id : null); setPname(p ? p.product_name : '');
    setRec(null); setItems([]); setTxt(''); setErrs({}); setBusy(false);
    setModal(true);
  };
  const close = () => { if (!busy) setModal(false); };

  // all active materials, for suggestions and duplicate checks
  useEffect(() => {
    if (!modal) return undefined;
    let live = true;
    setMatsLoaded(false);
    (async () => {
      try {
        const d = (await api.get('/materials', { params: { active: 'true', limit: 100 } })).data.data;
        if (live) setMaterials((d.items || d).map((m) => ({ id: m.id, name: m.material_name, unit: m.unit, stock: Number(m.current_stock) || 0 })));
      } catch (e) { /* suggestions are optional */ }
      if (live) setMatsLoaded(true);
    })();
    return () => { live = false; };
  }, [modal]);

  // when a product is chosen, load its existing ingredients
  useEffect(() => {
    setRec(null); setItems([]); setTxt(''); setLoadingRec(false);
    if (!modal || !productId) return undefined;
    let live = true;
    setLoadingRec(true);
    (async () => {
      try {
        const l = (await api.get('/recipes', { params: { product_id: productId, limit: 20 } })).data.data.items || [];
        if (l.length) { // newest version first
          const full = (await api.get(`/recipes/${l[0].id}`)).data.data;
          if (live) { setRec(full); setItems(full.ingredients.map((i) => ({ material_id: i.material_id, name: i.material_name }))); }
        }
      } catch (e) { if (live) setErrs({ top: errMsg(e) }); }
      if (live) setLoadingRec(false);
    })();
    return () => { live = false; };
  }, [productId, modal]); // eslint-disable-line

  const pick = (m) => {
    if (!usable(m)) { setErrs((e) => ({ ...e, list: `${m.name} is in ${m.unit}. Only GRAM or KG materials can be used in a recipe.` })); return; }
    if (items.some((i) => i.material_id === m.id)) return;
    setItems((l) => [...l, { material_id: m.id, name: m.name }]);
    setErrs((e) => ({ ...e, list: '' }));
  };
  const drop = (i) => { setItems((l) => l.filter((_, k) => k !== i)); setErrs((e) => ({ ...e, list: '' })); };

  // every active material of Material Master that is not yet in this product (txt = search filter only).
  // GRAM / KG materials first; materials in another unit are shown greyed (a recipe can use GRAM or KG materials only).
  const available = useMemo(() => {
    const k = norm(txt).toLowerCase();
    return materials
      .filter((m) => m.stock > 0 && !items.some((i) => i.material_id === m.id) && (!k || m.name.toLowerCase().includes(k)))
      .sort((a, b) => (usable(a) ? 0 : 1) - (usable(b) ? 0 : 1));
  }, [materials, items, txt]);
  const total = materials.filter((m) => m.stock > 0).length; // materials that have stock
  const goStock = () => { setModal(false); navigation.navigate('StockList'); };

  const save = async () => {
    const e = {};
    if (!norm(pname) && !productId) e.product = 'Enter the product name';
    else if (!items.length) e.list = 'Add at least one ingredient';
    else if (!productId && !canNewProduct) e.product = 'This product does not exist and you cannot add new products. Ask an admin.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      // 0) new product: create it with just the name (size + MRP come later in Product & MRP)
      let pid = productId;
      if (!pid) {
        const name = norm(pname);
        const found = (await api.get('/products', { params: { search: name, limit: 100 } })).data.data.items || [];
        const hit = found.find((x) => same(x.product_name, name));
        pid = hit ? hit.id : (await api.post('/products', { product_name: name, packs: [] })).data.data.id;
      }
      const next = items;
      // 1) save the product's ingredient list (existing quantities, if any, are kept by the backend)
      const body = { ingredients: next.map((x) => ({ material_id: x.material_id })) };
      if (rec) await api.put(`/recipes/${rec.id}`, body);
      else await api.post('/recipes', { product_id: pid, ...body });
      toast(productId ? 'Ingredients saved' : 'Recipe saved');
      setModal(false); list.silentReload();
    } catch (x) {
      const m = x.response ? errMsg(x) : x.message;
      if (x.response && x.response.status === 409 && /no changes/i.test(m)) { toast('No changes to save'); setModal(false); }
      else setErrs({ top: m });
    }
    setBusy(false);
  };

  /* ---------- layout ---------- */
  const cols = contentWidth >= 1250 ? 3 : contentWidth >= 800 ? 2 : 1;
  const w = cols === 1 ? '100%' : cols === 2 ? '48.8%' : '32%';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 18, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Container maxWidth={1280}>
        <View style={s.toolbar}>
          <View style={s.searchBox}>
            <MCI name="magnify" size={19} color={COLORS.grey} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search products..." placeholderTextColor="#B2A69C" style={s.searchInput} />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={10}><MCI name="close-circle" size={17} color={COLORS.grey} /></Pressable>}
          </View>
          {(canCreate || canEdit) && (
            <Pressable onPress={() => open(null)} accessibilityRole="button" style={({ hovered }) => [s.addBtn, hovered && { backgroundColor: COLORS.primaryDark }]}>
              <MCI name="plus" size={18} color="#fff" /><Text style={s.addText}>Add Recipe</Text>
            </Pressable>
          )}
        </View>

        {!!list.error && <Text style={s.error}>{list.error}</Text>}
        {list.loading && <View style={{ padding: 40 }}><ActivityIndicator color={COLORS.primary} /></View>}
        {!list.loading && !list.items.length && !list.error && (
          <View style={s.emptyBox}>
            <MCI name="package-variant" size={42} color="#D8CCC0" />
            <Text style={s.emptyTitle}>{q ? 'No match' : 'No recipes yet'}</Text>
            <Text style={s.emptySub}>{q ? 'Try another name.' : 'Press "Add Recipe" to add the first product and its ingredients.'}</Text>
          </View>
        )}

        <View style={s.grid}>
          {list.items.map((p, i) => {
            const r = p.current_recipe;
            const ing = r ? r.ingredients : [];
            const allowed = r ? canEdit : canCreate;
            return (
              <FadeIn key={p.id} delay={Math.min(i, 10) * 35} from={12} style={[s.card, SHADOW.sm, { width: w }, !r && s.cardDash]}>
                <View style={s.top}>
                  <View style={[s.avatar, { backgroundColor: tint(p.id) }]}><Text style={s.avatarText}>{String(p.product_name).trim().charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                    <Text style={s.name} numberOfLines={1}>{p.product_name}</Text>
                    <Text style={s.code}>{r ? `${p.product_code} · ${ing.length} ingredient${ing.length === 1 ? '' : 's'}` : p.product_code}</Text>
                  </View>
                  <Text style={[s.pill, r ? s.pillOk : s.pillWarn]}>{r ? '● Added' : '● Pending'}</Text>
                </View>

                {r ? (
                  <View style={s.chips}>
                    {ing.slice(0, SHOW).map((m, k) => (<View key={m.id || k} style={s.chip}><Text style={s.chipText} numberOfLines={1}>{m.material_name}</Text></View>))}
                    {ing.length > SHOW && <View style={[s.chip, s.chipMore]}><Text style={[s.chipText, { color: COLORS.primary }]}>{`+${ing.length - SHOW} more`}</Text></View>}
                  </View>
                ) : (
                  <Text style={s.none}>No ingredients added for this product yet.</Text>
                )}

                {(allowed || canDelete) && (
                  <View style={{ flexDirection: 'row', marginTop: 4 }}>
                    {allowed && (
                      <Pressable onPress={() => open(p)} accessibilityRole="button" style={({ hovered }) => [s.link, { flex: 1, marginTop: 0 }, !r && { backgroundColor: COLORS.primarySoft }, hovered && { backgroundColor: '#F3D5D5' }]}>
                        <MCI name={r ? 'pencil-outline' : 'plus'} size={16} color={COLORS.primary} />
                        <Text style={s.linkText}>{r ? 'Edit ingredients' : 'Add ingredients'}</Text>
                      </Pressable>
                    )}
                    {canDelete && (
                      <Pressable onPress={() => setDel(p)} accessibilityRole="button" accessibilityLabel={`Delete ${p.product_name}`}
                        style={({ hovered }) => [s.delBtn, hovered && { backgroundColor: '#F9D3CE' }]}>
                        <MCI name="trash-can-outline" size={18} color={COLORS.danger} />
                      </Pressable>
                    )}
                  </View>
                )}
              </FadeIn>
            );
          })}
        </View>

        {list.items.length < list.total && (
          <Pressable onPress={list.loadMore} style={s.more}>
            {list.loadingMore ? <ActivityIndicator size={16} color={COLORS.primary} /> : <Text style={s.moreText}>{`Load more (${list.items.length} of ${list.total})`}</Text>}
          </Pressable>
        )}
      </Container>

      {/* ---------- Add / Edit ingredients popup ---------- */}
      <ModalShell visible={modal} onDismiss={close} busy={busy} icon="shaker-outline" maxWidth={560}
        title={rec ? 'Edit Ingredients' : 'New Recipe'}
        subtitle={productName ? `Ingredients of ${productName}` : 'Product name and its ingredients'}
        footer={(
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={s.count}>{(productId || productName) ? `${items.length} ingredient${items.length === 1 ? '' : 's'}` : ''}</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={close} disabled={busy} style={s.cancel}><Text style={s.cancelText}>Cancel</Text></Pressable>
            {!!productName && (rec ? canEdit : canCreate) && (
              <Pressable onPress={save} disabled={busy || loadingRec} style={({ hovered }) => [s.save, hovered && { backgroundColor: COLORS.primaryDark }, (busy || loadingRec) && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator size={16} color="#fff" /> : <MCI name="check" size={18} color="#fff" />}
                <Text style={s.saveText}>Save</Text>
              </Pressable>
            )}
          </View>
        )}>
        <View>
          {matsLoaded && total === 0 && (
            <View style={s.noStock}>
              <MCI name="alert-circle-outline" size={22} color={COLORS.warn} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.noStockTitle}>Add material stock first</Text>
                <Text style={s.noStockSub}>Only materials that have stock can be added to a recipe. Add stock in Material Stock and Tracking, then come back here.</Text>
                <Pressable onPress={goStock} accessibilityRole="button" style={({ hovered }) => [s.noStockBtn, hovered && { backgroundColor: COLORS.primaryDark }]}>
                  <MCI name="package-variant-closed" size={16} color="#fff" />
                  <Text style={s.noStockBtnText}>Go to Material Stock</Text>
                </Pressable>
              </View>
            </View>
          )}
          <FormField label="Product name *" value={pname} onChangeText={(t) => { setPname(t); setErrs((e) => ({ ...e, product: '', top: '' })); }}
            error={errs.product} disabled={!!presetProduct} maxLength={120} autoFocus={!presetProduct}
            hint={!presetProduct && norm(pname) ? (productId ? 'Product exists. Its ingredients are shown below.' : 'New product - it will be created when you save.') : undefined} />

          {!!productName && (
            <View style={{ marginTop: 6 }}>
              {loadingRec && <View style={{ padding: 20 }}><ActivityIndicator color={COLORS.primary} /></View>}

              {!loadingRec && (
                <>
                  <Text style={s.label}>INGREDIENTS OF THIS PRODUCT</Text>
                  {items.length === 0 ? (
                    <Text style={s.empty}>No ingredients yet. Tap the materials below to add them.</Text>
                  ) : (
                    <View style={s.chips}>
                      {items.map((it, k) => (
                        <View key={it.material_id} style={[s.chip, s.chipOn]}>
                          <Text style={[s.chipText, { color: COLORS.text }]} numberOfLines={1}>{it.name}</Text>
                          <Pressable onPress={() => drop(k)} hitSlop={8} accessibilityLabel={`Remove ${it.name}`} style={s.x}><MCI name="close" size={14} color={COLORS.danger} /></Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  {!!errs.list && <Text style={s.error}>{errs.list}</Text>}

                  <View style={s.addBox}>
                    <Text style={s.label}>{`SELECT FROM MATERIALS (${total})`}</Text>
                    {total > 12 && (
                      <View style={s.find}>
                        <MCI name="magnify" size={18} color={COLORS.grey} />
                        <TextInput value={txt} onChangeText={setTxt} placeholder="Search materials..." placeholderTextColor="#B2A69C" style={s.findInput} />
                        {!!txt && <Pressable onPress={() => setTxt('')} hitSlop={10}><MCI name="close-circle" size={16} color={COLORS.grey} /></Pressable>}
                      </View>
                    )}
                    {available.length > 0 ? (
                      <View style={s.chips}>
                        {available.map((m) => (
                          <Pressable key={m.id} onPress={() => pick(m)} style={({ hovered }) => [s.chip, usable(m) ? s.chipPick : s.chipOff, hovered && usable(m) && { backgroundColor: '#F6DCDC' }]}>
                            <MCI name={usable(m) ? 'plus' : 'block-helper'} size={usable(m) ? 13 : 11} color={usable(m) ? COLORS.primary : COLORS.grey} />
                            <Text style={[s.chipText, { color: usable(m) ? COLORS.primary : COLORS.grey, marginLeft: 4 }]} numberOfLines={1}>{usable(m) ? m.name : `${m.name} · ${m.unit}`}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text style={s.hint}>{!total ? 'No material has stock yet. Add material stock first.' : txt.trim() ? 'No matching material.' : 'All materials are added.'}</Text>
                    )}
                  </View>
                </>
              )}
            </View>
          )}
          {!!errs.top && <Text style={[s.error, { marginTop: 10 }]}>{errs.top}</Text>}
        </View>
      </ModalShell>

      <ConfirmDialog visible={!!del} busy={delBusy} title="Delete product?" confirmText="Delete"
        message={`${del?.product_name || 'This product'} and all its ingredients will be deleted completely. This cannot be undone. A product that is already used in a batch cannot be deleted.`}
        onConfirm={removeProduct} onCancel={() => { if (!delBusy) setDel(null); }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 16 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 50, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 14 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14.5, fontWeight: '600', color: COLORS.text, height: 46 },
  addBtn: { height: 50, borderRadius: 16, paddingHorizontal: 22, marginLeft: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, ...SHADOW.sm },
  addText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1.5, borderColor: COLORS.border },
  cardDash: { borderStyle: 'dashed', backgroundColor: '#FCFAF7' },
  top: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '900', color: COLORS.primary },
  name: { fontSize: 16.5, fontWeight: '900', color: COLORS.text },
  code: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  pill: { fontSize: 11.5, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden', marginLeft: 8 },
  pillOk: { color: COLORS.ok, backgroundColor: COLORS.okBg },
  pillWarn: { color: COLORS.warn, backgroundColor: COLORS.warnBg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAF6F1', borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 11, paddingVertical: 6, marginRight: 8, marginBottom: 8, maxWidth: '100%' },
  chipMore: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primarySoft },
  chipOn: { backgroundColor: '#fff', borderColor: '#E3D3C8' },
  chipOff: { backgroundColor: '#F1ECE6', borderColor: '#F1ECE6' },
  chipPick: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primarySoft },
  chipText: { fontSize: 13, fontWeight: '800', color: COLORS.textSoft },
  x: { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  none: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 14, marginBottom: 8 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 12, backgroundColor: '#FAF6F1', marginTop: 4 },
  noStock: { flexDirection: 'row', backgroundColor: COLORS.warnBg, borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#F5D9B8' },
  noStockTitle: { fontSize: 14.5, fontWeight: '900', color: COLORS.warn },
  noStockSub: { fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft, marginTop: 3, lineHeight: 18 },
  noStockBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: COLORS.primary, marginTop: 10 },
  noStockBtnText: { marginLeft: 7, fontSize: 13, fontWeight: '800', color: '#fff' },
  delBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  linkText: { marginHorizontal: 8, fontSize: 13.5, fontWeight: '800', color: COLORS.primary },
  more: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border, marginTop: 6 },
  moreText: { fontSize: 14, fontWeight: '800', color: COLORS.primary },
  emptyBox: { alignItems: 'center', padding: 36 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  emptySub: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 3, textAlign: 'center' },
  error: { color: COLORS.danger, fontSize: 13, fontWeight: '700', marginTop: 8 },
  /* popup */
  label: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.8, color: COLORS.grey, marginTop: 8 },
  empty: { fontSize: 13.5, fontWeight: '600', color: COLORS.grey, paddingVertical: 14 },
  addBox: { backgroundColor: '#FBF8F4', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  hint: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey, marginTop: 12 },
  find: { flexDirection: 'row', alignItems: 'center', height: 44, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E6DBD0', paddingHorizontal: 12, marginTop: 8 },
  findInput: { flex: 1, marginLeft: 8, fontSize: 14, fontWeight: '600', color: COLORS.text, height: 40 },
  count: { fontSize: 14, fontWeight: '900', color: COLORS.ok },
  cancel: { height: 48, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  cancelText: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  save: { height: 48, paddingHorizontal: 22, borderRadius: 14, backgroundColor: COLORS.primary, flexDirection: 'row', alignItems: 'center' },
  saveText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: '#fff' },
});