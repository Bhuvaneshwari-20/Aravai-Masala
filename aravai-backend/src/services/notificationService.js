const crypto = require('crypto');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { FULL_ACCESS } = require('../utils/roles');
const tg = require('./telegramService');
const push = require('./pushService');
const hub = require('./notificationHub');


// What the bell shows: not removed by the user, not older than KEEP_UNREAD_D days, and read alerts only for KEEP_READ_H hours after they were read.
// Removed alerts are only HIDDEN (hidden = 1), never deleted, so the unique dedupe key stays and the job can never create the same alert again.
const KEEP_READ_H = Math.max(Math.floor(Number(process.env.NOTIFY_KEEP_READ_HOURS)) || 24, 1);
const KEEP_UNREAD_D = Math.max(Math.floor(Number(process.env.NOTIFY_KEEP_UNREAD_DAYS)) || 7, 1);
const VISIBLE = `hidden = 0 AND created_at >= NOW() - INTERVAL ${KEEP_UNREAD_D} DAY AND (is_read = 0 OR read_at >= NOW() - INTERVAL ${KEEP_READ_H} HOUR)`;

// A user whose browser / phone has not asked for notifications for this many seconds is "away" and gets the phone message.
// (the app asks every 20 seconds while it is open)
const AWAY_SECONDS = Number(process.env.NOTIFY_AWAY_SECONDS) || 90;
const SEVERITY = ['info', 'success', 'warning', 'danger'];

/* --------------------------------------------------------------- who gets it */
async function recipients({ userIds = [], roles = [], module: mod } = {}) {
  const ids = new Set(userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0));
  if (roles.length) {
    const [r] = await pool.query('SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND r.role_name IN (?)', [roles]);
    r.forEach((x) => ids.add(x.id));
  }
  if (mod) { // everybody who may open that module (Super Admin / Admin always may)
    const [r] = await pool.query(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = u.role_id AND rp.module = ?
        WHERE u.is_active = 1 AND (r.role_name IN (?) OR rp.can_view = 1)`, [mod, FULL_ACCESS]);
    r.forEach((x) => ids.add(x.id));
  }
  return [...ids];
}

// notify({ type, severity, title, message, screen, params, dedupeKey, userIds, roles, module, phone, processType, processId, batchId, stage })
//   dedupeKey : the same key for the same user is created only once (a job can run every 30 s without repeating itself)
//   processType / processId / batchId / stage : which process and which reminder stage this alert is about (saved in the row)
//   phone     : true  -> Telegram message only to users who are away from the website
//               'always' -> to everybody with a connected Telegram | false -> no Telegram
// The row in `notifications` is saved first. Then every channel is tried on its own - if one fails the others still work:
//   website : live signal to open browser tabs (bell + toast). Users who switched website alerts off get no live signal.
//   mobile  : Firebase push to every active phone of the user. Users who switched mobile push off get none.
//   Telegram: unchanged
async function notify(o) {
  if (!o || !o.title || !o.message) throw new Error('notify: title and message are required');
  const severity = SEVERITY.includes(o.severity) ? o.severity : 'info';
  const ids = await recipients(o);
  if (!ids.length) return { created: 0, phone: 0, push: 0, web: 0 };
  const params = o.params ? JSON.stringify(o.params).slice(0, 255) : null;
  const fresh = [];
  for (const uid of ids) {
    const [r] = await pool.query(
      `INSERT IGNORE INTO notifications (user_id, type, severity, title, message, screen, params, dedupe_key, process_type, process_id, batch_id, reminder_stage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, String(o.type || 'INFO').slice(0, 40), severity, String(o.title).slice(0, 120), String(o.message).slice(0, 500), o.screen || null, params,
        o.dedupeKey ? String(o.dedupeKey).slice(0, 120) : null, o.processType || null, o.processId || null, o.batchId || null, o.stage || null]);
    if (r.affectedRows) fresh.push({ uid, id: r.insertId });
  }
  if (!fresh.length) return { created: 0, phone: 0, push: 0, web: 0 };

  const prefs = await settingsMap(fresh.map((f) => f.uid));
  let web = 0; let sentPush = 0; let phone = 0;
  try { web = hub.emit(fresh.filter((f) => prefs.get(f.uid).web_enabled).map((f) => f.uid)); } catch (e) { console.error('Website alert:', e.message); }
  try { sentPush = await sendPush(fresh.filter((f) => prefs.get(f.uid).push_enabled), o, severity, params); } catch (e) { console.error('Mobile push:', e.message); }
  const tgMode = o.phone === undefined ? true : o.phone;
  try { phone = tgMode ? await sendPhone(fresh, o, tgMode === 'always') : 0; } catch (e) { console.error('Phone alerts:', e.message); }
  return { created: fresh.length, phone, push: sentPush, web };
}

