// Website real-time channel (Server-Sent Events). One open connection per browser tab.
// It only says "something new arrived"; the page then reads /notifications (the usual list), so the bell, count and toast
// update in about a second. If the stream is not available the page keeps polling every 20 s (existing behaviour).
// In-memory: with several server instances a user is reached only on the instance holding the connection - polling covers the rest.
const streams = new Map(); // userId -> Set(res)

function add(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
}
function remove(userId, res) {
  const s = streams.get(userId);
  if (!s) return;
  s.delete(res);
  if (!s.size) streams.delete(userId);
}
function emit(userIds, event = 'notification') {
  let n = 0;
  for (const id of userIds) {
    for (const res of streams.get(id) || []) {
      try { res.write(`event: ${event}\ndata: {}\n\n`); n += 1; } catch (e) { /* closed: removed on 'close' */ }
    }
  }
  return n;
}
module.exports = { add, remove, emit };