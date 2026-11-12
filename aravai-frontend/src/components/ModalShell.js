import React from 'react';
import { View, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Portal } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useLayout from '../hooks/useLayout';
import { COLORS } from '../theme';

// Shared popup: dark backdrop, coloured header with close button, scrollable body, optional footer.
export default function ModalShell({ visible, onDismiss, title, subtitle, icon = 'package-variant', color = COLORS.primaryDark,
  maxWidth = 600, busy, footer, noPad, children }) {
  const { isPhone } = useLayout();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Portal>
      <KeyboardAvoidingView style={[s.overlay, isPhone && s.overlayPhone]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backdrop} onPress={busy ? undefined : onDismiss} />
        <View style={[s.card, { maxWidth }, isPhone && s.cardPhone]}>
          {isPhone && <View style={[s.grab, { backgroundColor: color }]}><View style={s.grabBar} /></View>}
          <View style={[s.head, { backgroundColor: color }]}>
            <View style={s.headIcon}><MCI name={icon} size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.headTitle} numberOfLines={1}>{title}</Text>
              {!!subtitle && <Text style={s.headSub} numberOfLines={1}>{subtitle}</Text>}
            </View>
            <Pressable onPress={onDismiss} disabled={busy} style={s.close}><MCI name="close" size={22} color="#fff" /></Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={noPad ? null : s.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {!!footer && <View style={[s.foot, isPhone && { paddingBottom: 14 + insets.bottom }]}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Portal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16 },
  overlayPhone: { justifyContent: 'flex-end', padding: 0 },
  cardPhone: { maxWidth: '100%', maxHeight: '94%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  grab: { alignItems: 'center', paddingTop: 8 },
  grabBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,10,8,0.55)' },
  card: { width: '100%', maxHeight: '92%', backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden',
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  headIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  headSub: { color: '#FFD9A0', fontSize: 12, fontWeight: '600', marginTop: 1 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, paddingBottom: 8 },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', padding: 14, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: '#FBF7F0' },
});
