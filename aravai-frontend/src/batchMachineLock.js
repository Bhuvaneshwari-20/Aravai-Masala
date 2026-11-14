import api from './api';
import { parseMachineScan } from './machineCode';

// ---------------------------------------------------------------------------------------------
// Batch-wise weighing machine lock (frontend side).
//  - The machine is chosen in New Batch and sent as weighing_machine_id (already the case).
//  - The backend locks it to the batch when the first material weight is recorded and keeps it locked until the
//    batch is COMPLETED. The frontend only READS that state and checks the scanned QR against it; the backend
//    repeats every check, so this file is only there to give the operator a clear message early.
// ---------------------------------------------------------------------------------------------

// Id of the machine assigned to a batch (GET /batches/:id), or null for old batches without a machine.
export function batchMachineId(batch) {
  if (!batch) return null;
  const fromPlan = (batch.plan?.ingredients || []).find((i) => i.weighing_machine_id != null);
  const id = batch.weighing_machine_id ?? fromPlan?.weighing_machine_id ?? null;
  return id == null || id === '' ? null : id;
}

export function batchMachineLabel(batch) {
  if (!batch) return '';
  const fromPlan = (batch.plan?.ingredients || []).find((i) => i.weighing_machine_name);
  const code = batch.weighing_machine_code;
  const name = batch.weighing_machine_name || fromPlan?.weighing_machine_name;
  return [code, name].filter(Boolean).join(' - ') || 'the assigned machine';
}

// The machine stays locked while the batch is running (also ON_HOLD). Released when the batch is COMPLETED / CANCELLED.
export const isBatchMachineLocked = (batch) => !!batchMachineId(batch) && !['COMPLETED', 'CANCELLED'].includes(batch.status);

// Scanned QR text -> machine { id, machine_code, machine_name }. Uses the same parser + endpoint as the existing Scan Machine screen.
// Throws an Error with a readable message.
export async function lookupScannedMachine(raw) {
  const parsed = parseMachineScan(raw);
  if (!parsed) throw new Error('This is not an Aravai machine QR code. Scan the QR sticker on the machine.');
  try {
    const r = await api.get(`/machines/by-token/${encodeURIComponent(parsed.id)}`);
    return { ...r.data.data, qr_value: parsed.id }; // qr_value is sent to the server, which resolves the machine itself
  } catch (e) {
    if (e.response?.status === 404) throw new Error('This QR code is not registered to any machine.');
    throw new Error(e.response?.data?.message || (e.request ? 'Unable to connect to the server. Please check your WiFi / IP address.' : e.message));
  }
}

// -> { ok: true } | { ok: false, message }
export function checkMachineForBatch(batch, scanned) {
  const lockedId = batchMachineId(batch);
  if (!lockedId) return { ok: true }; // no machine assigned to this batch (older batch): nothing to compare
  if (!scanned || String(scanned.id) !== String(lockedId)) {
    return { ok: false, message: `Wrong machine${scanned?.machine_code ? ` (${scanned.machine_code})` : ''}. This batch is locked to ${batchMachineLabel(batch)}. Weighing is blocked until you scan that machine.` };
  }
  return { ok: true };
}
