import React, { useState } from 'react';
import { View, TouchableOpacity, Pressable, TextInput as RNInput, StyleSheet } from 'react-native';
import { TextInput, HelperText, Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import ModalShell from './ModalShell';
import { COLORS } from '../theme';

// Dropdown that opens a small centred popup. options: [{ value, label }]
// onCreate(name) -> Promise<{ value, label }>  (optional) adds an "add new" box at the bottom of the popup.
export default function SelectField({ label, value, options, onChange, error, disabled, onCreate, createLabel = 'Add new' }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cerr, setCerr] = useState('');
  const selected = options.find((o) => o.value === value);
  const title = String(label).replace(/\s*\*$/, '');

  const close = () => { setOpen(false); setName(''); setCerr(''); };
  const create = async () => {
    if (!name.trim()) return setCerr('Enter a name');
    setBusy(true); setCerr('');
    try {
      const o = await onCreate(name.trim());
      onChange(o.value); close();
    } catch (e) { setCerr(e.message || 'Could not add'); }
    setBusy(false);
  };

  return (
    <View style={{ marginBottom: 4 }}>
      <TouchableOpacity activeOpacity={0.7} disabled={disabled} onPress={() => setOpen(true)}>
        <View pointerEvents="none">
          <TextInput mode="outlined" label={label} value={selected ? selected.label : ''} editable={false}
            error={!!error} disabled={disabled} outlineColor="#E3D3C8" outlineStyle={{ borderRadius: 14 }} style={{ backgroundColor: '#fff', minHeight: 56 }}
            right={<TextInput.Icon icon="menu-down" />} />
        </View>
      </TouchableOpacity>
      <HelperText type="error" visible={!!error}>{error}</HelperText>

      <ModalShell visible={open} onDismiss={close} title={`Select ${title}`} icon="format-list-bulleted" maxWidth={400} noPad busy={busy}
        footer={onCreate ? (
          <View style={{ flex: 1 }}>
            <View style={s.addRow}>
              <RNInput value={name} onChangeText={setName} placeholder={createLabel} placeholderTextColor={COLORS.grey}
                onSubmitEditing={create} style={s.addInput} />
              <Button mode="contained" buttonColor={COLORS.green} onPress={create} loading={busy} disabled={busy} style={{ borderRadius: 10 }}>Add</Button>
            </View>
            {!!cerr && <Text style={s.cerr}>{cerr}</Text>}
          </View>
        ) : null}>
        <View style={{ paddingVertical: 6 }}>
          {options.length === 0 && (
            <Text style={s.empty}>{onCreate ? 'No options yet. Add the first one below.' : 'No options available'}</Text>
          )}
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable key={String(o.value)} onPress={() => { onChange(o.value); close(); }}
                style={({ hovered }) => [s.item, on && s.itemOn, hovered && !on && { backgroundColor: '#F6F1EC' }]}>
                <Text style={[s.itemText, on && { color: COLORS.primary, fontWeight: '800' }]}>{o.label}</Text>
                {on && <MCI name="check-circle" size={20} color={COLORS.primary} />}
              </Pressable>
            );
          })}
        </View>
      </ModalShell>
    </View>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 13 },
  itemOn: { backgroundColor: '#FDECEA' },
  itemText: { fontSize: 15, color: COLORS.text, fontWeight: '600' },
  empty: { textAlign: 'center', color: COLORS.grey, padding: 24 },
  addRow: { flexDirection: 'row', alignItems: 'center' },
  addInput: { flex: 1, height: 40, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, marginRight: 10, color: COLORS.text, outlineStyle: 'none' },
  cerr: { color: COLORS.danger, fontSize: 12, marginTop: 6, fontWeight: '600' },
});
