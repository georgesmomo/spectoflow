# Project memory — design

**Status:** approved and implemented in 0.33.0 (D78). Extends the second brain (`docs/second-brain-design.md`, D73).

## Problem

Everything an agent learns goes into the user's global second brain, loaded in every project. A fact that is
true for one project ("we use PostgreSQL", "tests must run with `--runInBand`", "the client calls orders
*commandes*") pollutes the context of all the others, and can be applied where it is wrong.

## The rule: what the fact is about

- **About the user** — true for them whatever the project (role, preferences, working style, what to avoid) →
  the **second brain**, global and private, unchanged.
- **About the project** — true for it whoever works on it (conventions, pitfalls, domain vocabulary,
  constraints) → the **project memory**, a file **in the repository, committed**: it is team knowledge, it must
  follow the project's history, and teammates and their agents benefit from it.
- **Never** anything personal in the project memory: it is shared. Never secrets anywhere.
- **Not a second home for what already has one.** Specs, plans and decisions (`docs/DECISIONS.md`, ADRs) keep
  their role. The project memory holds the small durable facts that deserve neither a spec nor a decision.

## Decisions taken with the user

1. **One page, two sections:** the Second brain tab shows **You** (global, private) and **This project**
   (shared). An entry can be **moved** from one to the other when the agent picked the wrong one.
2. **Same validation mechanism as the global brain:** facts the agent learns are added directly by default; a
   setting makes them wait in *To confirm*. For the project, the setting is **per project**
   (`config.json → memoryAutoAdd`, default `true`) — committed, so the team shares the choice.
3. **Project categories:** **Conventions** (naming, tools, imposed style) · **Pitfalls** (what breaks, known
   workarounds) · **Glossary** (domain vocabulary) · **Constraints** (technical, legal, client).

## Design

### The file

`.spectoflow/memory.md`, same markdown shape and the same fidelity-first parser as the brain (untouched lines
written back byte for byte, stable ids, lock + write-then-rename):

```markdown
# Project memory

## Conventions
- Tests run with `npm test -- --runInBand` (shared DB fixtures) <!-- id:m1 by:agent at:2026-09-17 -->

## Pitfalls
- The staging API rejects requests without `X-Tenant` <!-- id:m2 by:user at:2026-09-17 -->

## Glossary
- "Commande" = an order; "devis" = a quote <!-- id:m3 by:agent at:2026-09-17 -->

## Constraints
- Personal data must stay in the EU region <!-- id:m4 by:user at:2026-09-17 -->

## To confirm
- [pitfalls] Local Docker needs 6 GB of RAM for the full stack <!-- id:m5 by:agent at:2026-09-17 -->
```

- Not shipped by the kit, created on first write — so it is user-owned by construction: `spectoflow update`
  never touches it. Not gitignored: it is meant to be committed.
- `lib/brain.js` is generalized into a small memory-store factory (categories, headings, title, file, autoAdd
  source); the second brain and the project memory are two instances of it.

### How the agent reads and writes it

The file is inside the project, so every agent can read and write it directly, no MCP and no permission
prompt — including sandboxed ones.

- **Read** `.spectoflow/memory.md` at session start and apply it.
- **Write** a durable fact about the project by adding one line under its category — or, when
  `memoryAutoAdd` is `false`, under `## To confirm` as `- [category] fact`. One fact per line; don't repeat what
  is already there; never personal data; not what belongs in a spec, plan or decision.
- **Pick the right memory:** the second brain (`brain_learn`) for facts about the user, the project memory for
  facts about the project. The rule is written in `templates/SPECTOFLOW.md`, in the root entry files (the
  reminder already there), and in the `brain_learn` tool description ("facts about the project go in
  `.spectoflow/memory.md`, not here").
- Runs launched from the dashboard can edit files too (`acceptEdits`, `workspace-write`), so no extra run line
  is needed for the project memory.

### The page

The **Second brain** tab gets two sections, each with its own toggle, To-confirm block and category cards:

- **You** — unchanged (global, private). Hidden when the dashboard is served online, as today.
- **This project** — its four cards, the "Add what the agent learns directly" toggle bound to `memoryAutoAdd`,
  visible online too (it is project data, gated like any project read/write).
- **Move** on each entry → pick the target category in the other memory → removed from one file, added to the
  other. Moving to or from *You* is refused online.
- The hub already watches `.spectoflow/`, so an edit to `memory.md` (by the agent, by git, by hand) refreshes the
  page live.

### API

| Route | Op | Online |
|---|---|---|
| `GET /api/memory` | `memory.read` → `{ entries, pending, autoAdd }` | `project.read` |
| `POST /api/memory` | `memory.add` `{ category, text }` | `project.write` |
| `PATCH /api/memory/:id` | `memory.update` | `project.write` |
| `DELETE /api/memory/:id` | `memory.remove` | `project.write` |
| `POST /api/memory/:id/confirm` | `memory.confirm` | `project.write` |
| `POST /api/memory/move` | `memory.move` `{ from: 'user'\|'project', id, category }` | refused (touches the personal brain) |

`memoryAutoAdd` is saved through the existing `settings.save` (whitelisted in `writeConfig`).

## Out of scope

- A personal preference that applies to one project only (rare; the user can keep it in the project memory if
  it isn't personal, or in the brain otherwise).
- Automatic migration of project-specific facts already in someone's global brain: the page's **Move** is the
  tool for that.

## Tests

- The factory: both instances keep their own categories, headings and title; the existing brain tests still pass
  unchanged.
- Project memory: parse/serialize fidelity, add/update/remove/confirm, `memoryAutoAdd` on/off, category fallback.
- Ops: every `memory.*`, `memory.move` both ways (entry removed from one file, added to the other with the chosen
  category), `memory.move` refused with `ctx.remote`; relay permissions for `memory.*` and refusal of `memory.move`.
- `update` never touches `memory.md`.
- Real browser QA of the two sections, the toggles and Move; a real agent session that records one fact about
  the user and one about the project, each in the right file.
