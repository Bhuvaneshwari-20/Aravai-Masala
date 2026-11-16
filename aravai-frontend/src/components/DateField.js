import React from 'react';
import { View, Text, Platform } from 'react-native';
import { HelperText } from 'react-native-paper';
import FormField from './FormField';
import { COLORS } from '../theme';

// 'YYYY-MM-DD' plus n days (for the earliest allowed use-by date). Returns undefined for a blank or bad date.
export const addDays = (ymd, n) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Calendar date picker. On the web it uses the browser's own calendar (click the box, pick a day; typing is switched off).
// On a phone (Expo Go) there is no calendar library installed, so it falls back to the normal typed field.
// value / onChange use 'YYYY-MM-DD', the same format the form already saves.
export default function DateField({ label, value, onChange, error, hint, min, max }) {
  if (Platform.OS !== 'web') {
    return <FormField label={`${label} (YYYY-MM-DD)`} value={value} onChangeText={onChange} error={error} hint={hint} maxLength={10} />;
  }
  const openPicker = (el) => { try { if (el && el.showPicker) el.showPicker(); } catch (e) { /* only works on a click; ignore */ } };
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', top: -8, left: 14, zIndex: 2, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 12,
          color: error ? COLORS.danger : COLORS.grey }}>{label}</Text>
        {React.createElement('input', {
          type: 'date', value: value || '', min, max,
          onChange: (e) => onChange(e.target.value),
          onClick: (e) => openPicker(e.currentTarget),
          onKeyDown: (e) => {
            if (e.key === 'Tab' || e.key === 'Escape') return;
            e.preventDefault();                                   // no typing: the date is picked from the calendar
            if (e.key === 'Enter' || e.key === ' ') openPicker(e.currentTarget);
          },
          style: { width: '100%', height: 56, boxSizing: 'border-box', padding: '0 14px', fontSize: 16, fontFamily: 'inherit',
            color: '#1c1410', background: '#fff', border: `1px solid ${error ? COLORS.danger : '#E3D3C8'}`, borderRadius: 14,
            outline: 'none', cursor: 'pointer' },
        })}
      </View>
      <HelperText type={error ? 'error' : 'info'} visible={!!(error || hint)}>{error || hint}</HelperText>
    </View>
  );
}