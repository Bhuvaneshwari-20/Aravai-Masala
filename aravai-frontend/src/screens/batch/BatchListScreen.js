import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import StartBatchModal from '../../components/StartBatchModal';
import PageToolbar from '../../components/PageToolbar';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PressableScale from '../../components/PressableScale';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, ChevronDot, toneOf, useCardCols } from '../../components/InfoCard';
import { COLORS, fmt } from '../../theme';

export const STATUS = {
  IN_PROGRESS: { label: 'IN PROGRESS', color: COLORS.ok, bg: COLORS.okBg },
  ON_HOLD: { label: 'ON HOLD', color: COLORS.warn, bg: COLORS.warnBg },
  COMPLETED: { label: 'COMPLETED', color: COLORS.grey, bg: COLORS.greyBg },
  CANCELLED: { label: 'CANCELLED', color: COLORS.danger, bg: COLORS.dangerBg },
  OPEN: { label: 'OPEN', color: COLORS.grey, bg: COLORS.greyBg },
};

// Process (stage) a batch is currently in. Order: Batching -> Roasting -> Blending -> Grinding -> Final Blending -> Packing
export const stageLabel = (st) => String(st || '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Stage text for a batch. In PARALLEL roasting mode, Filtering runs alongside Roasting, so show both.
export const stageText = (b) => (b.roasting_mode === 'PARALLEL' && b.current_stage === 'ROASTING'
  ? 'Filtering + Roasting'
  : stageLabel(b.current_stage));

// What the card badge shows: the running process while the batch is IN_PROGRESS, else the status (Hold / Completed / Cancelled)
export const badgeFor = (b) => (b.status === 'IN_PROGRESS' && b.current_stage && b.current_stage !== 'COMPLETED'
  ? { label: stageText(b).toUpperCase(), color: COLORS.ok, bg: COLORS.okBg }
  : STATUS[b.status] || STATUS.OPEN);

export default function BatchListScreen({ navigation }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
  const [search, setSearch] = useState('');
  const [showStart, setShowStart] = useState(false);
  const [active, setActive] = useState(null);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/batches', { search: dSearch || undefined });

  const loadActive = useCallback(async () => {
    try { setActive((await api.get('/batches/active')).data.data); } catch (e) { /* banner is optional */ }
  }, []);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    loadActive();
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload, loadActive]));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="scale-balance" title="Batches" count={list.total} noun="batch" search={search} onSearch={setSearch}
        placeholder="Search batch no / product" addLabel="New Batch" onAdd={can('batching', 'create') ? () => setShowStart(true) : null} />

      {!!active && (
        <Container>
          <PressableScale to={0.98} style={s.banner} onPress={() => navigation.navigate('BatchDetail', { id: active.id })}>
            <Text style={s.bannerTitle}>Active batch: {active.batch_no}</Text>
            <Text style={s.bannerSub}>{active.product_name}  •  {active.status === 'ON_HOLD' ? 'ON HOLD' : 'Running'}  •  Process: {stageText(active)}</Text>
            <Text style={s.bannerHint}>Tap to open.</Text>
          </PressableScale>
        </Container>
      )}

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => { list.refresh(); loadActive(); }} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="⚖️" message="No batches yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => {
              const st = badgeFor(item);
              const running = item.status === 'IN_PROGRESS' || item.status === 'ON_HOLD';
              return (
                <InfoCard index={i} icon="scale-balance" color={COLORS.primary} value={item.batch_no} size="md"
                  caption={`${item.product_name}  •  ${fmt(item.planned_qty_kg)} kg`}
                  right={<ChevronDot />} onPress={() => navigation.navigate('BatchDetail', { id: item.id })}
                  footer={<Badge tone={toneOf(st.color)} text={st.label} />}>
                  <InfoLine icon="calendar-blank-outline" text={String(item.production_date).slice(0, 10)} />
                  <InfoLine icon="progress-clock" text={`Process: ${running ? stageText(item) :st.label.charAt(0) + st.label.slice(1).toLowerCase()}`} />
                </InfoCard>
              );
            }} />
        )}
      </Container>

      <StartBatchModal visible={showStart} onDismiss={() => setShowStart(false)}
        onSaved={(b) => { setShowStart(false); list.reload(); loadActive(); toast(`Batch ${b.batch_no} saved - next: ${b.roasting_mode === 'PARALLEL' ? 'Filtering + Roasting' : stageLabel(b.current_stage)}`); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  banner: { backgroundColor: COLORS.primaryDark, borderRadius: 16, marginHorizontal: 12, marginBottom: 6, padding: 14 },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  bannerSub: { color: '#FFD9A0', fontWeight: '700', marginTop: 3 },
  bannerHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },
});