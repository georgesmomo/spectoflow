# Deploying to cPanel / o2switch (no Docker)

> This guide is written from spectoflow-server's own documented behavior (`server/README.md`, its
> CLI's `--help` output, and its actual environment-variable handling in `server/src/index.js`) rather
> than tested against a live cPanel account. cPanel's own UI wording varies between hosts and cPanel
> versions — if a step below doesn't match what your host actually shows you, the discrepancy is
> almost certainly in cPanel's interface, not in what this application itself needs. The prerequisite
> in Step 0 is the one thing worth confirming with your host directly before starting.

## 0. Prerequisite: confirm your host offers Node.js ≥ 22

Not every cPanel host has this yet. Check under cPanel's "Setup Node.js App" section for the list of
available Node.js versions before proceeding — if only an older version is offered, contact your host
or choose a different one; there is no way to make this application run on an older Node version.

## 1. Create a MySQL database

In cPanel: **MySQL Databases** → create a new database, then create a new database user and add it to
that database with full privileges. Note down: the database name, username, and password cPanel shows
you (cPanel typically prefixes both the database and user names with your cPanel account's own
username — e.g. `youraccount_spectoflow` — copy the exact names cPanel actually created, not just what
you typed).

## 2. Upload the code

Get a copy of the `server/` folder from this repository onto your hosting account (via cPanel's File
Manager upload+extract, or `git clone` if your host's Terminal feature has git available) — anywhere
under your account's own file space works; note the full path, you'll need it in the next step.

## 3. Set up the Node.js application

In cPanel: **Setup Node.js App** → create a new application:
- **Node.js version**: ≥ 22 (per Step 0)
- **Application root**: the path to the `server/` folder from Step 2
- **Application URL**: the domain or subdomain you want this reachable at
- **Application startup file**: `src/index.js`

## 4. Set environment variables

Still inside the Node.js App's own settings screen, add these environment variables (cPanel provides
a form for this — no `.env` file needed here, unlike the Docker path):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `mysql://<db-user>:<db-password>@localhost/<db-name>` using the exact names cPanel created in Step 1 (cPanel-hosted MySQL is normally only reachable as `localhost` from your own account, not a remote host) |
| `BASE_URL` | `https://<your-domain>` — the same domain from Step 3's Application URL |
| `TRUST_PROXY` | `1` (cPanel's own web server sits in front of your Node app as a reverse proxy) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | credentials from a real transactional email provider — every verification/reset/invitation email goes through these |

Do **not** set `PORT` — cPanel's Node.js App feature assigns and manages the port itself.

## 5. Install dependencies

Back on the Node.js App's main screen, use the **"Run NPM Install"** button cPanel provides — this is
the equivalent of `npm ci` on the Docker path, done through cPanel's own UI instead.

## 6. (Optional) Run database migrations now, without waiting for Restart

You don't strictly need this step: `src/index.js` — the very file Step 3 set as the startup file —
calls `db.migrate()` itself, unconditionally, every time it starts, before it begins listening. So
migrations already run automatically whenever the app (re)starts, cPanel exactly like the Docker
path — restarting via Step 7 alone is enough to bring the schema up to date.

Running it here through Terminal is only a faster way to apply migrations right after a fresh
upload, without waiting for a full app restart — useful, for instance, to catch a migration error
early rather than finding out only when the app fails to come up in Step 7. Using cPanel's
**Terminal** feature (or SSH, if your host provides it) — make sure the shell has the environment
variables from Step 4 available (cPanel's Node.js App page provides a command to "Enter to the
virtual environment", which also loads them; otherwise set `DATABASE_URL` inline for this one
command):

```bash
cd <application root from Step 3>
node cli.js migrate
```

Expected output: `✓ migrations applied`. Safe to run at any time, including when nothing has
changed — migrations are idempotent, and this is the exact same `db.migrate()` call `index.js`
already makes on every startup, just triggered manually and earlier.

## 7. Start (or restart) the application

Back on the Node.js App's main screen, click **Restart** — this runs migrations automatically as
part of `src/index.js` starting up (see Step 6), so it alone is enough even if you skipped Step 6.
Visit `https://<your-domain>/healthz` — you should see `{"ok":true}`.

## 8. Create the first account, then connect a machine

Same as the Docker path: visit `https://<your-domain>/signup` (the first account ever created becomes
Platform Admin automatically). Unless you want this instance open to public signups, go to `/admin`
and set Signup mode to `invite_only` or `disabled` — a fresh instance defaults to `open`, meaning
anyone who finds the URL can create an account. Then use the **Account page** (`/account`, once
signed in) to create a machine token, then from the machine you want to publish projects from:

```bash
spectoflow dashboard login --url=https://<your-domain> --token=<the token just created>
spectoflow dashboard publish
```

If the connection keeps dropping or never shows as connected, cPanel's proxy may not be passing
WebSocket upgrades through — add `--transport=http` to the `spectoflow dashboard login` command to
skip the WebSocket attempt entirely and use HTTP long-polling instead.

## Updating later

Re-upload the changed files (Step 2), re-run "Run NPM Install" if dependencies changed (Step 5), then
Restart the app (Step 7) — migrations run automatically as part of that restart, same mechanism as
Step 6/7 above, so there is no separate migration step to remember. Running `node cli.js migrate` via
Terminal first (Step 6) is still fine and always safe, even if nothing changed — it's just optional,
not required.
