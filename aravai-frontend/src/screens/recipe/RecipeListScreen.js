import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import RecipeFormModal from '../../components/RecipeFormModal';
import ModalShell from '../../components/ModalShell';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import InfoCard, { CardList, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import { COLORS, fmt } from '../../theme';


// ---- Recipe History -------------------------------------------------------------------------------
// Every recipe change is saved by the backend as a NEW version row (recipe_master.version_no); old versions are never edited.
// History = all versions of the product (GET /recipes?product_id=), each with its materials (GET /recipes/:id).
// What changed in a version is worked out here by comparing it with the version before it.
const who = (v) => v.updated_by_name || v.updated_by_username || v.created_by_name || v.created_by_username || (v.created_by ? `User #${v.created_by}` : '-');
const when = (v) => {
  const raw = v.updated_at || v.created_at;
  if (!raw) return '-';
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const diffVersions = (prev, cur) => {
  const before = new Map((prev?.ingredients || []).map((i) => [i.material_id, i]));
  const after = new Map((cur.ingredients || []).map((i) => [i.material_id, i]));
  const added = []; const removed = []; const qty = [];
  after.forEach((i, id) => {
    const o = before.get(id);
    if (!o) added.push(i);
    else if (Number(o.quantity_kg || 0) !== Number(i.quantity_kg || 0)) qty.push({ name: i.material_name, from: Number(o.quantity_kg || 0), to: Number(i.quantity_kg || 0) });
  });
  before.forEach((i, id) => { if (!after.has(id)) removed.push(i); });
  return { added, removed, qty };
};

function Pills({ items, color, bg, sign }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {items.map((i) => (
        <View key={i.material_id} style={[s.pill, { backgroundColor: bg }]}>
          <Text style={{ fontSize: 12.5, fontWeight: '800', color }}>{`${sign} ${i.material_name}`}</Text>
        </View>
      ))}
    </View>
  );
}

function VersionCard({ v, change, isCurrent, isFirst }) {
  const none = !isFirst && !change.added.length && !change.removed.length && !change.qty.length;
  return (
    <View style={[s.ver, isCurrent && s.verCur]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={s.verTitle}>{`Version ${v.version_no}`}</Text>
        {isCurrent && <Badge tone="ok" text="Latest" style={{ marginLeft: 8 }} />}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        <MCI name="calendar-clock" size={14} color={COLORS.grey} />
        <Text style={s.meta}>{when(v)}</Text>
        <MCI name="account-outline" size={14} color={COLORS.grey} style={{ marginLeft: 12 }} />
        <Text style={s.meta}>{who(v)}</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        {isFirst && <Text style={s.chgText}>{`First version with ${v.ingredients.length} material${v.ingredients.length === 1 ? '' : 's'}.`}</Text>}
        {isFirst && <Pills items={v.ingredients} color={COLORS.textSoft} bg={COLORS.greyBg} sign="" />}
        {none && <Text style={s.chgText}>No material or quantity change.</Text>}
        {change.added.length > 0 && <View style={s.chg}><Text style={[s.chgHead, { color: COLORS.ok }]}>ADDED</Text><Pills items={change.added} color={COLORS.ok} bg={COLORS.okBg} sign="+" /></View>}
        {change.removed.length > 0 && <View style={s.chg}><Text style={[s.chgHead, { color: COLORS.danger }]}>REMOVED</Text><Pills items={change.removed} color={COLORS.danger} bg={COLORS.dangerBg} sign="−" /></View>}
        {change.qty.length > 0 && (
          <View style={s.chg}>
            <Text style={[s.chgHead, { color: COLORS.warn }]}>QUANTITY CHANGED</Text>
            {change.qty.map((q) => <Text key={q.name} style={s.chgText}>{`${q.name}: ${fmt(q.from)} kg → ${fmt(q.to)} kg`}</Text>)}
          </View>
        )}
      </View>
    </View>
  );
}

function RecipeHistory({ productId, onError }) {
  const [versions, setVersions] = useState(null); // oldest -> newest, each with ingredients
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const list = (await api.get('/recipes', { params: { product_id: productId, limit: 50 } })).data.data.items || [];
        list.sort((a, b) => (a.version_no - b.version_no) || (a.id - b.id));
        const full = await Promise.all(list.map(async (r) => ({ ...r, ...(await api.get(`/recipes/${r.id}`)).data.data })));
        if (live) setVersions(full);
      } catch (e) { if (live) { setVersions([]); onError(errMsg(e)); } }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [productId]); // eslint-disable-line
  if (loading) return <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>;
  if (!versions || !versions.length) return <Text style={s.chgText}>No history yet.</Text>;
  return (
    <View>
      {[...versions].reverse().map((v) => {
        const i = versions.indexOf(v);
        return <VersionCard key={v.id} v={v} isFirst={i === 0} isCurrent={i === versions.length - 1} change={diffVersions(versions[i - 1], v)} />;
      })}
      <Text style={[s.chgText, { marginTop: 4 }]}>Old versions are never changed. A batch always keeps the recipe version it was made with.</Text>
    </View>
  );
}

