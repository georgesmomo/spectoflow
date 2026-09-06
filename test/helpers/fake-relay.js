'use strict';
/*
 * A stand-in for server/ for the spectoflow-side tests — zero-dep, node:http only. Implements just
 * enough of RFC 6455 to talk to Node's native WebSocket client (handshake, masked text frames in,
 * unmasked text frames out, close frames), plus the HTTP fallback endpoints. Records every upward
 * frame (tagged with the transport it came through), lets a test push downward frames and wait for
 * a frame of a given type.
 */
const http = require('http');
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeFrames(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.subarray(p, p + 4); p += 4; }
    if (p + len > buf.length) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    frames.push({ opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}
function encodeText(str) {
  const data = Buffer.from(str, 'utf8'); const len = data.length; let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}
function closeFrame(code, reason) {
  const r = Buffer.from(reason || '', 'utf8'); const body = Buffer.alloc(2 + r.length);
  body.writeUInt16BE(code, 0); r.copy(body, 2);
  return Buffer.concat([Buffer.from([0x88, body.length]), body]);
}

async function startFakeRelay({ token = 'spf_test', pollHold = 150, authOk = true } = {}) {
  const relay = { token, machineId: 'm1', frames: [], sockets: [], outbox: [], waiters: [], upgrades: 0, httpPosts: 0, httpPolls: 0, rejectUpgrade: false };
  const subs = new Set();
  const record = (frame, via) => { const entry = { ...frame, via }; relay.frames.push(entry); for (const s of [...subs]) s(entry); };
  relay.waitFor = (type, { timeout = 5000, after = 0 } = {}) => new Promise((resolve, reject) => {
    const found = relay.frames.slice(after).find((f) => f.type === type);
    if (found) return resolve(found);
    const t = setTimeout(() => { subs.delete(sub); reject(new Error(`no "${type}" frame within ${timeout}ms (got: ${relay.frames.map((f) => f.type).join(',') || 'none'})`)); }, timeout);
    const sub = (f) => { if (f.type === type) { clearTimeout(t); subs.delete(sub); resolve(f); } };
    subs.add(sub);
  });
  const wsSend = (sock, frame) => sock.write(encodeText(JSON.stringify(frame)));
  relay.send = (frame) => {
    if (relay.sockets.length) { for (const s of relay.sockets) wsSend(s, frame); return; }
    relay.outbox.push(frame);
    for (const w of relay.waiters.splice(0)) w();
  };
  relay.dropSockets = () => { for (const s of relay.sockets.splice(0)) s.destroy(); };

  const server = http.createServer(async (req, res) => {
    const authed = req.headers.authorization === `Bearer ${token}` && authOk;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/connector/whoami' && req.method === 'POST') return authed ? json(200, { machineId: relay.machineId, name: 'fake' }) : json(401, { error: 'invalid token' });
    if (req.url === '/connector/frames' && req.method === 'POST') {
      if (!authed) return json(401, { error: 'invalid token' });
      relay.httpPosts++;
      let body = ''; for await (const c of req) body += c;
      let frames = []; try { frames = JSON.parse(body || '[]'); } catch {}
      const down = [];
      for (const f of frames) { record(f, 'http'); if (f.type === 'auth') down.push({ type: 'auth-ok', machineId: relay.machineId }); }
      down.push(...relay.outbox.splice(0));
      return json(200, down);
    }
    if (req.url === '/connector/frames' && req.method === 'GET') {
      if (!authed) return json(401, { error: 'invalid token' });
      relay.httpPolls++;
      if (relay.outbox.length) return json(200, relay.outbox.splice(0));
      let answered = false;
      const done = () => { if (answered) return; answered = true; clearTimeout(t); json(200, relay.outbox.splice(0)); };
      const t = setTimeout(done, pollHold);
      relay.waiters.push(done);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => {
    relay.upgrades++;
    if (req.url !== '/connector/ws' || relay.rejectUpgrade) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let authedWs = false, buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = decodeFrames(buf); buf = rest;
      for (const fr of frames) {
        if (fr.opcode === 8) { socket.write(closeFrame(1000, '')); socket.end(); return; }
        if (fr.opcode !== 1) continue;
        let f; try { f = JSON.parse(fr.payload.toString('utf8')); } catch { continue; }
        record(f, 'ws');
        if (!authedWs) {
          if (f.type !== 'auth' || f.token !== token || !authOk) { socket.write(closeFrame(4401, 'unauthorized')); socket.end(); return; }
          authedWs = true; relay.sockets.push(socket);
          wsSend(socket, { type: 'auth-ok', machineId: relay.machineId });
          for (const d of relay.outbox.splice(0)) wsSend(socket, d);
        }
      }
    });
    socket.on('close', () => { relay.sockets = relay.sockets.filter((s) => s !== socket); });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  relay.port = server.address().port;
  relay.url = `http://127.0.0.1:${relay.port}`;
  relay.close = () => new Promise((r) => { relay.dropSockets(); server.closeAllConnections(); server.close(() => r()); });
  return relay;
}

module.exports = { startFakeRelay, decodeFrames, encodeText };
