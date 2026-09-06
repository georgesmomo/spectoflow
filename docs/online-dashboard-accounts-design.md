# Online dashboard, part 2: accounts, sessions & sharing (sub-project C2, merged with C3) — design

**Status:** approved by user, section-by-section, 2026-09-06. Implementation via `writing-plans`.

## Program context

The "one dashboard, many projects" program (`docs/dashboard-separation-design.md`, table at the
top) has: **A** dashboard separation (shipped, v0.24.0, D64), **B** smart add (not started), **C**
online dashboard — **C1** relay + connector (shipped, v0.25.0, D65), **C2** accounts/sessions, **C3**
sharing (members, project groups) — **D** theme redesign (shipped, v0.26.0, D66), **C4** ops
(deferred). This document was originally scoped as C2 alone; during brainstorming the user
explicitly chose to **merge C2 and C3 into one sub-project** (real roles/permissions from the start,
covering both platform-wide and per-project scope, plus project groups) rather than build a
throwaway admin-flag model first. For the rest of this document, "C2" refers to this merged scope;
C3 as a separate deliverable no longer exists. C4 (Docker, cPanel/VPS runbooks, backups) is
unaffected and remains a later, separate step.

C1's own design doc anticipated this shape (§"What C1 prepares for the rest"): *"C2 —
`machines.token_hash` becomes `user_tokens`; the signed access-key cookie becomes a real session
row; `/login` becomes sign-in/sign-up; the token CLI moves into the UI."* *"C3 — `projects.id`
(server ids) are what memberships and groups attach to."* Both are delivered here, together.

The user's original request for the whole of C, verbatim: *"chacun doit pouvoir créer son compte,
ajouter ses projets, ajouter les gens (qui ont des comptes) au projet avec des droits, organiser ses
projets en groupe, ... bref le plus complet possible."* Confirmed during this brainstorming pass:
**a real, unified roles-and-permissions engine** — not a hardcoded admin flag — covering both
platform-wide capabilities (who can change the signup mode, manage accounts) and per-project
capabilities (who can read/write/manage members on a specific project), with **fully customizable
roles at both scopes**, reusable across all of an account's own projects.

## Goals

1. Real user accounts (email + password) replace the single shared `SPECTOFLOW_ACCESS_KEY` entirely.
2. Real, revocable, per-device sessions (a `sessions` table) replace the current stateless
   HMAC-signed cookie — a user sees every active session (device/IP/last-seen) and can revoke any
   one individually.
3. One unified roles → permissions engine, with a `scope` of `platform` or `project`, covering:
   - **Platform scope**: a system "Platform Admin" role (can change the signup mode, manage/promote
     accounts) plus the ability to define further custom platform roles.
   - **Project scope**: four system roles (Owner/Admin/Editor/Viewer) plus the ability for any
     account to define its own custom project roles, reusable across all of that account's projects.
