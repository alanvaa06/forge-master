---
name: prd-design
description: Interview a user from a raw idea into a testable PRD at docs/prd/NNN-name.md. Every user story gets at least one Given/When/Then acceptance criterion verifiable by test or command. Mandatory Non-Goals. Stable IDs (US-n, AC-n.m). Stops at human approval gate. Use when starting a forge-master run, or when the user says "write a PRD", "/forge-master:prd-design", or describes a feature to build.
disable-model-invocation: true
---

# prd-design — PRD Interview (Human Gate 1)

<!-- markers: ## Interview · Given/When/Then · Non-Goals · Definition of Done · gate 1 -->

Produce `docs/prd/NNN-name.md`: the contract consumed by `plan-design`. The acceptance criteria you write here become the loop's exit conditions, so they must be verifiable.

## Step 1 — Locate / number the PRD
- Ensure `docs/prd/` exists. If `docs/` scaffold is absent, tell the user to run the `scaffold` skill first (or run it for them), then continue.
- `NNN` = next zero-padded integer after the highest existing `docs/prd/NNN-*.md` (start at `001`).
- Derive `<name>` as a short kebab-case slug from the idea.

## Step 2 — Interview (one question at a time)
Brainstorming style: ask ONE question, wait, incorporate, propose, let the user correct. Do not dump a full PRD up front. Explore intent before structure.

Cover, in roughly this order:
1. **Goal** — what and why, in 1-3 lines.
2. **Non-Goals** — explicit out-of-scope. MANDATORY, even one line. This is the loop's anti-drift boundary.
3. **User stories** — for each: `As a <role>, I want <action>, so that <benefit>.` Assign `US-1`, `US-2`, ...
4. **Acceptance criteria** — for each story, propose ACs in **Given/When/Then** form, each verifiable by an automated test or a shell command. Assign `AC-1.1`, `AC-1.2`, ...
5. **Constraints** — stack, performance, security, technical limits.
6. **Definition of Done** — all ACs green, plus any extras (lint, docs, coverage).

## Hard rules (enforce during the interview, do not skip)
- **Every story has >= 1 AC. Every AC is Given/When/Then and verifiable by test or command.** A story with no testable AC does NOT enter the PRD — reformulate it or drop it.
- **Non-Goals is mandatory.**
- **Stable IDs** (`US-n`, `AC-n.m`) never reused or renumbered — plan, todo, tests, and commits reference them. This is the PRD->phase->test->commit traceability spine.
- Non-executable ACs ("looks good", "feels fast"): reformulate to command-verifiable (Playwright assertion, `curl` + status, a measured threshold). If genuinely manual, mark the AC `[manual-check]` — it will be verified in the final report and must NEVER block the loop.

## Step 3 — Write the file
Write `docs/prd/NNN-name.md` using exactly this structure:

```markdown
# PRD-NNN: <name>

## Goal
<1-3 lines: what and why>

## Non-Goals
<explicit out-of-scope>

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

## Step 4 — Human gate 1
Present the finished PRD. Ask for explicit approval. Do NOT proceed to `plan-design` until the user approves. On approval, tell them the next step is `/forge-master:plan-design`.
