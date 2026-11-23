import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import PhotoCapture from './PhotoCapture';
import { ErrorBox, InfoBox, Label } from './FormBits';
import {
  bwStatus, bwPassed, uploadWeightImage, weightImageErrMsg,
  machineCheck, machineStatusInfo, machinePassed,
} from '../batchWeightImage';
import { fmtW } from '../weighing';
import { COLORS } from '../theme';
import { MACHINE_QR_ENABLED } from '../config';

// Weight verification of one batching entry (one batch + one material).
//   1. The operator types the weight by hand (this component never changes it).
//   2. The operator takes a LIVE photo of the weighing machine display (no gallery upload).
//   3. The photo preview is shown (Retake photo / Remove photo).
//   4. The photo and the typed weight are sent to the OCR verification API. The weight read from the display is shown on its own,
//      next to the typed weight, with the result: MATCH (green) / MISMATCH (red) / UNREADABLE (warning).
//   5. Only MATCH reports passed = true. Changing the typed weight afterwards makes the result stale (passed = false) until the photo is verified again.
// QR / machine identification is OFF while MACHINE_QR_ENABLED is false in config.js (expectedMachine is then ignored).
// onChange({ imageId, hasPhoto, passed, status, stale, machineStatus, batchId, materialId, enteredWeight, detectedWeight }) tells the parent which image
// belongs to which batch + material, so the parent can refuse to save a result that belongs to another entry.
// batchId is null in the New Batch form (batch not created yet); the image is then tied to the material row and sent as weight_image_id on save.

const Tile = ({ k, v, bad, ok }) => (
  <View style={s.tile}>
    <Text style={s.cmpK}>{k}</Text>
    <Text style={[s.cmpV, bad && { color: COLORS.danger }, ok && { color: COLORS.ok }]} numberOfLines={2}>{v}</Text>
  </View>
);
const Pill = ({ label, color, bg, icon }) => (
  <View style={[s.pill, { backgroundColor: bg }]}>
    <MCI name={icon} size={15} color={color} />
    <Text style={[s.pillText, { color }]}>{label}</Text>
  </View>
);
const STATUS_ICON = { MATCH: 'check-circle', MISMATCH: 'close-circle', UNREADABLE: 'alert-circle' };

