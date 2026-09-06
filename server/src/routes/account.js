'use strict';
const ACCOUNT_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>spectoflow — account</title>
<style>body{font:14px system-ui;background:#0f1116;color:#e7e9f2;max-width:640px;margin:32px auto;padding:0 16px}
h2{font-size:15px;border-bottom:1px solid #2a2e3d;padding-bottom:6px}
.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e2130}
button{padding:5px 10px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2;cursor:pointer}
input{padding:7px 9px;border-radius:6px;border:1px solid #2a2e3d;background:#1e2130;color:#e7e9f2}</style></head><body>
<h1 style="font-size:17px">Account</h1>
<div id="profile"></div>
<h2>Change password</h2>
<form id="pwForm"><input id="cur" type="password" placeholder="Current password" /><input id="new" type="password" placeholder="New password (12+ chars)" /><button type="submit">Change</button><p id="pwErr" style="color:#e0607a"></p></form>
<h2>Sessions</h2><div id="sessions"></div>
<h2>Machine tokens</h2><div id="machines"></div>
<form id="mForm"><input id="mName" placeholder="Machine name" /><button type="submit">Create token</button></form>
<pre id="newToken" style="display:none;background:#1e2130;padding:10px;border-radius:6px"></pre>
<script>
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function j(url, opts) { const r = await fetch(url, opts); return r.json(); }
async function load() {
  const p = await j('/api/account'); document.getElementById('profile').textContent = p.email + (p.emailVerifiedAt ? ' (verified)' : ' (not verified)');
  const s = await j('/api/account/sessions');
  document.getElementById('sessions').innerHTML = s.sessions.map(x => '<div class="row"><span>' + esc(x.userAgent||'unknown') + ' — ' + esc(x.ip) + (x.id===s.currentSessionId?' (this device)':'') + '</span><button data-session="'+x.id+'">Revoke</button></div>').join('');
  const m = await j('/api/account/machines');
  document.getElementById('machines').innerHTML = m.machines.map(x => '<div class="row"><span>' + esc(x.name) + (x.revoked_at?' (revoked)':'') + '</span><button data-machine="'+x.id+'">Revoke</button></div>').join('');
}
document.addEventListener('click', async (e) => {
  if (e.target.dataset.session) { await fetch('/api/account/sessions/'+e.target.dataset.session, {method:'DELETE'}); load(); }
  if (e.target.dataset.machine) { await fetch('/api/account/machines/'+e.target.dataset.machine, {method:'DELETE'}); load(); }
});
document.getElementById('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/account/password', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:document.getElementById('cur').value,newPassword:document.getElementById('new').value})});
  if (r.ok) location.reload(); else document.getElementById('pwErr').textContent = (await r.json()).error || 'Could not change password.';
});
document.getElementById('mForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await j('/api/account/machines', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('mName').value})});
  document.getElementById('newToken').style.display='block'; document.getElementById('newToken').textContent = 'spectoflow dashboard login --url=' + location.origin + ' --token=' + r.machine.token;
  load();
});
load();
</script></body></html>`;

async function registerAccount(app, { db, insecureDev }) {
  app.get('/account', async (_req, reply) => reply.type('text/html').send(ACCOUNT_PAGE_HTML));

  app.get('/api/account', async (req) => {
    const u = await db.findUserById(req.user.id);
    return { id: u.id, email: u.email, emailVerifiedAt: u.email_verified_at };
  });

  app.post('/api/account/password', async (req, reply) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = await db.findUserById(req.user.id);
    if (typeof currentPassword !== 'string' || !(await db.verifyPassword(user, currentPassword))) return reply.code(400).send({ error: 'Current password is incorrect.' });
    if (typeof newPassword !== 'string' || newPassword.length < 12) return reply.code(400).send({ error: 'New password must be at least 12 characters.' });
    await db.updatePassword(user.id, newPassword);
    await db.revokeAllSessionsForUser(user.id); // including the current one — reissue below so this browser tab stays signed in
    const session = await db.createSession(user.id, { userAgent: (req.headers['user-agent'] || '').slice(0, 300), ip: req.ip });
    reply.setCookie('spf_session', session.token, { httpOnly: true, secure: !insecureDev, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
    return { ok: true };
  });

  app.get('/api/account/sessions', async (req) => {
    const sessions = await db.listSessionsForUser(req.user.id);
    return { sessions, currentSessionId: req.sessionId };
  });
  app.delete('/api/account/sessions/:id', async (req, reply) => {
    const mine = await db.listSessionsForUser(req.user.id);
    if (!mine.some((s) => s.id === req.params.id)) return reply.code(404).send({ error: 'Session not found.' });
    await db.revokeSession(req.params.id);
    return { ok: true };
  });

  app.get('/api/account/machines', async (req) => ({ machines: await db.listMachinesForOwner(req.user.id) }));
  app.post('/api/account/machines', async (req, reply) => {
    const name = req.body && req.body.name;
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name is required' });
    const m = db.createMachine(name.trim(), req.user.id); await m.ready;
    return { machine: { id: m.id, name: m.name, token: m.token } };
  });
  app.delete('/api/account/machines/:id', async (req, reply) => {
    const machine = await db.findMachine(req.params.id);
    if (!machine || machine.owner_user_id !== req.user.id) return reply.code(404).send({ error: 'Machine not found.' });
    await db.revokeMachine(req.params.id);
    return { ok: true };
  });
}
module.exports = { registerAccount };
