import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Value that eases 0 -> 1 -> 0 forever (native driver). Use it with .interpolate() for floating / pulsing / swinging effects.
export default function useLoop(duration = 1800, delay = 0, enabled = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return undefined;
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const t = setTimeout(() => anim.start(), delay);
    return () => { clearTimeout(t); anim.stop(); };
  }, [duration, delay, enabled]); // eslint-disable-line
  return v;
}
