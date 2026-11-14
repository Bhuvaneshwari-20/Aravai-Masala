import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { errMsg } from '../api';
import PhotoCapture from './PhotoCapture';
import FormField from './FormField';
import { ErrorBox, InfoBox, Label } from './FormBits';
import { bwStatus, bwPassed, uploadWeightImage, manualVerifyWeightImage, pickWeightImage } from '../batchWeightImage';
import { fmtW } from '../weighing';
import { COLORS } from '../theme';

// Photo check of the weighing machine display for one batching entry.
//   capture (camera) or upload (gallery / file)  ->  server reads the weight  ->  compared with the entered weight.
// Reports { imageId, passed } to the parent through onChange. Entered weight changed after the check => result is stale (not passed).
// uploadOnly: no camera button, the operator only uploads an existing image (New Batch form)
export default function WeightImageVerify({ batchId, materialId, enteredWeight, required, canManual, error, onChange, uploadOnly = false }) {
  const [mode, setMode] = useState('idle'); // idle | camera | picked
  const [photo, setPhoto] = useState(null);     // { uri } waiting to be verified
  const [lastUri, setLastUri] = useState(null); // last photo sent, so a corrected weight can be checked against the same photo
  const [result, setResult] = useState(null);   // server answer
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const entered = Number(enteredWeight) || 0;
  const stale = !!result && Math.abs(Number(result.entered_weight) - entered) > 0.0000001;
  const current = result && !stale ? result : null;
  const passed = !!current && bwPassed(current.status);

  useEffect(() => { onChange && onChange({ imageId: current ? current.id : null, passed, status: current ? current.status : null }); }, [current && current.id, current && current.status, passed]); // eslint-disable-line

  const verify = async (uri) => {
    if (busy) return;
    if (!(entered > 0)) { setErr('Enter the weighed quantity first, then verify it with the photo.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await uploadWeightImage(batchId, { uri, materialId, enteredWeight: entered });
      if (!live.current) return;
      setResult(r); setLastUri(uri); setPhoto(null); setMode('idle'); setReason(''); setReasonErr('');
    } catch (e) { if (live.current) setErr(errMsg(e)); }
    if (live.current) setBusy(false);
  };

  const upload = async () => {
    setErr('');
    try {
      const p = await pickWeightImage();
      if (p) { setPhoto(p); setMode('picked'); }
    } catch (e) { setErr('Could not open the image picker.'); }
  };

  const manual = async () => {
    if (busy) return;
    if (reason.trim().length < 5) { setReasonErr('Give a reason (at least 5 characters)'); return; }
    setReasonErr(''); setBusy(true); setErr('');
    try {
      const r = await manualVerifyWeightImage(batchId, result.id, reason.trim());
      if (live.current) setResult((p) => ({ ...p, ...r }));
    } catch (e) { if (live.current) setErr(errMsg(e)); }
    if (live.current) setBusy(false);
  };

  const reset = () => { setResult(null); setPhoto(null); setMode('idle'); setErr(''); };

  const st = current ? bwStatus(current.status) : null;
  const note = !current ? '' : {
    MATCH: 'The weight on the machine display is the same as the weight you entered.',
    MANUAL: `Verified manually${current.manual_reason ? `: ${current.manual_reason}` : '.'}`,
    MISMATCH: `The machine display shows ${fmtW(current.detected_weight)} but you entered ${fmtW(current.entered_weight)}. Saving is blocked. Check the weight you entered, or weigh again and take a new photo.`,
    UNREADABLE: 'The weight could not be read from the photo. Retake a clearer photo (hold steady, avoid glare, whole display in view) or ask for manual verification.',
  }[current.status];

  return (
    <View style={s.box}>
      <Label style={{ marginBottom: 6 }}>{`WEIGHING MACHINE PHOTO${required ? ' *' : ' (OPTIONAL)'}`}</Label>

      {!!current && (
        <View>
          <View style={[s.badge, { backgroundColor: st.bg }]}>
            <MCI name={passed ? 'check-circle' : 'alert-circle'} size={18} color={st.color} />
            <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
          </View>
          <Text style={s.note}>{note}</Text>
          {!!lastUri && <View style={s.thumb}><Image source={{ uri: lastUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /></View>}
          <View style={s.cmpRow}>
            <View style={s.cmp}><Text style={s.cmpK}>Entered</Text><Text style={s.cmpV}>{fmtW(current.entered_weight)}</Text></View>
            <View style={s.cmp}><Text style={s.cmpK}>Machine display</Text><Text style={[s.cmpV, current.status === 'MISMATCH' && { color: COLORS.danger }]}>{current.detected_weight == null ? 'Not read' : fmtW(current.detected_weight)}</Text></View>
          </View>

          {current.status === 'UNREADABLE' && (canManual ? (
            <View style={s.manual}>
              <Text style={s.manualTitle}>MANUAL VERIFICATION</Text>
              <Text style={s.help}>Look at the photo yourself. Only verify if the display really shows {fmtW(current.entered_weight)}. Your name and reason are saved.</Text>
              <FormField label="Reason *" value={reason} onChangeText={setReason} error={reasonErr} maxLength={255} />
              <Button mode="contained" icon="shield-check" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy} onPress={manual}>Verify manually</Button>
            </View>
          ) : <InfoBox text="Manual verification needs a supervisor with batching approval rights. Ask them, or retake a clearer photo." />)}

          {!passed && <Button mode="outlined" icon="camera-retake" textColor={COLORS.text} style={[s.btn, { borderColor: COLORS.border }]} disabled={busy} onPress={reset}>Retake / change photo</Button>}
          {passed && <Button compact icon="camera-retake" textColor={COLORS.grey} disabled={busy} onPress={reset}>Use a different photo</Button>}
        </View>
      )}

      {!current && mode === 'camera' && (
        <View>
          <PhotoCapture onUpload={(p) => verify(p.uri)} uploading={busy} error={err} uploadLabel="Verify weight" />
          {!busy && <Button compact textColor={COLORS.grey} onPress={() => { setMode('idle'); setErr(''); }}>Cancel</Button>}
        </View>
      )}

      {!current && mode === 'picked' && !!photo && (
        <View>
          <View style={s.preview}><Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /></View>
          <Text style={s.help}>Check that every digit on the display is sharp and readable.</Text>
          <ErrorBox text={err} />
          <View style={s.row}>
            <Button mode="outlined" icon="image-edit" textColor={COLORS.text} style={[s.half, { borderColor: COLORS.border }]} disabled={busy} onPress={upload}>Change</Button>
            <Button mode="contained" icon="shield-check" buttonColor={COLORS.green} style={s.half} loading={busy} disabled={busy} onPress={() => verify(photo.uri)}>Verify weight</Button>
          </View>
        </View>
      )}

      {!current && mode === 'idle' && (
        <View>
          {stale && <InfoBox text="The weighed quantity changed after the photo was checked. Verify it again." />}
          <Text style={s.help}>{uploadOnly ? 'Upload an image of the weighing machine display. The weight on it is read and compared with the weighed quantity.' : 'Take a photo of the weighing machine display, or upload one. The weight on it is read and compared with the weighed quantity.'}</Text>
          <View style={s.row}>
            {!uploadOnly && <Button mode="contained" icon="camera" buttonColor={COLORS.primary} style={s.half} disabled={busy} onPress={() => { setErr(''); setMode('camera'); }}>Take photo</Button>}
            <Button mode={uploadOnly ? 'contained' : 'outlined'} icon="upload" buttonColor={uploadOnly ? COLORS.primary : undefined} textColor={uploadOnly ? undefined : COLORS.text}
              style={[s.half, !uploadOnly && { borderColor: COLORS.border }]} disabled={busy} onPress={upload}>Upload image</Button>
          </View>
          {!!lastUri && entered > 0 && (
            <Button mode="outlined" icon="refresh" textColor={COLORS.primary} style={[s.btn, { borderColor: COLORS.primary }]} loading={busy} disabled={busy} onPress={() => verify(lastUri)}>Verify again with the same photo</Button>)}
          <ErrorBox text={err} />
        </View>
      )}

      <ErrorBox text={error} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: COLORS.bg, borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  help: { color: COLORS.grey, fontWeight: '600', marginTop: 4, marginBottom: 8, fontSize: 13 },
  row: { flexDirection: 'row' },
  half: { flex: 1, borderRadius: 12, marginHorizontal: 4 },
  btn: { borderRadius: 12, marginTop: 10 },
  preview: { width: '100%', aspectRatio: 4 / 3, maxHeight: 360, backgroundColor: '#1d1210', borderRadius: 14, overflow: 'hidden' },
  thumb: { width: '100%', height: 180, backgroundColor: '#1d1210', borderRadius: 12, overflow: 'hidden', marginTop: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: 10 },
  badgeText: { fontWeight: '900', fontSize: 16, marginLeft: 8, letterSpacing: 0.5 },
  note: { color: COLORS.text, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  cmpRow: { flexDirection: 'row', marginTop: 10 },
  cmp: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 10, marginHorizontal: 4 },
  cmpK: { color: COLORS.grey, fontWeight: '700', fontSize: 12 },
  cmpV: { color: COLORS.text, fontWeight: '900', fontSize: 16, marginTop: 3 },
  manual: { marginTop: 12, backgroundColor: '#fff', borderRadius: 12, padding: 10 },
  manualTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey },
});
