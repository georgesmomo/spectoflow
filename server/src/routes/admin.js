'use strict';
async function requirePlatformPermission(req, reply, db, permissionKey) {
  if (!(await db.hasPlatformPermission(req.user.id, permissionKey))) { reply.code(403).send({ error: 'You do not have permission to do that.' }); return false; }
  return true;
}

// Same as requirePlatformPermission, but for a route (the /admin page) that should open to a
// caller holding EITHER of two permissions — e.g. someone who can only manage signup mode still
// needs to reach the page, even without platform.manage_users.
async function requireAnyPlatformPermission(req, reply, db, permissionKeys) {
  for (const key of permissionKeys) {
    if (await db.hasPlatformPermission(req.user.id, key)) return true;
  }
  reply.code(403).send({ error: 'You do not have permission to do that.' });
  return false;
}

// The client-side script builds innerHTML from account emails, which are user-supplied and only
// loosely validated (EMAIL_RE forbids whitespace and requires one @ plus a dot — nothing else), so
// every interpolated email must go through esc() before it reaches innerHTML (same pattern as
// account.js's ACCOUNT_PAGE_HTML). Custom platform role names are also user-supplied text (set via
// POST /api/roles) and go through the same esc() before being rendered. x.id and a role's id are
// server-generated random ids, never attacker-controlled, so they are left unescaped in the
// data-promote/data-demote/data-role-select/etc. attribute values.
const ADMIN_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — admin</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:720px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2130}
select,button{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}</style></head><body>
<h1 style="font-size:17px">Admin</h1>
<h2>Signup mode</h2>
<select id="mode"><option value="open">Open</option><option value="invite_only">Invite only</option><option value="disabled">Disabled</option></select>
<h2>Accounts</h2><div id="users"></div>
<script>
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(u,o){const r=await fetch(u,o);return r.json();}
let assignableRoles = [];
function roleOptions(){ return assignableRoles.map(r => '<option value="'+r.id+'">'+esc(r.name)+'</option>').join(''); }
async function load(){
  const m = await j('/api/admin/signup-mode'); document.getElementById('mode').value = m.mode;
  const rolesResp = await j('/api/roles?scope=platform');
  assignableRoles = rolesResp.roles.filter(r => r.id !== 'sys-platform-admin');
  const u = await j('/api/admin/users');
  document.getElementById('users').innerHTML = u.users.map(x => {
    const granted = (x.platformRoles||[]).map(pr => '<span>'+esc(pr.name)+' <a href="#" data-remove-role="'+x.id+'" data-role-id="'+pr.id+'">x</a></span>').join(' ');
    return '<div class="row"><span>'+esc(x.email)+(x.email_verified_at?'':' (unverified)')+' '+granted+'</span>'
      +'<select data-role-select="'+x.id+'">'+roleOptions()+'</select>'
      +'<button data-grant-role="'+x.id+'">Grant</button>'
      +'<button data-promote="'+x.id+'">Promote</button><button data-demote="'+x.id+'">Demote</button></div>';
  }).join('');
}
document.getElementById('mode').addEventListener('change', async (e) => { await fetch('/api/admin/signup-mode', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:e.target.value})}); });
document.addEventListener('click', async (e) => {
  if (e.target.dataset.promote) await fetch('/api/admin/users/'+e.target.dataset.promote+'/promote', {method:'POST'});
  if (e.target.dataset.demote) await fetch('/api/admin/users/'+e.target.dataset.demote+'/demote', {method:'POST'});
  if (e.target.dataset.grantRole) {
    const sel = document.querySelector('[data-role-select="'+e.target.dataset.grantRole+'"]');
    if (sel && sel.value) await fetch('/api/admin/users/'+e.target.dataset.grantRole+'/roles', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roleId:sel.value})});
  }
  if (e.target.dataset.removeRole) {
    e.preventDefault();
    await fetch('/api/admin/users/'+e.target.dataset.removeRole+'/roles/'+e.target.dataset.roleId, {method:'DELETE'});
  }
  load();
});
load();
</script></body></html>`;

async function registerAdmin(app, { db }) {
  app.get('/api/admin/signup-mode', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_signup'))) return;
    return { mode: await db.getSignupMode() };
  });
  app.post('/api/admin/signup-mode', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_signup'))) return;
    try { await db.setSignupMode(req.body && req.body.mode); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    return { ok: true };
  });
  app.get('/api/admin/projects', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.view_all_projects'))) return;
    return { projects: await db.listPublic() };
  });
  app.get('/api/admin/users', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const users = await db.listUsers();
    const withRoles = await Promise.all(users.map(async (u) => {
      const roles = await db.listPlatformRolesForUser(u.id);
      return { ...u, platformRoles: roles.map((r) => ({ id: r.id, name: r.name })) };
    }));
    return { users: withRoles };
  });
  app.post('/api/admin/users/:id/promote', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const user = await db.findUserById(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    await db.assignPlatformRole(req.params.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/demote', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const user = await db.findUserById(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    const count = await db.countUsersWithPlatformRole(db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    const targetIsAdmin = await db.hasPlatformPermission(req.params.id, 'platform.manage_signup'); // any real admin permission implies membership in the role, this checks it holds the actual role
    if (targetIsAdmin && count <= 1) return reply.code(400).send({ error: 'Cannot remove the last Platform Admin.' });
    await db.removePlatformRole(req.params.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    return { ok: true };
  });
  // Assigns a CUSTOM platform role. sys-platform-admin is exclusively managed by /promote (which
  // carries the "last admin" protection) — this route must never grant or revoke it, so both it and
  // the DELETE below refuse that one role id up front, before ever reaching db.assignPlatformRole/
  // db.removePlatformRole.
  app.post('/api/admin/users/:id/roles', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const user = await db.findUserById(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    const { roleId } = req.body || {};
    if (roleId === db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN) return reply.code(400).send({ error: 'Use /promote to grant Platform Admin.' });
    try { await db.assignPlatformRole(req.params.id, roleId); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    return { ok: true };
  });
  app.delete('/api/admin/users/:id/roles/:roleId', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const user = await db.findUserById(req.params.id);
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    if (req.params.roleId === db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN) return reply.code(400).send({ error: 'Use /demote to remove Platform Admin.' });
    await db.removePlatformRole(req.params.id, req.params.roleId);
    return { ok: true };
  });
  app.get('/admin', async (req, reply) => {
    if (!(await requireAnyPlatformPermission(req, reply, db, ['platform.manage_users', 'platform.manage_signup']))) return;
    return reply.type('text/html').send(ADMIN_PAGE_HTML);
  });
}
module.exports = { registerAdmin };
