import React, { useEffect, useState } from 'react';
import { View, Pressable, Keyboard, Platform, ScrollView, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import { MENU, GROUPS } from '../menu';
import { ICON } from '../icons';
import { COLORS, SHADOW } from '../theme';

// Preferred shortcuts (first ones the user may view fill the bar); everything else lives in the "More" sheet.
const PREFERRED = ['material', 'batching', 'stock', 'vendor', 'tracking'];

// Bottom navigation for phones / tablets (the sidebar takes over from 900px up).
// Home + 3 shortcuts + More (opens a sheet with every module). Hides while the keyboard is open.
export default function MobileTabBar({ navRef, current }) {
  const { user, can, logout } = useAuth();
  const { toast } = useUi();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [kb, setKb] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const ready = MENU.filter((m) => m.screen && can(m.module, 'view'));
  const picks = PREFERRED.map((k) => ready.find((m) => m.module === k)).filter(Boolean);
  ready.forEach((m) => { if (picks.length < 3 && !picks.includes(m)) picks.push(m); });
  const shortcuts = picks.slice(0, 3);

  const tabs = [
    { key: 'Home', label: 'Dashboard', icon: 'view-dashboard', screen: 'Home', match: 'Home' },
    ...shortcuts.map((m) => ({ key: m.module, label: m.label.replace(' Master', '').replace('Material Stock Card', 'Stock'), icon: ICON[m.module], screen: m.screen, match: m.screen.replace('List', '') })),
  ];
  const inTabs = tabs.some((t) => current.startsWith(t.match));

  // reset = clean tab behaviour (no piling up of screens when tapping tabs repeatedly)
  const go = (screen) => { if (navRef.isReady() && navRef.getCurrentRoute()?.name !== screen) navRef.reset({ index: 0, routes: [{ name: screen }] }); };
  const openFromSheet = (item) => {
    if (!item.screen) return toast(`${item.label} will be available in an upcoming phase`);
    setMore(false); go(item.screen);
  };

  const groups = GROUPS.map((g) => ({ ...g, items: g.modules.map((m) => MENU.find((x) => x.module === m)).filter((m) => m && can(m.module, 'view')) })).filter((g) => g.items.length);

  if (kb) return null;
  const Tab = ({ on, icon, label, onPress }) => (
    <Pressable style={s.tab} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
      <View style={[s.iconWrap, on && s.iconWrapOn]}><MCI name={icon} size={23} color={on ? COLORS.primary : COLORS.grey} /></View>
      <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={[s.bar, SHADOW.md, { paddingBottom: Math.max(insets.bottom, 6) }]}>
        {tabs.map((t) => <Tab key={t.key} on={current.startsWith(t.match)} icon={t.icon} label={t.label} onPress={() => go(t.screen)} />)}
        <Tab on={!inTabs} icon="dots-grid" label="More" onPress={() => setMore(true)} />
      </View>

      <Modal visible={more} transparent animationType="slide" onRequestClose={() => setMore(false)} statusBarTranslucent>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMore(false)} accessibilityLabel="Close menu" />
          <View style={[s.sheet, { maxHeight: height * 0.86, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={s.grab} />
            <View style={s.sheetHead}>
              <View style={s.avatar}><Text style={s.avatarText}>{(user.full_name || '?').charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{user.full_name}</Text>
                <Text style={s.role} numberOfLines={1}>{user.role_name}</Text>
              </View>
              <Pressable onPress={() => setMore(false)} style={s.close} accessibilityLabel="Close"><MCI name="close" size={20} color={COLORS.textSoft} /></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 8 }}>
              {groups.map((g) => (
                <View key={g.title} style={{ marginTop: 14 }}>
                  <View style={s.groupHead}>
                    <View style={[s.groupBar, { backgroundColor: g.color }]} />
                    <Text style={s.groupTitle}>{g.title}</Text>
                  </View>
                  <View style={s.grid}>
                    {g.items.map((it) => (
                      <Pressable key={it.module} style={s.cell} onPress={() => openFromSheet(it)} accessibilityRole="button" accessibilityLabel={it.label}>
                        <View style={[s.tile, { backgroundColor: it.screen ? `${g.color}18` : COLORS.greyBg }]}>
                          <MCI name={ICON[it.module]} size={24} color={it.screen ? g.color : '#B5AAA1'} />
                        </View>
                        <Text style={[s.cellText, !it.screen && { color: '#A99D94' }]} numberOfLines={2}>{it.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              <Pressable style={s.logout} onPress={() => { setMore(false); logout(); }}>
                <MCI name="logout" size={18} color={COLORS.danger} />
                <Text style={s.logoutText}>Logout</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#fff', paddingTop: 6, borderTopWidth: 1, borderTopColor: COLORS.border },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', minHeight: 54, paddingHorizontal: 2 },
  iconWrap: { width: 54, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: COLORS.primarySoft },
  label: { fontSize: 11, fontWeight: '700', color: COLORS.grey, marginTop: 2, maxWidth: '100%' },
  labelOn: { color: COLORS.primary, fontWeight: '900' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(28,12,8,0.5)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, width: '100%', maxWidth: 720, alignSelf: 'center', paddingTop: 10 },
  grab: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#DDD2C8', alignSelf: 'center', marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  name: { fontWeight: '800', color: COLORS.text, fontSize: 15 },
  role: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingLeft: 4 },
  groupBar: { width: 4, height: 16, borderRadius: 2, marginRight: 8 },
  groupTitle: { fontSize: 13, fontWeight: '900', color: COLORS.textSoft, letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2 },
  tile: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cellText: { marginTop: 6, fontSize: 11.5, fontWeight: '700', color: COLORS.text, textAlign: 'center', lineHeight: 14 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 14, backgroundColor: COLORS.dangerBg, marginTop: 18 },
  logoutText: { color: COLORS.danger, fontWeight: '800', marginLeft: 8 },
});
