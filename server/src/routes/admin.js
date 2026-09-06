'use strict';
async function requirePlatformPermission(req, reply, db, permissionKey) {
  if (!(await db.hasPlatformPermission(req.user.id, permissionKey))) { reply.code(403).send({ error: 'You do not have permission to do that.' }); return false; }
  return true;
}

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
}
module.exports = { registerAdmin };
