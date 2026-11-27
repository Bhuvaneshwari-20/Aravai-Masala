import React from 'react';
import { ScrollView, Pressable, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { COLORS } from '../theme';
import useLayout from '../hooks/useLayout';

// options: [{ value, label, count? }]  -  single select. `children` = extra chips shown after the options.
export default function FilterChips({ options, value, onChange, children, style }) {
  const { pad } = useLayout();   // same side gap as the banner / cards, so the chips never touch the sidebar
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.row, { paddingHorizontal: pad }]} style={[s.scroll, style]}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={({ hovered }) => [s.chip, on && s.on, !on && hovered && s.hover]}>
            <Text style={[s.text, on && { color: '#fff' }]}>{o.label}</Text>
            {o.count !== undefined && o.count !== null && (
              <View style={[s.count, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                <Text style={[s.countText, on && { color: '#fff' }]}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingVertical: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 19, paddingHorizontal: 14, marginRight: 8, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border },
  hover: { backgroundColor: COLORS.primarySoft, borderColor: '#F0CFCF' },
  on: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  text: { fontSize: 13.5, fontWeight: '700', color: COLORS.textSoft },
  count: { marginLeft: 8, minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.greyBg },
  countText: { fontSize: 11, fontWeight: '900', color: COLORS.grey },
});