// Temp-git-repo tests for forge-state verify and forge-git.mjs.
// Run: node --test skills/forge-run/scripts/forge-state.git.test.mjs
// Every git call runs in a throwaway repo under os.tmpdir() with its own
// identity and an env stripped of inherited GIT_* vars, so nothing can leak
// into the repository that hosts these tests.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'forge-state.mjs');

const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'])
  delete ENV[k];

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, env: ENV, encoding: 'utf8' }).trim();
const write = (rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const commitAll = msg => {
  git('add', '-A');
  // No signing and no hooks: a user's global git config must not affect the fixture.
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${join(repo, '.git', 'no-hooks')}`, 'commit', '-q', '-m', msg);
};

const PLAN_PATH = 'docs/forge/plans/plan-007.md';
const STATE_PATH = 'docs/forge/runs/plan-007.state.md';
const PRD_PATH = 'docs/forge/prd/007-demo.md';

const plan = gatesLine => `# Plan-007: demo

## Run Config
- mode: autonomous
${gatesLine}
- K: 3

## Phases

### P1: core
- covers: AC-1.1, AC-1.2
- depends_on: -
- tier: senior
- process: heavy
- success: covered ACs green
- notes: none
`;

const PRD = `# PRD-007: demo

## User Stories
### US-1: a
- AC-1.1: Given x, When y, Then z
- AC-1.2: Given an AC not tagged \`[manual-check]\` in the text, When y, Then z
- AC-1.3: Given x, When y, Then z \`[manual-check]\`
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'forge-git-'));
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  write('src/app.js', 'module.exports = 1;\n');
  commitAll('init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

// Seed a plan inside the temp repo (its docs/forge, never this repo's).
function seed(gatesLine = '- gates: node -e "process.exit(0)"') {
  write(PLAN_PATH, plan(gatesLine));
  write(PRD_PATH, PRD);
  cli(['seed', PLAN_PATH]);
}
function cli(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args, '--state', STATE_PATH], {
    cwd: repo, env: ENV, encoding: 'utf8', stdio: 'pipe',
  });
}
const cliJson = args => JSON.parse(cli(args));
function cliFail(args) {
  try { cli(args); } catch (e) { return { code: e.status, stdout: e.stdout, stderr: e.stderr }; }
  assert.fail(`expected non-zero exit for: ${args.join(' ')}`);
}
const stateLine = () => readFileSync(join(repo, STATE_PATH), 'utf8').split(/\r?\n/).find(l => / P1: /.test(l));
const headTree = () => git('rev-parse', 'HEAD^{tree}');

// --- AC-2.3: verify runs the gates over an identified snapshot and persists it ---

test('AC-2.3 verify runs passing gates, prints JSON and persists verify=pass:<snapshot>', () => {
  seed();
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.plan, 'plan-007');
  assert.equal(r.phase, 'P1');
  assert.equal(r.exit_code, 0);
  assert.equal(r.pass, true);
  assert.match(r.snapshot, /^[0-9a-f]{40}$/);
  assert.equal(r.gates, 'node -e "process.exit(0)"');
  assert.ok(['bash', 'default'].includes(r.shell), r.shell);
  assert.deepEqual(r.untested_acs, []);
  assert.equal(typeof r.tail, 'string');
  // docs/forge is excluded: the code snapshot is exactly the committed code tree.
  assert.equal(r.snapshot, headTree());
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=pass:${r.snapshot}}`);
});

