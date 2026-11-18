const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { newToken, extractToken, qrUrl } = require('../utils/qrToken');

// LEGACY: machine types now live in the machine_types table (see the MACHINE TYPES section below).
// Kept only so other modules that still import TYPES do not break. Do not use it for validation.
const TYPES = ['ROASTING', 'GRINDING', 'BLENDING', 'PACKING', 'WEIGHING'];

const STATUSES = [
  'ACTIVE',
  'IDLE',
  'UNDER_MAINTENANCE',
  'BREAKDOWN',
  'INACTIVE'
];

const SELECT = `
  SELECT m.*, u.full_name AS operator_name,
         COALESCE(t.name, m.machine_type) AS machine_type_name
  FROM machine_master m
  LEFT JOIN users u ON u.id = m.operator_id
  LEFT JOIN machine_types t ON t.code = m.machine_type
`;

const fmtDate = (d) =>
  (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const shape = (m) => ({
  ...m,
  installation_date: fmtDate(m.installation_date),
  last_maintenance_date: fmtDate(m.last_maintenance_date),
  next_maintenance_date: fmtDate(m.next_maintenance_date),
  calibration_due_date: fmtDate(m.calibration_due_date)
});

// Optional date: blank -> null
const optDate = (x, label) =>
  (v.clean(x) ? v.date(x, label, { allowFuture: true }) : null);


// --------------------------------------------------
// GET MACHINE BY ID
// --------------------------------------------------

async function getById(idRaw, db = pool) {
  const id = v.toId(idRaw, 'machine id');

  const [rows] = await db.query(
    `${SELECT} WHERE m.id = ?`,
    [id]
  );

  if (!rows.length) {
    throw new AppError('Machine not found', 404);
  }

  return shape(rows[0]);
}


// --------------------------------------------------
// LIST MACHINES
// --------------------------------------------------

async function list(q) {
  const { page, limit, offset } = v.paging(q);

  const where = [];
  const args = [];

  if (q.machine_type) {
    const t = String(q.machine_type).trim().toUpperCase();

    where.push('m.machine_type = ?');
    args.push(t);
  }

  if (q.status) {
    const s = String(q.status).toUpperCase();

    if (!STATUSES.includes(s)) {
      throw new AppError('Invalid status');
    }

    where.push('m.status = ?');
    args.push(s);
  }

  const search = v.clean(q.search);

  if (search) {
    where.push(
      '(m.machine_code LIKE ? OR m.machine_name LIKE ? OR m.manufacturer LIKE ?)'
    );

    args.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`
    );
  }

  const w = where.length
    ? `WHERE ${where.join(' AND ')}`
    : '';

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM machine_master m ${w}`,
    args
  );

  const [rows] = await pool.query(
    `${SELECT} ${w}
     ORDER BY m.machine_type, m.machine_code
     LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  return {
    items: rows.map(shape),
    page,
    limit,
    total,
    total_pages: Math.max(Math.ceil(total / limit), 1)
  };
}


// --------------------------------------------------
// VALIDATE MACHINE DATA
// --------------------------------------------------

async function parse(body, db) {
  const type = String(body.machine_type || '').toUpperCase();

  if (!type) {
    throw new AppError('Select the machine type');
  }

  // Type must exist and not be deleted. LOCK IN SHARE MODE stops a type being deleted
  // (and its machines counted) while this machine is being saved.
  const [typeRows] = await db.query(
    'SELECT id FROM machine_types WHERE code = ? AND deleted_at IS NULL LOCK IN SHARE MODE',
    [type]
  );

  if (!typeRows.length) {
    throw new AppError('Select a valid machine type');
  }

  const status = String(body.status || 'ACTIVE').toUpperCase();

  if (!STATUSES.includes(status)) {
    throw new AppError('Invalid status');
  }

  const operatorId = v.clean(body.operator_id)
    ? v.toId(body.operator_id, 'operator')
    : null;

  if (operatorId) {
    const [u] = await db.query(
      'SELECT id FROM users WHERE id = ? AND is_active = 1',
      [operatorId]
    );

    if (!u.length) {
      throw new AppError('Operator must be an active user');
    }
  }

  const capacity = v.clean(body.capacity)
    ? v.num(body.capacity, 'Capacity', {
        max: 100000000,
        decimals: 2
      })
    : null;

  const intervalDays = v.clean(body.maintenance_interval_days)
    ? v.intRange(body.maintenance_interval_days, 'Maintenance interval (days)', 1, 3650)
    : null;

  const lastMaint = optDate(body.last_maintenance_date, 'Last maintenance date');
  let nextMaint = optDate(body.next_maintenance_date, 'Next maintenance date');
  // Next maintenance left blank -> last maintenance + interval
  if (!nextMaint && lastMaint && intervalDays) {
    const x = new Date(`${lastMaint}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + intervalDays);
    nextMaint = x.toISOString().slice(0, 10);
  }

  return {
    machine_name: v.reqStr(body.machine_name, 'Machine name', 100),
    machine_type: type,
    manufacturer: v.optStr(body.manufacturer, 'Manufacturer', 100),
    capacity,
    capacity_unit:
      v.optStr(body.capacity_unit, 'Capacity unit', 20) || 'KG/HR',
    status,
    installation_date: optDate(body.installation_date, 'Installation date'),
    last_maintenance_date: lastMaint,
    next_maintenance_date: nextMaint,
    operator_id: operatorId,
    location: v.optStr(body.location, 'Location', 100),
    model_no: v.optStr(body.model_no, 'Model no', 50),
    serial_no: v.optStr(body.serial_no, 'Serial no', 50),
    calibration_due_date: optDate(body.calibration_due_date, 'Calibration due date'),
    maintenance_interval_days: intervalDays,
    remarks: v.optStr(body.remarks, 'Remarks', 255)
  };
}


