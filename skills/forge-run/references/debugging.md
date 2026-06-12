# Systematic Debugging — red-iteration discipline

Loaded by `forge-run` for every red iteration. Followed by whoever owns the fix (the orchestrator on light phases, the implementer subagent on heavy phases) BEFORE any retry. Blind retries are forbidden — a retry without a diagnosis is spinning, not learning.

## The protocol (before iter++ and retry)

1. **Read the full error.** Complete stack trace and test output, not a summary. The answer is usually in the part that gets skipped.
2. **Form ONE falsifiable root-cause hypothesis.** "The test fails because X" — specific enough that evidence can kill it.
3. **Gather minimal evidence.** One command, one log read, one targeted inspection that confirms or refutes the hypothesis. Do not change code to "see if it helps".
4. **Fix the cause, not the symptom.** The fix targets the confirmed hypothesis. Never shotgun multiple simultaneous changes — if the fix works you won't know why, and if it fails you won't know what failed.
5. **Same error after the fix = the hypothesis is DEAD.** Form a new one. Repeating the same fix against the same error is a violation of this protocol.

## Wiring into the loop

- Each red iteration consumes one hypothesis cycle. K consecutive red iterations therefore means K dead hypotheses — that is what makes escalation meaningful.
- A subagent reporting **stuck** MUST include its tested hypotheses and the evidence that killed them (this extends the report contract in `dispatch.md`).
- ESCALATE passes the dead-hypothesis list to the fresh subagent via the escalation lesson — the senior retry starts from accumulated diagnosis, never from zero. Escalation is "more capable model PLUS inherited diagnosis", not just a more expensive guess.

---
Provenance: discipline adapted from the superpowers methodology (obra), frozen into this plugin on 2026-06-12. Self-contained by design — audit against upstream on superpowers major releases.
