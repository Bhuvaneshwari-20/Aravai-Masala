import api, { getToken } from './api';
import { API_URL } from './config';
import { COLORS } from './theme';
import { buildImageForm, uploadCfg } from './weighing';

// ---------------------------------------------------------------------------------------------
// Batching weight photo: the operator photographs (or uploads) the weighing machine display, the server reads the
// weight with OCR and compares it with the weighed quantity typed in the batching screen.
//   MATCH       weights are the same                          -> can be saved
//   MANUAL      OCR could not read it, a supervisor verified  -> can be saved
//   MISMATCH    weights differ                                -> saving blocked
//   UNREADABLE  image unclear / OCR could not read a weight   -> needs manual verification (or a better photo)
// The server repeats every check when the weighing is saved; this file only gives the operator a clear message early.
// ---------------------------------------------------------------------------------------------

export const BW_STATUS = {
  MATCH: { label: 'MATCH', color: COLORS.ok, bg: COLORS.okBg },
  MANUAL: { label: 'VERIFIED MANUALLY', color: COLORS.ok, bg: COLORS.okBg },
  MISMATCH: { label: 'MISMATCH', color: COLORS.danger, bg: COLORS.dangerBg },
  UNREADABLE: { label: 'UNREADABLE', color: COLORS.warn, bg: COLORS.warnBg },
};
export const bwStatus = (s) => BW_STATUS[s] || BW_STATUS.UNREADABLE;
export const bwPassed = (s) => s === 'MATCH' || s === 'MANUAL';

// Protected image. Same ?token= convention as weighing.js and the CSV reports, so <Image> can load it on native and web.
export const batchWeightImageUri = (batchId, image) => (image && image.id
  ? `${API_URL}/batches/${batchId}/weight-images/${image.id}/file?token=${encodeURIComponent(getToken() || '')}`
  : null);

// Photo -> server: stores it, reads the weight (OCR) and compares. Resolves { id, status, entered_weight, detected_weight, difference, tolerance }.
// enteredWeight left out (null / undefined / '') = auto-fill: the weight read from the photo is used, nothing is compared.
// machine (optional) = the machine this weighing must be done on { id, qrValue }. Sent as machine_id / qr_value so the server can
// validate the machine shown in the photo (and the scanned QR) itself; the answer comes back as detected_machine_* + machine_status.
export async function uploadWeightImage(batchId, { uri, materialId, enteredWeight, machine }) {
  const fd = await buildImageForm(uri);
  fd.append('material_id', String(materialId));
  if (enteredWeight !== null && enteredWeight !== undefined && enteredWeight !== '') fd.append('entered_weight', String(enteredWeight));
  if (machine && machine.id != null && machine.id !== '') fd.append('machine_id', String(machine.id));
  if (machine && machine.qrValue) fd.append('qr_value', String(machine.qrValue));
  const url = batchId ? `/batches/${batchId}/batching/weight-image` : '/batches/weight-image'; // no batchId = New Batch form (batch not saved yet)
  const r = await api.post(url, fd, uploadCfg);
  return r.data.data;
}

// Supervisor (batching: approve) verifies an UNREADABLE photo by eye. Resolves the updated image { id, status: 'MANUAL', ... }.
export async function manualVerifyWeightImage(batchId, imageId, reason) {
  const url = batchId ? `/batches/${batchId}/batching/weight-image/${imageId}/manual-verify` : `/batches/weight-image/${imageId}/manual-verify`;
  const r = await api.post(url, { reason });
  return r.data.data;
}

// Pick an existing photo of the display (gallery on a phone, file dialog on the web build). Resolves { uri } or null when cancelled.
export async function pickWeightImage() {
  const ImagePicker = require('expo-image-picker'); // eslint-disable-line global-require
  const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
  if (r.canceled || !r.assets || !r.assets.length) return null;
  return { uri: r.assets[0].uri };
}

