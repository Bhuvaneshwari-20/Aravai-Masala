import React from 'react';
import { View } from 'react-native';

// A bowl heaped with spice powder, drawn with plain Views (like the category tiles in the reference).
export default function SpiceBowl({ size = 64, color = '#D2381B' }) {
  const bowlH = size * 0.42;
  const heapW = size * 0.8;
  const heapH = size * 0.5;
  return (
    <View pointerEvents="none" style={{ width: size, height: size * 0.88 }}>
      <View style={{ position: 'absolute', bottom: bowlH - 4, left: (size - heapW) / 2, width: heapW, height: heapH,
        borderTopLeftRadius: heapW / 2, borderTopRightRadius: heapW / 2, backgroundColor: color, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: heapW * 0.18, top: heapH * 0.18, width: heapW * 0.22, height: heapH * 0.16,
          borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.28)' }} />
        <View style={{ position: 'absolute', right: heapW * 0.2, top: heapH * 0.4, width: heapW * 0.12, height: heapH * 0.1,
          borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.12)' }} />
      </View>
      <View style={{ position: 'absolute', bottom: 0, width: size, height: bowlH, borderBottomLeftRadius: size / 2,
        borderBottomRightRadius: size / 2, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: '#8A5A33' }} />
      <View style={{ position: 'absolute', bottom: bowlH - 5, width: size, height: 8, borderRadius: 4, backgroundColor: '#B98250' }} />
    </View>
  );
}
