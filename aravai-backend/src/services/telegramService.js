// Phone alerts through a Telegram bot.
//  - works with the plain http://<LAN-IP> setup (the SERVER calls Telegram; nothing has to reach the server from outside)
//  - needs: internet on the server + TELEGRAM_BOT_TOKEN in .env (create the bot with @BotFather, it is free)
//  - no extra npm package: uses the fetch of Node 18+
const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const isConfigured = () => !!token();
let botUsername = null;
let polling = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, body = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const e = new Error(data.description || `Telegram error ${res.status}`);
      e.code = data.error_code || res.status;
      throw e;
    }
    return data.result;
  } finally { clearTimeout(timer); }
}

async function username() {
  if (botUsername) return botUsername;
  const me = await call('getMe');
  botUsername = me.username;
  return botUsername;
}

const send = (chatId, text) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });

// Long polling: the bot receives "/start <code>" when a user presses START after tapping "Get alerts on my phone".
function startPolling(onMessage) {
  if (!isConfigured() || polling) return;
  polling = true;
  (async () => {
    try { await call('deleteWebhook', {}); } catch (e) { /* offline now, the loop below retries */ }
    let offset = 0;
    let warned = false;
    while (polling) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
        warned = false;
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message && u.message.text) { try { await onMessage(u.message); } catch (e) { console.error('Telegram message handler:', e.message); } }
        }
      } catch (e) {
        if (!warned) { console.error(`Telegram polling: ${e.message} (will keep trying)`); warned = true; }
        await sleep(10000);
      }
    }
  })();
}
const stopPolling = () => { polling = false; };

module.exports = { isConfigured, username, send, startPolling, stopPolling };