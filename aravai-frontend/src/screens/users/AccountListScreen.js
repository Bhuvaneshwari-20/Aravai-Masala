import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet, Pressable } from 'react-native';
import { Text, Button, Switch } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import AccountFormModal from '../../components/AccountFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, colorFor, padGrid } from '../../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-11-11 11:40:00' -> '11 Nov 2026'  (read from the text, so the time zone can never move the day)
const dmy = (v) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '–'; };

// One tile = a number + a filter. Tap to show only those accounts, tap "All" to see everyone again.
function StatTile({ icon, label, value, color, bg, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label}: ${value}. Tap to filter`}
      style={({ hovered }) => [s.tile, on && { borderColor: color, backgroundColor: bg }, !on && hovered && { backgroundColor: COLORS.bg }]}>
      <View style={[s.tileIcon, { backgroundColor: on ? '#fff' : bg }]}><MCI name={icon} size={20} color={color} /></View>
      <View style={{ minWidth: 0 }}>
        <Text style={[s.tileValue, on && { color }]}>{value}</Text>
        <Text style={s.tileLabel} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

const Fact = ({ icon, label, value }) => (
  <View style={s.fact}>
    <View style={s.factHead}><MCI name={icon} size={14} color={COLORS.grey} /><Text style={s.factLabel}>{label}</Text></View>
    <Text style={s.factValue} numberOfLines={1}>{value}</Text>
  </View>
);

function AccountCard({ item, index, onEdit, onToggle }) {
  const on = !!item.is_active;
  const c = colorFor(item.full_name);
  const st = on ? { color: COLORS.ok, bg: COLORS.okBg, text: 'Active' } : { color: COLORS.danger, bg: COLORS.dangerBg, text: 'Deactivated' };
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <View style={[s.card, !on && s.cardOff]}>
        <View style={[s.stripe, { backgroundColor: on ? c : COLORS.danger }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={[s.avatar, { backgroundColor: `${c}1F` }]}><Text style={[s.avatarText, { color: c }]}>{item.full_name.trim().charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name} numberOfLines={1}>{item.full_name}</Text>
              <Text style={s.user} numberOfLines={1}>@{item.username}</Text>
            </View>
            <View style={[s.pill, { backgroundColor: st.bg }]}>
              <View style={[s.dot, { backgroundColor: st.color }]} />
              <Text style={[s.pillText, { color: st.color }]}>{st.text}</Text>
            </View>
          </View>

          <View style={s.facts}>
            <Fact icon="shield-account-outline" label="Role" value={item.role_name} />
            <Fact icon="calendar-outline" label="Created on" value={dmy(item.created_at)} />
          </View>

          <View style={s.foot}>
            <View style={s.switchBox}>
              <Switch value={on} onValueChange={onToggle} color={COLORS.ok} accessibilityLabel={on ? `Deactivate ${item.full_name}` : `Activate ${item.full_name}`} />
              <View style={{ marginLeft: 8, flexShrink: 1 }}>
                <Text style={[s.switchText, { color: st.color }]}>{on ? 'Can log in' : 'Cannot log in'}</Text>
                <Text style={s.switchHint}>{on ? 'Turn off to block' : 'Turn on to allow'}</Text>
              </View>
            </View>
            <Button mode="contained-tonal" icon="pencil" compact onPress={onEdit} buttonColor={COLORS.primarySoft} textColor={COLORS.primary} style={s.editBtn}>Edit / Password</Button>
          </View>
        </View>
      </View>
    </FadeIn>
  );
}

// Users module. Super Admin sees Admins. Admin sees the staff they created.
export default function AccountListScreen() {
  const { user } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const isSuper = user.role_name === 'Super Admin';
  const noun = isSuper ? 'admin' : 'user';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');   // ALL | ACTIVE | OFF
  const [role, setRole] = useState('ALL');
  const [form, setForm] = useState({ open: false, account: null });
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (mode) => {
    if (mode === 'refresh') setRefreshing(true);
    try { setRows((await api.get('/accounts')).data.data); setError(''); }
    catch (e) { setError(errMsg(e)); }
    setLoading(false); setRefreshing(false);
  }, []);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { load(first.current ? 'initial' : 'silent'); first.current = false; }, [load]));

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.is_active).length;
    return { all: rows.length, active, off: rows.length - active };
  }, [rows]);

  // role chips come from the accounts themselves (shown only when there is more than one role)
  const roleChips = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => m.set(r.role_name, (m.get(r.role_name) || 0) + 1));
    return m.size > 1 ? [{ value: 'ALL', label: 'All roles', count: rows.length }, ...[...m.entries()].map(([name, n]) => ({ value: name, label: name, count: n }))] : [];
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (status === 'ALL' || (status === 'ACTIVE' ? r.is_active : !r.is_active))
      && (role === 'ALL' || r.role_name === role)
      && (!q || `${r.full_name} ${r.username} ${r.role_name}`.toLowerCase().includes(q)));
  }, [rows, search, status, role]);
  const filtered = status !== 'ALL' || role !== 'ALL' || !!search.trim();
  const clearFilters = () => { setStatus('ALL'); setRole('ALL'); setSearch(''); };

  const doToggle = async () => {
    setBusy(true);
    try {
      await api.patch(`/accounts/${confirm.id}/active`, { is_active: !confirm.is_active });
      toast(confirm.is_active ? 'Account deactivated' : 'Account activated');
      setConfirm(null); load('silent');
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="account-key" title={isSuper ? 'Admin Accounts' : 'Staff Accounts'} count={rows.length} noun={noun}
        search={search} onSearch={setSearch} placeholder="Search name / username / role"
        addLabel={`Add ${isSuper ? 'Admin' : 'User'}`} onAdd={() => setForm({ open: true, account: null })} />

      {!loading && rows.length > 0 && (
        <Container>
          <View style={s.tiles}>
            <StatTile icon="account-group-outline" label={`All ${noun}s`} value={counts.all} color={COLORS.primary} bg={COLORS.primarySoft} on={status === 'ALL'} onPress={() => setStatus('ALL')} />
            <StatTile icon="account-check-outline" label="Active" value={counts.active} color={COLORS.ok} bg={COLORS.okBg} on={status === 'ACTIVE'} onPress={() => setStatus(status === 'ACTIVE' ? 'ALL' : 'ACTIVE')} />
            <StatTile icon="account-off-outline" label="Deactivated" value={counts.off} color={COLORS.danger} bg={COLORS.dangerBg} on={status === 'OFF'} onPress={() => setStatus(status === 'OFF' ? 'ALL' : 'OFF')} />
          </View>
          {roleChips.length > 0 && <FilterChips options={roleChips} value={role} onChange={setRole} />}
        </Container>
      )}

      <Container fill>
        {loading ? <LoadingView /> : error && !rows.length ? (
          <EmptyView error={error} onRetry={() => load('initial')} />
        ) : (
          <FlatList
            key={listCols}
            numColumns={listCols}
            data={padGrid(shown, listCols)}
            keyExtractor={(i, n) => (i.pad ? `pad${n}` : String(i.id))}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}
            ListEmptyComponent={filtered
              ? (
                <View style={s.noMatch}>
                  <Text style={s.noMatchIcon}>🔎</Text>
                  <Text style={s.noMatchTitle}>No accounts match</Text>
                  <Text style={s.noMatchMsg}>Try a different search or filter.</Text>
                  <Button mode="outlined" icon="filter-remove-outline" onPress={clearFilters} textColor={COLORS.primary} style={s.noMatchBtn}>Clear filters</Button>
                </View>
              )
              : <EmptyView icon="👤" title={`No ${noun} accounts yet`} message={`Tap "Add ${isSuper ? 'Admin' : 'User'}" at the top to create the first one.`} />}
            renderItem={({ item, index }) => item.pad
              ? <View style={{ flex: 1, marginHorizontal: 12 }} />
              : <AccountCard item={item} index={index} onEdit={() => setForm({ open: true, account: item })} onToggle={() => setConfirm(item)} />}
          />
        )}
      </Container>

      <AccountFormModal visible={form.open} account={form.account} onDismiss={() => setForm({ open: false, account: null })}
        onSaved={(edited) => { setForm({ open: false, account: null }); load('silent'); toast(edited ? 'Account updated' : `${isSuper ? 'Admin' : 'User'} created`); }} />

      <ConfirmDialog visible={!!confirm} busy={busy} onCancel={() => setConfirm(null)} onConfirm={doToggle}
        title={confirm?.is_active ? 'Deactivate account?' : 'Activate account?'}
        confirmText={confirm?.is_active ? 'Deactivate' : 'Activate'}
        message={confirm ? (confirm.is_active
          ? `${confirm.full_name} will no longer be able to log in.`
          : `${confirm.full_name} will be able to log in again.`) : ''} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },

  tiles: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12 },
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 },
  tileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tileValue: { fontSize: 22, fontWeight: '800', color: COLORS.text, lineHeight: 26 },
  tileLabel: { fontSize: 12, fontWeight: '700', color: COLORS.grey },

  card: { flex: 1, flexDirection: 'row', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  cardOff: { backgroundColor: '#FDFBF9' },
  stripe: { width: 5 },
  body: { flex: 1, padding: 16 },
  top: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 22, fontWeight: '800' },
  name: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  user: { color: COLORS.grey, fontSize: 13, fontWeight: '600', marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: '800' },

  facts: { flexDirection: 'row', marginTop: 14, marginHorizontal: -6, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  fact: { flex: 1, paddingHorizontal: 6 },
  factHead: { flexDirection: 'row', alignItems: 'center' },
  factLabel: { marginLeft: 5, fontSize: 12, fontWeight: '700', color: COLORS.grey },
  factValue: { fontSize: 14.5, fontWeight: '800', color: COLORS.text, marginTop: 3 },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.line },
  switchBox: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 },
  switchText: { fontSize: 13.5, fontWeight: '800' },
  switchHint: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  editBtn: { borderRadius: 12 },

  noMatch: { alignItems: 'center', paddingVertical: 44, paddingHorizontal: 28 },
  noMatchIcon: { fontSize: 38 },
  noMatchTitle: { marginTop: 12, fontSize: 17, fontWeight: '800', color: COLORS.text },
  noMatchMsg: { marginTop: 4, fontSize: 14, color: COLORS.grey },
  noMatchBtn: { marginTop: 16, borderRadius: 12, borderColor: COLORS.border },
});