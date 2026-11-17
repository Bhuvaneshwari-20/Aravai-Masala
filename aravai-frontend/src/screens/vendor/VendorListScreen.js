import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import VendorFormModal from '../../components/VendorFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, ChevronDot, useCardCols } from '../../components/InfoCard';
import { COLORS, colorFor } from '../../theme';

export const STATUS_STYLE = {
  ACTIVE: { color: COLORS.ok, bg: COLORS.okBg },
  INACTIVE: { color: COLORS.grey, bg: COLORS.greyBg },
  BLOCKED: { color: COLORS.danger, bg: COLORS.dangerBg },
};
const TONE = { ACTIVE: 'ok', INACTIVE: 'grey', BLOCKED: 'danger' };

export default function VendorListScreen({ navigation, route }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 240, phoneMin: 280 });
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
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🏭" message="No vendors found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} color={colorFor(item.vendor_name)} letter={item.vendor_name.trim().charAt(0).toUpperCase()}
                value={item.vendor_name} size="md" caption={item.vendor_code} dim={item.status !== 'ACTIVE'}
                right={<ChevronDot />}
                onPress={() => navigation.navigate('VendorDetail', { id: item.id })}
                footer={<Badge tone={TONE[item.status] || 'grey'} text={item.status} />}>
                <InfoLine icon="account-outline" text={item.contact_person} />
                <InfoLine icon="phone-outline" text={item.mobile} />
                <InfoLine icon="map-marker-outline" text={item.city} />
              </InfoCard>
            )} />
        )}
      </Container>

      <VendorFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); list.reload(); toast('Vendor added'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
});
