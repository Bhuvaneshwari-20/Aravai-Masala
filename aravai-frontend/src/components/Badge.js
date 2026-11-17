import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS } from '../theme';

const TONES = {
  ok: { fg: COLORS.ok, bg: COLORS.okBg },
  danger: { fg: COLORS.danger, bg: COLORS.dangerBg },
  grey: { fg: COLORS.grey, bg: COLORS.greyBg },
  warn: { fg: COLORS.warn, bg: COLORS.warnBg },
  primary: { fg: COLORS.primary, bg: COLORS.primarySoft },
  green: { fg: COLORS.green, bg: COLORS.greenBg },
};

// Small status pill with a coloured dot:  <Badge tone="ok" text="Active" />
export default function Badge({ tone = 'grey', text, dot = true, style }) {
  const t = TONES[tone] || TONES.grey;
  return (
    <View style={[s.pill, { backgroundColor: t.bg }, style]}>
      {dot && <View style={[s.dot, { backgroundColor: t.fg }]} />}
      <Text style={[s.text, { color: t.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  text: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2, flexShrink: 1 },
});
