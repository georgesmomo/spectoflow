'use strict';
/*
 * Shared spectoflow ASCII brand — used by the CLI (bin/spectoflow.js) and the postinstall welcome
 * (bin/postinstall.js). The hexagon mark is drawn WHITE; the compact figlet wordmark is drawn AMBER
 * and centred under the mark. Callers pass their own colouriser `c` (with .white/.amber/.dim) and the
 * version string, so this stays presentation-agnostic and zero-dependency.
 */
const LOGO = [
  '                  ########',
  '               ######  #######',
  '           #######         ######',
  '         ######               ######',
  '      ######          ####       ######',
  '    #####          ######           ####',
  '    ####         ######               ####',
  '    ####       #####                  ####',
  '    ####      ####       ##           ####',
  '    ####      ####    #########       ####',
  '    ####      #### ####### #####      ####',
  '    ####       ########      ###      ####',
  '    ####          ##         ###      ####',
  '    ####                    ####      ####',
  '    ####                 ######       ####',
  '    ####              ######          ####',
  '    ####          ######            ####',
  '     ######       ###            ######',
  '        ######                ######',
  '           ######          ######',
  '              ######    ######',
  '                 ##########',
  '                    ####',
];
const NAME = [
  '                  _        __ _',
  '  ____ __  ___ __| |_ ___ / _| |_____ __ __',
  " (_-< '_ \\/ -_) _|  _/ _ \\  _| / _ \\ V  V /",
  ' /__/ .__/\\___\\__|\\__\\___/_| |_\\___/\\_/\\_/',
  '    |_|',
];
const NAME_W = Math.max(...NAME.map((l) => l.length));
const TAGLINE = 'agent-agnostic spec-driven development · real-time control plane';
const INDENT = '  ';

// Amber wordmark; when `centerUnder`, centred beneath the hexagon's true horizontal midpoint.
function nameBlock(c, centerUnder) {
  let pad = INDENT;
  if (centerUnder) {
    let lo = Infinity, hi = 0;
    for (const l of LOGO) { const i = l.search(/#/); if (i >= 0) { lo = Math.min(lo, i); hi = Math.max(hi, l.length - 1); } }
    pad = ' '.repeat(Math.max(0, Math.round(INDENT.length + (lo + hi) / 2 - NAME_W / 2)));
  }
  return NAME.map((l) => pad + c.amber(l)).join('\n');
}
// White hexagon + centred amber wordmark + version. For init, update and the install welcome.
function logo(c, version) {
  const art = LOGO.map((l) => INDENT + c.white(l)).join('\n');
  return `\n${art}\n\n${nameBlock(c, true)}\n\n${INDENT}${c.dim('v' + version + ' · ' + TAGLINE)}\n`;
}
// Just the amber wordmark + version. For help and the explore commands.
function wordmark(c, version) {
  return `\n${nameBlock(c, false)}\n\n${INDENT}${c.dim('v' + version + ' · ' + TAGLINE)}\n`;
}

module.exports = { LOGO, NAME, TAGLINE, logo, wordmark };
