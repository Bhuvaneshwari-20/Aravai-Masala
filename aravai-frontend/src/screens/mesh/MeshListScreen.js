import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MeshFormModal from '../../components/MeshFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS } from '../../theme';

export default function MeshListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await api.get('/mesh')).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const q = search.trim();
    return q ? items.filter((m) => m.mesh_size.includes(q)) : items;
  }, [items, search]);

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/mesh/${del.id}`); setDel(null); toast('Mesh size deleted'); load(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="grid" title="Mesh Size" count={items.length} noun="mesh size" search={search} onSearch={setSearch}
        placeholder="Search mesh size" addLabel="Add Mesh" onAdd={can('mesh', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {loading ? <LoadingView /> : error && !items.length ? <EmptyView error={error} onRetry={load} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 6 }}>
            {!shown.length ? <EmptyView icon="🔳" message="No mesh sizes yet. Add 20, 40, 60 ..." /> : (
              <View style={s.grid}>
                {shown.map((m) => (
                  <View key={m.id} style={s.card}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.big}>{m.mesh_size}</Text>
                      <Text style={s.small}>{m.used_count ? `Used in ${m.used_count} grinding entr${m.used_count > 1 ? 'ies' : 'y'}` : 'Not used yet'}</Text>
                    </View>
                    {can('mesh', 'delete') && !m.used_count && (
                      <IconButton icon="delete-outline" size={20} iconColor={COLORS.danger} onPress={() => setDel(m)} />)}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </Container>
      <MeshFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); toast('Mesh size added'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete mesh size?" message={`${del?.mesh_size || ''} will be removed from the list.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    margin: 6, paddingLeft: 18, paddingVertical: 10, paddingRight: 4, minWidth: 170 },
  big: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  small: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
});