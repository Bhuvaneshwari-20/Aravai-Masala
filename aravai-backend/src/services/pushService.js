
// Firebase Cloud Messaging through Firebase Admin SDK
// Compatible with firebase-admin v11 to v14+

const fs = require('fs');

const CHANNEL_ID = 'process-alerts';

const DEAD = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
];

let messaging = null;
let ready = null;
let lastError = '';

function init() {
  if (ready !== null) return ready;

  try {
    let raw = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64) {
      raw = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64,
        'base64'
      ).toString('utf8');

    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      raw = fs.readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        'utf8'
      );
    }

    if (!raw) {
      lastError =
        'Firebase credentials missing. Configure FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON_B64';

      console.error(`Push configuration error: ${lastError}`);

      ready = false;
      return false;
    }

    const serviceAccount = JSON.parse(raw);

    const {
      initializeApp,
      cert,
      getApps
    } = require('firebase-admin/app');

    const {
      getMessaging
    } = require('firebase-admin/messaging');

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount)
        });

    messaging = getMessaging(app);

    ready = true;
    lastError = '';

    console.log('Firebase Cloud Messaging initialized successfully');

    return true;

  } catch (e) {
    lastError = e.code === 'ENOENT'
      ? 'Firebase service account file not found. Check FIREBASE_SERVICE_ACCOUNT_PATH'
      : e.message;

    console.error('Firebase initialization failed:', lastError);

    messaging = null;
    ready = false;

    return false;
  }
}

const isConfigured = () => init();

const mask = (token) =>
  `...${String(token || '').slice(-6)}`;

// Send FCM notifications
async function send(rows, {
  title,
  body,
  data = {}
} = {}) {

  const out = {
    sent: 0,
    dead: [],
    failed: 0
  };

  if (!rows || !rows.length) {
    console.log('FCM: No registered devices found');
    return out;
  }

  if (!init()) {
    console.error('FCM unavailable:', lastError);
    return out;
  }

  // FCM data values must be strings
  const str = {};

  Object.keys(data).forEach((key) => {
    if (data[key] !== undefined && data[key] !== null) {
      str[key] = String(data[key]);
    }
  });

  // Firebase supports up to 500 messages per sendEach call
  for (let i = 0; i < rows.length; i += 500) {

    const part = rows.slice(i, i + 500);

    const messages = part.map((r) => ({
      token: r.device_token,

      notification: {
        title: String(title || 'Aravai Masala').slice(0, 120),
        body: String(body || '').slice(0, 500)
      },

      data: str,

      android: {
        priority: 'high',
        ttl: 60 * 60 * 1000,

        notification: {
          channelId: CHANNEL_ID,
          sound: 'default',
          tag: str.notification_id || undefined
        }
      }
    }));

    try {

      const res = await messaging.sendEach(messages);

      res.responses.forEach((result, index) => {

        const device = part[index];

        if (result.success) {
          out.sent++;

          console.log(
            `FCM SUCCESS: Device ${mask(device.device_token)}`
          );

          return;
        }

        out.failed++;

        const code = result.error?.code || 'unknown';
        const message = result.error?.message || 'Unknown Firebase error';

        console.error('FCM SEND FAILED:', {
          code,
          message,
          device: mask(device.device_token)
        });

        // Deactivate only genuinely invalid / expired tokens
        if (DEAD.includes(code)) {
          out.dead.push(device.id);
        }
      });

    } catch (e) {

      out.failed += part.length;

      console.error('FCM BATCH FAILED:', {
        code: e.code || 'unknown',
        message: e.message || 'Unknown batch error'
      });
    }
  }

  console.log('FCM FINAL RESULT:', {
    sent: out.sent,
    failed: out.failed,
    invalidTokens: out.dead.length
  });

  return out;
}

module.exports = {
  isConfigured,
  send,
  CHANNEL_ID,
  lastError: () => lastError
};
