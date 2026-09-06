'use strict';
/*
 * Project membership and invitation HTTP routes. Each route checks the caller's own permission on
 * the TARGET project directly (via db.resolveProjectPermissions), independent of relay.js's /api/*
 * op-relay enforcement (a separate route surface, wired up in a later task) — these routes exist and
 * are fully enforced on their own from the moment this task lands.
 */
const TOKEN_RE = /^spf_[A-Za-z0-9_-]+$/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function requirePermission(req, reply, db, projectId, permissionKey) {
  const perms = await db.resolveProjectPermissions(req.user.id, projectId);
  if (!perms.has(permissionKey)) { reply.code(403).send({ error: 'You do not have permission to do that on this project.' }); return false; }
  return true;
}

// sys-owner is never an assignable role through this API — it is only ever created by relay.js's
// own auto-insert on first publish. Assigning it here would mint a second, permanently un-removable
// "Owner" (removeProjectMember/changeMemberRole both refuse to touch any sys-owner membership),
// defeating the whole Owner-protection invariant this task is built around.
async function isAssignableProjectRole(db, ownerUserId, roleId) {
  if (roleId === db.SYSTEM_ROLE_IDS.OWNER) return false;
  const assignable = await db.listRolesByScope('project', ownerUserId);
  return assignable.some((r) => r.id === roleId);
}

async function registerSharing(app, { db, emailer }) {
  app.get('/api/projects/:id/members', async (req, reply) => {
    if (!(await requirePermission(req, reply, db, req.params.id, 'project.read'))) return;
    return { members: await db.listProjectMembers(req.params.id) };
  });

  app.post('/api/projects/:id/invite', async (req, reply) => {
    const projectId = req.params.id;
    if (!(await requirePermission(req, reply, db, projectId, 'project.manage_members'))) return;
    const { email, roleId } = req.body || {};
    if (typeof email !== 'string' || !email.includes('@')) return reply.code(400).send({ error: 'A valid email is required.' });
    const ownerUserId = await db.getProjectOwnerUserId(projectId);
    if (!(await isAssignableProjectRole(db, ownerUserId, roleId))) return reply.code(400).send({ error: 'Not a valid role for this project.' });
    const token = await db.createInvitation({ projectId, email, roleId, invitedByUserId: req.user.id });
    const project = await db.findProject(projectId);
    const url = `${req.protocol}://${req.hostname}/invitations/${token}`;
    try {
      await emailer.sendInvitationEmail(email, project ? project.name : 'a spectoflow project', url);
    } catch (err) {
      app.log.error(err, 'failed to send invitation email');
    }
    return { ok: true };
  });

  app.delete('/api/projects/:id/members/:userId', async (req, reply) => {
    if (!(await requirePermission(req, reply, db, req.params.id, 'project.manage_members'))) return;
    const result = await db.removeProjectMember(req.params.id, req.params.userId);
    if (result === 'not-found') return reply.code(404).send({ error: 'Not a member of this project.' });
    if (result === 'protected') return reply.code(403).send({ error: "The project owner's membership can't be removed here — unpublish the project locally instead." });
    return { ok: true };
  });

  app.patch('/api/projects/:id/members/:userId', async (req, reply) => {
    const projectId = req.params.id;
    if (!(await requirePermission(req, reply, db, projectId, 'project.manage_members'))) return;
    const { roleId } = req.body || {};
    const ownerUserId = await db.getProjectOwnerUserId(projectId);
    if (!(await isAssignableProjectRole(db, ownerUserId, roleId))) return reply.code(400).send({ error: 'Not a valid role for this project.' });
    const result = await db.changeMemberRole(projectId, req.params.userId, roleId);
    if (result === 'not-found') return reply.code(404).send({ error: 'Not a member of this project.' });
    if (result === 'protected') return reply.code(403).send({ error: "The project owner's role can't be changed here." });
    return { ok: true };
  });

  // Public: a person may not have an account yet. Shows a plain page; accepting requires being
  // signed in (the page itself prompts sign-in/sign-up first, preserving the token in the URL, since
  // /signup and /login are also public routes that don't consume anything here).
  app.get('/invitations/:token', async (req, reply) => {
    const token = req.params.token;
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      return reply.code(400).type('text/html').send(INVITE_INVALID_HTML);
    }
    const inv = await db.findInvitationByToken(token);
    if (!inv) return reply.code(404).type('text/html').send(INVITE_INVALID_HTML);
    const project = await db.findProject(inv.projectId);
    return reply.type('text/html').send(INVITE_HTML(escapeHtml(project ? project.name : 'a project'), token));
  });
  app.post('/invitations/:token/accept', async (req, reply) => {
    const projectId = await db.acceptInvitation(req.params.token, req.user.id);
    if (!projectId) return reply.code(400).send({ error: 'This invitation is invalid or has already been used.' });
    return { ok: true, projectId };
  });
}

const INVITE_INVALID_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title></head><body><p>This invitation link is invalid or has expired.</p></body></html>`;
const INVITE_HTML = (projectName, token) => `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title></head><body>
<p>You've been invited to <strong>${projectName}</strong>.</p>
<p><a href="/login">Sign in</a> or <a href="/signup">create an account</a> with this invitation's email, then come back to this page to accept.</p>
<button id="accept">Accept invitation</button><p id="err" style="color:#e0607a"></p>
<script>document.getElementById('accept').addEventListener('click',async()=>{
const r=await fetch('/invitations/${token}/accept',{method:'POST'});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Could not accept.';});</script></body></html>`;

module.exports = { registerSharing };
