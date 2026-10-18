# PRD-002: harness-enforcement

> Imported 2026-10-18 from the forge-master v0.17.0 audit (solutions S1-S3), grounded in field evidence from 18 real plans / 107 phases across Curamedi, Graphiu, Induxion-Community and Multi_Agent_Equity_System. Target version 0.18.0.

## Goal
Move the three guarantees that failed in the field from prose into code: subagents cannot touch forge state or move branches, a phase cannot be marked `done` without recorded passing evidence for the code it ships, and run state is reconcilable, single-driver, and finishes exactly once.

## Non-Goals
- Worktree environment bootstrap / infra-failure classification (audit S4).
- Behavioral evals (`claude plugin eval`), CI, CHANGELOG, stripping HTML-comment markers in `validate.mjs` (audit S5).
- Per-phase metrics, budget calibration, triage A/B experiments (audit S6).
- Closure loop for `[manual-check]` ACs (audit S7).
- General prose trimming (audit S8) — only prose whose behavior this PRD moves into code is removed.
- Changes to Parallel Groups beyond keeping them working under the new commit-ownership rule.
- A custom Stop hook (the native `/goal` stays the premature-stop guard).
- Moving `forge-state` into `bin/`.
- Any change to the escalation ladder (K, tier/process bump rules).
- Parsing shell redirections to catch writes into `docs/forge/` via Bash (best-effort scope: Edit/Write/NotebookEdit paths, git subcommands, and `forge-state` invocations only).

## User Stories

### US-1: Subagent containment
As a forge-master user, I want forge subagents to be technically unable to write forge state or run mutating git, so that a phase subagent can never revert run state, mark its own phase, or move the branch the orchestrator commits on.
- AC-1.1: Given the plugin repo, When `node validate.mjs` parses `agents/*.md` frontmatter, Then `forge-implementer-junior.md` (`model: sonnet`), `forge-implementer-senior.md` (`model: opus`) and `forge-reviewer.md` (`model: opus`) exist with `name`, `description` and `model`, and the reviewer's `disallowedTools` includes `Edit`, `Write` and `NotebookEdit`.
- AC-1.2: Given a PreToolUse hook input whose `agent_type` names a forge subagent and whose `tool_name` is `Edit`, `Write` or `NotebookEdit` with a `file_path` under `docs/forge/` or `docs/context/` (absolute or relative, either slash style), When the hook script runs with that JSON on stdin, Then it prints `hookSpecificOutput.permissionDecision: "deny"` with a reason naming the orchestrator-owned path. Verified by `node --test`.
- AC-1.3: Given a forge-subagent hook input with `tool_name: Bash` whose command runs a mutating git subcommand (`add`, `commit`, `checkout`, `switch`, `restore`, `pull`, `push`, `merge`, `rebase`, `reset`, `cherry-pick`, `branch`, `tag`, `worktree`, `stash`) or invokes `forge-state`, including inside chained commands (`cd x && git pull`), When the hook runs, Then it denies; read-only git (`status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`, `blame`) produces no decision. Verified by a table-driven `node --test`.
- AC-1.4: Given a hook input with no `agent_type` (main session) or a non-forge `agent_type`, When the hook runs with any input from AC-1.2 or AC-1.3, Then it exits 0 with empty stdout. Verified by `node --test`.
- AC-1.5: Given malformed JSON on stdin or an internal error in the hook script, When it runs, Then it exits 0 with empty stdout (fail-open) and writes an ASCII-only warning to stderr. Verified by `node --test`.
- AC-1.6: Given `hooks/hooks.json`, When `node validate.mjs` runs, Then the file parses and registers a `PreToolUse` hook whose matcher covers `Edit`, `Write`, `NotebookEdit` and `Bash` and whose command references `${CLAUDE_PLUGIN_ROOT}`; and `claude plugin validate .` exits 0.
- AC-1.7: Given `skills/forge-run/SKILL.md` and `skills/forge-run/references/{dispatch,code-review,parallel}.md`, When `node validate.mjs` checks markers, Then implementers are dispatched with `subagent_type` `forge-implementer-<tier>`, the reviewer with `forge-reviewer`, and `dispatch.md` states the orchestrator owns every commit and every state write, including commits inside parallel phase worktrees.
- AC-1.8: Given a live dogfood run, When a forge subagent attempts to edit `docs/forge/runs/*.state.md` or run `git checkout`, Then the attempt is denied and the run continues. `[manual-check]`

