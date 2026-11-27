import React, { useCallback, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import PageToolbar from '../../components/PageToolbar';
import Container from '../../components/Container';
import FilterChips from '../../components/FilterChips';
import ModalShell from '../../components/ModalShell';
import ConfirmDialog from '../../components/ConfirmDialog';
import Badge from '../../components/Badge';
import SalesReturnFormModal from '../../components/SalesReturnFormModal';
import { KV } from '../../components/SalesBits';
import { Label } from '../../components/FormBits';
import InfoCard, { CardList, InfoLine, InfoStats, ChevronDot, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import { niceDate, statusText, statusTone, typeText } from './salesUtils';
import { COLORS, fmt, money } from '../../theme';

// Sales Return: list of returns + "New Return" popup. Saving a return updates finished goods stock on the server.
// GET /sales/returns   POST /sales/returns   PUT /sales/returns/:id/status
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
];

export default function SalesReturnScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const grid = useCardCols({ min: 320, phoneMin: 280 });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const [showForm, setShowForm] = useState(false);
  const [open, setOpen] = useState(null);            // return opened in the details popup
  const [complete, setComplete] = useState(null);    // pending return the user wants to mark completed
  const [busy, setBusy] = useState(false);
  const list = usePagedList('/sales/returns', { search: dSearch || undefined, status: status || undefined });

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    list.silentReload();
  }, [list.silentReload])); // eslint-disable-line

  const markDone = async () => {
    setBusy(true);
    try {
      await api.put(`/sales/returns/${complete.id}/status`, { status: 'COMPLETED' });
      toast(`${complete.return_no} marked completed`);
      setComplete(null); setOpen(null); list.reload();
    } catch (e) { toast(errMsg(e)); setComplete(null); }
    setBusy(false);
  };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="keyboard-return" title="Sales Return" count={list.total} noun="return" subtitle="Returned packs go back to finished goods stock automatically"
        search={search} onSearch={setSearch} placeholder="Search return no / invoice / customer"
        addLabel="New Return" onAdd={can('sales_return', 'create') ? () => setShowForm(true) : null} />
      <Container fill>
        <FilterChips options={FILTERS} value={status} onChange={setStatus} />
        {list.loading ? <LoadingView rows={4} /> : list.error && !list.items.length ? <EmptyView error={list.error} onRetry={list.reload} /> : (
          <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
            onEndReached={list.loadMore} onEndReachedThreshold={0.4}
            ListEmptyComponent={<EmptyView icon="↩️" message="No sales returns yet" />}
            ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
            renderItem={(r, i) => (
              <InfoCard index={i} icon="keyboard-return" color={COLORS.danger} value={r.return_no} size="md"
                caption={`${r.customer_name} · ${r.invoice_no}`} right={<ChevronDot />} onPress={() => setOpen(r)}
                footer={<Badge tone={statusTone(r.status)} text={statusText(r.return_type, r.status)} />}>
                <InfoStats items={[
                  { label: 'PACKS RETURNED', value: fmt(r.total_packs) },
                  { label: r.return_type === 'REPLACEMENT' ? 'REPLACEMENT VALUE' : 'REFUND VALUE', value: money(r.refund_amount), color: COLORS.danger },
                ]} />
                <InfoLine icon="calendar-blank-outline" text={niceDate(r.return_date)} />
                <InfoLine icon="package-variant-closed" text={(r.items || []).map((x) => `${x.product_name} ${x.packing_size_label} × ${fmt(x.quantity)}`).join(', ')} lines={2} />
              </InfoCard>
            )} />
        )}
      </Container>

      <SalesReturnFormModal visible={showForm} onDismiss={() => setShowForm(false)}
        onSaved={(r) => { setShowForm(false); list.reload(); toast(`Return ${r?.return_no || ''} saved. Stock updated`); }} />

      <ModalShell visible={!!open} onDismiss={() => setOpen(null)} icon="keyboard-return" maxWidth={600}
        title={open ? open.return_no : ''} subtitle={open ? `${open.customer_name} · ${open.invoice_no}` : ''}
        footer={open && open.status === 'PENDING' && can('sales_return', 'edit') ? (
          <Button mode="contained" icon="check" buttonColor={COLORS.green} style={{ borderRadius: 10 }} onPress={() => setComplete(open)}>
            {open.return_type === 'REPLACEMENT' ? 'Mark replacement sent' : 'Mark refund paid'}
          </Button>
        ) : null}>
        {!!open && (
          <View>
            <Badge tone={statusTone(open.status)} text={statusText(open.return_type, open.status)} />
            <View style={{ marginTop: 12 }}>
              <KV label="Return date" value={niceDate(open.return_date)} />
              <KV label="Type" value={typeText(open.return_type)} />
              <KV label="Packs returned" value={fmt(open.total_packs)} />
              <KV label={open.return_type === 'REPLACEMENT' ? 'Replacement value' : 'Refund value'} value={money(open.refund_amount)} bold />
            </View>
            <Label style={{ marginTop: 14 }}>RETURNED ITEMS</Label>
            {(open.items || []).map((x) => (
              <View key={x.id} style={s.item}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemName}>{x.product_name} · {x.packing_size_label}</Text>
                  <Text style={s.itemSub}>{`${x.sku_code}  •  ${x.reason}`}</Text>
                  <Text style={[s.itemSub, { color: x.condition === 'DAMAGED' ? COLORS.warn : COLORS.ok }]}>
                    {x.condition === 'DAMAGED' ? 'Damaged: not added to stock' : 'Resalable: added back to stock'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.itemName}>{fmt(x.quantity)} packs</Text>
                  <Text style={s.itemSub}>{money(x.amount)}</Text>
                </View>
              </View>
            ))}
            {!!open.remarks && <Text style={s.remarks}>{open.remarks}</Text>}
          </View>
        )}
      </ModalShell>

      <ConfirmDialog visible={!!complete} busy={busy} title="Mark as completed?" confirmText="Yes, completed"
        message={complete ? (complete.return_type === 'REPLACEMENT'
          ? `The replacement packs for ${complete.return_no} will be issued from finished goods stock.`
          : `${complete.return_no}: refund of ${money(complete.refund_amount)} will be marked as paid.`) : ''}
        onConfirm={markDone} onCancel={() => setComplete(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  item: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 10, marginBottom: 6 },
  itemName: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  itemSub: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  remarks: { marginTop: 10, color: COLORS.textSoft, fontSize: 13.5, lineHeight: 19 },
});
