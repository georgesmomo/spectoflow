'use strict';
/*
 * spectoflow dashboard — ZERO-DEPENDENCY server, real-time (SSE + fs.watch), single project.
 * The actual /api/* route behavior lives in ./handlers.js — split out so the future multi-project hub
 * (lib/hub-server.js) can load a different project's handlers.js on demand (see
 * docs/multi-project-hub-design.md's "the server must split in two" addendum). This file remains the
 * direct single-project entry point (`node .spectoflow/dashboard/server.js`, today's `spectoflow
 * dashboard`) — its own external behavior is unchanged by the split.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandlers } = require('./handlers');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const PUBLIC = path.join(__dirname, 'public');
const ROOT = process.env.SPECTOFLOW_ROOT || path.resolve(__dirname, '..', '..');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
const clients = new Set();
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }

const handlers = createHandlers(ROOT);

function watch(dir){ try{ fs.watch(dir,{recursive:false},()=>emit({type:'change'})); }catch(_){} }
handlers.onBoot();
handlers.watchDirs.forEach((d)=>{ const p=path.join(ROOT,d); if(fs.existsSync(p)) watch(p); });

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,`http://localhost:${PORT}`); const p=u.pathname;
  try{
    if(p==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
      res.write('data: '+JSON.stringify({type:'hello'})+'\n\n');
      clients.add(res); req.on('close',()=>clients.delete(res)); return;
    }

    if (p.startsWith('/api/')) {
      const handled = await handlers.handleApi(req, res, u, emit);
      if (handled) return;
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
