import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialReceiptModal from '../../components/MaterialReceiptModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, RoundBtn, toneOf, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FilterChips from '../../components/FilterChips';
import { COLORS, fmt } from '../../theme';

// Material Stock Card page = 2 tabs:
//   Materials - stock card of each material. "Material Receipt" button adds stock (vendor, invoice, material, quantity).
//               Pencil = edit that material's saved receipt (vendor, invoice no, quantity, date fetched into the form), trash = delete
//   Overview  - stock overview of each material (used this month, days of stock, status). Tap -> material trace
const TABS = [
  { value: 'materials', label: 'Materials' },
  { value: 'overview', label: 'Overview' },
];
const STATE = {
  OK: { label: 'OK', color: COLORS.ok, bg: COLORS.okBg },
  LOW: { label: 'LOW', color: COLORS.warn, bg: COLORS.warnBg },
  OUT: { label: 'OUT', color: COLORS.danger, bg: COLORS.dangerBg },
  SOON: { label: 'RUNNING OUT', color: COLORS.warn, bg: COLORS.warnBg },
};

/* ---------------------------------------------------------------- Materials tab */
function MaterialsPane({ search, addTick }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 220, phoneMin: 150 });
  const [lowOnly, setLowOnly] = useState(false);
  const [receipt, setReceipt] = useState({ open: false, materialId: null, edit: false }); // edit = opened from a card's pencil (loads that material's saved receipt)
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = usePagedList('/materials', { search: search || undefined, active: 'true', received: 'true', low_stock: lowOnly ? 'true' : undefined }); // received = only materials that have a Material Receipt

  // "Material Receipt" button in the page header
  useEffect(() => { if (addTick > 0) setReceipt({ open: true, materialId: null, edit: false }); }, [addTick]);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const canEdit = can('stock', 'edit');
  const canDelete = can('material', 'delete');
  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/materials/${del.id}`); setDel(null); toast('Material deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Container>
        <FilterChips value={lowOnly ? 'low' : 'all'} onChange={(v) => setLowOnly(v === 'low')}
          options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🗂️" message="No materials found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="clipboard-list" color={item.is_low_stock ? COLORS.danger : '#0E7490'}
                value={fmt(item.current_stock)} unit={item.unit} caption={item.material_name} captionBold
                right={(
                  <>
                    {canEdit && <RoundBtn icon="pencil" color={COLORS.primary} bg={COLORS.primarySoft} onPress={() => setReceipt({ open: true, materialId: item.id, edit: true })} label={`Edit receipt of ${item.material_name}`} />}
                    {canDelete && <RoundBtn icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hoverBg="#F9D3CE" onPress={() => setDel(item)} label={`Delete ${item.material_name}`} />}
                  </>
                )}
              >
                <InfoLine icon="tag-outline" text={`${item.material_code}${item.place ? `  •  ${item.place}` : ''}`} />
              </InfoCard>
            )} />
        )}
      </Container>
      <ConfirmDialog visible={!!del} busy={busy} title="Delete material?"
        message={`${del?.material_name || ''} (${del?.material_code || ''}) and its stock entries${Number(del?.current_stock) > 0 ? ` (current stock ${fmt(del.current_stock)} ${del.unit || ''})` : ''} will be permanently deleted. This cannot be undone. A material already used in production or in a recipe cannot be deleted.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
      <MaterialReceiptModal visible={receipt.open} materialId={receipt.materialId} editReceipt={receipt.edit} onDismiss={() => setReceipt({ open: false, materialId: null, edit: false })}
        onSaved={(r) => { setReceipt({ open: false, materialId: null, edit: false }); list.reload(); toast(r.edited ? `Receipt updated. Balance ${fmt(r.closing_stock)} ${r.unit}` : (r.low_stock_alert || `Received. Balance ${fmt(r.closing_stock)} ${r.unit}`)); }} />
    </View>
  );
}

/* ---------------------------------------------------------------- Overview tab */
function Stat({ icon, color, value, label }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: `${color}1A` }]}><MCI name={icon} size={20} color={color} /></View>
      <View><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>
    </View>
  );
}