// --------------------------------------------------
// CREATE MACHINE
// QR TOKEN IS GENERATED DURING MACHINE CREATION
// --------------------------------------------------

async function create(body, userId, ip) {
  return withTransaction(async (conn) => {
    const d = await parse(body, conn);

    const code = await nextNumber(conn, 'MACHINE');

    let r;
    let token;

    for (let attempt = 0; ; attempt++) {
      token = newToken();

      try {
        [r] = await conn.query(
          `INSERT INTO machine_master (
            machine_code,
            machine_name,
            machine_type,
            manufacturer,
            capacity,
            capacity_unit,
            status,
            installation_date,
            last_maintenance_date,
            next_maintenance_date,
            operator_id,
            location,
            model_no,
            serial_no,
            calibration_due_date,
            maintenance_interval_days,
            remarks,
            qr_token
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            code,
            d.machine_name,
            d.machine_type,
            d.manufacturer,
            d.capacity,
            d.capacity_unit,
            d.status,
            d.installation_date,
            d.last_maintenance_date,
            d.next_maintenance_date,
            d.operator_id,
            d.location,
            d.model_no,
            d.serial_no,
            d.calibration_due_date,
            d.maintenance_interval_days,
            d.remarks,
            token
          ]
        );

        break;

      } catch (e) {
        if (
          e.code === 'ER_DUP_ENTRY' &&
          /qr/i.test(e.sqlMessage || '') &&
          attempt < 4
        ) {
          continue;
        }

        throw e;
      }
    }

    await audit({
      userId,
      action: 'CREATE',
      table: 'machine_master',
      recordId: r.insertId,
      newValues: {
        machine_code: code,
        qr_token: token,
        ...d
      },
      ip
    }, conn);

    return getById(r.insertId, conn);
  });
}


// --------------------------------------------------
// UPDATE MACHINE
// QR TOKEN IS NEVER CHANGED DURING UPDATE
// --------------------------------------------------

async function update(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'machine id');

  return withTransaction(async (conn) => {
    const old = await getById(id, conn);
    const d = await parse(body, conn);

    await conn.query(
      `UPDATE machine_master SET
        machine_name = ?,
        machine_type = ?,
        manufacturer = ?,
        capacity = ?,
        capacity_unit = ?,
        status = ?,
        installation_date = ?,
        last_maintenance_date = ?,
        next_maintenance_date = ?,
        operator_id = ?,
        location = ?,
        model_no = ?,
        serial_no = ?,
        calibration_due_date = ?,
        maintenance_interval_days = ?,
        remarks = ?
       WHERE id = ?`,
      [
        d.machine_name,
        d.machine_type,
        d.manufacturer,
        d.capacity,
        d.capacity_unit,
        d.status,
        d.installation_date,
        d.last_maintenance_date,
        d.next_maintenance_date,
        d.operator_id,
        d.location,
        d.model_no,
        d.serial_no,
        d.calibration_due_date,
        d.maintenance_interval_days,
        d.remarks,
        id
      ]
    );

    await audit({
      userId,
      action: 'UPDATE',
      table: 'machine_master',
      recordId: id,
      oldValues: old,
      newValues: d,
      ip
    }, conn);

    return getById(id, conn);
  });
}


// --------------------------------------------------
// DELETE MACHINE
// --------------------------------------------------

async function remove(idRaw, userId, ip) {
  const id = v.toId(idRaw, 'machine id');

  const old = await getById(id);

  try {
    await pool.query(
      'DELETE FROM machine_master WHERE id = ?',
      [id]
    );

  } catch (e) {
    if (e.code === 'ER_ROW_IS_REFERENCED_2') {
      throw new AppError(
        `${old.machine_name} is used in production records. Mark it INACTIVE instead of deleting`,
        409
      );
    }

    throw e;
  }

  await audit({
    userId,
    action: 'DELETE',
    table: 'machine_master',
    recordId: id,
    oldValues: old,
    ip
  });

  return { id };
}


// ==================================================
// QR TOKEN MANAGEMENT
// ==================================================


// --------------------------------------------------
// ENSURE PERMANENT QR TOKEN
// Existing token will never be overwritten
// --------------------------------------------------

async function ensureToken(idRaw, db = pool) {
  const id = v.toId(idRaw, 'machine id');

  for (let attempt = 0; attempt < 5; attempt++) {
    const [rows] = await db.query(
      'SELECT qr_token FROM machine_master WHERE id = ?',
      [id]
    );

    if (!rows.length) {
      throw new AppError('Machine not found', 404);
    }

    if (rows[0].qr_token) {
      return rows[0].qr_token;
    }

    try {
      await db.query(
        `UPDATE machine_master
         SET qr_token = ?
         WHERE id = ?
         AND (qr_token IS NULL OR qr_token = '')`,
        [newToken(), id]
      );

    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') {
        throw e;
      }
    }
  }

  throw new AppError(
    'Could not assign a QR token to this machine',
    500
  );
}


// --------------------------------------------------
// BACKFILL MISSING QR TOKENS
// For old machines without QR tokens
// --------------------------------------------------

async function backfillMissingTokens(db = pool) {
  const [rows] = await db.query(
    `SELECT id FROM machine_master
     WHERE qr_token IS NULL OR qr_token = ''`
  );

  for (const r of rows) {
    await ensureToken(r.id, db);
  }

  return rows.length;
}


// --------------------------------------------------
// GET QR INFORMATION BY MACHINE ID
// Example: GET /machines/2/qr
// --------------------------------------------------

async function qrInfo(idRaw) {
  const m = await getById(idRaw);

  const token = await ensureToken(m.id);

  return {
    id: m.id,
    machine_code: m.machine_code,
    machine_name: m.machine_name,
    machine_type: m.machine_type,
    qr_token: token,
    qr_url: qrUrl(token)
  };
}


// --------------------------------------------------
// GET MACHINE BY SCANNED QR CODE
// Supports:
// 1. Machine code (MCH002)
// 2. QR token
// 3. /machine/TOKEN URL
// 4. /m/CODE URL
// --------------------------------------------------

async function getByToken(input) {
  let text = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (!text) {
    throw new AppError('Machine QR code is required', 400);
  }

  // Extract machine code or token from URL
  const link = /\/(?:m|machine)\/([A-Za-z0-9_-]{3,64})\/?(?:[?#].*)?$/.exec(text);

  if (link) {
    text = link[1];
  }

  // First check machine code
  if (/^[A-Za-z0-9_-]{3,30}$/.test(text)) {
    const [byCode] = await pool.query(
      `${SELECT} WHERE m.machine_code = ?`,
      [text]
    );

    if (byCode.length) {
      return shape(byCode[0]);
    }
  }

  // Then check QR token
  const token = extractToken(text);

  if (!token) {
    throw new AppError(
      'Invalid machine QR code. No machine uses this code',
      404
    );
  }

  const [rows] = await pool.query(
    `${SELECT} WHERE m.qr_token = ?`,
    [token]
  );

  if (!rows.length) {
    throw new AppError(
      'Invalid machine QR code. No machine uses this code',
      404
    );
  }

  return shape(rows[0]);
}


// --------------------------------------------------
// CHANGE STATUS ONLY (used by the status badge on the machine card)
// Updates just the status column, so nothing else on the machine can be touched or blanked.
// --------------------------------------------------

async function setStatus(idRaw, body, userId, ip) {
  const id = v.toId(idRaw, 'machine id');
  const status = String((body && body.status) || '').toUpperCase();

  if (!STATUSES.includes(status)) {
    throw new AppError('Invalid status');
  }

  return withTransaction(async (conn) => {
    const old = await getById(id, conn);

    if (old.status === status) {
      return old;
    }

    await conn.query('UPDATE machine_master SET status = ? WHERE id = ?', [status, id]);

    await audit({
      userId,
      action: 'UPDATE',
      table: 'machine_master',
      recordId: id,
      oldValues: { status: old.status },
      newValues: { status },
      ip
    }, conn);

    return getById(id, conn);
  });
}


// ==================================================
// MACHINE TYPES (master data + audit history)
// ==================================================
// --------------------------------------------------
// Machine type master (soft delete) + independent audit log (machine_type_audit).
// machine_master.machine_type stores the type CODE. The code never changes, so renaming a type
// only changes how it is displayed and never breaks existing machines.
// --------------------------------------------------

const TYPE_SELECT = `
  SELECT t.id, t.code, t.name, t.created_at, t.updated_at, t.deleted_at,
         cu.full_name AS created_by_name,
         uu.full_name AS updated_by_name,
         (SELECT COUNT(*) FROM machine_master m WHERE m.machine_type = t.code) AS machine_count
  FROM machine_types t
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users uu ON uu.id = t.updated_by
`;

const parseJson = (x) => {
  if (x == null) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch (e) { return null; }
};

const codeFrom = (name) =>
  String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

async function typeGetById(idRaw, db = pool, lock = false) {
  const id = v.toId(idRaw, 'machine type id');
  const [rows] = await db.query(`${TYPE_SELECT} WHERE t.id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) throw new AppError('Machine type not found', 404);
  return rows[0];
}

async function typeLog(db, { type, action, prev, next, userId, ip }) {
  let name = null;
  if (userId) {
    const [u] = await db.query('SELECT full_name FROM users WHERE id = ?', [userId]);
    name = u.length ? u[0].full_name : null;
  }
  await db.query(
    `INSERT INTO machine_type_audit
       (machine_type_id, machine_type_name, action, previous_value, new_value, performed_by, performed_by_name, ip_address)
     VALUES (?,?,?,?,?,?,?,?)`,
    [type.id, type.name, action, prev ? JSON.stringify(prev) : null, next ? JSON.stringify(next) : null, userId || null, name, ip || null]
  );
}

// --------------------------------------------------
// LIST  (?status=active|deleted|all  &search=)
// --------------------------------------------------
async function listTypes(q = {}) {
  const where = [];
  const args = [];

  const status = String(q.status || 'active').toLowerCase();
  if (status === 'active') where.push('t.deleted_at IS NULL');
  else if (status === 'deleted') where.push('t.deleted_at IS NOT NULL');
  else if (status !== 'all') throw new AppError('Invalid status filter');

  const search = v.clean(q.search);
  if (search) {
    where.push('(t.name LIKE ? OR t.code LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query(
    `${TYPE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (t.deleted_at IS NOT NULL), t.name`,
    args
  );
  return { items: rows, total: rows.length };
}

// --------------------------------------------------
// CREATE  (re-adding the name of a deleted type restores that type, so its history stays in one place)
// --------------------------------------------------
async function createType(body, userId, ip) {
  return withTransaction(async (conn) => {
    const name = v.reqStr(body.name, 'Machine type name', 100);
    const baseCode = codeFrom(name);
    if (!baseCode) throw new AppError('Machine type name must contain letters or numbers');

    const [same] = await conn.query(
      'SELECT id, deleted_at FROM machine_types WHERE LOWER(name) = LOWER(?) ORDER BY id DESC FOR UPDATE',
      [name]
    );
    if (same.some((r) => !r.deleted_at)) throw new AppError(`Machine type "${name}" already exists`, 409);

    if (same.length) {
      const id = same[0].id;
      await conn.query(
        'UPDATE machine_types SET name = ?, deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?',
        [name, userId || null, id]
      );
      const t = await typeGetById(id, conn);
      await typeLog(conn, { type: t, action: 'CREATED', prev: null, next: { name, restored: true }, userId, ip });
      return t;
    }

    let code = baseCode;
    for (let n = 2; ; n++) {
      const [c] = await conn.query('SELECT 1 FROM machine_types WHERE code = ?', [code]);
      if (!c.length) break;
      code = `${baseCode}_${n}`;
    }

    const [r] = await conn.query(
      'INSERT INTO machine_types (code, name, created_by, updated_by) VALUES (?,?,?,?)',
      [code, name, userId || null, userId || null]
    );
    const t = await typeGetById(r.insertId, conn);
    await typeLog(conn, { type: t, action: 'CREATED', prev: null, next: { name }, userId, ip });
    return t;
  });
}

// --------------------------------------------------
// UPDATE (rename)
// --------------------------------------------------
async function updateType(idRaw, body, userId, ip) {
  return withTransaction(async (conn) => {
    const old = await typeGetById(idRaw, conn, true);
    if (old.deleted_at) throw new AppError('A deleted machine type cannot be edited', 409);

    const name = v.reqStr(body.name, 'Machine type name', 100);
    if (name === old.name) return old; // nothing changed -> no audit noise

    const [dup] = await conn.query(
      'SELECT id FROM machine_types WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL AND id <> ?',
      [name, old.id]
    );
    if (dup.length) throw new AppError(`Machine type "${name}" already exists`, 409);

    await conn.query('UPDATE machine_types SET name = ?, updated_by = ? WHERE id = ?', [name, userId || null, old.id]);
    const t = await typeGetById(old.id, conn);
    await typeLog(conn, { type: t, action: 'UPDATED', prev: { name: old.name }, next: { name }, userId, ip });
    return t;
  });
}

// --------------------------------------------------
// DELETE (soft). In use -> blocked, unless ?reassign_to=<other type id> moves those machines first.
// --------------------------------------------------
async function removeType(idRaw, reassignRaw, userId, ip) {
  return withTransaction(async (conn) => {
    const t = await typeGetById(idRaw, conn, true); // row lock: a machine cannot start using this type while we count
    if (t.deleted_at) throw new AppError('Machine type is already deleted', 409);

    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM machine_master WHERE machine_type = ?', [t.code]);

    const next = { deleted: true };
    if (cnt > 0) {
      if (!v.clean(reassignRaw)) {
        throw new AppError(
          `"${t.name}" is used by ${cnt} machine${cnt === 1 ? '' : 's'}. Move them to another type before deleting`,
          409
        );
      }
      const target = await typeGetById(reassignRaw, conn, true);
      if (target.deleted_at || target.id === t.id) throw new AppError('Choose a different, active machine type');
      await conn.query('UPDATE machine_master SET machine_type = ? WHERE machine_type = ?', [target.code, t.code]);
      next.reassigned_machines = cnt;
      next.reassigned_to = target.name;
    }

    await conn.query(
      'UPDATE machine_types SET deleted_at = NOW(), deleted_by = ?, updated_by = ? WHERE id = ?',
      [userId || null, userId || null, t.id]
    );
    await typeLog(conn, { type: t, action: 'DELETED', prev: { name: t.name }, next, userId, ip });
    return { id: t.id };
  });
}

// --------------------------------------------------
// HISTORY - read from the audit table, so it also works for deleted types
// --------------------------------------------------
async function typeHistory(idRaw) {
  const id = v.toId(idRaw, 'machine type id');
  const [rows] = await pool.query(
    `SELECT id, machine_type_id, machine_type_name, action, previous_value, new_value,
            performed_by, performed_by_name, performed_at
     FROM machine_type_audit WHERE machine_type_id = ?
     ORDER BY performed_at DESC, id DESC`,
    [id]
  );
  const [t] = await pool.query(`${TYPE_SELECT} WHERE t.id = ?`, [id]);
  if (!t.length && !rows.length) throw new AppError('Machine type not found', 404);

  return {
    type: t[0] || null,
    items: rows.map((r) => ({ ...r, previous_value: parseJson(r.previous_value), new_value: parseJson(r.new_value) }))
  };
}




// ==================================================
// EXPORT MODULE FUNCTIONS
// ==================================================

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  setStatus,

  // QR functions
  qrInfo,
  ensureToken,
  backfillMissingTokens,
  getByToken,

  // machine types
  listTypes,
  createType,
  updateType,
  removeType,
  typeHistory,

  TYPES,
  STATUSES
};
