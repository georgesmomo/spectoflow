'use strict';
// Kept as a mutable object (not reassigned) so every existing STATUS[key] lookup keeps working
// unchanged; updateStatusLabels() (called at the top of every render()) refreshes its values from
// the current UI language, so a language change re-labels every status chip/column/legend for free.
const STATUS = { todo:'To do', in_progress:'In progress', to_validate:'To validate', to_analyze:'To analyze', done:'Done', blocked:'Blocked' };
function updateStatusLabels(){ for(const k of Object.keys(STATUS)) STATUS[k]=t('status.'+k); }
let P = null, openTaskId = null;
let filter = { status: 'all', q: '' }; // board filter state — client-side only, read-only
let boardView = (()=>{ try{ return localStorage.getItem('spf-board-view')||'list'; }catch{ return 'list'; } })(); // 'list' | 'kanban'
let backlogFilter = { status: 'open', q: '' }; // backlog defaults to open (not-done) tasks
let backlogSort = { col: 'id', dir: 'asc' };   // backlog sort state — client-side only
let backlogPage = 1; const BACKLOG_PAGE = 25;   // backlog pagination — client-side only
let attnFilter = 'open';                          // attention tab filter — client-side only
// apply the persisted design skin as early as possible (before the first paint of app-driven DOM)
(function(){ try{ const d=localStorage.getItem('spf-design'); if(d) document.documentElement.setAttribute('data-design',d); }catch{} })();

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const el=(t,c,x)=>{const e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e;};
const allTasks=()=> (P.plans||[]).flatMap(pl=>pl.phases.flatMap(ph=>ph.tasks.map(t=>({...t,file:pl.file}))));
const runtimeTests=(id)=> (P.runtime&&P.runtime.tests&&P.runtime.tests[id])||null;

