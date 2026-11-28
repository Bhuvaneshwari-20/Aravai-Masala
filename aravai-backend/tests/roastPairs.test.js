// Run from the backend folder:  node --test tests/roastPairs.test.js   (no database needed)
const test = require('node:test');
const assert = require('node:assert');
const rp = require('../utils/roastPairs');

const FILTERED = { FILTERING: { status: 'COMPLETED', proceeded: false } };
const PROCEEDED = { FILTERING: { status: 'COMPLETED', proceeded: true } };

// A(filter)+B partner, C(filter)+D partner, E independent roast-only
function batch(mode, st = {}) {
  const mk = (id, name, o) => ({ material_id: id, material_name: name, needs: false, roast: true, roast_type: 'ROAST_PARTNER', s: st[name] || {}, ...o });
  const b = { process_mode: mode, materials: [
    mk(1, 'A', { needs: true, partner_ref: 2 }), mk(2, 'B', { partner_ref: 1 }),
    mk(3, 'C', { needs: true, partner_ref: 4 }), mk(4, 'D', { partner_ref: 3 }),
    mk(5, 'E', { roast_type: 'ROAST_ONLY' }),
  ] };
  rp.linkPairs(b.materials);
  return b;
}
const ok = (b, name) => rp.roastGroupReady(b, b.materials.find((m) => m.material_name === name)).ok;
const why = (b, name) => rp.roastGroupReady(b, b.materials.find((m) => m.material_name === name)).reason;

test('SIMULTANEOUS: A+B ready as soon as A is filtered, while C is still filtering', () => {
  const b = batch('SIMULTANEOUS', { A: FILTERED });
  assert.ok(ok(b, 'A') && ok(b, 'B'));
  assert.ok(!ok(b, 'C') && !ok(b, 'D'));
  assert.match(why(b, 'D'), /C must be filtered first/);
  assert.ok(ok(b, 'E'));                                  // independent material is never held
});
test('SIMULTANEOUS: C+D ready after C is filtered; no "Proceed" step is needed', () => {
  const b = batch('SIMULTANEOUS', { A: FILTERED, C: FILTERED });
  assert.ok(ok(b, 'A') && ok(b, 'B') && ok(b, 'C') && ok(b, 'D'));
});
test('SIMULTANEOUS: a running filtering of C does not release C+D', () => {
  const b = batch('SIMULTANEOUS', { A: FILTERED, C: { FILTERING: { status: 'RUNNING' } } });
  assert.ok(!ok(b, 'C') && !ok(b, 'D'));
  assert.match(why(b, 'C'), /still being filtered/);
});
test('SEQUENTIAL: A filtered but C pending -> no group is eligible (incl. independent E)', () => {
  const b = batch('SEQUENTIAL', { A: PROCEEDED });
  ['A', 'B', 'C', 'D', 'E'].forEach((n) => assert.ok(!ok(b, n), n));
  assert.match(why(b, 'A'), /whole batch/);
});
test('SEQUENTIAL: all Filtering done but C not confirmed -> only A+B eligible', () => {
  const b = batch('SEQUENTIAL', { A: PROCEEDED, C: FILTERED });
  assert.ok(ok(b, 'A') && ok(b, 'B') && ok(b, 'E'));
  assert.ok(!ok(b, 'C') && !ok(b, 'D'));
  assert.match(why(b, 'D'), /Proceed to Roasting.*C/);
});
test('SEQUENTIAL: everything filtered and confirmed -> both groups eligible', () => {
  const b = batch('SEQUENTIAL', { A: PROCEEDED, C: PROCEEDED });
  ['A', 'B', 'C', 'D', 'E'].forEach((n) => assert.ok(ok(b, n), n));
});
test('legacy filtering sessions (proceeded=true) keep working in SEQUENTIAL', () => {
  const b = batch('SEQUENTIAL', { A: { FILTERING: { status: 'COMPLETED', legacy: true, proceeded: true } }, C: PROCEEDED });
  assert.ok(ok(b, 'A') && ok(b, 'C'));
});

test('start-group: wrong partner (A + D) is rejected', () => {
  const b = batch('SIMULTANEOUS');
  assert.throws(() => rp.resolveStartGroup(b, [1, 4], false), /paired with B.*cannot be changed/);
  assert.throws(() => rp.resolveStartGroup(b, [1, 2, 4], false), /cannot be changed/);
  assert.throws(() => rp.resolveStartGroup(b, [1], false), /cannot be changed/);
});
test('start-group: the saved pair is accepted, or derived from one material_id', () => {
  const b = batch('SIMULTANEOUS');
  assert.deepStrictEqual(rp.resolveStartGroup(b, [1, 2], false).mats.map((m) => m.material_id), [1, 2]);
  assert.deepStrictEqual(rp.resolveStartGroup(b, [2, 1], false).mats.map((m) => m.material_id), [2, 1]);
  assert.deepStrictEqual(rp.resolveStartGroup(b, [4], true).mats.map((m) => m.material_id), [4, 3]);
});
test('start-group: an unpaired partner material (partner_ref 0) cannot be started as a group', () => {
  const b = batch('SIMULTANEOUS');
  b.materials.push({ material_id: 6, material_name: 'F', needs: false, roast: true, roast_type: 'ROAST_PARTNER', partner_ref: 0, s: {} });
  rp.linkPairs(b.materials);
  assert.throws(() => rp.resolveStartGroup(b, [6], true), /no roasting partner/);
  assert.ok(ok(b, 'F'));                                      // roasts alone, judged on its own
});
test('start-group: batch without saved partners (legacy NULL) keeps the old free rules', () => {
  const b = { process_mode: 'SEQUENTIAL', materials: [{ material_id: 1, material_name: 'A', s: {}, roast_type: 'ROAST_PARTNER' }, { material_id: 2, material_name: 'B', s: {}, roast_type: 'ROAST_PARTNER' }] };
  const g = rp.resolveStartGroup(b, [1, 2], false);
  assert.strictEqual(g.managed, false);
  assert.strictEqual(g.mats.length, 2);
});
test('linkPairs: one-sided or self pointers are not a pair', () => {
  const ms = [{ material_id: 1, partner_ref: 2 }, { material_id: 2, partner_ref: 0 }, { material_id: 3, partner_ref: 3 }];
  rp.linkPairs(ms);
  assert.ok(!ms[0].pair_id && !ms[1].pair_id && !ms[2].pair_id);
});

