'use strict';
/*
 * The local hub's outbound connector to an online dashboard (docs/online-dashboard-connector-design.md §2).
 * One connection per machine; JSON frames, identical on both transports:
 *   up:   auth {token,version} · hello {machineName,projects} · event {p,event} · snapshot {p,project} · reply {reqId,result|error} · pong
 *   down: auth-ok {machineId} · op {reqId,p,op,args} · ping
 * Transport 1 is Node's native WebSocket client (zero-dep, Node ≥ 22); transport 2 is HTTP long-poll
 * (POST batches + GET held ≤ 25 s) for hosts that don't pass WebSockets (cPanel/Passenger). The hub
 * decides nothing here: it hands in listPublished/readSnapshot/execOp and tees its emit into
 * pushEvent/pushSnapshot. Reconnection: exponential backoff 1 s → 30 s with jitter; after an upgrade
 * failure or 3 drops in 60 s the connector falls back to HTTP and retries WebSocket every 10 min.
 * The token travels in-band (auth frame / Authorization header) — never in a URL, never logged.
 */
const DEFAULT_TIMING = { backoffMin: 1000, backoffMax: 30000, dropWindow: 60000, dropLimit: 3, wsRetryEvery: 600000, pollTimeout: 35000, wsOpenTimeout: 15000 };
const REJECTED = 'token rejected by the server — run `spectoflow dashboard login` again';

