'use strict';
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }

function createGroupsModel(knex) {
  async function createGroup(ownerUserId, name) {
    const id = randomId(8);
    await knex('project_groups').insert({ id, owner_user_id: ownerUserId, name });
    return { id, ownerUserId, name };
  }
  async function listGroupsForOwner(ownerUserId) {
    return knex('project_groups').where({ owner_user_id: ownerUserId }).select('id', 'name').orderBy('name');
  }
  async function renameGroup(groupId, name) { await knex('project_groups').where({ id: groupId }).update({ name }); }
  async function deleteGroup(groupId) {
    await knex('projects').where({ group_id: groupId }).update({ group_id: null }); // SQLite's FK ON DELETE SET NULL isn't enforced without PRAGMA foreign_keys=ON, so do it explicitly too
    await knex('project_groups').where({ id: groupId }).delete();
  }
  async function setProjectGroup(projectId, groupId) { await knex('projects').where({ id: projectId }).update({ group_id: groupId }); }
  return { createGroup, listGroupsForOwner, renameGroup, deleteGroup, setProjectGroup };
}
module.exports = { createGroupsModel };
