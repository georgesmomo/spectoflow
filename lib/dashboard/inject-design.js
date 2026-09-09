'use strict';
/*
 * Shared by both dashboard surfaces — the local hub (hub-server.js) and the online relay
 * (server/src/app.js) — so a project's own configured design (config.design) is stamped onto the
 * served index.html's <html data-design="..."> attribute BEFORE the file ever reaches the browser.
 * Design is a shared, project-level setting (not a per-viewer choice, Sous-projet B) — this is the
 * ONLY place the design attribute is ever set for first paint; app.js has no localStorage fallback
 * or reconciliation for it any more, it only reflects P.config.design once the client boots.
 */

// Mirrors app.js's currentDesign() own default ('console') when the attribute is absent — same
// fallback a project with no design saved yet (or an unresolvable project) would land on anyway.
const DEFAULT_DESIGN = 'console';

// The real, live registry of selectable designs (lib/dashboard/public/designs.js) — required, not
// re-declared here, so an id added/removed there is instantly reflected here with zero drift risk.
const DESIGNS = require('./public/designs.js');
const KNOWN_IDS = new Set(DESIGNS.map((d) => d.id));

// Only ever accept a value that is one of the real, currently-registered design ids — never trust an
// arbitrary stored/cached string into the HTML (that would be an injection risk), and never trust a
// shape-valid but unregistered id either (a stale/typo'd/removed design would silently produce an
// unstyled page instead of falling back to the same default a missing value gets).
function sanitizeDesign(d) {
  return (typeof d === 'string' && KNOWN_IDS.has(d)) ? d : DEFAULT_DESIGN;
}

// Rewrites (or adds) the <html> tag's data-design attribute to the given value — leaves everything
// else in the file untouched, including data-theme (config.theme is applied client-side once app.js
// boots, same as before — this injector was only ever built to solve design's first-paint flash).
function injectDesign(html, design) {
  const safe = sanitizeDesign(design);
  return html.replace(/<html([^>]*)>/i, (full, attrs) => {
    const newAttrs = /\bdata-design=/.test(attrs)
      ? attrs.replace(/data-design="[^"]*"/, `data-design="${safe}"`)
      : `${attrs} data-design="${safe}"`;
    return `<html${newAttrs}>`;
  });
}

module.exports = { injectDesign, sanitizeDesign, DEFAULT_DESIGN };