function OverviewCard({ item, index, onPress }) {
  const st = STATE[item.state] || STATE.OK;
  return (
    <InfoCard index={index} icon="package-variant" color={st.color} value={item.material_name} size="md"
      caption={`${item.material_code} · ${item.category_name}`}
      right={<ChevronDot />} onPress={onPress}
      footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
      <InfoStats items={[
        { label: 'STOCK', value: `${fmt(item.current_stock)} ${item.unit}`, color: item.state === 'OUT' || item.state === 'LOW' ? COLORS.danger : undefined },
        { label: 'USED THIS MONTH', value: `${fmt(item.used_month)} ${item.unit}` },
        { label: 'DAYS OF STOCK', value: item.days_of_stock === null ? '-' : `${item.days_of_stock} days`, color: item.state === 'SOON' ? COLORS.warn : undefined },
        { label: 'ROASTING LOSS', value: item.roast_loss_pct === null ? '-' : `${item.roast_loss_pct}%` },
      ]} />
    </InfoCard>
  );
}

function OverviewPane({ search, navigation }) {
  const grid = useCardCols({ min: 280, phoneMin: 280 });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reqId = useRef(0);
  const load = useCallback(async (refresh) => {
    const id = ++reqId.current;
    if (refresh) setRefreshing(true);
    try {
      const r = await api.get('/material-overview/summary', { params: { search: search || undefined } });
      if (id !== reqId.current) return;
      setData(r.data.data); setError('');
    } catch (e) { if (id === reqId.current) setError(errMsg(e)); }
    if (id === reqId.current) setRefreshing(false);
  }, [search]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sm = data?.summary;
  return (
    <Container fill>
      {error && !data ? <EmptyView error={error} onRetry={() => load()} /> : !data ? <LoadingView /> : (
        <CardList {...grid} key={`o${grid.cols}`} data={data.items || []} keyExtractor={(i) => String(i.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[COLORS.primary]} />}
          ListHeaderComponent={(
            <View style={{ marginHorizontal: -(grid.pad - grid.gap / 2) }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stats}>
                <Stat icon="package-variant" color="#0E7490" value={sm.total} label="Materials" />
                <Stat icon="alert-circle" color={COLORS.warn} value={sm.low} label="Low stock" />
                <Stat icon="close-circle" color={COLORS.danger} value={sm.out} label="Out of stock" />
                <Stat icon="clock-alert-outline" color="#7C3AED" value={sm.soon} label={`Out within ${sm.soon_days} days`} />
                <Stat icon="weight-kilogram" color={COLORS.ok} value={`${fmt(sm.used_month_kg)} kg`} label="Used this month (KG)" />
              </ScrollView>
            </View>
          )}
          ListEmptyComponent={<EmptyView icon="📦" message="No materials match" />}
          renderItem={(item, i) => <OverviewCard item={item} index={i} onPress={() => navigation.navigate('OverviewMaterial', { id: item.id })} />} />
      )}
    </Container>
  );
}

/* ---------------------------------------------------------------- Page */
export default function MaterialStockScreen({ navigation }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('materials');
  const [search, setSearch] = useState('');
  const [addTick, setAddTick] = useState(0);
  const dSearch = useDebounce(search, 400);

  const placeholder = 'Search name / code';
  return (
    <View style={s.wrap}>
      <PageToolbar icon="clipboard-list" title="Material Stock and Tracking" subtitle={tab === 'overview' ? 'Stock overview of every material' : 'Stock of every material'}
        search={search} onSearch={setSearch} placeholder={placeholder}
        addLabel={tab === 'materials' ? 'Material Receipt' : undefined}
        onAdd={tab === 'materials' && can('stock', 'create') ? () => setAddTick((n) => n + 1) : null} />
      <Container><FilterChips options={TABS} value={tab} onChange={setTab} /></Container>
      {tab === 'materials' && <MaterialsPane search={dSearch} addTick={addTick} />}
      {tab === 'overview' && <OverviewPane search={dSearch} navigation={navigation} />}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  stats: { paddingHorizontal: 12, paddingVertical: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10 },
  statIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  statValue: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  statLabel: { fontSize: 11.5, fontWeight: '700', color: COLORS.grey },
});