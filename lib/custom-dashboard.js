'use strict';
/*
 * Pure helpers for user-generated custom dashboards (.spectoflow/dashboards/<id>.json).
 *
 * A custom dashboard is a DECLARATIVE block spec, never raw HTML/CSS/JS: the generating agent picks
 * blocks from a fixed vocabulary (BLOCK_TYPES) that the dashboard already knows how to render, using
 * the exact same token-driven components (kpi cards, bars, donut, tables…) the built-in Board uses.
 * That is what guarantees a custom dashboard always matches the active design — including any design
 * the user switches to later — with zero per-dashboard styling to keep in sync, and no arbitrary code
 * ever running in the dashboard.
 *
 * Zero dependency; consumed by lib/dashboard/handlers.js (Node) via readCustomDashboards() in
 * store.js. The browser-side renderer (dashboard/public/app.js) re-implements the tiny `resolveBind`
 * walk independently — sharing code across the Node/browser boundary would need a build step, which
 * this project avoids on purpose (see CLAUDE.md's zero-runtime-dependency invariant).
 */

// Every block a generated dashboard may use. Adding a new type here is how the vocabulary grows —
// pair it with a matching case in app.js's renderCustomBlock().
const BLOCK_TYPES = new Set([
  'markdown',       // rendered prose — a spec excerpt, an explanation, a summary
  'kpi-row',        // a row of big-number stat cards, each optionally live-bound
  'chart-bars',      // horizontal progress/comparison bars
  'chart-donut',     // a status/category breakdown donut + legend
  'table',           // a simple column/row data table
  'list',            // a flat bullet list
  'stat-tile-row',   // a row of compact stat tiles (value/label/sub)
]);

// A small, explicit allow-list of live data paths a block may `bind` to, resolved against the same
// stats object SpectoStats.stats(P) already computes for the built-in Board — never an arbitrary
// expression, just a dotted property walk, so there is nothing to sandbox or evaluate.
// Mirrors the exact shape SpectoStats.stats(P) returns (dashboard/public/stats.js):
// { total, done, pct, byStatus, phases, toAsk, running, statuses }.
const BIND_ROOTS = new Set(['pct', 'done', 'total', 'byStatus', 'phases', 'toAsk', 'running', 'statuses']);

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

// A conservative, curated icon key set — the same ICON map the rest of the dashboard already uses
// (icons.js), so a custom dashboard's tab never introduces a one-off, unstyled icon.
const ICON_KEYS = new Set(['board', 'requests', 'backlog', 'workflow', 'agents', 'chat', 'info', 'attention', 'settings']);

function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

// Validates one block. Returns a list of error strings (empty = valid). Deliberately permissive on
// the *content* fields (labels, values, markdown text are free text) — it only enforces the block's
// *shape* (a known type, and that any `bind` path starts from an allowed root) so a slightly unusual
// but well-typed spec still renders rather than being rejected outright.
function validateBlock(b, i) {
  const errs = [];
  const at = `blocks[${i}]`;
  if (!isPlainObject(b)) { errs.push(`${at} is not an object`); return errs; }
  if (!BLOCK_TYPES.has(b.type)) errs.push(`${at}.type "${b.type}" is not a known block type (${[...BLOCK_TYPES].join(', ')})`);
  const binds = [];
  if (typeof b.bind === 'string') binds.push(b.bind);
  if (Array.isArray(b.items)) b.items.forEach((it) => { if (it && typeof it.bind === 'string') binds.push(it.bind); });
  if (Array.isArray(b.rows)) b.rows.forEach((r) => { if (r && typeof r.bind === 'string') binds.push(r.bind); });
  if (Array.isArray(b.segments)) b.segments.forEach((s) => { if (s && typeof s.bind === 'string') binds.push(s.bind); });
  binds.forEach((p) => { const root = String(p).split('.')[0]; if (!BIND_ROOTS.has(root)) errs.push(`${at} has an unbound bind path "${p}" (must start with one of: ${[...BIND_ROOTS].join(', ')})`); });
  return errs;
}

// Validates a whole dashboard spec as read from disk. Never throws — callers (store.js) should skip
// an invalid file rather than let one bad custom dashboard break the whole /api/project response.
function validateSpec(spec) {
  const errors = [];
  if (!isPlainObject(spec)) return { valid: false, errors: ['not an object'] };
  if (!ID_RE.test(String(spec.id || ''))) errors.push('id must be lowercase kebab-case, starting with a letter, 1-40 chars');
  if (!spec.title || typeof spec.title !== 'string') errors.push('title is required (a short display name)');
  if (spec.icon != null && !ICON_KEYS.has(spec.icon)) errors.push(`icon "${spec.icon}" is not one of: ${[...ICON_KEYS].join(', ')}`);
  if (!Array.isArray(spec.blocks) || !spec.blocks.length) errors.push('blocks must be a non-empty array');
  else spec.blocks.forEach((b, i) => errors.push(...validateBlock(b, i)));
  return { valid: errors.length === 0, errors };
}

module.exports = { BLOCK_TYPES, BIND_ROOTS, ICON_KEYS, validateSpec, validateBlock };
