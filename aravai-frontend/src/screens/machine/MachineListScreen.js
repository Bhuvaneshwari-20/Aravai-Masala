import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, IconButton, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MachineFormModal, { MACHINE_TYPES, MACHINE_STATUS } from '../../components/MachineFormModal';
import MachineQrModal from '../../components/MachineQrModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt, padGrid } from '../../theme';

const STATUS_STYLE = {
  ACTIVE: { color: COLORS.ok, bg: COLORS.okBg },
  IDLE: { color: COLORS.grey, bg: COLORS.greyBg },
  UNDER_MAINTENANCE: { color: COLORS.warn, bg: COLORS.warnBg },
  BREAKDOWN: { color: COLORS.danger, bg: COLORS.dangerBg },
  INACTIVE: { color: COLORS.grey, bg: COLORS.greyBg },
};
const TYPE_ICON = { WEIGHING: 'scale-balance', ROASTING: 'fire', GRINDING: 'cog', BLENDING: 'blender', PACKING: 'package-variant-closed' };
const label = (list, v) => (list.find((x) => x.value === v) || {}).label || v;

// Machine master: weighing / roasting / grinding / blending / packing machines.
export default function MachineListScreen({ navigation }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [form, setForm] = useState(null); // null = closed, {} = new, machine = edit
  const [del, setDel] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/machines', { search: dSearch || undefined, machine_type: type || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/machines/${del.id}`); setDel(null); toast('Machine deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="cog" title="Machines" count={list.total} noun="machine" search={search} onSearch={setSearch}
        placeholder="Search code / name / maker" addLabel="Add Machine" onAdd={can('machine', 'create') ? () => setForm({}) : null} />
      <Container>
        {/* opens the in-app QR scanner (same screen as the weighing flow, in view-only mode) -> machine details */}
        <Button mode="contained-tonal" icon="qrcode-scan" style={s.scanBtn} onPress={() => navigation.navigate('WeighingScan', { mode: 'view' })}>Scan Machine</Button>
        <FilterChips value={type} onChange={setType} options={[{ value: '', label: 'All' }, ...MACHINE_TYPES]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <FlatList key={listCols} numColumns={listCols} data={padGrid(list.items, listCols)} keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🛠️" message="No machines yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => {
              if (item.pad) return <View style={{ flex: 1, marginHorizontal: 12 }} />;
              const st = STATUS_STYLE[item.status] || STATUS_STYLE.IDLE;
              return (
                <View style={{ flex: 1 }}>
                  <PressableScale to={0.98} style={s.card} onPress={can('machine', 'edit') ? () => setForm(item) : undefined}>
                    <View style={s.avatar}><MCI name={TYPE_ICON[item.machine_type] || 'cog'} size={28} color={COLORS.primary} /></View>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={s.name}>{item.machine_name}</Text>
                      <Text style={s.product}>{item.machine_code}  •  {label(MACHINE_TYPES, item.machine_type)}</Text>
                      {!!item.manufacturer && <Text style={s.code}>{item.manufacturer}</Text>}
                      {item.capacity != null && <Text style={s.code}>Capacity {fmt(item.capacity)} {item.capacity_unit}</Text>}
                      {!!item.operator_name && <Text style={s.code}>Operator: {item.operator_name}</Text>}
                      {!!item.next_maintenance_date && <Text style={s.code}>Next maintenance: {item.next_maintenance_date}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{label(MACHINE_STATUS, item.status).toUpperCase()}</Text></View>
                      <IconButton icon="qrcode" size={22} iconColor={COLORS.primary} onPress={() => setQr(item)} accessibilityLabel={`QR code for ${item.machine_name}`} />
                      {can('machine', 'delete') && <IconButton icon="delete-outline" size={20} iconColor={COLORS.danger} onPress={() => setDel(item)} accessibilityLabel={`Delete ${item.machine_name}`} />}
                    </View>
                  </PressableScale>
                </View>
              );
            }} />
        )}
      </Container>
      <MachineFormModal visible={!!form} machine={form && form.id ? form : null} onDismiss={() => setForm(null)}
        onSaved={(m) => { setForm(null); list.reload(); toast(`${m.machine_code} saved`); }} />
      <MachineQrModal visible={!!qr} machine={qr} onDismiss={() => setQr(null)} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete machine?" message={`${del?.machine_name || ''} (${del?.machine_code || ''}) will be removed.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  scanBtn: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, alignSelf: 'flex-start' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, marginHorizontal: 12, marginVertical: 8, padding: 20, minHeight: 130, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: `${COLORS.primary}14`, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  name: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  product: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  code: { color: COLORS.grey, fontSize: 14, fontWeight: '600', marginTop: 3 },
  badge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
});