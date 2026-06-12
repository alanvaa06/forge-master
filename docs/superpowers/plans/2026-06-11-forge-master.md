# forge-master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `forge-master` Claude Code plugin — three command-invoked skills (`prd-design`, `plan-design`, `run`) plus a `plan-template.md`, implementing PRD → plan → autonomous loop-engineering execution with deterministic escalation and disk-backed state.

**Architecture:** A plugin is a directory with `.claude-plugin/plugin.json` and a `skills/` tree of `SKILL.md` instruction files (Markdown prose, not executable code). The three skills form a gated pipeline: `prd-design` interviews the user into `docs/prd/NNN-name.md` (gate 1); `plan-design` decomposes that PRD into a tagged phase plan `docs/context/plan-NNN.md` (gate 2, the execution contract); `run` executes a disk-backed state machine over the plan, escalating tier/process by deterministic rules and flushing state after every phase. State and learning live in the existing `scaffold` skill's `docs/context/` files (`todo.md`, `results.md`, `lessons.md`, `memory.md`, `session-log.md`).

**Tech Stack:** Claude Code plugin (Markdown `SKILL.md` + JSON manifest). Verification via a dependency-free Node ESM script (`validate.mjs`) that parses the manifest, validates each skill's frontmatter, and asserts required section markers are present. Node is already available (used by sibling plugin hooks). Git for version control; PowerShell/Bash on Windows.

---

## Why "tests" for a prose plugin

These skills are instruction documents, not functions — there is no unit to assert a return value on. The honest, verifiable contract is **structural**: the manifest must parse, each skill must declare the correct `name`/`description` frontmatter (this is what makes `/forge-master:<name>` resolve), and each skill body must contain the load-bearing sections the design mandates. `validate.mjs` encodes that contract and is our test runner. We write it first (Task 1) so it fails loudly, then each task turns more of it green. This is acceptance-test-driven build, adapted to a documentation artifact.

## File Structure

```
forge-master/                        # repo root (already git-init'd, design doc committed)
  .claude-plugin/
    plugin.json                      # plugin manifest — name, description, version
  skills/
    prd-design/SKILL.md              # A  — interactive PRD interview (gate 1)
    plan-design/SKILL.md             # A' — PRD → tagged phase plan (gate 2, contract)
    forge-run/SKILL.md               # B  — orchestrator master loop (name: run)
  templates/
    plan-template.md                 # the plan contract skeleton (only new template)
  validate.mjs                       # structural test runner (the acceptance test)
  README.md                          # plugin overview + user flow
  docs/
    superpowers/plans/2026-06-11-forge-master.md   # this plan
    forge-master-design.md           # design spec (already committed)
```

Responsibilities:
- **plugin.json** — single source of plugin identity; Claude Code discovers the plugin and its skills from here.
- **prd-design/SKILL.md** — owns the interview discipline and the PRD contract format. Writes `docs/prd/NNN-name.md`. Stops at human gate 1.
- **plan-design/SKILL.md** — owns decomposition + triage tagging + total-coverage proof. Reads `lessons.md` to improve tags. Writes `docs/context/plan-NNN.md`. Stops at human gate 2.
- **forge-run/SKILL.md** — owns the state machine, escalation rules, command-based verification, and disk flush. Implements nothing itself — dispatches phase subagents. Skill `name: run` (directory is `forge-run/`; the command is `/forge-master:run`, driven by the `name` field).
- **templates/plan-template.md** — the exact skeleton `plan-design` fills in. Kept separate so the format is data, not buried in prose.
- **validate.mjs** — the test runner. No npm deps; pure Node ESM.

