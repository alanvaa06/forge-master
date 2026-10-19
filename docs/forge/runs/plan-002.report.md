# plan-002 final report: harness-enforcement (target v0.18.0)

Run: 2026-10-18, autonomous, isolation worktree (`../forge-master-forge-002`, branch `forge/002-harness-enforcement`), K=3, on_complete pr, max_parallel 1, gates `node validate.mjs && claude plugin validate .`. Executed with the INSTALLED v0.17 plugin (spec R2 dogfood bootstrap): the guard hook, verify gate and lock built here were not active during the run; every dispatch prompt forbade docs/forge|docs/context writes, forge-state calls and mutating git, and the orchestrator made every commit and state write.

## Outcome

| | count |
|---|---|
| phases done | 9 / 9 |
| blocked / blocked-upstream | 0 |
| plan-stale | 0 |
| pending | 0 |
| escalations | 0 |
| red iterations | 6 (one each in P2, P3, P4, P5, P7, P8; every one a review blocker, none a red test) |

| phase | tags | ACs | iter | commit |
|---|---|---|---|---|
| P1 plan contract lint + test-suite wiring | junior/heavy | AC-2.1, AC-2.2 | 0 | fcb03cb |
| P2 forge-git helpers + verify | senior/heavy | AC-2.3, AC-2.6 | 1 | 85d1cfd |
| P3 evidence-gated set done | junior/heavy | AC-2.4, AC-2.5 | 1 | a703b2f |
| P4 reconcile, finish, preflight | junior/heavy | AC-3.1, AC-3.2, AC-3.5 | 1 | 8e12018 |
| P5 run lock with heartbeat | junior/heavy | AC-3.4 | 1 | d52e38f |
| P6 forge-guard PreToolUse hook | senior/heavy | AC-1.2 .. AC-1.6 | 0 | a23a821 |
| P7 plugin agent definitions | junior/heavy | AC-1.1 | 1 | f147539 |
| P8 skill prose integration | junior/heavy | AC-1.7, AC-2.7, AC-3.3, AC-3.6 | 1 | ef14c39 |
| P9 release docs + live checks | junior/light | AC-1.8, AC-2.8, AC-3.7 ([manual-check]) | 0 | 421dde3 |

