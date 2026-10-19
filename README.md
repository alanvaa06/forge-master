# Forge Master

**Agentic loop-engineering for Claude Code.** Turn a designed PRD into autonomous, verified, self-correcting execution — decompose into phases, route each by complexity, apply TDD discipline where demanded, verify against testable acceptance criteria, and learn across runs until the task is complete or cleanly blocked.

## Install

From GitHub (inside Claude Code):

```
/plugin marketplace add alanvaa06/forge-master
/plugin install forge-master@forge-master
```

Or from the CLI:

```bash
claude plugin marketplace add alanvaa06/forge-master
claude plugin install forge-master@forge-master
```

Local development / testing a clone:

```bash
claude --plugin-dir .          # loads the plugin without installing
claude plugin validate .       # official marketplace manifest validation
claude plugin validate .claude-plugin/plugin.json   # schema-checks plugin components (agents/, hooks/hooks.json)
node validate.mjs              # this repo's structural acceptance test (runs every *.test.mjs too)
node --test skills/forge-run/scripts/forge-state.test.mjs       # state-script unit tests alone
node --test skills/forge-run/scripts/forge-state.git.test.mjs   # verify / set-done gate / reconcile / finish / preflight / lock (temp git repos)
node --test hooks/forge-guard.test.mjs                          # guard hook table tests
```

## When to use forge-master

**Use forge-master when:** the task is long-running or unattended; a PRD with testable acceptance criteria exists or can be written; you want to approve a contract once and let the loop execute to done/blocked; or you need resumability across sessions and compaction.

**Prefer normal interactive work (or the superpowers workflow) when:** the task is short or exploratory; requirements are still being discovered mid-task; or you want to supervise and steer every step.

The two are complementary — install them side by side: superpowers for interactive craftsmanship, forge-master for contract-driven autonomous runs.

## Commands

| Command | Input | Output | Gate |
|---|---|---|---|
| `/forge-master:forge` | anything — chains the full pipeline below | idea → PRD → (spec) → plan → run, every gate intact | all gates |
| `/forge-master:prd-design` | raw idea (interview; vague ideas get 2-3 approaches to pick from first) | `docs/forge/prd/NNN-name.md` | human gate 1 |
| `/forge-master:prd-import` | existing PRD/spec (file, paste, Jira/Notion/Linear export) | `docs/forge/prd/NNN-name.md` + Adjustments changelog | human gate 1 |
| `/forge-master:spec-design` | approved PRD (optional — for architecturally non-trivial tasks) | `docs/forge/specs/spec-NNN.md` (architecture, interfaces, file map, decisions, risks) | human gate 1.5 |
| `/forge-master:plan-design` | approved PRD (+ spec if present) | `docs/forge/plans/plan-NNN.md` (the execution contract) | human gate 2 |
| `/forge-master:budget` | a decomposed (not-yet-frozen) plan (optional) | per-phase token matrix + filled `phase_budget` / `run_budget` | informs gate 2 |
| `/forge-master:run` | approved plan | autonomous loop until done/blocked → final report | — |

Each command is independently invocable — or use `forge` to chain them all: it detects existing artifacts (PRD/spec/plan/partial run) and offers to enter at the right stage instead of redoing work. Starting fresh? `prd-design`. Already have a spec? `prd-import` normalizes it (testable ACs, mandatory Non-Goals, stable IDs) and shows you exactly what it changed. Task with real architecture (new interfaces, data models, multiple components)? Add `spec-design` between PRD and plan — decisions get made once, phase subagents stop re-deriving architecture. Small task? Skip it; the spec is optional by design and always subordinate to the plan.

## Quick start

```
1. /forge-master:prd-design          # interview → PRD with Given/When/Then ACs → you approve
2. /forge-master:spec-design         # (optional) architecture, exact interfaces, file map,
                                     #   resolved decisions, risks → you approve
3. /forge-master:plan-design         # PRD (+ spec) → phases tagged junior/senior + light/heavy,
                                     #   proven AC coverage → you approve (contract frozen)
4. /forge-master:run                 # branch forge/NNN-<slug>, executes phase by phase,
                                     #   commits per phase, never asks mid-run
```

Interrupted? Compacted? Crashed? Just re-invoke `/forge-master:run` — state lives on disk, INIT detects the partial run and resumes. A phase that was in flight when the session died is recovered: its partial diff is stashed (never discarded) and the phase re-runs from a clean tree with its escalations and red-iteration count intact.

