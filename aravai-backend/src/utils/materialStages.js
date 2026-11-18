// Material-level production status of a batch.
//   weighed -> [FILTERING -> FILTERED] -> READY_FOR_ROASTING -> ROASTING -> ROASTED
// Nothing extra is stored per material: the status is worked out from batching_details (Filter tick), filtering_details /
// filtering_materials (Filtering done) and roasting_details (Roasting entries). The batch stage follows from these (syncBatchStage).
// Filtering is recorded ONCE per batch and covers every ticked material, so "Filtering done" = the batch has a filtering entry.
const r3 = (n) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

async function filteringInfo(db, batchId) {
  const [f] = await db.query('SELECT id FROM filtering_details WHERE batch_id = ? LIMIT 1', [batchId]);
  const outputs = new Map(); // material_id -> filtered output kg
  if (f.length) {
    try {
      const [fm] = await db.query(
        'SELECT fm.material_id, fm.output_weight FROM filtering_materials fm JOIN filtering_details d ON d.id = fm.filtering_id WHERE d.batch_id = ?', [batchId]);
      fm.forEach((x) => outputs.set(x.material_id, Number(x.output_weight)));
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  }
  return { done: f.length > 0, outputs };
}

// Materials ticked "Filter" whose Filtering is not completed yet = they must NOT be roasted.
async function pendingFilterMaterials(db, batchId) {
  const info = await filteringInfo(db, batchId);
  if (info.done) return [];
  const [rows] = await db.query(
    `SELECT bd.material_id, m.material_name FROM batching_details bd JOIN materials m ON m.id = bd.material_id
      WHERE bd.batch_id = ? AND bd.needs_filtering = 1 ORDER BY bd.id`, [batchId]);
  return rows;
}

function deriveStage(batchStage, s) {
  if (batchStage === 'BATCHING') return null;                       // still weighing: no process has started
  if (!['FILTERING', 'ROASTING'].includes(batchStage)) return 'ROASTED'; // the batch is past Roasting
  if (s.roastRows > 0) {
    const basis = s.filteredQty !== null ? s.filteredQty : s.weighed;
    return s.openRows === 0 && s.roastedQty >= basis - EPS ? 'ROASTED' : 'ROASTING';
  }
  if (s.needsFiltering) return s.filtered ? 'FILTERED' : 'FILTERING';
  return 'READY_FOR_ROASTING';
}

// material_id -> { stage, needs_filtering, filtered, filtered_qty, weighed_qty, roasted_qty }
async function materialStateMap(db, b) {
  const [bd] = await db.query(
    'SELECT material_id, SUM(weighed_qty) AS weighed, MAX(needs_filtering) AS needs FROM batching_details WHERE batch_id = ? GROUP BY material_id', [b.id]);
  const [rs] = await db.query(
    `SELECT material_id, COUNT(*) AS n, COALESCE(SUM(input_weight), 0) AS in_kg, COALESCE(SUM(status = 'IN_PROGRESS'), 0) AS open_n
       FROM roasting_details WHERE batch_id = ? AND status <> 'REJECTED' GROUP BY material_id`, [b.id]);
  const roast = new Map(rs.map((x) => [x.material_id, x]));
  const fil = await filteringInfo(db, b.id);
  const out = new Map();
  bd.forEach((x) => {
    const r = roast.get(x.material_id);
    const needsFiltering = Number(x.needs) === 1;
    const s = {
      weighed: Number(x.weighed), needsFiltering, filtered: needsFiltering && fil.done,
      filteredQty: fil.outputs.has(x.material_id) ? fil.outputs.get(x.material_id) : null,
      roastRows: r ? Number(r.n) : 0, openRows: r ? Number(r.open_n) : 0, roastedQty: r ? Number(r.in_kg) : 0,
    };
    out.set(x.material_id, {
      stage: deriveStage(b.current_stage, s), needs_filtering: needsFiltering, filtered: s.filtered, filtered_qty: s.filteredQty,
      weighed_qty: r3(s.weighed), roasted_qty: r3(s.roastedQty),
    });
  });
  return out;
}

// The batch stage follows its materials. Called after a material was edited / deleted.
//  - nothing is ticked for Filtering (any more)  -> no filtering: batch goes straight to Roasting
//  - a material was ticked while the batch waits at Roasting: Roasting not started -> wait for Filtering, else Roasting continues for the others (PARALLEL)
//  - the last pending material was un-ticked / deleted while the batch waits at Filtering -> Roasting
async function syncBatchStage(conn, batchId) {
  const [[b]] = await conn.query('SELECT id, current_stage, roasting_mode FROM batch_master WHERE id = ? FOR UPDATE', [batchId]);
  if (!b) return null;
  const [[fl]] = await conn.query('SELECT COUNT(*) AS n FROM batching_details WHERE batch_id = ? AND needs_filtering = 1', [batchId]);
  let stage = b.current_stage; let mode = b.roasting_mode;
  if (stage !== 'BATCHING' && ['FILTERING', 'ROASTING'].includes(stage)) {
    const pending = await pendingFilterMaterials(conn, batchId);
    if (!Number(fl.n)) { mode = 'DIRECT'; if (stage === 'FILTERING') stage = 'ROASTING'; }
    else if (!pending.length) { if (stage === 'FILTERING') stage = 'ROASTING'; }
    else if (stage === 'ROASTING' && mode !== 'PARALLEL') {
      const [[st]] = await conn.query("SELECT COUNT(*) AS n FROM roasting_details WHERE batch_id = ? AND status <> 'REJECTED'", [batchId]);
      if (Number(st.n)) mode = 'PARALLEL'; else { stage = 'FILTERING'; mode = 'AFTER_FILTERING'; }
    } else if (stage === 'FILTERING' && !mode) mode = 'AFTER_FILTERING';
  }
  await conn.query('UPDATE batch_master SET current_stage = ?, roasting_mode = ?, needs_filtering = ? WHERE id = ?',
    [stage, mode || null, Number(fl.n) ? 1 : 0, batchId]);
  return { stage, mode };
}

module.exports = { filteringInfo, pendingFilterMaterials, materialStateMap, syncBatchStage };
