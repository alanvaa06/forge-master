---
name: run
description: Execute an approved forge-master plan as an autonomous loop. Disk-backed state machine — reads docs/context/plan-NNN.md, runs phases in dependency order, verifies with the test runner (never opinion), escalates tier/process by deterministic rules, flushes state after every phase so it survives compaction, and ends with a Definition-of-Done report. Resume by re-invoking. Use when the user says "/forge-master:run", "run the forge", or asks to execute an approved plan.
disable-model-invocation: true
---

# run — forge-master Master Loop

<!-- markers: INIT · LOOP · ESCALATE · BLOCK · todo.md · full repo suite -->

You are the orchestrator. You ORCHESTRATE and VERIFY. You implement ONLY light phases inline (inline execution — cheap, no dispatch overhead); heavy implementation ALWAYS lives in disposable phase subagents (subagent-driven development). Live state lives on disk, not in your context.

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

Every red iteration follows `references/debugging.md` (read it and pass it to whoever owns the fix) — no retry without a root-cause hypothesis; a stuck report must include the hypotheses tested.

### Execute by tags
- **light:** inline execution — implement in your own context, or a single subagent if the phase touches many files: implement -> write & run the covered-AC tests -> commit. No intermediate spec, no separate review. **Trade-off, explicit:** light = test-after by design, chosen for token economy; it sacrifices the red-proof. Escalation light->heavy restores full TDD.
- **heavy:** subagent-driven — full cycle, never inline: write a brief phase spec -> strict red-green TDD per covered AC following `references/tdd.md` (read it and pass it to the phase subagent) -> independent code review per `references/code-review.md` (read it and pass it to the reviewer subagent) -> commit. Independent heavy phases may fan out via a Workflow script. Dispatch and report format per `references/dispatch.md` (read it and follow it for every subagent you spawn).
- **junior:** dispatch a cheap-model subagent (haiku/sonnet), low effort.
- **senior:** dispatch a top-model subagent, high effort.

Review findings route deterministically (full contract in `references/code-review.md`): **blockers** re-enter the implementation cycle and increment `iter` — feeding the same K/escalation machinery as red tests; **nits** go to `results.md` and never block.

Phase subagents receive MINIMAL context: their plan section, their ACs, relevant lessons, `memory.md`, and — when `docs/context/spec-NNN.md` exists — only each spec section their phase's `notes:` cite (its Interfaces and File Map rows), never the whole spec. **Never the run history** — your master context stays lean. If implementation reality contradicts a cited spec section, the plan wins; record the divergence in `results.md`. Dispatch protocol, report contract, and freshness policy: `references/dispatch.md`.

### Verification is commands, not judgment
"Green" is decided by the test runner exit code, never by an agent's opinion — this guards against hallucinated progress. **Double anti-regression check:** the phase's covered-AC tests AND the full repo suite must both pass, so a new phase can never silently break a past phase.

### ESCALATE (deterministic, unidirectional — UP only)
Trigger when `iter >= K` OR any free signal fires: junior subagent declares stuck/no-progress, files touched far exceed the plan estimate, or `phase_budget` exhausted without green.
- Bump the weakest axis: `junior -> senior` first, then `light -> heavy`. Never de-escalate.
- Reset `iter` to 0.
- Append to `lessons.md`: `P<n> escalated (<from>-><to>): <reason>; dead hypotheses: <list>` — friction event, consumed by future `plan-design`; the dead-hypothesis list is what the fresh retry inherits (see `references/debugging.md`).
- Retry the phase.

### BLOCK (only when already senior+heavy and still red at K)
- Write the blocker to `results.md` and a lesson to `lessons.md`.
- `todo.md`: phase -> `[blocked]`; mark every dependent phase `[blocked-upstream]`.
- Continue with independent branches of the graph. Never request human input mid-run (autonomous mode).

### Re-plan trigger (stale plan ≠ stuck phase)
A phase subagent may report **"plan assumption broken"** — the plan's premise for this phase is false (interface it builds on doesn't exist as planned, AC contradicts repo reality, dependency phase produced something incompatible). This is NOT "stuck", so escalation would burn tokens on an unwinnable phase:
- Mark the phase `[plan-stale]` in `todo.md` (skip ESCALATE for it entirely).
- Record the broken assumption in `results.md` + a lesson.
- Continue independent branches as with BLOCK.
- The final report must recommend re-running `plan-design` on the unfinished remainder, citing the broken assumptions.

## Attended mode
`mode:` comes frozen from Run Config. **`autonomous` (default) never pauses at any of these points.** `attended` pauses at EXACTLY three:
1. **Before each ESCALATE** — present the trigger and proposed bump; user may approve it, override (different bump), or abort the phase (mark `[blocked]`).
2. **On BLOCK** — user may unblock with guidance (guidance goes to the phase subagent AND `lessons.md` as a correction), skip the phase, or stop the run cleanly.
3. **At the Finish stage** — user confirms the `on_complete` action before it executes.
No other pause points exist; attended mode does not turn the loop conversational.

## State discipline
**After EVERY phase, flush full state to disk** (todo, results, lessons, the commit). Compaction or a crash loses at most the in-flight phase. **Resume = re-invoke `/forge-master:run`** — INIT detects the partial `todo.md` and continues. Multi-session for free.

## END
1. All phases terminal -> walk the PRD **Definition of Done** checklist. Verify any `[manual-check]` ACs here (they never blocked the loop).
2. Write the **final report**: phases done / blocked / `[plan-stale]` / pending, tokens spent, escalations, key lessons — and, if any phase is `[plan-stale]`, the recommendation to re-run `plan-design` on the remainder.
3. Run the **Finish stage** (below).
4. Append a `session-log.md` line and one-line-per-decision architecture notes to `memory.md`.
5. **Clean-stop guarantees:** if `run_budget` is exhausted, stop cleanly with the report at a phase boundary — NEVER mid-phase without a commit. A budget-stop skips the Finish stage (`keep` behavior) and says so.

## Finish stage — land the branch
Execute ONLY when the full repo suite is green on the run branch. `on_complete` comes frozen from Run Config; in attended mode confirm the action with the user first, in autonomous mode execute the config without asking:
- **`pr`** (default) -> push the run branch and open a PR against the base branch; the PR body is generated from the final report (phases, AC IDs satisfied, escalations, lessons).
- **`merge`** -> merge the run branch into the base branch and delete the run branch. Never merge with blocked/`[plan-stale]` phases outstanding — fall back to `pr` and explain why in the report.
- **`keep`** -> leave the branch as-is and state in the report exactly where the work lives and how to land it later.
If the suite is not green (blocked phases remain), do not land anything: `keep` behavior, report states why.

## Anti-noise learning rule
Lessons are written ONLY on friction events (escalation, blocker, attended-mode user correction). First-pass-green phases write nothing to `lessons.md` — if everything is a lesson, nothing is.
