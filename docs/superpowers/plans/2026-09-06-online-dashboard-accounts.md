# Online Dashboard Accounts & Sharing (C2+C3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the online dashboard server's single shared access key with real user accounts,
revocable per-device sessions, a unified roles→permissions engine (platform and per-project scope),
email-driven signup/verification/password-reset/invitation flows, project membership with real
enforcement, custom roles, and flat project groups.

**Architecture:** Everything in this plan lives inside `server/` (Fastify + Knex + new real
dependencies — `argon2`, `nodemailer` — since `server/`'s own zero-dependency exemption already
applies from C1). No `lib/`, `bin/`, or `templates/` file changes; root `npm test` is untouched. New
persistence lives in small, focused modules under `server/src/models/` that `server/src/db.js`
aggregates into the one flat `db.xxx(...)` call surface every existing consumer (relay.js,
connector.js, auth.js, cli.js, every test file) already uses — no consumer has to learn a second
object shape. New UI in this plan (signup, login, account, admin, project members, role editor,
group management) is **plain server-rendered HTML pages owned by `server/` itself** (the same inline
`<style>`+vanilla-JS-fetch pattern `server/src/auth.js`'s current `LOGIN_HTML` already uses) — **not**
the shared `lib/dashboard/public/` project dashboard, which stays byte-identical between local and
online per C1's own design and has no natural place for "manage this project's members" (a purely
online-only, account-holder concept the local, single-owner dashboard doesn't need). A later,
separate design pass can restyle these plain pages richly if wanted; this plan's job is that they are
real and fully functional, not that they are beautiful.

**Tech Stack:** Fastify, Knex (SQLite for tests, MySQL/PostgreSQL supported unchanged), `argon2`
(password hashing), `nodemailer` (SMTP, injectable fake transport for tests), `node --test`.

**Spec:** `docs/online-dashboard-accounts-design.md` (binding authority — exact table columns, exact
permission catalog, exact system roles, exact endpoints, the Owner-vs-Admin protected-status rule,
the `platform.view_all_projects` bypass, the `GET /api/hub/projects` re-scoping, and the "only the
project Owner's own custom roles are assignable" rule).

## Global Constraints

- **`SPECTOFLOW_ACCESS_KEY` is removed entirely** — no code path reads it after Task 5. `SESSION_SECRET`
  is also removed: the new session mechanism is hash-lookup (like machine tokens), not HMAC-signed, so
  there is nothing left to sign with a secret.
- **Passwords**: `argon2id` only, via the `argon2` npm package.
- **Session/verification/reset/machine tokens** are all the same shape: `spf_` + 32 random bytes
  (base64url), stored **only** as a SHA-256 hash (`crypto.createHash('sha256').update(token).digest
  ('hex')` — the exact existing `hash()` helper in `server/src/db.js`, reused, never duplicated).
- **Permission keys are stable strings, not surrogate ids** — `permissions.key` (e.g.
  `'project.read'`) is the table's own primary key. **System role ids are fixed, human-readable
  slugs** — `'sys-platform-admin'`, `'sys-owner'`, `'sys-admin'`, `'sys-editor'`, `'sys-viewer'` —
  never random ids, so code references them directly with no fragile name-based lookup. Custom
  (user-created) roles get a random `randomId(8)` id, same shape as every other id in this schema.
- **Everything in `db.js`'s aggregated surface stays a flat, single object** — `server/src/db.js`
  `require()`s each new `server/src/models/*.js` file and spreads its returned functions into the one
  object `createDb()` returns, exactly like the file already does for its own machine/project
  functions. No task introduces a second db-like object any consumer has to juggle.
- **Zero visual/design work required by this plan** beyond "no gradients, functional forms" — the
  existing project-wide zero-gradient rule applies to any inline `<style>` this plan writes, but no
  task needs to consult the design/theming skills; these are plain utilitarian forms.
- **TDD throughout, SQLite for every test** — `sqlite::memory:`, matching every existing
  `server/test/*.test.js` file's own pattern (`createDb('sqlite::memory:')`, `await db.migrate()`).
- **Root `npm test` is untouched by this entire plan** — no task should show a different pass count
  there; only `cd server && npm test` changes.
- **`server/package.json`'s own version** moves from `0.1.0` to `0.2.0` at the end (Task 19) — a
  genuinely breaking change to the server's entire auth model, versioned accordingly; this is
  independent of the root `spectoflow` package's own version, which this plan never touches.

---

### Task 1: `users` table + the users model

**Files:**
- Create: `server/migrations/0003_users.js`
- Create: `server/src/models/users.js`
- Modify: `server/src/db.js` (require + spread `users` model's functions into the aggregated object)
- Test: `server/test/models/users.test.js`

**Interfaces:**
- Consumes: nothing new (uses the existing `knex` instance `createDb()` already builds, and the
  existing `hash()` helper pattern already in `db.js` — but users need `argon2`, not SHA-256, so
  `users.js` brings its own hashing, not `db.js`'s `hash()`).
- Produces: `db.createUser(email, password)` → `Promise<{id, email, email_verified_at:null,
  created_at, last_login_at:null}>` (never returns `password_hash`); `db.findUserByEmail(email)` →
  `Promise<row|null>` (row DOES include `password_hash`, for `verifyPassword` below — internal use
  only, never returned to an HTTP caller); `db.findUserById(id)` → `Promise<row|null>` (same,
  includes `password_hash`); `db.verifyPassword(user, password)` → `Promise<boolean>`;
  `db.updatePassword(userId, password)` → `Promise<void>`; `db.markEmailVerified(userId)` →
  `Promise<void>`; `db.touchLastLogin(userId)` → `Promise<void>`; `db.countUsers()` →
  `Promise<number>`; `db.listUsers()` → `Promise<Array<{id,email,email_verified_at,created_at,
  last_login_at}>>` (never includes `password_hash`).

- [ ] **Step 1: Install `argon2`**

```bash
cd server && npm install argon2@^0.41.1
```

- [ ] **Step 2: Write the migration**

```js
// server/migrations/0003_users.js
'use strict';
exports.up = (knex) => knex.schema.createTable('users', (t) => {
  t.string('id', 20).primary();
  t.string('email', 320).notNullable().unique();
  t.string('password_hash', 200).notNullable();
  t.timestamp('email_verified_at').nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_login_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('users');
```

- [ ] **Step 3: Write the failing tests**

```js
// server/test/models/users.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('createUser hashes the password (argon2id) and never returns it; findUserByEmail/findUserById round-trip', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('Alice@Example.com', 'correct horse battery staple');
    assert.ok(u.id);
    assert.strictEqual(u.email, 'alice@example.com'); // lowercased
    assert.strictEqual(u.password_hash, undefined);
    assert.strictEqual(u.email_verified_at, null);
    assert.strictEqual(u.last_login_at, null);
    const byEmail = await db.findUserByEmail('ALICE@EXAMPLE.COM'); // lookup is case-insensitive too
    assert.strictEqual(byEmail.id, u.id);
    assert.ok(byEmail.password_hash && byEmail.password_hash.startsWith('$argon2id$'));
    const byId = await db.findUserById(u.id);
    assert.strictEqual(byId.email, 'alice@example.com');
    assert.strictEqual(await db.findUserByEmail('nobody@example.com'), null);
    assert.strictEqual(await db.findUserById('nope'), null);
  } finally { await db.destroy(); }
});

test('a duplicate email (case-insensitive) is rejected', async () => {
  const db = await fresh();
  try {
    await db.createUser('bob@example.com', 'password123456');
    await assert.rejects(() => db.createUser('Bob@Example.com', 'different-password'));
  } finally { await db.destroy(); }
});

test('verifyPassword: correct password true, wrong password false', async () => {
  const db = await fresh();
  try {
    await db.createUser('carol@example.com', 'the-real-password');
    const user = await db.findUserByEmail('carol@example.com');
    assert.strictEqual(await db.verifyPassword(user, 'the-real-password'), true);
    assert.strictEqual(await db.verifyPassword(user, 'wrong'), false);
  } finally { await db.destroy(); }
});

test('updatePassword replaces the hash; markEmailVerified/touchLastLogin set their timestamps', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('dave@example.com', 'original-password');
    await db.updatePassword(u.id, 'new-password');
    const afterUpdate = await db.findUserByEmail('dave@example.com');
    assert.strictEqual(await db.verifyPassword(afterUpdate, 'original-password'), false);
    assert.strictEqual(await db.verifyPassword(afterUpdate, 'new-password'), true);
    assert.strictEqual((await db.findUserById(u.id)).email_verified_at, null);
    await db.markEmailVerified(u.id);
    assert.ok((await db.findUserById(u.id)).email_verified_at);
    assert.strictEqual((await db.findUserById(u.id)).last_login_at, null);
    await db.touchLastLogin(u.id);
    assert.ok((await db.findUserById(u.id)).last_login_at);
  } finally { await db.destroy(); }
});

test('countUsers / listUsers never leak password_hash', async () => {
  const db = await fresh();
  try {
    assert.strictEqual(await db.countUsers(), 0);
    await db.createUser('eve@example.com', 'password-one');
    await db.createUser('frank@example.com', 'password-two');
    assert.strictEqual(await db.countUsers(), 2);
    const rows = await db.listUsers();
    assert.strictEqual(rows.length, 2);
    for (const r of rows) assert.strictEqual(r.password_hash, undefined);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 4: Run to see them fail**

Run: `cd server && node --test test/models/users.test.js`
Expected: FAIL — `db.createUser is not a function`.

- [ ] **Step 5: Write `server/src/models/users.js`**

```js
'use strict';
/*
 * User accounts. Passwords are hashed with argon2id (current OWASP-recommended default) — never
 * SHA-256, unlike the SPF_-token hashing used elsewhere in this schema (machines/sessions/
 * verification tokens), since those are high-entropy random secrets, not human-chosen passwords.
 */
const crypto = require('crypto');
const argon2 = require('argon2');

function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
const PUBLIC_COLUMNS = ['id', 'email', 'email_verified_at', 'created_at', 'last_login_at'];

function createUsersModel(knex) {
  async function createUser(email, password) {
    const id = randomId(8);
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });
    await knex('users').insert({ id, email: String(email).toLowerCase(), password_hash });
    return findUserById(id);
  }
  async function findUserByEmail(email) {
    const row = await knex('users').where({ email: String(email).toLowerCase() }).first();
    return row || null;
  }
  async function findUserById(id) {
    const row = await knex('users').where({ id }).first();
    return row || null;
  }
  async function verifyPassword(user, password) {
    return argon2.verify(user.password_hash, password);
  }
  async function updatePassword(userId, password) {
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });
    await knex('users').where({ id: userId }).update({ password_hash });
  }
  async function markEmailVerified(userId) {
    await knex('users').where({ id: userId }).update({ email_verified_at: knex.fn.now() });
  }
  async function touchLastLogin(userId) {
    await knex('users').where({ id: userId }).update({ last_login_at: knex.fn.now() });
  }
  async function countUsers() {
    const r = await knex('users').count({ n: 'id' }).first();
    return Number(r.n);
  }
  async function listUsers() {
    return knex('users').select(PUBLIC_COLUMNS).orderBy('created_at', 'asc');
  }
  return {
    createUser: async (...a) => { const u = await createUser(...a); const { password_hash, ...pub } = u; return pub; },
    findUserByEmail, findUserById, verifyPassword, updatePassword, markEmailVerified, touchLastLogin,
    countUsers, listUsers,
  };
}

module.exports = { createUsersModel };
```

- [ ] **Step 6: Wire it into `server/src/db.js`**

Add near the top, with the other requires:
```js
const { createUsersModel } = require('./models/users');
```

Inside `createDb(databaseUrl)`, right before the final `return { ... }`, add:
```js
  const usersModel = createUsersModel(knex);
```

Add `...usersModel,` to the object literal in the final `return { knex, migrate, createMachine, ...
}` statement (anywhere in the object — order doesn't matter since every key is unique).

- [ ] **Step 7: Run the tests**

Run: `cd server && node --test test/models/users.test.js`
Expected: PASS.

- [ ] **Step 8: Run the full server suite** (confirm nothing else broke)

Run: `cd server && npm test`
Expected: same pass count as before, plus 5 new tests, 0 new failures (this task adds a table and a
model nothing else references yet).

- [ ] **Step 9: Commit**

```bash
cd server && git add package.json package-lock.json migrations/0003_users.js src/models/users.js src/db.js test/models/users.test.js
git commit -m "feat(server): users table + model — argon2id password hashing"
```

---

### Task 2: RBAC schema + seed data (permissions, roles, role_permissions, user_platform_roles)

**Files:**
- Create: `server/migrations/0004_rbac.js`
- Test: `server/test/models/rbac-seed.test.js`

**Interfaces:**
- Consumes: `db.knex` (direct queries — this task verifies the migration's seed data, no model
  functions yet; those are Task 3's job).
- Produces: the 4 tables below, with permissions and system roles already seeded by the migration
  itself (a migration is the right place for fixed, code-defined reference data — it runs exactly
  once per fresh database, unlike an app-boot-time seed that would need its own idempotency check).

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0004_rbac.js
'use strict';
// The permission catalog and the 5 system roles are fixed, code-defined reference data — seeded
// directly in this migration (runs once per database) rather than at app boot, so there is no
// idempotency check to get wrong and no risk of the seed silently drifting from what code expects.
const PERMISSIONS = [
  { key: 'platform.manage_signup', scope: 'platform', label: 'Change the signup mode' },
  { key: 'platform.manage_users', scope: 'platform', label: 'Manage any account' },
  { key: 'platform.manage_roles', scope: 'platform', label: 'Create/edit platform-scope custom roles' },
  { key: 'platform.view_all_projects', scope: 'platform', label: 'View every project on the instance' },
  { key: 'project.read', scope: 'project', label: 'View a project (board, tasks, files)' },
  { key: 'project.write', scope: 'project', label: 'Edit tasks, run agents, write files, chat' },
  { key: 'project.manage_settings', scope: 'project', label: 'Change agent/mode/language/design config' },
  { key: 'project.manage_members', scope: 'project', label: 'Invite/remove members, change their role' },
];
// role id -> [permission keys]. Owner and Admin deliberately hold the identical permission set — see
// docs/online-dashboard-accounts-design.md §2: what distinguishes Owner is protected membership
// status (enforced in application code, Task 12), not a broader permission list.
const SYSTEM_ROLES = [
  { id: 'sys-platform-admin', scope: 'platform', name: 'Platform Admin', perms: ['platform.manage_signup', 'platform.manage_users', 'platform.manage_roles', 'platform.view_all_projects'] },
  { id: 'sys-owner', scope: 'project', name: 'Owner', perms: ['project.read', 'project.write', 'project.manage_settings', 'project.manage_members'] },
  { id: 'sys-admin', scope: 'project', name: 'Admin', perms: ['project.read', 'project.write', 'project.manage_settings', 'project.manage_members'] },
  { id: 'sys-editor', scope: 'project', name: 'Editor', perms: ['project.read', 'project.write'] },
  { id: 'sys-viewer', scope: 'project', name: 'Viewer', perms: ['project.read'] },
];

exports.up = async (knex) => {
  await knex.schema.createTable('permissions', (t) => {
    t.string('key', 60).primary();
    t.string('scope', 20).notNullable();
    t.string('label', 200).notNullable();
  });
  await knex.schema.createTable('roles', (t) => {
    t.string('id', 20).primary();
    t.string('scope', 20).notNullable();
    t.string('owner_user_id', 20).nullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_system').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('role_permissions', (t) => {
    t.string('role_id', 20).notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.string('permission_key', 60).notNullable().references('key').inTable('permissions').onDelete('CASCADE');
    t.primary(['role_id', 'permission_key']);
  });
  await knex.schema.createTable('user_platform_roles', (t) => {
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role_id', 20).notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.primary(['user_id', 'role_id']);
  });
  await knex('permissions').insert(PERMISSIONS);
  for (const r of SYSTEM_ROLES) {
    await knex('roles').insert({ id: r.id, scope: r.scope, owner_user_id: null, name: r.name, is_system: true });
    await knex('role_permissions').insert(r.perms.map((permission_key) => ({ role_id: r.id, permission_key })));
  }
};
exports.down = (knex) => knex.schema
  .dropTableIfExists('user_platform_roles')
  .then(() => knex.schema.dropTableIfExists('role_permissions'))
  .then(() => knex.schema.dropTableIfExists('roles'))
  .then(() => knex.schema.dropTableIfExists('permissions'));
```

Note: `roles.owner_user_id` references `users.id`, so this migration must run **after** `0003_users.js`
— Knex applies migrations in filename order, and `0004` already sorts after `0003`, so no extra
wiring is needed.

- [ ] **Step 2: Write the failing tests**

```js
// server/test/models/rbac-seed.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('the permission catalog is seeded exactly (8 rows, correct scopes)', async () => {
  const db = await fresh();
  try {
    const rows = await db.knex('permissions').select('key', 'scope').orderBy('key');
    assert.strictEqual(rows.length, 8);
    const platform = rows.filter((r) => r.scope === 'platform').map((r) => r.key).sort();
    const project = rows.filter((r) => r.scope === 'project').map((r) => r.key).sort();
    assert.deepStrictEqual(platform, ['platform.manage_roles', 'platform.manage_signup', 'platform.manage_users', 'platform.view_all_projects']);
    assert.deepStrictEqual(project, ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
  } finally { await db.destroy(); }
});

test('the 5 system roles are seeded with the right permissions and are marked is_system', async () => {
  const db = await fresh();
  try {
    const roles = await db.knex('roles').select('id', 'scope', 'name', 'is_system', 'owner_user_id');
    assert.strictEqual(roles.length, 5);
    for (const r of roles) { assert.strictEqual(r.is_system, 1); assert.strictEqual(r.owner_user_id, null); }
    const permsOf = async (roleId) => (await db.knex('role_permissions').where({ role_id: roleId }).select('permission_key').orderBy('permission_key')).map((r) => r.permission_key);
    assert.deepStrictEqual(await permsOf('sys-platform-admin'), ['platform.manage_roles', 'platform.manage_signup', 'platform.manage_users', 'platform.view_all_projects']);
    assert.deepStrictEqual(await permsOf('sys-owner'), ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-admin'), ['project.manage_members', 'project.manage_settings', 'project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-editor'), ['project.read', 'project.write']);
    assert.deepStrictEqual(await permsOf('sys-viewer'), ['project.read']);
  } finally { await db.destroy(); }
});

test('role_permissions and user_platform_roles cascade-delete when their role/user is deleted', async () => {
  const db = await fresh();
  try {
    await db.knex('users').insert({ id: 'u1', email: 'x@example.com', password_hash: 'irrelevant-for-this-test' });
    await db.knex('user_platform_roles').insert({ user_id: 'u1', role_id: 'sys-platform-admin' });
    assert.strictEqual((await db.knex('user_platform_roles').where({ user_id: 'u1' })).length, 1);
    await db.knex('users').where({ id: 'u1' }).delete();
    assert.strictEqual((await db.knex('user_platform_roles').where({ user_id: 'u1' })).length, 0);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && node --test test/models/rbac-seed.test.js`
Expected: FAIL — `no such table: permissions`.

- [ ] **Step 4: Run migrate + the tests**

Run: `cd server && node --test test/models/rbac-seed.test.js`
Expected: PASS (the migration file itself, written in Step 1, is the whole implementation for this
task — nothing else to write).

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 1's ending count, plus 3 new tests, 0 new failures.

- [ ] **Step 6: Commit**

```bash
cd server && git add migrations/0004_rbac.js test/models/rbac-seed.test.js
git commit -m "feat(server): RBAC schema — permissions catalog, system roles, seeded by migration"
```

---

### Task 3: The RBAC engine — generic role CRUD + platform-scope permission resolution

**Files:**
- Create: `server/src/models/rbac.js`
- Modify: `server/src/db.js` (require + spread)
- Test: `server/test/models/rbac.test.js`

**Interfaces:**
- Consumes: Task 1's `db.createUser`/`db.findUserById`; Task 2's seeded `permissions`/`roles` tables.
- Produces: `db.SYSTEM_ROLE_IDS` = `{ PLATFORM_ADMIN:'sys-platform-admin', OWNER:'sys-owner',
  ADMIN:'sys-admin', EDITOR:'sys-editor', VIEWER:'sys-viewer' }` (a plain constant object, not a
  function); `db.createRole({scope, ownerUserId, name, permissionKeys})` → `Promise<role row incl.
  permissionKeys array>` (rejects if any `permissionKeys` entry isn't in that `scope`'s catalog);
  `db.deleteRole(roleId)` → `Promise<boolean>` (throws if `is_system`; the role's own
  `owner_user_id` is not checked here — Task 12/14's callers are responsible for confirming the
  caller owns it before calling this); `db.getRole(roleId)` → `Promise<{id,scope,ownerUserId,name,
  isSystem,permissionKeys}|null>`; `db.listRolesByScope(scope, ownerUserId)` → `Promise<Array<role>>`
  (every system role of that scope, plus every custom role of that scope owned by `ownerUserId`);
  `db.assignPlatformRole(userId, roleId)` → `Promise<void>`; `db.removePlatformRole(userId, roleId)`
  → `Promise<void>`; `db.listPlatformRolesForUser(userId)` → `Promise<Array<role>>`;
  `db.hasPlatformPermission(userId, permissionKey)` → `Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

```js
// server/test/models/rbac.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('SYSTEM_ROLE_IDS names the 5 seeded ids', async () => {
  const db = await fresh();
  try {
    assert.deepStrictEqual(db.SYSTEM_ROLE_IDS, { PLATFORM_ADMIN: 'sys-platform-admin', OWNER: 'sys-owner', ADMIN: 'sys-admin', EDITOR: 'sys-editor', VIEWER: 'sys-viewer' });
  } finally { await db.destroy(); }
});

