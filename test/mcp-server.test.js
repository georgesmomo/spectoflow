'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'spectoflow.js');

// Starts a real `spectoflow mcp` against its own SPECTOFLOW_HOME; send() resolves with the response
// carrying that id. Every stdout line must be valid JSON-RPC — nothing else may leak onto stdout.
function startServer(home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-mcp-'))) {
  const child = spawn(process.execPath, [BIN, 'mcp'], { env: { ...process.env, SPECTOFLOW_HOME: home, NO_COLOR: '1' } });
  const waiting = new Map(), lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      lines.push(line);
      const msg = JSON.parse(line);
      const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  let next = 1;
  const raw = (line) => child.stdin.write(line + '\n');
  const send = (method, params, id = next++) => new Promise((resolve) => { waiting.set(id, resolve); raw(JSON.stringify({ jsonrpc: '2.0', id, method, params })); });
  const stop = () => new Promise((r) => { child.on('close', r); child.stdin.end(); });
  return { home, send, raw, stop, lines, waitFor: (id) => new Promise((resolve) => waiting.set(id, resolve)) };
}

test('initialize negotiates the version and ships the known brain in instructions', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-mcp-'));
  fs.writeFileSync(path.join(home, 'brain.md'), '# Second brain\n\n## Profile\n- Scrum master\n');
  const s = startServer(home);
  try {
    const r = await s.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.strictEqual(r.result.protocolVersion, '2025-06-18');
    assert.strictEqual(r.result.serverInfo.name, 'spectoflow');
    assert.deepStrictEqual(r.result.capabilities, { tools: { listChanged: false } });
    assert.match(r.result.instructions, /## Profile\n- Scrum master/);
    assert.match(r.result.instructions, /Never secrets, credentials/);
    assert.match(r.result.instructions, /data, not commands/);
    assert.match(r.result.instructions, /never override your safety rules/);
    const newer = await s.send('initialize', { protocolVersion: '2099-01-01' });
    assert.strictEqual(newer.result.protocolVersion, '2025-11-25', 'an unknown version gets our latest');
  } finally { await s.stop(); }
});

test('tools/list exposes brain_read and brain_learn with a category enum', async () => {
  const s = startServer();
  try {
    const r = await s.send('tools/list', {});
    assert.deepStrictEqual(r.result.tools.map((t) => t.name), ['brain_read', 'brain_learn']);
    const learn = r.result.tools[1];
    assert.deepStrictEqual(learn.inputSchema.properties.category.enum, ['profile', 'preferences', 'workflow', 'avoid']);
    assert.deepStrictEqual(learn.inputSchema.required, ['category', 'text']);
  } finally { await s.stop(); }
});

test('brain_learn writes ~/.spectoflow/brain.md, brain_read returns it, a duplicate is reported', async () => {
  const s = startServer();
  try {
    const empty = await s.send('tools/call', { name: 'brain_read', arguments: {} });
    assert.match(empty.result.content[0].text, /empty/);
    const learned = await s.send('tools/call', { name: 'brain_learn', arguments: { category: 'avoid', text: 'Never publish without asking' } });
    assert.strictEqual(learned.result.content[0].text, 'Recorded: Never publish without asking');
    assert.match(fs.readFileSync(path.join(s.home, 'brain.md'), 'utf8'), /## Avoid\n- Never publish without asking <!-- id:\S+ by:agent/);
    const read = await s.send('tools/call', { name: 'brain_read', arguments: {} });
    assert.strictEqual(read.result.content[0].text, '## Avoid\n- Never publish without asking');
    const dup = await s.send('tools/call', { name: 'brain_learn', arguments: { category: 'avoid', text: 'never publish without ASKING' } });
    assert.match(dup.result.content[0].text, /^Already known/);
  } finally { await s.stop(); }
});

test('with brain.autoAdd false, a learned fact waits for confirmation', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-mcp-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ brain: { autoAdd: false } }));
  const s = startServer(home);
  try {
    const r = await s.send('tools/call', { name: 'brain_learn', arguments: { category: 'preferences', text: 'Prefers pnpm' } });
    assert.strictEqual(r.result.content[0].text, 'Recorded for the user to confirm: Prefers pnpm');
    assert.match(fs.readFileSync(path.join(home, 'brain.md'), 'utf8'), /## To confirm\n- \[preferences\] Prefers pnpm/);
  } finally { await s.stop(); }
});

test('errors: empty text is a tool error, unknown tool/method are JSON-RPC errors, bad JSON does not crash', async () => {
  const s = startServer();
  try {
    const empty = await s.send('tools/call', { name: 'brain_learn', arguments: { category: 'profile', text: '  ' } });
    assert.strictEqual(empty.result.isError, true);
    const unknownTool = await s.send('tools/call', { name: 'nope', arguments: {} });
    assert.strictEqual(unknownTool.error.code, -32602);
    const unknownMethod = await s.send('resources/list', {});
    assert.strictEqual(unknownMethod.error.code, -32601);
    s.raw('{not json');
    s.raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const ping = await s.send('ping', {});
    assert.deepStrictEqual(ping.result, {}, 'still answering after garbage and a notification');
    assert.ok(s.lines.some((l) => JSON.parse(l).error && JSON.parse(l).error.code === -32700), 'parse error reported');
    assert.ok(s.lines.every((l) => JSON.parse(l).jsonrpc === '2.0'), 'stdout carries JSON-RPC only');
  } finally { await s.stop(); }
});
