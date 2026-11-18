import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Animated, TextInput, StyleSheet, useWindowDimensions } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import useOptions from '../hooks/useOptions';
import { ErrorBox, ModalFooter } from './FormBits';
import { COLORS } from '../theme';

// ===== shared helpers (status / type meta, date formats) =====

export const MACHINE_STATUS = [
  { value: 'ACTIVE', label: 'Active' }, { value: 'IDLE', label: 'Idle' }, { value: 'UNDER_MAINTENANCE', label: 'Under maintenance' },
  { value: 'BREAKDOWN', label: 'Breakdown' }, { value: 'INACTIVE', label: 'Inactive' },
];

export const STATUS_STYLE = {
  ACTIVE: { color: COLORS.ok, bg: COLORS.okBg },
  IDLE: { color: COLORS.grey, bg: COLORS.greyBg },
  UNDER_MAINTENANCE: { color: COLORS.warn, bg: COLORS.warnBg },
  BREAKDOWN: { color: COLORS.danger, bg: COLORS.dangerBg },
  INACTIVE: { color: COLORS.grey, bg: COLORS.greyBg },
};

const TYPE_ICONS = { WEIGHING: 'scale-balance', ROASTING: 'fire', GRINDING: 'cog', BLENDING: 'blender', PACKING: 'package-variant-closed' };
export const typeIcon = (code) => TYPE_ICONS[code] || 'cog';

// Card text / form field names -> label shown in the modal header.
export const FIELD_LABELS = {
  machine_name: 'Machine name', machine_type: 'Machine type', status: 'Status', manufacturer: 'Manufacturer',
  operator_id: 'Operator', capacity: 'Capacity', capacity_unit: 'Capacity unit', model_no: 'Model no.',
  serial_no: 'Serial no.', location: 'Location / Section', calibration_due_date: 'Calibration due',
  installation_date: 'Installed on', last_maintenance_date: 'Last maintenance',
  maintenance_interval_days: 'Maintenance interval', next_maintenance_date: 'Next maintenance', remarks: 'Remarks',
};

export const statusLabel = (v) => (MACHINE_STATUS.find((x) => x.value === v) || {}).label || v;

export const fmtDateTime = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const fmtDay = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// ===== machine types hook (shared by form, list and Machine Type Management tab) =====

// One tiny shared "something changed" signal, so the machine form dropdown, the machine list filter chips
// and the Machine Types tab always show the same data (add / rename / delete in one place updates the others).
const listeners = new Set();
export const notifyMachineTypesChanged = () => listeners.forEach((fn) => fn());
export const subscribeMachineTypes = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Active machine types -> { types, options: [{ value: code, label: name }], loading, error, reload }
export function useMachineTypes(enabled = true) {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/machines/types');
      setTypes(r.data.data.items || []);
      setError('');
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useEffect(() => subscribeMachineTypes(load), [load]);

  const options = useMemo(() => types.map((t) => ({ value: t.code, label: t.name })), [types]);
  return { types, options, loading, error, reload: load };
}

// ===== dropdown with inline "+ Add New" =====

