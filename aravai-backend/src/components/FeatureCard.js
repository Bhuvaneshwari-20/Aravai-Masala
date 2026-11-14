import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { COLORS } from '../theme';

// Colourful module card. `color` = the group's accent colour.
export default function FeatureCard({ title, caption, icon, color = COLORS.green, ready, onPress, compact }) {
  return (
    <PressableScale onPress={onPress} to={0.98} style={[s.card, { borderColor: `${color}33` }]}>
      <View style={[s.top, compact && s.topC, { backgroundColor: `${color}14` }]}>
        <MCI name={icon} size={92} color={color} style={s.watermark} />
        <LinearGradient colors={[color, `${color}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.tile, compact && s.tileC]}>
          <MCI name={icon} size={compact ? 22 : 26} color="#fff" />
        </LinearGradient>
        <View style={[s.chip, { backgroundColor: ready ? COLORS.ok : '#fff' }]}>
          <Text style={[s.chipText, { color: ready ? '#fff' : color }]}>{ready ? 'READY' : 'SOON'}</Text>
        </View>
      </View>
      <View style={[s.body, compact && { padding: 11, paddingTop: 10 }]}>
        <Text style={[s.title, compact && { fontSize: 14 }]} numberOfLines={1}>{title}</Text>
        <View style={s.foot}>
          <Text style={[s.sub, ready && { color }]} numberOfLines={1}>{caption}</Text>
          <View style={[s.go, { backgroundColor: ready ? color : `${color}22` }]}>
            <MCI name="arrow-right" size={14} color={ready ? '#fff' : color} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1,
    elevation: 2, shadowColor: '#2B1B14', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  top: { height: 84, padding: 12, flexDirection: 'row', justifyContent: 'space-between', overflow: 'hidden' },
  topC: { height: 68, padding: 10 },
  tileC: { width: 40, height: 40, borderRadius: 12 },
  watermark: { position: 'absolute', right: -14, bottom: -22, opacity: 0.12 },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  chip: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  body: { padding: 14, paddingTop: 12 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sub: { flex: 1, fontSize: 12, color: COLORS.grey, fontWeight: '600', marginRight: 8 },
  go: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
