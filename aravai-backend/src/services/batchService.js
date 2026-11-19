const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const stock = require('./stockService');
const REQUIRE_WEIGHT_PHOTO = process.env.REQUIRE_WEIGHT_PHOTO === 'true'; // photo optional unless .env has REQUIRE_WEIGHT_PHOTO=true (demo: optional)
const wimg = require('./batchWeightImageService');   // weighing machine photo check
const machines = require('./machineService');
const ms = require('../utils/materialStages');       // material-level status (Filtering / Roasting) and batch stage sync

const r3 = (n) => Math.round(n * 1000) / 1000;

const BATCH_SELECT = `
  SELECT b.*, p.product_code, p.product_name, r.recipe_no, r.version_no, r.base_quantity_kg,
         r.default_filter_stages AS recipe_filter_stages, u.full_name AS created_by_name,
         lm.machine_code AS weighing_machine_code, lm.machine_name AS weighing_machine_name
  FROM batch_master b
  JOIN product_master p ON p.id = b.product_id
  LEFT JOIN recipe_master r ON r.id = b.recipe_id
  JOIN users u ON u.id = b.created_by
  LEFT JOIN machine_master lm ON lm.id = b.weighing_machine_id`;

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
  const [recipeRows] = await db.query(
    `SELECT d.material_id, m.material_code, m.material_name, m.unit, d.quantity_kg AS recipe_qty_kg, m.current_stock,
            m.default_filter_stages, bd.id AS batching_id, bd.entry_date, bd.no_of_bags, bd.weight_per_bag, bd.required_qty,
            bd.weighed_qty, bd.needs_filtering AS material_needs_filtering, bd.weighing_machine_id, wm.machine_name AS weighing_machine_name, bd.done_by, du.full_name AS done_by_name, bd.checked_by, cu.full_name AS checked_by_name, bd.stock_txn_id
     FROM recipe_details d
     JOIN materials m ON m.id = d.material_id
     LEFT JOIN batching_details bd ON bd.batch_id = ? AND bd.material_id = d.material_id
     LEFT JOIN machine_master wm ON wm.id = bd.weighing_machine_id
     LEFT JOIN users du ON du.id = bd.done_by
     LEFT JOIN users cu ON cu.id = bd.checked_by
     WHERE d.recipe_id = ? ORDER BY d.id`, [b.id, b.recipe_id]);

  // Extra materials added to the batch from the Edit option (not part of the recipe). They are always "done" (already weighed).
  const [extraRows] = await db.query(
    `SELECT bd.material_id, m.material_code, m.material_name, m.unit, 0 AS recipe_qty_kg, m.current_stock,
            m.default_filter_stages, bd.id AS batching_id, bd.entry_date, bd.no_of_bags, bd.weight_per_bag, bd.required_qty,
            bd.weighed_qty, bd.needs_filtering AS material_needs_filtering, bd.weighing_machine_id, wm.machine_name AS weighing_machine_name,
            bd.done_by, du.full_name AS done_by_name, bd.checked_by, cu.full_name AS checked_by_name
     FROM batching_details bd
     JOIN materials m ON m.id = bd.material_id
     LEFT JOIN machine_master wm ON wm.id = bd.weighing_machine_id
     LEFT JOIN users du ON du.id = bd.done_by
     LEFT JOIN users cu ON cu.id = bd.checked_by
     WHERE bd.batch_id = ? AND bd.material_id NOT IN (SELECT material_id FROM recipe_details WHERE recipe_id = ?) ORDER BY bd.id`, [b.id, b.recipe_id]);
  const rows = [...recipeRows, ...extraRows.map((x) => ({ ...x, is_extra: true }))];

  const photos = await wimg.forBatch(db, b.id); // material_id -> stored weighing machine photo
  const states = await ms.materialStateMap(db, b); // material_id -> { stage, filtered, roasted_qty ... }
  const batchOpen = b.status === 'IN_PROGRESS' && ['BATCHING', 'FILTERING', 'ROASTING'].includes(b.current_stage);
  const doneCount = rows.filter((r) => r.batching_id !== null).length;

  // bag-size breakdown (3 x 10 kg + 4 x 5 kg) of each weighed material
  const bagMap = new Map();
  const bdIds = rows.map((r) => r.batching_id).filter((x) => x !== null);
  if (bdIds.length) {
    try {
      const [bl] = await db.query('SELECT batching_detail_id, bags, weight_per_bag, qty_kg FROM batching_detail_bags WHERE batching_detail_id IN (?) ORDER BY sort_order, id', [bdIds]);
      bl.forEach((x) => { if (!bagMap.has(x.batching_detail_id)) bagMap.set(x.batching_detail_id, []); bagMap.get(x.batching_detail_id).push({ bags: x.bags, weight_per_bag: Number(x.weight_per_bag), qty_kg: Number(x.qty_kg) }); });
    } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; } // table not created yet -> no breakdown
  }

  // Recipes no longer carry quantities (base 0), so nothing is "required" - the weighed quantity is simply recorded.
  const base = Number(b.base_quantity_kg) || 0;
  const scale = base > 0 ? Number(b.planned_qty_kg) / base : null;
  const ingredients = rows.map((r) => {
    const required = scale !== null && Number(r.recipe_qty_kg) > 0 ? r3(Number(r.recipe_qty_kg) * scale) : null;
    const done = r.batching_id !== null;
    const stt = done ? states.get(r.material_id) : null;
    // a material can be edited / deleted only before it has been filtered or has started Roasting
    const changeable = done && batchOpen && (!stt || !stt.stage || ['FILTERING', 'READY_FOR_ROASTING'].includes(stt.stage));
    return {
      ...r,
      needs_filtering: done && Number(r.material_needs_filtering) === 1,
      stage: stt ? stt.stage : undefined,
      filtered: !!(stt && stt.filtered),
      filtered_qty: stt ? stt.filtered_qty : null,
      roasted_qty: stt ? stt.roasted_qty : 0,
      can_edit: changeable,
      can_delete: changeable && doneCount > 1,
      weight_image: photos.get(r.material_id) || null,
      bag_lines: bagMap.get(r.batching_id) || [],
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
    `SELECT m.id, m.machine_code, m.machine_name,
            (SELECT b.batch_no FROM batch_master b WHERE b.weighing_machine_id = m.id AND b.status NOT IN ('COMPLETED','CANCELLED') ORDER BY b.id DESC LIMIT 1) AS locked_batch_no
     FROM machine_master m WHERE m.machine_type = 'WEIGHING' AND m.status IN ('ACTIVE','IDLE') ORDER BY m.machine_code`);
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
  // Done by = the logged-in user. Checked by is optional (not asked in the New Batch form any more).
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : userId;
  const checkedBy = body.checked_by ? v.toId(body.checked_by, 'checked by') : null;
  if (checkedBy && doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  const machineId = body.weighing_machine_id ? v.toId(body.weighing_machine_id, 'weighing machine') : null;

  // "Filter" checkbox on each material row of the batching form. If any weighed material is ticked the batch goes to
  // FILTERING first, otherwise straight to ROASTING.  (Old clients send one batch-level needs_filtering flag and no
  // per-material flags -> that flag then applies to every material.)
  const isTrue = (x) => [true, 'true', 1, '1'].includes(x);
  const batchFlag = isTrue(body.needs_filtering);
  const hasPerMaterial = body.ingredients.some((i) => i && i.needs_filtering !== undefined);
  // New clients send roasting_mode (DIRECT | AFTER_FILTERING | PARALLEL). They also send every material completely filled,
  // so for them every material must have bags, weight per bag and weighed qty. Old clients keep the old (lenient) behaviour.
  const strict = body.roasting_mode !== undefined && body.roasting_mode !== null;
  const modeIn = String(body.roasting_mode || '').toUpperCase();

  const blank = (x) => x === undefined || x === null || String(x).trim() === '';
  if (strict && body.ingredients.some((i) => !i || blank(i.weighed_qty ?? i.quantity_kg) || Number(i.weighed_qty ?? i.quantity_kg) === 0))
    throw new AppError('Fill bags, weight per bag and weighed quantity for every material (or remove the material from the batch)');
  // blank / 0 weighed qty = that material is not used in this batch
  const items = body.ingredients
    .filter((i) => i && !blank(i.weighed_qty ?? i.quantity_kg) && Number(i.weighed_qty ?? i.quantity_kg) !== 0)
    .map((i) => {
      let weighed = v.positive(i.weighed_qty ?? i.quantity_kg, 'Weighed quantity (kg)', { max: 1000000 });
      // Several bag sizes for one material, e.g. 3 bags x 10 kg + 4 bags x 5 kg = 50 kg
      let lines = null;
      if (Array.isArray(i.bag_lines) && i.bag_lines.length > 1) {
        if (i.bag_lines.length > 20) throw new AppError('Too many bag sizes for one material');
        lines = i.bag_lines.map((l) => {
          const lb = Number(l && l.bags);
          if (!Number.isInteger(lb) || lb < 1 || lb > 100000) throw new AppError('No of bags must be a whole number of at least 1 in every bag size line');
          const lw = v.positive(l && l.weight, 'Weight per bag (kg)', { max: 100000 });
          return { bags: lb, perBag: lw, qty: r3(lb * lw) };
        });
        const sum = r3(lines.reduce((a, l) => a + l.qty, 0));
        if (Math.abs(sum - weighed) > 0.001) throw new AppError(`Weighed quantity (${weighed} kg) does not match the bag lines (${sum} kg)`);
        weighed = sum;
      }
      if (strict && !lines && (blank(i.no_of_bags) || blank(i.weight_per_bag))) throw new AppError('Enter number of bags and weight per bag for every material');
      const bags = lines ? lines.reduce((a, l) => a + l.bags, 0) : (blank(i.no_of_bags) ? 1 : v.intRange(i.no_of_bags, 'No of bags', 1, 100000));
      const perBag = lines ? r3(weighed / bags) : (blank(i.weight_per_bag) ? r3(weighed / bags) : v.positive(i.weight_per_bag, 'Weight per bag (kg)', { max: 100000 }));
      return { material_id: v.toId(i.material_id, 'material'), bags, perBag, lines, quantity_kg: weighed, filter: hasPerMaterial ? isTrue(i.needs_filtering) : batchFlag,
        image_id: i.weight_image_id ? v.toId(i.weight_image_id, 'weight photo') : null };
    });
  if (!items.length) throw new AppError('Enter the quantity for at least one material');
  if (new Set(items.map((i) => i.material_id)).size !== items.length) throw new AppError('A material is added twice');
  const total = r3(items.reduce((a, i) => a + i.quantity_kg, 0));
  const needsFiltering = items.some((i) => i.filter);
  // How the batch continues:
  //  DIRECT          nothing ticked -> Roasting
  //  AFTER_FILTERING everything ticked, or the operator chose to wait -> Filtering first, Roasting after it (old behaviour)
  //  PARALLEL        some ticked, some not, operator chose to start Roasting now -> unfiltered materials roast while the others are filtered
  const nFilter = items.filter((i) => i.filter).length;
  const mixed = nFilter > 0 && nFilter < items.length;
  // New clients send process_mode:
  //  SEQUENTIAL    each filtered material: Filtering -> "Proceed to Roasting?" -> Roasting (unfiltered materials roast straight away)
  //  SIMULTANEOUS  Filtering and Roasting of a material run independently, Grinding after both are done
  const pmIn = String(body.process_mode || '').toUpperCase();
  const processMode = pmIn === 'SIMULTANEOUS' ? 'SIMULTANEOUS' : 'SEQUENTIAL';
  let roastingMode = 'DIRECT';
  if (needsFiltering) {
    if (['SEQUENTIAL', 'SIMULTANEOUS'].includes(pmIn)) roastingMode = pmIn === 'SIMULTANEOUS' ? 'PARALLEL' : 'AFTER_FILTERING';
    else if (!mixed) roastingMode = 'AFTER_FILTERING';
    else if (modeIn === 'PARALLEL' || modeIn === 'AFTER_FILTERING') roastingMode = modeIn;
    else if (strict) throw new AppError('Choose the processing condition: Sequential or Simultaneous');
    else roastingMode = 'AFTER_FILTERING';
  }
  // the stage the batch waits at (the Filtering / Roasting cards decide what each material can do)
  const nextStage = roastingMode === 'AFTER_FILTERING' ? 'FILTERING' : 'ROASTING';

  return withTransaction(async (conn) => {
    const [prod] = await conn.query('SELECT id, is_active FROM product_master WHERE id = ?', [productId]);
    if (!prod.length) throw new AppError('Product not found', 404);
    if (!prod[0].is_active) throw new AppError('Product is inactive');
    const [rec] = await conn.query('SELECT id, product_id, is_active FROM recipe_master WHERE id = ?', [recipeId]);
    if (!rec.length) throw new AppError('Recipe not found', 404);
    if (rec[0].product_id !== productId) throw new AppError('This recipe does not belong to the selected product');
    if (!rec[0].is_active) throw new AppError('This recipe was updated by someone else. Close New Batch, open it again and select the product to use the latest recipe.', 409);

    const userIds = [doneBy, checkedBy].filter(Boolean);
    const [users] = await conn.query('SELECT id FROM users WHERE id IN (?) AND is_active = 1', [userIds]);
    if (users.length !== userIds.length) throw new AppError('Done by / Checked by must be active users');

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

    // (No cross-batch machine lock any more: the same weighing machine can be chosen for any number of batches.)
    // Weighing machine photo of every weighed material: OCR MATCH (or supervisor's manual verification), same material + same weight.
    for (const i of items) {
      const name = byId.get(i.material_id).material_name;
      if (REQUIRE_WEIGHT_PHOTO && !i.image_id) throw new AppError(`${name}: take or upload a photo of the weighing machine display and verify the weight`);
      if (i.image_id) {
        try { await wimg.claim(conn, { imageId: i.image_id, batchId: null, materialId: i.material_id, weighedQty: i.quantity_kg, userId, machineId, allowDraft: true }); }
        catch (e) { if (e instanceof AppError) e.message = `${name}: ${e.message}`; throw e; }
      }
    }

    const batchNo = await nextNumber(conn, 'BATCH');
    // Batching is finished -> the batch is IN_PROGRESS at the next process (ROASTING), not COMPLETED.
    const [r] = await conn.query(
      `INSERT INTO batch_master (batch_no, production_date, product_id, recipe_id, planned_qty_kg, current_stage, needs_filtering, roasting_mode, process_mode, status, current_output_kg,
         created_by, batching_completed_at, active_lock, weighing_machine_id, machine_locked_at)
       VALUES (?,?,?,?,?,?,?,?,?,'IN_PROGRESS',?,?,NOW(),NULL,?,IF(? IS NULL, NULL, NOW()))`,
      [batchNo, date, productId, recipeId, total, nextStage, needsFiltering ? 1 : 0, roastingMode, processMode, total, userId, machineId, machineId]);
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
      const [bd] = await conn.query(
        `INSERT INTO batching_details (batch_id, entry_date, material_id, no_of_bags, weight_per_bag, weighed_qty, weighing_machine_id, stock_txn_id, done_by, checked_by, needs_filtering, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMPLETED')`, [id, date, i.material_id, i.bags, i.perBag, i.quantity_kg, machineId, st.txn_id, doneBy, checkedBy, i.filter ? 1 : 0]);
      if (i.lines) {
        await conn.query('INSERT INTO batching_detail_bags (batching_detail_id, bags, weight_per_bag, qty_kg, sort_order) VALUES ?',
          [i.lines.map((l, n) => [bd.insertId, l.bags, l.perBag, l.qty, n])]);
      }
      if (i.image_id) await wimg.link(conn, i.image_id, bd.insertId, id); // photo is now stored against this batch + material
    }

    const created = await getById(id, conn);
    await audit({ userId, action: 'CREATE', table: 'batch_master', recordId: id,
      newValues: { batch_no: batchNo, product_id: productId, recipe_id: recipeId, total_kg: total, stage: nextStage, roasting_mode: roastingMode, process_mode: processMode, needs_filtering: needsFiltering, materials: items, doneBy, checkedBy }, ip }, conn);
    return { ...created, low_stock_alerts: alerts };
  });
}

// Scan check for the batching screen: the machine behind a scanned QR, checked against the selected / batch-locked machine.
// (The operator's role does not need the Machines module permission for this.)
const verifyMachine = (body) => wimg.verifyMachine(body || {});

// Machine of the first weighing of a batch (older batches never got batch_master.weighing_machine_id).
async function firstMachineOfBatch(conn, batchId) {
  const [r] = await conn.query('SELECT weighing_machine_id FROM batching_details WHERE batch_id = ? AND weighing_machine_id IS NOT NULL ORDER BY id LIMIT 1', [batchId]);
  return r.length ? r[0].weighing_machine_id : null;
}

/* ---------- step 7: weigh one material into the batch ---------- */
async function addBatching(batchIdRaw, body, user, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(body.material_id, 'material');
  const bags = v.intRange(body.no_of_bags, 'No of bags', 1, 100000);
  if (bags === undefined) throw new AppError('No of bags is required');
  const perBag = v.positive(body.weight_per_bag, 'Weight per bag (kg)', { max: 100000 });
  // Weighed quantity may be left blank when a weight photo is sent: the NET weight verified on that photo is then saved (see wimg.claim)
  const qtyBlank = body.weighed_qty === undefined || body.weighed_qty === null || String(body.weighed_qty).trim() === '';
  const autoQty = qtyBlank && !!body.weight_image_id;
  let weighed = autoQty ? null : v.positive(body.weighed_qty, 'Weighed quantity (kg)', { max: 1000000 });
  const doneBy = body.done_by ? v.toId(body.done_by, 'done by') : user.id;
  if (!body.checked_by) throw new AppError('Checked by is required');
  const checkedBy = v.toId(body.checked_by, 'checked by');
  if (doneBy === checkedBy) throw new AppError('Checked by must be a different person from Done by');
  let machineId = body.weighing_machine_id ? v.toId(body.weighing_machine_id, 'weighing machine') : null;

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

    // Batch-wise machine lock: once a batch has a weighing machine, every material must be weighed on it (its QR is scanned),
    // and the photo of that machine's display must have passed the OCR check (MATCH) or a supervisor's manual verification.
    const lockedId = b.weighing_machine_id || (await firstMachineOfBatch(conn, batchId));
    if (lockedId) {
      if (!body.qr_value) throw new AppError('Scan the QR code of the batch weighing machine first');
      const scanned = await machines.getByToken(body.qr_value); // 404 for an unknown code
      if (String(scanned.id) !== String(lockedId)) throw new AppError(`Wrong machine (${scanned.machine_code}). This batch is locked to another weighing machine. Scan that machine to continue`, 403);
      machineId = lockedId;
    }
    const imageId = body.weight_image_id ? v.toId(body.weight_image_id, 'weight photo') : null;
    if (REQUIRE_WEIGHT_PHOTO && lockedId && !imageId) throw new AppError('Take or upload a photo of the weighing machine display and verify the weight first');
    if (imageId) {
      // MATCH / MANUAL only, same batch + material + weight + machine, unused
      const w = await wimg.claim(conn, { imageId, batchId, materialId, weighedQty: weighed, machineId: machineId || null });
      if (weighed === null) {                                   // auto-save: net weight of the verified photo
        weighed = Number(w.entered_weight);
        if (!(weighed > 0)) throw new AppError('No weight was read from this photo. Enter the weighed quantity');
      }
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
    if (imageId) await wimg.link(conn, imageId, entryId); // photo is now stored against this batch + material
    if (machineId && !b.weighing_machine_id) {            // first weighing locks the machine to the batch
      await conn.query('UPDATE batch_master SET weighing_machine_id = ?, machine_locked_at = NOW() WHERE id = ? AND weighing_machine_id IS NULL', [machineId, batchId]);
    }
    await audit({ userId: user.id, action: 'CREATE', table: 'batching_details', recordId: entryId,
      newValues: { batch_id: batchId, material_id: materialId, bags, perBag, weighed, doneBy, checkedBy, stock_txn_id: st.txn_id, weighing_machine_id: machineId, weight_image_id: imageId }, ip }, conn);

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
    const nextStage = Number(b.needs_filtering) === 1 ? 'FILTERING' : 'ROASTING';
    await conn.query(
      `UPDATE batch_master SET current_stage = ?, current_output_kg = ?, batching_completed_at = NOW() WHERE id = ?`,
      [nextStage, plan.total_weighed_kg, batchId]);
    await audit({ userId, action: 'UPDATE', table: 'batch_master', recordId: batchId,
      oldValues: { current_stage: 'BATCHING' }, newValues: { current_stage: nextStage, current_output_kg: plan.total_weighed_kg }, ip }, conn);
    return getById(batchId, conn);
  });
}

