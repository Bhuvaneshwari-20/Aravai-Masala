import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FadeIn from './FadeIn';
import Container from './Container';
import useLayout from '../hooks/useLayout';
import { COLORS } from '../theme';

export const Pill = ({ text, color, bg }) => (
  <View style={{ backgroundColor: bg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, marginRight: 8 }}>
    <Text style={{ color, fontWeight: '900', fontSize: 11, letterSpacing: 0.4 }}>{text}</Text>
  </View>
);

export function ActionBtn({ icon, label, onPress, color = COLORS.green, outline }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, outline ? { borderColor: color, backgroundColor: '#fff' } : { backgroundColor: color, borderColor: color }]}>
      <MCI name={icon} size={17} color={outline ? color : '#fff'} />
      <Text style={[s.btnText, { color: outline ? color : '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

// White header card: colour stripe, tile, title/subtitle/pills on the left, action buttons on the right.
export function DetailHeader({ color, tile, title, subtitle, pills, actions }) {
  const { isWide } = useLayout();
  return (
    <Container maxWidth={900}>
      <FadeIn style={s.head}>
        <View style={[s.stripe, { backgroundColor: color }]} />
        <View style={[s.headBody, !isWide && { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={s.left}>
            <View style={[s.tile, { backgroundColor: `${color}1F` }]}>{tile}</View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
              {!!pills && <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>{pills}</View>}
            </View>
          </View>
          {!!actions && <View style={[s.actions, !isWide && { marginTop: 14 }]}>{actions}</View>}
        </View>
      </FadeIn>
    </Container>
  );
}

// Card of label/value rows (2 columns on wide screens)
export function InfoCard({ title, rows }) {
  const { isWide } = useLayout();
  return (
    <Container maxWidth={900}>
      <FadeIn delay={120} style={s.info}>
        <Text style={s.infoTitle}>{title}</Text>
        <View style={s.grid}>
          {rows.map((r) => (
            <View key={r.label} style={[s.cell, { width: isWide ? '50%' : '100%' }]}>
              <View style={s.cellIcon}><Text style={{ fontSize: 16 }}>{r.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cellLabel}>{r.label}</Text>
                <Text style={s.cellValue}>{r.value || '-'}</Text>
              </View>
            </View>
          ))}
        </View>
      </FadeIn>
    </Container>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', margin: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border,
    elevation: 1, shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  stripe: { width: 6 },
  headBody: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  tile: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  subtitle: { color: COLORS.grey, fontWeight: '600', marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 10, height: 40, paddingHorizontal: 14, marginLeft: 8, marginBottom: 4 },
  btnText: { fontWeight: '800', marginLeft: 6, fontSize: 14 },
  info: { backgroundColor: '#fff', borderRadius: 18, margin: 16, marginTop: 4, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  infoTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 12 },
  cellIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#FBF3EC', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cellLabel: { color: COLORS.grey, fontSize: 12, fontWeight: '700' },
  cellValue: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: 1 },
});
