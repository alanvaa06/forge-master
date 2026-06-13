---
name: spec-design
description: Turn an approved PRD into a technical design spec at docs/forge/specs/spec-NNN.md — architecture, components, exact interfaces, file map, resolved decisions, and risks that feed plan tagging. Optional step between prd-design/prd-import and plan-design; skip it for small tasks. Stops at human approval gate. Use after a PRD is approved when the task is architecturally non-trivial, or when the user says "write the spec", "design this", or "/forge-master:spec-design".
disable-model-invocation: true
---

# spec-design — PRD to Technical Design (Human Gate 1.5)

<!-- markers: ## Architecture · Interfaces · File Map · docs/forge/specs/spec- · OPTIONAL · gate 1.5 -->

Produce `docs/forge/specs/spec-NNN.md` from an approved `docs/forge/prd/NNN-name.md`: the HOW that sits between the PRD's WHAT and the plan's WHEN. Decisions get made once here, so phase subagents never re-derive architecture inconsistently.

**This step is OPTIONAL by design.** The loop's philosophy is optimistic defaults — if the task looks small (few phases, obvious structure, no new interfaces), say so and ASK the user as a lettered list (mark one **Recommended** with a concrete why), never decide yourself:
> This task looks small. Proceed with the spec?
> a) Skip the spec, go straight to `/forge-master:plan-design` — **Recommended**, small task with obvious structure
> b) Write the spec anyway — you want the design locked before planning

A spec is warranted when any of: multiple components must agree on interfaces, a data model or API contract is being introduced/changed, the PRD's Constraints imply architectural tradeoffs, or `lessons.md` shows past runs failing on design drift — when these hold, recommend (b) instead. The user picks by replying with a letter.

**Subordination rule:** the plan (`plan-NNN.md`) is the ONLY execution contract. The spec is a design reference the plan cites — if they ever conflict, the plan wins and the spec gets corrected.

## Step 1 — Load inputs
- Read the approved PRD `docs/forge/prd/NNN-name.md` (ask which N if ambiguous). Do not start without an approved PRD — ACs drive the design.
- Read `docs/context/memory.md` (existing architecture decisions bind you) and `docs/context/lessons.md` (past design-related friction).
- For an existing codebase: scan the repo structure and conventions — the spec extends what exists, it does not invent a parallel architecture.
- Read `templates/spec-template.md` (from this plugin) as the output skeleton.

## Step 2 — Design
Fill the template's sections, anchored to PRD IDs throughout:

1. **Architecture** — the shape of the solution in 3-10 lines. Smallest design that satisfies every AC; no speculative generality (YAGNI).
2. **Components** — each with ONE clear responsibility, its collaborators, and the `US-n` stories it serves. A component serving no story is overbuild — delete it.
3. **Interfaces** — exact signatures, schemas, routes, DDL, message shapes. This is the section phase subagents depend on most: vague prose here becomes incompatible implementations later.
4. **File Map** — files to create/modify, one responsibility each, mapped to components. Phase subagents follow this instead of improvising structure.
5. **Decisions** — every tradeoff resolved, one line each with the why. Anything left open becomes a mid-run stall; close it now or ask the user.
6. **Risks** — each mapped to the components/ACs it threatens, with mitigation. plan-design reads this to tag phases: a phase touching a listed risk should not start `junior`/`light`.
7. **Out of Scope (technical)** — paths deliberately not taken, complementing the PRD's Non-Goals.

Coverage check before presenting: every PRD `US-n` is served by at least one component, and every interface a story needs is specified. A story with no supporting design = incomplete spec.

## Step 3 — Resolve open questions
If anything genuinely cannot be decided from the PRD, repo, and memory — collect ALL open questions and ask the user in ONE batched message (numbered, with your recommended default per question). Never leave a `TBD` in the written spec.

## Step 4 — Write the file
Write `docs/forge/specs/spec-NNN.md` (create `docs/forge/specs/` if it does not exist) by filling `templates/spec-template.md` completely — no `<...>` placeholders left.

## Step 5 — Human gate 1.5
Present: the architecture summary, key decisions with reasoning, the risk list, and the story-coverage check. Ask for explicit approval. On approval, present the next step as a lettered list:
> Spec approved. Next:
> a) Proceed to `/forge-master:plan-design` — **Recommended**, it reads this spec and cites its sections in the phases
> b) Not yet — revise the spec first

The user chooses by replying with a letter.
