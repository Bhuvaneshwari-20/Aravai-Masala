import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, TextInput, Platform } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import ModalShell from './ModalShell';
import { COLORS, SHADOW } from '../theme';

// Small input widgets shared by the New Sales Entry tabs (Customers + Invoice).
// They live at module level so inputs keep focus while typing.

export const maskDate = (t) => {
  const d = String(t || '').replace(/[^0-9]/g, '').slice(0, 8);
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
};

// Dropdown that opens a popup. options: [{ value, label, short? }].  searchable adds a search box,
// footer = { label, onPress } adds an "add new ..." row at the top of the popup.
export function MiniSelect({ value, options, onChange, placeholder = 'Select', title = 'option', error, disabled, style, searchable, footer }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = options.find((o) => o.value === value);
  const shown = searchable && q.trim() ? options.filter((o) => String(o.label).toLowerCase().includes(q.trim().toLowerCase())) : options;
  const close = () => { setOpen(false); setQ(''); };
  return (
    <>
      <Pressable disabled={disabled} onPress={() => setOpen(true)} accessibilityRole="button"
        style={({ hovered }) => [s.box, error && s.boxErr, disabled && { opacity: 0.55 }, hovered && !disabled && { borderColor: COLORS.primary }, style]}>
        <Text style={[s.boxText, !sel && { color: '#A39890', fontWeight: '500' }]} numberOfLines={1}>{sel ? (sel.short ?? sel.label) : placeholder}</Text>
        <MCI name="chevron-down" size={19} color={COLORS.textSoft} />
      </Pressable>
      <ModalShell visible={open} onDismiss={close} title={`Select ${title}`} icon="format-list-bulleted" maxWidth={440} noPad>
        {searchable && (
          <View style={s.searchWrap}>
            <MCI name="magnify" size={20} color={COLORS.textSoft} />
            <TextInput value={q} onChangeText={setQ} placeholder={`Search ${title}`} placeholderTextColor="#B5ABA3" style={s.searchInput} autoFocus />
          </View>
        )}
        {!!footer && (
          <Pressable onPress={() => { close(); footer.onPress(); }} style={({ hovered }) => [s.optAdd, hovered && { backgroundColor: COLORS.primarySoft }]}>
            <View style={s.optAddIcon}><MCI name="plus" size={18} color="#fff" /></View>
            <Text style={s.optAddText}>{footer.label}</Text>
          </Pressable>
        )}
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingVertical: 6 }}>
            {shown.length === 0 && <Text style={s.optEmpty}>{q.trim() ? 'No match found' : 'No options available'}</Text>}
            {shown.map((o) => {
              const on = o.value === value;
              return (
                <Pressable key={String(o.value)} onPress={() => { onChange(o.value); close(); }}
                  style={({ hovered }) => [s.opt, on && { backgroundColor: COLORS.primarySoft }, hovered && !on && { backgroundColor: COLORS.greyBg }]}>
                  <Text style={[s.optText, on && { color: COLORS.primary, fontWeight: '800' }]}>{o.label}</Text>
                  {on && <MCI name="check-circle" size={20} color={COLORS.primary} />}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </ModalShell>
    </>
  );
}

export function Box({ value, onChange, numeric, digits, error, align = 'right', editable = true, placeholder, maxLength, style, multiline }) {
  const handle = (t) => {
    if (numeric) {
      let x = t.replace(/[^0-9.]/g, '');
      const i = x.indexOf('.');
      if (i !== -1) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, '');
      return onChange(x);
    }
    if (digits) return onChange(t.replace(/[^0-9]/g, ''));
    return onChange(t);
  };
  return (
    <TextInput value={value} onChangeText={handle} editable={editable} placeholder={placeholder} placeholderTextColor="#B5ABA3" maxLength={maxLength} multiline={multiline}
      keyboardType={numeric ? 'decimal-pad' : digits ? 'number-pad' : 'default'}
      style={[s.box, s.input, { textAlign: align }, error && s.boxErr, !editable && s.boxRO, multiline && { height: 70, paddingTop: 12, textAlignVertical: 'top' }, style]} />
  );
}

export function DateBox({ value, onChange, error, max }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date', value: value || '', max, onChange: (e) => onChange(e.target.value || ''),
      style: { width: '100%', height: 46, boxSizing: 'border-box', padding: '0 14px', fontSize: 14.5, fontFamily: 'inherit', fontWeight: 600, color: COLORS.text, backgroundColor: '#fff', borderRadius: 12, outline: 'none', border: `1.5px solid ${error ? COLORS.danger : COLORS.border}` },
    });
  }
  return <Box align="left" value={value} onChange={(t) => onChange(maskDate(t))} placeholder="YYYY-MM-DD" maxLength={10} digits={false} error={error} />;
}

export function Field({ label, req, error, children, style }) {
  return (
    <View style={[{ marginBottom: 6 }, style]}>
      <Text style={s.label}>{label}{req ? <Text style={{ color: COLORS.danger }}> *</Text> : null}</Text>
      {children}
      {!!error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

export function Btn({ icon, label, onPress, filled, tone = COLORS.primary, loading, disabled, style }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered, pressed }) => [s.btn, { borderColor: tone }, filled && { backgroundColor: tone }, hovered && !filled && { backgroundColor: `${tone}12` }, (disabled || loading) && { opacity: 0.6 }, pressed && { opacity: 0.85 }, filled && SHADOW.sm, style]}>
      {loading ? <ActivityIndicator size={16} color={filled ? '#fff' : tone} /> : !!icon && <MCI name={icon} size={18} color={filled ? '#fff' : tone} />}
      <Text style={[s.btnText, { color: filled ? '#fff' : tone }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, icon, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ hovered }) => [s.chip, on && s.chipOn, hovered && !on && { borderColor: COLORS.primary }]}>
      {!!icon && <MCI name={icon} size={17} color={on ? '#fff' : COLORS.textSoft} />}
      <Text style={[s.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  err: { color: COLORS.danger, fontSize: 12, fontWeight: '700', marginTop: 4 },
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 12 },
  boxErr: { borderColor: COLORS.danger },
  boxRO: { backgroundColor: COLORS.greyBg, color: COLORS.textSoft },
  boxText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: COLORS.text, marginRight: 6 },
  input: { fontSize: 14.5, fontWeight: '700', color: COLORS.text, outlineStyle: 'none', minWidth: 0 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 13 },
  optText: { fontSize: 15, color: COLORS.text, fontWeight: '600', flex: 1, marginRight: 8 },
  optEmpty: { textAlign: 'center', color: COLORS.grey, padding: 24 },
  optAdd: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  optAddIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  optAddText: { marginLeft: 12, fontSize: 15, fontWeight: '800', color: COLORS.primary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, marginBottom: 6, paddingHorizontal: 12, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff' },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14.5, fontWeight: '600', color: COLORS.text, outlineStyle: 'none' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 18, marginLeft: 10 },
  btnText: { marginLeft: 7, fontSize: 14, fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', marginRight: 8, marginBottom: 6 },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { marginLeft: 6, fontSize: 13.5, fontWeight: '800', color: COLORS.text },
});
