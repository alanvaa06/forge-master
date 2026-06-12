# PRD-001: forge-master-capability-gaps

> Imported 2026-06-12 (provisional PRD-006 renumbered to 001 — docs/prd/ was empty at import). Implemented in v0.4.0.

## Goal
Close the six capability gaps found auditing forge-master v0.3.0 against its design spec and the superpowers discipline it replicates natively: end-to-end umbrella command, divergent PRD exploration, a specified `attended` mode, TDD Iron Law in the run loop, a real code-review contract, and run completion that actually lands the branch (finish stage + re-plan trigger). The plugin must remain self-contained — no runtime dependency on superpowers.

## Non-Goals
- No worktree-per-phase parallelism (stays v2).
- No de-escalation of tier/process within a run.
- No new external dependencies or frameworks; all capabilities are SKILL.md instructions + templates.
- No change to the PRD/plan/spec file contracts beyond the additive fields named below (`on_complete`, attended semantics).
- No automatic merge to a protected main without the user-configured `on_complete` saying so.

## User Stories

### US-1: Umbrella command
As a forge-master user, I want a single `/forge-master:forge` entry point that chains prd-design → (spec-design if warranted) → plan-design → run, so that I launch a full pipeline with one invocation while keeping every human gate intact.
- AC-1.1: Given the plugin installed, When `skills/forge/SKILL.md` is inspected, Then it exists with frontmatter `name: forge` and instructions chaining the four stages in order, each stopping at its existing human gate. Verified by `node validate.mjs` extended with a structural check for the file and its required markers.
- AC-1.2: Given a raw idea passed to `/forge-master:forge`, When the pipeline runs, Then no gate is skipped: PRD approval and plan approval each require explicit user confirmation before the next stage starts. `[manual-check]`
- AC-1.3: Given the user already has `docs/prd/NNN-name.md` approved, When invoking the umbrella, Then it detects the existing artifact and offers to enter at the corresponding later stage instead of redoing the PRD. `[manual-check]`

### US-2: Divergent mode in prd-design
As a user with a raw or vague idea, I want prd-design to run a divergent exploration phase (2-3 approaches with trade-offs) before the convergent story/AC interview, so that creative work gets direction chosen before requirements get frozen.
- AC-2.1: Given `skills/prd-design/SKILL.md`, When inspected, Then it contains a divergent-phase section instructing: assess input maturity; if raw, propose 2-3 approaches with trade-offs and a recommendation, user picks direction; if already specific, skip straight to the convergent interview. Verified by marker grep in `validate.mjs`.
- AC-2.2: Given a vague prompt (e.g. "I want something to manage my reading backlog"), When prd-design runs, Then approaches are offered before any user story is drafted. `[manual-check]`
- AC-2.3: Given a specific prompt with clear scope, When prd-design runs, Then the divergent phase is skipped and the interview starts directly. `[manual-check]`

### US-3: Attended mode specified
As a user running delicate tasks, I want `mode: attended` in Run Config to have defined semantics, so that the flag is no longer dead and I can choose supervision per run.
- AC-3.1: Given `skills/forge-run/SKILL.md`, When inspected, Then it defines attended behavior at exactly three pause points — before each ESCALATE (user may approve, override the bump, or abort the phase), on BLOCK (user may unblock with guidance, skip, or stop the run), and at the finish stage (user confirms the `on_complete` action) — and states that autonomous mode never pauses at any of them. Verified by marker grep in `validate.mjs`.
- AC-3.2: Given `templates/plan-template.md`, When inspected, Then the `mode:` line documents both values with a one-line meaning each. Verified by grep.
- AC-3.3: Given a run with `mode: attended`, When an escalation triggers, Then the loop pauses and asks before bumping tier/process. `[manual-check]`

