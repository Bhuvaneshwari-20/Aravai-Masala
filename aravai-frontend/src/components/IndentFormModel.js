import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import useOptions from '../hooks/useOptions';
import ModalShell from './ModalShell';
import FormField from './FormField';
import DateField from './DateField';
import SelectField from './SelectField';
import { COLORS } from '../theme';

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EMPTY_LINE = { material_id: null, specification: '', required_qty: '', required_date: '' };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;
const qty = (n) => String(Number(Number(n).toFixed(3)));

// Admin: new indent. Fill the material line, press "Add line" (repeat for more materials), then "Save Indent".
export default function IndentFormModal({ visible, indent, onDismiss, onSaved }) {
  const materials = useOptions('/materials', { active: 'true' },
    (m) => ({ value: m.id, label: m.material_name, stock: Number(m.current_stock) || 0, unit: m.unit || 'KG' }), visible);
  const [line, setLine] = useState(EMPTY_LINE);
  const [lines, setLines] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

 useEffect(() => {
  if (!visible) return;
  setLine(EMPTY_LINE); setErrors({}); setErr(''); setSaving(false);
  setRemarks(indent?.remarks || '');
  setLines(indent ? indent.items.map((i) => ({
    material_id: i.material_id, name: i.material_name, specification: i.specification || '',
    required_qty: String(Number(i.required_qty)), required_date: String(i.required_date).slice(0, 10),
    unit: i.unit, available: Number(i.available_qty),
  })) : []);
}, [visible]);

  const mat = materials.find((m) => m.value === line.material_id);   // the picked material -> available quantity is its stock
  const setL = (k) => (v) => setLine((p) => ({ ...p, [k]: v }));

  const addLine = () => {
    const e = {};
    if (!line.material_id) e.material_id = 'Select a material';
    else if (lines.some((l) => l.material_id === line.material_id)) e.material_id = 'Already added below';
    if (!(Number(line.required_qty) > 0)) e.required_qty = 'Enter required quantity';
    if (!line.required_date) e.required_date = 'Select the date';
    else if (line.required_date < todayStr()) e.required_date = 'Date cannot be in the past';
    setErrors(e);
    if (Object.keys(e).length) return;
    setLines((p) => [...p, { ...line, specification: line.specification.trim(), name: mat.label, unit: mat.unit, available: mat.stock }]);
    setLine(EMPTY_LINE);
  };

  const save = async () => {
    if (!lines.length) { setErr('Add at least one material line'); return; }
    setSaving(true); setErr('');
    try {
      const items = lines.map((l) => ({ material_id: l.material_id, specification: l.specification, required_qty: l.required_qty, required_date: l.required_date }));
      await (indent
        ? api.put(`/indents/${indent.id}`, { remarks: remarks.trim(), items })
        : api.post('/indents', { indent_date: todayStr(), remarks: remarks.trim(), items }));
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="file-document-edit-outline" maxWidth={760}
     title={indent ? `Edit ${indent.indent_no}` : 'New Indent'} subtitle={indent ? (indent.status === 'APPROVED' ? 'Saving sends it to the Manager again' : 'Update this indent') : 'Indent no. is given when saved'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || !lines.length} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="send">{indent ? (indent.status === 'APPROVED' ? 'Save & Send Again' : 'Update Indent') : 'Save Indent'}</Button>
        </View>
      )}>
      {!!err && <Text style={{ color: COLORS.danger, marginBottom: 8 }}>{err}</Text>}

      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        <View style={{ flex: 1, marginRight: 8 }}><FormField label="Indent No." value="Auto generated" editable={false} /></View>
        <View style={{ flex: 1 }}><FormField label="Indent Date" value={todayStr()} editable={false} /></View>
      </View>

      <Label>ADD MATERIAL</Label>
      <SelectField label="Material Name *" value={line.material_id} options={materials} onChange={setL('material_id')} error={errors.material_id} />
      <FormField label="Specification" value={line.specification} onChangeText={setL('specification')} maxLength={255} />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <FormField label="Available Quantity (stock)" value={mat ? `${qty(mat.stock)} ${mat.unit}` : ''} editable={false} />
        </View>
        <View style={{ flex: 1 }}>
          <FormField label={`Required Quantity${mat ? ` (${mat.unit})` : ''} *`} numeric value={line.required_qty} onChangeText={setL('required_qty')} error={errors.required_qty} />
        </View>
      </View>
      <DateField label="Required Date *" value={line.required_date} onChangeText={setL('required_date')} error={errors.required_date} min={todayStr()} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 }}>
        <Button mode="outlined" onPress={() => { setLine(EMPTY_LINE); setErrors({}); }} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 8 }}>Clear</Button>
        <Button mode="contained" icon="plus" onPress={addLine} buttonColor={COLORS.primary} style={{ borderRadius: 10 }}>Add line</Button>
      </View>

      <Label>MATERIALS IN THIS INDENT ({lines.length})</Label>
      {!lines.length && <Text style={{ color: COLORS.grey, textAlign: 'center', paddingVertical: 14 }}>No lines yet. Fill the form above and press Add line.</Text>}
      {lines.map((l, i) => (
        <View key={l.material_id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
          <Text style={{ width: 24, color: COLORS.grey, fontWeight: '800' }}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '800', color: COLORS.text }}>{l.name}</Text>
            {!!l.specification && <Text style={{ color: COLORS.grey, fontSize: 12 }}>{l.specification}</Text>}
            <Text style={{ color: COLORS.grey, fontSize: 12 }}>Stock {qty(l.available)} {l.unit} · Need by {l.required_date}</Text>
          </View>
          <Text style={{ fontWeight: '900', color: COLORS.text, marginRight: 6 }}>{qty(l.required_qty)} {l.unit}</Text>
          <Button compact onPress={() => setLines((p) => p.filter((x) => x.material_id !== l.material_id))} textColor={COLORS.danger}><MCI name="close" size={18} color={COLORS.danger} /></Button>
        </View>
      ))}
      <View style={{ marginTop: 12 }}><FormField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} multiline maxLength={500} /></View>
    </ModalShell>
  );
}
