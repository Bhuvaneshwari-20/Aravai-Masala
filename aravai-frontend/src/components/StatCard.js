import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { COLORS, SHADOW } from '../theme';

// White KPI card with a tinted icon. `active` = selected filter (coloured ring).
export default function StatCard({ icon, color = COLORS.primary, value, label, hint, onPress, active, compact }) {
  return (
    <PressableScale onPress={onPress} disabled={!onPress} to={0.97} style={[s.card, SHADOW.sm, compact && s.cardC, active && { borderColor: color, backgroundColor: `${color}0D` }]}>
      <View style={[s.icon, { backgroundColor: `${color}18` }, compact && s.iconC]}>
        <MCI name={icon} size={compact ? 18 : 22} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0, marginTop: compact ? 8 : 0, marginLeft: compact ? 0 : 12 }}>
        <Text style={[s.value, compact && { fontSize: 20 }]} numberOfLines={1}>{value === undefined || value === null ? '–' : value}</Text>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        {!!hint && !compact && <Text style={[s.hint, { color }]} numberOfLines={1}>{hint}</Text>}
      </View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: COLORS.border },
  cardC: { flexDirection: 'column', alignItems: 'flex-start', padding: 12, borderRadius: 16 },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconC: { width: 34, height: 34, borderRadius: 10 },
  value: { fontSize: 24, fontWeight: '900', color: COLORS.text, lineHeight: 28 },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 1 },
  hint: { fontSize: 11, fontWeight: '800', marginTop: 2 },
});
