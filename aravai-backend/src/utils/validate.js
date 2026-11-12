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

// Whole number within [min, max]. undefined/empty -> `fallback` (default: undefined = "not sent").
function intRange(v, label, min, max, fallback) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

// Strictly positive number (num() allows 0).
function positive(v, label, opts) {
  const n = num(v, label, opts);
  if (n <= 0) throw new AppError(`${label} must be greater than 0`);
  return n;
}

// 'YYYY-MM-DD' calendar date. Empty -> today. Future dates are rejected unless allowFuture.
function date(v, label = 'Date', { allowFuture = false } = {}) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const s = clean(v);
  if (!s) return todayStr;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError(`${label} must be in YYYY-MM-DD format`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new AppError(`${label} is not a valid date`);
  if (!allowFuture && s > todayStr) throw new AppError(`${label} cannot be in the future`);
  return s;
}

function paging(q) {
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

const MOBILE_RE = /^[0-9]{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

module.exports = { clean, reqStr, optStr, num, intRange, positive, date, toId, toBool, paging, MOBILE_RE, EMAIL_RE, GST_RE };
