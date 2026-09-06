'use strict';
/*
 * Persistence for the online dashboard: machines (token-authenticated connectors) and their
 * projects (identity + published flag + last known snapshot, for offline reads). One Knex
 * instance per process; the driver (sqlite/mysql2/pg) is picked by knexfile.fromUrl from
 * DATABASE_URL. Token plaintext is returned to the caller exactly once (createMachine) and never
 * stored — only its SHA-256 lives in the row, so a leaked database never leaks usable tokens.
 */
const crypto = require('crypto');
const knexLib = require('knex');
const { fromUrl } = require('../knexfile');
const { createUsersModel } = require('./models/users');
const { createRbacModel } = require('./models/rbac');
const { createSessionsModel } = require('./models/sessions');
const { createTokensModel } = require('./models/tokens');
const { createSharingModel } = require('./models/sharing');
const { createSettingsModel } = require('./models/settings');
const { createGroupsModel } = require('./models/groups');

function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

async function createDb(databaseUrl) {
  const knex = knexLib(fromUrl(databaseUrl));
  async function migrate() { await knex.migrate.latest(); }

  function createMachine(name, ownerUserId) {
    const id = randomId(8);              // ~11 chars base64url
    const token = 'spf_' + randomId(32);  // printed once by the caller (cli.js)
    // Synchronous-looking API for the caller's convenience (`token create` prints it immediately).
    // A knex query builder is lazy — it only starts executing once something calls `.then()`/awaits
    // it — so `ready` must be kicked off eagerly instead of sitting inert until (and unless) a
    // caller awaits it. Naively attaching a second, separate `.catch(() => {})` directly to the
    // query builder does NOT work here: unlike a real Promise, a knex query builder does not
    // memoize its result — every `.then()`/`.catch()` call on it re-runs the query from scratch, so
    // a caller who later awaits `ready` would re-execute (and, for an insert, duplicate) it.
    // `Promise.resolve(builder)` adopts the builder's eventual state by calling its `.then()`
    // exactly once, handing back a real, memoized Promise — safe to attach further handlers to
    // without re-running anything. `ready.catch(() => {})` on *that* real Promise both fires the
    // query off immediately and silences Node's unhandled-rejection warning for callers who never
    // await `ready`; a caller who does await it (the admin CLI, before printing the token) still
    // sees the real rejection if the insert genuinely fails.
    const ready = Promise.resolve(knex('machines').insert({ id, name, token_hash: hash(token), owner_user_id: ownerUserId }));
    ready.catch(() => {});
    return { id, name, token, ready };
  }
  async function machineByToken(token) {
    const row = await knex('machines').where({ token_hash: hash(token) }).whereNull('revoked_at').first();
    return row || null;
  }
  async function touchMachine(id) { await knex('machines').where({ id }).update({ last_seen: knex.fn.now() }); }
  async function listMachines() { return knex('machines').select('id', 'name', 'created_at', 'last_seen', 'revoked_at').orderBy('created_at', 'desc'); }
  async function revokeMachine(id) {
    const n = await knex('machines').where({ id }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
    return n > 0;
  }

  async function findByMachineLocal(machineId, localId) {
    const row = await knex('projects').where({ machine_id: machineId, local_id: localId }).first();
    return row || null;
  }
  async function upsertProject({ machineId, localId, name, kind }) {
    const existing = await findByMachineLocal(machineId, localId);
    if (existing) { await knex('projects').where({ id: existing.id }).update({ name, kind }); return findProject(existing.id); }
    const id = randomId(7); // 10-char base64url, per spec §4
    await knex('projects').insert({ id, machine_id: machineId, local_id: localId, name, kind, published: false });
    return findProject(id);
  }
  async function findProject(id) {
    const row = await knex('projects').where({ id }).first();
    if (!row) return null;
    return { ...row, published: !!row.published };
  }
  async function setPublished(id, published) { await knex('projects').where({ id }).update({ published: !!published }); }
  async function listPublishedByMachine(machineId) {
    return (await knex('projects').where({ machine_id: machineId, published: true })).map((r) => ({ ...r, published: true }));
  }
  async function listPublic() {
    return (await knex('projects').where({ published: true })).map((r) => ({ ...r, published: true }));
  }
  async function saveSnapshot(id, snapshot) {
    await knex('projects').where({ id }).update({ last_snapshot: JSON.stringify(snapshot), snapshot_at: knex.fn.now() });
  }

  const usersModel = createUsersModel(knex);
  const rbacModel = createRbacModel(knex);
  const sessionsModel = createSessionsModel(knex);
  const tokensModel = createTokensModel(knex);
  const sharingModel = createSharingModel(knex);
  const settingsModel = createSettingsModel(knex);
  const groupsModel = createGroupsModel(knex);

  return {
    knex, migrate, createMachine, machineByToken, touchMachine, listMachines, revokeMachine,
    upsertProject, findProject, findByMachineLocal, setPublished, listPublishedByMachine, listPublic, saveSnapshot,
    ...usersModel,
    ...rbacModel,
    ...sessionsModel,
    ...tokensModel,
    ...sharingModel,
    ...settingsModel,
    ...groupsModel,
    destroy: () => knex.destroy(),
  };
}

module.exports = { createDb };
