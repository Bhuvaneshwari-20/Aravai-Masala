import React from 'react';
import { View } from 'react-native';
import useLayout from '../hooks/useLayout';

// Puts 2 fields side by side on wide screens, stacked on phones. (Must live outside the form component so inputs keep focus.)
export default function FormRow({ children }) {
  const { isWide } = useLayout();
  const kids = React.Children.toArray(children);
  if (!isWide) return <View>{kids}</View>;
  return (
    <View style={{ flexDirection: 'row' }}>
      {kids.map((c, i) => <View key={i} style={{ flex: 1, marginRight: i < kids.length - 1 ? 12 : 0 }}>{c}</View>)}
    </View>
  );
}
