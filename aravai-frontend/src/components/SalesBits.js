import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import StatCard from './StatCard';
import { useCardCols } from './InfoCard';
import useLayout from '../hooks/useLayout';
import { COLORS, SHADOW } from '../theme';

// White panel with a small icon + title (and an optional right slot). Used for every block of the Sales pages.
export function Panel({ title, icon, right, children, style, bodyStyle }) {
  return (
    <View style={[s.panel, SHADOW.sm, style]}>
      {!!title && (
        <View style={s.panelHead}>
          {!!icon && <MCI name={icon} size={18} color={COLORS.primary} />}
          <Text style={[s.panelTitle, !icon && { marginLeft: 0 }]} numberOfLines={1}>{title}</Text>
          {!!right && <View style={{ marginLeft: 'auto' }}>{right}</View>}
        </View>
      )}
      <View style={[{ padding: 14 }, bodyStyle]}>{children}</View>
    </View>
  );
}

// Responsive grid of StatCards. items: [{ icon, color, value, label, hint }]
export function KpiGrid({ items, min = 210, phoneMin = 150 }) {
  const { isPhone } = useLayout();
  const { cols, gap, pad } = useCardCols({ min, phoneMin });
  return (
    <View style={{ paddingHorizontal: pad - gap / 2, flexDirection: 'row', flexWrap: 'wrap' }}>
      {items.map((it) => (
        <View key={it.label} style={{ width: `${100 / cols}%`, padding: gap / 2 }}>
          <StatCard compact={isPhone} icon={it.icon} color={it.color} value={it.value} label={it.label} hint={it.hint} />
        </View>
      ))}
    </View>
  );
}

// small outlined action button (icon + text)
export function SoftBtn({ icon, label, onPress, tone = COLORS.primary, filled }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered, pressed }) => [s.btn, { borderColor: tone }, filled && { backgroundColor: tone }, hovered && !filled && { backgroundColor: `${tone}12` }, pressed && { opacity: 0.85 }]}>
      <MCI name={icon} size={17} color={filled ? '#fff' : tone} />
      <Text style={[s.btnText, { color: filled ? '#fff' : tone }]}>{label}</Text>
    </Pressable>
  );
}

// label : value row (detail popups, totals)
export function KV({ label, value, color, bold }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvLabel}>{label}</Text>
      <Text style={[s.kvValue, bold && { fontWeight: '900', fontSize: 15.5 }, color && { color }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  panelHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  panelTitle: { marginLeft: 8, fontSize: 15, fontWeight: '900', color: COLORS.text, flexShrink: 1 },
  btn: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 12, paddingHorizontal: 13, borderWidth: 1.5, marginLeft: 8 },
  btnText: { marginLeft: 6, fontSize: 13, fontWeight: '800' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  kvLabel: { fontSize: 13, fontWeight: '700', color: COLORS.grey },
  kvValue: { fontSize: 13.5, fontWeight: '800', color: COLORS.text },
});
