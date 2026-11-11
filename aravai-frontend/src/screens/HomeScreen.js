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

// Small stat tile in the red header
function Stat({ icon, color, value, label }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: color }]}><MCI name={icon} size={18} color="#fff" /></View>
      <View>
        <Text style={s.statVal}>{value === undefined ? '–' : fmt(value)}</Text>
        <Text style={s.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, logout, can } = useAuth();
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  const { width } = useLayout();
  const wide = width >= 900;
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

  const contentW = width - (wide ? 250 : 0) - (wide ? 56 : 24);
  const cols = Math.max(2, Math.min(5, Math.floor(contentW / 255)));

  // groups -> visible module cards (permission + search filtered)
  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map((g) => {
    const items = g.modules
      .map((key, i) => ({ ...MENU.find((x) => x.module === key), stage: i + 1 }))
      .filter((it) => it.module && can(it.module, 'view'));
    return { ...g, total: items.length, items: items.filter((it) => !needle || it.label.toLowerCase().includes(needle)) };
  }).filter((g) => g.total && g.items.length), [needle, user]); // eslint-disable-line

  const caption = (it) => {
    if (it.module === 'material') return m.total === undefined ? 'Open' : `${fmt(m.total)} materials available`;
    if (it.module === 'vendor') return v.total === undefined ? 'Open' : `${fmt(v.total)} vendors available`;
    return `Stage ${it.stage} • Coming soon`;
  };
  const open = (it) => (it.screen ? navigation.navigate(it.screen) : toast(`${it.label} will be available in an upcoming phase`));

  return (
    <View style={s.wrap}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, { paddingTop: insets.top + (wide ? 22 : 14), paddingHorizontal: wide ? 28 : 14 }]}>

          {/* Brand + logout only on mobile (on wide screens the sidebar already shows them) */}
          {!wide && (
            <View style={s.mobileBar}>
              <View style={s.miniLogo}><Text style={{ fontSize: 16 }}>🌶️</Text></View>
              <Text style={s.mobileBrand}>ARAVAI MASALA</Text>
              <View style={{ flex: 1 }} />
              <Pressable style={s.btnGhost} onPress={logout}><MCI name="logout" size={16} color="#fff" /></Pressable>
            </View>
          )}

          <Text style={s.date}>{today()}</Text>
          <Text style={[s.title, !wide && { fontSize: 24 }]} numberOfLines={1}>Welcome back, {user.full_name}</Text>
          <Text style={s.sub}>Here is your factory at a glance.</Text>

          <View style={[s.statsRow, wide && { justifyContent: 'space-between' }]}>
            <View style={s.stats}>
              {can('material', 'view') && <Stat icon={ICON.materials} color="#0E7490" value={m.total} label="Materials" />}
              {can('material', 'view') && <Stat icon={ICON.low} color="#16A34A" value={m.low} label="Low stock" />}
              {can('vendor', 'view') && <Stat icon={ICON.vendors} color="#7C3AED" value={v.total} label="Vendors" />}
            </View>
            <View style={[s.search, wide ? { width: 260 } : { width: '100%', marginTop: 12 }]}>
              <MCI name="magnify" size={18} color={COLORS.primary} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search modules..." placeholderTextColor="#9A8F88"
                autoCapitalize="none" autoCorrect={false} style={s.searchInput} />
              {!!q && <Pressable onPress={() => setQ('')}><MCI name="close-circle" size={16} color={COLORS.grey} /></Pressable>}
            </View>
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: wide ? 20 : 4 }}>
          {groups.map((g, gi) => (
            <View key={g.title}>
              <View style={s.secRow}>
                <View style={[s.secIcon, { backgroundColor: g.color }]}><MCI name={g.icon} size={18} color="#fff" /></View>
                <Text style={s.secTitle}>{g.title}</Text>
                <View style={[s.count, { backgroundColor: `${g.color}1F` }]}><Text style={[s.countText, { color: g.color }]}>{g.total}</Text></View>
                <View style={[s.secLine, { backgroundColor: `${g.color}33` }]} />
              </View>
              <View style={s.grid}>
                {g.items.map((it, i) => (
                  <FadeIn key={it.module} delay={gi * 60 + i * 40} from={16} style={{ width: `${100 / cols}%`, padding: 7 }}>
                    <FeatureCard title={it.label} caption={caption(it)} icon={ICON[it.module]} color={g.color} ready={!!it.screen} onPress={() => open(it)} />
                  </FadeIn>
                ))}
              </View>
            </View>
          ))}
          {!groups.length && <Text style={s.none}>No modules match “{q}”</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8F6F3' },
  hero: { paddingBottom: 20, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, overflow: 'hidden' },

  mobileBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  miniLogo: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF3E0', marginRight: 8 },
  mobileBrand: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  btnGhost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 10, padding: 8 },

  date: { color: '#FFD9A0', fontSize: 13, fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '900', color: '#fff', marginTop: 3 },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 13.5, fontWeight: '500', marginTop: 4 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 18 },
  stats: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, marginRight: 10, marginBottom: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  statVal: { color: '#fff', fontSize: 17, fontWeight: '900', lineHeight: 20 },
  statLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10.5, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13.5, color: COLORS.text, outlineStyle: 'none' },

  secRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 6, paddingHorizontal: 8 },
  secIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  secTitle: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  count: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, marginLeft: 8 },
  countText: { fontSize: 11, fontWeight: '900' },
  secLine: { flex: 1, height: 1.5, borderRadius: 1, marginLeft: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  none: { textAlign: 'center', color: COLORS.grey, marginTop: 40, fontWeight: '700' },
});