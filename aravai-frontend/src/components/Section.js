import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import FadeIn from './FadeIn';
import { COLORS } from '../theme';

// White rounded card with a coloured title - groups form fields
export default function Section({ title, icon, delay = 0, children }) {
  return (
    <FadeIn delay={delay} style={s.card}>
      <View style={s.head}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
        <Text style={s.title}>{title}</Text>
      </View>
      {children}
    </FadeIn>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 14, elevation: 2,
    shadowColor: '#7F1212', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { marginLeft: 8, fontSize: 16, fontWeight: '700', color: COLORS.primaryDark },
});
