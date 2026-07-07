#!/usr/bin/env node
// forge-state — deterministic todo.md state machine for forge-master runs.
// Owns the canonical entry format:  - [status] plan-NNN P<n>: <name> [{tier=… process=…}]
//
// Usage:
//   node forge-state.mjs seed     <plan-file> [--todo <path>]
//   node forge-state.mjs next     <plan-file> [--all] [--todo <path>]
//   node forge-state.mjs set      <plan-file> <P-id> <status> [--todo <path>]
//   node forge-state.mjs escalate <plan-file> <P-id> [--tier senior] [--process heavy] [--todo <path>]
//   node forge-state.mjs status   <plan-file> [--todo <path>]
//
// `escalate` persists the runtime tier/process bump onto the entry line so a
// resumed run re-reads the escalated tags instead of the original plan tags;
// `next` merges that suffix over the plan and echoes it as `escalated`.
//
// All commands print JSON to stdout. Errors go to stderr with exit code 1.
// `set blocked|plan-stale` cascades [blocked-upstream] to every pending
// transitive dependent — same rule as the run skill, executed not reasoned.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const NON_TERMINAL = ['pending', 'in_progress', 'in_progress-parallel'];
const TERMINAL = ['done', 'blocked', 'blocked-upstream', 'plan-stale'];
const STATUSES = [...NON_TERMINAL, ...TERMINAL];
const TIERS = ['junior', 'senior'];
const PROCESSES = ['light', 'heavy'];
// Canonical entry, with an OPTIONAL trailing escalation suffix persisted at runtime:
//   - [status] plan-NNN P<n>: <name> {tier=senior process=heavy}
// Group 4 is the phase name (non-greedy so it never eats the braces); group 5 is
// the raw override body when present. next merges group 5 over the plan's tags.
const ENTRY_RE = /^- \[([a-z_-]+)\] (plan-\S+) (P\d+): (.*?)(?:\s+\{([^}]*)\})?$/;

