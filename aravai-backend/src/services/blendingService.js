const { pool, withTransaction } = require('../config/db');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const h = require('../utils/productionHelpers');

// true  = ingredients picked from Material Master are issued from raw stock (ledger row + stock reduced).
// false = blending only records the weights and never touches stock.
const DEDUCT_STOCK = false;
const MAX_LINES = 50;

// The spices of a batch with their weights. Per-spice weights exist only at batching (or in the recipe), so they are
// scaled to the powder grinding actually handed over (batch_master.current_output_kg). Mixing % = spice weight / total.
async function loadIngredients(db, batchId = null) {
  const only = batchId ? 'AND b.id = ?' : '';
  const args = batchId ? [batchId, batchId] : [];
  const [rows] = await db.query(
    `SELECT b.id AS batch_id, b.current_output_kg AS ground_kg, m.id AS material_id, m.material_code, m.material_name, ROUND(SUM(d.weighed_qty), 3) AS qty
       FROM batch_master b JOIN batching_details d ON d.batch_id = b.id JOIN materials m ON m.id = d.material_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ${only}
      GROUP BY b.id, b.current_output_kg, m.id, m.material_code, m.material_name
     UNION ALL
     SELECT b.id, b.current_output_kg, m.id, m.material_code, m.material_name, ROUND(rd.quantity_kg * b.planned_qty_kg / r.base_quantity_kg, 3)
       FROM batch_master b JOIN recipe_master r ON r.id = b.recipe_id JOIN recipe_details rd ON rd.recipe_id = r.id
       JOIN materials m ON m.id = rd.material_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ${only}
        AND NOT EXISTS (SELECT 1 FROM batching_details x WHERE x.batch_id = b.id)`, args);
  const total = {};
  rows.forEach((r) => { total[r.batch_id] = (total[r.batch_id] || 0) + Number(r.qty); });
  return rows.map((r) => {
    const share = total[r.batch_id] > 0 ? Number(r.qty) / total[r.batch_id] : 0;
    const ground = Number(r.ground_kg);
    return { batch_id: r.batch_id, material_id: r.material_id, material_code: r.material_code, material_name: r.material_name,
      qty: h.r3(ground > 0 ? ground * share : Number(r.qty)), percent: h.r3(share * 100) };
  }).sort((a, b) => a.batch_id - b.batch_id || a.material_name.localeCompare(b.material_name));
}
/* ---------- dropdown data for the form ---------- */
async function lookups() {
  const [batches] = await pool.query(
    `SELECT b.id, b.batch_no, b.product_id, p.product_name, b.recipe_id, b.planned_qty_kg, b.current_output_kg
       FROM batch_master b JOIN product_master p ON p.id = b.product_id
      WHERE b.current_stage = 'BLENDING' AND b.status IN ('OPEN','IN_PROGRESS') ORDER BY b.id DESC`);
  const [machines] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'BLENDING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_name");
  const [recipes] = await pool.query(
    'SELECT id, recipe_no, product_id, version_no FROM recipe_master WHERE is_active = 1 ORDER BY recipe_no');
  const [materials] = await pool.query(
    "SELECT id, material_code, material_name, unit, current_stock FROM materials WHERE is_active = 1 AND unit IN ('KG','GRAM') ORDER BY material_name");
  const [users] = await pool.query('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name');
  let batchMaterials = [];
  try { batchMaterials = await loadIngredients(pool); } catch (e) { console.error('batch_materials lookup failed:', e.message); } // never let this break the whole form
  return { batches, machines, recipes, materials, users, batch_materials: batchMaterials };
}
/* ---------- validation ---------- */
function cleanInput(body, userId) {
  const d = {
    batch_id: v.toId(body.batch_id, 'batch'),
    recipe_id: body.recipe_id ? v.toId(body.recipe_id, 'recipe') : null,
    machine_id: v.toId(body.machine_id, 'machine'),
    entry_date: h.reqDate(body.entry_date, 'Date'),
    start_clock: h.reqTime(body.start_time, 'Start time'),
    mixing_duration_min: body.mixing_duration_min === '' || body.mixing_duration_min == null ? null : h.wholeNum(body.mixing_duration_min, 'Mixing duration', { max: 1440 }),
    done_by: body.done_by ? v.toId(body.done_by, 'done by user') : userId,
    checked_by: body.checked_by ? v.toId(body.checked_by, 'checked by user') : null,
    remarks: v.optStr(body.remarks, 'Remarks', 255),
  };

  d.output_weight = v.num(body.output_weight, 'Blended output weight', { max: 999999 });
  if (d.output_weight <= 0) throw new AppError('Enter the blended output weight');
  return d;
}

