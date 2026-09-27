// Tests for forge-state.mjs — run: node --test skills/forge-run/scripts/
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

const PRD = `# PRD-007: demo

## User Stories
### US-1: a
- AC-1.1: Given x, When y, Then z
### US-2: b
- AC-2.1: Given x, When y, Then z
- AC-2.2: Given x, When y, Then z \`[manual-check]\`
### US-3: c
- AC-3.1: Given x, When y, Then z
### US-4: d
- AC-4.1: Given x, When y, Then z
`;

let dir, planPath, statePath, prdPath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forge-state-'));
  planPath = join(dir, 'plan-007.md');
  statePath = join(dir, 'plan-007.state.md');
  prdPath = join(dir, '007-demo.md');
  writeFileSync(planPath, PLAN);
  writeFileSync(prdPath, PRD);
});

// Runs with cwd = the temp dir so default paths (docs/forge/runs, docs/context)
// resolve inside it and never touch the repo.
function run(args, opts = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--state', statePath], {
    encoding: 'utf8', cwd: dir, ...opts,
  });
}
function runJson(args) {
  return JSON.parse(run(args));
}
// Expect a non-zero exit; return parsed stdout (if any) and stderr.
function runFail(args, { withState = true } = {}) {
  const extra = withState ? ['--state', statePath] : [];
  try {
    execFileSync(process.execPath, [SCRIPT, ...args, ...extra], { encoding: 'utf8', cwd: dir, stdio: 'pipe' });
  } catch (e) {
    return { code: e.status, stdout: e.stdout ? tryJson(e.stdout) : null, stderr: e.stderr ?? '' };
  }
  assert.fail(`expected non-zero exit for: ${args.join(' ')}`);
}
function tryJson(s) { try { return JSON.parse(s); } catch { return s; } }
function writePlan(text) { writeFileSync(planPath, text); }
const state = () => readFileSync(statePath, 'utf8');
// A two-phase plan where P2's depends_on value is parameterised.
const twoPhase = (dep, extra = '') => `# Plan-007: edge
${extra}
## Phases
### P1: base
- covers: AC-1.1
- depends_on: -
- tier: junior
- process: light
### P2: second
- covers: AC-2.1
- depends_on: ${dep}
- tier: junior
- process: light
`;

test('seed creates one pending entry per phase', () => {
  const out = runJson(['seed', planPath]);
  assert.equal(out.seeded, 4);
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness/);
  assert.match(state(), /- \[pending\] plan-007 P4: independent extra/);
});

test('seed is idempotent — second call seeds nothing, reports resume', () => {
  runJson(['seed', planPath]);
  const out2 = runJson(['seed', planPath]);
  assert.equal(out2.seeded, 0);
  assert.equal(out2.resume, true);
  assert.equal(state().match(/plan-007 P1:/g).length, 1);
});

test('seed preserves unrelated content in the state file', () => {
  writeFileSync(statePath, '# Todos\n- [ ] unrelated human todo\n');
  runJson(['seed', planPath]);
  assert.match(state(), /unrelated human todo/);
  assert.match(state(), /plan-007 P1:/);
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
  assert.match(state(), /- \[in_progress\] plan-007 P1:/);
  runJson(['set', planPath, 'P1', 'done']);
  runJson(['set', planPath, 'P4', 'done']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P2');
});

test('set blocked cascades blocked-upstream transitively', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'blocked']);
  assert.match(state(), /- \[blocked\] plan-007 P1:/);
  assert.match(state(), /- \[blocked-upstream\] plan-007 P2:/);
  assert.match(state(), /- \[blocked-upstream\] plan-007 P3:/);
  assert.match(state(), /- \[pending\] plan-007 P4:/); // independent branch untouched
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P4');
});

test('set plan-stale cascades like blocked', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P2', 'plan-stale']);
  assert.match(state(), /- \[plan-stale\] plan-007 P2:/);
  assert.match(state(), /- \[blocked-upstream\] plan-007 P3:/);
  assert.match(state(), /- \[pending\] plan-007 P1:/); // upstream of stale phase untouched
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
  assert.equal(out.stalled, false);
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
  assert.match(state(), /- \[in_progress-parallel\] plan-007 P1:/);
  const out = runJson(['status', planPath]);
  assert.equal(out.all_terminal, false);
});

