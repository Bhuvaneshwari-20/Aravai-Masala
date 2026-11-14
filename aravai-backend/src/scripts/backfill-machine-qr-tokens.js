// Gives every machine without a QR token a permanent one. Safe to run repeatedly; existing tokens are never changed.
//   node src/scripts/backfill-machine-qr-tokens.js      (same effect as step 4 of migrations/2026_11_machine_qr_token.sql)
require('dotenv').config();
const { pool } = require('../config/db');
const { backfillMissingTokens } = require('../services/machineService');

backfillMissingTokens()
  .then((n) => { console.log(`Assigned QR tokens to ${n} machine(s).`); return pool.end(); })
  .catch((e) => { console.error('Backfill failed:', e.message); process.exit(1); });
