import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
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
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, RoundBtn, toneOf, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

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
  const grid = useCardCols({ min: 280, phoneMin: 280 });
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
        <FilterChips value={type} onChange={setType} options={[{ value: '', label: 'All' }, ...MACHINE_TYPES]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🛠️" message="No machines yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => {
              const st = STATUS_STYLE[item.status] || STATUS_STYLE.IDLE;
              return (
                <InfoCard index={i} icon={TYPE_ICON[item.machine_type] || 'cog'} color={COLORS.primary}
                  value={item.machine_name} size="md" caption={`${item.machine_code}  •  ${label(MACHINE_TYPES, item.machine_type)}`}
                  onPress={can('machine', 'edit') ? () => setForm(item) : undefined}
                  right={(
                    <>
                      <RoundBtn icon="qrcode" color={COLORS.primary} bg={COLORS.primarySoft} onPress={() => setQr(item)} label={`QR code for ${item.machine_name}`} />
                      {can('machine', 'delete') && <RoundBtn icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hoverBg="#F9D3CE" onPress={() => setDel(item)} label={`Delete ${item.machine_name}`} />}
                    </>
                  )}
                  footer={<Badge tone={toneOf(st.color)} text={label(MACHINE_STATUS, item.status)} />}>
                  <InfoLine icon="factory" text={item.manufacturer} />
                  <InfoLine icon="gauge" text={item.capacity != null ? `Capacity ${fmt(item.capacity)} ${item.capacity_unit}` : ''} />
                  <InfoLine icon="account-outline" text={item.operator_name ? `Operator: ${item.operator_name}` : ''} />
                  <InfoLine icon="wrench-clock" text={item.next_maintenance_date ? `Next maintenance: ${item.next_maintenance_date}` : ''} />
                </InfoCard>
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
});