async function load(){
  const r = await fetch('/api/project'); P = await r.json(); render();
  if(openTaskId) openDrawer(openTaskId,true);
}
// Coalesce bursts of SSE 'change'/'message' events into one reload so the board doesn't
// re-render (and flash) several times for a single agent action.
let loadTimer=null;
function scheduleLoad(){ clearTimeout(loadTimer); loadTimer=setTimeout(load,180); }
function connect(){
  const es = new EventSource('/api/events');
  es.onopen = ()=>{ $('#sync').classList.remove('offline'); $('#syncLabel').textContent='live'; };
  es.onmessage = (ev)=>{
    let m; try{ m=JSON.parse(ev.data); }catch{ return; }
    if(m.type==='change'||m.type==='message') return scheduleLoad(); // messages live from runtime.messages
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
  let node;
  if(m.role==='user'){ node=el('div','msg you'); node.append(el('div','bubble',m.text)); }
  else{
    node=el('div','msg agentmsg k-'+(m.kind||'message'));
    node.append(el('div','msg-role', m.role + (m.agent&&m.agent!==m.role?(' · '+m.agent):'')));
    node.append(el('div','bubble',m.text));
  }
  node.dataset.id=m.id; // lets renderChatLog tell a stale bubble from a genuinely new one
  return node;
}
function idleBlock(){ const d=el('div','chat-idle'); d.innerHTML=t('chat.idle'); return d; }
function renderChatLog(container){
  if(!container) return;
  const st=stateFor(container); const msgs=(P.runtime&&P.runtime.messages)||[];
  const ids=new Set(msgs.map(m=>m.id));
  // Summarize/Clear REPLACE the server-side log (a digest that leaves the old messages sitting right
  // below it wouldn't condense anything) — if anything we already rendered no longer exists, the log
  // was reset under us: rebuild from scratch instead of just appending, or the stale bubbles never go
  // away short of a full page reload.
  const stale=[...st.rendered].some(id=>!ids.has(id));
  if(stale){ container.innerHTML=''; st.rendered=new Set(); st.rawBlock=null; }
  if(!msgs.length){ if(!container.querySelector('.chat-idle')) container.append(idleBlock()); renderApproval(container); return; }
  clearIdle(container);
  let added=false;
  for(const m of msgs){ if(st.rendered.has(m.id)) continue; st.rendered.add(m.id); container.append(bubble(m)); added=true; }
  if(added||stale) scrollChat(container);
  renderApproval(container);
}
function renderApproval(container){
  if(!container) return;
  const o=(P.runtime&&P.runtime.orchestration)||null;
  let row=container.querySelector('.approval'); if(row) row.remove();
  if(!o || o.status!=='awaiting_approval') return;
  row=el('div','approval');
  row.append(el('div','msg-role','orchestrator · awaiting approval'));
  const a=el('button','btn primary',t('action.approve')); a.addEventListener('click',()=>approve('approve'));
  const c=el('button','btn',t('action.cancel')); c.addEventListener('click',()=>approve('cancel'));
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
  // Land where you can actually type, not wherever the log happened to be scrolled last.
  if(open) setTimeout(()=>{ scrollChat($('#chatLog')); $('#runPrompt').focus(); },60);
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
// ---- chat context management: condense the log via the agent, or wipe it (Chat tab only — the
// floating widget stays "quick access", full controls live where there's room to read them) ----
async function summarizeChat(agentEl){
  const agent=(agentEl||$('#tabRunAgent'))?.value;
  flash();
  await fetch('/api/chat/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent})});
}
async function clearChat(){
  flash();
  await fetch('/api/chat/clear',{method:'POST'});
}
async function patchTask(id,patch){ flash(); await fetch('/api/task/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); }
async function addComment(id,text,action){ flash(); await fetch('/api/task/'+encodeURIComponent(id)+'/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,action})}); }
async function toggleStep(name){ flash(); await fetch('/api/workflow/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); }
function flash(){ const s=$('#sync'); s.classList.add('saving'); $('#syncLabel').textContent='writing…'; setTimeout(()=>{ s.classList.remove('saving'); $('#syncLabel').textContent='live'; },800); }

function render(){
  const c = P.config||{};
  i18nSetLang(c.language||'en'); updateStatusLabels(); // language drives the whole UI, not just agent output
  $('#projectName').textContent = P.projectName || c.projectType || 'project';
  const bv=$('#brandVer'); if(bv){ if(P.version){ bv.textContent='v'+P.version; bv.hidden=false; } else { bv.hidden=true; } }
  // mode/language are edited live from the bar itself — see the #topMode/#topLang selects synced
  // in renderSettings() below (called on every render tick) and saved via saveSettings().
  // agent select — widget (#runAgent) and Chat tab (#tabRunAgent) each get their own populated
  // <select>, since an id can't be shared by two elements; same option list, same source of truth.
  // Shows every known agent (not just ones already in config.json → runners — a freshly-installed
  // agent works the first time, runner.js falls back to the registry default), disabling any that
  // isn't genuinely installed or can't run headless (e.g. kimi).
  [$('#runAgent'),$('#tabRunAgent')].forEach(sel=>fillAgentSelect(sel,P.knownAgents||[],runnableAgentIds(),c.agent));
  const s=SpectoStats.stats(P);
  const meterFill=$('#globalMeterFill');
  if(meterFill) meterFill.style.width=(s.pct||0)+'%';
  const meter=$('#globalMeter');
  if(meter) meter.title=`${t('kpi.globalProgress')}: ${s.pct}% (${s.done}/${s.total} ${t('kpi.tasksLabel')})`;
  renderOverview(); renderBoard(); renderBacklog(); renderWorkflow(); renderTeam();
  renderChatLog($('#chatLog')); renderChatLog($('#chatTabLog'));
  renderSidebar(); renderRequests(); renderAttention(); renderInfo(); renderDocs(); renderSettings(); renderFiles();
  renderCustomDashboards(); // adds/removes nav tabs + panels before applyActiveTab() below reads them
  applyActiveTab(); // re-apply the current tab so an SSE-driven re-render never resets to Board
  applyI18nStatic(); // re-translate the static markup (nav, headers, placeholders…) for this tick's language
}

// ---- Requests tab: tasks awaiting review/input (to_validate / to_analyze) ----
function renderRequests(){
  const list=$('#requestsList'); if(!list) return;
  const toAsk=SpectoStats.stats(P).toAsk||[];
  const count=$('#requestsCount'); if(count) count.textContent=toAsk.length;
  list.innerHTML='';
  if(!toAsk.length){ list.append(li('empty',t('requests.empty'))); return; }
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
// Capped to the 5 most recent entries by default — a long-running project's journal used to render
// its entire history inline and blow up the sidebar. "See more" reveals the rest for this session
// (client-side only; not persisted, so the rail opens compact again next visit).
const JOURNAL_PAGE=5;
let journalExpanded=false;
function renderSidebar(){ renderJournal(); }
function renderJournal(){
  const box=$('#journal'); if(!box) return;
  const msgs=((P.runtime&&P.runtime.messages)||[]).slice().reverse(); // reverse-chronological
  $('#journalCount').textContent=msgs.length;
  box.innerHTML='';
  if(!msgs.length){ box.append(el('div','empty',t('journal.empty'))); journalToggleBtn(0,0); return; }
  const shown = journalExpanded ? msgs : msgs.slice(0,JOURNAL_PAGE);
  shown.forEach(m=>{
    const row=el('div','journal-row'+(m.role==='user'?' j-you':' k-'+(m.kind||'message')));
    row.append(el('div','journal-head', m.role + (m.agent&&m.agent!==m.role?(' · '+m.agent):'')));
    row.append(el('div','journal-text', m.text));
    box.append(row);
  });
  journalToggleBtn(msgs.length, shown.length);
}
function journalToggleBtn(total,shownCount){
  const btn=$('#journalMore'); if(!btn) return;
  if(total<=JOURNAL_PAGE){ btn.hidden=true; return; }
  btn.hidden=false;
  btn.textContent = journalExpanded ? t('journal.seeLess') : t('journal.seeMore')+` (${total-shownCount})`;
}
const journalMoreBtn=$('#journalMore');
if(journalMoreBtn) journalMoreBtn.addEventListener('click',()=>{ journalExpanded=!journalExpanded; renderJournal(); });

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

function kpiCard(label,visual,sub,accent){
  const c=el('div','kpi');
  if(accent){ c.style.borderLeftColor=accent; c.classList.add('has-accent'); }
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
  kpis.append(kpiCard(t('kpi.globalProgress'), ring(s.pct,52), `${s.done}/${s.total} ${t('kpi.tasksLabel')}`, cssv('--s-done')));
  kpis.append(kpiCard(t('status.in_progress'), numBlock(s.byStatus.in_progress||0,'var(--s-in_progress)'), t('kpi.tasksLabel'), cssv('--s-in_progress')));
  kpis.append(kpiCard(t('status.to_validate'), numBlock(s.byStatus.to_validate||0,'var(--s-to_validate)'), t('kpi.awaitingReview'), cssv('--s-to_validate')));
  const r=s.running||{};
  let runVal='—', runSub=t('kpi.noRunsYet');
  if(r.agents>0){ runVal=`${r.agents} ${t('kpi.running').toLowerCase()}`; runSub=t('kpi.agentsActive'); }
  else if(r.orchestration&&r.orchestration.status){ runVal=r.orchestration.status; runSub=t('kpi.orchestration'); }
  else if(r.lastRun){ runVal=r.lastRun.status||'—'; runSub=t('kpi.lastPrefix')+(r.lastRun.tool||'—'); }
  kpis.append(kpiCard(t('kpi.running'), numBlock(runVal, r.agents>0?'var(--signal)':'var(--muted)', true), runSub, cssv('--signal')));
  box.append(kpis);

  // Status donut + legend
  const segments=s.statuses.map(k=>({key:k,value:s.byStatus[k]||0,color:cssv('--s-'+k)}));
  const d=donut(segments,140,{center:String(s.total),sub:t('chart.tasksSub')});
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
        [{name:t('chart.scope'),color:cssv('--cool'),data:hist.map(h=>h.total)},
         {name:t('chart.delivered'),color:cssv('--signal'),data:hist.map(h=>h.done)}],
        hist.map(h=>(h.date||'').slice(5)))
    : '<div class="empty">'+t('chart.noHistory')+'</div>');
  // enrich the area's hit-rect tooltips with the actual scope/delivered values
  // for that point (charts.js keeps them pure — just the date label)
  area.querySelectorAll('.area-hit').forEach((hit,i)=>{
    const h=hist[i]; if(!h) return;
    hit.dataset.tip = `<b>${h.date||''}</b><br>${t('chart.scope')}: ${h.total||0} · ${t('chart.delivered')}: ${h.done||0}`;
  });
  const topRow=el('div','overview-top');
  topRow.append(ocard(t('chart.statusDistribution'), donutRow));
  topRow.append(ocard(t('chart.scopeVsDelivered'), area));
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
  if(!steps.length) strip.append(el('div','empty',t('board.noWorkflow')));
  box.append(ocard(t('board.workflowGlance'), strip));

  // Per-phase progress bars — only phases that actually hold tasks (headings with no checkbox tasks
  // are noise, not phases), and cap the list height with an internal scroll so a big project with
  // dozens of phases can't blow up the overview.
  const phaseRows=s.phases.filter(ph=>ph.total>0).map(ph=>({label:ph.title,pct:ph.pct,sub:`${ph.done}/${ph.total}`}));
  if(phaseRows.length){
    const barsEl=bars(phaseRows);
    if(phaseRows.length>8) barsEl.classList.add('scroll-cap');
    box.append(ocard(t('board.phaseProgress',{n:phaseRows.length}), barsEl));
  }
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
  if(!(P.specs||[]).length) specs.append(li('empty',t('board.noneYet')));
  (P.specs||[]).forEach(s=> specs.append(li(null,s)));

  const running = (P.runtime&&P.runtime.agents||[]).filter(a=>a.status==='running');
  const rl=$('#running'); rl.innerHTML=''; $('#runCount').textContent=running.length;
  if(!running.length) rl.append(li('empty',t('board.noAgentRunning')));
  running.forEach(a=>{ const e=li('run-live',''); e.innerHTML=`<b>${a.tool}</b> · ${a.task||'—'}`; rl.append(e); });

  const board=$('#board'); board.innerHTML='';
  updateBoardViewToggle();
  board.classList.toggle('is-kanban', boardView==='kanban');
  if(!tasks.length){ board.append(emptyState()); return; }
  if(boardView==='kanban'){ renderKanban(board, tasks); return; } // columns by status
  let shown=0;
  (P.plans||[]).forEach(pl=> pl.phases.forEach(ph=>{
    const filtered=ph.tasks.filter(taskMatches);
    shown+=filtered.length;
    if(!filtered.length) return; // hide phases with zero matching tasks
    board.append(renderPhase(ph,pl.file,filtered));
  }));
  if(!shown) board.append(noMatchState());
  updatePhaseToggleAll();
}
// Kanban view — one column per status, filtered by the text search (columns already are the statuses).
function renderKanban(board, tasks){
  const q=filter.q.trim().toLowerCase();
  const match=(t)=> !q || (t.title+' '+t.id).toLowerCase().includes(q);
  const cols=el('div','kanban');
  Object.keys(STATUS).forEach(st=>{
    const colTasks=tasks.filter(t=> t.status===st && match(t));
    const col=el('div','kanban-col');
    const head=el('div','kanban-col-head');
    const dot=el('span','kanban-dot'); dot.style.background='var(--s-'+st+')';
    head.append(dot, el('span','kanban-col-title',STATUS[st]||st), el('span','kanban-col-count',String(colTasks.length)));
    col.append(head);
    const body=el('div','kanban-col-body');
    if(!colTasks.length) body.append(el('div','kanban-empty','—'));
    colTasks.forEach(t=> body.append(renderTask(t)));
    col.append(body); cols.append(col);
  });
  board.append(cols);
}
function updateBoardViewToggle(){ $$('#boardViewToggle .vt-btn').forEach(b=> b.classList.toggle('active', b.dataset.view===boardView)); }
function li(cls,txt){ const e=el('li',cls); e.textContent=txt; return e; }
function emptyState(){ const d=el('div','empty'); d.style.padding='40px'; d.textContent=t('board.noPlans'); return d; }
function noMatchState(){ const d=el('div','empty'); d.style.padding='40px'; d.textContent=t('board.noTasksMatch'); return d; }

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
  if(backlogFilter.status==='open'){ if(r.status==='done') return false; }       // "open" = every not-done task
  else if(backlogFilter.status!=='all' && r.status!==backlogFilter.status) return false;
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
  const pages=Math.max(1,Math.ceil(filtered.length/BACKLOG_PAGE));
  if(backlogPage>pages) backlogPage=pages;
  if(backlogPage<1) backlogPage=1;
  body.innerHTML='';
  if(!all.length){ body.append(backlogEmptyRow(t('board.noPlans'))); return renderBacklogPager(0,1); }
  if(!filtered.length){ body.append(backlogEmptyRow(t('board.noTasksMatch'))); return renderBacklogPager(0,1); }
  const start=(backlogPage-1)*BACKLOG_PAGE;
  filtered.slice(start,start+BACKLOG_PAGE).forEach(r=> body.append(backlogRow(r)));
  renderBacklogPager(filtered.length,pages);
}
function renderBacklogPager(total,pages){
  const pager=$('#backlogPager'); if(!pager) return; pager.innerHTML='';
  if(total<=BACKLOG_PAGE){ if(total) pager.append(el('span','pager-info', t(total>1?'backlog.pagerTasks':'backlog.pagerTask',{n:total}))); return; }
  const prev=el('button','pager-btn',t('backlog.prev')); prev.disabled=backlogPage<=1;
  prev.addEventListener('click',()=>{ backlogPage--; renderBacklog(); });
  const next=el('button','pager-btn',t('backlog.next')); next.disabled=backlogPage>=pages;
  next.addEventListener('click',()=>{ backlogPage++; renderBacklog(); });
  const from=(backlogPage-1)*BACKLOG_PAGE+1, to=Math.min(total,backlogPage*BACKLOG_PAGE);
  pager.append(prev, el('span','pager-info',t('backlog.pagerRange',{from,to,total,page:backlogPage,pages})), next);
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

// ---- phase expand state: we track which phases are EXPANDED (default = none), so on a big
// project the board opens compact — just phase headers with progress — and the user opens what
// they need. Persisted per phase title (guarded for private mode). ----
function loadExpanded(){
  try{ const raw=localStorage.getItem('spf-expanded'); const arr=raw?JSON.parse(raw):[]; return new Set(Array.isArray(arr)?arr:[]); }
  catch{ return new Set(); }
}
function saveExpanded(set){ try{ localStorage.setItem('spf-expanded', JSON.stringify([...set])); }catch{} }
let expandedPhases=loadExpanded();
function allPhaseTitles(){ const set=new Set(); (P.plans||[]).forEach(pl=> pl.phases.forEach(ph=> set.add(ph.title))); return [...set]; }
function updatePhaseToggleAll(){
  const btn=$('#phaseToggleAll'); if(!btn) return;
  const titles=allPhaseTitles();
  const allOpen = titles.length>0 && titles.every(x=> expandedPhases.has(x));
  btn.textContent = allOpen ? t('board.collapseAll') : t('board.expandAll');
  btn.dataset.state = allOpen ? 'open' : 'closed';
}

function renderPhase(ph,file,filteredTasks){
  const isCollapsed=!expandedPhases.has(ph.title);
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
    if(now) expandedPhases.delete(ph.title); else expandedPhases.add(ph.title);
    saveExpanded(expandedPhases); updatePhaseToggleAll();
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

// Plain-language explanation of what each workflow step does, resolved from the step name — so the
// detail zone teaches the user what the pipeline is, not just that a step exists.
function wfDesc(s){
  const n=String(s.name||'').toLowerCase();
  if(/brainstorm|idea|intake/.test(n)) return t('wf.desc.brainstorm');
  if(/analy/.test(n)) return t('wf.desc.analysis');
  if(/spec/.test(n)) return t('wf.desc.spec');
  if(/plan/.test(n)) return t('wf.desc.plan');
  if(/develop|implement|\bcode\b/.test(n)) return t('wf.desc.develop');
  if(/integration/.test(n)) return t('wf.desc.integration');
  if(/end.?to.?end|e2e/.test(n)) return t('wf.desc.e2e');
  if(/unit/.test(n)||/\btest/.test(n)) return t('wf.desc.unit');
  if(/review/.test(n)) return t('wf.desc.review');
  if(/deploy|ship|release|publish/.test(n)) return t('wf.desc.deploy');
  return t('wf.desc.fallback');
}
let wfPopStep=null; // name of the step whose click-popover is open (null = closed)

// Workflow — a horizontal pipeline of representative icons with directional arrows. Clicking a step
// opens a floating popover (tooltip-style, anchored to the step) with what it does, its
// capability/agent/skill, and the enable/disable button. On narrow screens the pipeline reflows into
// a centered wrap (no horizontal scroll).
function renderWorkflow(){
  const box=$('#wfDiagram'); box.innerHTML='';
  const steps=P.workflow||[];
  if(!steps.length){ box.append(el('div','empty',t('board.noWorkflow'))); closeWfPop(); return; }
  const enabledCount=steps.filter(s=>s.enabled).length;
  const legend=el('div','wf-legend');
  legend.append(el('span','wf-legend-dot'));
  legend.append(el('span','wf-legend-txt',t('workflow.stepsEnabled',{enabled:enabledCount,total:steps.length})));
  box.append(legend);
  const pipe=el('div','wf-pipeline');
  steps.forEach((s,i)=>{
    const step=el('div','wf-step2'+(s.enabled?' on':' off')+(s.name===wfPopStep?' is-selected':'')); step.style.setProperty('--i',i); step.dataset.idx=i;
    step.tabIndex=0; step.setAttribute('role','button'); step.setAttribute('aria-expanded',String(s.name===wfPopStep));
    step.title=s.name;
    const circle=el('div','wf-circle');
    circle.innerHTML=(typeof ICON!=='undefined'&&ICON.wf)?ICON.wf(s.name):'';
    step.append(circle);
    const cap=el('div','wf-caption'); cap.append(document.createTextNode(s.name));
    if(s.optional) cap.append(el('span','wf-opt2',t('workflow.optional')));
    step.append(cap);
    const sel=(e)=>{ if(e) e.stopPropagation(); if(wfPopStep===s.name) closeWfPop(); else openWfPop(s.name); };
    step.addEventListener('click',sel);
    step.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); sel(e); } });
    pipe.append(step);
    if(i<steps.length-1) pipe.append(el('div','wf-link'+(s.enabled&&steps[i+1].enabled?' on':'')));
  });
  box.append(pipe);
  if(wfPopStep) renderWfPop(); // re-anchor / refresh an open popover after a live re-render
}
function wfDetailRow(k,v){ const r=el('div','wf-detail-row'); r.append(el('span','wf-detail-k',k), el('span','wf-detail-v',v)); return r; }
function wfPopFill(pop, s, idx){
  const skill=(P.skills||[]).find(x=>x.name===s.skill);
  const agent=(P.agents||[]).find(a=>a.capability===s.cap);
  pop.innerHTML='';
  const head=el('div','wf-detail-head');
  head.append(el('span','wf-detail-num',String(idx+1)));
  head.append(el('span','wf-detail-name',s.name));
  head.append(el('span','wf-detail-status '+(s.enabled?'on':'off'), s.enabled?t('workflow.enabled'):t('workflow.disabled')));
  if(s.optional) head.append(el('span','wf-opt',t('workflow.optional')));
  pop.append(head);
  pop.append(el('p','wf-detail-desc', wfDesc(s)));
  const grid=el('div','wf-detail-grid');
  grid.append(wfDetailRow(t('workflow.capability'), s.cap||'—'));
  grid.append(wfDetailRow(t('workflow.handledBy'), agent?(agent.title||agent.name):'—'));
  grid.append(wfDetailRow(t('workflow.skill'), s.skill||'—'));
  if(skill&&skill.standard) grid.append(wfDetailRow(t('workflow.standard'), skill.standard));
  if(skill&&(skill.inputs||skill.outputs)) grid.append(wfDetailRow(t('workflow.flow'), (skill.inputs||'—')+'  →  '+(skill.outputs||'—')));
  pop.append(grid);
  if(skill&&skill.description){ const sk=el('div','wf-detail-skill'); sk.append(el('b',null,t('workflow.skillPrefix',{name:skill.name}))); sk.append(document.createTextNode(skill.description)); pop.append(sk); }
  const btn=el('button','btn '+(s.enabled?'':'primary')+' wf-detail-btn', s.enabled?t('workflow.disableStep'):t('workflow.enableStep'));
  btn.addEventListener('click',(e)=>{ e.stopPropagation(); toggleStep(s.name); });
  const actions=el('div','wf-pop-actions'); actions.append(btn); pop.append(actions);
}
function openWfPop(name){ wfPopStep=name; renderWfPop(); }
function closeWfPop(){ wfPopStep=null; const p=$('#wfPop'); if(p) p.hidden=true; $$('#wfDiagram .wf-step2.is-selected').forEach(x=>x.classList.remove('is-selected')); }
function renderWfPop(){
  const p=$('#wfPop'); if(!p) return;
  const steps=P.workflow||[]; const idx=steps.findIndex(s=>s.name===wfPopStep);
  if(idx<0){ closeWfPop(); return; }
  const anchor=$('#wfDiagram .wf-step2[data-idx="'+idx+'"]');
  if(!anchor){ p.hidden=true; return; }
  $$('#wfDiagram .wf-step2.is-selected').forEach(x=>x.classList.remove('is-selected')); anchor.classList.add('is-selected');
  wfPopFill(p, steps[idx], idx);
  positionWfPop(anchor.querySelector('.wf-circle')||anchor, p);
}
function positionWfPop(anchorEl, pop){
  const r=anchorEl.getBoundingClientRect();
  const vpH=window.innerHeight, m=12, edge=10;
  const below=vpH - r.bottom - m - edge;   // room below the step
  const above=r.top - m - edge;            // room above the step
  // Prefer below; flip above only when below is cramped and above has more room. Then cap the
  // popover's height to the space on the chosen side so it always fits the viewport and scrolls
  // internally (the enable/disable button stays reachable via the sticky footer).
  const useAbove = below < 240 && above > below;
  pop.style.visibility='hidden'; pop.hidden=false; pop.classList.remove('above');
  pop.style.maxHeight=Math.max(160, (useAbove?above:below))+'px';
  const pw=pop.offsetWidth;
  const left=Math.max(edge, Math.min(r.left + r.width/2 - pw/2, window.innerWidth-pw-edge));
  if(useAbove){ pop.style.top=(r.top - m - pop.offsetHeight)+'px'; pop.classList.add('above'); }
  else { pop.style.top=(r.bottom + m)+'px'; }
  pop.style.left=left+'px';
  pop.style.setProperty('--caret-x', ((r.left + r.width/2) - left)+'px');
  pop.style.visibility='';
}

// ---- Attention tab: agent/user-raised points; validate → real task ----------
function attnItems(){ return (P.runtime&&P.runtime.attention)||[]; }
function renderAttention(){
  const list=$('#attnList'); if(!list) return;
  const items=attnItems();
  const openN=items.filter(i=>i.status!=='resolved').length;
  const badge=$('#attnBadge'); if(badge){ badge.textContent=openN; badge.hidden=openN===0; }
  const count=$('#attnCount'); if(count) count.textContent=items.length;
  $$('.attn-filters .fchip').forEach(b=> b.classList.toggle('active', b.dataset.attn===attnFilter));
  const shown=items.filter(i=> attnFilter==='all' ? true : attnFilter==='resolved' ? i.status==='resolved' : i.status!=='resolved');
  list.innerHTML='';
  if(!shown.length){ list.append(el('div','empty', attnFilter==='resolved'?t('attn.emptyResolved'):t('attn.emptyOpen'))); return; }
  shown.forEach(it=> list.append(attnRow(it)));
}
function attnRow(it){
  const row=el('div','attn-row'+(it.status==='resolved'?' is-resolved':'')+(it.source==='agent'?' from-agent':''));
  const head=el('div','attn-head');
  head.append(el('span','attn-src '+(it.source==='agent'?'is-agent':'is-user'), it.source==='agent'?('⚑ '+(it.by||t('attn.agentFallback'))):('✎ '+t('attn.you'))));
  if(it.at) head.append(el('span','attn-time',(String(it.at).replace('T',' ')).slice(0,16)));
  if(it.status==='resolved') head.append(el('span','chip s-done', it.promotedTo?('→ '+it.promotedTo):t('attn.resolvedChip')));
  row.append(head);
  const txt=el('div','attn-text', it.text); row.append(txt);
  const acts=el('div','attn-actions');
  if(it.status!=='resolved'){
    const val=el('button','btn primary',t('action.validateToTask')); val.addEventListener('click',()=>promoteAttn(it.id));
    const res=el('button','btn',t('action.resolve')); res.addEventListener('click',()=>patchAttn(it.id,{status:'resolved'}));
    const edit=el('button','btn',t('action.edit')); edit.addEventListener('click',()=>editAttn(it,txt));
    acts.append(val,res,edit);
  }else{
    const re=el('button','btn',t('action.reopen')); re.addEventListener('click',()=>patchAttn(it.id,{status:'open'})); acts.append(re);
  }
  const del=el('button','btn danger',t('action.delete')); del.addEventListener('click',()=>deleteAttn(it.id));
  acts.append(del); row.append(acts);
  return row;
}
function editAttn(it,txtNode){
  const ta=el('textarea','attn-edit'); ta.value=it.text; txtNode.replaceWith(ta); ta.focus();
  let done=false;
  const save=()=>{ if(done) return; done=true; const v=ta.value.trim(); if(v&&v!==it.text) patchAttn(it.id,{text:v}); else renderAttention(); };
  ta.addEventListener('blur',save);
  ta.addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); save(); } if(e.key==='Escape'){ done=true; renderAttention(); } });
}
async function addAttn(text){ flash(); await fetch('/api/attention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }

// ---- Backlog "+ Add task" — a manual checkbox task, no agent involved ----
function openBacklogAddForm(){
  const form=$('#backlogAddForm'); if(!form) return;
  const list=$('#blPhaseList');
  if(list){ list.innerHTML=''; allPhaseTitles().forEach(ti=> list.append(new Option(ti))); }
  const err=$('#blAddError'); if(err) err.hidden=true;
  form.hidden=false; form.classList.add('is-open');
  $('#blAddTitle').focus();
}
function closeBacklogAddForm(){
  const form=$('#backlogAddForm'); if(!form) return;
  form.hidden=true; form.classList.remove('is-open');
  ['blAddTitle','blAddPhase','blAddOwner'].forEach(id=>{ const f=$('#'+id); if(f) f.value=''; });
  const lvl=$('#blAddLevel'); if(lvl) lvl.value='standard';
}
async function submitBacklogAdd(){
  const err=$('#blAddError');
  const title=($('#blAddTitle').value||'').trim();
  if(!title){ if(err){ err.textContent=t('backlog.addTitleRequired'); err.hidden=false; } $('#blAddTitle').focus(); return; }
  const phase=($('#blAddPhase').value||'').trim();
  const owner=($('#blAddOwner').value||'').trim();
  const level=$('#blAddLevel').value;
  flash();
  const r=await fetch('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title, phase:phase||undefined, owner:owner||undefined, level})});
  if(!r.ok){
    const j=await r.json().catch(()=>({}));
    if(err){ err.textContent=j.error||t('backlog.addFailed'); err.hidden=false; }
    return;
  }
  closeBacklogAddForm();
}
async function patchAttn(id,patch){ flash(); await fetch('/api/attention/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); }
async function deleteAttn(id){ flash(); await fetch('/api/attention/'+encodeURIComponent(id),{method:'DELETE'}); }
async function promoteAttn(id){ flash(); await fetch('/api/attention/'+encodeURIComponent(id)+'/promote',{method:'POST'}); }

// ---- Settings tab + topbar quick-switch: change autonomy mode + output language (writes config.json) ----
// Mode/language can be changed from two places — the Settings tab (#setMode/#setLang) and the
// always-visible topbar selects (#topMode/#topLang, in .brand-sub, present in every design). Both
// pairs are kept in sync: renderSettings() (every render tick) writes the current config into all
// four; a change on any one immediately mirrors into its sibling before saving, so saveSettings()
// never reads a stale value from the pair the user didn't touch.
function fillLangSelect(sel,lang){
  if(!sel) return;
  if(![...sel.options].some(o=>o.value===lang)){ const o=document.createElement('option'); o.value=lang; o.textContent=lang; sel.append(o); }
  sel.value=lang;
}
function setLangSelect(lang){ fillLangSelect($('#setLang'),lang); fillLangSelect($('#topLang'),lang); }
function setModeSelects(mode){ [$('#setMode'),$('#topMode')].forEach(s=>{ if(s) s.value=mode; }); }

// ---- active agent: always visible (topbar #topAgent) + editable (Settings #setAgent). Never lets
// the user activate an agent that isn't actually installed — options for a not-installed known agent
// are present but disabled, and P.installedAgents itself comes from the server testing each agent's
// real CLI (bin on PATH, or the project's own config dir), not a guess.
// ids that can actually be SPAWNED right now: installed AND headless-capable (a known agent like
// kimi can be "installed" and even the active agent, but nothing can run it non-interactively).
function runnableAgentIds(){
  const installed=P.installedAgents||[];
  return (P.knownAgents||[]).filter(a=>a.headless&&installed.includes(a.id)).map(a=>a.id);
}
function fillAgentSelect(sel,known,installed,active){
  if(!sel) return;
  const empty=!installed.length;
  sel.classList.toggle('is-empty',empty);
  sel.disabled=empty;
  if(empty){ sel.innerHTML=''; const o=document.createElement('option'); o.value=''; o.textContent=t('topbar.agent.none'); sel.append(o); return; }
  const sig=known.map(a=>a.id+':'+(installed.includes(a.id)?1:0)).join(',');
  if(sel.dataset.sig!==sig){
    sel.innerHTML='';
    known.forEach(a=>{
      const o=document.createElement('option'); o.value=a.id; o.textContent=a.label;
      if(!installed.includes(a.id)) o.disabled=true;
      sel.append(o);
    });
    sel.dataset.sig=sig;
  }
  if(active) sel.value=active;
}
function setAgentSelects(){
  const c=(P&&P.config)||{};
  const known=P.knownAgents||[], installed=P.installedAgents||[];
  fillAgentSelect($('#topAgent'),known,installed,c.agent);
  fillAgentSelect($('#setAgent'),known,installed,c.agent);
  const hint=$('#setAgentHint'); if(hint){ const empty=!installed.length; hint.hidden=!empty; hint.classList.toggle('is-empty',empty); if(empty) hint.textContent=t('topbar.agent.none'); }
}
function showAgentError(msg){
  const hint=$('#setAgentHint'); if(!hint) return;
  hint.hidden=false; hint.classList.add('is-empty'); hint.textContent=msg;
  setTimeout(()=>{ if(P&&P.installedAgents&&P.installedAgents.length) hint.hidden=true; },4000);
}
async function saveAgent(id){
  if(!id) return;
  flash();
  const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent:id})});
  if(!r.ok){ const body=await r.json().catch(()=>({})); showAgentError(body.error||t('topbar.agent.none')); setAgentSelects(); return; }
}
// ---- design skins (data-design) — switchable, persisted per viewer + as the project default ----
function currentDesign(){ return document.documentElement.getAttribute('data-design')||'console'; }
function applyDesign(id){ document.documentElement.setAttribute('data-design',id); try{ localStorage.setItem('spf-design',id); }catch{} }
async function saveDesign(id){ applyDesign(id); if(P) render(); /* re-read token colours into the SVG charts */ flash(); try{ await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:id})}); }catch{} }

