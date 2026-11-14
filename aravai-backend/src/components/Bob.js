import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

// Gentle floating + tilting wrapper (used for the red chilli)
export default function Bob({ children, amount = 6, duration = 1500, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line
  return (
    <Animated.View style={[{ transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -amount] }) },
      { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

// Pulsing red dot for "needs attention"
export function PulseDot({ color = '#C62828', style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 12, right: 12, width: 12, height: 12 }, style]}>
      <Animated.View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }] }} />
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
    </View>
  );
}
