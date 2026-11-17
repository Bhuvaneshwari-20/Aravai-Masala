import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { COLORS } from '../theme';

// Pulsing skeleton cards instead of a plain spinner
export default function LoadingView({ rows = 6 }) {
  const a = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 750, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.45, duration: 750, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line
  const bone = { backgroundColor: '#EFE6DD' };
  return (
    <View style={{ flex: 1, paddingTop: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={{ opacity: a, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
          borderRadius: 18, padding: 14, marginHorizontal: 14, marginVertical: 5, height: 80 }}>
          <View style={[bone, { width: 48, height: 48, borderRadius: 14, marginRight: 12 }]} />
          <View style={{ flex: 1 }}>
            <View style={[bone, { height: 14, width: '55%', borderRadius: 7 }]} />
            <View style={[bone, { height: 10, width: '35%', borderRadius: 5, marginTop: 10, opacity: 0.6 }]} />
          </View>
          <View style={[bone, { width: 56, height: 22, borderRadius: 11 }]} />
        </Animated.View>
      ))}
    </View>
  );
}
