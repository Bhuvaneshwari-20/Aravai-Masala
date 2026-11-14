import React, { useRef, useState } from 'react';
import { View, Image, StyleSheet, Linking } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { ErrorBox } from './FormBits';
import { COLORS } from '../theme';

// Live camera -> preview -> Retake / Upload. Only a photo taken right now is accepted (no gallery picker).
// onUpload(photo) must return a promise; errors are shown by the parent through `error`.
export default function PhotoCapture({ onUpload, uploading, error, uploadLabel = 'Upload & Verify' }) {
  const [perm, request] = useCameraPermissions();
  const cam = useRef(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [localErr, setLocalErr] = useState('');

  const snap = async () => {
    if (!cam.current || !ready || taking) return;
    setTaking(true); setLocalErr('');
    try { setPhoto(await cam.current.takePictureAsync({ quality: 0.7 })); } catch (e) { setLocalErr('Could not take the photo. Please try again.'); }
    setTaking(false);
  };

  if (!perm) return <View style={s.box} />;
  if (!perm.granted) {
    return (
      <View style={[s.box, s.center]}>
        <MCI name="camera-off" size={44} color="#fff" />
        <Text style={s.msg}>Camera permission is needed to photograph the weighing machine display.</Text>
        <Button mode="contained" buttonColor={COLORS.accent} textColor="#2B1B14" onPress={perm.canAskAgain ? request : () => Linking.openSettings()}>
          {perm.canAskAgain ? 'Allow camera' : 'Open settings'}
        </Button>
      </View>
    );
  }

  if (photo) {
    return (
      <View>
        <View style={s.box}><Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /></View>
        <Text style={s.help}>Check that every digit on the display is sharp and readable.</Text>
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
        <View style={s.guide} pointerEvents="none"><Text style={s.guideText}>Fit the weight display inside this box</Text></View>
      </View>
      <Text style={s.help}>Hold steady, avoid glare, and keep the whole display in view.</Text>
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
