'use strict';
// The client-side script builds innerHTML from role names, which are user-supplied text (set via
// POST /api/roles) — every interpolated role name must go through esc() before it reaches
// innerHTML (same pattern as account.js's ACCOUNT_PAGE_HTML / admin.js's ADMIN_PAGE_HTML).
// Permission keys/labels are fixed internal catalog data (migration 0004), not user-supplied, but
// are escaped too for consistency/defense-in-depth, matching this codebase's established caution.
const ROLES_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — roles</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:720px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2130}
.perms{color:#9aa0b4;font-size:12px}
select,button,input{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}
input{cursor:text}
.scopeBtn.active{border-color:#5b8cff;color:#5b8cff}
label.perm{display:block;font-weight:normal;cursor:pointer;padding:2px 0}</style></head><body>
<h1 style="font-size:17px">Roles</h1>
<div>
  <button class="scopeBtn" id="scopeProject" data-scope="project">Project roles</button>
  <button class="scopeBtn" id="scopePlatform" data-scope="platform">Platform roles</button>
</div>
<h2>Existing roles</h2>
<div id="roleList"></div>
<h2>Create role</h2>
<form id="createForm">
  <input id="roleName" placeholder="Role name" />
  <div id="permChecklist"></div>
  <button type="submit">Create role</button>
  <p id="createErr" style="color:#e0607a"></p>
</form>
<p id="deleteErr" style="color:#e0607a"></p>
<script>
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(url, opts) { const r = await fetch(url, opts); return { ok: r.ok, status: r.status, body: await r.json() }; }
let scope = 'project';
function updateScopeButtons() {
  document.getElementById('scopeProject').classList.toggle('active', scope === 'project');
  document.getElementById('scopePlatform').classList.toggle('active', scope === 'platform');
}
async function load() {
  updateScopeButtons();
  const rolesResp = await j('/api/roles?scope=' + scope);
  document.getElementById('roleList').innerHTML = (rolesResp.body.roles || []).map(r => {
    const perms = '<div class="perms">' + r.permissionKeys.map(k => esc(k)).join(', ') + '</div>';
    const marker = r.isSystem ? ' <em>(built-in)</em>' : '';
    const del = r.isSystem ? '' : '<button data-delete-role="' + r.id + '">Delete</button>';
    return '<div class="row"><span>' + esc(r.name) + marker + perms + '</span>' + del + '</div>';
  }).join('');
  const permsResp = await j('/api/permissions?scope=' + scope);
  document.getElementById('permChecklist').innerHTML = (permsResp.body.permissions || []).map(p =>
    '<label class="perm"><input type="checkbox" value="' + esc(p.key) + '" /> ' + esc(p.label) + ' (' + esc(p.key) + ')</label>'
  ).join('');
}
document.getElementById('scopeProject').addEventListener('click', () => { scope = 'project'; document.getElementById('createErr').textContent=''; document.getElementById('deleteErr').textContent=''; load(); });
document.getElementById('scopePlatform').addEventListener('click', () => { scope = 'platform'; document.getElementById('createErr').textContent=''; document.getElementById('deleteErr').textContent=''; load(); });
document.addEventListener('click', async (e) => {
  if (e.target.dataset.deleteRole) {
    document.getElementById('deleteErr').textContent = '';
    const r = await j('/api/roles/' + e.target.dataset.deleteRole, { method: 'DELETE' });
    if (!r.ok) document.getElementById('deleteErr').textContent = r.body.error || 'Could not delete role.';
    load();
  }
});
document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('createErr').textContent = '';
  const name = document.getElementById('roleName').value;
  const permissionKeys = Array.from(document.querySelectorAll('#permChecklist input:checked')).map(cb => cb.value);
  const r = await j('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, name, permissionKeys }) });
  if (!r.ok) { document.getElementById('createErr').textContent = r.body.error || 'Could not create role.'; return; }
  document.getElementById('roleName').value = '';
  load();
});
load();
</script></body></html>`;

async function registerRoles(app, { db }) {
  app.get('/api/roles', async (req, reply) => {
    const scope = req.query.scope;
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    return { roles: await db.listRolesByScope(scope, req.user.id) };
  });

  app.get('/api/permissions', async (req, reply) => {
    const scope = req.query.scope;
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    return { permissions: await db.listPermissions(scope) };
  });

  app.get('/roles', async (_req, reply) => reply.type('text/html').send(ROLES_PAGE_HTML));

  app.post('/api/roles', async (req, reply) => {
    const { scope, name, permissionKeys } = req.body || {};
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!Array.isArray(permissionKeys)) return reply.code(400).send({ error: 'permissionKeys must be an array' });
    if (scope === 'platform' && !(await db.hasPlatformPermission(req.user.id, 'platform.manage_roles'))) {
      return reply.code(403).send({ error: 'Creating a platform-scope role requires platform.manage_roles.' });
    }
    let role;
    try { role = await db.createRole({ scope, ownerUserId: req.user.id, name: name.trim(), permissionKeys }); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    return { role };
  });

  app.delete('/api/roles/:id', async (req, reply) => {
    const role = await db.getRole(req.params.id);
    if (!role) return reply.code(404).send({ error: 'Role not found.' });
    if (role.isSystem || role.ownerUserId !== req.user.id) return reply.code(403).send({ error: 'You can only delete your own custom roles.' });
    try {
      await db.deleteRole(req.params.id);
    } catch (e) {
      if (/currently assigned/i.test(e.message)) {
        return reply.code(409).send({ error: 'This role is currently assigned — remove it from every member/invitation first.' });
      }
      throw e;
    }
    return { ok: true };
  });
}
module.exports = { registerRoles };
