# Spec-NNN: <name>  (PRD: docs/forge/prd/NNN-name.md)

> Technical design reference. Approved at human gate 1.5, BEFORE plan-design. Subordinate to the plan:
> the plan is the only execution contract — phases CITE spec sections; the spec never overrides the plan.

## Architecture
<High-level approach in 3-10 lines: the shape of the solution, main components and how they connect.
A small ASCII diagram is welcome.>

## Components
### C1: <name>
- responsibility: <one clear responsibility>
- collaborates_with: <C-ids it talks to>
- serves: US-1, US-2              # PRD story IDs this component exists for

## Interfaces
> Data contracts and boundaries phase subagents must respect. Exact signatures/schemas, not prose.

### I1: <name>  (C1 -> C2)
```
<function signature, API route + request/response schema, DB table DDL, message shape, CLI contract...>
```

## File Map
> Files to create/modify, one responsibility each. Phase subagents follow this — no improvised structure.

| Path | Role | Component |
|------|------|-----------|
| `src/<path>` | <one-line role> | C1 |

## Decisions
> Tradeoffs resolved NOW so no phase subagent re-litigates them. One line each: decision + why.

- D1: <chosen> over <rejected> — <reason>.

## Risks
> Feeds plan-design tier/process tagging: a phase touching a listed risk should not start junior/light.

- R1: <risk> — affects: <C-ids / AC-ids> — mitigation: <approach>.

## Out of Scope (technical)
<Technical paths deliberately not taken; complements PRD Non-Goals at design level.>
