'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROUTES_PATH = path.resolve(__dirname, '..', 'lib', 'dashboard', 'routes.js');
const OPS_PATH = path.resolve(__dirname, '..', 'lib', 'dashboard', 'ops.js');

test('routes.js loads without pulling ops.js into the require cache (the server relies on this)', () => {
  delete require.cache[ROUTES_PATH]; delete require.cache[OPS_PATH];
  const routes = require(ROUTES_PATH);
  assert.ok(Array.isArray(routes.ROUTES) && routes.ROUTES.length >= 20);
  assert.strictEqual(require.cache[OPS_PATH], undefined, 'ops.js must not be loaded by routes.js');
});

test('every route names an op that exists, and every op is reachable by exactly one route', () => {
  const { ROUTES } = require(ROUTES_PATH);
  const { ops } = require(OPS_PATH);
  const named = ROUTES.map((r) => r[2]);
  for (const op of named) assert.ok(typeof ops[op] === 'function', `op ${op} missing in ops.js`);
  for (const op of Object.keys(ops)) assert.strictEqual(named.filter((n) => n === op).length, 1, `op ${op} should have exactly one route`);
});

test('findRoute matches method + path and extracts args the same way handlers.js does', () => {
  const { findRoute, seg } = require(ROUTES_PATH);
  const u = new URL('http://x/api/task/T-007?p=abc123');
  const r = findRoute('PATCH', u.pathname);
  assert.strictEqual(r[2], 'task.update');
  assert.deepStrictEqual(r[3](u, { status: 'done' }, u.pathname), { id: 'T-007', patch: { status: 'done' } });
  assert.strictEqual(findRoute('GET', '/api/nope'), undefined);
  assert.strictEqual(seg('/api/task/T-1%202', 3), 'T-1 2');
});

test('handlers.js re-exports the very same ROUTES array', () => {
  const routes = require(ROUTES_PATH);
  const handlers = require(path.resolve(__dirname, '..', 'lib', 'dashboard', 'handlers.js'));
  assert.strictEqual(handlers.ROUTES, routes.ROUTES);
});