test('AC-2.3 verify with failing gates exits 0 and persists verify=fail', () => {
  seed('- gates: node -e "console.log(\'boom\'); process.exit(3)"');
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.exit_code, 3);
  assert.equal(r.pass, false);
  assert.match(r.tail, /boom/);
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=fail:${r.snapshot}}`);
});

test('AC-2.3 verify runs gates in the current directory', () => {
  seed('- gates: node -e "process.exit(require(\'fs\').existsSync(\'src/app.js\') ? 0 : 9)"');
  assert.equal(cliJson(['verify', PLAN_PATH, 'P1']).exit_code, 0);
});

test('AC-2.3 verify executes the raw gates command, not the lint-cleaned value', () => {
  // clean() strips every * and everything after #: both would break this command.
  seed('- gates: node -e "process.exit(6*0 + \'#\'.length - 1)"   # REQUIRED. trailing comment');
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.gates, 'node -e "process.exit(6*0 + \'#\'.length - 1)"');
  assert.equal(r.exit_code, 0, r.tail);
});

test('AC-2.3 snapshot ignores docs/forge and docs/context but tracks code changes', () => {
  seed();
  const a = cliJson(['verify', PLAN_PATH, 'P1']).snapshot;
  write('docs/context/memory.md', 'note\n');
  write('docs/forge/runs/extra.md', 'x\n');
  const b = cliJson(['verify', PLAN_PATH, 'P1']).snapshot;
  assert.equal(b, a);
  write('src/app.js', 'module.exports = 2;\n');
  const c = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.notEqual(c.snapshot, a);
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=pass:${c.snapshot}}`);
});

test('AC-2.3 snapshot is taken before the gates run (gate artifacts do not count)', () => {
  seed('- gates: node -e "require(\'fs\').writeFileSync(\'coverage.txt\', \'x\')"');
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.snapshot, headTree());
});

test('AC-2.3 verify keeps the status and earlier suffix tokens, replacing its own', () => {
  seed('- gates: node -e "process.exit(1)"');
  cli(['set', PLAN_PATH, 'P1', 'in_progress']);
  cli(['red', PLAN_PATH, 'P1']);
  const a = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(stateLine(), `- [in_progress] plan-007 P1: core {iter=1 verify=fail:${a.snapshot}}`);
  write('src/app.js', 'module.exports = 3;\n');
  const b = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(stateLine(), `- [in_progress] plan-007 P1: core {iter=1 verify=fail:${b.snapshot}}`);
  // the suffix still round-trips through the other commands
  cli(['red', PLAN_PATH, 'P1']);
  assert.equal(stateLine(), `- [in_progress] plan-007 P1: core {iter=2 verify=fail:${b.snapshot}}`);
  assert.equal(cliJson(['status', PLAN_PATH]).counts.in_progress, 1);
});

test('AC-2.3 plan without gates and no --gates exits 1 with the usage message', () => {
  seed('');
  const r = cliFail(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /plan has no gates: pass --gates "<cmd>"/);
  assert.equal(stateLine(), '- [pending] plan-007 P1: core');
});

