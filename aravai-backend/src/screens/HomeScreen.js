import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { COLORS, GRADIENT, fmt } from '../theme';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';
import useLayout from '../hooks/useLayout';
import FadeIn from '../components/FadeIn';
import FeatureCard from '../components/FeatureCard';

const total = (path, params) => api.get(path, { params: { ...params, limit: 1 } }).then((r) => r.data.data.total);
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

// Glass stat tile. On phones the three tiles share the row equally (icon on top) so nothing overflows.
function Stat({ icon, color, value, label, phone }) {
  return (
    <View style={[s.stat, phone ? s.statPhone : s.statWide]}>
      <View style={[s.statIcon, { backgroundColor: color }]}><MCI name={icon} size={phone ? 16 : 18} color="#fff" /></View>
      <View style={phone ? { marginTop: 8 } : null}>
        <Text style={s.statVal}>{value === undefined ? '–' : fmt(value)}</Text>
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, logout, can } = useAuth();
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  const { width, isWide, isPhone } = useLayout();
  const [m, setM] = useState({});
  const [v, setV] = useState({});
  const [q, setQ] = useState('');

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

  // columns: phones 2 compact cards, tablets 3, desktop up to 5
  const pad = isWide ? 40 : isPhone ? 8 : 20;
  const contentW = width - (isWide ? 250 : 0) - pad * 2;
  const cols = Math.max(2, Math.min(5, Math.floor(contentW / (isPhone ? 150 : 225))));

  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map((g) => {
    const items = g.modules
      .map((key, i) => ({ ...MENU.find((x) => x.module === key), stage: i + 1 }))
      .filter((it) => it.module && can(it.module, 'view'));
    return { ...g, total: items.length, items: items.filter((it) => !needle || it.label.toLowerCase().includes(needle)) };
  }).filter((g) => g.total && g.items.length), [needle, user]); // eslint-disable-line

  const caption = (it) => {
    if (it.module === 'material') return m.total === undefined ? 'Open' : `${fmt(m.total)} materials`;
    if (it.module === 'vendor') return v.total === undefined ? 'Open' : `${fmt(v.total)} vendors`;
    if (it.screen) return 'Open';
    return 'Coming soon';
  };
  const open = (it) => (it.screen ? navigation.navigate(it.screen) : toast(`${it.label} will be available in an upcoming phase`));

  const quick = [
    can('material', 'create') && { label: 'Add Material', icon: 'package-variant-plus', go: () => navigation.navigate('MaterialList', { openAdd: true }) },
    can('vendor', 'create') && { label: 'Add Vendor', icon: 'store-plus', go: () => navigation.navigate('VendorList', { openAdd: true }) },
    can('material', 'view') && !!m.low && { label: `${fmt(m.low)} low stock`, icon: 'alert-circle', go: () => navigation.navigate('MaterialList', { lowOnly: true }), warn: true },
  ].filter(Boolean);

  const showStats = can('material', 'view') || can('vendor', 'view');

  return (
    <View style={s.wrap}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[s.hero, { paddingTop: insets.top + (isWide ? 24 : 12), paddingHorizontal: isWide ? 32 : 16 }]}>
          {/* soft decorative glows */}
          <View style={s.glow1} /><View style={s.glow2} />
          <Text style={s.spice} pointerEvents="none">🌶️</Text>

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
            <Text style={s.date}>{today()}</Text>
            <Text style={[s.title, isPhone && { fontSize: 23 }]} numberOfLines={2}>{greeting()}, {user.full_name} 👋</Text>
            <Text style={s.sub}>Here is your factory at a glance.</Text>
          </FadeIn>

          {showStats && (
            <View style={[s.statsRow, isWide && s.statsRowWide]}>
              {can('material', 'view') && <Stat phone={isPhone} icon={ICON.materials} color="#0E7490" value={m.total} label="Materials" />}
              {can('material', 'view') && <Stat phone={isPhone} icon={ICON.low} color="#16A34A" value={m.low} label="Low stock" />}
              {can('vendor', 'view') && <Stat phone={isPhone} icon={ICON.vendors} color="#7C3AED" value={v.total} label="Vendors" />}
            </View>
          )}

          <View style={[s.search, isWide && { width: 320, alignSelf: 'flex-start' }]}>
            <MCI name="magnify" size={20} color={COLORS.primary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search modules..." placeholderTextColor="#9A8F88"
              autoCapitalize="none" autoCorrect={false} style={s.searchInput} />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={10}><MCI name="close-circle" size={18} color={COLORS.grey} /></Pressable>}
          </View>

          {!!quick.length && !needle && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: isWide ? 0 : -16 }}
              contentContainerStyle={{ paddingHorizontal: isWide ? 0 : 16 }}>
              {quick.map((a) => (
                <Pressable key={a.label} onPress={a.go} style={[s.quick, a.warn && s.quickWarn]}>
                  <MCI name={a.icon} size={16} color={a.warn ? '#7F1212' : '#fff'} />
                  <Text style={[s.quickText, a.warn && { color: '#7F1212' }]}>{a.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </LinearGradient>

        <View style={{ paddingHorizontal: pad - 7 > 0 ? pad - 7 : 0, maxWidth: 1600, width: '100%', alignSelf: 'center' }}>
          {groups.map((g, gi) => (
            <View key={g.title}>
              <View style={s.secRow}>
                <View style={[s.secIcon, { backgroundColor: g.color }]}><MCI name={g.icon} size={18} color="#fff" /></View>
                <Text style={s.secTitle} numberOfLines={1}>{g.title}</Text>
                <View style={[s.count, { backgroundColor: `${g.color}1F` }]}><Text style={[s.countText, { color: g.color }]}>{g.total}</Text></View>
                <View style={[s.secLine, { backgroundColor: `${g.color}33` }]} />
              </View>
              <View style={s.grid}>
                {g.items.map((it, i) => (
                  <FadeIn key={it.module} delay={gi * 60 + i * 40} from={16} style={{ width: `${100 / cols}%`, padding: isPhone ? 5 : 7 }}>
                    <FeatureCard compact={isPhone} title={it.label} caption={caption(it)} icon={ICON[it.module]} color={g.color} ready={!!it.screen} onPress={() => open(it)} />
                  </FadeIn>
                ))}
              </View>
            </View>
          ))}
          {!groups.length && (
            <View style={s.noneBox}>
              <MCI name="magnify-close" size={42} color={COLORS.grey} />
              <Text style={s.none}>No modules match “{q}”</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f8f2f2' },
  hero: { paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden',
    elevation: 6, shadowColor: '#7F1212', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  glow1: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.08)', top: -90, right: -60 },
  glow2: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(242,169,0,0.18)', bottom: -70, left: -50 },
  spice: { position: 'absolute', right: 14, bottom: 6, fontSize: 84, opacity: 0.12 },

  mobileBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  miniLogo: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E0', marginRight: 8 },
  mobileBrand: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  btnGhost: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },

  date: { color: '#FFD9A0', fontSize: 13, fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 3 },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 13.5, fontWeight: '500', marginTop: 4 },

  statsRow: { flexDirection: 'row', marginTop: 16, marginHorizontal: -4 },
  statsRowWide: { alignSelf: 'flex-start' },
  stat: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', marginHorizontal: 4 },
  statPhone: { flex: 1, padding: 11 },
  statWide: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, minWidth: 150 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  statVal: { color: '#fff', fontSize: 19, fontWeight: '900', lineHeight: 22 },
  statLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700' },

  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, height: 46, marginTop: 14,
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14.5, color: COLORS.text, outlineStyle: 'none' },

  quick: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 20, paddingHorizontal: 13, height: 36, marginRight: 8 },
  quickWarn: { backgroundColor: '#FFD9A0', borderColor: '#FFD9A0' },
  quickText: { color: '#fff', fontWeight: '800', fontSize: 12.5, marginLeft: 6 },

  secRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 6, paddingHorizontal: 8 },
  secIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  secTitle: { fontSize: 19, fontWeight: '900', color: COLORS.text, flexShrink: 1 },
  count: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, marginLeft: 8 },
  countText: { fontSize: 11, fontWeight: '900' },
  secLine: { flex: 1, height: 1.5, borderRadius: 1, marginLeft: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  noneBox: { alignItems: 'center', marginTop: 40 },
  none: { textAlign: 'center', color: COLORS.grey, marginTop: 8, fontWeight: '700' },
});
