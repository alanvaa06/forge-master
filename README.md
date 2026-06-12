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
claude plugin validate .       # official manifest validation
node validate.mjs              # this repo's structural acceptance test
```

## When to use forge-master

**Use forge-master when:** the task is long-running or unattended; a PRD with testable acceptance criteria exists or can be written; you want to approve a contract once and let the loop execute to done/blocked; or you need resumability across sessions and compaction.

**Prefer normal interactive work (or the superpowers workflow) when:** the task is short or exploratory; requirements are still being discovered mid-task; or you want to supervise and steer every step.

The two are complementary — install them side by side: superpowers for interactive craftsmanship, forge-master for contract-driven autonomous runs.

## Commands

| Command | Input | Output | Gate |
|---|---|---|---|
| `/forge-master:forge` | anything — chains the full pipeline below | idea → PRD → (spec) → plan → run, every gate intact | all gates |
| `/forge-master:prd-design` | raw idea (interview; vague ideas get 2-3 approaches to pick from first) | `docs/prd/NNN-name.md` | human gate 1 |
| `/forge-master:prd-import` | existing PRD/spec (file, paste, Jira/Notion/Linear export) | `docs/prd/NNN-name.md` + Adjustments changelog | human gate 1 |
| `/forge-master:spec-design` | approved PRD (optional — for architecturally non-trivial tasks) | `docs/context/spec-NNN.md` (architecture, interfaces, file map, decisions, risks) | human gate 1.5 |
| `/forge-master:plan-design` | approved PRD (+ spec if present) | `docs/context/plan-NNN.md` (the execution contract) | human gate 2 |
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

Interrupted? Compacted? Crashed? Just re-invoke `/forge-master:run` — state lives on disk, INIT detects the partial run and resumes. At most the in-flight phase is lost.

## How it works

**Decompose.** Every PRD acceptance criterion is Given/When/Then and verifiable by a test or command. `plan-design` maps each AC to exactly one phase (orphan AC = invalid plan) over an acyclic dependency graph.

**Triage.** Phases start optimistic (`junior`/`light`) and escalate UP only — `junior→senior`, then `light→heavy` — by deterministic rules over signals the loop already observes (K consecutive red iterations, stuck subagent, budget exhausted). No triage agent, zero extra tokens. Every escalation is logged to `lessons.md` and improves the next plan's tags.

| tag | meaning |
|---|---|
| `junior` | cheap-model subagent, low effort |
| `senior` | top model, high effort |
| `light` | implement → run AC tests → commit |
| `heavy` | phase spec → TDD red-green → independent code review → commit |

The two tags are two execution patterns: light = **inline execution** by the orchestrator itself (cheap, no dispatch overhead); heavy = **subagent-driven development** with a defined dispatch/report contract and freshness policy ([references/dispatch.md](skills/forge-run/references/dispatch.md)).

**Parallel execution.** Plans can declare Parallel Groups (mutually independent AND file-disjoint phases, approved at gate 2) and set `max_parallel` > 1 in Run Config. Each batched phase runs in its own git worktree on a child branch of the run branch; integration is sequential — merge by phase order with the full repo suite after every merge. A merge conflict or red suite is an integration failure that feeds the same K/escalation machinery, and the phase re-runs sequentially on the updated run branch. Default stays `max_parallel: 1` — parallelism is opt-in and never improvised at runtime ([references/parallel.md](skills/forge-run/references/parallel.md)).

**Verify.** "Green" is the test runner's exit code, never agent opinion — guards against hallucinated progress. Double anti-regression: phase AC tests + full repo suite, so new phases can't silently break past ones.

**TDD discipline.** Heavy phases follow the Iron Law per AC (`skills/forge-run/references/tdd.md`): test first → MUST fail → minimal implementation → green; code before failing test = violation, AC cycle restarts. Light phases are test-after by declared trade-off (token economy) — escalation to heavy restores full TDD.

**Code review contract.** Heavy phases get an independent reviewer with a defined contract (`skills/forge-run/references/code-review.md`): checklist (AC coverage, spec compliance, regression risk, quality), every finding `blocker` or `nit`. Blockers re-enter the implementation cycle and count toward K; nits log to `results.md` and never block. Reviewer feedback is verified against the code, not applied blindly.

**Attended mode.** `mode: attended` in Run Config pauses at exactly three points — before each escalation (approve/override/abort), on block (unblock with guidance/skip/stop), and to confirm the finish action. `autonomous` (default) never pauses mid-run.

**Finish stage.** When the suite is green, the run lands its branch per `on_complete`: `pr` (default — push + PR generated from the final report), `merge` (merge + delete branch), or `keep`. A run with blocked or plan-stale phases never merges. Phase subagents can also report "plan assumption broken" — the phase is marked `[plan-stale]`, skips escalation, and the final report recommends re-running `plan-design` on the remainder instead of executing a stale plan to exhaustion.

**Persist.** Full state flushes to `docs/context/` after every phase:

| file | role |
|---|---|
| `plan-NNN.md` | frozen execution contract |
| `spec-NNN.md` | technical design reference (optional; phases cite its sections) |
| `todo.md` | phase status: pending / in_progress / done / blocked |
| `results.md` | 1-4 line outcome per phase, blockers |
| `lessons.md` | friction events only — escalations, blockers, corrections |
| `memory.md` | one-line architecture decisions |
| `session-log.md` | one line per session |

**Learn.** Friction events write lessons consumed by the next `plan-design` (better triage over time). First-pass-green phases write nothing — if everything is a lesson, nothing is.

**Isolate.** Each run lives on its own branch (`forge/NNN-<slug>`) with one atomic commit per phase tagged with the AC IDs it satisfies. You keep working on `main`. Full traceability: PRD → phase → test → commit.

## Blocked ≠ dead

A phase that stays red at `senior`+`heavy` after K iterations is marked `[blocked]`, its dependents `[blocked-upstream]`, and the loop continues with every independent branch of the graph. The final report lists done / blocked / pending, token spend, escalations, and lessons — then walks the PRD's Definition of Done, including any `[manual-check]` ACs (which never block the loop).

## Requirements

- A scaffolded workspace (`docs/context/`, `docs/prd/`) — `run` checks and runs the `scaffold` skill if missing.
- A repo test framework — or `run` inserts an implicit P0 "setup test harness" phase first.

## Layout

```
.claude-plugin/
  plugin.json                  # plugin manifest
  marketplace.json             # single-plugin marketplace (GitHub install)
skills/
  forge/SKILL.md               # umbrella — chains the full pipeline, all gates intact
  prd-design/SKILL.md          # gate 1   — idea → PRD (divergent phase for vague ideas)
  prd-import/SKILL.md          # gate 1   — existing spec → PRD
  spec-design/SKILL.md         # gate 1.5 — PRD → technical design (optional)
  plan-design/SKILL.md         # gate 2   — PRD (+ spec) → execution contract
  forge-run/SKILL.md           # the master loop (command: /forge-master:run)
  forge-run/references/
    tdd.md                     # Iron Law — heavy-phase red-green discipline
    code-review.md             # review contract — checklist, severities, routing
    dispatch.md                # dispatch protocol — subagent inputs, report contract, freshness
    debugging.md               # systematic debugging — hypothesis discipline per red iteration
    parallel.md                # worktree fan-out — plan-frozen parallel groups, sequential integration
templates/
  plan-template.md             # plan contract skeleton
  spec-template.md             # spec skeleton
validate.mjs                   # structural acceptance test: node validate.mjs
docs/forge-master-design.md    # full design rationale
```

## License

MIT — see [LICENSE](LICENSE).
