import api from './api';
import { APP_URL } from './config';

// ---------------------------------------------------------------------------------------------
// The ONLY place that knows the shape of the backend qrInfo API: GET /machines/:id/qr  ->  { qr_token, qr_url, ... }
// (routes/machines.js -> machineService.qrInfo). The token is permanent and is created / stored by the backend
// (machineService + utils/qrToken.js) - the app only READS it.
// ---------------------------------------------------------------------------------------------
export const QR_INFO_PATH = (machineId) => `/machines/${encodeURIComponent(machineId)}/qr`;

const pick = (d) => ({ token: d?.qr_token ?? d?.token ?? null, url: d?.qr_url ?? d?.url ?? null });

const cache = new Map(); // machine id -> { token, url }: the token never changes, so opening the modal again does not call the API again

const originOf = (u) => { try { return new URL(u).origin.toLowerCase(); } catch (e) { return ''; } };
const PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

// Is this URL safe to print on a sticker and scan with a phone?
// { ok:false, error }  -> do NOT print (phone can never open it)
// { ok:true,  warn }   -> printable, but tell the user (works on the factory Wi-Fi only / app origin differs)
export function checkQrUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return { ok: false, error: 'The QR link is missing or is not a valid URL. Check APP_URL in the backend .env.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'The QR link must start with http:// or https://.' };
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '[::1]' || h === '::1' || /^127\./.test(h)) {
    return { ok: false, error: `The QR link points to "${h}", which a phone cannot reach. Set APP_URL in the backend .env to the server's LAN IP or public domain.` };
  }
  if (!/\/(?:m|machine)\/[A-Za-z0-9_.~-]{3,128}\/?$/.test(u.pathname)) {
    return { ok: false, error: 'The QR link does not end in /m/<token>, so the app cannot open it.' };
  }
  let warn = '';
  if (originOf(url) !== originOf(APP_URL)) warn = `Backend APP_URL (${originOf(url)}) is different from the app's APP_URL (${originOf(APP_URL)}). The phone will not open the app from this QR until both match.`;
  else if (PRIVATE_HOST.test(h)) warn = 'This link uses a private network address: the phone must be on the same Wi-Fi as the server.';
  return { ok: true, warn };
}

// -> { token, url }. Throws a readable Error.
export async function fetchMachineQr(machine) {
  if (!machine || machine.id == null) throw new Error('Machine is not ready yet');
  const hit = cache.get(machine.id);
  if (hit) return hit;
  let r;
  try { r = await api.get(QR_INFO_PATH(machine.id)); } catch (e) {
    const status = e.response?.status;
    throw new Error(e.response?.data?.message || (status === 404 ? 'QR information is not available for this machine.' : 'Could not load the QR information. Check the connection and try again.'));
  }
  const qr = pick(r.data?.data ?? r.data);
  if (!qr.url) throw new Error('The server did not return a QR link (qr_url).');
  cache.set(machine.id, qr);
  return qr;
}
