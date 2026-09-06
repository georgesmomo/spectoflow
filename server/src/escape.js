'use strict';
/*
 * The one server-side HTML-escape helper. Any user-controlled or DB-sourced string interpolated
 * into an HTML response (a served page, or an emailed HTML body) must go through this first.
 * Client-side inline `esc()` functions (account.js/admin.js's `<script>` blocks, which run in the
 * browser) intentionally stay separate, small, inline copies — a Node module can't be imported into
 * inline browser script — but their escape map is kept identical to this one by hand.
 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { escapeHtml };