Review blockers that were caught and fixed (all reproduced by the reviewer before fixing):
- P2: AC-trace regex `\b` rejected the plugin's own `test_AC_2_1_` naming; git `maxBuffer` 1 MiB (ENOBUFS on large repos / CRLF warnings); gates backtick unwrap ran before the comment strip (executed the gates' output).
- P3: the unknown-phase test could no longer fail once the gate refused first.
- P4: `reconcile` counted a merged earlier plan's `P<n>:` commits (now name-scoped); `preflight` ignored the default `on_complete: pr`.
- P5: a lock with a missing/garbage heartbeat refused every other holder forever.
- P7: agent bodies referenced plugin files repo-relative (unresolvable in a user's repo) -> `${CLAUDE_PLUGIN_ROOT}/...`.
- P8: parallel worktree verify read the stale worktree state file; the finish `[meta]` line was never committed/pushed; a `/loop` tick after a `pr` finish hit `git worktree add -b` on the existing branch.

Dogfood finding at P9: the repo's new `forge-state verify --prd` (run against this repo on a scratch copy of the state) reported AC-1.6, AC-1.7, AC-2.7, AC-3.3 and AC-3.6 untested, because their validate.mjs checks carried no AC ID. Six reviews missed it. Fixed in P9 by tagging those validate.mjs sections; after the fix: 0 untested ACs, verify `pass: true`, and the new gated `set done` accepted the real committed tree.

## Definition of Done

- [x] All AC green: `node validate.mjs` exit 0 (forge-state 94 + git 72 + guard 91 tests, agent/hook/marker checks); `claude plugin validate .` exit 0; also `claude plugin validate .claude-plugin/plugin.json` exit 0.
- [x] `.claude-plugin/plugin.json` version `0.18.0`; README documents `agents/`, `hooks/`, `verify`, `reconcile`, `finish`, `preflight`, lock behavior, and why a finished plan is not re-opened.
- [ ] `[manual-check]` ACs verified once in a live dogfood run: PENDING (need the reinstalled 0.18 plugin), steps below.

## Pending [manual-check] ACs (verify after the PR is merged and 0.18 is reinstalled)

0. Reinstall: `claude plugin marketplace update forge-master`, then `claude plugin update forge-master@forge-master` (or `/plugin` in Claude Code), restart Claude Code, and confirm `claude plugin list` shows forge-master 0.18.0.
1. AC-1.8 (guard denies, run continues): in a Claude Code session in a scratch git repo with the plugin enabled, dispatch the Agent tool with `subagent_type: "forge-master:forge-implementer-junior"` (fallback `forge-implementer-junior` if rejected, which also settles spec R1) and ask it to (a) Edit `docs/forge/runs/plan-001.state.md` and (b) run `git checkout -b probe`. Expected: both calls denied with a `forge-guard: ... is orchestrator-owned` reason, the subagent reports it, the session continues. Repeat (b) in the main session: it must NOT be denied. Gap to probe too: the same `git checkout` via the PowerShell tool is NOT guarded (see follow-up 1).
2. AC-2.8 (non-zero gates refuse done): in a scratch repo with a seeded plan whose `gates:` exits non-zero (e.g. a failing `node --test`), run `forge-state verify <plan> P1 --prd <prd>` -> `pass: false`; then `forge-state set <plan> P1 done` -> exit 1, entry unchanged. In a live `/forge-master:run`, the phase must take the red path (`forge-state red`).
3. AC-3.7 (finished run never re-lands): in this repo after the merge, re-invoke `/forge-master:run docs/forge/plans/plan-002.md` (or let a `/loop 30m /forge-master:run` tick fire). Expected: INIT's seed reports `finished: true` with action `pr` and the PR URL, the run stops, and no push, merge or PR creation happens. The finish marker for this is recorded at `C:/Proyectos/forge-master/.git/forge/plan-002.finished.json` (written by this run with the new `forge-state finish`) plus the committed `[meta]` line.

## Divergences from the spec (plan wins; recorded in results.md)

- I4 AC regex: `(?<![a-z0-9])` instead of `\b`, so `test_AC_x_y_` names count (AC-2.6's own text).
- I1 reconcile: counts only subjects `P<n>: <exact phase name>` (or that plus a space), not any `/^P<n>: /`, so a merged earlier plan cannot mark this plan done.
- I5 forge-state rule: a word whose basename is `forge-state`/`forge-state.mjs`, not any segment containing the string, so `node --test .../forge-state.test.mjs` stays allowed; quotes group words.
- I7 reviewer body: ends with findings + `verdict: approve|blockers` (only signal `plan-assumption-broken`) instead of the implementer report contract.
- P9 touched validate.mjs (outside its File Map) only to add AC-ID comments.

## Follow-ups (not done; from review nits)

1. HIGH: the guard's matcher has no `PowerShell` tool, so on Windows a forge subagent can run `git commit` through PowerShell unguarded. Add `PowerShell` to the matcher and treat it like Bash in `decide`.
2. parallel.md: a non-zero `git merge --squash` must count as an integration failure before verify (a conflicted squash can pass the gates and commit conflict markers); `git branch -D` after a squash.
3. forge-guard precision: over-blocks reading `forge-state.mjs` (`git diff/cat/grep` on it) in this repo; `docs/./forge`, `docs//forge`, `..` path forms bypass (add posix normalize); read-only `git branch --show-current`/`stash list`/`worktree list` denied while `git revert/am/rm/mv/clean` are allowed.
4. This repo's gates: `claude plugin validate .` only checks marketplace.json; future plans should also gate `claude plugin validate .claude-plugin/plugin.json`.
5. The pre-existing `forge-state.test.mjs` leaks one `forge-state-*` temp dir per test (about 1.6k left in %TEMP% by this run's gate runs).
6. Lifecycle edges: the lock is released at all-terminal, leaving END/landing unlocked until `finish`; the heartbeat is not holder-checked; merge-mode finish deletes the branch before removing the worktree (git refuses) and should stage only the state file.

## Tokens

Harness-reported subagent totals about 4.43M (implementers + independent reviewers + re-reviews; these figures include context re-reads, so they overstate fresh tokens), plus about 0.37M orchestrator context: about 4.8M against run_budget 5,000,000. Per phase (subagents): P1 0.23M, P2 0.76M, P3 0.62M, P4 0.63M, P5 0.60M, P6 0.28M, P7 0.55M, P8 0.76M, P9 inline. P2, P3, P4, P5 and P8 ended above phase_budget 600,000, mostly in review/re-review cycles; the soft phase_budget escalation signal was not tracked live during the run (calibration note, not a stop condition).

## Key lessons

- Independent review is where this loop finds its defects: 0 red tests, 6 review blockers, each reproduced before fixing. 0 escalations again (107 + 9 field phases).
- Structural checks need AC IDs, or the AC trace calls the AC untested (see lessons.md).