4. Email-driven flows: address verification (non-blocking — the account works immediately),
   self-service password reset, and project invitations (a pending invite the recipient accepts by
   email; if they have no account yet, they're prompted to create one as part of accepting).
5. Project membership: an owner can invite any other account (existing or not-yet-existing, by
   email) onto a project with a specific role; the relay enforces that role's permissions on every
   `/api/*` request, replacing today's "any valid cookie can do anything."
6. Machine tokens move from an admin CLI to the web UI (`server/cli.js token create|list|revoke`
   remains as an admin/scripting fallback, no longer the primary path).
7. Flat project groups: each project belongs to zero or one group, purely a personal organizational
   view for the owning account — never affects access rights.
8. The platform admin can flip a global signup mode: `open` (default) / `invite_only` / `disabled`.

## Non-goals (explicitly deferred)

- Nested project groups or multi-group (tag-style) membership — flat, one group per project, per
  the user's own choice.
- SSO/OAuth login, 2FA — not requested; email+password only for now.
- Real production email deliverability concerns (SPF/DKIM/reputation) — an operational concern for
  C4, not this sub-project's code.
- Migrating any existing real deployment's data — confirmed with the user: nothing real exists yet
  to preserve; this is a clean schema evolution, not a data migration.
- Billing/plans/usage limits — never requested, out of scope entirely.
- A generic, drag-and-drop role/permission *builder UI framework* beyond a straightforward
  checkbox-list editor — the one editor component is reused for both platform- and project-scope
  roles (it's scope-aware, not two separate UIs), but it's a plain list of permission checkboxes, not
  a visual designer.

## Design

### 1. Architecture and the authentication mechanism

This stays inside `server/` (Fastify + Knex, already a real application with dependencies since
C1) — a separate auth microservice would be pure over-engineering for one self-hosted process.
`server/src/auth.js` (today: one shared key → a stateless signed cookie) is replaced by real
server-side sessions:

- **Session mechanism**: an opaque random token (same shape as today's machine tokens — `spf_` +
  32 random bytes, base64url), stored **hashed** (SHA-256, same pattern as `machines.token_hash`) in
  a new `sessions` table, with per-session metadata (`user_agent`, `ip`, `created_at`,
  `last_seen_at`, `revoked_at`). The `spf_session` cookie carries the plaintext token; only its hash
  ever touches the database. This is what makes the requested "see every active session, revoke any
  one" feature possible — a stateless JWT could not support real per-session revocation without
  reinventing a blocklist table, so a real sessions table is simply correct here, not a Y-A-G-N-I
  violation.
- **Passwords**: `argon2id` (current OWASP-recommended default), a new npm dependency in
  `server/package.json` (`argon2`).
- **`SPECTOFLOW_ACCESS_KEY`** is removed entirely — no code path reads it any more.
- **`--insecure-dev`**: unchanged in spirit (binds `127.0.0.1` only, a loud console warning) but its
  meaning narrows now that there's no single key to skip: it only relaxes the session cookie's
  `Secure` attribute (so `http://localhost` works without TLS) — signup/login are otherwise the real
  flow, real accounts, real passwords. No dev bypass account is invented.

### 2. Data model

New Knex migrations under `server/migrations/`, in dependency order:

- **`users`**: `id` (same `randomId(8)` shape as `machines.id`), `email` (unique, citext-equivalent
  — stored lowercased), `password_hash`, `email_verified_at` (nullable timestamp), `created_at`,
  `last_login_at` (nullable).
- **`permissions`**: a fixed, code-defined catalog (seeded by a migration, never editable through
  the UI) — `id`, `key` (e.g. `platform.manage_signup`), `scope` (`platform` | `project`), `label`.
  Exact catalog:
  - Platform scope: `platform.manage_signup` (flip the signup mode), `platform.manage_users`
    (promote/demote/suspend any account), `platform.manage_roles` (create/edit platform-scope
    custom roles), `platform.view_all_projects` (see every machine/project on the instance,
    published or not).
  - Project scope: `project.read` (view board/tasks/files, subscribe to SSE), `project.write`
    (add/edit tasks, run/orchestrate agents, chat, write files), `project.manage_settings` (agent/
    mode/language/design config), `project.manage_members` (invite/remove members, change their
    role on this project).
- **`roles`**: `id`, `scope` (`platform` | `project`), `owner_user_id` (nullable — `null` for the
  system-provided roles below; the creating account's id for a custom role), `name`, `is_system`
  (blocks deletion/edits of the system rows). Seeded system rows:
  - Platform: **Platform Admin** — all 4 platform permissions.
  - Project: **Owner** and **Admin** both hold all 4 project permissions (`read`/`write`/
    `manage_settings`/`manage_members`) — the catalog has no 5th "ownership" permission to
    distinguish them by permission alone. What actually distinguishes Owner is protected *status*,
    not a broader permission set: exactly one Owner member exists per project (the account that owns
    the machine that published it, inserted automatically — see §4), and that membership row can
    never be changed or removed through `project.manage_members` by anyone, Owner included — only
    unpublishing the project locally (the existing CLI flow) removes it. Admin is a real, second
    "full control" role for a project owner to hand to a trusted collaborator, whose membership
    (unlike Owner's) an Owner or another Admin can freely change or revoke. **Editor** —
    `project.read`/`project.write`; **Viewer** — `project.read` only.
  - A custom role (either scope) is created once by an account and is usable across every project
    that account owns/administers — creating one is an account-level action (no project context
    needed yet); *assigning* it to a member on a specific project requires `project.manage_members`
    on that project. The role picker in a project's Members panel offers only the 4 system roles
    plus custom project-scope roles **owned by that project's Owner account** — never every custom
    role that exists on the instance — so an Admin member can assign roles the Owner has already
    defined, but never invent visibility into an unrelated account's private role vocabulary.
- **`role_permissions`**: `role_id`, `permission_id` (join table).
- **`user_platform_roles`**: `user_id`, `role_id` — a user can hold zero or more platform-scope
  roles (in practice: none, or Platform Admin).
- **`project_members`**: `project_id` (references `projects.id`), `user_id`, `role_id` (a
  project-scope role). Publishing a project (existing `POST /connector/frames` `hello` flow from
  C1) auto-inserts the publishing machine's owning account as an **Owner** member of that project —
  see §4.
- **`project_invitations`**: `id`, `project_id`, `email` (the invitee, may not have an account yet),
  `role_id`, `invited_by_user_id`, `token_hash`, `expires_at` (72h), `accepted_at` (nullable).
- **`project_groups`**: `id`, `owner_user_id`, `name`. `projects` gains a nullable `group_id` FK.
- **`sessions`**: `id`, `user_id`, `token_hash` (unique), `user_agent`, `ip`, `created_at`,
  `last_seen_at`, `revoked_at` (nullable).
- **`password_reset_tokens`**: `user_id`, `token_hash`, `expires_at` (1h), `used_at` (nullable).
- **`email_verification_tokens`**: `user_id`, `token_hash`, `expires_at` (24h), `used_at` (nullable).
- **`platform_settings`**: a single-row key/value table (or a one-row table with named columns —
  implementation's choice, functionally: `signup_mode` = `open` (default) | `invite_only` |
  `disabled`), editable only by `platform.manage_signup`.
- **`machines`** gains `owner_user_id` (FK to `users`, NOT NULL going forward — every machine token
  is now created by, and belongs to, exactly one account).

### 3. Email and user-facing flows

- **SMTP**: configurable via env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM`), a new `nodemailer` dependency (the unsurprising standard choice). Under
  `--insecure-dev` with no SMTP host configured, emails are logged to the console instead of sent,
  so local development never blocks on real SMTP.
- **`POST /signup`** `{email, password}` → creates the account (usable immediately — verification is
  non-blocking, per the user's choice), sends a verification email in parallel (link valid 24h).
  Refused (400) if `platform_settings.signup_mode` is `disabled`, or `invite_only` and no valid
  `project_invitations` token was supplied in the request (an invite accepted by a not-yet-existing
  account routes through signup first, then auto-accepts the invite once the account exists).
  **Bootstrap**: if this is the very first account ever created (`users` table was empty), it is
  automatically granted the **Platform Admin** role — no separate bootstrap step or env var needed.
- **`POST /login`** replaces today's key-only version: `{email, password}` → verify the argon2id
  hash → create a `sessions` row → set the cookie. Rate-limited identically to today's `/login`
  (10/15min), extended to `/signup` and the password-reset request endpoint.
- **`POST /password-reset/request`** `{email}` → always 200 (never reveals whether the email
  exists), emails a link if it does. **`POST /password-reset/confirm`** `{token, newPassword}` →
  updates the hash and **revokes every existing session** for that account (standard practice: a
  password reset should also kick out anyone who had a stale session, e.g. after a suspected leak).
- **`POST /api/projects/:id/invite`** `{email, roleId}` (requires `project.manage_members` on that
  project) → creates a `project_invitations` row, emails the link. Accepting
  (`GET /invitations/:token` → confirm) inserts the `project_members` row; if the email has no
  account yet, the flow detours through `/signup` first (pre-filling the email, skipping the
  `invite_only` gate since arriving via a valid invitation token already proves invited status),
  then completes the accept.

### 4. UI and permission enforcement

- `server/src/auth.js`'s `/login` becomes a real email+password form; a new `/signup` page appears
  alongside it. A new **Account** page: profile, change password, email-verification status (+
  resend), and the **session list** (device/IP/last-seen, a revoke button per row). A new
  **Machines** page creates/revokes machine tokens directly in the UI (the CLI stays as a fallback).
- A new **Admin** page (visible only with `platform.manage_signup` or `platform.manage_users`):
  toggle the signup mode, list accounts, manage platform roles.
- Per project: a **Members** panel (invite by email + role, list/remove members, change role) and a
  **role editor** (create/edit a custom role — a plain checkbox list against the fixed permission
  catalog for that scope; the same component serves both platform- and project-scope roles).
- The hub landing page (`hub.html`) gains **groups**: create/rename/delete a group, assign a project
  to one — purely personal, never affects access.
- **`GET /api/hub/projects` narrows from "every published project on the instance" (C1's
  single-shared-key model, correct then) to "every project the requesting session's account is a
  member of"** — a real, necessary behavior change now that multiple distinct accounts exist on one
  server; each account's hub only ever lists their own memberships, plus their own `project_groups`
  for personal organization. An account with `platform.view_all_projects` gets an explicit, separate
  "Admin → all projects" view (not a change to the default hub listing itself — see the enforcement
  note below).
- **Enforcement**: `server/src/relay.js` (translates a browser request into an `op` frame for the
  owning machine) now resolves, before anything else, the requesting session's effective
  project-scope permissions for the targeted project (via `project_members` → `roles` →
  `role_permissions`) and checks the specific permission each `op` requires — 403 if insufficient,
  replacing today's "any valid cookie may do anything." A user who is not a member of a project at
  all gets 404 (indistinguishable from unpublished/nonexistent — the C1 pattern already established
  for unpublished projects extends naturally to "not a member") — **except** a user holding the
  platform-scope `platform.view_all_projects` permission, who gets read-only (`project.read`)
  visibility into every published project on the instance regardless of membership, for admin
  oversight/support; it grants no write permission on projects the account isn't otherwise a member
  of, and does not affect the hub listing's per-account scoping (an admin still sees only their own
  projects on the default hub view — `platform.view_all_projects` is a fallback the relay consults,
  not a change to what's listed by default).
- **Errors**: 401 = not authenticated at all (no/expired/revoked session); 403 = authenticated but
  lacking the specific permission this project/operation requires — a meaningful distinction the
  front-end surfaces differently (401 → redirect to `/login`; 403 → an inline "you don't have
  permission to do that" message, since the user IS correctly logged in).

### 5. Testing

`server/test/` gains: unit tests for the permission-resolution helper (given a user + project,
what's their effective permission set — covering system roles, a custom role, and "not a member at
all"); integration tests for the full signup→verify→login and invite→accept flows; a real
end-to-end test in the spirit of C1's own (`server/test/e2e.test.js`) that creates two real
accounts, publishes a project from a real spawned local hub, invites the second account as
**Viewer**, and confirms a read succeeds while a write attempt gets a real 403 — over a real running
server, not mocked permission logic. All on SQLite, matching every existing `server/test/` file.
Root `npm test` is untouched (no `lib/`, `bin/`, or `templates/` code changes — this sub-project is
entirely inside `server/`).

## What this prepares for (and deliberately does not build)

- **C4** (ops/deployment) is unaffected by this document — the server remains one 12-factor
  process; nothing here changes how it's packaged or deployed.
- A future "organizations/teams" concept (a group of *users*, not projects) was never requested and
  isn't implied by anything here — if it comes up later, `roles`' `scope` column already
  demonstrates the pattern for adding a third scope without redesigning the engine.
