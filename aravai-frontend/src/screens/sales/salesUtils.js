import { todayStr } from '../../productionUtils';
import { COLORS } from '../../theme';

// Small helpers shared by every Sales screen.
const pad = (n) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---- months: 'YYYY-MM' ----
export const monthOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthStart = (m) => `${m}-01`;
export const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(y, mo, 0).getDate())}`; };
export const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return monthOf(new Date(y, mo - 1 + n, 1)); };
export const monthLabel = (m, short) => {
  const [y, mo] = String(m).split('-').map(Number);
  return short ? `${MON[mo - 1]} ${String(y).slice(2)}` : `${FULL[mo - 1]} ${y}`;
};
export const recentMonths = (count = 24) => Array.from({ length: count }, (_, i) => {
  const m = shiftMonth(monthOf(), -i);
  return { value: m, label: monthLabel(m) };
});

// ---- dates ----
export const niceDate = (s) => {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d} ${MON[Number(m) - 1]} ${y}`;
};
export const shortDay = (s) => {
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)} ${MON[Number(m) - 1]}`;
};

// quick ranges used by the filter bar
export const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'all', label: 'All time' },
];
export const rangeDates = (key) => {
  const cur = monthOf();
  if (key === 'today') { const t = todayStr(); return { from: t, to: t }; }
  if (key === 'month') return { from: monthStart(cur), to: monthEnd(cur) };
  if (key === 'last') { const l = shiftMonth(cur, -1); return { from: monthStart(l), to: monthEnd(l) }; }
  return { from: '', to: '' };
};

// ---- numbers ----
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// ₹ 1.25 L style, for chart axes and tight tiles
export const compactMoney = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const trim = (x) => x.toFixed(2).replace(/\.?0+$/, '');
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
};
export const profitColor = (v) => (Number(v) > 0 ? COLORS.ok : Number(v) < 0 ? COLORS.danger : COLORS.text);

// ---- labels ----
export const skuLabel = (s) => `${s.product_name} · ${s.packing_size_label}`;
export const CUSTOMER_TYPES = [{ value: 'CUSTOMER', label: 'Customer' }, { value: 'AGENCY', label: 'Agency' }];
export const RETURN_REASONS = ['Damaged / torn pack', 'Leakage', 'Expired / near expiry', 'Quality complaint', 'Wrong item supplied', 'Excess stock returned', 'Other']
  .map((r) => ({ value: r, label: r }));
export const RETURN_TYPES = [{ value: 'REFUND', label: 'Refund' }, { value: 'REPLACEMENT', label: 'Replacement' }];
export const RETURN_STATUS = [{ value: 'PENDING', label: 'Pending' }, { value: 'COMPLETED', label: 'Completed' }];
export const CONDITIONS = [{ value: 'RESALABLE', label: 'Resalable (add back to stock)' }, { value: 'DAMAGED', label: 'Damaged (do not add to stock)' }];
export const typeText = (t) => (t === 'REPLACEMENT' ? 'Replacement' : 'Refund');
export const statusTone = (st) => (st === 'COMPLETED' ? 'ok' : 'warn');
export const statusText = (type, st) => `${type === 'REPLACEMENT' ? 'Replacement' : 'Refund'} ${st === 'COMPLETED' ? (type === 'REPLACEMENT' ? 'sent' : 'paid') : 'pending'}`;