// ---------------------------------------------------------------------------------------------
// Machine shown in the photo (detected_machine_code / detected_machine_name / detected_machine_id) versus the machine this weighing
// must use. The server's verdict (machine_status or machine_match) is used when it was made for the same machine; otherwise - or when the
// server sends no verdict yet - the app compares itself, so the badge also updates live if the operator changes the machine.
//   MATCH        photo shows the expected machine
//   MISMATCH     photo shows another machine            -> saving blocked
//   NOT_READ     no machine id / name could be read      -> not blocked here, server decides on save
//   NOT_CHECKED  nothing to compare with (no machine chosen / batch has none)
// ---------------------------------------------------------------------------------------------
export const MACHINE_STATUS = {
  MATCH: { label: 'MATCH', color: COLORS.ok, bg: COLORS.okBg, icon: 'check-circle' },
  MISMATCH: { label: 'MISMATCH', color: COLORS.danger, bg: COLORS.dangerBg, icon: 'close-circle' },
  NOT_READ: { label: 'NOT READ', color: COLORS.warn, bg: COLORS.warnBg, icon: 'help-circle' },
  NOT_CHECKED: { label: 'NOT CHECKED', color: COLORS.grey, bg: COLORS.greyBg, icon: 'minus-circle' },
};
export const machineStatusInfo = (s) => MACHINE_STATUS[s] || MACHINE_STATUS.NOT_CHECKED;

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const norm = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// expected: { id, code, name } or null.  trustServer: the server verdict was made for this same expected machine.
// -> { status, id, code, name, label }  (label = text to show for the machine on the photo, '' when nothing was read)
export function machineCheck(r, expected, trustServer = true) {
  const id = r ? r.detected_machine_id : null;
  const code = r ? r.detected_machine_code : null;
  const name = r ? r.detected_machine_name : null;
  const label = [has(code) ? code : (has(id) ? id : ''), has(name) ? name : ''].filter(Boolean).join(' - ');
  const out = (status) => ({ status, id: has(id) ? id : null, code: has(code) ? code : null, name: has(name) ? name : null, label });

  const sv = r ? String(r.machine_status || (r.machine_match === true ? 'MATCH' : r.machine_match === false ? 'MISMATCH' : '')).toUpperCase() : '';
  if (trustServer && MACHINE_STATUS[sv]) return out(sv);

  const seen = has(id) || has(code) || has(name);
  if (!seen) return out('NOT_READ');
  if (!expected || (!has(expected.id) && !has(expected.code) && !has(expected.name))) return out('NOT_CHECKED');

  const idHit = has(expected.id) && has(id) && String(id) === String(expected.id);
  const codeHit = has(expected.code) && [code, id].some((x) => has(x) && norm(x) === norm(expected.code));
  if (idHit || codeHit) return out('MATCH');
  if (has(id) || has(code)) return out('MISMATCH');
  return out(has(expected.name) && norm(name) === norm(expected.name) ? 'MATCH' : 'MISMATCH');
}

// Readable text for a failed photo upload / OCR call (the default 10 s axios timeout does not apply here, uploadCfg uses 60 s).
export function weightImageErrMsg(e) {
  const st = e && e.response && e.response.status;
  if (e && (e.code === 'ECONNABORTED' || /timeout/i.test(String(e.message || '')))) return 'Reading the photo took too long. Check the Wi-Fi and try again.';
  if (st === 413) return 'The photo is too large. Take it again at a lower quality or choose a smaller image.';
  if (st === 415 || st === 422) return (e.response.data && e.response.data.message) || 'This image could not be used. Choose a JPG or PNG photo of the machine display.';
  if (st >= 500) return (e.response.data && e.response.data.message) || 'The server could not read the photo. Please try again in a moment.';
  if (e && e.response && e.response.data && e.response.data.message) return e.response.data.message;
  if (e && e.request) return 'Unable to connect to the server. Please check your WiFi / IP address.';
  return (e && e.message) || 'Something went wrong while reading the photo.';
}
