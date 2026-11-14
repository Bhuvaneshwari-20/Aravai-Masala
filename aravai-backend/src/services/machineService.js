
const { pool, withTransaction } = require('../config/db');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { newToken, extractToken, qrUrl } = require('../utils/qrToken');

const TYPES = ['ROASTING', 'GRINDING', 'BLENDING', 'PACKING', 'WEIGHING'];

const STATUSES = [
  'ACTIVE',
  'IDLE',
  'UNDER_MAINTENANCE',
  'BREAKDOWN',
  'INACTIVE'
];

const SELECT = `
  SELECT m.*, u.full_name AS operator_name
  FROM machine_master m
  LEFT JOIN users u ON u.id = m.operator_id
`;

const fmtDate = (d) =>
  (d instanceof Date ? d.toISOString().slice(0, 10) : d);

const shape = (m) => ({
  ...m,
  installation_date: fmtDate(m.installation_date),
  last_maintenance_date: fmtDate(m.last_maintenance_date),
  next_maintenance_date: fmtDate(m.next_maintenance_date)
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
    const t = String(q.machine_type).toUpperCase();

    if (!TYPES.includes(t)) {
      throw new AppError('Invalid machine type');
    }

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

  if (!TYPES.includes(type)) {
    throw new AppError('Select the machine type');
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

  return {
    machine_name: v.reqStr(body.machine_name, 'Machine name', 100),
    machine_type: type,
    manufacturer: v.optStr(body.manufacturer, 'Manufacturer', 100),
    capacity,
    capacity_unit:
      v.optStr(body.capacity_unit, 'Capacity unit', 20) || 'KG/HR',
    status,
    installation_date: optDate(body.installation_date, 'Installation date'),
    last_maintenance_date: optDate(body.last_maintenance_date, 'Last maintenance date'),
    next_maintenance_date: optDate(body.next_maintenance_date, 'Next maintenance date'),
    operator_id: operatorId
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
            qr_token
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        operator_id = ?
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


// ==================================================
// EXPORT MODULE FUNCTIONS
// ==================================================

module.exports = {
  list,
  getById,
  create,
  update,
  remove,

  // QR functions
  qrInfo,
  ensureToken,
  backfillMissingTokens,
  getByToken,

  TYPES,
  STATUSES
};
