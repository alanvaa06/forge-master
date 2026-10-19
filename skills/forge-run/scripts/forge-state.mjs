#!/usr/bin/env node
// forge-state — deterministic run-state machine for forge-master runs.
// Owns the canonical entry format:
//   - [status] plan-NNN P<n>: <name> [{tier=.. process=.. iter=N verify=pass|fail:<tree> forced reconciled}]
//   - [meta] plan-NNN finished: action=<pr|merge|keep> ref=<ref> at=<iso>   (written by `finish`)
//
// Usage:
//   node forge-state.mjs lint     <plan-file> [--prd <prd-file>]
//   node forge-state.mjs seed     <plan-file> [--holder <id>]   (takes the run lock; default holder anonymous)
//   node forge-state.mjs next     <plan-file> [--all]
//   node forge-state.mjs set      <plan-file> <P-id> <status> [--force --reason "<text>"]
//   node forge-state.mjs red      <plan-file> <P-id>
//   node forge-state.mjs escalate <plan-file> <P-id> [--tier senior] [--process heavy]
//   node forge-state.mjs recover  <plan-file>
//   node forge-state.mjs status   <plan-file>
//   node forge-state.mjs verify   <plan-file> <P-id> [--prd <prd-file>] [--gates "<cmd>"]
//   node forge-state.mjs reconcile <plan-file>
//   node forge-state.mjs finish   <plan-file> --action pr|merge|keep [--ref <url-or-sha>]
//   node forge-state.mjs preflight <plan-file>
//   node forge-state.mjs finished <plan-file>   (read-only; the plan file need not exist)
// Run lock: <git-common-dir>/forge/plan-NNN.lock.json; mutating commands refresh its heartbeat,
// a lock idle >= 120 min is taken over. FORGE_STATE_NOW (ISO 8601) overrides the clock, tests only.
// Common flags: --state <path> (alias --todo; default docs/forge/runs/<plan>.state.md),
//               --context-todo <path> (scaffold's todo.md; default docs/context/todo.md).
//
// State lives in a forge-owned file, never in scaffold's todo.md: scaffold's
// /compact-context deletes finished todos, which would silently deadlock or
// re-run phases. While a run is open, todo.md carries ONE pointer line; `set`
// removes it once every phase is terminal. `seed` migrates entries a pre-0.17
// run left in todo.md.
//
// `lint` validates the plan (fields, tags, dependency graph, AC coverage,
// parallel groups) and `seed` refuses a plan that fails it. `red` records a red
// iteration and returns the deterministic K decision (retry | escalate | block);
// `escalate` persists an UP-only tier/process bump and resets iter; `recover`
// returns phases a crash left in flight to pending. `set blocked|plan-stale`
// cascades [blocked-upstream] to every pending transitive dependent. `verify`
// snapshots the code (git tree id, docs/forge + docs/context excluded) BEFORE
// running the plan's raw gates command, traces covered ACs to test files
// (--prd), and persists verify=pass|fail:<tree> on the entry.
//
// All commands print JSON to stdout (ASCII-only). Errors go to stderr with exit 1;
// `lint` also exits 1 when the plan has errors, listing them in its JSON.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { snapshotWorktree, snapshotHead, diffSnapshots, runGates, findUntestedAcs, gitCommonDir, phaseCommitList, hasRemote } from './forge-git.mjs';

const NON_TERMINAL = ['pending', 'in_progress', 'in_progress-parallel'];
const TERMINAL = ['done', 'blocked', 'blocked-upstream', 'plan-stale'];
const STATUSES = [...NON_TERMINAL, ...TERMINAL];
const IN_FLIGHT = ['in_progress', 'in_progress-parallel'];
const TIERS = ['junior', 'senior'];          // ordered weakest -> strongest
const PROCESSES = ['light', 'heavy'];        // ordered weakest -> strongest
const DEFAULT_K = 3;
const REQUIRED_FIELDS = ['covers', 'depends_on', 'tier', 'process'];
const PHASE_FIELDS = [...REQUIRED_FIELDS, 'success', 'notes'];
// Values an LLM-written plan uses for "no dependencies / no ACs".
const EMPTY_LIST = new Set(['', '-', '—', '–', 'none', 'n/a', '(none)']);
// Canonical entry, with an OPTIONAL trailing suffix persisted at runtime:
//   - [status] plan-NNN P<n>: <name> {tier=senior process=heavy iter=2}
// Group 4 is the phase name (non-greedy so it never eats the braces); group 5 is
// the raw suffix body when present.
const ENTRY_RE = /^- \[([a-z_-]+)\] (plan-\S+) (P\d+): (.*?)(?:\s+\{([^}]*)\})?$/;
// Plan list item: "- key: value", tolerating "- **key:** value" / "- **key**: value".
// Top-level only: an indented sub-bullet under notes never overrides a field.
const FIELD_RE = /^[-*]\s+(?:\*\*)?([\w-]+)(?:\*\*)?:(?:\*\*)?\s*(.*)$/;
const PRD_AC_RE = /^\s*[-*]\s+(?:\*\*)?(AC-\d+\.\d+)\b/;

