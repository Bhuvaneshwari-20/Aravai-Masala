import React, { useEffect, useState } from 'react';
import { View, Pressable, Keyboard, Platform, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../AuthContext';
import { MENU } from '../menu';
import { ICON } from '../icons';
import { COLORS } from '../theme';

// Bottom navigation for phones / small tablets (the sidebar takes over from 900px up).
// Shows Home + every ready module the user may view. Hides itself while the keyboard is open.
export default function MobileTabBar({ navRef, current }) {
  const { can } = useAuth();
  const insets = useSafeAreaInsets();
  const [kb, setKb] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (kb) return null;

  const tabs = [
    { key: 'Home', label: 'Home', icon: 'home-variant', screen: 'Home', match: 'Home', color: COLORS.primary },
    ...MENU.filter((m) => m.screen && can(m.module, 'view')).map((m) => ({
      key: m.module, label: m.label.replace(' Master', ''), icon: ICON[m.module], screen: m.screen,
      match: m.screen.replace('List', ''), color: COLORS.primary,
    })),
  ];
  // reset = clean tab behaviour (no piling up of screens when tapping tabs repeatedly)
  const go = (t) => { if (navRef.isReady() && navRef.getCurrentRoute()?.name !== t.screen) navRef.reset({ index: 0, routes: [{ name: t.screen }] }); };

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      {tabs.map((t) => {
        const on = current.startsWith(t.match);
        return (
          <Pressable key={t.key} style={s.tab} onPress={() => go(t)} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: on }}>
            {on ? (
              <LinearGradient colors={[COLORS.primaryDark, COLORS.primary, '#D1451F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pill}>
                <MCI name={t.icon} size={20} color="#fff" />
                <Text style={s.pillText} numberOfLines={1}>{t.label}</Text>
              </LinearGradient>
            ) : (
              <View style={s.idle}>
                <MCI name={t.icon} size={23} color={COLORS.grey} />
                <Text style={s.idleText} numberOfLines={1}>{t.label}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: 8, paddingHorizontal: 6,
    borderTopWidth: 1, borderTopColor: COLORS.border, elevation: 16,
    shadowColor: '#2B1B14', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: -4 } },
  tab: { flex: 1, minWidth: 76, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, paddingHorizontal: 12, height: 38, maxWidth: '100%' },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 12.5, marginLeft: 6, flexShrink: 1 },
  idle: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  idleText: { color: COLORS.grey, fontSize: 10.5, fontWeight: '700', marginTop: 1 },
});
