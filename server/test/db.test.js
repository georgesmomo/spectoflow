'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('createMachine prints the token once; only its hash is stored; machineByToken looks it up', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    assert.match(m.token, /^spf_[A-Za-z0-9_-]{20,}$/);
    assert.ok(m.id && m.id.length >= 8);
    const row = await db.knex('machines').where({ id: m.id }).first();
    assert.strictEqual(row.token_hash.length, 64);
    assert.notStrictEqual(row.token_hash, m.token);
    const found = await db.machineByToken(m.token);
    assert.strictEqual(found.id, m.id); assert.strictEqual(found.name, 'laptop');
    assert.strictEqual(await db.machineByToken('spf_wrong'), null);
  } finally { await db.destroy(); }
});

test('revokeMachine blanks token lookups; touchMachine bumps last_seen', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('box');
    assert.strictEqual(await db.revokeMachine(m.id), true);
    assert.strictEqual(await db.machineByToken(m.token), null);
    assert.strictEqual(await db.revokeMachine('unknown-id'), false);
    const before = (await db.knex('machines').where({ id: m.id }).first()).last_seen;
    const m2 = db.createMachine('box2');
    await db.touchMachine(m2.id);
    const after = (await db.knex('machines').where({ id: m2.id }).first()).last_seen;
    assert.ok(after, 'last_seen set'); assert.strictEqual(before, null);
  } finally { await db.destroy(); }
});

test('upsertProject assigns a stable server id per (machine, localId) and updates in place on re-announce', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    const p1 = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.ok(p1.id && p1.id.length === 10);
    const p2 = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha renamed', kind: 'spectoflow' });
    assert.strictEqual(p2.id, p1.id); assert.strictEqual(p2.name, 'Alpha renamed');
    const other = db.createMachine('other-box');
    const p3 = await db.upsertProject({ machineId: other.id, localId: 'aaaaaa', name: 'Same local id, other machine', kind: 'spectoflow' });
    assert.notStrictEqual(p3.id, p1.id);
  } finally { await db.destroy(); }
});

test('setPublished / findProject / listPublishedByMachine / listPublic / saveSnapshot', async () => {
  const db = await fresh();
  try {
    const m = db.createMachine('laptop');
    const p = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.strictEqual(await db.findProject(p.id).then((r) => r.published), false);
    assert.deepStrictEqual(await db.listPublishedByMachine(m.id), []);
    assert.deepStrictEqual(await db.listPublic(), []);
    await db.setPublished(p.id, true);
    assert.strictEqual((await db.findProject(p.id)).published, true);
    assert.strictEqual((await db.listPublishedByMachine(m.id))[0].id, p.id);
    assert.strictEqual((await db.listPublic())[0].id, p.id);
    await db.saveSnapshot(p.id, { projectName: 'Alpha', plans: [] });
    const row = await db.findProject(p.id);
    assert.deepStrictEqual(JSON.parse(row.last_snapshot), { projectName: 'Alpha', plans: [] });
    assert.ok(row.snapshot_at);
    await db.setPublished(p.id, false);
    assert.deepStrictEqual(await db.listPublic(), []);
    assert.strictEqual(await db.findProject('unknown'), null);
    assert.strictEqual(await db.findByMachineLocal(m.id, 'zzzzzz'), null);
    assert.strictEqual((await db.findByMachineLocal(m.id, 'aaaaaa')).id, p.id);
  } finally { await db.destroy(); }
});
