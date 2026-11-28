import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, RefreshControl, ScrollView, Pressable, StyleSheet } from 'react-native';
import { ActivityIndicator, Text, Button } from 'react-native-paper';
import api, { errMsg } from '../../api';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, ChevronDot, useCardCols } from '../../components/InfoCard';
import IndentFormModal from '../../components/IndentFormModel';
import IndentDetailModal, { STATUS_TONE } from '../../components/IndentDetailModel';
import { COLORS, colorFor } from '../../theme';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
const TABS = [['', 'All'], ['PENDING', 'Pending'], ['REEDIT', 'Re-edit'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']];

// Admin: raises indents and sees their status.   Manager: sees them here and approves / rejects.
export default function IndentScreen() {    
const { can, user, viewAs } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
 const manager = (viewAs?.role_name || user?.role_name) === 'Manager';
  const [status, setStatus] = useState(manager ? 'PENDING' : '');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/indents', { status: status || undefined, search: dSearch || undefined });

    const [ask, setAsk] = useState(null);     // remark popup: { id, no, what: 'reject' | 'reedit-request' }
  const [del, setDel] = useState(null);     // delete confirm
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    try { await fn(); list.reload(); toast(okMsg); } catch (e) { toast(errMsg(e)); }
  };
  const startEdit = async (id) => {
    try { const r = await api.get(`/indents/${id}`); setEditing(r.data.data); } catch (e) { toast(errMsg(e)); }
  };
  const removeIndent = async () => {
    setBusy(true);
    try { await api.delete(`/indents/${del.id}`); list.reload(); toast('Indent deleted'); } catch (e) { toast(errMsg(e)); }
    setDel(null); setBusy(false);
  };

  // buttons shown in the Action column of each row
  const actionsFor = (r) => {
    const a = [{ key: 'view', icon: 'eye-outline', label: 'View', color: COLORS.grey, onPress: () => setOpenId(r.id) }];
    const re = Number(r.re_edit_status || 0);
    const mine = r.requested_by === user?.id || user?.role_name === 'Super Admin';
    if (manager) {
      if (can('purchase', 'approve') && r.status === 'PENDING') {
        a.push({ key: 'ap', icon: 'check', label: 'Approve', color: COLORS.green, onPress: () => run(() => api.patch(`/indents/${r.id}/approve`, {}), 'Indent approved') });
        a.push({ key: 'rj', icon: 'close', label: 'Reject', color: COLORS.danger, onPress: () => setAsk({ id: r.id, no: r.indent_no, what: 'reject' }) });
      }
      if (can('purchase', 'approve') && r.status === 'APPROVED' && re === 1) {
        a.push({ key: 'al', icon: 'check-all', label: 'Allow Re-edit', color: COLORS.green, onPress: () => run(() => api.patch(`/indents/${r.id}/reedit-allow`, {}), 'Re-edit allowed') });
      }
    } else if (mine && can('purchase', 'edit')) {
      if (r.status === 'PENDING') {
        a.push({ key: 'ed', icon: 'pencil-outline', label: 'Edit', color: COLORS.primary, onPress: () => startEdit(r.id) });
        a.push({ key: 'dl', icon: 'delete-outline', label: 'Delete', color: COLORS.danger, onPress: () => setDel(r) });
      }
      if (r.status === 'APPROVED' && re === 0) a.push({ key: 're', icon: 'redo', label: 'Re-edit', color: COLORS.primary, onPress: () => setAsk({ id: r.id, no: r.indent_no, what: 'reedit-request' }) });
      if (r.status === 'APPROVED' && re === 2) a.push({ key: 'ed', icon: 'pencil-outline', label: 'Edit', color: COLORS.primary, onPress: () => startEdit(r.id) });
    }
    return a;
  };

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const sum = list.summary || {};
  return (
    <View style={s.wrap}>
      <PageToolbar icon="cart" title="Indent" count={list.total} noun="indent" search={search} onSearch={setSearch}
        placeholder="Search indent no / material / name" addLabel="New Indent" onAdd={can('purchase', 'create') ? () => setShowForm(true) : null} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {TABS.map(([key, label]) => (
          <Pressable key={key || 'all'} onPress={() => setStatus(key)} style={[s.tab, status === key && s.tabOn]}>
            <Text style={[s.tabText, status === key && { color: '#fff' }]}>{label}{key && sum[key] ? `  ${sum[key]}` : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}>
           <IndentTable rows={list.items} actionsFor={actionsFor} hasMore={list.hasMore} loadingMore={list.loadingMore} onMore={list.loadMore} />
          </ScrollView>
        )}
      </Container>

         <IndentFormModal visible={showForm || !!editing} indent={editing}
        onDismiss={() => { setShowForm(false); setEditing(null); }}
        onSaved={() => { const was = editing; setShowForm(false); setEditing(null); list.reload(); toast(was ? 'Indent updated' : 'Indent sent to Manager'); }} />
      <IndentDetailModal visible={!!openId} id={openId} onDismiss={() => setOpenId(null)}
        onEdit={(d) => { setOpenId(null); setEditing(d); }}
        onChanged={(what) => { setOpenId(null); list.reload();  toast({ approve: 'Indent approved', reject: 'Indent rejected', delete: 'Indent deleted', 'reedit-request': 'Re-edit request sent to Manager', 'reedit-allow': 'Re-edit allowed' }[what] || 'Done'); }} />

      <RemarkModal ask={ask} onDismiss={() => setAsk(null)}
        onDone={(what) => { setAsk(null); list.reload(); toast(what === 'reject' ? 'Indent rejected' : 'Re-edit request sent to Manager'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete indent?" message={`${del?.indent_no || ''} will be permanently deleted.`}
        confirmText="Delete" onConfirm={removeIndent} onCancel={() => setDel(null)} />

    </View>
  );
}

const HEAD = ['#7F1212', '#B01E1E', '#D1451F'];
const COLS = [['S.NO', 0.5], ['Indent No', 1.3], ['Date', 1], ['Raised By', 1.3], ['Materials', 0.9], ['Status', 1.6], ['Action', 3.4]];

function ActBtn({ icon, label, color, onPress }) {
  return (
    <Pressable onPress={onPress} style={[t.act, { borderColor: color }]}>
      <MCI name={icon} size={14} color={color} /><Text style={[t.actText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function IndentTable({ rows, actionsFor, hasMore, loadingMore, onMore }) {
  const cell = (n) => ({ flex: COLS[n][1], paddingHorizontal: 4 });
  return (
    <View style={t.panel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, minWidth: '100%' }}>
        <View style={{ flex: 1, minWidth: 980 }}>
          <LinearGradient colors={HEAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={t.head}>
            {COLS.map(([label], n) => <Text key={label} style={[t.th, cell(n)]}>{label}</Text>)}
          </LinearGradient>
          {rows.length === 0 ? <Text style={{ padding: 24, color: COLORS.grey }}>No indents found</Text> : rows.map((r, i) => {
            const re = Number(r.re_edit_status) === 1;
            return (
              <View key={r.id} style={t.row}>
                <Text style={[t.td, cell(0)]}>{i + 1}</Text>
                <Text style={[t.td, cell(1), { fontWeight: '800' }]}>{r.indent_no}</Text>
                <Text style={[t.td, cell(2)]}>{String(r.indent_date).slice(0, 10)}</Text>
                <Text style={[t.td, cell(3)]}>{r.requested_by_name || '-'}</Text>
                <Text style={[t.td, cell(4)]}>{r.item_count}</Text>
                <View style={[cell(5), { alignItems: 'flex-start' }]}>
                  <Badge tone={re ? 'warn' : (STATUS_TONE[r.status] || 'grey')} text={re ? 'RE-EDIT REQUESTED' : r.status} />
                </View>
                <View style={[cell(6), { flexDirection: 'row', flexWrap: 'wrap' }]}>
                  {actionsFor(r).map((a) => <ActBtn key={a.key} icon={a.icon} label={a.label} color={a.color} onPress={a.onPress} />)}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
      {hasMore && (
        <Pressable onPress={onMore} style={t.more}>
          {loadingMore ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ fontWeight: '800', color: COLORS.primary }}>Load more</Text>}
        </Pressable>
      )}
    </View>
  );
}

// Reason popup: Manager "Reject" and Admin "Re-edit request"
function RemarkModal({ ask, onDismiss, onDone }) {
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setRemark(''); setErr(''); setBusy(false); }, [ask]);
  const rej = ask?.what === 'reject';
  const send = async () => {
    if (!remark.trim()) { setErr('Enter the reason'); return; }
    setBusy(true); setErr('');
    try { await api.patch(`/indents/${ask.id}/${ask.what}`, { remark: remark.trim() }); setBusy(false); onDone(ask.what); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <ModalShell visible={!!ask} onDismiss={onDismiss} busy={busy} icon={rej ? 'close-circle-outline' : 'redo'} maxWidth={480}
      title={rej ? 'Reject indent' : 'Request re-edit'} subtitle={ask?.no || ''}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={busy} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={send} loading={busy} disabled={busy} buttonColor={rej ? COLORS.danger : COLORS.primary} style={{ borderRadius: 10 }}>{rej ? 'Reject' : 'Send Request'}</Button>
        </View>
      )}>
      {!!err && <Text style={{ color: COLORS.danger, marginBottom: 8 }}>{err}</Text>}
      <FormField label={rej ? 'Reason for rejecting *' : 'Reason for re-edit *'} value={remark} onChangeText={setRemark} multiline maxLength={500} />
    </ModalShell>
  );
}

const t = StyleSheet.create({
  panel: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10 },
  th: { fontSize: 11.5, fontWeight: '800', color: '#fff', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#F0ECF2' },
  td: { fontSize: 14, color: COLORS.text },
  btn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 4 },
  more: { alignItems: 'center', paddingVertical: 14 },

    act: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8, marginVertical: 2 },
  actText: { fontSize: 12, fontWeight: '800', marginLeft: 4 },
});

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { flexGrow: 0, paddingVertical: 10 },
tab: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, marginRight: 8 },
  tabOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontWeight: '800', fontSize: 13, color: COLORS.text },
});
