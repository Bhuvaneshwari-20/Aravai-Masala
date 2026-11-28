import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import SelectField from './SelectField';
import { COLORS } from '../theme';

// New Batch popup: Sequential / Simultaneous + Roasting partner pairs.
//   mode  : 'SEQUENTIAL' | 'SIMULTANEOUS' (only asked when the recipe has Filtering)
//   pairs : [{ a: material_id | null, b: material_id | null }]
// Only materials that the recipe marks "Roasting with Partner" (and that are in this batch) can be paired.
// A material that is marked but not paired simply roasts alone. The server validates everything again.

export const isPartnerItem = (i) => i.roast_type === 'ROAST_PARTNER' && i.process_type !== 'FILTER_ONLY';
export const cleanPairs = (pairs) => (pairs || []).filter((p) => p.a && p.b).map((p) => ({ lead_material_id: p.a, partner_material_id: p.b }));
export const pairError = (pairs) => ((pairs || []).some((p) => (p.a && !p.b) || (!p.a && p.b)) ? 'Select both materials of each roasting pair, or remove the pair' : '');

const MODES = [
  { value: 'SEQUENTIAL', icon: 'arrow-right-bold-outline', title: 'Sequential', text: 'Roasting starts only after ALL Filtering of the batch is completed.' },
  { value: 'SIMULTANEOUS', icon: 'call-split', title: 'Simultaneously', text: 'Each roasting pair starts as soon as its own Filtering is completed. Other Filtering continues meanwhile.' },
];

export default function RoastPlanSection({ active, needsFiltering, mode, onMode, pairs, onPairs, error, canPair = true }) {
  const eligible = (active || []).filter(isPartnerItem);
  const maxRows = Math.floor(eligible.length / 2);
  const optionsFor = (n, side) => {
    const taken = new Set();
    pairs.forEach((p, j) => ['a', 'b'].forEach((k) => { if (p[k] && !(j === n && k === side)) taken.add(p[k]); }));
    return eligible.filter((i) => !taken.has(i.material_id)).map((i) => ({ value: i.material_id, label: i.material_name }));
  };
  const setCell = (n, side) => (v) => onPairs(pairs.map((p, j) => (j === n ? { ...p, [side]: v } : p)));

  if (!needsFiltering && (!canPair || eligible.length < 2)) return null;
  return (
    <View style={{ marginBottom: 12 }}>
      {needsFiltering && (
        <View>
          <Text style={t.head}>PROCESS MODE</Text>
          {MODES.map((m) => {
            const on = mode === m.value;
            return (
              <Pressable key={m.value} onPress={() => onMode(m.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[t.opt, on && t.optOn]}>
                <MCI name={on ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={on ? COLORS.primary : COLORS.grey} />
                <MCI name={m.icon} size={20} color={on ? COLORS.primary : COLORS.grey} style={{ marginLeft: 10 }} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={t.optTitle}>{m.title}</Text>
                  <Text style={t.optText}>{m.text}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {canPair && eligible.length >= 2 && (
        <View style={{ marginTop: needsFiltering ? 10 : 0 }}>
          <Text style={t.head}>ROASTING PARTNERS</Text>
          <Text style={t.note}>Pair materials that are roasted together on one machine. The pairing is saved with the batch and cannot be changed while roasting. A material left unpaired roasts alone.</Text>
          {pairs.map((p, n) => (
            <View key={n} style={t.pairRow}>
              <View style={{ flex: 1 }}><SelectField label="Material" value={p.a || null} options={optionsFor(n, 'a')} onChange={setCell(n, 'a')} /></View>
              <MCI name="link-variant" size={20} color={COLORS.primary} style={{ marginHorizontal: 8 }} />
              <View style={{ flex: 1 }}><SelectField label="Partner" value={p.b || null} options={optionsFor(n, 'b')} onChange={setCell(n, 'b')} /></View>
              <Pressable onPress={() => onPairs(pairs.filter((_, j) => j !== n))} hitSlop={8} accessibilityLabel="Remove pair" style={{ marginLeft: 8 }}>
                <MCI name="close-circle" size={22} color={COLORS.danger} />
              </Pressable>
            </View>
          ))}
          {pairs.length < maxRows && (
            <Pressable onPress={() => onPairs([...pairs, { a: null, b: null }])} style={t.add} accessibilityRole="button">
              <MCI name="plus" size={16} color={COLORS.green} />
              <Text style={t.addText}>Add roasting pair</Text>
            </Pressable>
          )}
        </View>
      )}
      {!!error && <Text style={t.err}>{error}</Text>}
    </View>
  );
}

const t = StyleSheet.create({
  head: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.8, color: COLORS.grey, marginBottom: 6 },
  note: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginBottom: 6 },
  opt: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: '#fff' },
  optOn: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}0D` },
  optTitle: { fontSize: 14.5, fontWeight: '800', color: COLORS.text },
  optText: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  pairRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  add: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 6 },
  addText: { marginLeft: 4, fontSize: 13, fontWeight: '800', color: COLORS.green },
  err: { color: COLORS.danger, fontSize: 12.5, fontWeight: '700', marginTop: 4 },
});