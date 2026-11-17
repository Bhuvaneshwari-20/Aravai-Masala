import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, InfoStats, toneOf, useCardCols } from '../../components/InfoCard';
import PageToolbar from '../../components/PageToolbar';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import GrindingFormModal from '../../components/GrindingFormModal';
import { COLORS, fmt } from '../../theme';

// Grinding loss above this % is shown in red
const LOSS_ALERT = 3;

const STATUS = {
  COMPLETED: { color: COLORS.ok, bg: COLORS.okBg, label: 'COMPLETED' },
  IN_PROGRESS: { color: COLORS.warn, bg: COLORS.warnBg, label: 'IN PROGRESS' },
  REJECTED: { color: COLORS.danger, bg: COLORS.dangerBg, label: 'REJECTED' },
};

// where the batch is right now (batch_stage comes from the list API)
const STAGE = {
  GRINDING: { label: 'AT GRINDING', color: COLORS.warn },
  BLENDING: { label: 'AT BLENDING', color: COLORS.green },
  PACKING: { label: 'AT PACKING', color: COLORS.green },
  COMPLETED: { label: 'BATCH COMPLETED', color: COLORS.ok },
};
// The badge shows where the batch is now. A finished grinding entry is NOT "completed" until the whole batch is.
const badgeFor = (item) => {
  if (item.status === 'REJECTED') return STATUS.REJECTED;
  if (item.batch_status === 'ON_HOLD') return { label: 'ON HOLD', color: COLORS.danger };
  if (item.batch_status === 'CANCELLED') return { label: 'BATCH CANCELLED', color: COLORS.danger };
  if (item.batch_stage && STAGE[item.batch_stage]) return STAGE[item.batch_stage];
  return STATUS[item.status] || STATUS.COMPLETED;
};

const fmtDate = (d) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
};
// API gives "2026-11-16 03:00:00" (date + time) -> HH:MM
const hhmm = (t) => {
  const m = /(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '–';
};
const mins = (t) => {
  const m = /(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const duration = (a, b) => {
  const x = mins(a); const y = mins(b);
  if (x === null || y === null || y <= x) return '';
  const d = y - x;
  const h = Math.floor(d / 60); const mm = d % 60;
  return h ? `${h} h${mm ? ` ${mm} m` : ''}` : `${mm} m`;
};

function GrindCard({ item, index }) {
  const st = badgeFor(item);
  const loss = Number(item.loss_percent) || 0;
  const high = loss > LOSS_ALERT;
  const sieved = item.siever === 'YES'; // the column is `siever`
  const dur = duration(item.input_time, item.output_time);
  const lossKg = item.wastage_weight != null ? Number(item.wastage_weight) : Math.max(Number(item.input_weight) - Number(item.output_weight), 0);

  return (
    <InfoCard index={index} icon="mortar-pestle" color={high ? COLORS.danger : '#0F766E'} value={item.batch_code} size="md"
      caption={item.product} sub={`${fmtDate(item.grind_date)}${item.machine_name ? `  ·  ${item.machine_name}` : ''}`}
      footer={[
        <Badge key="s" tone={toneOf(st.color)} text={st.label} />,
        sieved ? <Badge key="v" tone="primary" text="SIEVED" /> : null,
      ]}>
      {/* weight flow: I/P -> O/P, loss */}
      <View style={s.flow}>
        <View style={s.flowBox}>
          <Text style={s.cellLabel}>I/P (KG)</Text>
          <Text style={s.flowVal}>{fmt(item.input_weight)}</Text>
        </View>
        <MCI name="arrow-right-thin" size={22} color={COLORS.grey} />
        <View style={s.flowBox}>
          <Text style={s.cellLabel}>O/P (KG)</Text>
          <Text style={[s.flowVal, { color: COLORS.green }]}>{fmt(item.output_weight)}</Text>
        </View>
        <View style={s.flowDivider} />
        <View style={[s.flowBox, { flex: 1.3 }]}>
          <Text style={s.cellLabel}>LOSS</Text>
          <Text style={[s.flowVal, { color: high ? COLORS.danger : COLORS.ok }]}>
            {loss.toFixed(2)}%
            <Text style={s.flowSmall}>{`  (${fmt(lossKg)} kg)`}</Text>
          </Text>
        </View>
      </View>

      <InfoStats items={[
        { label: 'MESH', value: `${item.mesh_size} mm` },
        { label: 'SIEVED', value: sieved ? 'Yes' : 'No', color: sieved ? COLORS.ok : undefined },
        { label: 'TIME', value: `${hhmm(item.input_time)} – ${hhmm(item.output_time)}` },
        { label: 'DURATION', value: dur || '–' },
      ]} />

      {!!item.remarks && <InfoLine icon="comment-text-outline" lines={2} text={item.remarks} />}
    </InfoCard>
  );
}

export default function GrindingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 320, phoneMin: 280 });
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/grinding', { search: dSearch || undefined });

  // refresh when coming back to this screen (not on the very first focus)
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload])); // eslint-disable-line

  return (
    <View style={s.wrap}>
      <PageToolbar icon="mortar-pestle" title="Grinding Log" count={list.total} noun="entry" subtitle={`${list.total} ${list.total === 1 ? 'entry' : 'entries'}`}
        search={search} onSearch={setSearch} placeholder="Search batch no / product / remarks" addLabel="Add Entry"
        onAdd={can('grinding', 'create') ? () => setShowForm(true) : null} />

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="⚙️" message="No grinding entries yet. Tap Add Entry." />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, index) => <GrindCard item={item} index={index} />}
          />
        )}
      </Container>

      <GrindingFormModal
        visible={showForm}
        onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); toast('Grinding entry saved'); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  flow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  flowBox: { flex: 1 },
  flowVal: { fontSize: 17, fontWeight: '900', color: COLORS.text, marginTop: 2 },
  flowSmall: { fontSize: 11.5, fontWeight: '700', color: COLORS.grey },
  flowDivider: { width: 1, alignSelf: 'stretch', backgroundColor: COLORS.border, marginHorizontal: 12 },
  cellLabel: { fontSize: 10, fontWeight: '800', color: COLORS.grey, letterSpacing: 0.5 },
});
