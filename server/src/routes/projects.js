'use strict';
/*
 * Two plain pages, following the established account.js/admin.js/roles.js pattern: a plain HTML
 * string constant with inline <style>, an inline <script> with a client-side esc() HTML-escape
 * helper applied to every user-supplied string before it reaches innerHTML, event delegation via
 * document.addEventListener. No server-side data injection — both pages fetch everything they show
 * through the existing JSON APIs (GET /api/hub/projects, /api/groups, /api/projects/:id/members,
 * /api/roles?scope=project), so there is nothing here to escape server-side; the escaping happens
 * entirely in the shipped client script, exactly like every other page in this file's family.
 *
 * Project names (user-supplied via the connector's `hello` frame — already a known-sensitive field,
 * see sharing.js's invite page) and group names (user-supplied via POST /api/groups) both go through
 * esc() before being rendered by /projects. Member emails (same sensitive field already fixed once
 * in admin.js) and role names (user-supplied for custom roles, same as roles.js/admin.js) both go
 * through esc() before being rendered by /projects/:id/members.
 *
 * Neither page route itself enforces per-project authorization — like every other page in this
 * family, authorization is enforced only by the JSON APIs the page calls (GET /api/projects/:id/
 * members already 403s a non-member; the invite-role dropdown and every mutation route already
 * enforce their own permission checks). The page shell renders unconditionally for any authenticated
 * caller (auth.js's onRequest hook already requires a session for every non-public route), matching
 * account.js/admin.js/roles.js.
 */
const PROJECTS_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — projects</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:720px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e2130}
.row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
select,button,input{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}
input{cursor:text}
a{color:#7c5cff}</style></head><body>
<h1 style="font-size:17px">Projects</h1>
<div id="projectList"></div>
<h2>Groups</h2>
<div id="groupList"></div>
<form id="groupForm">
  <input id="groupName" placeholder="Group name" />
  <button type="submit">Create group</button>
  <p id="groupErr" style="color:#e0607a"></p>
</form>
<script>
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(url, opts) { const r = await fetch(url, opts); return { ok: r.ok, status: r.status, body: await r.json() }; }
let groups = [];
function groupOptions(selectedId) {
  return '<option value="">(no group)</option>' + groups.map(g =>
    '<option value="' + g.id + '"' + (g.id === selectedId ? ' selected' : '') + '>' + esc(g.name) + '</option>'
  ).join('');
}
async function load() {
  const groupsResp = await j('/api/groups');
  groups = groupsResp.body.groups || [];
  const projResp = await j('/api/hub/projects');
  const projects = projResp.body.projects || [];
  document.getElementById('projectList').innerHTML = projects.map(p =>
    '<div class="row"><span>' + esc(p.name) + '</span>' +
    '<select data-project-group="' + p.id + '">' + groupOptions(p.groupId) + '</select>' +
    '<a href="/projects/' + p.id + '/members">Manage members</a></div>'
  ).join('');
  document.getElementById('groupList').innerHTML = groups.map(g =>
    '<div class="row"><span>' + esc(g.name) + '</span>' +
    '<input data-rename-input="' + g.id + '" placeholder="New name" />' +
    '<button data-rename-group="' + g.id + '">Rename</button>' +
    '<button data-delete-group="' + g.id + '">Delete</button></div>'
  ).join('');
}
document.addEventListener('change', async (e) => {
  if (e.target.dataset.projectGroup) {
    await fetch('/api/projects/' + e.target.dataset.projectGroup + '/group', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: e.target.value || null })
    });
    load();
  }
});
document.addEventListener('click', async (e) => {
  if (e.target.dataset.renameGroup) {
    const input = document.querySelector('[data-rename-input="' + e.target.dataset.renameGroup + '"]');
    const name = input ? input.value : '';
    if (!name.trim()) return;
    await fetch('/api/groups/' + e.target.dataset.renameGroup, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    load();
  }
  if (e.target.dataset.deleteGroup) {
    await fetch('/api/groups/' + e.target.dataset.deleteGroup, { method: 'DELETE' });
    load();
  }
});
document.getElementById('groupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('groupErr').textContent = '';
  const name = document.getElementById('groupName').value;
  const r = await j('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!r.ok) { document.getElementById('groupErr').textContent = r.body.error || 'Could not create group.'; return; }
  document.getElementById('groupName').value = '';
  load();
});
load();
</script></body></html>`;

const MEMBERS_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — project members</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:720px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e2130}
.row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
select,button,input{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}
input{cursor:text}</style></head><body>
<h1 style="font-size:17px">Project members</h1>
<p style="color:#8b93a6">Project id: <span id="pid"></span></p>
<div id="memberList"></div>
<h2>Invite</h2>
<form id="inviteForm">
  <input id="inviteEmail" type="email" placeholder="Email" />
  <select id="inviteRole"></select>
  <button type="submit">Invite</button>
  <p id="inviteErr" style="color:#e0607a"></p>
</form>
<script>
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(url, opts) { const r = await fetch(url, opts); return { ok: r.ok, status: r.status, body: await r.json() }; }
const projectId = location.pathname.split('/')[2];
document.getElementById('pid').textContent = projectId;
let roles = [];
function roleOptions(selectedId) {
  return roles.map(r => '<option value="' + r.id + '"' + (r.id === selectedId ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
}
async function load() {
  const rolesResp = await j('/api/roles?scope=project');
  roles = rolesResp.body.roles || [];
  document.getElementById('inviteRole').innerHTML = roleOptions();
  const membersResp = await j('/api/projects/' + projectId + '/members');
  const members = (membersResp.body && membersResp.body.members) || [];
  document.getElementById('memberList').innerHTML = members.map(m => {
    const isOwner = m.roleId === 'sys-owner';
    const controls = isOwner ? '<em>Owner</em>' :
      '<select data-member-role="' + m.userId + '">' + roleOptions(m.roleId) + '</select>' +
      '<button data-remove-member="' + m.userId + '">Remove</button>';
    return '<div class="row"><span>' + esc(m.email) + ' &mdash; ' + esc(m.roleName) + '</span>' + controls + '</div>';
  }).join('');
}
document.addEventListener('change', async (e) => {
  if (e.target.dataset.memberRole) {
    await fetch('/api/projects/' + projectId + '/members/' + e.target.dataset.memberRole, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: e.target.value })
    });
    load();
  }
});
document.addEventListener('click', async (e) => {
  if (e.target.dataset.removeMember) {
    await fetch('/api/projects/' + projectId + '/members/' + e.target.dataset.removeMember, { method: 'DELETE' });
    load();
  }
});
document.getElementById('inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  document.getElementById('inviteErr').textContent = '';
  const email = document.getElementById('inviteEmail').value;
  const roleId = document.getElementById('inviteRole').value;
  const r = await j('/api/projects/' + projectId + '/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, roleId }) });
  if (!r.ok) { document.getElementById('inviteErr').textContent = r.body.error || 'Could not send invite.'; return; }
  document.getElementById('inviteEmail').value = '';
  load();
});
load();
</script></body></html>`;

async function registerProjects(app) {
  app.get('/projects', async (_req, reply) => reply.type('text/html').send(PROJECTS_PAGE_HTML));
  app.get('/projects/:id/members', async (_req, reply) => reply.type('text/html').send(MEMBERS_PAGE_HTML));
}

module.exports = { registerProjects };
