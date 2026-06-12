// validate.mjs — structural acceptance test for the forge-master plugin.
// Dependency-free Node ESM. Exit 0 = all green, non-zero = failures.
import { readFileSync, existsSync } from 'node:fs';

let failures = 0;
const fail = (m) => { console.error('FAIL: ' + m); failures++; };
const ok = (m) => console.log('ok:   ' + m);

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
    markers: ['## Architecture', 'Interfaces', 'File Map', 'docs/context/spec-', 'OPTIONAL', 'gate 1.5'],
  },
  {
    path: 'skills/plan-design/SKILL.md',
    name: 'plan-design',
    markers: ['covers', 'depends_on', 'lessons.md', 'Total coverage', 'gate 2', 'spec-NNN.md'],
  },
  {
    path: 'skills/forge-run/SKILL.md',
    name: 'run',
    markers: [
      'INIT', 'LOOP', 'ESCALATE', 'BLOCK', 'todo.md', 'full repo suite', 'spec section',
      '## Attended mode', 'references/tdd.md', 'references/code-review.md', 'test-after',
      'on_complete', '[plan-stale]', 'plan assumption broken', '## Finish stage',
      'dispatch.md', 'inline execution', 'subagent-driven', 'debugging.md',
    ],
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
    markers: ['blocker', 'nit', 'iter', 'AC coverage', 'regression risk', 'verified against the code', 'incorrect-with-evidence'],
  },
  {
    path: 'skills/forge-run/references/dispatch.md',
    markers: ['signal', 'done | stuck | plan-assumption-broken', 'Freshness', 'hypotheses'],
  },
  {
    path: 'skills/forge-run/references/debugging.md',
    markers: ['falsifiable', 'dead', 'shotgun'],
  },
];
for (const r of REFS) {
  if (!existsSync(r.path)) { fail(r.path + ' missing'); continue; }
  const text = readFileSync(r.path, 'utf8');
  let bad = 0;
  for (const m of r.markers) {
    if (!text.includes(m)) { fail(`${r.path}: missing required marker "${m}"`); bad++; }
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
}

// 3. Plan template skeleton.
const TPL = 'templates/plan-template.md';
if (!existsSync(TPL)) {
  fail(TPL + ' missing');
} else {
  const t = readFileSync(TPL, 'utf8');
  let bad = 0;
  for (const m of ['## Run Config', '## Phases', 'covers:', 'depends_on:', 'tier:', 'process:', 'mode:', 'attended', 'on_complete:', 'pr | merge | keep']) {
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
