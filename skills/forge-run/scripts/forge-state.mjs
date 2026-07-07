#!/usr/bin/env node
// forge-state — deterministic todo.md state machine for forge-master runs.
// Owns the canonical entry format:  - [status] plan-NNN P<n>: <name>
//
// Usage:
//   node forge-state.mjs seed   <plan-file> [--todo <path>]
//   node forge-state.mjs next   <plan-file> [--all] [--todo <path>]
//   node forge-state.mjs set    <plan-file> <P-id> <status> [--todo <path>]
//   node forge-state.mjs status <plan-file> [--todo <path>]
//
// All commands print JSON to stdout. Errors go to stderr with exit code 1.
// `set blocked|plan-stale` cascades [blocked-upstream] to every pending
// transitive dependent — same rule as the run skill, executed not reasoned.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const NON_TERMINAL = ['pending', 'in_progress', 'in_progress-parallel'];
const TERMINAL = ['done', 'blocked', 'blocked-upstream', 'plan-stale'];
const STATUSES = [...NON_TERMINAL, ...TERMINAL];
const ENTRY_RE = /^- \[([a-z_-]+)\] (plan-\S+) (P\d+): (.*)$/;

function fail(msg) {
  process.stderr.write(`forge-state: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--todo') args.todo = argv[++i];
    else if (argv[i] === '--all') args.all = true;
    else args.rest.push(argv[i]);
  }
  return args;
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
    if (m && m[2] === planId) entries.set(m[3], { status: m[1], name: m[4] });
  }
  return entries;
}

function writeEntryStatus(todoPath, planId, phaseId, status) {
  const lines = readTodo(todoPath).split(/\r?\n/);
  const out = lines.map(line => {
    const m = line.match(ENTRY_RE);
    if (m && m[2] === planId && m[3] === phaseId)
      return `- [${status}] ${planId} ${phaseId}: ${m[4]}`;
    return line;
  });
  writeFileSync(todoPath, out.join('\n'));
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

const { rest, todo, all } = parseArgs(process.argv.slice(2));
const [cmd, planPath, ...cmdArgs] = rest;
if (!cmd || !planPath) fail('usage: forge-state.mjs <seed|next|set|status> <plan-file> [args] [--todo <path>]');
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
  const ready = executable(phases, entries);
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
} else if (cmd === 'status') {
  const entries = parseEntries(readTodo(todoPath), planId);
  if (entries.size === 0) fail(`no ${planId} entries in ${todoPath} — run seed first`);
  const counts = {};
  for (const e of entries.values()) counts[e.status] = (counts[e.status] ?? 0) + 1;
  print({ plan: planId, total: entries.size, counts, all_terminal: allTerminal(entries) });
} else {
  fail(`unknown command "${cmd}"`);
}
