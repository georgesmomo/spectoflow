'use strict';
/*
 * The second brain — what spectoflow has learned about the user, shared by all their projects.
 * One markdown file, ~/.spectoflow/brain.md (never inside a project, never copied), read and written
 * by the dashboard page, the `spectoflow mcp` server and the `::spectoflow learn` run line. Facts about
 * one project go to the project memory instead (lib/project-memory.js). The file format, its fidelity
 * and its lock live in lib/memory-store.js.
 */
const path = require('path');
const globalConfig = require('./global-config');
const { createMemoryStore } = require('./memory-store');

function brainPath() { return path.join(globalConfig.homeDir(), 'brain.md'); }

const store = createMemoryStore({
  name: 'second brain',
  title: 'Second brain',
  categories: ['profile', 'preferences', 'workflow', 'avoid'],
  headings: { profile: 'Profile', preferences: 'Preferences', workflow: 'Working style', avoid: 'Avoid' },
  fallback: 'preferences',
  idPrefix: 'b',
  defaultFile: brainPath,
  autoAdd: () => globalConfig.get('brain.autoAdd').value !== false,
});

module.exports = { ...store, brainPath };
