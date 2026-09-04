/* Spectral Console — command palette (Ctrl/Cmd+K). Only active while
   document.documentElement.dataset.design === 'console'; watches for live design switches. */
(function () {
  'use strict';
  var active = false;
  var searchBtn = null;
  var overlay = null;
  var items = [];
  var filtered = [];
  var selIdx = 0;

  function buildItems() {
    var out = [];
    document.querySelectorAll('#tabs .tab').forEach(function (tab) {
      var label = tab.querySelector('.tab-label');
      var text = label ? label.textContent.trim() : (tab.dataset.tab || 'tab');
      out.push({ text: 'Go to ' + text, tag: 'nav', run: function () { tab.click(); } });
    });
    var runBtn = document.getElementById('runQuickBtn');
    if (runBtn) out.push({ text: 'Run · open chat', tag: 'action', run: function () { runBtn.click(); } });
    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) out.push({ text: 'Toggle theme', tag: 'action', run: function () { themeBtn.click(); } });
    return out;
  }

  function renderList(q) {
    var list = overlay.querySelector('.cx-list');
    filtered = !q ? items : items.filter(function (it) { return it.text.toLowerCase().indexOf(q.toLowerCase()) !== -1; });
    selIdx = 0;
    list.innerHTML = '';
    if (!filtered.length) {
      var empty = document.createElement('div');
      empty.className = 'cx-empty';
      empty.textContent = 'No matches';
      list.appendChild(empty);
      return;
    }
    filtered.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'cx-item' + (i === 0 ? ' is-sel' : '');
      row.innerHTML = '<span>' + it.text.replace(/</g, '&lt;') + '</span><span class="cx-tag">' + it.tag + '</span>';
      row.addEventListener('click', function () { runItem(i); });
      list.appendChild(row);
    });
  }

  function highlight() {
    overlay.querySelectorAll('.cx-item').forEach(function (row, i) {
      row.classList.toggle('is-sel', i === selIdx);
    });
    var sel = overlay.querySelector('.cx-item.is-sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function runItem(i) {
    var it = filtered[i];
    if (!it) return;
    close();
    try { it.run(); } catch (e) { /* no-op: target control may not exist in this view */ }
  }

  function open() {
    if (overlay || !active) return;
    items = buildItems();
    overlay = document.createElement('div');
    overlay.className = 'cx-cmdk';
    overlay.innerHTML =
      '<div class="cx-panel">' +
      '<input type="text" placeholder="Go to a tab, run, toggle theme…" autocomplete="off" spellcheck="false" />' +
      '<div class="cx-list"></div>' +
      '<div class="cx-foot"><span>↑↓ navigate</span><span>↵ select</span><span>esc close</span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    renderList('');
    var input = overlay.querySelector('input');
    input.focus();
    input.addEventListener('input', function () { renderList(input.value); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, filtered.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(selIdx); }
    });
  }

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function onKeydown(e) {
    if (!active) return;
    var k = e.key === 'k' || e.key === 'K';
    if (k && (e.metaKey || e.ctrlKey)) { e.preventDefault(); overlay ? close() : open(); }
  }

  function injectButton() {
    if (searchBtn || document.getElementById('cxSearchBtn')) return;
    var host = document.querySelector('.top-right');
    if (!host) return;
    searchBtn = document.createElement('button');
    searchBtn.id = 'cxSearchBtn';
    searchBtn.className = 'cx-search-btn';
    searchBtn.type = 'button';
    searchBtn.title = 'Command palette';
    searchBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<span>Search…</span><kbd>⌘K</kbd>';
    searchBtn.addEventListener('click', open);
    host.insertBefore(searchBtn, host.firstChild);
  }

  function removeButton() {
    if (searchBtn) { searchBtn.remove(); searchBtn = null; }
  }

  // The topbar has a backdrop-filter, which makes it the containing block of any position:fixed
  // descendant — so a "fixed" rail inside it would be clipped to the header's height and scroll
  // away. Dock the tab nav directly under <body> while this design is on; put it back on leave.
  var tabsHome = null;
  function dockRail() {
    var t = document.getElementById('tabs');
    if (!t || t.parentElement === document.body) return;
    tabsHome = { parent: t.parentElement, next: t.nextSibling };
    document.body.appendChild(t);
  }
  function undockRail() {
    var t = document.getElementById('tabs');
    if (!t || !tabsHome) return;
    tabsHome.parent.insertBefore(t, tabsHome.next);
    tabsHome = null;
  }

  // ---- rail expand/collapse — icon-only stays the default; a viewer can opt into showing the
  // menu names too, persisted per browser (like the Board's List/Kanban toggle). ----
  var railToggle = null;
  function railExpanded() {
    try { return localStorage.getItem('spf-console-rail') === 'expanded'; } catch (e) { return false; }
  }
  function applyRailState() {
    var expanded = railExpanded();
    document.documentElement.setAttribute('data-rail', expanded ? 'expanded' : 'collapsed');
    if (railToggle) railToggle.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
    var label = railToggle && railToggle.querySelector('.cx-rail-toggle-label');
    if (label) label.textContent = expanded ? 'Collapse' : 'Expand';
  }
  function toggleRail() {
    var expanded = !railExpanded();
    try { localStorage.setItem('spf-console-rail', expanded ? 'expanded' : 'collapsed'); } catch (e) {}
    applyRailState();
  }
  function injectRailToggle() {
    if (railToggle || document.getElementById('cxRailToggle')) return;
    railToggle = document.createElement('button');
    railToggle.id = 'cxRailToggle';
    railToggle.type = 'button';
    railToggle.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
      '<span class="cx-rail-toggle-label"></span>';
    railToggle.addEventListener('click', toggleRail);
    document.body.appendChild(railToggle);
    applyRailState();
  }
  function removeRailToggle() {
    if (railToggle) { railToggle.remove(); railToggle = null; }
    document.documentElement.removeAttribute('data-rail');
  }

  function activate() {
    if (active) return;
    active = true;
    dockRail();
    injectButton();
    injectRailToggle();
    document.addEventListener('keydown', onKeydown);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    close();
    removeButton();
    removeRailToggle();
    undockRail();
    document.removeEventListener('keydown', onKeydown);
  }

  function sync() {
    if (document.documentElement.dataset.design === 'console') activate();
    else deactivate();
  }

  sync();
  var mo = new MutationObserver(sync);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-design'] });
  // .top-right may not exist yet on first paint in some load orders — retry once shortly after.
  if (document.documentElement.dataset.design === 'console' && !document.getElementById('cxSearchBtn')) {
    setTimeout(injectButton, 300);
  }
})();
