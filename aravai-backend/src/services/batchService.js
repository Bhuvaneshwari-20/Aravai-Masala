const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const stock = require('./stockService');

const r3 = (n) => Math.round(n * 1000) / 1000;

const BATCH_SELECT = `
  SELECT b.*, p.product_code, p.product_name, r.recipe_no, r.version_no, r.base_quantity_kg,
         r.default_filter_stages AS recipe_filter_stages, u.full_name AS created_by_name
  FROM batch_master b
  JOIN product_master p ON p.id = b.product_id
  LEFT JOIN recipe_master r ON r.id = b.recipe_id
  JOIN users u ON u.id = b.created_by`;

const shape = (b) => ({ ...b, is_locked: b.active_lock === 1 });

async function loadBatch(db, id, forUpdate = false) {
  const [rows] = await db.query(`${BATCH_SELECT} WHERE b.id = ? ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw new AppError('Batch not found', 404);
  return rows[0];
}

// Batch must be running (not on hold / completed) and still in the BATCHING stage.
function assertBatchingOpen(b) {
  if (b.status === 'ON_HOLD') throw new AppError(`Batch ${b.batch_no} is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}. Resume it first`);
  if (b.status !== 'IN_PROGRESS') throw new AppError(`Batch ${b.batch_no} is ${b.status.toLowerCase().replace('_', ' ')}`);
  if (b.current_stage !== 'BATCHING') throw new AppError(`Batching is already completed for batch ${b.batch_no}`);
}

/**
 * Batching plan = recipe scaled to the planned quantity, with what has been weighed so far.
 * This is what the Batching screen shows: one row per recipe ingredient.
 */
async function buildPlan(db, b) {
  if (!b.recipe_id) return null;
  const [rows] = await db.query(
    `SELECT d.material_id, m.material_code, m.material_name, m.unit, d.quantity_kg AS recipe_qty_kg, m.current_stock,
            m.default_filter_stages, bd.id AS batching_id, bd.entry_date, bd.no_of_bags, bd.weight_per_bag, bd.required_qty,
            bd.weighed_qty, bd.weighing_machine_id, wm.machine_name AS weighing_machine_name, bd.done_by, du.full_name AS done_by_name, bd.checked_by, cu.full_name AS checked_by_name, bd.stock_txn_id
     FROM recipe_details d
     JOIN materials m ON m.id = d.material_id
     LEFT JOIN batching_details bd ON bd.batch_id = ? AND bd.material_id = d.material_id
     LEFT JOIN machine_master wm ON wm.id = bd.weighing_machine_id
     LEFT JOIN users du ON du.id = bd.done_by
     LEFT JOIN users cu ON cu.id = bd.checked_by
     WHERE d.recipe_id = ? ORDER BY d.id`, [b.id, b.recipe_id]);

  // Recipes no longer carry quantities (base 0), so nothing is "required" - the weighed quantity is simply recorded.
  const base = Number(b.base_quantity_kg) || 0;
  const scale = base > 0 ? Number(b.planned_qty_kg) / base : null;
  const ingredients = rows.map((r) => {
    const required = scale !== null && Number(r.recipe_qty_kg) > 0 ? r3(Number(r.recipe_qty_kg) * scale) : null;
    const done = r.batching_id !== null;
    return {
      ...r,
      required_kg: required,
      is_done: done,
      variance_kg: done && required !== null ? r3(Number(r.weighed_qty) - required) : null,
      stock_short: !done && required !== null && Number(r.current_stock) < required,
    };
  });
  const done = ingredients.filter((i) => i.is_done);
  const recipeStages = Number(b.recipe_filter_stages || 0);
  return {
    scale: scale === null ? null : r3(scale),
    ingredients,
    total_required_kg: scale === null ? null : r3(ingredients.reduce((a, i) => a + (i.required_kg || 0), 0)),
    total_weighed_kg: r3(done.reduce((a, i) => a + Number(i.weighed_qty), 0)),
    done_count: done.length,
    pending_count: ingredients.length - done.length,
    can_complete: ingredients.length > 0 && done.length === ingredients.length,
    suggested_filter_stages: recipeStages > 0 ? recipeStages : Math.max(0, ...ingredients.map((i) => Number(i.default_filter_stages))),
  };
}

/* ---------- queries ---------- */
async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'batch id');
  const b = await loadBatch(db, id);
  return { ...shape(b), plan: await buildPlan(db, b) };
}

// The one batch that currently holds the lock (running OR on hold), or null.
async function active() {
  const [rows] = await pool.query(`${BATCH_SELECT} WHERE b.active_lock = 1 LIMIT 1`);
  if (!rows.length) return null;
  return { ...shape(rows[0]), plan: await buildPlan(pool, rows[0]) };
}

async function list(q) {
  const { page, limit, offset } = v.paging(q);
  const where = [];
  const args = [];
  if (q.status) { where.push('b.status = ?'); args.push(String(q.status).toUpperCase()); }
  const search = v.clean(q.search);
  if (search) { where.push('(b.batch_no LIKE ? OR p.product_name LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM batch_master b JOIN product_master p ON p.id = b.product_id ${w}`, args);
  const [rows] = await pool.query(`${BATCH_SELECT} ${w} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  return { items: rows.map(shape), page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) };
}

// Active staff for the "Done by" / "Checked by" pickers.
async function staff() {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, r.role_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND r.role_name <> 'Super Admin' ORDER BY u.full_name`);
  return rows;
}

