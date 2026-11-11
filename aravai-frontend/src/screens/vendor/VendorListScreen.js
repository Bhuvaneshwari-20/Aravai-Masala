import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import VendorFormModal from '../../components/VendorFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, colorFor, padGrid } from '../../theme';

export const STATUS_STYLE = {
  ACTIVE: { color: COLORS.ok, bg: COLORS.okBg },
  INACTIVE: { color: COLORS.grey, bg: COLORS.greyBg },
  BLOCKED: { color: COLORS.danger, bg: COLORS.dangerBg },
};

function VendorCard({ item, index, onPress }) {
  const c = colorFor(item.vendor_name);
  const st = STATUS_STYLE[item.status] || STATUS_STYLE.INACTIVE;
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} to={0.98} style={[s.card, item.status !== 'ACTIVE' && { opacity: 0.65 }]}>
        <View style={[s.stripe, { backgroundColor: c }]} />
        <View style={s.body}>
          <View style={s.top}>
            <View style={[s.avatar, { backgroundColor: `${c}1F` }]}><Text style={[s.avatarText, { color: c }]}>{item.vendor_name.trim().charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{item.vendor_name}</Text>
              <Text style={s.code}>{item.vendor_code}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{item.status}</Text></View>
          </View>
          <View style={s.info}>
            {!!item.contact_person && <Text style={s.line} numberOfLines={1}>👤  {item.contact_person}</Text>}
            {!!item.mobile && <Text style={s.line}>📞  {item.mobile}</Text>}
            {!!item.city && <Text style={s.line} numberOfLines={1}>📍  {item.city}</Text>}
          </View>
        </View>
      </PressableScale>
    </FadeIn>
  );
}

export default function VendorListScreen({ navigation, route }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const { listCols } = useLayout();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/vendors', { search: dSearch || undefined });

  useEffect(() => {
    if (route.params?.openAdd) { setShowForm(true); navigation.setParams({ openAdd: undefined }); }
  }, [route.params?.openAdd]); // eslint-disable-line

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  return (
    <View style={s.wrap}>
      <PageToolbar icon="store" title="All Vendors" count={list.total} noun="vendor" search={search} onSearch={setSearch}
        placeholder="Search name / code / mobile" addLabel="Add Vendor" onAdd={can('vendor', 'create') ? () => setShowForm(true) : null} />

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
            ListEmptyComponent={<EmptyView icon="🏭" message="No vendors found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={({ item, index }) => item.pad
              ? <View style={{ flex: 1, marginHorizontal: 12 }} />
              : <VendorCard item={item} index={index} onPress={() => navigation.navigate('VendorDetail', { id: item.id })} />}
          />
        )}
      </Container>

      <VendorFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); toast('Vendor added'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginVertical: 6,
    borderWidth: 1, borderColor: COLORS.border, elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 5 },
  body: { flex: 1, padding: 14 },
  top: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 21, fontWeight: '900' },
  name: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  code: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  info: { marginTop: 10 },
  line: { color: '#4a3b34', fontSize: 13, marginTop: 3 },
});
