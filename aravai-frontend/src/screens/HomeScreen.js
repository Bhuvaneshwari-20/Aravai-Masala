import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Image, ImageBackground, TextInput } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg'; // npx expo install react-native-svg
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { SHADOW, fmt } from '../theme';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';
import useLayout from '../hooks/useLayout';
import FadeIn from '../components/FadeIn';
import FeatureCard from '../components/FeatureCard';

// ---- assets (copy the "assets" folder into your project) ----
const BANNER = require('../../assets/banner-spices.jpg');
const LOGO = require('../../assets/chilli-logo.png');

const C = {
  bg: '#FBF5EE', card: '#FFFFFF', maroon: '#8A1020', maroonDark: '#6B0A17', gold: '#F2A900',
  ink: '#2A1D1B', mute: '#8B7B76', line: '#F1E3D3', green: '#2E9E5B', red: '#D93B3B',
};

// ---- SAMPLE DATA (no endpoint yet): Finished Stock card and the 7-day trend ----
const DEMO = {
  finishedKg: '1,980 kg', finishedDelta: '+4.8%',
  trend: [['13 Nov', 700], ['14 Nov', 900], ['15 Nov', 1300], ['16 Nov', 1500], ['17 Nov', 1900], ['18 Nov', 2100], ['19 Nov', 2450]],
};
const FLOW = [
  ['Batching', 'scale-balance'], ['Filtering', 'filter-variant'], ['Roasting', 'fire'],
  ['Grinding', 'blender'], ['Blending', 'flask-outline'], ['Packing', 'package-variant-closed'],
];

const total = (path, params) => api.get(path, { params: { ...params, limit: 1 } }).then((r) => r.data.data.total);
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// stock of KG materials as is, GRAM materials / 1000  ->  total kg
const sumKg = (items) => Math.round(items.reduce((a, i) => {
  const u = String(i.unit || '').toUpperCase();
  return a + (u === 'KG' ? Number(i.current_stock) : u === 'GRAM' ? Number(i.current_stock) / 1000 : 0);
}, 0) * 100) / 100;

