import React, { useEffect, useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Switch, Snackbar } from 'react-native-paper';
import api, { errMsg } from '../../api';
import FormField from '../../components/FormField';
import SelectField from '../../components/SelectField';
import Section from '../../components/Section';
import FadeIn from '../../components/FadeIn';
import Container from '../../components/Container';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import { COLORS, fmt } from '../../theme';

const UNITS = ['KG', 'GRAM', 'NOS', 'LITRE', 'BAGS'].map((u) => ({ value: u, label: u }));

export default function MaterialFormScreen({ route, navigation }) {
  const id = route.params?.id;
  const isEdit = !!id;
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [categories, setCategories] = useState([]);
  const [f, setF] = useState({
    material_name: '', category_id: null, unit: null, opening_stock: '', minimum_stock: '',
    purchase_rate: '', place: '', is_active: true,
  });
  const [stock, setStock] = useState(null); // edit mode: read-only stock info
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const load = async () => {
    setLoading(true); setLoadErr('');
    try {
      const c = await api.get('/material-categories');
      setCategories(c.data.data.map((x) => ({ value: x.id, label: x.category_name })));
      if (isEdit) {
        const r = (await api.get(`/materials/${id}`)).data.data;
        setF({
          material_name: r.material_name, category_id: r.category_id, unit: r.unit,
          opening_stock: String(r.opening_stock), minimum_stock: String(r.minimum_stock),
          purchase_rate: String(r.purchase_rate), place: r.place || '', is_active: r.is_active,
        });
        setStock(r);
      }
    } catch (e) { setLoadErr(errMsg(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

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
    setSaving(true);
    try {
      const body = {
        material_name: f.material_name.trim(), category_id: f.category_id, unit: f.unit,
        minimum_stock: f.minimum_stock || 0, purchase_rate: f.purchase_rate || 0,
        place: f.place.trim(), is_active: f.is_active,
      };
      if (isEdit) {
        await api.put(`/materials/${id}`, body);
        navigation.goBack();
      } else {
        body.opening_stock = f.opening_stock || 0;
        const r = await api.post('/materials', body);
        navigation.replace('MaterialDetail', { id: r.data.data.id });
      }
    } catch (e) { setMsg(errMsg(e)); setSaving(false); }
  };

  if (loading) return <LoadingView />;
  if (loadErr) return <EmptyView error={loadErr} onRetry={load} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Container maxWidth={720}>
        <Section title="Basic Details" icon="📦" delay={0}>
        <FormField label="Material name *" value={f.material_name} onChangeText={set('material_name')} error={errors.material_name} />
        <SelectField label="Category *" value={f.category_id} options={categories} onChange={set('category_id')} error={errors.category_id} />
        <SelectField label="Unit *" value={f.unit} options={UNITS} onChange={set('unit')} error={errors.unit} />
        <FormField label="Place (rack / godown)" value={f.place} onChangeText={set('place')} />
        </Section>

        <Section title="Stock & Price" icon="⚖️" delay={120}>

        {isEdit ? (
          <View style={{ backgroundColor: '#FFF3E0', borderRadius: 14, padding: 12, marginBottom: 14 }}>
            <Text style={{ fontWeight: '600' }}>Opening stock: {fmt(stock.opening_stock)} {stock.unit}  |  Current stock: {fmt(stock.current_stock)} {stock.unit}</Text>
            <Text style={{ color: COLORS.grey, marginTop: 4 }}>Stock cannot be changed here. It changes only through stock transactions.</Text>
          </View>
        ) : (
          <FormField label="Opening stock" numeric value={f.opening_stock} onChangeText={set('opening_stock')} error={errors.opening_stock}
            hint="Initial stock. It cannot be edited here after saving." />
        )}

        <FormField label="Minimum stock" numeric value={f.minimum_stock} onChangeText={set('minimum_stock')} error={errors.minimum_stock} />
        <FormField label="Purchase rate (₹)" numeric value={f.purchase_rate} onChangeText={set('purchase_rate')} error={errors.purchase_rate} />
        </Section>

        <FadeIn delay={240}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 20, elevation: 2 }}>
          <Text style={{ fontSize: 16 }}>Active</Text>
          <Switch value={f.is_active} onValueChange={set('is_active')} color={COLORS.primary} />
        </View>
        </FadeIn>

        <Button mode="contained" onPress={save} loading={saving} disabled={saving} contentStyle={{ paddingVertical: 8 }}
          buttonColor={COLORS.primary} style={{ borderRadius: 16 }}>{isEdit ? 'Update' : 'Save'}</Button>
        </Container>
      </ScrollView>
      <Snackbar visible={!!msg} onDismiss={() => setMsg('')} duration={4000}
        action={{ label: 'OK', onPress: () => setMsg('') }}>{msg}</Snackbar>
    </KeyboardAvoidingView>
  );
}