test('AC-2.3 plan without gates runs --gates and records it with the result', () => {
  seed('');
  const r = cliJson(['verify', PLAN_PATH, 'P1', '--gates', 'node -e "process.exit(0)"']);
  assert.equal(r.gates, 'node -e "process.exit(0)"');
  assert.equal(r.pass, true);
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=pass:${r.snapshot}}`);
});

test('AC-2.3 placeholder gates counts as missing', () => {
  seed('- gates: <one bash command>');
  assert.match(cliFail(['verify', PLAN_PATH, 'P1']).stderr, /plan has no gates/);
});

test('AC-2.3 tail carries the last 40 output lines', () => {
  seed('- gates: node -e "for (let i = 1; i <= 50; i++) console.log(\'line\' + i)"');
  const lines = cliJson(['verify', PLAN_PATH, 'P1']).tail.split('\n').filter(Boolean);
  assert.equal(lines.length, 40);
  assert.equal(lines[0], 'line11');
  assert.equal(lines.at(-1), 'line50');
});

test('AC-2.3 verify for an unknown phase exits 1', () => {
  seed();
  assert.equal(cliFail(['verify', PLAN_PATH, 'P9']).code, 1);
});

test('AC-2.3 --gates cannot replace a plan\'s frozen gates', () => {
  seed();
  const r = cliFail(['verify', PLAN_PATH, 'P1', '--gates', 'true']);
  assert.match(r.stderr, /--gates is only for plans without gates/);
  assert.equal(stateLine(), '- [pending] plan-007 P1: core');
});

test('AC-2.3 verify outside a git work tree exits 1 and persists nothing', () => {
  const bare = mkdtempSync(join(tmpdir(), 'forge-nogit-'));
  try {
    writeFileSync(join(bare, 'plan-007.md'), plan('- gates: node -e "process.exit(0)"'));
    const run = a => execFileSync(process.execPath, [SCRIPT, ...a, '--state', 'state.md'],
      { cwd: bare, env: { ...ENV, GIT_CEILING_DIRECTORIES: dirname(bare) }, encoding: 'utf8', stdio: 'pipe' });
    run(['seed', 'plan-007.md']);
    assert.throws(() => run(['verify', 'plan-007.md', 'P1']), e => e.status === 1 && /git work tree/.test(e.stderr));
    assert.equal(readFileSync(join(bare, 'state.md'), 'utf8').trim(), '- [pending] plan-007 P1: core');
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

// --- forge-git.mjs helpers ---

const gitMod = await import('./forge-git.mjs');
const { snapshotWorktree, snapshotHead, diffSnapshots, runGates, resolveBash } = gitMod;

test('snapshotWorktree never touches the real index', () => {
  write('src/new.js', 'x\n');
  const index = join(repo, '.git', 'index');
  const before = readFileSync(index);
  snapshotWorktree(repo);
  assert.deepEqual(readFileSync(index), before);
  assert.equal(git('status', '--porcelain'), '?? src/new.js');
});

test('snapshotWorktree equals HEAD on a clean tree and includes untracked, non-ignored files', () => {
  assert.equal(snapshotWorktree(repo), snapshotHead(repo));
  assert.equal(snapshotHead(repo), headTree());
  write('src/new.js', 'x\n');
  const s = snapshotWorktree(repo);
  assert.deepEqual(diffSnapshots(repo, snapshotHead(repo), s), ['src/new.js']);
});

test('snapshotWorktree ignores gitignored files', () => {
  write('.gitignore', 'build/\n');
  commitAll('ignore');
  write('build/out.js', 'x\n');
  assert.equal(snapshotWorktree(repo), snapshotHead(repo));
});

test('snapshots exclude docs/forge and docs/context only, even when committed', () => {
  write('docs/forge/runs/a.md', 'a\n');
  write('docs/context/memory.md', 'm\n');
  commitAll('docs');
  assert.equal(snapshotHead(repo), snapshotWorktree(repo));
  assert.notEqual(snapshotHead(repo), headTree());
  write('docs/guide.md', 'g\n');
  assert.deepEqual(diffSnapshots(repo, snapshotHead(repo), snapshotWorktree(repo)), ['docs/guide.md']);
});

test('snapshotWorktree is CRLF-safe under core.autocrlf', () => {
  git('config', 'core.autocrlf', 'true');
  write('src/crlf.js', 'a\r\nb\r\n');
  commitAll('crlf');
  write('src/crlf.js', 'a\r\nb\r\n');   // rewritten: stat changes, content normalizes the same
  assert.equal(snapshotWorktree(repo), snapshotHead(repo));
});

test('snapshotWorktree works from a subdirectory and ignores an inherited GIT_INDEX_FILE', () => {
  const expected = snapshotWorktree(repo);
  const saved = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = join(repo, 'bogus-index');
  try {
    assert.equal(snapshotWorktree(join(repo, 'src')), expected);
  } finally {
    if (saved === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = saved;
  }
});

test('runGates runs bash syntax, interleaves stdout/stderr in the tail, returns the exit code', () => {
  const r = runGates('[[ 1 == 1 ]] && echo out; echo err 1>&2; exit 4', repo);
  assert.equal(r.shell, 'bash');
  assert.equal(r.exit_code, 4);
  assert.equal(r.tail, 'out\nerr');
});

test('runGates falls back to the platform shell when bash is missing', () => {
  for (const bash of ['no-such-bash-forge-xyz', null]) {
    const r = runGates('node -e "process.exit(5)"', repo, { bash });
    assert.equal(r.shell, 'default');
    assert.equal(r.exit_code, 5);
  }
});

test('resolveBash prefers Git for Windows bash and never picks the WSL shim', () => {
  const have = paths => p => paths.includes(p);
  // Pure path logic (win32 semantics on any host): runs without WSL or Git Bash present.
  const execPath = 'C:/Program Files/Git/mingw64/libexec/git-core';   // `git --exec-path` output
  const gitBash = String.raw`C:\Program Files\Git\bin\bash.exe`;
  const wsl = String.raw`C:\Windows\System32\bash.exe`;
  const apps = String.raw`C:\Users\u\AppData\Local\Microsoft\WindowsApps`;
  const winPath = [String.raw`C:\Windows\System32`, apps].join(';');
  const opts = { platform: 'win32', systemRoot: String.raw`C:\Windows`, pathEnv: winPath };
  assert.equal(resolveBash({ ...opts, gitExecPath: execPath, exists: have([wsl, gitBash]) }), gitBash);
  assert.equal(resolveBash({ ...opts, gitExecPath: execPath, exists: have([wsl]) }), null);
  assert.equal(resolveBash({ ...opts, exists: have([wsl, `${apps}\\bash.exe`]) }), null);
  const msys = String.raw`C:\msys64\usr\bin`;
  assert.equal(resolveBash({ ...opts, pathEnv: `${winPath};${msys}`, exists: have([wsl, `${msys}\\bash.exe`]) }),
    `${msys}\\bash.exe`);
  assert.equal(resolveBash({ platform: 'linux' }), 'bash');
});

// --- AC-2.6: covered ACs must trace to a repository file ---

test('AC-2.6 verify --prd fails when a covered AC has no test file, even with green gates', () => {
  seed();
  const r = cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]);
  assert.equal(r.exit_code, 0);
  assert.deepEqual(r.untested_acs, ['AC-1.1', 'AC-1.2']);
  assert.equal(r.pass, false);
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=fail:${r.snapshot}}`);
});

