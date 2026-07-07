---
name: run
description: Execute an approved forge-master plan as an autonomous loop. Disk-backed state machine — reads docs/forge/plans/plan-NNN.md, runs phases in dependency order, verifies with the test runner (never opinion), escalates tier/process by deterministic rules, flushes state after every phase so it survives compaction, and ends with a Definition-of-Done report. Resume by re-invoking. Use when the user says "/forge-master:run", "run the forge", or asks to execute an approved plan.
---

# run — forge-master Master Loop

<!-- markers: INIT · LOOP · ESCALATE · BLOCK · todo.md · full repo suite -->

You are the orchestrator. You ORCHESTRATE and VERIFY. You implement ONLY light phases inline (inline execution — cheap, no dispatch overhead); heavy implementation ALWAYS lives in disposable phase subagents (subagent-driven development). Live state lives on disk, not in your context.

## INIT
1. **Read the contract.** Read `docs/forge/plans/plan-NNN.md` (ask which N if more than one and ambiguous) for the phases and Run Config — you need `branch` and `isolation` before touching disk. (On a worktree resume the plan may live only on the run branch; if it isn't in the current dir, the worktree list in step 2 leads you to it.)
2. **Establish the run root (Run Config `isolation`).** This decides WHERE every later step reads and writes — do it before the scaffold, resume, and harness checks.
   - **`worktree` (default):** the run gets its own git worktree, so the primary dir — the user's editor and any other session — keeps its branch untouched. In-place checkout only *looks* isolated; a worktree is what makes "the user keeps working on their branch" actually true.
     - *Resume first:* run `git worktree list`. If `../<repo-dirname>-forge-NNN` (branch `forge/NNN-<slug>`) already exists, that IS the run root — cd in, do not recreate.
     - *Fresh run:* `git worktree add ../<repo-dirname>-forge-NNN -b forge/NNN-<slug>` from the current HEAD, then cd in. Quote paths on Windows; the sibling layout keeps the worktree outside the repo root and any watcher scope. If the approved plan / spec / PRD or the `docs/context/` scaffold are not yet committed on this branch, write the content you read in step 1 into the worktree and commit it as the run's seed commit — the contract must live on the run branch.
   - **`in-place`:** `git checkout -b forge/NNN-<slug>` in the current dir. This moves the shared working dir onto the run branch, so any concurrent session or open editor collides. Use ONLY when this is the sole session on the repo; if `git worktree list` or recent commits on another branch suggest other live work, warn the user and switch to `worktree`.
   - From here, **the run root** = wherever you just landed. Every read, write, commit, and phase worktree below happens there.
3. **Scaffold check.** In the run root, verify `docs/context/` exists. If missing, run the user's `scaffold` skill first, then continue.
4. **Resume detection.** In the run root, run `node <skill-dir>/scripts/forge-state.mjs seed docs/forge/plans/plan-NNN.md` — idempotent: it seeds one `[pending]` entry per phase, or reports `resume: true` when this plan's entries already exist (you are RESUMING; `next` picks up at the first executable phase). Then read `docs/context/lessons.md`. Fallback — node missing, or `todo.md` holds this plan's entries in a pre-script format — do the same by hand per the State discipline rules.
5. **Test harness check:** detect the repo's test framework. If none exists, insert an implicit phase **P0: setup test harness** and run it first — nothing can be verified without a runner.

## LOOP — while executable phases remain
An "executable" phase is `[pending]` with all `depends_on` satisfied (those phases `done`).

**Parallel batches:** when the plan declares Parallel Groups and Run Config `max_parallel` > 1, executable phases belonging to the same group launch as a concurrent batch per `references/parallel.md` (read it first). Everything else about each phase — tags, TDD, review, K, escalation, debugging — applies unchanged; only WHERE it runs (a worktree) and WHEN it integrates (sequential merge with full-suite check after each) differ.

```
phase = forge-state next <plan>      (first [pending] whose depends_on are all done;
                                      --all lists every executable, for parallel batches)
forge-state set <P> in_progress      (FLUSH)
execute phase per its process/tier (table below)
verify: run the phase's covered-AC tests AND the full repo test suite
  green -> git commit "P<n>: <name> [AC-x.y, ...]"
           forge-state set <P> done; append 1-4 line results.md entry   (FLUSH)
           -> next phase
  red   -> iter++
           if iter >= K and (tier or process not maxed):  ESCALATE
           if iter >= K and already senior+heavy:          BLOCK
```
`forge-state next` returning `phase: null, all_terminal: true` ends the LOOP -> go to END. `phase: null` with non-terminal entries left means only in-flight work remains — finish it; never invent a phase the script did not return.

Every red iteration follows `references/debugging.md` (read it and pass it to whoever owns the fix) — no retry without a root-cause hypothesis; a stuck report must include the hypotheses tested.

### Execute by tags
- **light:** inline execution — implement in your own context, or a single subagent if the phase touches many files: implement -> write & run the covered-AC tests -> commit. No intermediate spec, no separate review. **Trade-off, explicit:** light = test-after by design, chosen for token economy; it sacrifices the red-proof. Escalation light->heavy restores full TDD.
- **heavy:** subagent-driven — full cycle, never inline: write a brief phase spec -> strict red-green TDD per covered AC following `references/tdd.md` (read it and pass it to the phase subagent) -> independent code review per `references/code-review.md` (read it and pass it to the reviewer subagent) -> commit. Independent phases in a plan-declared parallel group fan out per `references/parallel.md`. Dispatch and report format per `references/dispatch.md` (read it and follow it for every subagent you spawn).
- **junior:** dispatch a cheap-model subagent (haiku/sonnet), low effort.
- **senior:** dispatch a top-model subagent, high effort.

Review findings route deterministically (full contract in `references/code-review.md`): **blockers** re-enter the implementation cycle and increment `iter` — feeding the same K/escalation machinery as red tests; **nits** go to `results.md` and never block.

Phase subagents receive MINIMAL context: their plan section, their ACs, relevant lessons, `memory.md`, and — when `docs/forge/specs/spec-NNN.md` exists — only each spec section their phase's `notes:` cite (its Interfaces and File Map rows), never the whole spec. **Never the run history** — your master context stays lean. If implementation reality contradicts a cited spec section, the plan wins; record the divergence in `results.md`. Dispatch protocol, report contract, and freshness policy: `references/dispatch.md`.

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
- `forge-state set <P> blocked` — the script cascades `[blocked-upstream]` to every pending transitive dependent; do not mark them by hand.
- Continue with independent branches of the graph. Never request human input mid-run (autonomous mode).

### Re-plan trigger (stale plan ≠ stuck phase)
A phase subagent may report **"plan assumption broken"** — the plan's premise for this phase is false (interface it builds on doesn't exist as planned, AC contradicts repo reality, dependency phase produced something incompatible). This is NOT "stuck", so escalation would burn tokens on an unwinnable phase:
- `forge-state set <P> plan-stale` (skip ESCALATE for it entirely; cascades `[blocked-upstream]` like BLOCK).
- Record the broken assumption in `results.md` + a lesson.
- Continue independent branches as with BLOCK.
- The final report must recommend re-running `plan-design` on the unfinished remainder, citing the broken assumptions.

