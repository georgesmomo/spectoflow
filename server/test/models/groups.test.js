'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('createGroup/listGroupsForOwner/renameGroup/deleteGroup; setProjectGroup assigns and clears', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const g = await db.createGroup(owner.id, 'Clients');
    assert.ok(g.id); assert.strictEqual(g.name, 'Clients');
    assert.deepStrictEqual((await db.listGroupsForOwner(owner.id)).map((r) => r.name), ['Clients']);
    await db.renameGroup(g.id, 'Client Work');
    assert.deepStrictEqual((await db.listGroupsForOwner(owner.id)).map((r) => r.name), ['Client Work']);

    const m = await db.createMachine('m', owner.id); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.strictEqual((await db.knex('projects').where({ id: project.id }).first()).group_id, null);
    await db.setProjectGroup(project.id, g.id);
    assert.strictEqual((await db.knex('projects').where({ id: project.id }).first()).group_id, g.id);
    await db.deleteGroup(g.id);
    assert.deepStrictEqual(await db.listGroupsForOwner(owner.id), []);
    assert.strictEqual((await db.knex('projects').where({ id: project.id }).first()).group_id, null); // cleared, project untouched
    await db.setProjectGroup(project.id, null);
    assert.strictEqual((await db.knex('projects').where({ id: project.id }).first()).group_id, null);
  } finally { await db.destroy(); }
});