/* ---------- Edit batch: add an extra material that is not in the recipe ---------- */
// Allowed while the batch is running and nothing has consumed its weight yet: Batching, or Roasting before the first roasting entry.
// (Filtering is allowed too: Filtering only works on the materials that are ticked, the extra material is not ticked.)
// Stock of the material goes down, planned qty and the weight the batch holds go up by the weighed qty.
async function addExtraMaterial(batchIdRaw, body, user, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(body.material_id, 'material');
  const blank = (x) => x === undefined || x === null || String(x).trim() === '';
  const weighed = v.positive(body.weighed_qty, 'Weighed quantity (kg)', { max: 1000000 });
  const bags = blank(body.no_of_bags) ? 1 : v.intRange(body.no_of_bags, 'No of bags', 1, 100000);
  const perBag = blank(body.weight_per_bag) ? r3(weighed / bags) : v.positive(body.weight_per_bag, 'Weight per bag (kg)', { max: 100000 });

  return withTransaction(async (conn) => {
    const b = await loadBatch(conn, batchId, true);
    if (b.status !== 'IN_PROGRESS') throw new AppError(`Batch ${b.batch_no} is ${b.status.toLowerCase().replace('_', ' ')}. Materials can be added to a running batch only`);
    if (!['BATCHING', 'FILTERING', 'ROASTING'].includes(b.current_stage)) throw new AppError(`Batch ${b.batch_no} is at ${b.current_stage}. Materials can no longer be added`);
    // (an extra material is never ticked for Filtering, so it is simply part of the batch weight; with PARALLEL roasting it can still be added)
    if (b.current_stage === 'ROASTING' && b.roasting_mode !== 'PARALLEL') {
      const [started] = await conn.query('SELECT id FROM roasting_details WHERE batch_id = ? LIMIT 1', [batchId]);
      if (started.length) throw new AppError('Roasting has already started for this batch. Materials can no longer be added');
    }

    const [m] = await conn.query('SELECT id, material_name, unit, is_active FROM materials WHERE id = ?', [materialId]);
    if (!m.length) throw new AppError('Material not found', 404);
    if (!m[0].is_active) throw new AppError(`${m[0].material_name} is inactive`);
    if (m[0].unit !== 'KG') throw new AppError(`${m[0].material_name} is in ${m[0].unit}; only KG materials can be batched`);
    const [dup] = await conn.query('SELECT id FROM batching_details WHERE batch_id = ? AND material_id = ?', [batchId, materialId]);
    if (dup.length) throw new AppError(`${m[0].material_name} is already in this batch`, 409);

    // raw stock goes down here, in the same transaction (short stock is rejected by stock.postTxn)
    const st = await stock.postTxn(conn, {
      material_id: materialId, direction: 'OUT', txn_type: 'ISSUE', qty: weighed, txn_date: v.date(),
      issue_type: 'PRODUCTION', purpose: `Batch ${b.batch_no} - extra material`, reference_type: 'BATCH', reference_no: b.batch_no,
      batch_id: batchId, entered_by: user.id,
    });
    const [r] = await conn.query(
      `INSERT INTO batching_details (batch_id, entry_date, material_id, no_of_bags, weight_per_bag, weighed_qty, weighing_machine_id, stock_txn_id, done_by, checked_by, needs_filtering, status)
       VALUES (?,CURDATE(),?,?,?,?,?,?,?,NULL,0,'COMPLETED')`, [batchId, materialId, bags, perBag, weighed, b.weighing_machine_id || null, st.txn_id, user.id]);

    // the batch now holds more weight (Roasting reads current_output_kg as "what the batch holds")
    await conn.query(
      `UPDATE batch_master SET planned_qty_kg = planned_qty_kg + ?, current_output_kg = IF(current_stage = 'BATCHING', current_output_kg, current_output_kg + ?) WHERE id = ?`,
      [weighed, weighed, batchId]);
    await audit({ userId: user.id, action: 'CREATE', table: 'batching_details', recordId: r.insertId,
      newValues: { batch_id: batchId, material_id: materialId, extra_material: true, bags, perBag, weighed, stock_txn_id: st.txn_id }, ip }, conn);
    const updated = await getById(batchId, conn);
    return { ...updated, low_stock_alerts: st.low_stock_alert ? [st.low_stock_alert] : [] };
  });
}

