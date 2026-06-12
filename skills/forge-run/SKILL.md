---
name: run
description: Execute an approved forge-master plan as an autonomous loop. Disk-backed state machine — reads docs/context/plan-NNN.md, runs phases in dependency order, verifies with the test runner (never opinion), escalates tier/process by deterministic rules, flushes state after every phase so it survives compaction, and ends with a Definition-of-Done report. Resume by re-invoking. Use when the user says "/forge-master:run", "run the forge", or asks to execute an approved plan.
disable-model-invocation: true
---

# run — forge-master Master Loop

<!-- markers: INIT · LOOP · ESCALATE · BLOCK · todo.md · full repo suite -->

You are the orchestrator. You ORCHESTRATE and VERIFY; you never implement — implementation lives in disposable phase subagents. Live state lives on disk, not in your context.

## INIT
1. Read `docs/context/plan-NNN.md` (ask which N if more than one and ambiguous). Read `docs/context/lessons.md` and `docs/context/todo.md`.
2. Verify the `docs/context/` scaffold exists. If missing, run the user's `scaffold` skill first, then continue.
3. **Resume detection:** if `todo.md` already holds this plan's phase entries with some marked `done`/`blocked`, you are RESUMING — pick up at the first non-terminal phase. Otherwise seed `todo.md` with one `[pending]` entry per phase.
4. **Test harness check:** detect the repo's test framework. If none exists, insert an implicit phase **P0: setup test harness** and run it first — nothing can be verified without a runner.
5. Create/checkout the branch from Run Config (`forge/NNN-<slug>`). The user keeps working on `main`; this branch isolates the run.

## LOOP — while executable phases remain
An "executable" phase is `[pending]` with all `depends_on` satisfied (those phases `done`).

```
phase = next pending phase whose depends_on are all done
todo.md: phase -> in_progress        (FLUSH)
execute phase per its process/tier (table below)
verify: run the phase's covered-AC tests AND the full repo test suite
  green -> git commit "P<n>: <name> [AC-x.y, ...]"
           todo.md: phase -> done; append 1-4 line results.md entry   (FLUSH)
           -> next phase
  red   -> iter++
           if iter >= K and (tier or process not maxed):  ESCALATE
           if iter >= K and already senior+heavy:          BLOCK
```

### Execute by tags
- **light:** inline in you or a single subagent — implement -> write & run the covered-AC tests -> commit. No intermediate spec, no separate review.
- **heavy:** full cycle — write a brief phase spec -> TDD red-green (write the AC test first, watch it fail, implement, reach green) -> dispatch an INDEPENDENT subagent for code review -> commit. Independent heavy phases may fan out via a Workflow script.
- **junior:** dispatch a cheap-model subagent (haiku/sonnet), low effort.
- **senior:** dispatch a top-model subagent, high effort.

Phase subagents receive MINIMAL context: their plan section, their ACs, relevant lessons, `memory.md`, and — when `docs/context/spec-NNN.md` exists — only each spec section their phase's `notes:` cite (its Interfaces and File Map rows), never the whole spec. **Never the run history** — your master context stays lean. If implementation reality contradicts a cited spec section, the plan wins; record the divergence in `results.md`.

### Verification is commands, not judgment
"Green" is decided by the test runner exit code, never by an agent's opinion — this guards against hallucinated progress. **Double anti-regression check:** the phase's covered-AC tests AND the full repo suite must both pass, so a new phase can never silently break a past phase.

### ESCALATE (deterministic, unidirectional — UP only)
Trigger when `iter >= K` OR any free signal fires: junior subagent declares stuck/no-progress, files touched far exceed the plan estimate, or `phase_budget` exhausted without green.
- Bump the weakest axis: `junior -> senior` first, then `light -> heavy`. Never de-escalate.
- Reset `iter` to 0.
- Append to `lessons.md`: `P<n> escalated (<from>-><to>): <reason>` — friction event, consumed by future `plan-design`.
- Retry the phase.

### BLOCK (only when already senior+heavy and still red at K)
- Write the blocker to `results.md` and a lesson to `lessons.md`.
- `todo.md`: phase -> `[blocked]`; mark every dependent phase `[blocked-upstream]`.
- Continue with independent branches of the graph. Never request human input mid-run (autonomous mode).

## State discipline
**After EVERY phase, flush full state to disk** (todo, results, lessons, the commit). Compaction or a crash loses at most the in-flight phase. **Resume = re-invoke `/forge-master:run`** — INIT detects the partial `todo.md` and continues. Multi-session for free.

## END
1. All phases terminal -> walk the PRD **Definition of Done** checklist. Verify any `[manual-check]` ACs here (they never blocked the loop).
2. Write the **final report**: phases done / blocked / pending, tokens spent, escalations, and key lessons.
3. Append a `session-log.md` line and one-line-per-decision architecture notes to `memory.md`.
4. **Clean-stop guarantees:** if `run_budget` is exhausted, stop cleanly with the report at a phase boundary — NEVER mid-phase without a commit.

## Anti-noise learning rule
Lessons are written ONLY on friction events (escalation, blocker, attended-mode user correction). First-pass-green phases write nothing to `lessons.md` — if everything is a lesson, nothing is.
