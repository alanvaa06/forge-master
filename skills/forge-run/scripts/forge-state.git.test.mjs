// Temp-git-repo tests for forge-state verify and forge-git.mjs.
// Run: node --test skills/forge-run/scripts/forge-state.git.test.mjs
// Every git call runs in a throwaway repo under os.tmpdir() with its own
// identity and an env stripped of inherited GIT_* vars, so nothing can leak
// into the repository that hosts these tests.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
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

// --- AC-3.1: reconcile marks phases done from their P<n>: commits ---

const MULTI = `# Plan-007: demo

## Run Config
- gates: node -e "process.exit(0)"

## Phases

### P1: one
- covers: -
- depends_on: -
- tier: junior
- process: light

### P2: two
- covers: -
- depends_on: P1
- tier: junior
- process: light

### P10: ten
- covers: -
- depends_on: -
- tier: junior
- process: light
`;
const stateText = () => readFileSync(join(repo, STATE_PATH), 'utf8');
function seedMulti(extraConfig = '') {
  write(PLAN_PATH, MULTI.replace('## Phases', `${extraConfig}\n## Phases`));
  cli(['seed', PLAN_PATH]);
}
const emptyCommit = msg => git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false',
  '-c', `core.hooksPath=${join(repo, '.git', 'no-hooks')}`, 'commit', '-q', '--allow-empty', '-m', msg);

test('AC-3.1 reconcile marks phases with a P<n>: commit done+reconciled, leaves others', () => {
  seedMulti();
  emptyCommit('P1: one');
  emptyCommit('P10: ten');
  emptyCommit('unrelated: P2: not a subject start');
  const r = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r, { plan: 'plan-007', reconciled: ['P1', 'P10'], unchanged: ['P2'] });
  const t = stateText();
  assert.match(t, /^- \[done\] plan-007 P1: one \{reconciled\}$/m);
  assert.match(t, /^- \[done\] plan-007 P10: ten \{reconciled\}$/m);
  assert.match(t, /^- \[pending\] plan-007 P2: two$/m);
});

test('AC-3.1 P1 commit does not match P10 and done phases are untouched', () => {
  seedMulti();
  emptyCommit('P10: ten');
  const r = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r.reconciled, ['P10']);
  assert.deepEqual(r.unchanged, ['P1', 'P2']);
  emptyCommit('P2: two');
  const r2 = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r2.reconciled, ['P2']);
  assert.deepEqual(r2.unchanged, ['P1', 'P10']);
});

test('AC-3.1 reconcile re-creates a missing entry whose commit exists', () => {
  seedMulti();
  writeFileSync(join(repo, STATE_PATH), stateText().split('\n').filter(l => !/ P2: /.test(l)).join('\n'));
  emptyCommit('P2: two');
  const r = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r.reconciled, ['P2']);
  assert.match(stateText(), /^- \[done\] plan-007 P2: two \{reconciled\}$/m);
});

// --- AC-3.2: finish writes an idempotent finished record ---

const FIXED_NOW = '2026-10-18T12:00:00.000Z';
const cliNow = args => execFileSync(process.execPath, [SCRIPT, ...args, '--state', STATE_PATH], {
  cwd: repo, env: { ...ENV, FORGE_STATE_NOW: FIXED_NOW }, encoding: 'utf8', stdio: 'pipe' });

test('AC-3.2 finish records action/ref/at; seed and next report finished; second finish exits 1', () => {
  seedMulti();
  const r = JSON.parse(cliNow(['finish', PLAN_PATH, '--action', 'pr', '--ref', 'https://x/pull/1']));
  assert.deepEqual(r, { plan: 'plan-007', finished: { action: 'pr', ref: 'https://x/pull/1', at: FIXED_NOW } });
  assert.match(stateText(), /^- \[meta\] plan-007 finished: action=pr ref=https:\/\/x\/pull\/1 at=2026-10-18T12:00:00\.000Z$/m);
  const marker = join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'forge', 'plan-007.finished.json');
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { action: 'pr', ref: 'https://x/pull/1', at: FIXED_NOW });
  const s = cliJson(['seed', PLAN_PATH]);
  assert.deepEqual(s, { plan: 'plan-007', finished: true, action: 'pr', ref: 'https://x/pull/1', at: FIXED_NOW });
  const n = cliJson(['next', PLAN_PATH]);
  assert.equal(n.finished, true);
  assert.equal(n.action, 'pr');
  assert.equal(n.ref, 'https://x/pull/1');
  const again = cliFail(['finish', PLAN_PATH, '--action', 'keep']);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /plan-007 already finished \(pr https:\/\/x\/pull\/1 at 2026-10-18T12:00:00\.000Z\)/);
});

