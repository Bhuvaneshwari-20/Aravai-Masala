import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Container from './Container';
import useLayout from '../hooks/useLayout';
import { COLORS, GRADIENT, SHADOW } from '../theme';

// Top block of every list screen: icon + title + count, search, primary "Add" button.
// Desktop: one row. Phone: title + Add on the first row, full-width search below.
export default function PageToolbar({ icon, title, count, noun, subtitle, search, onSearch, placeholder = 'Search', addLabel, onAdd, children }) {
  const { isWide, isPhone, pad } = useLayout();
  const [focus, setFocus] = useState(false);
  const sub = subtitle || `${count} ${count === 1 ? noun : `${noun}s`}`;

  const searchBox = (
    <View style={[s.search, focus && s.searchOn, isWide ? { width: 320 } : { flex: 1 }]}>
      <MCI name="magnify" size={19} color={focus ? COLORS.primary : COLORS.grey} />
      <TextInput value={search} onChangeText={onSearch} placeholder={placeholder} placeholderTextColor="#A39890"
        autoCapitalize="none" autoCorrect={false} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={s.input} />
      {!!search && <Pressable onPress={() => onSearch('')} hitSlop={10}><MCI name="close-circle" size={17} color={COLORS.grey} /></Pressable>}
    </View>
  );

  const addBtn = !!onAdd && (
    <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={addLabel} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }, !isWide && { marginLeft: 10 }]}>
      <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.add, SHADOW.sm, isWide && { marginLeft: 12 }]}>
        <MCI name="plus" size={19} color="#fff" />
        <Text style={s.addText}>{isPhone ? (addLabel || 'Add').split(' ')[0] : addLabel}</Text>
      </LinearGradient>
    </Pressable>
  );

  return (
    <Container>
      <View style={[s.bar, { paddingHorizontal: pad }]}>
        <View style={[s.row, isWide && { justifyContent: 'space-between' }]}>
          <View style={[s.titleRow, !isWide && { flex: 1, minWidth: 0 }]}>
            <View style={s.titleIcon}><MCI name={icon} size={22} color={COLORS.primary} /></View>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={s.title} numberOfLines={1}>{title}</Text>
              <Text style={s.sub} numberOfLines={1}>{sub}</Text>
            </View>
          </View>
          {isWide ? <View style={s.actions}>{searchBox}{addBtn}</View> : addBtn}
        </View>
        {!isWide && <View style={s.mobileSearch}>{searchBox}</View>}
        {children}
      </View>
    </Container>
  );
}

const s = StyleSheet.create({
  bar: { paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: COLORS.grey, fontWeight: '600', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  mobileSearch: { flexDirection: 'row', marginTop: 14 },
  search: { flexDirection: 'row', alignItems: 'center', height: 46, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 13 },
  searchOn: { borderColor: COLORS.primary },
  input: { flex: 1, marginLeft: 9, fontSize: 14.5, color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, paddingHorizontal: 16, minWidth: 46 },
  addText: { color: '#fff', fontWeight: '800', marginLeft: 6, fontSize: 14.5 },
});
