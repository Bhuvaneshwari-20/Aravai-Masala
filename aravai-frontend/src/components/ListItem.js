import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FadeIn from './FadeIn';
import PressableScale from './PressableScale';
import { COLORS, SHADOW, colorFor } from '../theme';

// icon/iconColor: emoji avatar (else first letter).  badges: [{ text, color, bg }]
export default function ListItem({ title, subtitle, lines = [], badges = [], onPress, dim, index = 0, icon, iconColor }) {
  const c = iconColor || colorFor(title);
  return (
    <FadeIn delay={Math.min(index, 8) * 40} from={12} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} style={[s.card, SHADOW.sm, dim && { opacity: 0.6 }]}>
        <View style={[s.avatar, { backgroundColor: `${c}18` }]}>
          {icon ? <Text style={{ fontSize: 22 }}>{icon}</Text>
            : <Text style={[s.avatarText, { color: c }]}>{(title || '?').trim().charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          {!!subtitle && <Text style={s.sub} numberOfLines={1}>{subtitle}</Text>}
          {lines.filter(Boolean).map((l, i) => <Text key={i} style={s.line} numberOfLines={2}>{l}</Text>)}
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
          {badges.map((b, i) => (
            <View key={i} style={[s.badge, { backgroundColor: b.bg }]}>
              <Text style={[s.badgeText, { color: b.color }]}>{b.text}</Text>
            </View>
          ))}
        </View>
        {!!onPress && <MCI name="chevron-right" size={20} color="#C9BEB5" style={{ marginLeft: 4 }} />}
      </PressableScale>
    </FadeIn>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 14, marginHorizontal: 12, marginVertical: 5,
    minHeight: 76, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 20, fontWeight: '800' },
  title: { fontSize: 15.5, fontWeight: '800', color: COLORS.text },
  sub: { color: COLORS.grey, marginTop: 2, fontSize: 13, fontWeight: '500' },
  line: { marginTop: 3, color: COLORS.textSoft, fontSize: 13 },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  badgeText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
});
