// forge-git — git helpers behind forge-state's evidence gate (spec-002 I4, D5/D6/D8/D17).
// Zero-dependency Node ESM. Every git call is execFileSync('git', args, {cwd, env});
// snapshots build their tree in a throwaway index, so the real index is never touched.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';

// Paths that are run bookkeeping, not code: never part of a code snapshot.
const EXCLUDED = ['docs/forge', 'docs/context'];
const TAIL_LINES = 40;

// Inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (e.g. from a hook) would
// redirect git away from `cwd`; drop them and add only what the caller sets.
function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'])
    delete env[k];
  return { ...env, ...extra };
}

// No maxBuffer cap: `ls-files` on a large repo (or `add -A` warnings) can exceed
// execFileSync's 1 MiB default, which would kill git with ENOBUFS.
function git(cwd, args, extraEnv) {
  return execFileSync('git', args, {
    cwd, env: gitEnv(extraEnv), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: Infinity,
  });
}

// Temp-index git calls: never write a split index (sharedindex.* in .git), and
// no per-file CRLF warnings from `add -A` (core.safecrlf only warns or refuses;
// it never changes the blobs, so the tree id is unaffected).
const TEMP_INDEX_CONFIG = ['-c', 'core.splitIndex=false', '-c', 'core.safecrlf=false'];

// Snapshot pathspecs are relative to the repo root, whatever cwd the caller has.
const topLevel = cwd => git(cwd, ['rev-parse', '--show-toplevel']).trim();

