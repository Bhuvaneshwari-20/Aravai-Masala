import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Animated, Easing, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, Portal } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SHADOW } from '../theme';

// Side panel that slides in from the RIGHT (backdrop fades in, Esc / outside tap closes it).
export default function RightDrawer({ visible, onClose, title, subtitle, icon = 'history', width = 460, children }) {
  const { width: sw } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const w = Math.min(width, sw);
  const [mounted, setMounted] = useState(visible);
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(a, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(a, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible]); // eslint-disable-line

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!mounted) return null;
  return (
    <Portal>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(28,12,8,0.45)', opacity: a }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close panel" />
        </Animated.View>
        <Animated.View style={[s.panel, SHADOW.lg, { width: w, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [w, 0] }) }] }]}>
          <View style={[s.head, { paddingTop: 16 + insets.top }]}>
            <View style={s.headIcon}><MCI name={icon} size={22} color={COLORS.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title} numberOfLines={1}>{title}</Text>
              {!!subtitle && <Text style={s.sub} numberOfLines={1}>{subtitle}</Text>}
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={({ hovered }) => [s.close, hovered && { backgroundColor: COLORS.primarySoft }]}>
              <MCI name="close" size={20} color={COLORS.textSoft} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Animated.View>
      </View>
    </Portal>
  );
}

const s = StyleSheet.create({
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 24, borderBottomLeftRadius: 24, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  headIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { fontSize: 18, fontWeight: '900', color: COLORS.text, letterSpacing: -0.2 },
  sub: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 1 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});