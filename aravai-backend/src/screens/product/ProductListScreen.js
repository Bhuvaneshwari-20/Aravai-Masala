import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator, IconButton } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import ProductFormModal from '../../components/ProductFormModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, money, padGrid } from '../../theme';

export default function ProductListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState(null); // product being edited
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/products', { search: dSearch || undefined });
  const canEdit = can('product', 'edit');

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="tag-multiple" title="Products & MRP" count={list.total} noun="product" search={search} onSearch={setSearch}
        placeholder="Search product" addLabel="Add Product" onAdd={can('product', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <FlatList key={listCols} numColumns={listCols} data={padGrid(list.items, listCols)} keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🏷️" message="No products yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => item.pad ? <View style={{ flex: 1, marginHorizontal: 12 }} /> : (
              <View style={[s.card, !item.is_active && { opacity: 0.6 }]}>
                <View style={s.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{item.product_name}</Text>
                    <Text style={s.code}>{item.product_code}{item.category ? `  •  ${item.category}` : ''}</Text>
                  </View>
                  {canEdit && <IconButton icon="pencil" size={18} iconColor={COLORS.primary} style={s.editBtn} onPress={() => setEdit(item)}
                    accessibilityLabel={`Edit ${item.product_name}`} />}
                </View>
                <View style={s.packs}>
                  {item.packs.map((p) => (
                    <PressableScale key={p.id} to={0.96} disabled={!canEdit} onPress={() => setEdit(item)} style={s.pack}>
                      <Text style={s.packSize}>{p.packing_size_label}</Text>
                      <Text style={s.packMrp}>{money(p.mrp)}</Text>
                      {!!p.mrp_from && <Text style={s.packFrom}>from {p.mrp_from}</Text>}
                    </PressableScale>
                  ))}
                </View>
              </View>
            )} />
        )}
      </Container>
      <ProductFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); list.reload(); toast('Product added'); }} />
      <ProductFormModal visible={!!edit} product={edit} onDismiss={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Product updated'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 6, padding: 14, borderWidth: 1, borderColor: COLORS.border, flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  editBtn: { margin: 0, marginTop: -4, marginRight: -6 },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  code: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 3 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  pack: { backgroundColor: '#FBE9DD', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, alignItems: 'center' },
  packSize: { fontSize: 12, fontWeight: '800', color: COLORS.primaryDark },
  packMrp: { fontSize: 15, fontWeight: '900', color: COLORS.text, marginTop: 2 },
  packFrom: { fontSize: 10, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
});
