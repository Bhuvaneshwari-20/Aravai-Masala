import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import ModalShell from './ModalShell';
import { ErrorBox } from './FormBits';
import QrCode from './QrCode';
import { fetchMachineQr, checkQrUrl } from '../machineQr';
import { machineQrHtml, STICKER_MM, moduleMm } from '../machineQrPrint';
import { COLORS } from '../theme';

const PREVIEW_PX = 160; // on-screen preview: 160 x 160 px (4-module quiet zone included, never stretched)

// Machine QR: shows the machine's PERMANENT qr_url (from the backend qrInfo API - nothing is generated here)
// + Print / Download PDF of a 30 x 30 mm sticker. Read with the phone camera or the app (Machines -> Scan Machine).
export default function MachineQrModal({ visible, machine, onDismiss }) {
  const { width } = useWindowDimensions();
  const [qr, setQr] = useState(null);        // { token, url }
  const [loadErr, setLoadErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const modalWidth = Math.min(width - 16, 520);
  const id = machine ? machine.id : null;

  const load = useCallback(async () => {
    setQr(null); setLoadErr(''); setErr('');
    if (!machine) return;
    try { setQr(await fetchMachineQr(machine)); } catch (e) { setLoadErr(e.message); }
  }, [machine]);
  useEffect(() => { if (visible && machine) load(); }, [visible, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useMemo(() => (qr ? checkQrUrl(qr.url) : null), [qr]);
  const ready = !!(machine && qr && check && check.ok);
  const mm = ready ? moduleMm(qr.url) : 0;

  const run = (kind) => async () => {
    setBusy(kind); setErr('');
    try {
      if (!ready) throw new Error('QR is not ready yet');
      const html = machineQrHtml(machine, qr.url);
      if (kind === 'print') await Print.printAsync({ html });
      else {
        const f = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4 portrait in points (1/72 in)
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: 'application/pdf', dialogTitle: `${machine.machine_code} QR` });
      }
    } catch (e) { if (!/cancel/i.test(e.message || '')) setErr(e.message || 'Could not complete this action'); }
    setBusy('');
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="qrcode" maxWidth={modalWidth}
      title={machine ? machine.machine_code : 'Machine QR'} subtitle={machine ? machine.machine_name : ''}>
      <View style={{ alignItems: 'center' }}>
        {!!machine && !qr && !loadErr && <ActivityIndicator style={{ margin: 30 }} color={COLORS.primary} />}
        {ready && (
          <View style={s.qrBox}>
            <QrCode value={qr.url} size={PREVIEW_PX} />
            <Text style={s.codeText}>{machine.machine_code}</Text>
          </View>
        )}
        {ready && <Text style={s.note}>One permanent QR per machine. Prints at exactly {STICKER_MM} x {STICKER_MM} mm (module {mm.toFixed(2)} mm). Print at 100%, stick it flat on the machine, then scan it with the phone camera.</Text>}
        {ready && !!check.warn && <Text style={s.warn}>{check.warn}</Text>}
        <ErrorBox text={loadErr || (check && !check.ok ? check.error : '') || err} />
        {!!loadErr && <Button mode="outlined" textColor={COLORS.text} style={s.btn} onPress={load}>Retry</Button>}
        {ready && (
          <View style={s.row}>
            <Button mode="contained" icon="printer" buttonColor={COLORS.green} style={s.btn} loading={busy === 'print'} disabled={!!busy} onPress={run('print')}>Print</Button>
            {Platform.OS !== 'web' && (
              <Button mode="outlined" icon="download" textColor={COLORS.text} style={s.btn} loading={busy === 'file'} disabled={!!busy} onPress={run('file')}>Download PDF</Button>)}
          </View>
        )}
      </View>
    </ModalShell>
  );
}

const s = StyleSheet.create({
  qrBox: { padding: 14, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  codeText: { textAlign: 'center', fontWeight: '800', letterSpacing: 3, color: COLORS.text, marginTop: 6 },
  note: { color: COLORS.grey, textAlign: 'center', fontWeight: '600', marginTop: 12 },
  warn: { color: COLORS.warn, textAlign: 'center', fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', marginTop: 16, marginBottom: 6 },
  btn: { borderRadius: 12, marginHorizontal: 5, marginTop: 8, borderColor: COLORS.border },
});
