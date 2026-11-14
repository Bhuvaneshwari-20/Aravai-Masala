import React from 'react';
import { StyleSheet } from 'react-native';
import { Searchbar } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import Container from './Container';
import { COLORS } from '../theme';

// Search box on a gradient strip (blends with the screen header, full width, content centred)
export default function SearchBar({ value, onChangeText, placeholder = 'Search' }) {
  return (
    <LinearGradient colors={[COLORS.primaryDark, COLORS.primary]} style={s.wrap}>
      <Container style={{ paddingHorizontal: 14 }}>
        <Searchbar placeholder={placeholder} value={value} onChangeText={onChangeText} style={s.bar}
          inputStyle={{ minHeight: 0 }} elevation={3} autoCapitalize="none" autoCorrect={false} />
      </Container>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  bar: { height: 50, borderRadius: 25, backgroundColor: '#fff' },
});
