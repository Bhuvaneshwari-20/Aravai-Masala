import React, { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import { printBlending } from '../printDoc';
import { COLORS, fmt } from '../theme';
import { downloadBlendingPdf } from '../pdfDoc';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
const cap = (s) => { const t = String(s || '').replace('_', ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

const dash = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${fmt(v)}${unit}`);
const when = (t) => (t ? String(t).slice(0, 16) : '—');

// Defined OUTSIDE the modal so they are not re-created on every render.
function Section({ title, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 }}>{title}</Text>
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: '#FFFDF9', paddingHorizontal: 12, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}
function Row({ label, value, color, last, bold, hl, icon }) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: COLORS.border },
      hl && { backgroundColor: hl.bg, marginHorizontal: -12, paddingHorizontal: 12, borderLeftWidth: 4, borderLeftColor: hl.bar }]}>
      <Text style={{ color: hl ? COLORS.text : COLORS.grey, fontWeight: hl ? '800' : '600', fontSize: 13, flex: 1, paddingRight: 10 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        {!!icon && <MCI name={icon.name} size={20} color={icon.color} style={{ marginRight: 6 }} />}
        <Text style={[{ color: COLORS.text, fontWeight: bold || hl ? '900' : '700', fontSize: hl ? 15 : 14, textAlign: 'right', flexShrink: 1 }, color && { color }]}>{value}</Text>
      </View>
    </View>
  );
}
function IngredientLine({ i, name, weight, pct, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: COLORS.border }}>
      <Text style={{ width: 24, color: COLORS.grey, fontWeight: '700' }}>{i + 1}</Text>
      <Text style={{ flex: 1, color: COLORS.text, fontWeight: '700', fontSize: 13.5 }}>{name}</Text>
      <Text style={{ width: 86, textAlign: 'right', color: COLORS.text, fontWeight: '700', fontSize: 13.5 }}>{fmt(weight)} kg</Text>
      <Text style={{ width: 66, textAlign: 'right', color: COLORS.primary, fontWeight: '800', fontSize: 13.5 }}>{Number(pct).toFixed(2)}%</Text>
    </View>
  );
}

// Read-only details of one blending entry (opened by tapping a card on the Blending list).
export default function BlendingDetailModal({ visible, id, onDismiss }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !id) return;
    setD(null); setErr(''); setLoading(true);
    api.get(`/blending/${id}`)
      .then((r) => setD(r.data.data))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [visible, id]);

  const first = d?.ingredients?.[0];
const packed = d ? Number(d.batch_packed_kg) || 0 : 0;
const left = d ? Math.max(Number(d.batch_output_kg || 0) - packed, 0) : 0;
const packingDone = !!d && packed > 0 && left <= 0.001;
const batchDone = !!d && (d.batch_stage === 'COMPLETED' || d.batch_status === 'COMPLETED');
  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="blender" maxWidth={640}
      title="Blending details" subtitle={d ? `${d.batch_no} · ${d.product_name}` : 'Loading…'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
         {Platform.OS === 'web' && (
  <>
    <Button mode="contained" icon="printer" disabled={!d} onPress={() => printBlending(d)} buttonColor={COLORS.green}
      style={{ borderRadius: 10, marginRight: 10 }}>Print</Button>
    <Button mode="contained" icon="download" disabled={!d} onPress={() => downloadBlendingPdf(d)} buttonColor={COLORS.primary}
      style={{ borderRadius: 10, marginRight: 10 }}>Download</Button>
  </>
)}
          <Button mode="outlined" onPress={onDismiss} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border }}>Close</Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View>
        : err ? <Text style={{ color: COLORS.danger, fontWeight: '600', padding: 12 }}>{err}</Text>
        : !d ? null : (
          <View>
            <Section title="BLENDING RUN">
              <Row label="Batch" value={d.batch_no} />
              <Row label="Product" value={d.product_name} />
              <Row label="Recipe" value={`${d.recipe_no} (v${d.version_no})`} />
              <Row label="Machine" value={`${d.machine_code} · ${d.machine_name}`} />
              <Row label="Started" value={when(d.start_time)} />
              <Row label="Ended" value={when(d.end_time)} />
              <Row label="Mixing duration" value={dash(d.mixing_duration_min, ' min')} />
              <Row label="Operator" value={d.operator_name} />
              <Row label="Status" value={String(d.status).replace('_', ' ')} color={d.status === 'COMPLETED' ? COLORS.ok : undefined} last />
            </Section>

            <Section title="INGREDIENTS (MIXING %)">
              <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <Text style={{ width: 24 }} />
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '900', color: COLORS.grey }}>MATERIAL</Text>
                <Text style={{ width: 86, textAlign: 'right', fontSize: 11, fontWeight: '900', color: COLORS.grey }}>WEIGHT</Text>
                <Text style={{ width: 66, textAlign: 'right', fontSize: 11, fontWeight: '900', color: COLORS.grey }}>MIX %</Text>
              </View>
              {d.ingredients.map((l, i) => (
                <IngredientLine key={l.id} i={i} name={l.material_code ? `${l.material_code} · ${l.ingredient_name}` : l.ingredient_name}
                  weight={l.ingredient_weight} pct={l.percent} last={false} />
              ))}
              <View style={{ flexDirection: 'row', paddingVertical: 10 }}>
                <Text style={{ width: 24 }} />
                <Text style={{ flex: 1, fontWeight: '900', color: COLORS.text }}>Total</Text>
                <Text style={{ width: 86, textAlign: 'right', fontWeight: '900', color: COLORS.text }}>{fmt(d.total_input_weight)} kg</Text>
                <Text style={{ width: 66, textAlign: 'right', fontWeight: '900', color: COLORS.primary }}>100.00%</Text>
              </View>
            </Section>

            <Section title="WEIGHT">
              <Row label="input weight" value={dash(d.total_input_weight, ' kg')} />
              <Row label="Blended weight (output)" value={dash(d.output_weight, ' kg')} color={COLORS.ok} bold />
              <Row label="Wastage" value={`${fmt(d.wastage_weight || 0)} kg (${Number(d.loss_percent).toFixed(2)}%)`} color={Number(d.wastage_weight) > 0 ? COLORS.warn : undefined} last />
            </Section>

            <Section title="CHECKED BY">
              <Row label="Done by" value={first?.done_by_name || '—'} />
              <Row label="Checked by" value={first?.checked_by_name || '—'} last />
            </Section>

            <Section title="BATCH WEIGHT">
              <Row label="Initial weight (at batching)" value={Number(d.batching_kg) > 0 ? `${fmt(d.batching_kg)} kg` : '—'} />
              <Row label="Current output" value={dash(d.batch_output_kg, ' kg')} />
<Row label="Batch stage" value={batchDone ? 'Completed' : `${cap(d.batch_stage)} · ${cap(d.batch_status)}`}
  color={batchDone ? COLORS.ok : COLORS.warn} last={!packingDone} />
{packingDone ? (
  <Row label="Packing" value="Packing done" hl={{ bg: COLORS.okBg, bar: COLORS.ok }} color={COLORS.ok}
    icon={{ name: 'thumb-up', color: COLORS.ok }} last />
) : null}     
    </Section>

            {!!d.remarks && (
              <Section title="REMARKS">
                <Row label="Note" value={d.remarks} last />
              </Section>
            )}
          </View>
        )}
    </ModalShell>
  );
}