export default function WeightImageVerify({ batchId, materialId, enteredWeight, required, error, onChange, expectedMachine = null, blockedReason = '' }) {
  const machine = MACHINE_QR_ENABLED ? expectedMachine : null; // machine identification is switched off
  const [mode, setMode] = useState('idle');     // idle | camera
  const [previewUri, setPreviewUri] = useState(null);
  const [result, setResult] = useState(null);   // server answer for the photo + the weight that was sent
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [checkedFor, setCheckedFor] = useState(null);
  const [ratio, setRatio] = useState(4 / 3);
  const live = useRef(true);
  const busyRef = useRef(false);
  const enteredRef = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const entered = Number(enteredWeight) || 0;
  enteredRef.current = entered;

  // another batch / material -> nothing of the earlier photo may be carried over
  const idKey = `${batchId == null ? 'new' : batchId}:${materialId}`;
  const lastKey = useRef(idKey);
  useEffect(() => {
    if (lastKey.current === idKey) return;
    lastKey.current = idKey;
    setResult(null); setPreviewUri(null); setMode('idle'); setErr(''); setCheckedFor(null);
  }, [idKey]);

  useEffect(() => {
    if (!previewUri) return undefined;
    let ok = true;
    try { Image.getSize(previewUri, (w, h) => { if (ok && w > 0 && h > 0) setRatio(Math.min(2, Math.max(0.6, w / h))); }, () => {}); } catch (e) { /* keep 4:3 */ }
    return () => { ok = false; };
  }, [previewUri]);

  const retaking = mode === 'camera';
  const stale = !!result && Math.abs(Number(result.entered_weight) - entered) > 0.0005; // typed weight changed after the check
  const current = result && !stale ? result : null;
  const expectedId = machine && machine.id != null ? String(machine.id) : null;
  const mc = current ? machineCheck(current, machine, expectedId !== null && String(checkedFor) === expectedId) : null;
  const machineRequired = !!machine;
  const machineStatus = !current ? 'NOT_CHECKED' : machineRequired ? mc.status : 'NOT_CHECKED';
  const machineOk = !machineRequired || machinePassed(machineStatus);
  const weightOk = !!current && bwPassed(current.status); // MATCH only
  const passed = weightOk && machineOk && !retaking && !busy;

  useEffect(() => {
    onChange && onChange({
      imageId: current ? current.id : null, passed, status: current ? current.status : null, stale, machineStatus, hasPhoto: !!previewUri, batchId: batchId == null ? null : batchId, materialId,
      enteredWeight: current ? current.entered_weight : null, detectedWeight: current ? current.detected_weight : null,
    });
  }, [current && current.id, current && current.status, passed, stale, machineStatus, idKey, !!previewUri]); // eslint-disable-line

  // Sends the photo and the typed weight to the OCR verification API.
  const verify = async (uri) => {
    if (busyRef.current || blockedReason) return;
    const weight = enteredRef.current;
    setMode('idle'); setPreviewUri(uri); setResult(null); setErr(''); // a new photo replaces the old result at once
    if (!(weight > 0)) return; // shows "enter the weight" below; verified by the button as soon as a weight is there
    busyRef.current = true; setBusy(true);
    try {
      const r = await uploadWeightImage(batchId, { uri, materialId, enteredWeight: weight, machine });
      if (!live.current) return;
      // the answer must belong to this material (and batch) - never attach another entry's image
      if ((r.material_id != null && String(r.material_id) !== String(materialId)) || (batchId != null && r.batch_id != null && String(r.batch_id) !== String(batchId))) {
        throw new Error('The server answered for a different material or batch. Please take the photo again.');
      }
      setCheckedFor(machine && machine.id != null ? machine.id : null);
      setResult({ ...r, entered_weight: r.entered_weight != null ? r.entered_weight : weight });
    } catch (e) { if (live.current) setErr(e && e.response ? weightImageErrMsg(e) : (e && e.message && !e.request ? e.message : weightImageErrMsg(e))); }
    finally { busyRef.current = false; if (live.current) setBusy(false); }
  };

  const openCamera = () => { if (blockedReason || busyRef.current) return; setErr(''); setMode('camera'); };
  const clearAll = () => { if (busyRef.current) return; setResult(null); setPreviewUri(null); setMode('idle'); setErr(''); setCheckedFor(null); };

  const st = current ? bwStatus(current.status) : null;
  const icon = current ? (STATUS_ICON[current.status] || 'alert-circle') : 'alert-circle';
  const detectedKg = current && current.detected_weight != null && current.detected_weight !== '' ? current.detected_weight : null;
  const diff = current && current.difference != null && current.difference !== '' && Number.isFinite(Number(current.difference)) ? Math.abs(Number(current.difference)) : null;
  const mi = machineStatusInfo(machineStatus);
  const headBadge = !machineOk ? mi : st;
  const headLabel = !machineOk ? `QR ${mi.label}` : (st ? st.label : '');
  const machineNote = !current || !machineRequired ? '' : {
    MISMATCH: `QR MISMATCH: the QR code on the photo is ${mc.label || 'another machine'}, but the selected machine is ${machine.code || machine.name}.`,
    NOT_READ: 'QR code not detected on the photo. Retake the photo with the QR sticker in view.',
  }[machineStatus] || '';
  const note = !current ? '' : {
    MATCH: `The machine display shows ${fmtW(detectedKg)}, the same as the entered weight ${fmtW(current.entered_weight)}. You can save now.`,
    MISMATCH: `The machine display shows ${fmtW(current.detected_weight)} but the entered weight is ${fmtW(current.entered_weight)}. Saving is blocked. Correct the entered weight if it was a typing mistake, or weigh again and retake the photo. Your entered weight was not changed.`,
    UNREADABLE: 'The weight on the display could not be read. Saving is blocked. Retake the photo: hold steady, avoid glare and keep the whole display in view.',
  }[current.status] || 'This result cannot be used to save. Retake the photo.';

  const hasImage = !!previewUri;
  const canAct = !busy && !blockedReason;
  const needWeight = hasImage && !busy && !result && !(entered > 0) && mode === 'idle';
  const canVerify = hasImage && !busy && !current && entered > 0 && mode === 'idle' && !blockedReason;

  return (
    <View style={s.box}>
      <Label style={{ marginBottom: 6 }}>{`WEIGHING MACHINE PHOTO${required ? ' *' : ' (OPTIONAL)'}`}</Label>

      {!!blockedReason && <InfoBox text={blockedReason} />}

      {hasImage && mode !== 'camera' && (
        <View style={[s.thumb, { aspectRatio: ratio }]}>
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {busy && (
            <View style={s.overlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={s.overlayText}>Reading the weight from the photo…</Text>
            </View>
          )}
        </View>
      )}

      {!!current && !retaking && (
        <View style={{ marginTop: 10 }}>
          <View style={[s.badge, { backgroundColor: headBadge.bg }]}>
            <MCI name={passed ? 'check-circle' : icon} size={18} color={headBadge.color} />
            <Text style={[s.badgeText, { color: headBadge.color }]}>{headLabel}</Text>
          </View>
          <Text style={s.note}>{note}</Text>
          {!!machineNote && <Text style={[s.note, { color: machineStatus === 'MISMATCH' ? COLORS.danger : COLORS.warn }]}>{machineNote}</Text>}
          {machineRequired && <View style={s.pills}><Pill label={`QR ${mi.label}`} color={mi.color} bg={mi.bg} icon={mi.icon} /></View>}

          {/* typed weight and the weight read from the display are shown separately and never merged */}
          <View style={s.grid}>
            <Tile k="Entered weight (manual)" v={fmtW(current.entered_weight)} />
            <Tile k="OCR detected weight" v={detectedKg == null ? 'Not read' : fmtW(detectedKg)} bad={current.status === 'MISMATCH' || current.status === 'UNREADABLE'} ok={weightOk && detectedKg != null} />
            {diff != null && current.status === 'MISMATCH' && <Tile k="Difference" v={fmtW(diff)} bad />}
          </View>
        </View>
      )}

      {stale && mode === 'idle' && !busy && <InfoBox text="The entered weight changed after the photo was checked. Verify the weight again to unlock saving." />}
      {needWeight && <InfoBox text="Enter the weight above, then verify it against this photo." />}

      {mode === 'camera' && (
        <View>
          <PhotoCapture onUpload={(p) => verify(p.uri)} uploading={busy} error={err} autoSubmit uploadLabel="Verify weight"
            guideText={machine ? undefined : 'Keep the whole weight display in view'}
            helpText={machine ? undefined : 'Hold steady, avoid glare and keep the whole weight display in view.'}
            reviewText={machine ? undefined : 'Check that every digit on the display is sharp and readable.'} />
          {!busy && <Button compact textColor={COLORS.grey} onPress={() => { setMode('idle'); setErr(''); }}>Cancel</Button>}
        </View>
      )}

      {mode === 'idle' && (
        <View>
          {!hasImage && !busy && (
            <Text style={s.help}>Enter the weight, then take a live photo of the weighing machine display. The weight shown on the display is read and compared with the weight you entered (MATCH / MISMATCH / UNREADABLE). Your entered weight is never changed by the photo.</Text>
          )}
          <View style={[s.row, { marginTop: hasImage ? 10 : 0 }]}>
            <Button mode={hasImage ? 'outlined' : 'contained'} icon={hasImage ? 'camera-retake' : 'camera'} buttonColor={hasImage ? undefined : COLORS.primary} textColor={hasImage ? COLORS.text : undefined}
              style={[s.half, hasImage && { borderColor: COLORS.border }]} disabled={!canAct} onPress={openCamera}>{hasImage ? 'Retake Photo' : 'Take photo'}</Button>
            {canVerify && <Button mode="contained" icon="scale-balance" buttonColor={COLORS.green} style={s.half} onPress={() => verify(previewUri)}>Verify weight</Button>}
          </View>
          {hasImage && !busy && <Button compact icon="close" textColor={COLORS.grey} onPress={clearAll}>Remove photo</Button>}
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
  thumb: { width: '100%', maxHeight: 440, backgroundColor: '#1d1210', borderRadius: 12, overflow: 'hidden', marginTop: 6 },
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
});
