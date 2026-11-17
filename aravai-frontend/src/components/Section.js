import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import FadeIn from './FadeIn';
import { COLORS, SHADOW } from '../theme';

// White rounded card with a coloured title - groups form fields
export default function Section({ title, icon, delay = 0, children }) {
  return (
    <FadeIn delay={delay} style={[s.card, SHADOW.sm]}>
      <View style={s.head}>
        <View style={s.iconBox}><Text style={{ fontSize: 16 }}>{icon}</Text></View>
        <Text style={s.title}>{title}</Text>
      </View>
      {children}
    </FadeIn>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBox: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { marginLeft: 10, fontSize: 16, fontWeight: '800', color: COLORS.text },
});