test('AC-3.2 unfinished seed/next print finished: false; marker alone counts; bad action exits 1', () => {
  seedMulti();
  assert.equal(cliJson(['seed', PLAN_PATH]).finished, false);
  assert.equal(cliJson(['next', PLAN_PATH]).finished, false);
  assert.equal(cliFail(['finish', PLAN_PATH, '--action', 'bogus']).code, 1);
  assert.equal(cliFail(['finish', PLAN_PATH]).code, 1);
  cliNow(['finish', PLAN_PATH, '--action', 'keep']);
  writeFileSync(join(repo, STATE_PATH), stateText().split('\n').filter(l => !/\[meta\]/.test(l)).join('\n'));
  const s = cliJson(['seed', PLAN_PATH]);
  assert.equal(s.finished, true);
  assert.equal(s.action, 'keep');
});

test('AC-3.2 other commands preserve the meta line', () => {
  seedMulti();
  cliNow(['finish', PLAN_PATH, '--action', 'keep']);
  cli(['set', PLAN_PATH, 'P1', 'in_progress']);
  cli(['red', PLAN_PATH, 'P1']);
  assert.match(stateText(), /^- \[meta\] plan-007 finished: action=keep ref= at=/m);
});

// --- AC-3.5: preflight checks the landing remote ---

test('AC-3.5 preflight fails for on_complete pr|merge without a remote, passes with one', () => {
  for (const mode of ['pr', 'merge']) {
    seedMulti(`- on_complete: ${mode}`);
    const f = cliFail(['preflight', PLAN_PATH]);
    assert.equal(f.code, 1);
    const out = JSON.parse(f.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.checks.remote, false);
    assert.ok(out.errors.some(e => e.includes(`on_complete ${mode} needs a git remote`)), out.errors.join());
  }
  git('remote', 'add', 'origin', join(tmpdir(), 'forge-nowhere.git'));
  const ok = cliJson(['preflight', PLAN_PATH]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.checks.remote, true);
});

test('AC-3.5 preflight with on_complete keep passes without a remote', () => {
  seedMulti('- on_complete: keep');
  const r = cliJson(['preflight', PLAN_PATH]);
  assert.equal(r.ok, true);
  assert.equal(r.checks.remote, false);
});

// --- review fixes ---

test('AC-3.1 reconcile ignores an earlier plan commit with a different phase name', () => {
  seedMulti();
  emptyCommit('P1: other name');
  emptyCommit('P2: twofold');
  const r = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r.reconciled, []);
  assert.deepEqual(r.unchanged, ['P1', 'P2', 'P10']);
});

test('AC-3.1 reconcile matches "P<n>: <exact name> [AC-..]" subjects', () => {
  seedMulti();
  emptyCommit('P1: one [AC-1.1]');
  const r = cliJson(['reconcile', PLAN_PATH]);
  assert.deepEqual(r.reconciled, ['P1']);
});

test('AC-3.1 gated set done clears the reconciled token', () => {
  seed();
  write('src/b.js', 'x\n');
  commitAll('P1: core');
  cliJson(['reconcile', PLAN_PATH]);
  assert.match(stateLine(), /\{reconciled\}$/);
  cli(['set', PLAN_PATH, 'P1', 'pending']);
  cliJson(['verify', PLAN_PATH, 'P1']);
  cli(['set', PLAN_PATH, 'P1', 'done']);
  assert.match(stateLine(), /^- \[done\] plan-007 P1: core \{verify=pass:[0-9a-f]{40}\}$/);
});

test('AC-3.5 preflight treats a missing on_complete as pr', () => {
  seedMulti();
  const f = cliFail(['preflight', PLAN_PATH]);
  assert.equal(JSON.parse(f.stdout).ok, false);
  assert.ok(JSON.parse(f.stdout).errors[0].includes('on_complete pr needs a git remote'));
});

test('AC-3.2 seed reports finished before linting the plan', () => {
  seedMulti();
  cliNow(['finish', PLAN_PATH, '--action', 'keep']);
  write(PLAN_PATH, MULTI.replace('depends_on: P1', 'depends_on: P99'));
  const s = cliJson(['seed', PLAN_PATH]);
  assert.equal(s.finished, true);
});

