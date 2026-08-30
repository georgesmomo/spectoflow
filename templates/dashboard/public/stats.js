'use strict';
(function (root) {
  const STATUSES = ['todo', 'in_progress', 'to_validate', 'to_analyze', 'done', 'blocked'];
  const allTasks = (p) => (p.plans || []).flatMap((pl) => pl.phases.flatMap((ph) => ph.tasks.map((t) => ({ ...t, file: pl.file }))));
  function stats(p) {
    p = p || {};
    const tasks = allTasks(p);
    const total = tasks.length;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    tasks.forEach((t) => { if (byStatus[t.status] === undefined) byStatus[t.status] = 0; byStatus[t.status]++; });
    const done = byStatus.done || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const phases = (p.plans || []).flatMap((pl) => pl.phases.map((ph) => {
      const d = ph.tasks.filter((t) => t.status === 'done').length, tot = ph.tasks.length;
      return { title: ph.title, file: pl.file, done: d, total: tot, pct: tot ? Math.round((d / tot) * 100) : 0 };
    }));
    const toAsk = tasks.filter((t) => t.status === 'to_validate' || t.status === 'to_analyze')
      .map((t) => ({ id: t.id, title: t.title, status: t.status, file: t.file }));
    const rt = p.runtime || {};
    const agents = (rt.agents || []);
    const last = agents.length ? agents[agents.length - 1] : null;
    const running = {
      agents: agents.filter((a) => a.status === 'running').length,
      lastRun: last ? { tool: last.tool, status: last.status } : null,
      orchestration: rt.orchestration || null,
    };
    return { total, done, pct, byStatus, phases, toAsk, running, statuses: STATUSES };
  }
  const api = { stats, STATUSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpectoStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