// Weighing machines usable on the batching sheet (batching role does not need the Machines module permission for this).
async function weighingMachines() {
  const [rows] = await pool.query(
    "SELECT id, machine_code, machine_name FROM machine_master WHERE machine_type = 'WEIGHING' AND status IN ('ACTIVE','IDLE') ORDER BY machine_code");
  return rows;
}

/* ---------- start a batch: follows the "ARAVAI BATCHING PROCESS PLAN" sheet ---------- */
// One row per material: no of bags, weight (per bag), weighed qty. Done by / Checked by apply to the whole sheet.
// Saving weighs every material in (stock goes down), closes BATCHING and moves the batch to ROASTING (IN_PROGRESS).
// No active_lock is taken, so the next batch can be added straight away.
async function start(body, userId, ip) {
  const productId = v.toId(body.product_id, 'product');
  const recipeId = v.toId(body.recipe_id, 'recipe');
  const date = v.date(body.production_date, 'Production date');
  if (!Array.isArray(body.ingredients)) throw new AppError('Enter the quantity of the materials');
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : userId;
  if (!body.checked_by) throw new AppError('Checked by is required');
  const checkedBy = v.toId(body.checked_by, 'checked by');
  if (doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const machineId = body.weighing_machine_id ? v.toId(body.weighing_machine_id, 'weighing machine') : null;

  const blank = (x) => x === undefined || x === null || String(x).trim() === '';
  // blank / 0 weighed qty = that material is not used in this batch
  const items = body.ingredients
    .filter((i) => i && !blank(i.weighed_qty ?? i.quantity_kg) && Number(i.weighed_qty ?? i.quantity_kg) !== 0)
    .map((i) => {
      const weighed = v.positive(i.weighed_qty ?? i.quantity_kg, 'Weighed quantity (kg)', { max: 1000000 });
      const bags = blank(i.no_of_bags) ? 1 : v.intRange(i.no_of_bags, 'No of bags', 1, 100000);
      const perBag = blank(i.weight_per_bag) ? r3(weighed / bags) : v.positive(i.weight_per_bag, 'Weight per bag (kg)', { max: 100000 });
      return { material_id: v.toId(i.material_id, 'material'), bags, perBag, quantity_kg: weighed };
    });
  if (!items.length) throw new AppError('Enter the quantity for at least one material');
  if (new Set(items.map((i) => i.material_id)).size !== items.length) throw new AppError('A material is added twice');
  const total = r3(items.reduce((a, i) => a + i.quantity_kg, 0));

  return withTransaction(async (conn) => {
    const [prod] = await conn.query('SELECT id, is_active FROM product_master WHERE id = ?', [productId]);
    if (!prod.length) throw new AppError('Product not found', 404);
    if (!prod[0].is_active) throw new AppError('Product is inactive');
    const [rec] = await conn.query('SELECT id, product_id, is_active FROM recipe_master WHERE id = ?', [recipeId]);
    if (!rec.length) throw new AppError('Recipe not found', 404);
    if (rec[0].product_id !== productId) throw new AppError('This recipe does not belong to the selected product');
    if (!rec[0].is_active) throw new AppError('This recipe version is not active');

    const [users] = await conn.query('SELECT id FROM users WHERE id IN (?) AND is_active = 1', [[doneBy, checkedBy]]);
    if (users.length !== 2) throw new AppError('Done by / Checked by must be active users');

    const [inRecipe] = await conn.query('SELECT d.material_id, m.material_name, m.unit FROM recipe_details d JOIN materials m ON m.id = d.material_id WHERE d.recipe_id = ?', [recipeId]);
    const byId = new Map(inRecipe.map((r) => [r.material_id, r]));
    for (const i of items) {
      const m = byId.get(i.material_id);
      if (!m) throw new AppError('One of the materials is not part of the recipe');
      if (m.unit !== 'KG') throw new AppError(`${m.material_name} is in ${m.unit}; only KG materials can be batched`);
    }
    if (machineId) {
      const [mc] = await conn.query("SELECT id FROM machine_master WHERE id = ? AND machine_type = 'WEIGHING' AND status IN ('ACTIVE','IDLE')", [machineId]);
      if (!mc.length) throw new AppError('Selected weighing machine is not available');
    }

    const batchNo = await nextNumber(conn, 'BATCH');
    // Batching is finished -> the batch is IN_PROGRESS at the next process (ROASTING), not COMPLETED.
    const [r] = await conn.query(
      `INSERT INTO batch_master (batch_no, production_date, product_id, recipe_id, planned_qty_kg, current_stage, status, current_output_kg,
         created_by, batching_completed_at, active_lock)
       VALUES (?,?,?,?,?,'ROASTING','IN_PROGRESS',?,?,NOW(),NULL)`, [batchNo, date, productId, recipeId, total, total, userId]);
    const id = r.insertId;

    const alerts = [];
    for (const i of items) {
      // raw stock goes down here, in the same transaction as the batch
      const st = await stock.postTxn(conn, {
        material_id: i.material_id, direction: 'OUT', txn_type: 'ISSUE', qty: i.quantity_kg, txn_date: v.date(),
        issue_type: 'PRODUCTION', purpose: `Batch ${batchNo} - batching`, reference_type: 'BATCH', reference_no: batchNo,
        batch_id: id, entered_by: userId,
      });
      if (st.low_stock_alert) alerts.push(st.low_stock_alert);
      await conn.query(
        `INSERT INTO batching_details (batch_id, entry_date, material_id, no_of_bags, weight_per_bag, weighed_qty, weighing_machine_id, stock_txn_id, done_by, checked_by, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED')`, [id, date, i.material_id, i.bags, i.perBag, i.quantity_kg, machineId, st.txn_id, doneBy, checkedBy]);
    }

    const created = await getById(id, conn);
    await audit({ userId, action: 'CREATE', table: 'batch_master', recordId: id,
      newValues: { batch_no: batchNo, product_id: productId, recipe_id: recipeId, total_kg: total, stage: 'ROASTING', materials: items, doneBy, checkedBy }, ip }, conn);
    return { ...created, low_stock_alerts: alerts };
  });
}

/* ---------- step 7: weigh one material into the batch ---------- */
async function addBatching(batchIdRaw, body, user, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(body.material_id, 'material');
  const bags = v.intRange(body.no_of_bags, 'No of bags', 1, 100000);
  if (bags === undefined) throw new AppError('No of bags is required');
  const perBag = v.positive(body.weight_per_bag, 'Weight per bag (kg)', { max: 100000 });
  const weighed = v.positive(body.weighed_qty, 'Weighed quantity (kg)', { max: 1000000 });
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : user.id;
  if (!body.checked_by) throw new AppError('Checked by is required');
  const checkedBy = v.toId(body.checked_by, 'checked by');
  if (doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const machineId = body.weighing_machine_id ? v.toId(body.weighing_machine_id, 'weighing machine') : null;

  return withTransaction(async (conn) => {
    const b = await loadBatch(conn, batchId, true);
    assertBatchingOpen(b);

    const [ing] = await conn.query(
      `SELECT d.quantity_kg, m.material_name, m.unit FROM recipe_details d JOIN materials m ON m.id = d.material_id
       WHERE d.recipe_id = ? AND d.material_id = ?`, [b.recipe_id, materialId]);
    if (!ing.length) throw new AppError('This material is not part of the batch recipe');
    if (ing[0].unit !== 'KG') throw new AppError(`${ing[0].material_name} is in ${ing[0].unit}; only KG materials can be batched`);

    const [dup] = await conn.query('SELECT id FROM batching_details WHERE batch_id = ? AND material_id = ?', [batchId, materialId]);
    if (dup.length) throw new AppError(`${ing[0].material_name} is already weighed for this batch`, 409);

    const [users] = await conn.query('SELECT id FROM users WHERE id IN (?) AND is_active = 1', [[doneBy, checkedBy]]);
    if (users.length !== 2) throw new AppError('Done by / Checked by must be active users');
    if (machineId) {
      const [mc] = await conn.query("SELECT id FROM machine_master WHERE id = ? AND machine_type = 'WEIGHING' AND status IN ('ACTIVE','IDLE')", [machineId]);
      if (!mc.length) throw new AppError('Selected weighing machine is not available');
    }

    // raw stock goes down here, in the same transaction as the batching row
    const st = await stock.postTxn(conn, {
      material_id: materialId, direction: 'OUT', txn_type: 'ISSUE', qty: weighed, txn_date: v.date(),
      issue_type: 'PRODUCTION', purpose: `Batch ${b.batch_no} - batching`, reference_type: 'BATCH', reference_no: b.batch_no,
      batch_id: batchId, entered_by: user.id,
    });

    let entryId;
    try {
      const [r] = await conn.query(
        `INSERT INTO batching_details (batch_id, entry_date, material_id, no_of_bags, weight_per_bag, weighed_qty, weighing_machine_id,
           stock_txn_id, done_by, checked_by, status) VALUES (?,CURDATE(),?,?,?,?,?,?,?,?,'COMPLETED')`,
        [batchId, materialId, bags, perBag, weighed, machineId, st.txn_id, doneBy, checkedBy]);
      entryId = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError(`${ing[0].material_name} is already weighed for this batch`, 409);
      throw e;
    }
    await audit({ userId: user.id, action: 'CREATE', table: 'batching_details', recordId: entryId,
      newValues: { batch_id: batchId, material_id: materialId, bags, perBag, weighed, doneBy, checkedBy, stock_txn_id: st.txn_id }, ip }, conn);

    const fresh = await loadBatch(conn, batchId);
    const plan = await buildPlan(conn, fresh);
    return { entry_id: entryId, stock: st, progress: { done: plan.done_count, pending: plan.pending_count, can_complete: plan.can_complete,
      total_weighed_kg: plan.total_weighed_kg } };
  });
}

/* ---------- end of step 7: close batching, hand the weight to the next stage ---------- */
async function completeBatching(batchIdRaw, userId, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  return withTransaction(async (conn) => {
    const b = await loadBatch(conn, batchId, true);
    assertBatchingOpen(b);
    const plan = await buildPlan(conn, b);
    if (!plan || !plan.ingredients.length) throw new AppError('This batch has no recipe ingredients');
    if (!plan.can_complete) {
      const names = plan.ingredients.filter((i) => !i.is_done).map((i) => i.material_name).join(', ');
      throw new AppError(`Weigh every ingredient first. Pending: ${names}`);
    }
    await conn.query(
      `UPDATE batch_master SET current_stage = 'ROASTING', current_output_kg = ?, batching_completed_at = NOW() WHERE id = ?`,
      [plan.total_weighed_kg, batchId]);
    await audit({ userId, action: 'UPDATE', table: 'batch_master', recordId: batchId,
      oldValues: { current_stage: 'BATCHING' }, newValues: { current_stage: 'ROASTING', current_output_kg: plan.total_weighed_kg }, ip }, conn);
    return getById(batchId, conn);
  });
}

/* ---------- hold / resume (the lock is NOT released on hold) ---------- */
async function hold(batchIdRaw, body, userId, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const reason = v.reqStr(body.reason, 'Reason', 255);
  return withTransaction(async (conn) => {
    const b = await loadBatch(conn, batchId, true);
    if (b.status !== 'IN_PROGRESS') throw new AppError(`Only a running batch can be put on hold (this one is ${b.status.toLowerCase().replace('_', ' ')})`);
    await conn.query("UPDATE batch_master SET status = 'ON_HOLD', hold_reason = ? WHERE id = ?", [reason, batchId]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'batch_master', recordId: batchId,
      oldValues: { status: 'IN_PROGRESS' }, newValues: { status: 'ON_HOLD', reason }, ip }, conn);
    return getById(batchId, conn);
  });
}

async function resume(batchIdRaw, userId, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  return withTransaction(async (conn) => {
    const b = await loadBatch(conn, batchId, true);
    if (b.status !== 'ON_HOLD') throw new AppError('This batch is not on hold');
    await conn.query("UPDATE batch_master SET status = 'IN_PROGRESS', hold_reason = NULL WHERE id = ?", [batchId]);
    await audit({ userId, action: 'STATUS_CHANGE', table: 'batch_master', recordId: batchId,
      oldValues: { status: 'ON_HOLD' }, newValues: { status: 'IN_PROGRESS' }, ip }, conn);
    return getById(batchId, conn);
  });
}

module.exports = { list, active, getById, staff, weighingMachines, start, addBatching, completeBatching, hold, resume };