// --- AC-3.4: single-driver run lock with heartbeat ---

const T0 = Date.parse('2026-10-18T12:00:00.000Z');
const minAt = m => new Date(T0 + m * 60000).toISOString();
const lockFile = () => join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'forge', 'plan-007.lock.json');
const lockJson = () => JSON.parse(readFileSync(lockFile(), 'utf8'));
const runAt = (m, args) => execFileSync(process.execPath, [SCRIPT, ...args, '--state', STATE_PATH], {
  cwd: repo, env: { ...ENV, FORGE_STATE_NOW: minAt(m) }, encoding: 'utf8', stdio: 'pipe' });
const jsonAt = (m, args) => JSON.parse(runAt(m, args));
function failAt(m, args) {
  try { runAt(m, args); } catch (e) { return { code: e.status, stdout: e.stdout, stderr: e.stderr }; }
  assert.fail(`expected non-zero exit for: ${args.join(' ')}`);
}
const seedAs = (m, holder) => jsonAt(m, ['seed', PLAN_PATH, '--holder', holder]);

test('AC-3.4 fresh lock of holder A refuses B naming A and the heartbeat; A re-seeds ok; refusal leaves lock untouched', () => {
  write(PLAN_PATH, MULTI);
  const a = seedAs(0, 'A');
  assert.equal(a.seeded, 3);
  assert.equal(a.lock_takeover, undefined);
  assert.deepEqual(lockJson(), { holder: 'A', acquired_at: minAt(0), heartbeat_at: minAt(0), run_root: lockJson().run_root });
  const before = readFileSync(lockFile(), 'utf8');
  const stateBefore = stateText();
  const f = failAt(60, ['seed', PLAN_PATH, '--holder', 'B']);
  assert.equal(f.code, 1);
  assert.ok(f.stderr.includes(`plan-007 is driven by A (heartbeat ${minAt(0)}, 60 min ago); stop, or wait until it is stale (120 min)`), f.stderr);
  assert.equal(readFileSync(lockFile(), 'utf8'), before);
  assert.equal(stateText(), stateBefore);
  const again = seedAs(61, 'A');
  assert.equal(again.resume, true);
  assert.equal(again.lock_takeover, undefined);
  assert.equal(lockJson().heartbeat_at, minAt(61));
  assert.equal(lockJson().acquired_at, minAt(0));
});

test('AC-3.4 stale lock is taken over by B and the JSON reports the previous holder and heartbeat', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  const b = seedAs(121, 'B');
  assert.equal(b.lock_takeover, true);
  assert.equal(b.previous_holder, 'A');
  assert.equal(b.previous_heartbeat, minAt(0));
  assert.equal(lockJson().holder, 'B');
  assert.equal(lockJson().acquired_at, minAt(121));
  assert.equal(failAt(130, ['seed', PLAN_PATH, '--holder', 'A']).code, 1);
});

test('AC-3.4 a mutating command refreshes the heartbeat so a would-be-stale lock stays fresh', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  runAt(100, ['set', PLAN_PATH, 'P1', 'in_progress']);
  assert.equal(lockJson().heartbeat_at, minAt(100));
  const f = failAt(150, ['seed', PLAN_PATH, '--holder', 'B']);
  assert.match(f.stderr, /driven by A .* 50 min ago/);
  runAt(160, ['recover', PLAN_PATH]);
  assert.equal(lockJson().heartbeat_at, minAt(160));
  runAt(170, ['reconcile', PLAN_PATH]);
  assert.equal(lockJson().heartbeat_at, minAt(170));
});

test('AC-3.4 read-only commands neither refresh nor create the lock', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  for (const c of ['next', 'status', 'lint', 'preflight']) {
    try { runAt(100, [c, PLAN_PATH]); } catch { /* preflight may exit 1 */ }
  }
  assert.equal(lockJson().heartbeat_at, minAt(0));
  assert.equal(seedAs(121, 'B').lock_takeover, true);
});

