export const fmtSec = (sec) => {
  if (sec === null || sec === undefined || sec === '') return '—';
  const s = Math.round(Math.abs(Number(sec))); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', x || (!h && !m) ? `${x}s` : ''].filter(Boolean).join(' ');
};
export function durationRows(d) {
  const diff = d.actual_seconds == null || d.effective_seconds == null ? null : Number(d.actual_seconds) - Number(d.effective_seconds);
  return [
    ['Configured duration', fmtSec(d.configured_seconds)],
    ['Manual duration', d.manual_seconds ? fmtSec(d.manual_seconds) : '—'],
    ['Effective duration', fmtSec(d.effective_seconds)],
    ['Duration source', d.manual_seconds ? 'Manually changed' : 'Default (configured)'],
    ['Change reason', d.duration_change_reason || '—'],
    ['Actual duration', fmtSec(d.actual_seconds)],
    ['Actual vs effective', diff == null ? '—' : diff === 0 ? 'On time' : `${diff > 0 ? '+' : '-'}${fmtSec(Math.abs(diff))} (${diff > 0 ? 'longer' : 'shorter'})`],
  ];
}