function createConnector(opts) {
  const { token, machineName, listPublished, readSnapshot, execOp } = opts;
  const version = opts.version || '0.0.0';
  const base = String(opts.url || '').replace(/\/+$/, '');
  const preferred = opts.transport === 'http' ? 'http' : 'ws';
  const timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const log = opts.log || (() => {});

  const state = { connected: false, lastError: null, machineId: null, attempts: 0, since: null };
  let mode = preferred;          // transport in use ('ws' | 'http'); may fall back to 'http'
  let stopped = true;
  let active = null;             // the live transport: { send(frame), close() }
  let generation = 0;            // bumps on every connect/stop so a stale transport's callbacks are ignored
  const drops = [];
  let reconnectTimer = null, wsRetryTimer = null;

  function status() {
    return { url: base, machineName, connected: state.connected, transport: mode, lastError: state.lastError, machineId: state.machineId, since: state.since };
  }

  // ---- frames ----
  async function handleDownward(frame, send) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'auth-ok') { state.machineId = frame.machineId || null; onConnected(); return; }
    if (frame.type === 'ping') { send({ type: 'pong' }); return; }
    if (frame.type === 'op') {
      let reply;
      try {
        const result = await execOp(frame.p, frame.op, frame.args || {});
        reply = { type: 'reply', reqId: frame.reqId, result: result === undefined ? {} : result };
      } catch (e) {
        reply = { type: 'reply', reqId: frame.reqId, error: { status: Number(e && e.status) || 500, message: String(e && e.message || e) } };
      }
      send(reply);
    }
  }
  function onConnected() {
    state.connected = true; state.lastError = null; state.attempts = 0; state.since = new Date().toISOString();
    log(`online dashboard: connected to ${base} (${mode})`);
    announce();
  }
  async function announce() {
    const t = active;
    if (!t || !state.connected) return;
    const projects = listPublished();
    t.send({ type: 'hello', machineName, projects });
    for (const p of projects) {
      try { const project = await readSnapshot(p.localId); if (project && t === active) t.send({ type: 'snapshot', p: p.localId, project }); }
      catch (e) { log(`online dashboard: snapshot of ${p.localId} failed: ${e.message}`); }
    }
  }
  function pushEvent(localId, event) { if (active && state.connected) active.send({ type: 'event', p: localId, event }); }
  function pushSnapshot(localId, project) { if (active && state.connected) active.send({ type: 'snapshot', p: localId, project }); }

  // ---- lifecycle ----
  function onDisconnected(gen, err, { upgradeFailed = false } = {}) {
    if (gen !== generation) return;           // a transport we already replaced
    const was = state.connected;
    state.connected = false; active = null;
    if (err) state.lastError = String(err.message || err);
    if (was) log(`online dashboard: disconnected from ${base}${err ? ' — ' + state.lastError : ''}`);
    if (stopped) return;
    if (mode === 'ws' && preferred === 'ws') {
      const now = Date.now();
      drops.push(now); while (drops.length && now - drops[0] > timing.dropWindow) drops.shift();
      if (upgradeFailed || drops.length >= timing.dropLimit) {
        mode = 'http'; drops.length = 0;
        log('online dashboard: WebSocket unavailable, falling back to HTTP long-poll');
        scheduleWsRetry();
      }
    }
    scheduleReconnect();
  }
  function backoff() {
    const exp = Math.min(timing.backoffMax, timing.backoffMin * 2 ** Math.min(state.attempts, 10));
    state.attempts++;
    return Math.round(exp * (0.75 + Math.random() * 0.5));
  }
  function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, backoff()); }
  function scheduleWsRetry() {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => { if (!stopped && mode === 'http') { mode = 'ws'; forceReconnect(); } }, timing.wsRetryEvery);
  }
  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    const gen = ++generation;
    active = mode === 'http' ? httpTransport(gen) : wsTransport(gen);
  }
  function start() { if (!stopped) return; stopped = false; mode = preferred; state.attempts = 0; connect(); }
  function stop() {
    stopped = true; generation++;
    clearTimeout(reconnectTimer); clearTimeout(wsRetryTimer);
    const t = active; active = null; state.connected = false;
    if (t) t.close();
  }
  function forceReconnect() {
    if (stopped) return;
    const t = active; generation++; active = null; state.connected = false; state.attempts = 0;
    if (t) t.close();
    connect();
  }

  // ---- transport 1: native WebSocket ----
  // A handshake that never resolves (no open/error/close at all — observed on some platforms when
  // the server rejects the upgrade with a plain HTTP response) must still fail: wsOpenTimeout bounds
  // it so the connector always falls back to HTTP instead of hanging forever in 'ws' mode.
  function wsTransport(gen) {
    let ws, opened = false, settled = false, lastErr = null;
    const settle = (err, opts) => { if (settled) return; settled = true; clearTimeout(openTimer); onDisconnected(gen, err, opts); };
    try { ws = new WebSocket(base.replace(/^http/, 'ws') + '/connector/ws'); }
    catch (e) { setImmediate(() => settle(e, { upgradeFailed: true })); return { send() {}, close() {} }; }
    const openTimer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      settle(new Error('WebSocket handshake timed out'), { upgradeFailed: true });
    }, timing.wsOpenTimeout);
    const send = (frame) => { if (ws.readyState === 1) ws.send(JSON.stringify(frame)); };
    ws.addEventListener('open', () => { opened = true; clearTimeout(openTimer); send({ type: 'auth', token, version }); });
    ws.addEventListener('message', (ev) => { let f; try { f = JSON.parse(String(ev.data)); } catch { return; } handleDownward(f, send); });
    ws.addEventListener('error', (ev) => { lastErr = new Error((ev && ev.message) || 'websocket error'); });
    ws.addEventListener('close', (ev) => {
      const code = ev && ev.code;
      const err = code === 4401 ? new Error(REJECTED) : lastErr || (code && code !== 1000 && code !== 1005 ? new Error(`connection closed (${code}${ev.reason ? ' ' + ev.reason : ''})`) : null);
      settle(err, { upgradeFailed: !opened });
    });
    return { send, close: () => { clearTimeout(openTimer); try { ws.close(1000); } catch (_) {} } };
  }

  // ---- transport 2: HTTP long-poll ----
  // Upward frames are POSTed in batches, strictly one batch in flight at a time (ordering). Downward
  // frames arrive in the POST responses and through a GET loop the server holds open ≤ 25 s. The first
  // batch carries `auth` so the frame sequence is the same as on WebSocket; the Authorization header is
  // what actually authenticates every request.
  function httpTransport(gen) {
    const ac = new AbortController();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let queue = [{ type: 'auth', token, version }];
    let flushing = false, closed = false;
    const alive = () => !closed && gen === generation;
    const signal = () => AbortSignal.any([ac.signal, AbortSignal.timeout(timing.pollTimeout)]);
    const fail = (e) => { if (!alive()) return; closed = true; ac.abort(); onDisconnected(gen, e); };
    const check = (res, what) => {
      if (res.status === 401) throw new Error(REJECTED);
      if (!res.ok) throw new Error(`${what} /connector/frames → HTTP ${res.status}`);
      return res.json();
    };
    async function flush() {
      if (flushing) return;
      flushing = true;
      try {
        while (alive() && queue.length) {
          const batch = queue; queue = [];
          const res = await fetch(base + '/connector/frames', { method: 'POST', headers, body: JSON.stringify(batch), signal: signal() });
          const down = await check(res, 'POST');
          for (const f of down) handleDownward(f, send);   // not awaited: a slow op must not stall the batch loop
        }
      } catch (e) { fail(e); } finally { flushing = false; }
    }
    async function poll() {
      try {
        while (alive()) {
          const res = await fetch(base + '/connector/frames', { headers: { Authorization: headers.Authorization }, signal: signal() });
          if (!alive()) return;
          const down = await check(res, 'GET');
          for (const f of down) handleDownward(f, send);   // not awaited: a slow op must not stall the batch loop
        }
      } catch (e) { fail(e); }
    }
    function send(frame) { if (!alive()) return; queue.push(frame); flush(); }
    flush(); poll();
    return { send, close: () => { closed = true; ac.abort(); } };
  }

  return { start, stop, status, announce, pushEvent, pushSnapshot, forceReconnect };
}

module.exports = { createConnector, DEFAULT_TIMING };