test('AC-2.6 verify --prd passes once each covered AC appears as AC-x.y, AC_x_y or ac_x_y', () => {
  seed();
  write('test/one.test.js', "test('AC-1.1 does x', () => {});\n");
  assert.deepEqual(cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]).untested_acs, ['AC-1.2']);
  for (const form of ['AC_1_2', 'ac_1_2']) {
    write('test/two.test.js', `function ${form}_case() {}\n`);
    const r = cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]);
    assert.deepEqual(r.untested_acs, [], form);
    assert.equal(r.pass, true);
  }
});

test('AC-2.6 IDs only under docs/, node_modules/ or gitignored paths do not count', () => {
  seed();
  write('docs/notes.md', 'AC-1.1 AC-1.2\n');
  write('node_modules/x/index.js', '// AC-1.1 AC-1.2\n');
  write('pkg/node_modules/y.js', '// AC-1.1 AC-1.2\n');
  write('.gitignore', 'out/\n');
  write('out/a.test.js', '// AC-1.1 AC-1.2\n');
  assert.deepEqual(cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]).untested_acs, ['AC-1.1', 'AC-1.2']);
});

test('AC-2.6 AC-1.1 is not matched by AC-1.10 or a longer word', () => {
  seed();
  write('test/a.test.js', '// AC-1.10 xAC-1.2 ac-1_10\n');
  assert.deepEqual(cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]).untested_acs, ['AC-1.1', 'AC-1.2']);
});

test('AC-2.6 [manual-check] ACs are never required to have a test', () => {
  seed();
  write(PLAN_PATH, plan('- gates: node -e "process.exit(0)"').replace('AC-1.1, AC-1.2', 'AC-1.3'));
  const r = cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]);
  assert.deepEqual(r.untested_acs, []);
  assert.equal(r.pass, true);
});

test('AC-2.6 without --prd no AC trace is computed', () => {
  seed();
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.deepEqual(r.untested_acs, []);
  assert.equal(r.pass, true);
});

test('AC-2.6 findUntestedAcs skips binary (NUL) and over-1-MiB files', () => {
  const { findUntestedAcs } = gitMod;
  write('bin/blob.dat', 'AC-1.1\0binary');
  write('big/huge.txt', 'AC-1.2 ' + 'x'.repeat(1024 * 1024));
  assert.deepEqual(findUntestedAcs(repo, ['AC-1.1', 'AC-1.2']), ['AC-1.1', 'AC-1.2']);
  write('src/ok.test.js', '// AC-1.1 ac_1_2\n');
  assert.deepEqual(findUntestedAcs(join(repo, 'src'), ['AC-1.1', 'AC-1.2']), []);
});

