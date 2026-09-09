'use strict';
/*
 * The Fastify application shell: static front-end + access control + health check. Relay routes
 * (Task 11) and the connector route (Task 10) register into this same instance.
 */
const fs = require('fs').promises;
const path = require('path');
const fastifyStatic = require('@fastify/static');
const Fastify = require('fastify');
const { registerAuth } = require('./auth');
const { registerConnector, createRegistry } = require('./connector');
const { injectDesign } = require('../../lib/dashboard/inject-design');

async function buildApp({ db, insecureDev, publicDir, trustProxy, onFrame, registry, emailer, baseUrl }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  const PUBLIC_DIR = publicDir || path.resolve(__dirname, '..', '..', 'lib', 'dashboard', 'public');
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { db, insecureDev, emailer, baseUrl });
  await app.register(fastifyStatic, { root: PUBLIC_DIR });
  app.decorate('db', db);
  const reg = registry || createRegistry();
  const { registerRelay } = require('./relay');
  const relay = registerRelay(app, { db, registry: reg });
  await registerConnector(app, { db, registry: reg, onFrame: onFrame || relay.onFrame });
  const { registerSharing } = require('./routes/sharing');
  await registerSharing(app, { db, emailer, insecureDev, baseUrl });
  const { registerAdmin } = require('./routes/admin');
  await registerAdmin(app, { db });
  const { registerRoles } = require('./routes/roles');
  await registerRoles(app, { db });
  const { registerGroups } = require('./routes/groups');
  await registerGroups(app, { db });
  const { registerAccount } = require('./routes/account');
  await registerAccount(app, { db, insecureDev });
  const { registerProjects } = require('./routes/projects');
  await registerProjects(app, { db });
  app.decorate('connectorRegistry', reg);
  app.get('/', async (_req, reply) => reply.sendFile('hub.html'));
  // Stamps the served index.html's <html data-design="..."> with THIS project's own config.design
  // before the file reaches the browser — the online-relay counterpart of the local hub's fix in
  // lib/dashboard/hub-server.js#serveStatic (same bug, same shared front-end, D65/D66 program). The
  // relay never holds a live process for an offline project — `project.read` itself already answers
  // from the DB-cached last_snapshot rather than a live round trip (see relay.js) — so this reuses
  // that exact same cached snapshot (which already carries `config`, written by ops.js's
  // `project.read` on the machine) instead of needing any new plumbing to the machine.
  app.get('/p/:id/*', async (req, reply) => {
    let design;
    try {
      const row = await db.findProject(req.params.id);
      const snapshot = row && row.last_snapshot ? JSON.parse(row.last_snapshot) : null;
      design = snapshot && snapshot.config && snapshot.config.design;
    } catch (_) { /* fall through to the shared default */ }
    const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    reply.type('text/html; charset=utf-8').send(injectDesign(html, design));
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !path.extname(req.raw.url.split('?')[0])) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
  return app;
}

module.exports = { buildApp };
