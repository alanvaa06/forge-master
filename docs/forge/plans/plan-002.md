# Plan-002: harness-enforcement  (PRD: docs/forge/prd/002-harness-enforcement.md)

> Execution contract. After human gate 2 approval this file is FROZEN — the loop reads it and asks nothing.
> Spec: docs/forge/specs/spec-002.md. Dogfood (spec R2): this run executes with the installed v0.17 plugin, so the guard, verify gate and lock it builds are NOT active during the run — every dispatch prompt forbids subagent git writes and docs/forge|docs/context writes (docs/context/lessons.md).

## Run Config
- mode: autonomous
- branch: forge/002-harness-enforcement
- isolation: worktree
- K: 3
- phase_budget: 600000
- run_budget: 5000000
- on_complete: pr
- max_parallel: 1
- gates: node validate.mjs && claude plugin validate .

## Phases

### P1: plan contract lint + test-suite wiring
- covers: AC-2.1, AC-2.2
- depends_on: -
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C3, I1 (lint errors), I9, File Map rows templates/plan-template.md, forge-state.mjs, forge-state.test.mjs, validate.mjs. Also make validate.mjs run every *.test.mjs under skills/ and hooks/ so later suites join the gate. gates missing = contract error (not graph) so legacy plans still seed (R7); existing fixtures gain a gates: line. heavy because R7 (backward compat, 87 existing tests); junior because the logic is table-driven checks.

### P2: forge-git helpers + verify
- covers: AC-2.3, AC-2.6
- depends_on: P1
- tier: senior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C4, I1 (verify), I2 (verify= suffix token), I4 (snapshotWorktree, snapshotHead, diffSnapshots, runGates, findUntestedAcs), D5, D6, D8, D17; File Map rows forge-git.mjs, forge-state.mjs, forge-state.git.test.mjs (temp git repos). senior+heavy: R3 snapshot false refusals, R6 gate timeouts, R7 suffix compat, R8 module split, Windows shell fallback.

### P3: evidence-gated set done
- covers: AC-2.4, AC-2.5
- depends_on: P2
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C4, I1 (set done gate, --force --reason, refusal message listing differing paths), D7, D15, D16 (existing fixture `set done` calls switch to --force --reason fixture; no env bypass). Files forge-state.mjs, forge-state.test.mjs, forge-state.git.test.mjs. heavy: R3, R7.

### P4: reconcile, finish, preflight
- covers: AC-3.1, AC-3.2, AC-3.5
- depends_on: P2
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C5, I1 (reconcile, finish, preflight, seed/next finished field), I2 ([meta] finished line), I3 (finished.json in git common dir), I4 (phaseCommits, hasRemote, gitCommonDir), D9, D10, D14. Files forge-state.mjs, forge-git.mjs, forge-state.git.test.mjs. heavy: R7, R8.

### P5: run lock with heartbeat
- covers: AC-3.4
- depends_on: P4
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C5, I1 (seed --holder, lock refusal/takeover output, heartbeat on every mutating command, release when all terminal and on finish), I3 (lock.json), D11, D12 (120 min), D13, FORGE_STATE_NOW clock. Files forge-state.mjs, forge-state.git.test.mjs. heavy: concurrency edge cases (same holder, fresh other holder, stale takeover).

### P6: forge-guard PreToolUse hook
- covers: AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6
- depends_on: P1
- tier: senior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C2, I5 (decide(input), path rule, bash tokenizer, deny/allow/error outputs), I6 (exec form, timeout 10), D1, D2, D18; File Map rows hooks/hooks.json, hooks/forge-guard.mjs, hooks/forge-guard.test.mjs, validate.mjs (hooks.json structural check over command + args). senior+heavy: R4 (fires in every session; a bug blocks normal work), R5 (tokenizer bypasses), R1 (agent_type naming).

### P7: plugin agent definitions
- covers: AC-1.1
- depends_on: P1
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C1, I7 (frontmatter, descriptions, bodies), D3, D19; File Map rows agents/forge-implementer-junior.md, agents/forge-implementer-senior.md, agents/forge-reviewer.md, validate.mjs (frontmatter checks). heavy because R1/D19 (wrong description text triggers auto-delegation); the work itself is small.

### P8: skill prose integration
- covers: AC-1.7, AC-2.7, AC-3.3, AC-3.6
- depends_on: P3, P4, P5, P6, P7
- tier: junior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: spec C6, I8 (INIT/LOOP/END protocol), I9; File Map rows skills/forge-run/SKILL.md, references/dispatch.md, references/code-review.md, references/parallel.md, skills/plan-design/SKILL.md, validate.mjs (markers). Remove INIT's hand-run git log --grep reconciliation text (AC-3.3 checks it is absent). Delete prose that code now owns; do not add new MUST/NEVER prose beyond what the ACs need. heavy: R1, R2 (this prose drives every future run).

### P9: release docs + live checks
- covers: AC-1.8, AC-2.8, AC-3.7
- depends_on: P8
- tier: junior
- process: light
- success: covered ACs green + full repo test suite still passes
- notes: spec C7; File Map rows README.md (agents/, hooks/, verify/reconcile/finish/preflight/lock, re-opening a finished plan), .claude-plugin/plugin.json (0.18.0). The three covered ACs are [manual-check]: they need the reinstalled 0.18 plugin, so they are verified in the final report after landing and never block (spec R2).

## Coverage Proof
> Filled by plan-design before presenting. Lists every PRD AC and the single phase that covers it.
> Total coverage required: an orphan AC (covered by no phase) makes the plan invalid.

| AC | Phase |
|----|-------|
| AC-1.1 | P7 |
| AC-1.2 | P6 |
| AC-1.3 | P6 |
| AC-1.4 | P6 |
| AC-1.5 | P6 |
| AC-1.6 | P6 |
| AC-1.7 | P8 |
| AC-1.8 | P9 |
| AC-2.1 | P1 |
| AC-2.2 | P1 |
| AC-2.3 | P2 |
| AC-2.4 | P3 |
| AC-2.5 | P3 |
| AC-2.6 | P2 |
| AC-2.7 | P8 |
| AC-2.8 | P9 |
| AC-3.1 | P4 |
| AC-3.2 | P4 |
| AC-3.3 | P8 |
| AC-3.4 | P5 |
| AC-3.5 | P4 |
| AC-3.6 | P8 |
| AC-3.7 | P9 |
