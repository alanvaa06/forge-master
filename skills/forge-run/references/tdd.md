# TDD Iron Law — heavy-phase discipline

Loaded by `forge-run` for every `heavy` phase. The phase subagent follows this per covered AC, in order, no exceptions.

## The Iron Law

For EACH AC the phase covers, one strict red-green cycle:

1. **Write the AC test first.** The test encodes the AC's Given/When/Then — nothing more.
2. **Run it. It MUST fail.** Watch it fail for the RIGHT reason (the feature is absent, not a typo/import error). A test that passes before implementation is a broken test — fix the test, not the code.
3. **Write the minimal implementation.** The least code that makes this one test pass. No speculative structure, no "while I'm here" additions (YAGNI).
4. **Run it again. Green.** Also confirm previously green AC tests in this phase still pass.
5. **Next AC.** Repeat until every covered AC has its cycle.

## Violation rule

Implementation code written BEFORE its failing test exists is a **violation**: discard or stash that code, write the test, watch it fail, then re-implement. The cycle for that AC restarts. No retroactive test-writing — a test written after the code never demonstrated red, so it proves nothing.

## Why red matters

The failing run is the only evidence the test can detect the feature's absence. Skip the red and "green" becomes an opinion — exactly the hallucinated progress this loop is built to prevent.

## Boundaries

- Tests assert observable behavior from the AC, not implementation internals — refactors must not break them.
- One AC may need several assertions, but keep one test (or one tight test group) per AC, named with the AC ID (e.g. `test_AC_2_1_...`) for PRD->phase->test->commit traceability.
- Light phases do NOT follow this file: light = test-after by design (token economy). Escalation light->heavy restores the Iron Law.

---
Provenance: discipline adapted from the superpowers methodology (obra), frozen into this plugin on 2026-06-12. Self-contained by design — audit against upstream on superpowers major releases.