test('createRole/getRole/deleteRole: a custom role round-trips, rejects a permission from the wrong scope, and cannot delete a system role', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const role = await db.createRole({ scope: 'project', ownerUserId: owner.id, name: 'Reviewer', permissionKeys: ['project.read'] });
    assert.ok(role.id); assert.strictEqual(role.name, 'Reviewer'); assert.strictEqual(role.isSystem, false);
    assert.deepStrictEqual(role.permissionKeys, ['project.read']);
    const fetched = await db.getRole(role.id);
    assert.deepStrictEqual(fetched.permissionKeys, ['project.read']);
    await assert.rejects(() => db.createRole({ scope: 'project', ownerUserId: owner.id, name: 'Bad', permissionKeys: ['platform.manage_users'] }), /scope/i);
    assert.strictEqual(await db.deleteRole(role.id), true);
    assert.strictEqual(await db.getRole(role.id), null);
    await assert.rejects(() => db.deleteRole(db.SYSTEM_ROLE_IDS.VIEWER), /system/i);
  } finally { await db.destroy(); }
});

test('listRolesByScope returns every system role of that scope plus only the given owner\'s custom roles', async () => {
  const db = await fresh();
  try {
    const alice = await db.createUser('alice@example.com', 'password-123456');
    const bob = await db.createUser('bob@example.com', 'password-123456');
    await db.createRole({ scope: 'project', ownerUserId: alice.id, name: 'Alice Custom', permissionKeys: ['project.read'] });
    await db.createRole({ scope: 'project', ownerUserId: bob.id, name: 'Bob Custom', permissionKeys: ['project.read'] });
    const forAlice = await db.listRolesByScope('project', alice.id);
    const names = forAlice.map((r) => r.name).sort();
    assert.deepStrictEqual(names, ['Admin', 'Alice Custom', 'Editor', 'Owner', 'Viewer']);
    assert.ok(!names.includes('Bob Custom'));
  } finally { await db.destroy(); }
});

test('assignPlatformRole/removePlatformRole/listPlatformRolesForUser/hasPlatformPermission', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('admin@example.com', 'password-123456');
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), false);
    assert.deepStrictEqual(await db.listPlatformRolesForUser(u.id), []);
    await db.assignPlatformRole(u.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), true);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'project.read'), false); // wrong scope entirely, never true
    assert.strictEqual((await db.listPlatformRolesForUser(u.id)).length, 1);
    await db.removePlatformRole(u.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    assert.strictEqual(await db.hasPlatformPermission(u.id, 'platform.manage_signup'), false);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && node --test test/models/rbac.test.js`
Expected: FAIL — `db.SYSTEM_ROLE_IDS is undefined`.

- [ ] **Step 3: Write `server/src/models/rbac.js`**

```js
'use strict';
/*
 * The RBAC engine's generic half: role/permission CRUD and platform-scope permission resolution.
 * Project-scope resolution (a user's effective permissions on a SPECIFIC project) is Task 12's job
 * — it needs the project_members table, which doesn't exist until then.
 */
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }

const SYSTEM_ROLE_IDS = { PLATFORM_ADMIN: 'sys-platform-admin', OWNER: 'sys-owner', ADMIN: 'sys-admin', EDITOR: 'sys-editor', VIEWER: 'sys-viewer' };

function createRbacModel(knex) {
  async function getRole(roleId) {
    const row = await knex('roles').where({ id: roleId }).first();
    if (!row) return null;
    const perms = await knex('role_permissions').where({ role_id: roleId }).select('permission_key').orderBy('permission_key');
    return { id: row.id, scope: row.scope, ownerUserId: row.owner_user_id, name: row.name, isSystem: !!row.is_system, permissionKeys: perms.map((p) => p.permission_key) };
  }
  async function createRole({ scope, ownerUserId, name, permissionKeys }) {
    const validKeys = (await knex('permissions').where({ scope }).select('key')).map((r) => r.key);
    for (const k of permissionKeys) {
      if (!validKeys.includes(k)) throw new Error(`permission "${k}" is not in the "${scope}" scope`);
    }
    const id = randomId(8);
    await knex('roles').insert({ id, scope, owner_user_id: ownerUserId, name, is_system: false });
    if (permissionKeys.length) await knex('role_permissions').insert(permissionKeys.map((permission_key) => ({ role_id: id, permission_key })));
    return getRole(id);
  }
  async function deleteRole(roleId) {
    const row = await knex('roles').where({ id: roleId }).first();
    if (!row) return false;
    if (row.is_system) throw new Error('cannot delete a system role');
    await knex('roles').where({ id: roleId }).delete(); // role_permissions cascades
    return true;
  }
  async function listRolesByScope(scope, ownerUserId) {
    const rows = await knex('roles').where({ scope }).andWhere((qb) => qb.where({ is_system: true }).orWhere({ owner_user_id: ownerUserId })).orderBy('name');
    return Promise.all(rows.map((r) => getRole(r.id)));
  }
  async function assignPlatformRole(userId, roleId) {
    const exists = await knex('user_platform_roles').where({ user_id: userId, role_id: roleId }).first();
    if (!exists) await knex('user_platform_roles').insert({ user_id: userId, role_id: roleId });
  }
  async function removePlatformRole(userId, roleId) {
    await knex('user_platform_roles').where({ user_id: userId, role_id: roleId }).delete();
  }
  async function listPlatformRolesForUser(userId) {
    const rows = await knex('user_platform_roles').where({ user_id: userId }).select('role_id');
    return Promise.all(rows.map((r) => getRole(r.role_id)));
  }
  async function hasPlatformPermission(userId, permissionKey) {
    const row = await knex('user_platform_roles')
      .join('role_permissions', 'role_permissions.role_id', 'user_platform_roles.role_id')
      .where({ 'user_platform_roles.user_id': userId, 'role_permissions.permission_key': permissionKey })
      .first();
    return !!row;
  }
  return { SYSTEM_ROLE_IDS, getRole, createRole, deleteRole, listRolesByScope, assignPlatformRole, removePlatformRole, listPlatformRolesForUser, hasPlatformPermission };
}

module.exports = { createRbacModel, SYSTEM_ROLE_IDS };
```

- [ ] **Step 4: Wire it into `server/src/db.js`**

Add near the top:
```js
const { createRbacModel } = require('./models/rbac');
```
Inside `createDb`, before the final `return`:
```js
  const rbacModel = createRbacModel(knex);
```
Add `...rbacModel,` to the final returned object.

- [ ] **Step 5: Run the tests**

Run: `cd server && node --test test/models/rbac.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 2's ending count, plus 4 new tests, 0 new failures.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/models/rbac.js src/db.js test/models/rbac.test.js
git commit -m "feat(server): RBAC engine — generic role CRUD + platform-scope permission resolution"
```

---

### Task 4: `sessions` table + the sessions model

**Files:**
- Create: `server/migrations/0005_sessions.js`
- Create: `server/src/models/sessions.js`
- Modify: `server/src/db.js` (require + spread)
- Test: `server/test/models/sessions.test.js`

**Interfaces:**
- Consumes: Task 1's `users` table (FK).
- Produces: `db.createSession(userId, {userAgent, ip})` → `Promise<{id, token, userId, userAgent, ip,
  createdAt, lastSeenAt, revokedAt:null}>` (`token` is the ONLY time the plaintext is ever returned —
  matching `createMachine`'s existing "shown once" convention exactly); `db.findSessionByToken(token)`
  → `Promise<row|null>` (null if revoked or the token doesn't hash-match anything — never returns a
  revoked session, so a caller doesn't have to separately check `revokedAt`); `db.touchSession(id)` →
  `Promise<void>` (bumps `lastSeenAt`); `db.revokeSession(id)` → `Promise<boolean>`;
  `db.revokeAllSessionsForUser(userId)` → `Promise<number>` (count revoked); `db.listSessionsForUser
  (userId)` → `Promise<Array<{id,userAgent,ip,createdAt,lastSeenAt}>>` (never includes the token hash
  — only active, non-revoked sessions, ordered most-recently-active first).

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0005_sessions.js
'use strict';
exports.up = (knex) => knex.schema.createTable('sessions', (t) => {
  t.string('id', 20).primary();
  t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
  t.string('token_hash', 64).notNullable().unique();
  t.string('user_agent', 300).nullable();
  t.string('ip', 64).nullable();
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('revoked_at').nullable();
});
exports.down = (knex) => knex.schema.dropTableIfExists('sessions');
```

- [ ] **Step 2: Write the failing tests**

```js
// server/test/models/sessions.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }
async function user(db, email = 'x@example.com') { return db.createUser(email, 'password-123456'); }

test('createSession returns the token once; findSessionByToken looks it up and never re-returns the token', async () => {
  const db = await fresh();
  try {
    const u = await user(db);
    const s = await db.createSession(u.id, { userAgent: 'TestAgent/1.0', ip: '127.0.0.1' });
    assert.match(s.token, /^spf_[A-Za-z0-9_-]{20,}$/);
    const found = await db.findSessionByToken(s.token);
    assert.strictEqual(found.id, s.id);
    assert.strictEqual(found.userId, u.id);
    assert.strictEqual(found.userAgent, 'TestAgent/1.0');
    assert.strictEqual(found.token, undefined);
    assert.strictEqual(await db.findSessionByToken('spf_wrong'), null);
  } finally { await db.destroy(); }
});

test('touchSession bumps last_seen_at; revokeSession makes findSessionByToken return null', async () => {
  const db = await fresh();
  try {
    const u = await user(db);
    const s = await db.createSession(u.id, { userAgent: 'A', ip: '1.2.3.4' });
    const before = (await db.findSessionByToken(s.token)).lastSeenAt;
    await new Promise((r) => setTimeout(r, 20));
    await db.touchSession(s.id);
    const after = (await db.findSessionByToken(s.token)).lastSeenAt;
    assert.notStrictEqual(before, after);
    assert.strictEqual(await db.revokeSession(s.id), true);
    assert.strictEqual(await db.findSessionByToken(s.token), null);
    assert.strictEqual(await db.revokeSession('unknown-id'), false);
  } finally { await db.destroy(); }
});

test('revokeAllSessionsForUser revokes only that user\'s sessions; listSessionsForUser excludes revoked ones and the token itself', async () => {
  const db = await fresh();
  try {
    const alice = await user(db, 'alice@example.com');
    const bob = await user(db, 'bob@example.com');
    const s1 = await db.createSession(alice.id, { userAgent: 'A1', ip: '1.1.1.1' });
    const s2 = await db.createSession(alice.id, { userAgent: 'A2', ip: '2.2.2.2' });
    const s3 = await db.createSession(bob.id, { userAgent: 'B1', ip: '3.3.3.3' });
    assert.strictEqual(await db.revokeAllSessionsForUser(alice.id), 2);
    assert.strictEqual(await db.findSessionByToken(s1.token), null);
    assert.strictEqual(await db.findSessionByToken(s2.token), null);
    assert.ok(await db.findSessionByToken(s3.token)); // bob's session untouched
    const bobList = await db.listSessionsForUser(bob.id);
    assert.strictEqual(bobList.length, 1);
    assert.strictEqual(bobList[0].token, undefined);
    assert.strictEqual((await db.listSessionsForUser(alice.id)).length, 0);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && node --test test/models/sessions.test.js`
Expected: FAIL — `db.createSession is not a function`.

- [ ] **Step 4: Write `server/src/models/sessions.js`**

```js
'use strict';
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function toPublic(row) { return { id: row.id, userId: row.user_id, userAgent: row.user_agent, ip: row.ip, createdAt: row.created_at, lastSeenAt: row.last_seen_at }; }

function createSessionsModel(knex) {
  async function createSession(userId, { userAgent, ip } = {}) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    await knex('sessions').insert({ id, user_id: userId, token_hash: hashToken(token), user_agent: userAgent || null, ip: ip || null });
    return { ...toPublic(await knex('sessions').where({ id }).first()), token };
  }
  async function findSessionByToken(token) {
    const row = await knex('sessions').where({ token_hash: hashToken(token) }).whereNull('revoked_at').first();
    return row ? toPublic(row) : null;
  }
  async function touchSession(id) {
    await knex('sessions').where({ id }).update({ last_seen_at: knex.fn.now() });
  }
  async function revokeSession(id) {
    const n = await knex('sessions').where({ id }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
    return n > 0;
  }
  async function revokeAllSessionsForUser(userId) {
    return knex('sessions').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: knex.fn.now() });
  }
  async function listSessionsForUser(userId) {
    const rows = await knex('sessions').where({ user_id: userId }).whereNull('revoked_at').orderBy('last_seen_at', 'desc');
    return rows.map(toPublic);
  }
  return { createSession, findSessionByToken, touchSession, revokeSession, revokeAllSessionsForUser, listSessionsForUser };
}

module.exports = { createSessionsModel };
```

- [ ] **Step 5: Wire it into `server/src/db.js`**

Add the require and spread, same pattern as Tasks 1 and 3.

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/models/sessions.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 3's ending count, plus 3 new tests, 0 new failures.

- [ ] **Step 8: Commit**

```bash
cd server && git add migrations/0005_sessions.js src/models/sessions.js src/db.js test/models/sessions.test.js
git commit -m "feat(server): sessions table + model — revocable, per-device, hash-lookup tokens"
```

---

### Task 5: Replace the auth mechanism — real signup/login/logout, remove the access-key model