function renderSettings(){
  const c=(P&&P.config)||{};
  setModeSelects(c.mode||'semi');
  setLangSelect(c.language||'en');
  setAgentSelects();
  // design switcher — options from the DESIGNS registry (designs.js)
  const dsel=$('#setDesign');
  if(dsel){
    const designs=(typeof DESIGNS!=='undefined')?DESIGNS:[{id:'control-room',name:'Control Room'}];
    if(dsel.options.length!==designs.length){ dsel.innerHTML=''; designs.forEach(d=>{ const o=document.createElement('option'); o.value=d.id; o.textContent=d.name; if(d.desc) o.title=d.desc; dsel.append(o); }); }
    // reconcile: a per-viewer choice (localStorage) wins; else the project default (config.design)
    let active; try{ active=localStorage.getItem('spf-design'); }catch{}
    if(!active && c.design) active=c.design;
    if(active && active!==currentDesign() && designs.some(d=>d.id===active)) document.documentElement.setAttribute('data-design',active);
    dsel.value=currentDesign();
  }
  const box=$('#settingsReadonly');
  if(box){
    box.innerHTML='';
    const rows=[[t('info.activeAgent'),c.agent||'—'],[t('info.projectType'),c.projectType||'—'],
      [t('field.plansFolder'),c.plansDir||'plans'],[t('field.specsFolder'),c.specsDir||'specs'],
      [t('field.frameworkVersion'), P&&P.version?('v'+P.version):'—']];
    rows.forEach(([k,v])=>{ const r=el('div','settings-ro-row'); r.append(el('span','settings-ro-k',k), el('span','settings-ro-v',String(v))); box.append(r); });
  }
  const fv=$('#footerVer'); if(fv) fv.textContent = (P&&P.version) ? ('v'+P.version) : '';
  renderCustomize();
}
async function saveSettings(){
  flash();
  const mode=($('#setMode')||$('#topMode')).value, language=($('#setLang')||$('#topLang')).value;
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,language})});
  const s=$('#settingsSaved'); if(s){ s.hidden=false; setTimeout(()=>{ s.hidden=true; },1500); }
}

