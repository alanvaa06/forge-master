---
name: plan-design
description: Decompose an approved PRD into docs/forge/plans/plan-NNN.md — phases tagged tier (junior/senior) and process (light/heavy), each mapped to the ACs it covers, with a proven total-coverage table and an acyclic depends_on graph. Reads docs/context/lessons.md so past escalations improve triage. Stops at human approval gate. Use after a PRD is approved, or when the user says "write the plan" or "/forge-master:plan-design".
disable-model-invocation: true
---

# plan-design — PRD to Execution Contract (Human Gate 2)

<!-- markers: covers · depends_on · lessons.md · Total coverage · gate 2 · Run Config card -->

Produce `docs/forge/plans/plan-NNN.md` from `docs/forge/prd/NNN-name.md`. After approval this file is the FROZEN execution contract — `run` asks nothing.

## Step 1 — Load inputs
- Read the target PRD `docs/forge/prd/NNN-name.md` (ask which N if ambiguous).
- If `docs/forge/specs/spec-NNN.md` exists (produced by `spec-design`), read it. Phases then follow its File Map and Interfaces, `notes:` cite the spec sections a phase implements, and the spec's Risks inform tagging — a phase touching a listed risk does not start `junior`/`light`.
- If NO spec exists and the PRD looks architecturally non-trivial (new interfaces, data models, multiple components that must agree), ASK the user ONCE before decomposing, as a lettered list (mark one **Recommended** with a concrete why) — never assume either way:
  > No spec found, and this PRD looks architecturally non-trivial. Next:
  > a) Run `/forge-master:spec-design` first — **Recommended**, new interfaces / data models / components that must agree
  > b) Plan directly — you accept resolving design inline as phases are decomposed

  The user picks by replying with a letter. For a clearly small task, proceed without asking — the spec is optional and subordinate to this plan.
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

## Step 3.5 — Parallel groups (only if the user wants parallelism)
Identify sets of phases that are mutually independent (no `depends_on` path between any pair) AND file-disjoint (probable files in notes / cited File Map rows do not overlap). Declare them in the plan as `## Parallel Groups` (e.g. `group-1: P2, P3, P4`). A phase in no group runs sequentially. When in doubt about file overlap, leave the phase out of any group — sequential is the safe default.

## Step 4 — Run config
Fill `Run Config`: mode (default `autonomous`), `branch: forge/NNN-<slug>`, `K: 3`, `phase_budget` / `run_budget` heuristics sized to the PRD, `on_complete` (default `pr` — push branch + open PR | `merge` | `keep`), and `max_parallel: 1` (default — fully sequential) or N (max concurrent phases per batch). Only set > 1 when Parallel Groups exist.

For a large or heavy plan, optionally hand off to the `budget` skill (`/forge-master:budget`) BEFORE gate 2 — it produces a per-phase token matrix and fills `phase_budget` / `run_budget` with principled numbers instead of heuristics, and flags any phase whose cost contradicts its tag. Optional; skip it for small plans.

## Step 5 — Write the file
Write `docs/forge/plans/plan-NNN.md` (create `docs/forge/plans/` if it does not exist) by filling `templates/plan-template.md` completely — no `<...>` placeholders left.

## Step 6 — Human gate 2
Present TWO blocks, then gate.

### Block A — Run Config card
Render the frozen-candidate config with a health mark on each diagnosable line (`✓` healthy · `⚠` advisory · `⛔` hard-block):

```
## Run Config — review before freeze
- **mode:** <autonomous|attended> · <one-line meaning>
- **branch:** forge/NNN-<slug>
- **K:** <n> · max self-heal red iterations/phase before escalate
- **max_parallel:** <n> · <sequential | concurrent per group>      <mark>
- **phase_budget:** ~<n> · soft early-escalation signal            <mark>
- **run_budget:** ~<n> · global cap, clean-stop on exhaust         <mark>
- **on_complete:** <pr|merge|keep> · <one-line meaning>
- **gates (every phase):** <gate cmds the run will enforce>
```

Mark logic:
- **run_budget** — `✓` if ≥ matrix TOTAL-high × headroom · `⚠ below est` if under TOTAL-high · `(heuristic — no matrix)` if `budget` never ran.
- **phase_budget** — `✓` if ≥ a typical phase's estimated high · `⚠ below est` if under · `(heuristic — no matrix)` if no matrix.
- **K** — `✓` at 2–5 · `⚠ low` if <2 · `⚠ high` if >6.
- **max_parallel** — `✓` at 1 · `✓ groups file-disjoint` if >1 WITH `## Parallel Groups` · `⛔ no Parallel Groups` if >1 WITHOUT.

### Block B — the plan
Then present: the phase list, each phase's tier/process tags WITH the reasoning (and any lesson that drove a non-default tag), the total-coverage table, and — when declared — the Parallel Groups with their file-disjointness reasoning (the human approves parallelism as part of the frozen contract).

### The gate
Ask as a lettered list:
> Review the config and plan above. Next:
> a) Approve & freeze — **Recommended** *(omit this line whenever any card line is ⛔)*
> b) Change something — name the knob and the new value

On **b)**, apply the matching pushback, then edit the plan's Run Config and re-present Block A once (back to a/b). Pushback is **advisory — warn once, then honor** for every knob EXCEPT the one hard block:

- **run_budget below matrix TOTAL-high:** "⚠ run_budget ~X is below the matrix TOTAL-high (~Y). The loop stops cleanly mid-run with a report at the cap — you may not reach the finish action. Trade: ~Δ fewer tokens for a possible incomplete run. Keep ~X?"
- **phase_budget below a typical phase's high:** "⚠ phase_budget ~X is under several phases' estimated high — those phases early-escalate to you before finishing (more interruptions, not a kill). Intended?"
- **K < 2:** "⚠ K=X: self-heal gives up after X red iteration(s) then escalates. Lower K = faster failures, more human pings. Default 3 balances. Keep X?"
- **K > 6:** "⚠ K=X: a stuck phase burns budget on many red retries before escalating. Trades tokens for autonomy. Keep X?"
- **budget tightened but no matrix exists** — soft offer, lettered:
  > I'm estimating from heuristics — no matrix was run, so I can't say how close ~X is to real cost.
  > a) Run `/forge-master:budget` first — **Recommended**, grounds this in real numbers
  > b) Keep ~X anyway — you accept the guess
- **max_parallel > 1 with no `## Parallel Groups`** (⛔ HARD — the only blocker): "⛔ max_parallel=X but no Parallel Groups are declared. Concurrent phases run in worktrees with no file-disjointness proof — merge-back can corrupt overlapping files. Can't freeze. Either set max_parallel: 1, or declare Parallel Groups (I'll re-check file-disjointness)." Option a) stays unavailable until this clears.

Advisory pushback fires ONCE per knob; if the user reconfirms, honor it and move on — no re-litigating. The change loop converges because every pass is user-driven.

On approval the plan is FROZEN. Then present the next step as a lettered list:
> Plan approved and frozen. Next:
> a) Proceed to `/forge-master:run` — **Recommended**, executes the frozen contract now
> b) Hold — stop here; resume later by re-invoking `/forge-master:run`

The user chooses by replying with a letter.
