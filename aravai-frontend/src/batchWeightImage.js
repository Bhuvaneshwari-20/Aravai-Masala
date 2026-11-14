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
export async function uploadWeightImage(batchId, { uri, materialId, enteredWeight }) {
  const fd = await buildImageForm(uri);
  fd.append('material_id', String(materialId));
  fd.append('entered_weight', String(enteredWeight));
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
