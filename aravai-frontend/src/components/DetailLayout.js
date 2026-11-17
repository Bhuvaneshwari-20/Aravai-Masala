import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FadeIn from './FadeIn';
import Container from './Container';
import useLayout from '../hooks/useLayout';
import { COLORS, SHADOW } from '../theme';

export const Pill = ({ text, color, bg }) => (
  <View style={{ backgroundColor: bg, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 4, marginRight: 8, marginBottom: 4 }}>
    <Text style={{ color, fontWeight: '800', fontSize: 11, letterSpacing: 0.3 }}>{text}</Text>
  </View>
);

export function ActionBtn({ icon, label, onPress, color = COLORS.primary, outline }) {
  const { isPhone } = useLayout();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ hovered, pressed }) => [s.btn, isPhone ? s.btnPhone : { marginLeft: 8 },
        outline ? { borderColor: color, backgroundColor: hovered ? `${color}0F` : '#fff' } : { backgroundColor: color, borderColor: color },
        pressed && { opacity: 0.85 }]}>
      <MCI name={icon} size={18} color={outline ? color : '#fff'} />
      <Text style={[s.btnText, { color: outline ? color : '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// Header card: soft colour wash, tile, title/subtitle/pills, action buttons (full width row on phones).
export function DetailHeader({ color, tile, title, subtitle, pills, actions }) {
  const { isWide, isPhone, pad } = useLayout();
  return (
    <Container maxWidth={900}>
      <FadeIn style={[s.head, SHADOW.sm, { margin: pad, marginBottom: 12 }]}>
        <View style={[s.wash, { backgroundColor: `${color}14` }]} />
        <View style={[s.headBody, !isWide && { flexDirection: 'column', alignItems: 'stretch' }]}>
          <View style={s.left}>
            <View style={[s.tile, { backgroundColor: '#fff', borderColor: `${color}33` }, SHADOW.sm]}>{tile}</View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.title, isPhone && { fontSize: 20 }]}>{title}</Text>
              {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
            </View>
          </View>
          {!!pills && <View style={s.pills}>{pills}</View>}
          {!!actions && <View style={[s.actions, !isWide && { marginTop: 14 }]}>{actions}</View>}
        </View>
      </FadeIn>
    </Container>
  );
}

// Card of label/value rows (2 columns on wide screens)
export function InfoCard({ title, rows }) {
  const { isWide, pad } = useLayout();
  return (
    <Container maxWidth={900}>
      <FadeIn delay={120} style={[s.info, SHADOW.sm, { marginHorizontal: pad }]}>
        <Text style={s.infoTitle}>{title}</Text>
        <View style={s.grid}>
          {rows.map((r) => (
            <View key={r.label} style={[s.cell, { width: isWide ? '50%' : '100%' }]}>
              <View style={s.cellIcon}><Text style={{ fontSize: 17 }}>{r.icon}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
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
  head: { backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  wash: { position: 'absolute', left: 0, right: 0, top: 0, height: 78 },
  headBody: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', padding: 18 },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 220 },
  tile: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 14, borderWidth: 1.5 },
  title: { fontSize: 23, fontWeight: '900', color: COLORS.text, letterSpacing: -0.3 },
  subtitle: { color: COLORS.textSoft, fontWeight: '700', marginTop: 2, fontSize: 13.5 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, width: '100%' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', width: '100%', marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, height: 44, paddingHorizontal: 16, marginBottom: 4 },
  btnPhone: { flex: 1, marginRight: 8, minWidth: 120 },
  btnText: { fontWeight: '800', marginLeft: 7, fontSize: 14 },
  info: { backgroundColor: '#fff', borderRadius: 22, marginBottom: 12, padding: 18, borderWidth: 1, borderColor: COLORS.border },
  infoTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: COLORS.grey, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingRight: 12 },
  cellIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FBF3EC', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cellLabel: { color: COLORS.grey, fontSize: 12, fontWeight: '700' },
  cellValue: { color: COLORS.text, fontSize: 15, fontWeight: '800', marginTop: 1 },
});
