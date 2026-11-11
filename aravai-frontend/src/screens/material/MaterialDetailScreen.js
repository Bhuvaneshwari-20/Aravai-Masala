import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Snackbar } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import MaterialFormModal from '../../components/MaterialFormModal';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import FadeIn from '../../components/FadeIn';
import Container from '../../components/Container';
import { DetailHeader, InfoCard, ActionBtn, Pill } from '../../components/DetailLayout';
import { COLORS, fmt, money, categoryStyle } from '../../theme';

export default function MaterialDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/materials/${id}`);
      setM(r.data.data); setError('');
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeStatus = async () => {
    setBusy(true);
    try {
      const r = await api.patch(`/materials/${id}/status`, { is_active: !m.is_active });
      setM(r.data.data); setConfirm(false);
      setMsg(r.data.data.is_active ? 'Material activated' : 'Material deactivated');
    } catch (e) { setConfirm(false); setMsg(errMsg(e)); }
    setBusy(false);
  };

  if (loading) return <LoadingView />;
  if (error || !m) return <EmptyView error={error || 'Material not found'} onRetry={() => { setLoading(true); load(); }} />;

  const cs = categoryStyle(m.category_name);
  const cur = Number(m.current_stock) || 0;
  const min = Number(m.minimum_stock) || 0;
  const pct = min > 0 ? Math.max(0.04, Math.min(1, cur / (min * 2))) : 1;
  const low = !!m.is_low_stock;
  const canEdit = can('material', 'edit');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <DetailHeader color={cs.color} tile={<Text style={{ fontSize: 30 }}>{cs.icon}</Text>}
          title={m.material_name} subtitle={`${m.material_code}  •  ${m.category_name}`}
          pills={(
            <>
              <Pill text={m.is_active ? 'ACTIVE' : 'INACTIVE'} color={m.is_active ? COLORS.ok : COLORS.grey} bg={m.is_active ? COLORS.okBg : COLORS.greyBg} />
              {low && <Pill text="LOW STOCK" color={COLORS.danger} bg={COLORS.dangerBg} />}
            </>
          )}
          actions={canEdit ? (
            <>
              <ActionBtn icon="pencil" label="Edit" onPress={() => setEditing(true)} />
              <ActionBtn outline icon={m.is_active ? 'close-circle' : 'check-circle'} label={m.is_active ? 'Deactivate' : 'Activate'}
                color={m.is_active ? COLORS.danger : COLORS.ok} onPress={() => setConfirm(true)} />
            </>
          ) : null} />

        <Container maxWidth={900}>
          <FadeIn delay={60} style={[s.stock, low && { borderColor: COLORS.danger }]}>
            <Text style={s.stockLabel}>CURRENT STOCK</Text>
            <Text style={[s.big, low && { color: COLORS.danger }]}>{fmt(cur)} <Text style={s.unit}>{m.unit}</Text></Text>
            <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: low ? COLORS.danger : COLORS.ok }]} /></View>
            <Text style={s.minText}>Minimum stock: {fmt(min)} {m.unit}</Text>
          </FadeIn>
        </Container>

        <InfoCard title="DETAILS" rows={[
          { icon: '🗂️', label: 'Category', value: m.category_name },
          { icon: '📏', label: 'Unit', value: m.unit },
          { icon: '📝', label: 'Specifications', value: (m.specifications || []).map((x, i) => `${i + 1}. ${x}`).join('\n') },
          { icon: '📥', label: 'Opening stock', value: `${fmt(m.opening_stock)} ${m.unit}` },
          { icon: '🔔', label: 'Minimum stock', value: `${fmt(m.minimum_stock)} ${m.unit}` },
          { icon: '💰', label: 'Purchase rate', value: money(m.purchase_rate) },
          { icon: '📍', label: 'Place', value: m.place },
          { icon: '🏷️', label: 'SKU', value: m.sku },
          { icon: '🕒', label: 'Created', value: m.created_at },
        ]} />
      </ScrollView>

      <MaterialFormModal visible={editing} id={id} onDismiss={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(); setMsg('Material updated'); }} />
      <ConfirmDialog visible={confirm} busy={busy}
        title={m.is_active ? 'Deactivate material?' : 'Activate material?'}
        message={`${m.material_name} (${m.material_code}) - ${m.is_active ? 'deactivate' : 'activate'} this material?`}
        confirmText={m.is_active ? 'Deactivate' : 'Activate'}
        onConfirm={changeStatus} onCancel={() => setConfirm(false)} />
      <Snackbar visible={!!msg} onDismiss={() => setMsg('')} duration={3000}>{msg}</Snackbar>
    </View>
  );
}

const s = StyleSheet.create({
  stock: { backgroundColor: '#fff', borderRadius: 18, marginHorizontal: 16, marginBottom: 12, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  stockLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey },
  big: { fontSize: 40, fontWeight: '900', color: COLORS.text, marginTop: 4 },
  unit: { fontSize: 18, fontWeight: '700', color: COLORS.grey },
  track: { height: 8, borderRadius: 4, backgroundColor: COLORS.greyBg, marginTop: 10, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  minText: { color: COLORS.grey, fontWeight: '600', marginTop: 8, fontSize: 13 },
});
