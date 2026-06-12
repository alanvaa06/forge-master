# Code Review Contract — heavy-phase review

Loaded by `forge-run` when a `heavy` phase reaches green and needs its independent review before commit.

## Reviewer input (minimal context, like any phase subagent)

The reviewer subagent receives exactly:
- the phase's plan section (covers, success, notes),
- the covered AC texts (Given/When/Then),
- the spec sections the phase cites (Interfaces, File Map rows) when a spec exists,
- the diff produced by the phase (not the whole repo history).

Never the run history. The reviewer is INDEPENDENT: a fresh subagent that did not write the code.

## Checklist (review against, in order)

1. **AC coverage** — does the diff actually satisfy each covered AC? Is each AC's test present, named by AC ID, and asserting the AC's observable behavior (not mocks of it)?
2. **Spec/interface compliance** — do signatures, schemas, routes, and file placement match the cited spec sections / plan notes?
3. **Regression risk** — could this change break behavior owned by other phases? Shared state, changed interfaces, modified fixtures. Any plausible regression risk is a blocker, not a nit.
4. **Code quality** — clarity, naming, duplication, dead code, error handling proportionate to the phase's scope. No style-war nits.

## Severity — every finding carries exactly one

- **blocker** — an AC is not truly satisfied, a spec interface is violated, or a likely regression. Must be fixed before commit.
- **nit** — improvement that does not gate the phase.

## Routing (deterministic)

- **Blockers** → the finding goes back to the implementation cycle; the phase re-enters implement->verify and `iter` increments — review failures feed the SAME K/escalation machinery as red tests. Fix, re-verify, re-review the fixed area.
- **Nits** → logged to `results.md` with the phase entry; NEVER block the commit and never increment `iter`.
- **Feedback is verified against the code before being implemented, not applied blindly.** If the implementer can show the reviewer's claim is factually wrong (test exists, interface does match), record the disagreement in `results.md` and proceed — the test runner, not the reviewer, has final authority on green.