// Console output must stay ASCII (Windows consoles default to cp1252). JSON
// stays valid: non-ASCII only ever appears inside strings, escaped as \uXXXX.
const ascii = s => s.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const print = obj => process.stdout.write(ascii(JSON.stringify(obj, null, 2)) + '\n');

function fail(msg) {
  process.stderr.write(`forge-state: ${ascii(msg)}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--state' || argv[i] === '--todo') args.state = argv[++i];
    else if (argv[i] === '--context-todo') args.contextTodo = argv[++i];
    else if (argv[i] === '--prd') args.prd = argv[++i];
    else if (argv[i] === '--all') args.all = true;
    else if (argv[i] === '--tier') args.tier = argv[++i];
    else if (argv[i] === '--process') args.process = argv[++i];
    else if (argv[i] === '--gates') args.gates = argv[++i];
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--action') args.action = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--holder') args.holder = argv[i + 1]?.startsWith('--') ? '' : argv[++i];
    else if (argv[i] === '--reason') args.reason = argv[++i];
    else args.rest.push(argv[i]);
  }
  return args;
}

// --- files: line endings preserved ---

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const eolOf = text => (text.includes('\r\n') ? '\r\n' : '\n');

// Direct write, not temp + rename: on Windows a rename fails (EPERM) while an
// indexer, AV scanner or tail holds the file open without delete sharing.
function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function rewriteLines(path, fn) {
  const text = readText(path);
  writeText(path, fn(text.split(/\r?\n/)).join(eolOf(text)));
}

function appendLines(path, lines) {
  let text = readText(path);
  const eol = eolOf(text);
  if (text && !text.endsWith('\n')) text += eol;
  writeText(path, text + lines.join(eol) + eol);
}

// --- plan parsing ---

// Structured values: drop "# comment", backticks and bold markers.
const clean = raw => raw.replace(/#.*$/, '').replace(/[`*]/g, '').trim();
const list = value => (EMPTY_LIST.has(value.toLowerCase()) ? [] : value.split(/[,\s]+/).filter(Boolean));

