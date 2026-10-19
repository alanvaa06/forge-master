// validate.mjs — structural acceptance test for the forge-master plugin.
// Dependency-free Node ESM. Exit 0 = all green, non-zero = failures.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let failures = 0;
const asc = (m) => String(m).replace(/[^ -~]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const fail = (m) => { console.error('FAIL: ' + asc(m)); failures++; };
const ok = (m) => console.log('ok:   ' + asc(m));

// 1. Manifest parses and identifies the plugin.
const PJ = '.claude-plugin/plugin.json';
if (!existsSync(PJ)) {
  fail(PJ + ' missing');
} else {
  try {
    const j = JSON.parse(readFileSync(PJ, 'utf8'));
    if (j.name !== 'forge-master') fail(`${PJ}: name is "${j.name}", expected "forge-master"`);
    else ok(`${PJ} valid JSON, name=forge-master`);
    if (!j.description) fail(`${PJ}: missing description`);
    if (!j.version) fail(`${PJ}: missing version`);
    for (const f of ['displayName', 'homepage', 'repository', 'license']) {
      if (!j[f]) fail(`${PJ}: missing ${f}`);
    }
  } catch (e) {
    fail(`${PJ} invalid JSON: ${e.message}`);
  }
}

// 1b. Marketplace manifest — required for GitHub install. ONE plugin entry, source = repo root.
const MP = '.claude-plugin/marketplace.json';
if (!existsSync(MP)) {
  fail(MP + ' missing');
} else {
  try {
    const m = JSON.parse(readFileSync(MP, 'utf8'));
    if (m.name !== 'forge-master') fail(`${MP}: name is "${m.name}", expected "forge-master"`);
    if (!m.owner?.name) fail(`${MP}: missing owner.name`);
    if (!Array.isArray(m.plugins) || m.plugins.length !== 1) fail(`${MP}: must list exactly one plugin (the repo itself)`);
    else {
      const p = m.plugins[0];
      if (p.name !== 'forge-master') fail(`${MP}: plugins[0].name must be "forge-master"`);
      if (p.source !== './') fail(`${MP}: plugins[0].source must be "./" (repo root)`);
      if (!p.description) fail(`${MP}: plugins[0] missing description`);
    }
    if (!failures) ok(`${MP} valid, single root-plugin entry`);
  } catch (e) {
    fail(`${MP} invalid JSON: ${e.message}`);
  }
}

// 1c. License file must exist when plugin.json declares a license.
if (!existsSync('LICENSE')) fail('LICENSE file missing');

// 2. Each skill: file exists, frontmatter has the right name + a description,
//    body contains the load-bearing section markers from the design.
const SKILLS = [
  {
    path: 'skills/forge/SKILL.md',
    name: 'forge',
    markers: ['## Stage', 'prd-design', 'spec-design', 'plan-design', 'existing artifact', 'never skip a gate'],
  },
  {
    path: 'skills/prd-design/SKILL.md',
    name: 'prd-design',
    markers: ['## Interview', 'Given/When/Then', 'Non-Goals', 'Definition of Done', 'gate 1', '## Divergent'],
  },
  {
    path: 'skills/prd-import/SKILL.md',
    name: 'prd-import',
    markers: ['## Adjustments', 'Given/When/Then', 'Non-Goals', '[manual-check]', 'gate 1'],
  },
  {
    path: 'skills/spec-design/SKILL.md',
    name: 'spec-design',
    markers: ['## Architecture', 'Interfaces', 'File Map', 'docs/forge/specs/spec-', 'OPTIONAL', 'gate 1.5'],
  },
  {
    path: 'skills/plan-design/SKILL.md',
    name: 'plan-design',
    markers: ['covers', 'depends_on', 'lessons.md', 'Total coverage', 'gate 2', 'spec-NNN.md', 'Parallel Groups', 'budget', 'forge-state.mjs" lint', 'P0: setup test harness',
      'gates:', '.github/workflows', 'forge-state.mjs" preflight', '⛔ no remote', 'approve option withheld'],
    absent: ['EXCEPT the one hard block', 'the only blocker'],
  },
  {
    path: 'skills/budget/SKILL.md',
    name: 'budget',
    markers: ['## Budget Matrix', 'phase_budget', 'run_budget', 'order-of-magnitude', 'OPTIONAL', 'gate 2', 'never a gate'],
  },
  {
    path: 'skills/forge-run/SKILL.md',
    name: 'run',
    markers: [
      'INIT', 'LOOP', 'ESCALATE', 'BLOCK', 'todo.md', 'full repo suite', 'spec section',
      '## Attended mode', 'references/tdd.md', 'references/code-review.md', 'test-after',
      'on_complete', '[plan-stale]', 'plan assumption broken', '## Finish stage',
      'dispatch.md', 'inline execution', 'subagent-driven', 'debugging.md', 'parallel.md',
      'forge-state.mjs', 'blocked-upstream', '/goal', '/loop',
      'forge-state.mjs" lint', 'forge-state recover', 'forge-state red', 'docs/forge/runs/', 'stalled', 'sesion-log.md',
      'forge-state verify', 'timeout 600000', 'git add -A', 'forge-state reconcile', 'forge-state preflight',
      'forge-state finish', 'finished: true', 'cancel any `/loop`', '--holder ${CLAUDE_SESSION_ID}',
      'forge-master:forge-implementer-', 'forge-master:forge-reviewer', '--reason',
      'ok: false', 'forge: finish plan-', 'git worktree add <path> forge/NNN-<slug>',
      'plan-NNN.lock.json', 'only for phases with no code to verify', 'INIT and the LOOP',
    ],
    absent: ['git log --oneline --grep', 'git log --grep', 'First make sure no other session', 'implement -> write & run the covered-AC tests -> commit.', 'reconcile`: INIT only'],
  },
];

// 2b. Progressive-disclosure reference files for the run loop.
const REFS = [
  {
    path: 'skills/forge-run/references/tdd.md',
    markers: ['Iron Law', 'MUST fail', 'violation', 'red-green', 'minimal implementation'],
  },
  {
    path: 'skills/forge-run/references/code-review.md',
    markers: ['blocker', 'nit', 'iter', 'AC coverage', 'regression risk', 'verified against the code', 'incorrect-with-evidence',
      'forge-master:forge-reviewer', 'read-only', 'verdict: approve', 'verdict: blockers', 'working directory', 'implementer reports it, the orchestrator records'],
  },
  {
    path: 'skills/forge-run/references/dispatch.md',
    markers: ['signal', 'done | stuck | plan-assumption-broken', 'Freshness', 'hypotheses',
      'forge-master:forge-implementer-', 'forge-implementer-<tier>', 'orchestrator owns every commit', 'every state write', 'phase worktrees'],
  },
  {
    path: 'skills/forge-run/references/debugging.md',
    markers: ['falsifiable', 'dead', 'shotgun'],
  },
  {
    path: 'skills/forge-run/references/parallel.md',
    markers: ['worktree', 'file-disjoint', 'integration failure', 'max_parallel',
      'forge-state verify', 'orchestrator commits', '--state', 'git merge --squash', 'wip P<n>', 'timeout 600000'],
    absent: ['the orchestrator commits in the phase worktree (`git add -A`, subject `P<n>: <name>`)'],
  },
];
for (const r of REFS) {
  if (!existsSync(r.path)) { fail(r.path + ' missing'); continue; }
  const text = readFileSync(r.path, 'utf8');
  let bad = 0;
  for (const m of r.markers) {
    if (!text.includes(m)) { fail(`${r.path}: missing required marker "${m}"`); bad++; }
  }
  for (const m of r.absent || []) {
    if (text.includes(m)) { fail(`${r.path}: superseded text must be absent: "${m}"`); bad++; }
  }
  if (!bad) ok(`${r.path} checked`);
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;
for (const s of SKILLS) {
  if (!existsSync(s.path)) { fail(s.path + ' missing'); continue; }
  const text = readFileSync(s.path, 'utf8');
  const fm = text.match(FM);
  if (!fm) { fail(s.path + ' missing YAML frontmatter'); }
  else {
    if (!new RegExp(`name:\\s*${s.name}\\b`).test(fm[1])) fail(`${s.path}: frontmatter name != ${s.name}`);
    else ok(`${s.path} name=${s.name}`);
    if (!/description:\s*\S/.test(fm[1])) fail(`${s.path}: missing/empty description`);
  }
  for (const m of s.markers) {
    if (!text.includes(m)) fail(`${s.path}: missing required marker "${m}"`);
  }
  if (s.name === 'run') {
    const lp = text.slice(text.indexOf('## LOOP'));
    const iv = lp.indexOf('forge-state verify'), id = lp.indexOf('forge-state set <P> done');
    if (iv < 0 || id < 0 || iv > id) fail(s.path + ': LOOP must call forge-state verify before forge-state set <P> done');
    const fi = text.indexOf("If it reports `finished: true`");
    const fin = text.slice(fi, fi + 400);
    for (const w of ['`action`', '`ref`', 'STOP']) if (fi < 0 || !fin.includes(w)) fail(s.path + ': finished stop must mention ' + w);
  }
  for (const m of s.absent || []) {
    if (text.includes(m)) fail(`${s.path}: superseded text must be absent: "${m}"`);
  }
}

// 2b2. Agent definitions (spec-002 I7, D3, D19, AC-1.1): frontmatter name/description/model/effort,
//      description pinned to the I7 string (no "proactively"), reviewer tools exactly Read/Grep/Glob
//      with Edit/Write/NotebookEdit/Bash disallowed, bodies reference plugin files via ${CLAUDE_PLUGIN_ROOT}.
const AGENT_DESC = 'Internal to forge-master runs: dispatched only by the /forge-master:run orchestrator. Not for general tasks.';
const AGENTS = [
  { path: 'agents/forge-implementer-junior.md', name: 'forge-implementer-junior', model: 'sonnet', effort: 'low' },
  { path: 'agents/forge-implementer-senior.md', name: 'forge-implementer-senior', model: 'opus', effort: 'high' },
  { path: 'agents/forge-reviewer.md', name: 'forge-reviewer', model: 'opus', effort: 'high', reviewer: true },
];
const yamlVal = (v) => v.trim().replace(/^\[|\]$/g, '').trim().replace(/^(["'])(.*)\1$/, '$2');
const yamlList = (v) => (v === null ? [] : v.split(',').map((x) => yamlVal(x)).filter(Boolean));
for (const a of AGENTS) {
  if (!existsSync(a.path)) { fail(a.path + ' missing'); continue; }
  const atext = readFileSync(a.path, 'utf8').replace(/^\uFEFF/, '');
  const afm = atext.match(FM);
  if (!afm) { fail(a.path + ' missing YAML frontmatter'); continue; }
  const field = (k) => { const m = afm[1].match(new RegExp('^' + k + ':[ \t]*(.*)$', 'm')); return m ? yamlVal(m[1]) : null; };
  const rawField = (k) => { const m = afm[1].match(new RegExp('^' + k + ':[ \t]*(.*)$', 'm')); return m ? m[1].trim().replace(/^\[|\]$/g, '') : null; };
  let bad = false;
  if (field('name') !== a.name) { fail(`${a.path}: frontmatter name != ${a.name}`); bad = true; }
  if (field('model') !== a.model) { fail(`${a.path}: frontmatter model != ${a.model}`); bad = true; }
  if (field('effort') !== a.effort) { fail(`${a.path}: frontmatter effort != ${a.effort}`); bad = true; }
  const desc = field('description');
  if (!desc) { fail(`${a.path}: missing/empty description`); bad = true; }
  else {
    if (/proactively/i.test(desc)) { fail(`${a.path}: description must not say "proactively" (D19)`); bad = true; }
    if (desc !== AGENT_DESC) { fail(`${a.path}: description != I7 string`); bad = true; }
  }
  if (a.reviewer) {
    const dis = yamlList(rawField('disallowedTools'));
    for (const t of ['Edit', 'Write', 'NotebookEdit', 'Bash']) {
      if (!dis.includes(t)) { fail(`${a.path}: disallowedTools must include ${t}`); bad = true; }
    }
    const tools = yamlList(rawField('tools')).sort().join(',');
    if (tools !== 'Glob,Grep,Read') { fail(`${a.path}: tools must be exactly Read, Grep, Glob (D3)`); bad = true; }
  }
  if (/(?<!\$\{CLAUDE_PLUGIN_ROOT\}\/)skills\/forge-run\/references\//.test(atext.slice(afm[0].length))) {
    fail(`${a.path}: body references skills/forge-run/references/ without the \${CLAUDE_PLUGIN_ROOT}/ prefix`); bad = true;
  }
  if (!bad) ok(`${a.path} frontmatter`);
}

// 2c. State script: exists and its unit tests pass (deterministic run-state bookkeeping).
const STATE = 'skills/forge-run/scripts/forge-state.mjs';
const STATE_TEST = 'skills/forge-run/scripts/forge-state.test.mjs';
if (!existsSync(STATE)) fail(STATE + ' missing');
if (!existsSync(STATE_TEST)) fail(STATE_TEST + ' missing');
if (existsSync(STATE) && existsSync(STATE_TEST)) {
  try {
    execFileSync(process.execPath, ['--test', STATE_TEST], { stdio: 'pipe' });
    ok(`${STATE} unit tests pass`);
  } catch (e) {
    fail(`${STATE} unit tests failed — run: node --test ${STATE_TEST}`);
  }
}

// 2d. Every *.test.mjs under skills/ and hooks/ joins the gate (hooks/ may not exist yet).
const testFiles = [];
const walk = (d) => {
  if (!existsSync(d)) return;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const q = d + '/' + e.name;
    if (e.isDirectory()) walk(q);
    else if (e.name.endsWith('.test.mjs') && q !== STATE_TEST) testFiles.push(q);
  }
};
walk('skills'); walk('hooks');
for (const tf of testFiles) {
  try {
    execFileSync(process.execPath, ['--test', tf], { stdio: 'pipe' });
    ok(`${tf} unit tests pass`);
  } catch (e) {
    fail(`${tf} unit tests failed - run: node --test ${tf}`);
  }
}

// 2e. Guard hook registration (spec-002 I6, D18): hooks/hooks.json registers a PreToolUse
//     command hook whose matcher covers the guarded tools and whose command + args
//     reference ${CLAUDE_PLUGIN_ROOT} (exec form or string form both accepted).
const HJ = 'hooks/hooks.json';
if (!existsSync(HJ)) {
  fail(HJ + ' missing');
} else {
  try {
    const h = JSON.parse(readFileSync(HJ, 'utf8'));
    const entries = h.hooks?.PreToolUse;
    if (!Array.isArray(entries)) throw new Error('hooks.PreToolUse is not an array');
    const covers = (matcher, tool) =>
      matcher === undefined || matcher === '' || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(tool);
    const guarded = ['Edit', 'Write', 'NotebookEdit', 'Bash'];
    const good = entries.some((e) =>
      guarded.every((t) => covers(e.matcher, t)) &&
      (e.hooks ?? []).some((c) => c.type === 'command' &&
        [c.command, ...(Array.isArray(c.args) ? c.args : [])].some((s) => typeof s === 'string' && s.includes('${CLAUDE_PLUGIN_ROOT}'))));
    if (!good) fail(`${HJ}: no PreToolUse command hook whose matcher covers ${guarded.join('|')} and whose command/args reference \${CLAUDE_PLUGIN_ROOT}`);
    else ok(`${HJ} registers the PreToolUse guard (${guarded.join('|')}, \${CLAUDE_PLUGIN_ROOT})`);
  } catch (e) {
    fail(`${HJ} invalid: ${e.message}`);
  }
}

// 3. Plan template skeleton.
const TPL = 'templates/plan-template.md';
if (!existsSync(TPL)) {
  fail(TPL + ' missing');
} else {
  const t = readFileSync(TPL, 'utf8');
  let bad = 0;
  for (const m of ['## Run Config', '## Phases', 'covers:', 'depends_on:', 'tier:', 'process:', 'mode:', 'attended', 'on_complete:', 'pr | merge | keep', 'max_parallel:', 'gates:']) {
    if (!t.includes(m)) { fail(`${TPL}: missing "${m}"`); bad++; }
  }
  if (!bad) ok(`${TPL} checked`);
}

// 4. Spec template skeleton.
const STPL = 'templates/spec-template.md';
if (!existsSync(STPL)) {
  fail(STPL + ' missing');
} else {
  const t = readFileSync(STPL, 'utf8');
  let bad = 0;
  for (const m of ['## Architecture', '## Interfaces', '## File Map', '## Decisions', '## Risks', 'PRD:']) {
    if (!t.includes(m)) { fail(`${STPL}: missing "${m}"`); bad++; }
  }
  if (!bad) ok(`${STPL} checked`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
process.exit(0);
