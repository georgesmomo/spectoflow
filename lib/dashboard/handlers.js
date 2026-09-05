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

const seg = (p, i) => decodeURIComponent(p.split('/')[i] || '');
const q = (u, k) => u.searchParams.get(k) || '';
// [method, matcher, op, args(u, body, pathname)]
const ROUTES = [
  ['GET', '/api/project', 'project.read', () => ({})],
  ['GET', '/api/agentfile', 'agentfile.read', (u) => ({ path: q(u, 'path') })],
  ['GET', '/api/files/tree', 'files.tree', () => ({})],
  ['GET', '/api/files/read', 'files.read', (u) => ({ path: q(u, 'path') })],
  ['POST', '/api/files/write', 'files.write', (_u, b) => b],
  ['POST', '/api/files/mkdir', 'files.mkdir', (_u, b) => b],
  ['POST', '/api/task', 'task.add', (_u, b) => b],
  ['PATCH', /^\/api\/task\/[^/]+$/, 'task.update', (_u, b, p) => ({ id: seg(p, 3), patch: b })],
  ['POST', /^\/api\/task\/[^/]+\/comment$/, 'task.comment', (_u, b, p) => ({ id: seg(p, 3), text: b.text, action: b.action })],
  ['POST', '/api/workflow/toggle', 'workflow.toggle', (_u, b) => b],
  ['POST', '/api/run', 'run.start', (_u, b) => b],
  ['POST', '/api/chat/summarize', 'chat.summarize', (_u, b) => b],
  ['POST', '/api/chat/clear', 'chat.clear', () => ({})],
  ['POST', '/api/orchestrate', 'orchestrate.start', (_u, b) => b],
  ['POST', '/api/orchestrate/approve', 'orchestrate.approve', (_u, b) => b],
  ['POST', '/api/settings', 'settings.save', (_u, b) => b],
  ['POST', '/api/attention', 'attention.add', (_u, b) => b],
  ['POST', /^\/api\/attention\/[^/]+\/promote$/, 'attention.promote', (_u, _b, p) => ({ id: seg(p, 3) })],
  ['PATCH', /^\/api\/attention\/[^/]+$/, 'attention.update', (_u, b, p) => ({ id: seg(p, 3), patch: b })],
  ['DELETE', /^\/api\/attention\/[^/]+$/, 'attention.remove', (_u, _b, p) => ({ id: seg(p, 3) })],
];
const matches = (m, p) => (typeof m === 'string' ? m === p : m.test(p));

function createHandlers(root) {
  async function handleApi(req, res, u, emit) {
    const p = u.pathname;
    const route = ROUTES.find(([method, m]) => method === req.method && matches(m, p));
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
