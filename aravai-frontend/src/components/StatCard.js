import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { COLORS, SHADOW } from '../theme';

// KPI chip with a pastel tint of its own colour. `active` = selected filter (stronger ring).
export default function StatCard({ icon, color = COLORS.primary, value, label, hint, onPress, active, compact }) {
  return (
    <PressableScale onPress={onPress} disabled={!onPress} to={0.97}
      style={[s.card, SHADOW.sm, compact && s.cardC, { backgroundColor: '#fff', borderColor: COLORS.border }, active && { borderColor: color, backgroundColor: `${color}0F` }]}>
      <View style={[s.icon, { backgroundColor: `${color}1F` }, compact && s.iconC]}>
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
  card: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1 },
  cardC: { flexDirection: 'column', alignItems: 'flex-start', padding: 12, borderRadius: 16 },
  icon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  iconC: { width: 36, height: 36, borderRadius: 18 },
  value: { fontSize: 26, fontWeight: '900', color: COLORS.text, lineHeight: 28 },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.textSoft, marginTop: 1 },
  hint: { fontSize: 11, fontWeight: '800', marginTop: 2 },
});
