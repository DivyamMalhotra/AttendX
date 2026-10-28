const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const live = require('../services/liveService');

const HEARTBEAT_MS = 25000;
const MAX_CONNECTIONS_PER_USER = 5;
const open = new Map(); // userId -> Set(res)

/**
 * GET /api/events — Server-Sent Events stream of the signed-in user's live events.
 * Authenticated by the session cookie; a user can only ever subscribe to their own channel.
 * The page works without it (it is an enhancement): on any failure the browser simply retries.
 */
router.get('/', requireAuth(), async (req, res) => {
  const userId = String(req.user._id);
  const conns = open.get(userId) || new Set();
  if (conns.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = conns.values().next().value;
    oldest.end();
    conns.delete(oldest);
  }
  conns.add(res);
  open.set(userId, conns);

  res.status(200).set({
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'   // stop nginx-style proxies from buffering the stream
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const send = evt => res.write(`id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify({ ...evt.data, at: evt.at })}\n\n`);

  // Resume after a reconnect: send what was missed, then go live.
  const last = Number(req.get('last-event-id') || req.query.lastEventId);
  const unsubscribe = live.subscribe(userId, send);
  if (Number.isSafeInteger(last) && last >= 0) (await live.replay(userId, last)).forEach(send);

  const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    unsubscribe();
    conns.delete(res);
    if (!conns.size) open.delete(userId);
  });
});

module.exports = router;
