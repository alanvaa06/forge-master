# Spec-002: harness-enforcement  (PRD: docs/forge/prd/002-harness-enforcement.md)

> Technical design reference. Approved at human gate 1.5, BEFORE plan-design. Subordinate to the plan:
> the plan is the only execution contract — phases CITE spec sections; the spec never overrides the plan.

## Architecture
Three enforcement points, each moving one prose guarantee into code the model cannot talk its way around:

```
 subagent tool call ──> PreToolUse hook (forge-guard.mjs) ──deny──> docs/forge|docs/context writes,
   (agent_type = forge-master:forge-*)                              mutating git, forge-state calls
 orchestrator ──> forge-state verify ──> snapshot tree id + gates exit + AC-test trace ──> state entry
              ──> git commit ──> forge-state set done ──(HEAD tree == verified tree?)──> done | refuse
 orchestrator INIT ──> forge-state preflight / seed --holder (lock + finished check) / reconcile
                         lock + finished marker live in <git-common-dir>/forge/ (never committed)
```

Subagent roles become real plugin agents (`agents/*.md`) so model, effort and tool access are harness
facts, not dispatch prose. Git-touching logic lives in one zero-dep helper module (`forge-git.mjs`)
consumed by `forge-state.mjs`. The SKILL prose shrinks where code takes over (INIT reconciliation).

## Components
### C1: Plugin agent definitions
- responsibility: fix model, effort and tool access per subagent role (junior implementer, senior implementer, reviewer)
- collaborates_with: C2 (the guard keys on these agent types), C6 (dispatch names them)
- serves: US-1

### C2: Guard hook
- responsibility: deny forge subagents writes to orchestrator-owned paths, mutating git, and `forge-state` calls; stay silent and fail-open everywhere else
- collaborates_with: C1
- serves: US-1

### C3: Plan contract + lint extensions
- responsibility: require a frozen `gates:` command and validate Run Config enums and budgets
- collaborates_with: C4 (verify reads `gates`), C6 (plan-design writes it)
- serves: US-2

### C4: Evidence gate
- responsibility: run the gates over an identified code snapshot, trace covered ACs to tests, and refuse `done` without a matching passing verify
- collaborates_with: C3, C5 (shared git helpers), C6
- serves: US-2

### C5: Run lifecycle
- responsibility: reconcile state from phase commits, single-driver lock with heartbeat, idempotent finish record, landing preflight
- collaborates_with: C4 (shared git helpers), C6
- serves: US-3

### C6: Skill prose integration
- responsibility: wire C1-C5 into plan-design and the run loop; delete prose that code now owns
- collaborates_with: C1-C5
- serves: US-1, US-2, US-3

### C7: Validation + docs
- responsibility: structural checks for agents/hooks, run every `*.test.mjs` suite, README, version 0.18.0
- collaborates_with: all
- serves: US-1, US-2, US-3 (Definition of Done)

## Interfaces
> Data contracts and boundaries phase subagents must respect. Exact signatures/schemas, not prose.

