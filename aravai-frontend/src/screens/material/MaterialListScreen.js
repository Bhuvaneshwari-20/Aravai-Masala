import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialFormModal from '../../components/MaterialFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FilterChips from '../../components/FilterChips';
import StatCard from '../../components/StatCard';
import Badge from '../../components/Badge';
import StockBar from '../../components/StockBar';
import { COLORS, SHADOW, fmt, categoryStyle, padGrid } from '../../theme';

const count = (params) => api.get('/materials', { params: { ...params, limit: 1 } }).then((r) => r.data.data.total);

// Edit / Delete buttons (label on desktop, full-width row on phone cards)
function Actions({ onEdit, onDelete, block }) {
  if (!onEdit && !onDelete) return null;
  const Btn = ({ icon, label, color, bg, onPress }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered, pressed }) => [a.btn, block && a.block, { backgroundColor: hovered ? `${color}26` : bg }, pressed && { opacity: 0.8 }]}>
      <MCI name={icon} size={17} color={color} />
      <Text style={[a.text, { color }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[a.row, block && { width: '100%', marginRight: -8 }]}>
      {!!onEdit && <Btn icon="pencil" label="Edit" color={COLORS.primary} bg={COLORS.primarySoft} onPress={onEdit} />}
      {!!onDelete && <Btn icon="trash-can-outline" label="Delete" color={COLORS.danger} bg={COLORS.dangerBg} onPress={onDelete} />}
    </View>
  );
}

// ---------- phone / tablet card ----------
function MaterialCard({ item, index, onEdit, onDelete }) {
  const cs = categoryStyle(item.category_name || '');
  const cur = Number(item.current_stock) || 0;
  const low = !!item.is_low_stock;
  return (
    <FadeIn delay={Math.min(index, 8) * 40} from={12} style={{ flex: 1 }}>
      <View style={[s.card, SHADOW.sm, !item.is_active && { opacity: 0.7 }]}>
        <View style={s.cardTop}>
          <View style={[s.tile, { backgroundColor: `${cs.color}14` }]}><Text style={{ fontSize: 24 }}>{cs.icon}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{item.material_name}</Text>
            <Text style={s.meta} numberOfLines={1}>{item.sku || item.material_code}</Text>
          </View>
          {!item.is_active && <Badge tone="grey" text="Inactive" />}
        </View>
        {!!item.specifications?.length && <Text style={s.specs} numberOfLines={2}>{item.specifications.join('  •  ')}</Text>}
        <View style={s.divider} />
        <View style={s.stockRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.stockLabel}>STOCK</Text>
            <Text style={[s.stockVal, low && { color: COLORS.danger }]} numberOfLines={1}>{fmt(cur)} <Text style={s.unit}>{item.unit}</Text></Text>
          </View>
          {low && <Badge tone="danger" text="Low" />}
        </View>
        <StockBar current={cur} minimum={item.minimum_stock} low={low} style={{ marginTop: 10 }} />
        <View style={{ marginTop: 14 }}><Actions block onEdit={onEdit} onDelete={onDelete} /></View>
      </View>
    </FadeIn>
  );
}

// ---------- desktop table ----------
const COL = { name: { flex: 3.6 }, code: { flex: 1.3 }, stock: { flex: 2 }, actions: { width: 190, alignItems: 'flex-end' } };

function TableHead() {
  return (
    <View style={[t.row, t.head]}>
      <Text style={[t.th, COL.name]}>MATERIAL</Text>
      <Text style={[t.th, COL.code]}>CODE</Text>
      <Text style={[t.th, COL.stock]}>STOCK</Text>
      <Text style={[t.th, { width: 190, textAlign: 'right', paddingRight: 0 }]}>ACTIONS</Text>
    </View>
  );
}

function TableRow({ item, onEdit, onDelete }) {
  const cs = categoryStyle(item.category_name || '');
  const cur = Number(item.current_stock) || 0;
  const low = !!item.is_low_stock;
  return (
    <Pressable style={({ hovered }) => [t.row, t.body, hovered && { backgroundColor: '#FDF8F3' }, !item.is_active && { opacity: 0.65 }]}>
      <View style={[COL.name, { flexDirection: 'row', alignItems: 'center', minWidth: 0 }]}>
        <View style={[t.tile, { backgroundColor: `${cs.color}14` }]}><Text style={{ fontSize: 20 }}>{cs.icon}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={t.name} numberOfLines={1}>{item.material_name}</Text>
            {!item.is_active && <Badge tone="grey" text="Inactive" style={{ marginLeft: 8 }} />}
          </View>
          {!!item.specifications?.length && <Text style={t.spec} numberOfLines={1}>{item.specifications.join('  •  ')}</Text>}
        </View>
      </View>
      <View style={COL.code}><Text style={t.code} numberOfLines={1}>{item.sku || item.material_code || '–'}</Text></View>
      <View style={[COL.stock, { paddingRight: 24 }]}>
        <Text style={[t.stock, low && { color: COLORS.danger }]} numberOfLines={1}>{fmt(cur)} <Text style={t.unit}>{item.unit}</Text></Text>
        <StockBar current={cur} minimum={item.minimum_stock} low={low} height={5} style={{ marginTop: 6, maxWidth: 160 }} />
      </View>
      <View style={COL.actions}><Actions onEdit={onEdit} onDelete={onDelete} /></View>
    </Pressable>
  );
}