/* ---------- Edit / Delete one material of a batch ---------- */
// Allowed while the batch is running and that material has NOT been filtered or started Roasting yet.
// Stock is corrected in the same transaction, the batch weight follows, and the batch stage is re-worked out from its materials.
const isTrue = (x) => [true, 'true', 1, '1'].includes(x);

async function lockMaterialRow(conn, batchId, materialId) {
  const b = await loadBatch(conn, batchId, true);
  if (b.status === 'ON_HOLD') throw new AppError(`Batch ${b.batch_no} is on hold${b.hold_reason ? ` (${b.hold_reason})` : ''}. Resume it first`);
  if (b.status !== 'IN_PROGRESS') throw new AppError(`Batch ${b.batch_no} is ${b.status.toLowerCase().replace('_', ' ')}. Materials can be changed in a running batch only`);
  if (!['BATCHING', 'FILTERING', 'ROASTING'].includes(b.current_stage)) throw new AppError(`Batch ${b.batch_no} is at ${b.current_stage}. Materials can no longer be changed`);
  const [rows] = await conn.query(
    `SELECT bd.*, m.material_name FROM batching_details bd JOIN materials m ON m.id = bd.material_id
      WHERE bd.batch_id = ? AND bd.material_id = ? ORDER BY bd.id FOR UPDATE`, [batchId, materialId]);
  if (!rows.length) throw new AppError('This material is not weighed in this batch', 404);
  const st = (await ms.materialStateMap(conn, b)).get(materialId);
  if (st && st.stage && !['FILTERING', 'READY_FOR_ROASTING'].includes(st.stage)) {
    const why = { FILTERED: 'already filtered', ROASTING: 'being roasted', ROASTED: 'already roasted' }[st.stage] || 'in production';
    throw new AppError(`${rows[0].material_name} is ${why}. It can no longer be changed`, 409);
  }
  return { b, bd: rows[0] };
}

