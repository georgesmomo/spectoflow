#!/usr/bin/env node
'use strict';
/*
 * Printed after `npm install -g spectoflow`: the brand welcome + first steps.
 * Guarded to a GLOBAL, interactive (TTY) install so it never spams CI, dependency installs, or logs,
 * and wrapped so a banner can never fail an install. Note: npm may buffer lifecycle-script output —
 * if it doesn't appear, `spectoflow` (no args) and `spectoflow init` show the same brand.
 */
try {
  if (process.env.npm_config_global === 'true' && process.stdout.isTTY) {
    const brand = require('../lib/brand');
    const version = require('../package.json').version;
    const useColor = !process.env.NO_COLOR;
    const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
    const c = { white: paint('97'), amber: paint('38;5;179'), dim: paint('2'), bold: paint('1'), g: paint('32') };
    process.stdout.write(brand.logo(c, version));
    process.stdout.write(`\n  ${c.bold('Get started')}\n`);
    process.stdout.write(`    ${c.g('spectoflow init')}      scaffold a project in the current folder\n`);
    process.stdout.write(`    ${c.g('spectoflow --help')}    all commands\n\n`);
  }
} catch { /* never break an install over a welcome banner */ }
