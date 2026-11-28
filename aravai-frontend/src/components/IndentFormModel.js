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
const EMPTY_LINE = { material_id: null, required_qty: '', required_date: '' };
const qty = (n) => String(Number(Number(n).toFixed(3)));

// numbered section heading
const Section = ({ no, title, right, children }) => (
  <View style={{ marginBottom: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{no}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '900', letterSpacing: 1, color: COLORS.text }}>{title}</Text>
      {right}
    </View>
    {children}
  </View>
);
const Pair = ({ children }) => (
  <View style={{ flexDirection: 'row' }}>
    {React.Children.map(children, (c, i) => <View style={{ flex: 1, marginRight: i === 0 ? 10 : 0 }}>{c}</View>)}
  </View>
);

// Admin: new indent (or edit). Pick material -> stock shows -> required qty + date -> "Add line" (repeat) -> Save.
export default function IndentFormModal({ visible, indent, onDismiss, onSaved }) {
  const materials = useOptions('/materials', { active: 'true' },
    (m) => ({ value: m.id, label: m.material_name, stock: Number(m.current_stock) || 0, unit: m.unit || 'KG' }), visible);
  const [indentNo, setIndentNo] = useState('');
  const [indentDate, setIndentDate] = useState(todayStr());
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
    setIndentDate(indent ? String(indent.indent_date).slice(0, 10) : todayStr());
    setIndentNo(indent ? indent.indent_no : '');
    setLines(indent ? indent.items.map((i) => ({
      material_id: i.material_id, name: i.material_name, specification: i.specification || '',
      required_qty: String(Number(i.required_qty)), required_date: String(i.required_date).slice(0, 10),
      unit: i.unit, available: Number(i.available_qty),
    })) : []);
    if (!indent) api.get('/indents/next-no').then((r) => setIndentNo(r.data.data.indent_no)).catch(() => setIndentNo(''));
  }, [visible]);

  const mat = materials.find((m) => m.value === line.material_id);
  const setL = (k) => (v) => setLine((p) => ({ ...p, [k]: v }));
  const toBuy = mat && Number(line.required_qty) > 0 ? Math.max(0, Number(line.required_qty) - mat.stock) : null;

  const addLine = () => {
    const e = {};
    if (!line.material_id) e.material_id = 'Select a material';
    else if (lines.some((l) => l.material_id === line.material_id)) e.material_id = 'Already added below';
    if (!(Number(line.required_qty) > 0)) e.required_qty = 'Enter required quantity';
    if (!line.required_date) e.required_date = 'Select the date';
    else if (line.required_date < indentDate) e.required_date = 'Cannot be before the indent date';
    setErrors(e);
    if (Object.keys(e).length) return;
    setLines((p) => [...p, { ...line, specification: '', name: mat.label, unit: mat.unit, available: mat.stock }]);
    setLine(EMPTY_LINE);
  };

  const save = async () => {
    if (!lines.length) { setErr('Add at least one material line'); return; }
    setSaving(true); setErr('');
    try {
      const items = lines.map((l) => ({ material_id: l.material_id, specification: l.specification || '', required_qty: l.required_qty, required_date: l.required_date }));
      await (indent
        ? api.put(`/indents/${indent.id}`, { remarks: remarks.trim(), items })
        : api.post('/indents', { indent_date: indentDate, remarks: remarks.trim(), items }));
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="file-document-edit-outline" maxWidth={760}
      title={indent ? `Edit ${indent.indent_no}` : 'New Indent'}
      subtitle={indent ? (indent.status === 'APPROVED' ? 'Saving sends it to the Manager again' : 'Update this indent') : 'Create a new material request'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || !lines.length} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="send">
            {indent ? (indent.status === 'APPROVED' ? 'Save & Send Again' : 'Update Indent') : 'Submit Indent'}
          </Button>
        </View>
      )}>
      {!!err && <Text style={{ color: COLORS.danger, marginBottom: 10 }}>{err}</Text>}

      <Section no="1" title="INDENT INFORMATION">
        <Pair>
          <FormField label="Indent No." value={indentNo || 'Auto generated'} editable={false} />
          {indent
            ? <FormField label="Indent Date" value={indentDate} editable={false} />
            : <DateField label="Indent Date *" value={indentDate} onChangeText={setIndentDate} max={todayStr()} />}
        </Pair>
      </Section>

      <Section no="2" title="ADD MATERIAL">
        <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12 }}>
          <SelectField label="Material Name *" value={line.material_id} options={materials} onChange={setL('material_id')} error={errors.material_id} />
          <Pair>
            <FormField label="Available Stock" value={mat ? `${qty(mat.stock)} ${mat.unit}` : ''} editable={false} />
            <FormField label={`Required Quantity${mat ? ` (${mat.unit})` : ''} *`} numeric value={line.required_qty} onChangeText={setL('required_qty')} error={errors.required_qty} />
          </Pair>
          <Pair>
            <FormField label="Items to Purchase" value={toBuy === null ? '' : `${qty(toBuy)} ${mat.unit}`} editable={false} />
            <DateField label="Required Date *" value={line.required_date} onChangeText={setL('required_date')} error={errors.required_date} min={indentDate} />
          </Pair>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
            <Button mode="outlined" onPress={() => { setLine(EMPTY_LINE); setErrors({}); }} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 8 }}>Clear</Button>
            <Button mode="contained" icon="plus" onPress={addLine} buttonColor={COLORS.primary} style={{ borderRadius: 10 }}>Add line</Button>
          </View>
        </View>
      </Section>

      <Section no="3" title="MATERIAL LIST"
        right={<View style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 2 }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{lines.length}</Text></View>}>
        {!lines.length ? (
          <View style={{ alignItems: 'center', paddingVertical: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, borderRadius: 14 }}>
            <MCI name="clipboard-text-outline" size={26} color={COLORS.grey} />
            <Text style={{ color: COLORS.grey, marginTop: 6 }}>Added materials will appear here</Text>
          </View>
        ) : lines.map((l, i) => (
          <View key={l.material_id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <Text style={{ width: 24, color: COLORS.grey, fontWeight: '800' }}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{l.name}</Text>
              <Text style={{ color: COLORS.grey, fontSize: 12 }}>Stock {qty(l.available)} {l.unit} · To buy {qty(Math.max(0, Number(l.required_qty) - l.available))} {l.unit} · Need by {l.required_date}</Text>
            </View>
            <Text style={{ fontWeight: '900', color: COLORS.text, marginRight: 6 }}>{qty(l.required_qty)} {l.unit}</Text>
            <Button compact onPress={() => setLines((p) => p.filter((x) => x.material_id !== l.material_id))} textColor={COLORS.danger}><MCI name="close" size={18} color={COLORS.danger} /></Button>
          </View>
        ))}
      </Section>

      <Section no="4" title="REMARKS">
        <FormField label="Purpose / Remarks (optional)" value={remarks} onChangeText={setRemarks} multiline maxLength={500} />
      </Section>
    </ModalShell>
  );
}