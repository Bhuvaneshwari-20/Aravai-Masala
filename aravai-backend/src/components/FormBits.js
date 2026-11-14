import React from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS } from '../theme';

export const Label = ({ children, style }) => (
  <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>
);

export const ErrorBox = ({ text }) => (!text ? null : (
  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 12 }}>
    <MCI name="alert-circle" size={16} color={COLORS.danger} />
    <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{text}</Text>
  </View>
));

export const InfoBox = ({ text, tone = 'warn' }) => (!text ? null : (
  <View style={{ backgroundColor: tone === 'warn' ? COLORS.warnBg : COLORS.okBg, borderRadius: 10, padding: 10, marginBottom: 12 }}>
    <Text style={{ color: tone === 'warn' ? COLORS.warn : COLORS.ok, fontWeight: '700', fontSize: 13 }}>{text}</Text>
  </View>
));

// Cancel + primary button row used in every popup footer
export const ModalFooter = ({ onCancel, onSave, saving, disabled, label = 'Save', icon = 'check', color = COLORS.green }) => (
  <View style={{ flexDirection: 'row' }}>
    <Button mode="outlined" onPress={onCancel} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
    <Button mode="contained" onPress={onSave} loading={saving} disabled={saving || disabled} buttonColor={color} style={{ borderRadius: 10 }} icon={icon}>{label}</Button>
  </View>
);

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