### I1: forge-state CLI additions  (C3/C4/C5 -> orchestrator)
All output JSON on stdout, ASCII-only. Exit 1 + stderr message on refusal or usage error.
```
lint      <plan> [--prd <prd>]
          new contract errors: "Run Config gates is required (one bash command covering what CI runs)"
                               "Run Config <key> must be one of <a|b|c>, got \"<v>\""   (mode, isolation, on_complete)
                               "Run Config <key> must be a positive integer, got \"<v>\"" (phase_budget, run_budget, when present)
          a gates value that is empty or still a "<...>" placeholder counts as missing

verify    <plan> <P-id> [--prd <prd>] [--gates "<cmd>"]
          -> {plan, phase, snapshot: "<40-hex tree id>", gates, shell: "bash"|"default",
              exit_code, untested_acs: ["AC-x.y", ...], pass, tail: "<last 40 output lines>"}
          pass = exit_code == 0 && untested_acs.length == 0  (untested_acs only computed with --prd)
          persists verify=pass|fail:<snapshot> on the entry; exit 0 whenever the gates ran (pass carried in JSON)
          plan without gates and no --gates -> exit 1 "plan has no gates: pass --gates \"<cmd>\""

set       <plan> <P-id> done [--force --reason "<text>"]
          gate: entry verify == pass:<V> AND snapshotHead() == V, else exit 1:
            "P3: no passing verify for the committed code (verified <V|none>, committed <H>); differing: a.js, b.js.
             Run forge-state verify after the last code change, commit with git add -A, then set done."
          --force requires --reason (else exit 1); success -> {..., forced: true, reason}; persists `forced` token

reconcile <plan>
          -> {plan, reconciled: ["P2", ...], unchanged: ["P4", ...]}
          every plan phase whose entry is not done (or missing) and has a commit subject /^P<n>: / on HEAD's history
          becomes done with the `reconciled` token; no verify required (the commit is the evidence)

finish    <plan> --action pr|merge|keep [--ref <url-or-sha-or-branch>]
          -> {plan, finished: {action, ref, at}}; writes I3 marker + I2 meta line; releases the lock
          second call -> exit 1 "plan-NNN already finished (<action> <ref> at <at>)"

preflight <plan>
          -> {plan, ok, errors: [...], checks: {remote: true|false}}; exit 0 if ok else 1
          on_complete pr|merge with `git remote` empty -> error "on_complete <a> needs a git remote; add one or set keep"

seed      <plan> [--holder <id>]          (holder defaults to "anonymous")
          finished marker present -> {plan, finished: true, action, ref, at}; nothing else happens
          else acquire lock (I3): fresh lock of another holder -> exit 1
            "plan-NNN is driven by <holder> (heartbeat <iso>, <n> min ago); stop, or wait until it is stale (120 min)"
          same holder or stale lock -> acquire; stale takeover adds {lock_takeover: true, previous_holder, previous_heartbeat}
          existing output fields unchanged, plus finished: false

next      <plan> [--all]                  (+ finished: true|false, same detection as seed)
```
Every mutating command (`set`, `red`, `escalate`, `recover`, `verify`, `reconcile`) refreshes the lock heartbeat when a lock file exists. `set` releases the lock when every phase becomes terminal. Clock: `FORGE_STATE_NOW` (ISO 8601) overrides `Date.now()` for tests only.

### I2: State line grammar  (C4/C5 <-> state file)
```
- [status] plan-NNN P<n>: <name> {tier=<t> process=<p> iter=<n> verify=<pass|fail>:<40-hex> forced reconciled}
- [meta] plan-NNN finished: action=<pr|merge|keep> ref=<ref> at=<iso>
```
Suffix tokens are optional and order-fixed as written. A brace group containing any other token stays part of the phase name (existing rule). `[meta]` lines never match ENTRY_RE (no `P<n>:` after the plan id).

### I3: Out-of-tree run files  (C5, never committed)
```
<git rev-parse --git-common-dir>/forge/plan-NNN.lock.json
  {"holder":"<id>","acquired_at":"<iso>","heartbeat_at":"<iso>","run_root":"<abs path>"}
<git rev-parse --git-common-dir>/forge/plan-NNN.finished.json
  {"action":"pr|merge|keep","ref":"<ref>","at":"<iso>"}
```
`seed`/`next` report finished if EITHER the marker file or the I2 meta line exists.

### I4: forge-git.mjs  (C4/C5 internal module)
```js
export function gitCommonDir(cwd)              // -> absolute path
export function snapshotWorktree(cwd)          // -> tree id: temp GIT_INDEX_FILE, `git add -A`, `git rm -r --cached
                                               //    --ignore-unmatch -- docs/forge docs/context`, `git write-tree`
export function snapshotHead(cwd)              // -> tree id: temp index, `git read-tree HEAD`, same rm, write-tree
export function diffSnapshots(cwd, a, b)       // -> string[] paths: `git diff-tree -r --name-only a b`
export function phaseCommits(cwd)              // -> Map<"P<n>", sha> from `git log --format=%H%x09%s` subjects /^P(\d+): /
export function hasRemote(cwd)                 // -> boolean: `git remote` non-empty
export function runGates(cmd, cwd)             // -> {exit_code, shell, tail}; spawn bash -c <cmd>, on ENOENT fall back to shell:true
export function findUntestedAcs(cwd, acIds)    // -> string[]; scans `git ls-files -co --exclude-standard`, skips paths under
                                               //    docs/ and node_modules/, files > 1 MiB, files containing a NUL byte;
                                               //    AC-x.y matches /\bac[-_]x[._]y(?!\d)/i
