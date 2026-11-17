import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PackingFormModal from '../../components/PackingFormModal';
import PackingDetailModal from '../../components/PackingDetailModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

export default function PackingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);   // packing entry opened in the details view
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/packing', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload])); // eslint-disable-line

  return (
    <View style={s.wrap}>
<PageToolbar icon="package-variant-closed" title="Packing" count={list.total} noun="packing run" subtitle={`${list.total} batch packing process was done`} search={search} onSearch={setSearch}        placeholder="Search batch / product / pack" addLabel="New Packing" onAdd={can('packing', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="📫" message="No packing entries yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => {
              const packed = Number(item.batch_packed_kg) || 0;
              const left = Math.max(Number(item.batch_output_kg) - packed, 0);
              const closed = item.batch_status === 'COMPLETED';            // user closed the batch
              const done = closed || (packed > 0 && left <= 0.001);        // closed, or everything packed
              const leftover = done && left > 0.001;                       // closed but masala was left
              return (
                <InfoCard index={i} icon="package-variant-closed" color="#B45309" value={item.batch_no} size="md"
                  caption={`${item.product_name} · ${item.packing_size_label}`}
                  right={<ChevronDot />} onPress={() => setDetailId(item.id)}
                  footer={done ? <Badge tone={leftover ? 'warn' : 'ok'} text={leftover ? `Packing done · ${fmt(left)} kg left` : 'Packing done'} /> : null}>
                  <InfoStats items={[
                    { label: 'TOTAL PACKETS', value: fmt(item.total_bag_count) },
                    { label: 'ACCEPTED', value: fmt(item.accepted_bag_count), color: COLORS.ok },
                    { label: 'REJECTED', value: fmt(item.rejected_bag_count), color: item.rejected_bag_count ? COLORS.danger : undefined },
                    { label: 'PACKED', value: `${fmt(item.total_packing_weight)} kg` },
                  ]} />
                  <InfoLine icon="calendar-blank-outline" text={`${item.packing_date}  •  ${item.sku_code}`} />
                  <InfoLine icon="cog-outline" text={item.machine_name} />
                  <InfoLine icon="account-outline" text={item.operator_name} />
                </InfoCard>
              );
            }}
          />
        )}
      </Container>
      <PackingDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
      <PackingFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={(closed) => { setShowForm(false); list.reload(); toast(closed ? 'Packing saved. Batch completed' : 'Packing saved'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
});
