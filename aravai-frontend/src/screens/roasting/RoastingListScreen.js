import React, { useCallback, useRef, useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import useLayout from '../../hooks/useLayout';
import Container from '../../components/Container';
import FadeIn from '../../components/FadeIn';
import PressableScale from '../../components/PressableScale';
import PageToolbar from '../../components/PageToolbar';
import RoastingFormModal from '../../components/RoastingFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, padGrid, fmt } from '../../theme';

const STATUS = {
  COMPLETED: { color: COLORS.ok, bg: COLORS.okBg, label: 'COMPLETED' },
  IN_PROGRESS: { color: COLORS.warn, bg: COLORS.warnBg, label: 'IN PROGRESS' },
  REJECTED: { color: COLORS.danger, bg: COLORS.dangerBg, label: 'REJECTED' },
};
const hhmm = (dt) => (dt ? dt.slice(11, 16) : '–');

function Cell({ label, value, color, bold }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cellValue, bold && { fontWeight: '900', fontSize: 16 }, color && { color }]}>{value}</Text>
    </View>
  );
}

function RoastCard({ item, index, onPress }) {
  const st = STATUS[item.status] || STATUS.IN_PROGRESS;
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} to={0.98} style={s.card}>
        <View style={[s.stripe, { backgroundColor: item.loss_alert ? COLORS.danger : st.color }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={{ flex: 1 }}>
              <Text style={s.code} numberOfLines={1}>{item.code_no}</Text>
              {!!item.batch_no && <Text style={s.batch} numberOfLines={1}>{item.batch_no} · {item.material_code} {item.material_name}</Text>}
              <Text style={s.sub}>{item.roast_date} · {item.machine_name}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text></View>
          </View>

          <View style={s.row}>
            <Cell label="I/P (Kg)" value={fmt(item.input_weight)} />
            <Cell label="O/P AFTER ROASTING (Kg)" bold value={item.output_weight == null ? '–' : fmt(item.output_weight)} />
            <Cell label="LOSS %" value={item.loss_percent == null ? '–' : `${item.loss_percent}%`} color={item.loss_alert ? COLORS.danger : undefined} />
          </View>
          <View style={s.row}>
            <Cell label="TEMP (before / std / after)" value={`${item.temp_before ?? '–'} / ${item.std_temp ?? '–'} / ${item.temp_after ?? '–'}`} />
            <Cell label="TIME" value={`${hhmm(item.start_time)} – ${hhmm(item.end_time)}${item.running_hours != null ? `  (${item.running_hours} h)` : ''}`} />
          </View>
          <Text style={s.foot} numberOfLines={1}>
            By {item.operator_name}{item.incharge_name ? ` · Incharge: ${item.incharge_name}` : ''}{item.loss_alert ? '  ·  ⚠ High loss' : ''}
          </Text>
        </View>
      </PressableScale>
    </FadeIn>
  );
}

export default function RoastingListScreen({ navigation, route }) {
  const { can, user } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ open: false, item: null });
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/roasting', { search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const openItem = (item) => {
    if (!can('roasting', 'edit')) return toast('You can view this entry but not edit it');
    if (item.status === 'COMPLETED' && user.role_name === 'Roasting Operator') return toast('Completed entries are locked. Ask the Production Incharge to correct it.');
    setForm({ open: true, item });
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="fire" title="Roasting Register" count={list.total} noun="record" search={search} onSearch={setSearch}
        placeholder="Search batch no / material / code no / machine" addLabel="Add Entry"
        onAdd={can('roasting', 'create') ? () => setForm({ open: true, item: null }) : null} />

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <FlatList
            key={listCols}
            numColumns={listCols}
            data={padGrid(list.items, listCols)}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🔥" message="No roasting entries yet. Tap Add Entry." />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item, index }) => item.pad
              ? <View style={{ flex: 1, marginHorizontal: 12 }} />
              : <RoastCard item={item} index={index} onPress={() => openItem(item)} />}
          />
        )}
      </Container>

      <RoastingFormModal visible={form.open} item={form.item} onDismiss={() => setForm({ open: false, item: null })}
        onSaved={(edited) => { setForm({ open: false, item: null }); list.reload(); toast(edited ? 'Roasting entry updated' : 'Roasting entry saved'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  batch: { color: COLORS.primary, fontSize: 12.5, fontWeight: '800', marginTop: 2 },
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 5 },
  body: { flex: 1, padding: 14 },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  code: { fontSize: 17, fontWeight: '900', color: COLORS.text },
  sub: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  row: { flexDirection: 'row', marginTop: 10 },
  cellLabel: { fontSize: 10, fontWeight: '800', color: COLORS.grey, letterSpacing: 0.5 },
  cellValue: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginTop: 2 },
  foot: { marginTop: 10, color: COLORS.grey, fontSize: 12, fontWeight: '600' },
});