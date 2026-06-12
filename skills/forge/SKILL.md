---
name: forge
description: Umbrella entry point for the full forge-master pipeline — chains prd-design, optional spec-design, plan-design, and run in one invocation while keeping every human gate intact. Detects existing artifacts (PRD, spec, plan) and offers to enter at the right stage instead of redoing work. Use when the user says "/forge-master:forge", "forge this", or wants the whole idea-to-execution loop from a single command.
disable-model-invocation: true
---

# forge — Full Pipeline (Umbrella)

You chain the four stages below in order. You are a dispatcher, not a shortcut: **never skip a gate** — each stage's human approval is required before the next stage starts, exactly as if the user had invoked the stage skill directly.

## Stage 0 — Detect existing artifacts (enter at the right stage)
Before starting from scratch, list what already exists and ask the user where to enter:
- `docs/prd/NNN-*.md` present and relevant to the user's request → offer to reuse the existing artifact and enter at Stage 2 (or Stage 1.5) instead of redoing the PRD. If the user provided an external/unnormalized spec document, route Stage 1 through `prd-import` instead of `prd-design`.
- `docs/context/spec-NNN.md` present for that PRD → offer to enter at Stage 2.
- `docs/context/plan-NNN.md` present and approved → offer to enter at Stage 3.
- Partial `todo.md` for that plan → this is a resume; go straight to Stage 3 (`run` INIT handles resume detection).
The user picks the entry stage; recommend, never assume.

## Stage 1 — PRD (human gate 1)
Invoke the `prd-design` skill (or `prd-import` for an existing document) and follow it fully — divergent exploration, convergent interview, hard AC rules. Stop at its approval gate. Do not continue until the user explicitly approves the PRD.

## Stage 1.5 — Spec (optional, human gate 1.5)
After PRD approval, ask the spec-or-plan question exactly as `prd-design` specifies (recommend, user decides). If the user chooses a spec, invoke the `spec-design` skill and stop at its approval gate.

## Stage 2 — Plan (human gate 2)
Invoke the `plan-design` skill and follow it fully — decomposition, tagging, total coverage proof. Stop at its approval gate. The approved plan is the frozen execution contract.

## Stage 3 — Run
Invoke the `run` skill. From here the loop's own autonomy contract governs: autonomous mode asks nothing mid-run; attended mode pauses only at its defined points. The pipeline ends with the run's final report.

## Rules
- **Never skip a gate.** No stage starts without the previous stage's explicit user approval, even if the user seems eager — the gates ARE the product.
- One stage at a time; never pre-generate a later stage's artifact while an earlier gate is open.
- If the user aborts at any gate, stop cleanly and say what artifact exists and how to re-enter later (`/forge-master:forge` re-detects in Stage 0).