function parsePlan(planPath) {
  if (!existsSync(planPath)) fail(`plan file not found: ${planPath}`);
  const planId = basename(planPath).replace(/\.md$/, '');
  const phases = [];
  const present = new Map();   // phase -> Set of fields the plan actually wrote
  const duplicates = [];
  const malformed = [];        // phase-like headings the parser would otherwise drop
  const config = {};
  const rawConfig = {};        // as written: `gates` must run verbatim, not clean()ed
  const groups = [];
  let section = null;
  let current = null;
  for (const line of readFileSync(planPath, 'utf8').split(/\r?\n/)) {
    const head = line.match(/^###\s+(P\d+):\s*(.*)$/);
    if (head) {
      if (phases.some(p => p.id === head[1])) duplicates.push(head[1]);
      current = { id: head[1], name: head[2].trim(), covers: [], depends_on: [] };
      phases.push(current);
      present.set(current, new Set());
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      current = null;
      if (/^P\d+\b/.test(heading[2])) malformed.push(line.trim());
      if (heading[1].length <= 2) section = heading[2].trim().toLowerCase();
      continue;
    }
    const field = line.match(FIELD_RE);
    if (!field) continue;
    const [, key, raw] = field;
    if (current) {
      if (!PHASE_FIELDS.includes(key)) continue;
      present.get(current).add(key);
      if (key === 'covers' || key === 'depends_on') current[key] = list(clean(raw));
      else if (key === 'tier' || key === 'process') current[key] = clean(raw);
      else current[key] = raw.trim();
    } else if (section?.startsWith('run config')) {
      config[key] = clean(raw);
      rawConfig[key] = raw.trim();
    } else if (section?.startsWith('parallel groups')) {
      groups.push({ name: key, members: list(clean(raw)) });
    }
  }
  if (phases.length === 0) fail(`no "### P<n>:" phases found in ${planPath}`);
  return { planId, phases, present, duplicates, malformed, config, rawConfig, groups };
}

// The gates command as bash will run it. clean() would strip every `*` and
// everything after any `#`; here only what bash itself ignores goes: a comment
// (`#` at a word start, outside quotes). Then a value wrapped whole in one pair
// of backticks (markdown code) is unwrapped, since bash would run it as a command
// substitution and execute its OUTPUT. Comment first: `cmd`  # REQUIRED... is
// the template's shape filled in markdown style.
function gatesCommand(raw) {
  const cmd = stripComment(raw.trim());
  const code = cmd.match(/^`([^`]+)`$/);
  return code ? code[1].trim() : cmd;
}

function stripComment(cmd) {
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '\\') i++;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(cmd[i - 1]))) return cmd.slice(0, i).trim();
  }
  return cmd;
}

const isPlaceholder = v => v === '' || /^<.*>$/.test(v);

// AC IDs in the PRD; `manual` holds those tagged [manual-check]. The tag counts
// only at the END of the AC line: an AC's text may mention the tag itself.
const MANUAL_TAG_RE = /`?\[manual-check\]`?\s*$/;
function parsePrdAcs(prdPath, manual = new Set()) {
  if (!existsSync(prdPath)) fail(`PRD file not found: ${prdPath}`);
  const acs = new Set();
  for (const line of readFileSync(prdPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(PRD_AC_RE);
    if (!m) continue;
    acs.add(m[1]);
    if (MANUAL_TAG_RE.test(line)) manual.add(m[1]);
  }
  return acs;
}

// --- graph ---

// transitive dependents of rootId over the plan graph
function dependents(phases, rootId) {
  const hit = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of phases) {
      if (hit.has(p.id)) continue;
      if (p.depends_on.some(d => hit.has(d))) { hit.add(p.id); grew = true; }
    }
  }
  hit.delete(rootId);
  return hit;
}

// First dependency cycle found, as a path of phase ids ending where it started.
function findCycle(phases) {
  const byId = new Map(phases.map(p => [p.id, p]));
  const state = new Map();   // id -> 'visiting' | 'done'
  const stack = [];
  function visit(id) {
    state.set(id, 'visiting');
    stack.push(id);
    for (const d of byId.get(id).depends_on) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 'visiting') return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) { const c = visit(d); if (c) return c; }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  }
  for (const p of phases) {
    if (!state.has(p.id)) { const c = visit(p.id); if (c) return c; }
  }
  return null;
}

// --- lint: every check the plan's prose used to leave to the reader ---

// Two severities of error. `graph` errors break the state machine itself (a
// phase dropped, run out of order, deadlocked, or with tags `red`/`escalate`
// cannot reason about); `seed` refuses on those. The rest are contract errors
// (coverage, Run Config, groups): plan-design must fix them before gate 2, but
// they cannot corrupt run state, so an already-seeded run still resumes.
function lint(plan, prdAcs) {
  const { phases, present, duplicates, malformed, config, groups } = plan;
  const graph = [];
  const contract = [];
  const warnings = [];
  const ids = new Set(phases.map(p => p.id));
  for (const id of new Set(duplicates)) graph.push(`duplicate phase id ${id}`);
  for (const h of malformed) graph.push(`unparseable phase heading "${h}" (expected "### P<n>: <name>")`);
  for (const p of phases) {
    for (const f of REQUIRED_FIELDS)
      if (!present.get(p).has(f)) (f === 'covers' ? contract : graph).push(`${p.id}: missing required field "${f}"`);
    if (p.tier !== undefined && !TIERS.includes(p.tier))
      graph.push(`${p.id}: invalid tier "${p.tier}" (one of: ${TIERS.join(', ')})`);
    if (p.process !== undefined && !PROCESSES.includes(p.process))
      graph.push(`${p.id}: invalid process "${p.process}" (one of: ${PROCESSES.join(', ')})`);
    for (const d of p.depends_on) {
      if (d === p.id) graph.push(`${p.id}: depends on itself`);
      else if (!ids.has(d)) graph.push(`${p.id}: depends_on names unknown phase "${d}"`);
    }
    if (present.get(p).has('covers') && p.covers.length === 0) warnings.push(`${p.id}: covers no AC`);
  }
  const cycle = findCycle(phases);
  if (cycle) graph.push(`dependency cycle: ${cycle.join(' -> ')}`);
  const errors = contract;

  const owners = new Map();
  for (const p of phases)
    for (const ac of p.covers) owners.set(ac, [...(owners.get(ac) ?? []), p.id]);
  for (const [ac, ps] of owners)
    if (ps.length > 1) errors.push(`${ac} is covered by more than one phase: ${ps.join(', ')}`);
  if (prdAcs) {
    for (const ac of prdAcs)
      if (!owners.has(ac)) errors.push(`${ac}: orphan AC, in the PRD but covered by no phase`);
    for (const [ac, ps] of owners)
      if (!prdAcs.has(ac)) errors.push(`${ac}: covered by ${ps.join(', ')} but not in the PRD`);
  }

  if (isPlaceholder(config.gates ?? ''))
    errors.push('Run Config gates is required (one bash command covering what CI runs)');
  for (const [key, allowed] of [['mode', ['autonomous', 'attended']], ['isolation', ['worktree', 'in-place']], ['on_complete', ['pr', 'merge', 'keep']]])
    if (config[key] !== undefined && !allowed.includes(config[key]))
      errors.push(`Run Config ${key} must be one of ${allowed.join('|')}, got "${config[key]}"`);
  for (const key of ['K', 'max_parallel', 'phase_budget', 'run_budget'])
    if (config[key] !== undefined && !/^[1-9]\d*$/.test(config[key]))
      errors.push(`Run Config ${key} must be a positive integer, got "${config[key]}"`);
  const parallel = Number(config.max_parallel) > 1;
  if (parallel && groups.length === 0)
    errors.push(`max_parallel is ${config.max_parallel} but no ## Parallel Groups are declared`);

  // Groups only run concurrently when max_parallel > 1; otherwise a bad group
  // (e.g. the template's example line left in place) is inert, so warn only.
  const groupIssues = parallel ? errors : warnings;
  const groupOf = new Map();
  for (const g of groups) {
    const known = [];
    for (const m of g.members) {
      if (!ids.has(m)) groupIssues.push(`${g.name}: unknown phase "${m}"`);
      else if (groupOf.has(m)) groupIssues.push(`${m} is in both ${groupOf.get(m)} and ${g.name}`);
      else { groupOf.set(m, g.name); known.push(m); }
    }
    for (let i = 0; i < known.length; i++)
      for (let j = i + 1; j < known.length; j++) {
        const [a, b] = [known[i], known[j]];
        if (dependents(phases, a).has(b) || dependents(phases, b).has(a))
          groupIssues.push(`${g.name}: ${a} and ${b} are not independent (dependency path between them)`);
      }
  }
  return { errors: [...graph, ...errors], graph, warnings };
}

