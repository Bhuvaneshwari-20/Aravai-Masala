import React, { useRef, useState } from 'react';
import { View, StyleSheet, Linking, TextInput } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Live scanner (rear camera). Reads the machine QR code (new labels) and Code 128 (previously printed labels).
// onScanned(text) fires for a code the camera reads; the same code seen again within 3 s is dropped here
// (the camera reports a steady code many times a second), and the screen adds its own lock on top.
// If the camera is not allowed (or not available, e.g. a browser over http), the code can be typed instead.
function ManualEntry({ onSubmit, dark }) {
  const [v, setV] = useState('');
  const go = () => { const t = v.trim(); if (t) { onSubmit(t); setV(''); } };
  return (
    <View style={[s.manualRow, !dark && s.manualLight]}>
      <TextInput value={v} onChangeText={setV} placeholder="Or type the machine code (e.g. MCH005)" placeholderTextColor="#aaa"
        autoCapitalize="characters" autoCorrect={false} style={s.input} onSubmitEditing={go} returnKeyType="go" />
      <Button mode="contained" buttonColor={COLORS.green} style={s.goBtn} disabled={!v.trim()} onPress={go}>Go</Button>
    </View>
  );
}

export default function QrScanner({ onScanned, active = true }) {
  const [perm, request] = useCameraPermissions();
  const focused = useIsFocused(); // camera is switched off while another screen (machine details) is on top
  const [torch, setTorch] = useState(false);
  const last = useRef({ v: '', t: 0 });
  const SAME_MS = 3000;

  const onCode = ({ data, type }) => {
    const text = String(data ?? '').trim();
    if (!text) return;
    const now = Date.now();
    if (text === last.current.v && now - last.current.t < SAME_MS) return;
    last.current = { v: text, t: now };
    onScanned(text, type);
  };

  if (!perm || !focused) return <View style={s.box} />;

  if (!perm.granted) {
    return (
      <View style={[s.box, s.center]}>
        <MCI name="camera-off" size={44} color="#fff" />
        <Text style={s.msg}>Camera permission is needed to scan the machine QR code.</Text>
        {perm.canAskAgain
          ? <Button mode="contained" buttonColor={COLORS.accent} textColor="#2B1B14" onPress={request}>Allow camera</Button>
          : <Button mode="contained" buttonColor={COLORS.accent} textColor="#2B1B14" onPress={() => Linking.openSettings()}>Open settings</Button>}
        <ManualEntry onSubmit={(t) => onScanned(t)} dark />
      </View>
    );
  }

  return (
    <View>
      <View style={s.box}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128'] }}
          onBarcodeScanned={active ? onCode : undefined} />
        <View style={s.frameWrap} pointerEvents="none">
          <View style={s.frame}>
            <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} /><View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
          </View>
          <Text style={s.hint}>Hold the phone 15-25 cm away, QR code inside the square</Text>
        </View>
        <IconButton icon={torch ? 'flashlight' : 'flashlight-off'} iconColor="#fff" size={24} style={s.torch} onPress={() => setTorch((t) => !t)} accessibilityLabel="Toggle flashlight" />
      </View>
      <ManualEntry onSubmit={(t) => onScanned(t)} />
    </View>
  );
}

const C = 26;
const corner = { position: 'absolute', width: C, height: C, borderColor: COLORS.accent };
const s = StyleSheet.create({
  box: { width: '100%', aspectRatio: 3 / 4, maxHeight: 520, backgroundColor: '#1d1210', borderRadius: 22, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { color: '#fff', textAlign: 'center', fontWeight: '700', marginVertical: 14 },
  manualRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 18 },
  manualLight: { marginTop: 12 },
  input: { flex: 1, height: 44, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border },
  goBtn: { marginLeft: 8, borderRadius: 10 },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '68%', aspectRatio: 1 }, // square: matches a QR code (old Code 128 labels are still read anywhere in the picture)
  corner,
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  hint: { position: 'absolute', bottom: 18, color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden', textAlign: 'center' },
  torch: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
});