// settings of many users (users without a row = everything on)
async function settingsMap(userIds) {
  const map = new Map(userIds.map((id) => [id, { web_enabled: true, push_enabled: true }]));
  if (!userIds.length) return map;
  const [rows] = await pool.query('SELECT user_id, web_enabled, push_enabled FROM notification_settings WHERE user_id IN (?)', [userIds]);
  rows.forEach((r) => map.set(r.user_id, { web_enabled: !!r.web_enabled, push_enabled: !!r.push_enabled }));
  return map;
}

// Mobile push: each user's own notification id goes in the data, so tapping it opens the right screen and marks it read.
async function sendPush(fresh, o, severity, params) {
  if (!fresh.length || !push.isConfigured()) return 0;
  const [tokens] = await pool.query('SELECT id, user_id, device_token FROM device_tokens WHERE is_active = 1 AND user_id IN (?)', [fresh.map((f) => f.uid)]);
  if (!tokens.length) return 0;
  let total = 0;
  const dead = [];
  const dbg = process.env.NOTIFY_DEBUG === '1';
  for (const f of fresh) {
    const mine = tokens.filter((t) => t.user_id === f.uid);
    if (!mine.length) { if (dbg) console.log(`[push] user ${f.uid}: no active phone`); continue; }
    try {
      const r = await push.send(mine, {
        title: o.title, body: o.message,
        data: { notification_id: f.id, type: o.type || 'INFO', severity, screen: o.screen || '', params: params || '', process_type: o.processType || '', process_id: o.processId || '', batch_id: o.batchId || '' },
      });
      total += r.sent; dead.push(...r.dead);
      if (r.sent) await pool.query('UPDATE notifications SET push_sent_at = NOW() WHERE id = ?', [f.id]);
      if (r.ok.length) await pool.query('UPDATE device_tokens SET last_error = NULL WHERE id IN (?) AND last_error IS NOT NULL', [r.ok]);
      for (const x of r.failed) await pool.query('UPDATE device_tokens SET last_error = ? WHERE id = ?', [String(x.code).slice(0, 190), x.id]);
      if (dbg) console.log(`[push] user ${f.uid}: accepted by FCM ${r.sent}/${mine.length}${r.failed.length ? `, failed: ${r.failed.map((x) => x.code).join(',')}` : ''}`);
    } catch (e) { console.error(`Mobile push for user ${f.uid}:`, e.message); }   // one user's problem never stops the others
  }
  if (dead.length) await pool.query("UPDATE device_tokens SET is_active = 0, last_error = 'token not registered' WHERE id IN (?)", [dead]); // expired / uninstalled
  return total;
}

