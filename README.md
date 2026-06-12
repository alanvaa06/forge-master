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
