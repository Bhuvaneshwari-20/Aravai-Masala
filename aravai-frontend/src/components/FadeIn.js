import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Fade + slide-up entrance. Use delay for staggered lists.
export default function FadeIn({ children, delay = 0, from = 18, duration = 450, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []); // eslint-disable-line
  return (
    <Animated.View style={[{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}
