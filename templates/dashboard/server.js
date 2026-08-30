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
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8' };
const clients = new Set();

function project(){ return store.readProject(ROOT); }
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function body(req){ return new Promise(r=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b||'{}'));}catch{r({});} }); }); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }
function findPlanFileForTask(id){ for(const pl of store.readPlans(ROOT)) for(const ph of pl.phases) if(ph.tasks.find(t=>t.id===id)) return pl.file; return null; }

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
      const abs = path.resolve(base, rel);
      const okDir = abs.startsWith(path.join(base, 'agents') + path.sep) || abs.startsWith(path.join(base, 'skills') + path.sep);
      if (!okDir || !abs.endsWith('.md') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory())
        return sendJSON(res, 400, { error: 'not an agent/skill file' });
      return sendJSON(res, 200, { content: fs.readFileSync(abs, 'utf8') });
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

    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(full,(err,data)=>{ if(err){res.writeHead(404); return res.end('Not found');}
      res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream'}); res.end(data); });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});
server.listen(PORT,()=>{ console.log(`spectoflow · dashboard → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
