import React, { useEffect, useState } from 'react';
import { Platform, View, Pressable, StyleSheet } from 'react-native';
import { Text, HelperText } from 'react-native-paper';
import FormField from './FormField';
import { COLORS } from '../theme';
import { useTimeFmt, setUses12h, split12, join12 } from '../timeFormat';

// Time picker. Drop-in replacement for the old typed time boxes:
//   <TimeField label="Start time *" value={f.start} onChangeText={set('start')} error={errors.start} />
// Web build : the browser's own clock picker (it follows the computer's 12 / 24 hour setting by itself).
// Phone     : 24-hour box (HH:MM, e.g. 20:30) OR 12-hour box (hh:mm + AM / PM). A small link switches between them; the choice is remembered.
// The value is always '' or 'HH:MM' (24-hour), exactly what the forms and the server already expect.
const mask24 = (t) => {
  let d = String(t || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (d.length && d[0] > '2') d = `0${d}`.slice(0, 4);             // 8 -> 08
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
const mask12 = (t) => {
  const d = String(t || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (d.length <= 1) return d;
  const one = d[0] > '1';                                            // 8 -> hour is one digit; 08 / 12 -> two digits
  const h = one ? d[0] : d.slice(0, 2);
  const m = one ? d.slice(1) : d.slice(2);
  return m ? `${h}:${m}` : h;
};

function PhoneTime({ label, value, onChangeText, error: errorProp, hint, disabled }) {
  const is12 = useTimeFmt();
  const [text, setText] = useState('');
  const [ap, setAp] = useState('AM');

  // the value changed from outside (default time, edit form) -> show it in 12-hour form
  useEffect(() => {
    if (!is12) return;
    if (value) { if (join12(text, ap) !== value) { const s = split12(value); setText(s.text); setAp(s.ap); } }
    else if (!text) setAp('AM');
  }, [value, is12]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!is12) {
    return (
      <View>
        <FormField label={label} value={value || ''} onChangeText={(t) => onChangeText(mask24(t))} error={errorProp} hint={hint || 'HH:MM, e.g. 20:30 (24-hour)'} maxLength={5} editable={!disabled} />
        <Pressable onPress={() => setUses12h(true)} hitSlop={6} style={s.switch}><Text style={s.switchText}>Use 12-hour time (AM / PM)</Text></Pressable>
      </View>
    );
  }
  const bad = text && !join12(text, ap) ? 'Enter a time like 08:30' : undefined;
  return (
    <View>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <FormField label={label} value={text} onChangeText={(t) => { const m = mask12(t); setText(m); onChangeText(join12(m, ap)); }}
            error={errorProp || bad} hint={hint || 'hh:mm, e.g. 08:30'} maxLength={5} editable={!disabled} />
        </View>
        <View style={s.ap}>
          {['AM', 'PM'].map((a) => (
            <Pressable key={a} disabled={disabled} onPress={() => { setAp(a); onChangeText(join12(text, a)); }} accessibilityRole="button" accessibilityState={{ selected: ap === a }}
              style={[s.apBtn, ap === a && s.apOn]}>
              <Text style={[s.apText, ap === a && { color: '#fff' }]}>{a}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable onPress={() => setUses12h(false)} hitSlop={6} style={s.switch}><Text style={s.switchText}>Use 24-hour time (e.g. 20:30)</Text></Pressable>
    </View>
  );
}

export default function TimeField({ label, value, onChangeText, error: errorProp, hint, disabled, min }) {
  // optional: pass min={startTime} on an End time box -> an end time that is not after it is flagged straight away
  const error = errorProp || (min && value && value <= min ? 'End time must be after start time' : undefined);
  if (Platform.OS !== 'web') return <PhoneTime label={label} value={value} onChangeText={onChangeText} error={error} hint={hint} disabled={disabled} />;
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

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  ap: { flexDirection: 'row', marginLeft: 8, marginTop: 4, height: 56, borderRadius: 14, borderWidth: 1, borderColor: '#E3D3C8', overflow: 'hidden', backgroundColor: '#fff' },
  apBtn: { width: 48, alignItems: 'center', justifyContent: 'center' },
  apOn: { backgroundColor: COLORS.primary },
  apText: { fontSize: 14, fontWeight: '800', color: COLORS.textSoft },
  switch: { alignSelf: 'flex-start', paddingVertical: 4, marginBottom: 4 },
  switchText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '800' },
});