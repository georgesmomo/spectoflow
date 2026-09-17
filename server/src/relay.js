'use strict';
/*
 * Turns a browser's HTTP request into an `op` frame for the owning machine, and a machine's upward
 * frames into what a browser sees: the same ROUTES table the local hub uses (lib/dashboard/routes.js),
 * so the online HTTP surface stays identical to the local one by construction (spec §2). Never
 * requires ops.js — this process executes nothing itself.
 */
const { findRoute } = require('../../lib/dashboard/routes');

const REPLY_TIMEOUT_MS = Number(process.env.SPECTOFLOW_RELAY_REPLY_TIMEOUT_MS) || 30000;

// Every op's required permission — the same 20 op names lib/dashboard/routes.js's ROUTES table
// defines (server/src/relay.js never hardcodes a second copy of that table; this maps each of ITS
// names to the ONE permission that gates it, kept in sync with routes.js by the fact that an
// unrecognized op name below fails closed — see checkAccess's `required` lookup).
// The second brain's `brain.*` routes are deliberately NOT listed: they are the machine owner's personal
// data, never a project's, so they must fail closed here for everyone, the project owner included.
const OP_PERMISSIONS = {
  'project.read': 'project.read', 'agentfile.read': 'project.read', 'files.tree': 'project.read', 'files.read': 'project.read',
  'files.write': 'project.write', 'files.mkdir': 'project.write', 'task.add': 'project.write', 'task.update': 'project.write',
  'task.comment': 'project.write', 'workflow.toggle': 'project.write', 'workflow.suggest': 'project.read', 'workflow.apply': 'project.write', 'run.start': 'project.write', 'run.stop': 'project.write', 'chat.summarize': 'project.write',
  'chat.clear': 'project.write', 'orchestrate.start': 'project.write', 'orchestrate.approve': 'project.write',
  'settings.save': 'project.manage_settings',
  'attention.add': 'project.write', 'attention.promote': 'project.write', 'attention.update': 'project.write', 'attention.remove': 'project.write',
  // The project memory is the project's; `memory.move` is not listed (it touches the owner's second brain).
  'memory.read': 'project.read', 'memory.add': 'project.write', 'memory.update': 'project.write', 'memory.remove': 'project.write', 'memory.confirm': 'project.write',
};

