import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
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
import FadeIn from '../../components/FadeIn';
import Badge from '../../components/Badge';
import useLayout from '../../hooks/useLayout';
import { COLORS, SHADOW } from '../../theme';

const BLUE = '#0EA5E9';

// "50 GM" -> { num: '50', unit: 'GM' }
const split = (label = '') => {
  const m = String(label).trim().match(/^([\d.,]+)\s*(.*)$/);
  return m ? { num: m[1], unit: m[2] || 'GM' } : { num: label, unit: '' };
};

function GramCard({ g, index, canDelete, onDelete }) {
  const { num, unit } = split(g.label);
  const used = Number(g.used_count) || 0;
  return (
    <FadeIn delay={Math.min(index, 10) * 40} from={14}>
      <View style={[s.card, SHADOW.sm]}>
        <View style={s.glow} />
        <View style={s.top}>
          <View style={s.tile}><MCI name="scale" size={22} color={BLUE} /></View>
          {canDelete && !used ? (
            <Pressable onPress={onDelete} accessibilityLabel={`Delete ${g.label}`} hitSlop={6}
              style={({ hovered }) => [s.del, hovered && { backgroundColor: '#F9D3CE' }]}>
              <MCI name="trash-can-outline" size={19} color={COLORS.danger} />
            </Pressable>
          ) : used ? (
            <View style={s.lock}><MCI name="lock-outline" size={16} color="#A99D94" /></View>
          ) : null}
        </View>
        <View style={s.valueRow}>
          <Text style={s.num} numberOfLines={1}>{num}</Text>
          <Text style={s.unit}>{unit}</Text>
        </View>
        <Text style={s.caption}>Pack size</Text>
        <View style={s.divider} />
        <Badge tone={used ? 'ok' : 'grey'} text={used ? `Used in ${used} product${used > 1 ? 's' : ''}` : 'Not used yet'} />
      </View>
    </FadeIn>
  );
}

// Gram master: the pack sizes that can be picked while adding a product.
export default function GramListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { pad, contentWidth, isPhone } = useLayout();
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

  // 2 cards per row on phones, up to 6 on big screens
  const gap = 12;
  const cols = Math.max(2, Math.min(6, Math.floor((contentWidth - pad * 2 + gap) / ((isPhone ? 150 : 200) + gap))));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="scale" title="Grams" count={items.length} noun="gram" search={search} onSearch={setSearch}
        placeholder="Search gram" addLabel="Add Gram" onAdd={can('gram', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {loading ? <LoadingView /> : error && !items.length ? <EmptyView error={error} onRetry={load} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: pad, paddingTop: 10 }} showsVerticalScrollIndicator={false}>
            {!shown.length ? <EmptyView icon="📏" title="No grams yet" message="Add pack sizes like 50, 100, 200, 500 ..." /> : (
              <View style={[s.grid, { marginHorizontal: -gap / 2 }]}>
                {shown.map((g, i) => (
                  <View key={g.id} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
                    <GramCard g={g} index={i} canDelete={can('gram', 'delete')} onDelete={() => setDel(g)} />
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
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, right: -40, top: -44, backgroundColor: `${BLUE}12` },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tile: { width: 46, height: 46, borderRadius: 14, backgroundColor: `${BLUE}1A`, alignItems: 'center', justifyContent: 'center' },
  del: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.dangerBg, alignItems: 'center', justifyContent: 'center' },
  lock: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16 },
  num: { fontSize: 38, fontWeight: '900', color: COLORS.text, letterSpacing: -1, flexShrink: 1 },
  unit: { fontSize: 15, fontWeight: '800', color: COLORS.grey, marginLeft: 6 },
  caption: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 1 },
  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: 12 },
});
