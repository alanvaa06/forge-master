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
  } catch (e) {
    fail(`${PJ} invalid JSON: ${e.message}`);
  }
}

// 2. Each skill: file exists, frontmatter has the right name + a description,
//    body contains the load-bearing section markers from the design.
const SKILLS = [
  {
    path: 'skills/prd-design/SKILL.md',
    name: 'prd-design',
    markers: ['## Interview', 'Given/When/Then', 'Non-Goals', 'Definition of Done', 'gate 1'],
  },
  {
    path: 'skills/prd-import/SKILL.md',
    name: 'prd-import',
    markers: ['## Adjustments', 'Given/When/Then', 'Non-Goals', '[manual-check]', 'gate 1'],
  },
  {
    path: 'skills/plan-design/SKILL.md',
    name: 'plan-design',
    markers: ['covers', 'depends_on', 'lessons.md', 'Total coverage', 'gate 2'],
  },
  {
    path: 'skills/forge-run/SKILL.md',
    name: 'run',
    markers: ['INIT', 'LOOP', 'ESCALATE', 'BLOCK', 'todo.md', 'full repo suite'],
  },
];

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
  for (const m of ['## Run Config', '## Phases', 'covers:', 'depends_on:', 'tier:', 'process:', 'mode:']) {
    if (!t.includes(m)) fail(`${TPL}: missing "${m}"`);
  }
  ok(`${TPL} checked`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nALL CHECKS PASSED');
process.exit(0);
