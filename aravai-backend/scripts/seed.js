require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

// V=view C=create E=edit D=delete A=approve
const M = {
  'Purchase Department': { material: 'V', vendor: 'VCE', indent: 'VCE', quotation: 'VCEA', purchase_order: 'VCE', dashboard: 'V' },
  'Store Incharge': { material: 'V', vendor: 'V', stock: 'VCE', indent: 'VC', purchase_order: 'V', finished_goods: 'V', reports: 'V', dashboard: 'V' },
  'Production Incharge': { material: 'V', product: 'VCE', batching: 'VCEA', filtering: 'VCEA', roasting: 'VE', grinding: 'VE', blending: 'VCE', recipe: 'VCE', machine: 'VE', packing: 'VE', finished_goods: 'VCE', reports: 'V', dashboard: 'V' },
  'Batching Operator': { batching: 'VCE', filtering: 'VCE', material: 'V', product: 'V', recipe: 'V' },
  'Roasting Operator': { filtering: 'V', roasting: 'VCE', machine: 'V' },
  'Grinding Operator': { grinding: 'VCE', machine: 'V' },
  'Blending Operator': { blending: 'VCE', recipe: 'V', machine: 'V' },
  'Packing Operator': { packing: 'VCE', product: 'V', machine: 'V' },
};

(async () => {
  const [roles] = await pool.query('SELECT id, role_name FROM roles');
  for (const r of roles) {
    const mods = M[r.role_name]; if (!mods) continue; // Admin = full access in middleware
    for (const [module, f] of Object.entries(mods)) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve)
         VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE can_view=VALUES(can_view), can_create=VALUES(can_create),
         can_edit=VALUES(can_edit), can_delete=VALUES(can_delete), can_approve=VALUES(can_approve)`,
        [r.id, module, f.includes('V'), f.includes('C'), f.includes('E'), f.includes('D'), f.includes('A')]);
    }
  }
  const [[admin]] = await pool.query("SELECT id FROM roles WHERE role_name='Admin'");
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 10);
  await pool.query('INSERT IGNORE INTO users (full_name, username, password_hash, role_id) VALUES (?,?,?,?)',
    ['System Admin', process.env.ADMIN_USERNAME || 'admin', hash, admin.id]);
  // Default material categories (safe to re-run)
  for (const c of ['Raw Spices', 'Packing Material', 'Consumables', 'Others']) {
    await pool.query('INSERT IGNORE INTO material_categories (category_name) VALUES (?)', [c]);
  }
  console.log('Seed complete: permissions + admin user + material categories');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });