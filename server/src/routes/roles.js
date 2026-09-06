'use strict';
async function registerRoles(app, { db }) {
  app.get('/api/roles', async (req, reply) => {
    const scope = req.query.scope;
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    return { roles: await db.listRolesByScope(scope, req.user.id) };
  });

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
