import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Watch-timer style picker for a duration: Hours : Minutes : Seconds, each with up / down arrows.
//   <DurationField label="Roasting time" value={seconds} onChange={setSeconds} />
// value    = total seconds (number) or null/'' when not set
// onChange = (totalSeconds | null) ; 0:0:0 is reported as null (= not set)
// compact  = smaller version for table rows
const pad = (n) => String(n).padStart(2, '0');
export const splitSeconds = (sec) => { const s = Math.max(0, Math.floor(Number(sec) || 0)); return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }; };
export const fmtDuration = (sec) => { if (!(Number(sec) > 0)) return '—'; const { h, m, s } = splitSeconds(sec); return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' '); };

function Col({ unit, value, max, onSet, compact }) {
  const step = (d) => onSet((value + d + (max + 1)) % (max + 1)); // wraps around like a watch dial
  const hit = compact ? 4 : 8;
  return (
    <View style={{ alignItems: 'center', width: compact ? 40 : 58 }}>
      <Pressable onPress={() => step(1)} hitSlop={hit} accessibilityLabel={`${unit} up`}><MCI name="chevron-up" size={compact ? 18 : 24} color={COLORS.primary} /></Pressable>
      <View style={{ minWidth: compact ? 36 : 52, paddingVertical: compact ? 2 : 6, borderRadius: 10, backgroundColor: COLORS.greyBg, alignItems: 'center' }}>
        <Text style={{ fontSize: compact ? 16 : 22, fontWeight: '800', color: COLORS.text, fontVariant: ['tabular-nums'] }}>{pad(value)}</Text>
      </View>
      <Pressable onPress={() => step(-1)} hitSlop={hit} accessibilityLabel={`${unit} down`}><MCI name="chevron-down" size={compact ? 18 : 24} color={COLORS.primary} /></Pressable>
      <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 1, color: COLORS.grey }}>{unit}</Text>
    </View>
  );
}

export default function DurationField({ label, value, onChange, hint, error, compact, disabled }) {
  const { h, m, s } = splitSeconds(value);
  const emit = (nh, nm, ns) => { const t = nh * 3600 + nm * 60 + ns; onChange(t > 0 ? t : null); };
  const dot = <Text style={{ fontSize: compact ? 16 : 22, fontWeight: '800', color: COLORS.grey, marginHorizontal: 2, alignSelf: 'center', marginBottom: 14 }}>:</Text>;
  return (
    <View style={{ marginBottom: compact ? 0 : 8, opacity: disabled ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      {!!label && <Text style={{ fontSize: 12, color: error ? COLORS.danger : COLORS.grey, marginBottom: 4 }}>{label}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' }}>
        <Col unit="HR" value={h} max={23} onSet={(x) => emit(x, m, s)} compact={compact} />{dot}
        <Col unit="MIN" value={m} max={59} onSet={(x) => emit(h, x, s)} compact={compact} />{dot}
        <Col unit="SEC" value={s} max={59} onSet={(x) => emit(h, m, x)} compact={compact} />
      </View>
      {!!(error || hint) && <Text style={{ fontSize: 12, marginTop: 2, color: error ? COLORS.danger : COLORS.grey }}>{error || hint}</Text>}
    </View>
  );
}
