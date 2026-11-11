import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { COLORS } from '../theme';

// options: [{ value, label }]  -  single select. `children` = extra chips shown after the options.
export default function FilterChips({ options, value, onChange, children }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroll}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Chip key={String(o.value)} selected={on} selectedColor="#fff" showSelectedOverlay={false}
            onPress={() => onChange(o.value)} style={[s.chip, on && s.on]}
            textStyle={{ fontSize: 14, fontWeight: '600', color: on ? '#fff' : COLORS.text }}>
            {o.label}
          </Chip>
        );
      })}
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center' },
  chip: { marginRight: 8, minHeight: 38, backgroundColor: '#fff', borderRadius: 19, borderWidth: 1, borderColor: '#EADBD1' },
  on: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
});
