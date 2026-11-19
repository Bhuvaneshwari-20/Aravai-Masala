import React, { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Switch, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import PackFormModal from '../../components/PackFormModal';
import useLayout from '../../hooks/useLayout';
import { dateOf, timeOf, who } from '../../components/RecipeTimeline';
import ProductTimeline from '../../components/ProductTimeline';
import { COLORS, SHADOW, money } from '../../theme';

const TABS = [
  { k: 'mrp', label: 'Product & MRP', icon: 'package-variant-closed' },
  { k: 'timeline', label: 'Timeline', icon: 'timeline-clock-outline' },
  { k: 'details', label: 'Details', icon: 'information-outline' },
];

// 2026-11-12 -> 12 Nov 2026
const niceDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return String(d || '');
  return `${m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`;
};

/* ---------- small pieces ---------- */
function SumCard({ icon, value, label, dark }) {
  return (
    <View style={[s.sum, dark && s.sumDark, SHADOW.sm]}>
      <View style={[s.sumIcon, dark && { backgroundColor: 'rgba(255,255,255,0.18)' }]}><MCI name={icon} size={22} color={dark ? '#fff' : COLORS.primary} /></View>
      <View style={{ marginLeft: 12, flexShrink: 1 }}>
        <Text style={[s.sumNum, dark && { color: '#fff' }]} numberOfLines={1}>{value}</Text>
        <Text style={[s.sumLabel, dark && { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function Panel({ title, icon, right, children, style }) {
  return (
    <View style={[s.panel, SHADOW.sm, style]}>
      {!!title && (
        <View style={s.panelHead}>
          {!!icon && <MCI name={icon} size={20} color={COLORS.primary} style={{ marginRight: 8 }} />}
          <Text style={s.panelTitle}>{title}</Text>
          <View style={{ flex: 1 }} />
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

const Row = ({ label, value }) => (
  <View style={s.kv}><Text style={s.kvLabel}>{label}</Text><Text style={s.kvValue} numberOfLines={1}>{value}</Text></View>
);

function SoftBtn({ icon, label, onPress, tone = 'primary' }) {
  const fg = tone === 'primary' ? COLORS.primary : COLORS.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered }) => [s.softBtn, { backgroundColor: hovered ? '#F3D5D5' : COLORS.primarySoft }]}>
      <MCI name={icon} size={16} color={fg} /><Text style={[s.softBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Round({ icon, color, bg, hover, onPress, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ hovered }) => [s.round, { backgroundColor: hovered ? hover : bg }]}>
      <MCI name={icon} size={18} color={color} />
    </Pressable>
  );
}

/* ---------- dashboard ---------- */
export default function ProductsDashboard({ list, sum, search, onSearch, status, onStatus, canView, canRecipeView, canRecipe, can,
  onAddProduct, onEditProduct, onDeleteProduct, onViewRecipe, onCreateRecipe, onChanged, toast }) {
  const { contentWidth, pad } = useLayout();
  const mode = contentWidth >= 1100 ? 'three' : contentWidth >= 720 ? 'two' : 'one';
  const items = list.items;
  const [selId, setSelId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [tab, setTab] = useState('mrp');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [packModal, setPackModal] = useState(null); // { pack: null | pack }
  const [delPack, setDelPack] = useState(null);
  const [busy, setBusy] = useState(false);

  const sel = items.find((p) => p.id === selId) || null;
  const canEdit = can('product', 'edit');
  const canCreate = can('product', 'create');
  const canDelete = can('product', 'delete');

  // keep a valid selection (first product by default, next one after a delete / search)
  useEffect(() => {
    if (list.loading) return;
    if (!items.length) { if (selId !== null) setSelId(null); return; }
    if (!items.some((p) => p.id === selId)) setSelId(items[0].id);
  }, [items, list.loading]); // eslint-disable-line

  useEffect(() => {
    if (!sel) return;
    setName(sel.product_name); setCategory(sel.category || ''); setActive(sel.is_active !== false);
  }, [sel ? sel.id : 0, sel ? sel.product_name : '', sel ? sel.category : '', sel ? sel.is_active : true]); // eslint-disable-line

  const dirty = !!sel && (name.trim() !== sel.product_name || category.trim() !== (sel.category || '') || active !== (sel.is_active !== false));

  const saveInfo = async () => {
    if (!name.trim()) { toast('Product name is required'); return; }
    setSavingInfo(true);
    try {
      await api.put(`/products/${sel.id}`, { product_name: name.trim(), category: category.trim(), is_active: active });
      toast('Product updated'); onChanged();
    } catch (e) { toast(errMsg(e)); }
    setSavingInfo(false);
  };

  const togglePack = async (p) => {
    try { await api.put(`/products/${sel.id}/packs/${p.id}`, { is_active: !p.is_active }); toast(`${p.packing_size_label} marked ${p.is_active ? 'inactive' : 'active'}`); onChanged(); }
    catch (e) { toast(errMsg(e)); }
  };

  const removePack = async () => {
    setBusy(true);
    try { await api.delete(`/products/${sel.id}/packs/${delPack.id}`); setDelPack(null); toast('Pack size deleted'); onChanged(); }
    catch (e) { setDelPack(null); toast(errMsg(e)); }
    setBusy(false);
  };

  const pick = (p) => { setSelId(p.id); setTab('mrp'); setMobileDetail(true); };
  const rec = sel ? sel.current_recipe : undefined; // undefined = no permission, null = no recipe

  /* ----- left : product list ----- */
  const listPanel = (
    <Panel title="Product List" right={<View style={s.count}><Text style={s.countText}>{sum.total ?? items.length}</Text></View>}>
      <View style={s.searchBox}>
        <MCI name="magnify" size={18} color={COLORS.grey} />
        <TextInput value={search} onChangeText={onSearch} placeholder="Search name or code..." placeholderTextColor="#A39890" autoCapitalize="none" autoCorrect={false} style={s.searchInput} />
        {!!search && <Pressable onPress={() => onSearch('')} hitSlop={10}><MCI name="close-circle" size={16} color={COLORS.grey} /></Pressable>}
      </View>
      <View style={s.chipsRow}>
        {[['true', 'Active'], ['false', 'Inactive'], ['all', 'All']].map(([k, l]) => (
          <Pressable key={k} onPress={() => onStatus(k)} accessibilityRole="button" accessibilityState={{ selected: status === k }}
            style={({ hovered }) => [s.chip, status === k && s.chipOn, status !== k && hovered && { backgroundColor: COLORS.greyBg }]}>
            <Text style={[s.chipText, status === k && { color: '#fff' }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={s.listScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {list.loading && !items.length && <ActivityIndicator style={{ margin: 24 }} color={COLORS.primary} />}
        {!list.loading && list.error && !items.length && <Text style={s.empty}>{list.error}</Text>}
        {!list.loading && !list.error && !items.length && <Text style={s.empty}>{search ? `No results for "${search}"` : 'No products found'}</Text>}
        {items.map((p) => {
          const on = p.id === selId && (mode !== 'one');
          return (
            <Pressable key={p.id} onPress={() => pick(p)} accessibilityRole="button" accessibilityLabel={`Open ${p.product_name}`}
              style={({ hovered }) => [s.item, on && s.itemOn, !on && hovered && { backgroundColor: '#FDFBF8' }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.itemName} numberOfLines={1}>{p.product_name}</Text>
                <Text style={s.itemCode} numberOfLines={1}>{p.product_code}</Text>
                <View style={s.itemMeta}>
                  <MCI name="package-variant-closed" size={14} color={COLORS.grey} />
                  <Text style={s.itemPacks}>{`${(p.packs || []).length} Pack Size${(p.packs || []).length === 1 ? '' : 's'}`}</Text>
                  {p.current_recipe !== undefined && <Badge tone={p.current_recipe ? 'ok' : 'warn'} text={p.current_recipe ? 'Recipe Added' : 'No Recipe'} dot={false} style={{ marginLeft: 8 }} />}
                  {p.is_active === false && <Badge tone="grey" text="Inactive" dot={false} style={{ marginLeft: 6 }} />}
                </View>
              </View>
              <MCI name="chevron-right" size={20} color={COLORS.grey} />
            </Pressable>
          );
        })}
        {list.loadingMore && <ActivityIndicator style={{ margin: 12 }} color={COLORS.primary} />}
      </ScrollView>
      <View style={s.listFoot}>
        <Text style={s.itemCode}>{`Showing ${items.length} of ${list.total}`}</Text>
        {list.hasMore && (
          <Pressable onPress={list.loadMore} accessibilityRole="button" style={({ hovered }) => [s.moreBtn, hovered && { backgroundColor: COLORS.primarySoft }]}>
            <Text style={s.moreText}>Load more</Text><MCI name="chevron-down" size={16} color={COLORS.primary} />
          </Pressable>
        )}
      </View>
    </Panel>
  );

  const summaryCard = !sel ? null : (
    <Panel title="Product Summary" icon="chart-box-outline">
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Row label="Total Pack Sizes" value={String((sel.packs || []).length)} />
        {rec !== undefined && <Row label="Total Materials (Recipe)" value={rec ? String(rec.ingredients.length) : '-'} />}
        {rec !== undefined && <Row label="Last Updated" value={rec ? `${dateOf(rec)}, ${timeOf(rec)}` : '-'} />}
        {rec !== undefined && <Row label="Updated By" value={rec ? who(rec) : '-'} />}
      </View>
    </Panel>
  );

  /* ----- center : product details ----- */
  const packs = sel ? (sel.packs || []) : [];
  const center = !sel ? (
    <Panel><Text style={[s.empty, { padding: 40 }]}>{list.loading ? 'Loading...' : 'Select a product from the list'}</Text></Panel>
  ) : (
    <Panel>
      <View style={s.cHead}>
        <View style={s.cTile}><MCI name="tag-outline" size={26} color={COLORS.primary} /></View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
          <Text style={s.cName} numberOfLines={2}>{sel.product_name}</Text>
          <Text style={s.itemCode} numberOfLines={1}>{`${sel.product_code}${sel.category ? `  •  ${sel.category}` : ''}`}</Text>
        </View>
        {rec !== undefined && <Badge tone={rec ? 'ok' : 'warn'} text={rec ? 'Recipe Added' : 'No Recipe'} style={{ marginRight: 8 }} />}
        {canEdit && <Round icon="pencil" color={COLORS.primary} bg={COLORS.primarySoft} hover="#F3D5D5" onPress={() => onEditProduct(sel)} label={`Edit ${sel.product_name}`} />}
        {canDelete && <View style={{ marginLeft: 8 }}><Round icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hover="#F9D3CE" onPress={() => onDeleteProduct(sel)} label={`Delete ${sel.product_name}`} /></View>}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {TABS.map((t) => {
          const on = tab === t.k;
          return (
            <Pressable key={t.k} onPress={() => setTab(t.k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={({ hovered }) => [s.tab, on ? s.tabOn : s.tabOff, !on && hovered && { backgroundColor: '#F6DCDC' }]}>
              <MCI name={t.icon} size={17} color={on ? '#fff' : COLORS.text} />
              <Text style={[s.tabText, on && { color: '#fff' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === 'mrp' && (
        <View>
          <View style={s.section}>
            <View style={s.secHead}><MCI name="tag-outline" size={18} color={COLORS.primary} /><Text style={s.secTitle}>Product Information</Text></View>
            <View style={s.fields}>
              <View style={s.field}><Text style={s.fLabel}>Product Name *</Text>
                <TextInput value={name} onChangeText={setName} editable={canEdit} maxLength={120} style={[s.input, !canEdit && s.inputOff]} /></View>
              <View style={s.field}><Text style={s.fLabel}>Product Code</Text>
                <TextInput value={sel.product_code} editable={false} style={[s.input, s.inputOff]} /></View>
              <View style={s.field}><Text style={s.fLabel}>Category</Text>
                <TextInput value={category} onChangeText={setCategory} editable={canEdit} maxLength={80} placeholder="e.g. Masala Powder" placeholderTextColor="#A39890" style={[s.input, !canEdit && s.inputOff]} /></View>
              <View style={s.field}><Text style={s.fLabel}>Unit</Text>
                <TextInput value="g (Gram)" editable={false} style={[s.input, s.inputOff]} /></View>
            </View>
            {canEdit && (
              <View style={s.infoFoot}>
                <Switch value={active} onValueChange={setActive} trackColor={{ true: COLORS.ok, false: '#D8CFC6' }} thumbColor="#fff" activeThumbColor="#fff" />
                <Text style={s.activeText}>{active ? 'Product is Active' : 'Product is Inactive'}</Text>
                <View style={{ flex: 1 }} />
                {dirty && (
                  <>
                    <Pressable onPress={() => { setName(sel.product_name); setCategory(sel.category || ''); setActive(sel.is_active !== false); }} accessibilityRole="button"
                      style={({ hovered }) => [s.discardBtn, hovered && { backgroundColor: COLORS.greyBg }]}>
                      <Text style={s.discardText}>Discard</Text>
                    </Pressable>
                    <Pressable onPress={saveInfo} disabled={savingInfo} accessibilityRole="button"
                      style={({ hovered }) => [s.saveBtn, savingInfo && { opacity: 0.6 }, hovered && { backgroundColor: COLORS.primaryDark }]}>
                      {savingInfo ? <ActivityIndicator size={14} color="#fff" /> : <MCI name="check" size={16} color="#fff" />}
                      <Text style={s.saveText}>Save changes</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={s.section}>
            <View style={s.secHead}>
              <MCI name="package-variant-closed" size={18} color={COLORS.primary} /><Text style={s.secTitle}>Pack Size & MRP</Text>
              <View style={{ flex: 1 }} />
              {canCreate && <SoftBtn icon="plus" label="Add Pack Size" onPress={() => setPackModal({ pack: null })} />}
            </View>
            <View style={s.table}>
              <View style={s.trHead}>
                <Text style={[s.th, { width: 48 }]}>S.No</Text>
                <Text style={[s.th, { flex: 1 }]}>Pack Size</Text>
                <Text style={[s.th, { width: 150, textAlign: 'right', paddingRight: 20 }]}>MRP (₹)</Text>
                <Text style={[s.th, { width: 92, textAlign: 'center' }]}>Status</Text>
                <Text style={[s.th, { width: 96, textAlign: 'center' }]}>Actions</Text>
              </View>
              {packs.length === 0 && <Text style={s.empty}>No pack sizes yet</Text>}
              {packs.map((p, i) => (
                <View key={p.id} style={[s.tr, i === packs.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={[s.td, { width: 48, color: COLORS.grey }]}>{i + 1}</Text>
                  <Text style={[s.td, { flex: 1, fontWeight: '800' }]}>{p.packing_size_label}</Text>
                  <View style={{ width: 150, alignItems: 'flex-end', paddingRight: 20 }}>
                    <Text style={[s.td, { fontWeight: '800' }]}>{Number(p.mrp).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    {!!p.mrp_from && <Text style={s.from}>{`from ${niceDate(p.mrp_from)}`}</Text>}
                    {!!p.next_mrp && <Text style={[s.from, { color: COLORS.warn }]}>{`next ${money(p.next_mrp.mrp)} on ${niceDate(p.next_mrp.effective_from)}`}</Text>}
                  </View>
                  <View style={{ width: 92, alignItems: 'center' }}>
                    <Pressable disabled={!canEdit} onPress={() => togglePack(p)} accessibilityRole="button" accessibilityLabel={`${p.packing_size_label} is ${p.is_active ? 'active' : 'inactive'}. Tap to change`}
                      style={({ hovered }) => [hovered && canEdit && { opacity: 0.7 }]}>
                      <Badge tone={p.is_active ? 'ok' : 'grey'} text={p.is_active ? 'Active' : 'Inactive'} dot={false} />
                    </Pressable>
                    {canEdit && <Text style={s.tapHint}>tap to change</Text>}
                  </View>
                  <View style={{ width: 96, flexDirection: 'row', justifyContent: 'center' }}>
                    {canEdit && <Round icon="pencil" color={COLORS.primary} bg={COLORS.primarySoft} hover="#F3D5D5" onPress={() => setPackModal({ pack: p })} label={`Edit ${p.packing_size_label} MRP`} />}
                    {canDelete && <View style={{ marginLeft: 6 }}><Round icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hover="#F9D3CE" onPress={() => setDelPack(p)} label={`Delete ${p.packing_size_label}`} /></View>}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {tab === 'timeline' && (
        <View style={[s.section, { paddingBottom: 16 }]}>
          <ProductTimeline product={sel} canRecipeView={canRecipeView} />
        </View>
      )}

      {tab === 'details' && (
        <View style={[s.section, { paddingBottom: 12 }]}>
          <Row label="Product ID" value={String(sel.id)} />
          <Row label="Product Code" value={sel.product_code} />
          <Row label="Category" value={sel.category || '-'} />
          <Row label="Status" value={sel.is_active === false ? 'Inactive' : 'Active'} />
          <Row label="Total Pack Sizes" value={String(packs.length)} />
          <Row label="MRP Range" value={packs.length ? (() => { const m = packs.map((p) => Number(p.mrp)); const lo = Math.min(...m); const hi = Math.max(...m); return lo === hi ? money(lo) : `${money(lo)} - ${money(hi)}`; })() : '-'} />
          {!!sel.created_at && <Row label="Created" value={String(sel.created_at)} />}
        </View>
      )}
    </Panel>
  );

  const cards = (
    <View style={s.cards}>
      <SumCard dark icon="cube-outline" value={String(sum.total ?? 0)} label="Total Products" />
      <SumCard icon="layers-outline" value={String(sum.packs ?? 0)} label="Pack Sizes" />
      <SumCard icon="currency-inr" value={Number(sum.mrp_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} label="Total MRP Value" />
      {canRecipeView && <SumCard icon="leaf" value={String(sum.with_recipe ?? 0)} label="With Recipe" />}
      {canRecipeView && <SumCard icon="flask-outline" value={String(sum.without_recipe ?? 0)} label="Without Recipe" />}
      {canCreate && (
        <Pressable onPress={onAddProduct} accessibilityRole="button" accessibilityLabel="Add Product"
          style={({ hovered }) => [s.addBtn, hovered && { backgroundColor: COLORS.primaryDark }]}>
          <MCI name="plus" size={18} color="#fff" /><Text style={s.addText}>Add Product</Text>
        </Pressable>
      )}
    </View>
  );

  let body;
  if (mode === 'three') {
    body = (
      <View style={s.cols}>
        <View style={{ width: 310 }}>{listPanel}</View>
        <View style={{ flex: 1, minWidth: 0, marginHorizontal: 16 }}>{center}</View>
        <View style={{ width: 300 }}>{summaryCard}</View>
      </View>
    );
  } else if (mode === 'two') {
    body = (
      <View style={s.cols}>
        <View style={{ width: 290 }}>{listPanel}</View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 16 }}>{center}<View style={{ height: 16 }} />{summaryCard}</View>
      </View>
    );
  } else {
    body = !mobileDetail ? listPanel : (
      <View>
        <Pressable onPress={() => setMobileDetail(false)} accessibilityRole="button" style={s.back}><MCI name="arrow-left" size={18} color={COLORS.primary} /><Text style={s.backText}>Back to products</Text></Pressable>
        {center}
        <View style={{ height: 16 }} />
        {summaryCard}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 8, paddingBottom: 48 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {cards}
      {body}
      <PackFormModal visible={!!packModal} product={sel} pack={packModal ? packModal.pack : null} onDismiss={() => setPackModal(null)}
        onSaved={(isEdit) => { setPackModal(null); toast(isEdit ? 'Pack size updated' : 'Pack size added'); onChanged(); }} />
      <ConfirmDialog visible={!!delPack} busy={busy} title="Delete pack size?"
        message={`${delPack ? delPack.packing_size_label : ''} of ${sel ? sel.product_name : ''} and its MRP history will be deleted. Pack sizes already used in packing or stock cannot be deleted.`}
        confirmText="Delete" onConfirm={removePack} onCancel={() => setDelPack(null)} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginHorizontal: -6, marginBottom: 14 },
  sum: { flexGrow: 1, flexBasis: 170, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 14, paddingHorizontal: 14, margin: 6 },
  sumDark: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sumIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  sumNum: { fontSize: 22, fontWeight: '900', color: COLORS.text, letterSpacing: -0.3, lineHeight: 26 },
  sumLabel: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 18, height: 46, margin: 6 },
  addText: { marginLeft: 6, fontSize: 14, fontWeight: '800', color: '#fff' },
  cols: { flexDirection: 'row', alignItems: 'flex-start' },
  panel: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 10 },
  panelTitle: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  count: { minWidth: 26, height: 24, borderRadius: 12, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countText: { fontSize: 12.5, fontWeight: '800', color: COLORS.textSoft },
  // list
  searchBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, height: 40, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#FCFAF7', paddingHorizontal: 10 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: COLORS.text, outlineStyle: 'none' },
  chipsRow: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  chipOn: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  chipText: { fontSize: 12.5, fontWeight: '800', color: COLORS.text },
  listScroll: { maxHeight: 560 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: COLORS.line, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  itemOn: { backgroundColor: COLORS.primarySoft, borderLeftColor: COLORS.primary },
  itemName: { fontSize: 15, fontWeight: '900', color: COLORS.text },
  itemCode: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 1 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  itemPacks: { marginLeft: 4, fontSize: 12, fontWeight: '700', color: COLORS.textSoft },
  empty: { padding: 20, textAlign: 'center', fontSize: 13.5, fontWeight: '600', color: COLORS.grey },
  listFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: COLORS.line },
  moreBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 30, borderRadius: 8 },
  moreText: { fontSize: 13, fontWeight: '800', color: COLORS.primary, marginRight: 2 },
  // center
  cHead: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  cTile: { width: 54, height: 54, borderRadius: 16, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cName: { fontSize: 21, fontWeight: '900', color: COLORS.text, letterSpacing: -0.3 },
  round: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabsScroll: { flexGrow: 0, borderTopWidth: 1, borderTopColor: COLORS.line, paddingVertical: 12 },
  tab: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 14, borderRadius: 12, marginRight: 8 },
  tabOn: { backgroundColor: COLORS.primary },
  tabOff: { backgroundColor: COLORS.greyBg },
  tabText: { marginLeft: 7, fontSize: 13.5, fontWeight: '800', color: COLORS.text },
  section: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: COLORS.line, paddingTop: 14 },
  secHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  secTitle: { marginLeft: 8, fontSize: 16, fontWeight: '900', color: COLORS.text },
  fields: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  field: { flexGrow: 1, flexBasis: 200, margin: 6 },
  fLabel: { fontSize: 12, fontWeight: '800', color: COLORS.textSoft, marginBottom: 5, marginRight: 10 },
  input: { height: 42, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 14, fontWeight: '700', color: COLORS.text, outlineStyle: 'none' },
  inputOff: { backgroundColor: COLORS.greyBg, color: COLORS.textSoft },
  infoFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, height: 38 },
  saveText: { marginLeft: 6, fontSize: 13, fontWeight: '800', color: '#fff' },
  softBtn: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 10 },
  softBtnText: { marginLeft: 5, fontSize: 13, fontWeight: '800' },
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: 'hidden' },
  trHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, paddingVertical: 9, paddingHorizontal: 12 },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: COLORS.grey },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  td: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  tapHint: { fontSize: 10, fontWeight: '600', color: COLORS.grey, marginTop: 3 },
  from: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  // right
  viewBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 10, height: 30 },
  viewText: { fontSize: 13, fontWeight: '800', color: COLORS.primary, marginRight: 6 },
  recBox: { backgroundColor: COLORS.okBg, borderWidth: 1, borderColor: '#BFE0C2', borderRadius: 12, padding: 12 },
  recVer: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  matPill: { backgroundColor: COLORS.accentSoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  matPillText: { fontSize: 12, fontWeight: '800', color: COLORS.text },
  recLine: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  viewBtnFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 10, backgroundColor: COLORS.primarySoft, marginTop: 12 },
  activeText: { marginLeft: 10, fontSize: 13, fontWeight: '800', color: COLORS.text },
  discardBtn: { paddingHorizontal: 14, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  discardText: { fontSize: 13, fontWeight: '800', color: COLORS.textSoft },
  recMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  metaText: { marginLeft: 4, fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft },
  noRecipe: { alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: '#FCFAF7' },
  noRecipeIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  noRecipeTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  createBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, height: 38, marginTop: 14 },
  createText: { marginLeft: 6, fontSize: 13.5, fontWeight: '800', color: '#fff' },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  kvLabel: { fontSize: 13, fontWeight: '700', color: COLORS.textSoft },
  kvValue: { fontSize: 13.5, fontWeight: '800', color: COLORS.text, marginLeft: 12, flexShrink: 1 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backText: { marginLeft: 6, fontSize: 14, fontWeight: '800', color: COLORS.primary },
});