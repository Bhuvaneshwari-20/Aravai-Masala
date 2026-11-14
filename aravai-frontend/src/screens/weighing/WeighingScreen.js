import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Image, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useUi } from '../../ui';
import Container from '../../components/Container';
import FormField from '../../components/FormField';
import FormRow from '../../components/FormRow';
import SelectField from '../../components/SelectField';
import FilterChips from '../../components/FilterChips';
import PhotoCapture from '../../components/PhotoCapture';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { ErrorBox, InfoBox } from '../../components/FormBits';
import { W_UNITS, WEIGHT_RE, wStatus, fmtW, imageUri, buildImageForm, uploadCfg } from '../../weighing';
import { COLORS } from '../../theme';

const STEPS = ['Machine', 'Weight', 'Photo', 'Result'];
const ITEM_TYPES = [{ value: 'PRODUCT', label: 'Product' }, { value: 'MATERIAL', label: 'Material' }];

function Stepper({ at }) {
  return (
    <View style={s.stepper}>
      {STEPS.map((n, i) => {
        const done = i < at; const on = i === at;
        return (
          <View key={n} style={s.stepItem}>
            <View style={[s.dot, (done || on) && { backgroundColor: done ? COLORS.ok : COLORS.primary }]}>
              {done ? <MCI name="check" size={14} color="#fff" /> : <Text style={[s.dotText, on && { color: '#fff' }]}>{i + 1}</Text>}
            </View>
            <Text style={[s.stepText, on && { color: COLORS.text, fontWeight: '900' }]}>{n}</Text>
          </View>
        );
      })}
    </View>
  );
}

