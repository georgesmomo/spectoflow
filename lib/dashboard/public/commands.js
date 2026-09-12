'use strict';
/*
 * Slash-command logic for the dashboard chat. A command is a saved prompt macro: the user types
 * "/trigger <text>" and it expands, client-side, into the command's full `instruction` (with an
 * optional {{input}} placeholder for the trailing text). The agent never sees the "/" — expansion
 * happens before /api/run, so this is fully agent-agnostic.
 *
 * Zero-dependency, loaded both in the browser (via <script> — exposes window.SpectoCommands) and in
 * node --test (via require — module.exports), the same pattern as stats.js / charts.js. This is the
 * single source of truth for the built-in command set and for trigger validation.
 */
(function (root) {
  const TRIGGER_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

  // Shipped defaults. Kept ONLY here (not duplicated into templates/config.json): a project with no
  // config.commands field uses these; the first user edit persists the full list into config.json.
  const BUILTIN_COMMANDS = [
    { trigger: 'spec', description: 'Write or update a spec',
      instruction: "Write or update the specification for the following. Follow the project's spec conventions under .spectoflow (specs/ markdown: clear goals, non-goals, acceptance criteria). Focus: {{input}}",
      enabled: true },
    { trigger: 'plan', description: 'Break work into a task plan',
      instruction: "Break the following work into an ordered plan of small, independently testable checkbox tasks, following the project's plan conventions (plans/ markdown). Work: {{input}}",
      enabled: true },
    { trigger: 'revue', description: 'Code-review the current diff',
      instruction: 'Review the current working-tree diff for correctness bugs and quality issues (reuse, simplification, efficiency). Report findings most-severe first. {{input}}',
      enabled: true },
    { trigger: 'resume', description: 'Summarize progress',
      instruction: 'Give a concise summary of the current project progress: what is done, what is in progress, and what is next. {{input}}',
      enabled: true },
    { trigger: 'rapport_jour', description: 'Structured daily report',
      instruction: "Write today's daily report with these sections: 1) Highlights (what was accomplished), 2) Blockers, 3) Next steps. Keep it concise and factual. {{input}}",
      enabled: true },
  ];

  function effectiveCommands(config) {
    config = config || {};
    return Array.isArray(config.commands) ? config.commands : BUILTIN_COMMANDS.slice();
  }

  function validateTrigger(trigger, existingTriggers) {
    if (typeof trigger !== 'string') return { ok: false, error: 'invalidTrigger' };
    const lc = trigger.toLowerCase();
    if (!TRIGGER_RE.test(lc)) return { ok: false, error: 'invalidTrigger' };
    if ((existingTriggers || []).some((t) => String(t).toLowerCase() === lc)) return { ok: false, error: 'duplicateTrigger' };
    return { ok: true };
  }

  function matchCommands(query, commands) {
    const q = String(query || '').toLowerCase();
    return (commands || []).filter((c) => c && c.enabled !== false
      && typeof c.trigger === 'string' && c.trigger.toLowerCase().startsWith(q));
  }

  function parseInvocation(text) {
    const m = String(text == null ? '' : text).trim().match(/^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
    if (!m) return null;
    return { trigger: m[1], rest: m[2] || '' };
  }

  function expandCommand(text, commands) {
    const inv = parseInvocation(text);
    if (!inv) return null;
    const cmd = (commands || []).find((c) => c && c.enabled !== false
      && typeof c.trigger === 'string' && c.trigger.toLowerCase() === inv.trigger.toLowerCase()
      && typeof c.instruction === 'string' && c.instruction.trim());
    if (!cmd) return null;
    const rest = inv.rest.trim();
    const prompt = cmd.instruction.indexOf('{{input}}') !== -1
      ? cmd.instruction.split('{{input}}').join(rest)
      : (rest ? cmd.instruction + '\n\n' + rest : cmd.instruction);
    return { prompt: prompt.trim(), display: String(text).trim() };
  }

  const api = { BUILTIN_COMMANDS, effectiveCommands, validateTrigger, matchCommands, parseInvocation, expandCommand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpectoCommands = api;
})(typeof window !== 'undefined' ? window : globalThis);