test('AC-3.4 lock is released when every phase is terminal, and on finish', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  for (const p of ['P1', 'P2']) runAt(1, ['set', PLAN_PATH, p, 'done', '--force', '--reason', 'no code']);
  assert.ok(existsSync(lockFile()));
  runAt(2, ['set', PLAN_PATH, 'P10', 'done', '--force', '--reason', 'no code']);
  assert.equal(existsSync(lockFile()), false);
  rmSync(join(repo, STATE_PATH));
  seedAs(3, 'A');
  assert.ok(existsSync(lockFile()));
  runAt(4, ['finish', PLAN_PATH, '--action', 'keep']);
  assert.equal(existsSync(lockFile()), false);
});

test('AC-3.4 seed without --holder uses "anonymous"; positional parsing is unaffected', () => {
  write(PLAN_PATH, MULTI);
  jsonAt(0, ['seed', '--holder', 'A', PLAN_PATH]);
  assert.equal(lockJson().holder, 'A');
  rmSync(lockFile());
  jsonAt(0, ['seed', PLAN_PATH]);
  assert.equal(lockJson().holder, 'anonymous');
});

// --- AC-3.4 hardening: corrupt locks, bad clock, holder values, no-create, more refreshers ---

const putLock = obj => { mkdirSync(dirname(lockFile()), { recursive: true }); writeFileSync(lockFile(), typeof obj === 'string' ? obj : JSON.stringify(obj)); };

test('AC-3.4 a lock without a parseable heartbeat counts as stale and is taken over', () => {
  write(PLAN_PATH, MULTI);
  putLock({ holder: 'A', acquired_at: minAt(0) });
  const b = seedAs(1, 'B');
  assert.equal(b.lock_takeover, true);
  assert.equal(b.previous_holder, 'A');
  assert.equal(lockJson().holder, 'B');
  putLock({ holder: 'A', acquired_at: minAt(0), heartbeat_at: 'garbage' });
  assert.equal(seedAs(2, 'C').lock_takeover, true);
});

test('AC-3.4 an unparseable lock.json is reported as a takeover with previous_holder null', () => {
  write(PLAN_PATH, MULTI);
  putLock('{not json');
  const b = seedAs(0, 'B');
  assert.equal(b.lock_takeover, true);
  assert.equal(b.previous_holder, null);
  assert.equal(lockJson().holder, 'B');
});

test('AC-3.4 an unparseable FORGE_STATE_NOW exits 1 and writes no lock', () => {
  write(PLAN_PATH, MULTI);
  try {
    execFileSync(process.execPath, [SCRIPT, 'seed', PLAN_PATH, '--holder', 'A', '--state', STATE_PATH], {
      cwd: repo, env: { ...ENV, FORGE_STATE_NOW: 'garbage' }, encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected exit 1');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /FORGE_STATE_NOW/);
  }
  assert.equal(existsSync(lockFile()), false);
});

test('AC-3.4 an empty or missing --holder value means anonymous', () => {
  write(PLAN_PATH, MULTI);
  jsonAt(0, ['seed', PLAN_PATH, '--holder', '']);
  assert.equal(lockJson().holder, 'anonymous');
  rmSync(lockFile());
  runAt(0, ['seed', PLAN_PATH, '--holder']);
  assert.equal(lockJson().holder, 'anonymous');
});

test('AC-3.4 lock records the real repo root as run_root', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  assert.equal(realpathSync.native(lockJson().run_root), realpathSync.native(git('rev-parse', '--show-toplevel')));
});

test('AC-3.4 no command creates a lock when none exists (read-only and heartbeat)', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  rmSync(lockFile());
  for (const c of ['next', 'status', 'lint', 'preflight']) {
    try { runAt(5, [c, PLAN_PATH]); } catch { /* preflight may exit 1 */ }
  }
  assert.equal(existsSync(lockFile()), false);
  runAt(6, ['set', PLAN_PATH, 'P1', 'in_progress']);
  runAt(6, ['red', PLAN_PATH, 'P1']);
  assert.equal(existsSync(lockFile()), false);
});

test('AC-3.4 red, escalate and verify refresh the heartbeat', () => {
  write(PLAN_PATH, MULTI);
  seedAs(0, 'A');
  runAt(10, ['red', PLAN_PATH, 'P1']);
  assert.equal(lockJson().heartbeat_at, minAt(10));
  runAt(20, ['escalate', PLAN_PATH, 'P1', '--tier', 'senior']);
  assert.equal(lockJson().heartbeat_at, minAt(20));
  runAt(30, ['verify', PLAN_PATH, 'P1']);
  assert.equal(lockJson().heartbeat_at, minAt(30));
});
