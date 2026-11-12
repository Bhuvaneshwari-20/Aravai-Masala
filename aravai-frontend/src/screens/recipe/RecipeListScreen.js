import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import RecipeFormModal from '../../components/RecipeFormModal';
import ModalShell from '../../components/ModalShell';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, padGrid } from '../../theme';

export default function RecipeListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols: cols } = useLayout();
  const listCols = Math.min(cols, 2); // bigger cards: at most 2 per row
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState(null); // recipe detail
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/recipes', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const open = async (id) => {
    try { setView((await api.get(`/recipes/${id}`)).data.data); } catch (e) { toast(errMsg(e)); }
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="book-open-variant" title="Recipes" count={list.total} noun="recipe" search={search} onSearch={setSearch}
        placeholder="Search recipe / product" addLabel="New Recipe" onAdd={can('recipe', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <FlatList key={listCols} numColumns={listCols} data={padGrid(list.items, listCols)} keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📖" message="No recipes yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => item.pad ? <View style={{ flex: 1, marginHorizontal: 12 }} /> : (
              <PressableScale to={0.98} style={[s.card, !item.is_active && { opacity: 0.6 }]} onPress={() => open(item.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.product_name}</Text>
                  <Text style={s.code}>{item.ingredient_count} material{item.ingredient_count === 1 ? '' : 's'}</Text>
                </View>
                <View style={[s.badge, { backgroundColor: item.is_active ? COLORS.okBg : COLORS.greyBg }]}>
                  <Text style={[s.badgeText, { color: item.is_active ? COLORS.ok : COLORS.grey }]}>{item.is_active ? 'ACTIVE' : 'OLD'}</Text>
                </View>
              </PressableScale>
            )} />
        )}
      </Container>

      <RecipeFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); list.reload(); toast('Recipe saved'); }} />
      <ModalShell visible={!!view} onDismiss={() => setView(null)} icon="book-open-variant" title={view?.product_name || ''}
        subtitle={view ? `${view.ingredients.length} materials` : ''}>
        {view && (
          <View>
            {view.ingredients.map((i) => (
              <View key={i.id} style={s.ing}>
                <View style={{ flex: 1 }}>
                  <Text style={s.ingName}>{i.material_name}</Text>
                  <Text style={s.code}>{i.material_code}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ModalShell>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 8, padding: 28, minHeight: 150, flex: 1, borderWidth: 1, borderColor: COLORS.border },
  name: { fontSize: 24, fontWeight: '800', color: COLORS.text },
  code: { color: COLORS.grey, fontSize: 16, fontWeight: '600', marginTop: 8 },
  badge: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginLeft: 12 },
  badgeText: { fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  ing: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ingName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  ingQty: { fontSize: 15, fontWeight: '900', color: COLORS.text },
});