// Step 3: product / material, batch (optional), measured weight and unit.
function WeightStep({ txn, onSaved }) {
  const [itemType, setItemType] = useState('PRODUCT');
  const [itemId, setItemId] = useState(null);
  const [batch, setBatch] = useState('NONE');
  const [batchOpts, setBatchOpts] = useState([{ value: 'NONE', label: 'No batch (standalone weighing)' }]);
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState('KG');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [opts, setOpts] = useState({ products: [], materials: [] });
  const [optErr, setOptErr] = useState('');
  // one call gives the active products, materials and running batches (operators do not need Product / Material permissions)
  useEffect(() => {
    let live = true;
    api.get('/weighing/options').then((r) => {
      if (!live) return;
      const d = r.data.data;
      setOpts({
        products: d.products.map((p) => ({ value: p.id, label: `${p.product_code} - ${p.product_name}` })),
        materials: d.materials.map((m) => ({ value: m.id, label: `${m.material_code} - ${m.material_name}` })),
      });
      setBatchOpts([{ value: 'NONE', label: 'No batch (standalone weighing)' }, ...d.batches.map((b) => ({ value: b.id, label: `${b.batch_no} - ${b.product_name}`, machineId: b.weighing_machine_id ?? null, machineName: [b.weighing_machine_code, b.weighing_machine_name].filter(Boolean).join(' - ') }))]);
    }).catch((e) => { if (live) setOptErr(errMsg(e)); });
    return () => { live = false; };
  }, []);
  const products = opts.products;
  const materials = opts.materials;

  const save = async () => {
    if (saving) return;
    const e = {};
    if (!itemId) e.item = `Select the ${itemType.toLowerCase()}`;
    if (!weight || !WEIGHT_RE.test(weight) || Number(weight) <= 0) e.weight = 'Enter a weight above 0 (up to 3 decimals)';
    if (!unit) e.unit = 'Select the unit';
    // Batch machine lock: a batch weighed on one machine cannot be weighed on another (the server checks this too)
    const picked = batch === 'NONE' ? null : batchOpts.find((o) => o.value === batch);
    if (picked && picked.machineId != null && txn.machine_id != null && String(picked.machineId) !== String(txn.machine_id)) {
      e.batch = `This batch is locked to ${picked.machineName || 'another machine'}. Scan that machine to weigh for this batch.`;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.put(`/weighing/transactions/${txn.id}/weight`, {
        product_id: itemType === 'PRODUCT' ? itemId : undefined, material_id: itemType === 'MATERIAL' ? itemId : undefined,
        batch_id: batch === 'NONE' ? null : batch, weight: Number(weight), unit,
      });
      setSaving(false);
      onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <View style={s.card}>
      <Text style={s.secTitle}>PRODUCT & WEIGHT</Text>
      <FilterChips value={itemType} onChange={(v) => { setItemType(v); setItemId(null); }} options={ITEM_TYPES} />
      <View style={{ height: 8 }} />
      <SelectField key={itemType} label={`${itemType === 'PRODUCT' ? 'Product' : 'Material'} *`} value={itemId}
        options={itemType === 'PRODUCT' ? products : materials} onChange={setItemId} error={errors.item} />
      <SelectField label="Batch (optional)" value={batch} options={batchOpts} onChange={setBatch} error={errors.batch} />
      <FormRow>
        <FormField label="Measured weight *" numeric value={weight} onChangeText={setWeight} error={errors.weight} maxLength={10} />
        <SelectField label="Unit *" value={unit} options={W_UNITS} onChange={setUnit} error={errors.unit} />
      </FormRow>
      {!!weight && WEIGHT_RE.test(weight) && <Text style={s.preview}>You will confirm: {fmtW(weight, unit)}</Text>}
      <InfoBox text="Enter exactly what the weighing machine shows. The weight cannot be changed after you save." />
      <ErrorBox text={err || optErr} />
      <Button mode="contained" icon="arrow-right" buttonColor={COLORS.green} style={s.btnFull} contentStyle={{ flexDirection: 'row-reverse' }}
        loading={saving} disabled={saving} onPress={save}>Save & take photo</Button>
    </View>
  );
}

// Step 4: photo of the display -> upload -> OCR verification.
function PhotoStep({ txn, onDone }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const upload = async (photo) => {
    if (uploading) return;
    setUploading(true); setErr('');
    try {
      const fd = await buildImageForm(photo.uri);
      await api.post(`/weighing/transactions/${txn.id}/image`, fd, uploadCfg); // upload + OCR + comparison happen in this one call
      onDone();
    } catch (e) { setErr(errMsg(e)); setUploading(false); }
  };

  return (
    <View style={s.card}>
      <Text style={s.secTitle}>PHOTO OF THE WEIGHING DISPLAY</Text>
      <View style={s.entered}><Text style={s.enteredLabel}>You entered</Text><Text style={s.enteredVal}>{fmtW(txn.entered_weight, txn.unit)}</Text></View>
      <PhotoCapture onUpload={upload} uploading={uploading} error={err} />
    </View>
  );
}

const Compare = ({ k, v, color }) => (
  <View style={s.cmp}><Text style={s.cmpK}>{k}</Text><Text style={[s.cmpV, color && { color }]}>{v}</Text></View>
);

// Result: entered vs image weight, difference and status.
function ResultStep({ txn, busy, err, onVerify, onRetake, onAgain }) {
  const st = wStatus(txn.status);
  const img = imageUri(txn);
  const failed = txn.status === 'MISMATCH' || txn.status === 'UNREADABLE';
  const note = {
    VERIFIED: txn.verification_method === 'MANUAL' ? 'This weighing was verified manually by the admin.' : 'MATCH: the weight read from the photo is the same as the weight you entered.',
    MISMATCH: 'MISMATCH: the weight read from the photo is different from the weight you entered. This is NOT verified and the admin will review it.',
    UNREADABLE: 'The weight could not be read from the photo. This is NOT verified. Retake a clearer photo or ask the admin to review.',
    REJECTED: 'This weighing was rejected by the admin.',
    IMAGE_UPLOADED: 'Your photo is saved but verification has not finished yet.',
  }[txn.status];
  return (
    <View style={s.card}>
      <View style={[s.resultBadge, { backgroundColor: st.bg }]}>
        <MCI name={txn.status === 'VERIFIED' ? 'check-circle' : txn.status === 'IMAGE_UPLOADED' ? 'timer-sand' : 'alert-circle'} size={22} color={st.color} />
        <Text style={[s.resultText, { color: st.color }]}>{txn.status === 'VERIFIED' && txn.verification_method === 'MANUAL' ? 'VERIFIED BY ADMIN' : st.label}</Text>
      </View>
      {!!note && <Text style={s.note}>{note}</Text>}
      {!!img && <Image source={{ uri: img }} style={s.img} resizeMode="contain" />}
      <View style={s.cmpRow}>
        <Compare k="Entered weight" v={fmtW(txn.entered_weight, txn.unit)} />
        <Compare k="Image weight" v={txn.detected_weight == null ? 'Not read' : fmtW(txn.detected_weight, txn.unit)} color={txn.status === 'MISMATCH' ? COLORS.danger : undefined} />
      </View>
      <View style={s.cmpRow}>
        <Compare k="Difference" v={txn.difference == null ? '-' : fmtW(Math.abs(txn.difference), txn.unit)} />
        <Compare k="Allowed tolerance" v={txn.tolerance == null ? '-' : fmtW(txn.tolerance, txn.unit)} />
      </View>
      <ErrorBox text={err} />

      {txn.status === 'IMAGE_UPLOADED' && (
        <Button mode="contained" icon="shield-check" buttonColor={COLORS.green} style={s.btnFull} loading={busy} disabled={busy} onPress={onVerify}>Verify now</Button>)}
      {failed && (
        <>
          <Button mode="contained" icon="camera-retake" buttonColor={COLORS.primary} style={s.btnFull} disabled={busy} onPress={onRetake}>Retake photo</Button>
          <Button mode="outlined" icon="refresh" textColor={COLORS.text} style={[s.btnFull, { borderColor: COLORS.border }]} loading={busy} disabled={busy} onPress={onVerify}>Run verification again</Button>
        </>
      )}
      <Button mode={txn.status === 'VERIFIED' ? 'contained' : 'outlined'} icon="qrcode-scan" buttonColor={txn.status === 'VERIFIED' ? COLORS.green : undefined}
        textColor={txn.status === 'VERIFIED' ? undefined : COLORS.text} style={[s.btnFull, txn.status !== 'VERIFIED' && { borderColor: COLORS.border }]} onPress={onAgain}>
        {txn.status === 'VERIFIED' ? 'Done - weigh another' : 'Start a new weighing'}
      </Button>
    </View>
  );
}

export default function WeighingScreen({ route, navigation }) {
  const { id } = route.params;
  const { toast } = useUi();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [retake, setRetake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setT((await api.get(`/weighing/transactions/${id}`)).data.data); setError(''); } catch (e) { setError(errMsg(e)); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const verify = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await api.post(`/weighing/transactions/${id}/reverify`, {}, { timeout: 60000 }); await load(); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  if (error && !t) return <EmptyView error={error} onRetry={load} />;
  if (!t) return <LoadingView />;

  const step = t.status === 'PENDING' ? 'pending'
    : t.status === 'MACHINE_CONFIRMED' ? 'weight'
      : t.status === 'WEIGHT_ENTERED' || retake ? 'photo' : 'result';
  const at = { pending: 0, weight: 1, photo: 2, result: 3 }[step];

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Container maxWidth={640}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t.machine_code}  •  {t.machine_name}</Text>
            <Text style={s.sub}>{t.txn_no}  •  Operator: {t.operator_name}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: wStatus(t.status).bg }]}><Text style={[s.badgeText, { color: wStatus(t.status).color }]}>{wStatus(t.status).label}</Text></View>
        </View>
        <Stepper at={at} />

        {step === 'pending' && (
          <View style={s.card}>
            <ErrorBox text="The machine has not been confirmed for this transaction. Please scan the machine again." />
            <Button mode="contained" icon="qrcode-scan" buttonColor={COLORS.primary} style={s.btnFull} onPress={() => navigation.replace('WeighingScan')}>Scan machine</Button>
          </View>
        )}
        {step === 'weight' && <WeightStep txn={t} onSaved={(n) => { setT(n); toast('Weight saved'); }} />}
        {step === 'photo' && <PhotoStep txn={t} onDone={async () => { setRetake(false); await load(); }} />}
        {step === 'result' && (
          <ResultStep txn={t} busy={busy} err={err} onVerify={verify} onRetake={() => { setErr(''); setRetake(true); }}
            onAgain={() => navigation.replace('WeighingScan')} />
        )}
      </Container>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 18 },
  title: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 12.5, color: COLORS.grey, fontWeight: '600', marginTop: 2 },
  badge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 8 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12 },
  stepItem: { alignItems: 'center', flex: 1 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontWeight: '900', fontSize: 12, color: COLORS.grey },
  stepText: { fontSize: 11.5, color: COLORS.grey, fontWeight: '700', marginTop: 4 },
  card: { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  secTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 },
  preview: { color: COLORS.text, fontWeight: '800', marginBottom: 10 },
  btnFull: { borderRadius: 12, marginTop: 12 },
  entered: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 12, padding: 12, marginBottom: 12 },
  enteredLabel: { color: COLORS.grey, fontWeight: '700' },
  enteredVal: { color: COLORS.text, fontWeight: '900', fontSize: 18 },
  resultBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, padding: 12 },
  resultText: { fontWeight: '900', fontSize: 18, marginLeft: 8, letterSpacing: 0.5 },
  note: { color: COLORS.text, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  img: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#1d1210', marginTop: 14 },
  cmpRow: { flexDirection: 'row', marginTop: 12 },
  cmp: { flex: 1, backgroundColor: COLORS.bg, borderRadius: 12, padding: 12, marginHorizontal: 4 },
  cmpK: { color: COLORS.grey, fontWeight: '700', fontSize: 12 },
  cmpV: { color: COLORS.text, fontWeight: '900', fontSize: 17, marginTop: 4 },
});