// Never throws: a Telegram problem must not stop the job or the screen that created the alert.
async function sendPhone(fresh, o, always) {
  if (!tg.isConfigured()) return 0;
  let sent = 0;
  try {
    const uids = fresh.map((f) => f.uid);
    const [rows] = await pool.query(
      `SELECT c.user_id, c.address, COALESCE(TIMESTAMPDIFF(SECOND, p.last_seen, NOW()), 999999) AS idle_sec
         FROM phone_channels c LEFT JOIN user_presence p ON p.user_id = c.user_id
        WHERE c.kind = 'TELEGRAM' AND c.user_id IN (?)`, [uids]);
    for (const ch of rows) {
      if (!always && Number(ch.idle_sec) < AWAY_SECONDS) continue; // inside the website right now -> the bell shows it
      try {
        await tg.send(ch.address, `🔔 ${o.title}\n${o.message}`);
        sent += 1;
        const row = fresh.find((f) => f.uid === ch.user_id);
        if (row) await pool.query('UPDATE notifications SET phone_sent_at = NOW() WHERE id = ?', [row.id]);
      } catch (e) {
        console.error(`Phone alert to user ${ch.user_id} failed: ${e.message}`);
        if (e.code === 403) await pool.query('DELETE FROM phone_channels WHERE user_id = ?', [ch.user_id]); // the user blocked the bot
      }
    }
  } catch (e) { console.error('Phone alerts:', e.message); }
  return sent;
}

/* ------------------------------------------------------- the bell (per user) */
async function touchPresence(userId) {
  await pool.query('INSERT INTO user_presence (user_id, last_seen) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE last_seen = NOW()', [userId]);
}

async function list(userId, q = {}) {
  await touchPresence(userId); // the app calls this every 20 s while it is open
  const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
  const [rows] = await pool.query(
        `SELECT id, type, severity, title, message, screen, params, process_type, process_id, batch_id, reminder_stage, is_read, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_sec
         FROM notifications WHERE user_id = ? AND ${VISIBLE} ORDER BY id DESC LIMIT ?`, [userId, limit]);
  const [[c]] = await pool.query(
       `SELECT SUM(is_read = 0 AND hidden = 0 AND created_at >= NOW() - INTERVAL ${KEEP_UNREAD_D} DAY) AS unread, COALESCE(MAX(id), 0) AS max_id FROM notifications WHERE user_id = ?`, [userId]);
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  return {
    items: rows.map((r) => ({ ...r, is_read: !!r.is_read, params: parse(r.params), age_sec: Number(r.age_sec) })),
       unread: Number(c.unread || 0), max_id: Number(c.max_id),
    settings: (await settingsMap([userId])).get(userId),
  
  };
}

async function markRead(userId, idRaw) {
  const id = v.toId(idRaw, 'notification');
  await pool.query('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ? AND is_read = 0', [id, userId]);
  return { id };
}
async function markAllRead(userId) {
  const [r] = await pool.query('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0', [userId]);
  return { updated: r.affectedRows };
}

