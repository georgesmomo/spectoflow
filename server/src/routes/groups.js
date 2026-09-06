'use strict';
async function registerGroups(app, { db }) {
  app.get('/api/groups', async (req) => ({ groups: await db.listGroupsForOwner(req.user.id) }));
  app.post('/api/groups', async (req, reply) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    return { group: await db.createGroup(req.user.id, name.trim()) };
  });
  app.patch('/api/groups/:id', async (req, reply) => {
    const groups = await db.listGroupsForOwner(req.user.id);
    if (!groups.some((g) => g.id === req.params.id)) return reply.code(404).send({ error: 'Group not found.' });
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    await db.renameGroup(req.params.id, name.trim());
    return { ok: true };
  });
  app.delete('/api/groups/:id', async (req, reply) => {
    const groups = await db.listGroupsForOwner(req.user.id);
    if (!groups.some((g) => g.id === req.params.id)) return reply.code(404).send({ error: 'Group not found.' });
    await db.deleteGroup(req.params.id);
    return { ok: true };
  });
  app.post('/api/projects/:id/group', async (req, reply) => {
    const groupId = req.body && req.body.groupId;
    if (groupId !== null && groupId !== undefined) {
      const groups = await db.listGroupsForOwner(req.user.id);
      if (!groups.some((g) => g.id === groupId)) return reply.code(400).send({ error: 'Not one of your groups.' });
    }
    const perms = await db.resolveProjectPermissions(req.user.id, req.params.id);
    if (!perms.has('project.read')) return reply.code(404).send({ error: 'Unknown project.' });
    await db.setProjectGroup(req.params.id, groupId || null);
    return { ok: true };
  });
}
module.exports = { registerGroups };
