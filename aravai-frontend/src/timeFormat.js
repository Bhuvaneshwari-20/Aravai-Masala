import { useEffect, useState } from 'react';
import { storage } from './storage';

// 12-hour (08:30 PM) or 24-hour / railway (20:30) time on the phone.
// The value stored and sent to the server is ALWAYS 24-hour 'HH:MM' - only what the user sees and types changes.
const p2 = (n) => String(n).padStart(2, '0');
const guess12 = () => { try { return /am|pm/i.test(new Date(2020, 0, 1, 13, 0).toLocaleTimeString()); } catch (e) { return false; } };

let is12 = guess12();
const subs = new Set();
storage.get('time_fmt').then((v) => { if (v === '12' || v === '24') { is12 = v === '12'; subs.forEach((f) => f()); } }).catch(() => {});

export const uses12h = () => is12;
export const setUses12h = (v) => { is12 = !!v; storage.set('time_fmt', v ? '12' : '24').catch(() => {}); subs.forEach((f) => f()); };
export function useTimeFmt() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return is12;
}

export const fmtHM = (h, m) => (is12 ? `${p2(((h + 11) % 12) + 1)}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}` : `${p2(h)}:${p2(m)}`);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function split12(hhmm) {
  if (!TIME_RE.test(hhmm || '')) return { text: '', ap: 'AM' };
  const [h, m] = hhmm.split(':').map(Number);
  return { text: `${p2(((h + 11) % 12) + 1)}:${p2(m)}`, ap: h >= 12 ? 'PM' : 'AM' };
}
export function join12(text, ap) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  if (!m) return '';
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h < 1 || h > 12 || mi > 59) return '';
  return `${p2((h % 12) + (ap === 'PM' ? 12 : 0))}:${p2(mi)}`;
}