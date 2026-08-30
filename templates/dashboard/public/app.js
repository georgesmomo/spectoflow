'use strict';
const STATUS = { todo:'To do', in_progress:'In progress', to_validate:'To validate', to_analyze:'To analyze', done:'Done', blocked:'Blocked' };
let P = null, openTaskId = null;

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
    if(m.type==='change') return load();
    if(m.type==='run-start') return appendRun(`▶ ${m.run.tool}: ${m.run.prompt}\n`,'meta');
    if(m.type==='run-line') return appendRun(m.chunk);
    if(m.type==='run-end') return appendRun(`\n■ finished (exit ${m.code})\n`,'end');
  };
  es.onerror = ()=>{ $('#sync').classList.add('offline'); $('#syncLabel').textContent='offline'; };
}
function appendRun(text,cls){
  const c=$('#runConsole'); const idle=c.querySelector('.run-idle'); if(idle) idle.remove();
  const span=document.createElement('span'); if(cls)span.className='run-line '+cls; span.textContent=text; c.append(span);
  c.scrollTop=c.scrollHeight;
}
async function doRun(){
  const prompt=$('#runPrompt').value.trim(); if(!prompt) return;
  const agent=$('#runAgent').value;
  await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,agent})});
  $('#runPrompt').value='';
}
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
  const sel=$('#runAgent'); const runners=Object.keys((c.runners)||{claude:1});
  if(sel.options.length!==runners.length){ sel.innerHTML=''; runners.forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.append(o); }); if(c.agent) sel.value=c.agent; }
  renderBoard(); renderWorkflow(); renderTeam();
}

function renderBoard(){
  const tasks = allTasks();
  const done = tasks.filter(t=>t.status==='done').length;
  const pct = tasks.length?Math.round(done/tasks.length*100):0;
  $('#progressFill').style.width = pct+'%';
  $('#progressLabel').textContent = `${done}/${tasks.length} tasks · ${pct}%`;

  const specs=$('#specs'); specs.innerHTML=''; $('#specsCount').textContent=(P.specs||[]).length;
  if(!(P.specs||[]).length) specs.append(li('empty','none yet'));
  (P.specs||[]).forEach(s=> specs.append(li(null,s)));

  const running = (P.runtime&&P.runtime.agents||[]).filter(a=>a.status==='running');
  const rl=$('#running'); rl.innerHTML=''; $('#runCount').textContent=running.length;
  if(!running.length) rl.append(li('empty','no agent running'));
  running.forEach(a=>{ const e=li('run-live',''); e.innerHTML=`<b>${a.tool}</b> · ${a.task||'—'}`; rl.append(e); });

  const board=$('#board'); board.innerHTML='';
  (P.plans||[]).forEach(pl=> pl.phases.forEach(ph=> board.append(renderPhase(ph,pl.file))));
  if(!tasks.length) board.append(emptyState());
}
function li(cls,txt){ const e=el('li',cls); e.textContent=txt; return e; }
function emptyState(){ const d=el('div','empty'); d.style.padding='40px'; d.textContent='No plans yet. Ask your agent to build something — it will run Intake and write plans/*.md.'; return d; }

function renderPhase(ph,file){
  const sec=el('section','phase');
  const head=el('div','phase-head');
  head.append(el('span','phase-title',ph.title));
  head.append(el('span','phase-src',file));
  const d=ph.tasks.filter(t=>t.status==='done').length;
  head.append(el('span','phase-stat',`${d}/${ph.tasks.length}`));
  sec.append(head);
  const wrap=el('div','tasks');
  ph.tasks.forEach(t=> wrap.append(renderTask(t)));
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
  const foot=el('div','task-foot');
  if(t.owner) foot.append(el('span','owner','@'+t.owner));
  if(t.comments&&t.comments.length) foot.append(el('span',null,'💬 '+t.comments.length));
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

function renderTeam(){
  const ag=$('#agents'); ag.innerHTML=''; $('#agentsCount').textContent=(P.agents||[]).length;
  (P.agents||[]).forEach(a=>{
    const c=el('div','card');
    c.append(el('div','ct',a.title||a.name));
    if(a.capability) c.append(el('div','cc',a.capability));
    if(a.description) c.append(el('div','cd',a.description));
    ag.append(c);
  });
  const sk=$('#skills'); sk.innerHTML=''; $('#skillsCount').textContent=(P.skills||[]).length;
  (P.skills||[]).forEach(s=>{
    const c=el('div','card');
    c.append(el('div','ct',s.name));
    if(s.description) c.append(el('div','cd',s.description));
    sk.append(c);
  });
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

// tabs
$$('#tabs .tab').forEach(tab=> tab.addEventListener('click',()=>{
  $$('#tabs .tab').forEach(t=>t.classList.remove('is-active'));
  tab.classList.add('is-active');
  $$('.panel').forEach(p=>p.classList.remove('is-active'));
  $(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');
}));
// theme
(function(){ const s=localStorage.getItem('spf-theme'); if(s)document.documentElement.setAttribute('data-theme',s);
  $('#themeToggle').addEventListener('click',()=>{ const c=document.documentElement.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme',n); localStorage.setItem('spf-theme',n); }); })();
$('#runBtn').addEventListener('click',doRun);
$('#runPrompt').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter')doRun(); });
$('#drawerClose').addEventListener('click',closeDrawer);
$('#drawerScrim').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape')closeDrawer(); });
load(); connect();
