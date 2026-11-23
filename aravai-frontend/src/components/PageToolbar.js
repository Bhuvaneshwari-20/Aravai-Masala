import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ImageBackground } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Container from './Container';
import { NotificationBell } from './NotificationCenter';
import useLayout from '../hooks/useLayout';
import { COLORS, SHADOW } from '../theme';

const HERO_IMG = require('../../assets/banner-spices.jpg');
const MAROON = '#8A1020';

// Top block of every list screen:  maroon hero banner (icon + title + description)  ->  KPI chips (children)  ->  search + "Add" button.
// `desc` = one-line description shown in the banner (falls back to `subtitle` / "N things").
export default function PageToolbar({ icon, title, count, noun, subtitle, desc, search, onSearch, placeholder = 'Search', addLabel, onAdd, heroImage, children }) {
  const { isWide, isPhone, pad } = useLayout();
  const [focus, setFocus] = useState(false);
  const sub = desc || subtitle || `${count} ${count === 1 ? noun : `${noun}s`}`;

  const searchBox = (
    <View style={[s.search, focus && s.searchOn, isWide ? { width: 440 } : { flex: 1 }]}>
      <MCI name="magnify" size={19} color={focus ? MAROON : COLORS.grey} />
      <TextInput value={search} onChangeText={onSearch} placeholder={placeholder} placeholderTextColor="#A39890"
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
        {/* hero banner */}
        <ImageBackground source={heroImage || HERO_IMG} resizeMode="cover" style={[s.hero, isPhone && { minHeight: 84, padding: 14 }]} imageStyle={{ borderRadius: 20 }}>
          <LinearGradient colors={['#5E0A15', '#8A1020F2', '#8A102099', '#8A102000']} locations={[0, 0.45, 0.72, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 20 }]} />
          <View style={[s.heroIcon, isPhone && { width: 44, height: 44, borderRadius: 13 }]}><MCI name={icon} size={isPhone ? 24 : 30} color="#fff" /></View>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 52 }}>
            <Text style={[s.heroTitle, isPhone && { fontSize: 19 }]} numberOfLines={1}>{title}</Text>
            <Text style={s.heroSub} numberOfLines={2}>{sub}</Text>
          </View>
          {/* notification bell lives in the banner, so it scrolls / sits with the header and never floats over the content */}
          <View style={[s.heroBell, isPhone && { top: 10, right: 10 }]}><NotificationBell tone="dark" /></View>
        </ImageBackground>

        {/* KPI chips passed by the screen */}
        {children}

        {/* search + add */}
        <View style={[s.row, isWide ? { justifyContent: 'space-between' } : null]}>
          {searchBox}
          {addBtn}
        </View>
      </View>
    </Container>
  );
}

const s = StyleSheet.create({
  bar: { paddingTop: 14, paddingBottom: 6 },
  hero: { flexDirection: 'row', alignItems: 'center', minHeight: 104, borderRadius: 20, padding: 20, overflow: 'hidden', backgroundColor: MAROON },
  heroBell: { position: 'absolute', top: 14, right: 14, zIndex: 5 },
  heroIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.2 },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600', marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  search: { flexDirection: 'row', alignItems: 'center', height: 46, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, paddingHorizontal: 13 },
  searchOn: { borderColor: MAROON },
  input: { flex: 1, marginLeft: 9, fontSize: 14.5, color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, paddingHorizontal: 18, minWidth: 46, backgroundColor: MAROON },
  addText: { color: '#fff', fontWeight: '800', marginLeft: 6, fontSize: 14.5 },
});