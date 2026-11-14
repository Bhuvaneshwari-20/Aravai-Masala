import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { Text } from 'react-native-paper';

// Counts up from 0 to `value` (shows a dash until the number is loaded)
export default function AnimatedNumber({ value, style, duration = 900 }) {
  const a = useRef(new Animated.Value(0)).current;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (typeof value !== 'number') return undefined;
    const id = a.addListener(({ value: v }) => setN(Math.round(v)));
    Animated.timing(a, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => a.removeListener(id);
  }, [value]); // eslint-disable-line
  return <Text style={style}>{typeof value === 'number' ? n : '–'}</Text>;
}
