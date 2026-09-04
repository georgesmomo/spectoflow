'use strict';
/*
 * The multi-project hub's server process — global (ships under lib/, never vendored into a
 * project's .spectoflow/). For this sub-project it still serves exactly one project (no /p/<id>
 * routing yet — a later sub-project, see docs/multi-project-hub-design.md's decomposition). Its job
 * here is to prove the split works: same behavior as templates/dashboard/server.js, but loading that
 * one project's route logic dynamically from its own vendored handlers.js, and serving the
 * globally-installed frontend (templates/dashboard/public) rather than the project's own copy — an
 * intentional, approved difference (the frontend is unavoidably global; see the design doc's "the
 * server must split in two" addendum).
 *
 * Not yet wired into `spectoflow dashboard` (that CLI switch is a later sub-project) — this module is
 * exercised directly, the same way templates/dashboard/server.js is exercised by test/
 * dashboard-backend.test.js: spawn it as a subprocess with SPECTOFLOW_ROOT + SPECTOFLOW_PORT env vars.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SPECTOFLOW_PORT ? Number(process.env.SPECTOFLOW_PORT) : 4319;
const ROOT = process.env.SPECTOFLOW_ROOT || process.cwd();
const PUBLIC = path.join(__dirname, '..', 'templates', 'dashboard', 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff' };
const clients = new Set();
function sendJSON(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); }
function emit(obj){ const line='data: '+JSON.stringify(obj)+'\n\n'; for(const res of clients) res.write(line); }

const { createHandlers } = require(path.join(ROOT, '.spectoflow', 'dashboard', 'handlers.js'));
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

    let file=p==='/'?'/index.html':p;
    const full=path.join(PUBLIC,path.normalize(file).replace(/^(\.\.[/\\])+/,''));
    if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end('Forbidden'); }
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
      const headers = ext==='.woff2'||ext==='.woff' ? { 'Cache-Control':'public, max-age=604800' } : noCache;
      res.writeHead(200,Object.assign({'Content-Type':MIME[ext]||'application/octet-stream'},headers)); res.end(data);
    });
  }catch(e){ sendJSON(res,500,{error:String(e&&e.message||e)}); }
});

const LOCK = path.join(ROOT, '.spectoflow', '.dashboard.lock');
function writeLock(){ try{ fs.mkdirSync(path.dirname(LOCK),{recursive:true}); fs.writeFileSync(LOCK, JSON.stringify({ pid:process.pid, port:PORT, url:`http://localhost:${PORT}`, startedAt:new Date().toISOString() })+'\n'); }catch{} }
function clearLock(){ try{ const l=JSON.parse(fs.readFileSync(LOCK,'utf8')); if(l.pid===process.pid) fs.unlinkSync(LOCK); }catch{} }
process.on('exit', clearLock);
['SIGINT','SIGTERM'].forEach((s)=> process.on(s, ()=>{ clearLock(); process.exit(0); }));
server.listen(PORT,()=>{ writeLock(); console.log(`spectoflow · hub → http://localhost:${PORT}`); console.log(`project root: ${ROOT}`); });
