import { Platform } from 'react-native';
import { COLORS } from './theme';
import { API_URL } from './config';
import { getToken } from './api';

// Status of a weighing transaction, in the order of the workflow.
export const W_STATUS = {
  PENDING: { label: 'PENDING', color: COLORS.grey, bg: COLORS.greyBg },
  MACHINE_CONFIRMED: { label: 'MACHINE CONFIRMED', color: COLORS.green, bg: COLORS.greenBg },
  WEIGHT_ENTERED: { label: 'WEIGHT ENTERED', color: COLORS.warn, bg: COLORS.warnBg },
  IMAGE_UPLOADED: { label: 'IMAGE UPLOADED', color: COLORS.warn, bg: COLORS.warnBg },
  VERIFIED: { label: 'MATCH', color: COLORS.ok, bg: COLORS.okBg },
  MISMATCH: { label: 'MISMATCH', color: COLORS.danger, bg: COLORS.dangerBg },
  UNREADABLE: { label: 'UNREADABLE', color: COLORS.warn, bg: COLORS.warnBg },
  REJECTED: { label: 'REJECTED', color: COLORS.danger, bg: COLORS.dangerBg },
};
export const wStatus = (s) => W_STATUS[s] || W_STATUS.PENDING;
export const W_STATUS_OPTIONS = [{ value: '', label: 'All' },
  ...Object.keys(W_STATUS).map((k) => ({ value: k, label: W_STATUS[k].label.charAt(0) + W_STATUS[k].label.slice(1).toLowerCase() }))];

export const W_UNITS = [{ value: 'KG', label: 'KG' }, { value: 'G', label: 'G' }];

// up to 6 digits before and 3 after the decimal point
export const WEIGHT_RE = /^\d{1,6}(\.\d{1,3})?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const fmtW = (v, unit = 'KG') => (v === null || v === undefined || v === '' ? '-' : `${Number(v).toFixed(3)} ${unit}`);

// One id per submit attempt: the server uses it to ignore a double tap / retry (no duplicate transactions).
export const newRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Protected image. Same ?token= convention the CSV reports already use, so it also works in the web build.
export const imageUri = (t) => (t && t.has_image
  ? `${API_URL}/weighing/transactions/${t.id}/image?token=${encodeURIComponent(getToken() || '')}&v=${t.image_version || 0}`
  : null);

// File name / mime type that match the real file (a PNG is no longer announced as image/jpeg). Falls back to JPEG.
const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
function imageMeta(uri, blobType) {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(uri || ''));
  const byExt = m ? IMG_MIME[m[1].toLowerCase()] : null;
  const type = (blobType && /^image\//.test(blobType) ? blobType : byExt) || 'image/jpeg';
  const ext = Object.keys(IMG_MIME).find((k) => IMG_MIME[k] === type) || 'jpg';
  return { type, name: `weight.${ext}` };
}

// Multipart body for the weight photo (native needs { uri, name, type }, web needs a Blob).
// The file is sent exactly as the camera / picker produced it: no resize, crop or re-compression happens here.
export async function buildImageForm(uri, field = 'image') {
  const fd = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const { name } = imageMeta(uri, blob.type);
    fd.append(field, blob, name);
  } else {
    const { name, type } = imageMeta(uri);
    fd.append(field, { uri, name, type });
  }
  return fd;
}

// axios config for the upload: bigger timeout than the 10s default (photo + OCR on a slow WiFi)
export const uploadCfg = Platform.OS === 'web' ? { timeout: 60000 } : { timeout: 60000, headers: { 'Content-Type': 'multipart/form-data' } };