// ---- Custom dashboards (Customize page → generate-dashboard skill) ---------------------------
// A custom dashboard is a DECLARATIVE block spec (.spectoflow/dashboard/custom/<id>.json, embedded
// in P.customDashboards by the server) — never raw HTML/CSS/JS. Every block below reuses the exact
// same components the built-in Board renders with (kpiCard/ocard/bars/donut/statTile/mdLite/el), so a
// generated dashboard automatically matches the active design — and any design switched to later —
// with zero page-specific styling. Mirrors the schema in .spectoflow/lib/custom-dashboard.js (the
// Node-side validator); this is the independent browser-side reader for the same shape.
function resolveBind(s,bindPath,fallback){
  if(bindPath==null) return fallback;
  let v=s;
  for(const p of String(bindPath).split('.')){ if(v==null) return fallback; v=v[p]; }
  return v==null?fallback:v;
}
function renderCustomBlock(b,s){
  switch(b.type){
    case 'markdown': return htmlBlock('cd-markdown', mdLite(b.content||''));
    case 'kpi-row': {
      const row=el('div','kpi-row');
      (b.items||[]).forEach(it=>{
        const val=it.bind!=null?resolveBind(s,it.bind,it.value):it.value;
        row.append(kpiCard(it.label||'', numBlock(val==null?'—':val,it.color||'var(--signal)'), it.sub||'', cssv(it.colorVar||'--signal')));
      });
      return row;
    }
    case 'chart-bars': {
      const rows=(b.rows||[]).map(r=>({label:r.label||'', pct:r.bind!=null?(resolveBind(s,r.bind,r.pct||0)):(r.pct||0), sub:r.sub||''}));
      return ocard(b.title||'', bars(rows));
    }
    case 'chart-donut': {
      const segs=(b.segments||[]).map(g=>({key:g.key||'', value:g.bind!=null?(resolveBind(s,g.bind,g.value||0)):(g.value||0), color:cssv(g.colorVar||'--muted')}));
      const total=segs.reduce((a,x)=>a+(Number(x.value)||0),0);
      const d=donut(segs,140,{center:String(total),sub:t('chart.tasksSub')});
      const legend=el('div','legend');
      segs.forEach(seg=>{ const item=el('div','legend-item'); const sw=el('span','legend-swatch'); sw.style.background=seg.color; item.append(sw, el('span','legend-label',seg.key), el('span','legend-count',String(seg.value))); legend.append(item); });
      const row=el('div','donut-row'); row.append(d.wrap,legend);
      return ocard(b.title||'', row);
    }
    case 'table': {
      const wrap=el('div','table-scroll'); const tbl=el('table','backlog-table');
      const thead=el('thead'); const htr=el('tr'); (b.columns||[]).forEach(c=>htr.append(el('th',null,String(c)))); thead.append(htr); tbl.append(thead);
      const tbody=el('tbody'); (b.rows||[]).forEach(r=>{ const tr=el('tr'); (r||[]).forEach(c=>tr.append(el('td',null,String(c)))); tbody.append(tr); }); tbl.append(tbody);
      wrap.append(tbl);
      return b.title? ocard(b.title,wrap) : wrap;
    }
    case 'list': {
      const ul=el('ul','flatlist'); (b.items||[]).forEach(x=>ul.append(li(null,String(x))));
      return b.title? ocard(b.title,ul) : ul;
    }
    case 'stat-tile-row': {
      const row=el('div','stat-tiles');
      (b.items||[]).forEach(it=>{ const val=it.bind!=null?resolveBind(s,it.bind,it.value):it.value; row.append(statTile(val==null?'—':String(val), it.label||'', it.sub||'')); });
      return row;
    }
    default: return el('div','empty','Unknown block type: '+b.type);
  }
}
function customDashboardTabs(){ return $$('#tabs .tab[data-tab^="custom:"]'); }
// Adds/removes nav tabs + panels to match P.customDashboards, and refreshes an existing tab's label
// if the dashboard was regenerated with a new title. Console's rail and Orbit's radial menu both read
// #tabs live, so a custom tab appears in either design's navigation with no design-specific change.
function syncCustomTabs(list){
  const tabsNav=$('#tabs'); if(!tabsNav) return;
  const wanted=new Set(list.map(spec=>'custom:'+spec.id));
  customDashboardTabs().forEach(btn=>{
    const id=btn.dataset.tab;
    if(!wanted.has(id)){ const panel=$('.panel[data-panel="'+id+'"]'); if(panel) panel.remove(); btn.remove(); }
  });
  list.forEach(spec=>{
    const id='custom:'+spec.id;
    let btn=$('#tabs .tab[data-tab="'+id+'"]');
    if(!btn){
      btn=el('button','tab'); btn.dataset.tab=id;
      const icoKey=spec.icon||'info';
      const ico=el('span','tab-ico'); ico.dataset.icon=icoKey; if(typeof ICON!=='undefined'&&ICON[icoKey]) ico.innerHTML=ICON[icoKey];
      btn.append(ico, el('span','tab-label',spec.title||spec.id));
      btn.addEventListener('click',()=>navigateTab(id));
      tabsNav.append(btn);
      const panel=el('section','panel'); panel.dataset.panel=id;
      const wrap=el('div','custom-dash-wrap');
      wrap.append(el('h2','panel-title',spec.title||spec.id));
      wrap.append(el('div','custom-dash-body'));
      panel.append(wrap);
      $('.stage').append(panel);
    } else {
      const lbl=btn.querySelector('.tab-label'); if(lbl) lbl.textContent=spec.title||spec.id;
      const title=$('.panel[data-panel="'+id+'"] .panel-title'); if(title) title.textContent=spec.title||spec.id;
    }
  });
}
function renderCustomDashboards(){
  const list=P.customDashboards||[];
  syncCustomTabs(list);
  const s=SpectoStats.stats(P);
  list.forEach(spec=>{
    const box=$('.panel[data-panel="custom:'+spec.id+'"] .custom-dash-body'); if(!box) return;
    box.innerHTML='';
    (spec.blocks||[]).forEach(b=> box.append(renderCustomBlock(b,s)));
  });
}