async function updateMaterial(batchIdRaw, materialIdRaw, body, user, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(materialIdRaw, 'material');
  const qtyGiven = body.weighed_qty !== undefined || body.no_of_bags !== undefined || body.weight_per_bag !== undefined;
  const flagGiven = body.needs_filtering !== undefined;
  if (!qtyGiven && !flagGiven) throw new AppError('Nothing to change');
  let weighed = null; let bags = null; let perBag = null;
  if (qtyGiven) {
    bags = v.intRange(body.no_of_bags, 'No of bags', 1, 100000);
    if (bags === undefined) throw new AppError('No of bags is required');
    perBag = v.positive(body.weight_per_bag, 'Weight per bag (kg)', { max: 100000 });
    weighed = v.positive(body.weighed_qty, 'Weighed quantity (kg)', { max: 1000000 });
  }
  const flag = flagGiven ? isTrue(body.needs_filtering) : null;
  const imageId = body.weight_image_id ? v.toId(body.weight_image_id, 'weight photo') : null;

  return withTransaction(async (conn) => {
    const { b, bd } = await lockMaterialRow(conn, batchId, materialId);
    const old = Number(bd.weighed_qty);
    const alerts = [];
    let delta = 0;

    if (qtyGiven) {
      let lineCount = 0;
      try { [[{ n: lineCount }]] = await conn.query('SELECT COUNT(*) AS n FROM batching_detail_bags WHERE batching_detail_id = ?', [bd.id]); }
      catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
      if (Number(lineCount) > 1) throw new AppError(`${bd.material_name} was weighed in more than one bag size. Delete it and add it again to change the quantity`);
      delta = r3(weighed - old);
      if (Math.abs(delta) > 0.0005) {
        // the photo of the machine display showed the OLD quantity: it is released, and a new verified photo is needed when photos are compulsory
        if (!imageId && REQUIRE_WEIGHT_PHOTO) throw new AppError('The quantity changed: take or upload a photo of the weighing machine display and verify the new weight');
        const st = await stock.postTxn(conn, {
          material_id: materialId, direction: delta > 0 ? 'OUT' : 'IN', txn_type: delta > 0 ? 'ISSUE' : 'ADJUSTMENT_IN', qty: Math.abs(delta), txn_date: v.date(),
          issue_type: delta > 0 ? 'PRODUCTION' : null, purpose: `Batch ${b.batch_no} - ${bd.material_name} quantity corrected (${old} kg to ${weighed} kg)`,
          reference_type: 'BATCH', reference_no: b.batch_no, batch_id: batchId, entered_by: user.id,
        });
        if (st.low_stock_alert) alerts.push(st.low_stock_alert);
        await conn.query('UPDATE batch_weight_images SET batching_detail_id = NULL WHERE batching_detail_id = ?', [bd.id]);
        if (imageId) {
          await wimg.claim(conn, { imageId, batchId, materialId, weighedQty: weighed, userId: user.id, machineId: bd.weighing_machine_id || null });
          await wimg.link(conn, imageId, bd.id, batchId);
        }
        await conn.query('UPDATE batch_master SET planned_qty_kg = planned_qty_kg + ?, current_output_kg = IF(current_stage = \'BATCHING\', current_output_kg, current_output_kg + ?) WHERE id = ?', [delta, delta, batchId]);
      }
    }

    if (flagGiven && flag !== (Number(bd.needs_filtering) === 1)) {
      if (flag && (await ms.filteringInfo(conn, batchId)).done) throw new AppError('Filtering is already completed for this batch. This material cannot be added to it now');
    }

    const sets = []; const args = [];
    if (qtyGiven) { sets.push('no_of_bags = ?', 'weight_per_bag = ?', 'weighed_qty = ?'); args.push(bags, perBag, weighed); }
    if (flagGiven) { sets.push('needs_filtering = ?'); args.push(flag ? 1 : 0); }
    await conn.query(`UPDATE batching_details SET ${sets.join(', ')} WHERE id = ?`, [...args, bd.id]);

    const moved = await ms.syncBatchStage(conn, batchId); // the batch stage follows its materials
    await audit({ userId: user.id, action: 'UPDATE', table: 'batching_details', recordId: bd.id,
      oldValues: { weighed_qty: old, no_of_bags: bd.no_of_bags, weight_per_bag: bd.weight_per_bag, needs_filtering: bd.needs_filtering },
      newValues: { weighed_qty: qtyGiven ? weighed : old, no_of_bags: qtyGiven ? bags : bd.no_of_bags, weight_per_bag: qtyGiven ? perBag : bd.weight_per_bag, needs_filtering: flagGiven ? (flag ? 1 : 0) : bd.needs_filtering, stage: moved && moved.stage, roasting_mode: moved && moved.mode }, ip }, conn);
    return { ...(await getById(batchId, conn)), low_stock_alerts: alerts };
  });
}