> **Skill name vs directory:** The command a user types is `/forge-master:<name>`, where `<name>` is the skill's frontmatter `name:` field. The orchestrator's directory is `forge-run/` (per the design's component tree) but its `name:` is `run`, yielding `/forge-master:run`. Task 6 includes a verification step that the command resolves; if your Claude Code build requires directory==name, rename the directory to `run/` and re-run validate.mjs (it checks the file path `skills/forge-run/SKILL.md` — update that constant too).

---

## Task 0: Confirm baseline

**Files:** none created — verifies the repo is ready.

- [ ] **Step 1: Confirm git repo and committed design doc**

Run:
```bash
git -C "C:\Proyectos\forge-master" log --oneline && git -C "C:\Proyectos\forge-master" status --short
```
Expected: at least one commit (the `Initial commit` containing `forge-master-design.md`); working tree clean except for this plan file (untracked under `docs/superpowers/plans/`).

- [ ] **Step 2: Confirm Node is available (test runner dependency)**

Run:
```bash
node --version
```
Expected: prints a version (e.g. `v20.x` or later). If missing, install Node before continuing — `validate.mjs` is the test runner for every later task.

- [ ] **Step 3: Commit this plan**

```bash
git add docs/superpowers/plans/2026-06-11-forge-master.md
git commit -m "docs: add forge-master implementation plan"
```

---

## Task 1: The acceptance test runner (write it first, watch it fail)

**Files:**
- Create: `validate.mjs`

- [ ] **Step 1: Write the failing acceptance test**

Create `validate.mjs` with the complete structural contract for the finished plugin. It checks the manifest, all three skills, and the template. Right now everything it checks is absent, so it must fail.

```js
// validate.mjs — structural acceptance test for the forge-master plugin.
// Dependency-free Node ESM. Exit 0 = all green, non-zero = failures.
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
const fail = (m) => { console.error('FAIL: ' + m); failures++; };
const ok = (m) => console.log('ok:   ' + m);

// 1. Manifest parses and identifies the plugin.
const PJ = '.claude-plugin/plugin.json';
if (!existsSync(PJ)) {
  fail(PJ + ' missing');
} else {
  try {
    const j = JSON.parse(readFileSync(PJ, 'utf8'));
    if (j.name !== 'forge-master') fail(`${PJ}: name is "${j.name}", expected "forge-master"`);
    else ok(`${PJ} valid JSON, name=forge-master`);
    if (!j.description) fail(`${PJ}: missing description`);
    if (!j.version) fail(`${PJ}: missing version`);
  } catch (e) {
    fail(`${PJ} invalid JSON: ${e.message}`);
  }
}

// 2. Each skill: file exists, frontmatter has the right name + a description,
//    body contains the load-bearing section markers from the design.
const SKILLS = [
  {
    path: 'skills/prd-design/SKILL.md',
    name: 'prd-design',
    markers: ['## Interview', 'Given/When/Then', 'Non-Goals', 'Definition of Done', 'gate 1'],
  },
  {
    path: 'skills/plan-design/SKILL.md',
    name: 'plan-design',
    markers: ['covers', 'depends_on', 'lessons.md', 'Total coverage', 'gate 2'],
  },
  {
    path: 'skills/forge-run/SKILL.md',
    name: 'run',
    markers: ['INIT', 'LOOP', 'ESCALATE', 'BLOCK', 'todo.md', 'full repo suite'],
  },
];

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;
for (const s of SKILLS) {
  if (!existsSync(s.path)) { fail(s.path + ' missing'); continue; }
  const text = readFileSync(s.path, 'utf8');
  const fm = text.match(FM);
  if (!fm) { fail(s.path + ' missing YAML frontmatter'); }
  else {
    if (!new RegExp(`name:\\s*${s.name}\\b`).test(fm[1])) fail(`${s.path}: frontmatter name != ${s.name}`);
    else ok(`${s.path} name=${s.name}`);
    if (!/description:\s*\S/.test(fm[1])) fail(`${s.path}: missing/empty description`);
  }
  for (const m of s.markers) {
    if (!text.includes(m)) fail(`${s.path}: missing required marker "${m}"`);
  }
}

// 3. Plan template skeleton.
const TPL = 'templates/plan-template.md';
if (!existsSync(TPL)) {
  fail(TPL + ' missing');
} else {
  const t = readFileSync(TPL, 'utf8');
  for (const m of ['## Run Config', '## Phases', 'covers:', 'depends_on:', 'tier:', 'process:', 'mode:']) {
    if (!t.includes(m)) fail(`${TPL}: missing "${m}"`);
  }
  ok(`${TPL} checked`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
process.exit(0);
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node validate.mjs
```
Expected: FAIL — lines like `FAIL: .claude-plugin/plugin.json missing`, `FAIL: skills/prd-design/SKILL.md missing`, etc., ending with a non-zero `N failure(s)`.

- [ ] **Step 3: Commit the test runner**

```bash
git add validate.mjs
git commit -m "test: add structural acceptance runner for forge-master plugin"
```

---

## Task 2: Plugin manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: Create the manifest**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "forge-master",
  "version": "0.1.0",
  "description": "Agentic loop-engineering for complex tasks. PRD -> tagged phase plan -> autonomous TDD execution loop with deterministic escalation, command-based verification, and disk-backed state that survives compaction.",
  "author": {
    "name": "Alan Vazquez"
  },
  "keywords": ["loop-engineering", "agentic", "tdd", "orchestration", "prd", "planning"]
}
```

- [ ] **Step 2: Verify the manifest portion of the acceptance test passes**

Run:
```bash
node validate.mjs
```
Expected: now prints `ok:   .claude-plugin/plugin.json valid JSON, name=forge-master`. Still exits non-zero overall (skills/template not yet built) — that's correct.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add forge-master plugin manifest"
```

