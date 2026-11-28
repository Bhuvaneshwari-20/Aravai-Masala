// Roasting partner pairs + Sequential / Simultaneous eligibility. Pure functions (no database), so they are unit-tested.
//
//   batching_details.roast_partner_of  is saved when the batch is created, on BOTH materials of a pair:
//       NULL  = old batch, or a material without the "Roasting with Partner" option -> old behaviour, nothing changes
//       0     = "Roasting with Partner" material left unpaired in a NEW batch        -> it roasts alone
//       > 0   = material_id of its partner                                          -> the two are always roasted together, one machine
const AppError = require('./AppError');

const r3 = (n) => Math.round(n * 1000) / 1000;
const done = (m, t) => !!(m && m.s && m.s[t] && m.s[t].status === 'COMPLETED');
const isManaged = (m) => !!m && m.partner_ref !== null && m.partner_ref !== undefined;   // partner choice was saved with the batch
const mateOf = (b, m) => (m && m.pair_id ? (b.materials.find((x) => x.material_id === m.pair_id) || null) : null);

/* ---------- batch creation ---------- */
// raw = [{ lead_material_id, partner_material_id }]; items = [{ material_id }] of the batch;
// recipe = Map material_id -> { name, roast_type, process_type } of the recipe the batch is made with.
function normalizePairs(raw, items, recipe) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AppError('Roasting partners are not valid');
  if (raw.length > 50) throw new AppError('Too many roasting pairs');
  const inBatch = new Set(items.map((i) => i.material_id));
  const label = (id) => (recipe.get(id) && recipe.get(id).name) || `Material ${id}`;
  const partnerOf = new Map();
  const out = [];
  for (const p of raw) {
    const lead = Number(p && p.lead_material_id);
    const partner = Number(p && p.partner_material_id);
    if (!Number.isInteger(lead) || lead < 1 || !Number.isInteger(partner) || partner < 1) throw new AppError('Select both materials of every roasting pair');
    if (lead === partner) throw new AppError(`${label(lead)} cannot be paired with itself`);
    for (const id of [lead, partner]) {
      const r = recipe.get(id);
      if (!r) throw new AppError(`${label(id)} is not part of the recipe of this batch`);
      if (!inBatch.has(id)) throw new AppError(`${label(id)} is not in this batch`);
      if (r.roast_type !== 'ROAST_PARTNER' || r.process_type === 'FILTER_ONLY') throw new AppError(`${label(id)} is not marked "Roasting with Partner" in the recipe, so it cannot be paired`);
      if (partnerOf.has(id)) throw new AppError(`${label(id)} is already paired with ${label(partnerOf.get(id))}. A material can have only one roasting partner`);
    }
    partnerOf.set(lead, partner); partnerOf.set(partner, lead);
    out.push({ lead, partner });
  }
  return out;
}

// value of batching_details.roast_partner_of for every material of a NEW batch: partner id / 0 (partner material left unpaired) / null (no Roasting option)
function partnerColumn(items, recipe, pairs) {
  const mate = new Map();
  pairs.forEach((p) => { mate.set(p.lead, p.partner); mate.set(p.partner, p.lead); });
  const out = new Map();
  items.forEach((i) => {
    const r = recipe.get(i.material_id) || {};
    if (mate.has(i.material_id)) out.set(i.material_id, mate.get(i.material_id));
    else out.set(i.material_id, r.roast_type === 'ROAST_PARTNER' && r.process_type !== 'FILTER_ONLY' ? 0 : null);
  });
  return out;
}

/* ---------- loading ---------- */
// materials of ONE batch, each with partner_ref (number or undefined). A pair counts only when both rows point at each other.
function linkPairs(materials) {
  materials.forEach((m) => { delete m.pair_id; });
  materials.forEach((m) => {
    if (!(m.partner_ref > 0)) return;
    const mate = materials.find((x) => x.material_id === m.partner_ref);
    if (mate && mate.material_id !== m.material_id && mate.partner_ref === m.material_id) m.pair_id = mate.material_id;
  });
  return materials;
}

