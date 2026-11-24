
import React from 'react';
import { View, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Portal } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useLayout, { SIDEBAR_W } from '../hooks/useLayout';
import { COLORS, SHADOW } from '../theme';

// Prevent plain strings from being rendered directly inside View.
const renderSafeContent = (node) => {
  return React.Children.map(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      if (String(child).trim() === '') return child;
      return <Text>{String(child)}</Text>;
    }

    if (!React.isValidElement(child)) return child;

    if (child.type === Text) return child;

    if (child.props?.children !== undefined) {
      return React.cloneElement(child, {
        children: renderSafeContent(child.props.children),
      });
    }

    return child;
  });
};

// Shared popup. Desktop = centred dialog, phone = bottom sheet with grab handle.
// `color` tints the header icon tile (same prop as before, so existing forms keep working).
export default function ModalShell({ visible, onDismiss, title, subtitle, icon = 'package-variant', color = COLORS.primary,
  maxWidth = 600, centerInContent, busy, footer, noPad, children }) {
  const { isPhone, isWide } = useLayout();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  const tint = color === COLORS.primaryDark ? COLORS.primary : color;

  return (
    <Portal>
      <KeyboardAvoidingView
        style={[s.overlay, isPhone && s.overlayPhone, centerInContent && isWide && { paddingLeft: 16 + SIDEBAR_W * 0.5 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={s.backdrop} onPress={busy ? undefined : onDismiss} />

        <View style={[s.card, SHADOW.lg, { maxWidth }, isPhone && s.cardPhone]}>
          {isPhone && <View style={s.grab}><View style={s.grabBar} /></View>}

          <View style={s.head}>
            <View style={[s.headIcon, { backgroundColor: `${tint}18` }]}>
              <MCI name={icon} size={22} color={tint} />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.headTitle} numberOfLines={1}>{title}</Text>
              {!!subtitle && <Text style={s.headSub} numberOfLines={1}>{subtitle}</Text>}
            </View>

            <Pressable
              onPress={onDismiss}
              disabled={busy}
              accessibilityLabel="Close"
              hitSlop={8}
              style={({ hovered }) => [s.close, hovered && { backgroundColor: COLORS.primarySoft }]}
            >
              <MCI name="close" size={20} color={COLORS.textSoft} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={noPad ? null : s.body}
            keyboardShouldPersistTaps="handled"
          >
            {renderSafeContent(children)}
          </ScrollView>

          {!!footer && (
            <View style={[s.foot, isPhone && { paddingBottom: 14 + insets.bottom }]}>
              {renderSafeContent(footer)}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Portal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16 },
  overlayPhone: { justifyContent: 'flex-end', padding: 0 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,12,8,0.5)' },
  card: { width: '100%', maxHeight: '92%', backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden' },
  cardPhone: { maxWidth: '100%', maxHeight: '94%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  grab: { alignItems: 'center', paddingTop: 10 },
  grabBar: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#DDD2C8' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  headIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  headSub: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  body: { padding: 20, paddingBottom: 10 },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', padding: 14, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: COLORS.line, backgroundColor: '#FCFAF7' },
});