// remove one alert / all alerts of this user from the bell (they are only hidden - see VISIBLE)
async function remove(userId, idRaw) {
  const id = v.toId(idRaw, 'notification');
  await pool.query('UPDATE notifications SET hidden = 1, is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [id, userId]);
  return { id };
}
async function clearAll(userId) {
  const [r] = await pool.query('UPDATE notifications SET hidden = 1, is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND hidden = 0', [userId]);
  return { removed: r.affectedRows };
}
/* ------------------------------------------------- unread count, settings, devices */
async function unreadCount(userId) {
   const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0 AND hidden = 0 AND created_at >= NOW() - INTERVAL ${KEEP_UNREAD_D} DAY`, [userId]);
  return { unread: Number(c.n) };
}

async function getSettings(userId) {
  const s = (await settingsMap([userId])).get(userId);
  const [[d]] = await pool.query('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ? AND is_active = 1', [userId]);
  return { ...s, push_available: push.isConfigured(), devices: Number(d.n) };
}
async function saveSettings(userId, body) {
  const cur = (await settingsMap([userId])).get(userId);
  const web = body.web_enabled === undefined ? cur.web_enabled : v.toBool(body.web_enabled, 'Website alerts');
  const mob = body.push_enabled === undefined ? cur.push_enabled : v.toBool(body.push_enabled, 'Mobile push');
  await pool.query(
    `INSERT INTO notification_settings (user_id, web_enabled, push_enabled) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE web_enabled = VALUES(web_enabled), push_enabled = VALUES(push_enabled)`, [userId, web ? 1 : 0, mob ? 1 : 0]);
  return getSettings(userId);
}

const hashOf = (t) => crypto.createHash('sha256').update(t).digest('hex');

// The user always comes from the login token (req.user), never from the request body.
// A token belongs to one phone: if it is registered again by another user (phone handed over), it moves to that user.
async function registerDevice(userId, body) {
  const token = v.reqStr(body.token, 'Device token', 512);
  const type = ['android', 'ios'].includes(String(body.device_type || 'android').toLowerCase()) ? String(body.device_type || 'android').toLowerCase() : 'android';
  const deviceId = v.optStr(body.device_id, 'Device id', 80) || null;
  const appVersion = v.optStr(body.app_version, 'App version', 20) || null;
  const h = hashOf(token);
  await pool.query(
    `INSERT INTO device_tokens (user_id, device_token, token_hash, device_type, device_id, app_version, is_active) VALUES (?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), device_token = VALUES(device_token), device_type = VALUES(device_type),
    device_id = VALUES(device_id), app_version = VALUES(app_version), is_active = 1, last_error = NULL, updated_at = NOW()`, [userId, token, h, type, deviceId, appVersion]);
  // token refresh: the old token of the same phone is switched off (by device id, or by the old token the app sends)
  if (body.old_token) await pool.query('UPDATE device_tokens SET is_active = 0 WHERE token_hash = ? AND user_id = ?', [hashOf(String(body.old_token)), userId]);
  if (deviceId) await pool.query('UPDATE device_tokens SET is_active = 0 WHERE user_id = ? AND device_id = ? AND token_hash <> ?', [userId, deviceId, h]);
  const [[d]] = await pool.query('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ? AND is_active = 1', [userId]);
  return { registered: true, devices: Number(d.n) };
}

// logout: only the caller's own token can be switched off
async function unregisterDevice(userId, body) {
  const token = v.reqStr(body.token, 'Device token', 512);
  const [r] = await pool.query('UPDATE device_tokens SET is_active = 0 WHERE token_hash = ? AND user_id = ?', [hashOf(token), userId]);
  return { unregistered: r.affectedRows > 0 };
}

// push to the caller's own phones only (not saved in the bell list)
async function sendTestPush(userId) {
  if (!push.isConfigured()) throw new AppError('Mobile push is not set up on the server yet (Firebase credentials missing)', 503);
  const [rows] = await pool.query('SELECT id, device_token FROM device_tokens WHERE user_id = ? AND is_active = 1', [userId]);
  if (!rows.length) throw new AppError('No phone is registered for push notifications. Open the mobile app and allow notifications first', 409);
  const r = await push.send(rows, { title: 'Test notification', body: 'Mobile push is working on this phone.', data: { type: 'TEST', screen: '', params: '' } });
  if (r.dead.length) await pool.query("UPDATE device_tokens SET is_active = 0, last_error = 'token not registered' WHERE id IN (?)", [r.dead]);
  for (const x of r.failed) await pool.query('UPDATE device_tokens SET last_error = ? WHERE id = ?', [String(x.code).slice(0, 190), x.id]);
  if (r.ok.length) await pool.query('UPDATE device_tokens SET last_error = NULL WHERE id IN (?)', [r.ok]);
  if (!r.sent) throw new AppError(`Firebase could not deliver the test message${r.failed.length ? ` (${r.failed.map((x) => x.code).join(', ')})` : ''}. The phone token may have expired - open the app again`, 502);
  return { sent: r.sent, devices: rows.length, failed: r.failed };
}

/* ------------------------------------------------------------ connect a phone */
async function phoneStatus(userId) {
  const configured = tg.isConfigured();
  const [rows] = await pool.query('SELECT kind, linked_at FROM phone_channels WHERE user_id = ?', [userId]);
  let bot = null;
  if (configured) { try { bot = await tg.username(); } catch (e) { /* server offline: still show the status */ } }
  return { configured, connected: rows.length > 0, bot_username: bot, channel: rows.length ? rows[0].kind : null };
}

async function createLinkCode(userId) {
  if (!tg.isConfigured()) throw new AppError('Phone alerts are not set up yet. Ask the admin to add TELEGRAM_BOT_TOKEN to the server .env', 503);
  let bot;
  try { bot = await tg.username(); } catch (e) { throw new AppError('Could not reach Telegram from the server. Check the internet connection and the bot token', 502); }
  await pool.query('DELETE FROM phone_link_codes WHERE user_id = ?', [userId]);
  let code = '';
  while (code.length < 8) code = crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
  await pool.query('INSERT INTO phone_link_codes (code, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))', [code, userId]);
  return { code, bot_username: bot, url: `https://t.me/${bot}?start=${code}` };
}

async function disconnectPhone(userId) {
  await pool.query('DELETE FROM phone_channels WHERE user_id = ?', [userId]);
  return { connected: false };
}

async function sendTest(userId) {
  const [rows] = await pool.query("SELECT address FROM phone_channels WHERE user_id = ? AND kind = 'TELEGRAM'", [userId]);
  if (!rows.length) throw new AppError('Connect your phone first', 409);
  try { await tg.send(rows[0].address, '✅ Test message from Aravai Masala. Phone alerts are working.'); } catch (e) { throw new AppError(`Telegram could not deliver the message: ${e.message}`, 502); }
  return { sent: true };
}

// Called by the Telegram polling loop for every message the bot receives.
async function onTelegramMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = String(msg.text || '').trim();
  const reply = (t) => tg.send(chatId, t).catch(() => {});
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,16})$/.exec(text);
  if (m) {
    const [rows] = await pool.query(
      `SELECT c.user_id, u.full_name FROM phone_link_codes c JOIN users u ON u.id = c.user_id WHERE c.code = ? AND c.expires_at > NOW()`, [m[1].toUpperCase()]);
    if (!rows.length) return reply('This link has expired. Open Aravai Masala, press "Get alerts on my phone" again and tap the new link.');
    await pool.query("INSERT INTO phone_channels (user_id, kind, address) VALUES (?, 'TELEGRAM', ?) ON DUPLICATE KEY UPDATE kind = 'TELEGRAM', address = VALUES(address), linked_at = NOW()", [rows[0].user_id, chatId]);
    await pool.query('DELETE FROM phone_link_codes WHERE user_id = ?', [rows[0].user_id]);
    return reply(`✅ Connected, ${rows[0].full_name}. Filtering, Roasting, Grinding and Blending alerts will come here when you are away from the website.`);  }
  if (/^\/stop\b/.test(text)) {
    await pool.query("DELETE FROM phone_channels WHERE kind = 'TELEGRAM' AND address = ?", [chatId]);
    return reply('Alerts stopped. You can connect again from Aravai Masala any time.');
  }
  return reply('Hello! To get Aravai Masala alerts here, open the website or app, press the bell icon, then "Get alerts on my phone".');
}

const startPhoneLink = () => tg.startPolling(onTelegramMessage);

async function cleanup() {
  await pool.query('DELETE FROM notifications WHERE created_at < NOW() - INTERVAL 60 DAY');
  await pool.query('DELETE FROM phone_link_codes WHERE expires_at < NOW()');
    await pool.query('DELETE FROM device_tokens WHERE is_active = 0 AND updated_at < NOW() - INTERVAL 90 DAY');
}

module.exports = { AWAY_SECONDS, notify, list, unreadCount, markRead, markAllRead, remove, clearAll, getSettings, saveSettings, registerDevice, unregisterDevice, sendTestPush, phoneStatus, createLinkCode, disconnectPhone, sendTest, onTelegramMessage, startPhoneLink, cleanup };