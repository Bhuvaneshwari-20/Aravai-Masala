// Small helpers shared by the Blending and Packing forms.
const pad = (n) => String(n).padStart(2, '0');

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const nowHHmm = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// '' / junk -> 0
export const num = (x) => (x === '' || x == null || Number.isNaN(Number(x)) ? 0 : Number(x));
export const r3 = (n) => Math.round(n * 1000) / 1000;
let seq = 0;
export const nextKey = () => { seq += 1; return `k${seq}`; };