# Policy — non-negotiable gates

Orthogonal to mode. Even in autopilot, these require **explicit human approval** before execution.

- **Production deployment** (build/release/deploy to prod).
- **Destructive migration** (irreversible drop/alter, data deletion, purge).
- **Security change** (auth, permissions, secrets, network exposure, session lifetime).
- **Committing spend / external side effect** (payment, purchase, mass send).

When a step hits a gate: stop, explain the act and its risk in one line, ask [Approve / Cancel /
Modify], and record the decision in the runtime log. Overridable per project (add or relax gates).
