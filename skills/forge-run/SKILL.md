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
4. **Lint the contract.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/forge-run/scripts/forge-state.mjs" lint docs/forge/plans/plan-NNN.md --prd docs/forge/prd/NNN-name.md`. Do NOT repair the frozen plan yourself.
   - **Fresh run** (no run state for this plan yet): `ok: false` means the plan is invalid, e.g. an unknown or cyclic dependency, a missing field, an orphan or double-covered AC, or a bad parallel group. Stop cleanly, report the lint errors verbatim, and recommend re-running `plan-design`.
   - **Resume** (a state file, or pre-0.17 entries in `docs/context/todo.md`, already exists): only `graph_errors` stop the run. `seed` refuses those too, because they break the state machine. Record any other errors in `results.md` and continue: the plan was approved and seeded under an older lint.
5. **Test harness check:** detect the repo's test framework. If none exists, the plan must start with a **P0: setup test harness** phase (`plan-design` writes it, so it passed gate 2 like every other phase). If there is no runner AND no P0 in the plan, nothing can be verified: stop cleanly and recommend re-running `plan-design`. Never improvise a phase the frozen contract does not contain.
6. **Resume detection.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/forge-run/scripts/forge-state.mjs" seed docs/forge/plans/plan-NNN.md`. It is idempotent: it seeds one `[pending]` entry per phase into `docs/forge/runs/plan-NNN.state.md`, or reports `resume: true` when this plan's entries already exist (you are RESUMING; `next` picks up at the first executable phase). It also migrates entries a pre-0.17 run left in `docs/context/todo.md`; pass `--context-todo <path>` if that run kept todo.md elsewhere. Then read `docs/context/lessons.md`. On a resume, handle the seed output in this order:
   - **Missing entries** (`missing` non-empty; e.g. a pre-0.17 todo.md that scaffold's `/compact-context` trimmed): reconcile each phase against git on the run branch. If `git log --oneline --grep "^P<n>: "` finds its phase commit, run `forge-state set P<n> done`; otherwise run `forge-state set P<n> pending`. `set` re-creates the entry.
   - **Crash recovery** (`in_flight` non-empty: a previous session died mid-phase). First make sure no other session is still driving this run. If one might be, for example a manual invocation overlapping a `/loop` timer in another window, stop and report instead of recovering. Then, per in-flight phase:
     - If `git log --grep "^P<n>: "` shows its phase commit already landed, the crash hit between commit and flush: `forge-state set P<n> done`.
     - For a parallel-batch phase, run `git worktree list`. If its phase worktree `../<run-root-dirname>-P<n>` still exists, commit anything uncommitted there as `WIP forge-recover P<n>`, remove the worktree, and rename its branch to `forge/NNN-<slug>-P<n>-recovered`. That keeps the salvage and frees the path and branch name for the re-dispatch.
     - Then run `forge-state recover`: the remaining in-flight phases return to `[pending]` with their escalations and `iter` intact.
     - Park the dead attempt's partial code in the run root without discarding it. If `git status` shows changes outside forge's own files, run `git stash push -u -m "forge-recover plan-NNN <P-ids>" -- . ":(exclude)docs/forge" ":(exclude)docs/context"` and note the stash in `results.md`. The exclusions matter: the plan, PRD, spec, run state, results, and lessons must stay in the tree even when they were never committed.
     - Re-run the recovered phases from that clean tree.

## LOOP — while executable phases remain
An "executable" phase is `[pending]` with all `depends_on` satisfied (those phases `done`).

**Parallel batches:** when the plan declares Parallel Groups and Run Config `max_parallel` > 1, executable phases belonging to the same group launch as a concurrent batch per `references/parallel.md` (read it first). Everything else about each phase — tags, TDD, review, K, escalation, debugging — applies unchanged; only WHERE it runs (a worktree) and WHEN it integrates (sequential merge with full-suite check after each) differ.

```
phase = forge-state next <plan>      (first [pending] whose depends_on are all done;
                                      --all lists every executable, for parallel batches)
forge-state set <P> in_progress      (FLUSH)
execute phase per its process/tier (table below)
verify: run the phase's covered-AC tests AND the full repo test suite
  green -> git commit "P<n>: <name> [AC-x.y, ...]"   (the phase's code plus docs/forge/runs + docs/context)
           forge-state set <P> done; append 1-4 line results.md entry   (FLUSH)
           -> next phase
  red   -> forge-state red <P>          (FLUSH: persists iter, reads K from Run Config)
           decision: retry    -> diagnose per debugging.md, retry
                     escalate -> ESCALATE with the returned bump
                     block    -> BLOCK
```
`forge-state next` returning `phase: null, all_terminal: true` ends the LOOP -> go to END. `phase: null` with a non-empty `in_flight` means only in-flight work remains (a parallel batch still integrating): finish it. `stalled: true` means the state can never progress; its `waiting` list names the unmet dependencies. If `missing` is non-empty, an entry was deleted outside the script: reconcile it against git exactly as INIT does, then continue. Otherwise stop cleanly and report a state-integrity failure. Never invent a phase the script did not return.

Every red iteration follows `references/debugging.md` (read it and pass it to whoever owns the fix) — no retry without a root-cause hypothesis; a stuck report must include the hypotheses tested.

### Execute by tags
- **light:** inline execution — implement in your own context, or a single subagent if the phase touches many files: implement -> write & run the covered-AC tests -> commit. No intermediate spec, no separate review. **Trade-off, explicit:** light = test-after by design, chosen for token economy; it sacrifices the red-proof. Escalation light->heavy restores full TDD.
- **heavy:** subagent-driven — full cycle, never inline: write a brief phase spec -> strict red-green TDD per covered AC following `references/tdd.md` (read it and pass it to the phase subagent) -> independent code review per `references/code-review.md` (read it and pass it to the reviewer subagent) -> commit. Independent phases in a plan-declared parallel group fan out per `references/parallel.md`. Dispatch and report format per `references/dispatch.md` (read it and follow it for every subagent you spawn).
- **junior:** dispatch a cheap-model subagent (haiku/sonnet), low effort.
- **senior:** dispatch a top-model subagent, high effort.

Review findings route deterministically (full contract in `references/code-review.md`): **blockers** re-enter the implementation cycle and count as a red iteration (`forge-state red`, which increments `iter`), feeding the same K/escalation machinery as red tests; **nits** go to `results.md` and never block.

Phase subagents receive MINIMAL context: their plan section, their ACs, relevant lessons, `memory.md`, and — when `docs/forge/specs/spec-NNN.md` exists — only each spec section their phase's `notes:` cite (its Interfaces and File Map rows), never the whole spec. **Never the run history** — your master context stays lean. If implementation reality contradicts a cited spec section, the plan wins; record the divergence in `results.md`. Dispatch protocol, report contract, and freshness policy: `references/dispatch.md`.

### Verification is commands, not judgment
"Green" is decided by the test runner exit code, never by an agent's opinion — this guards against hallucinated progress. **Double anti-regression check:** the phase's covered-AC tests AND the full repo suite must both pass, so a new phase can never silently break a past phase.

### ESCALATE (deterministic, unidirectional — UP only)
Trigger when `forge-state red` returns `decision: escalate` (it carries the `bump`) OR any free signal fires: junior subagent declares stuck/no-progress, files touched far exceed the plan estimate, or `phase_budget` exhausted without green. A free signal escalates early, before K: bump the weakest axis that is not yet maxed. On a phase already senior+heavy there is nothing to bump, so count the signal as a red iteration (`forge-state red`) and follow its decision; only `red` ever decides BLOCK.
- Bump the weakest axis: `junior -> senior` first, then `light -> heavy`. Never de-escalate (the script refuses a bump that is not strictly UP).
- **Flush the bump to disk** so a resume inherits it: `node "${CLAUDE_PLUGIN_ROOT}/skills/forge-run/scripts/forge-state.mjs" escalate docs/forge/plans/plan-NNN.md P<n> [--tier senior] [--process heavy]`. This persists a `{tier=... process=...}` suffix on the entry and resets its `iter` to 0 (a fresh K window). On resume `forge-state next` merges the suffix over the plan tags (echoed as `escalated`), so the phase restarts at the escalated tags, not the original plan tags. Skip this and a post-compaction resume repeats the dead hypotheses at the weaker tier.
- Append to `lessons.md`: `P<n> escalated (<from>-><to>): <reason>; dead hypotheses: <list>` — friction event, consumed by future `plan-design`; the dead-hypothesis list is what the fresh retry inherits (see `references/debugging.md`).
- Retry the phase.

### BLOCK (only when `forge-state red` returns `decision: block`: already senior+heavy and still red at K)
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
**After EVERY phase, flush full state to disk** (run state, results, lessons, the commit). Compaction or a crash loses at most the in-flight phase, and INIT's crash recovery re-runs it. **Resume = re-invoke `/forge-master:run`**: INIT detects the partial run state and continues. Multi-session for free.

**Run state lives in `docs/forge/runs/plan-NNN.state.md`**, a forge-owned file. It is NOT scaffold's `docs/context/todo.md`: scaffold's `/compact-context` deletes finished todos, which would deadlock or re-run phases. While the run is open, `todo.md` carries exactly one pointer line (`- [ ] [in_progress] forge run plan-NNN -> <state file> (forge-state)`); the script adds it at `seed` and removes it once every phase is terminal. Never edit either by hand.

**Every run-state mutation goes through `scripts/forge-state.mjs`** (zero-dep node; canonical line format `- [status] plan-NNN P<n>: <name> [{tier=.. process=.. iter=N}]`). Full invocation, the plan file always first, the script path always quoted (the plugin root may contain spaces): `node "${CLAUDE_PLUGIN_ROOT}/skills/forge-run/scripts/forge-state.mjs" <cmd> docs/forge/plans/plan-NNN.md [P-id ...] [flags]`. `forge-state <cmd>` below is shorthand for this. Flags: `--state <path>` if the state file is not at `docs/forge/runs/plan-NNN.state.md`; `--context-todo <path>` if scaffold's todo.md is not at `docs/context/todo.md`. Subcommands:
- `lint [--prd <prd>]`: validates the plan (fields, tags, dependency graph, AC coverage, parallel groups). Exits 1 with the errors in its JSON; `graph_errors` is the state-breaking subset. Run at INIT.
- `seed`: at INIT. Idempotent, migrates legacy entries, reports `in_flight` after a crash and `missing` for plan phases without an entry.
- `recover`: returns in-flight phases to `[pending]` (crash recovery, INIT only).
- `next [--all]`: phase selection. It merges persisted escalations and `iter` over the plan tags, so trust `phase.tier` / `phase.process` from its output, not the raw plan.
- `set <P-id> <status>`: every status flush. `blocked` / `plan-stale` cascade `blocked-upstream` automatically. Re-creates the entry of a plan phase that has none.
- `red <P-id>`: every red iteration (test red, review blocker, integration failure). Persists `iter` and returns `decision: retry | escalate | block`.
- `escalate <P-id> [--tier senior] [--process heavy]`: persists an ESCALATE bump (UP only) and resets `iter`.
- `status`: the terminal check before END.

Output is JSON; trust it over re-parsing the markdown yourself. Deterministic bookkeeping is cheaper than reasoning and immune to post-compaction misreads. Manual fallback ONLY when node is unavailable; then follow the same rules by hand.

## Keeping the loop alive (harness-enforced, optional)
The stop condition ("all phases terminal") lives in this skill's prose — the harness does not enforce it. Two user-invoked primitives harden an autonomous run. Suggest them ONCE, in the status line right before phase 1 of a fresh autonomous run (never mid-run, never on resume, never in attended mode):
- **Premature-stop guard:** `/goal every phase in docs/forge/runs/plan-NNN.state.md is terminal (done/blocked/blocked-upstream/plan-stale) and the final report is written` — an evaluator model bounces any early stop back into the loop instead of trusting prose discipline.
- **Unattended auto-resume:** `/loop 30m /forge-master:run` — INIT's resume detection is idempotent, so a timer turns disk-backed resumability into self-resume after a crash or compaction. The user cancels the loop when the final report lands.

## END
1. All phases terminal -> walk the PRD **Definition of Done** checklist. Verify any `[manual-check]` ACs here (they never blocked the loop).
2. Write the **final report**: phases done / blocked / `[plan-stale]` / pending, tokens spent, escalations, key lessons — and, if any phase is `[plan-stale]`, the recommendation to re-run `plan-design` on the remainder.
3. Commit the final run state (`docs/forge/runs/`, `docs/context/`) as `forge: run state plan-NNN`. Each phase commit carries the state as it stood before that phase's own `done` flush, so without this commit the branch would land with its last phase still `[in_progress]`. Then run the **Finish stage** (below).
4. Append one line to scaffold's session log (`docs/context/sesion-log.md`, the name scaffold creates; use `session-log.md` only if that is the file that exists, never create a second log) and one-line-per-decision architecture notes to `memory.md`.
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
