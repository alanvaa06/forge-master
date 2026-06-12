# forge-master — Design Spec

**Date:** 2026-06-11
**Status:** Draft for review
**Author:** Claude (brainstormed with Alan Vazquez)

---

## 1. Purpose

Claude Code plugin that executes **agentic loop engineering** over complex, long-running tasks driven by a designed PRD. It decomposes the PRD into phases, routes each phase by complexity (senior/junior agent, heavy/light process), applies TDD discipline where demanded, verifies against testable acceptance criteria, self-evaluates, and learns across runs — until the task is complete or cleanly blocked.

Grounded in: Loop Engineering (act→observe→reason→repeat with explicit exits), Agent Harness Engineering (legibility, filesystem as system of record), Superpowers-style TDD discipline (replicated natively, no runtime dependency), and the user's existing `scaffold` skill (`docs/context/` memory system).

## 2. Decisions Locked

| # | Decision | Choice |
|---|---|---|
| D1 | Runtime | **Skill-driven master loop** (main agent, conversational) with optional fan-out to Workflow scripts for heavy independent phases. No external SDK. |
| D2 | Decomposition | **Native `plan-design` skill** replicating spec→plan→execute discipline. Self-contained; no superpowers dependency at runtime. |
| D3 | Triage | **Hybrid:** initial tags assigned by `plan-design` (human-reviewed), runtime adjustment via **deterministic rules over loop signals** (no triage agent, zero extra tokens). Escalation is **unidirectional (only up)**. Every escalation logged to lessons. |
| D4 | Autonomy | **Autonomous by default.** Gates and success/failure criteria are defined in the plan and approved once. The loop never requests human input mid-run. Stuck = document + continue independent branches or terminate cleanly. Optional `attended` mode. |
| D5 | Git isolation | **Branch per run** (`forge/NNN-<slug>`), **atomic commit per phase**. Sequential. Worktree/parallelism deferred to v2. |
| D6 | Name | Plugin: **forge-master**. |

## 3. Components

```
forge-master/
  .claude-plugin/plugin.json
  skills/
    prd-design/SKILL.md      # A  — interactive: idea → docs/prd/NNN-name.md
    plan-design/SKILL.md     # A' — PRD → docs/context/plan-NNN.md (execution contract)
    forge-run/SKILL.md       # B  — orchestrator / master loop
  templates/
    plan-template.md         # only addition; docs/context scaffold reused from existing `scaffold` skill
```

User flow:

```
/forge-master:prd-design   →  PRD approved          (human gate 1)
/forge-master:plan-design  →  plan approved          (human gate 2 — THE execution contract)
/forge-master:run          →  autonomous loop until done/blocked → final report
```

Each skill independently invocable (existing PRD → enter at plan-design). `forge-run` checks `docs/context/` exists; if missing, runs the user's `scaffold` skill first. No template duplication.

## 4. PRD Contract (`docs/prd/NNN-name.md`)

Produced by `prd-design`, consumed by `plan-design`.

```markdown
# PRD-NNN: <name>

## Goal
<1-3 lines: what and why>

## Non-Goals
<explicit out-of-scope — anti-drift boundary for the loop>

## User Stories
### US-1: <title>
As a <role>, I want <action>, so that <benefit>.
- AC-1.1: Given <state>, When <action>, Then <observable result>
- AC-1.2: ...

## Constraints
<stack, performance, security, technical limits>

## Definition of Done
- [ ] All AC green
- [ ] <extras: lint, docs, etc.>
```

Hard rules enforced by `prd-design` during the interview:

- **Every story ≥1 AC; every AC in Given/When/Then, verifiable by test or command.** A story without a testable AC does not enter the PRD — ACs are the loop's exit conditions, non-negotiable.
- `Non-Goals` mandatory (even 1 line).
- Stable IDs (`US-n`, `AC-n.m`) — plan, todo, and commits reference by ID. Full traceability PRD→phase→test→commit.

Behavior: brainstorming-style interview (one question at a time, explores intent, proposes stories, user corrects) → writes file → **human gate 1: PRD approval**.

## 5. Plan Contract (`docs/context/plan-NNN.md`)

Produced by `plan-design`, executed by `forge-run`. **This file IS the execution contract** — after approval, the loop asks nothing.

```markdown
# Plan-NNN: <name>  (PRD: docs/prd/NNN-name.md)

## Run Config
- mode: autonomous | attended     (default: autonomous)
- branch: forge/NNN-<slug>
- K: 3                            (max red iterations per phase before escalate/block)
- phase_budget: <approx tokens>   (escalation signal, not hard kill)
- run_budget: <global cap>

## Phases
### P1: <name>
- covers: AC-1.1, AC-1.2          (explicit phase→AC map)
- depends_on: —                   (P-ids; defines what remains executable on block)
- tier: junior | senior           (initial tag, runtime-escalable ↑)
- process: light | heavy
- success: listed ACs green + repo test suite not broken
- notes: <risks, probable files>
```

Tag semantics:

