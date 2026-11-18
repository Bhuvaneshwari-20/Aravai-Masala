import React, { useEffect, useState } from 'react';
import { View, TextInput as RNInput } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const EMPTY = { material_name: '', short_code: '', unit: null };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// Add (no id) or Edit (id) material, as a popup on the same page.
export default function MaterialFormModal({ visible, id, onDismiss, onSaved }) {
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [units, setUnits] = useState([]);
  const [stock, setStock] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // "Add unit" mini form
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnit, setNewUnit] = useState('');
  const [unitBusy, setUnitBusy] = useState(false);
  const [unitErr, setUnitErr] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF(EMPTY); setStock(null); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    setAddingUnit(false); setNewUnit(''); setUnitErr('');
    (async () => {
      try {
        // unit list comes only from the database (material_units table)
        const list = (await api.get('/materials/units')).data.data;
        setUnits(Array.isArray(list) ? list.map((u) => u.unit_name) : []);
        if (isEdit) {
          const r = (await api.get(`/materials/${id}`)).data.data;
          setF({ ...EMPTY, material_name: r.material_name, short_code: r.sku || '', unit: r.unit });
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
      // specifications are no longer sent, so any specs already saved on a material stay as they are
      const body = { material_name: f.material_name.trim(), sku: f.short_code.trim().toUpperCase(), unit: f.unit };
      if (isEdit) await api.put(`/materials/${id}`, body);
      else await api.post('/materials', body);
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  const closeUnitForm = () => { setAddingUnit(false); setNewUnit(''); setUnitErr(''); };
  const addUnit = async () => {
    const name = newUnit.trim();
    if (!name) return setUnitErr('Enter a unit name');
    setUnitBusy(true); setUnitErr('');
    try {
      const u = (await api.post('/materials/units', { unit_name: name })).data.data;
      setUnits((p) => (p.includes(u.unit_name) ? p : [...p, u.unit_name]));
      set('unit')(u.unit_name);                       // select the new unit straight away
      setErrors((p) => ({ ...p, unit: undefined }));
      closeUnitForm();
    } catch (e) { setUnitErr(errMsg(e)); }
    setUnitBusy(false);
  };

  const unitOptions = units.map((u) => ({ value: u, label: u }));

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'package-variant'}
      title={isEdit ? 'Edit Material' : 'Add Material'} subtitle={isEdit ? stock?.material_code : 'Name, code and unit'}
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
          <SelectField label="Unit *" value={f.unit} options={unitOptions} onChange={set('unit')} error={errors.unit} />

          <Label style={{ marginTop: 6 }}>UNITS</Label>
          {addingUnit ? (
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <RNInput value={newUnit} onChangeText={(t) => setNewUnit(t.toUpperCase())} placeholder="New unit (e.g. PACKET, BOX)" placeholderTextColor={COLORS.grey}
                  maxLength={20} autoFocus autoCapitalize="characters" onSubmitEditing={addUnit}
                  style={{ flex: 1, height: 44, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: '#fff', paddingHorizontal: 12, marginRight: 10, color: COLORS.text, outlineStyle: 'none' }} />
                <Button mode="contained" buttonColor={COLORS.green} onPress={addUnit} loading={unitBusy} disabled={unitBusy} style={{ borderRadius: 10, marginRight: 6 }}>Add</Button>
                <Button mode="text" textColor={COLORS.grey} onPress={closeUnitForm} disabled={unitBusy}>Cancel</Button>
              </View>
              {!!unitErr && <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 6, fontWeight: '600' }}>{unitErr}</Text>}
            </View>
          ) : (
            <Button mode="outlined" icon="plus" onPress={() => setAddingUnit(true)} textColor={COLORS.green}
              style={{ borderRadius: 10, borderColor: COLORS.green, alignSelf: 'flex-start', marginBottom: 14 }}>Add unit</Button>
          )}

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