export default function MaterialListScreen({ navigation, route }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const [showForm, setShowForm] = useState(false);
  const { listCols, isWide, isPhone, pad } = useLayout();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(route.params?.lowOnly ? 'low' : 'all');
  const [counts, setCounts] = useState({});
  const [editId, setEditId] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (route.params?.openAdd) { setShowForm(true); navigation.setParams({ openAdd: undefined }); }
  }, [route.params?.openAdd]); // eslint-disable-line
  useEffect(() => { if (route.params?.lowOnly) setFilter('low'); }, [route.params?.lowOnly]);
  const dSearch = useDebounce(search, 400);

  const list = usePagedList('/materials', {
    sort: 'latest', // newest material first
    search: dSearch || undefined,
    low_stock: filter === 'low' ? 'true' : undefined,
  });

  const loadCounts = useCallback(() => {
    Promise.allSettled([count({}), count({ low_stock: 'true' })]).then((r) => {
      const v = (i) => (r[i].status === 'fulfilled' ? r[i].value : undefined);
      setCounts({ all: v(0), low: v(1) });
    });
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // refresh list when coming back from Add/Edit/Detail (skip the very first focus)
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload(); loadCounts();
  }, [list.silentReload, loadCounts]));

  const chips = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'low', label: 'Low stock', count: counts.low },
  ];
  const onEdit = can('material', 'edit') ? (item) => setEditId(item.id) : null;
  const onDelete = can('material', 'delete') ? (item) => setDel(item) : null;
  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/materials/${del.id}`); setDel(null); toast('Material deleted'); list.reload(); loadCounts(); }
    catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };
  const pick = (v) => setFilter((f) => (f === v ? 'all' : v));
  const subtitle = list.loading ? 'Loading…' : `${fmt(list.total)} ${list.total === 1 ? 'material' : 'materials'}${filter !== 'all' ? ' • filtered' : ''}`;

  const empty = (
    <EmptyView icon="📦" title="No materials found"
      message={search || filter !== 'all' ? 'Try a different search or clear the filter.' : 'Add your first material to start tracking stock.'} />
  );

  return (
    <View style={s.wrap}>
      <PageToolbar icon="package-variant" title="All Materials" subtitle={subtitle} search={search} onSearch={setSearch}
        placeholder="Search name, code or specification" addLabel="Add Material" onAdd={can('material', 'create') ? () => setShowForm(true) : null}>
        {!isPhone && (
          <View style={s.stats}>
            <StatCard icon="package-variant" color="#0E7490" value={counts.all === undefined ? undefined : fmt(counts.all)} label="Total materials" active={filter === 'all'} onPress={() => setFilter('all')} />
            <View style={{ width: 12 }} />
            <StatCard icon="alert-circle" color="#DC2626" value={counts.low === undefined ? undefined : fmt(counts.low)} label="Low stock" active={filter === 'low'} onPress={() => pick('low')} />
          </View>
        )}
        {isPhone && <FilterChips options={chips} value={filter} onChange={setFilter} style={{ marginTop: 6, marginHorizontal: -pad }} />}
      </PageToolbar>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : isWide ? (
          <View style={[s.table, SHADOW.sm, { marginHorizontal: pad }]}>
            <TableHead />
            <FlatList
              data={list.items}
              keyExtractor={(i) => String(i.id)}
              refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
              onEndReached={list.loadMore}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={empty}
              ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
              renderItem={({ item }) => <TableRow item={item} onEdit={onEdit && (() => onEdit(item))} onDelete={onDelete && (() => onDelete(item))} />}
            />
          </View>
        ) : (
          <FlatList
            key={listCols}
            numColumns={listCols}
            data={padGrid(list.items, listCols)}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 28, paddingTop: 6, paddingHorizontal: pad - 7 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={empty}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item, index }) => item.pad
              ? <View style={{ flex: 1, margin: 7 }} />
              : <MaterialCard item={item} index={index} onEdit={onEdit && (() => onEdit(item))} onDelete={onDelete && (() => onDelete(item))} />}
          />
        )}
      </Container>
      <MaterialFormModal visible={!!editId} id={editId} onDismiss={() => setEditId(null)}
        onSaved={() => { setEditId(null); list.silentReload(); loadCounts(); toast('Material updated'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete material?"
        message={`${del?.material_name || ''} (${del?.material_code || ''}) will be permanently deleted. This cannot be undone.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
      <MaterialFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); loadCounts(); toast('Material added'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  stats: { flexDirection: 'row', marginTop: 16, marginBottom: 8 },
  table: { flex: 1, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', marginTop: 8, marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, margin: 7, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  tile: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  meta: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  specs: { color: COLORS.textSoft, fontSize: 12.5, fontWeight: '500', marginTop: 10 },
  divider: { height: 1, backgroundColor: COLORS.line, marginTop: 12, marginBottom: 12 },
  stockRow: { flexDirection: 'row', alignItems: 'center' },
  stockLabel: { color: COLORS.grey, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2 },
  stockVal: { fontSize: 20, fontWeight: '900', color: COLORS.text, marginTop: 1 },
  unit: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey },
});

const a = StyleSheet.create({
  row: { flexDirection: 'row' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 11, paddingHorizontal: 13, marginLeft: 8 },
  block: { flex: 1, height: 42, marginLeft: 0, marginRight: 8 },
  text: { fontSize: 13.5, fontWeight: '800', marginLeft: 6 },
});

const t = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  head: { height: 44, backgroundColor: '#FBF8F4', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  body: { minHeight: 68, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  th: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3, color: COLORS.grey, paddingRight: 12 },
  tile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  name: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  spec: { fontSize: 12, color: COLORS.grey, fontWeight: '500', marginTop: 2 },
  code: { fontSize: 13, fontWeight: '800', color: COLORS.textSoft },
  cell: { fontSize: 14, fontWeight: '600', color: COLORS.textSoft, paddingRight: 12 },
  stock: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  unit: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
});