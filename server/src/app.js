'use strict';
/*
 * The Fastify application shell: static front-end + access control + health check. Relay routes
 * (Task 11) and the connector route (Task 10) register into this same instance.
 */
const path = require('path');
const fastifyStatic = require('@fastify/static');
const Fastify = require('fastify');
const { registerAuth } = require('./auth');
const { registerConnector, createRegistry } = require('./connector');

async function buildApp({ db, insecureDev, publicDir, trustProxy, onFrame, registry, emailer, baseUrl }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { db, insecureDev, emailer, baseUrl });
  await app.register(fastifyStatic, { root: publicDir || path.resolve(__dirname, '..', '..', 'lib', 'dashboard', 'public') });
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
  app.decorate('connectorRegistry', reg);
  app.get('/', async (_req, reply) => reply.sendFile('hub.html'));
  app.get('/p/:id/*', async (_req, reply) => reply.sendFile('index.html'));
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !path.extname(req.raw.url.split('?')[0])) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
  return app;
}

module.exports = { buildApp };
