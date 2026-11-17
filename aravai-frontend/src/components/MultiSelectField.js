import React, { useState, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Pressable, TextInput as RNInput, StyleSheet } from 'react-native';
import { TextInput, HelperText, Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import ModalShell from './ModalShell';
import { COLORS } from '../theme';

// Multi-select dropdown. Opens a popup with a search box and tappable chips.
// values: [id, ...]   options: [{ value, label }]   onChange(newValuesArray)
export default function MultiSelectField({ label, values = [], options, onChange, error, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const title = String(label).replace(/\s*\*$/, '');
  const picked = options.filter((o) => values.includes(o.value));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => String(o.label).toLowerCase().includes(t)) : options;
  }, [options, q]);
  const allShownOn = shown.length > 0 && shown.every((o) => values.includes(o.value));

  const close = () => { setOpen(false); setQ(''); };
  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const toggleAll = () => {
    const ids = shown.map((o) => o.value);
    onChange(allShownOn ? values.filter((v) => !ids.includes(v)) : [...new Set([...values, ...ids])]);
  };
  const text = picked.length === 0 ? '' : picked.length <= 2 ? picked.map((o) => o.label).join(', ') : `${picked.length} materials selected`;

  return (
    <View style={{ marginBottom: 4 }}>
      <TouchableOpacity activeOpacity={0.7} disabled={disabled} onPress={() => setOpen(true)}>
        <View pointerEvents="none">
          <TextInput mode="outlined" label={label} value={text} editable={false}
            error={!!error} disabled={disabled} outlineColor="#E3D3C8" outlineStyle={{ borderRadius: 14 }} style={{ backgroundColor: '#fff', minHeight: 56 }}
            right={<TextInput.Icon icon="menu-down" />} />
        </View>
      </TouchableOpacity>
      <HelperText type="error" visible={!!error}>{error}</HelperText>

      <ModalShell visible={open} onDismiss={close} title={`Select ${title}`} icon="format-list-checks" maxWidth={460}
        footer={(
          <View style={{ flex: 1 }}>
            <Button mode="contained" onPress={close} buttonColor={COLORS.green} icon="check" contentStyle={{ height: 46 }} style={{ borderRadius: 12 }}>
              {values.length ? `Done  •  ${values.length} selected` : 'Done'}
            </Button>
          </View>
        )}>
        <View style={s.searchWrap}>
          <MCI name="magnify" size={20} color={COLORS.grey} />
          <RNInput value={q} onChangeText={setQ} placeholder="Search materials" placeholderTextColor={COLORS.grey} style={s.search} />
          {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><MCI name="close-circle" size={18} color={COLORS.grey} /></Pressable>}
        </View>

        <View style={s.bar}>
          <Text style={s.count}>{values.length} of {options.length} selected</Text>
          <View style={{ flexDirection: 'row' }}>
            <Pressable onPress={toggleAll} disabled={!shown.length}><Text style={s.link}>{allShownOn ? 'Unselect all' : 'Select all'}</Text></Pressable>
            {values.length > 0 && <Pressable onPress={() => onChange([])}><Text style={[s.link, { color: COLORS.danger, marginLeft: 16 }]}>Clear</Text></Pressable>}
          </View>
        </View>

        <ScrollView style={{ maxHeight: 340 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {shown.length === 0 ? <Text style={s.empty}>No materials found</Text> : (
            <View style={s.grid}>
              {shown.map((o) => {
                const on = values.includes(o.value);
                return (
                  <Pressable key={String(o.value)} onPress={() => toggle(o.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    style={({ hovered }) => [s.chip, on && s.chipOn, hovered && !on && { backgroundColor: '#F6F1EC' }]}>
                    <MCI name={on ? 'check-circle' : 'plus-circle-outline'} size={18} color={on ? COLORS.primary : COLORS.grey} />
                    <Text style={[s.chipText, on && { color: COLORS.primary, fontWeight: '800' }]} numberOfLines={1}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </ModalShell>
    </View>
  );
}

const s = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 46, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: '#FBF8F4' },
  search: { flex: 1, marginLeft: 8, color: COLORS.text, fontSize: 15, outlineStyle: 'none' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 },
  count: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: COLORS.grey },
  link: { fontSize: 13, fontWeight: '800', color: COLORS.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  chip: { flexDirection: 'row', alignItems: 'center', margin: 4, paddingHorizontal: 12, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', maxWidth: '100%' },
  chipOn: { backgroundColor: '#FDECEA', borderColor: COLORS.primary },
  chipText: { marginLeft: 8, fontSize: 14.5, fontWeight: '600', color: COLORS.text, flexShrink: 1 },
  empty: { textAlign: 'center', color: COLORS.grey, padding: 28 },
});