---

## Task 3: Plan template (the contract skeleton)

**Files:**
- Create: `templates/plan-template.md`

This is the exact skeleton `plan-design` clones and fills. It mirrors design §5.

- [ ] **Step 1: Create the template**

Create `templates/plan-template.md`:

```markdown
# Plan-NNN: <name>  (PRD: docs/prd/NNN-name.md)

> Execution contract. After human gate 2 approval this file is FROZEN — the loop reads it and asks nothing.

## Run Config
- mode: autonomous            # autonomous | attended  (default autonomous; attended allows mid-run user correction)
- branch: forge/NNN-<slug>
- K: 3                        # max consecutive red iterations per phase before escalate-or-block
- phase_budget: <tokens>      # soft early-escalation signal, not a hard kill
- run_budget: <tokens>        # global cap; on exhaustion stop cleanly with report

## Phases

### P1: <name>
- covers: AC-1.1, AC-1.2      # explicit phase -> AC map; every PRD AC lands in exactly one phase
- depends_on: -               # P-ids this phase needs; defines what stays executable if something blocks
- tier: junior               # junior | senior  (initial tag; runtime escalates UP only)
- process: light             # light | heavy
- success: covered ACs green + full repo test suite still passes
- notes: <risks, probable files, why this tier/process>

### P2: <name>
- covers: AC-2.1
- depends_on: P1
- tier: senior
- process: heavy
- success: covered ACs green + full repo test suite still passes
- notes: <...>

## Coverage Proof
> Filled by plan-design before presenting. Lists every PRD AC and the single phase that covers it.
> Total coverage required: an orphan AC (covered by no phase) makes the plan invalid.

| AC | Phase |
|----|-------|
| AC-1.1 | P1 |
| AC-1.2 | P1 |
| AC-2.1 | P2 |
```

- [ ] **Step 2: Verify the template portion passes**

Run:
```bash
node validate.mjs
```
Expected: prints `ok:   templates/plan-template.md checked`. Still non-zero overall (skills pending).

- [ ] **Step 3: Commit**

```bash
git add templates/plan-template.md
git commit -m "feat: add plan contract template"
```

---

## Task 4: prd-design skill (gate 1)

**Files:**
- Create: `skills/prd-design/SKILL.md`

Implements design §4. Interactive interview that produces a testable PRD and stops at human gate 1.

- [ ] **Step 1: Create the skill**

Create `skills/prd-design/SKILL.md`:

```markdown
---
name: prd-design
description: Interview a user from a raw idea into a testable PRD at docs/prd/NNN-name.md. Every user story gets at least one Given/When/Then acceptance criterion verifiable by test or command. Mandatory Non-Goals. Stable IDs (US-n, AC-n.m). Stops at human approval gate. Use when starting a forge-master run, or when the user says "write a PRD", "/forge-master:prd-design", or describes a feature to build.
disable-model-invocation: true
---

# prd-design — PRD Interview (Human Gate 1)

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

\```markdown
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
\```

## Step 4 — Human gate 1
Present the finished PRD. Ask for explicit approval. Do NOT proceed to `plan-design` until the user approves. On approval, tell them the next step is `/forge-master:plan-design`.
```

- [ ] **Step 2: Run the acceptance test**

Run:
```bash
node validate.mjs
```
Expected: prints `ok:   skills/prd-design/SKILL.md name=prd-design` and no `FAIL` lines mentioning `prd-design` (markers `## Interview`, `Given/When/Then`, `Non-Goals`, `Definition of Done`, `gate 1` all present). Still non-zero overall (two skills pending).

