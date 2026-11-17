import { MD3LightTheme } from 'react-native-paper';

// NOTE: primary / primaryDark / text / GRADIENT are used by the Login screen - values intentionally unchanged.
export const COLORS = {
  primary: '#B01E1E',
  primaryDark: '#7F1212',
  primarySoft: '#FBECEC',
  green: '#1F5C52',
  greenBg: '#E3F1EE',
  border: '#ECE4DA',
  line: '#F2ECE4',
  accent: '#F2A900',
  accentSoft: '#FFF4D6',
  bg: '#F7F4EF',
  surface: '#FFFFFF',
  text: '#2B1B14',
  textSoft: '#5E5148',
  danger: '#C62828',
  dangerBg: '#FDECEA',
  ok: '#2E7D32',
  okBg: '#E8F5E9',
  grey: '#85786F',
  greyBg: '#F1ECE6',
  warn: '#E65100',
  warnBg: '#FFF3E0',
};

export const GRADIENT = [COLORS.primaryDark, COLORS.primary, '#D1451F'];
export const GRADIENT_DANGER = ['#7f1d1d', '#C62828', '#E55353'];

// design tokens used by the new UI
export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
export const SHADOW = {
  sm: { elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  md: { elevation: 3, shadowColor: '#2B1B14', shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  lg: { elevation: 10, shadowColor: '#2B1B14', shadowOpacity: 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: 12 } },
};

export const paperTheme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: COLORS.primary,
    secondary: COLORS.accent,
    secondaryContainer: '#F8D9D6',
    onSecondaryContainer: COLORS.primaryDark,
    background: COLORS.bg,
    surface: '#FFFFFF',
    outline: COLORS.border,
  },
};

export const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const money = (n) => `₹ ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// icon + colour per material category (matches seeded categories, falls back to spice jar)
export const categoryStyle = (name = '') => {
  const n = name.toLowerCase();
  if (n.includes('spice')) return { icon: '🌶️', color: '#B01E1E' };
  if (n.includes('pack')) return { icon: '📦', color: '#B45309' };
  if (n.includes('consum')) return { icon: '🧤', color: '#1F5C52' };
  return { icon: '🧂', color: '#6B5B95' };
};

// pads the last grid row so a lone card does not stretch full width
export const padGrid = (items, cols) => {
  if (cols < 2 || items.length % cols === 0) return items;
  const extra = cols - (items.length % cols);
  return [...items, ...Array.from({ length: extra }, (_, i) => ({ id: `pad${i}`, pad: true }))];
};

// stable pretty colour for avatars
const PALETTE = ['#B01E1E', '#B45309', '#7C3AED', '#0EA5E9', '#059669', '#DB2777', '#4F46E5', '#0F766E'];
export const colorFor = (text = '') => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 997;
  return PALETTE[h % PALETTE.length];
};
