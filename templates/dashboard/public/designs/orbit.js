'use strict';
/*
 * Orbit design behavior: replaces the hidden tab bar with a round "hub" button (live global %)
 * that opens a full-screen radial menu built from the very same #tabs buttons — so all routing
 * stays owned by app.js; this file only clones markup and forwards clicks/keys to the real tabs.
 * Active only while document.documentElement.dataset.design === 'orbit'; watches that attribute
 * so switching designs live cleanly builds/tears down without touching any other file.
 */
(function () {
  var active = false;
  var hubEl = null, ovEl = null, tabsObserver = null, fillObserver = null, pctInterval = null;
  var state = { open: false };

  function isOrbit() { return document.documentElement.getAttribute('data-design') === 'orbit'; }
  function tabs() { return Array.prototype.slice.call(document.querySelectorAll('#tabs .tab')); }
  function activeIndex(list) { var i = list.findIndex(function (t) { return t.classList.contains('is-active'); }); return i < 0 ? 0 : i; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function chevSvg(dir) {
    var d = { up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6' }[dir];
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  }

  /* ---- hub button (injected into .brand) ---- */
  function buildHub() {
    if (hubEl) return;
    var brand = document.querySelector('.brand');
    if (!brand) return;
    hubEl = document.createElement('button');
    hubEl.type = 'button';
    hubEl.className = 'ob-hub';
    hubEl.title = 'Menu (M)';
    hubEl.setAttribute('aria-haspopup', 'dialog');
    hubEl.innerHTML = '<span class="ob-pct">0%</span>';
    brand.insertBefore(hubEl, brand.firstChild);
    hubEl.addEventListener('click', toggleOverlay);
  }
  function removeHub() { if (hubEl) { hubEl.remove(); hubEl = null; } }

  /* ---- global progress % — read #globalMeterFill's width, kept live ---- */
  function updatePct() {
    var fill = document.getElementById('globalMeterFill');
    var pct = 0;
    if (fill && fill.style && fill.style.width) pct = parseFloat(fill.style.width) || 0;
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    if (hubEl) { var hp = hubEl.querySelector('.ob-pct'); if (hp) hp.textContent = pct + '%'; }
    if (ovEl) {
      var cp = ovEl.querySelector('.ob-center .ob-pct'); if (cp) cp.textContent = pct + '%';
      var prog = ovEl.querySelector('.ob-prog');
      if (prog) { var C = 804.2, len = (pct / 100 * C).toFixed(1); prog.setAttribute('stroke-dasharray', len + ' ' + C); }
    }
  }

  /* ---- radial overlay ---- */
  function buildOverlay() {
    if (ovEl) return;
    var list = tabs(), n = list.length || 1;
    var idx = activeIndex(list);
    var items = list.map(function (tab, i) {
      var angle = -90 + i * (360 / n);
      var ico = tab.querySelector('.tab-ico');
      var lbl = tab.querySelector('.tab-label');
      var badgeEl = tab.querySelector('.tab-badge');
      var badge = badgeEl && !badgeEl.hidden ? '<span class="ob-bd">' + escapeHtml(badgeEl.textContent) + '</span>' : '';
      var cls = 'ob-item' + (i === idx ? ' is-active' : '');
      return '<button type="button" class="' + cls + '" style="--a:' + angle + 'deg" data-tab-idx="' + i + '">' + badge +
        '<span class="ob-ico">' + (ico ? ico.innerHTML : '') + '</span>' +
        '<span class="ob-lb">' + escapeHtml(lbl ? lbl.textContent : '') + '</span></button>';
    }).join('');
    var markerAngle = idx * (360 / n);
    ovEl = document.createElement('div');
    ovEl.className = 'ob-ov';
    ovEl.innerHTML =
      '<div class="ob-dial" role="dialog" aria-label="spectoflow navigation">' +
        '<svg class="ob-ring" viewBox="0 0 284 284" aria-hidden="true">' +
          '<circle class="ob-track" cx="142" cy="142" r="128" stroke-dasharray="176 25" stroke-dashoffset="-12"></circle>' +
          '<circle class="ob-prog" cx="142" cy="142" r="128" stroke-dasharray="0 804.2"></circle>' +
          '<circle class="ob-marker" cx="142" cy="142" r="128" stroke-dasharray="34 770.2" style="transform:rotate(' + markerAngle + 'deg)"></circle>' +
        '</svg>' +
        '<button type="button" class="ob-chev ob-up" title="Previous (Up)">' + chevSvg('up') + '</button>' +
        '<button type="button" class="ob-chev ob-down" title="Next (Down)">' + chevSvg('down') + '</button>' +
        '<button type="button" class="ob-chev ob-left" title="Search / Board">' + chevSvg('left') + '</button>' +
        '<button type="button" class="ob-chev ob-right" title="Run">' + chevSvg('right') + '</button>' +
        '<button type="button" class="ob-center" title="Close (Esc)"><span class="ob-pct">0%</span><span class="ob-lbl">Delivered</span></button>' +
        items +
      '</div>';
    document.body.appendChild(ovEl);
    updatePct();
    ovEl.addEventListener('click', onOverlayClick);
    var tabsEl = document.getElementById('tabs');
    if (tabsEl) {
      tabsObserver = new MutationObserver(syncActiveVisual);
      tabsObserver.observe(tabsEl, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
    var center = ovEl.querySelector('.ob-center');
    if (center && center.focus) center.focus();
  }

  function syncActiveVisual() {
    if (!ovEl) return;
    var list = tabs(), n = list.length || 1, idx = activeIndex(list);
    var items = ovEl.querySelectorAll('.ob-item');
    items.forEach(function (el, i) { el.classList.toggle('is-active', i === idx); });
    var marker = ovEl.querySelector('.ob-marker');
    if (marker) marker.style.transform = 'rotate(' + (idx * (360 / n)) + 'deg)';
  }

  function cycle(dir) {
    var list = tabs(), n = list.length;
    if (!n) return;
    var idx = (activeIndex(list) + dir + n) % n;
    list[idx].click();
  }
  function goLeft() {
    var search = document.getElementById('search');
    if (search) { closeOverlay(); search.focus(); return; }
    var board = tabs().filter(function (t) { return t.dataset.tab === 'board'; })[0];
    if (board) board.click();
    closeOverlay();
  }
  function goRight() {
    var run = document.getElementById('runQuickBtn');
    if (run) run.click();
    closeOverlay();
  }

  function onOverlayClick(e) {
    var item = e.target.closest('.ob-item');
    if (item) {
      var idx = +item.dataset.tabIdx, list = tabs();
      if (list[idx]) list[idx].click();
      closeOverlay();
      return;
    }
    if (e.target.closest('.ob-center')) { closeOverlay(); return; }
    var chev = e.target.closest('.ob-chev');
    if (chev) {
      if (chev.classList.contains('ob-up')) cycle(-1);
      else if (chev.classList.contains('ob-down')) cycle(1);
      else if (chev.classList.contains('ob-left')) goLeft();
      else if (chev.classList.contains('ob-right')) goRight();
      return;
    }
    if (e.target === ovEl) closeOverlay();
  }

  function toggleOverlay() { if (state.open) closeOverlay(); else openOverlay(); }
  function openOverlay() { buildOverlay(); state.open = true; }
  function closeOverlay() {
    if (tabsObserver) { tabsObserver.disconnect(); tabsObserver = null; }
    state.open = false;
    if (!ovEl) return;
    var el = ovEl; ovEl = null;
    el.classList.add('ob-closing');
    setTimeout(function () { el.remove(); }, 160);
  }

  /* ---- keyboard: m toggles, arrows cycle while open, Enter/Esc close ---- */
  function isTyping(el) {
    return el && (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(el.tagName) !== -1 || el.isContentEditable);
  }
  function onKeydown(e) {
    if (!active) return;
    if ((e.key === 'm' || e.key === 'M') && !isTyping(document.activeElement)) { e.preventDefault(); toggleOverlay(); return; }
    if (!state.open) return;
    if (e.key === 'Escape') closeOverlay();
    else if (e.key === 'ArrowUp') { e.preventDefault(); cycle(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); cycle(1); }
    else if (e.key === 'Enter') closeOverlay();
  }
  document.addEventListener('keydown', onKeydown);

  /* ---- enter / leave the design ---- */
  function enter() {
    buildHub();
    updatePct();
    pctInterval = setInterval(updatePct, 2000);
    var fill = document.getElementById('globalMeterFill');
    if (fill) {
      fillObserver = new MutationObserver(updatePct);
      fillObserver.observe(fill, { attributes: true, attributeFilter: ['style'] });
    }
  }
  function leave() {
    closeOverlay();
    removeHub();
    if (pctInterval) { clearInterval(pctInterval); pctInterval = null; }
    if (fillObserver) { fillObserver.disconnect(); fillObserver = null; }
  }
  function sync() {
    var on = isOrbit();
    if (on && !active) { active = true; enter(); }
    else if (!on && active) { active = false; leave(); }
  }

  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-design'] });
  sync();
})();
