'use strict';
/*
 * Server side of the local↔server connection (docs/online-dashboard-connector-design.md §2/§3).
 * Authenticates a machine by its Bearer token (hashed lookup in db.machines), keeps one live entry
 * per connected machine (WebSocket socket, or "an HTTP long-poll is outstanding"), and hands every
 * recognized upward frame to onFrame(machineId, frame) — relay.js (Task 11) is the real consumer;
 * this file knows nothing about ROUTES or op semantics, only the wire protocol and who is connected.
 */

function createRegistry() {
  const machines = new Map(); // machineId -> entry
  function entry(machineId) {
    let e = machines.get(machineId);
    if (!e) { e = { name: null, connected: false, transport: null, lastSeen: null, sockets: new Set(), httpWaiters: new Set(), httpOutbox: [], lastHttpAt: 0 }; machines.set(machineId, e); }
    return e;
  }
  function markWsConnected(machineId, socket) { const e = entry(machineId); e.sockets.add(socket); e.connected = true; e.transport = 'ws'; e.lastSeen = new Date(); }
  function markWsDisconnected(machineId, socket) { const e = machines.get(machineId); if (!e) return; e.sockets.delete(socket); if (!e.sockets.size && e.transport === 'ws') e.connected = false; }
  function markHttpSeen(machineId) { const e = entry(machineId); e.transport = 'http'; e.connected = true; e.lastSeen = new Date(); e.lastHttpAt = Date.now(); }
  function sweepHttp(timeoutMs) {
    const now = Date.now();
    for (const [id, e] of machines) if (e.transport === 'http' && now - e.lastHttpAt > timeoutMs) e.connected = false;
  }
  function send(machineId, frame) {
    const e = machines.get(machineId);
    if (!e) return false;
    if (e.sockets.size) { const msg = JSON.stringify(frame); for (const s of e.sockets) s.send(msg); return true; }
    e.httpOutbox.push(frame);
    for (const w of [...e.httpWaiters]) w();
    return e.connected; // queued even if currently disconnected — delivered on the machine's next poll
  }
  function status(machineId) {
    const e = machines.get(machineId);
    return e ? { connected: e.connected, transport: e.transport, lastSeen: e.lastSeen } : { connected: false, transport: null, lastSeen: null };
  }
  return { machines, entry, markWsConnected, markWsDisconnected, markHttpSeen, sweepHttp, send, status };
}

async function registerConnector(app, { db, registry, onFrame }) {
  await app.register(require('@fastify/websocket'));

  async function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    return db.machineByToken(token);
  }

  app.post('/connector/whoami', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    await db.touchMachine(m.id);
    return { machineId: m.id, name: m.name };
  });

  app.get('/connector/ws', { websocket: true }, (socket, req) => {
    let machineId = null;
    const authTimeout = setTimeout(() => { if (!machineId) { try { socket.close(4408, 'auth timeout'); } catch (_) {} } }, 5000);
    socket.on('message', async (raw) => {
      let frame; try { frame = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (!machineId) {
        if (frame.type !== 'auth') return;
        const m = await authenticate({ headers: { authorization: `Bearer ${frame.token}` } });
        if (!m) { try { socket.close(4401, 'unauthorized'); } catch (_) {} return; }
        clearTimeout(authTimeout);
        machineId = m.id;
        registry.entry(machineId).name = m.name;
        registry.markWsConnected(machineId, socket);
        await db.touchMachine(machineId);
        socket.send(JSON.stringify({ type: 'auth-ok', machineId }));
        return;
      }
      if (frame.type === 'pong') return;
      await db.touchMachine(machineId);
      registry.entry(machineId).lastSeen = new Date();
      onFrame(machineId, frame);
    });
    socket.on('close', () => { clearTimeout(authTimeout); if (machineId) registry.markWsDisconnected(machineId, socket); });
    socket.on('error', () => {});
    const pinger = setInterval(() => { if (socket.readyState === 1) { try { socket.send(JSON.stringify({ type: 'ping' })); } catch (_) {} } }, 25000);
    socket.on('close', () => clearInterval(pinger));
  });

  app.post('/connector/frames', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    registry.markHttpSeen(m.id);
    await db.touchMachine(m.id);
    const batch = Array.isArray(req.body) ? req.body : [];
    for (const frame of batch) {
      if (frame.type === 'auth') continue; // already authenticated via the header for this transport
      if (frame.type === 'pong') continue;
      onFrame(m.id, frame);
    }
    const e = registry.entry(m.id);
    const down = e.httpOutbox.splice(0);
    if (batch.some((f) => f.type === 'auth')) down.unshift({ type: 'auth-ok', machineId: m.id });
    return down;
  });

  app.get('/connector/frames', async (req, reply) => {
    const m = await authenticate(req);
    if (!m) return reply.code(401).send({ error: 'Invalid or revoked token.' });
    registry.markHttpSeen(m.id);
    const e = registry.entry(m.id);
    if (e.httpOutbox.length) return e.httpOutbox.splice(0);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; e.httpWaiters.delete(finish); clearTimeout(t); resolve(e.httpOutbox.splice(0)); };
      const t = setTimeout(finish, 25000);
      e.httpWaiters.add(finish);
    });
  });

  const sweeper = setInterval(() => registry.sweepHttp(40000), 5000);
  app.addHook('onClose', (_i, done) => { clearInterval(sweeper); done(); });
}

module.exports = { registerConnector, createRegistry };
