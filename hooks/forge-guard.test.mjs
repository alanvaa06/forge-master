// Tests for forge-guard.mjs (PreToolUse hook) - run: node --test hooks/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './forge-guard.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'forge-guard.mjs');
const FORGE = 'forge-master:forge-implementer-senior';

const hookInput = (over) => ({
  session_id: 's1', transcript_path: '/tmp/t.jsonl', cwd: '/repo',
  hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: FORGE, ...over,
});
const run = (stdin) => spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8' });

// ---------- AC-1.2: Edit/Write/NotebookEdit under docs/forge|docs/context ----------

const DENIED_PATHS = [
  ['Edit', { file_path: 'C:\\repo\\docs\\forge\\runs\\x.state.md' }, 'docs\\forge\\runs\\x.state.md'],
  ['Write', { file_path: 'docs/context/todo.md' }, 'docs/context/todo.md'],
  ['Edit', { file_path: 'C:/repo/Docs/Forge/plans/plan-002.md' }, 'Docs/Forge/plans/plan-002.md'],
  ['Write', { file_path: '/home/u/repo/docs/context' }, 'docs/context'],
  ['Edit', { file_path: '.\\docs\\context\\lessons.md' }, 'lessons.md'],
  ['NotebookEdit', { notebook_path: 'C:\\repo\\docs\\forge\\nb.ipynb' }, 'nb.ipynb'],
  ['Write', { file_path: 'docs/forge/' }, 'docs/forge/'],
];
for (const [tool_name, tool_input, shown] of DENIED_PATHS) {
  const p = tool_input.file_path ?? tool_input.notebook_path;
  test(`AC-1.2 ${tool_name} ${p} -> deny naming the path`, () => {
    const d = decide(hookInput({ tool_name, tool_input }));
    assert.ok(d, 'expected a deny decision');
    assert.match(d.reason, /^forge-guard: /);
    assert.match(d.reason, /orchestrator-owned/);
    assert.ok(d.reason.includes(shown), `reason should name ${shown}: ${d.reason}`);
  });
}

const ALLOWED_PATHS = [
  ['Write', { file_path: 'docs/forgery.md' }],
  ['Edit', { file_path: 'mydocs/forge/x' }],
  ['Edit', { file_path: 'C:\\repo\\src\\docs\\forge-notes.md' }],
  ['Write', { file_path: 'docs/contexts/a.md' }],
  ['Edit', { file_path: 'hooks/forge-guard.mjs' }],
  ['NotebookEdit', { notebook_path: 'notebooks/a.ipynb' }],
  ['Read', { file_path: 'docs/forge/runs/x.state.md' }],
];
for (const [tool_name, tool_input] of ALLOWED_PATHS) {
  const p = tool_input.file_path ?? tool_input.notebook_path;
  test(`AC-1.2 ${tool_name} ${p} -> no decision (near-miss / other tool)`, () => {
    assert.equal(decide(hookInput({ tool_name, tool_input })), null);
  });
}

test('AC-1.2 stdin wrapper prints the PreToolUse deny JSON', () => {
  const r = run(JSON.stringify(hookInput({ tool_name: 'Write', tool_input: { file_path: 'docs/context/todo.md' } })));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /forge-guard: .*docs\/context\/todo\.md.*orchestrator-owned/);
  assert.match(r.stdout, /^[\x00-\x7f]*$/, 'stdout must be ASCII-only');
});

test('AC-1.2 stdin wrapper: non-ASCII path is escaped (ASCII-only stdout, JSON round-trips)', () => {
  const file_path = 'docs/forge/caf' + String.fromCharCode(0xe9, 0x2192) + '.md';
  const r = run(JSON.stringify(hookInput({ tool_name: 'Edit', tool_input: { file_path } })));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^[\x00-\x7f]+$/, 'stdout must be ASCII-only');
  assert.ok(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason.includes(file_path));
});

test('AC-1.2 forge agent_type variants are all guarded', () => {
  for (const agent_type of ['forge-master:forge-implementer-junior', 'forge-implementer-senior', 'forge-master:forge-reviewer']) {
    assert.ok(decide(hookInput({ agent_type, tool_name: 'Edit', tool_input: { file_path: 'docs/forge/x.md' } })), agent_type);
  }
});

// ---------- AC-1.3: Bash mutating git / forge-state ----------
// Quote rule (I5 "strip quotes, tokenize"): quotes group a word and are then
// removed, so `echo "git push"` is ONE token "git push" (not git) -> allowed,
// while `"git" push` is git + push -> denied.

const bash = (command) => decide(hookInput({ tool_name: 'Bash', tool_input: { command } }));
const MUTATING = ['add', 'commit', 'checkout', 'switch', 'restore', 'pull', 'push', 'merge', 'rebase', 'reset', 'cherry-pick', 'branch', 'tag', 'worktree', 'stash'];

