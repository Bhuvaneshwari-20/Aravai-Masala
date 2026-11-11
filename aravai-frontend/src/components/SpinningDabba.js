import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import SpiceDabba from './SpiceDabba';

// The masala dabba (spice wheel) turning slowly - used in hero + login
export default function SpinningDabba({ size = 200, duration = 40000, style }) {
  const r = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(r, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line
  return (
    <Animated.View pointerEvents="none"
      style={[{ transform: [{ rotate: r.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }, style]}>
      <SpiceDabba size={size} />
    </Animated.View>
  );
}
