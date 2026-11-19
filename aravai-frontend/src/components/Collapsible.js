import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

// Smooth height + fade expand/collapse. Content is measured once (and again whenever it changes size),
// so it also works when something inside (e.g. a nested Collapsible) grows or shrinks.
export default function Collapsible({ open, children, duration = 280 }) {
  const [h, setH] = useState(0);
  const a = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: open ? 1 : 0, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [open]); // eslint-disable-line
  return (
    <Animated.View pointerEvents={open ? 'auto' : 'none'}
      style={{ overflow: 'hidden', opacity: a, height: a.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) }}>
      <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
        {children}
      </View>
    </Animated.View>
  );
}

// Chevron that rotates smoothly between closed (0deg) and open (180deg)
export function useSpin(open, duration = 260) {
  const a = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: open ? 1 : 0, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open]); // eslint-disable-line
  return { transform: [{ rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] };
}