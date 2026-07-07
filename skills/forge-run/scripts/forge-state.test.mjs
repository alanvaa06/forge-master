// Tests for forge-state.mjs — run: node --test skills/forge-run/scripts/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'forge-state.mjs');

const PLAN = `# Plan-007: demo  (PRD: docs/forge/prd/007-demo.md)

## Run Config
- mode: autonomous
- branch: forge/007-demo
- K: 3

## Phases

### P1: setup harness
- covers: AC-1.1
- depends_on: -
- tier: junior
- process: light
- success: covered ACs green
- notes: none

### P2: core module
- covers: AC-2.1, AC-2.2
- depends_on: P1
- tier: senior
- process: heavy
- success: covered ACs green
- notes: risky

### P3: docs
- covers: AC-3.1
- depends_on: P2
- tier: junior
- process: light
- success: covered ACs green
- notes: none

### P4: independent extra
- covers: AC-4.1
- depends_on: -
- tier: junior
- process: light
- success: covered ACs green
- notes: none
`;

let dir, planPath, todoPath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-state-'));
  planPath = join(dir, 'plan-007.md');
  todoPath = join(dir, 'todo.md');
  writeFileSync(planPath, PLAN);
});

function run(args, opts = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--todo', todoPath], {
    encoding: 'utf8',
    ...opts,
  });
}
function runJson(args) {
  return JSON.parse(run(args));
}

test('seed creates one pending entry per phase', () => {
  const out = runJson(['seed', planPath]);
  assert.equal(out.seeded, 4);
  const todo = readFileSync(todoPath, 'utf8');
  assert.match(todo, /- \[pending\] plan-007 P1: setup harness/);
  assert.match(todo, /- \[pending\] plan-007 P4: independent extra/);
});

test('seed is idempotent — second call seeds nothing, reports resume', () => {
  runJson(['seed', planPath]);
  const out2 = runJson(['seed', planPath]);
  assert.equal(out2.seeded, 0);
  assert.equal(out2.resume, true);
  const todo = readFileSync(todoPath, 'utf8');
  assert.equal(todo.match(/plan-007 P1:/g).length, 1);
});

test('seed preserves unrelated todo.md content', () => {
  writeFileSync(todoPath, '# Todos\n- [ ] unrelated human todo\n');
  runJson(['seed', planPath]);
  const todo = readFileSync(todoPath, 'utf8');
  assert.match(todo, /unrelated human todo/);
  assert.match(todo, /plan-007 P1:/);
});

test('next returns first executable phase with plan metadata', () => {
  runJson(['seed', planPath]);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P1');
  assert.equal(out.phase.tier, 'junior');
  assert.equal(out.phase.process, 'light');
  assert.deepEqual(out.phase.covers, ['AC-1.1']);
  assert.deepEqual(out.phase.depends_on, []);
});

test('next skips phases with unmet deps; --all lists every executable', () => {
  runJson(['seed', planPath]);
  const all = runJson(['next', planPath, '--all']);
  // P1 and P4 have no deps; P2, P3 wait
  assert.deepEqual(all.phases.map(p => p.id), ['P1', 'P4']);
});

test('set updates status; done unlocks dependents', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  assert.match(readFileSync(todoPath, 'utf8'), /- \[in_progress\] plan-007 P1:/);
  runJson(['set', planPath, 'P1', 'done']);
  runJson(['set', planPath, 'P4', 'done']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P2');
});

test('set blocked cascades blocked-upstream transitively', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'blocked']);
  const todo = readFileSync(todoPath, 'utf8');
  assert.match(todo, /- \[blocked\] plan-007 P1:/);
  assert.match(todo, /- \[blocked-upstream\] plan-007 P2:/);
  assert.match(todo, /- \[blocked-upstream\] plan-007 P3:/);
  assert.match(todo, /- \[pending\] plan-007 P4:/); // independent branch untouched
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P4');
});

test('set plan-stale cascades like blocked', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P2', 'plan-stale']);
  const todo = readFileSync(todoPath, 'utf8');
  assert.match(todo, /- \[plan-stale\] plan-007 P2:/);
  assert.match(todo, /- \[blocked-upstream\] plan-007 P3:/);
  assert.match(todo, /- \[pending\] plan-007 P1:/); // upstream of stale phase untouched
});

