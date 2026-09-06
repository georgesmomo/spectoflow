#!/usr/bin/env node
'use strict';
/*
 * Admin CLI for the online dashboard server — machine tokens and migrations. C1 has no accounts yet
 * (C2 moves token creation into the UI), so this is the only way to onboard a machine: create a
 * token here, hand it to whoever runs `spectoflow dashboard login` on that machine.
 */
const { createDb } = require('./src/db');
const argv = process.argv.slice(2);
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || undefined;

async function main() {
  const [cmd, sub] = argv;
  const db = await createDb(process.env.DATABASE_URL);
  try {
    if (cmd === 'migrate') { await db.migrate(); console.log('✓ migrations applied'); return; }
    if (cmd === 'token' && sub === 'create') {
      const name = flag('name');
      const ownerEmail = flag('owner-email');
      if (!name || !ownerEmail) { console.error('Usage: node cli.js token create --name="laptop" --owner-email="you@example.com"'); process.exitCode = 1; return; }
      const owner = await db.findUserByEmail(ownerEmail);
      if (!owner) { console.error(`! no account found with email "${ownerEmail}" — create the account first (via the web /signup page), then run this again.`); process.exitCode = 1; return; }
      const m = db.createMachine(name, owner.id); await m.ready;
      console.log(`✓ machine "${name}" created — id ${m.id}`);
      console.log(`  token (shown once, store it now):\n\n  ${m.token}\n`);
      return;
    }
    if (cmd === 'token' && sub === 'list') {
      const rows = await db.listMachines();
      if (!rows.length) return console.log('no machines yet');
      rows.forEach((r) => console.log(`${r.id}  ${r.name.padEnd(24)}  ${r.revoked_at ? 'revoked' : 'active '}  last seen ${r.last_seen || 'never'}`));
      return;
    }
    if (cmd === 'token' && sub === 'revoke') {
      const id = argv[2];
      if (!id) { console.error('Usage: node cli.js token revoke <machine-id>'); process.exitCode = 1; return; }
      console.log((await db.revokeMachine(id)) ? `✓ revoked ${id}` : `! no active machine with id ${id}`);
      return;
    }
    console.log('Usage: node cli.js migrate | token create --name=<n> | token list | token revoke <id>');
    process.exitCode = 1;
  } finally { await db.destroy(); }
}
main();
