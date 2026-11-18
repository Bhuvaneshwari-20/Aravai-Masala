import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import QrScanner from './QrScanner';
import WeightImageVerify from './WeightImageVerify';
import { batchMachineId, batchMachineLabel, isBatchMachineLocked, lookupScannedMachine, checkMachineForBatch } from '../batchMachineLock';
import { ErrorBox, InfoBox, ModalFooter } from './FormBits';
import { COLORS, fmt } from '../theme';

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

// Step C7: weigh one material (bags, weight, weighed qty, done by, checked by). Raw stock goes down when this is saved.
export default function BatchingEntryModal({ visible, batch, ingredient, onDismiss, onSaved }) {
  const { user, can } = useAuth();
  const staff = useOptions('/batches/staff', {}, (u) => ({ value: u.id, label: `${u.full_name} (${u.role_name})` }), visible);
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [verified, setVerified] = useState(null); // machine scanned for this weighing (must be the batch's machine)
  const [checking, setChecking] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const scanLock = useRef(false);
  const [wimg, setWimg] = useState({ imageId: null, passed: false }); // weighing machine photo check of this weighing
  const [fromPhoto, setFromPhoto] = useState(false); // weighed quantity was filled in from the machine photo (same behaviour as New Batch)
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ no_of_bags: '', weight_per_bag: '', weighed_qty: '', done_by: user?.id, checked_by: null });
    setErrors({}); setErr(''); setSaving(false);
    setVerified(null); setScanErr(''); setChecking(false); scanLock.current = false;
    setWimg({ imageId: null, passed: false }); setFromPhoto(false);
  }, [visible]); // eslint-disable-line

  if (!ingredient) return null;
  // Batch has a machine -> its QR must be scanned before this material can be weighed.
  const needsScan = isBatchMachineLocked(batch) && !verified;
  const photoRequired = isBatchMachineLocked(batch);
  // machine the photo must show: the one scanned for this weighing (= the batch machine)
  const expectedMachine = verified ? { id: verified.id, code: verified.machine_code, name: verified.machine_name, qrValue: verified.qr_value } : null;
  // Save unlocks only when the photo check passed (required on a machine-locked batch; if a photo was added it must pass too)
  const photoPending = (photoRequired || !!wimg.imageId) && !wimg.passed;

  const onScanned = async (raw) => {
    if (scanLock.current) return;
    scanLock.current = true; setChecking(true); setScanErr('');
    try {
      const m = await lookupScannedMachine(raw);
      const c = checkMachineForBatch(batch, m);
      if (c.ok) setVerified(m); else setScanErr(c.message);
    } catch (x) { setScanErr(x.message); }
    setChecking(false);
    setTimeout(() => { scanLock.current = false; }, 1500);
  };
  const bagsTotal = (Number(f.no_of_bags) || 0) * (Number(f.weight_per_bag) || 0);
  const required = Number(ingredient.required_kg);
  // photo of the machine display was read -> its weight becomes the weighed quantity
  const onDetected = (kg) => {
    setF((p) => ({ ...p, weighed_qty: String(r3(kg)) }));
    setErrors((p) => ({ ...p, weighed_qty: undefined, photo: undefined }));
    setFromPhoto(true);
  };
  const off = Number(f.weighed_qty) > 0 && required > 0 && Math.abs(Number(f.weighed_qty) - required) / required > 0.05;

  const save = async () => {
    const e = {};
    if (!f.no_of_bags || Number(f.no_of_bags) < 1) e.no_of_bags = 'Enter number of bags';
    if (!f.weight_per_bag || Number(f.weight_per_bag) <= 0) e.weight_per_bag = 'Enter weight per bag';
    if (!f.weighed_qty || Number(f.weighed_qty) <= 0) e.weighed_qty = 'Enter weighed quantity';
    if (!f.done_by) e.done_by = 'Select who weighed';
    if (!f.checked_by) e.checked_by = 'Select who checked';
    else if (f.checked_by === f.done_by) e.checked_by = 'Must be a different person';
    if (isBatchMachineLocked(batch) && !verified) e.machine = 'Scan the batch machine QR code first';
    // Weight photo: required on a machine-locked batch; if a photo was added (any batch) it must match before saving
    if (photoPending) e.photo = wimg.imageId ? (wimg.machineStatus === 'MISMATCH' ? 'The photo shows a different machine. Photograph the display of the batch machine before saving.' : 'The weight in the photo does not match, or is not verified. Fix it before saving.') : 'Take or upload a photo of the weighing machine display and verify the weight first';
    setErrors(e);
    if (Object.keys(e).length) { if (e.machine) setScanErr(e.machine); return; }
    setSaving(true); setErr('');
    try {
      const r = await api.post(`/batches/${batch.id}/batching`, { material_id: ingredient.material_id, ...f, ...(verified ? { weighing_machine_id: verified.id, qr_value: verified.qr_value } : {}), ...(wimg.passed ? { weight_image_id: wimg.imageId } : {}) });
      setSaving(false);
      onSaved && onSaved(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="scale-balance" title={ingredient.material_name}
      subtitle={`${required > 0 ? `Required ${fmt(required)} kg  •  ` : ''}Stock ${fmt(ingredient.current_stock)} kg`}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} disabled={needsScan || photoPending} label="Save Weighing" />}>
      <View>
        {isBatchMachineLocked(batch) && (
          verified
            ? <InfoBox tone="ok" text={`Machine verified: ${verified.machine_code} - ${verified.machine_name}`} />
            : (
              <View>
                <InfoBox text={`This batch is locked to ${batchMachineLabel(batch)}. Scan that machine's QR code to weigh.`} />
                <QrScanner onScanned={onScanned} active={!checking} />
                <ErrorBox text={scanErr} />
              </View>
            )
        )}
        {!needsScan && (<View>
        {ingredient.stock_short && <InfoBox text="Stock is less than the required quantity. Weighing may be rejected." />}
        <FormRow>
          <FormField label="No of bags *" digits value={f.no_of_bags || ''} onChangeText={set('no_of_bags')} error={errors.no_of_bags} />
          <FormField label="Weight per bag (kg) *" numeric value={f.weight_per_bag || ''} onChangeText={set('weight_per_bag')} error={errors.weight_per_bag} />
        </FormRow>
        <Text style={{ color: COLORS.grey, fontWeight: '600', marginBottom: 8 }}>Bags total: {fmt(bagsTotal)} kg</Text>
        <FormField label="Weighed quantity (kg) *" numeric value={f.weighed_qty || ''} onChangeText={(v) => { setFromPhoto(false); set('weighed_qty')(v); }} error={errors.weighed_qty}
          hint={fromPhoto && wimg.passed ? 'Filled in from the weighing machine photo' : undefined} />
        {off && <InfoBox text={`Weighed quantity differs from the required ${fmt(required)} kg by more than 5%. Please recheck.`} />}
        <WeightImageVerify batchId={batch.id} materialId={ingredient.material_id} enteredWeight={f.weighed_qty} required={photoRequired}
          canManual={can('batching', 'approve')} error={errors.photo} onChange={setWimg}
          autoFill onDetected={onDetected} expectedMachine={expectedMachine} />
        {photoPending && !errors.photo && <InfoBox text="Save Weighing unlocks when the weighing machine photo is read, the machine matches and the weight matches the weighed quantity." />}
        <SelectField label="Done by *" value={f.done_by} options={staff} onChange={set('done_by')} error={errors.done_by} />
        <SelectField label="Checked by *" value={f.checked_by} options={staff} onChange={set('checked_by')} error={errors.checked_by} />
        <ErrorBox text={err} />
        </View>)}
      </View>
    </ModalShell>
  );
}