// --- review red 1 ---

test('AC-2.6 the references/tdd.md naming test_AC_x_y_... (and pytest test_ac_x_y_...) counts', () => {
  seed();
  write('tests/test_core.py', 'def test_AC_1_1_rejects_x():\n    pass\n\ndef test_ac_1_2_accepts_y():\n    pass\n');
  const r = cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]);
  assert.deepEqual(r.untested_acs, []);
  assert.equal(r.pass, true);
});

test('AC-2.6 an AC ID glued to a preceding letter or digit, or a longer minor, does not count', () => {
  seed();
  write('tests/test_core.py', '# xAC-1.1 MAC_1_1 2ac_1_1 AC-1.10 ac_1_12\n');
  assert.deepEqual(cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]).untested_acs, ['AC-1.1', 'AC-1.2']);
});

test('AC-2.3/AC-2.6 verify survives git output over 1 MiB (many paths, CRLF warnings)', () => {
  seed();
  git('config', 'core.autocrlf', 'true');
  // ~6000 long names: `ls-files -z` stdout and `add -A` CRLF warnings both exceed 1 MiB.
  const pad = 'p'.repeat(180);
  for (let i = 0; i < 6000; i++) writeFileSync(join(repo, `f${String(i).padStart(5, '0')}_${pad}.txt`), 'lf\n');
  write('tests/core.test.js', '// AC-1.1 AC-1.2\n');
  const r = cliJson(['verify', PLAN_PATH, 'P1', '--prd', PRD_PATH]);
  assert.match(r.snapshot, /^[0-9a-f]{40}$/);
  assert.deepEqual(r.untested_acs, []);
  assert.equal(r.pass, true);
  assert.equal(stateLine(), `- [pending] plan-007 P1: core {verify=pass:${r.snapshot}}`);
});

test('AC-2.3 backtick-wrapped gates with a trailing comment run the command, not its output', () => {
  seed("- gates: `node -e \"console.log('echo SUBST-RAN')\"`   # REQUIRED. one bash command");
  const r = cliJson(['verify', PLAN_PATH, 'P1']);
  assert.equal(r.gates, "node -e \"console.log('echo SUBST-RAN')\"");
  assert.equal(r.tail, 'echo SUBST-RAN');
});

// D7 round trip (P3's set-done gate relies on it): the verified snapshot of a
// dirty tree is exactly what `git add -A && git commit` produces.
test('AC-2.3 snapshotWorktree of a dirty tree equals snapshotHead after git add -A + commit', () => {
  write('src/app.js', 'module.exports = 42;\n');
  write('src/new.js', 'n\n');
  write('docs/forge/runs/s.md', 's\n');
  write('docs/guide.md', 'g\n');
  const v = snapshotWorktree(repo);
  commitAll('phase');
  assert.equal(snapshotHead(repo), v);
});

// --- AC-2.4 / AC-2.5: set done is gated on a passing verify of the committed code ---

test('AC-2.4 set done succeeds when verify passed and the commit matches the verified snapshot', () => {
  seed();
  write('src/app.js', 'module.exports = 5;\n');
  cliJson(['verify', PLAN_PATH, 'P1']);
  commitAll('phase');
  const r = cliJson(['set', PLAN_PATH, 'P1', 'done']);
  assert.equal(r.status, 'done');
  assert.equal(r.forced, undefined);
  assert.match(stateLine(), /^- \[done\] plan-007 P1: core \{verify=pass:[0-9a-f]{40}\}$/);
});

test('AC-2.4 set done without any verify exits 1 and leaves the entry unchanged', () => {
  seed();
  const before = stateLine();
  const r = cliFail(['set', PLAN_PATH, 'P1', 'done']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /P1: no passing verify for the committed code \(verified none, committed [0-9a-f]{40}\)/);
  assert.match(r.stderr, /Run forge-state verify after the last code change, commit with git add -A, then set done\./);
  assert.equal(stateLine(), before);
});

