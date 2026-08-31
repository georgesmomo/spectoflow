'use strict';
/*
 * Dashboard design registry. Each entry is a selectable visual "skin" applied via the
 * `data-design="<id>"` attribute on <html>. The switcher in Settings is built from this list.
 *
 * TO ADD A DESIGN (3 easy steps, no other code changes needed):
 *   1. Append an entry here: { id, name, desc }.  The id must be a slug (kebab-case).
 *   2. In styles.css, add a scoped block that overrides the design tokens (and, if the design
 *      needs it, component rules) under that id:
 *          :root[data-design="<id>"]              { --bg:…; --surface:…; --signal:…; … }
 *          :root[data-design="<id>"][data-theme="light"] { … light-mode overrides … }
 *          :root[data-design="<id>"] .kpi { … optional component tweaks … }
 *      Everything is token-driven, so most designs are just a palette override.
 *   3. That's it — the design shows up in Settings → Dashboard design and can be switched live.
 *
 * The active design is persisted per viewer (localStorage 'spf-design') and, when changed, also
 * written to config.json (config.design) as the project default. Fonts stay system-only (the
 * dashboard is zero-dependency and offline-capable), so designs express themselves through colour,
 * surfaces, radius, shadow and spacing rather than web fonts.
 */
(function (root) {
  const DESIGNS = [
    { id: 'control-room', name: 'Control Room', desc: 'Dark violet engineering control room — the original.' },
    { id: 'obsidian',     name: 'Obsidian Ops',  desc: 'Near-black mission-control — electric lime + cyan, mono type, Linear/Vercel precision.' },
    { id: 'neon-command', name: 'Neon Command',  desc: 'Glassmorphism — aurora violet + cyan, Space Grotesk display, control-room ambiance.' },
    { id: 'mission',      name: 'Mission Control', desc: 'Indigo control panel on solid slate — clean, flat, status-coloured.' },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = DESIGNS;
  else root.DESIGNS = DESIGNS;
})(typeof window !== 'undefined' ? window : globalThis);
