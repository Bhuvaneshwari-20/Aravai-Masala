import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
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
import Badge from '../../components/Badge';
import InfoCard, { CardList, RoundBtn, LockDot, useCardCols } from '../../components/InfoCard';
import { COLORS } from '../../theme';

const PURPLE = '#7C3AED';

export default function MeshListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols();
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
    return q ? items.filter((m) => String(m.mesh_size).includes(q)) : items;
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
          <CardList {...grid} data={shown} keyExtractor={(m) => String(m.id)}
            ListEmptyComponent={<EmptyView icon="🔳" message="No mesh sizes yet. Add 20, 40, 60 ..." />}
            renderItem={(m, i) => {
              const used = Number(m.used_count) || 0;
              return (
                <InfoCard index={i} icon="grid" color={PURPLE} value={m.mesh_size} unit="MM" caption="Mesh size"
                  right={can('mesh', 'delete') && !used
                    ? <RoundBtn icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hoverBg="#F9D3CE" onPress={() => setDel(m)} label={`Delete ${m.mesh_size}`} />
                    : used ? <LockDot /> : null}
                  footer={<Badge tone={used ? 'ok' : 'grey'} text={used ? `Used in ${used} grinding entr${used > 1 ? 'ies' : 'y'}` : 'Not used yet'} />} />
              );
            }} />
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
});
