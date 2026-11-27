import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FilterChips from './FilterChips';
import DateField from './DateField';
import FormRow from './FormRow';
import useLayout from '../hooks/useLayout';
import { DATE_RE } from '../productionUtils';
import { RANGES, rangeDates } from '../screens/sales/salesUtils';
import { COLORS } from '../theme';

// Quick range chips + a "Filters" chip that opens From / To dates (+ any extra selects passed as children).
//   value = { from, to }   onChange({ from, to })   extraActive = true when a select in `children` is set (highlights the chip)
// Chips apply at once; typed dates apply with the "Apply dates" button.
export default function SalesFilterBar({ value, onChange, children, extraActive }) {
  const { pad } = useLayout();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const [err, setErr] = useState('');
  useEffect(() => { setFrom(value.from); setTo(value.to); setErr(''); }, [value.from, value.to]);

  const active = RANGES.find((r) => { const d = rangeDates(r.value); return d.from === value.from && d.to === value.to; });

  const apply = () => {
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return setErr('Use YYYY-MM-DD');
    if (from && to && from > to) return setErr('From date is after the To date');
    setErr(''); onChange({ from, to });
    return undefined;
  };

  const on = open || extraActive || !active;   // custom dates or an extra filter = highlighted
  return (
    <View>
      <FilterChips options={RANGES} value={active ? active.value : null} onChange={(k) => onChange(rangeDates(k))}>
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
          style={[s.chip, on && s.chipOn]}>
          <MCI name="tune-variant" size={16} color={on ? '#fff' : COLORS.textSoft} />
          <Text style={[s.chipText, on && { color: '#fff' }]}>Filters</Text>
        </Pressable>
      </FilterChips>
      {open && (
        <View style={[s.card, { marginHorizontal: pad }]}>
          <FormRow>
            <DateField label="From date" value={from} onChangeText={setFrom} />
            <DateField label="To date" value={to} onChangeText={setTo} />
          </FormRow>
          {children}
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={s.btnRow}>
            <Button mode="contained" icon="filter-check" buttonColor={COLORS.primary} style={{ borderRadius: 10 }} onPress={apply}>Apply dates</Button>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 19, paddingHorizontal: 14, marginRight: 8, backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border },
  chipOn: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipText: { marginLeft: 6, fontSize: 13.5, fontWeight: '700', color: COLORS.textSoft },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14, paddingBottom: 12, marginBottom: 8 },
  err: { color: COLORS.danger, fontWeight: '700', fontSize: 12.5, marginBottom: 6 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});