test('next reports terminal state when nothing remains', () => {
  runJson(['seed', planPath]);
  for (const p of ['P1', 'P2', 'P3', 'P4']) runJson(['set', planPath, p, 'done']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase, null);
  assert.equal(out.all_terminal, true);
});

test('next distinguishes stuck graph from finished graph', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'blocked']);
  runJson(['set', planPath, 'P4', 'done']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase, null);
  assert.equal(out.all_terminal, true); // blocked/blocked-upstream are terminal
});

test('status reports counts and all_terminal', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'done']);
  const out = runJson(['status', planPath]);
  assert.equal(out.counts.done, 1);
  assert.equal(out.counts.pending, 3);
  assert.equal(out.all_terminal, false);
  assert.equal(out.total, 4);
});

test('invalid status rejected with non-zero exit', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['set', planPath, 'P1', 'finished'], { stdio: 'pipe' }));
});

test('set on unknown phase rejected with non-zero exit', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['set', planPath, 'P9', 'done'], { stdio: 'pipe' }));
});

test('in_progress-parallel accepted as batch status', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress-parallel']);
  assert.match(readFileSync(todoPath, 'utf8'), /- \[in_progress-parallel\] plan-007 P1:/);
  const out = runJson(['status', planPath]);
  assert.equal(out.all_terminal, false);
});

// --- escalation persistence ---

test('escalate writes escalated tags suffix onto the entry line', () => {
  runJson(['seed', planPath]);
  const out = runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  assert.equal(out.phase, 'P1');
  assert.deepEqual(out.escalated, { tier: 'senior', process: 'heavy' });
  assert.match(readFileSync(todoPath, 'utf8'),
    /- \[pending\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
});

test('next returns escalated tags overriding plan tags', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P1');
  assert.equal(out.phase.tier, 'senior'); // plan says junior
  assert.equal(out.phase.process, 'heavy'); // plan says light
  assert.deepEqual(out.phase.escalated, { tier: 'senior', process: 'heavy' });
});

test('escalate on a single axis leaves the other at its plan tag', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.tier, 'senior'); // overridden
  assert.equal(out.phase.process, 'light'); // plan default, not overridden
  assert.deepEqual(out.phase.escalated, { tier: 'senior' });
});

test('escalate merges successive bumps on the same phase', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  const out = runJson(['escalate', planPath, 'P1', '--process', 'heavy']);
  assert.deepEqual(out.escalated, { tier: 'senior', process: 'heavy' });
  assert.match(readFileSync(todoPath, 'utf8'),
    /- \[pending\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
});

test('escalate preserves the current status', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  assert.match(readFileSync(todoPath, 'utf8'),
    /- \[in_progress\] plan-007 P1: setup harness \{tier=senior\}/);
});

test('set status change preserves an existing escalated suffix', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  runJson(['set', planPath, 'P1', 'done']);
  assert.match(readFileSync(todoPath, 'utf8'),
    /- \[done\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
});

test('escalated suffix survives a blocked-upstream cascade on dependents', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P3', '--tier', 'senior']); // downstream of P2
  runJson(['set', planPath, 'P2', 'blocked']);
  const todo = readFileSync(todoPath, 'utf8');
  assert.match(todo, /- \[blocked-upstream\] plan-007 P3: docs \{tier=senior\}/);
});

test('escalate with no axis flags is rejected', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['escalate', planPath, 'P1'], { stdio: 'pipe' }));
});

test('escalate with invalid tier is rejected', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['escalate', planPath, 'P1', '--tier', 'wizard'], { stdio: 'pipe' }));
});

test('escalate with invalid process is rejected', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['escalate', planPath, 'P1', '--process', 'medium'], { stdio: 'pipe' }));
});

test('escalate on unknown phase is rejected', () => {
  runJson(['seed', planPath]);
  assert.throws(() => run(['escalate', planPath, 'P9', '--tier', 'senior'], { stdio: 'pipe' }));
});

test('escalated entries round-trip through status counts', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  const out = runJson(['status', planPath]);
  assert.equal(out.total, 4);
  assert.equal(out.counts.pending, 4);
});