## Attended mode
`mode:` comes frozen from Run Config. **`autonomous` (default) never pauses at any of these points.** `attended` pauses at EXACTLY three. At each, present the choices as a lettered list and mark one **Recommended** so the user can reply with a single letter:

1. **Before each ESCALATE** — present the trigger and the proposed bump:
   > a) Approve the proposed bump (`<from>`→`<to>`) — **Recommended**, follows the deterministic escalation rule
   > b) Override with a different bump
   > c) Abort the phase (mark `[blocked]`)
2. **On BLOCK**:
   > a) Unblock with guidance — **Recommended** if you can name the fix; guidance goes to the phase subagent AND `lessons.md` as a correction
   > b) Skip the phase (mark `[blocked]`, continue independent branches)
   > c) Stop the run cleanly
3. **At the Finish stage** — confirm the `on_complete` action before it executes:
   > a) Proceed with `<on_complete>` (the Run Config action: pr/merge/keep) — **Recommended**, the approved config
   > b) Use a different finish action
   > c) Stop without landing

No other pause points exist; attended mode does not turn the loop conversational.

## State discipline
**After EVERY phase, flush full state to disk** (todo, results, lessons, the commit). Compaction or a crash loses at most the in-flight phase. **Resume = re-invoke `/forge-master:run`** — INIT detects the partial `todo.md` and continues. Multi-session for free.

