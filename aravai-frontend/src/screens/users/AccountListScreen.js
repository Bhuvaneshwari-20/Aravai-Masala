import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import PageToolbar from '../../components/PageToolbar';
import AccountFormModal from '../../components/AccountFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, colorFor, padGrid } from '../../theme';

function AccountCard({ item, index, onEdit, onToggle }) {
  const on = !!item.is_active;
  const c = colorFor(item.full_name);
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <View style={[s.card, !on && { opacity: 0.7 }]}>
        <View style={[s.stripe, { backgroundColor: on ? c : COLORS.danger }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={[s.avatar, { backgroundColor: `${c}1F` }]}><Text style={[s.avatarText, { color: c }]}>{item.full_name.trim().charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{item.full_name}</Text>
              <Text style={s.code}>@{item.username} · {item.role_name}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: on ? COLORS.okBg : COLORS.dangerBg }]}>
              <Text style={[s.badgeText, { color: on ? COLORS.ok : COLORS.danger }]}>{on ? 'ACTIVE' : 'DEACTIVATED'}</Text>
            </View>
          </View>
          <View style={s.actions}>
            <Button compact icon="pencil" textColor={COLORS.primary} onPress={onEdit}>Edit / Password</Button>
            <Button compact icon={on ? 'account-off' : 'account-check'} textColor={on ? COLORS.danger : COLORS.ok} onPress={onToggle}>{on ? 'Deactivate' : 'Activate'}</Button>
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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.full_name} ${r.username}`.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

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
        search={search} onSearch={setSearch} placeholder="Search name / username"
        addLabel={`Add ${isSuper ? 'Admin' : 'User'}`} onAdd={() => setForm({ open: true, account: null })} />

      <Container fill>
        {loading ? <LoadingView /> : error && !rows.length ? (
          <EmptyView error={error} onRetry={() => load('initial')} />
        ) : (
          <FlatList
            key={listCols}
            numColumns={listCols}
            data={padGrid(shown, listCols)}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} colors={[COLORS.primary]} />}
            ListEmptyComponent={<EmptyView icon="👤" message={`No ${noun} accounts yet. Tap Add to create one.`} />}
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
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 5 },
  body: { flex: 1, padding: 14 },
  top: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 21, fontWeight: '900' },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  code: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  actions: { flexDirection: 'row', marginTop: 8, marginLeft: -6 },
});
