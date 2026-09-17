# Roadmap

What spectoflow is for, what's next, and — just as important — what it deliberately won't become.

## The principle: simple, no ceremony

Spec-driven frameworks tend to grow heavy: mandatory phases, stacks of templates, commands to learn,
documents that exist to feed other documents. spectoflow's promise is the opposite. You talk to your agent
in plain language; the framework picks the right amount of process for the request (Quick / Standard /
Major), keeps its artifacts as plain markdown you own, and shows everything live.

Every item below is judged against that: it ships only if it removes work or risk for the user, it stays
optional when it adds a concept, and it never adds a mandatory step, a new file to maintain by hand, or a
command you must remember.

## Where things stand (0.33)

Details in `docs/DECISIONS.md`. In short: markdown specs and plans; an intent router with modes and policy
gates; stable agents and evolving skills; 13 coding-agent CLIs; an orchestrator; a real-time dashboard for all
your projects (local-only hub) plus an optional online relay with accounts and sharing; a personal second
brain reached through MCP and a project memory committed with the code; a workflow fitted to each project at `init` and kept in step by the agent; slash
commands; custom dashboards, skills and agents generated on request.

## Next

Ordered by value for the user. Sizes are rough: S (days), M (a week or two), L (more).

### 1. Foundations — in progress
- ~~Security: agent commands from `config.json` run only once allowed on the machine (D76)~~
- ~~Stop a stuck run; runs left "running" by a crash are marked interrupted~~
- ~~`runtime.json` bounded~~
- ~~Version drift: an older hub restarts itself, an older project offers a one-click update~~
- ~~Browser notifications when a run ends or a step waits for approval~~
- Windows: run agent CLIs installed as `.cmd` shims reliably, and add a Windows CI job (M)

### 2. The delivery loop
What every serious agent tool now has, kept to one path (design in `docs/delivery-loop-design.md`, awaiting
approval):
- one git worktree per task, so two runs never step on each other (L);
- review the diff in the dashboard, approve or send comments back to the agent (M);
- turn an approved task into a branch and a pull request through `gh` (M);
- a checkpoint before each run, one-click rollback (S–M).

### 3. Specs you can trust
- `spectoflow validate`: spec ↔ plan ↔ tasks consistency, JSON output for CI (M);
- acceptance criteria in a light WHEN/THEN form, linked to tasks and tests, coverage shown in the dashboard (M);
- ~~**project memory** — facts about the project (conventions, pitfalls, glossary, constraints) committed with the
  code, next to the personal second brain (D78)~~
- onboarding an existing codebase into that project memory (M).

### 4. Integrations
- GitHub Issues → task, then Linear and Jira (M, then L);
- scheduled runs — nightly tests, weekly drift audit (S–M);
- cost and tokens per run where the agent CLI reports them (M).

## What we deliberately don't do

- **No mandatory ceremony.** No required phase, template, or document for a quick change. The router decides;
  the user can always override.
- **No framework-specific vocabulary to learn** (constitutions, story shards, personas-as-rituals). Concepts
  from other frameworks come in only as plain, optional files — e.g. project principles would live in the
  project memory, not in a new artifact type.
- **No command zoo.** A handful of CLI commands; everything else is plain language to the agent or a click in
  the dashboard.
- **No lock-in.** Markdown in your repo, any of 13 agents, the dashboard reads your files — delete spectoflow
  and your specs and plans are still just markdown.
- **No hidden automation.** The agent enables workflow steps only when you allowed it; it never disables one,
  never records something you can't see and edit, never runs a custom command you didn't allow.