```
All git calls via `execFileSync('git', args, {cwd, env})`; the real index is never touched.

### I5: Guard hook I/O  (Claude Code -> C2)
```
stdin  {session_id, transcript_path, cwd, hook_event_name: "PreToolUse", tool_name, tool_input, agent_id?, agent_type?}
forge subagent  iff  agent_type matches /(^|:)forge-(implementer-(junior|senior)|reviewer)$/   (missing/empty = not forge)
path rule   tool_name in Edit|Write|NotebookEdit; p = tool_input.file_path ?? tool_input.notebook_path;
            normalize "\" -> "/", case-insensitive; deny if /(^|\/)docs\/(forge|context)(\/|$)/
bash rule   split tool_input.command on && || ; | & newline $( and backtick; per segment strip quotes, tokenize;
            token with basename git|git.exe -> skip globals (-C v, -c v, --git-dir[=v], --work-tree[=v], --no-pager,
            -P, --namespace[=v]) -> subcommand in {add commit checkout switch restore pull push merge rebase reset
            cherry-pick branch tag worktree stash} -> deny; any segment containing "forge-state" -> deny
deny   stdout {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
               "permissionDecisionReason":"forge-guard: <what> is orchestrator-owned. <fix-it: report it in your final message>"}}
allow  exit 0, empty stdout
error  any exception or unparseable stdin -> exit 0, empty stdout, ASCII warning on stderr (fail-open)
```
Module shape: `export function decide(input) -> null | {reason}` (pure, unit-tested) plus a stdin wrapper run only when executed directly.

### I6: hooks/hooks.json  (C2 registration)
```json
{"hooks":{"PreToolUse":[{"matcher":"Edit|Write|NotebookEdit|Bash",
  "hooks":[{"type":"command","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/hooks/forge-guard.mjs"],"timeout":10}]}]}}
```

### I7: Agent frontmatter  (C1)
```
forge-implementer-junior.md  name: forge-implementer-junior  model: sonnet  effort: low
forge-implementer-senior.md  name: forge-implementer-senior  model: opus    effort: high
forge-reviewer.md            name: forge-reviewer            model: opus    effort: high
                             tools: Read, Grep, Glob
                             disallowedTools: Edit, Write, NotebookEdit, Bash
description (all): "Internal to forge-master runs: dispatched only by the /forge-master:run orchestrator. Not for general tasks."
body: role; never write docs/forge or docs/context; no mutating git; final message follows references/dispatch.md report contract
dispatch: subagent_type "forge-master:forge-implementer-<tier>" | "forge-master:forge-reviewer"
```

### I8: Run loop protocol  (C6 -> skills/forge-run/SKILL.md)
```
INIT  fresh run: forge-state preflight -> ok:false => stop, report errors
      forge-state seed <plan> --holder ${CLAUDE_SESSION_ID}
        finished:true => report action/ref, tell user to cancel any /loop, STOP (no LOOP/END/Finish)
        lock refused  => stop, report holder
      resume with missing/in_flight => forge-state reconcile (replaces hand-run git log --grep steps)
LOOP  set P in_progress -> dispatch forge-master:forge-implementer-<tier> (or inline light)
      heavy: dispatch forge-master:forge-reviewer with plan section, AC texts, cited spec rows, and the diff
      forge-state verify <plan> P --prd <prd>   (Bash tool timeout 600000)
        pass -> git add -A; git commit -m "P<n>: <name> [AC-..]"; forge-state set P done
        fail -> forge-state red P (existing K machinery)
END   Finish action lands -> forge-state finish <plan> --action <a> --ref <PR url | merge sha | branch>
      budget clean-stop writes NO finish record (the run is resumable)