// Dropdown whose list can be extended without leaving the form.
//   options : [{ value, label }]
//   onAdd   : async (name) => newValue   (throw Error(message) to show an inline error)
//   canAdd  : show the "+ Add new ..." row
// The list opens inline (no overlay), so it works the same in a modal on phone, tablet and desktop.
export function DynamicSelect({
  label, value, options, onChange, error, placeholder = 'Select', loading,
  canAdd, addLabel = '+ Add New', addPlaceholder = 'New name', onAdd, autoOpen,
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState('');

  useEffect(() => { setOpen(!!autoOpen); }, [autoOpen]);

  const selected = options.find((o) => o.value === value);
  const shown = selected ? selected.label : value || '';

  const pick = (v) => { onChange(v); setOpen(false); setAdding(false); };

  const submit = async () => {
    const n = name.trim();
    if (!n) { setAddErr('Enter a name'); return; }
    setBusy(true); setAddErr('');
    try {
      const v = await onAdd(n);
      onChange(v);
      setName(''); setAdding(false); setOpen(false);
    } catch (e) { setAddErr(e.message || 'Could not add'); }
    setBusy(false);
  };

  return (
    <View style={{ marginBottom: 12 }}>
      {!!label && <Text style={ds.label}>{label}</Text>}
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={label}
        style={({ hovered }) => [ds.box, open && ds.boxOpen, !!error && ds.boxErr, hovered && !open && ds.boxHover]}>
        <Text style={[ds.value, !shown && ds.placeholder]} numberOfLines={1}>{shown || placeholder}</Text>
        {loading ? <ActivityIndicator size={16} color={COLORS.primary} /> : <MCI name={open ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.grey} />}
      </Pressable>
      {!!error && <Text style={ds.err}>{error}</Text>}

      {open && (
        <View style={ds.panel}>
          <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {!options.length && <Text style={ds.empty}>Nothing here yet</Text>}
            {options.map((o) => {
              const on = o.value === value;
              return (
                <Pressable key={String(o.value)} onPress={() => pick(o.value)} style={({ hovered }) => [ds.opt, on && ds.optOn, hovered && !on && ds.optHover]}>
                  <Text style={[ds.optText, on && { color: COLORS.primary }]}>{o.label}</Text>
                  {on && <MCI name="check" size={18} color={COLORS.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>

          {canAdd && !adding && (
            <Pressable onPress={() => { setAdding(true); setAddErr(''); }} style={({ hovered }) => [ds.addRow, hovered && ds.optHover]}>
              <MCI name="plus-circle-outline" size={18} color={COLORS.primary} />
              <Text style={ds.addText}>{addLabel.replace(/^\+\s*/, '')}</Text>
            </Pressable>
          )}

          {canAdd && adding && (
            <View style={ds.addBox}>
              <TextInput value={name} onChangeText={(t) => { setName(t); setAddErr(''); }} placeholder={addPlaceholder}
                placeholderTextColor={COLORS.grey} autoFocus maxLength={100} onSubmitEditing={submit} returnKeyType="done"
                style={[ds.input, !!addErr && { borderColor: COLORS.danger }]} />
              {!!addErr && <Text style={ds.err}>{addErr}</Text>}
              <View style={ds.addBtns}>
                <Button compact textColor={COLORS.grey} onPress={() => { setAdding(false); setName(''); setAddErr(''); }} disabled={busy}>Cancel</Button>
                <Button compact mode="contained" buttonColor={COLORS.primary} onPress={submit} loading={busy} disabled={busy}>Save</Button>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const ds = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: COLORS.grey, marginBottom: 6 },
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  boxHover: { borderColor: COLORS.primary },
  boxOpen: { borderColor: COLORS.primary, borderWidth: 2 },
  boxErr: { borderColor: COLORS.danger },
  value: { flex: 1, fontSize: 16, fontWeight: '600', color: COLORS.text },
  placeholder: { color: COLORS.grey, fontWeight: '500' },
  err: { color: COLORS.danger, fontSize: 12, fontWeight: '600', marginTop: 4 },
  panel: { marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', overflow: 'hidden' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  optOn: { backgroundColor: COLORS.primarySoft },
  optHover: { backgroundColor: COLORS.bg },
  optText: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  empty: { padding: 14, color: COLORS.grey, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: 1, borderTopColor: COLORS.border },
  addText: { marginLeft: 8, fontSize: 15, fontWeight: '800', color: COLORS.primary },
  addBox: { padding: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  input: { height: 46, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 15, color: COLORS.text },
  addBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
});

// ===== the edit / add modal =====

// LEGACY: the real list now comes from the server (useMachineTypes). Kept so older imports keep compiling.
export const MACHINE_TYPES = [
  { value: 'WEIGHING', label: 'Weighing' }, { value: 'ROASTING', label: 'Roasting' }, { value: 'GRINDING', label: 'Grinding' },
  { value: 'BLENDING', label: 'Blending' }, { value: 'PACKING', label: 'Packing' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS = ['KG/HR', 'T/HR', 'L/HR', 'PCS/HR'];
const ORDER = ['machine_name', 'machine_type', 'status', 'manufacturer', 'operator_id', 'capacity', 'capacity_unit', 'model_no', 'serial_no',
  'location', 'calibration_due_date', 'installation_date', 'last_maintenance_date', 'maintenance_interval_days', 'next_maintenance_date'];

const blank = { machine_name: '', machine_type: null, manufacturer: '', capacity: '', capacity_unit: 'KG/HR', status: 'ACTIVE',
  installation_date: '', last_maintenance_date: '', next_maintenance_date: '', operator_id: null,
  location: '', model_no: '', serial_no: '', calibration_due_date: '', maintenance_interval_days: '', remarks: '' };

const toForm = (m) => ({
  machine_name: m.machine_name, machine_type: m.machine_type, manufacturer: m.manufacturer || '',
  capacity: m.capacity != null ? String(Number(m.capacity)) : '', capacity_unit: m.capacity_unit || 'KG/HR', status: m.status,
  installation_date: m.installation_date || '', last_maintenance_date: m.last_maintenance_date || '',
  next_maintenance_date: m.next_maintenance_date || '', operator_id: m.operator_id || null,
  location: m.location || '', model_no: m.model_no || '', serial_no: m.serial_no || '',
  calibration_due_date: m.calibration_due_date || '',
  maintenance_interval_days: m.maintenance_interval_days != null ? String(m.maintenance_interval_days) : '',
  remarks: m.remarks || '',
});

// Wraps one field. When `active`, it gets a soft pulse + a clear border so the user sees what they clicked.
function Box({ name, active, register, grow, children }) {
  const ref = useRef(null);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => { register(name, ref); }, [name, register]);
  useEffect(() => {
    if (!active) { pulse.setValue(0); return; }
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 350, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: false }),
    ]).start();
  }, [active, pulse]);
  const bg = pulse.interpolate({ inputRange: [0, 1], outputRange: [`${COLORS.primary}00`, `${COLORS.primary}26`] });
  return (
    <Animated.View ref={ref} collapsable={false}
      style={[b.box, grow && { flex: 1 }, { backgroundColor: bg, borderColor: active ? COLORS.primary : 'transparent' }]}>
      {children}
    </Animated.View>
  );
}

const Row = ({ wide, children }) => (
  <View style={wide ? { flexDirection: 'row' } : undefined}>
    {React.Children.map(children, (c) => (c ? React.cloneElement(c, { grow: wide }) : c))}
  </View>
);

const Section = ({ icon, title }) => (
  <View style={b.section}><MCI name={icon} size={16} color={COLORS.grey} /><Text style={b.sectionText}>{title}</Text></View>
);

function StatusPicker({ value, onChange }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={b.label}>Status</Text>
      <View style={b.chips}>
        {MACHINE_STATUS.map((o) => {
          const st = STATUS_STYLE[o.value]; const on = value === o.value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityLabel={`Status ${o.label}`}
              style={({ hovered }) => [b.chip, { borderColor: on ? st.color : COLORS.border, backgroundColor: on ? st.bg : '#fff' }, hovered && !on && { borderColor: st.color }]}>
              {on ? <MCI name="check-circle" size={16} color={st.color} /> : <View style={[b.dot, { backgroundColor: st.color }]} />}
              <Text style={[b.chipText, { color: on ? st.color : COLORS.text }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Add / edit a machine. `focusField` = the card item the user clicked: that field is highlighted, scrolled into view
// (and the Type dropdown opens by itself when the type was clicked). Code MCH-001 is generated by the server.
export default function MachineFormModal({ visible, machine, focusField, onDismiss, onSaved }) {
  const { width, height } = useWindowDimensions();
  const { can } = useAuth();
  const wide = width >= 600;
  const staff = useOptions('/batches/staff', {}, (u) => ({ value: u.id, label: `${u.full_name} (${u.role_name})` }), visible);
  const types = useMachineTypes(visible);
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [active, setActive] = useState(null);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const boxes = useRef({});
  const register = useCallback((name, ref) => { boxes.current[name] = ref; }, []);
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p)); };

  const scrollTo = useCallback((name) => {
    const box = boxes.current[name] && boxes.current[name].current;
    const content = contentRef.current;
    const sv = scrollRef.current;
    if (!box || !content || !sv) return;
    try { box.measureLayout(content, (x, y) => sv.scrollTo({ y: Math.max(y - 24, 0), animated: true }), () => {}); } catch (e) { /* scrolling is a nicety only */ }
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    setF(machine ? toForm(machine) : blank);
    setErrors({}); setErr(''); setSaving(false);
    setActive(focusField || null);
    if (!focusField) return undefined;
    const t = setTimeout(() => scrollTo(focusField), 450); // wait for the open animation
    return () => clearTimeout(t);
  }, [visible, machine, focusField, scrollTo]);

  const addType = async (name) => {
    try {
      const r = await api.post('/machines/types', { name });
      notifyMachineTypesChanged();
      return r.data.data.code;
    } catch (e) { throw new Error(errMsg(e)); }
  };

  const save = async () => {
    const e = {};
    if (!f.machine_name.trim()) e.machine_name = 'Enter the machine name';
    if (!f.machine_type) e.machine_type = 'Select the type';
    if (f.capacity && !(Number(f.capacity) >= 0)) e.capacity = 'Enter a valid number';
    if (f.maintenance_interval_days && !(Number(f.maintenance_interval_days) >= 1 && Number(f.maintenance_interval_days) <= 3650)) e.maintenance_interval_days = 'Use 1 to 3650 days';
    ['installation_date', 'last_maintenance_date', 'next_maintenance_date', 'calibration_due_date'].forEach((k) => { if (f[k] && !DATE_RE.test(f[k])) e[k] = 'Use YYYY-MM-DD'; });
    setErrors(e);
    const first = ORDER.find((k) => e[k]);
    if (first) { setActive(first); scrollTo(first); return; }
    setSaving(true); setErr('');
    try {
      const body = { ...f, machine_name: f.machine_name.trim() };
      const r = machine ? await api.put(`/machines/${machine.id}`, body) : await api.post('/machines', body);
      setSaving(false);
      onSaved && onSaved(r.data.data, !!machine);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  const Bx = (name, node) => <Box name={name} active={active === name} register={register}>{node}</Box>;
  const showCalibration = f.machine_type === 'WEIGHING' || !!f.calibration_due_date || focusField === 'calibration_due_date';

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="cog" maxWidth={680}
      title={machine ? `Edit ${machine.machine_code}` : 'Add Machine'}
      subtitle={focusField && FIELD_LABELS[focusField] ? `Editing: ${FIELD_LABELS[focusField]}` : 'Machine master'}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label={machine ? 'Update Machine' : 'Save Machine'} />}>
      <ScrollView ref={scrollRef} nestedScrollEnabled keyboardShouldPersistTaps="handled"
        style={{ maxHeight: Math.max(Math.min(height * 0.62, 620), 260) }}>
        <View ref={contentRef} collapsable={false}>
          <Section icon="information-outline" title="BASIC DETAILS" />
          {Bx('machine_name', <FormField label="Machine name *" value={f.machine_name} onChangeText={set('machine_name')} error={errors.machine_name} maxLength={100} />)}
          {Bx('machine_type', (
            <DynamicSelect label="Machine type *" value={f.machine_type} options={types.options} onChange={set('machine_type')} error={errors.machine_type}
              placeholder="Select machine type" loading={types.loading} canAdd={can('machine', 'create')} addLabel="+ Add New Machine Type"
              addPlaceholder="e.g. Cold Press" onAdd={addType} autoOpen={visible && focusField === 'machine_type'} />
          ))}
          {Bx('status', <StatusPicker value={f.status} onChange={set('status')} />)}
          <Row wide={wide}>
            <Box name="manufacturer" active={active === 'manufacturer'} register={register}>
              <FormField label="Manufacturer" value={f.manufacturer} onChangeText={set('manufacturer')} maxLength={100} />
            </Box>
            <Box name="operator_id" active={active === 'operator_id'} register={register}>
              <SelectField label="Operator" value={f.operator_id} options={staff} onChange={set('operator_id')} />
            </Box>
          </Row>

          <Section icon="gauge" title="SPECIFICATIONS" />
          <Row wide={wide}>
            <Box name="capacity" active={active === 'capacity'} register={register}>
              <FormField label="Capacity" numeric value={f.capacity} onChangeText={set('capacity')} error={errors.capacity} />
            </Box>
            <Box name="capacity_unit" active={active === 'capacity_unit'} register={register}>
              <FormField label="Capacity unit" value={f.capacity_unit} onChangeText={set('capacity_unit')} maxLength={20} />
              <View style={b.unitRow}>
                {UNITS.map((u) => (
                  <Pressable key={u} onPress={() => set('capacity_unit')(u)} style={[b.unit, f.capacity_unit === u && b.unitOn]}>
                    <Text style={[b.unitText, f.capacity_unit === u && { color: COLORS.primary }]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </Box>
          </Row>
          <Row wide={wide}>
            <Box name="model_no" active={active === 'model_no'} register={register}>
              <FormField label="Model no." value={f.model_no} onChangeText={set('model_no')} maxLength={50} />
            </Box>
            <Box name="serial_no" active={active === 'serial_no'} register={register}>
              <FormField label="Serial no." value={f.serial_no} onChangeText={set('serial_no')} maxLength={50} />
            </Box>
          </Row>
          <Row wide={wide}>
            <Box name="location" active={active === 'location'} register={register}>
              <FormField label="Location / Section" value={f.location} onChangeText={set('location')} maxLength={100} />
            </Box>
            {showCalibration ? (
              <Box name="calibration_due_date" active={active === 'calibration_due_date'} register={register}>
                <FormField label="Calibration due (YYYY-MM-DD)" value={f.calibration_due_date} onChangeText={set('calibration_due_date')} error={errors.calibration_due_date} maxLength={10} />
              </Box>
            ) : null}
          </Row>

          <Section icon="wrench-clock" title="MAINTENANCE" />
          <Row wide={wide}>
            <Box name="installation_date" active={active === 'installation_date'} register={register}>
              <FormField label="Installed on (YYYY-MM-DD)" value={f.installation_date} onChangeText={set('installation_date')} error={errors.installation_date} maxLength={10} />
            </Box>
            <Box name="last_maintenance_date" active={active === 'last_maintenance_date'} register={register}>
              <FormField label="Last maintenance (YYYY-MM-DD)" value={f.last_maintenance_date} onChangeText={set('last_maintenance_date')} error={errors.last_maintenance_date} maxLength={10} />
            </Box>
          </Row>
          <Row wide={wide}>
            <Box name="maintenance_interval_days" active={active === 'maintenance_interval_days'} register={register}>
              <FormField label="Maintenance interval (days)" digits value={f.maintenance_interval_days} onChangeText={set('maintenance_interval_days')} error={errors.maintenance_interval_days} maxLength={4} />
            </Box>
            <Box name="next_maintenance_date" active={active === 'next_maintenance_date'} register={register}>
              <FormField label="Next maintenance (YYYY-MM-DD)" value={f.next_maintenance_date} onChangeText={set('next_maintenance_date')} error={errors.next_maintenance_date} maxLength={10} />
            </Box>
          </Row>
          <Text style={b.hint}>Leave Next maintenance blank to set it automatically (Last maintenance + interval).</Text>
          {Bx('remarks', <FormField label="Remarks" value={f.remarks} onChangeText={set('remarks')} maxLength={255} multiline />)}
          <ErrorBox text={err} />
        </View>
      </ScrollView>
    </ModalShell>
  );
}

const b = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: 14, padding: 6, marginBottom: 2 },
  section: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 8, paddingHorizontal: 6 },
  sectionText: { marginLeft: 6, fontSize: 12, fontWeight: '900', letterSpacing: 0.8, color: COLORS.grey },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.grey, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginRight: 8, marginBottom: 8 },
  chipText: { marginLeft: 6, fontSize: 14, fontWeight: '800' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -4 },
  unit: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginBottom: 4 },
  unitOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  unitText: { fontSize: 11, fontWeight: '800', color: COLORS.grey },
  hint: { fontSize: 12, color: COLORS.grey, fontWeight: '600', marginBottom: 10, paddingHorizontal: 6 },
});




