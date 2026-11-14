import React, { useCallback, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { MACHINE_TYPES, MACHINE_STATUS } from '../../components/MachineFormModal';
import { parseMachineScan } from '../../machineCode';
import { COLORS, fmt } from '../../theme';

const label = (list, v) => (list.find((x) => x.value === v) || {}).label || v;
// '2026-03-05' or '2026-03-05T00:00:00.000Z' -> '05 Mar 2026' (date only, no time-zone shift)
const fmtDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m) return v;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return mon ? `${m[3]} ${mon} ${m[1]}` : v;
};
const Row = ({ k, v }) => (
  <View style={s.row}><Text style={s.k}>{k}</Text><Text style={s.v}>{v === null || v === undefined || v === '' ? '-' : v}</Text></View>
);

// Machine details after a QR scan. Route: 'MachineQr' with params { token: <qr_token | machine code | scanned link>, machine?: <already loaded machine> }.
// Opened by the phone camera through the QR link <APP_URL>/m/<qr_token> (see linking.js), or by the in-app scanner.
// `machine` (from the scan screen) is shown at once, then refreshed from GET /machines/by-token/:code.
export default function MachineQrScreen({ route, navigation }) {
  const params = route.params || {};
  const { can } = useAuth();
  const [m, setM] = useState(params.machine || null);
  const [error, setError] = useState('');
  const have = useRef(!!params.machine);

  const load = useCallback(async () => {
    setError('');
    const parsed = parseMachineScan(params.token);
    if (!parsed) { setM(null); have.current = false; setError('Invalid machine QR code.'); return; }
    try {
      const r = await api.get(`/machines/by-token/${encodeURIComponent(parsed.id)}`);
      setM(r.data.data); have.current = true;
    } catch (e) {
      if (!have.current) setError(e.response?.status === 404 ? 'This QR code is not registered to any machine.' : errMsg(e)); // already showing the scanned machine? keep it on a failed refresh
    }
  }, [params.token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error && !m) return <EmptyView error={error} onRetry={load} />;
  if (!m) return <LoadingView />;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }}>
      <Container maxWidth={640}>
        <View style={s.card}>
          <View style={s.avatar}><MCI name="cog" size={32} color={COLORS.primary} /></View>
          <Text style={s.code}>{m.machine_code}</Text>
          <Text style={s.name}>{m.machine_name}</Text>
          <View style={s.rows}>
            <Row k="Machine code" v={m.machine_code} />
            <Row k="Machine name" v={m.machine_name} />
            <Row k="Machine type" v={label(MACHINE_TYPES, m.machine_type)} />
            <Row k="Status" v={label(MACHINE_STATUS, m.status)} />
            <Row k="Manufacturer" v={m.manufacturer} />
            <Row k="Capacity" v={m.capacity != null ? `${fmt(m.capacity)} ${m.capacity_unit || ''}`.trim() : null} />
            <Row k="Assigned operator" v={m.operator_name} />
            <Row k="Installation date" v={fmtDate(m.installation_date)} />
            <Row k="Last maintenance date" v={fmtDate(m.last_maintenance_date)} />
            <Row k="Next maintenance date" v={fmtDate(m.next_maintenance_date)} />
          </View>
          {navigation.canGoBack() && (
            <Button mode="contained" icon="qrcode-scan" buttonColor={COLORS.primary} style={s.btn} onPress={() => navigation.goBack()}>Scan another machine</Button>)}
          {can('machine', 'view') && (
            <Button mode="outlined" icon="cogs" textColor={COLORS.text} style={[s.btn, { borderColor: COLORS.border }]} onPress={() => navigation.navigate('MachineList')}>
              All machines
            </Button>)}
        </View>
      </Container>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', margin: 12, marginTop: 20, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: `${COLORS.primary}14`, alignItems: 'center', justifyContent: 'center' },
  code: { fontSize: 26, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  name: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  rows: { width: '100%', marginTop: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  k: { color: COLORS.grey, fontWeight: '700' },
  v: { color: COLORS.text, fontWeight: '800', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  btn: { borderRadius: 12, marginTop: 14, alignSelf: 'stretch' },
});
