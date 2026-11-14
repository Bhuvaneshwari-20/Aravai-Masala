import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS } from '../theme';

// Pulsing skeleton cards instead of a plain spinner
export default function LoadingView({ text = 'Loading...' }) {
  const a = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line
  return (
    <View style={{ flex: 1, paddingTop: 14 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Animated.View key={i} style={{ opacity: a, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
          borderRadius: 18, padding: 14, marginHorizontal: 12, marginVertical: 5, height: 76 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: '#F0E4DB', marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <View style={{ height: 14, width: '60%', borderRadius: 7, backgroundColor: '#F0E4DB' }} />
            <View style={{ height: 10, width: '40%', borderRadius: 5, backgroundColor: '#F6EEE8', marginTop: 10 }} />
          </View>
        </Animated.View>
      ))}
      <Text style={{ textAlign: 'center', marginTop: 10, color: COLORS.grey }}>{text}</Text>
    </View>
  );
}
