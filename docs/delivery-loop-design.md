# Delivery loop — design

**Status:** approved (2026-09-17), implemented in 0.34.0 (D79). Roadmap lot 2.

## Problem

Every run happens in the project's working tree. Two runs at once write over each other, nothing separates
"what the agent changed" from what was already there, and there is no way to review the change, send it back,
or throw it away cleanly. Every serious agent tool now isolates work in a git worktree and ends it with a diff
review and a merge or a pull request.

## One path, no new concepts

A task already has a status (`to do → in progress → to validate → done`). The loop rides on it:

```
  Backlog / Board — task T-012
        │  [Work on it in isolation]
        ▼
  git worktree on branch spectoflow/T-012   ← the agent works here, your working tree is untouched
        │  run ends → task goes "to validate"
        ▼
  task drawer → Changes: files + diff
        ├─ [Merge]          merge into your current branch, remove the worktree       → done
        ├─ [Open a PR]      push the branch, `gh pr create`, remove the worktree       → to validate (PR link)
        ├─ [Send feedback]  your comment goes back to the agent, same worktree          → in progress
        └─ [Discard]        remove the worktree and the branch                          → to do
```

- **Opt-in, per task.** Chat runs and orchestration keep working in the working tree exactly as today. The
  button exists only in a git repository; elsewhere it isn't shown.
- **Isolation is the checkpoint.** Your tree is never touched until you merge, so "Discard" is the rollback.
  No separate checkpoint mechanism.
- **Several tasks at once.** Isolated runs don't block the chat or each other; each task card shows its own
  running state.

## Details

- **Worktree location:** `~/.spectoflow/worktrees/<repo>-<hash>/<task-id>` — outside the project, so no tool,
  watcher, search or test runner in it sees a second copy of the code. (First designed inside `.git/`: a real
  Claude Code run showed agents refuse to write there.) Branch: `spectoflow/<task-id>`, created from the current
  `HEAD`. The project may sit in a sub-folder of the repository; the agent then works in the same sub-folder.
- **Starting point:** the worktree is a clean checkout of `HEAD`. If the working tree has uncommitted changes, the
  drawer says how many aren't in the copy (the plans folder and `config.json`, which the dashboard writes itself,
  are not counted). No extra confirmation step.
- **The run:** the configured agent (same runner, same trust check as D76) with the prompt "Work on task
  <id>: <title>", cwd = the worktree. It doesn't make the chat busy; its messages still appear in the chat, and the
  tail of its plain output is shown in the drawer. Starting from the dashboard is the user's go-ahead: the agent
  may enable a workflow step the task needs (visible in the diff).
- **Dependencies:** a worktree has no `node_modules` and no build output. The agent installs what it needs; the
  drawer says so the first time. No copying or symlinking magic.
- **Merge:** `git merge --no-ff spectoflow/<id>` in the working tree. Uncommitted changes only block it when git
  would overwrite them. On any failure (conflict included): `git merge --abort`, nothing changed, the drawer shows
  git's reason; the worktree stays for feedback.
- **Pull request:** shown only if `gh` is installed and authenticated and a remote exists. Push, then
  `gh pr create --fill`; the PR URL is added to the task as a comment line.
- **Send feedback:** runs the agent again in the same worktree with the review comment appended to the task.
- **State:** `runtime.json → worktrees: { <task-id>: { branch, path, status, startedAt } }`; the git worktree list is
  the source of truth at boot (an entry whose worktree no longer exists is dropped).
- **Online:** start, feedback and discard need `project.write`; merge and PR need `project.write` too, and are
  refused online (they push or change the owner's branches) — the owner does them locally.

## Out of scope

- Worktrees for chat runs or orchestration steps.
- Automatic dependency setup, containers, remote sandboxes.
- Resolving merge conflicts in the dashboard.

## Tests

- git helpers against a real temporary repository: create, diff, merge (clean, dirty tree refused, conflict
  aborted), discard, boot reconciliation.
- Ops: every action, remote refusals, non-git project.
- A fixture agent that edits a file in its worktree: the working tree stays untouched until merge.
- Real browser QA of the drawer flow, including two tasks running at once.
