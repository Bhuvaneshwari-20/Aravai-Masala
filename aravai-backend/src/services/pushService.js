// Firebase Cloud Messaging (mobile push) through the Firebase Admin SDK (modular API: works with firebase-admin 11 to 14+).
// The service-account key is NEVER in the code or the repo. Give it to the server in ONE of these ways (.env or host secrets):
//   FIREBASE_SERVICE_ACCOUNT_PATH=C:\secrets\firebase-service-account.json     (file kept outside the project folder)
//   FIREBASE_SERVICE_ACCOUNT_JSON_B64=<base64 of the json file>                (for hosts that only have env variables)
// Not configured -> every function here quietly does nothing (bell icon + Telegram keep working).
const fs = require('fs');

const CHANNEL_ID = 'process-alerts'; // Android notification channel created by the app (src/pushNotifications.js)
const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

let messaging = null;
let ready = null; // null = not tried yet, true / false afterwards
let lastError = '';

function init() {
  if (ready !== null) return ready;
  try {
    let raw = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64) raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8');
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8');
    if (!raw) { lastError = 'FIREBASE_SERVICE_ACCOUNT_PATH is not set'; ready = false; return ready; }
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(JSON.parse(raw)) });
    messaging = getMessaging(app);
    ready = true;
  } catch (e) {
    lastError = e.code === 'ENOENT' ? 'service-account file not found (check FIREBASE_SERVICE_ACCOUNT_PATH)' : e.message;
    console.error(`Push (FCM) could not start: ${lastError}`); // never prints the key
    ready = false;
  }
  return ready;
}
const isConfigured = () => init();
const mask = (t) => `...${String(t).slice(-6)}`; // logs never contain a full token

// rows: [{ id, device_token }]   payload: { title, body, data: { key: value } }
// -> { sent, ok: [row ids FCM accepted], dead: [row ids to deactivate], failed: [{ id, code }] }
// Every phone is its own message: one phone failing (or being offline) never stops the others.
async function send(rows, { title, body, data = {} }) {
  const out = { sent: 0, ok: [], dead: [], failed: [] };
  if (!rows.length || !init()) return out;
  const str = {};
  Object.keys(data).forEach((k) => { if (data[k] !== undefined && data[k] !== null) str[k] = String(data[k]); }); // FCM data values must be strings
  for (let i = 0; i < rows.length; i += 500) { // sendEach accepts 500 messages per call
    const part = rows.slice(i, i + 500);
    const messages = part.map((r) => ({
      token: r.device_token,
      notification: { title: String(title).slice(0, 120), body: String(body).slice(0, 500) },
      data: str,
      android: { priority: 'high', ttl: (Number(process.env.PUSH_TTL_HOURS) || 24) * 60 * 60 * 1000, notification: { channelId: CHANNEL_ID, sound: 'default', tag: str.notification_id || undefined } },
    }));
    try {
      const res = await messaging.sendEach(messages);
      res.responses.forEach((x, n) => {
        if (x.success) { out.sent += 1; out.ok.push(part[n].id); return; }
        const code = (x.error && x.error.code) || 'unknown';
        if (DEAD.includes(code)) out.dead.push(part[n].id);
        else { out.failed.push({ id: part[n].id, code }); console.error(`FCM send failed (${code}) for device ${mask(part[n].device_token)}`); }
      });
    } catch (e) {
      const code = e.code || e.message || 'batch-failed';
      part.forEach((r) => out.failed.push({ id: r.id, code }));
      console.error(`FCM batch failed: ${code}`);
    }
  }
  return out;
}

module.exports = { isConfigured, send, CHANNEL_ID, lastError: () => lastError };