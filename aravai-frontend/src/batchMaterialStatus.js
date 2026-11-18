import { COLORS } from './theme';

// ---------------------------------------------------------------------------------------------
// Material-level production status of a batch (frontend side).
// Every material of a batch moves on its own:
//   weighed -> [Filtering -> Filtered] -> ready for Roasting -> Roasting -> Roasted
// The batch stage is the result of all its materials (the server calculates it, this file only shows it).
// The server sends `stage` on every ingredient; the fallback below keeps old responses working.
// ---------------------------------------------------------------------------------------------

export const MAT_STAGE = {
  FILTERING: { label: 'WAITING FOR FILTERING', short: 'Filtering', color: COLORS.warn, bg: COLORS.warnBg },
  FILTERED: { label: 'FILTERED', short: 'Filtered', color: COLORS.ok, bg: COLORS.okBg },
  READY_FOR_ROASTING: { label: 'READY FOR ROASTING', short: 'Ready for roasting', color: COLORS.primary, bg: `${COLORS.primary}14` },
  ROASTING: { label: 'ROASTING', short: 'Roasting', color: COLORS.warn, bg: COLORS.warnBg },
  ROASTED: { label: 'ROASTED', short: 'Roasted', color: COLORS.ok, bg: COLORS.okBg },
};

// stage key of one ingredient of batch.plan.ingredients
export function materialStage(i) {
  if (!i) return 'READY_FOR_ROASTING';
  if (i.stage && MAT_STAGE[i.stage]) return i.stage;
  if (i.roasted || i.roasting_done) return 'ROASTED';
  if (i.roasting_started) return 'ROASTING';
  if (i.needs_filtering && !(i.filtered || i.filtering_done)) return 'FILTERING';
  if (i.needs_filtering) return 'FILTERED';
  return 'READY_FOR_ROASTING';
}
export const materialBadge = (i) => MAT_STAGE[materialStage(i)];

// A material can only be roasted when it does not need filtering, or its filtering is completed.
export const canRoastMaterial = (i) => !['FILTERING'].includes(materialStage(i));

// Edit / delete of one material is only possible before that material has started its next process.
// The server decides (can_edit / can_delete) and checks again; this is the fallback for old responses.
export const materialLocked = (i) => ['FILTERED', 'ROASTING', 'ROASTED'].includes(materialStage(i));
export const canEditMaterial = (i) => (i.can_edit != null ? !!i.can_edit : !materialLocked(i));
export const canDeleteMaterial = (i) => (i.can_delete != null ? !!i.can_delete : !materialLocked(i));

// "3 waiting for filtering · 7 ready for roasting"
export function stageSummary(ingredients) {
  const done = (ingredients || []).filter((i) => i.is_done !== false);
  const n = (k) => done.filter((i) => materialStage(i) === k).length;
  const parts = [];
  if (n('FILTERING')) parts.push(`${n('FILTERING')} waiting for filtering`);
  if (n('FILTERED') + n('READY_FOR_ROASTING')) parts.push(`${n('FILTERED') + n('READY_FOR_ROASTING')} ready for roasting`);
  if (n('ROASTING')) parts.push(`${n('ROASTING')} roasting`);
  if (n('ROASTED')) parts.push(`${n('ROASTED')} roasted`);
  return parts.join('  •  ');
}

export const ROAST_MODE_TEXT = {
  PARALLEL: 'Roasting starts now for unfiltered materials; filtered ones join after Filtering.',
  AFTER_FILTERING: 'Roasting starts only after Filtering is completed.',
  DIRECT: 'No filtering: straight to Roasting.',
};
