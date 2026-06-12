# Dispatch Protocol — phase subagents

Loaded by `forge-run` whenever it spawns an implementer subagent (heavy phases always; light phases only when delegated). The reviewer subagent has its own input contract in `code-review.md`; this file governs implementers.

## Dispatch prompt template

Every implementer subagent receives EXACTLY this, nothing more:

1. Its phase section from the plan, verbatim (covers, depends_on, tier, process, success, notes).
2. The covered AC texts, verbatim Given/When/Then.
3. The spec sections the phase's notes cite (Interfaces and File Map rows only), when a spec exists.
4. Relevant lessons from `docs/context/lessons.md` and the full `docs/context/memory.md`.
5. For heavy phases: the TDD Iron Law (`references/tdd.md`), to be followed per covered AC.
6. The report contract below, stated as mandatory.

Never the run history, never other phases' sections, never the whole spec.

## Report contract (mandatory — the loop's signals depend on it)

The subagent's final message MUST contain:

- **signal:** exactly one of done | stuck | plan-assumption-broken
  - done — all covered-AC tests written and green.
  - stuck — cannot reach green after genuine attempts; include what was tried (feeds ESCALATE).
  - plan-assumption-broken — the plan's premise for this phase is false (interface it builds on does not exist as planned, AC contradicts repo reality, dependency phase produced something incompatible); include the broken assumption verbatim (feeds the re-plan trigger, NOT escalation).
- **files:** every file created or modified.
- **commands:** the test commands run and their exit codes.
- **tests:** which covered-AC tests exist, named by AC ID, and their final state.
- **notes:** anything the orchestrator must know (max 3 lines).

A report without a signal is treated as stuck.

## Freshness policy

- One subagent per phase attempt. NEVER reuse a subagent across phases.
- After an ESCALATE, the retry gets a FRESH subagent with clean context — the new dispatch includes the escalation lesson just written (what failed and why), not the failed subagent's transcript. A subagent contaminated by its own failures repeats them; a fresh one with the distilled lesson does not.
- After a review blocker, the SAME implementer context may fix it (it knows the code it just wrote); if the fix iteration triggers ESCALATE, freshness applies again.
