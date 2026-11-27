import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, ScrollView, Pressable, StyleSheet } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import PageToolbar from '../../components/PageToolbar';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import Badge from '../../components/Badge';
import InfoCard, { CardList, InfoLine, ChevronDot, useCardCols } from '../../components/InfoCard';
import IndentFormModal from '../../components/IndentFormModel';
import IndentDetailModal, { STATUS_TONE } from '../../components/IndentDetailModel';
import { COLORS, colorFor } from '../../theme';

const TABS = [['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']];

// Admin: raises indents and sees their status.   Manager: sees them here and approves / rejects.
export default function IndentScreen() {    
const { can, user, viewAs } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 260, phoneMin: 280 });
 const manager = (viewAs?.role_name || user?.role_name) === 'Manager';
  const [status, setStatus] = useState(manager ? 'PENDING' : '');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const dSearch = useDebounce(search, 400);
  const list = usePagedList('/indents', { status: status || undefined, search: dSearch || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload]));

  const sum = list.summary || {};
  return (
    <View style={s.wrap}>
      <PageToolbar icon="cart" title="Indent" count={list.total} noun="indent" search={search} onSearch={setSearch}
        placeholder="Search indent no / material / name" addLabel="New Indent" onAdd={can('purchase', 'create') ? () => setShowForm(true) : null} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {TABS.map(([key, label]) => (
          <Pressable key={key || 'all'} onPress={() => setStatus(key)} style={[s.tab, status === key && s.tabOn]}>
            <Text style={[s.tabText, status === key && { color: '#fff' }]}>{label}{key && sum[key] ? `  ${sum[key]}` : ''}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Container fill>
        {list.loading ? <LoadingView /> : list.error && !list.items.length ? (
          <EmptyView error={list.error} onRetry={list.reload} />
        ) : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="🛒" message="No indents found" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(item, i) => (
              <InfoCard index={i} color={colorFor(item.indent_no || 'PR')} letter="IN" value={item.indent_no} size="md"
                caption={String(item.indent_date).slice(0, 10)} right={<ChevronDot />} onPress={() => setOpenId(item.id)}
                footer={<Badge tone={STATUS_TONE[item.status] || 'grey'} text={item.status} />}>
                <InfoLine icon="account-outline" text={item.requested_by_name} />
                <InfoLine icon="package-variant" text={`${item.item_count} material${item.item_count === 1 ? '' : 's'}`} />
              </InfoCard>
            )} />
        )}
      </Container>

         <IndentFormModal visible={showForm || !!editing} indent={editing}
        onDismiss={() => { setShowForm(false); setEditing(null); }}
        onSaved={() => { const was = editing; setShowForm(false); setEditing(null); list.reload(); toast(was ? 'Indent updated' : 'Indent sent to Manager'); }} />
      <IndentDetailModal visible={!!openId} id={openId} onDismiss={() => setOpenId(null)}
        onEdit={(d) => { setOpenId(null); setEditing(d); }}
        onChanged={(what) => { setOpenId(null); list.reload(); toast(what === 'approve' ? 'Indent approved' : what === 'reject' ? 'Indent rejected' : what === 'delete' ? 'Indent deleted' : 'Indent cancelled'); }} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { flexGrow: 0, paddingVertical: 10 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, marginRight: 8 },
  tabOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontWeight: '800', fontSize: 13, color: COLORS.text },
});