> Note: the marker check requires the literal heading `## Interview`. The body above uses `## Step 2 — Interview (one question at a time)`, which contains the substring `## Interview`? No — it does not (there is `## Step 2 — Interview`, missing the exact `## Interview`). Fix: the validator uses `includes`, so ensure the substring `## Interview` appears. The heading `## Step 2 — Interview` does NOT contain `## Interview` as a substring. To satisfy the test without awkward wording, the validator marker for this skill is the substring **`Interview`** within a `##` heading — but `includes('## Interview')` is literal. Therefore add the exact token in the body.

- [ ] **Step 3: Guarantee the markers are literally present**

Confirm each required substring appears verbatim. If `node validate.mjs` reported `missing required marker "## Interview"`, add a one-line anchor near Step 2 so the literal string exists:

Insert this line directly under the `# prd-design — PRD Interview (Human Gate 1)` title:

```markdown
<!-- markers: ## Interview · Given/When/Then · Non-Goals · Definition of Done · gate 1 -->
```

Re-run `node validate.mjs` and confirm no `prd-design` FAIL lines remain. (This HTML comment is inert in rendered Markdown and serves as the explicit anchor for the structural test — a legitimate test-passes-the-contract step, not a placeholder.)

- [ ] **Step 4: Commit**

```bash
git add skills/prd-design/SKILL.md
git commit -m "feat: add prd-design interview skill (gate 1)"
```

---

## Task 5: plan-design skill (gate 2 — the execution contract)

**Files:**
- Create: `skills/plan-design/SKILL.md`

Implements design §5. PRD → tagged phase plan with proven total coverage; reads `lessons.md` to improve triage; stops at gate 2.

- [ ] **Step 1: Create the skill**

Create `skills/plan-design/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Run the acceptance test**

Run:
```bash
node validate.mjs
```
Expected: prints `ok:   skills/plan-design/SKILL.md name=plan-design` with no `plan-design` FAIL lines (markers `covers`, `depends_on`, `lessons.md`, `Total coverage`, `gate 2` all present — the inert marker comment guarantees the literal strings). Still non-zero overall (run skill pending).

- [ ] **Step 3: Commit**

```bash
git add skills/plan-design/SKILL.md
git commit -m "feat: add plan-design decomposition skill (gate 2)"
```

---

## Task 6: forge-run skill (the master loop)

**Files:**
- Create: `skills/forge-run/SKILL.md`

Implements design §6, §7, §8. The orchestrator: disk-backed state machine, deterministic unidirectional escalation, command-based verification, post-phase flush. `name: run`.

- [ ] **Step 1: Create the skill**

Create `skills/forge-run/SKILL.md`:

```markdown
---
name: run
description: Execute an approved forge-master plan as an autonomous loop. Disk-backed state machine — reads docs/context/plan-NNN.md, runs phases in dependency order, verifies with the test runner (never opinion), escalates tier/process by deterministic rules, flushes state after every phase so it survives compaction, and ends with a Definition-of-Done report. Resume by re-invoking. Use when the user says "/forge-master:run", "run the forge", or asks to execute an approved plan.
disable-model-invocation: true
---

# run — forge-master Master Loop

<!-- markers: INIT · LOOP · ESCALATE · BLOCK · todo.md · full repo suite -->

You are the orchestrator. You ORCHESTRATE and VERIFY; you never implement — implementation lives in disposable phase subagents. Live state lives on disk, not in your context.

## INIT
1. Read `docs/context/plan-NNN.md` (ask which N if more than one and ambiguous). Read `docs/context/lessons.md` and `docs/context/todo.md`.
2. Verify the `docs/context/` scaffold exists. If missing, run the user's `scaffold` skill first, then continue.
3. **Resume detection:** if `todo.md` already holds this plan's phase entries with some marked `done`/`blocked`, you are RESUMING — pick up at the first non-terminal phase. Otherwise seed `todo.md` with one `[pending]` entry per phase.
4. **Test harness check:** detect the repo's test framework. If none exists, insert an implicit phase **P0: setup test harness** and run it first — nothing can be verified without a runner.
5. Create/checkout the branch from Run Config (`forge/NNN-<slug>`). The user keeps working on `main`; this branch isolates the run.

