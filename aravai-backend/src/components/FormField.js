import React from 'react';
import { View } from 'react-native';
import { TextInput, HelperText } from 'react-native-paper';

// numeric = decimal keyboard (digits and one dot only); digits = integer keyboard (digits only)
export default function FormField({ label, value, onChangeText, error, numeric, digits, multiline, hint, ...rest }) {
  const handle = (t) => {
    if (numeric) {
      let x = t.replace(/[^0-9.]/g, '');
      const i = x.indexOf('.');
      if (i !== -1) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
      return onChangeText(x);
    }
    if (digits) return onChangeText(t.replace(/[^0-9]/g, ''));
    return onChangeText(t);
  };
  return (
    <View style={{ marginBottom: 4 }}>
      <TextInput mode="outlined" label={label} value={value} onChangeText={handle} error={!!error}
        keyboardType={numeric ? 'decimal-pad' : digits ? 'number-pad' : 'default'}
        multiline={multiline} numberOfLines={multiline ? 3 : 1}
        outlineColor="#E3D3C8" activeOutlineColor="#B01E1E" outlineStyle={{ borderRadius: 14 }}
        style={{ backgroundColor: '#fff', minHeight: multiline ? 90 : 56 }} {...rest} />
      <HelperText type={error ? 'error' : 'info'} visible={!!(error || hint)}>{error || hint}</HelperText>
    </View>
  );
}