// ---- Settings → Customize: add dashboards/skills/agents by description, or "Auto" -------------
// Generation itself is real agent work (research, clarify, write a file) — this UI never does it
// client-side. It just constructs a plain-language prompt (recognized by AGENTS.md's Router, which
// hands it to framework-curator) and sends it through the SAME /api/run + group-chat pipeline every
// other "Run" already uses, then jumps to Chat so the requester watches it happen and can answer any
// clarifying question there — no separate conversational UI to build or keep in sync.
const CZ_KINDS=[
  { kind:'dashboard', promptAdd:(d)=>'Add a custom dashboard: '+d, promptAuto:'Propose dashboard candidates for this project (Auto customize)' },
  { kind:'skill',     promptAdd:(d)=>'Create a new skill: '+d,     promptAuto:'Propose skill candidates for this project (Auto customize)' },
  { kind:'agent',     promptAdd:(d)=>'Create a new agent: '+d,     promptAuto:'Propose agent candidates for this project (Auto customize)' },
];
function czItemsFor(kind){
  if(kind==='dashboard') return (P.customDashboards||[]).map(spec=>({ title:spec.title||spec.id, sub:(spec.blocks||[]).length+' '+t('customize.blocksSub'), open:()=>navigateTab('custom:'+spec.id) }));
  if(kind==='skill') return (P.skills||[]).filter(s=>s.custom).map(s=>({ title:s.name, sub:s.description||'', open:()=>openFileDrawer('skill',s) }));
  return (P.agents||[]).filter(a=>a.custom).map(a=>({ title:a.title||a.name, sub:a.description||'', open:()=>openFileDrawer('agent',a) }));
}
function renderCustomize(){
  const root=$('#czRoot'); if(!root) return;
  const openKind=root.dataset.open||'';
  // a block with its form open spans the full row (see CSS) — an auto-fit grid would otherwise
  // still reserve empty trailing cells beside it for the two collapsed blocks that no longer fill
  // out a row, so drop to a single column for the whole grid while any block is open.
  root.classList.toggle('has-open', !!openKind);
  root.innerHTML='';
  CZ_KINDS.forEach(({kind})=>{
    const items=czItemsFor(kind);
    const block=el('div','cz-block'+(openKind===kind?' is-open':''));
    const head=el('div','cz-head');
    head.append(el('h3',null,t('customize.'+kind+'s')+' ('+items.length+')'));
    const addBtn=el('button','btn cz-add',t('customize.add.'+kind));
    addBtn.setAttribute('aria-expanded',String(openKind===kind));
    addBtn.addEventListener('click',()=>{ root.dataset.open=(openKind===kind)?'':kind; renderCustomize(); });
    head.append(addBtn); block.append(head);
    const list=el('div','cz-list');
    if(!items.length) list.append(el('div','empty',t('customize.empty.'+kind)));
    items.forEach(it=>{
      const row=el('div','cz-item'); row.tabIndex=0;
      row.append(el('span','cz-item-title',it.title));
      if(it.sub) row.append(el('span','cz-item-sub',it.sub));
      row.addEventListener('click',it.open);
      row.addEventListener('keydown',(e)=>{ if(e.key==='Enter') it.open(); });
      list.append(row);
    });
    block.append(list);
    if(openKind===kind){
      const form=el('div','cz-form');
      const ta=el('textarea','chat-ta'); ta.placeholder=t('customize.describePh');
      const sel=el('select','chat-agent');
      fillAgentSelect(sel,P.knownAgents||[],runnableAgentIds(),P.config&&P.config.agent);
      const actions=el('div','cz-form-actions');
      const autoBtn=el('button','btn',t('customize.auto'));
      const goBtn=el('button','btn primary',t('customize.generate'));
      autoBtn.addEventListener('click',()=>czSubmit(kind,null,sel.value));
      goBtn.addEventListener('click',()=>{ const v=ta.value.trim(); if(v) czSubmit(kind,v,sel.value); });
      actions.append(sel,autoBtn,goBtn);
      form.append(ta,actions);
      block.append(form);
    }
    root.append(block);
  });
}
async function czSubmit(kind,description,agent){
  const cfg=CZ_KINDS.find((c)=>c.kind===kind);
  const prompt=description?cfg.promptAdd(description):cfg.promptAuto;
  await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,agent})});
  const root=$('#czRoot'); if(root) root.dataset.open='';
  navigateTab('chat');
}

