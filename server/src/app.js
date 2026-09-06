'use strict';
/*
 * The Fastify application shell: static front-end + access control + health check. Relay routes
 * (Task 11) and the connector route (Task 10) register into this same instance.
 */
const path = require('path');
const fastifyStatic = require('@fastify/static');
const Fastify = require('fastify');
const { registerAuth } = require('./auth');

async function buildApp({ db, accessKey, sessionSecret, insecureDev, publicDir, trustProxy }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { accessKey, sessionSecret, insecureDev });
  await app.register(fastifyStatic, { root: publicDir || path.resolve(__dirname, '..', '..', 'lib', 'dashboard', 'public'), decorateReply: false });
  app.get('/', async (_req, reply) => reply.sendFile('hub.html'));
  app.get('/p/:id/*', async (_req, reply) => reply.sendFile('index.html'));
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !path.extname(req.raw.url.split('?')[0])) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
  app.decorate('db', db);
  return app;
}

module.exports = { buildApp };