// --- escalation persistence ---

test('escalate writes escalated tags suffix onto the entry line', () => {
  runJson(['seed', planPath]);
  const out = runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  assert.equal(out.phase, 'P1');
  assert.deepEqual(out.escalated, { tier: 'senior', process: 'heavy' });
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
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
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
});

test('escalate preserves the current status', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  assert.match(state(), /- \[in_progress\] plan-007 P1: setup harness \{tier=senior\}/);
});

test('set status change preserves an existing escalated suffix', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior', '--process', 'heavy']);
  runJson(['set', planPath, 'P1', 'done']);
  assert.match(state(), /- \[done\] plan-007 P1: setup harness \{tier=senior process=heavy\}/);
});

test('escalated suffix survives a blocked-upstream cascade on dependents', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P3', '--tier', 'senior']); // downstream of P2
  runJson(['set', planPath, 'P2', 'blocked']);
  assert.match(state(), /- \[blocked-upstream\] plan-007 P3: docs \{tier=senior\}/);
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

test('escalate refuses a de-escalation (UP only)', () => {
  runJson(['seed', planPath]);
  const r = runFail(['escalate', planPath, 'P2', '--tier', 'junior']); // P2 is senior in the plan
  assert.match(r.stderr, /not an escalation/);
});

test('escalate refuses a no-op bump to the current tag', () => {
  runJson(['seed', planPath]);
  const r = runFail(['escalate', planPath, 'P2', '--process', 'heavy']); // P2 already heavy
  assert.match(r.stderr, /not an escalation/);
});

// --- lint: plan validated by code, not by reasoning ---

test('lint passes a well-formed plan', () => {
  const out = runJson(['lint', planPath]);
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
});

test('lint with --prd passes when every PRD AC is covered exactly once', () => {
  const out = runJson(['lint', planPath, '--prd', prdPath]);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
});

test('lint --prd flags an orphan AC (in PRD, covered by no phase)', () => {
  writeFileSync(prdPath, PRD + '- AC-4.2: Given x, When y, Then z\n');
  const r = runFail(['lint', planPath, '--prd', prdPath]);
  assert.equal(r.stdout.ok, false);
  assert.ok(r.stdout.errors.some(e => /AC-4\.2/.test(e) && /orphan/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint --prd flags a covered AC the PRD does not define', () => {
  writeFileSync(prdPath, PRD.replace('- AC-4.1: Given x, When y, Then z\n', ''));
  const r = runFail(['lint', planPath, '--prd', prdPath]);
  assert.ok(r.stdout.errors.some(e => /AC-4\.1/.test(e) && /not in the PRD/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags an AC covered by two phases', () => {
  writePlan(PLAN.replace('- covers: AC-4.1', '- covers: AC-4.1, AC-1.1'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /AC-1\.1/.test(e) && /more than one phase/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a dependency on a phase that does not exist', () => {
  writePlan(twoPhase('P7'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /P2/.test(e) && /P7/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a dependency cycle', () => {
  writePlan(twoPhase('P1').replace('- depends_on: -', '- depends_on: P2'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /cycle/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a phase missing a required field', () => {
  writePlan(twoPhase('P1').replace('- tier: junior\n- process: light\n### P2', '- process: light\n### P2'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /P1/.test(e) && /tier/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags an invalid tier value', () => {
  writePlan(twoPhase('P1').replace('- tier: junior\n- process: light\n### P2', '- tier: wizard\n- process: light\n### P2'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /wizard/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a duplicate phase id', () => {
  writePlan(PLAN.replace('### P4: independent extra', '### P3: independent extra'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /duplicate/.test(e) && /P3/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags max_parallel > 1 without Parallel Groups', () => {
  writePlan(PLAN.replace('- K: 3', '- K: 3\n- max_parallel: 2'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /max_parallel/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a parallel group whose members depend on each other', () => {
  writePlan(PLAN.replace('- K: 3', '- K: 3\n- max_parallel: 2') +
    '\n## Parallel Groups\n- group-1: P1, P3   # P3 depends on P1 via P2\n');
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /group-1/.test(e) && /P1/.test(e) && /P3/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint flags a parallel group naming an unknown phase', () => {
  writePlan(PLAN.replace('- K: 3', '- K: 3\n- max_parallel: 2') + '\n## Parallel Groups\n- group-1: P1, P9\n');
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /group-1/.test(e) && /P9/.test(e)), JSON.stringify(r.stdout.errors));
});

test('lint accepts independent parallel group members', () => {
  writePlan(PLAN.replace('- K: 3', '- K: 3\n- max_parallel: 2') + '\n## Parallel Groups\n- group-1: P1, P4\n');
  const out = runJson(['lint', planPath]);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
});

test('seed refuses a plan that fails lint and writes no state', () => {
  writePlan(twoPhase('P7'));
  const r = runFail(['seed', planPath]);
  assert.match(r.stderr, /lint/);
  assert.equal(existsSync(statePath), false);
});

// --- tolerant parsing of LLM-typical plan formatting ---

for (const noDep of ['—', '–', 'none', 'None', 'n/a', '(none)']) {
  test(`depends_on "${noDep}" means no dependencies`, () => {
    writePlan(twoPhase(noDep));
    runJson(['seed', planPath]);
    const all = runJson(['next', planPath, '--all']);
    assert.deepEqual(all.phases.map(p => p.id), ['P1', 'P2']);
  });
}

test('bold field keys are parsed, so dependencies are not silently dropped', () => {
  writePlan(twoPhase('P1').replace('- depends_on: P1', '- **depends_on:** P1'));
  runJson(['seed', planPath]);
  const all = runJson(['next', planPath, '--all']);
  assert.deepEqual(all.phases.map(p => p.id), ['P1']);
});

test('backticked dependency ids are parsed', () => {
  writePlan(twoPhase('`P1`'));
  runJson(['seed', planPath]);
  assert.deepEqual(runJson(['next', planPath, '--all']).phases.map(p => p.id), ['P1']);
  runJson(['set', planPath, 'P1', 'done']);
  assert.equal(runJson(['next', planPath]).phase.id, 'P2'); // dep resolves to P1, not "`P1`"
});

test('P0 is an ordinary plan phase', () => {
  writePlan(twoPhase('P0').replace('### P1: base', '### P0: setup test harness\n- covers: -\n- depends_on: -\n- tier: junior\n- process: light\n### P1: base'));
  runJson(['seed', planPath]);
  assert.equal(runJson(['next', planPath]).phase.id, 'P0');
  runJson(['set', planPath, 'P0', 'done']);
  assert.match(state(), /- \[done\] plan-007 P0: setup test harness/);
});

// --- crash recovery ---

test('seed on resume reports in-flight phases', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  const out = runJson(['seed', planPath]);
  assert.equal(out.resume, true);
  assert.deepEqual(out.in_flight, ['P1']);
});

test('recover returns in-flight phases to pending, keeping their suffix', () => {
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  runJson(['set', planPath, 'P1', 'in_progress']);
  runJson(['set', planPath, 'P4', 'in_progress-parallel']);
  const out = runJson(['recover', planPath]);
  assert.deepEqual(out.recovered, ['P1', 'P4']);
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness \{tier=senior\}/);
  assert.equal(runJson(['next', planPath]).phase.id, 'P1');
});

test('next reports in-flight work when nothing else is executable', () => {
  writePlan(twoPhase('P1'));
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase, null);
  assert.deepEqual(out.in_flight, ['P1']);
  assert.equal(out.stalled, false);
});

test('next reports a stalled graph instead of waiting forever', () => {
  writePlan(twoPhase('P1'));
  runJson(['seed', planPath]);
  // simulate an external edit (e.g. a context compaction) deleting P1's entry
  writeFileSync(statePath, state().split('\n').filter(l => !/ P1: /.test(l)).join('\n'));
  const out = runJson(['next', planPath]);
  assert.equal(out.phase, null);
  assert.equal(out.stalled, true);
  assert.ok(out.waiting.some(w => w.id === 'P2' && w.unmet.includes('P1')), JSON.stringify(out.waiting));
});

// --- red iterations: K and the escalation rule executed, not reasoned ---

test('red increments iter and persists it on the entry', () => {
  runJson(['seed', planPath]);
  const out = runJson(['red', planPath, 'P1']);
  assert.equal(out.iter, 1);
  assert.equal(out.K, 3);
  assert.equal(out.decision, 'retry');
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness \{iter=1\}/);
});

test('red at K on junior decides escalate with a tier bump', () => {
  runJson(['seed', planPath]);
  runJson(['red', planPath, 'P1']);
  runJson(['red', planPath, 'P1']);
  const out = runJson(['red', planPath, 'P1']);
  assert.equal(out.iter, 3);
  assert.equal(out.decision, 'escalate');
  assert.deepEqual(out.bump, { tier: 'senior' });
});

test('escalate resets iter; the next K reds bump process', () => {
  runJson(['seed', planPath]);
  for (let i = 0; i < 3; i++) runJson(['red', planPath, 'P1']);
  runJson(['escalate', planPath, 'P1', '--tier', 'senior']);
  assert.match(state(), /- \[pending\] plan-007 P1: setup harness \{tier=senior\}/);
  let out;
  for (let i = 0; i < 3; i++) out = runJson(['red', planPath, 'P1']);
  assert.equal(out.decision, 'escalate');
  assert.deepEqual(out.bump, { process: 'heavy' });
});

test('red at K on senior+heavy decides block', () => {
  runJson(['seed', planPath]);
  let out;
  for (let i = 0; i < 3; i++) out = runJson(['red', planPath, 'P2']); // P2 is senior+heavy
  assert.equal(out.decision, 'block');
  assert.equal(out.bump, undefined);
});

test('red reads K from Run Config', () => {
  writePlan(PLAN.replace('- K: 3', '- K: 2  # tighter'));
  runJson(['seed', planPath]);
  runJson(['red', planPath, 'P1']);
  const out = runJson(['red', planPath, 'P1']);
  assert.equal(out.K, 2);
  assert.equal(out.decision, 'escalate');
});

test('iter survives resume: next echoes it after recover', () => {
  runJson(['seed', planPath]);
  runJson(['set', planPath, 'P1', 'in_progress']);
  runJson(['red', planPath, 'P1']);
  runJson(['recover', planPath]);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase.id, 'P1');
  assert.equal(out.phase.iter, 1);
  assert.equal(out.phase.escalated, undefined); // iter is not an escalation
});

// --- state location: forge-owned file, scaffold todo.md holds only a pointer ---

test('default state file lives under docs/forge/runs/', () => {
  execFileSync(process.execPath, [SCRIPT, 'seed', planPath], { encoding: 'utf8', cwd: dir });
  assert.ok(existsSync(join(dir, 'docs/forge/runs/plan-007.state.md')));
});

test('--todo is still accepted as an alias for --state', () => {
  const legacy = join(dir, 'legacy-todo.md');
  execFileSync(process.execPath, [SCRIPT, 'seed', planPath, '--todo', legacy], { encoding: 'utf8', cwd: dir });
  assert.match(readFileSync(legacy, 'utf8'), /- \[pending\] plan-007 P1:/);
});

test('legacy --todo docs/context/todo.md keeps state there and adds no pointer to itself', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, '# Todo\n');
  execFileSync(process.execPath, [SCRIPT, 'seed', planPath, '--todo', 'docs/context/todo.md'], { encoding: 'utf8', cwd: dir });
  const text = readFileSync(ctx, 'utf8');
  assert.match(text, /- \[pending\] plan-007 P1:/);
  assert.doesNotMatch(text, /forge run plan-007/);
});

test('seed adds one pointer line to scaffold todo.md when it exists', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, '# Todo\n');
  runJson(['seed', planPath]);
  runJson(['seed', planPath]);
  const lines = readFileSync(ctx, 'utf8').split('\n').filter(l => /forge run plan-007/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- \[ \] \[in_progress\] forge run plan-007 -> .*plan-007\.state\.md \(forge-state\)$/);
});

test('seed does not create scaffold todo.md when absent', () => {
  runJson(['seed', planPath]);
  assert.equal(existsSync(join(dir, 'docs/context/todo.md')), false);
});

test('pointer is removed once every phase is terminal', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, '# Todo\n- [ ] [pending] other work\n');
  runJson(['seed', planPath]);
  assert.match(readFileSync(ctx, 'utf8'), /forge run plan-007/);
  for (const p of ['P1', 'P2', 'P3']) runJson(['set', planPath, p, 'done']);
  assert.match(readFileSync(ctx, 'utf8'), /forge run plan-007/); // P4 still pending
  runJson(['set', planPath, 'P4', 'done']);
  const text = readFileSync(ctx, 'utf8');
  assert.doesNotMatch(text, /forge run plan-007/);
  assert.match(text, /other work/);
});

test('seed migrates legacy entries out of scaffold todo.md', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, [
    '# Todo',
    '- [ ] [pending] other work',
    '- [done] plan-007 P1: setup harness {tier=senior}',
    '- [pending] plan-007 P2: core module',
    '- [pending] plan-007 P3: docs',
    '- [pending] plan-007 P4: independent extra',
    '',
  ].join('\n'));
  const out = runJson(['seed', planPath]);
  assert.equal(out.migrated, 4);
  assert.equal(out.resume, true);
  assert.match(state(), /- \[done\] plan-007 P1: setup harness \{tier=senior\}/);
  const ctxText = readFileSync(ctx, 'utf8');
  assert.doesNotMatch(ctxText, /- \[done\] plan-007 P1/);
  assert.match(ctxText, /other work/);
  assert.equal(runJson(['next', planPath]).phase.id, 'P2');
});

// --- hygiene: line endings, ASCII-only console output ---

test('CRLF line endings in scaffold todo.md are preserved', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, '# Todo\r\n- [ ] [pending] other work\r\n');
  runJson(['seed', planPath]);
  const text = readFileSync(ctx, 'utf8');
  assert.match(text, /forge run plan-007/);
  assert.equal(/[^\r]\n/.test(text), false, 'found a bare LF');
});

test('CRLF line endings in the state file are preserved on rewrite', () => {
  runJson(['seed', planPath]);
  writeFileSync(statePath, state().replace(/\n/g, '\r\n'));
  runJson(['set', planPath, 'P1', 'done']);
  assert.equal(/[^\r]\n/.test(state()), false, 'found a bare LF');
});

test('stdout is ASCII-only even for non-ASCII phase names', () => {
  writePlan(PLAN.replace('### P1: setup harness', '### P1: configuración inicial'));
  run(['seed', planPath]);
  const raw = run(['next', planPath]);
  assert.match(raw, /^[\x00-\x7f]*$/);
  assert.equal(JSON.parse(raw).phase.name, 'configuración inicial');
});

test('error messages are ASCII-only', () => {
  runJson(['seed', planPath]);
  const r = runFail(['set', planPath, 'P1', 'terminadó']); // message echoes the bad status
  assert.match(r.stderr, /invalid status "terminad\\u00f3"/);
  assert.match(r.stderr, /^[\x00-\x7f]*$/);
});

// --- review fixes ---

test('seed on a finished run does not restore the todo.md pointer', () => {
  mkdirSync(join(dir, 'docs/context'), { recursive: true });
  const ctx = join(dir, 'docs/context/todo.md');
  writeFileSync(ctx, '# Todo\n');
  runJson(['seed', planPath]);
  for (const p of ['P1', 'P2', 'P3', 'P4']) runJson(['set', planPath, p, 'done']);
  runJson(['seed', planPath]); // e.g. a /loop re-invocation after the run ended
  assert.doesNotMatch(readFileSync(ctx, 'utf8'), /forge run plan-007/);
});

test('parallel-group problems are warnings while max_parallel is 1', () => {
  writePlan(PLAN + '\n## Parallel Groups\n- group-1: P2, P9   # example, delete or replace\n');
  const out = runJson(['lint', planPath]);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.ok(out.warnings.some(w => /group-1/.test(w)), JSON.stringify(out.warnings));
});

test('lint separates state-breaking graph errors from contract errors', () => {
  writePlan(PLAN.replace('- covers: AC-4.1', '- covers: AC-4.1, AC-1.1'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.length > 0);
  assert.deepEqual(r.stdout.graph_errors, []);
  writePlan(twoPhase('P7'));
  const r2 = runFail(['lint', planPath]);
  assert.ok(r2.stdout.graph_errors.some(e => /P7/.test(e)), JSON.stringify(r2.stdout));
});

test('seed resumes a plan whose only lint errors are contract errors', () => {
  runJson(['seed', planPath]);
  writePlan(PLAN.replace('- covers: AC-4.1', '- covers: AC-4.1, AC-1.1'));
  const out = runJson(['seed', planPath]);
  assert.equal(out.resume, true);
});

const dropLine = re => writeFileSync(statePath, state().split('\n').filter(l => !re.test(l)).join('\n'));

test('a plan phase with no state entry is not terminal and is reported missing', () => {
  runJson(['seed', planPath]);
  for (const p of ['P1', 'P2', 'P3']) runJson(['set', planPath, p, 'done']);
  dropLine(/ P4: /);
  const out = runJson(['next', planPath]);
  assert.equal(out.phase, null);
  assert.equal(out.all_terminal, false);
  assert.deepEqual(out.missing, ['P4']);
  assert.equal(runJson(['status', planPath]).all_terminal, false);
  assert.deepEqual(runJson(['seed', planPath]).missing, ['P4']);
});

test('set creates the entry for a plan phase that has none', () => {
  runJson(['seed', planPath]);
  dropLine(/ P1: /);
  runJson(['set', planPath, 'P1', 'done']);
  assert.match(state(), /- \[done\] plan-007 P1: setup harness/);
  assert.equal(runJson(['next', planPath]).phase.id, 'P2');
});

test('red on an entry whose phase is not in the plan fails cleanly', () => {
  runJson(['seed', planPath]);
  writeFileSync(statePath, state() + '- [pending] plan-007 P9: ghost\n');
  const r = runFail(['red', planPath, 'P9']);
  assert.match(r.stderr, /not in the plan/);
  assert.doesNotMatch(r.stderr, /TypeError/);
});

test('lint flags a phase heading it cannot parse, and seed refuses it', () => {
  writePlan(PLAN.replace('### P4: independent extra', '### P4 — independent extra'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.graph_errors.some(e => /P4/.test(e) && /heading/.test(e)), JSON.stringify(r.stdout));
  assert.match(runFail(['seed', planPath]).stderr, /lint/);
});

test('Run Config heading variants are recognised', () => {
  writePlan(PLAN.replace('## Run Config', '## Run Config (frozen)').replace('- K: 3', '- K: 2'));
  runJson(['seed', planPath]);
  runJson(['red', planPath, 'P1']);
  assert.equal(runJson(['red', planPath, 'P1']).decision, 'escalate');
});

test('K defaults to 3 when Run Config omits it', () => {
  writePlan(twoPhase('P1'));
  runJson(['seed', planPath]);
  assert.equal(runJson(['red', planPath, 'P1']).K, 3);
});

test('lint flags a non-integer K', () => {
  writePlan(PLAN.replace('- K: 3', '- K: three'));
  const r = runFail(['lint', planPath]);
  assert.ok(r.stdout.errors.some(e => /\bK\b/.test(e) && /three/.test(e)), JSON.stringify(r.stdout.errors));
});

test('bold "**key**: value" form is parsed too', () => {
  writePlan(twoPhase('P1').replace('- depends_on: P1', '- **depends_on**: P1'));
  runJson(['seed', planPath]);
  assert.deepEqual(runJson(['next', planPath, '--all']).phases.map(p => p.id), ['P1']);
});

test('nested sub-bullets do not override phase fields', () => {
  writePlan(twoPhase('P1').replace('- process: light\n### P2',
    '- process: light\n- notes: maybe later\n  - process: heavy (maybe later)\n### P2'));
  runJson(['seed', planPath]);
  assert.equal(runJson(['next', planPath]).phase.process, 'light');
});

test('phase names ending in braces keep them through rewrites', () => {
  writePlan(PLAN.replace('### P3: docs', '### P3: docs {beta}'));
  runJson(['seed', planPath]);
  runJson(['escalate', planPath, 'P3', '--tier', 'senior']);
  runJson(['set', planPath, 'P3', 'done']);
  assert.match(state(), /- \[done\] plan-007 P3: docs \{beta\} \{tier=senior\}/);
});
