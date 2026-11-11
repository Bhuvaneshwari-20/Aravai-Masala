// npm run seed:superadmin   -> creates the Super Admin, or resets it to the .env values
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

(async () => {
  const name = process.env.SUPERADMIN_NAME || 'Super Admin';
  const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const hash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD || 'ChangeMe@123', 10);
  await pool.query("INSERT IGNORE INTO roles (role_name, description) VALUES ('Super Admin', 'Owner. Creates Admin accounts. Full access.')");
  const [[role]] = await pool.query("SELECT id FROM roles WHERE role_name = 'Super Admin'");
  const [[ex]] = await pool.query('SELECT id FROM users WHERE role_id = ? LIMIT 1', [role.id]);
  if (ex) {
    await pool.query('UPDATE users SET full_name=?, username=?, password_hash=?, is_active=1 WHERE id=?', [name, username, hash, ex.id]);
    console.log('Super Admin login reset. Username:', username);
  } else {
    await pool.query('INSERT INTO users (full_name, username, password_hash, role_id) VALUES (?,?,?,?)', [name, username, hash, role.id]);
    console.log('Super Admin created. Username:', username);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