```

### I9: Plan template Run Config line  (C3)
```
- gates: <cmd>                # REQUIRED. One bash command the loop runs as every phase's gate; must cover everything CI runs (e.g. npm test && npx tsc --noEmit)
```

## File Map
> Files to create/modify, one responsibility each. Phase subagents follow this — no improvised structure.

| Path | Role | Component |
|------|------|-----------|
| `agents/forge-implementer-junior.md` | junior implementer definition (I7) | C1 |
| `agents/forge-implementer-senior.md` | senior implementer definition (I7) | C1 |
| `agents/forge-reviewer.md` | read-only reviewer definition (I7) | C1 |
| `hooks/hooks.json` | registers the PreToolUse guard (I6) | C2 |
| `hooks/forge-guard.mjs` | `decide(input)` + stdin wrapper (I5) | C2 |
| `hooks/forge-guard.test.mjs` | table-driven guard tests (AC-1.2..1.5) | C2 |
| `skills/forge-run/scripts/forge-git.mjs` | git helpers (I4) | C4, C5 |
| `skills/forge-run/scripts/forge-state.mjs` | CLI: lint extensions, verify, set-done gate, reconcile, finish, preflight, lock (I1-I3) | C3, C4, C5 |
| `skills/forge-run/scripts/forge-state.test.mjs` | existing suite + lint/suffix tests; fixtures gain `gates:`, legacy `set done` calls use `--force --reason fixture` | C3 |
| `skills/forge-run/scripts/forge-state.git.test.mjs` | temp-git-repo tests: verify, set gate, reconcile, finish, preflight, lock | C4, C5 |
| `templates/plan-template.md` | `gates:` line (I9) | C3 |
| `skills/plan-design/SKILL.md` | derive `gates:` from CI config + test scripts; preflight `⛔` on the Run Config card | C6 |
| `skills/forge-run/SKILL.md` | INIT/LOOP/END per I8; old reconciliation prose removed | C6 |
| `skills/forge-run/references/dispatch.md` | agent types; orchestrator owns every commit and state write | C6 |
| `skills/forge-run/references/code-review.md` | reviewer = `forge-master:forge-reviewer`, read-only, receives the diff | C6 |
| `skills/forge-run/references/parallel.md` | orchestrator commits inside phase worktrees | C6 |
| `validate.mjs` | agents/hooks structural checks, run every `*.test.mjs`, new markers | C7 |
| `README.md` | document agents/, hooks/, new subcommands, lock + finish behavior | C7 |
| `.claude-plugin/plugin.json` | version 0.18.0 | C7 |

## Decisions
> Tradeoffs resolved NOW so no phase subagent re-litigates them. One line each: decision + why.

- D1: Enforcement in the plugin-level `hooks/hooks.json`, filtered by `agent_type` — plugin agents ignore frontmatter `hooks`/`permissionMode`.
- D2: Forge-agent match is the regex `(^|:)forge-(implementer-(junior|senior)|reviewer)$` — docs say plugin agent_type is plugin-scoped (`forge-master:...`); the regex also tolerates a bare name.
- D3: Reviewer gets `Read, Grep, Glob` only, no Bash — "a reviewer should never hold a pen"; the orchestrator supplies the diff and runs the gates.
- D4: Implementers run no mutating git at all; the orchestrator owns every commit, including in parallel phase worktrees (user answer 2a, MAES lessons.md:48).
- D5: Code snapshot = git tree id from a throwaway index (`git add -A`, minus `docs/forge`, `docs/context`); compared to HEAD's tree with the same exclusions — prototyped: CRLF-safe under autocrlf, ignores gitignored files, never touches the real index.
- D6: Snapshot is taken BEFORE the gates run — artifacts the gates create (coverage, caches) cannot cause false mismatches.
- D7: Phase commits use `git add -A` — the committed tree must equal the verified tree; stray files must be gitignored or deleted, and the refusal lists them.
- D8: Gates run via `bash -c`, falling back to the platform shell on ENOENT — plans are written in bash syntax (Git Bash on Windows); the JSON reports which shell ran.
- D9: Lock and finished marker live in `<git-common-dir>/forge/` — shared by every worktree of the repo, never committed, survive run-worktree removal (the /loop-after-finish case).
- D10: Finished is dual-written (marker file + `[meta]` line in the state file) — the marker survives worktree removal; the meta line satisfies AC-3.2 and travels with the branch.
- D11: Lock holder = `${CLAUDE_SESSION_ID}` substituted into SKILL.md — same session re-invoking (compaction, /loop) re-acquires; another window is refused.
- D12: Stale threshold 120 min — field phases finished well within an hour (Graphiu 15 phases, Induxion 11 phases, each in one day); 120 = four /loop 30m ticks before a crashed run is taken over.
- D13: Heartbeat refreshed by every mutating `forge-state` command — no separate daemon; long phases are bracketed by `set in_progress` and `verify`.
- D14: `reconcile` marks done without verify — under 0.18 a `P<n>:` commit only exists after a passing verify; for legacy runs the commit is the best evidence available.
- D15: `--force` needs `--reason`; the reason is printed and the SKILL writes it to `results.md` — the entry only carries the `forced` flag (suffix tokens hold no free text).
- D16: Existing tests that `set done` as fixture setup switch to `--force --reason fixture` — no hidden env bypass, since a bypass the tests can use is one a model can use.
- D17: Git helpers split into `forge-git.mjs` — keeps `forge-state.mjs` the state machine and makes git behavior testable on its own.
- D18: Hook uses exec form (`command: node`, `args: [path]`), timeout 10 s — docs recommend exec form for path placeholders; AC-1.6's "command references `${CLAUDE_PLUGIN_ROOT}`" is checked over `command` + `args`.
- D19: Agent descriptions say "dispatched only by the forge-master run orchestrator" and never "use proactively" — descriptions drive automatic delegation and no frontmatter field disables it.

## Risks
> Feeds plan-design tier/process tagging: a phase touching a listed risk should not start junior/light.

- R1: The Agent tool's `subagent_type` string for plugin agents is undocumented, and `agent_type` is documented but not observed — affects: C1, C2, C6 / AC-1.2..1.4, AC-1.7, AC-1.8 — mitigation: D2's tolerant regex; dispatch.md falls back to the bare name if the scoped name is rejected; AC-1.8 live probe after reinstall.
- R2: Dogfood bootstrap — this run executes with the installed v0.17 plugin, so the guard, verify gate and lock are NOT active while building them — affects: all phases — mitigation: dispatch prompts in this run forbid git writes and state writes in prose (the v0.17 field lessons); reinstall the plugin after landing, then close the `[manual-check]` ACs.
- R3: Snapshot false refusals (untracked non-ignored files, filters, generated files) — affects: C4 / AC-2.3, AC-2.4 — mitigation: D6, D7, actionable refusal listing differing paths, `--force --reason` escape.
- R4: The guard fires on every Edit/Write/Bash in every session with the plugin enabled (node spawn cost; a bug could block normal work) — affects: C2 / AC-1.4, AC-1.5 — mitigation: early return for non-forge input, fail-open, 10 s timeout, AC-1.4/1.5 tests.
- R5: Bash git detection is bypassable (`sh -c`, aliases, scripts) — affects: C2 / AC-1.3 — mitigation: best-effort by Non-Goal; damage still surfaces as a snapshot mismatch at `set done`.
- R6: Gate commands may exceed the Bash tool's default 2-minute timeout — affects: C4, C6 / AC-2.3 — mitigation: I8 mandates timeout 600000 for verify.
- R7: Backward compatibility (v0.17 state lines, plans without gates, the existing 87 tests) — affects: C3, C4 / AC-2.1, AC-2.3 — mitigation: additive suffix grammar, gates missing is a contract (not graph) error so seed still resumes, `--gates` override, D16.
- R8: State-script complexity grows (~541 lines now) — affects: C3-C5 — mitigation: D17 module split; temp-git tests isolated in their own file.

## Out of Scope (technical)
- Parsing shell syntax into an AST to catch indirect git or redirection writes (best-effort tokenizer only).
- Locking across machines or clones (the lock is per git common dir).
- Re-opening a finished plan (re-run requires a new plan number or deleting the marker by hand; documented in README).
- Enforcing anything on the main-session orchestrator (it owns state; the guard only constrains forge subagents).
- Signing or hashing evidence beyond the git tree id; PostToolUse auditing.