### US-4: TDD Iron Law in the loop
As a plugin author, I want heavy phases to follow strict red-green TDD and light phases to declare their test-after trade-off explicitly, so that the run loop carries real TDD discipline instead of a one-line mention.
- AC-4.1: Given the repo, When inspected, Then a TDD reference exists (`skills/forge-run/references/tdd.md` or an equivalent section in forge-run) stating the Iron Law per covered AC: write the AC test first → run it → it MUST fail → minimal implementation → green → next AC; implementation code before a failing test is a violation that restarts the AC cycle. Verified by `validate.mjs` marker check.
- AC-4.2: Given `skills/forge-run/SKILL.md`, When inspected, Then the heavy execution path cites the TDD reference, and the light path contains an explicit trade-off note: light = test-after by design for token economy, escalation to heavy restores full TDD. Verified by grep.
- AC-4.3: Given a heavy phase in a live run, When its subagent implements an AC, Then the transcript shows the AC test failing before implementation code is written. `[manual-check]`

### US-5: Code review contract
As a plugin author, I want the heavy-phase code review to be a defined contract instead of one line, so that reviews catch real issues and findings route back deterministically.
- AC-5.1: Given the repo, When inspected, Then a review contract exists (reference file or forge-run section) with: reviewer receives the phase's plan section, covered ACs, and cited spec sections; checklist = AC coverage, spec/interface compliance, regression risk, code quality; every finding carries severity `blocker` or `nit`. Verified by `validate.mjs` marker check.
- AC-5.2: Given the contract, When inspected, Then routing is defined: blockers re-enter the phase implementation cycle and increment `iter` (feeding the existing K/escalation machinery); nits are logged to `results.md` and never block; reviewer feedback is verified against the code before being implemented, not applied blindly. Verified by grep.
- AC-5.3: Given a heavy phase whose review finds a blocker, When the loop continues, Then the fix iteration counts toward K. `[manual-check]`

### US-6: Finish stage and re-plan trigger
As a forge-master user, I want runs to land their work (configurable merge/PR/keep) and to detect when the plan itself is broken, so that a "done" run leaves no stranded branch and a stale plan is never executed to exhaustion.
- AC-6.1: Given `templates/plan-template.md`, When inspected, Then Run Config includes `on_complete: pr | merge | keep` with default `pr` and a one-line meaning each. Verified by grep.
- AC-6.2: Given `skills/forge-run/SKILL.md`, When inspected, Then END includes a finish stage executed only when the full repo suite is green: `pr` → push branch + open PR whose body is generated from the final report (phases, ACs, escalations); `merge` → merge into the base branch and delete the run branch; `keep` → leave the branch and say so in the report. Attended mode confirms the action first; autonomous executes the config. Verified by `validate.mjs` marker check.
- AC-6.3: Given `skills/forge-run/SKILL.md`, When inspected, Then a re-plan trigger is defined: a phase subagent reporting "plan assumption broken" (as distinct from "stuck") marks the phase `[plan-stale]` in `todo.md`, skips escalation for it, continues independent branches, and the final report recommends re-running `plan-design` on the unfinished remainder. Verified by marker grep.
- AC-6.4: Given a completed run with `on_complete: pr`, When END executes, Then a PR exists whose body lists phases and AC IDs. `[manual-check]`

## Constraints
- Self-contained plugin: replicate discipline natively; never invoke superpowers skills at runtime (design decision D2).
- Autonomy contract (D4) holds: autonomous mode asks nothing mid-run; every new decision point (escalate-pause, finish action) is either plan-frozen config or attended-only.
- All structural ACs must be enforceable by extending the existing `validate.mjs` — it is the repo's test runner and the loop's own verification command.
- Token economy: new instructions favor progressive disclosure (reference files loaded only by the paths that need them) over bloating every SKILL.md.
- Windows-compatible instructions (user runs win32; no POSIX-only commands in skill steps).

## Definition of Done
- [x] All AC green (`node validate.mjs` passes with the new structural checks; `claude plugin validate .` passes)
- [ ] `[manual-check]` ACs verified once in a live dogfood run and noted in the final report
- [x] README.md updated: command table includes `forge`, capability sections for TDD/review/finish, attended mode documented
- [x] No SKILL.md exceeds its current order of magnitude in length (progressive disclosure respected)
