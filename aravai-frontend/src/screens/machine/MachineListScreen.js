import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Modal, RefreshControl, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MachineFormModal, { DynamicSelect, useMachineTypes, notifyMachineTypesChanged, subscribeMachineTypes, MACHINE_STATUS, STATUS_STYLE, statusLabel, typeIcon, fmtDateTime, fmtDay } from '../../components/MachineFormModal';
import MachineQrModal from '../../components/MachineQrModal';
import ModalShell from '../../components/ModalShell';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import { CardList, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FormField from '../../components/FormField';
import { ErrorBox, ModalFooter } from '../../components/FormBits';
import { COLORS, fmt } from '../../theme';

// ===== machine card (only the status badge is clickable; the pencil opens the full form) =====
// Small round icon button with a hover tooltip (web) + accessibility label (phones / screen readers).
function IconAction({ icon, color, bg, label, onPress }) {
  const [tip, setTip] = useState(false);
  return (
    <View style={{ marginLeft: 8 }}>
      {tip && (
        <View style={mc.tipWrap} pointerEvents="none"><View style={mc.tip}><Text style={mc.tipText}>{label}</Text></View></View>
      )}
      <Pressable onPress={onPress} onHoverIn={() => setTip(true)} onHoverOut={() => setTip(false)} accessibilityRole="button" accessibilityLabel={label}
        style={({ hovered, pressed }) => [mc.iconBtn, { backgroundColor: bg }, (hovered || pressed) && { opacity: 0.75 }]}>
        <MCI name={icon} size={19} color={color} />
      </Pressable>
    </View>
  );
}

function Line({ icon, label, value }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <View style={mc.line}>
      <MCI name={icon} size={18} color={COLORS.grey} />
      <Text style={mc.lineLabel}>{label}</Text>
      <Text style={[mc.lineValue, empty && mc.lineEmpty]} numberOfLines={1}>{empty ? '-' : value}</Text>
    </View>
  );
}

function MachineCard({ item, canEdit, canDelete, onEdit, onStatus, onQr, onDelete }) {
  const st = STATUS_STYLE[item.status] || STATUS_STYLE.IDLE;
  const typeName = item.machine_type_name || item.machine_type || 'No type';

  return (
    <View style={mc.card}>
      <View style={mc.head}>
        <View style={mc.avatar}><MCI name={typeIcon(item.machine_type)} size={26} color={COLORS.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={mc.name} numberOfLines={2}>{item.machine_name}</Text>
          <View style={mc.sub}>
            <Text style={mc.code}>{item.machine_code}</Text>
            <View style={mc.chip}><Text style={mc.chipText} numberOfLines={1}>{typeName}</Text></View>
          </View>
        </View>
        <Pressable disabled={!canEdit} onPress={() => onStatus(item)} accessibilityRole="button" accessibilityLabel={`Change status, now ${statusLabel(item.status)}`}
          style={({ hovered }) => [mc.badge, { backgroundColor: st.bg }, hovered && canEdit && { opacity: 0.8 }]}>
          <View style={[mc.dot, { backgroundColor: st.color }]} />
          <Text style={[mc.badgeText, { color: st.color }]}>{statusLabel(item.status).toUpperCase()}</Text>
          {canEdit && <MCI name="chevron-down" size={14} color={st.color} />}
        </Pressable>
      </View>

      <View style={mc.divider} />

      <Line icon="factory" label="Maker" value={item.manufacturer} />
      <Line icon="gauge" label="Capacity" value={item.capacity != null ? `${fmt(item.capacity)} ${item.capacity_unit || ''}`.trim() : ''} />
      <Line icon="account-outline" label="Operator" value={item.operator_name} />
      <Line icon="map-marker-outline" label="Location" value={item.location} />
      <Line icon="wrench-clock" label="Next service" value={item.next_maintenance_date} />

      <View style={mc.actions}>
        {canEdit && <IconAction icon="pencil-outline" color={COLORS.primary} bg={COLORS.primarySoft} label="Edit machine" onPress={() => onEdit(item)} />}
        <IconAction icon="qrcode" color={COLORS.primary} bg={COLORS.primarySoft} label="QR code" onPress={() => onQr(item)} />
        {canDelete && <IconAction icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} label="Delete machine" onPress={() => onDelete(item)} />}
      </View>
    </View>
  );
}

