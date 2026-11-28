import React from 'react';
import { View } from 'react-native';
import FormField from './FormField';
import { fmtDuration } from './DurationField';

export const toMin = (sec) => Math.max(Math.ceil(Number(sec) / 60), 1);
export const durText = (sec) => (Number(sec) > 0 ? fmtDuration(Number(sec)) : '—');

// same validation for Filtering / Roasting / Grinding / Blending
export function checkDuration(cfgSec, manual, reason) {
  const cfgMin = Number(cfgSec) > 0 ? toMin(cfgSec) : 0;
  const m = String(manual || '').trim();
  const has = m !== '';
  const e = {};
  if (has && !(Number(m) >= 1 && Number(m) <= 1440)) e.manual = 'Enter minutes between 1 and 1440';
  if (!cfgMin && !has) e.manual = 'No configured duration. Enter the manual duration';
  const changed = has && !e.manual && cfgMin > 0 && Number(m) !== cfgMin;
  if (changed && !String(reason || '').trim()) e.reason = 'Enter the reason for changing the duration';
  return { e, changed, cfgMin, effMin: has ? Number(m) : cfgMin };
}

export function overrideMessage(cfgSec, manual, reason) {
  const diff = Number(manual) * 60 - Number(cfgSec);
  return `Configured duration: ${fmtDuration(cfgSec)}\nManual duration: ${fmtDuration(Number(manual) * 60)}\n`
    + `Difference: ${diff > 0 ? '+' : '-'}${fmtDuration(Math.abs(diff))}\nReason: ${reason}\n\n`
    + 'Start with the manual duration? The configured duration stays unchanged.';
}

// Configured (read-only) + Manual override (optional) + Reason (only when it differs)
export default function DurationFields({ configuredSec, manual, reason, onChange, err }) {
  const hasCfg = Number(configuredSec) > 0;
  const { changed } = checkDuration(configuredSec, manual, reason);
  return (
    <View>
      <FormField label="Configured duration (Material Master)" value={hasCfg ? fmtDuration(Number(configuredSec)) : 'Not configured'} editable={false} />
      <FormField label={hasCfg ? 'Manual duration (override, min) - optional' : 'Manual duration (min) *'} digits value={manual || ''}
        onChangeText={(t) => onChange({ manual: t.replace(/[^0-9]/g, '') })} error={err && err.manual}
        hint={hasCfg ? 'Leave empty to use the configured duration' : undefined} />
      {changed && <FormField label="Reason for changing the duration *" value={reason || ''} onChangeText={(t) => onChange({ reason: t })} maxLength={255} error={err && err.reason} />}
    </View>
  );
}