Fully unattended? Two harness primitives harden the loop beyond prose discipline: wrap the run in `/goal` ("every phase in the run state file terminal and final report written") so an evaluator model bounces premature stops back into the loop, and `/loop 30m /forge-master:run` to auto-resume after a crash or compaction — INIT's resume detection makes re-invocation idempotent. And when `on_complete: pr`, the final report ends with a handoff command (`/loop 30m check PR ...: address reviews, fix CI`) — the run ends at the PR, but reviews and CI don't.

## How it works

**Decompose.** Every PRD acceptance criterion is Given/When/Then and verifiable by a test or command. `plan-design` maps each AC to exactly one phase (orphan AC = invalid plan) over an acyclic dependency graph — and proves it with `forge-state lint`, not by eyeballing: unknown or cyclic dependencies, missing fields, orphan or double-covered ACs, and dependent members of a parallel group all fail the lint, and `run` refuses to seed a plan that fails it. A repo with no test runner gets an explicit `P0: setup test harness` phase in the plan, approved at gate 2 like any other.

**Triage.** Phases start optimistic (`junior`/`light`) and escalate UP only — `junior→senior`, then `light→heavy` — by deterministic rules over signals the loop already observes (K consecutive red iterations, stuck subagent, budget exhausted). The K rule is executed, not reasoned: `forge-state red` persists each red iteration and returns `retry`, `escalate` (with the bump), or `block`, so the count survives compaction. No triage agent, zero extra tokens. Every escalation is logged to `lessons.md` and improves the next plan's tags.

| tag | meaning |
|---|---|
| `junior` | plugin agent `forge-implementer-junior` (sonnet, low effort) |
| `senior` | plugin agent `forge-implementer-senior` (opus, high effort) |
| `light` | implement → run AC tests → verify → commit |
| `heavy` | phase spec → TDD red-green → independent code review → commit |

The two tags are two execution patterns: light = **inline execution** by the orchestrator itself (cheap, no dispatch overhead); heavy = **subagent-driven development** with a defined dispatch/report contract and freshness policy ([references/dispatch.md](skills/forge-run/references/dispatch.md)).

**Parallel execution.** Plans can declare Parallel Groups (mutually independent AND file-disjoint phases, approved at gate 2) and set `max_parallel` > 1 in Run Config. Each batched phase runs in its own git worktree on a child branch of the run branch; integration is sequential — the orchestrator commits each worktree, squash-merges by phase order, and runs `forge-state verify` on the run branch after every merge. A merge conflict or red suite is an integration failure that feeds the same K/escalation machinery, and the phase re-runs sequentially on the updated run branch. Default stays `max_parallel: 1` — parallelism is opt-in and never improvised at runtime ([references/parallel.md](skills/forge-run/references/parallel.md)).

**Budget (optional).** Before a large plan is frozen, `budget` estimates per-phase token cost from the plan's own signals (tier, process, AC count, parallel groups), prints a matrix, and fills `phase_budget` / `run_budget` with principled numbers instead of heuristics — so the loop's existing budget machinery (early-escalation signal + clean-stop cap) runs on real estimates. It also flags phases whose cost contradicts their tag (a `junior`/`light` phase estimating high is probably mis-tagged — cheaper to fix at plan time than via runtime escalation). Estimates are ranges, never gates; the human still approves at gate 2.

