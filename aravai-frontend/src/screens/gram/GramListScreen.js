import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, IconButton } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import GramFormModal from '../../components/GramFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS } from '../../theme';

// Gram master: the pack sizes that can be picked while adding a product.
export default function GramListScreen() {
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
    try { setItems((await api.get('/grams')).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((g) => g.label.toLowerCase().includes(q) || String(g.weight_grams).includes(q)) : items;
  }, [items, search]);

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/grams/${del.id}`); setDel(null); toast('Gram deleted'); load(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="scale" title="Grams" count={items.length} noun="gram" search={search} onSearch={setSearch}
        placeholder="Search gram" addLabel="Add Gram" onAdd={can('gram', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {loading ? <LoadingView /> : error && !items.length ? <EmptyView error={error} onRetry={load} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 6 }}>
            {!shown.length ? <EmptyView icon="📏" message="No grams yet. Add 50, 100, 200, 500 ..." /> : (
              <View style={s.grid}>
                {shown.map((g) => (
                  <View key={g.id} style={s.card}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.big}>{g.label}</Text>
                      <Text style={s.small}>{g.used_count ? `Used in ${g.used_count} product${g.used_count > 1 ? 's' : ''}` : 'Not used yet'}</Text>
                    </View>
                    {can('gram', 'delete') && !g.used_count && (
                      <IconButton icon="delete-outline" size={20} iconColor={COLORS.danger} onPress={() => setDel(g)} accessibilityLabel={`Delete ${g.label}`} />)}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </Container>
      <GramFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); toast('Gram added'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete gram?" message={`${del?.label || ''} will be removed from the list.`}
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
