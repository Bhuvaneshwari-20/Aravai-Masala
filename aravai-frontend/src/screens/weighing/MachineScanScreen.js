import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import Container from '../../components/Container';
import QrScanner from '../../components/QrScanner';
import { ErrorBox } from '../../components/FormBits';
import { MACHINE_TYPES, MACHINE_STATUS } from '../../components/MachineFormModal';
import { newRequestId } from '../../weighing';
import { parseMachineScan } from '../../machineCode';
import { COLORS } from '../../theme';

const label = (list, v) => (list.find((x) => x.value === v) || {}).label || v;
const Row = ({ k, v }) => (
  <View style={s.row}><Text style={s.k}>{k}</Text><Text style={s.v}>{v || '-'}</Text></View>
);

// Scan the machine QR code (link <APP_URL>/m/<qr_token>). Previously printed Code 128 labels (plain machine code, e.g. MCH005) still work.
//  - Weighing flow (default): Step 1 scan, Step 2 "Is this your machine?".
//  - route.params.mode === 'view': scan, then open the machine details screen ('MachineQr').
export default function MachineScanScreen({ navigation, route }) {
  const { user } = useAuth();
  const viewOnly = route?.params?.mode === 'view';
  const [phase, setPhase] = useState('scan'); // scan | loading | confirm
  const [machine, setMachine] = useState(null);
  const [qr, setQr] = useState('');           // the machine code sent on with the weighing transaction
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);                 // one scan at a time: the camera fires many events per second
  const lastBad = useRef({ v: '', t: 0 });    // the same wrong barcode is ignored for 3 s (no error flicker, no API spam)
  const timer = useRef(null);
  const reqId = useRef(newRequestId());       // same id on a double tap => only one transaction

  const unlockSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { lock.current = false; }, 1500); };

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    lock.current = false; lastBad.current = { v: '', t: 0 }; reqId.current = newRequestId();
    setMachine(null); setQr(''); setErr(''); setBusy(false); setPhase('scan');
  }, []);
  useFocusEffect(useCallback(() => { reset(); }, [reset])); // fresh scanner every time this screen is shown
  useEffect(() => () => clearTimeout(timer.current), []);

  const onScanned = async (data) => {
    const raw = String(data ?? '').trim();
    if (!raw || lock.current) return;
    const parsed = parseMachineScan(raw);       // { kind:'qr', id:<qr_token> } | { kind:'code', id:'MCH005' } | null
    const code = parsed ? parsed.id : null;
    const key = code || raw;
    if (key === lastBad.current.v && Date.now() - lastBad.current.t < 3000) return;
    lock.current = true; setErr('');

    if (!code) { // e.g. a product barcode: no API call
      lastBad.current = { v: key, t: Date.now() };
      setErr('This is not an Aravai machine QR code. Scan the QR sticker on the machine.');
      unlockSoon();
      return;
    }

    setPhase('loading');
    try {
      if (viewOnly) {
        const r = await api.get(`/machines/by-token/${encodeURIComponent(code)}`);
        const m = r.data.data;
        navigation.navigate('MachineQr', { token: m.machine_code, machine: m });
        return; // stay locked + "loading" while the details open; reset() runs when this screen is focused again
      }
      // same call as before: the weighing service accepts the permanent qr_token (new QR) or the machine code (old Code 128)
      const r = await api.post('/weighing/scan', { qr_value: code });
      const { machine: m, block_reason: reason } = r.data.data;
      setMachine({ ...m, block_reason: reason }); setQr(code); setPhase('confirm');
    } catch (e) {
      lastBad.current = { v: key, t: Date.now() };
      setErr(e.response?.status === 404 ? 'This QR code is not registered to any machine.' : errMsg(e)); setPhase('scan');
      unlockSoon();
    }
  };

  // Server decides too; this only gives the operator a clear message before they tap Yes.
  const blockReason = !machine ? '' : machine.block_reason
    || (!machine.operator_id ? 'No operator is assigned to this machine.' : '')
    || (machine.operator_id !== user.id ? `This machine is assigned to ${machine.operator_name}, not to you.` : '');

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api.post('/weighing/transactions', { qr_value: qr, client_request_id: reqId.current });
      navigation.replace('WeighingScanTxn', { id: r.data.data.id });
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Container maxWidth={640}>
        <View style={s.head}>
          <View style={s.headIcon}><MCI name="qrcode-scan" size={22} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Scan Machine</Text>
            <Text style={s.sub}>
              {viewOnly ? 'Scan the QR code on the machine'
                : phase === 'confirm' ? 'Step 2 of 4  •  Confirm machine' : 'Step 1 of 4  •  Scan the QR code on the machine'}
            </Text>
          </View>
        </View>

        {phase !== 'confirm' && (
          <View style={{ marginHorizontal: 12 }}>
            <QrScanner onScanned={onScanned} active={phase === 'scan'} />
            {phase === 'loading' && (
              <View style={s.loading}><ActivityIndicator color={COLORS.primary} /><Text style={s.loadText}>{viewOnly ? 'Finding machine...' : 'Checking machine...'}</Text></View>)}
            <ErrorBox text={err} />
          </View>
        )}

        {phase === 'confirm' && !!machine && (
          <View style={s.card}>
            <View style={s.avatar}><MCI name="cog" size={30} color={COLORS.primary} /></View>
            <Text style={s.code}>{machine.machine_code}</Text>
            <Text style={s.name}>{machine.machine_name}</Text>
            <View style={s.rows}>
              <Row k="Machine type" v={label(MACHINE_TYPES, machine.machine_type)} />
              <Row k="Assigned operator" v={machine.operator_name} />
              <Row k="Machine status" v={label(MACHINE_STATUS, machine.status)} />
            </View>

            {blockReason ? (
              <>
                <ErrorBox text={blockReason} />
                <Button mode="contained" icon="qrcode-scan" buttonColor={COLORS.primary} style={s.btnFull} onPress={reset}>Scan another machine</Button>
              </>
            ) : (
              <>
                <Text style={s.ask}>Is this your machine?</Text>
                <ErrorBox text={err} />
                <View style={{ flexDirection: 'row', marginTop: 14 }}>
                  <Button mode="outlined" icon="close" textColor={COLORS.text} style={[s.btn, { borderColor: COLORS.border }]} disabled={busy} onPress={reset}>No</Button>
                  <Button mode="contained" icon="check" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy} onPress={confirm}>Yes, continue</Button>
                </View>
              </>
            )}
          </View>
        )}
      </Container>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 18 },
  headIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 12.5, color: COLORS.grey, fontWeight: '600', marginTop: 1 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  loadText: { marginLeft: 8, color: COLORS.grey, fontWeight: '700' },
  card: { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: `${COLORS.primary}14`, alignItems: 'center', justifyContent: 'center' },
  code: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  name: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  rows: { width: '100%', marginTop: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  k: { color: COLORS.grey, fontWeight: '700' },
  v: { color: COLORS.text, fontWeight: '800', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  ask: { fontSize: 20, fontWeight: '900', color: COLORS.text, marginTop: 20 },
  btn: { flex: 1, borderRadius: 12, marginHorizontal: 5 },
  btnFull: { borderRadius: 12, marginTop: 14, alignSelf: 'stretch' },
});