**Every `todo.md` mutation goes through `scripts/forge-state.mjs`** (zero-dep node, lives next to this skill; canonical line format `- [status] plan-NNN P<n>: <name>`). Full invocation — the plan file is always the first argument: `node <skill-dir>/scripts/forge-state.mjs <seed|next|set|status> docs/forge/plans/plan-NNN.md [P-id status] [--all]` (add `--todo <path>` only if todo.md is not at `docs/context/todo.md`). Subcommands: `seed` at INIT (idempotent), `next [--all]` for phase selection, `set <P-id> <status>` for every flush (`blocked`/`plan-stale` cascade `blocked-upstream` automatically), `status` for the terminal check before END. Output is JSON — trust it over re-parsing the markdown yourself; deterministic bookkeeping is cheaper than reasoning and immune to post-compaction misreads. Manual fallback ONLY when node is unavailable or the entries predate the canonical format — then follow the same rules by hand.

## Keeping the loop alive (harness-enforced, optional)
The stop condition ("all phases terminal") lives in this skill's prose — the harness does not enforce it. Two user-invoked primitives harden an autonomous run. Suggest them ONCE, in the status line right before phase 1 of a fresh autonomous run (never mid-run, never on resume, never in attended mode):
- **Premature-stop guard:** `/goal every phase in docs/context/todo.md is terminal (done/blocked/blocked-upstream/plan-stale) and the final report is written` — an evaluator model bounces any early stop back into the loop instead of trusting prose discipline.
- **Unattended auto-resume:** `/loop 30m /forge-master:run` — INIT's resume detection is idempotent, so a timer turns disk-backed resumability into self-resume after a crash or compaction. The user cancels the loop when the final report lands.

## END
1. All phases terminal -> walk the PRD **Definition of Done** checklist. Verify any `[manual-check]` ACs here (they never blocked the loop).
2. Write the **final report**: phases done / blocked / `[plan-stale]` / pending, tokens spent, escalations, key lessons — and, if any phase is `[plan-stale]`, the recommendation to re-run `plan-design` on the remainder.
3. Run the **Finish stage** (below).
4. Append a `session-log.md` line and one-line-per-decision architecture notes to `memory.md`.
5. **Clean-stop guarantees:** if `run_budget` is exhausted, stop cleanly with the report at a phase boundary — NEVER mid-phase without a commit. A budget-stop skips the Finish stage (`keep` behavior) and says so. List git worktrees and remove any forge-created leftovers (`git worktree list` / `git worktree remove`) — a finished or stopped run leaves no dangling worktrees or phase branches. Under `isolation: worktree` this includes the run worktree itself once the Finish action has landed the branch (cd to the primary dir first, since you cannot remove the worktree you stand in); for `keep`, leave the run worktree and report its path.

## Finish stage — land the branch
Execute ONLY when the full repo suite is green on the run branch. `on_complete` comes frozen from Run Config; in attended mode confirm the action with the user first, in autonomous mode execute the config without asking:
- **`pr`** (default) -> push the run branch and open a PR against the base branch; the PR body is generated from the final report (phases, AC IDs satisfied, escalations, lessons). The run ends at the PR but the PR keeps living — reviews and CI arrive later — so close the final report with the handoff command: `/loop 30m check PR <url>: address new review comments and fix failing CI`.
- **`merge`** -> merge the run branch into the base branch and delete the run branch. Never merge with blocked/`[plan-stale]` phases outstanding — fall back to `pr` and explain why in the report.
- **`keep`** -> leave the branch as-is and state in the report exactly where the work lives and how to land it later.
If the suite is not green (blocked phases remain), do not land anything: `keep` behavior, report states why.

**Worktree isolation (`isolation: worktree`):** the run root is the run worktree, so `pr` and `keep` operate from there — push the branch, or leave the worktree in place and tell the user its path (that is where the work lives). `merge` must run where the base branch is checked out — the primary dir — so cd back there, merge the run branch, delete it, then remove the run worktree. Never `git worktree remove` the worktree you are standing in; cd out first.

## Anti-noise learning rule
Lessons are written ONLY on friction events (escalation, blocker, attended-mode user correction). First-pass-green phases write nothing to `lessons.md` — if everything is a lesson, nothing is.
