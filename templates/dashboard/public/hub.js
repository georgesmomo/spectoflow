'use strict';
(function () {
  const grid = document.getElementById('hubGrid');
  const empty = document.getElementById('hubEmpty');
  const modal = document.getElementById('hubModal');
  const modalError = document.getElementById('hubModalError');
  const modalStatus = document.getElementById('hubModalStatus');
  const browsePane = document.getElementById('hubBrowsePane');
  const pastePane = document.getElementById('hubPastePane');
  const browseCrumb = document.getElementById('hubBrowseCrumb');
  const browseList = document.getElementById('hubBrowseList');
  const browseCurrent = document.getElementById('hubBrowseCurrent');
  let browsePath = null; // null = show starting points (home dir / drives)

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  async function loadProjects() {
    const r = await fetch('/api/hub/projects');
    const data = await r.json();
    const rows = data.projects || [];
    empty.hidden = rows.length > 0;
    grid.innerHTML = rows.map((p) => {
      const pct = p.stats && p.stats.total ? Math.round(100 * p.stats.done / p.stats.total) : null;
      return `<div class="hub-card" data-id="${p.id}">
        <a class="hub-card-open" href="/p/${p.id}/board">
          <div class="hub-card-name">${esc(p.name)}</div>
          <div class="hub-card-path">${esc(p.path)}</div>
          ${pct !== null ? `<div class="hub-card-progress"><div class="hub-card-progress-fill" style="width:${pct}%"></div></div><div class="hub-card-pct">${pct}% · ${p.stats.done}/${p.stats.total} tasks</div>` : ''}
          <div class="hub-card-meta">Opened ${esc(timeAgo(p.lastOpened))}</div>
        </a>
        <button class="hub-card-remove" data-remove="${p.id}" title="Remove from this list" aria-label="Remove ${esc(p.name)}">&times;</button>
      </div>`;
    }).join('');
  }

  // No native confirm() — it blocks the tab (and this codebase never uses it, see D46). A second
  // click within 3s on the same remove button confirms; the button flips to a checkmark meanwhile.
  let pendingRemoveId = null;
  function confirmRemove(id) {
    if (pendingRemoveId === id) { pendingRemoveId = null; return true; }
    pendingRemoveId = id;
    const btn = grid.querySelector('[data-remove="' + id + '"]');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓'; btn.title = 'Click again to confirm';
      setTimeout(() => { if (btn.textContent === '✓') btn.textContent = orig; }, 3000);
    }
    return false;
  }
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute('data-remove');
    if (!confirmRemove(id)) return;
    await fetch('/api/hub/projects/' + encodeURIComponent(id), { method: 'DELETE' });
    loadProjects();
  });

  function openModal() { modal.hidden = false; modalError.hidden = true; modalStatus.hidden = true; browsePath = null; loadBrowse(); }
  function closeModal() { modal.hidden = true; }
  document.getElementById('hubAddBtn').addEventListener('click', openModal);
  document.getElementById('hubAddBtnEmpty').addEventListener('click', openModal);
  document.getElementById('hubModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.querySelectorAll('.hub-modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.hub-modal-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const mode = tab.getAttribute('data-mode');
      browsePane.hidden = mode !== 'browse';
      pastePane.hidden = mode !== 'paste';
    });
  });

  async function loadBrowse() {
    const q = browsePath ? ('?path=' + encodeURIComponent(browsePath)) : '';
    const r = await fetch('/api/hub/browse' + q);
    const data = await r.json();
    if (data.error) { browseList.innerHTML = '<p class="hub-browse-empty">' + esc(data.error) + '</p>'; return; }
    browsePath = data.current || null;
    browseCurrent.textContent = browsePath || 'Choose a starting point';
    browseCrumb.innerHTML = data.parent ? `<button class="hub-crumb-up" id="hubCrumbUp">&larr; Up</button>` : '';
    const up = document.getElementById('hubCrumbUp');
    if (up) up.addEventListener('click', () => { browsePath = data.parent; loadBrowse(); });
    browseList.innerHTML = (data.entries || []).map((e) =>
      `<button class="hub-browse-item" data-path="${esc(e.path)}">${esc(e.name)}</button>`
    ).join('') || '<p class="hub-browse-empty">No sub-folders here.</p>';
    browseList.querySelectorAll('[data-path]').forEach((el) => {
      el.addEventListener('click', () => { browsePath = el.getAttribute('data-path'); loadBrowse(); });
    });
  }

  async function submitPath(p) {
    modalError.hidden = true; modalStatus.hidden = false; modalStatus.textContent = 'Adding…';
    const r = await fetch('/api/hub/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) });
    const data = await r.json();
    if (!r.ok) { modalStatus.hidden = true; modalError.hidden = false; modalError.textContent = data.error || 'Could not add that folder.'; return; }
    location.href = '/p/' + data.entry.id + '/board';
  }
  document.getElementById('hubBrowseUse').addEventListener('click', () => { if (browsePath) submitPath(browsePath); });
  document.getElementById('hubPasteUse').addEventListener('click', () => {
    const v = document.getElementById('hubPasteInput').value.trim();
    if (v) submitPath(v);
  });

  loadProjects();
})();