export default function RecipeListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState(null); // recipe detail
  const [tab, setTab] = useState('CURRENT'); // 'CURRENT' | 'HISTORY'
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/recipes', { search: dSearch || undefined, active: 'true' }) // latest version of each product; older versions are in Recipe History;

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const open = async (id) => {
    try { const d = (await api.get(`/recipes/${id}`)).data.data; setTab('CURRENT'); setView(d); } catch (e) { toast(errMsg(e)); }
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="book-open-variant" title="Recipes" count={list.total} noun="recipe" search={search} onSearch={setSearch}
        placeholder="Search recipe / product" addLabel="New Recipe" onAdd={can('recipe', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📖" message="No recipes yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="book-open-variant" color="#059669" value={item.product_name} size="md" caption={item.version_no ? `Recipe · Version ${item.version_no}` : 'Recipe'}
                dim={!item.is_active} right={<ChevronDot />} onPress={() => open(item.id)} />
            )} />
        )}
      </Container>

      <RecipeFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); list.reload(); toast('Recipe saved'); }} />
      <ModalShell visible={!!view} onDismiss={() => setView(null)} icon="book-open-variant" title={view?.product_name || ''}
        subtitle={view ? `Version ${view.version_no || 1} · ${view.ingredients.length} materials` : ''}>
        {view && (
          <View>
            <View style={s.tabs}>
              {[['CURRENT', 'Current Recipe', 'book-open-variant'], ['HISTORY', 'Recipe History', 'history']].map(([k, text, icon]) => (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[s.tab, tab === k && s.tabOn]}>
                  <MCI name={icon} size={18} color={tab === k ? COLORS.primary : COLORS.grey} />
                  <Text style={[s.tabText, tab === k && { color: COLORS.primary }]}>{text}</Text>
                </Pressable>
              ))}
            </View>
            {tab === 'CURRENT' ? view.ingredients.map((i) => (
              <View key={i.id} style={s.ing}>
                <View style={{ flex: 1 }}>
                  <Text style={s.ingName}>{i.material_name}</Text>
                  <Text style={s.code}>{i.material_code}</Text>
                </View>
                {Number(i.quantity_kg) > 0 && <Text style={s.ingQty}>{fmt(i.quantity_kg)} kg</Text>}
              </View>
            )) : <RecipeHistory productId={view.product_id} onError={(m) => toast(m)} />}
          </View>
        )}
      </ModalShell>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  code: { color: COLORS.grey, fontSize: 16, fontWeight: '600', marginTop: 8 },
  ing: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ingName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  tabs: { flexDirection: 'row', backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 4, marginBottom: 14 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 9 },
  tabOn: { backgroundColor: '#fff' },
  tabText: { marginLeft: 6, fontSize: 13.5, fontWeight: '800', color: COLORS.grey },
  ver: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginBottom: 10, backgroundColor: '#fff' },
  verCur: { borderColor: COLORS.ok, backgroundColor: COLORS.okBg + '66' },
  verTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  meta: { marginLeft: 4, fontSize: 12.5, fontWeight: '600', color: COLORS.grey },
  chg: { marginTop: 6 },
  chgHead: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1, marginBottom: 2 },
  chgText: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft, marginTop: 2 },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginTop: 4 },
  ingQty: { fontSize: 15, fontWeight: '900', color: COLORS.text },
});
