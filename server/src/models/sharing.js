'use strict';
/*
 * Project membership and invitations. Owner protection (docs/online-dashboard-accounts-design.md
 * §2): the account auto-inserted as `sys-owner` on publish (relay.js) can never have its own
 * membership row changed or removed through these functions — only unpublishing the project locally
 * removes it, and that's a separate, existing code path (relay.js's own `hello` handling already
 * unpublishes; it does not touch project_members at all, so an Owner's membership genuinely survives
 * an unpublish/republish cycle exactly as before).
 */
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function createSharingModel(knex) {
  async function findMembership(projectId, userId) {
    const row = await knex('project_members').where({ project_id: projectId, user_id: userId }).first();
    return row ? { roleId: row.role_id } : null;
  }
  async function addProjectMember(projectId, userId, roleId) {
    const existing = await findMembership(projectId, userId);
    if (existing) await knex('project_members').where({ project_id: projectId, user_id: userId }).update({ role_id: roleId });
    else await knex('project_members').insert({ project_id: projectId, user_id: userId, role_id: roleId });
  }
  async function removeProjectMember(projectId, userId) {
    const existing = await findMembership(projectId, userId);
    if (!existing) return 'not-found';
    if (existing.roleId === 'sys-owner') return 'protected';
    await knex('project_members').where({ project_id: projectId, user_id: userId }).delete();
    return 'ok';
  }
  async function changeMemberRole(projectId, userId, roleId) {
    const existing = await findMembership(projectId, userId);
    if (!existing) return 'not-found';
    if (existing.roleId === 'sys-owner') return 'protected';
    await knex('project_members').where({ project_id: projectId, user_id: userId }).update({ role_id: roleId });
    return 'ok';
  }
  async function getProjectOwnerUserId(projectId) {
    const row = await knex('project_members').where({ project_id: projectId, role_id: 'sys-owner' }).first();
    return row ? row.user_id : null;
  }
  async function listProjectMembers(projectId) {
    const rows = await knex('project_members').join('users', 'users.id', 'project_members.user_id').join('roles', 'roles.id', 'project_members.role_id')
      .where({ 'project_members.project_id': projectId })
      .select('users.id as userId', 'users.email as email', 'roles.id as roleId', 'roles.name as roleName');
    return rows;
  }
  async function createInvitation({ projectId, email, roleId, invitedByUserId }) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await knex('project_invitations').insert({ id, project_id: projectId, email: String(email).toLowerCase(), role_id: roleId, invited_by_user_id: invitedByUserId, token_hash: hashToken(token), expires_at: expiresAt });
    return token;
  }
  async function findInvitationByToken(rawToken) {
    const row = await knex('project_invitations').where({ token_hash: hashToken(rawToken) }).whereNull('accepted_at').first();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return { id: row.id, projectId: row.project_id, email: row.email, roleId: row.role_id, invitedByUserId: row.invited_by_user_id };
  }
  async function acceptInvitation(rawToken, userId) {
    const inv = await findInvitationByToken(rawToken);
    if (!inv) return null;
    // Email-locked (docs/online-dashboard-accounts-design.md §2): an invitation is only acceptable
    // by the account whose email matches the one it was sent to — otherwise anyone who obtains the
    // raw token (forwarded email, shared link, browser history) could join under an unrelated
    // account. A mismatch is treated the same as an invalid token: not consumed, still findable.
    const user = await knex('users').where({ id: userId }).first();
    if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) return null;
    await knex('project_invitations').where({ id: inv.id }).update({ accepted_at: knex.fn.now() });
    await addProjectMember(inv.projectId, userId, inv.roleId);
    return inv.projectId;
  }
  async function hasPendingInvitationForEmail(email) {
    const row = await knex('project_invitations').where({ email: String(email).toLowerCase() }).whereNull('accepted_at').where('expires_at', '>', new Date()).first();
    return !!row;
  }
  return { findMembership, addProjectMember, removeProjectMember, changeMemberRole, getProjectOwnerUserId, listProjectMembers, createInvitation, findInvitationByToken, acceptInvitation, hasPendingInvitationForEmail };
}

module.exports = { createSharingModel };
