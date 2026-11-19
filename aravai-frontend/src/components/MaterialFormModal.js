import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import { COLORS } from '../theme';

const NEW_UNIT = ''; // a new material has NO unit. The unit is chosen when its first stock is received (Material Stock > Material Receipt)
const EMPTY = { material_name: '', short_code: '', unit: NEW_UNIT };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// Add (no id) or Edit (id) material, as a popup on the same page.
// New units are added from the Material Receipt popup (Material Stock), not here.
export default function MaterialFormModal({ visible, id, onDismiss, onSaved }) {
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [stock, setStock] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF(EMPTY); setStock(null); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    (async () => {
      try {
        if (isEdit) {
          const r = (await api.get(`/materials/${id}`)).data.data;
          setF({ ...EMPTY, material_name: r.material_name, short_code: r.sku || '', unit: r.unit || '' });
          setStock(r);
        }
      } catch (e) { setErr(errMsg(e)); }
      setLoading(false);
    })();
  }, [visible, id]); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!f.material_name.trim()) e.material_name = 'Material name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      // specifications are no longer sent, so any specs already saved on a material stay as they are
      const body = { material_name: f.material_name.trim(), sku: f.short_code.trim().toUpperCase(), unit: f.unit };
      if (isEdit) await api.put(`/materials/${id}`, body);
      else await api.post('/materials', body);
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };


  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'package-variant'}
      title={isEdit ? 'Edit Material' : 'Add Material'} subtitle={isEdit ? stock?.material_code : 'Name and code. Unit is chosen when stock is added'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || loading} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
            {isEdit ? 'Update Material' : 'Save Material'}
          </Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View> : (
        <View>
          <Label>BASIC DETAILS</Label>
          <FormField label="Material name *" value={f.material_name} onChangeText={set('material_name')} error={errors.material_name} />
          <FormField label="Material code (e.g. AST, CUM)" value={f.short_code} onChangeText={(t) => set('short_code')(t.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} maxLength={10} autoCapitalize="characters" />

          {!!err && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 12 }}>
              <MCI name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
            </View>
          )}
        </View>
      )}
    </ModalShell>
  );
}