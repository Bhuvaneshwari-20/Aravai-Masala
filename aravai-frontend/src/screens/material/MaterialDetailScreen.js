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
import StockBar from '../../components/StockBar';
import { DetailHeader, InfoCard, ActionBtn, Pill } from '../../components/DetailLayout';
import useLayout from '../../hooks/useLayout';
import { COLORS, SHADOW, fmt, categoryStyle } from '../../theme';

export default function MaterialDetailScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const { pad } = useLayout();
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

  if (loading) return <LoadingView rows={3} />;
  if (error || !m) return <EmptyView error={error || 'Material not found'} onRetry={() => { setLoading(true); load(); }} />;

  const cs = categoryStyle(m.category_name || '');
  const cur = Number(m.current_stock) || 0;
  const min = Number(m.minimum_stock) || 0;
  const low = !!m.is_low_stock;
  const canEdit = can('material', 'edit');
  const specs = Array.isArray(m.specifications) ? m.specifications : [];
  const stockColor = low ? COLORS.danger : COLORS.ok;

  const rows = [
    { icon: cs.icon, label: 'Category', value: m.category_name },
    { icon: '📏', label: 'Unit', value: m.unit },
    !!m.sku && { icon: '🔖', label: 'Short code', value: m.sku },
    min > 0 && { icon: '🔔', label: 'Minimum stock', value: `${fmt(min)} ${m.unit}` },
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <DetailHeader color={cs.color} tile={<Text style={{ fontSize: 30 }}>{cs.icon}</Text>}
          title={m.material_name} subtitle={m.material_code}
          pills={(
            <>
              <Pill text={m.is_active ? '● ACTIVE' : '● INACTIVE'} color={m.is_active ? COLORS.ok : COLORS.grey} bg={m.is_active ? COLORS.okBg : COLORS.greyBg} />
              {low && <Pill text="⚠ LOW STOCK" color={COLORS.danger} bg={COLORS.dangerBg} />}
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
          <FadeIn delay={60} style={[s.stock, SHADOW.sm, { marginHorizontal: pad }, low && { borderColor: '#F3C4C0' }]}>
            <View style={s.stockTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.stockLabel}>CURRENT STOCK</Text>
                <Text style={[s.big, { color: stockColor }]} numberOfLines={1}>{fmt(cur)} <Text style={s.unit}>{m.unit}</Text></Text>
              </View>
              <View style={[s.status, { backgroundColor: low ? COLORS.dangerBg : COLORS.okBg }]}>
                <Text style={[s.statusText, { color: stockColor }]}>{low ? 'Reorder soon' : 'Healthy'}</Text>
              </View>
            </View>
            {min > 0 && (
              <View style={{ marginTop: 16 }}>
                <StockBar current={cur} minimum={min} low={low} height={10} />
                <View style={s.scale}>
                  <Text style={s.scaleText}>0</Text>
                  <Text style={s.scaleText}>Minimum {fmt(min)}</Text>
                  <Text style={s.scaleText}>{fmt(min * 2)}+</Text>
                </View>
              </View>
            )}
          </FadeIn>
        </Container>

        <InfoCard title="DETAILS" rows={rows} />

        {!!specs.length && (
          <Container maxWidth={900}>
            <FadeIn delay={160} style={[s.specCard, SHADOW.sm, { marginHorizontal: pad }]}>
              <Text style={s.specTitle}>SPECIFICATIONS</Text>
              <View style={s.chips}>
                {specs.map((x, i) => (
                  <View key={i} style={s.chip}>
                    <View style={s.chipNo}><Text style={s.chipNoText}>{i + 1}</Text></View>
                    <Text style={s.chipText}>{x}</Text>
                  </View>
                ))}
              </View>
            </FadeIn>
          </Container>
        )}
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
  stock: { backgroundColor: '#fff', borderRadius: 22, marginBottom: 12, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  stockTop: { flexDirection: 'row', alignItems: 'center' },
  stockLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: COLORS.grey },
  big: { fontSize: 38, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 },
  unit: { fontSize: 17, fontWeight: '700', color: COLORS.grey },
  status: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 10 },
  statusText: { fontSize: 12, fontWeight: '900' },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  scaleText: { fontSize: 11, fontWeight: '700', color: COLORS.grey },
  specCard: { backgroundColor: '#fff', borderRadius: 22, marginBottom: 12, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  specTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: COLORS.grey, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FBF6F0', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 10, marginRight: 8, marginBottom: 8, maxWidth: '100%' },
  chipNo: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  chipNoText: { fontSize: 11, fontWeight: '900', color: COLORS.primary },
  chipText: { fontSize: 14, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
});
