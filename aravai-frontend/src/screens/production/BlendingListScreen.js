import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import BlendingFormModal from '../../components/BlendingFormModal';
import BlendingDetailModal from '../../components/BlendingDetailModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

export default function BlendingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const [showForm, setShowForm] = useState(false);
  const [detailId, setDetailId] = useState(null);   // blending entry opened in the details view
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/blending', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload])); // eslint-disable-line

  return (
    <View style={s.wrap}>
<PageToolbar icon="blender" title="Blending" count={list.total} noun="blending run" search={search} onSearch={setSearch}        placeholder="Search batch / product" addLabel="New Blending" onAdd={can('blending', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🥣" message="No blending entries yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} icon="blender" color="#7C3AED" value={item.batch_no} size="md" caption={item.product_name}
                right={<ChevronDot />} onPress={() => setDetailId(item.id)}>
                <InfoStats per={3} items={[
                  { label: 'INPUT', value: `${fmt(item.total_input_weight)} kg` },
                  { label: 'OUTPUT', value: `${fmt(item.output_weight)} kg`, color: COLORS.ok },
                  { label: 'WASTAGE', value: `${fmt(item.wastage_weight)} kg`, color: COLORS.warn },
                ]} />
                <InfoLine icon="clock-outline" text={`${item.start_time?.slice(0, 16) || ''}${item.mixing_duration_min ? `  •  ${item.mixing_duration_min} min` : ''}`} />
                <InfoLine icon="cog-outline" text={item.machine_name} />
              </InfoCard>
            )}
          />
        )}
      </Container>
      <BlendingDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
      <BlendingFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); toast('Blending saved. Batch moved to packing'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
});
