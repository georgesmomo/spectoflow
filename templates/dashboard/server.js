'use strict';
/*
 * spectoflow dashboard — ZERO-DEPENDENCY server, real-time (SSE + fs.watch).
 * v0.4 adds an agent launcher: POST /api/run spawns the configured agent headless in the project
 * root (with project memory: CLAUDE.md → AGENTS.md), streams its output over SSE, and records the
 * run in .spectoflow/runtime.json. As the agent edits plans/*.md, the board refreshes live.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const { startRun } = require('./runner');
const orchestrator = require('./orchestrator');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const PUBLIC = path.join(__dirname, 'public');
const ROOT = process.env.SPECTOFLOW_ROOT || path.resolve(__dirname, '..', '..');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
const clients = new Set();

// Installed framework version: the manifest records it at init/update time. Fallback to the kit's
// own package.json — only reachable (and only used) when the server is run straight from templates/
// (dev/preview), never from an installed project whose sibling package.json belongs to the user.
function frameworkVersion(){
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.spectoflow', '.manifest.json'), 'utf8')).version; } catch {}
  try { const pk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')); if (pk.name === 'spectoflow') return pk.version; } catch {}
  return null;
}
function project(){
  const p = store.readProject(ROOT);
  const v = frameworkVersion(); if (v) p.version = v;
  return p;
}
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function body(req){ return new Promise(r=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b||'{}'));}catch{r({});} }); }); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }
function findPlanFileForTask(id){ for(const pl of store.readPlans(ROOT)) for(const ph of pl.phases) if(ph.tasks.find(t=>t.id===id)) return pl.file; return null; }

// ---- helpers for settings + attention points -----------------------------
const configPath = () => path.join(ROOT, '.spectoflow', 'config.json');
function writeConfig(patch){
  const cp = configPath(); const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
  if (patch.mode && ['autopilot','semi','manual'].includes(patch.mode)) cfg.mode = patch.mode;
  if (typeof patch.language === 'string' && patch.language.trim()) cfg.language = patch.language.trim();
  if (typeof patch.design === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.design)) cfg.design = patch.design;
  fs.writeFileSync(cp, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}
// Next free T-### id across every plan file (absolute paths from store.readPlans).
function nextTaskId(){
  let max = 0;
  for (const pl of store.readPlans(ROOT)) {
    try { const t = fs.readFileSync(pl.file, 'utf8'); const re = /\bT-(\d+)/g; let m; while ((m = re.exec(t))) max = Math.max(max, Number(m[1])); } catch {}
  }
  return 'T-' + String(max + 1).padStart(3, '0');
}
// Promote an attention item into a real checkbox task under an `## Attention` phase.
function promoteAttention(item){
  const plans = store.readPlans(ROOT);
  let file = plans[0] && plans[0].file;
  if (!file) { file = path.join(ROOT, 'plans', 'inbox.md'); fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, '# Inbox\n'); }
  const id = nextTaskId();
  let text = fs.readFileSync(file, 'utf8');
  const line = `- [ ] ${id} ${String(item.text).replace(/\s+/g, ' ').trim()} @user ~standard`;
  if (/^##\s+Attention\s*$/m.test(text)) text = text.replace(/^(##\s+Attention\s*)$/m, `$1\n${line}`);
  else { if (!text.endsWith('\n')) text += '\n'; text += `\n## Attention\n${line}\n`; }
  fs.writeFileSync(file, text);
  return { id, file };
}

function watch(dir){ try{ fs.watch(dir,{recursive:false},()=>emit({type:'change'})); }catch(_){} }
['plans','specs','.spectoflow'].forEach(d=>{ const p=path.join(ROOT,d); if(fs.existsSync(p)) watch(p); });

// A process restart loses any in-flight orchestration; without this, a stale 'running' or
// 'awaiting_approval' status wedges the /api/orchestrate 409 guard forever. Not a real
// resume — just clears the wedge so a fresh orchestration can start.
try { orchestrator.reconcileOnBoot(ROOT); } catch {}

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`); const p=u.pathname;
  try{
    if(p==='/api/project') return sendJSON(res,200,project());

    // ---- read-only agent/skill file viewer (scoped to .spectoflow/{agents,skills}/**) ----
    if (p === '/api/agentfile' && req.method === 'GET') {
      const rel = new URL(req.url, 'http://x').searchParams.get('path') || '';
      const base = path.join(ROOT, '.spectoflow');
      const aDir = path.join(base, 'agents'), sDir = path.join(base, 'skills');
      const abs = path.resolve(base, rel);
      const okDir = abs.startsWith(aDir + path.sep) || abs.startsWith(sDir + path.sep);
      if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory())
        return sendJSON(res, 400, { error: 'not an agent/skill file' });
      // Symlink guard: the resolved real path must stay within the (real) scope dirs.
      let real; try { real = fs.realpathSync(abs); } catch { real = null; }
      const realA = (() => { try { return fs.realpathSync(aDir); } catch { return aDir; } })();
      const realS = (() => { try { return fs.realpathSync(sDir); } catch { return sDir; } })();
      const okReal = real && (real.startsWith(realA + path.sep) || real.startsWith(realS + path.sep));
      if (!okReal || !real.endsWith('.md') || fs.statSync(real).isDirectory())
        return sendJSON(res, 400, { error: 'not an agent/skill file' });
      return sendJSON(res, 200, { content: fs.readFileSync(real, 'utf8') });
    }

    if(p==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
      res.write('data: '+JSON.stringify({type:'hello'})+'\n\n');
      clients.add(res); req.on('close',()=>clients.delete(res)); return;
    }

    if(p.startsWith('/api/task/')&&req.method==='PATCH'){
      const id=decodeURIComponent(p.split('/')[3]||''); const patch=await body(req);
      const file=findPlanFileForTask(id); if(!file) return sendJSON(res,404,{error:`Task ${id} not found.`});
      store.updateTaskLine(ROOT,file,id,patch); emit({type:'change'}); return sendJSON(res,200,{ok:true});
    }
    if(/^\/api\/task\/[^/]+\/comment$/.test(p)&&req.method==='POST'){
      const id=decodeURIComponent(p.split('/')[3]||''); const {text,action}=await body(req);
      if(!text||!String(text).trim()) return sendJSON(res,400,{error:'Empty comment.'});
      const file=findPlanFileForTask(id); if(!file) return sendJSON(res,404,{error:`Task ${id} not found.`});
      store.addTaskComment(ROOT,file,id,String(text).trim(),'me');
      if(action==='analyze') store.updateTaskLine(ROOT,file,id,{status:'to_analyze'});
      emit({type:'change'}); return sendJSON(res,200,{ok:true});
    }
    if(p==='/api/workflow/toggle'&&req.method==='POST'){
      const {name}=await body(req); const wf=path.join(ROOT,'.spectoflow','workflow.md');
      const lines=fs.readFileSync(wf,'utf8').split('\n');
      for(let i=0;i<lines.length;i++){ const m=lines[i].match(/^(\s*- \[)( |x|X)(\]\s+)(.*)$/);
        if(m&&m[4].replace(/\s*\(optional\)\s*$/i,'').trim()===name) lines[i]=m[1]+(m[2].trim()?' ':'x')+m[3]+m[4]; }
      fs.writeFileSync(wf,lines.join('\n')); emit({type:'change'}); return sendJSON(res,200,{ok:true});
    }

    // ---- agent launcher (pipeline lives in runner.js; posts to the group-chat log) ----
    if(p==='/api/run'&&req.method==='POST'){
      const {prompt,agent}=await body(req);
      if(!prompt||!String(prompt).trim()) return sendJSON(res,400,{error:'Empty request.'});
      const r=startRun(ROOT,{prompt,agent},emit);
      if(r.error) return sendJSON(res,400,{error:r.error});
      return sendJSON(res,200,{runId:r.runId});
    }

    // ---- orchestrator ----
    if (p === '/api/orchestrate' && req.method === 'POST') {
      const { request } = await body(req);
      if (!request || !String(request).trim()) return sendJSON(res, 400, { error: 'Empty request.' });
      const active = store.readRuntime(ROOT).orchestration;
      if (active && ['running', 'awaiting_approval'].includes(active.status))
        return sendJSON(res, 409, { error: 'An orchestration is already active.' });
      const mode = store.readConfig(ROOT).mode || 'semi';
      // fire and forget; state + messages stream over SSE
      orchestrator.runOrchestration({ root: ROOT, request: String(request).trim(), mode,
        runStep: orchestrator.defaultRunStep, confirm: orchestrator.defaultConfirm }, emit)
        .catch((e) => emit({ type: 'message', message: { role: 'orchestrator', kind: 'status', text: 'orchestration error: ' + e.message } }));
      const o = store.readRuntime(ROOT).orchestration;
      return sendJSON(res, 200, { orchestrationId: o && o.id });
    }
    if (p === '/api/orchestrate/approve' && req.method === 'POST') {
      const { decision, note } = await body(req);
      const ok = orchestrator.submitDecision(decision, note);
      return sendJSON(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'No pending approval.' });
    }

    // ---- settings: change autonomy mode + output language (writes config.json) ----
    if (p === '/api/settings' && req.method === 'POST') {
      const patch = await body(req);
      try { const cfg = writeConfig(patch); emit({ type: 'change' }); return sendJSON(res, 200, { config: cfg }); }
      catch (e) { return sendJSON(res, 400, { error: String(e && e.message || e) }); }
    }

    // ---- attention points: agent- or user-raised notes; validate → real task ----
    if (p === '/api/attention' && req.method === 'POST') {
      const { text } = await body(req);
      if (!text || !String(text).trim()) return sendJSON(res, 400, { error: 'Empty note.' });
      const rt = store.readRuntime(ROOT); rt.attention = rt.attention || [];
      const item = { id: 'att' + Date.now().toString(36), at: new Date().toISOString(), by: 'me', source: 'user', status: 'open', text: String(text).trim() };
      rt.attention.unshift(item); store.writeRuntime(ROOT, rt); emit({ type: 'change' });
      return sendJSON(res, 200, { item });
    }
    if (/^\/api\/attention\/[^/]+\/promote$/.test(p) && req.method === 'POST') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const rt = store.readRuntime(ROOT); const it = (rt.attention || []).find((x) => x.id === id);
      if (!it) return sendJSON(res, 404, { error: 'Note not found.' });
      const t = promoteAttention(it); it.status = 'resolved'; it.promotedTo = t.id;
      store.writeRuntime(ROOT, rt); emit({ type: 'change' });
      return sendJSON(res, 200, { task: t });
    }
    if (/^\/api\/attention\/[^/]+$/.test(p) && req.method === 'PATCH') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const patch = await body(req);
      const rt = store.readRuntime(ROOT); const it = (rt.attention || []).find((x) => x.id === id);
      if (!it) return sendJSON(res, 404, { error: 'Note not found.' });
      if (typeof patch.text === 'string' && patch.text.trim()) it.text = patch.text.trim();
      if (patch.status && ['open', 'resolved'].includes(patch.status)) it.status = patch.status;
      store.writeRuntime(ROOT, rt); emit({ type: 'change' });
      return sendJSON(res, 200, { item: it });
    }
    if (/^\/api\/attention\/[^/]+$/.test(p) && req.method === 'DELETE') {
      const id = decodeURIComponent(p.split('/')[3] || '');
      const rt = store.readRuntime(ROOT); rt.attention = (rt.attention || []).filter((x) => x.id !== id);
      store.writeRuntime(ROOT, rt); emit({ type: 'change' });
      return sendJSON(res, 200, { ok: true });
    }

    // ---- static files, with SPA fallback: a route like /backlog (no file extension)
    //      that isn't a real asset serves index.html so client-side routing can take over ----
    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
    // Local tool: always serve the freshest asset — never let the browser cache a stale app.js/css.
    const noCache = { 'Cache-Control': 'no-store, must-revalidate' };
    fs.readFile(full,(err,data)=>{
      if(err){
        if(req.method==='GET' && !path.extname(p) && !p.startsWith('/api/')){
          return fs.readFile(path.join(PUBLIC,'index.html'),(e2,d2)=>{
            if(e2){ res.writeHead(404); return res.end('Not found'); }
            res.writeHead(200,Object.assign({'Content-Type':MIME['.html']},noCache)); res.end(d2);
          });
        }
        res.writeHead(404); return res.end('Not found');
      }
      const ext=path.extname(full);
      // fonts are content-hashed by name and safe to cache long-term; everything else is no-store
      const headers = ext==='.woff2'||ext==='.woff' ? { 'Cache-Control':'public, max-age=604800' } : noCache;
      res.writeHead(200,Object.assign({'Content-Type':MIME[ext]||'application/octet-stream'},headers)); res.end(data);
    });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});
// pidfile so `spectoflow dashboard stop` can find and stop this server; cleared on exit.
const LOCK = path.join(ROOT, '.spectoflow', '.dashboard.lock');
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));
server.listen(PORT,()=>{ writeLock(); console.log(`spectoflow · dashboard → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
