import React from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';
import { SIDEBAR_W } from '../hooks/useLayout';

const GOLD = '#F2A900';

// Persistent left navigation (web / wide screens). Flat, quiet, with a gold active marker.
export default function Sidebar({ navRef, current }) {
  const { user, can, logout } = useAuth();
  const { toast } = useUi();
  const groups = GROUPS.map((g) => ({ ...g, items: g.modules.map((m) => MENU.find((x) => x.module === m)).filter((m) => m && can(m.module, 'view')) }))
    .filter((g) => g.items.length);

  const go = (item) => {
    if (!item.screen) return toast(`${item.label} will be available in an upcoming phase`);
    if (navRef.isReady()) navRef.navigate(item.screen);
  };
  const isActive = (item) => !!item.screen && current.startsWith(item.screen.replace('List', ''));
  const homeOn = current === 'Home';

  const Row = ({ on, icon, label, soon, onPress, accent }) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ hovered }) => [s.row, hovered && !on && s.rowHover, on && s.rowOn]}>
      {on && <View style={s.bar} />}
      <MCI name={icon} size={19} color={on ? GOLD : '#FFFFFF'} />
      <Text style={[s.rowText, on && s.rowTextOn]} numberOfLines={1}>{label}</Text>
      {soon && <View style={s.soon}><Text style={s.soonText}>SOON</Text></View>}
      {!soon && !!accent && <View style={[s.groupDot, { backgroundColor: accent }]} />}
    </Pressable>
  );

  return (
    <LinearGradient colors={['#2E0D0D', '#3A1010', '#25100C']} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 1 }} style={s.wrap}>
      <View style={s.brand}>
        <LinearGradient colors={[GOLD, '#E58A00']} style={s.brandLogo}><Text style={{ fontSize: 20 }}>🌶️</Text></LinearGradient>
        <View>
          <Text style={s.brandName}>ARAVAI MASALA</Text>
          <Text style={s.brandSub}>Manufacturing Suite</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <Row on={homeOn} icon="view-dashboard" label="Dashboard" onPress={() => navRef.isReady() && navRef.navigate('Home')} />
        {groups.map((g) => (
          <View key={g.title} style={{ marginTop: 18 }}>
            <Text style={s.label}>{g.title.toUpperCase()}</Text>
            {g.items.map((item) => (
              <Row key={item.module} on={isActive(item)} icon={ICON[item.module]} label={item.label} soon={!item.screen} onPress={() => go(item)} />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <View style={s.avatar}><Text style={s.avatarText}>{(user.full_name || '?').charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>{user.full_name}</Text>
          <Text style={s.role} numberOfLines={1}>{user.role_name}</Text>
        </View>
        <Pressable onPress={logout} accessibilityLabel="Logout" style={({ hovered }) => [s.logout, hovered && { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
          <MCI name="logout" size={18} color="#fff" />
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { width: SIDEBAR_W },
  brand: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 20 },
  brandLogo: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  brandName: { color: '#fff', fontWeight: '900', fontSize: 14.5, letterSpacing: 1.3 },
  brandSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', marginTop: 2 },
  label: { color: '#F2A900', fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 6, marginLeft: 12 },
  row: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2, overflow: 'hidden' },
  rowHover: { backgroundColor: 'rgba(255,255,255,0.07)' },
  rowOn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  bar: { position: 'absolute', left: 0, top: 9, bottom: 9, width: 3.5, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: GOLD },
  rowText: { flex: 1, marginLeft: 12, color: '#FFFFFF', fontSize: 14.5, fontWeight: '700', letterSpacing: 0.1 },
  rowTextOn: { color: '#FFD98A', fontWeight: '900' },
  soon: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  soonText: { fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: '800', letterSpacing: 0.7 },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', margin: 12, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#3A1010', fontWeight: '900', fontSize: 16 },
  name: { fontWeight: '800', color: '#fff', fontSize: 13.5 },
  role: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  logout: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