const DENIED_CMDS = [
  ...MUTATING.map((s) => `git ${s}`),
  'git -C x checkout main',
  'git --no-pager -c a=b commit -m x',
  'git --git-dir=.git --work-tree=. reset --hard',
  'git --git-dir .git --work-tree . merge main',
  'git -P --namespace=n push',
  'git --namespace n tag v1',
  '/usr/bin/git push',
  'git.exe stash',
  'C:\\Git\\bin\\GIT.EXE push',
  '"C:\\Program Files\\Git\\bin\\git.exe" push origin',
  '"git" push',
  'cd x && git pull',
  'make || git restore .',
  'a; git reset --hard',
  'x | git tag v1',
  'sleep 1 & git switch dev',
  'echo hi\ngit add -A',
  'echo $(git branch -D y)',
  'echo `git stash`',
  '(cd x; git commit -am wip)',
  'git commit -m "fix: thing"',
  'node skills/forge-run/scripts/forge-state.mjs set plan.md P1 done',
  'node "C:\\x\\forge-state.mjs" next plan.md',
  'cd x && forge-state status plan.md',
];
for (const cmd of DENIED_CMDS) {
  test(`AC-1.3 deny: ${JSON.stringify(cmd)}`, () => {
    const d = bash(cmd);
    assert.ok(d, 'expected a deny decision');
    assert.match(d.reason, /^forge-guard: .*orchestrator-owned/);
  });
}

const ALLOWED_CMDS = [
  ...['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame'].map((s) => `git ${s}`),
  'git -C x status --short',
  'git --no-pager log --oneline -3',
  'git diff HEAD~1 -- src/branch.js',
  'git log --grep "push" --oneline',
  'cd x && git status && git diff',
  'echo "git push"',
  "echo 'git commit -m x'",
  'grep -rn git src',
  'npm test',
  'node --test skills/forge-run/scripts/forge-state.test.mjs',
  'node validate.mjs',
  'ls hooks',
];
for (const cmd of ALLOWED_CMDS) {
  test(`AC-1.3 allow (no decision): ${JSON.stringify(cmd)}`, () => {
    assert.equal(bash(cmd), null);
  });
}

test('AC-1.3 deny reason names the git subcommand', () => {
  assert.ok(bash('cd x && git pull').reason.includes('git pull'));
});

// ---------- AC-1.4: main session / non-forge agent_type -> silent ----------

const NOT_FORGE = [
  ['missing', undefined], ['empty', ''], ['general-purpose', 'general-purpose'],
  ['forge-master:other', 'forge-master:other'], ['my-forge-reviewer-x', 'my-forge-reviewer-x'],
  ['forge-implementer-mid', 'forge-implementer-mid'], ['xforge-reviewer', 'xforge-reviewer'],
];
const GUARDED_INPUTS = [
  ...DENIED_PATHS.map(([tool_name, tool_input]) => ({ tool_name, tool_input })),
  ...DENIED_CMDS.map((command) => ({ tool_name: 'Bash', tool_input: { command } })),
];
for (const [label, agent_type] of NOT_FORGE) {
  test(`AC-1.4 agent_type ${label}: decide is null for every guarded input`, () => {
    for (const over of GUARDED_INPUTS) {
      const input = hookInput({ ...over, agent_type });
      if (agent_type === undefined) delete input.agent_type;
      assert.equal(decide(input), null, JSON.stringify(over));
    }
  });
}

test('AC-1.4 stdin wrapper: main session and non-forge agent exit 0 with empty stdout', () => {
  const samples = [GUARDED_INPUTS[0], { tool_name: 'Bash', tool_input: { command: 'cd x && git pull' } }];
  for (const over of samples) {
    const main = hookInput(over);
    delete main.agent_type;
    delete main.agent_id;
    for (const input of [main, hookInput({ ...over, agent_type: 'general-purpose' })]) {
      const r = run(JSON.stringify(input));
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  }
});

// ---------- AC-1.5: malformed stdin / internal error -> fail-open ----------

const FAIL_OPEN = [
  ['malformed JSON', '{"tool_name": "Edit", '],
  ['non-JSON text', 'not json at all'],
  ['empty stdin', ''],
  ['non-ASCII malformed JSON', '{"file_path": "docs/forge/caf\u00e9\u2192'],
  ['JSON null', 'null'],
  ['internal error: Bash command not a string', JSON.stringify(hookInput({ tool_name: 'Bash', tool_input: { command: 42 } }))],
  ['internal error: tool_input null', JSON.stringify(hookInput({ tool_name: 'Edit', tool_input: null }))],
];
for (const [label, stdin] of FAIL_OPEN) {
  test(`AC-1.5 ${label}: exit 0, empty stdout, ASCII warning on stderr`, () => {
    const r = run(stdin);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /forge-guard: warning: .*fail-open/);
    assert.match(r.stderr, /^[\x00-\x7f]+$/, 'stderr must be ASCII-only');
  });
}
