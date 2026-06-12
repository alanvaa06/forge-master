---
name: plan-design
description: Decompose an approved PRD into docs/context/plan-NNN.md — phases tagged tier (junior/senior) and process (light/heavy), each mapped to the ACs it covers, with a proven total-coverage table and an acyclic depends_on graph. Reads docs/context/lessons.md so past escalations improve triage. Stops at human approval gate. Use after a PRD is approved, or when the user says "write the plan" or "/forge-master:plan-design".
disable-model-invocation: true
---

# plan-design — PRD to Execution Contract (Human Gate 2)

<!-- markers: covers · depends_on · lessons.md · Total coverage · gate 2 -->

Produce `docs/context/plan-NNN.md` from `docs/prd/NNN-name.md`. After approval this file is the FROZEN execution contract — `run` asks nothing.

## Step 1 — Load inputs
- Read the target PRD `docs/prd/NNN-name.md` (ask which N if ambiguous).
- If `docs/context/spec-NNN.md` exists (produced by `spec-design`), read it. Phases then follow its File Map and Interfaces, `notes:` cite the spec sections a phase implements, and the spec's Risks inform tagging — a phase touching a listed risk does not start `junior`/`light`. No spec = proceed normally; the spec is optional and subordinate to this plan.
- Read `docs/context/lessons.md`. Past escalation lessons ("P-type X tagged light escalated — tag heavy when <pattern>") MUST inform your tagging. This is the triage learning loop.
- Read `templates/plan-template.md` (from this plugin) as the output skeleton.

## Step 2 — Decompose into phases
- Group the PRD's ACs into phases (`P1`, `P2`, ...). Each phase is an independently committable, independently verifiable unit of work.
- For each phase set:
  - **covers:** the AC IDs it satisfies.
  - **depends_on:** prerequisite P-ids. The graph MUST be acyclic. It defines what remains executable if a phase blocks.
  - **tier:** `junior` (cheap-model subagent, low effort) or `senior` (top model, high effort). Start optimistic — junior unless evidence (PRD constraints, a relevant lesson) demands senior.
  - **process:** `light` (inline implement -> write/run AC tests -> commit; no separate spec or review) or `heavy` (brief phase spec -> TDD red-green -> independent-subagent code review -> commit). Start light unless complexity/risk warrants heavy.
  - **success:** covered ACs green + full repo test suite still passes.
  - **notes:** risks, probable files, the reason for the tier/process choice (cite a lesson if one applied).

## Step 3 — Total coverage proof (do this BEFORE presenting)
Build the coverage table: every PRD AC -> the single phase that covers it.
- **Every AC appears in exactly one phase.** An AC covered by zero phases (orphan) makes the plan INVALID — fix before presenting.
- An AC covered by two phases is also invalid — assign it to one.
- Verify the `depends_on` graph is acyclic.

## Step 4 — Run config
Fill `Run Config`: mode (default `autonomous`), `branch: forge/NNN-<slug>`, `K: 3`, and `phase_budget` / `run_budget` heuristics sized to the PRD.

## Step 5 — Write the file
Write `docs/context/plan-NNN.md` by filling `templates/plan-template.md` completely — no `<...>` placeholders left.

## Step 6 — Human gate 2
Present: the phase list, each phase's tier/process tags WITH the reasoning (and any lesson that drove a non-default tag), and the total-coverage table. Ask for explicit approval. On approval the plan is FROZEN. Tell the user the next step is `/forge-master:run`.