function registerRelay(app, { db, registry }) {
  const pending = new Map();        // reqId -> {resolve,reject,timer}
  const sse = new Map();            // serverId -> Set<reply.raw>
  const localIdOf = new Map();      // serverId -> {machineId, localId}
  const chains = new Map();         // machineId -> tail promise of its frame-processing chain
  let reqCounter = 0;

  function fanoutSSE(serverId, obj) {
    const set = sse.get(serverId);
    if (!set) return;
    const line = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const res of set) res.write(line);
  }

  // registerConnector (connector.js) calls onFrame(machineId, frame) once per frame in a batch
  // WITHOUT awaiting it, so a `hello` immediately followed by a `snapshot` in the same batch (the
  // common real-world case — announce the project, then push its current state) would otherwise
  // race: the snapshot's lookup of the just-announced project could run before the hello's own
  // await chain has registered it. Serialize per machine so each frame is fully processed, in
  // arrival order, before the next one starts — regardless of whether the caller awaits.
  //
  // safeProcessFrame() never rejects: if a frame's processing throws (e.g. a transient DB error),
  // that must not (a) block subsequent frames from that machine from still being processed, and —
  // just as importantly — (b) leave a rejected promise at the tail of the chain with nothing ever
  // attached to it. (b) matters because nothing ever calls .then()/.catch() on the chain's own tail
  // once a machine goes quiet (onFrame's caller in connector.js doesn't await it either), so a bare
  // rejection there would surface as an unhandled promise rejection — which crashes the whole
  // process under Node's default --unhandled-rejections=throw, taking down every connected machine
  // and browser tab, not just the one whose frame failed. Catching inside safeProcessFrame (so the
  // chain itself only ever resolves) closes that hole without changing the ordering guarantee above.
  function onFrame(machineId, frame) {
    const prev = chains.get(machineId) || Promise.resolve();
    const next = prev.then(() => safeProcessFrame(machineId, frame));
    chains.set(machineId, next);
    return next;
  }

  async function safeProcessFrame(machineId, frame) {
    try { await processFrame(machineId, frame); }
    catch (e) { console.error(`relay: error processing ${frame.type} frame from machine ${machineId}:`, e); }
  }

  async function processFrame(machineId, frame) {
    if (frame.type === 'hello') {
      const seen = new Set();
      for (const p of frame.projects || []) {
        const row = await db.upsertProject({ machineId, localId: p.localId, name: p.name, kind: p.kind || 'spectoflow' });
        await db.setPublished(row.id, true); // a project sent in `hello` is, by construction, published
        // First publish only: the machine's owning account becomes this project's protected Owner
        // member. Idempotent — upsertProject/hello re-run on every reconnect, so only insert once.
        if (!(await db.getProjectOwnerUserId(row.id))) {
          const machine = await db.knex('machines').where({ id: machineId }).first();
          if (machine && machine.owner_user_id) {
            await db.addProjectMember(row.id, machine.owner_user_id, db.SYSTEM_ROLE_IDS.OWNER);
          } else {
            // Diagnostic-only: this project has no Owner member and never will until its machine
            // gets an owner_user_id — resulting in every /api/* call 404ing as "Unknown project."
            // for everyone, with nothing else in the logs to explain why. Should not happen in
            // practice (createMachine always takes an ownerUserId) but a stale/hand-edited row could
            // hit this, and it would otherwise be completely undiagnosable.
            app.log.warn(`project "${row.id}" (${p.name}) was published but its machine "${machineId}" has no owner_user_id — no Owner member was created, so this project will answer 404 to everyone.`);
          }
        }
        localIdOf.set(row.id, { machineId, localId: p.localId });
        seen.add(p.localId);
        registry.entry(machineId).projects = registry.entry(machineId).projects || new Map();
        registry.entry(machineId).projects.set(p.localId, { serverId: row.id, name: p.name, kind: p.kind, stats: p.stats || null });
      }
      // A project that was published before but is absent from this hello (unpublished, or the
      // machine no longer has it) is marked unpublished here — its row and last snapshot are kept.
      for (const row of await db.listPublishedByMachine(machineId)) if (!seen.has(row.local_id)) await db.setPublished(row.id, false);
      return;
    }
    const known = registry.entry(machineId).projects && registry.entry(machineId).projects.get(frame.p);
    if (frame.type === 'event') {
      if (!known) return; // unannounced localId — dropped, never stored/fanned out (spec §2 ordering note)
      fanoutSSE(known.serverId, frame.event);
      return;
    }
    if (frame.type === 'snapshot') {
      if (!known) return;
      await db.saveSnapshot(known.serverId, frame.project);
      const cached = registry.entry(machineId).projects.get(frame.p);
      if (cached) cached.stats = statsOf(frame.project);
      fanoutSSE(known.serverId, { type: 'change' });
      return;
    }
    if (frame.type === 'reply') {
      const p = pending.get(frame.reqId);
      if (!p) return;
      pending.delete(frame.reqId); clearTimeout(p.timer);
      p.resolve(frame);
    }
  }
  function statsOf(project) {
    if (!project || !Array.isArray(project.plans)) return null;
    let total = 0, done = 0;
    for (const pl of project.plans) for (const ph of pl.phases || []) for (const t of ph.tasks || []) { total++; if (t.status === 'done') done++; }
    return { total, done };
  }

  // machineId/localId never change for a given serverId once assigned, so those are safe to cache
  // forever — but `published` can flip at any time (an unpublish must take effect immediately, not
  // just for calls that happen to miss the cache), so it is always re-read fresh from the DB rather
  // than memoized alongside the rest of the row.
  async function ownerOf(serverId) {
    const cached = localIdOf.get(serverId);
    if (cached) {
      const row = await db.findProject(serverId);
      if (!row) return null;
      return { ...cached, published: row.published };
    }
    const row = await db.findProject(serverId);
    if (!row) return null;
    const found = { machineId: row.machine_id, localId: row.local_id };
    localIdOf.set(serverId, found);
    return { ...found, published: row.published };
  }
  function sendOp(machineId, frame) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(frame.reqId); resolve({ timedOut: true }); }, REPLY_TIMEOUT_MS);
      pending.set(frame.reqId, { resolve, timer });
      const delivered = registry.send(machineId, frame);
      if (!delivered) { clearTimeout(timer); pending.delete(frame.reqId); resolve({ offline: true }); }
    });
  }

  // Resolves to exactly one of 'ok' | 'forbidden' | 'not-member'. A real member missing the specific
  // permission an op requires is 'forbidden' (403) — a real, distinguishable account with the wrong
  // role. Someone who isn't a member at all is 'not-member' (404) — indistinguishable from an
  // unpublished/nonexistent project, matching C1's existing pattern for unpublished projects, UNLESS
  // they hold platform.view_all_projects, which grants read-only ('project.read' only) visibility
  // regardless of membership.
  async function checkAccess(userId, serverId, requiredPermission) {
    const perms = await db.resolveProjectPermissions(userId, serverId);
    if (perms.has(requiredPermission)) return 'ok';
    if (perms.size > 0) return 'forbidden';
    // platform.view_all_projects makes a non-member's presence on this project visible/real (not
    // 'not-member'/404) even for a non-read op — they just lack that op's specific permission, so a
    // write is 'forbidden' (403), same as a real member with the wrong role would get.
    if (await db.hasPlatformPermission(userId, 'platform.view_all_projects')) return requiredPermission === 'project.read' ? 'ok' : 'forbidden';
    return 'not-member';
  }

  app.get('/api/hub/projects', async (req) => {
    const rows = await db.listPublishedProjectsForUser(req.user.id);
    const projects = await Promise.all(rows.map(async (r) => {
      const m = await db.knex('machines').where({ id: r.machine_id }).first();
      const st = registry.status(r.machine_id);
      const cached = registry.entry(r.machine_id).projects && registry.entry(r.machine_id).projects.get(r.local_id);
      return { id: r.id, name: r.name, kind: r.kind, machine: m ? m.name : 'unknown', online: st.connected, lastSeen: st.lastSeen, stats: (cached && cached.stats) || null, lastOpened: r.snapshot_at || r.created_at, groupId: r.group_id || null };
    }));
    return { mode: 'remote', projects };
  });

  app.get('/api/events', async (req, reply) => {
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    // An unpublished project (or one that never existed) is indistinguishable to the caller — both
    // 404 as "Unknown project.", so unpublishing takes a cached serverId out of circulation for SSE
    // exactly like reads below, not just for writes.
    if (!owner || !owner.published) return reply.code(404).send({ error: 'Unknown project.' });
    const access = await checkAccess(req.user.id, serverId, 'project.read');
    if (access === 'not-member') return reply.code(404).send({ error: 'Unknown project.' });
    if (access === 'forbidden') return reply.code(403).send({ error: 'You do not have permission to view this project.' });
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    reply.raw.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n');
    if (!sse.has(serverId)) sse.set(serverId, new Set());
    sse.get(serverId).add(reply.raw);
    req.raw.on('close', () => { const set = sse.get(serverId); if (set) set.delete(reply.raw); });
    return reply;
  });

  app.all('/api/*', async (req, reply) => {
    if (req.raw.url.startsWith('/api/hub/') || req.raw.url.startsWith('/api/events')) return reply.callNotFound();
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    // An unpublished project must 404 exactly like an unknown one, for every op including
    // `project.read`'s cache-only special case below — otherwise unpublishing would stop a project
    // from being listed in /api/hub/projects while its last-known snapshot stayed readable forever
    // to anyone who still has (or guesses) its serverId.
    if (!owner || !owner.published) return reply.code(404).send({ error: 'Unknown project.' });
    const route = findRoute(req.method, req.raw.url.split('?')[0]);
    if (!route) return reply.callNotFound();
    const [, , opName, argsFn] = route;
    const required = OP_PERMISSIONS[opName];
    if (!required) return reply.callNotFound(); // unrecognized op — fail closed, never silently allow
    const access = await checkAccess(req.user.id, serverId, required);
    if (access === 'not-member') return reply.code(404).send({ error: 'Unknown project.' });
    if (access === 'forbidden') return reply.code(403).send({ error: 'You do not have permission to do that on this project.' });
    const u = new URL(req.raw.url, 'http://x');
    const args = argsFn(u, req.body || {}, u.pathname);
    const st = registry.status(owner.machineId);
    // project.read always answers from the stored snapshot — never a live round trip — because the
    // registry's `connected` flag (for an HTTP-transport machine) only means "recently touched base",
    // not "currently blocked in a long-poll and able to answer synchronously"; a browser opening a
    // project shouldn't have to wait out a full round trip (and possibly the reply timeout) just to
    // read data that a `snapshot` frame already delivered. Writes still go live below, and correctly
    // time out (504) if nobody is actually polling to receive them.
    if (opName === 'project.read') {
      const row = await db.findProject(serverId);
      const snapshot = row && row.last_snapshot ? JSON.parse(row.last_snapshot) : {};
      return { ...snapshot, online: st.connected, lastSeen: st.lastSeen };
    }
    if (!st.connected) return reply.code(503).send({ error: `${owner.localId} is offline (last seen ${st.lastSeen || 'never'}).` });
    const reqId = ++reqCounter;
    const result = await sendOp(owner.machineId, { type: 'op', reqId, p: owner.localId, op: opName, args });
    if (result.timedOut) return reply.code(504).send({ error: 'The machine did not respond in time.' });
    if (result.offline) return reply.code(503).send({ error: `${owner.localId} is offline.` });
    if (result.error) return reply.code(result.error.status || 500).send({ error: result.error.message });
    return result.result === undefined ? {} : result.result;
  });

  // Read-only access to a project's cached config, gated by the exact same check the `/api/*`
  // catch-all above applies to `project.read` (owner.published + checkAccess(..., 'project.read')) —
  // used by app.js's page route to decide what design to stamp into the served HTML without ever
  // exposing a project's real cached snapshot to a caller who couldn't read it via the API either.
  // Returns null (never throws) for a nonexistent/unpublished/not-visible project — indistinguishable
  // from an unregistered id, on purpose.
  async function getVisibleConfig(userId, serverId) {
    if (!serverId) return null;
    const owner = await ownerOf(serverId);
    if (!owner || !owner.published) return null;
    const access = await checkAccess(userId, serverId, 'project.read');
    if (access !== 'ok') return null;
    const row = await db.findProject(serverId);
    const snapshot = row && row.last_snapshot ? JSON.parse(row.last_snapshot) : null;
    return (snapshot && snapshot.config) || {};
  }

  return { onFrame, getVisibleConfig };
}

module.exports = { registerRelay };
