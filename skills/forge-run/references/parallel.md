# Parallel Execution — worktree fan-out for independent phases

Loaded by `forge-run` when the plan contains parallel groups and Run Config has `max_parallel` > 1. Parallelism is NEVER improvised at runtime — only plan-declared groups run concurrently.

## What may run in parallel

A parallel group is declared in the plan and contains phases that are: (a) mutually independent — no `depends_on` path between any two members; (b) file-disjoint — their probable files (plan notes / spec File Map rows) do not overlap. Both conditions were verified by `plan-design` and approved by the human at gate 2. If reality diverges mid-run (a phase touches a file outside its declared set that another group member also touches), finish the current batch, then fall back to sequential for the remainder of the group and record a lesson.

## Mechanics

1. **Setup:** for each phase in the batch (up to `max_parallel` at once), create a worktree: `git worktree add ../<repo-dirname>-forge-P<n> -b forge/NNN-<slug>-P<n>` branched from the current run branch HEAD.
2. **Dispatch:** one implementer subagent per phase, per the dispatch protocol (`references/dispatch.md`), with one addition to its context: its working directory is its worktree path, and it must never touch files outside it. Dispatch all subagents of the batch concurrently (multiple Agent calls in a single message).
3. **Phase-local verification:** each subagent runs its covered-AC tests inside ITS worktree. Heavy phases run their TDD cycle and code review inside the worktree as usual.
4. **Integration (sequential, by phase number):** when the batch completes, the orchestrator merges each phase branch into the run branch in ascending phase order. After EACH merge, run the FULL repo suite on the run branch.
   - Merge conflict OR red suite after merge = **integration failure**: do not resolve inside the worktree. Count it as a red iteration for that phase (`debugging.md` applies — diagnose, don't blind-retry), and re-run the phase SEQUENTIALLY on top of the updated run branch (which now contains the already-merged siblings). Its iter/K/escalation machinery applies unchanged.
5. **Cleanup:** after a phase branch merges (or its phase is re-run sequentially), remove its worktree (`git worktree remove`) and delete the phase branch. Never leave dangling worktrees — list and clean them in END as a guarantee.
6. **State:** `todo.md` marks batch members `[in_progress-parallel]`. Full state flush happens per merged phase (commit, todo, results), preserving the at-most-one-phase-lost guarantee.
7. **Budget:** check `run_budget` at every batch boundary (before launching a batch). If remaining budget cannot plausibly cover the whole batch, shrink the batch or go sequential — never launch a batch you cannot finish.
8. **Attended mode:** no new pause points. Escalation pauses arising from parallel phases are handled one at a time as the batch integrates.

## Windows note

Worktrees work on win32; always quote paths and use the sibling-directory layout (`../<repo-dirname>-forge-P<n>`) so worktrees stay outside the repo root and outside any watcher/scanner scope.

---
Provenance: discipline adapted from the superpowers methodology (obra) — using-git-worktrees + dispatching-parallel-agents — frozen into this plugin on 2026-06-12. Self-contained by design — audit against upstream on superpowers major releases.
