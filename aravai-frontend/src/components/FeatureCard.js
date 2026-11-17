import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import useLoop from '../hooks/useLoop';
import { COLORS, SHADOW } from '../theme';

// blend a #rrggbb colour with white (amt 0..1) -> lighter shade for the gradient
const lighten = (hex, amt) => {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return hex;
  const c = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) + (255 - parseInt(h.slice(i, i + 2), 16)) * amt));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};

// Module card on the Home screen.
//  - springs in (staggered by `delay`), the icon floats gently, lifts + tilts on hover, springs on press
//  - `color` = the group's accent colour, `ready` = false shows the greyed "SOON" version
export default function FeatureCard({ title, caption, icon, color = COLORS.green, ready, onPress, compact, delay = 0 }) {
  const [hov, setHov] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const hover = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const float = useLoop(1700, 400 + (delay % 5) * 260, !!ready);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay, friction: 7, tension: 70, useNativeDriver: true }).start();
  }, []); // eslint-disable-line

  const goHover = (on) => { setHov(on); Animated.spring(hover, { toValue: on ? 1 : 0, friction: 6, tension: 120, useNativeDriver: true }).start(); };
  const goPress = (v) => Animated.spring(press, { toValue: v, friction: 5, tension: 200, useNativeDriver: true }).start();

  const lift = hover.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });
  const enterS = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const opacity = enter.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
  const tileRot = hover.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-8deg'] });
  const tileScale = hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const iconY = float.interpolate({ inputRange: [0, 1], outputRange: [1.5, -2.5] });
  const markRot = hover.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] });
  const markScale = hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const arrowX = hover.interpolate({ inputRange: [0, 1], outputRange: [0, 3] });
  const bar = hover.interpolate({ inputRange: [0, 1], outputRange: [0.001, 1] });

  const tile = compact ? 44 : 54;
  return (
    <Animated.View style={{ opacity, transform: [{ translateY: Animated.add(enterY, lift) }, { scale: Animated.multiply(enterS, press) }] }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
        onPressIn={() => goPress(0.96)} onPressOut={() => goPress(1)} onHoverIn={() => goHover(true)} onHoverOut={() => goHover(false)}>
        <View style={[s.card, compact && s.cardC, hov ? SHADOW.md : SHADOW.sm, !ready && { backgroundColor: '#FCFAF7' }]}>
          <View style={[s.glow, { backgroundColor: `${color}${ready ? '14' : '0C'}` }]} />
          <Animated.View pointerEvents="none" style={[s.mark, compact && s.markC, { transform: [{ rotate: markRot }, { scale: markScale }] }]}>
            <MCI name={icon} size={compact ? 84 : 112} color={`${color}${ready ? '12' : '0A'}`} />
          </Animated.View>

          <View style={s.top}>
            <Animated.View style={[s.tileWrap, ready && { shadowColor: color }, { transform: [{ rotate: tileRot }, { scale: tileScale }] }]}>
              {ready ? (
                <LinearGradient colors={[lighten(color, 0.18), color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={[s.tile, { width: tile, height: tile, borderRadius: compact ? 14 : 17 }]}>
                  <Animated.View style={{ transform: [{ translateY: iconY }] }}>
                    <MCI name={icon} size={compact ? 22 : 27} color="#fff" />
                  </Animated.View>
                </LinearGradient>
              ) : (
                <View style={[s.tile, { width: tile, height: tile, borderRadius: compact ? 14 : 17, backgroundColor: COLORS.greyBg }]}>
                  <MCI name={icon} size={compact ? 22 : 27} color="#B5AAA1" />
                </View>
              )}
            </Animated.View>
            {ready ? (
              <View style={[s.arrow, { backgroundColor: hov ? color : `${color}18` }]}>
                <Animated.View style={{ transform: [{ translateX: arrowX }] }}>
                  <MCI name="arrow-right" size={17} color={hov ? '#fff' : color} />
                </Animated.View>
              </View>
            ) : <View style={s.soon}><Text style={s.soonText}>SOON</Text></View>}
          </View>

          <Text style={[s.title, compact && s.titleC, !ready && { color: COLORS.textSoft }]} numberOfLines={1}>{title}</Text>
          <View style={[s.chip, { backgroundColor: ready ? `${color}14` : COLORS.greyBg }]}>
            <Text style={[s.chipText, { color: ready ? color : COLORS.grey }]} numberOfLines={1}>{caption}</Text>
          </View>

          {ready && <Animated.View pointerEvents="none" style={[s.bar, { backgroundColor: color, transform: [{ scaleX: bar }] }]} />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', padding: 18, minHeight: 148 },
  cardC: { padding: 13, minHeight: 124, borderRadius: 20 },
  glow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, right: -42, top: -48 },
  mark: { position: 'absolute', right: -14, bottom: -22 },
  markC: { right: -10, bottom: -14 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tileWrap: { shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 0 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '900', color: COLORS.text, marginTop: 16, letterSpacing: -0.2 },
  titleC: { fontSize: 14.5, marginTop: 11 },
  chip: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginTop: 6 },
  chipText: { fontSize: 11.5, fontWeight: '800' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  soon: { backgroundColor: COLORS.greyBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  soonText: { fontSize: 9.5, fontWeight: '900', color: COLORS.grey, letterSpacing: 0.8 },
});
