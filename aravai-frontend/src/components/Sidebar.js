import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';

// Persistent left navigation (web / wide screens): dark spice gradient, colour-coded module groups
export default function Sidebar({ navRef, current }) {
  const { user, can, logout } = useAuth();
  const { toast } = useUi();
  const [open, setOpen] = useState({ Masters: true, Production: true });
  const groups = GROUPS.map((g) => ({ ...g, items: g.modules.map((m) => MENU.find((x) => x.module === m)).filter((m) => m && can(m.module, 'view')) }))
    .filter((g) => g.items.length);

  const go = (item) => {
    if (!item.screen) return toast(`${item.label} will be available in an upcoming phase`);
    if (navRef.isReady()) navRef.navigate(item.screen);
  };
  const isActive = (item) => !!item.screen && current.startsWith(item.screen.replace('List', ''));
  const homeOn = current === 'Home';

  return (
    <LinearGradient colors={['#3B0A0A', '#5C1212', '#2E1A12']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={s.wrap}>
      <ScrollView contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
        <View style={s.brand}>
          <View style={s.brandLogo}><Text style={{ fontSize: 20 }}>🌶️</Text></View>
          <View>
            <Text style={s.brandName}>ARAVAI MASALA</Text>
            <Text style={s.brandSub}>Manufacturing</Text>
          </View>
        </View>

        <View style={s.user}>
          <View style={s.avatar}><Text style={s.avatarText}>{(user.full_name || '?').charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{user.full_name}</Text>
            <View style={s.rolePill}><Text style={s.role}>{user.role_name}</Text></View>
          </View>
        </View>

        <Pressable style={[s.home, homeOn && s.homeOn]} onPress={() => navRef.isReady() && navRef.navigate('Home')}>
          <MCI name="home-variant" size={19} color={homeOn ? '#3B0A0A' : '#FFD9A0'} />
          <Text style={[s.homeText, homeOn && { color: '#3B0A0A' }]}>Home</Text>
        </Pressable>

        <Text style={s.label}>MODULES</Text>
        {groups.map((g) => {
          const isOpen = !!open[g.title];
          return (
            <View key={g.title} style={s.group}>
              <Pressable style={s.groupHead} onPress={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>
                <View style={[s.groupIcon, { backgroundColor: g.color }]}>
                  <MCI name={g.icon} size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.groupTitle}>{g.title}</Text>
                  <Text style={s.groupSub}>{g.items.length} modules</Text>
                </View>
                <MCI name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color="rgba(255,255,255,0.6)" />
              </Pressable>
              {isOpen && g.items.map((item) => {
                const on = isActive(item);
                return (
                  <Pressable key={item.module} style={({ hovered }) => [s.row, hovered && s.rowHover, on && { backgroundColor: g.color }]} onPress={() => go(item)}>
                    <View style={[s.dot, { backgroundColor: on ? 'rgba(255,255,255,0.25)' : `${g.color}55` }]}>
                      <MCI name={ICON[item.module]} size={15} color="#fff" />
                    </View>
                    <Text style={[s.rowText, on && { fontWeight: '800' }]} numberOfLines={1}>{item.label}</Text>
                    {!item.screen && <View style={s.soon}><Text style={s.soonText}>SOON</Text></View>}
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <Pressable style={s.logout} onPress={logout}>
          <MCI name="logout" size={18} color="#3B0A0A" />
          <Text style={s.logoutText}>Logout</Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { width: 250 },
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  brandLogo: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF3E0', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  brandName: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 1.2 },
  brandSub: { color: '#FFD9A0', fontSize: 11, fontWeight: '600', marginTop: 1 },
  user: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 14, padding: 10, marginBottom: 12 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2A900', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#3B0A0A', fontWeight: '900', fontSize: 16 },
  name: { fontWeight: '800', color: '#fff', fontSize: 13.5 },
  rolePill: { alignSelf: 'flex-start', backgroundColor: 'rgba(242,169,0,0.22)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1, marginTop: 3 },
  role: { color: '#FFD9A0', fontSize: 10.5, fontWeight: '800' },
  home: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 16 },
  homeOn: { backgroundColor: '#FFD9A0' },
  homeText: { marginLeft: 10, color: '#fff', fontWeight: '800', fontSize: 14 },
  label: { color: 'rgba(255,255,255,0.45)', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, marginBottom: 8, marginLeft: 4 },
  group: { marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingBottom: 4, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', padding: 10 },
  groupIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  groupTitle: { fontWeight: '800', color: '#fff', fontSize: 13.5 },
  groupSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 7, marginHorizontal: 6, marginBottom: 2, borderRadius: 10 },
  rowHover: { backgroundColor: 'rgba(255,255,255,0.09)' },
  dot: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rowText: { color: 'rgba(255,255,255,0.92)', fontSize: 13.5, flex: 1, fontWeight: '600' },
  soon: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  soonText: { fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: '800', letterSpacing: 0.6 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFD9A0', borderRadius: 12, paddingVertical: 11, marginTop: 10 },
  logoutText: { color: '#3B0A0A', fontWeight: '900', marginLeft: 8 },
});
