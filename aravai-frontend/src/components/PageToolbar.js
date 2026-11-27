import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import Container from './Container';
import { NotificationBell } from './NotificationCenter';
import useLayout from '../hooks/useLayout';
import { COLORS, SHADOW } from '../theme';

// Top block of every list screen:  clean header (icon tile + title + description + bell)  ->  KPI chips (children)  ->  search + "Add" button.
// `hideSearch` = header without the search box (dashboard / form pages).  `desc` = one-line description (falls back to `subtitle` / "N things").
// `heroImage` is accepted for old call sites but no longer used.
export default function PageToolbar({ icon, title, count, noun, subtitle, desc, search, onSearch, placeholder = 'Search', addLabel, onAdd, hideSearch, children }) {
  const { isWide, isPhone, pad } = useLayout();
  const [focus, setFocus] = useState(false);
  const sub = desc || subtitle || `${count} ${count === 1 ? noun : `${noun}s`}`;

  const searchBox = (
    <View style={[s.search, focus && s.searchOn, isWide ? { width: 440 } : { flex: 1 }]}>
      <MCI name="magnify" size={19} color={focus ? COLORS.primary : COLORS.grey} />
      <TextInput value={search} onChangeText={onSearch} placeholder={placeholder} placeholderTextColor="#9AAAA0"
        autoCapitalize="none" autoCorrect={false} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={s.input} />
      {!!search && <Pressable onPress={() => onSearch('')} hitSlop={10}><MCI name="close-circle" size={17} color={COLORS.grey} /></Pressable>}
    </View>
  );

  const addBtn = !!onAdd && (
    <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={addLabel} style={({ pressed }) => [s.add, SHADOW.sm, { opacity: pressed ? 0.85 : 1 }, !isWide && { marginLeft: 10 }]}>
      <MCI name="plus" size={19} color="#fff" />
      <Text style={s.addText}>{isPhone ? (addLabel || 'Add').split(' ')[0] : addLabel}</Text>
    </Pressable>
  );

  return (
    <Container>
      <View style={[s.bar, { paddingHorizontal: pad }]}>
        {/* page header */}
        <View style={s.head}>
          <View style={[s.iconTile, isPhone && { width: 42, height: 42, borderRadius: 12, marginRight: 10 }]}>
            <MCI name={icon} size={isPhone ? 22 : 28} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.title, isPhone && { fontSize: 20 }]} numberOfLines={1}>{title}</Text>
            <Text style={s.sub} numberOfLines={2}>{sub}</Text>
          </View>
          <NotificationBell />
        </View>

        {/* KPI chips passed by the screen */}
        {children}

        {/* search + add */}
        {(!hideSearch || addBtn) && (
          <View style={[s.row, isWide ? { justifyContent: hideSearch ? 'flex-end' : 'space-between' } : null, hideSearch && !isWide ? { justifyContent: 'flex-end' } : null]}>
            {!hideSearch && searchBox}
            {addBtn}
          </View>
        )}
      </View>
    </Container>
  );
}

const s = StyleSheet.create({
  bar: { paddingTop: 16, paddingBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  iconTile: { width: 52, height: 52, borderRadius: 15, backgroundColor: COLORS.primarySoft, borderWidth: 1, borderColor: '#CFE6D8', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.2 },
  sub: { color: COLORS.textSoft, fontSize: 13, fontWeight: '600', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  search: { flexDirection: 'row', alignItems: 'center', height: 46, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 13 },
  searchOn: { borderColor: COLORS.primary },
  input: { flex: 1, marginLeft: 9, fontSize: 14.5, color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, paddingHorizontal: 18, minWidth: 46, backgroundColor: COLORS.primary },
  addText: { color: '#fff', fontWeight: '800', marginLeft: 6, fontSize: 14.5 },
});