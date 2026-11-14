// Machine QR token: random, permanent, stored in machine_master.qr_token.
// The QR image encodes  <APP_URL>/machine/<token>  so a phone camera opens the app on that machine.
// (links <APP_URL>/m/<token> are read too)
const crypto = require('crypto');
const AppError = require('./AppError');

const newToken = () => crypto.randomBytes(16).toString('hex'); // 128 bits, 32 chars, URL-safe
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

// The scanner may hand us the full URL (what the QR contains) or just the token.
function extractToken(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (TOKEN_RE.test(raw)) return raw;
  const m = /\/(?:machine|m)\/([A-Za-z0-9_-]{8,64})\/?(?:[?#].*)?$/.exec(raw);
  return m ? m[1] : null;
}

function appUrl() {
  const base = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(base); } catch { u = null; }
  if (!u || !['http:', 'https:'].includes(u.protocol)) {
    throw new AppError('APP_URL is not configured on the server (e.g. APP_URL=https://app.yourdomain.com). The QR code needs it to open the app', 500);
  }
  // a phone can never reach the server's own "localhost": refuse to build (and so to print) such a QR
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '[::1]' || h === '::1' || /^127\./.test(h)) {
    throw new AppError(`APP_URL (${base}) points to "${h}", which a phone cannot open. Set APP_URL to the server's LAN IP or public domain, then restart the API`, 500);
  }
  return base;
}
const qrUrl = (token) => `${appUrl()}/machine/${token}`;

module.exports = { newToken, extractToken, qrUrl, appUrl, TOKEN_RE };