**Files:**
- Modify: `server/src/auth.js` (near-total rewrite)
- Modify: `server/src/app.js` (`buildApp`'s signature: `accessKey`/`sessionSecret` removed)
- Modify: `server/src/index.js` (boot: `SPECTOFLOW_ACCESS_KEY`/`SESSION_SECRET` env handling removed)
- Modify: `server/test/auth.test.js` (full rewrite for the new flow)

**Interfaces:**
- Consumes: Task 1's `db.createUser/findUserByEmail/verifyPassword/touchLastLogin`; Task 4's
  `db.createSession/findSessionByToken/touchSession`.
- Produces: `registerAuth(fastify, { db, insecureDev })` (², a new required `db` param, `accessKey`
  and `sessionSecret` **removed**) registers `POST /signup`, `POST /login`, `POST /logout`, `GET
  /signup` and `GET /login` (plain HTML pages), and the `onRequest` hook that resolves the session
  cookie into `req.user = {id, email}` (decorated onto the request — later tasks' routes read
  `req.user.id`) or 401s. `buildApp({db, insecureDev, publicDir, trustProxy, onFrame, registry})` —
  no more `accessKey`/`sessionSecret` params anywhere in the call chain. `isPublic(url)` keeps its
  exact current export shape and exact current public-route list (`/healthz`, `/login`,
  `/connector/`, `/login-assets/`) plus **adds** `/signup` (exact match, same bypass-prevention
  reasoning as `/login`'s existing exact-match entry).

- [ ] **Step 1: Write the failing tests** (full replacement of `server/test/auth.test.js`)

```js
// server/test/auth.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../src/app');
const { createDb } = require('../src/db');

async function app(opts = {}) {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const a = await buildApp({ db, insecureDev: false, publicDir: __dirname, ...opts });
  return { app: a, db };
}
async function signup(a, email = 'alice@example.com', password = 'a-real-password-123') {
  return a.inject({ method: 'POST', url: '/signup', payload: { email, password } });
}

test('/healthz is public and needs no cookie', async () => {
  const { app: a, db } = await app();
  try { const r = await a.inject({ method: 'GET', url: '/healthz' }); assert.strictEqual(r.statusCode, 200); }
  finally { await a.close(); await db.destroy(); }
});

test('every other route is 401 without a session cookie; GET /login and GET /signup are public', async () => {
  const { app: a, db } = await app();
  try {
    assert.strictEqual((await a.inject({ method: 'GET', url: '/' })).statusCode, 401);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/login' })).statusCode, 200);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/signup' })).statusCode, 200);
    assert.strictEqual((await a.inject({ method: 'GET', url: '/loginZZZ' })).statusCode, 401); // no bypass-in-waiting, same rule as before
    assert.strictEqual((await a.inject({ method: 'GET', url: '/signupZZZ' })).statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /signup creates a real account, sets a working session cookie, and rejects a duplicate email', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    const r = await signup(a);
    assert.strictEqual(r.statusCode, 200, r.body);
    const cookie = r.cookies.find((c) => c.name === 'spf_session');
    assert.ok(cookie); assert.strictEqual(cookie.httpOnly, true); assert.strictEqual(cookie.sameSite, 'Lax');
    const protectedOk = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie.value } });
    assert.strictEqual(protectedOk.statusCode, 200);
    assert.match(protectedOk.body, /<html/i);
    const dup = await signup(a);
    assert.strictEqual(dup.statusCode, 409);
    const user = await db.findUserByEmail('alice@example.com');
    assert.ok(user);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login: correct credentials set a cookie; wrong password/unknown email are 401 and set no cookie; a tampered cookie is 401', async () => {
  const { app: a, db } = await app();
  try {
    await signup(a);
    const wrong = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'nope' } });
    assert.strictEqual(wrong.statusCode, 401); assert.strictEqual(wrong.cookies.length, 0);
    const unknown = await a.inject({ method: 'POST', url: '/login', payload: { email: 'nobody@example.com', password: 'whatever12345' } });
    assert.strictEqual(unknown.statusCode, 401);
    const ok = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'a-real-password-123' } });
    assert.strictEqual(ok.statusCode, 200);
    const cookie = ok.cookies.find((c) => c.name === 'spf_session').value;
    assert.strictEqual((await a.inject({ method: 'GET', url: '/healthz' })).statusCode, 200); // public regardless
    const tampered = cookie.slice(0, -1) + (cookie.slice(-1) === 'a' ? 'b' : 'a');
    assert.strictEqual((await a.inject({ method: 'GET', url: '/', cookies: { spf_session: tampered } })).statusCode, 401);
    const user = await db.findUserByEmail('alice@example.com');
    assert.ok(user.last_login_at);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /logout revokes the session; the same cookie no longer authorizes', async () => {
  const { app: a, db } = await app();
  try {
    const r = await signup(a);
    const cookie = r.cookies.find((c) => c.name === 'spf_session').value;
    const before = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie } });
    assert.strictEqual(before.statusCode, 200);
    const out = await a.inject({ method: 'POST', url: '/logout', cookies: { spf_session: cookie } });
    assert.strictEqual(out.statusCode, 200);
    const after = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: cookie } });
    assert.strictEqual(after.statusCode, 401);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /login is rate-limited: the 11th attempt within the window is 429', async () => {
  const { app: a, db } = await app();
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await a.inject({ method: 'POST', url: '/login', payload: { email: 'nobody@example.com', password: 'nope' } });
    assert.strictEqual(last.statusCode, 429);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /signup validates: missing fields 400, a too-short password 400', async () => {
  const { app: a, db } = await app();
  try {
    assert.strictEqual((await a.inject({ method: 'POST', url: '/signup', payload: { email: 'x@example.com' } })).statusCode, 400);
    assert.strictEqual((await a.inject({ method: 'POST', url: '/signup', payload: { email: 'x@example.com', password: 'short' } })).statusCode, 400);
  } finally { await a.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && node --test test/auth.test.js`
Expected: FAIL — `buildApp` still requires `accessKey`, `/signup` doesn't exist.

- [ ] **Step 3: Rewrite `server/src/auth.js`**

```js
'use strict';
/*
 * C2 access control: real accounts, real per-device sessions. A session token (same shape as a
 * machine token — `spf_` + 32 random bytes) is looked up by its SHA-256 hash (server/src/db.js's
 * `sessions` model, Task 4) — there is nothing to sign and no shared secret, unlike C1's now-removed
 * single-access-key HMAC cookie. `req.user = {id, email}` is decorated onto every authenticated
 * request for downstream routes/hooks to read.
 */
const fastifyCookie = require('@fastify/cookie');
const fastifyRateLimit = require('@fastify/rate-limit');

const COOKIE = 'spf_session';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const PUBLIC_EXACT = ['/healthz', '/login', '/signup'];
const PUBLIC_PREFIXES = ['/connector/', '/login-assets/'];
const isPublic = (url) => PUBLIC_EXACT.includes(url) || PUBLIC_PREFIXES.some((p) => url.startsWith(p));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function registerAuth(fastify, { db, insecureDev }) {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyRateLimit, { global: false });

  function setSessionCookie(reply, token) {
    reply.setCookie(COOKIE, token, { httpOnly: true, secure: !insecureDev, sameSite: 'lax', path: '/', maxAge: THIRTY_DAYS_S });
  }
  function clientMeta(req) { return { userAgent: (req.headers['user-agent'] || '').slice(0, 300), ip: req.ip }; }

  fastify.get('/signup', async (_req, reply) => reply.type('text/html').send(SIGNUP_HTML));
  fastify.post('/signup', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    if (typeof password !== 'string' || password.length < 12) return reply.code(400).send({ error: 'Password must be at least 12 characters.' });
    if (await db.findUserByEmail(email)) return reply.code(409).send({ error: 'An account with that email already exists.' });
    const user = await db.createUser(email, password);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    return { ok: true, userId: user.id };
  });

  fastify.get('/login', async (_req, reply) => reply.type('text/html').send(LOGIN_HTML));
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;
    const user = typeof email === 'string' ? await db.findUserByEmail(email) : null;
    if (!user || typeof password !== 'string' || !(await db.verifyPassword(user, password))) {
      return reply.code(401).send({ error: 'Incorrect email or password.' });
    }
    await db.touchLastLogin(user.id);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    return { ok: true };
  });

  fastify.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    const session = token && await db.findSessionByToken(token);
    if (session) await db.revokeSession(session.id);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  fastify.addHook('onRequest', async (req, reply) => {
    if (isPublic(req.raw.url)) return;
    const token = req.cookies[COOKIE];
    const session = token && await db.findSessionByToken(token);
    if (!session) return reply.code(401).send({ error: 'Sign in required.' });
    await db.touchSession(session.id);
    req.user = { id: session.userId };
  });
}

const FORM_STYLE = `body{font:14px system-ui;background:#0f1116;color:#e7e9f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{background:#171922;border:1px solid #2a2e3d;border-radius:10px;padding:28px;min-width:280px}
input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;margin-top:10px}
button{width:100%;margin-top:14px;padding:9px;border-radius:6px;border:none;background:#7c5cff;color:#fff;cursor:pointer}
p.err{color:#e0607a;min-height:18px} a{color:#7c5cff}`;

const LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">spectoflow</h1><p style="margin:0 0 6px;color:#8b93a6">Sign in.</p>
<input id="email" type="email" placeholder="Email" autocomplete="email" autofocus />
<input id="password" type="password" placeholder="Password" autocomplete="current-password" />
<p class="err" id="err"></p><button type="submit">Sign in</button>
<p style="margin:14px 0 0;font-size:12.5px"><a href="/signup">Create an account</a></p></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Sign-in failed.';});</script></body></html>`;

const SIGNUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">spectoflow</h1><p style="margin:0 0 6px;color:#8b93a6">Create your account.</p>
<input id="email" type="email" placeholder="Email" autocomplete="email" autofocus />
<input id="password" type="password" placeholder="Password (12+ characters)" autocomplete="new-password" />
<p class="err" id="err"></p><button type="submit">Create account</button>
<p style="margin:14px 0 0;font-size:12.5px"><a href="/login">Already have an account?</a></p></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Could not create the account.';});</script></body></html>`;

module.exports = { registerAuth, COOKIE, isPublic };
```

- [ ] **Step 4: Update `server/src/app.js`**

Find:
```js
async function buildApp({ db, accessKey, sessionSecret, insecureDev, publicDir, trustProxy, onFrame, registry }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { accessKey, sessionSecret, insecureDev });
```
Replace with:
```js
async function buildApp({ db, insecureDev, publicDir, trustProxy, onFrame, registry }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { db, insecureDev });
```

- [ ] **Step 5: Update `server/src/index.js`**

Find the whole access-key/session-secret block:
```js
  const insecureDev = process.argv.includes('--insecure-dev') || process.env.INSECURE_DEV === '1';
  const accessKey = process.env.SPECTOFLOW_ACCESS_KEY || '';
  if (!insecureDev && accessKey.length < 16) {
    console.error('SPECTOFLOW_ACCESS_KEY must be set (16+ characters) — or pass --insecure-dev for local development only (binds 127.0.0.1, no key required).');
    process.exit(1);
  }
  if (insecureDev) console.error('! --insecure-dev: no access key required, binding 127.0.0.1 only. Never use this on a reachable host.');

  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  let sessionSecret = process.env.SESSION_SECRET;
  const secretFile = path.join(dataDir, 'session-secret');
  if (!sessionSecret) {
    sessionSecret = fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : crypto.randomBytes(32).toString('base64url');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
  }

  const db = await createDb(process.env.DATABASE_URL);
  await db.migrate();
  const app = await buildApp({ db, accessKey: insecureDev ? 'x'.repeat(20) : accessKey, sessionSecret, insecureDev, trustProxy: process.env.TRUST_PROXY === '1' });
```
Replace with:
```js
  const insecureDev = process.argv.includes('--insecure-dev') || process.env.INSECURE_DEV === '1';
  if (insecureDev) console.error('! --insecure-dev: the session cookie is not marked Secure, binding 127.0.0.1 only. Never use this on a reachable host.');

  const db = await createDb(process.env.DATABASE_URL);
  await db.migrate();
  const app = await buildApp({ db, insecureDev, trustProxy: process.env.TRUST_PROXY === '1' });
```
Remove the now-unused `const crypto = require('crypto');` and `const path = require('path');` /
`const fs = require('fs');` requires at the top of the file **only if** nothing else in the file
still uses them — read the rest of the file first; `path`/`fs` may still be needed elsewhere (they
aren't, per the current file, but verify before deleting an import blindly).

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/auth.test.js`
Expected: PASS (7 tests).

- [ ] **Step 7: Run the full server suite** (other files will now fail — expected, Task 6 fixes them)

Run: `cd server && npm test`
Expected: `test/auth.test.js` passes; `test/relay.test.js`, `test/connector.test.js`,
`test/e2e.test.js`, `test/cli.test.js` now FAIL (they still build apps with `accessKey`/post the old
`/login` shape) — this is the expected, correctly-sequenced intermediate state; Task 6 fixes them
next. Do not attempt to fix them in this task.

- [ ] **Step 8: Commit**

```bash
cd server && git add src/auth.js src/app.js src/index.js test/auth.test.js
git commit -m "feat(server): real signup/login/logout — sessions replace the single access key entirely

BREAKING: SPECTOFLOW_ACCESS_KEY and SESSION_SECRET are gone. buildApp() no longer takes accessKey/
sessionSecret. Other server/test/*.test.js files still build apps the old way and will fail until
the next task migrates their boot helpers — expected, not a regression to chase down here."
```

---

### Task 6: Migrate every other existing test file's boot helper to real signup+login

**Files:**
- Modify: `server/test/relay.test.js` (its `boot()` helper only)
- Modify: `server/test/connector.test.js` (its `boot()` helper only)
- Modify: `server/test/e2e.test.js` (its `bootServer()` helper only)
- Modify: `server/test/cli.test.js` (unaffected by auth — verify, don't blindly touch)

**Interfaces:**
- Consumes: Task 5's `POST /signup` (simplest way to get both a fresh account AND a valid session
  cookie in one call, replacing the old `POST /login` with a fixed access key).
- Produces: nothing new — every existing test in these 4 files keeps its exact same assertions;
  only the mechanism that obtains `authedFetch`/the session cookie changes.

- [ ] **Step 1: Fix `server/test/relay.test.js`'s `boot()`**

Find:
```js
const ACCESS_KEY = 'x'.repeat(20);

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, accessKey: ACCESS_KEY, sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: __dirname, registry });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // The relay's browser-facing routes (/api/*, /api/hub/*, /api/events) sit behind the same
  // session-cookie auth as every other non-public route (server/src/auth.js) — log in once here
  // and thread the cookie through every subsequent request to those routes so this test exercises
  // the real, protected surface rather than bypassing it.
  const loginRes = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ACCESS_KEY }) });
  const setCookie = loginRes.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  function authedFetch(p, opts = {}) {
    const headers = Object.assign({}, opts.headers, { Cookie: cookie });
    return fetch(url + p, { ...opts, headers });
  }
  return { app, db, machine: m, registry, url, authedFetch };
}
```
Replace with:
```js
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, registry });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // The relay's browser-facing routes sit behind the real session-cookie auth (server/src/auth.js) —
  // sign up a real, fresh test account (which also logs it in, per Task 5's /signup) and thread the
  // cookie through every subsequent request, so this test exercises the real, protected surface.
  const signupRes = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'relay-test@example.com', password: 'a-real-password-123' }) });
  const cookie = signupRes.headers.get('set-cookie').split(';')[0];
  function authedFetch(p, opts = {}) {
    const headers = Object.assign({}, opts.headers, { Cookie: cookie });
    return fetch(url + p, { ...opts, headers });
  }
  return { app, db, machine: m, registry, url, authedFetch };
}
```
Every test in this file keeps calling `boot()` and using `authedFetch`/`db`/`machine`/`registry`/`url`
exactly as before — no other line in this file changes.

- [ ] **Step 2: Fix `server/test/connector.test.js`'s `boot()`**

Find:
```js
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const frames = [];
  const app = await buildApp({ db, accessKey: 'x'.repeat(20), sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: __dirname, onFrame: (machineId, frame) => frames.push({ machineId, frame }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, db, machine: m, frames, url: `http://127.0.0.1:${addr.port}` };
}
```
Replace with:
```js
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const m = db.createMachine('laptop'); await m.ready;
  const frames = [];
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, onFrame: (machineId, frame) => frames.push({ machineId, frame }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return { app, db, machine: m, frames, url: `http://127.0.0.1:${addr.port}` };
}
```
(This file's own tests never call `/login` or any browser-facing `/api/*` route — they only drive
`/connector/*`, which is public/Bearer-token-protected, not session-cookie-protected — so no
`authedFetch`/signup call is even needed here; the only fix is removing the now-invalid
`accessKey`/`sessionSecret` params from `buildApp`.)

- [ ] **Step 3: Fix `server/test/e2e.test.js`'s `bootServer()`**

Find:
```js
const ACCESS_KEY = 'x'.repeat(20);

async function bootServer() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, accessKey: ACCESS_KEY, sessionSecret: 's'.repeat(32), insecureDev: true, publicDir: path.join(KIT, 'lib', 'dashboard', 'public') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // Every /api/* route sits behind the session-cookie auth (server/src/auth.js) regardless of
  // insecureDev — log in once here and thread the cookie through every subsequent request, matching
  // server/test/relay.test.js's own `authedFetch` pattern.
  const loginRes = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ACCESS_KEY }) });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
  return { app, db, url, authedFetch };
}
```
Replace with:
```js
async function bootServer() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: path.join(KIT, 'lib', 'dashboard', 'public') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  // Every /api/* route sits behind the real session-cookie auth (server/src/auth.js) — sign up a
  // real, fresh test account (also logs it in, per Task 5's /signup) and thread the cookie through
  // every subsequent request, matching server/test/relay.test.js's own `authedFetch` pattern.
  const signupRes = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e2e-test@example.com', password: 'a-real-password-123' }) });
  const cookie = signupRes.headers.get('set-cookie').split(';')[0];
  const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
  return { app, db, url, authedFetch };
}
```
This file's header comment (point 1 in its own top-of-file explanation) already correctly describes
"logs in via POST /login" — update that one sentence to say "signs up (which also logs in) via POST
/signup" so the comment doesn't go stale; the rest of the header's reasoning (points 2/3, the
`--transport` mechanics) is unaffected and stays as-is.

- [ ] **Step 4: Confirm `server/test/cli.test.js` needs no change**

Read it: it only invokes `server/cli.js`'s `migrate`/`token create|list|revoke` subcommands directly
against a database — it never boots the Fastify app or touches `/login` at all, so it is genuinely
unaffected by this whole task. Run it to confirm it still passes unmodified (Step 6 below covers this
as part of the full suite anyway).

- [ ] **Step 5: Run each file**

Run: `cd server && node --test test/relay.test.js test/connector.test.js test/e2e.test.js
test/cli.test.js`
Expected: all PASS (the `e2e.test.js` run takes 1-3 minutes total across its 2 scenarios — expected,
not a hang).

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: every test file passes; total count matches the sum of all tasks so far, 0 failures.

- [ ] **Step 7: Commit**

```bash
cd server && git add test/relay.test.js test/connector.test.js test/e2e.test.js
git commit -m "test(server): migrate every remaining boot helper from the old access-key login to real signup"
```

---

### Task 7: Machine ownership — `machines.owner_user_id`

**Files:**
- Create: `server/migrations/0006_machines_owner.js`
- Modify: `server/src/db.js` (`createMachine` signature change)
- Modify: `server/cli.js` (`token create` gains a required `--owner-email`)
- Modify: `server/test/db.test.js`, `server/test/cli.test.js`, `server/test/connector.test.js`,
  `server/test/relay.test.js`, `server/test/e2e.test.js` (every `createMachine`/`token create` call
  site now needs an owner — mechanical, same-shape fix across all 5 files, done together as one task
  per the "batch small same-shape work" principle)

**Interfaces:**
- Consumes: Task 1's `db.findUserByEmail`.
- Produces: `db.createMachine(name, ownerUserId)` — **signature change** from today's
  `createMachine(name)`; the returned shape (`{id, name, token, ready}`) is unchanged, but the
  underlying `machines` row now always has a real `owner_user_id`. `db.machineByToken(token)`'s
  returned row gains an `owner_user_id` field (harmless additive change — nothing that destructures
  specific fields off it breaks).

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0006_machines_owner.js
'use strict';
exports.up = async (knex) => {
  await knex.schema.alterTable('machines', (t) => {
    t.string('owner_user_id', 20).nullable().references('id').inTable('users').onDelete('CASCADE');
  });
  // No real data to backfill (confirmed with the user during brainstorming — nothing real is
  // deployed yet); the column stays nullable at the DB level for driver portability (some support
  // adding a NOT NULL column with no default more readily than others), but application code (Step 3
  // below) always supplies one — every future row is fully owned.
};
exports.down = (knex) => knex.schema.alterTable('machines', (t) => t.dropColumn('owner_user_id'));
```

- [ ] **Step 2: Update the failing tests first**

In `server/test/db.test.js`, every `db.createMachine('name')` call becomes `db.createMachine('name',
ownerUserId)` where `ownerUserId` is a real user created via `db.createUser(...)` earlier in that same
test. Concretely, add this to the TOP of each existing test in that file (right after `const db =
await fresh();`):
```js
    const owner = await db.createUser(`owner-${Math.random().toString(36).slice(2)}@example.com`, 'password-123456');
```
and change every `db.createMachine('laptop')` / `db.createMachine('box')` / `db.createMachine('box2')`
/ `db.createMachine('other-box')` call in that file to pass `owner.id` as the second argument (for
the one test that creates two machines — `'upsertProject assigns a stable server id...'` — reuse the
SAME `owner` for both, since the test's own point is that the same account can own multiple
machines).

- [ ] **Step 3: Run to see it fail**

Run: `cd server && node --test test/db.test.js`
Expected: FAIL — machines are created without an owner still, or (once Step 4 lands) fail on a
missing `owner_user_id` argument.

- [ ] **Step 4: Update `server/src/db.js`'s `createMachine`**

Find:
```js
  function createMachine(name) {
    const id = randomId(8);              // ~11 chars base64url
    const token = 'spf_' + randomId(32);  // printed once by the caller (cli.js)
    ...
    const ready = Promise.resolve(knex('machines').insert({ id, name, token_hash: hash(token) }));
```
Replace the `insert` call's object with:
```js
  function createMachine(name, ownerUserId) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    ...
    const ready = Promise.resolve(knex('machines').insert({ id, name, token_hash: hash(token), owner_user_id: ownerUserId }));
```
(keep every comment/line around it — this touches only the `insert()` call's argument object and
the function's own parameter list, nothing else in `createMachine`).

- [ ] **Step 5: Run `db.test.js` again**

Run: `cd server && node --test test/db.test.js`
Expected: PASS.

- [ ] **Step 6: Update `server/cli.js`'s `token create`**

Find:
```js
    if (cmd === 'token' && sub === 'create') {
      const name = flag('name');
      if (!name) { console.error('Usage: node cli.js token create --name="laptop"'); process.exitCode = 1; return; }
      const m = db.createMachine(name); await m.ready;
```
Replace with:
```js
    if (cmd === 'token' && sub === 'create') {
      const name = flag('name');
      const ownerEmail = flag('owner-email');
      if (!name || !ownerEmail) { console.error('Usage: node cli.js token create --name="laptop" --owner-email="you@example.com"'); process.exitCode = 1; return; }
      const owner = await db.findUserByEmail(ownerEmail);
      if (!owner) { console.error(`! no account found with email "${ownerEmail}" — create the account first (via the web /signup page), then run this again.`); process.exitCode = 1; return; }
      const m = db.createMachine(name, owner.id); await m.ready;
```

- [ ] **Step 7: Fix `server/test/cli.test.js`**

Find the existing test and its `run(url, ['token', 'create', '--name=ci-box'])` call — it needs a
real account to own the machine first. Replace the whole test with:
```js
test('migrate, then create a real owner account via signup, then token create prints the token once; list shows it active; revoke closes it', async () => {
  const url = dbUrl();
  run(url, ['migrate']);
  // token create now requires an existing owner account — create one directly via the db model
  // (no HTTP server involved in this CLI-only test), matching how a real admin would point the CLI
  // at an account created through the web /signup page.
  const { createDb } = require('../src/db');
  const db = await createDb(url);
  await db.createUser('ci-owner@example.com', 'password-123456');
  await db.destroy();
  const created = run(url, ['token', 'create', '--name=ci-box', '--owner-email=ci-owner@example.com']);
  const m = created.match(/token \(shown once.*\):\s*\n\s*\n\s*(spf_\S+)/s);
  assert.ok(m, created);
  const token = m[1];
  let list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+active/);
  const id = list.trim().split(/\s+/)[0];
  const revoked = run(url, ['token', 'revoke', id]);
  assert.match(revoked, /revoked/);
  list = run(url, ['token', 'list']);
  assert.match(list, /ci-box\s+revoked/);
  assert.throws(() => run(url, ['token', 'create', '--name=x']));       // missing --owner-email
  assert.throws(() => run(url, ['token', 'create', '--name=x', '--owner-email=nobody@example.com'])); // unknown owner
});
```
(This replaces the single existing test in that file — the file has exactly one test today, per the
earlier read of its contents.)

- [ ] **Step 8: Fix the 3 remaining files' `db.createMachine(...)` call sites**

In `server/test/connector.test.js`'s `boot()`, `server/test/relay.test.js`'s `boot()`, and
`server/test/e2e.test.js`'s `createToken(db, name)` helper — each currently calls
`db.createMachine('laptop')` (or similar) with no owner. In each file, create a real owner account
first (via `db.createUser`, since these are DB-level calls not HTTP calls — the machine's owner
doesn't need to be the SAME account as the one `authedFetch` logs in as, they're independent
concerns: one account owns the machine/publishes the project, and separately a session is
authenticated to browse it) and pass its `id` as `createMachine`'s second argument. For example, in
`connector.test.js`'s `boot()`:
```js
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const owner = await db.createUser('machine-owner@example.com', 'password-123456');
  const m = db.createMachine('laptop', owner.id); await m.ready;
  ...
```
Apply the identical pattern (one `db.createUser(...)` call, then pass `.id` as `createMachine`'s
second argument) in `relay.test.js`'s `boot()` and in `e2e.test.js`'s `createToken(db, name)`
function (which currently reads `function createToken(db, name) { const m = db.createMachine(name);
return m.ready.then(() => m); }` — change its signature to `createToken(db, name, ownerUserId)` and
update its one call site in `runOneScenario` to create an owner account first and pass its id).

- [ ] **Step 9: Run every affected file**

Run: `cd server && node --test test/db.test.js test/cli.test.js test/connector.test.js
test/relay.test.js test/e2e.test.js`
Expected: all PASS.

- [ ] **Step 10: Run the full server suite**

Run: `cd server && npm test`
Expected: same total count as Task 6's ending state (no new tests added, only existing ones
adjusted), 0 failures.

- [ ] **Step 11: Commit**

```bash
cd server && git add migrations/0006_machines_owner.js src/db.js cli.js test/db.test.js test/cli.test.js test/connector.test.js test/relay.test.js test/e2e.test.js
git commit -m "feat(server): machines gain owner_user_id — createMachine(name, ownerUserId), CLI needs --owner-email"
```

---

### Task 8: Password-reset and email-verification tokens + the email-sending abstraction

**Files:**
- Create: `server/migrations/0007_tokens.js`
- Create: `server/src/models/tokens.js`
- Create: `server/src/email.js`
- Modify: `server/src/db.js` (require + spread)
- Test: `server/test/models/tokens.test.js`, `server/test/email.test.js`

**Interfaces:**
- Consumes: Task 1's `users` table.
- Produces: `db.createEmailVerificationToken(userId)` → `Promise<string>` (the raw token, `spf_`+32
  random bytes — nothing else about it is ever returned); `db.consumeEmailVerificationToken(rawToken)`
  → `Promise<string|null>` (the `userId` it belonged to, or `null` if invalid/expired/already used;
  marks it used on success, single-use); `db.createPasswordResetToken(userId)` → `Promise<string>`;
  `db.consumePasswordResetToken(rawToken)` → `Promise<string|null>` (same shape). `createEmailer
  ({smtpHost,smtpPort,smtpUser,smtpPass,smtpFrom,insecureDev,transport})` → `{sendVerificationEmail
  (to,url), sendPasswordResetEmail(to,url), sendInvitationEmail(to,projectName,url)}` — each returns
  `Promise<void>`; `transport` is an injectable override (tests pass a fake object with a `sendMail`
  method that records calls instead of a real `nodemailer` transport) so no test ever needs a real
  SMTP server.

- [ ] **Step 1: Install `nodemailer`**

```bash
cd server && npm install nodemailer@^6.9.16
```

- [ ] **Step 2: Write the migration**

```js
// server/migrations/0007_tokens.js
'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('email_verification_tokens', (t) => {
    t.string('id', 20).primary();
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.string('id', 20).primary();
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
  });
};
exports.down = (knex) => knex.schema.dropTableIfExists('password_reset_tokens').then(() => knex.schema.dropTableIfExists('email_verification_tokens'));
```

- [ ] **Step 3: Write the failing tests** (`server/test/models/tokens.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('email verification token: create, consume once (returns the userId), a second consume fails', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('a@example.com', 'password-123456');
    const token = await db.createEmailVerificationToken(u.id);
    assert.match(token, /^spf_/);
    assert.strictEqual(await db.consumeEmailVerificationToken(token), u.id);
    assert.strictEqual(await db.consumeEmailVerificationToken(token), null); // single-use
    assert.strictEqual(await db.consumeEmailVerificationToken('spf_bogus'), null);
  } finally { await db.destroy(); }
});

test('password reset token: same single-use shape, independent of email-verification tokens', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('b@example.com', 'password-123456');
    const evToken = await db.createEmailVerificationToken(u.id);
    const prToken = await db.createPasswordResetToken(u.id);
    assert.notStrictEqual(evToken, prToken);
    assert.strictEqual(await db.consumePasswordResetToken(evToken), null); // wrong table entirely
    assert.strictEqual(await db.consumePasswordResetToken(prToken), u.id);
    assert.strictEqual(await db.consumePasswordResetToken(prToken), null);
    assert.strictEqual(await db.consumeEmailVerificationToken(evToken), u.id); // untouched by the above
  } finally { await db.destroy(); }
});

test('an expired token is never consumable', async () => {
  const db = await fresh();
  try {
    const u = await db.createUser('c@example.com', 'password-123456');
    const token = await db.createEmailVerificationToken(u.id);
    // Force it into the past directly, since createEmailVerificationToken's real expiry is 24h out.
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.knex('email_verification_tokens').where({ token_hash: tokenHash }).update({ expires_at: new Date(Date.now() - 1000) });
    assert.strictEqual(await db.consumeEmailVerificationToken(token), null);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 4: Write the failing tests** (`server/test/email.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createEmailer } = require('../src/email');

function fakeTransport() {
  const sent = [];
  return { sent, sendMail: async (opts) => { sent.push(opts); return { messageId: 'fake' }; } };
}

test('sendVerificationEmail/sendPasswordResetEmail/sendInvitationEmail each send exactly one message with the link included', async () => {
  const transport = fakeTransport();
  const emailer = createEmailer({ smtpFrom: 'spectoflow <noreply@example.com>', transport });
  await emailer.sendVerificationEmail('alice@example.com', 'https://dash.example.com/verify-email/abc123');
  await emailer.sendPasswordResetEmail('alice@example.com', 'https://dash.example.com/password-reset/xyz789');
  await emailer.sendInvitationEmail('bob@example.com', 'Alpha Project', 'https://dash.example.com/invitations/qqq111');
  assert.strictEqual(transport.sent.length, 3);
  assert.strictEqual(transport.sent[0].to, 'alice@example.com');
  assert.match(transport.sent[0].html, /abc123/);
  assert.match(transport.sent[1].html, /xyz789/);
  assert.match(transport.sent[2].html, /qqq111/);
  assert.match(transport.sent[2].html, /Alpha Project/);
  assert.strictEqual(transport.sent[0].from, 'spectoflow <noreply@example.com>');
});

test('with insecureDev and no SMTP host configured, emails are logged to the console instead of sent', async () => {
  const emailer = createEmailer({ insecureDev: true }); // no smtpHost, no transport override
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await emailer.sendVerificationEmail('alice@example.com', 'https://dash.example.com/verify-email/abc123');
    assert.ok(logs.some((l) => l.includes('alice@example.com') && l.includes('abc123')));
  } finally { console.log = origLog; }
});
```

- [ ] **Step 5: Run to see them fail**

Run: `cd server && node --test test/models/tokens.test.js test/email.test.js`
Expected: FAIL — `db.createEmailVerificationToken is not a function`; `Cannot find module
'../src/email'`.

- [ ] **Step 6: Write `server/src/models/tokens.js`**

```js
'use strict';
/*
 * A single generic single-use-token implementation, parameterized by table name, reused for both
 * email_verification_tokens and password_reset_tokens (identical shape: id/user_id/token_hash/
 * expires_at/used_at) — DRY without merging two semantically distinct tables into one.
 */
const crypto = require('crypto');
function randomId(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

function makeTokenPair(knex, tableName, ttlMs) {
  async function create(userId) {
    const id = randomId(8);
    const token = 'spf_' + randomId(32);
    const expiresAt = new Date(Date.now() + ttlMs);
    await knex(tableName).insert({ id, user_id: userId, token_hash: hashToken(token), expires_at: expiresAt });
    return token;
  }
  async function consume(rawToken) {
    const row = await knex(tableName).where({ token_hash: hashToken(rawToken) }).whereNull('used_at').first();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    await knex(tableName).where({ id: row.id }).update({ used_at: knex.fn.now() });
    return row.user_id;
  }
  return { create, consume };
}

function createTokensModel(knex) {
  const HOUR = 60 * 60 * 1000;
  const emailVerification = makeTokenPair(knex, 'email_verification_tokens', 24 * HOUR);
  const passwordReset = makeTokenPair(knex, 'password_reset_tokens', HOUR);
  return {
    createEmailVerificationToken: emailVerification.create,
    consumeEmailVerificationToken: emailVerification.consume,
    createPasswordResetToken: passwordReset.create,
    consumePasswordResetToken: passwordReset.consume,
  };
}

module.exports = { createTokensModel };
```

- [ ] **Step 7: Wire it into `server/src/db.js`** (same require+spread pattern as every prior task)

- [ ] **Step 8: Write `server/src/email.js`**

```js
'use strict';
/*
 * Thin nodemailer wrapper. `transport` is injectable (tests pass a fake with a `sendMail(opts)`
 * method) so nothing ever needs a real SMTP server to run. Under --insecure-dev with no SMTP host
 * configured, emails are logged to the console instead of sent, so local development never blocks
 * on real SMTP.
 */
const nodemailer = require('nodemailer');

function createEmailer({ smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, insecureDev, transport } = {}) {
  const from = smtpFrom || 'spectoflow <noreply@localhost>';
  const realTransport = transport || (smtpHost
    ? nodemailer.createTransport({ host: smtpHost, port: Number(smtpPort) || 587, auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined })
    : null);

  async function send(to, subject, html) {
    if (!realTransport) {
      if (!insecureDev) throw new Error('No SMTP transport configured (set SMTP_HOST) and --insecure-dev was not passed.');
      console.log(`[email:insecure-dev] to=${to} subject="${subject}"\n${html}`);
      return;
    }
    await realTransport.sendMail({ from, to, subject, html });
  }

  return {
    sendVerificationEmail: (to, url) => send(to, 'Verify your spectoflow email', `<p>Confirm your email address:</p><p><a href="${url}">${url}</a></p><p>This link expires in 24 hours.</p>`),
    sendPasswordResetEmail: (to, url) => send(to, 'Reset your spectoflow password', `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`),
    sendInvitationEmail: (to, projectName, url) => send(to, `You've been invited to "${projectName}" on spectoflow`, `<p>You've been invited to join <strong>${projectName}</strong>.</p><p><a href="${url}">${url}</a></p><p>This link expires in 72 hours.</p>`),
  };
}

module.exports = { createEmailer };
```

- [ ] **Step 9: Run the tests**

Run: `cd server && node --test test/models/tokens.test.js test/email.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 7's count, plus 6 new tests, 0 new failures.

- [ ] **Step 11: Commit**

```bash
cd server && git add package.json package-lock.json migrations/0007_tokens.js src/models/tokens.js src/email.js src/db.js test/models/tokens.test.js test/email.test.js
git commit -m "feat(server): single-use verification/reset tokens + a testable email-sending abstraction"
```

---

### Task 9: Email verification — wired into signup, a confirm route, resend

**Files:**
- Modify: `server/src/auth.js` (signup route sends a verification email; new `GET
  /verify-email/:token` and `POST /account/resend-verification` routes)
- Modify: `server/src/app.js` (`buildApp` gains an `emailer` param, passed into `registerAuth`)
- Modify: `server/src/index.js` (boots a real `createEmailer(...)` from env vars, passes it in)
- Modify: `server/test/auth.test.js` (adjust the signup tests to use a fake emailer and assert a
  verification email was "sent"; add new tests for the confirm/resend routes)

**Interfaces:**
- Consumes: Task 8's `db.createEmailVerificationToken`/`consumeEmailVerificationToken`,
  `createEmailer`.
- Produces: `registerAuth(fastify, { db, insecureDev, emailer })` — one new required param,
  `emailer` (an object shaped like `createEmailer(...)`'s return value). `GET
  /verify-email/:token` (public) confirms or shows a plain "invalid/expired link" page. `POST
  /account/resend-verification` (authenticated) issues a fresh token and re-sends.

- [ ] **Step 1: Update the failing tests in `server/test/auth.test.js`**

Add a fake emailer helper near the top of the file and use it in `app(opts)`:
```js
function fakeEmailer() {
  const sent = [];
  return { sent,
    sendVerificationEmail: async (to, url) => { sent.push({ kind: 'verify', to, url }); },
    sendPasswordResetEmail: async (to, url) => { sent.push({ kind: 'reset', to, url }); },
    sendInvitationEmail: async (to, projectName, url) => { sent.push({ kind: 'invite', to, projectName, url }); },
  };
}
async function app(opts = {}) {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const emailer = opts.emailer || fakeEmailer();
  const a = await buildApp({ db, insecureDev: false, publicDir: __dirname, emailer, ...opts });
  return { app: a, db, emailer };
}
```
Update the existing `'POST /signup creates a real account...'` test to also assert:
```js
    assert.strictEqual(emailer.sent.length, 1);
    assert.strictEqual(emailer.sent[0].kind, 'verify');
    assert.strictEqual(emailer.sent[0].to, 'alice@example.com');
```
(destructure `emailer` from the `await app(...)` call at the top of that test, alongside `a`/`db`).

Add two new tests:
```js
test('GET /verify-email/:token marks the account verified once, and only once', async () => {
  const { app: a, db, emailer } = await app({ publicDir: undefined });
  try {
    await signup(a);
    const link = emailer.sent[0].url;
    const token = link.split('/verify-email/')[1];
    const before = await db.findUserByEmail('alice@example.com');
    assert.strictEqual(before.email_verified_at, null);
    const r1 = await a.inject({ method: 'GET', url: `/verify-email/${token}` });
    assert.strictEqual(r1.statusCode, 200);
    assert.ok((await db.findUserByEmail('alice@example.com')).email_verified_at);
    const r2 = await a.inject({ method: 'GET', url: `/verify-email/${token}` });
    assert.strictEqual(r2.statusCode, 400); // already used
    const bogus = await a.inject({ method: 'GET', url: '/verify-email/spf_bogus' });
    assert.strictEqual(bogus.statusCode, 400);
  } finally { await a.close(); await db.destroy(); }
});

test('POST /account/resend-verification requires a session and sends a fresh email', async () => {
  const { app: a, db, emailer } = await app();
  try {
    const anon = await a.inject({ method: 'POST', url: '/account/resend-verification' });
    assert.strictEqual(anon.statusCode, 401);
    const r = await signup(a);
    const cookie = r.cookies.find((c) => c.name === 'spf_session').value;
    assert.strictEqual(emailer.sent.length, 1);
    const resend = await a.inject({ method: 'POST', url: '/account/resend-verification', cookies: { spf_session: cookie } });
    assert.strictEqual(resend.statusCode, 200);
    assert.strictEqual(emailer.sent.length, 2);
    assert.strictEqual(emailer.sent[1].kind, 'verify');
  } finally { await a.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && node --test test/auth.test.js`
Expected: FAIL — `buildApp` doesn't accept/use `emailer` yet, no `/verify-email/:token` route.

- [ ] **Step 3: Update `server/src/auth.js`**

Add `emailer` to `registerAuth`'s destructured params:
```js
async function registerAuth(fastify, { db, insecureDev, emailer }) {
```
In the `POST /signup` handler, right after `setSessionCookie(reply, session.token);` and before
`return { ok: true, userId: user.id };`, insert:
```js
    const verifyToken = await db.createEmailVerificationToken(user.id);
    const verifyUrl = `${req.protocol}://${req.hostname}/verify-email/${verifyToken}`;
    await emailer.sendVerificationEmail(user.email, verifyUrl);
```
Add two new routes (anywhere after the `/signup` routes, before the `onRequest` hook):
```js
  fastify.get('/verify-email/:token', async (req, reply) => {
    const userId = await db.consumeEmailVerificationToken(req.params.token);
    if (!userId) return reply.code(400).type('text/html').send(VERIFY_FAIL_HTML);
    await db.markEmailVerified(userId);
    return reply.type('text/html').send(VERIFY_OK_HTML);
  });
  fastify.post('/account/resend-verification', async (req, reply) => {
    const token = await db.createEmailVerificationToken(req.user.id);
    const user = await db.findUserById(req.user.id);
    const url = `${req.protocol}://${req.hostname}/verify-email/${token}`;
    await emailer.sendVerificationEmail(user.email, url);
    return { ok: true };
  });
```
Add the two page templates near `LOGIN_HTML`/`SIGNUP_HTML`:
```js
const VERIFY_OK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<div style="text-align:center"><h1 style="font-size:16px">Email verified</h1><p style="color:#8b93a6">You're all set. <a href="/">Go to your dashboard</a>.</p></div></body></html>`;
const VERIFY_FAIL_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<div style="text-align:center"><h1 style="font-size:16px">Link expired or already used</h1><p style="color:#8b93a6">Sign in and request a new verification email from your account page.</p></div></body></html>`;
```
Add `/verify-email/` to the auth hook's public routing — the route above is registered at an exact
path per-token, not a static path, so it must be matched by prefix. Update `PUBLIC_PREFIXES`:
```js
const PUBLIC_PREFIXES = ['/connector/', '/login-assets/', '/verify-email/'];
```

- [ ] **Step 4: Update `server/src/app.js`**

Add `emailer` to `buildApp`'s destructured params and pass it through:
```js
async function buildApp({ db, insecureDev, publicDir, trustProxy, onFrame, registry, emailer }) {
  const app = Fastify({ trustProxy: !!trustProxy });
  app.get('/healthz', async () => ({ ok: true }));
  await registerAuth(app, { db, insecureDev, emailer });
```

- [ ] **Step 5: Update `server/src/index.js`**

Add near the top:
```js
const { createEmailer } = require('./email');
```
Right before `const app = await buildApp({...})`, add:
```js
  const emailer = createEmailer({
    smtpHost: process.env.SMTP_HOST, smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER, smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM, insecureDev,
  });
```
and add `emailer` to the `buildApp({...})` call's object.

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full server suite** (other files that call `buildApp` without an `emailer`
  will now fail — this is expected; fix them in this same task since it's a small, same-shape
  addition, not deferred to a later task)

Run: `cd server && npm test`
Expected: `test/relay.test.js`, `test/connector.test.js`, `test/e2e.test.js` now fail with
"`emailer.sendVerificationEmail is not a function`" or similar — since their `boot()`/`bootServer()`
helpers call `buildApp(...)` without an `emailer`. Fix each by adding a fake emailer (the exact same
shape as `auth.test.js`'s `fakeEmailer()` above — copy that function verbatim into each of these 3
files, right above their `boot()`/`bootServer()` function) and passing `emailer: fakeEmailer()` into
each file's `buildApp({...})` call. `test/cli.test.js` and `test/db.test.js`/`test/models/*.test.js`
never call `buildApp`, so they're unaffected.

- [ ] **Step 8: Run the full suite again**

Run: `cd server && npm test`
Expected: all PASS, same total count as Task 8 plus 2 new tests.

- [ ] **Step 9: Commit**

```bash
cd server && git add src/auth.js src/app.js src/index.js test/auth.test.js test/relay.test.js test/connector.test.js test/e2e.test.js
git commit -m "feat(server): email verification — sent on signup, confirm link, resend"
```

---

### Task 10: Password reset

**Files:**
- Modify: `server/src/auth.js` (2 new routes + 2 new plain pages)
- Modify: `server/test/auth.test.js`

**Interfaces:**
- Consumes: Task 8's `db.createPasswordResetToken`/`consumePasswordResetToken`, Task 4's
  `db.revokeAllSessionsForUser`.
- Produces: `POST /password-reset/request` `{email}` → always `200` (never reveals whether the
  email exists); `GET /password-reset/:token` (public, a plain form to enter a new password); `POST
  /password-reset/confirm` `{token, newPassword}` → `200` on success (updates the hash, revokes
  every session for that account), `400` if the token is invalid/expired/used or the new password is
  under 12 characters.

- [ ] **Step 1: Write the failing tests**

```js
test('password reset: request never reveals whether the email exists; confirm updates the password and revokes every session', async () => {
  const { app: a, db, emailer } = await app({ publicDir: undefined });
  try {
    const rSignup = await signup(a);
    const oldCookie = rSignup.cookies.find((c) => c.name === 'spf_session').value;
    const reqUnknown = await a.inject({ method: 'POST', url: '/password-reset/request', payload: { email: 'nobody@example.com' } });
    assert.strictEqual(reqUnknown.statusCode, 200);
    assert.strictEqual(emailer.sent.filter((m) => m.kind === 'reset').length, 0); // nothing actually sent for an unknown email
    const reqKnown = await a.inject({ method: 'POST', url: '/password-reset/request', payload: { email: 'alice@example.com' } });
    assert.strictEqual(reqKnown.statusCode, 200);
    const resetEmails = emailer.sent.filter((m) => m.kind === 'reset');
    assert.strictEqual(resetEmails.length, 1);
    const token = resetEmails[0].url.split('/password-reset/')[1];
    const page = await a.inject({ method: 'GET', url: `/password-reset/${token}` });
    assert.strictEqual(page.statusCode, 200);
    const badPassword = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'short' } });
    assert.strictEqual(badPassword.statusCode, 400);
    const confirm = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'a-brand-new-password-1' } });
    assert.strictEqual(confirm.statusCode, 200);
    const stillOld = await a.inject({ method: 'GET', url: '/', cookies: { spf_session: oldCookie } });
    assert.strictEqual(stillOld.statusCode, 401); // old session revoked by the reset
    const login = await a.inject({ method: 'POST', url: '/login', payload: { email: 'alice@example.com', password: 'a-brand-new-password-1' } });
    assert.strictEqual(login.statusCode, 200);
    const again = await a.inject({ method: 'POST', url: '/password-reset/confirm', payload: { token, newPassword: 'yet-another-password-2' } });
    assert.strictEqual(again.statusCode, 400); // single-use
  } finally { await a.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd server && node --test test/auth.test.js`
Expected: FAIL — no `/password-reset/*` routes exist.

- [ ] **Step 3: Add the routes to `server/src/auth.js`**

```js
  fastify.post('/password-reset/request', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const email = req.body && req.body.email;
    const user = typeof email === 'string' ? await db.findUserByEmail(email) : null;
    if (user) {
      const token = await db.createPasswordResetToken(user.id);
      const url = `${req.protocol}://${req.hostname}/password-reset/${token}`;
      await emailer.sendPasswordResetEmail(user.email, url);
    }
    return { ok: true }; // identical response whether or not the email exists
  });
  fastify.get('/password-reset/:token', async (req, reply) => reply.type('text/html').send(PASSWORD_RESET_HTML(req.params.token)));
  fastify.post('/password-reset/confirm', async (req, reply) => {
    const { token, newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 12) return reply.code(400).send({ error: 'Password must be at least 12 characters.' });
    const userId = typeof token === 'string' ? await db.consumePasswordResetToken(token) : null;
    if (!userId) return reply.code(400).send({ error: 'This link is invalid or has expired.' });
    await db.updatePassword(userId, newPassword);
    await db.revokeAllSessionsForUser(userId);
    return { ok: true };
  });
```
Add the page template near the others:
```js
const PASSWORD_RESET_HTML = (token) => `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title><style>${FORM_STYLE}</style></head><body>
<form id="f"><h1 style="margin:0 0 4px;font-size:16px">Reset your password</h1>
<input id="password" type="password" placeholder="New password (12+ characters)" autocomplete="new-password" autofocus />
<p class="err" id="err"></p><button type="submit">Set new password</button></form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();
const r=await fetch('/password-reset/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)},newPassword:document.getElementById('password').value})});
if(r.ok) location.href='/login'; else document.getElementById('err').textContent=(await r.json()).error||'Could not reset the password.';});</script></body></html>`;
```
Add `/password-reset/` to `PUBLIC_PREFIXES` (the `:token` GET page and the `request`/`confirm` POST
routes must all be reachable without a session):
```js
const PUBLIC_PREFIXES = ['/connector/', '/login-assets/', '/verify-email/', '/password-reset/'];
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 9's count, plus 1 new test, 0 new failures.

- [ ] **Step 6: Commit**

```bash
cd server && git add src/auth.js test/auth.test.js
git commit -m "feat(server): self-service password reset — revokes every session on success"
```

---

### Task 11: Project sharing — members, invitations, auto-Owner-on-publish

**Files:**
- Create: `server/migrations/0008_project_sharing.js`
- Create: `server/src/models/sharing.js`
- Modify: `server/src/models/rbac.js` (add `resolveProjectPermissions`)
- Modify: `server/src/db.js` (require + spread)
- Modify: `server/src/relay.js` (the `hello` handler auto-inserts the machine's owner as **Owner**)
- Create: `server/src/routes/sharing.js` (new Fastify route plugin)
- Modify: `server/src/app.js` (mount the new plugin)
- Test: `server/test/models/sharing.test.js`, `server/test/routes/sharing.test.js`

**Interfaces:**
- Consumes: Task 1's `db.findUserByEmail`/`findUserById`; Task 3's `db.SYSTEM_ROLE_IDS`,
  `db.getRole`; Task 8's `emailer.sendInvitationEmail`, token infra pattern (this task's tokens reuse
  the exact same hash-lookup shape, via its own table); existing `db.upsertProject`/`setPublished`
  (C1).
- Produces (all added to the aggregated `db` object): `db.resolveProjectPermissions(userId,
  projectId)` → `Promise<Set<string>>` (empty set if not a member); `db.addProjectMember(projectId,
  userId, roleId)` → `Promise<void>` (upsert — updates the role if already a member);
  `db.removeProjectMember(projectId, userId)` → `Promise<'ok'|'protected'|'not-found'>` (`'protected'`
  if the target's current role is `sys-owner` — never removable via this function);
  `db.changeMemberRole(projectId, userId, roleId)` → same 3-value result shape;
  `db.findMembership(projectId, userId)` → `Promise<{roleId}|null>`; `db.listProjectMembers
  (projectId)` → `Promise<Array<{userId,email,roleId,roleName}>>`; `db.getProjectOwnerUserId
  (projectId)` → `Promise<string|null>` (the account holding the `sys-owner` membership on this
  project); `db.createInvitation({projectId,email,roleId,invitedByUserId})` → `Promise<string>` (the
  raw token); `db.findInvitationByToken(rawToken)` → `Promise<{id,projectId,email,roleId,
  invitedByUserId}|null>` (null if invalid/expired/already accepted); `db.acceptInvitation(rawToken,
  userId)` → `Promise<string|null>` (the `projectId` joined, or `null` if the token was invalid).

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0008_project_sharing.js
'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('project_members', (t) => {
    t.string('project_id', 20).notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role_id', 20).notNullable().references('id').inTable('roles');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['project_id', 'user_id']);
  });
  await knex.schema.createTable('project_invitations', (t) => {
    t.string('id', 20).primary();
    t.string('project_id', 20).notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('email', 320).notNullable();
    t.string('role_id', 20).notNullable().references('id').inTable('roles');
    t.string('invited_by_user_id', 20).notNullable().references('id').inTable('users');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('accepted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};
exports.down = (knex) => knex.schema.dropTableIfExists('project_invitations').then(() => knex.schema.dropTableIfExists('project_members'));
```

- [ ] **Step 2: Write the failing model tests** (`server/test/models/sharing.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }
async function projectFor(db, ownerUserId, localId = 'aaaaaa') {
  return db.upsertProject({ machineId: (await db.createMachine('m', ownerUserId)).id, localId, name: 'Alpha', kind: 'spectoflow' });
}

test('resolveProjectPermissions: empty set for a non-member; the seeded permission set for a real member', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const viewer = await db.createUser('viewer@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(viewer.id, project.id), new Set());
    await db.addProjectMember(project.id, viewer.id, db.SYSTEM_ROLE_IDS.VIEWER);
    assert.deepStrictEqual(await db.resolveProjectPermissions(viewer.id, project.id), new Set(['project.read']));
  } finally { await db.destroy(); }
});

test('removeProjectMember/changeMemberRole refuse to touch the Owner\'s own membership', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner2@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    await db.addProjectMember(project.id, owner.id, db.SYSTEM_ROLE_IDS.OWNER);
    assert.strictEqual(await db.removeProjectMember(project.id, owner.id), 'protected');
    assert.strictEqual(await db.changeMemberRole(project.id, owner.id, db.SYSTEM_ROLE_IDS.ADMIN), 'protected');
    assert.deepStrictEqual(await db.resolveProjectPermissions(owner.id, project.id), new Set(['project.read', 'project.write', 'project.manage_settings', 'project.manage_members']));
    const editor = await db.createUser('editor2@example.com', 'password-123456');
    await db.addProjectMember(project.id, editor.id, db.SYSTEM_ROLE_IDS.EDITOR);
    assert.strictEqual(await db.changeMemberRole(project.id, editor.id, db.SYSTEM_ROLE_IDS.VIEWER), 'ok');
    assert.deepStrictEqual(await db.resolveProjectPermissions(editor.id, project.id), new Set(['project.read']));
    assert.strictEqual(await db.removeProjectMember(project.id, editor.id), 'ok');
    assert.strictEqual(await db.removeProjectMember(project.id, 'unknown-user'), 'not-found');
  } finally { await db.destroy(); }
});

test('getProjectOwnerUserId finds the sys-owner member; listProjectMembers includes email + role name', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner3@example.com', 'password-123456');
    const editor = await db.createUser('editor3@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    await db.addProjectMember(project.id, owner.id, db.SYSTEM_ROLE_IDS.OWNER);
    await db.addProjectMember(project.id, editor.id, db.SYSTEM_ROLE_IDS.EDITOR);
    assert.strictEqual(await db.getProjectOwnerUserId(project.id), owner.id);
    const members = await db.listProjectMembers(project.id);
    assert.strictEqual(members.length, 2);
    const editorRow = members.find((m) => m.userId === editor.id);
    assert.strictEqual(editorRow.email, 'editor3@example.com');
    assert.strictEqual(editorRow.roleName, 'Editor');
  } finally { await db.destroy(); }
});

test('createInvitation/findInvitationByToken/acceptInvitation: single-use, joins the project on accept', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner4@example.com', 'password-123456');
    const project = await projectFor(db, owner.id);
    const token = await db.createInvitation({ projectId: project.id, email: 'invitee@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.id });
    const found = await db.findInvitationByToken(token);
    assert.strictEqual(found.projectId, project.id); assert.strictEqual(found.email, 'invitee@example.com');
    const invitee = await db.createUser('invitee@example.com', 'password-123456');
    assert.strictEqual(await db.acceptInvitation(token, invitee.id), project.id);
    assert.deepStrictEqual(await db.resolveProjectPermissions(invitee.id, project.id), new Set(['project.read']));
    assert.strictEqual(await db.findInvitationByToken(token), null); // single-use
    assert.strictEqual(await db.acceptInvitation('spf_bogus', invitee.id), null);
  } finally { await db.destroy(); }
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && node --test test/models/sharing.test.js`
Expected: FAIL — `db.resolveProjectPermissions is not a function`.

- [ ] **Step 4: Add `resolveProjectPermissions` to `server/src/models/rbac.js`**

Add this function inside `createRbacModel(knex)`, and add it to the returned object:
```js
  async function resolveProjectPermissions(userId, projectId) {
    const membership = await knex('project_members').where({ project_id: projectId, user_id: userId }).first();
    if (!membership) return new Set();
    const perms = await knex('role_permissions').where({ role_id: membership.role_id }).select('permission_key');
    return new Set(perms.map((p) => p.permission_key));
  }
```
(add `resolveProjectPermissions` to the `return { ... }` statement at the bottom of the file).

- [ ] **Step 5: Write `server/src/models/sharing.js`**

```js
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
    await knex('project_invitations').where({ id: inv.id }).update({ accepted_at: knex.fn.now() });
    await addProjectMember(inv.projectId, userId, inv.roleId);
    return inv.projectId;
  }
  return { findMembership, addProjectMember, removeProjectMember, changeMemberRole, getProjectOwnerUserId, listProjectMembers, createInvitation, findInvitationByToken, acceptInvitation };
}

module.exports = { createSharingModel };
```

- [ ] **Step 6: Wire it into `server/src/db.js`** (require + spread, same pattern as every prior task)

- [ ] **Step 7: Run the model tests**

Run: `cd server && node --test test/models/sharing.test.js`
Expected: PASS.

- [ ] **Step 8: Auto-insert the Owner on publish — update `server/src/relay.js`**

Find, in `processFrame`'s `hello` branch:
```js
      for (const p of frame.projects || []) {
        const row = await db.upsertProject({ machineId, localId: p.localId, name: p.name, kind: p.kind || 'spectoflow' });
        await db.setPublished(row.id, true); // a project sent in `hello` is, by construction, published
```
Replace with:
```js
      for (const p of frame.projects || []) {
        const row = await db.upsertProject({ machineId, localId: p.localId, name: p.name, kind: p.kind || 'spectoflow' });
        await db.setPublished(row.id, true); // a project sent in `hello` is, by construction, published
        // First publish only: the machine's owning account becomes this project's protected Owner
        // member. Idempotent — upsertProject/hello re-run on every reconnect, so only insert once.
        if (!(await db.getProjectOwnerUserId(row.id))) {
          const machine = await db.knex('machines').where({ id: machineId }).first();
          if (machine && machine.owner_user_id) await db.addProjectMember(row.id, machine.owner_user_id, db.SYSTEM_ROLE_IDS.OWNER);
        }
```

- [ ] **Step 9: Write `server/src/routes/sharing.js`**

```js
'use strict';
/*
 * Project membership and invitation HTTP routes. Each route checks the caller's own permission on
 * the TARGET project directly (via db.resolveProjectPermissions), independent of relay.js's /api/*
 * op-relay enforcement (a separate route surface, wired up in a later task) — these routes exist and
 * are fully enforced on their own from the moment this task lands.
 */
async function requirePermission(req, reply, db, projectId, permissionKey) {
  const perms = await db.resolveProjectPermissions(req.user.id, projectId);
  if (!perms.has(permissionKey)) { reply.code(403).send({ error: 'You do not have permission to do that on this project.' }); return false; }
  return true;
}

async function registerSharing(app, { db, emailer }) {
  app.get('/api/projects/:id/members', async (req, reply) => {
    if (!(await requirePermission(req, reply, db, req.params.id, 'project.read'))) return;
    return { members: await db.listProjectMembers(req.params.id) };
  });

  app.post('/api/projects/:id/invite', async (req, reply) => {
    const projectId = req.params.id;
    if (!(await requirePermission(req, reply, db, projectId, 'project.manage_members'))) return;
    const { email, roleId } = req.body || {};
    if (typeof email !== 'string' || !email.includes('@')) return reply.code(400).send({ error: 'A valid email is required.' });
    const ownerUserId = await db.getProjectOwnerUserId(projectId);
    const assignable = await db.listRolesByScope('project', ownerUserId);
    if (!assignable.some((r) => r.id === roleId)) return reply.code(400).send({ error: 'Not a valid role for this project.' });
    const token = await db.createInvitation({ projectId, email, roleId, invitedByUserId: req.user.id });
    const project = await db.findProject(projectId);
    const url = `${req.protocol}://${req.hostname}/invitations/${token}`;
    await emailer.sendInvitationEmail(email, project ? project.name : 'a spectoflow project', url);
    return { ok: true };
  });

  app.delete('/api/projects/:id/members/:userId', async (req, reply) => {
    if (!(await requirePermission(req, reply, db, req.params.id, 'project.manage_members'))) return;
    const result = await db.removeProjectMember(req.params.id, req.params.userId);
    if (result === 'not-found') return reply.code(404).send({ error: 'Not a member of this project.' });
    if (result === 'protected') return reply.code(403).send({ error: "The project owner's membership can't be removed here — unpublish the project locally instead." });
    return { ok: true };
  });

  app.patch('/api/projects/:id/members/:userId', async (req, reply) => {
    const projectId = req.params.id;
    if (!(await requirePermission(req, reply, db, projectId, 'project.manage_members'))) return;
    const { roleId } = req.body || {};
    const ownerUserId = await db.getProjectOwnerUserId(projectId);
    const assignable = await db.listRolesByScope('project', ownerUserId);
    if (!assignable.some((r) => r.id === roleId)) return reply.code(400).send({ error: 'Not a valid role for this project.' });
    const result = await db.changeMemberRole(projectId, req.params.userId, roleId);
    if (result === 'not-found') return reply.code(404).send({ error: 'Not a member of this project.' });
    if (result === 'protected') return reply.code(403).send({ error: "The project owner's role can't be changed here." });
    return { ok: true };
  });

  // Public: a person may not have an account yet. Shows a plain page; accepting requires being
  // signed in (the page itself prompts sign-in/sign-up first, preserving the token in the URL, since
  // /signup and /login are also public routes that don't consume anything here).
  app.get('/invitations/:token', async (req, reply) => {
    const inv = await db.findInvitationByToken(req.params.token);
    if (!inv) return reply.code(404).type('text/html').send(INVITE_INVALID_HTML);
    const project = await db.findProject(inv.projectId);
    return reply.type('text/html').send(INVITE_HTML(project ? project.name : 'a project', req.params.token));
  });
  app.post('/invitations/:token/accept', async (req, reply) => {
    const projectId = await db.acceptInvitation(req.params.token, req.user.id);
    if (!projectId) return reply.code(400).send({ error: 'This invitation is invalid or has already been used.' });
    return { ok: true, projectId };
  });
}

const INVITE_INVALID_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title></head><body><p>This invitation link is invalid or has expired.</p></body></html>`;
const INVITE_HTML = (projectName, token) => `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow</title></head><body>
<p>You've been invited to <strong>${projectName}</strong>.</p>
<p><a href="/login">Sign in</a> or <a href="/signup">create an account</a> with this invitation's email, then come back to this page to accept.</p>
<button id="accept">Accept invitation</button><p id="err" style="color:#e0607a"></p>
<script>document.getElementById('accept').addEventListener('click',async()=>{
const r=await fetch('/invitations/${token}/accept',{method:'POST'});
if(r.ok) location.href='/'; else document.getElementById('err').textContent=(await r.json()).error||'Could not accept.';});</script></body></html>`;

module.exports = { registerSharing };
```

Note: `/invitations/:token` (the `GET` page) must be reachable **without** a session — add
`/invitations/` to `server/src/auth.js`'s `PUBLIC_PREFIXES` in this same task:
```js
const PUBLIC_PREFIXES = ['/connector/', '/login-assets/', '/verify-email/', '/password-reset/', '/invitations/'];
```
(the `POST /invitations/:token/accept` route is intentionally left OFF the public list — accepting
genuinely requires a real session, per the spec's flow: sign in/up first, then come back and accept).

- [ ] **Step 10: Mount it in `server/src/app.js`**

Add the require and registration, right after the existing relay registration:
```js
  const { registerSharing } = require('./routes/sharing');
  await registerSharing(app, { db, emailer });
```

- [ ] **Step 11: Write the failing route tests** (`server/test/routes/sharing.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { const sent = []; return { sent, sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async (to, projectName, url) => { sent.push({ to, projectName, url }); } }; }

async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const emailer = fakeEmailer();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, emailer, url, signupAndLogin };
}
async function publishedProject(db, ownerUserId) {
  const m = db.createMachine('laptop', ownerUserId); await m.ready;
  const row = await db.upsertProject({ machineId: (await m).id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
  await db.setPublished(row.id, true);
  await db.addProjectMember(row.id, ownerUserId, db.SYSTEM_ROLE_IDS.OWNER);
  return row;
}

test('owner invites a viewer by email; the invitee signs up, accepts, and shows up in the members list', async () => {
  const { app, db, emailer, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner@example.com');
    const project = await publishedProject(db, owner.userId);
    const invite = await owner.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) });
    assert.strictEqual(invite.status, 200);
    assert.strictEqual(emailer.sent.length, 1);
    const token = emailer.sent[0].url.split('/invitations/')[1];
    const invitee = await signupAndLogin('viewer@example.com');
    const accept = await invitee.fetch(`/invitations/${token}/accept`, { method: 'POST' });
    assert.strictEqual(accept.status, 200);
    const members = await (await owner.fetch(`/api/projects/${project.id}/members`)).json();
    assert.strictEqual(members.members.length, 2);
    assert.ok(members.members.some((m) => m.email === 'viewer@example.com' && m.roleName === 'Viewer'));
  } finally { await app.close(); await db.destroy(); }
});

test('a non-member cannot invite (403), list members (403), or remove/change anyone (403)', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner2@example.com');
    const project = await publishedProject(db, owner.userId);
    const stranger = await signupAndLogin('stranger@example.com');
    assert.strictEqual((await stranger.fetch(`/api/projects/${project.id}/members`)).status, 403);
    assert.strictEqual((await stranger.fetch(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) })).status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('the Owner\'s own membership cannot be removed or changed via the API, even by themself', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const owner = await signupAndLogin('owner3@example.com');
    const project = await publishedProject(db, owner.userId);
    const remove = await owner.fetch(`/api/projects/${project.id}/members/${owner.userId}`, { method: 'DELETE' });
    assert.strictEqual(remove.status, 403);
    const change = await owner.fetch(`/api/projects/${project.id}/members/${owner.userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: db.SYSTEM_ROLE_IDS.EDITOR }) });
    assert.strictEqual(change.status, 403);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 12: Run to see them fail, then implement, then pass**

Run: `cd server && node --test test/routes/sharing.test.js`
Expected first: FAIL (routes don't exist yet — this validates Step 9-10 above haven't been applied
yet if done out of order; if Steps 9-10 are already applied, this instead validates the real
behavior). Apply Steps 9-10 if not already done, then re-run.
Expected: PASS.

- [ ] **Step 13: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 10's count, plus 7 new tests, 0 new failures.

- [ ] **Step 14: Commit**

```bash
cd server && git add migrations/0008_project_sharing.js src/models/sharing.js src/models/rbac.js src/db.js src/relay.js src/routes/sharing.js src/auth.js src/app.js test/models/sharing.test.js test/routes/sharing.test.js
git commit -m "feat(server): project sharing — members, email invitations, auto-Owner on first publish"
```

---

### Task 12: Signup mode (open/invite_only/disabled) + first-user-becomes-admin bootstrap

**Files:**
- Create: `server/migrations/0009_platform_settings.js`
- Create: `server/src/models/settings.js`
- Modify: `server/src/models/sharing.js` (add `hasPendingInvitationForEmail`)
- Modify: `server/src/db.js` (require + spread both)
- Modify: `server/src/auth.js` (signup route: mode gating + bootstrap)
- Modify: `server/src/routes/sharing.js` — no, **create** `server/src/routes/admin.js` (new file:
  `GET`/`POST /api/admin/signup-mode`)
- Modify: `server/src/app.js` (mount the new admin routes plugin)
- Test: `server/test/models/settings.test.js`, `server/test/auth.test.js` (new signup-mode tests),
  `server/test/routes/admin.test.js`

**Interfaces:**
- Consumes: Task 3's `db.hasPlatformPermission`/`SYSTEM_ROLE_IDS`/`assignPlatformRole`; Task 1's
  `db.countUsers`.
- Produces: `db.getSignupMode()` → `Promise<'open'|'invite_only'|'disabled'>` (defaults to `'open'`
  the first time it's read, even before any row exists — the migration seeds one row so this is
  moot in practice, but the function itself is defensive); `db.setSignupMode(mode)` → `Promise<void>`
  (throws on an invalid mode string); `db.hasPendingInvitationForEmail(email)` → `Promise<boolean>`.

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0009_platform_settings.js
'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('platform_settings', (t) => {
    t.string('id', 20).primary();
    t.string('signup_mode', 20).notNullable().defaultTo('open');
  });
  await knex('platform_settings').insert({ id: 'singleton', signup_mode: 'open' });
};
exports.down = (knex) => knex.schema.dropTableIfExists('platform_settings');
```

- [ ] **Step 2: Write the failing model tests** (`server/test/models/settings.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../../src/db');

async function fresh() { const db = await createDb('sqlite::memory:'); await db.migrate(); return db; }

test('getSignupMode defaults to open; setSignupMode changes it; an invalid mode is rejected', async () => {
  const db = await fresh();
  try {
    assert.strictEqual(await db.getSignupMode(), 'open');
    await db.setSignupMode('invite_only');
    assert.strictEqual(await db.getSignupMode(), 'invite_only');
    await db.setSignupMode('disabled');
    assert.strictEqual(await db.getSignupMode(), 'disabled');
    await assert.rejects(() => db.setSignupMode('bogus'));
  } finally { await db.destroy(); }
});

test('hasPendingInvitationForEmail: true only for an unaccepted, unexpired invitation to that email', async () => {
  const db = await fresh();
  try {
    const owner = await db.createUser('owner@example.com', 'password-123456');
    const m = await db.createMachine('m', owner.id); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), false);
    const token = await db.createInvitation({ projectId: project.id, email: 'Invitee@Example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: owner.id });
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), true); // case-insensitive
    const invitee = await db.createUser('invitee@example.com', 'password-123456');
    await db.acceptInvitation(token, invitee.id);
    assert.strictEqual(await db.hasPendingInvitationForEmail('invitee@example.com'), false); // consumed
  } finally { await db.destroy(); }
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && node --test test/models/settings.test.js`
Expected: FAIL — `db.getSignupMode is not a function`.

- [ ] **Step 4: Write `server/src/models/settings.js`**

```js
'use strict';
const VALID_MODES = ['open', 'invite_only', 'disabled'];
function createSettingsModel(knex) {
  async function getSignupMode() {
    const row = await knex('platform_settings').where({ id: 'singleton' }).first();
    return (row && row.signup_mode) || 'open';
  }
  async function setSignupMode(mode) {
    if (!VALID_MODES.includes(mode)) throw new Error(`invalid signup mode "${mode}" — must be one of ${VALID_MODES.join(', ')}`);
    await knex('platform_settings').where({ id: 'singleton' }).update({ signup_mode: mode });
  }
  return { getSignupMode, setSignupMode };
}
module.exports = { createSettingsModel, VALID_MODES };
```

- [ ] **Step 5: Add `hasPendingInvitationForEmail` to `server/src/models/sharing.js`**

Add this function inside `createSharingModel(knex)`, and add it to the returned object:
```js
  async function hasPendingInvitationForEmail(email) {
    const row = await knex('project_invitations').where({ email: String(email).toLowerCase() }).whereNull('accepted_at').where('expires_at', '>', new Date()).first();
    return !!row;
  }
```

- [ ] **Step 6: Wire both into `server/src/db.js`** (require+spread, same pattern)

- [ ] **Step 7: Run the model tests**

Run: `cd server && node --test test/models/settings.test.js`
Expected: PASS.

- [ ] **Step 8: Write the failing signup-mode tests in `server/test/auth.test.js`**

```js
test('signup respects the platform signup mode: disabled blocks everyone, invite_only requires a pending invitation for that email', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    await db.setSignupMode('disabled');
    assert.strictEqual((await signup(a, 'x1@example.com')).statusCode, 403);
    await db.setSignupMode('invite_only');
    assert.strictEqual((await signup(a, 'x2@example.com')).statusCode, 403); // no invitation exists for this email
    // Create a real pending invitation for x3@example.com via the model directly (routes.sharing's
    // own HTTP invite flow is tested in test/routes/sharing.test.js — this test only needs the
    // signup-side gate, not the full invite-creation path).
    const someoneElse = await db.createUser('inviter@example.com', 'password-123456');
    const m = await db.createMachine('m', someoneElse.id); await m.ready;
    const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
    await db.createInvitation({ projectId: project.id, email: 'x3@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER, invitedByUserId: someoneElse.id });
    assert.strictEqual((await signup(a, 'x3@example.com')).statusCode, 200);
    await db.setSignupMode('open');
    assert.strictEqual((await signup(a, 'x4@example.com')).statusCode, 200); // open mode needs no invitation
  } finally { await a.close(); await db.destroy(); }
});

test('the very first account ever created automatically becomes Platform Admin; the second does not', async () => {
  const { app: a, db } = await app({ publicDir: undefined });
  try {
    const first = await signup(a, 'first@example.com');
    const firstUser = await db.findUserByEmail('first@example.com');
    assert.strictEqual(await db.hasPlatformPermission(firstUser.id, 'platform.manage_signup'), true);
    await signup(a, 'second@example.com');
    const secondUser = await db.findUserByEmail('second@example.com');
    assert.strictEqual(await db.hasPlatformPermission(secondUser.id, 'platform.manage_signup'), false);
  } finally { await a.close(); await db.destroy(); }
});
```

(`signup(a, email, password)` — the existing helper at the top of this file takes `(a, email,
password)` with defaults; these calls override just the email, keeping the default password.)

- [ ] **Step 9: Run to see them fail**

Run: `cd server && node --test test/auth.test.js`
Expected: FAIL — signup mode is never checked yet, no bootstrap happens.

- [ ] **Step 10: Update `server/src/auth.js`'s `POST /signup` handler**

Find:
```js
    if (typeof password !== 'string' || password.length < 12) return reply.code(400).send({ error: 'Password must be at least 12 characters.' });
    if (await db.findUserByEmail(email)) return reply.code(409).send({ error: 'An account with that email already exists.' });
    const user = await db.createUser(email, password);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    const verifyToken = await db.createEmailVerificationToken(user.id);
```
Replace with:
```js
    if (typeof password !== 'string' || password.length < 12) return reply.code(400).send({ error: 'Password must be at least 12 characters.' });
    const mode = await db.getSignupMode();
    if (mode === 'disabled') return reply.code(403).send({ error: 'Signup is currently disabled on this instance.' });
    if (mode === 'invite_only' && !(await db.hasPendingInvitationForEmail(email))) {
      return reply.code(403).send({ error: 'Signup is invite-only on this instance — you need a pending project invitation sent to this email.' });
    }
    if (await db.findUserByEmail(email)) return reply.code(409).send({ error: 'An account with that email already exists.' });
    const user = await db.createUser(email, password);
    if ((await db.countUsers()) === 1) await db.assignPlatformRole(user.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    const session = await db.createSession(user.id, clientMeta(req));
    setSessionCookie(reply, session.token);
    const verifyToken = await db.createEmailVerificationToken(user.id);
```

- [ ] **Step 11: Run the tests**

Run: `cd server && node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 12: Write the failing admin route tests** (`server/test/routes/admin.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, url, signupAndLogin };
}

test('GET/POST /api/admin/signup-mode: the bootstrap admin (first account) can read and change it; a later, non-admin account gets 403', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin@example.com'); // first account -> auto Platform Admin
    const notAdmin = await signupAndLogin('later@example.com');
    const read = await admin.fetch('/api/admin/signup-mode');
    assert.strictEqual(read.status, 200);
    assert.strictEqual((await read.json()).mode, 'open');
    const deny = await notAdmin.fetch('/api/admin/signup-mode');
    assert.strictEqual(deny.status, 403);
    const set = await admin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'invite_only' }) });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(await db.getSignupMode(), 'invite_only');
    const denySet = await notAdmin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'open' }) });
    assert.strictEqual(denySet.status, 403);
    const bad = await admin.fetch('/api/admin/signup-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'bogus' }) });
    assert.strictEqual(bad.status, 400);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 13: Run to see them fail**

Run: `cd server && node --test test/routes/admin.test.js`
Expected: FAIL — no `/api/admin/signup-mode` route.

- [ ] **Step 14: Write `server/src/routes/admin.js`**

```js
'use strict';
async function requirePlatformPermission(req, reply, db, permissionKey) {
  if (!(await db.hasPlatformPermission(req.user.id, permissionKey))) { reply.code(403).send({ error: 'You do not have permission to do that.' }); return false; }
  return true;
}

async function registerAdmin(app, { db }) {
  app.get('/api/admin/signup-mode', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_signup'))) return;
    return { mode: await db.getSignupMode() };
  });
  app.post('/api/admin/signup-mode', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_signup'))) return;
    try { await db.setSignupMode(req.body && req.body.mode); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    return { ok: true };
  });
}
module.exports = { registerAdmin };
```

- [ ] **Step 15: Mount it in `server/src/app.js`**

```js
  const { registerAdmin } = require('./routes/admin');
  await registerAdmin(app, { db });
```

- [ ] **Step 16: Run the tests**

Run: `cd server && node --test test/routes/admin.test.js`
Expected: PASS.

- [ ] **Step 17: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 11's count, plus 5 new tests, 0 new failures.

- [ ] **Step 18: Commit**

```bash
cd server && git add migrations/0009_platform_settings.js src/models/settings.js src/models/sharing.js src/db.js src/auth.js src/routes/admin.js src/app.js test/models/settings.test.js test/auth.test.js test/routes/admin.test.js
git commit -m "feat(server): signup mode (open/invite_only/disabled) + first-account-becomes-admin bootstrap"
```

---

### Task 13: Relay enforcement — real per-op permissions, `GET /api/hub/projects` re-scoped to membership

**Files:**
- Modify: `server/src/models/sharing.js` (add `listPublishedProjectsForUser`)
- Modify: `server/src/db.js` (require already present from Task 11 — just add the new function to
  the spread, no new require needed)
- Modify: `server/src/relay.js` (`/api/*`, `/api/events`, `GET /api/hub/projects`)
- Modify: `server/src/routes/admin.js` (add `GET /api/admin/projects`, the `platform.view_all_projects`
  admin listing)
- Test: `server/test/relay.test.js` (extended — every existing test in this file already
  authenticates as a real account via Task 6's fix; this task adds new tests specifically for
  membership/permission enforcement, and updates the file's `boot()` to make its default test
  account the project's Owner, since every pre-existing test in this file implicitly assumed "any
  authenticated session can do anything" — that assumption is what this task removes.)

**Interfaces:**
- Consumes: Task 11's `db.resolveProjectPermissions`, `db.SYSTEM_ROLE_IDS`, `db.addProjectMember`;
  Task 3's `db.hasPlatformPermission`.
- Produces: `db.listPublishedProjectsForUser(userId)` → `Promise<Array<project row>>` (same row
  shape `db.listPublic()` already returns — `id, machine_id, local_id, name, kind, published,
  last_snapshot, snapshot_at, created_at` — filtered to published projects where `userId` holds a
  `project_members` row); every `/api/*` and `/api/events` request now resolves to exactly one of
  **404** (not a member at all, and no `platform.view_all_projects` bypass applies — indistinguishable
  from unpublished/nonexistent, matching C1's existing pattern), **403** (a real member, but their
  role lacks the specific permission this operation requires), or proceeding normally.

- [ ] **Step 1: Add `listPublishedProjectsForUser` to `server/src/models/sharing.js`**

Add inside `createSharingModel(knex)`, and to its returned object:
```js
  async function listPublishedProjectsForUser(userId) {
    return knex('projects').join('project_members', 'project_members.project_id', 'projects.id')
      .where({ 'project_members.user_id': userId, 'projects.published': true })
      .select('projects.*');
  }
```

- [ ] **Step 2: Fix `server/test/relay.test.js`'s `boot()`** so its default test account is the
  project's Owner (every pre-existing test in this file publishes project `aaaaaa` from machine
  `laptop` and then immediately calls `authedFetch` — that authenticated account now needs real
  Owner membership for those pre-existing tests to keep passing under enforcement)

Find, in `boot()`:
```js
  const m = db.createMachine('laptop'); await m.ready;
```
Replace with:
```js
  const owner = await db.createUser('relay-test@example.com', 'a-real-password-123');
  const m = db.createMachine('laptop', owner.id); await m.ready;
```
(remove the old, separate `signupRes`/`/signup` call from Task 6's fix — this task's `owner` account
IS the account that logs in, so reuse its email/password there instead of creating a second,
unrelated account). The updated `boot()` in full:
```js
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const owner = await db.createUser('relay-test@example.com', 'a-real-password-123');
  const m = db.createMachine('laptop', owner.id); await m.ready;
  const registry = createRegistry();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, registry, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const loginRes = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'relay-test@example.com', password: 'a-real-password-123' }) });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  function authedFetch(p, opts = {}) {
    const headers = Object.assign({}, opts.headers, { Cookie: cookie });
    return fetch(url + p, { ...opts, headers });
  }
  return { app, db, machine: m, registry, url, authedFetch, ownerUserId: owner.id };
}
```
Add the same `fakeEmailer()` helper this file needs (copy verbatim from `test/auth.test.js`'s
version — a small object with a `sent` array and 3 no-op-recording methods) near the top of the file
if Task 9 didn't already add one here (it should have — verify before duplicating it).

Since the relay's `hello`-driven auto-Owner logic (Task 11, Step 8) only runs when a `hello` frame
actually flows through `/connector/frames`, and every existing test in this file DOES send a real
`hello` for `aaaaaa` via that endpoint already, the auto-Owner insertion happens for free — no test
needs to call `db.addProjectMember` directly. Run the file now to confirm every PRE-EXISTING test in
it still passes with this `boot()` change alone, before writing anything new:

Run: `cd server && node --test test/relay.test.js`
Expected: PASS (all pre-existing tests — the Owner auto-insertion on `hello` is what keeps them
green under the new enforcement rules, once Step 5 below actually adds the enforcement).

- [ ] **Step 3: Write the new failing enforcement tests** (append to `test/relay.test.js`)

```js
test('a Viewer member can read but gets 403 on a write; a non-member gets 404 (indistinguishable from unpublished)', async () => {
  const { app, db, machine, url, authedFetch, ownerUserId } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }, { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;

    const viewer = await db.createUser('viewer@example.com', 'a-real-password-123');
    await db.addProjectMember(serverId, viewer.id, db.SYSTEM_ROLE_IDS.VIEWER);
    const viewerLogin = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', password: 'a-real-password-123' }) });
    const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0];
    const viewerFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: viewerCookie }) });

    const readOk = await viewerFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(readOk.status, 200);
    const writeForbidden = await viewerFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'nope' }) });
    assert.strictEqual(writeForbidden.status, 403);

    const stranger = await db.createUser('stranger@example.com', 'a-real-password-123');
    const strangerLogin = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'stranger@example.com', password: 'a-real-password-123' }) });
    const strangerCookie = strangerLogin.headers.get('set-cookie').split(';')[0];
    const strangerFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: strangerCookie }) });
    const notMember = await strangerFetch(`/api/project?p=${serverId}`);
    assert.strictEqual(notMember.status, 404);
    const notMemberSse = await strangerFetch(`/api/events?p=${serverId}`);
    assert.strictEqual(notMemberSse.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('platform.view_all_projects grants a non-member READ visibility but not write', async () => {
  const { app, db, machine, url, authedFetch } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }, { type: 'snapshot', p: 'aaaaaa', project: { projectName: 'Alpha', plans: [] } }]) });
    const serverId = (await (await authedFetch('/api/hub/projects')).json()).projects[0].id;

    const superAdmin = await db.createUser('super@example.com', 'a-real-password-123');
    await db.assignPlatformRole(superAdmin.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'super@example.com', password: 'a-real-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const adminFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });

    assert.strictEqual((await adminFetch(`/api/project?p=${serverId}`)).status, 200);
    assert.strictEqual((await adminFetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).status, 403);
  } finally { await app.close(); await db.destroy(); }
});

test('GET /api/hub/projects only lists projects the caller is a member of', async () => {
  const { app, db, machine, url, authedFetch, ownerUserId } = await boot();
  try {
    await fetch(url + '/connector/frames', { method: 'POST', headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'auth', token: machine.token }, { type: 'hello', machineName: 'laptop', projects: [{ localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow', stats: null }] }]) });
    const ownerList = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(ownerList.projects.length, 1);
    const outsider = await db.createUser('outsider@example.com', 'a-real-password-123');
    const login = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'outsider@example.com', password: 'a-real-password-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const outsiderFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
    const outsiderList = await (await outsiderFetch('/api/hub/projects')).json();
    assert.strictEqual(outsiderList.projects.length, 0);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 4: Run to see the new tests fail**

Run: `cd server && node --test test/relay.test.js`
Expected: the 3 new tests FAIL (no enforcement exists yet — a Viewer's write currently succeeds, a
non-member's read currently succeeds, `GET /api/hub/projects` currently lists every published project
regardless of caller).

- [ ] **Step 5: Update `server/src/relay.js`**

Add near the top, right after the `REPLY_TIMEOUT_MS` constant:
```js
// Every op's required permission — the same 20 op names lib/dashboard/routes.js's ROUTES table
// defines (server/src/relay.js never hardcodes a second copy of that table; this maps each of ITS
// names to the ONE permission that gates it, kept in sync with routes.js by the fact that an
// unrecognized op name below fails closed — see checkAccess's `required` lookup).
const OP_PERMISSIONS = {
  'project.read': 'project.read', 'agentfile.read': 'project.read', 'files.tree': 'project.read', 'files.read': 'project.read',
  'files.write': 'project.write', 'files.mkdir': 'project.write', 'task.add': 'project.write', 'task.update': 'project.write',
  'task.comment': 'project.write', 'workflow.toggle': 'project.write', 'run.start': 'project.write', 'chat.summarize': 'project.write',
  'chat.clear': 'project.write', 'orchestrate.start': 'project.write', 'orchestrate.approve': 'project.write',
  'settings.save': 'project.manage_settings',
  'attention.add': 'project.write', 'attention.promote': 'project.write', 'attention.update': 'project.write', 'attention.remove': 'project.write',
};
```

Inside `registerRelay(app, { db, registry })`, add this helper right after `sendOp`:
```js
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
    if (requiredPermission === 'project.read' && await db.hasPlatformPermission(userId, 'platform.view_all_projects')) return 'ok';
    return 'not-member';
  }
```

Replace `GET /api/hub/projects`:
```js
  app.get('/api/hub/projects', async () => {
    const rows = await db.listPublic();
```
with:
```js
  app.get('/api/hub/projects', async (req) => {
    const rows = await db.listPublishedProjectsForUser(req.user.id);
```
(the rest of that handler's body — mapping rows to `{id,name,kind,machine,online,lastSeen,stats,
lastOpened}` — is completely unchanged; only the source query changes).

Replace `GET /api/events`:
```js
  app.get('/api/events', async (req, reply) => {
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    // An unpublished project (or one that never existed) is indistinguishable to the caller — both
    // 404 as "Unknown project.", so unpublishing takes a cached serverId out of circulation for SSE
    // exactly like reads below, not just for writes.
    if (!owner || !owner.published) return reply.code(404).send({ error: 'Unknown project.' });
```
with:
```js
  app.get('/api/events', async (req, reply) => {
    const serverId = req.query.p;
    const owner = serverId && await ownerOf(serverId);
    if (!owner || !owner.published) return reply.code(404).send({ error: 'Unknown project.' });
    const access = await checkAccess(req.user.id, serverId, 'project.read');
    if (access === 'not-member') return reply.code(404).send({ error: 'Unknown project.' });
    if (access === 'forbidden') return reply.code(403).send({ error: 'You do not have permission to view this project.' });
```

Replace the `app.all('/api/*', ...)` handler's body — find:
```js
    const route = findRoute(req.method, req.raw.url.split('?')[0]);
    if (!route) return reply.callNotFound();
    const [, , opName, argsFn] = route;
    const u = new URL(req.raw.url, 'http://x');
    const args = argsFn(u, req.body || {}, u.pathname);
    const st = registry.status(owner.machineId);
```
Insert the access check right after `opName` is known, before anything else uses it:
```js
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
```

- [ ] **Step 6: Add `GET /api/admin/projects` to `server/src/routes/admin.js`**

```js
  app.get('/api/admin/projects', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.view_all_projects'))) return;
    return { projects: await db.listPublic() };
  });
```

- [ ] **Step 7: Run the tests**

Run: `cd server && node --test test/relay.test.js test/routes/admin.test.js`
Expected: PASS.

- [ ] **Step 8: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 12's count, plus 3 new tests in relay.test.js, 0 new failures.

- [ ] **Step 9: Commit**

```bash
cd server && git add src/models/sharing.js src/db.js src/relay.js src/routes/admin.js test/relay.test.js
git commit -m "feat(server): real per-op permission enforcement in the relay; hub listing scoped to membership"
```

---

### Task 14: Custom role CRUD (both scopes) over HTTP

**Files:**
- Create: `server/src/routes/roles.js`
- Modify: `server/src/app.js` (mount it)
- Test: `server/test/routes/roles.test.js`

**Interfaces:**
- Consumes: Task 3's `db.createRole/deleteRole/getRole/listRolesByScope/hasPlatformPermission`.
- Produces: `GET /api/roles?scope=project|platform` (authenticated) → `{roles: [...]}` — every
  system role of that scope plus the caller's own custom roles of that scope (via
  `listRolesByScope(scope, req.user.id)`, exactly as already defined); `POST /api/roles`
  `{scope, name, permissionKeys}` → creates a custom role owned by the caller — for `scope:
  'platform'` this requires `platform.manage_roles` (403 otherwise); for `scope: 'project'` any
  authenticated account may create one (it's their own reusable, account-level vocabulary — no
  project context or extra permission needed, per the spec); `DELETE /api/roles/:id` → 403 if the
  role is a system role OR not owned by the caller, 200 otherwise.

- [ ] **Step 1: Write the failing tests** (`server/test/routes/roles.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, signupAndLogin };
}

test('GET /api/roles?scope=project lists the 4 system roles plus only the caller\'s own custom roles', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice@example.com');
    const bob = await signupAndLogin('bob@example.com');
    await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Reviewer', permissionKeys: ['project.read'] }) });
    const aliceList = await (await alice.fetch('/api/roles?scope=project')).json();
    const bobList = await (await bob.fetch('/api/roles?scope=project')).json();
    assert.strictEqual(aliceList.roles.length, 5); // 4 system + Reviewer
    assert.strictEqual(bobList.roles.length, 4); // 4 system only, not alice's Reviewer
    assert.ok(aliceList.roles.some((r) => r.name === 'Reviewer'));
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/roles rejects a permission from the wrong scope with 400', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice2@example.com');
    const r = await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Bad', permissionKeys: ['platform.manage_users'] }) });
    assert.strictEqual(r.status, 400);
  } finally { await app.close(); await db.destroy(); }
});

test('creating a platform-scope custom role requires platform.manage_roles; a project-scope one never does', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const first = await signupAndLogin('first@example.com'); // bootstrap admin, has platform.manage_roles
    const second = await signupAndLogin('second@example.com'); // ordinary account
    const ok = await first.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Support', permissionKeys: ['platform.view_all_projects'] }) });
    assert.strictEqual(ok.status, 200);
    const denied = await second.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'platform', name: 'Bad', permissionKeys: ['platform.view_all_projects'] }) });
    assert.strictEqual(denied.status, 403);
    const projectOk = await second.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'MyRole', permissionKeys: ['project.read'] }) });
    assert.strictEqual(projectOk.status, 200); // no special permission needed for a project-scope custom role
  } finally { await app.close(); await db.destroy(); }
});

test('DELETE /api/roles/:id: 403 for a system role, 403 for someone else\'s role, 200 for your own', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const alice = await signupAndLogin('alice3@example.com');
    const bob = await signupAndLogin('bob3@example.com');
    const created = await (await alice.fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'project', name: 'Mine', permissionKeys: ['project.read'] }) })).json();
    assert.strictEqual((await bob.fetch(`/api/roles/${created.role.id}`, { method: 'DELETE' })).status, 403);
    assert.strictEqual((await alice.fetch(`/api/roles/${db.SYSTEM_ROLE_IDS.VIEWER}`, { method: 'DELETE' })).status, 403);
    assert.strictEqual((await alice.fetch(`/api/roles/${created.role.id}`, { method: 'DELETE' })).status, 200);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && node --test test/routes/roles.test.js`
Expected: FAIL — no `/api/roles` route.

- [ ] **Step 3: Write `server/src/routes/roles.js`**

```js
'use strict';
async function registerRoles(app, { db }) {
  app.get('/api/roles', async (req, reply) => {
    const scope = req.query.scope;
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    return { roles: await db.listRolesByScope(scope, req.user.id) };
  });

  app.post('/api/roles', async (req, reply) => {
    const { scope, name, permissionKeys } = req.body || {};
    if (scope !== 'platform' && scope !== 'project') return reply.code(400).send({ error: 'scope must be "platform" or "project"' });
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    if (!Array.isArray(permissionKeys)) return reply.code(400).send({ error: 'permissionKeys must be an array' });
    if (scope === 'platform' && !(await db.hasPlatformPermission(req.user.id, 'platform.manage_roles'))) {
      return reply.code(403).send({ error: 'Creating a platform-scope role requires platform.manage_roles.' });
    }
    let role;
    try { role = await db.createRole({ scope, ownerUserId: req.user.id, name: name.trim(), permissionKeys }); }
    catch (e) { return reply.code(400).send({ error: e.message }); }
    return { role };
  });

  app.delete('/api/roles/:id', async (req, reply) => {
    const role = await db.getRole(req.params.id);
    if (!role) return reply.code(404).send({ error: 'Role not found.' });
    if (role.isSystem || role.ownerUserId !== req.user.id) return reply.code(403).send({ error: 'You can only delete your own custom roles.' });
    await db.deleteRole(req.params.id);
    return { ok: true };
  });
}
module.exports = { registerRoles };
```

- [ ] **Step 4: Mount it in `server/src/app.js`**

```js
  const { registerRoles } = require('./routes/roles');
  await registerRoles(app, { db });
```

- [ ] **Step 5: Run the tests**

Run: `cd server && node --test test/routes/roles.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 13's count, plus 4 new tests, 0 new failures.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/routes/roles.js src/app.js test/routes/roles.test.js
git commit -m "feat(server): custom role CRUD over HTTP, both scopes"
```

---

### Task 15: Flat project groups

**Files:**
- Create: `server/migrations/0010_project_groups.js`
- Create: `server/src/models/groups.js`
- Modify: `server/src/db.js` (require + spread)
- Modify: `server/src/relay.js` (`GET /api/hub/projects` includes `groupId`/`groupName`)
- Create: `server/src/routes/groups.js`
- Modify: `server/src/app.js` (mount it)
- Test: `server/test/models/groups.test.js`, `server/test/routes/groups.test.js`

**Interfaces:**
- Consumes: Task 1's `users`; existing `projects` table.
- Produces: `db.createGroup(ownerUserId, name)` → `Promise<{id,ownerUserId,name}>`;
  `db.listGroupsForOwner(ownerUserId)` → `Promise<Array<{id,name}>>`; `db.renameGroup(groupId,
  name)` → `Promise<void>`; `db.deleteGroup(groupId)` → `Promise<void>` (any project in the group
  has its `group_id` set back to `null`, never cascades to delete the project); `db.setProjectGroup
  (projectId, groupId|null)` → `Promise<void>`.

- [ ] **Step 1: Write the migration**

```js
// server/migrations/0010_project_groups.js
'use strict';
exports.up = async (knex) => {
  await knex.schema.createTable('project_groups', (t) => {
    t.string('id', 20).primary();
    t.string('owner_user_id', 20).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 100).notNullable();
  });
  await knex.schema.alterTable('projects', (t) => {
    t.string('group_id', 20).nullable().references('id').inTable('project_groups').onDelete('SET NULL');
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('projects', (t) => t.dropColumn('group_id'));
  await knex.schema.dropTableIfExists('project_groups');
};
```

- [ ] **Step 2: Write the failing model tests** (`server/test/models/groups.test.js`)

```js
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
```

- [ ] **Step 3: Run to see it fail**

Run: `cd server && node --test test/models/groups.test.js`
Expected: FAIL — `db.createGroup is not a function`.

- [ ] **Step 4: Write `server/src/models/groups.js`**

```js
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
```

- [ ] **Step 5: Wire it into `server/src/db.js`** (require + spread, same pattern)

- [ ] **Step 6: Run the model tests**

Run: `cd server && node --test test/models/groups.test.js`
Expected: PASS.

- [ ] **Step 7: Include group info in `GET /api/hub/projects` — update `server/src/relay.js`**

Find (inside the `GET /api/hub/projects` handler, from Task 13):
```js
      return { id: r.id, name: r.name, kind: r.kind, machine: m ? m.name : 'unknown', online: st.connected, lastSeen: st.lastSeen, stats: (cached && cached.stats) || null, lastOpened: r.snapshot_at || r.created_at };
```
Replace with:
```js
      return { id: r.id, name: r.name, kind: r.kind, machine: m ? m.name : 'unknown', online: st.connected, lastSeen: st.lastSeen, stats: (cached && cached.stats) || null, lastOpened: r.snapshot_at || r.created_at, groupId: r.group_id || null };
```
(`db.listPublishedProjectsForUser`'s rows already include every `projects` column via `select
('projects.*')` from Task 13, so `r.group_id` is already present with zero query changes needed.)

- [ ] **Step 8: Write `server/src/routes/groups.js`**

```js
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
```
Note the last route deliberately checks only `project.read` (any member may personally file a
project into one of their own groups for their own view — this never touches anyone else's view of
the same project, since `group_id` is a single column on `projects`, not per-viewer... **this is a
real, deliberate simplification the spec's own wording already anticipated** ("purely personal ...
never affects access") **but the current single `group_id` column makes a project's group ONE
shared value, not one-per-viewing-member.** Since the spec explicitly describes groups as personal
per-account organization and this plan's `projects.group_id` is a single column (matching the
spec's own §2 schema literally), the practical behavior is: only the fields that matter for a
single-owner project (the overwhelmingly common case — most published projects have exactly one
member, the Owner, until they're specifically shared) work exactly as intended; on a project with
multiple members who've each been given `project.read`, the LAST person to set a group "wins" for
everyone, which does deviate from "purely personal" for that narrower multi-member case. This is a
real, minor spec/schema tension — not a bug in this task's code, which faithfully implements the
schema exactly as written — flag it for the controller's own notes rather than silently
"improving" the schema unilaterally in this task (a real fix, if wanted later, would need a
per-`(project_id,user_id)` group-assignment table instead of one shared `projects.group_id` column
— out of scope for this plan to redesign without the user's own sign-off).

- [ ] **Step 9: Mount it in `server/src/app.js`**

```js
  const { registerGroups } = require('./routes/groups');
  await registerGroups(app, { db });
```

- [ ] **Step 10: Write the failing route tests** (`server/test/routes/groups.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'a-real-password-123' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
  const userId = (await r.json()).userId;
  const m = await db.createMachine('laptop', userId); await m.ready;
  const project = await db.upsertProject({ machineId: m.id, localId: 'aaaaaa', name: 'Alpha', kind: 'spectoflow' });
  await db.addProjectMember(project.id, userId, db.SYSTEM_ROLE_IDS.OWNER);
  return { app, db, authedFetch, project };
}

test('create/list/rename/delete a group; assign a project to it and clear it', async () => {
  const { app, db, authedFetch, project } = await boot();
  try {
    const created = await (await authedFetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clients' }) })).json();
    assert.ok(created.group.id);
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups.length, 1);
    await authedFetch(`/api/groups/${created.group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Client Work' }) });
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups[0].name, 'Client Work');
    const assign = await authedFetch(`/api/projects/${project.id}/group`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: created.group.id }) });
    assert.strictEqual(assign.status, 200);
    const list = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(list.projects[0].groupId, created.group.id);
    await authedFetch(`/api/groups/${created.group.id}`, { method: 'DELETE' });
    assert.strictEqual((await (await authedFetch('/api/groups')).json()).groups.length, 0);
    const listAfter = await (await authedFetch('/api/hub/projects')).json();
    assert.strictEqual(listAfter.projects[0].groupId, null); // cleared, project untouched
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 11: Run to see it fail, then pass**

Run: `cd server && node --test test/routes/groups.test.js`
Expected first: FAIL (routes/migration not yet applied — apply Steps 1-9 if not already done).
Expected: PASS.

- [ ] **Step 12: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 14's count, plus 2 new tests, 0 new failures.

- [ ] **Step 13: Commit**

```bash
cd server && git add migrations/0010_project_groups.js src/models/groups.js src/db.js src/relay.js src/routes/groups.js src/app.js test/models/groups.test.js test/routes/groups.test.js
git commit -m "feat(server): flat project groups — personal organization, never affects access

Note (for the controller's own D-entry write-up, not a code defect): projects.group_id is one
shared column per the spec's own schema, so on a MULTI-member project the last person to set a
group technically affects every member's view, not just their own — the overwhelmingly common
single-owner case works exactly as intended. A true per-viewer group assignment would need a
(project_id,user_id) table instead; deliberately not redesigned here without explicit sign-off."
```

---

### Task 16: Account page — profile, password change, sessions, machine tokens (web UI)

**Files:**
- Modify: `server/src/db.js` (add `listMachinesForOwner`/`findMachine` directly — machines have
  always lived inline in this file since C1, not in a `models/` sub-file; this task doesn't move
  them, just extends what's already there)
- Create: `server/src/routes/account.js`
- Modify: `server/src/app.js` (mount it)
- Test: `server/test/routes/account.test.js`

**Interfaces:**
- Consumes: Task 1's `db.findUserById/verifyPassword/updatePassword`; Task 4's
  `db.listSessionsForUser/revokeSession/revokeAllSessionsForUser/createSession`; Task 7's
  `db.createMachine`.
- Produces: `db.listMachinesForOwner(ownerUserId)` → `Promise<Array<{id,name,created_at,last_seen,
  revoked_at}>>`; `db.findMachine(machineId)` → `Promise<row|null>` (the full row, including
  `owner_user_id` — used here to verify ownership before letting someone revoke a machine token that
  isn't theirs). `GET /account` (a plain page); `GET /api/account` → `{id,email,emailVerifiedAt}`;
  `POST /api/account/password` `{currentPassword,newPassword}` → verifies, updates, revokes every
  OTHER session, issues a fresh cookie for the current one; `GET /api/account/sessions` →
  `{sessions:[...], currentSessionId}`; `DELETE /api/account/sessions/:id` → 404 if that session
  isn't the caller's own; `GET /api/account/machines` → `{machines:[...]}`; `POST
  /api/account/machines` `{name}` → `{machine:{id,name,token}}` (token shown once, same convention as
  the CLI); `DELETE /api/account/machines/:id` → 404 if not owned by the caller.

- [ ] **Step 1: Add the two small db.js functions**

In `server/src/db.js`, right after the existing `revokeMachine` function, add:
```js
  async function listMachinesForOwner(ownerUserId) {
    return knex('machines').where({ owner_user_id: ownerUserId }).select('id', 'name', 'created_at', 'last_seen', 'revoked_at').orderBy('created_at', 'desc');
  }
  async function findMachine(id) {
    const row = await knex('machines').where({ id }).first();
    return row || null;
  }
```
Add `listMachinesForOwner, findMachine,` to the final returned object (alongside the existing
`createMachine, machineByToken, ...`).

- [ ] **Step 2: Write the failing route tests** (`server/test/routes/account.test.js`)

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildApp } = require('../../src/app');
const { createDb } = require('../../src/db');

function fakeEmailer() { return { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendInvitationEmail: async () => {} }; }
async function boot() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const app = await buildApp({ db, insecureDev: true, publicDir: __dirname, emailer: fakeEmailer() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return { app, db, url };
}
async function login(url, email, password) {
  const r = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { cookie: r.headers.get('set-cookie').split(';')[0], fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: r.headers.get('set-cookie').split(';')[0] }) }) };
}

test('GET /api/account returns the profile; GET /account renders a page', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const authedFetch = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) });
    const profile = await (await authedFetch('/api/account')).json();
    assert.strictEqual(profile.email, 'alice@example.com');
    assert.strictEqual(profile.emailVerifiedAt, null);
    assert.strictEqual((await authedFetch('/account')).status, 200);
  } finally { await app.close(); await db.destroy(); }
});

test('POST /api/account/password: wrong current password 400; success revokes every OTHER session, keeps this one working via a fresh cookie', async () => {
  const { app, db, url } = await boot();
  try {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.com', password: 'a-real-password-123' }) });
    const cookieA = r.headers.get('set-cookie').split(';')[0];
    const { cookie: cookieB } = await login(url, 'bob@example.com', 'a-real-password-123'); // a second, independent session
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const wrong = await authedA('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'nope', newPassword: 'brand-new-password-1' }) });
    assert.strictEqual(wrong.status, 400);
    const change = await authedA('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'a-real-password-123', newPassword: 'brand-new-password-1' }) });
    assert.strictEqual(change.status, 200);
    const newCookie = change.headers.get('set-cookie').split(';')[0];
    const stillWorksNew = await fetch(url + '/api/account', { headers: { Cookie: newCookie } });
    assert.strictEqual(stillWorksNew.status, 200);
    const otherSessionDead = await fetch(url + '/api/account', { headers: { Cookie: cookieB } });
    assert.strictEqual(otherSessionDead.status, 401);
  } finally { await app.close(); await db.destroy(); }
});

test('GET/DELETE /api/account/sessions: lists the caller\'s own sessions only, can revoke one of them, 404 for someone else\'s', async () => {
  const { app, db, url } = await boot();
  try {
    const rA = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'carol@example.com', password: 'a-real-password-123' }) });
    const cookieA = rA.headers.get('set-cookie').split(';')[0];
    const { cookie: cookieA2 } = await login(url, 'carol@example.com', 'a-real-password-123');
    const rB = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dave@example.com', password: 'a-real-password-123' }) });
    const cookieB = rB.headers.get('set-cookie').split(';')[0];
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const list = await (await authedA('/api/account/sessions')).json();
    assert.strictEqual(list.sessions.length, 2); // this browser's session + the second login
    const other = list.sessions.find((s) => s.id !== list.currentSessionId);
    const revokeOk = await authedA(`/api/account/sessions/${other.id}`, { method: 'DELETE' });
    assert.strictEqual(revokeOk.status, 200);
    const authedB = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieB }) });
    const bList = await (await authedB('/api/account/sessions')).json();
    const revokeForeign = await authedA(`/api/account/sessions/${bList.currentSessionId}`, { method: 'DELETE' });
    assert.strictEqual(revokeForeign.status, 404);
  } finally { await app.close(); await db.destroy(); }
});

test('GET/POST/DELETE /api/account/machines: create shows the token once, list never re-shows it, delete refuses someone else\'s machine', async () => {
  const { app, db, url } = await boot();
  try {
    const rA = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'erin@example.com', password: 'a-real-password-123' }) });
    const cookieA = rA.headers.get('set-cookie').split(';')[0];
    const authedA = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieA }) });
    const created = await (await authedA('/api/account/machines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'my-laptop' }) })).json();
    assert.match(created.machine.token, /^spf_/);
    const list = await (await authedA('/api/account/machines')).json();
    assert.strictEqual(list.machines.length, 1);
    assert.strictEqual(list.machines[0].token, undefined);
    const rB = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'frank@example.com', password: 'a-real-password-123' }) });
    const cookieB = rB.headers.get('set-cookie').split(';')[0];
    const authedB = (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookieB }) });
    assert.strictEqual((await authedB(`/api/account/machines/${created.machine.id}`, { method: 'DELETE' })).status, 404);
    assert.strictEqual((await authedA(`/api/account/machines/${created.machine.id}`, { method: 'DELETE' })).status, 200);
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && node --test test/routes/account.test.js`
Expected: FAIL — none of these routes exist.

- [ ] **Step 4: Write `server/src/routes/account.js`**

```js
'use strict';
const ACCOUNT_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — account</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:640px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2130}
button{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}
input{padding:7px 9px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2}</style></head><body>
<h1 style="font-size:17px">Account</h1>
<div id="profile"></div>
<h2>Change password</h2>
<form id="pwForm"><input id="cur" type="password" placeholder="Current password" /><input id="new" type="password" placeholder="New password (12+ chars)" /><button type="submit">Change</button><p id="pwErr" style="color:#e0607a"></p></form>
<h2>Sessions</h2><div id="sessions"></div>
<h2>Machine tokens</h2><div id="machines"></div>
<form id="mForm"><input id="mName" placeholder="Machine name" /><button type="submit">Create token</button></form>
<pre id="newToken" style="display:none;background:#1e2130;padding:10px;border-radius:6px"></pre>
<script>
async function j(url, opts) { const r = await fetch(url, opts); return r.json(); }
async function load() {
  const p = await j('/api/account'); document.getElementById('profile').textContent = p.email + (p.emailVerifiedAt ? ' (verified)' : ' (not verified)');
  const s = await j('/api/account/sessions');
  document.getElementById('sessions').innerHTML = s.sessions.map(x => '<div class="row"><span>' + (x.userAgent||'unknown') + ' — ' + x.ip + (x.id===s.currentSessionId?' (this device)':'') + '</span><button data-session="'+x.id+'">Revoke</button></div>').join('');
  const m = await j('/api/account/machines');
  document.getElementById('machines').innerHTML = m.machines.map(x => '<div class="row"><span>' + x.name + (x.revoked_at?' (revoked)':'') + '</span><button data-machine="'+x.id+'">Revoke</button></div>').join('');
}
document.addEventListener('click', async (e) => {
  if (e.target.dataset.session) { await fetch('/api/account/sessions/'+e.target.dataset.session, {method:'DELETE'}); load(); }
  if (e.target.dataset.machine) { await fetch('/api/account/machines/'+e.target.dataset.machine, {method:'DELETE'}); load(); }
});
document.getElementById('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/account/password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:document.getElementById('cur').value,newPassword:document.getElementById('new').value})});
  if (r.ok) location.reload(); else document.getElementById('pwErr').textContent = (await r.json()).error || 'Could not change password.';
});
document.getElementById('mForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await j('/api/account/machines', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('mName').value})});
  document.getElementById('newToken').style.display='block'; document.getElementById('newToken').textContent = 'spectoflow dashboard login --url=' + location.origin + ' --token=' + r.machine.token;
  load();
});
load();
</script></body></html>`;

async function registerAccount(app, { db, insecureDev }) {
  app.get('/account', async (_req, reply) => reply.type('text/html').send(ACCOUNT_PAGE_HTML));

  app.get('/api/account', async (req) => {
    const u = await db.findUserById(req.user.id);
    return { id: u.id, email: u.email, emailVerifiedAt: u.email_verified_at };
  });

  app.post('/api/account/password', async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = await db.findUserById(req.user.id);
    if (typeof currentPassword !== 'string' || !(await db.verifyPassword(user, currentPassword))) return reply.code(400).send({ error: 'Current password is incorrect.' });
    if (typeof newPassword !== 'string' || newPassword.length < 12) return reply.code(400).send({ error: 'New password must be at least 12 characters.' });
    await db.updatePassword(user.id, newPassword);
    await db.revokeAllSessionsForUser(user.id); // including the current one — reissue below so this browser tab stays signed in
    const session = await db.createSession(user.id, { userAgent: (req.headers['user-agent'] || '').slice(0, 300), ip: req.ip });
    reply.setCookie('spf_session', session.token, { httpOnly: true, secure: !insecureDev, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
    return { ok: true };
  });

  app.get('/api/account/sessions', async (req) => {
    const sessions = await db.listSessionsForUser(req.user.id);
    return { sessions, currentSessionId: req.sessionId };
  });
  app.delete('/api/account/sessions/:id', async (req, reply) => {
    const mine = await db.listSessionsForUser(req.user.id);
    if (!mine.some((s) => s.id === req.params.id)) return reply.code(404).send({ error: 'Session not found.' });
    await db.revokeSession(req.params.id);
    return { ok: true };
  });

  app.get('/api/account/machines', async (req) => ({ machines: await db.listMachinesForOwner(req.user.id) }));
  app.post('/api/account/machines', async (req, reply) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    const m = db.createMachine(name.trim(), req.user.id); await m.ready;
    return { machine: { id: m.id, name: m.name, token: m.token } };
  });
  app.delete('/api/account/machines/:id', async (req, reply) => {
    const machine = await db.findMachine(req.params.id);
    if (!machine || machine.owner_user_id !== req.user.id) return reply.code(404).send({ error: 'Machine not found.' });
    await db.revokeMachine(req.params.id);
    return { ok: true };
  });
}
module.exports = { registerAccount };
```

Note: `req.sessionId` is referenced by `GET /api/account/sessions` above but nothing sets it yet —
add one line to `server/src/auth.js`'s `onRequest` hook (this task modifies that file too, a small
addition):
```js
    req.user = { id: session.userId };
```
becomes:
```js
    req.user = { id: session.userId };
    req.sessionId = session.id;
```

- [ ] **Step 5: Mount it in `server/src/app.js`**

```js
  const { registerAccount } = require('./routes/account');
  await registerAccount(app, { db, insecureDev });
```

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/routes/account.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 15's count, plus 4 new tests, 0 new failures.

- [ ] **Step 8: Commit**

```bash
cd server && git add src/db.js src/auth.js src/routes/account.js src/app.js test/routes/account.test.js
git commit -m "feat(server): Account page — profile, password change, revocable sessions, machine tokens via web"
```

---

### Task 17: Admin page — user list, promote/demote, signup-mode toggle (web UI)

**Files:**
- Modify: `server/src/models/rbac.js` (add `countUsersWithPlatformRole`)
- Modify: `server/src/db.js` (spread the new function — no new require, `rbac.js` is already required)
- Modify: `server/src/routes/admin.js` (add user list + promote/demote + the plain admin page)
- Test: `server/test/routes/admin.test.js` (extended)

**Interfaces:**
- Consumes: Task 1's `db.listUsers`; Task 3's `db.assignPlatformRole/removePlatformRole/
  hasPlatformPermission/SYSTEM_ROLE_IDS`.
- Produces: `db.countUsersWithPlatformRole(roleId)` → `Promise<number>`; `GET /admin` (a plain page,
  requires `platform.manage_users` OR `platform.manage_signup` — shows whichever sections the
  caller's own permissions unlock); `GET /api/admin/users` (requires `platform.manage_users`) →
  `{users:[...]}`; `POST /api/admin/users/:id/promote` / `/demote` (requires `platform.manage_users`)
  — `demote` returns `400` if the target is the LAST account holding Platform Admin (never leave the
  instance with zero admins).

- [ ] **Step 1: Add `countUsersWithPlatformRole` to `server/src/models/rbac.js`**

Add inside `createRbacModel(knex)`, and to its returned object:
```js
  async function countUsersWithPlatformRole(roleId) {
    const r = await knex('user_platform_roles').where({ role_id: roleId }).count({ n: 'user_id' }).first();
    return Number(r.n);
  }
```

- [ ] **Step 2: Write the failing tests** (append to `server/test/routes/admin.test.js`)

```js
test('GET /api/admin/users lists every account; promote/demote toggle Platform Admin; the last admin cannot be demoted', async () => {
  const { app, db, signupAndLogin } = await boot();
  try {
    const admin = await signupAndLogin('admin2@example.com'); // bootstrap admin
    const other = await signupAndLogin('other2@example.com');
    const list = await (await admin('/api/admin/users')).json();
    assert.strictEqual(list.users.length, 2);
    assert.strictEqual(list.users[0].passwordHash, undefined);

    const otherUserId = list.users.find((u) => u.email === 'other2@example.com').id;
    const promote = await admin(`/api/admin/users/${otherUserId}/promote`, { method: 'POST' });
    assert.strictEqual(promote.status, 200);
    assert.strictEqual(await db.hasPlatformPermission(otherUserId, 'platform.manage_signup'), true);

    const denied = await other(`/api/admin/users/${otherUserId}/demote`, { method: 'POST' }); // now also admin, but that's fine — still requires the permission, which it has
    assert.strictEqual(denied.status, 200); // 'other' now holds platform.manage_users too, via the promotion above

    const adminUserId = list.users.find((u) => u.email === 'admin2@example.com').id;
    const demoteBootstrap = await admin(`/api/admin/users/${adminUserId}/demote`, { method: 'POST' });
    assert.strictEqual(demoteBootstrap.status, 200); // 2 admins exist right now (admin2 + other2), so this succeeds
    const demoteLast = await other(`/api/admin/users/${otherUserId}/demote`, { method: 'POST' });
    assert.strictEqual(demoteLast.status, 400); // would leave zero admins — refused
  } finally { await app.close(); await db.destroy(); }
});
```

- [ ] **Step 3: Run to see it fail**

Run: `cd server && node --test test/routes/admin.test.js`
Expected: FAIL — no `/api/admin/users` route.

- [ ] **Step 4: Extend `server/src/routes/admin.js`**

Add these routes and the page:
```js
  app.get('/api/admin/users', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    return { users: await db.listUsers() };
  });
  app.post('/api/admin/users/:id/promote', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    await db.assignPlatformRole(req.params.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/demote', async (req, reply) => {
    if (!(await requirePlatformPermission(req, reply, db, 'platform.manage_users'))) return;
    const count = await db.countUsersWithPlatformRole(db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    const targetIsAdmin = await db.hasPlatformPermission(req.params.id, 'platform.manage_signup'); // any real admin permission implies membership in the role, this checks it holds the actual role
    if (targetIsAdmin && count <= 1) return reply.code(400).send({ error: 'Cannot remove the last Platform Admin.' });
    await db.removePlatformRole(req.params.id, db.SYSTEM_ROLE_IDS.PLATFORM_ADMIN);
    return { ok: true };
  });
  app.get('/admin', async (_req, reply) => reply.type('text/html').send(ADMIN_PAGE_HTML));
```
Add the page template near the top of the file (or bottom, before `module.exports`):
```js
const ADMIN_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — admin</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:720px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2130}
select,button{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}</style></head><body>
<h1 style="font-size:17px">Admin</h1>
<h2>Signup mode</h2>
<select id="mode"><option value="open">Open</option><option value="invite_only">Invite only</option><option value="disabled">Disabled</option></select>
<h2>Accounts</h2><div id="users"></div>
<script>
async function j(u,o){const r=await fetch(u,o);return r.json();}
async function load(){
  const m = await j('/api/admin/signup-mode'); document.getElementById('mode').value = m.mode;
  const u = await j('/api/admin/users');
  document.getElementById('users').innerHTML = u.users.map(x => '<div class="row"><span>'+x.email+(x.email_verified_at?'':' (unverified)')+'</span><button data-promote="'+x.id+'">Promote</button><button data-demote="'+x.id+'">Demote</button></div>').join('');
}
document.getElementById('mode').addEventListener('change', async (e) => { await fetch('/api/admin/signup-mode', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:e.target.value})}); });
document.addEventListener('click', async (e) => {
  if (e.target.dataset.promote) await fetch('/api/admin/users/'+e.target.dataset.promote+'/promote', {method:'POST'});
  if (e.target.dataset.demote) await fetch('/api/admin/users/'+e.target.dataset.demote+'/demote', {method:'POST'});
  load();
});
load();
</script></body></html>`;
```

- [ ] **Step 5: Run the tests**

Run: `cd server && node --test test/routes/admin.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: same as Task 16's count, plus 1 new test, 0 new failures.

- [ ] **Step 7: Commit**

```bash
cd server && git add src/models/rbac.js src/db.js src/routes/admin.js test/routes/admin.test.js
git commit -m "feat(server): Admin page — account list, promote/demote, signup-mode toggle (last-admin guard)"
```

---

### Task 18: Real end-to-end test — two accounts, an invited Viewer, real 403/200

**Files:**
- Create: `server/test/e2e-sharing.test.js`

**Interfaces:**
- Consumes: everything built in Tasks 1-17 — no new production code, this is purely an integration
  test in the spirit of `server/test/e2e.test.js` (C1's own end-to-end test), proving the whole
  accounts+sharing stack works together over a real running server and a real spawned local hub, not
  mocked permission logic.

- [ ] **Step 1: Write the test**

```js
'use strict';
/*
 * Real end-to-end proof of sub-project C2 (accounts, sessions, sharing): two real accounts, a real
 * spawned local hub, a real invitation accepted by the second account as Viewer, and a real 403 on
 * a write attempt / real 200 on a read — over the actual running server, nothing mocked.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createDb } = require('../src/db');
const { buildApp } = require('../src/app');
const workspace = require('../../lib/workspace');

const KIT = path.resolve(__dirname, '..', '..');
const BIN = path.join(KIT, 'bin', 'spectoflow.js');
const HUB = path.join(KIT, 'lib', 'dashboard', 'hub-server.js');

function fakeEmailer() { const sent = []; return { sent,
  sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {},
  sendInvitationEmail: async (to, projectName, url) => { sent.push({ to, projectName, url }); },
}; }

async function bootServer() {
  const db = await createDb('sqlite::memory:'); await db.migrate();
  const emailer = fakeEmailer();
  const app = await buildApp({ db, insecureDev: true, publicDir: path.join(KIT, 'lib', 'dashboard', 'public'), emailer });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function signupAndLogin(email) {
    const r = await fetch(url + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'a-real-password-123' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { userId: (await r.json()).userId, fetch: (p, opts = {}) => fetch(url + p, { ...opts, headers: Object.assign({}, opts.headers, { Cookie: cookie }) }) };
  }
  return { app, db, url, emailer, signupAndLogin };
}
function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, ...args], { stdio: 'pipe', ...opts });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => (status === 0 ? resolve({ status, stdout, stderr }) : reject(new Error(`${args.join(' ')} exited ${status}\n${stdout}${stderr}`))));
  });
}
function startHub(home, port) {
  return new Promise((resolve) => {
    const srv = spawn('node', [HUB], { env: { ...process.env, SPECTOFLOW_HOME: home, SPECTOFLOW_PORT: String(port) } });
    srv.stdout.on('data', (d) => { if (/hub →/.test(d.toString())) resolve(srv); });
  });
}

test('two accounts, a real invitation accepted as Viewer, real 200 read / real 403 write', { timeout: 60000 }, async () => {
  const { app, db, url, emailer, signupAndLogin } = await bootServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-e2e-share-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-e2e-share-proj-'));
  execFileSync('node', [BIN, 'init', projectDir], { stdio: 'pipe' });
  const owner = await signupAndLogin('owner@example.com');
  // A machine token is created via the account, not the admin CLI — matching how a real user would
  // do this from the Account page (Task 16); this test drives it via the model directly (equivalent
  // to what that route does) since spinning up a browser for one token isn't needed here.
  const machine = db.createMachine('e2e-laptop', owner.userId); await machine.ready;
  let hub = null;
  try {
    const env = { ...process.env, SPECTOFLOW_HOME: home };
    await run(['dashboard', 'login', `--url=${url}`, `--token=${machine.token}`, '--name=e2e-box'], { env });
    workspace.registerProject(projectDir, path.join(home, 'dashboard'));
    await run(['dashboard', 'publish'], { env, cwd: projectDir });
    hub = await startHub(home, 5900 + Math.floor(Math.random() * 100));

    let serverId = null;
    for (let i = 0; i < 100 && !serverId; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = (await (await owner.fetch('/api/hub/projects')).json()).projects;
      if (rows.length) serverId = rows[0].id;
    }
    assert.ok(serverId, 'the project appears, owned by the account that created the machine token');

    const invite = await owner.fetch(`/api/projects/${serverId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', roleId: db.SYSTEM_ROLE_IDS.VIEWER }) });
    assert.strictEqual(invite.status, 200);
    const inviteToken = emailer.sent[0].url.split('/invitations/')[1];
    const viewer = await signupAndLogin('viewer@example.com');
    const accept = await viewer.fetch(`/invitations/${inviteToken}/accept`, { method: 'POST' });
    assert.strictEqual(accept.status, 200);

    const read = await viewer.fetch(`/api/project?p=${serverId}`);
    assert.strictEqual(read.status, 200);
    const write = await viewer.fetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'not allowed' }) });
    assert.strictEqual(write.status, 403);

    const ownerWrite = await owner.fetch(`/api/task?p=${serverId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'allowed' }) });
    assert.strictEqual(ownerWrite.status, 200);
  } finally {
    if (hub) hub.kill();
    workspace.clearRemote(path.join(home, 'dashboard'));
    await app.close(); await db.destroy();
  }
});
```

- [ ] **Step 2: Run it**

Run: `cd server && node --test test/e2e-sharing.test.js`
Expected: PASS (1-2 minutes — real process spawning, expected, not a hang).

- [ ] **Step 3: Run the full server suite one more time**

Run: `cd server && npm test`
Expected: all PASS, same as Task 17's count plus 1 new test.

- [ ] **Step 4: Commit**

```bash
cd server && git add test/e2e-sharing.test.js
git commit -m "test(server): real end-to-end — two accounts, an invited Viewer, real 403/200 over a live server"
```

---

### Task 19: Final regression pass, version bump, controller-only documentation markers

**Files:**
- Modify: `server/package.json` (version only)
- Modify: `docs/DECISIONS.md` (controller-only placeholder marker, NOT committed by this task)
- Modify: `CLAUDE.md` (controller-only placeholder marker, NOT committed by this task)

**Interfaces:**
- Consumes: every test file from Tasks 1-18.
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Run the full server suite one final time**

Run: `cd server && npm test`
Expected: every test file passes — this is the moment to confirm the whole accounts+sharing stack,
built across 18 tasks, is fully green together, not just file-by-file.

- [ ] **Step 2: Run the root suite to confirm this sub-project genuinely touched nothing outside `server/`**

Run: `npm test` (from the repo root)
Expected: identical pass/fail/skip counts to the baseline recorded before Task 1 started (this whole
plan is entirely inside `server/` — if the root count changed, something leaked outside its
boundary and must be investigated before proceeding).

- [ ] **Step 3: Bump `server/package.json`'s version**

Find:
```json
  "version": "0.1.0",
```
Replace with:
```json
  "version": "0.2.0",
```
(Minor, not patch — this replaces `server/`'s entire authentication and authorization model; matches
how this repo has versioned every prior sub-project's user-visible/breaking change. This is
`server/`'s own, independent version — the root `spectoflow` package's version is untouched by this
entire plan.)

- [ ] **Step 4: Leave the controller-only documentation markers** (do NOT write real prose — this
  repo's established convention, followed by every prior sub-project's final task, is that
  `docs/DECISIONS.md`'s narrative entry — French — and `CLAUDE.md`'s "What exists" section — English
  — are written by the controller personally, after implementation, not by a dispatched task)

Append to `docs/DECISIONS.md` (find the end of the most recent entry and append right after it):
```markdown
<!-- CONTROLLER: write the next DECISIONS entry here (French), summarizing sub-project C2 (merged
with C3) — accounts, sessions, roles/permissions (platform + project scope), sharing, project
groups — per the repo's existing DECISIONS entry style (see the immediately preceding entries for
the shape: what existed before, what changed, why, what was verified). Note explicitly: (a)
SPECTOFLOW_ACCESS_KEY/SESSION_SECRET are gone entirely, replaced by real accounts; (b) the
Owner-vs-Admin protected-status distinction (identical permissions, different removability); (c) the
project_groups schema limitation found during planning (one shared group_id column per project, not
per-viewer — the common single-owner case is unaffected, a genuinely multi-member project's group
assignment is shared, not personal, contrary to the spec's original "purely personal" intent — flag
this as a known, deliberate limitation, not a bug). Remove this marker once written. -->
```

Append to `CLAUDE.md`, right after the most recent `## What exists (vX.Y.Z — see DECISIONS DNN)`
section's last paragraph (before the next `## What exists` heading):
```markdown
<!-- CONTROLLER: add a "## What exists (vNEXT — see DECISIONS DNEXT)" section here, in this file's
own established voice/format (see the section just above for the shape), describing sub-project C2
(merged with C3): real accounts/sessions replacing the single access key, the unified roles→
permissions engine (platform + project scope, both fully customizable), email-driven signup/
verification/password-reset/invitation flows, project membership enforcement in the relay, custom
roles, and flat project groups (noting the group_id schema limitation for multi-member projects).
Remove this marker once written. -->
```

These two edits are made to the working tree but **NOT staged or committed** by this task — same
convention as every prior sub-project's final task (the controller commits them together with the
real decision write-up afterward).

- [ ] **Step 5: Commit the version bump only**

```bash
cd server && git add package.json
git commit -m "chore: spectoflow-server 0.2.0 — accounts, sessions, roles/permissions, sharing (C2+C3)"
```

---

## Self-Review

**1. Spec coverage** — every goal in `docs/online-dashboard-accounts-design.md` maps to a task:
Goal 1 (real accounts replace the access key) → Task 5. Goal 2 (revocable per-device sessions) →
Task 4 (model) + Task 16 (UI/list/revoke). Goal 3 (unified roles→permissions, both scopes,
customizable) → Tasks 2-3 (schema+engine) + Task 14 (HTTP CRUD). Goal 4 (email flows) → Task 8
(abstraction+tokens) + Task 9 (verification) + Task 10 (password reset) + Task 11 (invitations).
Goal 5 (project membership + real enforcement) → Task 11 (membership/invites) + Task 13
(enforcement). Goal 6 (machine tokens move to the UI, CLI stays a fallback) → Task 7 (ownership) +
Task 16 (web UI) + Task 7's own CLI `--owner-email` addition (fallback preserved, not removed).
Goal 7 (flat project groups) → Task 15. Goal 8 (signup-mode toggle) → Task 12 (logic) + Task 17
(UI). The spec's own "Owner-vs-Admin protected status" rule → Task 2 (identical permission sets,
documented) + Task 11 (`removeProjectMember`/`changeMemberRole` refuse `sys-owner`, tested). The
`platform.view_all_projects` bypass → Task 13, tested explicitly. The `GET /api/hub/projects`
re-scoping → Task 13, tested explicitly. The "only the project Owner's own custom roles are
assignable" rule → Task 11's invite/member-role routes, which filter through
`listRolesByScope('project', ownerUserId)` rather than every role that exists.

**2. Placeholder scan** — no TBD/TODO in any step; every code block is complete, real code. One
genuine, deliberately-flagged limitation was found WHILE writing this plan (Task 15's `group_id`
column being shared rather than per-viewer) — this is not a placeholder, it's an honest documentation
of a real spec/schema tension discovered during planning, explicitly called out (not silently
"fixed" by unilaterally redesigning the schema beyond what the approved spec specifies) and routed
to the controller's own D-entry for a considered decision later.

**3. Type/interface consistency** — traced every function name across task boundaries: `db.
createUser`/`findUserByEmail`/`findUserById` (Task 1) are used unchanged by Tasks 5, 9, 10, 12, 16,
17. `db.SYSTEM_ROLE_IDS` (Task 3) is the one, unchanging source for role ids referenced in Tasks
11-18 — no task re-derives or hardcodes a role id string directly except via this constant. `db.
resolveProjectPermissions` (added to `rbac.js` in Task 11, since it needs `project_members` which
doesn't exist before then) is consumed identically by Task 11's own sharing routes and Task 13's
relay enforcement — same return shape (`Set<string>`) in both places. `db.createMachine(name,
ownerUserId)`'s Task-7 signature change is applied consistently everywhere it's called afterward
(Tasks 8, 11-18's tests, `cli.js`, `account.js`) — no task reverts to the old one-argument form.
Every new Fastify route file (`auth.js`, `sharing.js`, `admin.js`, `roles.js`, `groups.js`,
`account.js`) is mounted from `app.js` in its own task, and `app.js`'s final shape (after Task 17) is
never re-described wholesale in a later task — each task shows only the exact lines it adds, matching
how the file actually grows.