**Verify.** "Green" is the test runner's exit code, never agent opinion — guards against hallucinated progress. Double anti-regression: phase AC tests + full repo suite, so new phases can't silently break past ones. Since 0.18 this is enforced in code: the plan freezes one `gates:` command (derived by `plan-design` from the repo's CI config and test scripts; `lint` rejects a plan without it), and `forge-state verify <plan> <P> --prd <prd>` runs it over an identified code snapshot (a git tree id that excludes `docs/forge/` and `docs/context/`), fails when a covered non-`[manual-check]` AC has no test referencing its ID, and records `verify=pass|fail:<tree>` on the phase entry. `forge-state set <P> done` is refused unless the latest verify passed on exactly the committed tree; the refusal lists the differing paths. `--force --reason "<text>"` is the explicit escape for phases with no code to verify, persisted as `forced`.

**Containment.** Subagent roles are plugin agents (`agents/`): `forge-implementer-junior`, `forge-implementer-senior`, and a read-only `forge-reviewer` (Read, Grep, Glob only). A plugin-level PreToolUse hook (`hooks/hooks.json` → `hooks/forge-guard.mjs`) keys on those agent types and denies them writes under `docs/forge/` or `docs/context/`, mutating git (`add`, `commit`, `checkout`, `switch`, `restore`, `pull`, `push`, `merge`, `rebase`, `reset`, `cherry-pick`, `branch`, `tag`, `worktree`, `stash`, also inside chained commands) and `forge-state` calls. The orchestrator owns every commit and every state write. The hook fires in every session where the plugin is enabled, so it is silent and fail-open for everything that is not a forge subagent; detection is best-effort (Edit/Write/NotebookEdit paths and Bash command tokens, not shell redirections or other shells).

**Run lifecycle.** Run state is reconcilable, single-driver, and finishes once:
- `forge-state preflight <plan>` — on a fresh run, `on_complete: pr|merge` (default `pr`) without a git remote stops INIT; `plan-design` shows the same check as a hard block on the gate-2 card.
- `forge-state seed <plan> --holder <session-id>` takes a run lock (`<git-common-dir>/forge/plan-NNN.lock.json`, shared by every worktree, never committed). Another holder with a fresh heartbeat is refused; every mutating `forge-state` command refreshes the heartbeat; a heartbeat older than 120 minutes is taken over (`lock_takeover: true`). The lock is released when every phase is terminal and by `finish`. A crashed session's lock holds until stale; delete the lock file by hand only when you know no session is driving the run.
- `forge-state reconcile <plan>` marks `done {reconciled}` every phase whose commit subject on the run branch is `P<n>: <phase name>` — INIT uses it instead of hand-run `git log --grep` steps.
- `forge-state finish <plan> --action pr|merge|keep --ref <url|sha|branch>` records the landing twice: a marker in `<git-common-dir>/forge/plan-NNN.finished.json` and a `[meta] plan-NNN finished:` line in the state file, committed where the action landed. From then on `seed` and `next` report `finished: true`, a second `finish` exits 1, and a re-invoked `/forge-master:run` (e.g. by `/loop`) reports the run as already finished and never pushes, merges or opens a PR again.
- Re-opening a finished plan is not supported: write a new plan number. (By hand, it takes deleting both the marker file and the committed `[meta]` line.)

**TDD discipline.** Heavy phases follow the Iron Law per AC (`skills/forge-run/references/tdd.md`): test first → MUST fail → minimal implementation → green; code before failing test = violation, AC cycle restarts. Light phases are test-after by declared trade-off (token economy) — escalation to heavy restores full TDD.

**Code review contract.** Heavy phases get an independent, read-only reviewer (`forge-reviewer`; the orchestrator supplies the diff and runs the gates) with a defined contract (`skills/forge-run/references/code-review.md`): checklist (AC coverage, spec compliance, regression risk, quality), every finding `blocker` or `nit`. Blockers re-enter the implementation cycle and count toward K; nits log to `results.md` and never block. Reviewer feedback is verified against the code, not applied blindly.

**Attended mode.** `mode: attended` in Run Config pauses at exactly three points — before each escalation (approve/override/abort), on block (unblock with guidance/skip/stop), and to confirm the finish action. `autonomous` (default) never pauses mid-run.

**Finish stage.** When the suite is green, the run lands its branch per `on_complete`: `pr` (default — push + PR generated from the final report), `merge` (merge + delete branch), or `keep`. A run with blocked or plan-stale phases never merges. Phase subagents can also report "plan assumption broken" — the phase is marked `[plan-stale]`, skips escalation, and the final report recommends re-running `plan-design` on the remainder instead of executing a stale plan to exhaustion.

**Persist.** The human-approved **artifacts** and the run's phase **state** live under `docs/forge/`, which forge-master owns; the loop's learning notes flush to `docs/context/` after every phase (the `scaffold` skill's shared project-memory system, which forge-master integrates with rather than owns). Phase state stays out of scaffold's `todo.md` on purpose: scaffold's `/compact-context` deletes finished todos, which would deadlock or re-run a plan — so `todo.md` only carries a one-line pointer while a run is open, and `forge-state` removes it when the run finishes.

| location | file | role |
|---|---|---|
| `docs/forge/prd/` | `NNN-name.md` | the PRD — testable acceptance criteria |
| `docs/forge/specs/` | `spec-NNN.md` | technical design reference (optional; phases cite its sections) |
| `docs/forge/plans/` | `plan-NNN.md` | frozen execution contract |
| `docs/forge/runs/` | `plan-NNN.state.md` | phase status (pending / in_progress / done / blocked / ...), persisted escalations, red-iteration counts, verify evidence (`verify=`, `forced`, `reconciled`) and the `[meta]` finished line; written only by `forge-state` |
| `<git-common-dir>/forge/` | `plan-NNN.lock.json`, `plan-NNN.finished.json` | run lock and finish marker; outside the work tree, never committed |
| `docs/context/` | `todo.md` | one pointer line to the run state while a run is open |
| `docs/context/` | `results.md` | 1-4 line outcome per phase, blockers |
| `docs/context/` | `lessons.md` | friction events only — escalations, blockers, corrections |
| `docs/context/` | `memory.md` | one-line architecture decisions |
| `docs/context/` | `sesion-log.md` | one line per session (scaffold's file name) |

**Learn.** Friction events write lessons consumed by the next `plan-design` (better triage over time). First-pass-green phases write nothing — if everything is a lesson, nothing is.

**Isolate.** Each run lives on its own branch (`forge/NNN-<slug>`) with one atomic commit per phase tagged with the AC IDs it satisfies. You keep working on `main`. Full traceability: PRD → phase → test → commit.

## Blocked ≠ dead

A phase that stays red at `senior`+`heavy` after K iterations is marked `[blocked]`, its dependents `[blocked-upstream]`, and the loop continues with every independent branch of the graph. The final report lists done / blocked / pending, token spend, escalations, and lessons — then walks the PRD's Definition of Done, including any `[manual-check]` ACs (which never block the loop).

## Requirements

- A scaffolded workspace (`docs/context/`, `docs/forge/prd/`) — `run` checks and runs the `scaffold` skill if missing.
- A repo test framework — or `plan-design` writes a `P0: setup test harness` phase into the plan.
- Node.js on PATH, for the `forge-state` script and the guard hook (zero dependencies). Without it, the hook shows a non-blocking hook-error notice on every Edit/Write/Bash.
- Git; `forge-state verify` runs the plan's `gates:` with `bash -c` (Git Bash on Windows), falling back to the platform shell.

## Layout

```
.claude-plugin/
  plugin.json                  # plugin manifest
  marketplace.json             # single-plugin marketplace (GitHub install)
agents/
  forge-implementer-junior.md  # junior phase implementer (sonnet, low effort)
  forge-implementer-senior.md  # senior phase implementer (opus, high effort)
  forge-reviewer.md            # read-only heavy-phase reviewer (Read, Grep, Glob)
hooks/
  hooks.json                   # registers the PreToolUse guard
  forge-guard.mjs              # denies forge subagents state writes, mutating git, forge-state calls
  forge-guard.test.mjs         # its table-driven tests
skills/
  forge/SKILL.md               # umbrella — chains the full pipeline, all gates intact
  prd-design/SKILL.md          # gate 1   — idea → PRD (divergent phase for vague ideas)
  prd-import/SKILL.md          # gate 1   — existing spec → PRD
  spec-design/SKILL.md         # gate 1.5 — PRD → technical design (optional)
  plan-design/SKILL.md         # gate 2   — PRD (+ spec) → execution contract
  budget/SKILL.md              # optional — token matrix, fills phase_budget/run_budget before gate 2
  forge-run/SKILL.md           # the master loop (command: /forge-master:run)
  forge-run/references/
    tdd.md                     # Iron Law — heavy-phase red-green discipline
    code-review.md             # review contract — checklist, severities, routing
    dispatch.md                # dispatch protocol — subagent inputs, report contract, freshness
    debugging.md               # systematic debugging — hypothesis discipline per red iteration
    parallel.md                # worktree fan-out — plan-frozen parallel groups, sequential integration
  forge-run/scripts/
    forge-state.mjs            # run-state machine: lint, seed, next, set, red, escalate, recover, status,
                               #   verify, reconcile, finish, preflight (+ run lock)
    forge-git.mjs              # git helpers: code snapshots, gates runner, AC-test trace, phase commits
    forge-state.test.mjs       # its unit tests (node --test)
    forge-state.git.test.mjs   # temp-git-repo tests for the git-backed commands
templates/
  plan-template.md             # plan contract skeleton
  spec-template.md             # spec skeleton
validate.mjs                   # structural acceptance test: node validate.mjs
docs/
  forge/                       # forge-master artifacts (created at runtime)
    prd/NNN-name.md            #   the PRD
    specs/spec-NNN.md          #   the technical design (optional)
    plans/plan-NNN.md          #   the frozen execution contract
    runs/plan-NNN.state.md     #   run state, owned by forge-state
  context/                     # scaffold's shared memory: todo (pointer only), results, lessons, memory, sesion-log
  forge-master-design.md       # full design rationale
```

## License

MIT — see [LICENSE](LICENSE).
