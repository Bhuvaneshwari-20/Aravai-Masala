import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const UNITS = ['KG', 'GRAM', 'NOS', 'LITRE', 'BAGS'].map((u) => ({ value: u, label: u }));
const EMPTY = { material_name: '', unit: null, specifications: [] };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// Add (no id) or Edit (id) material, as a popup on the same page.
export default function MaterialFormModal({ visible, id, onDismiss, onSaved }) {
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [stock, setStock] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const addSpec = () => setF((p) => ({ ...p, specifications: [...p.specifications, ''] }));
  const setSpec = (i, t) => setF((p) => ({ ...p, specifications: p.specifications.map((x, j) => (j === i ? t : x)) }));
  const removeSpec = (i) => setF((p) => ({ ...p, specifications: p.specifications.filter((_, j) => j !== i) }));

  useEffect(() => {
    if (!visible) return;
    setF(EMPTY); setStock(null); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    (async () => {
      try {
        if (isEdit) {
          const r = (await api.get(`/materials/${id}`)).data.data;
          setF({ ...EMPTY, material_name: r.material_name, unit: r.unit,
            specifications: Array.isArray(r.specifications) ? r.specifications : [] });
          setStock(r);
        }
      } catch (e) { setErr(errMsg(e)); }
      setLoading(false);
    })();
  }, [visible, id]); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!f.material_name.trim()) e.material_name = 'Material name is required';
    if (!f.unit) e.unit = 'Please select a unit';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      const body = { material_name: f.material_name.trim(), unit: f.unit,
        specifications: f.specifications.map((x) => x.trim()).filter(Boolean) };
      if (isEdit) await api.put(`/materials/${id}`, body);
      else await api.post('/materials', body);
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'package-variant'}
      title={isEdit ? 'Edit Material' : 'Add Material'} subtitle={isEdit ? stock?.material_code : 'Name, unit and specifications'}
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
          <SelectField label="Unit *" value={f.unit} options={UNITS} onChange={set('unit')} error={errors.unit} />

          <Label style={{ marginTop: 6 }}>SPECIFICATIONS</Label>
          {f.specifications.map((sp, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <FormField label={`Specification ${i + 1}`} value={sp} onChangeText={(t) => setSpec(i, t)} maxLength={255} />
              </View>
              <IconButton icon="close" size={20} iconColor={COLORS.danger} onPress={() => removeSpec(i)}
                accessibilityLabel={`Remove specification ${i + 1}`} style={{ marginTop: 10 }} />
            </View>
          ))}
          <Button mode="outlined" icon="plus" onPress={addSpec} textColor={COLORS.green}
            style={{ borderRadius: 10, borderColor: COLORS.green, alignSelf: 'flex-start', marginBottom: 14 }}>Add specification</Button>

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