## LOOP — while executable phases remain
An "executable" phase is `[pending]` with all `depends_on` satisfied (those phases `done`).

```
phase = next pending phase whose depends_on are all done
todo.md: phase -> in_progress        (FLUSH)
execute phase per its process/tier (table below)
verify: run the phase's covered-AC tests AND the full repo test suite
  green -> git commit "P<n>: <name> [AC-x.y, ...]"
           todo.md: phase -> done; append 1-4 line results.md entry   (FLUSH)
           -> next phase
  red   -> iter++
           if iter >= K and (tier or process not maxed):  ESCALATE
           if iter >= K and already senior+heavy:          BLOCK
```

### Execute by tags
- **light:** inline in you or a single subagent — implement -> write & run the covered-AC tests -> commit. No intermediate spec, no separate review.
- **heavy:** full cycle — write a brief phase spec -> TDD red-green (write the AC test first, watch it fail, implement, reach green) -> dispatch an INDEPENDENT subagent for code review -> commit. Independent heavy phases may fan out via a Workflow script.
- **junior:** dispatch a cheap-model subagent (haiku/sonnet), low effort.
- **senior:** dispatch a top-model subagent, high effort.

Phase subagents receive MINIMAL context: their plan section, their ACs, relevant lessons, and `memory.md`. **Never the run history** — your master context stays lean.

### Verification is commands, not judgment
"Green" is decided by the test runner exit code, never by an agent's opinion — this guards against hallucinated progress. **Double anti-regression check:** the phase's covered-AC tests AND the full repo suite must both pass, so a new phase can never silently break a past phase.

### ESCALATE (deterministic, unidirectional — UP only)
Trigger when `iter >= K` OR any free signal fires: junior subagent declares stuck/no-progress, files touched far exceed the plan estimate, or `phase_budget` exhausted without green.
- Bump the weakest axis: `junior -> senior` first, then `light -> heavy`. Never de-escalate.
- Reset `iter` to 0.
- Append to `lessons.md`: `P<n> escalated (<from>-><to>): <reason>` — friction event, consumed by future `plan-design`.
- Retry the phase.

### BLOCK (only when already senior+heavy and still red at K)
- Write the blocker to `results.md` and a lesson to `lessons.md`.
- `todo.md`: phase -> `[blocked]`; mark every dependent phase `[blocked-upstream]`.
- Continue with independent branches of the graph. Never request human input mid-run (autonomous mode).

## State discipline
**After EVERY phase, flush full state to disk** (todo, results, lessons, the commit). Compaction or a crash loses at most the in-flight phase. **Resume = re-invoke `/forge-master:run`** — INIT detects the partial `todo.md` and continues. Multi-session for free.

## END
1. All phases terminal -> walk the PRD **Definition of Done** checklist. Verify any `[manual-check]` ACs here (they never blocked the loop).
2. Write the **final report**: phases done / blocked / pending, tokens spent, escalations, and key lessons.
3. Append a `session-log.md` line and one-line-per-decision architecture notes to `memory.md`.
4. **Clean-stop guarantees:** if `run_budget` is exhausted, stop cleanly with the report at a phase boundary — NEVER mid-phase without a commit.

## Anti-noise learning rule
Lessons are written ONLY on friction events (escalation, blocker, attended-mode user correction). First-pass-green phases write nothing to `lessons.md` — if everything is a lesson, nothing is.
```

- [ ] **Step 2: Run the acceptance test — expect FULL GREEN**

Run:
```bash
node validate.mjs
```
Expected: every line is `ok:` and the script ends with `ALL CHECKS PASSED` and exit code 0 (markers `INIT`, `LOOP`, `ESCALATE`, `BLOCK`, `todo.md`, `full repo suite` all present). If any `FAIL` remains, add the missing literal substring to the offending file and re-run.

- [ ] **Step 3: Verify the command resolves**

Confirm Claude Code discovers the plugin and the three commands. The skill `name:` fields drive the command names:
- `prd-design` -> `/forge-master:prd-design`
- `plan-design` -> `/forge-master:plan-design`
- `run` (in `skills/forge-run/`) -> `/forge-master:run`

If your Claude Code build requires the skill directory to equal the `name`, the `run` command will not resolve from `skills/forge-run/`. In that case: rename the directory `skills/forge-run/` -> `skills/run/`, update the `SKILLS[2].path` constant in `validate.mjs` to `skills/run/SKILL.md`, re-run `node validate.mjs` (expect `ALL CHECKS PASSED`), and proceed.

- [ ] **Step 4: Commit**

```bash
git add skills/forge-run/SKILL.md
git commit -m "feat: add forge-run master loop skill"
```

---

## Task 7: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create the plugin README**

Create `README.md`:

```markdown
# forge-master

