import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Small step indicator for the "Product & MRP -> Recipe" flow.  step = 1-based current step.
export default function Stepper({ step = 1, steps = ['Product & MRP', 'Recipe'] }) {
  return (
    <View style={s.row}>
      {steps.map((label, i) => {
        const n = i + 1; const done = n < step; const on = n === step;
        return (
          <React.Fragment key={label}>
            <View style={s.item}>
              <View style={[s.dot, done && s.dotDone, on && s.dotOn]}>
                {done ? <MCI name="check" size={14} color="#fff" /> : <Text style={[s.num, on && { color: '#fff' }]}>{n}</Text>}
              </View>
              <Text style={[s.label, (on || done) && { color: COLORS.text }]} numberOfLines={1}>{label}</Text>
            </View>
            {i < steps.length - 1 && <Line filled={done} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function Line({ filled }) {
  const a = useRef(new Animated.Value(filled ? 1 : 0)).current;
  useEffect(() => { Animated.timing(a, { toValue: filled ? 1 : 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [filled]); // eslint-disable-line
  return (
    <View style={s.line}>
      <Animated.View style={{ height: 3, borderRadius: 2, backgroundColor: COLORS.ok, width: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 18 },
  item: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6DDD3' },
  dotOn: { backgroundColor: COLORS.primary },
  dotDone: { backgroundColor: COLORS.ok },
  num: { fontSize: 13, fontWeight: '900', color: COLORS.grey },
  label: { marginLeft: 8, fontSize: 13, fontWeight: '800', color: COLORS.grey },
  line: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E6DDD3', marginHorizontal: 12, minWidth: 20, overflow: 'hidden' },
});