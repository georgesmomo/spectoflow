'use strict';
/*
 * HTTP glue for one project: parse the request, pick the op, call it, serialize. Every operation
 * lives in ops.js (pure, transport-agnostic) — nothing here decides anything about the project.
 *
 * createHandlers(root) returns what a listener-owning process (hub-server.js) needs:
 *   - handleApi(req, res, u, emit): Promise<boolean> — true if this was an API route (handled).
 *     Excludes /api/events: SSE registration stays with whoever owns the HTTP listener.
 *   - watchDirs: dirs (relative to root) whose changes should emit {type:'change'}.
 *   - onBoot(): once per project per process (creates the custom-views dir, clears a stale
 *     in-flight orchestration).
 */
const fs = require('fs');
const path = require('path');
const { ops, OpError } = require('./ops');
const orchestrator = require('./orchestrator');

function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }

const { ROUTES, findRoute } = require('./routes');

function createHandlers(root) {
  async function handleApi(req, res, u, emit) {
    const p = u.pathname;
    const route = findRoute(req.method, p);
    if (!route) return false;
    const [, , opName, args] = route;
    const b = req.method === 'GET' ? {} : await body(req);
    try {
      const result = await ops[opName](root, args(u, b, p), { emit });
      sendJSON(res, 200, result);
    } catch (e) {
      if (e instanceof OpError) sendJSON(res, e.status, { error: e.message });
      else sendJSON(res, 500, { error: String(e && e.message || e) });
    }
    return true;
  }
  function onBoot() {
    try { fs.mkdirSync(path.join(root, '.spectoflow', 'dashboards'), { recursive: true }); } catch (_) {}
    // A process restart loses any in-flight orchestration; clear a stale 'running'/'awaiting_approval'
    // so the 409 guard in orchestrate.start can't wedge forever. Not a resume — just un-wedging.
    try { orchestrator.reconcileOnBoot(root); } catch (_) {}
  }
  return {
    handleApi,
    // The legacy custom-views dir is watched too, until `spectoflow update` migrates it (Task 4/8).
    watchDirs: ['plans', 'specs', '.spectoflow', '.spectoflow/dashboards', '.spectoflow/dashboard/custom'],
    onBoot,
  };
}

module.exports = { createHandlers, ROUTES };