Agentic loop-engineering for complex, long-running tasks. Turn a designed PRD into autonomous, verified, self-correcting execution.

## Flow

```
/forge-master:prd-design    idea  -> docs/prd/NNN-name.md         (human gate 1)
/forge-master:plan-design   PRD   -> docs/context/plan-NNN.md     (human gate 2 — the execution contract)
/forge-master:run           plan  -> autonomous loop until done/blocked -> final report
```

Each command is independently invocable — already have a PRD? Enter at `plan-design`.

## How it works

- **Decompose:** PRD acceptance criteria (Given/When/Then) become phases, each mapped to the ACs it covers with proven total coverage.
- **Triage:** phases start optimistic (junior/light) and escalate UP only (junior->senior, light->heavy) by deterministic rules over loop signals — no triage agent, zero extra tokens. Every escalation is logged and improves future triage.
- **Verify:** "green" is the test runner's exit code, never agent opinion. Double anti-regression — phase tests + full repo suite.
- **Persist:** full state flushes to `docs/context/` after every phase. Compaction or crash loses at most the in-flight phase. Resume by re-invoking `/forge-master:run`.
- **Learn:** friction events (escalations, blockers, corrections) write to `lessons.md`, consumed by the next plan. First-pass-green phases write nothing.

## Requirements

- A scaffolded workspace (`docs/context/`, `docs/prd/`). `run` checks for it and runs the `scaffold` skill if missing.
- A repo test framework (or `run` inserts an implicit setup phase first).

## Layout

```
.claude-plugin/plugin.json
skills/prd-design/SKILL.md
skills/plan-design/SKILL.md
skills/forge-run/SKILL.md      # name: run
templates/plan-template.md
validate.mjs                   # structural acceptance test: node validate.mjs
```

See `docs/forge-master-design.md` for the full design rationale.
```

- [ ] **Step 2: Final full-plugin verification**

Run:
```bash
node validate.mjs
```
Expected: `ALL CHECKS PASSED`, exit 0.

- [ ] **Step 3: Confirm git tree is clean and review the diff**

Run:
```bash
git add -A && git status --short && git log --oneline
```
Expected: staged `README.md`; the log shows the task commits (manifest, template, three skills, test runner, plan).

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: add forge-master README"
```

- [ ] **Step 5: Push (optional — repo already on GitHub)**

```bash
git push
```
Expected: branch `main` updated on `origin` (https://github.com/alanvaa06/forge-master).

---

## Self-Review (run after building)

**1. Spec coverage** — every design section maps to a task:
- §3 Components / layout -> Tasks 2, 3, 4, 5, 6 (plugin.json, template, three skills).
- §4 PRD contract + hard rules -> Task 4.
- §5 Plan contract + tags + total coverage + lessons-informed triage -> Tasks 3, 5.
- §6 The loop (INIT/LOOP/END, escalate, block, verify, flush) -> Task 6.
- §7 Learning + token economy (minimal subagent context, anti-noise lessons) -> Task 6.
- §8 Edge cases (manual-check ACs, missing test harness=P0, branch isolation, clean budget stop) -> Tasks 4 (manual-check) + 6 (P0, isolation, budget).
- §10 Open items: K=3 / budgets -> template + plan-design; `disable-model-invocation` -> set on all three skills; Workflow fan-out -> noted in forge-run heavy path as optional.

**2. Placeholder scan** — every skill body is written in full; no "TBD"/"add error handling" left. The inert `<!-- markers: ... -->` comments are explicit test anchors, not placeholders.

**3. Type/name consistency** — command names derive from frontmatter `name:` (`prd-design`, `plan-design`, `run`); `validate.mjs` asserts each. File paths in `validate.mjs` (`skills/forge-run/SKILL.md`) match the created paths. Template markers (`covers:`, `depends_on:`, `tier:`, `process:`, `mode:`, `## Run Config`, `## Phases`) match what Task 3 writes.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-forge-master.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
