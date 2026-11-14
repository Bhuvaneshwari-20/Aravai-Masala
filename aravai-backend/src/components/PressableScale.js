import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// Springy press effect + soft lift on mouse hover (web)
export default function PressableScale({ children, onPress, style, disabled, to = 0.96 }) {
  const s = useRef(new Animated.Value(1)).current;
  const go = (v) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 8 }).start();
  return (
    <Pressable onPress={onPress} disabled={disabled} onPressIn={() => go(to)} onPressOut={() => go(1)}
      onHoverIn={() => go(1.035)} onHoverOut={() => go(1)}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
