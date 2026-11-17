import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { COLORS, GRADIENT, SHADOW, fmt } from '../theme';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';
import useLayout from '../hooks/useLayout';
import FadeIn from '../components/FadeIn';
import FeatureCard from '../components/FeatureCard';
import useLoop from '../hooks/useLoop';

const total = (path, params) => api.get(path, { params: { ...params, limit: 1 } }).then((r) => r.data.data.total);
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

// waving hand next to the greeting
function Wave({ size }) {
  const w = useLoop(380, 600);
  const rot = w.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '22deg'] });
  return <Animated.Text style={{ fontSize: size, marginLeft: 8, transform: [{ rotate: rot }] }}>👋</Animated.Text>;
}

export default function HomeScreen({ navigation }) {
  const { user, logout, can } = useAuth();
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { isWide, isPhone, isTiny, pad, contentWidth } = useLayout();
  const [m, setM] = useState({});
  const [v, setV] = useState({});
  const floatA = useLoop(2600);
  const pulseA = useLoop(3200);
  const pulseB = useLoop(3800, 600);

  useFocusEffect(useCallback(() => {
    let on = true;
    const pull = (jobs, setter) => Promise.allSettled(jobs.map(([k, p]) => p.then((n) => [k, n]))).then((res) => {
      if (!on) return;
      const o = {};
      res.forEach((x) => { if (x.status === 'fulfilled') o[x.value[0]] = x.value[1]; });
      setter((prev) => ({ ...prev, ...o }));
    });
    if (can('material', 'view')) {
      pull([['total', total('/materials')], ['low', total('/materials', { active: 'true', low_stock: 'true' })]], setM);
    }
    if (can('vendor', 'view')) pull([['total', total('/vendors')]], setV);
    return () => { on = false; };
  }, [])); // eslint-disable-line

  // columns: tiny phones 1-2, phones 2, tablets 3, desktop up to 5
  const gutter = isPhone ? 10 : 14;
  const usable = contentWidth - pad * 2;
  const cols = Math.max(isTiny ? 1 : 2, Math.min(5, Math.floor((usable + gutter) / ((isPhone ? 150 : 270) + gutter))));

  const needle = '';
  const groups = useMemo(() => GROUPS.map((g) => {
    const items = g.modules
      .map((key, i) => ({ ...MENU.find((x) => x.module === key), stage: i + 1 }))
      .filter((it) => it.module && can(it.module, 'view'));
    return { ...g, total: items.length, items: items.filter((it) => !needle || it.label.toLowerCase().includes(needle)) };
  }).filter((g) => g.total && g.items.length), [needle, user]); // eslint-disable-line

  const caption = (it) => {
    if (it.module === 'material') return m.total === undefined ? 'Open module' : `${fmt(m.total)} materials`;
    if (it.module === 'vendor') return v.total === undefined ? 'Open module' : `${fmt(v.total)} vendors`;
    if (it.screen) return 'Open module';
    return `Stage ${it.stage} • Coming soon`;
  };
  const open = (it) => (it.screen ? navigation.navigate(it.screen) : toast(`${it.label} will be available in an upcoming phase`));

  const first = (user.full_name || '').split(' ')[0] || user.full_name;

  return (
    <View style={s.wrap}>
      {focused && <StatusBar style="light" />}
      <ScrollView contentContainerStyle={{ paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[s.hero, { paddingTop: insets.top + (isWide ? 28 : 14), paddingHorizontal: pad, paddingBottom: 30 }]}>
          <Animated.View style={[s.glow1, { transform: [{ scale: pulseA.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] }]} />
          <Animated.View style={[s.glow2, { transform: [{ scale: pulseB.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }] }]} />
          <Animated.Text style={[s.spice, { transform: [{ translateY: floatA.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) }, { rotate: floatA.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '8deg'] }) }] }]} pointerEvents="none">🌶️</Animated.Text>
          <View style={s.heroInner}>
            {!isWide && (
              <View style={s.mobileBar}>
                <View style={s.miniLogo}><Text style={{ fontSize: 16 }}>🌶️</Text></View>
                <Text style={s.mobileBrand}>ARAVAI MASALA</Text>
                <View style={{ flex: 1 }} />
                <Pressable style={s.btnGhost} onPress={logout} accessibilityLabel="Logout" hitSlop={8}>
                  <MCI name="logout" size={18} color="#fff" />
                </Pressable>
              </View>
            )}

            <FadeIn from={10}>
              <View style={s.datePill}><MCI name="calendar-today" size={12} color="#FFE2B0" /><Text style={s.date}>{today()}</Text></View>
              <View style={s.greetRow}>
                <Text style={[s.title, isPhone && { fontSize: isTiny ? 22 : 26 }]} numberOfLines={2}>{greeting()}, {first}</Text>
                <Wave size={isPhone ? (isTiny ? 22 : 26) : 32} />
              </View>
              <Text style={s.sub}>Here is your factory at a glance.</Text>
            </FadeIn>

          </View>
        </LinearGradient>

        <View style={[s.body, { paddingHorizontal: pad }]}>
          {groups.map((g, gi) => (
            <View key={g.title}>
              <FadeIn delay={gi * 80} from={10}><View style={s.secRow}>
                <View style={[s.secIcon, { backgroundColor: `${g.color}1A` }]}><MCI name={g.icon} size={19} color={g.color} /></View>
                <Text style={s.secTitle} numberOfLines={1}>{g.title}</Text>
                <View style={[s.count, { backgroundColor: `${g.color}18` }]}><Text style={[s.countText, { color: g.color }]}>{g.total}</Text></View>
              </View></FadeIn>
              <View style={[s.grid, { marginHorizontal: -gutter / 2 }]}>
                {g.items.map((it, i) => (
                  <View key={it.module} style={{ width: `${100 / cols}%`, padding: gutter / 2 }}>
                    <FeatureCard compact={isPhone} delay={gi * 90 + i * 60} title={it.label} caption={caption(it)} icon={ICON[it.module]} color={g.color} ready={!!it.screen} onPress={() => open(it)} />
                  </View>
                ))}
              </View>
            </View>
          ))}
          {!groups.length && (
            <View style={s.noneBox}>
              <MCI name="magnify-close" size={44} color="#C9BEB5" />
              <Text style={s.none}>No modules available</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  hero: { borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: 'hidden' },
  heroInner: { width: '100%', maxWidth: 1600, alignSelf: 'center' },
  glow1: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(255,255,255,0.07)', top: -120, right: -70 },
  glow2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(242,169,0,0.16)', bottom: -90, left: -50 },
  spice: { position: 'absolute', right: 18, bottom: 40, fontSize: 96, opacity: 0.1 },

  mobileBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  miniLogo: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E0', marginRight: 9 },
  mobileBrand: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.3 },
  btnGhost: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },

  datePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  date: { color: '#FFE2B0', fontSize: 12, fontWeight: '800', marginLeft: 6 },
  greetRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 10 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -0.5, flexShrink: 1 },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, fontWeight: '500', marginTop: 4 },

  controls: { marginTop: 18 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 15, paddingHorizontal: 14, height: 48, ...SHADOW.md },
  searchInput: { flex: 1, marginLeft: 9, fontSize: 14.5, color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  quick: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 22, paddingHorizontal: 14, height: 40, marginRight: 8 },
  quickWarn: { backgroundColor: '#FFD9A0', borderColor: '#FFD9A0' },
  quickText: { color: '#fff', fontWeight: '800', fontSize: 13, marginLeft: 7 },

  body: { width: '100%', maxWidth: 1600, alignSelf: 'center', paddingTop: 6 },
    secRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 8 },
  secIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  secTitle: { fontSize: 19, fontWeight: '900', color: COLORS.text, flexShrink: 1, letterSpacing: -0.2 },
  count: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 10 },
  countText: { fontSize: 11.5, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  noneBox: { alignItems: 'center', marginTop: 50 },
  none: { textAlign: 'center', color: COLORS.grey, marginTop: 10, fontWeight: '700' },
});