// Build a tree in a temp index. `seed` prepares the index (copy the real one, or
// read HEAD); the exclusions are dropped before write-tree.
function treeFromTempIndex(cwd, seed) {
  const top = topLevel(cwd);
  const tmp = mkdtempSync(join(tmpdir(), 'forge-git-index-'));
  const index = join(tmp, 'index');
  try {
    const env = { GIT_INDEX_FILE: index };
    seed(top, index, env);
    git(top, [...TEMP_INDEX_CONFIG, 'rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...EXCLUDED], env);
    return git(top, [...TEMP_INDEX_CONFIG, 'write-tree'], env).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Tree id of the working tree as `git add -A` would commit it, minus EXCLUDED.
// The temp index starts as a copy of the real one: files git already tracks stay
// tracked (as in a real `git add -A` commit) and unchanged files reuse the stat
// cache instead of being re-hashed.
export function snapshotWorktree(cwd) {
  return treeFromTempIndex(cwd, (top, index, env) => {
    const real = resolve(top, git(top, ['rev-parse', '--git-path', 'index']).trim());
    if (existsSync(real)) {
      copyFileSync(real, index);
      // Keep the real index's mtime: git's racy-entry check compares file mtimes
      // against it, and a fresher copy would make same-second edits look clean.
      const { atime, mtime } = statSync(real);
      utimesSync(index, atime, mtime);
    }
    git(top, [...TEMP_INDEX_CONFIG, 'add', '-A'], env);
  });
}

// Tree id of HEAD, minus EXCLUDED: directly comparable to snapshotWorktree().
export function snapshotHead(cwd) {
  return treeFromTempIndex(cwd, (top, index, env) => {
    git(top, [...TEMP_INDEX_CONFIG, 'read-tree', 'HEAD'], env);
  });
}

// Paths that differ between two tree ids.
export function diffSnapshots(cwd, a, b) {
  return git(cwd, ['diff-tree', '-r', '-z', '--name-only', a, b]).split('\0').filter(Boolean);
}

const MAX_SCAN_BYTES = 1024 * 1024;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// AC IDs ("AC-1.2") that no repository file mentions as AC-1.2 / AC_1_2 / ac_1_2
// (not preceded by a letter or digit, not followed by a digit).
// Scans tracked + untracked non-ignored files, skipping docs/ (where the PRD and
// plan name every AC), node_modules/, files over 1 MiB and binaries (NUL byte).
export function findUntestedAcs(cwd, acIds) {
  if (acIds.length === 0) return [];
  const patterns = new Map(acIds.map(id => {
    const [, x, y] = id.match(/^AC-(\d+)\.(\d+)$/i) ?? [];
    // Not \b: `_` is a word char, so \b would reject the documented test naming
    // `test_AC_2_1_...` (references/tdd.md). Only a letter or digit may not precede.
    return [id, x === undefined ? null : new RegExp(`(?<![a-z0-9])ac[-_]${escapeRe(x)}[._]${escapeRe(y)}(?!\\d)`, 'i')];
  }));
  const top = topLevel(cwd);
  const files = git(top, ['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  const pending = new Set(acIds);
  for (const rel of new Set(files)) {
    if (pending.size === 0) break;
    if (rel.startsWith('docs/') || rel.split('/').includes('node_modules')) continue;
    let buf;
    try {
      const p = join(top, rel);
      if (statSync(p).size > MAX_SCAN_BYTES) continue;
      buf = readFileSync(p);
    } catch { continue; }   // tracked but deleted, or not a regular file
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    for (const id of pending) if (patterns.get(id)?.test(text)) pending.delete(id);
  }
  return acIds.filter(id => pending.has(id));
}

// The bash to run gates with, or null when there is none worth trusting.
// On Windows `bash` on PATH is often C:\Windows\System32\bash.exe, the WSL shim,
// which fails (exit 1, not ENOENT) without a distro: a false red. Prefer the Git
// for Windows bash next to git itself, then a PATH bash outside the Windows dirs.
export function resolveBash({
  platform = process.platform,
  gitExecPath,
  pathEnv = process.env.PATH ?? process.env.Path ?? '',
  systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return 'bash';
  const candidates = [];
  if (gitExecPath) {
    // <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe, <git>/usr/bin/bash.exe
    const root = win32.resolve(gitExecPath, '..', '..', '..');
    candidates.push(win32.join(root, 'bin', 'bash.exe'), win32.join(root, 'usr', 'bin', 'bash.exe'));
  }
  const winDir = win32.resolve(systemRoot).toLowerCase();
  for (const dir of pathEnv.split(';').filter(Boolean)) {
    const d = win32.resolve(dir).toLowerCase();
    if (d === winDir || d.startsWith(winDir + '\\') || d.includes('\\windowsapps')) continue;
    candidates.push(win32.join(dir, 'bash.exe'));
  }
  return candidates.find(c => exists(c)) ?? null;
}

function gitExecPath() {
  try { return execFileSync('git', ['--exec-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return undefined; }
}

// Run the gates command in cwd: `bash -c <cmd>`, falling back to the platform
// shell when no bash is available (ENOENT, or none trustworthy on Windows).
// stdout and stderr share one file so the tail keeps their interleaving. No
// timeout: gates can legitimately run for many minutes (R6).
export function runGates(cmd, cwd, { bash = resolveBash({ gitExecPath: gitExecPath() }) } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-gates-'));
  const outPath = join(tmp, 'out.log');
  const fd = openSync(outPath, 'w');
  try {
    const opts = { cwd, stdio: ['ignore', fd, fd], windowsHide: true };
    let shell = 'bash';
    let r = bash ? spawnSync(bash, ['-c', cmd], opts) : { error: { code: 'ENOENT' } };
    if (r.error?.code === 'ENOENT') {
      shell = 'default';
      r = spawnSync(cmd, { ...opts, shell: true });
    }
    if (r.error) throw r.error;
    closeSync(fd);
    const lines = readFileSync(outPath, 'utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    return { exit_code: r.status ?? 1, shell, tail: lines.slice(-TAIL_LINES).join('\n') };
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Absolute git common dir: shared by every worktree of the repo (spec-002 D9).
export function gitCommonDir(cwd) {
  return resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim());
}

// Every commit on HEAD's history whose subject starts "P<n>: ", newest first.
export function phaseCommitList(cwd) {
  const out = [];
  for (const line of git(cwd, ['log', '--format=%H%x09%s']).split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    const m = tab < 0 ? null : line.slice(tab + 1).match(/^P(\d+): /);
    if (m) out.push({ id: `P${m[1]}`, sha: line.slice(0, tab), subject: line.slice(tab + 1) });
  }
  return out;
}

// "P<n>" -> sha of the NEWEST such commit.
export function phaseCommits(cwd) {
  const out = new Map();
  for (const c of phaseCommitList(cwd)) if (!out.has(c.id)) out.set(c.id, c.sha);
  return out;
}

// True when `git remote` lists at least one remote.
export function hasRemote(cwd) {
  return git(cwd, ['remote']).trim().length > 0;
}
