# Capabilities — palette + project-type adaptation

A capability is a role; an agent implements it; a skill is the procedure it runs. Workflows ask for a
capability, never a named agent — this keeps spectoflow agent-agnostic.

Palette: intake · research · analysis · architecture · planning · testing · implementation · security · quality · design · operations · governance · customization.

`governance` is the odd one out: it is **advisory, not a workflow step**. The `spec-source-guardian`
(skill `audit-source`) watches that the spec (intent) and the code/tests (reality) stay coherent, and
surfaces drift to the Attention tab; it gates only at `done`/Major (see `policy.md`), never mid-edit.

`clarify` is a **reflex under `intake`, not a workflow step** either: on *any* ambiguous request the
agent reflects it back and asks **one targeted question at a time** (each with a recommendation) until
the need is crisp, then proceeds — it feeds the workflow, never replaces it. See `skills/clarify` and
the Clarify step in `AGENTS.md`.

`customization` is also **not a workflow step** — it is triggered explicitly, either from the
dashboard's Settings → Customize page or by a direct request ("add a dashboard for…", "create a skill
for…", "create an agent for…"). The `framework-curator` agent owns it, running one of four skills:
`generate-dashboard` (a declarative block-spec page — validated by `spectoflow dashboard validate`),
`generate-skill`, `generate-agent` (both follow `docs/agents-skills-standard.md`'s gold-standard
shape, grounded in real, cited domain standards), and `propose-customizations` (the "Auto" mode:
analyzes the project and proposes candidates instead of taking a description). Still gated by mode
and policy like any other change — no special-casing.

| Project type | Active capabilities |
|---|---|
| app / web / API | all |
| infra / IaC | intake, research, analysis, architecture, planning, security, quality, implementation, operations |
| data / ETL | intake, analysis, architecture, planning, testing (data quality), implementation, quality |
| study / content | intake, research, analysis, planning, quality |

For non-code projects the code-specific capabilities simply stay inactive; the workflow adapts.