// ---- client-side routing: /<tab>[/<taskId>] via the History API ------------
// A custom dashboard (Customize page) gets its own tab id "custom:<id>" and its own URL shape
// /custom/<id> — kept out of ROUTES (a fixed list) since the set of custom ids is dynamic; recognized
// by a dedicated branch in tabFromPath()/navigateTab() instead.
const ROUTES=['board','requests','attention','backlog','workflow','team','files','chat','info','docs','personalize'];
// the tab used to be named/routed "settings" — old bookmarks and any localStorage value saved
// under that name still land on the Personalize tab instead of a blank panel.
function normalizeTab(t){ return t==='settings'?'personalize':t; }
function tabFromPath(){
  const s=location.pathname.split('/').filter(Boolean);
  if(s[0]==='custom'&&s[1]) return 'custom:'+decodeURIComponent(s[1]);
  const t=normalizeTab(s[0]);
  return ROUTES.includes(t)?t:null;
}
function taskFromPath(){ const s=location.pathname.split('/').filter(Boolean); return (ROUTES.includes(s[0])&&s[1])?decodeURIComponent(s[1]):null; }
function navigateTab(tabId,push){
  activeTab=tabId; try{ localStorage.setItem('spf-tab',tabId); }catch{}
  if(push!==false){
    const isCustom=tabId.indexOf('custom:')===0;
    history.pushState(null,'', isCustom ? '/custom/'+encodeURIComponent(tabId.slice(7)) : '/'+tabId);
  }
  applyActiveTab();
  closeNav(); // a tab pick closes the mobile menu
  // Landing on Chat: go straight to where you can read the latest and type, not wherever the log
  // was scrolled to last (only on an actual switch INTO the tab — applyActiveTab() alone runs on
  // every SSE render tick too, and re-scrolling/re-focusing there would fight the user's typing).
  if(tabId==='chat') setTimeout(()=>{ scrollChat($('#chatTabLog')); $('#tabRunPrompt').focus(); },60);
  if(tabId==='files') renderFiles(); // the tree is fetched lazily — only load it on an actual switch in
}
function closeNav(){ document.body.classList.remove('nav-open'); const nt=$('#navToggle'); if(nt) nt.setAttribute('aria-expanded','false'); }

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
  const std=chipRow(t('team.standardsLabel'),a.standards); if(std) c.append(std);
  const uses=chipRow(t('team.usesLabel'),a.uses); if(uses) c.append(uses);
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
  const std=chipRow(t('team.standardLabel'), s.standard?[s.standard]:null); if(std) c.append(std);
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
  const inline=s=> s
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>') // [text](url)
    .replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g,'$1<a href="$2" target="_blank" rel="noopener">$2</a>'); // bare https://… URLs, skipping ones already inside an href/text we just built
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
  b.append(el('div','d-id', kind==='agent'?t('drawer.agent'):t('drawer.skill')));
  b.append(el('div','d-title', obj.title||obj.name));
  const sec=el('div','d-section'); sec.append(el('div','d-label',t('drawer.file',{rel})));
  const body=el('div','md-body'); body.append(el('div','empty',t('drawer.loading')));
  sec.append(body); b.append(sec);
  $('#drawer').setAttribute('aria-hidden','false');
  try{
    const r=await fetch('/api/agentfile?path='+encodeURIComponent(rel));
    const data=await r.json().catch(()=>({}));
    if(!r.ok){ body.innerHTML=''; body.append(el('div','empty', data.error||t('drawer.loadError'))); return; }
    body.innerHTML=mdLite(data.content||'');
  }catch(err){
    body.innerHTML=''; body.append(el('div','empty',t('drawer.loadError')));
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
  const tile=el('div','stat-tile');
  tile.append(el('div','stat-tile-val',String(value)));
  tile.append(el('div','stat-tile-label',label));
  if(sub) tile.append(el('div','stat-tile-sub',sub));
  return tile;
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
  projRows.append(infoRow(t('info.projectType'), c.projectType||'—'));
  projRows.append(infoRow(t('info.mode'), c.mode||'—'));
  projRows.append(infoRow(t('info.language'), c.language||'—'));
  projRows.append(infoRow(t('info.activeAgent'), c.agent||'—'));
  box.append(infoSection(t('info.project'),'info',projRows));

  // Runners: agent → command, monospace
  const runners=c.runners||{};
  const runnerKeys=Object.keys(runners);
  const runnerRows=el('div','info-rows info-rows-mono');
  if(!runnerKeys.length) runnerRows.append(el('div','empty',t('info.noRunners')));
  runnerKeys.forEach(k=> runnerRows.append(infoRow(k, runners[k])));
  box.append(infoSection(t('info.runners'),'run',runnerRows));

  // Counts: tasks/specs/agents/skills/enabled workflow steps
  const tiles=el('div','stat-tiles');
  tiles.append(statTile(`${s.done}/${s.total}`,t('info.tasksLabel'),t('info.doneSub',{pct:s.pct})));
  tiles.append(statTile(String((P.specs||[]).length),t('info.specsLabel'),t('info.filesSub')));
  tiles.append(statTile(String((P.agents||[]).length),t('info.agentsLabel'),t('info.personasSub')));
  tiles.append(statTile(String((P.skills||[]).length),t('info.skillsLabel'),t('info.proceduresSub')));
  tiles.append(statTile(`${enabledSteps.length}/${steps.length}`,t('info.workflowLabel'),t('info.stepsEnabledSub')));
  box.append(infoSection(t('info.counts'),'board',tiles));

  // Specs: the P.specs filename list
  const specsList=el('ul','flatlist');
  const specs=P.specs||[];
  if(!specs.length) specsList.append(li('empty',t('board.noneYet')));
  specs.forEach(sp=> specsList.append(li(null,sp)));
  box.append(infoSection(t('info.specsLabel'),'backlog',specsList));

  // Workflow: compact list of enabled steps (name + cap/skill)
  const wfList=el('div','info-wf-list');
  if(!enabledSteps.length) wfList.append(el('div','empty',t('info.noEnabledSteps')));
  enabledSteps.forEach(st=>{
    const row=el('div','info-wf-row');
    row.append(el('span','info-wf-name',st.name));
    const meta=[st.cap,st.skill].filter(Boolean).join(' · ');
    if(meta) row.append(el('span','info-wf-meta',meta));
    wfList.append(row);
  });
  box.append(infoSection(t('info.workflowLabel'),'workflow',wfList));
}

