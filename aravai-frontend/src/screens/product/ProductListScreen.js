import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import api, { errMsg } from '../../api';
import ConfirmDialog from '../../components/ConfirmDialog';
import ProductFormModal from '../../components/ProductFormModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import InfoCard, { CardList, RoundBtn, useCardCols } from '../../components/InfoCard';
import { COLORS, money } from '../../theme';

const AMBER = '#B45309';

export default function ProductListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState(null); // product being edited
  const [del, setDel] = useState(null); // product waiting for delete confirmation
  const [busy, setBusy] = useState(false);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/products', { search: dSearch || undefined });
  const canEdit = can('product', 'edit');
  const canDelete = can('product', 'delete');

  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/products/${del.id}`); setDel(null); toast('Product deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

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
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🏷️" message="No products yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="tag-multiple" color={AMBER} value={item.product_name} size="md"
                caption={`${item.product_code}${item.category ? `  •  ${item.category}` : ''}`}
                right={(canEdit || canDelete) ? (
                  <View style={s.actions}>
                    {canEdit && <RoundBtn icon="pencil" color={COLORS.primary} bg={COLORS.primarySoft} onPress={() => setEdit(item)} label={`Edit ${item.product_name}`} />}
                    {canDelete && <View style={canEdit && { marginLeft: 8 }}><RoundBtn icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hoverBg="#F9D3CE" onPress={() => setDel(item)} label={`Delete ${item.product_name}`} /></View>}
                  </View>
                ) : null}
                onPress={canEdit ? () => setEdit(item) : undefined}
                >
                <View style={s.packs}>
                  {item.packs.map((p) => (
                    <View key={p.id} style={s.pack}>
                      <Text style={s.packSize}>{p.packing_size_label}</Text>
                      <Text style={s.packMrp}>{money(p.mrp)}</Text>
                      {!!p.mrp_from && <Text style={s.packFrom}>from {p.mrp_from}</Text>}
                    </View>
                  ))}
                </View>
              </InfoCard>
            )} />
        )}
      </Container>
      <ProductFormModal visible={showForm} onDismiss={() => setShowForm(false)} onSaved={() => { setShowForm(false); list.reload(); toast('Product added'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete product?"
        message={`${del?.product_name || ''} and all its pack sizes / MRP history will be permanently deleted.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
      <ProductFormModal visible={!!edit} product={edit} onDismiss={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Product updated'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  actions: { flexDirection: 'row', alignItems: 'center' },
  packs: { flexDirection: 'row', flexWrap: 'wrap' },
  pack: { backgroundColor: '#FBE9DD', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8, alignItems: 'center' },
  packSize: { fontSize: 12, fontWeight: '800', color: COLORS.primaryDark },
  packMrp: { fontSize: 15, fontWeight: '900', color: COLORS.text, marginTop: 2 },
  packFrom: { fontSize: 10, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
});
