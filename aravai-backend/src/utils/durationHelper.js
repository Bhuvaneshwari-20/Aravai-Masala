const AppError = require('./AppError');

// configured (Material Master) + optional manual minutes + reason  ->  what is saved on the session
function resolveDuration({ configuredSec, manualRaw, reasonRaw, label }) {
  const cfg = Number(configuredSec) > 0 ? Number(configuredSec) : null;
  const hasManual = manualRaw !== undefined && manualRaw !== null && String(manualRaw).trim() !== '';
  let manualMin = null;
  if (hasManual) {
    manualMin = Number(manualRaw);
    if (!Number.isInteger(manualMin) || manualMin < 1 || manualMin > 1440) throw new AppError('Manual duration must be a whole number of minutes between 1 and 1440');
  }
  if (!cfg && !manualMin) throw new AppError(`No ${label} time is configured. Enter the manual duration in minutes`);
  const cfgMin = cfg ? Math.max(Math.ceil(cfg / 60), 1) : null;
  const overridden = !!manualMin && manualMin !== cfgMin;          // same as configured = no override
  const reason = String(reasonRaw || '').trim().slice(0, 255) || null;
  if (overridden && cfg && !reason) throw new AppError('Enter the reason for changing the duration');
  const effectiveSec = overridden ? manualMin * 60 : cfg;
  return { configuredSec: cfg, manualSec: overridden ? manualMin * 60 : null, effectiveSec, reason: overridden ? reason : null };
}
module.exports = { resolveDuration };