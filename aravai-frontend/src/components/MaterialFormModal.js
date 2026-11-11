import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button, Switch, ActivityIndicator, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import { COLORS, fmt } from '../theme';

const UNITS = ['KG', 'GRAM', 'NOS', 'LITRE', 'BAGS'].map((u) => ({ value: u, label: u }));
const EMPTY = { material_name: '', category_id: null, unit: null, opening_stock: '', minimum_stock: '', purchase_rate: '', place: '', is_active: true, specifications: [] };
const Label = ({ children, style }) => <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 8 }, style]}>{children}</Text>;

// Add (no id) or Edit (id) material, as a popup on the same page.
export default function MaterialFormModal({ visible, id, onDismiss, onSaved }) {
  const { user } = useAuth();
  const isEdit = !!id;
  const isAdmin = user?.role_name === 'Admin';
  const [categories, setCategories] = useState([]);
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
        const c = await api.get('/material-categories');
        setCategories(c.data.data.map((x) => ({ value: x.id, label: x.category_name })));
        if (isEdit) {
          const r = (await api.get(`/materials/${id}`)).data.data;
          setF({ material_name: r.material_name, category_id: r.category_id, unit: r.unit, opening_stock: String(r.opening_stock),
            minimum_stock: String(r.minimum_stock), purchase_rate: String(r.purchase_rate), place: r.place || '', is_active: !!r.is_active,
            specifications: Array.isArray(r.specifications) ? r.specifications : [] });
          setStock(r);
        }
      } catch (e) { setErr(errMsg(e)); }
      setLoading(false);
    })();
  }, [visible, id]); // eslint-disable-line

  const createCategory = async (name) => {
    try {
      const r = await api.post('/material-categories', { category_name: name });
      const o = { value: r.data.data.id, label: r.data.data.category_name };
      setCategories((p) => [...p, o].sort((a, b) => a.label.localeCompare(b.label)));
      return o;
    } catch (e) { throw new Error(errMsg(e)); }
  };

  const validate = () => {
    const e = {};
    if (!f.material_name.trim()) e.material_name = 'Material name is required';
    if (!f.category_id) e.category_id = 'Please select a category';
    if (!f.unit) e.unit = 'Please select a unit';
    ['opening_stock', 'minimum_stock', 'purchase_rate'].forEach((k) => {
      if (f[k] !== '' && (isNaN(Number(f[k])) || Number(f[k]) < 0)) e[k] = 'Enter a valid number (0 or more)';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      const body = { material_name: f.material_name.trim(), category_id: f.category_id, unit: f.unit,
        minimum_stock: f.minimum_stock || 0, purchase_rate: f.purchase_rate || 0, place: f.place.trim(), is_active: f.is_active,
        specifications: f.specifications.map((x) => x.trim()).filter(Boolean) };
      if (isEdit) await api.put(`/materials/${id}`, body);
      else await api.post('/materials', { ...body, opening_stock: f.opening_stock || 0 });
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'package-variant'}
      title={isEdit ? 'Edit Material' : 'Add Material'} subtitle={isEdit ? stock?.material_code : 'Fill in the details and save'}
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
          <FormRow>
            <SelectField label="Category *" value={f.category_id} options={categories} onChange={set('category_id')} error={errors.category_id}
              onCreate={isAdmin ? createCategory : undefined} createLabel="New category name" />
            <SelectField label="Unit *" value={f.unit} options={UNITS} onChange={set('unit')} error={errors.unit} />
          </FormRow>
          <FormField label="Place (rack / godown)" value={f.place} onChangeText={set('place')} />

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

          <Label style={{ marginTop: 6 }}>STOCK & PRICE</Label>
          {isEdit && stock ? (
            <View style={{ backgroundColor: '#FFF3E0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <Text style={{ fontWeight: '700' }}>Opening: {fmt(stock.opening_stock)} {stock.unit}   |   Current: {fmt(stock.current_stock)} {stock.unit}</Text>
              <Text style={{ color: COLORS.grey, marginTop: 3, fontSize: 12.5 }}>Stock changes only through stock transactions.</Text>
            </View>
          ) : (
            <FormRow>
              <FormField label="Opening stock" numeric value={f.opening_stock} onChangeText={set('opening_stock')} error={errors.opening_stock} />
              <FormField label="Minimum stock" numeric value={f.minimum_stock} onChangeText={set('minimum_stock')} error={errors.minimum_stock} />
            </FormRow>
          )}
          <FormRow>
            {isEdit ? <FormField label="Minimum stock" numeric value={f.minimum_stock} onChangeText={set('minimum_stock')} error={errors.minimum_stock} /> : null}
            <FormField label="Purchase rate (₹)" numeric value={f.purchase_rate} onChangeText={set('purchase_rate')} error={errors.purchase_rate}
              hint={isEdit ? undefined : 'Opening stock cannot be edited after saving.'} />
          </FormRow>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.greenBg, borderRadius: 14, padding: 14, marginTop: 4 }}>
            <View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.text }}>Active</Text>
              <Text style={{ fontSize: 12, color: COLORS.grey, marginTop: 1 }}>Inactive materials are hidden from selection</Text>
            </View>
            <Switch value={f.is_active} onValueChange={set('is_active')} color={COLORS.green} />
          </View>
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