test('AC-2.4 set done after a failing verify exits 1 and leaves the entry unchanged', () => {
  seed('- gates: node -e "process.exit(2)"');
  cliJson(['verify', PLAN_PATH, 'P1']);
  commitAll('phase');
  const before = stateLine();
  const r = cliFail(['set', PLAN_PATH, 'P1', 'done']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no passing verify/);
  assert.equal(stateLine(), before);
});

test('AC-2.4 set done refuses when the committed code differs from the verified snapshot, listing paths', () => {
  seed();
  write('src/app.js', 'module.exports = 5;\n');
  cliJson(['verify', PLAN_PATH, 'P1']);
  write('src/app.js', 'module.exports = 6;\n');
  write('src/extra.js', 'x\n');
  commitAll('phase');
  const before = stateLine();
  const r = cliFail(['set', PLAN_PATH, 'P1', 'done']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /differing: .*src\/app\.js/);
  assert.match(r.stderr, /src\/extra\.js/);
  assert.equal(stateLine(), before);
});

test('AC-2.4 set done refuses when verified code was never committed', () => {
  seed();
  write('src/app.js', 'module.exports = 5;\n');
  cliJson(['verify', PLAN_PATH, 'P1']);
  const r = cliFail(['set', PLAN_PATH, 'P1', 'done']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /differing: src\/app\.js/);
});

test('AC-2.4 other statuses are not gated', () => {
  seed();
  assert.equal(cliJson(['set', PLAN_PATH, 'P1', 'in_progress']).status, 'in_progress');
  assert.equal(cliJson(['set', PLAN_PATH, 'P1', 'blocked']).status, 'blocked');
});

test('AC-2.5 set done --force --reason succeeds, persists forced and prints it', () => {
  seed();
  const r = cliJson(['set', PLAN_PATH, 'P1', 'done', '--force', '--reason', 'manual only']);
  assert.equal(r.forced, true);
  assert.equal(r.reason, 'manual only');
  assert.equal(stateLine(), '- [done] plan-007 P1: core {forced}');
  // the forced token round-trips through other commands
  assert.equal(cliJson(['status', PLAN_PATH]).counts.done, 1);
});

test('AC-2.5 forced keeps earlier tokens and sits after verify', () => {
  seed();
  const v = cliJson(['verify', PLAN_PATH, 'P1']).snapshot;
  cliJson(['set', PLAN_PATH, 'P1', 'done', '--force', '--reason', 'r']);
  assert.equal(stateLine(), `- [done] plan-007 P1: core {verify=pass:${v} forced}`);
});

test('AC-2.5 --force without --reason exits 1 and leaves the entry unchanged', () => {
  seed();
  const before = stateLine();
  const r = cliFail(['set', PLAN_PATH, 'P1', 'done', '--force']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--force requires --reason/);
  assert.equal(stateLine(), before);
});

test('AC-2.4 set done outside a git work tree refuses; --force --reason succeeds', () => {
  seed();
  const dir = mkdtempSync(join(tmpdir(), 'forge-nogit-'));
  try {
    const run = extra => execFileSync(process.execPath,
      [SCRIPT, 'set', join(repo, PLAN_PATH), 'P1', 'done', '--state', join(repo, STATE_PATH), ...extra],
      { cwd: dir, env: { ...ENV, GIT_CEILING_DIRECTORIES: tmpdir() }, encoding: 'utf8', stdio: 'pipe' });
    assert.throws(() => run([]), e => e.status === 1 && /no passing verify|git work tree/.test(e.stderr));
    assert.equal(stateLine(), '- [pending] plan-007 P1: core');
    assert.equal(JSON.parse(run(['--force', '--reason', 'x'])).forced, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AC-2.5 a later gated done drops the forced token', () => {
  seed();
  cliJson(['set', PLAN_PATH, 'P1', 'done', '--force', '--reason', 'r']);
  write('src/app.js', 'module.exports = 9;\n');
  cliJson(['verify', PLAN_PATH, 'P1']);
  commitAll('phase');
  cliJson(['set', PLAN_PATH, 'P1', 'done']);
  assert.match(stateLine(), /^- \[done\] plan-007 P1: core \{verify=pass:[0-9a-f]{40}\}$/);
});
