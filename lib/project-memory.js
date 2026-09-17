'use strict';
/*
 * The project memory — durable facts about ONE project (conventions, pitfalls, glossary, constraints),
 * true whoever works on it. `.spectoflow/memory.md`, committed with the code: team knowledge that follows
 * the project's history. Never anything personal (that is the second brain, lib/brain.js).
 *
 * Not shipped by the kit — created on first write — so `spectoflow update` never touches it. Agents read
 * and write the file directly; the dashboard goes through here. `config.json → memoryAutoAdd` (default
 * true, per project) decides whether an agent's fact lands confirmed or under "To confirm". (D78)
 */
const fs = require('fs');
const path = require('path');
const { createMemoryStore } = require('./memory-store');

const REL = '.spectoflow/memory.md';
const fileFor = (root) => path.join(root, '.spectoflow', 'memory.md');

// The store is keyed by file; the project's config sits next to it.
function autoAddFor(file) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'config.json'), 'utf8')).memoryAutoAdd !== false; } catch { return true; }
}

const store = createMemoryStore({
  name: 'project memory',
  title: 'Project memory',
  categories: ['conventions', 'pitfalls', 'glossary', 'constraints'],
  headings: { conventions: 'Conventions', pitfalls: 'Pitfalls', glossary: 'Glossary', constraints: 'Constraints' },
  fallback: 'conventions',
  idPrefix: 'm',
  defaultFile: () => { throw new Error('project memory: a file is required'); },
  autoAdd: autoAddFor,
});

module.exports = { ...store, REL, fileFor };
