'use strict';
/*
 * The install manifest — `.spectoflow/.manifest.json`. Records the kit version and a sha256 of every
 * framework-owned file as it was installed. `update` compares the on-disk hash against this baseline
 * to tell "untouched framework file" (safe to refresh) from "user-edited" (preserve, drop a .new).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_NAME = '.manifest.json';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// { relPath: sha256 } for each file, read relative to baseDir.
function hashFileMap(baseDir, relFiles) {
  const map = {};
  for (const rel of relFiles) {
    map[rel] = sha256(fs.readFileSync(path.join(baseDir, rel.split('/').join(path.sep))));
  }
  return map;
}

function writeManifest(spectoflowDir, data) {
  fs.writeFileSync(path.join(spectoflowDir, MANIFEST_NAME), JSON.stringify(data, null, 2) + '\n');
}

function readManifest(spectoflowDir) {
  const fp = path.join(spectoflowDir, MANIFEST_NAME);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

module.exports = { sha256, hashFileMap, writeManifest, readManifest, MANIFEST_NAME };