### US-2: Evidence-gated done
As a forge-master user, I want `done` to require a recorded passing run of a frozen gate set over the exact code being committed, so that a phase cannot be declared green on opinion, on an incomplete gate set, or with its AC tests missing.
- AC-2.1: Given a plan whose `## Run Config` lacks `gates:` or leaves it empty, When `forge-state lint` runs, Then it exits 1 with an error naming `gates`; and `templates/plan-template.md` contains a `gates:` line. Verified by `node --test` and `node validate.mjs`.
- AC-2.2: Given a Run Config with `mode` outside `autonomous|attended`, `isolation` outside `worktree|in-place`, `on_complete` outside `pr|merge|keep`, or `phase_budget` / `run_budget` not a plain positive integer, When `forge-state lint` runs, Then it exits 1 naming each offending key. Verified by `node --test`.
- AC-2.3: Given a plan with `gates:` set, When `forge-state verify <plan> P<n>` runs, Then it executes the gates command in the current directory, prints JSON with `exit_code` and `pass`, and persists the result plus an identifier of the verified code snapshot (excluding `docs/forge/` and `docs/context/`) on the phase's state entry; a plan without `gates:` (seeded before 0.18) requires `--gates "<cmd>"`, which is recorded with the result. Verified by `node --test` in a temporary git repo.
- AC-2.4: Given a phase whose latest verify is missing, failed, or recorded a snapshot that differs from the phase's code as committed (excluding `docs/forge/` and `docs/context/`), When `forge-state set <plan> P<n> done` runs, Then it exits 1 and the entry is unchanged; given a matching passing verify, it succeeds. Verified by `node --test`.
- AC-2.5: Given `forge-state set <plan> P<n> done --force --reason "<text>"`, When it runs, Then it succeeds, persists `forced` on the entry, and prints `forced: true` with the reason; `--force` without `--reason` exits 1. Verified by `node --test`.
- AC-2.6: Given `verify --prd <prd>` for a phase covering an AC not tagged `[manual-check]` in the PRD, and no repository file outside `.git/`, `node_modules/` and `docs/` containing that AC ID as `AC-x.y`, `AC_x_y` or `ac_x_y`, When verify runs, Then `pass` is false and the JSON lists the untested AC IDs, even when the gates exit 0. Verified by `node --test`.
- AC-2.7: Given `skills/plan-design/SKILL.md` and `skills/forge-run/SKILL.md`, When `node validate.mjs` checks markers, Then plan-design derives `gates:` from the repo's CI configuration and package/test scripts and shows it on the Run Config card, and the run LOOP calls `forge-state verify` before `forge-state set <P> done`.
- AC-2.8: Given a live dogfood run, When a phase's gates exit non-zero, Then `set done` is refused and the phase follows the red path. `[manual-check]`

### US-3: Reconcilable, single-driver, finish-once state
As a forge-master user, I want run state reconciled from git by code, guarded against two concurrent drivers, and closed by an idempotent finish record, so that stale entries, overlapping sessions, and `/loop` re-invocations can no longer corrupt or replay a run.
- AC-3.1: Given state entries not `done` for phases whose `P<n>: ` commit exists in `git log` of the current branch, When `forge-state reconcile <plan>` runs, Then those entries become `done` marked `reconciled`, the JSON lists them, and phases without a commit are unchanged. Verified by `node --test` in a temporary git repo.
- AC-3.2: Given `forge-state finish <plan> --action pr|merge|keep [--ref <url-or-sha>]`, When it runs, Then the state file gains a `finished:` record with action, ref and timestamp; subsequent `seed` and `next` print `finished: true` with action and ref; a second `finish` exits 1. Verified by `node --test`.
- AC-3.3: Given `skills/forge-run/SKILL.md`, When `node validate.mjs` checks markers, Then INIT stops when `seed` reports `finished: true` (reports action and ref, tells the user to cancel any `/loop`, never re-enters LOOP, END or the Finish stage), and INIT's reconciliation uses `forge-state reconcile` instead of hand-run `git log --grep` steps (the old instruction text is absent).
- AC-3.4: Given a run lock held by holder A with a fresh heartbeat (refreshed by every mutating `forge-state` command), When holder B runs `seed`, Then it exits 1 naming holder A and the last heartbeat; when holder A re-runs `seed`, it succeeds; when the heartbeat is older than the stale threshold, B takes over and the JSON reports `lock_takeover: true` with the previous holder. Verified by `node --test` with an injectable clock.
- AC-3.5: Given a plan with `on_complete: pr` or `merge` and a repo where `git remote` prints nothing, When `forge-state preflight <plan>` runs, Then it prints `ok: false` with an error naming the missing remote; with a remote configured it prints `ok: true`. Verified by `node --test`.
- AC-3.6: Given `skills/plan-design/SKILL.md` and `skills/forge-run/SKILL.md`, When `node validate.mjs` checks markers, Then the gate-2 Run Config card marks `on_complete` `⛔` (hard block, approve option withheld) when preflight reports no remote, and run INIT runs `forge-state preflight` on a fresh run and stops on `ok: false`.
- AC-3.7: Given a finished run, When `/forge-master:run` is re-invoked (e.g. by `/loop`), Then no push, merge or PR creation happens and the report states the run already finished. `[manual-check]`

## Constraints
- Zero-dependency Node ESM, consistent with `forge-state.mjs`; Windows (win32, Git Bash and PowerShell paths, CRLF files) must work.
- Console output ASCII-only (cp1252 consoles); JSON stays valid with non-ASCII escaped.
- Every new behavior is covered by `node --test` suites wired into `node validate.mjs` (the repo's test runner and the loop's own gate).
- Plugin-agent frontmatter fields `hooks`, `permissionMode` and `mcpServers` are ignored by Claude Code for plugin agents, so enforcement lives in the plugin-level `hooks/hooks.json`, filtered by `agent_type`.
- Plugin hooks fire in every session where the plugin is enabled: the hook must be fail-open and silent outside forge subagents.
- Backward compatibility: a run seeded under v0.17 (state lines without the new suffix fields, plans without `gates:`) must still resume.
- Human gates stay prose-enforced per the existing gating policy; `spec-design`, `plan-design` and `run` remain model-invocable.

## Definition of Done
- [ ] All AC green (`node validate.mjs` passes, including the new `node --test` suites; `claude plugin validate .` exits 0)
- [ ] `.claude-plugin/plugin.json` version is `0.18.0`; README documents `agents/`, `hooks/` and the new `forge-state` subcommands (`verify`, `reconcile`, `finish`, `preflight`, lock behavior)
- [ ] `[manual-check]` ACs verified once in a live dogfood run and noted in the final report
