# NOTE: build context is the repo root, not server/ — see the "docker build" invocation below.
# server/src/app.js (static front-end) and server/src/relay.js (route table) both intentionally
# reach outside server/ into the repo-root lib/dashboard/ (D65: server/ shares the front-end and
# route table with the local hub, never duplicates them) via relative requires like
# require('../../lib/dashboard/routes') from server/src/relay.js — two levels up from server/src
# lands on the repo root. To keep that relative path resolving correctly, the image mirrors the
# same two-level nesting: app files live under /app/server (not flattened into /app), and the
# shared lib/dashboard/{routes.js,public/} are copied to /app/lib/dashboard — a Docker build
# context can't COPY from outside itself, so those shared paths must be reachable from the
# context root too.

# ---- deps stage: install dependencies from the committed lockfile only ----
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- final stage: copy only what's needed to run, nothing from the deps stage's build cache ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json server/cli.js server/knexfile.js ./
COPY server/migrations ./migrations
COPY server/src ./src
COPY server/docker-entrypoint.sh ./
COPY lib/dashboard/routes.js /app/lib/dashboard/routes.js
COPY lib/dashboard/public /app/lib/dashboard/public
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
