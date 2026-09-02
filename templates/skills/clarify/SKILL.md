---
name: clarify
description: When a request is ambiguous, act as an analyst — reflect it back and ask one targeted question at a time (each with a recommendation) until the need is crisp, then execute.
capability: intake
inputs: The raw request from the user, plus the project's objectives (specs/, plans/, goals) and the mode/policy.
outputs: A crisp, confirmed statement of the need (or explicit assumptions to proceed on), ready for classification and the normal workflow.
standard: requirements elicitation
---
# Clarify

Turn a vague request into a crisp, agreed need **before** classifying or acting — the way a good
analyst does: reflect, ask the sharpest question, listen, repeat. This is a **reflex**, always in the
agent's memory (see the Clarify step in `AGENTS.md`), not a workflow stage — it fires on *any*
request, including bug reports and change requests on an existing project ("the login page doesn't
display well, users can't sign in").

## When to use
Whenever a request is ambiguous or under-specified and acting on it would mean guessing:
- a **vague symptom** ("doesn't work", "displays badly", "is slow") with no observable, testable meaning;
- **missing acceptance** — you can't yet name what "done" looks like;
- **several plausible readings** that would lead to genuinely different work;
- **unclear scope or users** ("everyone"? one browser? mobile only?);
- a request that **contradicts the spec** or a best practice — clarify the intent before complying.

Skip it when the request is already unambiguous and testable — over-questioning is its own failure.

## Method — reflect, then one question at a time
1. **Reflect it back.** Restate the request in one sentence and name the goal as you understand it.
   Surface your assumptions explicitly so a wrong one is easy to correct.
2. **Ask ONE question — the highest-value one first.** The single question that most reduces
   uncertainty about what to build. Carry **your recommended default and a one-line reason** ("I'd
   assume the layout breaks on mobile, since that's the common case — is that it?"). Prefer a small set
   of concrete options over an open prompt. **Never send a block of questions.**
3. **Wait, then decide if you still need more.** Read the answer. If the intent is now crisp, stop and
   proceed. If not, ask the next single question. Keep looping until it's clear — typically 1-3
   questions, rarely more.
4. **Anchor every question in the two sources of truth.** Each question and recommendation must follow
   from (a) the project's objectives (`specs/`, `plans/`, stated goals) and (b) domain best practices —
   so you're steering like an expert, not fishing. For a login bug that means asking about the
   observable failure, the affected users/browser, and the acceptance ("signed-in and redirected"),
   not cosmetic trivia.
5. **Converge and confirm.** Once clear, restate the crisp need in one or two lines and get a yes
   before running: "So: <need>, for <users>, done when <acceptance>. Correct?"
6. **Then hand off** the confirmed need to the normal Router flow (Classify → Gate → Load → Run), or to
   `brainstorm` / `analyze-requirements` for a new build. Clarify **replaces nothing** downstream.

## Guardrails
- **One question at a time** — never a wall of questions. This is the whole point.
- **Only ask what changes the outcome.** If an answer wouldn't change what you'd do, don't ask it.
- **Always recommend.** A question without your reasoned default offloads the thinking back onto the
  user — give the expert view, let them correct it.
- **Respect the mode** (`config.json`): `autopilot` → state one assumption and proceed (record it);
  `semi` (default) → clarify when ambiguous/risky; `manual` → clarify. "Just do it / you decide" is a
  valid answer → proceed on explicit, recorded assumptions (`policy.md` still applies).
- **Cap the loop.** If it's still unclear after a few rounds, propose the most reasonable
  interpretation as a recommendation and ask for a yes/no — don't interrogate indefinitely.
- **Never fabricate the answer** to keep moving; a decision-blocking gap that isn't yours to settle is
  a `need`, raised per `policy.md`.

## Output contract
The confirmed need (or the assumptions being proceeded on) is recorded granularly — a note/task
comment, or the spec if one exists — one line at a time. Report to the orchestrator and group chat:

```
::spectoflow role=intake kind=clarify msg=<the one crisp question you just asked, or the confirmed need>
```

## Quality bar
- [ ] The request was reflected back in one sentence before any question was asked.
- [ ] Questions were asked **one at a time**, never as a block.
- [ ] Every question carried a recommended default with a one-line reason.
- [ ] Each question was anchored in the project's objectives and/or a best practice — not trivia.
- [ ] The loop stopped as soon as the need was crisp (no over-questioning), and the crisp need was
      confirmed with the user before execution.
- [ ] Mode was respected; "you decide" was honored by proceeding on explicit, recorded assumptions.

## References
- Anthropic, "Claude Code best practices" (be specific; let the agent ask before acting) —
  https://www.anthropic.com/engineering/claude-code-best-practices
- IIBA, *A Guide to the Business Analysis Body of Knowledge (BABOK)* — Elicitation & Collaboration —
  https://www.iiba.org/career-resources/a-business-analysis-professionals-foundation/babok/
- Gojko Adzic, *Specification by Example* (Manning, 2011) — converging on a shared, testable
  understanding before building — https://gojko.net/books/specification-by-example/