function fail(msg) {
  process.stderr.write(`forge-state: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--todo') args.todo = argv[++i];
    else if (argv[i] === '--all') args.all = true;
    else if (argv[i] === '--tier') args.tier = argv[++i];
    else if (argv[i] === '--process') args.process = argv[++i];
    else args.rest.push(argv[i]);
  }
  return args;
}

// Escalation suffix helpers. Only tier/process are recognised; order is fixed so
// the persisted line is deterministic regardless of the bump order.
function parseOverride(raw) {
  if (!raw) return null;
  const o = {};
  for (const tok of raw.trim().split(/\s+/)) {
    const [k, v] = tok.split('=');
    if (k && v) o[k] = v;
  }
  return Object.keys(o).length ? o : null;
}

function formatOverride(o) {
  if (!o) return '';
  const parts = [];
  if (o.tier) parts.push(`tier=${o.tier}`);
  if (o.process) parts.push(`process=${o.process}`);
  return parts.length ? ` {${parts.join(' ')}}` : '';
}

function parsePlan(planPath) {
  if (!existsSync(planPath)) fail(`plan file not found: ${planPath}`);
  const planId = basename(planPath).replace(/\.md$/, '');
  const phases = [];
  let current = null;
  for (const line of readFileSync(planPath, 'utf8').split(/\r?\n/)) {
    const head = line.match(/^### (P\d+): (.*)$/);
    if (head) {
      current = { id: head[1], name: head[2].trim(), covers: [], depends_on: [] };
      phases.push(current);
      continue;
    }
    if (/^#/.test(line)) { current = null; continue; }
    if (!current) continue;
    const field = line.match(/^- (covers|depends_on|tier|process|success|notes): (.*)$/);
    if (!field) continue;
    const [, key, raw] = field;
    const value = raw.replace(/#.*$/, '').trim();
    if (key === 'covers') current.covers = value.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'depends_on')
      current.depends_on = value === '-' ? [] : value.split(',').map(s => s.trim()).filter(Boolean);
    else current[key] = value;
  }
  if (phases.length === 0) fail(`no "### P<n>:" phases found in ${planPath}`);
  return { planId, phases };
}

function readTodo(todoPath) {
  return existsSync(todoPath) ? readFileSync(todoPath, 'utf8') : '';
}

function parseEntries(todoText, planId) {
  const entries = new Map();
  for (const line of todoText.split(/\r?\n/)) {
    const m = line.match(ENTRY_RE);
    if (m && m[2] === planId)
      entries.set(m[3], { status: m[1], name: m[4], override: parseOverride(m[5]) });
  }
  return entries;
}

// Rewrite one matched entry line; `fn` receives its current
// {status, name, override} and returns the next one. Whichever field it does not
// change is carried over verbatim, so a status flush keeps the escalation suffix
// and an escalation flush keeps the status.
function rewriteEntry(todoPath, planId, phaseId, fn) {
  const lines = readTodo(todoPath).split(/\r?\n/);
  const out = lines.map(line => {
    const m = line.match(ENTRY_RE);
    if (m && m[2] === planId && m[3] === phaseId) {
      const cur = { status: m[1], name: m[4], override: parseOverride(m[5]) };
      const next = fn(cur);
      return `- [${next.status}] ${planId} ${phaseId}: ${next.name}${formatOverride(next.override)}`;
    }
    return line;
  });
  writeFileSync(todoPath, out.join('\n'));
}

function writeEntryStatus(todoPath, planId, phaseId, status) {
  rewriteEntry(todoPath, planId, phaseId, cur => ({ ...cur, status }));
}

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

function executable(phases, entries) {
  return phases.filter(p => {
    const e = entries.get(p.id);
    if (!e || e.status !== 'pending') return false;
    return p.depends_on.every(d => entries.get(d)?.status === 'done');
  });
}

function allTerminal(entries) {
  return [...entries.values()].every(e => TERMINAL.includes(e.status));
}

// Merge an entry's persisted escalation over the plan's static tags. The result
// is what a resumed run must execute — escalated tags win, un-escalated axes fall
// back to the plan. `escalated` echoes only what was overridden.
function withEscalation(phase, entries) {
  const o = entries.get(phase.id)?.override;
  if (!o) return phase;
  return { ...phase, ...o, escalated: o };
}

const { rest, todo, all, tier, process: procTag } = parseArgs(process.argv.slice(2));
const [cmd, planPath, ...cmdArgs] = rest;
if (!cmd || !planPath) fail('usage: forge-state.mjs <seed|next|set|escalate|status> <plan-file> [args] [--todo <path>]');
const todoPath = todo ?? 'docs/context/todo.md';
const { planId, phases } = parsePlan(planPath);
const print = obj => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

if (cmd === 'seed') {
  const existing = parseEntries(readTodo(todoPath), planId);
  if (existing.size > 0) {
    print({ plan: planId, seeded: 0, resume: true, existing: existing.size });
  } else {
    let text = readTodo(todoPath);
    if (text && !text.endsWith('\n')) text += '\n';
    text += phases.map(p => `- [pending] ${planId} ${p.id}: ${p.name}`).join('\n') + '\n';
    writeFileSync(todoPath, text);
    print({ plan: planId, seeded: phases.length, resume: false });
  }
} else if (cmd === 'next') {
  const entries = parseEntries(readTodo(todoPath), planId);
  if (entries.size === 0) fail(`no ${planId} entries in ${todoPath} — run seed first`);
  const ready = executable(phases, entries).map(p => withEscalation(p, entries));
  if (all) {
    print({ plan: planId, phases: ready, all_terminal: allTerminal(entries) });
  } else if (ready.length > 0) {
    print({ plan: planId, phase: ready[0], all_terminal: false });
  } else {
    print({
      plan: planId,
      phase: null,
      all_terminal: allTerminal(entries),
      non_terminal: [...entries.entries()]
        .filter(([, e]) => !TERMINAL.includes(e.status))
        .map(([id, e]) => ({ id, status: e.status })),
    });
  }
} else if (cmd === 'set') {
  const [phaseId, status] = cmdArgs;
  if (!phaseId || !status) fail('usage: forge-state.mjs set <plan-file> <P-id> <status>');
  if (!STATUSES.includes(status)) fail(`invalid status "${status}" — one of: ${STATUSES.join(', ')}`);
  const entries = parseEntries(readTodo(todoPath), planId);
  if (!entries.has(phaseId)) fail(`no entry for ${planId} ${phaseId} in ${todoPath}`);
  writeEntryStatus(todoPath, planId, phaseId, status);
  const cascaded = [];
  if (status === 'blocked' || status === 'plan-stale') {
    for (const depId of dependents(phases, phaseId)) {
      if (parseEntries(readTodo(todoPath), planId).get(depId)?.status === 'pending') {
        writeEntryStatus(todoPath, planId, depId, 'blocked-upstream');
        cascaded.push(depId);
      }
    }
  }
  print({ plan: planId, phase: phaseId, status, cascaded_blocked_upstream: cascaded });
} else if (cmd === 'escalate') {
  const [phaseId] = cmdArgs;
  if (!phaseId) fail('usage: forge-state.mjs escalate <plan-file> <P-id> [--tier senior] [--process heavy]');
  if (tier === undefined && procTag === undefined)
    fail('escalate needs at least one of --tier / --process');
  if (tier !== undefined && !TIERS.includes(tier))
    fail(`invalid tier "${tier}" — one of: ${TIERS.join(', ')}`);
  if (procTag !== undefined && !PROCESSES.includes(procTag))
    fail(`invalid process "${procTag}" — one of: ${PROCESSES.join(', ')}`);
  const entries = parseEntries(readTodo(todoPath), planId);
  if (!entries.has(phaseId)) fail(`no entry for ${planId} ${phaseId} in ${todoPath}`);
  const add = {};
  if (tier !== undefined) add.tier = tier;
  if (procTag !== undefined) add.process = procTag;
  let merged;
  rewriteEntry(todoPath, planId, phaseId, cur => {
    merged = { ...cur.override, ...add };
    return { ...cur, override: merged };
  });
  print({ plan: planId, phase: phaseId, escalated: merged });
} else if (cmd === 'status') {
  const entries = parseEntries(readTodo(todoPath), planId);
  if (entries.size === 0) fail(`no ${planId} entries in ${todoPath} — run seed first`);
  const counts = {};
  for (const e of entries.values()) counts[e.status] = (counts[e.status] ?? 0) + 1;
  print({ plan: planId, total: entries.size, counts, all_terminal: allTerminal(entries) });
} else {
  fail(`unknown command "${cmd}"`);
}
