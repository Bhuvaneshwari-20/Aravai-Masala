import React from 'react';
import { View } from 'react-native';

// Centres content; wide enough to use big web screens (was 1100)
export default function Container({ children, maxWidth = 1600, fill, style }) {
  return <View style={[{ width: '100%', maxWidth, alignSelf: 'center' }, fill && { flex: 1 }, style]}>{children}</View>;
}
