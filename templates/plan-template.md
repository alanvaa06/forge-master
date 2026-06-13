# Plan-NNN: <name>  (PRD: docs/forge/prd/NNN-name.md)

> Execution contract. After human gate 2 approval this file is FROZEN — the loop reads it and asks nothing.

## Run Config
- mode: autonomous            # autonomous = never pauses mid-run | attended = pauses only before escalations, on blocks, and to confirm the finish action
- branch: forge/NNN-<slug>
- isolation: worktree         # worktree = run in a sibling git worktree, primary dir + your editor untouched (default; required for safe concurrent work) | in-place = checkout the run branch in the current dir (only when this is the sole session on the repo)
- K: 3                        # max consecutive red iterations per phase before escalate-or-block
- phase_budget: <tokens>      # soft early-escalation signal, not a hard kill
- run_budget: <tokens>        # global cap; on exhaustion stop cleanly with report
- on_complete: pr             # pr | merge | keep — pr = push branch + open PR from final report (default) | merge = merge into base + delete run branch | keep = leave branch, report where it lives
- max_parallel: 1             # 1 = fully sequential (default); >1 = max concurrent phases per batch, requires ## Parallel Groups below

## Phases

### P1: <name>
- covers: AC-1.1, AC-1.2      # explicit phase -> AC map; every PRD AC lands in exactly one phase
- depends_on: -               # P-ids this phase needs; defines what stays executable if something blocks
- tier: junior               # junior | senior  (initial tag; runtime escalates UP only)
- process: light             # light | heavy
- success: covered ACs green + full repo test suite still passes
- notes: <risks, probable files, why this tier/process>

### P2: <name>
- covers: AC-2.1
- depends_on: P1
- tier: senior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: <...>

## Parallel Groups
> Optional. Only phases declared here run concurrently (worktree per phase, sequential merge-back). Members must be mutually independent (no depends_on path) AND file-disjoint. Omit the section for fully sequential runs.

- group-1: P2, P3              # example — delete or replace

## Coverage Proof
> Filled by plan-design before presenting. Lists every PRD AC and the single phase that covers it.
> Total coverage required: an orphan AC (covered by no phase) makes the plan invalid.

| AC | Phase |
|----|-------|
| AC-1.1 | P1 |
| AC-1.2 | P1 |
| AC-2.1 | P2 |