function Card({ children, style }) { return <View style={[s.card, style]}>{children}</View>; }
function CardTitle({ icon, title, right, onRight, pill }) {
  return (
    <View style={s.cardHead}>
      <MCI name={icon} size={20} color={C.maroon} />
      <Text style={s.cardTitle}>{title}</Text>
      <View style={{ flex: 1 }} />
      {right ? (
        <Pressable onPress={onRight} style={pill ? s.pill : null}>
          <Text style={s.link}>{right} {pill ? '⌄' : '→'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Kpi({ icon, tint, label, value, delta }) {
  return (
    <LinearGradient colors={['#FFFFFF', `${tint}1A`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.kpi}>
      <View style={[s.kpiIcon, { backgroundColor: `${tint}26` }]}><MCI name={icon} size={24} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.kpiLabel} numberOfLines={1}>{label}</Text>
        <Text style={s.kpiValue} numberOfLines={1}>{value}</Text>
        {delta ? <Text style={[s.kpiDelta, { color: C.green }]}>↑ {delta}</Text> : null}
      </View>
    </LinearGradient>
  );
}

function Donut({ data, size = 150, stroke = 24, title, sub }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const sum = data.reduce((a, d) => a + d[1], 0) || 1;
  let acc = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.line} strokeWidth={stroke} fill="none" />
        {data.map(([n, val, col]) => {
          const len = (val / sum) * circ;
          const el = len > 0 ? (
            <Circle
              key={n} cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth={stroke} fill="none"
              strokeDasharray={`${Math.max(len - 2, 0)} ${circ}`} strokeDashoffset={-acc}
              rotation={-90} origin={`${size / 2}, ${size / 2}`}
            />
          ) : null;
          acc += len;
          return el;
        })}
      </Svg>
      <View style={s.donutCenter} pointerEvents="none">
        <Text style={s.donutTitle}>{title}</Text>
        <Text style={s.donutSub}>{sub}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, logout, can } = useAuth();
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { isWide, isPhone, isTiny, pad, contentWidth } = useLayout();
  const [d, setD] = useState({});
  const [q, setQ] = useState('');

  // live numbers; each card fills in as its request finishes, a failed / not permitted one stays "—"
  useFocusEffect(useCallback(() => {
    let on = true;
    const job = (key, p) => p.then((val) => { if (on) setD((prev) => ({ ...prev, [key]: val })); }).catch(() => {});
    if (can('material', 'view')) {
      job('materials', total('/materials'));
      job('stockKg', api.get('/material-overview/summary').then((r) => sumKg(r.data.data.items || [])));
    }
    if (can('vendor', 'view')) job('vendors', total('/vendors'));
    if (can('recipe', 'view')) job('recipes', total('/recipes', { active: 'true' }));
    if (can('product', 'view')) job('products', total('/products'));
    if (can('batching', 'view')) {
      job('inProgress', total('/batches', { status: 'IN_PROGRESS' }));
      job('completed', total('/batches', { status: 'COMPLETED' }));
      job('hold', total('/batches', { status: 'ON_HOLD' }));
      job('open', total('/batches', { status: 'OPEN' }));
    }
    return () => { on = false; };
  }, [])); // eslint-disable-line

  const first = (user.full_name || '').split(' ')[0] || user.full_name;
  const goStage = (name) => {
    const it = MENU.find((x) => x.label && x.label.toLowerCase().includes(name.toLowerCase()) && x.screen);
    return it ? navigation.navigate(it.screen) : toast(`${name} will be available in an upcoming phase`);
  };

  // module grid (kept for phones, where there is no sidebar)
  const gutter = 10;
  const usable = contentWidth - pad * 2;
  const cols = Math.max(isTiny ? 1 : 2, Math.min(5, Math.floor((usable + gutter) / (150 + gutter))));
  const groups = useMemo(() => GROUPS.map((g) => {
    const items = g.modules.map((key, i) => ({ ...MENU.find((x) => x.module === key), stage: i + 1 })).filter((it) => it.module && can(it.module, 'view'));
    return { ...g, total: items.length, items };
  }).filter((g) => g.total), [user]); // eslint-disable-line
  const caption = (it) => {
    if (it.module === 'material') return d.materials === undefined ? 'Open module' : `${fmt(d.materials)} materials`;
    if (it.module === 'vendor') return d.vendors === undefined ? 'Open module' : `${fmt(d.vendors)} vendors`;
    return it.screen ? 'Open module' : `Stage ${it.stage} • Coming soon`;
  };
  const open = (it) => (it.screen ? navigation.navigate(it.screen) : toast(`${it.label} will be available in an upcoming phase`));

  // KPI values
  const dash = (x, f = (y) => y) => (x === undefined ? '—' : f(x));
  const recipesValue = d.recipes === undefined ? '—' : d.products === undefined ? fmt(d.recipes) : `${fmt(d.recipes)} / ${fmt(d.products)}`;

  // batch status donut (Pending = on hold + open)
  const pending = (d.hold || 0) + (d.open || 0);
  const done = d.completed || 0;
  const running = d.inProgress || 0;
  const batchTotal = done + running + pending;
  const status = [['Completed', done, C.green], ['In Progress', running, C.gold], ['Pending', pending, C.red]];

  // trend chart maths: 0 .. niceMax in steps of 500 kg
  const CH = 150;
  const maxBar = Math.max(...DEMO.trend.map((t) => t[1]));
  const niceMax = Math.max(1000, Math.ceil(maxBar / 1000) * 1000);
  const ticks = [];
  for (let t = niceMax; t >= 0; t -= 500) ticks.push(t);
  const last = DEMO.trend.length - 1;
  const row = isWide ? 'row' : 'column';

  return (
    <View style={s.wrap}>
      {focused && <StatusBar style="dark" />}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: '100%', paddingHorizontal: pad, paddingTop: insets.top + 10 }}>

          {/* top bar */}
          <View style={s.topBar}>
            {!isWide && (<><Image source={LOGO} style={{ width: 30, height: 28 }} resizeMode="contain" />
              <View style={{ marginLeft: 8 }}>
                <Text style={s.brand}>ARAVAI MASALA</Text>
                <Text style={s.brandSub}>Manufacturing Management</Text>
              </View></>)}
            {isWide && (
              <View style={s.search}>
                <MCI name="magnify" size={20} color={C.mute} />
                <TextInput value={q} onChangeText={setQ} placeholder="Search batch, product, material…" placeholderTextColor={C.mute} style={s.searchInput} />
              </View>
            )}
            <View style={{ flex: 1 }} />
            <View style={s.bell}><MCI name="bell-outline" size={20} color={C.ink} /><View style={s.dot} /></View>
            <Pressable style={s.user} onPress={logout} accessibilityLabel="Logout">
              <View style={s.avatar}><MCI name="account" size={18} color="#fff" /></View>
              {!isPhone && <Text style={s.userName}>{first}</Text>}
              <MCI name="logout" size={17} color={C.mute} style={{ marginLeft: isPhone ? 0 : 6 }} />
            </Pressable>
          </View>

          {/* welcome banner */}
          <FadeIn from={10}>
            <ImageBackground source={BANNER} resizeMode="cover" style={[s.banner, { height: isPhone ? 130 : 150 }]} imageStyle={{ borderRadius: 20 }}>
              <LinearGradient
                colors={['#FBF1E4', '#FBF1E4F0', '#FBF1E400']}
                locations={[0, 0.4, 0.72]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: isPhone ? '88%' : '62%' }}>
                <View style={[s.bannerIcon, isPhone && { width: 52, height: 52 }]}><MCI name="cog-outline" size={isPhone ? 28 : 38} color="#fff" /></View>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[s.welcome, isPhone && { fontSize: 17 }]}>Welcome to</Text>
                  <Text style={[s.welcomeBrand, isPhone && { fontSize: 22 }]}>ARAVAI MASALA</Text>
                  <Text style={s.welcomeSub}>Manufacturing & Production Management</Text>
                </View>
              </View>
            </ImageBackground>
          </FadeIn>

          {/* KPI row */}
          <View style={s.kpiRow}>
            {[
              ['cube-outline', '#2E9E5B', 'Material Stock', dash(d.stockKg, (x) => `${num(x)} kg`), null],
              ['book-open-variant', '#7B4BD6', 'Active Recipes', recipesValue, null],
              ['layers-triple-outline', '#E8942A', 'Batches in Process', dash(d.inProgress), null],
              ['warehouse', '#2F80ED', 'Finished Stock', DEMO.finishedKg, DEMO.finishedDelta],
            ].map(([icon, tint, label, value, delta]) => (
              <View key={label} style={{ width: isPhone ? '50%' : '25%', padding: 5 }}>
                <Kpi icon={icon} tint={tint} label={label} value={value} delta={delta} />
              </View>
            ))}
          </View>

          {/* production flow */}
          <Card>
            <CardTitle icon="layers-outline" title="Production Flow" right="View Batches" onRight={() => goStage('Batching')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.flow}>
              {FLOW.map(([name, icon], i) => (
                <React.Fragment key={name}>
                  <Pressable style={s.flowItem} onPress={() => goStage(name)}>
                    <View style={s.flowCircle}><MCI name={icon} size={26} color="#E8742A" /></View>
                    <Text style={s.flowLabel}>{name}</Text>
                  </Pressable>
                  {i < FLOW.length - 1 && <Text style={s.arrow}>→</Text>}
                </React.Fragment>
              ))}
            </ScrollView>
          </Card>

          {/* trend + batch status */}
          <View style={{ flexDirection: row, marginHorizontal: -6 }}>
            <Card style={[s.col, { flex: isWide ? 1.5 : undefined }]}>
              <CardTitle icon="chart-bar" title="Production Trend (Last 7 Days)" />
              <View style={{ flexDirection: 'row', marginTop: 6 }}>
                <View style={{ height: CH + 12, marginTop: -6, justifyContent: 'space-between', marginRight: 8 }}>
                  {ticks.map((t) => <Text key={t} style={s.yLabel}>{num(t)} kg</Text>)}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ height: CH }}>
                    {ticks.map((t, i) => <View key={t} style={[s.gridLine, { top: (i / (ticks.length - 1)) * CH }]} />)}
                    <View style={s.bars}>
                      {DEMO.trend.map(([dt, val], i) => (
                        <View key={dt} style={s.barCol}>
                          {i === last && <View style={s.tip}><Text style={s.tipText}>{num(val)} kg</Text></View>}
                          <LinearGradient colors={['#C42B3B', '#F6A9B0']} style={[s.bar, { height: Math.max(8, (val / niceMax) * CH) }]} />
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: 4 }}>
                    {DEMO.trend.map(([dt]) => (
                      <Text key={dt} style={s.barLabel} numberOfLines={1}>{isPhone ? dt.slice(0, 2) : dt}</Text>
                    ))}
                  </View>
                </View>
              </View>
            </Card>

            <Card style={[s.col, { flex: isWide ? 1 : undefined }]}>
              <CardTitle icon="chart-donut" title="Batch Status" />
              <View style={s.donutRow}>
                <Donut data={status} title={d.inProgress === undefined && d.completed === undefined ? '—' : String(batchTotal)} sub="Batches" />
                <View style={{ flex: 1, minWidth: 130, marginLeft: 16 }}>
                  {status.map(([n, val, col]) => (
                    <View key={n} style={s.legend}>
                      <View style={[s.legendDot, { backgroundColor: col }]} />
                      <Text style={s.legendText}>{n}</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={s.legendPct}>{val}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          </View>

          {/* phone only: module list (no sidebar on phones) */}
          {isPhone && groups.map((g, gi) => (
            <View key={g.title}>
              <FadeIn delay={gi * 80} from={10}>
                <View style={s.secRow}>
                  <View style={[s.secIcon, { backgroundColor: `${g.color}1A` }]}><MCI name={g.icon} size={19} color={g.color} /></View>
                  <Text style={s.secTitle} numberOfLines={1}>{g.title}</Text>
                </View>
              </FadeIn>
              <View style={[s.grid, { marginHorizontal: -gutter / 2 }]}>
                {g.items.map((it, i) => (
                  <View key={it.module} style={{ width: `${100 / cols}%`, padding: gutter / 2 }}>
                    <FeatureCard compact delay={gi * 90 + i * 60} title={it.label} caption={caption(it)} icon={ICON[it.module]} color={g.color} ready={!!it.screen} onPress={() => open(it)} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  brand: { fontSize: 14, fontWeight: '900', color: C.maroon, letterSpacing: 0.8 },
  brandSub: { fontSize: 10.5, color: C.ink },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, height: 42, width: 400 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13.5, color: C.ink, outlineStyle: 'none', minWidth: 0 },
  bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, marginRight: 10 },
  dot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: C.red },
  user: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 4, paddingRight: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.maroon, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  userName: { fontWeight: '800', color: C.ink, fontSize: 13 },

  banner: { alignSelf: 'stretch', width: '100%', borderRadius: 20, paddingHorizontal: 22, justifyContent: 'center', overflow: 'hidden', backgroundColor: '#FBF1E4' },
  bannerIcon: { width: 68, height: 68, borderRadius: 18, backgroundColor: C.maroon, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  welcome: { fontSize: 22, fontWeight: '700', color: C.ink },
  welcomeBrand: { fontSize: 32, fontWeight: '900', color: C.maroonDark, letterSpacing: 0.5 },
  welcomeSub: { fontSize: 13.5, color: C.ink, marginTop: 4 },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginTop: 8 },
  kpi: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line, ...SHADOW.md },
  kpiIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  kpiLabel: { fontSize: 12, color: C.ink, fontWeight: '600' },
  kpiValue: { fontSize: 22, fontWeight: '900', color: C.ink, marginTop: 1 },
  kpiDelta: { fontSize: 11.5, fontWeight: '800', marginTop: 1 },

  card: { backgroundColor: C.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.line, marginTop: 12, ...SHADOW.md },
  col: { marginHorizontal: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '900', color: C.ink, marginLeft: 8 },
  link: { fontSize: 12, fontWeight: '800', color: C.maroon },
  pill: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#fff' },

  flow: { alignItems: 'center', justifyContent: 'space-between', flexGrow: 1, paddingHorizontal: 6, paddingVertical: 8, backgroundColor: '#FDF4EA', borderRadius: 16 },
  flowItem: { alignItems: 'center', width: 96 },
  flowCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FCE3C8', alignItems: 'center', justifyContent: 'center' },
  flowLabel: { marginTop: 6, fontSize: 13, fontWeight: '800', color: C.ink },
  arrow: { fontSize: 20, color: C.red, marginBottom: 20, marginHorizontal: 2, fontWeight: '900' },

  yLabel: { fontSize: 9.5, color: C.mute, height: 12, lineHeight: 12 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.line },
  bars: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '62%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.ink },
  tip: { backgroundColor: C.red, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 5 },
  tipText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },

  donutRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 6 },
  donutCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  donutTitle: { fontSize: 24, fontWeight: '900', color: C.ink },
  donutSub: { fontSize: 12, color: C.ink, fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  legendDot: { width: 11, height: 11, borderRadius: 6, marginRight: 8 },
  legendText: { fontSize: 13.5, color: C.ink, fontWeight: '600' },
  legendPct: { fontSize: 13.5, color: C.ink, fontWeight: '800' },

  secRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 8 },
  secIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  secTitle: { fontSize: 18, fontWeight: '900', color: C.ink, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
