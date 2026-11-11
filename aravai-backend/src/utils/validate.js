const AppError = require('./AppError');

const clean = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

function reqStr(v, label, max) {
  const s = clean(v);
  if (!s) throw new AppError(`${label} is required`);
  if (s.length > max) throw new AppError(`${label} must be at most ${max} characters`);
  return s;
}

function optStr(v, label, max) {
  const s = clean(v);
  if (s && s.length > max) throw new AppError(`${label} must be at most ${max} characters`);
  return s;
}

// Empty -> 0. Rejects text, negative and absurdly big numbers.
function num(v, label, { max = 99999999999, decimals = 3 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError(`${label} must be a number`);
  if (n < 0) throw new AppError(`${label} cannot be negative`);
  if (n > max) throw new AppError(`${label} is too large`);
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function toId(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`Invalid ${label}`);
  return n;
}

function toBool(v, label) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  throw new AppError(`${label} must be true or false`);
}

function paging(q) {
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

const MOBILE_RE = /^[0-9]{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

module.exports = { clean, reqStr, optStr, num, toId, toBool, paging, MOBILE_RE, EMAIL_RE, GST_RE };
