# Policy — non-negotiable gates

Orthogonal to mode. Even in autopilot, these require **explicit human approval** before execution.

- **Production deployment** (build/release/deploy to prod).
- **Destructive migration** (irreversible drop/alter, data deletion, purge).
- **Security change** (auth, permissions, secrets, network exposure, session lifetime).
- **Committing spend / external side effect** (payment, purchase, mass send).
- **Source-of-truth drift at `done` / Major** (governance) — before a Major, or before a task flips to
  `done`, the `spec-source-guardian`'s drift check must be clean (or the drift explicitly accepted):
  the change is reflected in the spec **and** covered by a test. This gate *acknowledges*, it does not
  auto-fix — unresolved drift blocks the "done" until resolved or accepted.

When a step hits a gate: stop, explain the act and its risk in one line, ask [Approve / Cancel /
Modify], and record the decision in the runtime log. Overridable per project (add or relax gates).