const recipe = new Map([
  [1, { name: 'A', roast_type: 'ROAST_PARTNER', process_type: 'FILTER_ROAST' }], [2, { name: 'B', roast_type: 'ROAST_PARTNER', process_type: 'ROAST_ONLY' }],
  [3, { name: 'C', roast_type: 'ROAST_PARTNER', process_type: 'FILTER_ROAST' }], [4, { name: 'D', roast_type: 'ROAST_PARTNER', process_type: 'ROAST_ONLY' }],
  [5, { name: 'E', roast_type: 'ROAST_ONLY', process_type: 'ROAST_ONLY' }], [6, { name: 'F', roast_type: 'ROAST_PARTNER', process_type: 'FILTER_ONLY' }],
  [7, { name: 'G', roast_type: 'ROAST_PARTNER', process_type: 'ROAST_ONLY' }],
]);
const items = [1, 2, 3, 4, 5, 6].map((material_id) => ({ material_id }));   // G (7) is in the recipe but left out of the batch
const P = (a, b) => ({ lead_material_id: a, partner_material_id: b });

test('create: valid pairs are normalised', () => {
  assert.deepStrictEqual(rp.normalizePairs([P(1, 2), P(3, 4)], items, recipe), [{ lead: 1, partner: 2 }, { lead: 3, partner: 4 }]);
  assert.deepStrictEqual(rp.normalizePairs(undefined, items, recipe), []);
  assert.deepStrictEqual(rp.normalizePairs([], items, recipe), []);
});
test('create: invalid pairs are rejected', () => {
  const bad = (pairs, re) => assert.throws(() => rp.normalizePairs(pairs, items, recipe), re);
  bad('x', /not valid/);
  bad([P(1, 1)], /itself/);
  bad([P(1, null)], /both materials/);
  bad([P(1, 5)], /E is not marked/);               // "Only Roasting" material
  bad([P(1, 6)], /F is not marked/);               // Filtering Only material
  bad([P(1, 7)], /G is not in this batch/);        // in recipe, left out of the batch
  bad([P(1, 99)], /not part of the recipe/);
});
test('create: duplicate pairing is rejected', () => {
  const bad = (pairs, re) => assert.throws(() => rp.normalizePairs(pairs, items, recipe), re);
  bad([P(1, 2), P(1, 4)], /A is already paired with B/);     // one lead, two partners
  bad([P(1, 2), P(3, 2)], /B is already paired with A/);     // one partner, two leads
  bad([P(1, 2), P(2, 3)], /already paired/);                 // partner also used as lead
  bad([P(1, 2), P(2, 1)], /already paired/);                 // same pair twice, reversed
  bad([P(1, 2), P(1, 2)], /already paired/);
});
test('create: column values - paired / unpaired partner material (0) / no option (null)', () => {
  const col = rp.partnerColumn(items, recipe, [{ lead: 1, partner: 2 }]);
  assert.strictEqual(col.get(1), 2); assert.strictEqual(col.get(2), 1);
  assert.strictEqual(col.get(3), 0); assert.strictEqual(col.get(4), 0);   // marked Roasting with Partner, left unpaired: roasts alone
  assert.strictEqual(col.get(5), null);                                    // Only Roasting
  assert.strictEqual(col.get(6), null);                                    // Filtering Only
});

test('queue: a saved pair becomes ONE card; unpaired and legacy cards stay separate', () => {
  const card = (id, name, pair, o = {}) => ({ key: `9:${id}:ROASTING`, batch_id: 9, process_type: 'ROASTING', material_id: id, material_name: name, quantity: 10, status: 'PENDING', planned_seconds: id * 60, pair_material_id: pair, session: null, ...o });
  const out = rp.mergePairCards([card(1, 'A', 2), card(2, 'B', 1), card(3, 'C', null)]);
  assert.strictEqual(out.length, 2);
  assert.ok(out[0].is_group); assert.strictEqual(out[0].material_name, 'A + B'); assert.strictEqual(out[0].quantity, 20);
  assert.strictEqual(out[0].planned_seconds, 120); assert.strictEqual(out[0].members.length, 2);
  assert.ok(!out[1].is_group);
  const split = rp.mergePairCards([card(1, 'A', 2, { status: 'RUNNING' }), card(2, 'B', 1)]);   // inconsistent data is never hidden
  assert.strictEqual(split.length, 2);
});