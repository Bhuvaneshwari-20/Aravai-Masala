import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import PhotoCapture from './PhotoCapture';
import FormField from './FormField';
import { ErrorBox, InfoBox, Label } from './FormBits';
import {
  bwStatus, bwPassed, uploadWeightImage, manualVerifyWeightImage, pickWeightImage, weightImageErrMsg,
} from '../batchWeightImage';
import { fmtW } from '../weighing';
import { COLORS } from '../theme';

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

// Photo check of the weighing machine display for one batching entry.
//   capture (camera) or upload (gallery / file)  ->  server reads Machine ID, Machine name and weight  ->  machine + weight are checked.
// Reports { imageId, passed, status, stale, machineStatus } to the parent through onChange.
//   passed = weight check passed AND the machine on the photo is not a different machine.
//   Entered weight changed after the check => result is stale (not passed).
// uploadOnly: no camera button, the operator only uploads an existing image
// cameraOnly: no upload button, only a live photo taken right now with the camera is accepted (not used by the New Batch form any more)
// autoFill: the weight on the photo is read and sent to the parent through onDetected(kg) (fills "Weighed Qty"); nothing has to be typed first.
//           The photo is read as soon as it is taken / chosen.
// expectedMachine: { id, code, name, qrValue } the machine this weighing must be done on. Compared with the machine on the photo.
// blockedReason: text -> the photo buttons are disabled and this message is shown (e.g. "select the machine first").
export default function WeightImageVerify({ batchId, materialId, enteredWeight, required, canManual, error, onChange, onDetected, autoFill = false, uploadOnly = false, cameraOnly = false, expectedMachine = null, blockedReason = '' }) {
  const [mode, setMode] = useState('idle');   // idle | camera
  const [pending, setPending] = useState(null); // { uri } chosen, but not sent yet (compare mode and no weight typed yet)
  const [previewUri, setPreviewUri] = useState(null); // photo shown on screen (the one being read / last read), kept after a failed read
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
  // Weight-only verification: the photo is checked only for its displayed weight.
  const weightOk = !!current && bwPassed(current.status);
  const passed = weightOk;

  useEffect(() => { onChange && onChange({ imageId: current ? current.id : null, passed, status: current ? current.status : null, stale, machineStatus: 'NOT_CHECKED' }); }, [current && current.id, current && current.status, passed, stale]); // eslint-disable-line

  // compare = true: check the photo against the typed weighed quantity (old behaviour, also used by "Verify again with the same photo")
  const verify = async (uri, compare = false) => {
    if (busy) return;
    const auto = autoFill && !compare;
    if (!auto && !(entered > 0)) { setPending({ uri }); setPreviewUri(uri); setErr('Enter the weighed quantity first, then verify it with the photo.'); return; }
    setBusy(true); setErr(''); setPreviewUri(uri); setPending(null);
    try {
      const r = await uploadWeightImage(batchId, { uri, materialId, enteredWeight: auto ? null : entered, machine: expectedMachine });
      if (!live.current) return;
      setReason(''); setReasonErr('');
      const detected = r.detected_weight === null || r.detected_weight === undefined || r.detected_weight === '' ? NaN : Number(r.detected_weight);
      const read = Number.isFinite(detected) && detected > 0 && r.status !== 'UNREADABLE';
      if (auto && !read) {
        // nothing could be read: do not fill anything. The operator retakes the photo, or types the weight and verifies it against this photo.
        setResult(null); setMode('idle');
        setErr('The weight could not be read from the photo. Retake a clearer photo (hold steady, avoid glare, whole display in view), or type the weighed quantity and tap "Verify again with the same photo".');
      } else {
        // auto mode: the weighed quantity IS the detected weight, so the result is not "stale" against it
        const res = auto ? { ...r, entered_weight: r3(detected) } : r;
        setResult(res); setMode('idle');
        // Weight-only verification: fill the detected weight without requiring machine ID / QR recognition.
        if (auto && onDetected) onDetected(r3(detected));
      }
    } catch (e) { if (live.current) setErr(weightImageErrMsg(e)); }
    if (live.current) setBusy(false);
  };

  const openCamera = () => {
    if (blockedReason) return;
    if (!autoFill && !(entered > 0)) { setErr('Enter the weighed quantity first, then take the photo.'); return; }
    setErr(''); setMode('camera');
  };

  // chosen from the gallery / file dialog: read at once (nothing to type first when autoFill, or when the weight is already typed)
  const upload = async () => {
    if (blockedReason) return;
    setErr('');
    try {
      const p = await pickWeightImage();
      if (p) verify(p.uri);
    } catch (e) { setErr('Could not open the image picker.'); }
  };

  const manual = async () => {
    if (busy) return;
    if (reason.trim().length < 5) { setReasonErr('Give a reason (at least 5 characters)'); return; }
    setReasonErr(''); setBusy(true); setErr('');
    try {
      const r = await manualVerifyWeightImage(batchId, result.id, reason.trim());
      if (live.current) setResult((p) => ({ ...p, ...r }));
    } catch (e) { if (live.current) setErr(weightImageErrMsg(e)); }
    if (live.current) setBusy(false);
  };

  const clearAll = () => { setResult(null); setPending(null); setPreviewUri(null); setMode('idle'); setErr(''); };

  const st = current ? bwStatus(current.status) : null;
  const detectedKg = current && current.detected_weight != null && current.detected_weight !== '' ? current.detected_weight : null;
  const headBadge = st;
  const note = !current ? '' : {
      MATCH: autoFill ? `Weight ${fmtW(detectedKg)} was read from the machine display and filled in as the Weighed Qty.` : 'The weight on the machine display is the same as the weight you entered.',
      MANUAL: `Verified manually${current.manual_reason ? `: ${current.manual_reason}` : '.'}`,
      MISMATCH: `The machine display shows ${fmtW(current.detected_weight)} but you entered ${fmtW(current.entered_weight)}. Saving is blocked. Check the weight you entered, or weigh again and take a new photo.`,
      UNREADABLE: 'The weight could not be read from the photo. Retake a clearer photo (hold steady, avoid glare, whole display in view) or ask for manual verification.',
    }[current.status];

  const busyText = autoFill ? 'Reading weight from the display…' : 'Checking the weight on the photo…';
  const hasImage = !!previewUri;
  const canAct = !busy && !blockedReason;

  const Tile = ({ k, v, bad, ok }) => (
    <View style={s.tile}>
      <Text style={s.cmpK}>{k}</Text>
      <Text style={[s.cmpV, bad && { color: COLORS.danger }, ok && { color: COLORS.ok }]} numberOfLines={2}>{v}</Text>
    </View>
  );
  const Pill = ({ k, label, color, bg, icon }) => (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <MCI name={icon} size={15} color={color} />
      <Text style={[s.pillText, { color }]}>{`${k}: ${label}`}</Text>
    </View>
  );

  return (
    <View style={s.box}>
      <Label style={{ marginBottom: 6 }}>{`WEIGHING MACHINE PHOTO${required ? ' *' : ' (OPTIONAL)'}`}</Label>

      {!!blockedReason && <InfoBox text={blockedReason} />}

      {/* the photo: always visible once chosen, with a loading layer while it is being read */}
      {hasImage && mode !== 'camera' && (
        <View style={s.thumb}>
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {busy && (
            <View style={s.overlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={s.overlayText}>{busyText}</Text>
            </View>
          )}
        </View>
      )}

      {!!current && (
        <View style={{ marginTop: 10 }}>
          <View style={[s.badge, { backgroundColor: headBadge.bg }]}>
            <MCI name={passed ? 'check-circle' : 'alert-circle'} size={18} color={headBadge.color} />
            <Text style={[s.badgeText, { color: headBadge.color }]}>{autoFill && current.status === 'MATCH' ? 'READ SUCCESSFULLY' : headBadge.label}</Text>
          </View>
          <Text style={s.note}>{note}</Text>

          <View style={s.pills}>
            <Pill k="Weight" label={autoFill && current.status === 'MATCH' ? 'READ' : st.label} color={st.color} bg={st.bg} icon={bwPassed(current.status) ? 'check-circle' : 'alert-circle'} />
          </View>

          <View style={s.grid}>
            <Tile k="Weight" v={detectedKg == null ? 'Not read' : fmtW(detectedKg)} bad={current.status === 'MISMATCH'} />
            {!autoFill && <Tile k="Entered" v={fmtW(current.entered_weight)} />}
          </View>


          {current.status === 'UNREADABLE' && (canManual ? (
            <View style={s.manual}>
              <Text style={s.manualTitle}>MANUAL VERIFICATION</Text>
              <Text style={s.help}>Look at the photo yourself. Only verify if the display really shows {fmtW(current.entered_weight)}. Your name and reason are saved.</Text>
              <FormField label="Reason *" value={reason} onChangeText={setReason} error={reasonErr} maxLength={255} />
              <Button mode="contained" icon="shield-check" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy} onPress={manual}>Verify manually</Button>
            </View>
          ) : <InfoBox text="Manual verification needs a supervisor with batching approval rights. Ask them, or retake a clearer photo." />)}
        </View>
      )}

      {/* the photo was not read: say why, keep the photo on screen */}
      {!current && stale && mode === 'idle' && <InfoBox text="The weighed quantity changed after the photo was checked. Verify it again." />}
      {!current && !!pending && mode === 'idle' && (
        <View>
          <Text style={s.help}>Check that every digit on the display is sharp and readable.</Text>
          <Button mode="contained" icon="shield-check" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy || !(entered > 0)} onPress={() => verify(pending.uri)}>Verify weight</Button>
        </View>
      )}

      {mode === 'camera' && (
        <View>
          <PhotoCapture onUpload={(p) => verify(p.uri)} uploading={busy} error={err} autoSubmit uploadLabel={autoFill ? 'Read weight' : 'Verify weight'} />
          {!busy && <Button compact textColor={COLORS.grey} onPress={() => { setMode('idle'); setErr(''); }}>Cancel</Button>}
        </View>
      )}

      {mode === 'idle' && (
        <View>
          {!hasImage && !busy && (
            <Text style={s.help}>{autoFill ? 'Take a photo of the weighing machine display, or upload one. Only the displayed weight is read and filled in as the Weighed Qty. QR scanning is not required.' : uploadOnly ? 'Upload an image of the weighing machine display. The weight on it is read and compared with the weighed quantity.' : cameraOnly ? 'Take a live photo of the weighing machine display. The weight on it is read and compared with the weighed quantity.' : 'Take a photo of the weighing machine display, or upload one. The weight on it is read and compared with the weighed quantity.'}</Text>
          )}
          <View style={[s.row, { marginTop: hasImage ? 10 : 0 }]}>
            {!uploadOnly && <Button mode={hasImage ? 'outlined' : 'contained'} icon={hasImage ? 'camera-retake' : 'camera'} buttonColor={hasImage ? undefined : COLORS.primary} textColor={hasImage ? COLORS.text : undefined}
              style={[s.half, hasImage && { borderColor: COLORS.border }]} disabled={!canAct} onPress={openCamera}>{hasImage ? 'Retake photo' : 'Take photo'}</Button>}
            {!cameraOnly && <Button mode={uploadOnly && !hasImage ? 'contained' : 'outlined'} icon="upload" buttonColor={uploadOnly && !hasImage ? COLORS.primary : undefined} textColor={uploadOnly && !hasImage ? undefined : COLORS.text}
              style={[s.half, !(uploadOnly && !hasImage) && { borderColor: COLORS.border }]} disabled={!canAct} onPress={upload}>{hasImage ? 'Upload another' : 'Upload image'}</Button>}
          </View>
          {hasImage && !busy && !current && !pending && entered > 0 && (
            <Button mode="outlined" icon="refresh" textColor={COLORS.primary} style={[s.btn, { borderColor: COLORS.primary }]} disabled={!canAct} onPress={() => verify(previewUri, true)}>Verify again with the same photo</Button>)}
          {hasImage && !busy && (
            <Button compact icon="close" textColor={COLORS.grey} onPress={clearAll}>Remove photo</Button>)}
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
  thumb: { width: '100%', height: 200, backgroundColor: '#1d1210', borderRadius: 12, overflow: 'hidden', marginTop: 6 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(29,18,16,0.72)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  overlayText: { color: '#fff', fontWeight: '800', marginTop: 12, textAlign: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, padding: 10 },
  badgeText: { fontWeight: '900', fontSize: 16, marginLeft: 8, letterSpacing: 0.5 },
  note: { color: COLORS.text, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 4, marginBottom: 4 },
  pillText: { fontWeight: '900', fontSize: 12, marginLeft: 6, letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  tile: { flexGrow: 1, flexBasis: '30%', minWidth: 110, backgroundColor: '#fff', borderRadius: 12, padding: 10, margin: 4 },
  cmpK: { color: COLORS.grey, fontWeight: '700', fontSize: 12 },
  cmpV: { color: COLORS.text, fontWeight: '900', fontSize: 16, marginTop: 3 },
  expected: { color: COLORS.grey, fontWeight: '700', fontSize: 12.5, textAlign: 'center', marginTop: 4, marginBottom: 6 },
  manual: { marginTop: 12, backgroundColor: '#fff', borderRadius: 12, padding: 10 },
  manualTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey },
});
