import React from 'react';
import { Platform, View } from 'react-native';
import { Text, HelperText } from 'react-native-paper';
import FormField from './FormField';
import { COLORS } from '../theme';

// Date picker, same look as TimeField. Value is always '' or 'YYYY-MM-DD' (what the forms and the server expect).
//   <DateField label="Date *" value={f.entry_date} onChangeText={set('entry_date')} error={errors.entry_date} />
// Web build : the browser's own calendar picker.
// Phone     : plain box that formats itself while typing (20261102 -> 2026-11-02).
const mask = (t) => {
  const d = String(t || '').replace(/[^0-9]/g, '').slice(0, 8);
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
};

export default function DateField({ label, value, onChangeText, error, hint, disabled, min, max }) {
  if (Platform.OS !== 'web') {
    return <FormField label={label} value={value || ''} onChangeText={(t) => onChangeText(mask(t))} error={error} hint={hint || 'YYYY-MM-DD'} maxLength={10} editable={!disabled} keyboardType="number-pad" />;
  }
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', top: -8, left: 14, zIndex: 2, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 12, color: error ? COLORS.danger : COLORS.grey }}>{label}</Text>
        {React.createElement('input', {
          type: 'date', value: value || '', disabled: !!disabled, min, max,
          onChange: (e) => onChangeText(e.target.value || ''),
          style: {
            width: '100%', height: 56, boxSizing: 'border-box', padding: '0 16px', fontSize: 16, fontFamily: 'inherit',
            color: COLORS.text, backgroundColor: '#fff', borderRadius: 14, outline: 'none',
            border: `1px solid ${error ? COLORS.danger : '#E3D3C8'}`,
          },
        })}
      </View>
      <HelperText type={error ? 'error' : 'info'} visible={!!(error || hint)}>{error || hint}</HelperText>
    </View>
  );
}