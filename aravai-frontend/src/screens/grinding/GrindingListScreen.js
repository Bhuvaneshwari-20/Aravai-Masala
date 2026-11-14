import React, { useState } from 'react';
import { View, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
// import { useFocusEffect } from '@react-navigation/native';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import GrindingFormModal from '../../components/GrindingFormModal';
import { COLORS } from '../../theme';

const fmtDate = (d) => { const [y, m, day] = String(d).split('-'); return `${day}/${m}/${y}`; };
const fmtTime = (t) => String(t).slice(0, 5);

function Cell({ label, value }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue}>{value}</Text>
    </View>
  );
}

function EntryCard({ item }) {
  const loss = Number(item.loss_percent);
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.product}>{item.product}</Text>
          <Text style={s.batch}>{item.batch_code}  ·  {fmtDate(item.grind_date)}</Text>
        </View>
        <View style={[s.lossBadge, loss > 3 && { backgroundColor: COLORS.dangerBg }]}>
          <Text style={[s.lossText, loss > 3 && { color: COLORS.danger }]}>Loss {loss.toFixed(2)}%</Text>
        </View>
      </View>
      <View style={s.grid}>
        <Cell label="MESH" value={`${item.mesh_size} mm`} />
        <Cell label="I/P WT" value={`${item.input_weight} kg`} />
        <Cell label="O/P WT" value={`${item.output_weight} kg`} />
        <Cell label="SIEVED" value={item.sieved === 'YES' ? 'Yes' : 'No'} />
        <Cell label="I/P TIME" value={fmtTime(item.input_time)} />
        <Cell label="O/P TIME" value={fmtTime(item.output_time)} />
        <Cell label="SIGN" value={item.sign_name} />
      </View>
    </View>
  );
}

export default function GrindingListScreen() {
  const { toast } = useUi();
  const [showForm, setShowForm] = useState(false);
  const list = usePagedList('/grinding', {});

  // open the form every time the screen is opened from the sidebar
  // useFocusEffect(useCallback(() => { setShowForm(true); }, []));

  return (
    <View style={s.wrap}>
      <Container>
        <View style={s.bar}>
          <View style={s.titleRow}>
            <View style={s.titleIcon}><MCI name="mortar-pestle" size={20} color="#fff" /></View>
            <View>
              <Text style={s.title}>Grinding Log</Text>
              <Text style={s.sub}>{list.total} {list.total === 1 ? 'entry' : 'entries'}</Text>
            </View>
          </View>
          <Pressable style={s.add} onPress={() => setShowForm(true)}>
            <MCI name="plus" size={18} color="#fff" /><Text style={s.addText}>Add Entry</Text>
          </Pressable>
        </View>
      </Container>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="⚙️" message="No grinding entries yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item }) => <EntryCard item={item} />}
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
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  title: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  sub: { color: COLORS.grey, fontSize: 12, fontWeight: '600' },
  add: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  addText: { color: '#fff', fontWeight: '800', marginLeft: 6 },
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 12, marginVertical: 6, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  product: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  batch: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  lossBadge: { backgroundColor: COLORS.okBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  lossText: { color: COLORS.ok, fontWeight: '900', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', minWidth: 90, marginBottom: 8, paddingRight: 8 },
  cellLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: COLORS.grey },
  cellValue: { fontSize: 13.5, fontWeight: '700', color: COLORS.text, marginTop: 1 },
});