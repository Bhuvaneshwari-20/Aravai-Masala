import React from 'react';
import { View } from 'react-native';

// Full width on big web screens. Pass maxWidth only for narrow pages (forms / detail).
export default function Container({ children, maxWidth, fill, style }) {
  return <View style={[{ width: '100%', alignSelf: 'center' }, maxWidth ? { maxWidth } : null, fill && { flex: 1 }, style]}>{children}</View>;
}
