'use strict';
/*
 * DATABASE_URL → Knex config. MySQL is the default deployment target (spec decision); SQLite is what
 * the test suite and local dev use (file or :memory:); PostgreSQL is the third supported driver.
 * Recognized schemes: mysql://…, postgres:// (or postgresql://), sqlite:<path-or-:memory:>.
 */
const path = require('path');

function fromUrl(databaseUrl) {
  const url = databaseUrl || 'mysql://spectoflow:spectoflow@localhost/spectoflow';
  const migrations = { directory: path.join(__dirname, 'migrations') };
  if (url.startsWith('sqlite:')) {
    const file = url.slice('sqlite:'.length);
    return { client: 'better-sqlite3', useNullAsDefault: true, connection: file === ':memory:' ? ':memory:' : { filename: file }, pool: { min: 1, max: 1 }, migrations };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return { client: 'pg', connection: url, migrations };
  if (url.startsWith('mysql://')) return { client: 'mysql2', connection: url, migrations };
  throw new Error(`Unrecognized DATABASE_URL scheme: "${url}" (expected mysql://, postgres:// or sqlite:)`);
}

module.exports = { fromUrl };
