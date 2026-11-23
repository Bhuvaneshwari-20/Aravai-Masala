import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Linking, Platform } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { ErrorBox } from './FormBits';
import { COLORS } from '../theme';

// Browsers only give the live camera to https:// pages (or localhost). The app is opened over http://<PC-IP>:8081 on the LAN, so there
// the live preview can never be allowed. Then the phone's own camera app is opened instead (<input capture>, works on http too).
const insecureWeb = Platform.OS === 'web' && typeof window !== 'undefined' && window.isSecureContext === false;

// Live camera -> preview -> Retake / Upload. Only a photo taken right now is accepted (no gallery picker).
// onUpload(photo) must return a promise; errors are shown by the parent through `error`.
// autoSubmit: onUpload runs as soon as the photo is taken (no extra tap); Retake / the upload button stay available if it fails.
export default function PhotoCapture({ onUpload, uploading, error, uploadLabel = 'Upload & Verify', autoSubmit = false, guideText = 'Keep the whole weight display in view', helpText = 'Hold steady, avoid glare, and keep the whole weight display in view.', reviewText = 'Check that every digit and the decimal point are sharp and readable.' }) {
  const [perm, request] = useCameraPermissions();
  const cam = useRef(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [localErr, setLocalErr] = useState('');
  const live = useRef(true); // with autoSubmit the parent closes this camera as soon as the photo is taken
  useEffect(() => () => { live.current = false; }, []);

  const accept = (p) => {
    if (live.current) setPhoto(p);
    if (autoSubmit && onUpload) Promise.resolve(onUpload(p)).catch(() => {}); // errors are shown by the parent
  };

  const snap = async () => {
    if (!cam.current || !ready || taking) return;
    setTaking(true); setLocalErr('');
    try {
      // quality: 1 = no extra JPEG compression, the display digits must stay sharp for the OCR.
      // skipProcessing stays false on purpose: expo-camera then bakes the device rotation into the pixels (correct orientation).
      // Nothing is resized or cropped here - the file is the full-size picture the camera produced.
      const p = await cam.current.takePictureAsync({ quality: 1, skipProcessing: false, exif: false, base64: false });
      if (!p || !p.uri) throw new Error('no photo');
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[PhotoCapture] captured', p.width + 'x' + p.height, p.uri); // eslint-disable-line no-console
      accept(p);
    } catch (e) { if (live.current) setLocalErr('Could not take the photo. Please try again.'); }
    if (live.current) setTaking(false);
  };

  // phone camera app (native camera screen on a phone, <input capture> on the web) -> same preview / upload step below
  const openPhoneCamera = async () => {
    setLocalErr('');
    try {
      const ImagePicker = require('expo-image-picker'); // eslint-disable-line global-require
      // quality 1 + allowsEditing false: no compression and no crop/edit screen. The picker already returns an upright image.
      const r = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false, exif: false, base64: false });
      if (!r.canceled && r.assets && r.assets.length) {
        const a = r.assets[0];
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[PhotoCapture] picked', a.width + 'x' + a.height, a.uri); // eslint-disable-line no-console
        accept({ uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType });
      }
    } catch (e) { setLocalErr('Could not open the camera. Please allow camera access in the browser / phone settings.'); }
  };

  if (!photo && insecureWeb) {
    return (
      <View>
        <View style={[s.box, s.center]}>
          <MCI name="camera" size={44} color="#fff" />
          <Text style={s.msg}>Tap below to open your phone camera and photograph the weighing machine weight display.</Text>
          <Button mode="contained" icon="camera" buttonColor={COLORS.accent} textColor="#2B1B14" onPress={openPhoneCamera}>Open camera</Button>
        </View>
        <ErrorBox text={localErr} />
      </View>
    );
  }

  if (!perm && !photo) return <View style={s.box} />;
  if (perm && !perm.granted && !photo) {
    return (
      <View>
        <View style={[s.box, s.center]}>
          <MCI name="camera-off" size={44} color="#fff" />
          <Text style={s.msg}>Camera permission is needed to photograph the weighing machine.</Text>
          <Button mode="contained" buttonColor={COLORS.accent} textColor="#2B1B14" onPress={perm.canAskAgain ? request : () => Linking.openSettings()}>
            {perm.canAskAgain ? 'Allow camera' : 'Open settings'}
          </Button>
          <Button compact icon="camera" textColor="#fff" style={{ marginTop: 8 }} onPress={openPhoneCamera}>Use phone camera app instead</Button>
        </View>
        <ErrorBox text={localErr} />
      </View>
    );
  }

  if (photo) {
    return (
      <View>
        <View style={s.box}><Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /></View>
        <Text style={s.help}>{reviewText}</Text>
        <ErrorBox text={error || localErr} />
        <View style={s.row}>
          <Button mode="outlined" icon="camera-retake" textColor={COLORS.text} style={s.btn} disabled={uploading}
            onPress={() => { setPhoto(null); setLocalErr(''); }}>Retake</Button>
          <Button mode="contained" icon="cloud-upload" buttonColor={COLORS.green} style={s.btn} loading={uploading} disabled={uploading}
            onPress={() => onUpload(photo)}>{uploadLabel}</Button>
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={s.box}>
        <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
        <View style={s.guide} pointerEvents="none"><Text style={s.guideText}>{guideText}</Text></View>
      </View>
      <Text style={s.help}>{helpText}</Text>
      <ErrorBox text={localErr} />
      <View style={s.row}>
        <Button mode="contained" icon="camera" buttonColor={COLORS.primary} style={[s.btn, { flex: 1 }]} contentStyle={{ paddingVertical: 6 }}
          loading={taking} disabled={!ready || taking} onPress={snap}>Take Photo</Button>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: '100%', aspectRatio: 4 / 3, maxHeight: 460, backgroundColor: '#1d1210', borderRadius: 18, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { color: '#fff', textAlign: 'center', fontWeight: '700', marginVertical: 14 },
  guide: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guideText: { position: 'absolute', bottom: 12, color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  help: { color: COLORS.grey, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  row: { flexDirection: 'row', marginTop: 14 },
  btn: { flex: 1, borderRadius: 12, marginHorizontal: 4, borderColor: COLORS.border },
});