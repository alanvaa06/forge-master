#!/usr/bin/env node
// forge-guard - PreToolUse hook (spec-002 C2/I5). For forge phase subagents only
// (agent_type matches FORGE_AGENT), denies:
//   - Edit/Write/NotebookEdit of a path under docs/forge/ or docs/context/
//   - Bash running a mutating git subcommand (any chained segment, git globals skipped)
//   - Bash invoking forge-state (a word whose basename is forge-state or forge-state.mjs;
//     forge-state.test.mjs etc. stay allowed so phases can run its tests)
// Quotes group a word, so `echo "git push"` is allowed. Best-effort by design (R5):
// `sh -c`, aliases and scripts are not parsed. Everything else is silent; errors fail open.
//
// decide(input) is pure: null = no decision, {reason} = deny.
// When executed directly it reads the hook JSON on stdin and prints the
// PreToolUse deny output, or nothing.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const OWNED_PATH = /(^|\/)docs\/(forge|context)(\/|$)/;
const MUTATING_GIT = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'pull', 'push', 'merge', 'rebase',
  'reset', 'cherry-pick', 'branch', 'tag', 'worktree', 'stash']);
// git globals that take the NEXT token as their value (unless written --opt=value).
const VALUE_GLOBALS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const SEGMENT_SPLIT = /&&|\|\||;|\||&|\n|\$\(|`/;
const FORGE_STATE = /^forge-state(\.mjs)?$/;

// Shell-ish word split (best-effort, R5): whitespace and ( ) { } < > separate
// words outside quotes; '...' and "..." group a word and the quotes are dropped
// (an unclosed quote runs to the end). Backslashes are literal (Windows paths).
function tokenize(segment) {
  const words = [];
  let cur = null;
  let quote = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; cur ??= '';
    } else if (/[\s(){}<>]/.test(ch)) {
      if (cur !== null) words.push(cur);
      cur = null;
    } else {
      cur = (cur ?? '') + ch;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

const basename = (w) => w.replace(/\\/g, '/').split('/').pop().toLowerCase();

// Returns the denied command text ("git <sub>" | "forge-state") or null.
function deniedCommand(command) {
  for (const segment of command.split(SEGMENT_SPLIT)) {
    const words = tokenize(segment);
    for (let i = 0; i < words.length; i++) {
      const base = basename(words[i]);
      if (FORGE_STATE.test(base)) return 'forge-state';
      if (base !== 'git' && base !== 'git.exe') continue;
      let j = i + 1;
      while (j < words.length && words[j].startsWith('-')) j += VALUE_GLOBALS.has(words[j]) ? 2 : 1;
      if (MUTATING_GIT.has(words[j])) return `git ${words[j]}`;
    }
  }
  return null;
}

// D2: plugin agents are plugin-scoped ("forge-master:forge-reviewer"); a bare name is tolerated.
const FORGE_AGENT = /(^|:)forge-(implementer-(junior|senior)|reviewer)$/;

export function decide(input) {
  const { agent_type, tool_name, tool_input } = input;
  if (typeof agent_type !== 'string' || !FORGE_AGENT.test(agent_type)) return null; // R4 fast path
  if (WRITE_TOOLS.has(tool_name)) {
    const p = tool_input.file_path ?? tool_input.notebook_path;
    if (typeof p === 'string' && OWNED_PATH.test(p.replace(/\\/g, '/').toLowerCase())) {
      return { reason: `forge-guard: writing ${p} is orchestrator-owned. Do not edit it; report the change you need in your final message.` };
    }
  } else if (tool_name === 'Bash') {
    const what = deniedCommand(tool_input.command);
    if (what) return { reason: `forge-guard: running ${what} is orchestrator-owned. Do not run it; report what you need in your final message.` };
  }
  return null;
}

// ASCII-only JSON: escape every non-ASCII code unit (Windows consoles, cp1252).
const asciiJson = (o) => JSON.stringify(o).replace(/[^\x00-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// Fail-open (AC-1.5): any error -> exit 0, empty stdout, ASCII warning on stderr.
async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const d = decide(JSON.parse(raw));
    if (d) {
      process.stdout.write(asciiJson({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason },
      }));
    }
  } catch (e) {
    const msg = String(e?.message ?? e).replace(/[^\x20-\x7e]/g, '?');
    process.stderr.write(`forge-guard: warning: ${msg}; allowing the tool call (fail-open)\n`);
  }
  process.exitCode = 0;
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = () => {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try { return same(realpathSync(self), realpathSync(resolve(process.argv[1]))); } catch { return same(self, resolve(process.argv[1])); }
};
if (isMain()) await main();
