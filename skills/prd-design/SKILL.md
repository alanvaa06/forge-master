---
name: prd-design
description: Interview a user from a raw idea into a testable PRD at docs/forge/prd/NNN-name.md. Every user story gets at least one Given/When/Then acceptance criterion verifiable by test or command. Mandatory Non-Goals. Stable IDs (US-n, AC-n.m). Stops at human approval gate. Use when starting a forge-master run, or when the user says "write a PRD", "/forge-master:prd-design", or describes a feature to build.
disable-model-invocation: true
---

# prd-design — PRD Interview (Human Gate 1)

<!-- markers: ## Interview · Given/When/Then · Non-Goals · Definition of Done · gate 1 -->

Produce `docs/forge/prd/NNN-name.md`: the contract consumed by `plan-design`. The acceptance criteria you write here become the loop's exit conditions, so they must be verifiable.

## Two habits that run through the whole interview
These apply to every question you ask below, including the divergent phase.

**Recommend, don't just enumerate.** Any time you offer a choice — an approach, an AC phrasing, a constraint, the next step — present it as a lettered list and mark exactly one option **Recommended** with a one-line, concrete reason. Ground the reason in something real: matches an existing pattern in the codebase, lowest risk, smallest scope, fits a constraint the user already stated. The list lets the user answer with a single letter; you carry the weighing so they don't have to evaluate every option cold. Two options is the default — add a third only when it is a genuinely distinct, worthwhile path, never padding; cap at three. Format:
> <question?>
> a) <option A> — **Recommended**, <concrete why, e.g. "matches current pattern in auth.ts">
> b) <option B> — <trade-off>
> c) <option C> — <trade-off>

This applies especially to next-step handoffs between skills/commands (e.g. PRD → spec → plan): always lay the choices out as a lettered list, never bury them in prose.

**Close every question — assume nothing.** The interview covers a fixed set of topics (the six in Step 2). Treat them as an open-questions ledger: it is done only when the user has answered *every* one. A default you proposed is not an answer until the user confirms it — nothing enters the PRD on your authority alone. Users will interrupt, jump ahead, or try to short-circuit ("looks good, just write it"); when they do, absorb the new information, then name what is still open and return to it. A silently skipped question is a hole in the contract that resurfaces downstream as drift or a missing acceptance criterion — closing all of them is exactly what this gate exists for. Resuming sounds like: *"Got it — that covers US-2's criteria. Still open: Non-Goals and Constraints. Next: <question>."*

## When the user gets stuck, switch to plain-language mode
The interview only works if the user actually understands what they are deciding — an approval given in confusion is a rubber stamp that turns into drift downstream. So watch for confusion and treat clearing it as the task, not a detour. Stay lean by default (don't over-explain to a user who is moving fast), but the moment any of these signals fires, change gear:

**Triggers (any one):** the user asks you to simplify or says "I don't get it" · answers your question with a question · still can't answer after you rephrase once · says "shape this" / "help me think."

**Changing gear is a real mode switch, not the same words said louder:**
- Drop every piece of jargon and every ID. No `AC-4.3`, no "foreign key", no "read-gate" — name things in words a non-engineer would use.
- Anchor in ONE concrete example from the user's own case, not an abstraction (*"Apple's 10-K is the exact same file for everyone; Crocs isn't on your list, so saving it bounced."*).
- Reframe the decision as a trade-off the user can weigh without expertise: who pays, what it costs, what breaks on each side. Two or three options, one line each.
- If an insight collapses the complexity, lead with it (*"there are two **kinds** of content here, not one — public filings are identical for every user; private uploads differ per user"*). Finding that reframe is the product-manager move.
- THEN re-ask the original question in the new framing. You simplified the question — you did not answer it. The user still decides; confusion is never license to pick for them (this is the "assume nothing" habit under pressure).

In short: behave like a product manager — translate the technical or schema reality into product terms, surface the trade-off, and hand the decision back clearer than you found it.

## Step 1 — Locate / number the PRD
- Ensure `docs/forge/prd/` exists — forge owns the `docs/forge/` tree, so create it if missing. Separately, the `docs/context/` memory system (lessons, memory, todo, ...) is provided by the `scaffold` skill; if `docs/context/` is absent, tell the user to run `scaffold` first (or run it for them), then continue.
- `NNN` = next zero-padded integer after the highest existing `docs/forge/prd/NNN-*.md` (start at `001`).
- Derive `<name>` as a short kebab-case slug from the idea.

## Divergent phase — explore before converging (Step 1.5)
Assess the input's maturity before any story is drafted:
- **Raw/vague idea** (a wish, a problem statement, no clear shape — "something to manage my reading backlog"): DIVERGE first. Propose **2-3 distinct approaches** with one-line trade-offs each (scope, effort, risk), and mark one **Recommended** with a concrete why (use the recommend habit above). The user picks the direction. Only then start the convergent interview below — direction gets chosen before requirements get frozen.
- **Specific idea** (clear scope, named feature, known shape): skip the divergent phase entirely and go straight to the interview. Do not manufacture alternatives for an already-decided direction.

## Step 2 — Interview (one question at a time)
Brainstorming style: ask ONE question, wait, incorporate, propose, let the user correct. Do not dump a full PRD up front. Explore intent before structure. Apply both habits above to every question: recommend an option, and keep the ledger until all six topics are answered by the user.

Cover, in roughly this order:
1. **Goal** — what and why, in 1-3 lines.
2. **Non-Goals** — explicit out-of-scope. MANDATORY, even one line. This is the loop's anti-drift boundary.
3. **User stories** — for each: `As a <role>, I want <action>, so that <benefit>.` Assign `US-1`, `US-2`, ...
4. **Acceptance criteria** — for each story, propose ACs in **Given/When/Then** form, each verifiable by an automated test or a shell command. Assign `AC-1.1`, `AC-1.2`, ...
5. **Constraints** — stack, performance, security, technical limits.
6. **Definition of Done** — all ACs green, plus any extras (lint, docs, coverage).

## Hard rules (enforce during the interview, do not skip)
- **No topic silently skipped; nothing assumed on the user's behalf.** All six topics must be answered by the user before you write the file. If they interrupt or jump ahead, absorb the input and loop back to what is still open. A default you proposed counts only once the user confirms it — you never grant an answer to yourself.
- **Every story has >= 1 AC. Every AC is Given/When/Then and verifiable by test or command.** A story with no testable AC does NOT enter the PRD — reformulate it or drop it.
- **Non-Goals is mandatory.**
- **Stable IDs** (`US-n`, `AC-n.m`) never reused or renumbered — plan, todo, tests, and commits reference them. This is the PRD->phase->test->commit traceability spine.
- Non-executable ACs ("looks good", "feels fast"): reformulate to command-verifiable (Playwright assertion, `curl` + status, a measured threshold). If genuinely manual, mark the AC `[manual-check]` — it will be verified in the final report and must NEVER block the loop.

## Step 3 — Write the file
Write `docs/forge/prd/NNN-name.md` using exactly this structure:

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
Present the finished PRD. Ask for explicit approval. Do NOT proceed to `plan-design` until the user approves.

On approval, ASK the user — never decide for them — and lay the next step out as a lettered list (recommend habit above), e.g.:

> PRD approved. Next step:
> a) Write a technical spec first (`/forge-master:spec-design`) — **Recommended**, <reason: new interfaces, data models, multiple components that must agree>
> b) Go straight to the plan (`/forge-master:plan-design`) — <reason: small task, obvious structure>

Pick the recommendation by the spec-vs-skip heuristic in the reasons above. The user chooses by replying with a letter.
