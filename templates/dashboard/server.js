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
const { spawn } = require('child_process');
const store = require('../lib/store');

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

// ---- runtime helpers for runs ----
function runStart(run){ const rt=store.readRuntime(ROOT); rt.agents=rt.agents||[]; rt.agents.push(run); store.writeRuntime(ROOT,rt); }
function runEnd(id,code){ const rt=store.readRuntime(ROOT); const a=(rt.agents||[]).find(x=>x.id===id); if(a){ a.status=code===0?'done':'failed'; a.endedAt=new Date().toISOString(); } store.writeRuntime(ROOT,rt); }

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`); const p=u.pathname;
  try{
    if(p==='/api/project') return sendJSON(res,200,project());

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

    // ---- agent launcher ----
    if(p==='/api/run'&&req.method==='POST'){
      const {prompt,agent}=await body(req);
      if(!prompt||!String(prompt).trim()) return sendJSON(res,400,{error:'Empty request.'});
      const cfg=store.readConfig(ROOT);
      const which=agent||cfg.agent||'claude';
      const cmdStr=(cfg.runners&&cfg.runners[which]);
      if(!cmdStr) return sendJSON(res,400,{error:`No runner configured for "${which}".`});
      const parts=cmdStr.split(/\s+/).filter(Boolean);
      const runId='r'+Date.now().toString(36);
      const run={ id:runId, tool:which, prompt:String(prompt).trim(), status:'running', startedAt:new Date().toISOString() };
      runStart(run); emit({type:'run-start',run}); emit({type:'change'});
      let child;
      try{ child=spawn(parts[0],[...parts.slice(1),String(prompt).trim()],{cwd:ROOT,env:process.env}); }
      catch(e){ runEnd(runId,1); emit({type:'run-line',runId,chunk:'spawn error: '+e.message}); emit({type:'run-end',runId,code:1}); emit({type:'change'}); return sendJSON(res,200,{runId}); }
      const pipe=(stream)=>{ stream.on('data',d=> emit({type:'run-line',runId,chunk:d.toString()})); };
      child.stdout&&pipe(child.stdout); child.stderr&&pipe(child.stderr);
      child.on('error',e=> emit({type:'run-line',runId,chunk:'error: '+e.message}));
      child.on('close',code=>{ runEnd(runId,code); emit({type:'run-end',runId,code}); emit({type:'change'}); });
      return sendJSON(res,200,{runId});
    }

    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(full,(err,data)=>{ if(err){res.writeHead(404); return res.end('Not found');}
      res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream'}); res.end(data); });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});
server.listen(PORT,()=>{ console.log(`spectoflow · dashboard → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
