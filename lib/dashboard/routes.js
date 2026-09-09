'use strict';
/*
 * The dashboard's HTTP route table — method + path → op name + args extraction — with NO reference
 * to ops.js. Two consumers share it: handlers.js (local hub, calls ops directly) and the online
 * relay server (server/src/relay.js), which turns the same rows into `op` frames sent to the machine.
 * Keeping it dependency-free is what lets the server require it without loading ops.js (which
 * would drag in the runner, the orchestrator, agent detection… none of which exist server-side).
 */
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
  ['POST', '/api/meeting/generate', 'meeting.generate', (_u, b) => b],
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
const findRoute = (method, pathname) => ROUTES.find(([m, matcher]) => m === method && matches(matcher, pathname));

module.exports = { ROUTES, seg, q, matches, findRoute };
