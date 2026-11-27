import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import { splitSeconds, fmtDuration } from './DurationField';
import { COLORS } from '../theme';

const NEW_UNIT = ''; // a new material has NO unit. The unit is chosen when its first stock is received (Material Stock > Material Receipt)
const EMPTY = { material_name: '', short_code: '', unit: NEW_UNIT, low: '', roast: '' }; // roast = roasting time typed as text, e.g. 01:30:00

// Roasting time typed in ONE field:  "1:30:00" = 1h 30m 0s,  "1:30" = 1h 30m,  "45" = 45 minutes.
// Returns { total (seconds), error }
const parseRoast = (txt) => {
  const t = String(txt || '').trim();
  if (!t) return { total: 0 };
  const nums = t.split(':').map((p) => (p === '' ? 0 : Number(p)));
  if (nums.length > 3 || nums.some((n) => Number.isNaN(n))) return { total: 0, error: 'Type like 01:30:00 (hours:minutes:seconds)' };
  let h = 0, m = 0, s = 0;
  if (nums.length === 1) m = nums[0]; else if (nums.length === 2) [h, m] = nums; else [h, m, s] = nums;
  if (nums.length >= 2 && m > 59) return { total: 0, error: 'Minutes cannot be more than 59' };
  if (nums.length === 3 && s > 59) return { total: 0, error: 'Seconds cannot be more than 59' };
  const total = h * 3600 + m * 60 + s;
  if (total > 86400) return { total: 0, error: 'Roasting time cannot be more than 24 hours' };
  return { total };
};
const pad2 = (n) => String(n).padStart(2, '0');
const toClock = (sec) => { const t = splitSeconds(sec); return `${pad2(t.h)}:${pad2(t.m)}:${pad2(t.s)}`; };
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
  const roast = parseRoast(f.roast); // { total seconds, error }

  useEffect(() => {
    if (!visible) return;
    setF(EMPTY); setStock(null); setErrors({}); setErr(''); setSaving(false); setLoading(true);
    (async () => {
      try {
        if (isEdit) {
          const r = (await api.get(`/materials/${id}`)).data.data;
          setF({ ...EMPTY, material_name: r.material_name, short_code: r.sku || '', unit: r.unit || '', low: Number(r.minimum_stock) > 0 ? String(Number(r.minimum_stock)) : '', roast: r.roast_seconds ? toClock(r.roast_seconds) : '' });
          setStock(r);
        }
      } catch (e) { setErr(errMsg(e)); }
      setLoading(false);
    })();
  }, [visible, id]); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!f.material_name.trim()) e.material_name = 'Material name is required';
    if (roast.error) e.roast = roast.error;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      // specifications are no longer sent, so any specs already saved on a material stay as they are
      const body = { material_name: f.material_name.trim(), sku: f.short_code.trim().toUpperCase(), unit: f.unit, minimum_stock: f.low === '' ? 0 : f.low, roast_seconds: roast.total || '' };
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

          <FormField label={`Based on this material set lowstock${stock?.unit ? ` (${stock.unit})` : ''}`} value={f.low} onChangeText={set('low')} numeric maxLength={10} error={errors.low}
            hint="Hint: Example: 5. If stock goes below this, it shows as Low stock" />
          <FormField label="Roasting time (HH:MM:SS)" value={f.roast} onChangeText={(t) => set('roast')(t.replace(/[^0-9:]/g, ''))} maxLength={8}
            keyboardType="numbers-and-punctuation" error={errors.roast}
            hint={roast.total > 0 ? `= ${fmtDuration(roast.total)}. Comes automatically in New Batch for this material` : 'Optional. Type hours:minutes:seconds, e.g. 01:30:00'} />

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