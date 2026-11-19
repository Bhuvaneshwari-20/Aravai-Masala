import React, { useState } from 'react';
import { View, TextInput as RNInput } from 'react-native';
import { Text, Button } from 'react-native-paper';
import api, { errMsg } from '../api';
import { COLORS } from '../theme';

// "+ Add unit" button. Tap -> small box to type a new unit name -> saved in the database (material_units table).
// onAdded(unitName) is called after it is saved, so the parent form can react (show a message / select it).
export default function AddUnitBox({ onAdded }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const close = () => { setAdding(false); setName(''); setErr(''); };
  const add = async () => {
    const n = name.trim();
    if (!n) return setErr('Enter a unit name');
    setBusy(true); setErr('');
    try {
      const u = (await api.post('/materials/units', { unit_name: n })).data.data;
      close();
      onAdded && onAdded(u.unit_name);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  return adding ? (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <RNInput value={name} onChangeText={(t) => setName(t.toUpperCase())} placeholder="New unit (e.g. PACKET, BOX)" placeholderTextColor={COLORS.grey}
          maxLength={20} autoFocus autoCapitalize="characters" onSubmitEditing={add}
          style={{ flex: 1, height: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, marginRight: 10, color: COLORS.text, outlineStyle: 'none' }} />
        <Button mode="contained" buttonColor={COLORS.green} onPress={add} loading={busy} disabled={busy} style={{ borderRadius: 10, marginRight: 6 }}>Add</Button>
        <Button mode="text" textColor={COLORS.grey} onPress={close} disabled={busy}>Cancel</Button>
      </View>
      {!!err && <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 6, fontWeight: '600' }}>{err}</Text>}
    </View>
  ) : (
    <Button mode="outlined" icon="plus" onPress={() => setAdding(true)} textColor={COLORS.green}
      style={{ borderRadius: 10, borderColor: COLORS.green, alignSelf: 'flex-start', marginBottom: 14 }}>Add unit</Button>
  );
}