// Small popup opened by the status badge: tap a status and it is saved straight away.
function StatusPopup({ machine, busy, onPick, onClose }) {
  const cur = machine ? machine.status : null;
  return (
    <Modal visible={!!machine} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={sp.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={sp.box} onPress={() => {}}>
          <Text style={sp.title}>Change status</Text>
          <Text style={sp.sub} numberOfLines={1}>{machine ? `${machine.machine_name} · ${machine.machine_code}` : ''}</Text>
          {MACHINE_STATUS.map((o) => {
            const c = STATUS_STYLE[o.value]; const on = cur === o.value;
            return (
              <Pressable key={o.value} disabled={busy} onPress={() => onPick(o.value)} accessibilityRole="button" accessibilityLabel={`Set status ${o.label}`}
                style={({ hovered }) => [sp.row, on && { backgroundColor: c.bg }, hovered && !on && { backgroundColor: COLORS.bg }]}>
                <View style={[sp.dot, { backgroundColor: c.color }]} />
                <Text style={[sp.label, on && { color: c.color }]}>{o.label}</Text>
                {on && <MCI name="check" size={18} color={c.color} />}
              </Pressable>
            );
          })}
          {busy && <ActivityIndicator style={{ marginTop: 10 }} color={COLORS.primary} />}
          <Button compact textColor={COLORS.grey} style={{ marginTop: 6 }} onPress={onClose} disabled={busy}>Cancel</Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const sp = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  title: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 2, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  label: { flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.text },
});

const cardStyles = {
  card: {
    backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, margin: 6, padding: 18,
    shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
};

const mc = StyleSheet.create({
  ...cardStyles,
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: `${COLORS.primary}14`, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  name: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  textHover: { opacity: 0.7 },
  sub: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  code: { fontSize: 13, fontWeight: '800', color: COLORS.grey, marginRight: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 160 },
  chipHover: { opacity: 0.8 },
  chipText: { fontSize: 12, fontWeight: '800', color: COLORS.primary, marginRight: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4, marginRight: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 },
  lineHover: { backgroundColor: COLORS.bg },
  lineLabel: { width: 78, marginLeft: 10, fontSize: 13, fontWeight: '700', color: COLORS.grey },
  lineValue: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '800', color: COLORS.text },
  lineEmpty: { color: COLORS.grey, fontWeight: '500', fontStyle: 'italic' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  tipWrap: { position: 'absolute', bottom: 44, right: -30, width: 130, alignItems: 'center', zIndex: 10 },
  tip: { backgroundColor: '#1F2937', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  tipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

// ===== add / rename machine type =====

// Add / rename a machine type. type = null -> add.
function MachineTypeFormModal({ visible, type, onDismiss, onSaved }) {
  const [name, setName] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(type ? type.name : ''); setFieldErr(''); setErr(''); setSaving(false);
  }, [visible, type]);

  const save = async () => {
    const n = name.trim();
    if (!n) { setFieldErr('Enter the machine type name'); return; }
    setSaving(true); setErr('');
    try {
      const r = type ? await api.put(`/machines/types/${type.id}`, { name: n }) : await api.post('/machines/types', { name: n });
      setSaving(false);
      onSaved && onSaved(r.data.data, !!type);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="shape-outline" maxWidth={460}
      title={type ? 'Edit Machine Type' : 'Add Machine Type'} subtitle="Machine type master"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={type ? 'Update Type' : 'Save Type'} />}>
      <View>
        <FormField label="Machine type name *" value={name} onChangeText={(t) => { setName(t); setFieldErr(''); }} error={fieldErr} maxLength={100} />
        <Text style={{ fontSize: 12, color: COLORS.grey, fontWeight: '600', marginBottom: 8 }}>
          {type ? 'Renaming changes how this type is shown everywhere. Machines already using it stay linked. Every change is saved in the history.'
            : 'The new type appears in the machine form dropdown straight away.'}
        </Text>
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}

// ===== type history / activity log =====

const ACTION = {
  CREATED: { label: 'Created', icon: 'plus-circle', color: COLORS.ok, bg: COLORS.okBg },
  UPDATED: { label: 'Updated', icon: 'pencil-circle', color: COLORS.primary, bg: COLORS.primarySoft },
  DELETED: { label: 'Deleted', icon: 'delete-circle', color: COLORS.danger, bg: COLORS.dangerBg },
};
const KEY_LABEL = { name: 'Name', deleted: 'Deleted', restored: 'Restored', reassigned_machines: 'Machines moved', reassigned_to: 'Moved to' };
const show = (x) => (x === undefined || x === null ? '-' : typeof x === 'boolean' ? (x ? 'Yes' : 'No') : String(x));

// Human readable lines for one audit row: what happened and what changed (previous -> new).
function describe(it) {
  const prev = it.previous_value || {};
  const next = it.new_value || {};
  if (it.action === 'CREATED') {
    return [next.restored ? `Restored from deleted as "${next.name}"` : `Created as "${next.name || it.machine_type_name}"`];
  }
  if (it.action === 'DELETED') {
    const out = ['Deleted (soft delete - history kept)'];
    if (next.reassigned_machines) out.push(`${next.reassigned_machines} machine${next.reassigned_machines === 1 ? '' : 's'} moved to "${next.reassigned_to}"`);
    return out;
  }
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
  const diffs = keys.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  return diffs.length ? diffs.map((k) => `${KEY_LABEL[k] || k}: "${show(prev[k])}"  →  "${show(next[k])}"`) : ['Saved without changes'];
}

// View History / Activity Log for one machine type (also works after the type was deleted).
function MachineTypeHistoryModal({ visible, type, onDismiss }) {
  const { height, width } = useWindowDimensions();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setData(null); setError('');
    if (!type) return;
    try { const r = await api.get(`/machines/types/${type.id}/history`); setData(r.data.data); } catch (e) { setError(errMsg(e)); }
  }, [type]);
  useEffect(() => { if (visible && type) load(); }, [visible, type, load]);

  const items = data ? data.items : [];
  const created = items.slice().reverse().find((i) => i.action === 'CREATED');
  const deleted = items.find((i) => i.action === 'DELETED');

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="history" maxWidth={Math.min(width - 16, 560)}
      title="Activity History" subtitle={type ? type.name : ''}>
      <View>
        {!data && !error && <ActivityIndicator style={{ margin: 30 }} color={COLORS.primary} />}
        <ErrorBox text={error} />
        {!!error && <Button mode="outlined" textColor={COLORS.text} style={{ borderRadius: 12, borderColor: COLORS.border }} onPress={load}>Retry</Button>}

        {data && (
          <>
            <View style={hs.summary}>
              <Text style={hs.sumLine}><Text style={hs.sumKey}>Created: </Text>{created ? `${fmtDateTime(created.performed_at)} by ${created.performed_by_name || 'Unknown user'}` : 'No record'}</Text>
              {!!deleted && <Text style={[hs.sumLine, { color: COLORS.danger }]}><Text style={hs.sumKey}>Deleted: </Text>{fmtDateTime(deleted.performed_at)} by {deleted.performed_by_name || 'Unknown user'}</Text>}
              <Text style={hs.sumLine}><Text style={hs.sumKey}>Total actions: </Text>{items.length}</Text>
            </View>

            <ScrollView style={{ maxHeight: Math.max(height * 0.5, 240) }} nestedScrollEnabled>
              {!items.length && <Text style={hs.empty}>No activity recorded yet</Text>}
              {items.map((it, i) => {
                const a = ACTION[it.action] || ACTION.UPDATED;
                return (
                  <View key={it.id} style={hs.item}>
                    <View style={hs.rail}>
                      <View style={[hs.iconWrap, { backgroundColor: a.bg }]}><MCI name={a.icon} size={20} color={a.color} /></View>
                      {i < items.length - 1 && <View style={hs.line} />}
                    </View>
                    <View style={hs.body}>
                      <View style={hs.top}>
                        <Text style={[hs.action, { color: a.color }]}>{a.label}</Text>
                        <Text style={hs.when}>{fmtDateTime(it.performed_at)}</Text>
                      </View>
                      <Text style={hs.who}>by {it.performed_by_name || 'Unknown user'}</Text>
                      {describe(it).map((t, k) => <Text key={k} style={hs.change}>{t}</Text>)}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>
    </ModalShell>
  );
}

const hs = StyleSheet.create({
  summary: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  sumLine: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginVertical: 2 },
  sumKey: { fontWeight: '900', color: COLORS.grey },
  empty: { textAlign: 'center', color: COLORS.grey, fontWeight: '600', padding: 20 },
  item: { flexDirection: 'row' },
  rail: { alignItems: 'center', width: 40 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: COLORS.border, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 18, paddingLeft: 6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  action: { fontSize: 15, fontWeight: '900' },
  when: { fontSize: 12, fontWeight: '700', color: COLORS.grey },
  who: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  change: { fontSize: 13, fontWeight: '600', color: COLORS.grey, marginTop: 4 },
});

// ===== Machine Type Management tab =====

const FILTERS = [{ value: 'active', label: 'Active' }, { value: 'deleted', label: 'Deleted' }, { value: 'all', label: 'All' }];

function TypeCard({ t, canEdit, canDelete, onEdit, onDelete, onHistory }) {
  const deleted = !!t.deleted_at;
  return (
    <View style={[cardStyles.card, deleted && { opacity: 0.8 }]}>
      <View style={ts.head}>
        <View style={[ts.avatar, deleted && { backgroundColor: COLORS.greyBg }]}>
          <MCI name={typeIcon(t.code)} size={24} color={deleted ? COLORS.grey : COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ts.name} numberOfLines={2}>{t.name}</Text>
          <Text style={ts.code}>{t.code}</Text>
        </View>
        {deleted
          ? <View style={[ts.pill, { backgroundColor: COLORS.dangerBg }]}><Text style={[ts.pillText, { color: COLORS.danger }]}>DELETED</Text></View>
          : <View style={[ts.pill, { backgroundColor: COLORS.primarySoft }]}><MCI name="cog" size={13} color={COLORS.primary} /><Text style={[ts.pillText, { color: COLORS.primary }]}>{t.machine_count} machine{t.machine_count === 1 ? '' : 's'}</Text></View>}
      </View>
      <View style={ts.divider} />
      <View style={ts.meta}><Text style={ts.k}>Created</Text><Text style={ts.v}>{fmtDay(t.created_at)}{t.created_by_name ? ` · ${t.created_by_name}` : ''}</Text></View>
      <View style={ts.meta}><Text style={ts.k}>{deleted ? 'Deleted' : 'Updated'}</Text><Text style={ts.v}>{fmtDay(deleted ? t.deleted_at : t.updated_at)}{t.updated_by_name ? ` · ${t.updated_by_name}` : ''}</Text></View>
      <View style={ts.actions}>
        <IconAction icon="history" color={COLORS.primary} bg={COLORS.primarySoft} label="View history" onPress={() => onHistory(t)} />
        {!deleted && canEdit && <IconAction icon="pencil-outline" color={COLORS.primary} bg={COLORS.primarySoft} label="Edit type" onPress={() => onEdit(t)} />}
        {!deleted && canDelete && <IconAction icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} label="Delete type" onPress={() => onDelete(t)} />}
      </View>
    </View>
  );
}

// "Machine Type Management" tab: add / edit / delete types, search, filter, history.
function MachineTypesTab() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 280, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);      // null closed | {type:null} add | {type} edit
  const [hist, setHist] = useState(null);
  const [del, setDel] = useState(null);        // unused type -> simple confirm
  const [move, setMove] = useState(null);      // used type -> { type, to }
  const [moveErr, setMoveErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dSearch = useDebounce(search, 400);

  const load = useCallback(async (mode = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const r = await api.get('/machines/types', { params: { search: dSearch || undefined, status } });
      setItems(r.data.data.items || []); setError('');
    } catch (e) { setError(errMsg(e)); }
    setLoading(false); setRefreshing(false);
  }, [dSearch, status]);

  useEffect(() => { load('initial'); }, [load]);
  useEffect(() => subscribeMachineTypes(() => load('silent')), [load]);

  const changed = () => { notifyMachineTypesChanged(); };

  const startDelete = (t) => { if (t.machine_count > 0) { setMoveErr(''); setMove({ type: t, to: null }); } else setDel(t); };

  const doDelete = async (t, reassignTo) => {
    setBusy(true);
    try {
      await api.delete(`/machines/types/${t.id}`, { params: reassignTo ? { reassign_to: reassignTo } : undefined });
      toast(`${t.name} deleted`);
      setDel(null); setMove(null); changed();
    } catch (e) {
      if (move) setMoveErr(errMsg(e)); else { setDel(null); toast(errMsg(e)); }
    }
    setBusy(false);
  };

  const targets = move ? items.filter((x) => !x.deleted_at && x.id !== move.type.id).map((x) => ({ value: x.id, label: x.name })) : [];

  return (
    <View style={{ flex: 1 }}>
      <PageToolbar icon="shape-outline" title="Machine Types" count={items.length} noun="type" search={search} onSearch={setSearch}
        placeholder="Search machine types" addLabel="Add Machine Type" onAdd={can('machine', 'create') ? () => setForm({ type: null }) : null} />
      <Container>
        <FilterChips value={status} onChange={setStatus} options={FILTERS} />
      </Container>
      <Container fill>
        {loading ? <LoadingView /> : error && !items.length ? <EmptyView error={error} onRetry={() => load('initial')} /> : (
          <CardList {...grid} data={items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}
            ListEmptyComponent={<EmptyView icon="🗂️" message={search ? 'No machine types match your search' : status === 'deleted' ? 'No deleted machine types' : 'No machine types yet'} />}
            renderItem={(t) => (
              <TypeCard t={t} canEdit={can('machine', 'edit')} canDelete={can('machine', 'delete')}
                onEdit={(x) => setForm({ type: x })} onDelete={startDelete} onHistory={setHist} />
            )} />
        )}
      </Container>

      <MachineTypeFormModal visible={!!form} type={form ? form.type : null} onDismiss={() => setForm(null)}
        onSaved={(t, edited) => { setForm(null); toast(edited ? `${t.name} updated` : `${t.name} added`); changed(); }} />
      <MachineTypeHistoryModal visible={!!hist} type={hist} onDismiss={() => setHist(null)} />

      <ConfirmDialog visible={!!del} busy={busy} title="Delete machine type?"
        message={`"${del?.name || ''}" will be deleted. It is not used by any machine, and its history stays available under the Deleted filter.`}
        confirmText="Delete" onConfirm={() => doDelete(del)} onCancel={() => setDel(null)} />

      <ModalShell visible={!!move} onDismiss={() => setMove(null)} busy={busy} icon="swap-horizontal" maxWidth={480}
        title="Type is in use" subtitle={move ? move.type.name : ''}
        footer={<ModalFooter onCancel={() => setMove(null)} onSave={() => (move && move.to ? doDelete(move.type, move.to) : setMoveErr('Choose the type to move the machines to'))} saving={busy} label="Move & Delete" />}>
        <View>
          <Text style={ts.note}>
            {move ? `${move.type.machine_count} machine${move.type.machine_count === 1 ? ' uses' : 's use'} "${move.type.name}". ` : ''}
            Choose another type to move them to. Then "{move ? move.type.name : ''}" is deleted and the change is saved in the history.
          </Text>
          <DynamicSelect label="Move machines to" value={move ? move.to : null} options={targets} placeholder="Select machine type"
            onChange={(v) => { setMove((m) => ({ ...m, to: v })); setMoveErr(''); }} />
          <ErrorBox text={moveErr} />
        </View>
      </ModalShell>
    </View>
  );
}

const ts = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: `${COLORS.primary}14`, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  name: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  code: { fontSize: 12, fontWeight: '800', color: COLORS.grey, marginTop: 2, letterSpacing: 0.5 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8 },
  pillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.3, marginLeft: 4 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { fontSize: 13, fontWeight: '700', color: COLORS.grey },
  v: { fontSize: 13, fontWeight: '800', color: COLORS.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  note: { color: COLORS.grey, fontWeight: '600', marginBottom: 14 },
});

// ===== screen: Machine List + Machine Type Management tabs =====

const TABS = [
  { key: 'machines', label: 'Machine List', icon: 'cog' },
  { key: 'types', label: 'Machine Type Management', icon: 'shape-outline' },
];

function Tabs({ value, onChange }) {
  return (
    <Container>
      <View style={s.tabs}>
        {TABS.map((t) => {
          const on = t.key === value;
          return (
            <Pressable key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={({ hovered }) => [s.tab, on && s.tabOn, hovered && !on && s.tabHover]}>
              <MCI name={t.icon} size={18} color={on ? COLORS.primary : COLORS.grey} />
              <Text style={[s.tabText, on && { color: COLORS.primary }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Container>
  );
}

function MachinesTab() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [form, setForm] = useState(null); // null = closed | { machine: null|machine, focus: null|fieldName }
  const [del, setDel] = useState(null);
  const [qr, setQr] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const dSearch = useDebounce(search, 400);
  const types = useMachineTypes();
  const list = usePagedList('/machines', { search: dSearch || undefined, machine_type: type || undefined });
  const canEdit = can('machine', 'edit');

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  // Types may have been renamed / deleted in the other tab -> refresh the cards too.
  const typeSig = types.types.map((t) => `${t.code}:${t.name}`).join('|');
  const lastSig = useRef(null);
  useEffect(() => {
    if (types.loading) return;
    if (lastSig.current === null) { lastSig.current = typeSig; return; }
    if (lastSig.current !== typeSig) { lastSig.current = typeSig; list.silentReload(); }
  }, [typeSig, types.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/machines/${del.id}`); setDel(null); toast('Machine deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  const pickStatus = async (st) => {
    if (!statusFor) return;
    if (st === statusFor.status) { setStatusFor(null); return; }
    setStatusBusy(true);
    try {
      await api.put(`/machines/${statusFor.id}/status`, { status: st });
      toast(`${statusFor.machine_code} is now ${statusLabel(st)}`);
      setStatusFor(null);
      list.silentReload();
    } catch (e) { toast(errMsg(e)); }
    setStatusBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <PageToolbar icon="cog" title="Machines" count={list.total} noun="machine" search={search} onSearch={setSearch}
        placeholder="Search code / name / maker" addLabel="Add Machine" onAdd={can('machine', 'create') ? () => setForm({ machine: null, focus: null }) : null} />
      <Container>
        <FilterChips value={type} onChange={setType} options={[{ value: '', label: 'All' }, ...types.options]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🛠️" message="No machines yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item) => (
              <MachineCard item={item} canEdit={canEdit} canDelete={can('machine', 'delete')}
                onEdit={(m) => canEdit && setForm({ machine: m, focus: null })} onStatus={setStatusFor} onQr={setQr} onDelete={setDel} />
            )} />
        )}
      </Container>
      <MachineFormModal visible={!!form} machine={form ? form.machine : null} focusField={form ? form.focus : null} onDismiss={() => setForm(null)}
        onSaved={(m, edited) => { setForm(null); list.reload(); toast(`${m.machine_code} ${edited ? 'updated' : 'added'}`); }} />
      <MachineQrModal visible={!!qr} machine={qr} onDismiss={() => setQr(null)} />
      <StatusPopup machine={statusFor} busy={statusBusy} onPick={pickStatus} onClose={() => setStatusFor(null)} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete machine?" message={`${del?.machine_name || ''} (${del?.machine_code || ''}) will be removed.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
    </View>
  );
}

// Machine master: two tabs - Machine List (cards, click-to-edit) and Machine Type Management.
export default function MachineListScreen() {
  const [tab, setTab] = useState('machines');
  return (
    <View style={s.wrap}>
      <Tabs value={tab} onChange={setTab} />
      {tab === 'machines' ? <MachinesTab /> : <MachineTypesTab />}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 4, marginHorizontal: 12, marginTop: 10 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 11 },
  tabOn: { backgroundColor: COLORS.primarySoft },
  tabHover: { backgroundColor: COLORS.bg },
  tabText: { marginLeft: 8, fontSize: 14, fontWeight: '800', color: COLORS.grey, flexShrink: 1 },
});