| process | Runtime flow |
|---|---|
| **light** | inline in main agent or single subagent: implement → write/run AC tests → commit. No intermediate spec, no separate review. |
| **heavy** | full cycle: brief phase spec → TDD red-green (AC test first, fails, implement, green) → code review by independent subagent → commit. Independent heavies may fan-out via Workflow. |

| tier | Agent |
|---|---|
| **junior** | cheap-model subagent (haiku/sonnet), low effort |
| **senior** | top model, high effort |

`plan-design` rules:

- Every PRD AC appears in exactly one phase (`covers`) — **total coverage verified before presenting**. Orphan AC = invalid plan.
- `depends_on` graph acyclic; used by failure floor to know what stays executable.
- Reads `docs/context/lessons.md` before tagging — past escalations correct future tags (learning loop for triage).
- Presents plan + tags + reasoning → **human gate 2** → approved = frozen.

## 6. The Loop (`/forge-master:run`)

State machine; live state on disk, not in context.

```
INIT:  read plan + lessons + todo. Verify scaffold. Create/checkout branch.
       Seed todo.md: one entry per phase [pending].

LOOP:  while (executable phases remain):
         phase = next with depends_on satisfied
         todo.md → in_progress
         execute per process/tier table
         verify: run phase AC tests + full repo suite
         ├─ green → commit "P<n>: <name> [AC-x.y..]" → todo.md done
         │          → results.md (1-4 lines) → next phase
         └─ red   → iter++
                    iter ≥ K, tier/process not maxed → ESCALATE
                      (↑ junior→senior, light→heavy; reset iter;
                       lesson: "P<n> escalated: <reason>")
                    iter ≥ K, already senior+heavy → BLOCK:
                      blocker → results.md + lesson; todo.md [blocked]
                      dependent phases → [blocked-upstream]
                      continue with independent branches

END:   all done → PRD Definition of Done checklist
       final report: done/blocked/pending + tokens + escalations + lessons
       session-log.md + memory.md (architecture decisions, 1 line each)
```

Critical properties:

- **After EVERY phase, full state flushed to disk** (todo, results, lessons, commit). Compaction or crash loses at most the in-flight phase. **Resume = re-invoke `/forge-master:run`** — INIT detects existing plan + partial todo and continues. Multi-session for free.
- **Verification = commands, not judgment.** "Green" is decided by the test runner, never by agent opinion — guards against hallucinated progress.
- **Double anti-regression check:** phase AC tests + full repo suite. New phases cannot break past phases.
- Phase subagents receive minimal context: their plan section, their ACs, relevant lessons, memory. **Never the run history** — master context stays lean.
- Escalation: unidirectional, deterministic, logged (per D3).

Escalation signals (free — already observed by the loop):

- AC red K consecutive iterations
- junior agent declares stuck / no progress
- files touched ≫ plan estimate
- phase token budget exhausted without green

## 7. Learning + Token Economy

Learning (no separate code — loop writes to existing scaffold):

| Event | File | Consumed later by |
|---|---|---|
| Escalation (tier or process) | `lessons.md`: "P-type X tagged light escalated — tag heavy if <pattern>" | next `plan-design` (better triage) |
| Blocker | `lessons.md` + `results.md` | user on relaunch; future plan-design |
| User correction mid-run (attended) | `lessons.md` | every future run |
| Architecture decision | `memory.md` (1 line) | every agent touching the repo |
| Run end | `session-log.md` + report | multi-session continuity |

**Anti-noise rule: lessons only on friction events (escalation, blocker, correction). First-pass-green phases write nothing** — if everything is a lesson, nothing is.

Token economy:

1. Optimistic defaults: phases start junior/light unless evidence; escalate only when reality demands.
2. Subagents get minimal context (phase + ACs + lessons), never history.
3. Lean master: orchestrates and verifies, never implements — implementation lives in disposable subagents.
4. Runtime triage is free (rules, not an agent).
5. `phase_budget` as early escalation signal — cuts expensive retry spirals.

## 8. Edge Cases

- **Non-executable ACs** ("UI looks good"): `prd-design` rejects or reformulates to command-verifiable (Playwright, curl, assert). Genuinely manual → tagged `manual-check` in plan, verified in final report, **never blocks the loop**.
- **Repo without test framework:** INIT detects → implicit P0 "setup test harness" before any phase.
- **Human-loop conflict:** dedicated branch `forge/NNN-*` isolates; user keeps working on main.
- **Global budget exhausted:** clean stop with report (done/pending state), never mid-phase without commit.

## 9. Out of Scope (v1)

- Worktree-per-phase parallelism (v2; D5 keeps sequential branch-per-run).
- De-escalation (tier/process only go up within a run).
- Cross-repo runs.
- Automatic PRD inference from free-form prompts (PRD always passes human gate 1).

## 10. Open Items for Implementation Plan

- `plugin.json` metadata + skill frontmatter (`disable-model-invocation` for run?).
- Exact plan-template.md wording.
- Workflow fan-out script for independent heavy phases (v1 optional; design supports it).
- Defaults: K=3, phase_budget/run_budget heuristics.