// ---- Documentation tab: which coding agents spectoflow can drive (with links to each one's own
// docs, sourced from the same registry the topbar switcher reads) + the CLI command reference.
// Never build this table from anything but P.knownAgents/P.installedAgents — that data comes from a
// real PATH/config-dir test on the server, never a guess spectoflow hasn't verified. ----
function linkEl(text,url){ const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener'; a.textContent=text; return a; }
function docsAgentsTable(){
  const known=P.knownAgents||[], installed=P.installedAgents||[];
  const wrap=el('div','table-scroll'); const tbl=el('table','backlog-table');
  const thead=el('thead'); const htr=el('tr');
  [t('docs.colAgent'),t('docs.colStatus'),t('docs.colDocs')].forEach(c=>htr.append(el('th',null,c)));
  thead.append(htr); tbl.append(thead);
  const tbody=el('tbody');
  known.forEach(a=>{
    const tr=el('tr');
    tr.append(el('td',null,a.label));
    const statusTd=el('td');
    const isInstalled=installed.includes(a.id);
    const chip=el('span','chip s-'+(isInstalled?'done':'todo'), isInstalled?t('docs.installed'):t('docs.notInstalled'));
    statusTd.append(chip);
    if(!a.headless){ statusTd.append(document.createTextNode(' ')); statusTd.append(el('span','docs-manual-badge',t('docs.manualOnly'))); }
    tr.append(statusTd);
    const docsTd=el('td');
    if(a.docsUrl) docsTd.append(linkEl(t('docs.officialDocs'),a.docsUrl));
    tr.append(docsTd);
    tbody.append(tr);
  });
  tbl.append(tbody); wrap.append(tbl);
  return wrap;
}
function docsCommandsTable(){
  const rows=[
    ['spectoflow init [dir] [--agent=a,b]', t('docs.cmd.init')],
    ['spectoflow update [--dry-run] [--force|-f]', t('docs.cmd.update')],
    ['spectoflow status', t('docs.cmd.status')],
    ['spectoflow dashboard [--port=NNNN]', t('docs.cmd.dashboard')],
    ['spectoflow dashboard status|stop|restart', t('docs.cmd.dashboardSub')],
    ['spectoflow dashboard create "…" | --auto', t('docs.cmd.dashboardCreate')],
    ['spectoflow skill create "…" | --auto', t('docs.cmd.skillCreate')],
    ['spectoflow agent create "…" | --auto', t('docs.cmd.agentCreate')],
    ['spectoflow list', t('docs.cmd.list')],
    ['spectoflow agents · skills · workflow', t('docs.cmd.explore')],
  ];
  const wrap=el('div','table-scroll'); const tbl=el('table','backlog-table');
  const thead=el('thead'); const htr=el('tr');
  [t('docs.colCommand'),t('docs.colWhatItDoes')].forEach(c=>htr.append(el('th',null,c)));
  thead.append(htr); tbl.append(thead);
  const tbody=el('tbody');
  rows.forEach(([cmd,desc])=>{
    const tr=el('tr');
    const cmdTd=el('td'); const code=el('code',null,cmd); cmdTd.append(code); tr.append(cmdTd);
    tr.append(el('td',null,desc));
    tbody.append(tr);
  });
  tbl.append(tbody); wrap.append(tbl);
  return wrap;
}
function renderDocs(){
  const box=$('#docsBody'); if(!box) return;
  box.innerHTML='';
  box.append(infoSection(t('docs.agentsTitle'),'agents',docsAgentsTable()));
  box.append(infoSection(t('docs.commandsTitle'),'run',docsCommandsTable()));
  const note=el('p','docs-note');
  note.append(document.createTextNode(t('docs.moreNote')+' '));
  note.append(linkEl('github.com/georgesmomo/spectoflow','https://github.com/georgesmomo/spectoflow'));
  box.append(note);
}

// ---- Files tab: browse the project tree, view/edit any text file (Markdown rendered, HTML
// previewed in a sandboxed iframe, everything else as a plain monospace editor). The tree is
// fetched lazily (only while this tab is active) and never refetched mid-edit — an SSE 'change'
// event refreshes the TREE listing but never overwrites an open file's editor buffer, so an
// unrelated agent write elsewhere can't clobber unsaved work here. ----
let filesTreeData=null, filesOpenPath=null, filesOpenDirty=false;
const filesOpenDirs=new Set(); // persists which tree folders are expanded across a refresh
async function loadFilesTree(){
  try{
    const r=await fetch('/api/files/tree'); const d=await r.json().catch(()=>({}));
    filesTreeData = (r.ok && Array.isArray(d.tree)) ? d.tree : [];
  }catch{ filesTreeData=filesTreeData||[]; }
  renderFilesTree();
}
function renderFiles(){
  // Only the FIRST activation fetches — render() re-runs on every SSE 'change' (a chat message, a
  // task update, anything) and a full tree rebuild on each of those would yank rows out from under
  // an in-progress click. Fresh-after-your-own-action is handled by loadFilesTree() calls at the
  // point of action (filesCreate); the toolbar's Refresh button covers everything else.
  if(activeTab!=='files' || filesTreeData!=null) return;
  loadFilesTree();
}
function fNode(entry){
  const row=el('div','f-row'+(entry.type==='dir'&&filesOpenDirs.has(entry.path)?' is-open':'')+(entry.path===filesOpenPath?' is-active':''));
  row.tabIndex=0;
  if(entry.type==='dir'){
    const chev=document.createElementNS('http://www.w3.org/2000/svg','svg');
    chev.setAttribute('viewBox','0 0 18 18'); chev.setAttribute('class','f-chevron'); chev.setAttribute('fill','none'); chev.setAttribute('stroke','currentColor'); chev.setAttribute('stroke-width','1.8');
    chev.innerHTML='<path d="M6.5 4l6 5-6 5"/>';
    row.append(chev);
  } else row.append(el('span',null,''));
  row.append(el('span','f-name',entry.name));
  const wrap=el('div','f-node');
  wrap.append(row);
  if(entry.type==='dir'){
    const kids=el('div','f-children'); kids.hidden=!filesOpenDirs.has(entry.path);
    (entry.children||[]).forEach(c=> kids.append(fNode(c)));
    wrap.append(kids);
    row.addEventListener('click',()=>{
      const open=filesOpenDirs.has(entry.path);
      if(open) filesOpenDirs.delete(entry.path); else filesOpenDirs.add(entry.path);
      row.classList.toggle('is-open',!open); kids.hidden=open;
    });
  } else {
    row.addEventListener('click',()=> openFilesFile(entry.path));
  }
  return wrap;
}
function renderFilesTree(){
  const box=$('#filesTree'); if(!box) return;
  box.innerHTML='';
  if(!filesTreeData || !filesTreeData.length){ box.append(el('div','empty',t('files.empty'))); return; }
  filesTreeData.forEach(e=> box.append(fNode(e)));
}
function filesExt(p){ const m=/\.([a-z0-9]+)$/i.exec(p||''); return m?m[1].toLowerCase():''; }
async function openFilesFile(relPath){
  // no native confirm() dialog (it blocks the whole tab, including our own SSE/automation) — a
  // dirty editor just refuses to switch until the user explicitly saves or discards.
  if(filesOpenDirty){
    const actions=$('#filesContent .files-actions');
    if(actions && !actions.querySelector('.files-error-tip')){
      const tip=el('span','files-error-tip',t('files.discardConfirm')); actions.append(tip);
    }
    return;
  }
  filesOpenPath=relPath; filesOpenDirty=false;
  renderFilesTree();
  const box=$('#filesContent'); box.innerHTML='';
  box.append(el('div','files-empty',t('drawer.loading')));
  let data;
  try{ const r=await fetch('/api/files/read?'+new URLSearchParams({path:relPath})); data=await r.json().catch(()=>({})); if(!r.ok) throw new Error(data.error||'error'); }
  catch(err){ box.innerHTML=''; box.append(el('div','files-empty',err.message||t('files.loadError'))); return; }
  box.innerHTML='';
  const bar=el('div','files-toolbar-row');
  bar.append(el('div','files-path',relPath));
  const actions=el('div','files-actions'); bar.append(actions);
  box.append(bar);
  if(data.binary){ box.append(el('div','files-binary',t('files.binary'))); return; }
  const ext=filesExt(relPath);
  const content=data.content||'';
  if(ext==='md'||ext==='markdown'){ renderFilesMd(box,actions,relPath,content); }
  else if(ext==='html'||ext==='htm'){ renderFilesHtml(box,actions,relPath,content); }
  else { renderFilesText(box,actions,relPath,content); }
}
function filesSavedTip(actions){
  const tip=el('span','files-saved-tip',t('files.saved')); actions.append(tip);
  setTimeout(()=>tip.remove(),1500);
}
// Explicit, non-blocking way to abandon local edits (no confirm() dialog) — re-fetches the file
// fresh from disk and clears the dirty flag so switching tree files is unblocked again.
function filesDiscardBtn(relPath){
  const btn=el('button',null,t('files.discard')); btn.type='button';
  btn.addEventListener('click',()=>{ filesOpenDirty=false; openFilesFile(relPath); });
  return btn;
}
async function filesSave(relPath,content,actions){
  try{
    const r=await fetch('/api/files/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:relPath,content})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||'error');
    filesOpenDirty=false; filesSavedTip(actions);
  }catch(err){
    const tip=el('span','files-error-tip',err.message||t('files.saveError')); actions.append(tip);
  }
}
// Markdown: rendered preview by default (via the same mdLite renderer the Agents & Skills drawer
// uses), with an Edit toggle that swaps in a plain-text editor plus a tiny insert-at-cursor toolbar.
function renderFilesMd(box,actions,relPath,content){
  let editing=false;
  const editBtn=el('button','btn',t('files.edit'));
  actions.append(editBtn);
  const body=el('div','files-body-col');
  box.append(body);
  const showPreview=()=>{ body.innerHTML=''; const md=el('div','files-view md-body'); md.innerHTML=mdLite(content); body.append(md); editBtn.textContent=t('files.edit'); };
  const showEditor=()=>{
    body.innerHTML='';
    const tb=el('div','files-md-toolbar');
    const ta=el('textarea','files-editor'); ta.value=content;
    const wrapSel=(before,after)=>{ const s=ta.selectionStart,e=ta.selectionEnd; const v=ta.value; ta.value=v.slice(0,s)+before+v.slice(s,e)+after+v.slice(e); ta.focus(); ta.selectionStart=s+before.length; ta.selectionEnd=e+before.length; content=ta.value; filesOpenDirty=true; };
    [['B','**','**'],['I','_','_'],['H','## ',''],['Link','[','](url)']].forEach(([label,a,b])=>{
      const bt=el('button',null,label); bt.type='button'; bt.addEventListener('click',()=>wrapSel(a,b)); tb.append(bt);
    });
    const saveBtn=el('button',null,t('files.save')); saveBtn.type='button'; saveBtn.addEventListener('click',()=>{ content=ta.value; filesSave(relPath,content,actions); });
    tb.append(saveBtn,filesDiscardBtn(relPath));
    ta.addEventListener('input',()=>{ content=ta.value; filesOpenDirty=true; });
    body.append(tb,ta); ta.focus(); editBtn.textContent=t('files.preview');
  };
  editBtn.addEventListener('click',()=>{ editing=!editing; if(editing) showEditor(); else showPreview(); });
  showPreview();
}
// HTML: sandboxed iframe preview by default, plain-text editor on toggle (no WYSIWYG — the
// dashboard stays zero-dependency, no editor library is loaded).
function renderFilesHtml(box,actions,relPath,content){
  let editing=false;
  const editBtn=el('button','btn',t('files.edit'));
  actions.append(editBtn);
  const body=el('div','files-body-col');
  box.append(body);
  const showPreview=()=>{
    body.innerHTML='';
    const frame=document.createElement('iframe');
    frame.className='files-iframe'; frame.setAttribute('sandbox',''); frame.srcdoc=content;
    body.append(frame); editBtn.textContent=t('files.edit');
  };
  const showEditor=()=>{
    body.innerHTML='';
    const ta=el('textarea','files-editor'); ta.value=content;
    ta.addEventListener('input',()=>{ content=ta.value; filesOpenDirty=true; });
    const saveBtn=el('button','btn primary',t('files.save')); saveBtn.type='button'; saveBtn.addEventListener('click',()=>filesSave(relPath,content,actions));
    const tb=el('div','files-md-toolbar'); tb.append(saveBtn,filesDiscardBtn(relPath));
    body.append(tb,ta); ta.focus(); editBtn.textContent=t('files.preview');
  };
  editBtn.addEventListener('click',()=>{ editing=!editing; if(editing) showEditor(); else showPreview(); });
  showPreview();
}
// Anything else that reads as text: a plain monospace editor, editable straight away.
function renderFilesText(box,actions,relPath,content){
  const ta=el('textarea','files-editor'); ta.value=content;
  ta.addEventListener('input',()=>{ filesOpenDirty=true; });
  const saveBtn=el('button','btn primary',t('files.save')); saveBtn.type='button';
  saveBtn.addEventListener('click',()=>filesSave(relPath,ta.value,actions));
  actions.append(saveBtn,filesDiscardBtn(relPath));
  box.append(ta); ta.focus();
}
// "+ File"/"+ Folder" open the same inline form (never a native prompt()/alert() — those block the
// whole tab, including our own SSE connection, until dismissed).
let filesCreateKind='file';
function openFilesCreateForm(kind){
  filesCreateKind=kind;
  const form=$('#filesCreateForm'); if(!form) return;
  const input=$('#filesCreateInput');
  input.placeholder = kind==='dir' ? t('files.newFolderPrompt') : t('files.newFilePrompt');
  input.value='';
  const err=$('#filesCreateError'); if(err) err.hidden=true;
  form.hidden=false; form.classList.add('is-open');
  input.focus();
}
function closeFilesCreateForm(){
  const form=$('#filesCreateForm'); if(!form) return;
  form.hidden=true; form.classList.remove('is-open');
}
async function submitFilesCreate(){
  const input=$('#filesCreateInput'); const err=$('#filesCreateError');
  const name=(input.value||'').trim();
  if(!name){ if(err){ err.textContent=t('backlog.addTitleRequired'); err.hidden=false; } return; }
  const rel=name.replace(/^\/+/,'');
  const kind=filesCreateKind;
  const endpoint = kind==='dir' ? '/api/files/mkdir' : '/api/files/write';
  const payload = kind==='dir' ? {path:rel} : {path:rel,content:''};
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){ if(err){ err.textContent=d.error||t('files.saveError'); err.hidden=false; } return; }
  closeFilesCreateForm();
  await loadFilesTree();
  if(kind!=='dir') openFilesFile(rel);
}

function openDrawer(id,keep){
  // named `task`, not `t` — `t` is the global translation function (see i18n.js) and this whole
  // function calls it repeatedly below; shadowing it with a task variable would break every call.
  const task=allTasks().find(x=>x.id===id); if(!task) return;
  openTaskId=id;
  if(!keep && taskFromPath()!==id) history.pushState(null,'','/'+activeTab+'/'+encodeURIComponent(id));
  const b=$('#drawerBody'); const prev=keep?$('.drawer-panel').scrollTop:0; b.innerHTML='';
  b.append(el('div','d-id',task.id+' · '+(task.level||'standard')+' · '+task.file));
  b.append(el('div','d-title',task.title));
  const sSec=el('div','d-section'); sSec.append(el('div','d-label',t('task.status')));
  const sr=el('div','status-row');
  Object.keys(STATUS).forEach(k=>{
    const btn=el('button','status-btn'+(task.status===k?' active':''),STATUS[k]);
    if(task.status===k) btn.style.background=cssv('--s-'+k);
    btn.addEventListener('click',()=>patchTask(id,{status:k}));
    sr.append(btn);
  });
  sSec.append(sr); b.append(sSec);

  const tr=runtimeTests(id);
  if(tr){ const ts=el('div','d-section'); ts.append(el('div','d-label',t('task.tests')));
    ts.append(el('div','d-text', tr.failed?t('task.failingPassing',{f:tr.failed,p:tr.passed||0}):t('task.passing',{n:tr.passed||0}))); b.append(ts); }

  const cSec=el('div','d-section'); cSec.append(el('div','d-label',t('task.comments')));
  const list=el('div','comments');
  (task.comments||[]).forEach(cm=> list.append(el('div','comment',cm)));
  if(!(task.comments||[]).length) list.append(el('div','empty',t('task.noComments')));
  cSec.append(list);
  const box=el('div','c-box'); const ta=el('textarea'); ta.placeholder=t('task.addCommentPlaceholder');
  const actions=el('div','c-actions');
  const add=el('button','btn',t('action.add')); const an=el('button','btn primary',t('action.addToAnalyze'));
  add.addEventListener('click',()=>{ if(ta.value.trim())addComment(id,ta.value.trim(),'note'); });
  an.addEventListener('click',()=>{ if(ta.value.trim())addComment(id,ta.value.trim(),'analyze'); });
  actions.append(add,an); box.append(ta,actions);
  box.append(el('div','empty',t('task.toAnalyzeHint')));
  cSec.append(box); b.append(cSec);
  $('#drawer').setAttribute('aria-hidden','false');
  if(keep) $('.drawer-panel').scrollTop=prev;
}
function closeDrawer(){ if(taskFromPath()) history.pushState(null,'','/'+activeTab); openTaskId=null; $('#drawer').setAttribute('aria-hidden','true'); }
const cssv=(v)=> getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#888';

// tabs — activeTab is the single source of truth (persisted), so a click sets it and applies it,
// and render()'s SSE-driven re-render (triggered by the snapshot write / polling) re-applies it
// too instead of ever resetting to Board; this is what keeps a tab selected across a race with a
// 'change'/'message' event that lands right after a click.
// initial tab: the URL path wins (deep-link / refresh), else the persisted tab, else board
let activeTab = tabFromPath() || (()=>{ try{ return normalizeTab(localStorage.getItem('spf-tab'))||'board'; }catch{ return 'board'; } })();
openTaskId = taskFromPath(); // deep-link straight to a task drawer
function applyActiveTab(){
  $$('#tabs .tab').forEach(t=> t.classList.toggle('is-active', t.dataset.tab===activeTab));
  $$('.panel').forEach(p=> p.classList.toggle('is-active', p.dataset.panel===activeTab));
}
$$('#tabs .tab').forEach(tab=> tab.addEventListener('click',()=> navigateTab(tab.dataset.tab)));
// mobile hamburger — toggles the tab dropdown (body.nav-open); closes on tab pick / outside / Esc
const navToggle=$('#navToggle');
if(navToggle) navToggle.addEventListener('click',e=>{ e.stopPropagation(); const open=!document.body.classList.contains('nav-open'); document.body.classList.toggle('nav-open',open); navToggle.setAttribute('aria-expanded',String(open)); });
document.addEventListener('click',e=>{ if(!document.body.classList.contains('nav-open')) return; if(e.target.closest('#tabs')||e.target.closest('#navToggle')) return; closeNav(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeNav(); });
// workflow step popover — close on outside click / Esc / resize. (No scroll-to-close: a capture
// scroll listener also fires on the popover's own internal scroll, which would slam it shut.)
document.addEventListener('click',e=>{ if(wfPopStep && !e.target.closest('#wfPop') && !e.target.closest('.wf-step2')) closeWfPop(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeWfPop(); });
window.addEventListener('resize',()=>{ if(wfPopStep) closeWfPop(); });
// keep the URL and the path in sync when the user uses the browser back/forward buttons
window.addEventListener('popstate',()=>{
  activeTab = tabFromPath() || 'board'; applyActiveTab();
  const id=taskFromPath(); if(id) openDrawer(id); else closeDrawer();
});
// brand logo → Board (SPA nav, no full reload)
const brandLogo=$('.brand-logo'); if(brandLogo) brandLogo.addEventListener('click',e=>{ e.preventDefault(); navigateTab('board'); });
applyActiveTab(); // sync to the resolved tab before the first render
// an old bookmark/share to the pre-rename "/settings" URL: swap the address bar to the real
// route once resolved, so the visible URL matches the "Personalize" tab it landed on.
if(location.pathname.split('/').filter(Boolean)[0]==='settings') history.replaceState(null,'','/personalize');
// filters (status chips + search) — client-side only, does not write anything
$$('#statusChips .fchip').forEach(b=> b.addEventListener('click', ()=>{ filter.status=b.dataset.status; renderBoard(); }));
$('#search').addEventListener('input', e=>{ filter.q=e.target.value; renderBoard(); });
// board view switch — List (phase-grouped) vs Kanban (columns by status), persisted per viewer
$$('#boardViewToggle .vt-btn').forEach(b=> b.addEventListener('click', ()=>{ boardView=b.dataset.view; try{ localStorage.setItem('spf-board-view',boardView); }catch{} renderBoard(); }));
// expand / collapse all phases (List view) — keeps a big board compact by default
const phaseToggleAllBtn=$('#phaseToggleAll');
if(phaseToggleAllBtn) phaseToggleAllBtn.addEventListener('click', ()=>{
  const titles=allPhaseTitles();
  const allOpen = titles.length>0 && titles.every(t=> expandedPhases.has(t));
  if(allOpen) expandedPhases.clear(); else titles.forEach(t=> expandedPhases.add(t));
  saveExpanded(expandedPhases); renderBoard();
});
// backlog: independent filters + sortable column headers — client-side only (reset to page 1 on change)
$$('#backlogStatusChips .fchip').forEach(b=> b.addEventListener('click', ()=>{ backlogFilter.status=b.dataset.status; backlogPage=1; renderBacklog(); }));
$('#backlogSearch').addEventListener('input', e=>{ backlogFilter.q=e.target.value; backlogPage=1; renderBacklog(); });
$$('#backlogTable thead th').forEach(th=> th.addEventListener('click', ()=>{
  const col=th.dataset.col;
  if(backlogSort.col===col) backlogSort.dir = backlogSort.dir==='asc'?'desc':'asc';
  else { backlogSort.col=col; backlogSort.dir='asc'; }
  backlogPage=1; renderBacklog();
}));
// files tab: create a new file/folder (path relative to the project root, e.g. "notes/todo.md")
const filesNewFileBtn=$('#filesNewFile'); if(filesNewFileBtn) filesNewFileBtn.addEventListener('click',()=>openFilesCreateForm('file'));
const filesNewFolderBtn=$('#filesNewFolder'); if(filesNewFolderBtn) filesNewFolderBtn.addEventListener('click',()=>openFilesCreateForm('dir'));
const filesRefreshBtn=$('#filesRefresh'); if(filesRefreshBtn) filesRefreshBtn.addEventListener('click',loadFilesTree);
const filesCreateGoBtn=$('#filesCreateGo'); if(filesCreateGoBtn) filesCreateGoBtn.addEventListener('click',submitFilesCreate);
const filesCreateCancelBtn=$('#filesCreateCancel'); if(filesCreateCancelBtn) filesCreateCancelBtn.addEventListener('click',closeFilesCreateForm);
const filesCreateInputEl=$('#filesCreateInput'); if(filesCreateInputEl) filesCreateInputEl.addEventListener('keydown',e=>{ if(e.key==='Enter') submitFilesCreate(); });
// backlog: manual "+ Add task" form (title required, phase/owner/level optional)
$('#backlogAddBtn').addEventListener('click', ()=>{ const form=$('#backlogAddForm'); (form&&!form.hidden)?closeBacklogAddForm():openBacklogAddForm(); });
$('#blAddCancel').addEventListener('click', closeBacklogAddForm);
$('#blAddSubmit').addEventListener('click', submitBacklogAdd);
$('#blAddTitle').addEventListener('keydown', e=>{ if(e.key==='Enter') submitBacklogAdd(); });
// attention tab: add a note + filter chips
$('#attnAddBtn').addEventListener('click',()=>{ const t=$('#attnInput'); const v=t.value.trim(); if(v){ addAttn(v); t.value=''; } });
$('#attnInput').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ const v=e.target.value.trim(); if(v){ addAttn(v); e.target.value=''; } } });
$$('.attn-filters .fchip').forEach(b=> b.addEventListener('click',()=>{ attnFilter=b.dataset.attn; renderAttention(); }));
// settings — the footer link opens the Settings tab; selects save on change
const footerSettingsBtn=$('#footerSettings'); if(footerSettingsBtn) footerSettingsBtn.addEventListener('click',()=>navigateTab('personalize'));
const footerLogo=$('.footer-logo'); if(footerLogo) footerLogo.addEventListener('click',e=>{ e.preventDefault(); navigateTab('board'); });
function onModeSelectChange(e){ setModeSelects(e.target.value); saveSettings(); }
function onLangSelectChange(e){ setLangSelect(e.target.value); saveSettings(); }
$('#setMode').addEventListener('change',onModeSelectChange);
$('#setLang').addEventListener('change',onLangSelectChange);
const topModeSel=$('#topMode'); if(topModeSel) topModeSel.addEventListener('change',onModeSelectChange);
const topLangSel=$('#topLang'); if(topLangSel) topLangSel.addEventListener('change',onLangSelectChange);
const setDesignSel=$('#setDesign'); if(setDesignSel) setDesignSel.addEventListener('change',()=>saveDesign(setDesignSel.value));
const topAgentSel=$('#topAgent'); if(topAgentSel) topAgentSel.addEventListener('change',(e)=>saveAgent(e.target.value));
const setAgentSel=$('#setAgent'); if(setAgentSel) setAgentSel.addEventListener('change',(e)=>saveAgent(e.target.value));
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
$('#widgetSummarizeBtn').addEventListener('click',()=>summarizeChat($('#runAgent')));
$('#widgetClearBtn').addEventListener('click',clearChat);
$('#runPrompt').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter')doRun(); });
// Chat tab — same doRun/doOrchestrate/approve, its own textarea/select (#tabRunPrompt/#tabRunAgent)
$('#tabRunBtn').addEventListener('click',()=>doRun($('#tabRunPrompt'),$('#tabRunAgent')));
$('#tabOrchBtn').addEventListener('click',()=>doOrchestrate($('#tabRunPrompt')));
$('#tabSummarizeBtn').addEventListener('click',()=>summarizeChat($('#tabRunAgent')));
$('#tabClearBtn').addEventListener('click',clearChat);
$('#tabRunPrompt').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter')doRun($('#tabRunPrompt'),$('#tabRunAgent')); });
$('#drawerClose').addEventListener('click',closeDrawer);
$('#drawerScrim').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeDrawer(); });
// entry animations play only during the initial boot window; after that, live SSE re-renders
// don't replay them (kills the flicker). CSS scopes @keyframes to body.booting.
document.body.classList.add('booting');
setTimeout(()=>document.body.classList.remove('booting'),1400);
load(); connect();