// --- entries ---

// Suffix body: tier/process are persisted escalations, iter the red count,
// verify the last verify result over a code snapshot ("pass:<tree>").
// Returns null when the braces hold anything else: then they are part of the
// phase name (e.g. "P3: docs {beta}"), not a suffix.
const VERIFY_RE = /^(?:pass|fail):(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function parseSuffix(raw) {
  const override = {};
  let iter = 0;
  let verify;
  let forced = false;
  let reconciled = false;
  for (const tok of raw.trim().split(/\s+/)) {
    if (tok === 'forced') { forced = true; continue; }
    if (tok === 'reconciled') { reconciled = true; continue; }
    const m = tok.match(/^(tier|process|iter|verify)=(\S+)$/);
    if (!m) return null;
    if (m[1] === 'iter') iter = Number(m[2]) || 0;
    else if (m[1] === 'verify') {
      if (!VERIFY_RE.test(m[2])) return null;
      verify = m[2];
    } else override[m[1]] = m[2];
  }
  return { override: Object.keys(override).length ? override : null, iter, ...(verify && { verify }), ...(forced && { forced }), ...(reconciled && { reconciled }) };
}

// One entry line -> {status, name, override, iter}, or null if not this plan's.
function parseEntry(line, planId) {
  const m = line.match(ENTRY_RE);
  if (!m || m[2] !== planId) return null;
  const suffix = m[5] === undefined ? { override: null, iter: 0 } : parseSuffix(m[5]);
  if (!suffix) return { id: m[3], status: m[1], name: `${m[4]} {${m[5]}}`, override: null, iter: 0 };
  return { id: m[3], status: m[1], name: m[4], ...suffix };
}

// Fixed order so the persisted line is deterministic regardless of bump order.
function formatSuffix(override, iter, verify, forced, reconciled) {
  const parts = [];
  if (override?.tier) parts.push(`tier=${override.tier}`);
  if (override?.process) parts.push(`process=${override.process}`);
  if (iter > 0) parts.push(`iter=${iter}`);
  if (verify) parts.push(`verify=${verify}`);
  if (forced) parts.push('forced');
  if (reconciled) parts.push('reconciled');
  return parts.length ? ` {${parts.join(' ')}}` : '';
}

function parseEntries(text, planId) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const e = parseEntry(line, planId);
    if (e) entries.set(e.id, e);
  }
  return entries;
}

const planLines = (text, planId) => text.split(/\r?\n/).filter(l => parseEntry(l, planId));
const formatEntry = (planId, phaseId, e) =>
  `- [${e.status}] ${planId} ${phaseId}: ${e.name}${formatSuffix(e.override, e.iter, e.verify, e.forced, e.reconciled)}`;

// Rewrite one matched entry line; `fn` receives its current
// {status, name, override, iter, verify, forced} and returns the next one. Whatever it does not
// change is carried over verbatim, so a status flush keeps the suffix and an
// escalation flush keeps the status.
function rewriteEntry(path, planId, phaseId, fn) {
  rewriteLines(path, lines => lines.map(line => {
    const e = parseEntry(line, planId);
    return e?.id === phaseId ? formatEntry(planId, phaseId, fn(e)) : line;
  }));
}

function executable(phases, entries) {
  return phases.filter(p => {
    const e = entries.get(p.id);
    if (!e || e.status !== 'pending') return false;
    return p.depends_on.every(d => entries.get(d)?.status === 'done');
  });
}

// Judged over the PLAN's phases, not the entries: a phase whose entry vanished
// (hand edit, compaction) is not terminal, it is missing.
const allTerminal = (phases, entries) => phases.every(p => TERMINAL.includes(entries.get(p.id)?.status));
const inFlight = (phases, entries) => phases.filter(p => IN_FLIGHT.includes(entries.get(p.id)?.status)).map(p => p.id);
const missing = (phases, entries) => phases.filter(p => !entries.has(p.id)).map(p => p.id);

// Merge an entry's persisted escalation over the plan's static tags. The result
// is what a resumed run must execute: escalated tags win, un-escalated axes fall
// back to the plan. `escalated` echoes only what was overridden; `iter` is the
// persisted red count.
function effective(phase, entries) {
  const e = entries.get(phase.id);
  const merged = { ...phase, iter: e?.iter ?? 0 };
  if (!e?.override) return merged;
  return { ...merged, ...e.override, escalated: e.override };
}

// --- finished record (spec-002 I2/I3, D9/D10): marker in the git common dir + [meta] line ---

