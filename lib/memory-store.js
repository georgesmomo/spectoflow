'use strict';
/*
 * A memory: durable facts kept in one markdown file, grouped by category, with a "To confirm" section for
 * what an agent learned while the owner wants to validate first. Two instances: the second brain
 * (lib/brain.js — about the user, ~/.spectoflow/brain.md) and the project memory (lib/project-memory.js —
 * about one project, .spectoflow/memory.md, committed). Zero dependency.
 *
 *   # Second brain
 *   ## Profile
 *   - Scrum master and full-stack developer <!-- id:b7k2 by:agent at:2026-09-16 -->
 *   ## To confirm
 *   - [preferences] Prefers pnpm over npm <!-- id:b7k6 by:agent at:2026-09-16 -->
 *
 * The file is the user's too: every line spectoflow doesn't change is written back byte for byte —
 * titles, blank lines, comments, code blocks, unknown sections and their order, hand-written entries.
 * Writers in different processes (hub, MCP servers, runs) take a lock file, then write-then-rename.
 *
 * createMemoryStore({ categories, headings, fallback, title, idPrefix, name, defaultFile, autoAdd })
 *   defaultFile() → the file used when a call passes none; autoAdd(file) → whether an agent's fact is
 *   confirmed right away.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PENDING = 'To confirm';
const MAX_TEXT = 500;

// One line, no HTML-comment delimiters (they would break the metadata), capped.
function cleanText(t) {
  return String(t == null ? '' : t).replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}
// A hand-written line has no id: derive a stable one. `n` tells identical lines of a category apart.
const derivedId = (category, text, n) => 'h' + crypto.createHash('sha1').update(`${category}\n${text}\n${n}`).digest('hex').slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const isBlank = (it) => it.raw !== undefined && !it.raw.trim();

const ENTRY_RE = /^-\s+(?:\[([\w-]+)\]\s+)?(.*?)\s*(?:<!--\s*(.*?)\s*-->)?\s*$/;
function parseMeta(s) {
  const out = {};
  for (const m of String(s || '').matchAll(/(\w+):(\S+)/g)) out[m[1]] = m[2];
  return out;
}

// Cross-process lock: the hub, any number of `spectoflow mcp` processes and runs may write in the
// same instant. A lock older than 10s is a crashed writer's and is taken over.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withLock(file, fn, busyMessage) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`, deadline = Date.now() + 3000;
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.unlinkSync(lock); continue; } } catch (_) {}
      if (Date.now() > deadline) throw Object.assign(new Error(busyMessage), { status: 503 });
      sleepSync(15);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch (_) {} }
}

const notFound = () => Object.assign(new Error('Entry not found.'), { status: 404 });
const emptyText = () => Object.assign(new Error('Text is required.'), { status: 400 });

function createMemoryStore({ categories, headings, fallback, title, idPrefix, name, defaultFile, autoAdd: autoAddFor }) {
  const CATEGORIES = categories, HEADINGS = headings;
  const normCategory = (c) => (CATEGORIES.includes(String(c || '').trim().toLowerCase()) ? String(c).trim().toLowerCase() : fallback);
  const newId = () => idPrefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

  function headingKind(t0) {
    const t = t0.trim().toLowerCase();
    if (t === PENDING.toLowerCase()) return { kind: 'pending' };
    const cat = CATEGORIES.find((c) => c === t || HEADINGS[c].toLowerCase() === t);
    return cat ? { kind: 'category', id: cat } : { kind: 'unknown' };
  }

  // → { title, blocks: [{ kind: preamble|category|pending|unknown, id?, heading?, items: [...] }] }
  // item = { raw } (a line kept verbatim) or an entry { id, category, text, by, at, status, line }.
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const model = { title: null, eol: /\r\n/.test(String(text || '')) ? '\r\n' : '\n', blocks: [{ kind: 'preamble', items: [] }] };
    let block = model.blocks[0], inFence = false;
    const seen = new Map();
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; block.items.push({ raw: line }); continue; }
      if (inFence) { block.items.push({ raw: line }); continue; }
      if (model.title === null && model.blocks.length === 1 && block.items.every(isBlank) && /^#\s+/.test(line)) { model.title = line; continue; }
      const h = line.match(/^##\s+(.*)$/);
      if (h) {
        block = { ...headingKind(h[1]), heading: line, items: [] };
        model.blocks.push(block);
        continue;
      }
      const m = (block.kind === 'category' || block.kind === 'pending') && line.match(ENTRY_RE);
      const meta = m ? parseMeta(m[3]) : null;
      // A trailing comment is never part of the fact (a user's own comment stays hidden: the line itself is
      // written back verbatim while the entry is untouched; editing the entry replaces the line).
      const body = m ? m[2] : '';
      if (m && cleanText(body)) {
        const pending = block.kind === 'pending';
        const category = pending ? normCategory(m[1]) : block.id;
        const entryText = cleanText(pending || !m[1] ? body : `[${m[1]}] ${body}`);
        let id = meta.id;
        if (!id) { const k = `${category}\n${entryText}`; const n = seen.get(k) || 0; seen.set(k, n + 1); id = derivedId(category, entryText, n); }
        block.items.push({ id, category, text: entryText, by: meta.by || 'user', at: meta.at || null, status: pending ? 'pending' : 'confirmed', line });
      } else {
        block.items.push({ raw: line });
      }
    }
    return model;
  }

  function entryLine(e) {
    const meta = `id:${e.id} by:${e.by}${e.at ? ' at:' + e.at : ''}`;
    return `- ${e.status === 'pending' ? `[${e.category}] ` : ''}${e.text} <!-- ${meta} -->`;
  }
  function serialize(model) {
    const out = [model.title || `# ${title}`];
    for (const b of model.blocks) {
      if (b.kind === 'pending' && !b.items.some((it) => it.raw === undefined) && b.items.every(isBlank)) continue;
      if (b.kind !== 'preamble') {
        if (out[out.length - 1].trim()) out.push(''); // a section always follows a blank line
        out.push(b.heading || `## ${b.kind === 'pending' ? PENDING : HEADINGS[b.id]}`);
      }
      for (const it of b.items) out.push(it.raw !== undefined ? it.raw : (it.line && !it.dirty ? it.line : entryLine(it)));
    }
    while (out.length > 1 && !out[out.length - 1].trim()) out.pop();
    const eol = model.eol || '\n';
    return out.join(eol) + eol;
  }

  function emptyModel() {
    return { title: null, blocks: [{ kind: 'preamble', items: [] }, ...CATEGORIES.map((id) => ({ kind: 'category', id, heading: null, items: [] }))] };
  }
  function load(file) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return text.trim() ? parse(text) : emptyModel();
  }
  function save(model, file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, serialize(model));
    fs.renameSync(tmp, file);
  }
  // Read, change, save — under the lock. `fn` returns { result, changed }.
  function mutate(file, fn) {
    return withLock(file, () => {
      const model = load(file);
      const { result, changed } = fn(model);
      if (changed) save(model, file);
      return result;
    }, `The ${name} is busy, try again.`);
  }

  const entriesOf = (model) => model.blocks.flatMap((b) => b.items.filter((it) => it.raw === undefined));
  function find(model, id) {
    for (const b of model.blocks) {
      const i = b.items.findIndex((it) => it.raw === undefined && it.id === id);
      if (i >= 0) return { block: b, i, entry: b.items[i] };
    }
    return null;
  }
  // Append before the block's trailing blank lines, so the spacing before the next heading stays.
  function append(block, entry) {
    let i = block.items.length;
    while (i > 0 && isBlank(block.items[i - 1])) i--;
    block.items.splice(i, 0, entry);
  }
  function blockFor(model, status, category) {
    const want = status === 'pending' ? (b) => b.kind === 'pending' : (b) => b.kind === 'category' && b.id === category;
    let b = model.blocks.find(want);
    if (!b) {
      b = status === 'pending' ? { kind: 'pending', heading: null, items: [] } : { kind: 'category', id: category, heading: null, items: [] };
      const at = status === 'pending' ? -1 : model.blocks.findIndex((x) => x.kind === 'pending');
      if (at < 0) model.blocks.push(b); else model.blocks.splice(at, 0, b);
    }
    return b;
  }

  const autoAdd = (file = defaultFile()) => autoAddFor(file);

  // { entries (confirmed, in category order), pending, autoAdd }
  function read(file = defaultFile()) {
    const all = entriesOf(load(file));
    return {
      entries: CATEGORIES.flatMap((c) => all.filter((e) => e.status === 'confirmed' && e.category === c)),
      pending: all.filter((e) => e.status === 'pending'),
      autoAdd: autoAdd(file),
    };
  }

  // Adds one fact. status 'confirmed' or 'pending'. A case-insensitive duplicate of any entry is not
  // added again: → { duplicate: true, entry: <the existing one> }.
  function add({ category, text, by = 'user', status = 'confirmed' }, file = defaultFile()) {
    const t = cleanText(text);
    if (!t) throw emptyText();
    return mutate(file, (model) => {
      const existing = entriesOf(model).find((e) => e.text.toLowerCase() === t.toLowerCase());
      if (existing) return { result: { duplicate: true, entry: existing }, changed: false };
      const entry = { id: newId(), category: normCategory(category), text: t, by, at: today(), status: status === 'pending' ? 'pending' : 'confirmed' };
      append(blockFor(model, entry.status, entry.category), entry);
      return { result: { duplicate: false, entry }, changed: true };
    });
  }

  // What an agent learned: confirmed right away, or "to confirm", per the store's autoAdd setting.
  function learn({ category, text }, file = defaultFile()) {
    return add({ category, text, by: 'agent', status: autoAdd(file) ? 'confirmed' : 'pending' }, file);
  }

  function get(id, file = defaultFile()) {
    const hit = find(load(file), id);
    if (!hit) throw notFound();
    return hit.entry;
  }

  function update(id, { text, category } = {}, file = defaultFile()) {
    const t = text === undefined ? undefined : cleanText(text);
    if (text !== undefined && !t) throw emptyText();
    return mutate(file, (model) => {
      const hit = find(model, id); if (!hit) throw notFound();
      const e = hit.entry;
      if (t !== undefined) e.text = t;
      if (category !== undefined) {
        const c = normCategory(category);
        if (c !== e.category && e.status === 'confirmed') { hit.block.items.splice(hit.i, 1); append(blockFor(model, 'confirmed', c), e); }
        e.category = c;
      }
      e.dirty = true;
      return { result: e, changed: true };
    });
  }

  function remove(id, file = defaultFile()) {
    return mutate(file, (model) => {
      const hit = find(model, id); if (!hit) throw notFound();
      hit.block.items.splice(hit.i, 1);
      return { result: { ok: true }, changed: true };
    });
  }

  function confirm(id, file = defaultFile()) {
    return mutate(file, (model) => {
      const hit = find(model, id); if (!hit) throw notFound();
      if (hit.entry.status !== 'pending') return { result: hit.entry, changed: false };
      hit.block.items.splice(hit.i, 1);
      hit.entry.status = 'confirmed'; hit.entry.dirty = true;
      append(blockFor(model, 'confirmed', hit.entry.category), hit.entry);
      return { result: hit.entry, changed: true };
    });
  }

  // Confirmed entries as markdown, grouped by category — what an agent is given.
  function renderForAgent(file = defaultFile()) {
    const { entries } = read(file);
    return CATEGORIES.map((c) => {
      const items = entries.filter((e) => e.category === c);
      return items.length ? `## ${HEADINGS[c]}\n${items.map((e) => `- ${e.text}`).join('\n')}` : '';
    }).filter(Boolean).join('\n\n');
  }

  return { CATEGORIES, HEADINGS, MAX_TEXT, normCategory, parse, serialize, read, add, learn, get, update, remove, confirm, renderForAgent, autoAdd };
}

module.exports = { createMemoryStore, MAX_TEXT };
