import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import MaterialReceiptModal from '../../components/MaterialReceiptModal';
import MaterialFormModal from '../../components/MaterialFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import InfoCard, { CardList, InfoLine, RoundBtn, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FilterChips from '../../components/FilterChips';
import { COLORS, fmt } from '../../theme';

// Raw material stock: one card per material. "+" = new material receipt.
export default function StockListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 220, phoneMin: 150 });
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [editId, setEditId] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/materials', { search: dSearch || undefined, active: 'true', low_stock: lowOnly ? 'true' : undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const canEdit = can('material', 'edit');
  const canDelete = can('material', 'delete');
  const remove = async () => {
    setBusy(true);
    try { await api.delete(`/materials/${del.id}`); setDel(null); toast('Material deleted'); list.reload(); } catch (e) { setDel(null); toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="clipboard-list" title="Material Stock" count={list.total} noun="material" search={search} onSearch={setSearch}
        placeholder="Search name / code" addLabel="Material Receipt" onAdd={can('stock', 'create') ? () => setShowReceipt(true) : null} />
      <Container>
        <FilterChips value={lowOnly ? 'low' : 'all'} onChange={(v) => setLowOnly(v === 'low')}
          options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }]} />
      </Container>
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🗂️" message="No materials found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="clipboard-list" color={item.is_low_stock ? COLORS.danger : '#0E7490'}
                value={fmt(item.current_stock)} unit={item.unit} caption={item.material_name} captionBold
                right={(
                  <>
                    {canEdit && <RoundBtn icon="pencil" color={COLORS.primary} bg={COLORS.primarySoft} onPress={() => setEditId(item.id)} label={`Edit ${item.material_name}`} />}
                    {canDelete && <RoundBtn icon="trash-can-outline" color={COLORS.danger} bg={COLORS.dangerBg} hoverBg="#F9D3CE" onPress={() => setDel(item)} label={`Delete ${item.material_name}`} />}
                  </>
                )}
                >
                <InfoLine icon="tag-outline" text={`${item.material_code}${item.place ? `  •  ${item.place}` : ''}`} />
              </InfoCard>
            )} />
        )}
      </Container>
      <MaterialFormModal visible={!!editId} id={editId} onDismiss={() => setEditId(null)}
        onSaved={() => { setEditId(null); list.silentReload(); toast('Material updated'); }} />
      <ConfirmDialog visible={!!del} busy={busy} title="Delete material?"
        message={`${del?.material_name || ''} (${del?.material_code || ''}) will be permanently deleted. This cannot be undone.`}
        confirmText="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
      <MaterialReceiptModal visible={showReceipt} onDismiss={() => setShowReceipt(false)}
        onSaved={(r) => { setShowReceipt(false); list.reload(); toast(r.low_stock_alert || `Received. Balance ${fmt(r.closing_stock)} ${r.unit}`); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
});