/* ---------- submit ---------- */
async function create(body, userId, ip) {
  const d = cleanInput(body, userId);
  return withTransaction(async (conn) => {
    const batch = await h.lockBatch(conn, d.batch_id, 'BLENDING');
    await h.checkMachine(conn, d.machine_id, 'BLENDING');
    await h.checkUsers(conn, [userId, d.done_by, d.checked_by]);

    const recipeId = d.recipe_id || batch.recipe_id;
    if (!recipeId) throw new AppError('This batch has no recipe. Please select one');
    const [rec] = await conn.query('SELECT id, product_id FROM recipe_master WHERE id = ? AND is_active = 1', [recipeId]);
    if (!rec.length) throw new AppError('Selected recipe does not exist or is inactive');
    if (rec[0].product_id !== batch.product_id) throw new AppError('Selected recipe belongs to a different product');

    // ingredients and their weights come from the batch itself, never from the form
    d.ingredients = (await loadIngredients(conn, batch.id)).map((m) => ({
      material_id: m.material_id, ingredient_weight: m.qty, no_of_bags: 0, weight_per_bag: null }));
    if (!d.ingredients.length) throw new AppError('No ingredient weights found for this batch. It needs batching weights or a recipe');
    const totalInput = h.r3(d.ingredients.reduce((s, l) => s + l.ingredient_weight, 0));
    if (d.output_weight > totalInput + 0.01) throw new AppError(`Blended weight (${d.output_weight} kg) cannot be more than the total ingredients (${totalInput} kg)`);
    const wastage = h.r3(Math.max(totalInput - d.output_weight, 0));

    const start = h.dateTimeStr(d.entry_date, d.start_clock);
    const end = d.mixing_duration_min == null ? null : h.dateTimeStr(d.entry_date, d.start_clock, d.mixing_duration_min);
    const [hd] = await conn.query(
      `INSERT INTO blending_details (batch_id, recipe_id, machine_id, operator_id, total_input_weight, mixing_duration_min,
         start_time, end_time, output_weight, wastage_weight, status, remarks) VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED',?)`,
      [batch.id, recipeId, d.machine_id, userId, totalInput, d.mixing_duration_min, start, end, d.output_weight, wastage, d.remarks]);

    for (const l of d.ingredients) {
      let name = l.ingredient_name;
      let txnId = null;
      if (l.material_id) {
        const [[m]] = await conn.query('SELECT material_name FROM materials WHERE id = ?', [l.material_id]);
        if (!m) throw new AppError('Selected material does not exist');
        name = m.material_name;
        if (DEDUCT_STOCK) {
          txnId = await h.issueRawMaterial(conn, { materialId: l.material_id, weightKg: l.ingredient_weight, date: d.entry_date,
            batch, userId, purpose: `Blending - ${batch.batch_no}` });
        }
      } else {
        name = name || `Ground batch ${batch.batch_no}`;
      }
      await conn.query(
        `INSERT INTO blending_ingredients (blending_id, entry_date, material_id, ingredient_name, no_of_bags, weight_per_bag,
           ingredient_weight, done_by, checked_by, stock_txn_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [hd.insertId, d.entry_date, l.material_id, name, l.no_of_bags, l.weight_per_bag, l.ingredient_weight, d.done_by, d.checked_by, txnId]);
    }

    // hand the blended weight to Packing
    await conn.query(
      `UPDATE batch_master SET current_stage = 'PACKING', status = 'IN_PROGRESS', current_output_kg = ?,
         total_wastage_kg = total_wastage_kg + ? WHERE id = ?`, [d.output_weight, wastage, batch.id]);

    const result = { id: hd.insertId, batch_no: batch.batch_no, total_input_weight: totalInput, output_weight: d.output_weight, wastage_weight: wastage };
    await audit({ userId, action: 'CREATE', table: 'blending_details', recordId: hd.insertId, newValues: { ...result, lines: d.ingredients.length }, ip }, conn);
    return result;
  });
}


/* ---------- one entry, for the details view ---------- */
async function get(id) {
  const bid = v.toId(id, 'blending entry');
  const [rows] = await pool.query(
    `SELECT bd.*, b.batch_no, b.current_stage AS batch_stage, b.status AS batch_status, b.current_output_kg AS batch_output_kg,
            p.product_name, rc.recipe_no, rc.version_no, m.machine_code, m.machine_name, u.full_name AS operator_name,
            COALESCE((SELECT SUM(x.weighed_qty) FROM batching_details x WHERE x.batch_id = b.id), 0) AS batching_kg,
COALESCE((SELECT SUM(x.total_packing_weight) FROM packing_details x WHERE x.batch_id = b.id AND x.status <> 'CANCELLED'), 0) AS batch_packed_kg
       FROM blending_details bd
       JOIN batch_master b ON b.id = bd.batch_id
       JOIN product_master p ON p.id = b.product_id
       JOIN recipe_master rc ON rc.id = bd.recipe_id
       JOIN machine_master m ON m.id = bd.machine_id
       JOIN users u ON u.id = bd.operator_id
      WHERE bd.id = ?`, [bid]);
  if (!rows.length) throw new AppError('Blending entry not found', 404);
  const d = rows[0];
  const [ing] = await pool.query(
    `SELECT i.id, i.entry_date, i.ingredient_name, i.ingredient_weight, i.no_of_bags, i.weight_per_bag, mt.material_code,
            du.full_name AS done_by_name, cu.full_name AS checked_by_name
       FROM blending_ingredients i
       LEFT JOIN materials mt ON mt.id = i.material_id
       LEFT JOIN users du ON du.id = i.done_by
       LEFT JOIN users cu ON cu.id = i.checked_by
      WHERE i.blending_id = ? ORDER BY i.id`, [bid]);
  const total = Number(d.total_input_weight);
  d.ingredients = ing.map((r) => ({ ...r, percent: total > 0 ? h.r2((Number(r.ingredient_weight) / total) * 100) : 0 }));
  d.loss_percent = total > 0 ? h.r2((Number(d.wastage_weight || 0) / total) * 100) : 0;
  return d;
}

/* ---------- recent entries ---------- */
async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const args = [];
  let w = '';
  const search = v.clean(q.search);
  if (search) { w = 'WHERE (b.batch_no LIKE ? OR p.product_name LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const from = `FROM blending_details bd JOIN batch_master b ON b.id = bd.batch_id JOIN product_master p ON p.id = b.product_id
    JOIN machine_master m ON m.id = bd.machine_id JOIN users u ON u.id = bd.operator_id ${w}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [items] = await pool.query(
    `SELECT bd.id, b.batch_no, p.product_name, m.machine_name, u.full_name AS operator_name, bd.start_time, bd.mixing_duration_min,
            bd.total_input_weight, bd.output_weight, bd.wastage_weight, bd.status ${from} ORDER BY bd.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]);
  return { items, page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { lookups, create, list, get };