const metaRe = id => new RegExp('^- \\[meta\\] ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' finished: action=(\\S+) ref=(\\S*) at=(\\S+)$');
function nowIso() {
  const v = process.env.FORGE_STATE_NOW;
  if (v === undefined || v === '') return new Date().toISOString();
  if (!Number.isFinite(Date.parse(v))) fail('FORGE_STATE_NOW is not a valid ISO 8601 timestamp: ' + v);
  return v;
}

// Marker path, or null outside a git work tree.
function markerPath(id) {
  try { return join(gitCommonDir(process.cwd()), 'forge', id + '.finished.json'); }
  catch { return null; }
}

// --- run lock (spec-002 I3, D9/D11-D13): single driver, heartbeat refreshed by mutating commands ---

const STALE_MIN = 120;
const lockPaths = new Map();
function lockPath(id) {
  if (!lockPaths.has(id)) { const mp = markerPath(id); lockPaths.set(id, mp && mp.replace(/\.finished\.json$/, '.lock.json')); }
  return lockPaths.get(id);
}
// null: no lock file. { corrupt: true }: file present but not a lock. Else the lock.
function readLock(id) {
  const lp = lockPath(id);
  if (!lp || !existsSync(lp)) return null;
  try { const j = JSON.parse(readFileSync(lp, 'utf8')); return j && typeof j.holder === 'string' ? j : { corrupt: true }; }
  catch { return { corrupt: true }; }
}
// Refresh the heartbeat when a lock file exists; never creates one.
function heartbeat(id) {
  const lock = readLock(id);
  if (lock && !lock.corrupt) writeText(lockPath(id), JSON.stringify({ ...lock, heartbeat_at: nowIso() }) + '\n');
}
function releaseLock(id) {
  const lp = lockPath(id);
  if (lp && existsSync(lp)) rmSync(lp, { force: true });
}
// Take the lock for `holder`; refuses (exit 1) while another holder is fresh.
// A lock whose heartbeat does not parse (or a corrupt lock file) counts as stale.
// Returns takeover info when a stale/corrupt lock of another holder was replaced.
function acquireLock(id, holder) {
  const lp = lockPath(id);
  if (!lp) return null;
  const now = nowIso();
  for (let attempt = 0; attempt < 3; attempt++) {
    const prev = readLock(id);
    let takeover = null;
    if (prev?.corrupt) takeover = { lock_takeover: true, previous_holder: null };
    else if (prev && prev.holder !== holder) {
      const age = Math.floor((Date.parse(now) - Date.parse(prev.heartbeat_at)) / 60000);
      if (Number.isFinite(age) && age < STALE_MIN)
        fail(`${id} is driven by ${prev.holder} (heartbeat ${prev.heartbeat_at}, ${age} min ago); stop, or wait until it is stale (${STALE_MIN} min)`);
      takeover = { lock_takeover: true, previous_holder: prev.holder, previous_heartbeat: prev.heartbeat_at };
    }
    const same = prev && !prev.corrupt && prev.holder === holder;
    const text = JSON.stringify({ holder, acquired_at: same ? prev.acquired_at : now, heartbeat_at: now, run_root: process.cwd() }) + '\n';
    if (prev) { writeText(lp, text); return takeover; }
    // No lock yet: create exclusively so two racing seeds cannot both win.
    try { mkdirSync(dirname(lp), { recursive: true }); writeFileSync(lp, text, { flag: 'wx' }); return null; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  fail(`${id}: could not acquire the run lock (contended)`);
}

// {action, ref, at} when EITHER the marker file or the meta line says finished.
function finishedRecord(id, stateText) {
  const mp = markerPath(id);
  if (mp && existsSync(mp)) {
    try {
      const j = JSON.parse(readFileSync(mp, 'utf8'));
      if (j && typeof j.action === 'string') return { action: j.action, ref: j.ref ?? '', at: j.at ?? '' };
    } catch { /* unreadable marker: fall through to the meta line */ }
  }
  const re = metaRe(id);
  for (const line of stateText.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return { action: m[1], ref: m[2], at: m[3] };
  }
  return null;
}

// --- main ---

const args = parseArgs(process.argv.slice(2));
const [cmd, planPath, ...cmdArgs] = args.rest;
if (!cmd || !planPath)
  fail('usage: forge-state.mjs <lint|seed|next|set|red|escalate|recover|status|verify|reconcile|finish|preflight|finished> <plan-file> [args] [--state <path>]');
// `finished` runs before the plan is parsed: INIT calls it from the primary dir, before
// (re)creating the run worktree, where the plan and state may live only on the run branch.
// Read-only: no state write, no lock, no todo.md pointer.
if (cmd === 'finished') {
  const id = basename(planPath).replace(/\.md$/, '');
  const fin = finishedRecord(id, readText(args.state ?? `docs/forge/runs/${id}.state.md`));
  print({ plan: id, finished: Boolean(fin), ...fin });
  process.exit(0);
}
const plan = parsePlan(planPath);
const { planId, phases, config, rawConfig } = plan;
const statePath = args.state ?? `docs/forge/runs/${planId}.state.md`;
const ctxPath = args.contextTodo ?? 'docs/context/todo.md';
// A legacy `--todo docs/context/todo.md` makes todo.md the state file itself:
// then there is nothing to migrate and no pointer to keep.
const norm = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const ctxIsState = norm(ctxPath) === norm(statePath);

// Scaffold's todo.md pointer: one line while the run is open.
const pointerRe = new RegExp(`^- \\[ \\] \\[in_progress\\] forge run ${planId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -> .* \\(forge-state\\)$`);
function ensurePointer() {
  if (ctxIsState || !existsSync(ctxPath)) return;
  if (readText(ctxPath).split(/\r?\n/).some(l => pointerRe.test(l))) return;
  appendLines(ctxPath, [`- [ ] [in_progress] forge run ${planId} -> ${statePath.replace(/\\/g, '/')} (forge-state)`]);
}
function dropPointer() {
  if (!ctxIsState && existsSync(ctxPath)) rewriteLines(ctxPath, lines => lines.filter(l => !pointerRe.test(l)));
}

function loadEntries() {
  const entries = parseEntries(readText(statePath), planId);
  if (entries.size === 0) fail(`no ${planId} entries in ${statePath}: run seed first`);
  return entries;
}

// The plan phase behind a P-id. With `mustHaveEntry` (red, escalate) its state
// entry must exist too; `set` may create a missing one.
function requirePhase(entries, phaseId, usage, mustHaveEntry = true) {
  if (!phaseId) fail(`usage: forge-state.mjs ${usage}`);
  const phase = phases.find(p => p.id === phaseId);
  if (!phase) fail(`${phaseId} is not in the plan ${planId} (${planPath})`);
  if (mustHaveEntry && !entries.has(phaseId)) fail(`no entry for ${planId} ${phaseId} in ${statePath}`);
  return phase;
}

if (cmd === 'lint') {
  const prdAcs = args.prd ? parsePrdAcs(args.prd) : null;
  const { errors, graph, warnings } = lint(plan, prdAcs);
  print({ plan: planId, ok: errors.length === 0, errors, graph_errors: graph, warnings, phases: phases.length,
    ...(prdAcs && { prd_acs: prdAcs.size }) });
  process.exit(errors.length ? 1 : 0);
} else if (cmd === 'seed') {
  // Only state-breaking errors block here; run INIT lints the full contract.
  const done0 = finishedRecord(planId, readText(statePath));
  if (done0) { print({ plan: planId, finished: true, ...done0 }); process.exit(0); }
  const { graph } = lint(plan, null);
  if (graph.length) fail(`plan failed lint, nothing seeded: ${graph.join('; ')}`);
  const takeover = acquireLock(planId, args.holder?.trim() || 'anonymous');
  let migrated = 0;
  if (!ctxIsState && parseEntries(readText(statePath), planId).size === 0 && existsSync(ctxPath)) {
    const legacy = planLines(readText(ctxPath), planId);
    if (legacy.length) {
      appendLines(statePath, legacy);
      rewriteLines(ctxPath, lines => lines.filter(l => !parseEntry(l, planId)));
      migrated = legacy.length;
    }
  }
  const existing = parseEntries(readText(statePath), planId);
  if (existing.size > 0) {
    const finished = allTerminal(phases, existing);
    // A re-invocation after the run ended (e.g. /loop) must not reopen the pointer.
    if (finished) dropPointer(); else ensurePointer();
    print({ plan: planId, seeded: 0, resume: true, existing: existing.size, all_terminal: finished,
      in_flight: inFlight(phases, existing), missing: missing(phases, existing), finished: false, ...(migrated && { migrated }), ...takeover });
  } else {
    appendLines(statePath, phases.map(p => `- [pending] ${planId} ${p.id}: ${p.name}`));
    ensurePointer();
    print({ plan: planId, seeded: phases.length, resume: false, finished: false, ...takeover });
  }
} else if (cmd === 'next') {
  const entries = loadEntries();
  const fin = finishedRecord(planId, readText(statePath));
  const finishedOut = fin ? { finished: true, ...fin } : { finished: false };
  const ready = executable(phases, entries).map(p => effective(p, entries));
  const flying = inFlight(phases, entries);
  const lost = missing(phases, entries);
  if (args.all) {
    print({ plan: planId, phases: ready, all_terminal: allTerminal(phases, entries), in_flight: flying, missing: lost, ...finishedOut });
  } else if (ready.length > 0) {
    print({ plan: planId, phase: ready[0], all_terminal: false, ...finishedOut });
  } else {
    const done = allTerminal(phases, entries);
    // Nothing executable, nothing in flight, not finished: the graph can never
    // progress. Say so instead of letting the loop wait forever.
    const stalled = !done && flying.length === 0;
    print({
      plan: planId,
      phase: null,
      all_terminal: done,
      in_flight: flying,
      stalled,
      missing: lost,
      ...finishedOut,
      non_terminal: [...entries.entries()]
        .filter(([, e]) => !TERMINAL.includes(e.status))
        .map(([id, e]) => ({ id, status: e.status })),
      ...(stalled && {
        waiting: phases
          .filter(p => entries.get(p.id)?.status === 'pending')
          .map(p => ({ id: p.id, unmet: p.depends_on.filter(d => entries.get(d)?.status !== 'done') })),
      }),
    });
  }
} else if (cmd === 'set') {
  const [phaseId, status] = cmdArgs;
  if (!status) fail('usage: forge-state.mjs set <plan-file> <P-id> <status> [--force --reason "<text>"]');
  if (!STATUSES.includes(status)) fail(`invalid status "${status}", one of: ${STATUSES.join(', ')}`);
  const entries = loadEntries();
  const phase = requirePhase(entries, phaseId, 'set <plan-file> <P-id> <status>', false);
  if (args.force && !args.reason?.trim()) fail('--force requires --reason "<text>"');
  const forced = status === 'done' && args.force === true;
  // Evidence gate (C4): done needs a passing verify of exactly the committed code.
  if (status === 'done' && !forced) {
    const verified = entries.get(phaseId)?.verify;
    const vTree = verified?.startsWith('pass:') ? verified.slice(5) : null;
    let head;
    try { head = snapshotHead(process.cwd()); }
    catch (e) {
      const why = String(e.stderr || e.message).trim().split(/\r?\n/).at(-1);
      fail(`${phaseId}: no passing verify for the committed code (not a git work tree: ${why}). Use --force --reason "<text>" only for phases with no code to verify.`);
    }
    if (vTree !== head) {
      let differing = [];
      if (vTree) { try { differing = diffSnapshots(process.cwd(), vTree, head); } catch { /* verified tree gone */ } }
      fail(`${phaseId}: no passing verify for the committed code (verified ${vTree ?? 'none'}, committed ${head})` +
        `${differing.length ? `; differing: ${differing.join(', ')}` : ''}. ` +
        'Run forge-state verify after the last code change, commit with git add -A, then set done.');
    }
  }
  // A plan phase whose entry vanished is re-created, so a missing entry can be
  // repaired after reconciling it against git.
  if (!entries.has(phaseId)) appendLines(statePath, [formatEntry(planId, phaseId, { status, name: phase.name, override: null, iter: 0, ...(forced && { forced }) })]);
  else rewriteEntry(statePath, planId, phaseId, cur => ({ ...cur, status, ...(status === 'done' && { forced, reconciled: forced && cur.reconciled }) }));
  const cascaded = [];
  if (status === 'blocked' || status === 'plan-stale') {
    for (const depId of dependents(phases, phaseId)) {
      if (entries.get(depId)?.status === 'pending') {
        rewriteEntry(statePath, planId, depId, cur => ({ ...cur, status: 'blocked-upstream' }));
        cascaded.push(depId);
      }
    }
  }
  const terminal = allTerminal(phases, parseEntries(readText(statePath), planId));
  if (terminal) { dropPointer(); releaseLock(planId); } else heartbeat(planId);
  print({ plan: planId, phase: phaseId, status, cascaded_blocked_upstream: cascaded, all_terminal: terminal,
    ...(forced && { forced: true, reason: args.reason.trim() }) });
} else if (cmd === 'red') {
  const [phaseId] = cmdArgs;
  const entries = loadEntries();
  const phase = effective(requirePhase(entries, phaseId, 'red <plan-file> <P-id>'), entries);
  const K = Number(config.K ?? DEFAULT_K);
  let iter;
  rewriteEntry(statePath, planId, phaseId, cur => ({ ...cur, iter: (iter = cur.iter + 1) }));
  // The ESCALATE/BLOCK rule, executed: bump the weakest axis (tier first, then
  // process); already senior+heavy means block.
  let decision = 'retry';
  let bump;
  if (iter >= K) {
    if (phase.tier === 'junior') { decision = 'escalate'; bump = { tier: 'senior' }; }
    else if (phase.process === 'light') { decision = 'escalate'; bump = { process: 'heavy' }; }
    else decision = 'block';
  }
  heartbeat(planId);
  print({ plan: planId, phase: phaseId, iter, K, decision, ...(bump && { bump }) });
} else if (cmd === 'escalate') {
  const [phaseId] = cmdArgs;
  const { tier, process: proc } = args;
  if (tier === undefined && proc === undefined) fail('escalate needs at least one of --tier / --process');
  if (tier !== undefined && !TIERS.includes(tier)) fail(`invalid tier "${tier}", one of: ${TIERS.join(', ')}`);
  if (proc !== undefined && !PROCESSES.includes(proc)) fail(`invalid process "${proc}", one of: ${PROCESSES.join(', ')}`);
  const entries = loadEntries();
  const phase = effective(requirePhase(entries, phaseId, 'escalate <plan-file> <P-id> [--tier senior] [--process heavy]'), entries);
  if (tier !== undefined && TIERS.indexOf(tier) <= TIERS.indexOf(phase.tier))
    fail(`--tier ${tier} is not an escalation for ${phaseId} (current: ${phase.tier}); tags only go UP`);
  if (proc !== undefined && PROCESSES.indexOf(proc) <= PROCESSES.indexOf(phase.process))
    fail(`--process ${proc} is not an escalation for ${phaseId} (current: ${phase.process}); tags only go UP`);
  const add = {};
  if (tier !== undefined) add.tier = tier;
  if (proc !== undefined) add.process = proc;
  let merged;
  // A bump starts a fresh K window: iter resets to 0.
  rewriteEntry(statePath, planId, phaseId, cur => ({ ...cur, override: (merged = { ...cur.override, ...add }), iter: 0 }));
  heartbeat(planId);
  print({ plan: planId, phase: phaseId, escalated: merged });
} else if (cmd === 'recover') {
  const entries = loadEntries();
  const recovered = inFlight(phases, entries);
  for (const id of recovered) rewriteEntry(statePath, planId, id, cur => ({ ...cur, status: 'pending' }));
  heartbeat(planId);
  print({ plan: planId, recovered });
} else if (cmd === 'status') {
  const entries = loadEntries();
  const counts = {};
  for (const e of entries.values()) counts[e.status] = (counts[e.status] ?? 0) + 1;
  print({ plan: planId, total: entries.size, counts, all_terminal: allTerminal(phases, entries),
    in_flight: inFlight(phases, entries), missing: missing(phases, entries) });
} else if (cmd === 'verify') {
  const [phaseId] = cmdArgs;
  const entries = loadEntries();
  const phase = requirePhase(entries, phaseId, 'verify <plan-file> <P-id> [--prd <prd-file>] [--gates "<cmd>"]');
  const manual = new Set();
  if (args.prd) parsePrdAcs(args.prd, manual);
  // The plan's gates are frozen; --gates only stands in for a plan seeded
  // before gates existed (or still holding the template placeholder).
  const planGates = isPlaceholder(config.gates ?? '') ? null : gatesCommand(rawConfig.gates);
  if (planGates && args.gates !== undefined && args.gates.trim() !== planGates)
    fail(`plan has gates (${planGates}); --gates is only for plans without gates`);
  const gates = planGates ?? args.gates?.trim();
  if (!gates) fail('plan has no gates: pass --gates "<cmd>"');
  const cwd = process.cwd();
  // D6: snapshot BEFORE the gates, so artifacts they write cannot count.
  let snapshot;
  try { snapshot = snapshotWorktree(cwd); }
  catch (e) {
    // git's last stderr line carries the reason; earlier lines are warnings.
    const why = String(e.stderr || e.message).trim().split(/\r?\n/).at(-1);
    fail(`verify needs a git work tree at ${cwd}: ${why}`);
  }
  // A covered AC not tagged [manual-check] must be named by some test file.
  const untested = args.prd ? findUntestedAcs(cwd, phase.covers.filter(ac => !manual.has(ac))) : [];
  const result = runGates(gates, cwd);
  const pass = result.exit_code === 0 && untested.length === 0;
  rewriteEntry(statePath, planId, phaseId, cur => ({ ...cur, verify: `${pass ? 'pass' : 'fail'}:${snapshot}` }));
  heartbeat(planId);
  print({ plan: planId, phase: phaseId, snapshot, gates, shell: result.shell, exit_code: result.exit_code,
    untested_acs: untested, pass, tail: result.tail });
} else if (cmd === 'reconcile') {
  const entries = loadEntries();
  let commits;
  try { commits = phaseCommitList(process.cwd()); }
  catch (e) { fail(`reconcile needs a git work tree at ${process.cwd()}: ${String(e.stderr || e.message).trim().split(/\r?\n/).at(-1)}`); }
  const reconciled = [];
  const unchanged = [];
  for (const p of phases) {
    const cur = entries.get(p.id);
    if (cur?.status === 'done' || !commits.some(c => c.id === p.id && (c.subject === `${p.id}: ${p.name}` || c.subject.startsWith(`${p.id}: ${p.name} `)))) { unchanged.push(p.id); continue; }
    // D14: the commit is the evidence; no verify gate.
    if (cur) rewriteEntry(statePath, planId, p.id, c => ({ ...c, status: 'done', reconciled: true }));
    else appendLines(statePath, [formatEntry(planId, p.id, { status: 'done', name: p.name, override: null, iter: 0, reconciled: true })]);
    reconciled.push(p.id);
  }
  if (allTerminal(phases, parseEntries(readText(statePath), planId))) dropPointer();
  heartbeat(planId);
  print({ plan: planId, reconciled, unchanged });
} else if (cmd === 'finish') {
  if (!['pr', 'merge', 'keep'].includes(args.action)) fail('usage: forge-state.mjs finish <plan-file> --action pr|merge|keep [--ref <url-or-sha-or-branch>]');
  const ref = args.ref ?? '';
  if (/\s/.test(ref)) fail('--ref must not contain whitespace');
  const prior = finishedRecord(planId, readText(statePath));
  if (prior) fail(`${planId} already finished (${[prior.action, prior.ref].filter(Boolean).join(' ')} at ${prior.at})`);
  const rec = { action: args.action, ref, at: nowIso() };
  const mp = markerPath(planId);
  if (mp) writeText(mp, JSON.stringify(rec) + '\n');
  appendLines(statePath, [`- [meta] ${planId} finished: action=${rec.action} ref=${rec.ref} at=${rec.at}`]);
  dropPointer();
  releaseLock(planId);
  print({ plan: planId, finished: rec });
} else if (cmd === 'preflight') {
  const errors = [];
  let remote = false;
  try { remote = hasRemote(process.cwd()); } catch { /* not a git work tree: no remote */ }
  const mode = config.on_complete ?? 'pr';
  if ((mode === 'pr' || mode === 'merge') && !remote)
    errors.push(`on_complete ${mode} needs a git remote; add one or set keep`);
  print({ plan: planId, ok: errors.length === 0, errors, checks: { remote } });
  process.exit(errors.length ? 1 : 0);
} else {
  fail(`unknown command "${cmd}"`);
}
