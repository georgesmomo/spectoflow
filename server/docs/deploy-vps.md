# Deploying to a VPS (Docker)

Assumes a fresh Ubuntu or Debian VPS with a domain's DNS `A` record already pointed at its IP address.

## 1. Install Docker

Follow Docker's own official install instructions for your distribution:
https://docs.docker.com/engine/install/ — this includes the Docker Compose plugin (`docker compose`,
no separate install needed on a recent Docker install).

## 2. Clone this repository

```bash
git clone https://github.com/georgesmomo/spectoflow.git
cd spectoflow
```

A full clone, not just the `server/` folder — `server/` isn't a self-contained deployable unit. Its
application code (`server/src/relay.js`, `server/src/app.js`) intentionally reaches outside `server/`
into the repo-root `lib/dashboard/` directory to reuse the exact same front-end and route table the
local hub uses, rather than duplicating them (see `../docs/online-dashboard-connector-design.md`).
The Docker build reflects this: its context is the whole repo root (`docker-compose.yml`'s `build:
{context: ., dockerfile: server/Dockerfile}`), not `server/` alone, so it can `COPY` those shared
`lib/dashboard/` paths into the image. Cloning the full repo keeps everything the build needs on disk
together, exactly as it is in this repository.

## 3. Configure your environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and fill in every `CHANGE_ME` value:
- `DOMAIN` and `BASE_URL` — your real domain (e.g. `dashboard.example.com` / `https://dashboard.example.com`).
  **These two must point at the same hostname** — the file's own comment explains why.
- `MYSQL_PASSWORD` — a real, random password. Copy the exact same value into `DATABASE_URL`'s
  connection string (replacing the `CHANGE_ME` right after `spectoflow:`). `DATABASE_URL` is parsed as
  a URL, so use only letters and digits (no `@ : / ? #`) in the password, or percent-encode it if it
  must contain one of those characters.
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` — credentials from a real transactional
  email provider (e.g. Postmark, SES, Mailgun, SendGrid). Every account signup, password reset, and
  project invitation this server ever sends goes through these.

## 4. Start everything

```bash
docker compose up -d --build
```

This builds the application image, starts MySQL (creating its database on first boot), waits for
MySQL to report healthy, then starts the app (which runs its own database migrations automatically
before serving traffic), then starts Caddy, which requests a free TLS certificate from Let's Encrypt
for your domain automatically.

## 5. Confirm it's up

```bash
docker compose logs -f server
```

Watch for `spectoflow server → http://0.0.0.0:3000`, then Ctrl+C out of the logs. Visit
`https://<your-domain>/healthz` in a browser or via `curl` — you should see `{"ok":true}`. This
confirms Caddy's TLS handshake succeeded and the application itself is responding.

## 6. Create the first account

Visit `https://<your-domain>/signup` and create an account — the very first account ever created on
a fresh instance automatically becomes Platform Admin.

Unless you want this instance open to public signups, go to `/admin` and set Signup mode to
`invite_only` or `disabled` — a fresh instance defaults to `open`, meaning anyone who finds the URL
can create an account.

## 7. Connect a machine

From the computer you actually want to publish spectoflow projects from (not necessarily the VPS
itself): sign in at `https://<your-domain>/login`, go to `/account`, and use "Create token" under
Machine tokens — this is the same flow documented in the main project README. Then, on that machine
(replacing `YOUR-DOMAIN` and `YOUR-TOKEN` with your actual domain and the token you just created):

```bash
spectoflow dashboard login --url=https://YOUR-DOMAIN --token=YOUR-TOKEN
spectoflow dashboard publish   # from inside the project you want to make visible online
```

(The CLI (`docker compose exec server node cli.js token create --name="..." --owner-email="..."`) is
also available as a fallback if you'd rather not use the web UI for this — the account must already
exist via `/signup` first, since machine tokens are always owned by a real account.)

## Updating later

```bash
git pull
docker compose up -d --build
```

Migrations re-run automatically and safely on the new container's start — there is no separate
migration step to remember.

## Troubleshooting

- **Caddy can't get a certificate**: confirm your domain's DNS `A` record actually points at this
  VPS's IP address, and that ports 80 and 443 are open in any firewall/security-group in front of the
  VPS (Let's Encrypt's automatic verification needs port 80 reachable from the public internet, even
  though the final site is served over 443).
- **`server` container keeps restarting**: `docker compose logs server` — a `BASE_URL must be set`
  error means `server/.env` wasn't filled in before `docker compose up`; a migration error means
  `DATABASE_URL`'s password doesn't match `MYSQL_PASSWORD` (both must be identical, see step 3 above).
