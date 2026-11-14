import { MD3LightTheme } from 'react-native-paper';

export const COLORS = {
  primary: '#B01E1E',
  primaryDark: '#7F1212',
  green: '#1F5C52',
  greenBg: '#E3F1EE',
  border: '#EADFD2',
  accent: '#F2A900',
  bg: '#FBF7F0',
  text: '#2B1B14',
  danger: '#C62828',
  dangerBg: '#FDECEA',
  ok: '#2E7D32',
  okBg: '#E8F5E9',
  grey: '#8A7B73',
  greyBg: '#F0EBE7',
  warn: '#E65100',
  warnBg: '#FFF3E0',
};

export const GRADIENT = [COLORS.primaryDark, COLORS.primary, '#D1451F'];
export const GRADIENT_DANGER = ['#7f1d1d', '#C62828', '#E55353'];

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
