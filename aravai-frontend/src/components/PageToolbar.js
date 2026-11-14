import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import Container from './Container';
import useLayout from '../hooks/useLayout';
import { COLORS } from '../theme';

// Top row of every master list: icon + title + count on the left, compact search + Add button on the right.
export default function PageToolbar({ icon, title, count, noun,subtitle, search, onSearch, placeholder = 'Search', addLabel, onAdd }) {
  const { isWide, isPhone } = useLayout();
  return (
    <Container>
      <View style={[s.bar, !isWide && s.barCol]}>
        <View style={s.titleRow}>
          <View style={s.titleIcon}><MCI name={icon} size={20} color="#fff" /></View>
          <View>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>{subtitle || `${count} ${count === 1 ? noun : `${noun}s`}`}</Text>
          </View>
        </View>
        <View style={[s.actions, !isWide && { width: '100%', marginTop: 12 }]}>
          <View style={[s.search, !isWide && { flex: 1, width: 'auto' }]}>
            <MCI name="magnify" size={18} color={COLORS.grey} />
            <TextInput value={search} onChangeText={onSearch} placeholder={placeholder} placeholderTextColor={COLORS.grey}
              autoCapitalize="none" autoCorrect={false} style={s.input} />
            {!!search && <Pressable onPress={() => onSearch('')}><MCI name="close-circle" size={16} color={COLORS.grey} /></Pressable>}
          </View>
          {!!onAdd && (
            <Pressable style={[s.add, isPhone && s.addPhone]} onPress={onAdd} accessibilityLabel={addLabel}>
              <MCI name="plus" size={18} color="#fff" />{!isPhone && <Text style={s.addText}>{addLabel}</Text>}
            </Pressable>
          )}
        </View>
      </View>
    </Container>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 10 },
  barCol: { flexDirection: 'column', alignItems: 'flex-start', paddingBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 12.5, color: COLORS.grey, fontWeight: '600', marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', width: 280, height: 44, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12 },
  input: { flex: 1, marginLeft: 8, fontSize: 14, color: COLORS.text, outlineStyle: 'none' },
  add: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.green, borderRadius: 10, height: 40, paddingHorizontal: 16, marginLeft: 10 },
  addPhone: { width: 44, height: 44, borderRadius: 14, paddingHorizontal: 0, justifyContent: 'center', elevation: 3 },
  addText: { color: '#fff', fontWeight: '800', marginLeft: 6, fontSize: 14 },
});
