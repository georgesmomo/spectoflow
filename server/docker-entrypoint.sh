#!/bin/sh
set -e
# Deliberate fail-fast duplicate: src/index.js also calls db.migrate() itself on every start, so this
# isn't strictly required — but running it here means an unreachable/misconfigured database fails
# fast with a clear "✓ migrations applied" (or error) message before the app even tries to start.
node cli.js migrate
exec node src/index.js
