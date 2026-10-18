# Lessons

> Rules from corrections. Friction only — never repeat a logged mistake. List format. Cap enforced by hook.

- forge-subagent-containment (field 2026-10, 4/4 projects): phase subagents MUST NOT write `docs/forge/**` or `docs/context/**` and MUST NOT run mutating git (checkout/switch/pull/push/merge/rebase/reset/branch/stash/commit) — they reverted run state (Curamedi), marked their own phase (Graphiu), and moved the branch so the next commit landed on main (MAES). The orchestrator owns every commit and state write; state any such need in the final report instead.
- subagent-death-is-not-stuck (Curamedi): a subagent killed by an API/session limit is not a red iteration — check the worktree's `git status`, resume the phase, escalate only on real test failures.
