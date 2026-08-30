'use strict';
const STATUS = { todo:'To do', in_progress:'In progress', to_validate:'To validate', to_analyze:'To analyze', done:'Done', blocked:'Blocked' };
let P = null, openTaskId = null;
let filter = { status: 'all', q: '' }; // board filter state — client-side only, read-only
let backlogFilter = { status: 'all', q: '' }; // backlog filter state — independent from the board's
let backlogSort = { col: 'id', dir: 'asc' };   // backlog sort state — client-side only

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const el=(t,c,x)=>{const e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e;};
const allTasks=()=> (P.plans||[]).flatMap(pl=>pl.phases.flatMap(ph=>ph.tasks.map(t=>({...t,file:pl.file}))));
const runtimeTests=(id)=> (P.runtime&&P.runtime.tests&&P.runtime.tests[id])||null;

async function load(){
  const r = await fetch('/api/project'); P = await r.json(); render();
  if(openTaskId) openDrawer(openTaskId,true);
}
function connect(){
  const es = new EventSource('/api/events');
  es.onopen = ()=>{ $('#sync').classList.remove('offline'); $('#syncLabel').textContent='live'; };
  es.onmessage = (ev)=>{
    let m; try{ m=JSON.parse(ev.data); }catch{ return; }
    if(m.type==='change'||m.type==='message') return load();   // messages live from runtime.messages
    if(m.type==='run-start'||m.type==='run-end') { chatState.forEach(st=>{ st.rawBlock=null; }); return; }
    if(m.type==='run-line') return appendRaw(m.chunk);          // raw output is ephemeral (not logged)
  };
  es.onerror = ()=>{ $('#sync').classList.add('offline'); $('#syncLabel').textContent='offline'; };
}
// The chat transcript is the view of runtime.messages, shared by the floating widget (#chatLog)
// and the Chat tab (#chatTabLog) via renderChatLog(container) — same messages, same markup, so
// they never drift. Each container tracks its own render/raw state (a container can be rendered
// into while hidden, e.g. the tab behind the widget) so neither surface clobbers the other.
// Render incrementally (by message id) so a live raw-output block isn't wiped by a re-render; raw
// run output streams into an ephemeral <pre> block appended in order, per container.
const chatState=new Map(); // container element -> { rendered:Set<id>, rawBlock:Element|null }
function stateFor(container){
  let st=chatState.get(container);
  if(!st){ st={rendered:new Set(),rawBlock:null}; chatState.set(container,st); }
  return st;
}
function chatContainers(){ return [$('#chatLog'),$('#chatTabLog')].filter(Boolean); }
function scrollChat(container){ container.scrollTop=container.scrollHeight; }
function clearIdle(container){ const i=container.querySelector('.chat-idle'); if(i) i.remove(); }
function bubble(m){
  if(m.role==='user'){ const d=el('div','msg you'); d.append(el('div','bubble',m.text)); return d; }
  const wrap=el('div','msg agentmsg k-'+(m.kind||'message'));
  wrap.append(el('div','msg-role', m.role + (m.agent&&m.agent!==m.role?(' · '+m.agent):'')));
  wrap.append(el('div','bubble',m.text));
  return wrap;
}
function renderChatLog(container){
  if(!container) return;
  const st=stateFor(container); const msgs=(P.runtime&&P.runtime.messages)||[];
  if(msgs.length) clearIdle(container);
  let added=false;
  for(const m of msgs){ if(st.rendered.has(m.id)) continue; st.rendered.add(m.id); container.append(bubble(m)); added=true; }
  if(added) scrollChat(container);
  renderApproval(container);
}
function renderApproval(container){
  if(!container) return;
  const o=(P.runtime&&P.runtime.orchestration)||null;
  let row=container.querySelector('.approval'); if(row) row.remove();
  if(!o || o.status!=='awaiting_approval') return;
  row=el('div','approval');
  row.append(el('div','msg-role','orchestrator · awaiting approval'));
  const a=el('button','btn primary','Approve'); a.addEventListener('click',()=>approve('approve'));
  const c=el('button','btn','Cancel'); c.addEventListener('click',()=>approve('cancel'));
  const acts=el('div','c-actions'); acts.append(a,c); row.append(acts);
  container.append(row); scrollChat(container);
}
function appendRaw(chunk){
  chatContainers().forEach(container=>{
    const st=stateFor(container);
    clearIdle(container);
    if(!st.rawBlock){ st.rawBlock=el('pre','msg agent'); container.append(st.rawBlock); }
    st.rawBlock.textContent += chunk; // single text node → correct preformatted wrapping
    scrollChat(container);
  });
}
function setChat(open){
  $('#chat').setAttribute('aria-hidden', open?'false':'true');
  $('#chatFab').classList.toggle('is-open',open);
  try{ localStorage.setItem('spf-chat', open?'1':'0'); }catch{}
  if(open) setTimeout(()=>$('#runPrompt').focus(),60);
}
// doRun/doOrchestrate default to the floating widget's textarea/select; the Chat tab has its own
// #tabRunPrompt/#tabRunAgent (an id can't be shared by two elements) and passes them explicitly —
// one code path, same endpoints, for both surfaces.
async function doRun(promptEl,agentEl){
  promptEl=promptEl||$('#runPrompt'); agentEl=agentEl||$('#runAgent');
  const prompt=promptEl.value.trim(); if(!prompt) return;
  const agent=agentEl.value;
  await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,agent})});
  promptEl.value=''; // the prompt renders as a bubble from the message log
}
async function doOrchestrate(promptEl){
  promptEl=promptEl||$('#runPrompt');
  const prompt=promptEl.value.trim(); if(!prompt) return;
  await fetch('/api/orchestrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:prompt})});
  promptEl.value='';
}
async function approve(decision){ await fetch('/api/orchestrate/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})}); }
async function patchTask(id,patch){ flash(); await fetch('/api/task/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); }
async function addComment(id,text,action){ flash(); await fetch('/api/task/'+encodeURIComponent(id)+'/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,action})}); }
async function toggleStep(name){ flash(); await fetch('/api/workflow/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); }
function flash(){ const s=$('#sync'); s.classList.add('saving'); $('#syncLabel').textContent='writing…'; setTimeout(()=>{ s.classList.remove('saving'); $('#syncLabel').textContent='live'; },800); }

function render(){
  const c = P.config||{};
  $('#projectName').textContent = c.projectType || 'project';
  $('#agentChip').textContent = c.agent||'claude';
  $('#langChip').textContent = c.language||'en';
  $('#modeChip').textContent = c.mode||'semi';
  $('#brandSub').textContent = (c.mode||'semi') + ' · ' + (c.language||'en');
  // agent select — widget (#runAgent) and Chat tab (#tabRunAgent) each get their own populated
  // <select>, since an id can't be shared by two elements; same option list, same source of truth.
  const runners=Object.keys((c.runners)||{claude:1});
  [$('#runAgent'),$('#tabRunAgent')].forEach(sel=>{
    if(!sel) return;
    if(sel.options.length!==runners.length){ sel.innerHTML=''; runners.forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.append(o); }); if(c.agent) sel.value=c.agent; }
  });
  const s=SpectoStats.stats(P);
  const meterFill=$('#globalMeterFill');
  if(meterFill) meterFill.style.width=(s.pct||0)+'%';
  const meter=$('#globalMeter');
  if(meter) meter.title=`Global progress: ${s.pct}% (${s.done}/${s.total} tasks)`;
  renderOverview(); renderBoard(); renderBacklog(); renderWorkflow(); renderTeam();
  renderChatLog($('#chatLog')); renderChatLog($('#chatTabLog'));
  renderSidebar(); renderRequests(); renderInfo();
  applyActiveTab(); // re-apply the current tab so an SSE-driven re-render never resets to Board
}

// ---- Requests tab: tasks awaiting review/input (to_validate / to_analyze) ----
function renderRequests(){
  const list=$('#requestsList'); if(!list) return;
  const toAsk=SpectoStats.stats(P).toAsk||[];
  const count=$('#requestsCount'); if(count) count.textContent=toAsk.length;
  list.innerHTML='';
  if(!toAsk.length){ list.append(li('empty','Nothing awaiting you.')); return; }
  toAsk.forEach(t=>{
    const row=el('li','request-row'); row.tabIndex=0;
    row.append(el('span','request-id',t.id));
    row.append(el('span','request-title',t.title));
    row.append(el('span','chip s-'+t.status,STATUS[t.status]||t.status));
    row.append(el('span','request-file',t.file));
    const open=()=>openDrawer(t.id);
    row.addEventListener('click',open);
    row.addEventListener('keydown',e=>{ if(e.key==='Enter')open(); });
    list.append(row);
  });
}

// ---- right sidebar: "Journal" (read-only runtime.messages feed) ----
function renderSidebar(){ renderJournal(); }
function renderJournal(){
  const box=$('#journal'); if(!box) return;
  const msgs=((P.runtime&&P.runtime.messages)||[]).slice().reverse(); // reverse-chronological
  $('#journalCount').textContent=msgs.length;
  box.innerHTML='';
  if(!msgs.length){ box.append(el('div','empty','No activity yet.')); return; }
  msgs.forEach(m=>{
    const row=el('div','journal-row'+(m.role==='user'?' j-you':' k-'+(m.kind||'message')));
    row.append(el('div','journal-head', m.role + (m.agent&&m.agent!==m.role?(' · '+m.agent):'')));
    row.append(el('div','journal-text', m.text));
    box.append(row);
  });
}

// ---- SVG helpers ----------------------------------------------------------
// The chart *markup* (donut/ring/bars arcs & rows) is built by the pure,
// unit-tested SpectoCharts module (charts.js); here we just wrap its
// SVG-string output in a DOM node and, for bars, drive the count-up.
function htmlBlock(cls,html){ const d=el('div',cls); d.innerHTML=html; return d; }

function ring(pct,size){ return htmlBlock('ring-wrap', SpectoCharts.ring(pct,{size:size||72})); }

// Returns {wrap, center:null} — donut's centre label is now baked into the SVG
// via opts.center/opts.sub (see renderOverview), so there is no DOM centre node.
function donut(segments,size,opts){
  const wrap=htmlBlock('donut-wrap', SpectoCharts.donut(segments,Object.assign({size:size||140},opts)));
  return {wrap,center:null};
}

// Horizontal progress bars from [{label,pct,sub}]; animates any data-count spans.
function bars(rows){
  const items=(rows||[]).map(r=>({label:r.label,value:r.pct,sub:r.sub,suffix:r.suffix,color:r.color}));
  const wrap=htmlBlock('bars-block', SpectoCharts.bars(items));
  wrap.querySelectorAll('[data-count]').forEach(countUp);
  return wrap;
}
function countUp(node){
  const target=Number(node.dataset.count)||0; const suffix=node.textContent.replace(/^0*/,'');
  let cur=0; const step=Math.max(1,Math.round(target/20));
  const tick=()=>{ cur=Math.min(target,cur+step); node.textContent=cur+suffix; if(cur<target) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function kpiCard(label,visual,sub){
  const c=el('div','kpi');
  c.append(el('div','kpi-label',label));
  const body=el('div','kpi-body'); body.append(visual); c.append(body);
  if(sub) c.append(el('div','kpi-sub',sub));
  return c;
}
function numBlock(val,color,isText){
  const d=el('div','kpi-num'+(isText?' is-text':''),String(val));
  if(color) d.style.color=color;
  return d;
}
function ocard(title,content){
  const c=el('div','ocard');
  c.append(el('div','ocard-title',title));
  c.append(content);
  return c;
}

function renderOverview(){
  const box=$('#overview'); if(!box) return;
  const s=SpectoStats.stats(P);
  box.innerHTML='';

  // KPI row
  const kpis=el('div','kpi-row');
  kpis.append(kpiCard('Global progress', ring(s.pct,72), `${s.done}/${s.total} tasks`));
  kpis.append(kpiCard('In progress', numBlock(s.byStatus.in_progress||0,'var(--s-in_progress)'), 'tasks'));
  kpis.append(kpiCard('To validate', numBlock(s.byStatus.to_validate||0,'var(--s-to_validate)'), 'awaiting review'));
  const r=s.running||{};
  let runVal='—', runSub='no runs yet';
  if(r.agents>0){ runVal=`${r.agents} running`; runSub='agents active'; }
  else if(r.orchestration&&r.orchestration.status){ runVal=r.orchestration.status; runSub='orchestration'; }
  else if(r.lastRun){ runVal=r.lastRun.status||'—'; runSub='last: '+(r.lastRun.tool||'—'); }
  kpis.append(kpiCard('Running', numBlock(runVal, r.agents>0?'var(--signal)':'var(--muted)', true), runSub));
  box.append(kpis);

  // Status donut + legend
  const segments=s.statuses.map(k=>({key:k,value:s.byStatus[k]||0,color:cssv('--s-'+k)}));
  const d=donut(segments,140,{center:String(s.total),sub:'tasks'});
  const legend=el('div','legend');
  segments.forEach(seg=>{
    const item=el('div','legend-item');
    const sw=el('span','legend-swatch'); sw.style.background=seg.color;
    item.append(sw, el('span','legend-label',STATUS[seg.key]||seg.key), el('span','legend-count',String(seg.value)));
    legend.append(item);
  });
  const donutRow=el('div','donut-row'); donutRow.append(d.wrap,legend);

  // Scope-vs-delivered area curve — history is a snapshot of {date,total,done}
  // recorded by the server; seed a synthetic prior point when there's only one
  // so the line actually draws instead of a single dot.
  let hist=(P.runtime&&P.runtime.history)||[];
  if(hist.length===1){ hist=[{date:hist[0].date,total:0,done:0},hist[0]]; }
  const area=htmlBlock('area-wrap', hist.length
    ? SpectoCharts.area(
        [{name:'Scope',color:cssv('--cool'),data:hist.map(h=>h.total)},
         {name:'Delivered',color:cssv('--signal'),data:hist.map(h=>h.done)}],
        hist.map(h=>(h.date||'').slice(5)))
    : '<div class="empty">No history yet.</div>');
  // enrich the area's hit-rect tooltips with the actual scope/delivered values
  // for that point (charts.js keeps them pure — just the date label)
  area.querySelectorAll('.area-hit').forEach((hit,i)=>{
    const h=hist[i]; if(!h) return;
    hit.dataset.tip = `<b>${h.date||''}</b><br>Scope: ${h.total||0} · Delivered: ${h.done||0}`;
  });
  const topRow=el('div','overview-top');
  topRow.append(ocard('Status distribution', donutRow));
  topRow.append(ocard('Scope vs delivered', area));
  box.append(topRow);

  // Workflow-at-a-glance strip (reuses the wf-arrow flow animation)
  const strip=el('div','wf-strip');
  const steps=P.workflow||[];
  steps.forEach((st,i)=>{
    const node=el('div','wf-mini'+(st.enabled?'':' off'));
    node.append(el('span','dot')); node.append(el('span','nm',st.name));
    strip.append(node);
    if(i<steps.length-1){ const a=el('div','wf-arrow'+(st.enabled&&steps[i+1].enabled?'':' off')); strip.append(a); }
  });
  if(!steps.length) strip.append(el('div','empty','No workflow defined.'));
  box.append(ocard('Workflow at a glance', strip));

  // Per-phase progress bars
  const rows=s.phases.map(ph=>({label:ph.title,pct:ph.pct,sub:`${ph.done}/${ph.total}`}));
  box.append(ocard('Phase progress', bars(rows)));
}

function taskMatches(t){
  if(filter.status!=='all' && t.status!==filter.status) return false;
  const q=filter.q.trim().toLowerCase();
  if(q && !((t.title+' '+t.id).toLowerCase().includes(q))) return false;
  return true;
}
function updateFilterChips(){
  $$('#statusChips .fchip').forEach(b=> b.classList.toggle('active', b.dataset.status===filter.status));
}

function renderBoard(){
  const tasks = allTasks(); // unfiltered — used only to tell "no plans" apart from "no matches"
  updateFilterChips();

  const specs=$('#specs'); specs.innerHTML=''; $('#specsCount').textContent=(P.specs||[]).length;
  if(!(P.specs||[]).length) specs.append(li('empty','none yet'));
  (P.specs||[]).forEach(s=> specs.append(li(null,s)));

  const running = (P.runtime&&P.runtime.agents||[]).filter(a=>a.status==='running');
  const rl=$('#running'); rl.innerHTML=''; $('#runCount').textContent=running.length;
  if(!running.length) rl.append(li('empty','no agent running'));
  running.forEach(a=>{ const e=li('run-live',''); e.innerHTML=`<b>${a.tool}</b> · ${a.task||'—'}`; rl.append(e); });

  const board=$('#board'); board.innerHTML='';
  let shown=0;
  (P.plans||[]).forEach(pl=> pl.phases.forEach(ph=>{
    const filtered=ph.tasks.filter(taskMatches);
    shown+=filtered.length;
    if(!filtered.length) return; // hide phases with zero matching tasks
    board.append(renderPhase(ph,pl.file,filtered));
  }));
  if(!tasks.length) board.append(emptyState());
  else if(!shown) board.append(noMatchState());
}
function li(cls,txt){ const e=el('li',cls); e.textContent=txt; return e; }
function emptyState(){ const d=el('div','empty'); d.style.padding='40px'; d.textContent='No plans yet. Ask your agent to build something — it will run Intake and write plans/*.md.'; return d; }
function noMatchState(){ const d=el('div','empty'); d.style.padding='40px'; d.textContent='No tasks match this filter.'; return d; }

// ---- Backlog tab: flat, sortable, filterable table of every task ----------
// Rows are built from P.plans (not allTasks()) so each task carries its phase title.
function backlogRows(){
  const rows=[];
  (P.plans||[]).forEach(pl=> pl.phases.forEach(ph=> ph.tasks.forEach(t=>{
    rows.push({ id:t.id, title:t.title, phase:ph.title, status:t.status, owner:t.owner||'', level:t.level||'standard', comments:(t.comments||[]).length, file:pl.file });
  })));
  return rows;
}
function backlogMatches(r){
  if(backlogFilter.status!=='all' && r.status!==backlogFilter.status) return false;
  const q=backlogFilter.q.trim().toLowerCase();
  if(q && !((r.id+' '+r.title).toLowerCase().includes(q))) return false;
  return true;
}
function sortBacklogRows(rows){
  const {col,dir}=backlogSort; const mul=dir==='asc'?1:-1;
  return rows.slice().sort((a,b)=>{
    if(col==='comments') return (a.comments-b.comments)*mul;
    let av=a[col], bv=b[col];
    if(col==='status'){ av=STATUS[a.status]||a.status; bv=STATUS[b.status]||b.status; }
    av=String(av==null?'':av).toLowerCase(); bv=String(bv==null?'':bv).toLowerCase();
    if(av<bv) return -1*mul;
    if(av>bv) return 1*mul;
    return 0;
  });
}
function updateBacklogFilterChips(){
  $$('#backlogStatusChips .fchip').forEach(b=> b.classList.toggle('active', b.dataset.status===backlogFilter.status));
}
function updateBacklogSortHeaders(){
  $$('#backlogTable thead th').forEach(th=>{
    const active=th.dataset.col===backlogSort.col;
    th.classList.toggle('is-sorted',active);
    if(active) th.dataset.dir=backlogSort.dir; else th.removeAttribute('data-dir');
  });
}
function renderBacklog(){
  const body=$('#backlogBody'); if(!body) return;
  updateBacklogFilterChips(); updateBacklogSortHeaders();
  const all=backlogRows();
  const cnt=$('#backlogCount'); if(cnt) cnt.textContent=all.length;
  const filtered=sortBacklogRows(all.filter(backlogMatches));
  body.innerHTML='';
  if(!all.length){ body.append(backlogEmptyRow('No plans yet. Ask your agent to build something — it will run Intake and write plans/*.md.')); return; }
  if(!filtered.length){ body.append(backlogEmptyRow('No tasks match this filter.')); return; }
  filtered.forEach(r=> body.append(backlogRow(r)));
}
function backlogEmptyRow(txt){
  const tr=el('tr','backlog-empty-row'); const td=el('td',null,txt); td.colSpan=7; tr.append(td); return tr;
}
function backlogRow(r){
  const tr=el('tr','backlog-row'); tr.tabIndex=0;
  tr.append(el('td','bl-id',r.id));
  tr.append(el('td','bl-title',r.title));
  tr.append(el('td','bl-phase',r.phase));
  const stTd=el('td','bl-status'); stTd.append(el('span','chip s-'+r.status,STATUS[r.status]||r.status)); tr.append(stTd);
  tr.append(el('td','bl-owner', r.owner?('@'+r.owner):'—'));
  tr.append(el('td','bl-level', r.level));
  tr.append(el('td','bl-comments', r.comments?('💬 '+r.comments):''));
  const open=()=>openDrawer(r.id);
  tr.addEventListener('click',open);
  tr.addEventListener('keydown',e=>{ if(e.key==='Enter')open(); });
  return tr;
}

// ---- collapsed-phase state (persisted per phase title, guarded for private mode) ----
function loadCollapsed(){
  try{ const raw=localStorage.getItem('spf-collapsed'); const arr=raw?JSON.parse(raw):[]; return new Set(Array.isArray(arr)?arr:[]); }
  catch{ return new Set(); }
}
function saveCollapsed(set){ try{ localStorage.setItem('spf-collapsed', JSON.stringify([...set])); }catch{} }
let collapsedPhases=loadCollapsed();

function renderPhase(ph,file,filteredTasks){
  const isCollapsed=collapsedPhases.has(ph.title);
  const sec=el('section','phase'+(isCollapsed?' is-collapsed':''));
  const head=el('div','phase-head'); head.tabIndex=0; head.setAttribute('role','button'); head.setAttribute('aria-expanded',String(!isCollapsed));
  head.append(el('span','chevron'));
  head.append(el('span','phase-title',ph.title));
  head.append(el('span','phase-src',file));
  const d=ph.tasks.filter(t=>t.status==='done').length, tot=ph.tasks.length;
  const pct=tot?Math.round((d/tot)*100):0;
  const track=el('div','phase-bar'); const fill=el('div','phase-bar-fill'); fill.style.width=pct+'%'; track.append(fill);
  head.append(track);
  head.append(el('span','phase-stat',`${d}/${tot}`));
  const toggle=()=>{
    const now=sec.classList.toggle('is-collapsed');
    head.setAttribute('aria-expanded',String(!now));
    if(now) collapsedPhases.add(ph.title); else collapsedPhases.delete(ph.title);
    saveCollapsed(collapsedPhases);
  };
  head.addEventListener('click',toggle);
  head.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
  sec.append(head);
  const wrap=el('div','tasks');
  filteredTasks.forEach(t=> wrap.append(renderTask(t)));
  sec.append(wrap); return sec;
}
function renderTask(t){
  const c=el('div','task'+(t.status==='in_progress'?' is-in_progress':''));
  c.tabIndex=0;
  const top=el('div','task-top');
  top.append(el('span','task-id',t.id));
  top.append(el('span','lvl',t.level||'standard'));
  top.append(el('span','chip s-'+t.status,STATUS[t.status]||t.status));
  c.append(top);
  c.append(el('div','task-title',t.title));
  if(t.tags&&t.tags.length){
    const tags=el('div','task-tags');
    t.tags.forEach(tg=> tags.append(el('span','tag',tg)));
    c.append(tags);
  }
  const foot=el('div','task-foot');
  if(t.owner) foot.append(el('span','owner','@'+t.owner));
  if(t.comments&&t.comments.length) foot.append(el('span','cmt-count','💬 '+t.comments.length));
  const tr=runtimeTests(t.id);
  if(tr) foot.append(el('span','tflag '+(tr.failed?'fail':'pass'), tr.failed?`${tr.failed} failing`:`${tr.passed||0} passing`));
  c.append(foot);
  const open=()=>openDrawer(t.id);
  c.addEventListener('click',open);
  c.addEventListener('keydown',e=>{ if(e.key==='Enter')open(); });
  return c;
}

function renderWorkflow(){
  const box=$('#wfDiagram'); box.innerHTML='';
  const steps=P.workflow||[];
  steps.forEach((s,i)=>{
    const step=el('div','wf-step');
    const node=el('div','wf-node'+(s.enabled?'':' off'));
    node.append(el('span','dot'));
    node.append(el('span','nm',s.name));
    if(s.optional) node.append(el('span','opt','opt'));
    node.addEventListener('click',()=>toggleStep(s.name));
    step.append(node);
    if(i<steps.length-1){ const a=el('div','wf-arrow'+(s.enabled&&steps[i+1].enabled?'':' off')); step.append(a); }
    box.append(step);
  });
  if(!steps.length) box.append(el('div','empty','No workflow defined.'));
}

// chip row: a small uppercase kicker label followed by one chip per item — used for
// agent standards/uses and the skill standard.
function chipRow(label,items){
  if(!items||!items.length) return null;
  const row=el('div','cu'); row.append(el('b',null,label));
  items.forEach(x=> row.append(el('span',null,x)));
  return row;
}
function agentCard(a){
  const c=el('div','card'); c.tabIndex=0;
  c.append(el('div','ct',a.title||a.name));
  if(a.capability) c.append(el('div','cc',a.capability));
  const std=chipRow('standards',a.standards); if(std) c.append(std);
  const uses=chipRow('uses',a.uses); if(uses) c.append(uses);
  if(a.description) c.append(el('div','cd',a.description));
  const open=()=>openFileDrawer('agent',a);
  c.addEventListener('click',open);
  c.addEventListener('keydown',e=>{ if(e.key==='Enter')open(); });
  return c;
}
function skillCard(s){
  const c=el('div','card'); c.tabIndex=0;
  c.append(el('div','ct',s.name));
  if(s.capability) c.append(el('div','cc',s.capability));
  const std=chipRow('standard', s.standard?[s.standard]:null); if(std) c.append(std);
  if(s.inputs||s.outputs) c.append(el('div','io', (s.inputs||'—')+'  →  '+(s.outputs||'—')));
  if(s.description) c.append(el('div','cd',s.description));
  const open=()=>openFileDrawer('skill',s);
  c.addEventListener('click',open);
  c.addEventListener('keydown',e=>{ if(e.key==='Enter')open(); });
  return c;
}
function renderTeam(){
  const ag=$('#agents'); ag.innerHTML=''; $('#agentsCount').textContent=(P.agents||[]).length;
  (P.agents||[]).forEach(a=> ag.append(agentCard(a)));
  const sk=$('#skills'); sk.innerHTML=''; $('#skillsCount').textContent=(P.skills||[]).length;
  (P.skills||[]).forEach(s=> sk.append(skillCard(s)));
}

// ---- Agent/Skill file-body drawer — fetches the real markdown file and renders it with a
// tiny inline renderer (mdLite). Content is HTML-escaped before any markup is generated, so a
// crafted agent/skill file can never inject markup into the page.
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function mdLite(raw){
  let text=String(raw||'');
  // 1) strip YAML front-matter (between the first two '---' lines), if present
  const lines0=text.split('\n');
  if(lines0[0]&&lines0[0].trim()==='---'){
    let end=-1;
    for(let i=1;i<lines0.length;i++){ if(lines0[i].trim()==='---'){ end=i; break; } }
    if(end!==-1) text=lines0.slice(end+1).join('\n');
  }
  text=text.replace(/^\n+/,'');
  if(!text.trim()) return '<pre>(empty file)</pre>';
  // 2) escape HTML — everything below builds markup only from this escaped text
  text=escHtml(text);
  // 3) convert a small markdown subset to HTML
  const inline=s=> s.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  const lines=text.split('\n');
  let html='', inCode=false, codeBuf=[], listBuf=[], paraBuf=[];
  const flushPara=()=>{ if(paraBuf.length){ html+='<p>'+paraBuf.join(' ')+'</p>'; paraBuf=[]; } };
  const flushList=()=>{ if(listBuf.length){ html+='<ul>'+listBuf.map(x=>'<li>'+x+'</li>').join('')+'</ul>'; listBuf=[]; } };
  for(const line of lines){
    if(/^\s*```/.test(line)){
      if(!inCode){ flushPara(); flushList(); inCode=true; codeBuf=[]; }
      else { html+='<pre><code>'+codeBuf.join('\n')+'</code></pre>'; inCode=false; }
      continue;
    }
    if(inCode){ codeBuf.push(line); continue; }
    const h=line.match(/^(#{1,3})\s+(.*)$/);
    if(h){ flushPara(); flushList(); const lvl=h[1].length; html+=`<h${lvl}>${inline(h[2])}</h${lvl}>`; continue; }
    const li=line.match(/^\s*-\s+(.*)$/);
    if(li){ flushPara(); listBuf.push(inline(li[1])); continue; }
    if(line.trim()===''){ flushPara(); flushList(); continue; }
    flushList(); paraBuf.push(inline(line));
  }
  flushPara(); flushList();
  if(inCode&&codeBuf.length) html+='<pre><code>'+codeBuf.join('\n')+'</code></pre>';
  return html || '<pre>'+text+'</pre>';
}
async function openFileDrawer(kind,obj){
  openTaskId=null;
  const rel = kind==='agent' ? ('agents/'+(obj.file||(obj.name+'.md'))) : ('skills/'+obj.name+'/SKILL.md');
  const b=$('#drawerBody'); b.innerHTML='';
  b.append(el('div','d-id', kind==='agent'?'Agent':'Skill'));
  b.append(el('div','d-title', obj.title||obj.name));
  const sec=el('div','d-section'); sec.append(el('div','d-label','File · '+rel));
  const body=el('div','md-body'); body.append(el('div','empty','Loading…'));
  sec.append(body); b.append(sec);
  $('#drawer').setAttribute('aria-hidden','false');
  try{
    const r=await fetch('/api/agentfile?path='+encodeURIComponent(rel));
    const data=await r.json().catch(()=>({}));
    if(!r.ok){ body.innerHTML=''; body.append(el('div','empty', data.error||'Could not load this file.')); return; }
    body.innerHTML=mdLite(data.content||'');
  }catch(err){
    body.innerHTML=''; body.append(el('div','empty','Could not load this file.'));
  }
}

// ---- Info tab: read-only project overview (config, runners, counts, specs, active workflow) ----
function infoSection(title,iconKey,content){
  const sec=el('div','info-section');
  const head=el('div','info-section-head');
  const ico=el('span','info-section-ico');
  ico.innerHTML=(typeof ICON!=='undefined'&&ICON[iconKey])||'';
  head.append(ico, el('span','info-section-title',title));
  sec.append(head, content);
  return sec;
}
function infoRow(label,value){
  const row=el('div','info-row');
  row.append(el('span','info-row-label',label));
  row.append(el('span','info-row-value',String(value)));
  return row;
}
function statTile(value,label,sub){
  const t=el('div','stat-tile');
  t.append(el('div','stat-tile-val',String(value)));
  t.append(el('div','stat-tile-label',label));
  if(sub) t.append(el('div','stat-tile-sub',sub));
  return t;
}
function renderInfo(){
  const box=$('#infoGrid'); if(!box) return;
  box.innerHTML='';
  const c=P.config||{};
  const s=SpectoStats.stats(P);
  const steps=P.workflow||[];
  const enabledSteps=steps.filter(st=>st.enabled);

  // Project: mode/language/agent/type from config
  const projRows=el('div','info-rows');
  projRows.append(infoRow('Project type', c.projectType||'—'));
  projRows.append(infoRow('Mode', c.mode||'—'));
  projRows.append(infoRow('Language', c.language||'—'));
  projRows.append(infoRow('Active agent', c.agent||'—'));
  box.append(infoSection('Project','info',projRows));

  // Runners: agent → command, monospace
  const runners=c.runners||{};
  const runnerKeys=Object.keys(runners);
  const runnerRows=el('div','info-rows info-rows-mono');
  if(!runnerKeys.length) runnerRows.append(el('div','empty','No runners configured.'));
  runnerKeys.forEach(k=> runnerRows.append(infoRow(k, runners[k])));
  box.append(infoSection('Runners','run',runnerRows));

  // Counts: tasks/specs/agents/skills/enabled workflow steps
  const tiles=el('div','stat-tiles');
  tiles.append(statTile(`${s.done}/${s.total}`,'Tasks',`${s.pct}% done`));
  tiles.append(statTile(String((P.specs||[]).length),'Specs','files'));
  tiles.append(statTile(String((P.agents||[]).length),'Agents','personas'));
  tiles.append(statTile(String((P.skills||[]).length),'Skills','procedures'));
  tiles.append(statTile(`${enabledSteps.length}/${steps.length}`,'Workflow','steps enabled'));
  box.append(infoSection('Counts','board',tiles));

  // Specs: the P.specs filename list
  const specsList=el('ul','flatlist');
  const specs=P.specs||[];
  if(!specs.length) specsList.append(li('empty','none yet'));
  specs.forEach(sp=> specsList.append(li(null,sp)));
  box.append(infoSection('Specs','backlog',specsList));

  // Workflow: compact list of enabled steps (name + cap/skill)
  const wfList=el('div','info-wf-list');
  if(!enabledSteps.length) wfList.append(el('div','empty','No enabled workflow steps.'));
  enabledSteps.forEach(st=>{
    const row=el('div','info-wf-row');
    row.append(el('span','info-wf-name',st.name));
    const meta=[st.cap,st.skill].filter(Boolean).join(' · ');
    if(meta) row.append(el('span','info-wf-meta',meta));
    wfList.append(row);
  });
  box.append(infoSection('Workflow','workflow',wfList));
}

function openDrawer(id,keep){
  const t=allTasks().find(x=>x.id===id); if(!t) return;
  openTaskId=id;
  const b=$('#drawerBody'); const prev=keep?$('.drawer-panel').scrollTop:0; b.innerHTML='';
  b.append(el('div','d-id',t.id+' · '+(t.level||'standard')+' · '+t.file));
  b.append(el('div','d-title',t.title));
  const sSec=el('div','d-section'); sSec.append(el('div','d-label','Status'));
  const sr=el('div','status-row');
  Object.keys(STATUS).forEach(k=>{
    const btn=el('button','status-btn'+(t.status===k?' active':''),STATUS[k]);
    if(t.status===k) btn.style.background=cssv('--s-'+k);
    btn.addEventListener('click',()=>patchTask(id,{status:k}));
    sr.append(btn);
  });
  sSec.append(sr); b.append(sSec);

  const tr=runtimeTests(id);
  if(tr){ const ts=el('div','d-section'); ts.append(el('div','d-label','Tests'));
    ts.append(el('div','d-text', tr.failed?`${tr.failed} failing, ${tr.passed||0} passing`:`${tr.passed||0} passing`)); b.append(ts); }

  const cSec=el('div','d-section'); cSec.append(el('div','d-label','Comments'));
  const list=el('div','comments');
  (t.comments||[]).forEach(cm=> list.append(el('div','comment',cm)));
  if(!(t.comments||[]).length) list.append(el('div','empty','No comments.'));
  cSec.append(list);
  const box=el('div','c-box'); const ta=el('textarea'); ta.placeholder='Add a comment, a remark, feedback…';
  const actions=el('div','c-actions');
  const add=el('button','btn','Add'); const an=el('button','btn primary','Add + to analyze');
  add.addEventListener('click',()=>{ if(ta.value.trim())addComment(id,ta.value.trim(),'note'); });
  an.addEventListener('click',()=>{ if(ta.value.trim())addComment(id,ta.value.trim(),'analyze'); });
  actions.append(add,an); box.append(ta,actions);
  box.append(el('div','empty','"To analyze" moves the task back so the agent picks it up next round.'));
  cSec.append(box); b.append(cSec);
  $('#drawer').setAttribute('aria-hidden','false');
  if(keep) $('.drawer-panel').scrollTop=prev;
}
function closeDrawer(){ openTaskId=null; $('#drawer').setAttribute('aria-hidden','true'); }
const cssv=(v)=> getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#888';

// tabs — activeTab is the single source of truth (persisted), so a click sets it and applies it,
// and render()'s SSE-driven re-render (triggered by the snapshot write / polling) re-applies it
// too instead of ever resetting to Board; this is what keeps a tab selected across a race with a
// 'change'/'message' event that lands right after a click.
let activeTab = (()=>{ try{ return localStorage.getItem('spf-tab')||'board'; }catch{ return 'board'; } })();
function applyActiveTab(){
  $$('#tabs .tab').forEach(t=> t.classList.toggle('is-active', t.dataset.tab===activeTab));
  $$('.panel').forEach(p=> p.classList.toggle('is-active', p.dataset.panel===activeTab));
}
$$('#tabs .tab').forEach(tab=> tab.addEventListener('click',()=>{
  activeTab=tab.dataset.tab;
  try{ localStorage.setItem('spf-tab',activeTab); }catch{}
  applyActiveTab();
}));
applyActiveTab(); // sync to any persisted tab before the first render
// filters (status chips + search) — client-side only, does not write anything
$$('#statusChips .fchip').forEach(b=> b.addEventListener('click', ()=>{ filter.status=b.dataset.status; renderBoard(); }));
$('#search').addEventListener('input', e=>{ filter.q=e.target.value; renderBoard(); });
// backlog: independent filters + sortable column headers — client-side only
$$('#backlogStatusChips .fchip').forEach(b=> b.addEventListener('click', ()=>{ backlogFilter.status=b.dataset.status; renderBacklog(); }));
$('#backlogSearch').addEventListener('input', e=>{ backlogFilter.q=e.target.value; renderBacklog(); });
$$('#backlogTable thead th').forEach(th=> th.addEventListener('click', ()=>{
  const col=th.dataset.col;
  if(backlogSort.col===col) backlogSort.dir = backlogSort.dir==='asc'?'desc':'asc';
  else { backlogSort.col=col; backlogSort.dir='asc'; }
  renderBacklog();
}));
// theme
(function(){ const s=localStorage.getItem('spf-theme'); if(s)document.documentElement.setAttribute('data-theme',s);
  $('#themeToggle').addEventListener('click',()=>{ const c=document.documentElement.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme',n); localStorage.setItem('spf-theme',n); }); })();
// chart tooltip — a single floating layer, shown on hover over any [data-tip]
// element (area-hit rects, future hit targets) and positioned near the cursor.
(function(){
  const tip=$('#tooltip'); if(!tip) return;
  let current=null;
  document.addEventListener('mousemove',e=>{
    const target=e.target.closest && e.target.closest('[data-tip],.hit,.area-hit');
    if(!target){ if(current){ tip.hidden=true; current=null; } return; }
    if(target!==current){ tip.innerHTML=target.dataset.tip||''; current=target; }
    tip.hidden=false;
    tip.style.left=(e.clientX+14)+'px';
    tip.style.top=(e.clientY+14)+'px';
  });
  document.addEventListener('mouseleave',()=>{ tip.hidden=true; current=null; });
})();
// icons — fill every [data-icon] placeholder from the ICON map (icons.js), once at startup
(function applyIcons(){
  if(typeof ICON==='undefined') return;
  $$('[data-icon]').forEach(node=>{ const svg=ICON[node.dataset.icon]; if(svg) node.innerHTML=svg; });
})();
// chat widget
$('#runQuickBtn').addEventListener('click',()=> setChat(true));
$('#chatFab').addEventListener('click',()=> setChat($('#chat').getAttribute('aria-hidden')==='true'));
$('#chatClose').addEventListener('click',()=> setChat(false));
try{ if(localStorage.getItem('spf-chat')==='1') setChat(true); }catch{}
$('#runBtn').addEventListener('click',()=>doRun());
$('#orchBtn').addEventListener('click',()=>doOrchestrate());
$('#runPrompt').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter')doRun(); });
// Chat tab — same doRun/doOrchestrate/approve, its own textarea/select (#tabRunPrompt/#tabRunAgent)
$('#tabRunBtn').addEventListener('click',()=>doRun($('#tabRunPrompt'),$('#tabRunAgent')));
$('#tabOrchBtn').addEventListener('click',()=>doOrchestrate($('#tabRunPrompt')));
$('#tabRunPrompt').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter')doRun($('#tabRunPrompt'),$('#tabRunAgent')); });
$('#drawerClose').addEventListener('click',closeDrawer);
$('#drawerScrim').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeDrawer(); });
load(); connect();
