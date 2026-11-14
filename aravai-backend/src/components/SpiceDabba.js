import React from 'react';
import { View } from 'react-native';

// Decorative "masala dabba" (round Indian spice box) drawn with plain Views - no images, no extra packages.
const SPICES = ['#D2381B', '#F2B01E', '#9C8A3A', '#E8631A', '#7B5A2B', '#B8860B', '#C2410C'];

export default function SpiceDabba({ size = 240, style }) {
  const c = size / 2;
  const bowl = size * 0.27;
  const orbit = size * 0.31;
  const n = SPICES.length;
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]}>
      {/* tin */}
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: c, backgroundColor: '#5A2E18',
        borderWidth: size * 0.035, borderColor: '#D9A25B' }} />
      <View style={{ position: 'absolute', left: size * 0.06, top: size * 0.06, width: size * 0.88, height: size * 0.88,
        borderRadius: size * 0.44, borderWidth: 1.5, borderColor: 'rgba(255,214,150,0.45)' }} />
      {/* spice bowls */}
      {SPICES.map((col, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * orbit - bowl / 2;
        const y = c + Math.sin(a) * orbit - bowl / 2;
        return (
          <View key={col} style={{ position: 'absolute', left: x, top: y, width: bowl, height: bowl, borderRadius: bowl / 2,
            backgroundColor: '#8A5A33', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: bowl * 0.82, height: bowl * 0.82, borderRadius: bowl * 0.41, backgroundColor: col }}>
              <View style={{ position: 'absolute', left: bowl * 0.14, top: bowl * 0.12, width: bowl * 0.26, height: bowl * 0.26,
                borderRadius: bowl * 0.13, backgroundColor: 'rgba(255,255,255,0.22)' }} />
            </View>
          </View>
        );
      })}
      {/* centre lid knob */}
      <View style={{ position: 'absolute', left: c - size * 0.1, top: c - size * 0.1, width: size * 0.2, height: size * 0.2,
        borderRadius: size * 0.1, backgroundColor: '#D9A25B', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size * 0.12, height: size * 0.12, borderRadius: size * 0.06, backgroundColor: '#3A1B0D' }} />
      </View>
    </View>
  );
}
