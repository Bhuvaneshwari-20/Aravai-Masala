import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import FadeIn from './FadeIn';
import PressableScale from './PressableScale';
import { COLORS, colorFor } from '../theme';

// icon/iconColor: emoji avatar (else first letter).  badges: [{ text, color, bg }]
export default function ListItem({ title, subtitle, lines = [], badges = [], onPress, dim, index = 0, icon, iconColor }) {
  const c = iconColor || colorFor(title);
  return (
    <FadeIn delay={Math.min(index, 8) * 45} from={14} style={{ flex: 1 }}>
      <PressableScale onPress={onPress} to={0.97} style={[s.card, dim && { opacity: 0.6 }]}>
        <View style={[s.avatar, { backgroundColor: `${c}1A` }]}>
          {icon ? <Text style={{ fontSize: 24 }}>{icon}</Text>
            : <Text style={[s.avatarText, { color: c }]}>{(title || '?').trim().charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          {!!subtitle && <Text style={s.sub}>{subtitle}</Text>}
          {lines.filter(Boolean).map((l, i) => <Text key={i} style={s.line}>{l}</Text>)}
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
          {badges.map((b, i) => (
            <View key={i} style={[s.badge, { backgroundColor: b.bg }]}>
              <Text style={[s.badgeText, { color: b.color }]}>{b.text}</Text>
            </View>
          ))}
        </View>
      </PressableScale>
    </FadeIn>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginHorizontal: 12, marginVertical: 5,
    minHeight: 80, borderWidth: 1, borderColor: COLORS.border },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 20, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  sub: { color: COLORS.grey, marginTop: 2, fontSize: 13 },
  line: { marginTop: 3, color: '#4a3b34', fontSize: 13 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