/* ---------- eligibility ---------- */
// Can this ONE material go to Roasting (the unchanged per-material rules)?
//   SEQUENTIAL   : every Filtering of the batch is completed (+ "Proceed to Roasting" for a filtered material)
//   SIMULTANEOUS : the material has no Filtering, or ITS OWN Filtering is completed
function memberRoastReady(b, m) {
  const fs = m.s && m.s.FILTERING;
  if (b.process_mode !== 'SIMULTANEOUS') {
    if (b.materials.some((x) => x.needs && !done(x, 'FILTERING'))) return { ok: false, reason: 'Sequential batch: Roasting starts after Filtering of the whole batch is completed' };
    if (m.needs && !(fs && fs.proceeded)) return { ok: false, reason: `Filtering is done. Confirm "Proceed to Roasting" for ${m.material_name} on the Filtering card` };
    return { ok: true, reason: '' };
  }
  if (m.needs && !done(m, 'FILTERING')) {
    return { ok: false, reason: fs ? `${m.material_name} is still being filtered. This pair can be roasted after its Filtering` : `${m.material_name} must be filtered first. This pair can be roasted after its Filtering` };
  }
  return { ok: true, reason: '' };
}

// A saved pair is ready only when BOTH materials are ready. A material without a pair is judged alone.
function roastGroupReady(b, m) {
  const mine = memberRoastReady(b, m);
  const mate = mateOf(b, m);
  if (!mate || !mine.ok) return mine;
  return memberRoastReady(b, mate);
}

/* ---------- starting a combined roast ---------- */
// ids = materials the client sent. derive = the client sent only one material_id (cards of a saved pair).
// Returns { managed, mats }. managed = the batch has saved partner choices: the group is ALWAYS the saved pair.
function resolveStartGroup(b, ids, derive) {
  const mats = ids.map((id) => {
    const m = b.materials.find((x) => x.material_id === id);
    if (!m) throw new AppError('One of the materials is not part of this batch', 404);
    return m;
  });
  if (!mats.some(isManaged)) return { managed: false, mats };           // old batch: old rules (checked by the caller)
  const first = mats[0];
  const mate = mateOf(b, first);
  if (!mate) throw new AppError(`${first.material_name} has no roasting partner in this batch. Roast it individually`, 409);
  if (!derive && !(mats.length === 2 && mats.some((x) => x.material_id === mate.material_id))) {
    throw new AppError(`${first.material_name} is paired with ${mate.material_name}. They must be roasted together. The partner cannot be changed`, 409);
  }
  return { managed: true, mats: [first, mate] };
}

/* ---------- queue: one Roasting card per saved pair ---------- */
function mergePairCards(items) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const skip = new Set();
  const out = [];
  for (const i of items) {
    if (skip.has(i.key)) continue;
    const mate = i.process_type === 'ROASTING' && i.pair_material_id ? byKey.get(`${i.batch_id}:${i.pair_material_id}:ROASTING`) : null;
    if (!mate || mate.pair_material_id !== i.material_id || mate.status !== i.status) { out.push(i); continue; }
    skip.add(mate.key);
    const members = [i, mate].map((x) => ({ key: x.key, material_id: x.material_id, material_name: x.material_name, quantity: x.quantity, status: x.status, session: x.session }));
    out.push({
      ...i, is_group: true, members, material_name: `${i.material_name} + ${mate.material_name}`,
      quantity: r3((Number(i.quantity) || 0) + (Number(mate.quantity) || 0)),
      planned_seconds: Math.max(Number(i.planned_seconds) || 0, Number(mate.planned_seconds) || 0) || null, // same rule as startGroup: longest configured time
    });
  }
  return out;
}

module.exports = { isManaged, mateOf, done, normalizePairs, partnerColumn, linkPairs, memberRoastReady, roastGroupReady, resolveStartGroup, mergePairCards };