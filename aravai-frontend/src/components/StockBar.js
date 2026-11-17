import React from 'react';
import { View } from 'react-native';
import { COLORS } from '../theme';

// Thin level bar. ratio = current / (2 x minimum) so the "minimum" mark sits at the middle.
export default function StockBar({ current, minimum, low, height = 6, style }) {
  const min = Number(minimum) || 0;
  if (min <= 0) return null;
  const pct = Math.max(0.04, Math.min(1, (Number(current) || 0) / (min * 2)));
  const color = low ? COLORS.danger : COLORS.ok;
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: COLORS.greyBg, overflow: 'hidden' }, style]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height / 2, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5, backgroundColor: 'rgba(43,27,20,0.25)' }} />
    </View>
  );
}
