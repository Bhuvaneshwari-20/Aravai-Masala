import React from 'react';
import { View, ScrollView, Pressable, StyleSheet, Image } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { MENU, groupsForRole } from '../menu';
import { ICON } from '../icons';
import { SIDEBAR_W } from '../hooks/useLayout';

const GOLD = '#F2A900';
const DARK = '#3A1010';
const LOGO = require('../../assets/chilli-logo.png');
const DECO = require('../../assets/banner-spices.jpg');

// Persistent left navigation (web / wide screens): maroon gradient, gold section labels with a rule,
// solid gold pill for the active page, chilli / spice decoration at the bottom.
// Role levels: Super Admin = all sections, Admin = Masters + Stock & Reports, User = Production only.
export default function Sidebar({ navRef, current }) {
  const { user, can, logout } = useAuth();
  const { toast } = useUi();
    const groups = groupsForRole(user.role_name, user.explicit)
    .map((g) => ({ ...g, items: g.modules.map((m) => MENU.find((x) => x.module === m)).filter((m) => m && can(m.module, 'view')) }))
    .filter((g) => g.items.length);

  const go = (item) => {
    if (!item.screen) return toast(`${item.label} will be available in an upcoming phase`);
    if (navRef.isReady()) navRef.navigate(item.screen);
  };
  // Products & Recipes is one page now, so the old Recipe screens also light up this entry
  const isActive = (item) => !!item.screen && current.startsWith(item.screen.replace('List', ''));
  const homeOn = current === 'Home';

  // gold = solid gold pill (Dashboard), otherwise a soft highlight with a gold marker
  const Row = ({ on, gold, icon, label, soon, onPress, chevron }) => (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ hovered }) => [s.row, hovered && !on && s.rowHover, on && !gold && s.rowOn, on && gold && s.rowGold]}>
      {on && !gold && <View style={s.bar} />}
      <View style={s.iconBox}><MCI name={icon} size={19} color={on ? (gold ? DARK : GOLD) : '#FFFFFF'} /></View>
      <Text style={[s.rowText, on && !gold && s.rowTextOn, on && gold && { color: DARK, fontWeight: '900' }]} numberOfLines={2}>{label}</Text>
      {soon && <View style={s.soon}><Text style={s.soonText}>SOON</Text></View>}
      {!soon && chevron && !on && <MCI name="chevron-right" size={18} color="rgba(255,255,255,0.55)" />}
    </Pressable>
  );

  return (
    <LinearGradient colors={['#7A0F1C', '#5E0A15', '#3E0710']} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={s.wrap}>
      {/* spice decoration at the bottom, fades into the maroon */}
      <View pointerEvents="none" style={s.deco}>
        <Image source={DECO} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        <LinearGradient colors={['#3E0710', '#3E0710D9', '#3E071000']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </View>

      <View style={s.brand}>
        <View style={s.brandLogo}><Image source={LOGO} style={{ width: 30, height: 30 }} resizeMode="contain" /></View>
        <View>
          <Text style={s.brandName}>ARAVAI MASALA</Text>
          <Text style={s.brandSub}>Manufacturing Suite</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <Row on={homeOn} gold icon="view-dashboard" label="Dashboard" onPress={() => navRef.isReady() && navRef.navigate('Home')} />
        {groups.map((g) => (
          <View key={g.title} style={{ marginTop: 18 }}>
            <View style={s.labelRow}>
              <Text style={s.label}>{g.title.toUpperCase()}</Text>
              <View style={s.labelLine} />
            </View>
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
  wrap: { width: SIDEBAR_W, height: '100%' },
  deco: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 210, opacity: 0.85 },
  brand: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18 },
  brandLogo: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#FFF4E0', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  brandName: { color: '#fff', fontWeight: '900', fontSize: 14.5, letterSpacing: 1.3 },
  brandSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', marginTop: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginLeft: 12, marginRight: 6 },
  label: { color: GOLD, fontSize: 11.5, fontWeight: '900', letterSpacing: 1.1 },
  labelLine: { flex: 1, height: 1, backgroundColor: 'rgba(242,169,0,0.55)', marginLeft: 10 },
  iconBox: { width: 24, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, marginBottom: 2, overflow: 'hidden' },
  rowHover: { backgroundColor: 'rgba(255,255,255,0.07)' },
  rowOn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  rowGold: { backgroundColor: GOLD },
  bar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3.5, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: GOLD },
  rowText: { flex: 1, marginLeft: 12, color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '700', letterSpacing: 0.1 },
  rowTextOn: { color: '#FFD98A', fontWeight: '900' },
  soon: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  soonText: { fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: '800', letterSpacing: 0.7 },
  footer: { flexDirection: 'row', alignItems: 'center', margin: 12, padding: 10, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: DARK, fontWeight: '900', fontSize: 16 },
  name: { fontWeight: '800', color: '#fff', fontSize: 13.5 },
  role: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  logout: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
