---
name: budget
description: Estimate the token cost of an approved-shape plan before it is frozen. Reads the PRD and the plan, produces a per-phase Budget Matrix (tier/process/AC-count drivers → estimated token range), flags phases whose cost contradicts their tier/process tag, and writes principled phase_budget / run_budget values into the plan's Run Config. Optional, informative, never a gate. Use after plan-design has decomposed phases but before gate-2 approval, or when the user says "estimate the budget", "how much will this cost", or "/forge-master:budget".
disable-model-invocation: true
---

# budget — Token Budget Matrix (optional, before gate 2)

<!-- markers: ## Budget Matrix · phase_budget · run_budget · order-of-magnitude · OPTIONAL · gate 2 · never a gate -->

Turn the plan's hand-waved budget heuristics into principled numbers. You estimate the token cost of each phase from signals already in the plan, present a matrix, and fill the `phase_budget` / `run_budget` fields the loop already consumes (`phase_budget` → early-escalation signal; `run_budget` → clean-stop cap).

**This step is OPTIONAL.** Small plans (few light phases) don't need it — the default heuristics are fine. When the plan looks small, say so and offer the choice as a lettered list (mark one **Recommended**) rather than deciding silently:
> This plan is small (few light phases). Estimate the budget?
> a) Skip — **Recommended**, default heuristics are fine here; return to gate 2
> b) Run the matrix anyway — you want a cost ceiling set with eyes open

It is worth running when the plan is large, has heavy phases, declares parallel groups, or the user wants a cost ceiling set with eyes open — recommend (b) in those cases.

**Timing matters.** Run AFTER `plan-design` has decomposed phases but BEFORE gate-2 approval — the budgets you write become part of the FROZEN contract, approved by the human alongside the phase list. Never edit an already-frozen plan; if invoked on one, re-open it explicitly for re-approval.

**It is NOT a gate and NEVER blocks.** Estimates are rough by nature. Present ranges and order-of-magnitude, never false precision. The human still decides at gate 2.

## Step 1 — Load inputs
- Read the target `docs/forge/plans/plan-NNN.md`: phases, their `tier`, `process`, `covers` (AC IDs), `depends_on`, and any `## Parallel Groups`.
- Read the PRD `docs/forge/prd/NNN-name.md` for AC complexity (a multi-clause Given/When/Then costs more than a one-liner).
- Read `docs/context/lessons.md` — if past runs recorded actual phase costs, calibrate against them instead of priors.

## Step 2 — Estimate per phase (drivers, not guesses)
Estimate each phase from these drivers. Treat the anchors as order-of-magnitude priors, not promises:

| driver | effect on cost |
|---|---|
| **tier** | `junior` = small/cheap model, low effort · `senior` = top model, high effort (roughly an order more) |
| **process** | `light` = one implement + test-after + commit cycle · `heavy` = phase spec + a red-green TDD cycle PER covered AC + an independent review pass (several × light) |
| **# covered ACs** | heavy cost scales ~linearly per AC (one cycle each); light scales weakly |
| **review iterations** | heavy phases may loop on blockers — add headroom, don't assume first-pass |
| **files touched** | more files in the plan notes / cited File Map rows → more context per dispatch |

Express each phase as a RANGE (low–high), not a point. State your anchors so the estimate is reproducible.

## Step 3 — Build the Budget Matrix
Present:

```
| Phase | tier | process | #AC | est. tokens (low–high) |
|-------|------|---------|-----|------------------------|
| P1    | ...  | ...     | ... | ...                    |
| TOTAL |      |         |     | sum(low) – sum(high)   |
```

For parallel groups, note that members spend concurrently — the TOTAL token cost is unchanged, but wall-clock compresses; do not double-count.

## Step 4 — Flag tag/cost contradictions
A phase tagged `junior`/`light` whose estimate lands high is probably mis-tagged. Flag it and recommend bumping the tag at plan time — re-tagging now is free; discovering it via runtime escalation costs K wasted red iterations first. This feeds the same triage discipline as `lessons.md`.

## Step 5 — Write the budgets into the plan
With the matrix agreed, fill the plan's Run Config:
- `phase_budget`: a per-phase soft signal — set near the high end of a typical phase's estimate (exceeding it early-escalates, it is not a kill).
- `run_budget`: a safety CAP, not a prediction — set to TOTAL high estimate × a headroom factor (e.g. 1.3). On exhaustion the loop stops cleanly with a report.
Frame both to the user in those terms: signal vs cap.

## Step 6 — Hand back
The matrix is informative AND it has filled the contract's budget fields. Tell the user the numbers are estimates with wide error bars, then return to `plan-design`'s gate 2 — the human approves the phases AND these budgets together. `budget` never approves anything itself and never blocks the run.
