import React from 'react';
import { Platform, View } from 'react-native';
import { Text, HelperText } from 'react-native-paper';
import FormField from './FormField';
import { COLORS } from '../theme';

// Time picker for HH:MM (24 hour). Drop-in replacement for the old typed time boxes:
//   <TimeField label="Start time *" value={f.start} onChangeText={set('start')} error={errors.start} />
// Web build : the browser's own clock picker (the "13:02 + clock icon" box).
// Phone     : plain HH:MM box that formats itself while typing (0930 -> 09:30).
// The value is always '' or 'HH:MM', exactly what the forms and the server already expect.
const mask = (t) => { const d = String(t || '').replace(/[^0-9]/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };

export default function TimeField({ label, value, onChangeText, error: errorProp, hint, disabled, min }) {
  // optional: pass min={startTime} on an End time box -> an end time that is not after it is flagged straight away
  const error = errorProp || (min && value && value <= min ? 'End time must be after start time' : undefined);
  if (Platform.OS !== 'web') {
    return <FormField label={label} value={value || ''} onChangeText={(t) => onChangeText(mask(t))} error={error} hint={hint || 'HH:MM, e.g. 10:00'} maxLength={5} editable={!disabled} />;
  }
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', top: -8, left: 14, zIndex: 2, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 12, color: error ? COLORS.danger : COLORS.grey }}>{label}</Text>
        {React.createElement('input', {
          type: 'time', step: 60, value: value || '', disabled: !!disabled, min: min || undefined,
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