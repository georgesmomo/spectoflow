'use strict';
/*
 * Shared by both dashboard surfaces — the local hub (hub-server.js) and the online relay
 * (server/src/app.js) — so a project's own configured design (config.design) is stamped onto the
 * served index.html's <html data-design="..."> attribute BEFORE the file ever reaches the browser,
 * for a viewer's very first-ever page load (no localStorage value saved yet to reconcile against
 * client-side — see app.js's IIFE at the top of the file and the reconciliation in renderSettings()).
 * A per-viewer localStorage choice, once one exists, always wins — this only fills that first-paint
 * gap, never overrides it.
 */

// Mirrors app.js's currentDesign() own default ('console') when the attribute is absent — same
// fallback a project with no design saved yet (or an unresolvable project) would land on anyway.
const DEFAULT_DESIGN = 'console';

// Only ever accept a value shaped like a real design id (lib/dashboard/public/designs.js registers
// them as lowercase-alnum-hyphen) — never trust an arbitrary stored/cached string into the HTML.
function sanitizeDesign(d) {
  return (typeof d === 'string' && /^[a-z0-9-]{1,40}$/.test(d)) ? d : DEFAULT_DESIGN;
}

// Rewrites (or adds) the <html> tag's data-design attribute to the given value — leaves everything
// else in the file untouched, including any data-theme (no per-project theme preference exists in
// config today; theme stays purely a per-viewer localStorage choice + prefers-color-scheme, D25).
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