async function removeMaterial(batchIdRaw, materialIdRaw, user, ip) {
  const batchId = v.toId(batchIdRaw, 'batch id');
  const materialId = v.toId(materialIdRaw, 'material');
  return withTransaction(async (conn) => {
    const { b, bd } = await lockMaterialRow(conn, batchId, materialId);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM batching_details WHERE batch_id = ?', [batchId]);
    if (Number(n) <= 1) throw new AppError('A batch needs at least one material. This is the only material of the batch');
    const qty = Number(bd.weighed_qty);

    // the weighed quantity goes back to stock (one ledger line, so the Material Stock Card still balances)
    await stock.postTxn(conn, {
      material_id: materialId, direction: 'IN', txn_type: 'ADJUSTMENT_IN', qty, txn_date: v.date(),
      purpose: `Batch ${b.batch_no} - ${bd.material_name} removed from the batch`, reference_type: 'BATCH', reference_no: b.batch_no,
      batch_id: batchId, entered_by: user.id,
    });
    try { await conn.query('DELETE FROM batching_detail_bags WHERE batching_detail_id = ?', [bd.id]); }
    catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
    await conn.query('UPDATE batch_weight_images SET batching_detail_id = NULL WHERE batching_detail_id = ?', [bd.id]); // photo stays on record, it is just released
    await conn.query('DELETE FROM batching_details WHERE id = ?', [bd.id]);
    await conn.query(
      `UPDATE batch_master SET planned_qty_kg = GREATEST(planned_qty_kg - ?, 0),
         current_output_kg = IF(current_stage = 'BATCHING', current_output_kg, GREATEST(current_output_kg - ?, 0)) WHERE id = ?`, [qty, qty, batchId]);

    const moved = await ms.syncBatchStage(conn, batchId);
    await audit({ userId: user.id, action: 'DELETE', table: 'batching_details', recordId: bd.id,
      oldValues: { batch_id: batchId, material_id: materialId, weighed_qty: qty, needs_filtering: bd.needs_filtering },
      newValues: { stage: moved && moved.stage, roasting_mode: moved && moved.mode }, ip }, conn);
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

module.exports = { list, active, getById, staff, weighingMachines, verifyMachine, start, addBatching, addExtraMaterial, updateMaterial, removeMaterial, completeBatching, hold, resume };