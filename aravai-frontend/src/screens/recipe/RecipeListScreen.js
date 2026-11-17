import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
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
import Container from '../../components/Container';
import InfoCard, { CardList, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS } from '../../theme';

export default function RecipeListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
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
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📖" message="No recipes yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="book-open-variant" color="#059669" value={item.product_name} size="md" caption="Recipe"
                dim={!item.is_active} right={<ChevronDot />} onPress={() => open(item.id)} />
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
  code: { color: COLORS.grey, fontSize: 16, fontWeight: '600', marginTop: 8 },
  ing: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ingName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  ingQty: { fontSize: 15, fontWeight: '900', color: COLORS.text },
});
