import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = [
  process.env.JHO_CLI_PATH,
  path.join(ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI, 'Could not locate bin/cli.mjs');
const PACKAGE_ROOT = path.resolve(path.dirname(CLI), '..');

const FILL_SKILL_PATH = path.join(ROOT, 'skills', '04-fill-and-apply.md');
const WAIT_SKILL_PATH = path.join(ROOT, 'skills', '18-condition-based-browser-waiting.md');

const FILL_SKILL = fs.readFileSync(FILL_SKILL_PATH, 'utf8');
const WAIT_SKILL = fs.readFileSync(WAIT_SKILL_PATH, 'utf8');

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function assertNoInvisibleUnicodeOrBiDi(text, label) {
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    assert.ok(
      !(cp >= 0xE0000 && cp <= 0xE007F) && !(cp >= 0x202A && cp <= 0x202E) && !(cp >= 0x2066 && cp <= 0x2069),
      `${label} contains prohibited invisible Unicode/BiDi char U+${cp.toString(16).toUpperCase()} at offset ${i}`,
    );
  }
}

// Patterns that indicate normative implicit/bypass submission authorization.
const BYPASS_PATTERNS = [
  {
    name: 'second-approve-bypass',
    re: /without\s+asking\s+for\s+a\s+second\s+`?APPROVE`?/i,
  },
  {
    name: 'selection-authorizes-submit',
    re: /counts?\s+as\s+full\s+authorization\s+to\s+fill\s+and\s+click\s+`?Submit`?/i,
  },
  {
    name: 'auto-submit-on-apply-command',
    re: /click\s+`?Submit`?(?:\s*\/\s*`?Apply`?)?\s+directly\s+without/i,
  },
  {
    name: 'single-turn-unapproved-submit',
    re: /fill\s+verified\s+fields\s*(?:→|->)\s*save\/submit\s*(?:→|->)\s*verify\s+receipt/i,
  },
];

// Lines that explicitly frame a pattern as a prohibited example/anti-pattern should not cause brittle false positives.
function isExplicitProhibitionLine(line) {
  return /(?:^\s*-\s*❌|\b(?:never|prohibited|forbidden|anti-pattern|do\s+not\s+allow|must\s+not)\b)/i.test(line);
}

test('1. skills/04-fill-and-apply.md removes implicit auto-submit bypass & enforces unconditional APPROVE gate', () => {
  // Known contradictory bypass heading & instructions must be absent
  assert.doesNotMatch(FILL_SKILL, /###\s*End-to-End Auto-Fill on User Apply Command/i);
  for (const { name, re } of BYPASS_PATTERNS) {
    assert.doesNotMatch(FILL_SKILL, re, `skills/04-fill-and-apply.md must not contain bypass pattern "${name}"`);
  }

  // Job selection / apply intent ("1", "APPLY 1", "APPLY ALL GREEN", "apply", "قدم") authorizes preparation/filling ONLY
  assert.match(FILL_SKILL, /"1".*"APPLY 1".*"APPLY ALL GREEN".*"apply".*"قدم"/);
  assert.match(FILL_SKILL, /preparation and non-submitting form filling ONLY\s*—\s*NEVER final submission/i);

  // Required safety invariants preserved and explicitly stated
  assert.match(FILL_SKILL, /intermediate non-submitting pages/i);
  assert.match(FILL_SKILL, /Unconditional Hard Stop Before Submit/i);
  assert.match(FILL_SKILL, /fresh `browser_snapshot`/i);
  assert.match(FILL_SKILL, /Live DOM Read-Back Table/);
  assert.match(FILL_SKILL, /node \.\/bin\/cli\.mjs pre-submit/);
  assert.match(FILL_SKILL, /separate, explicit, fresh, job-specific `APPROVE`/i);
  assert.match(FILL_SKILL, /No inferred, ambiguous, previous-turn, blanket, batch, or general approval may authorize submission/i);
  assert.match(FILL_SKILL, /invalidates prior approval|invalidate approval/i);
  assert.match(FILL_SKILL, /dry_run:\s*true.*never permit submission/i);
  assert.match(FILL_SKILL, /click Submit \*\*once\*\*/i);
  assert.match(FILL_SKILL, /skills\/meta-self-verification\.md/);

  // Proactive offer stops at review gate rather than promising direct submit
  const offerMatch = FILL_SKILL.match(/### Proactive Apply Offer([\s\S]*?)### /);
  assert.ok(offerMatch, 'Missing Proactive Apply Offer section');
  assert.match(offerMatch[1], /stop before final submission/i);
  assert.match(offerMatch[1], /Live DOM Read-Back Table/);
  assert.match(offerMatch[1], /explicit.*`APPROVE`/i);
});

test('2. skills/18-condition-based-browser-waiting.md separates pre-approval preparation from post-APPROVE submission', () => {
  for (const { name, re } of BYPASS_PATTERNS) {
    assert.doesNotMatch(WAIT_SKILL, re, `skills/18-condition-based-browser-waiting.md must not contain bypass pattern "${name}"`);
  }

  const delegationMatch = WAIT_SKILL.match(/\*\*Single-Turn Batched Delegation[^\n]*\*\*([^\n]*)/i);
  assert.ok(delegationMatch, 'Missing Single-Turn Batched Delegation item in skills/18-condition-based-browser-waiting.md');
  const line = delegationMatch[0];
  assert.match(line, /non-submitting preparation/i);
  assert.match(line, /stop before final Submit\/Save/i);
  assert.match(line, /Live DOM Read-Back Table/);
  assert.match(line, /separate post-approval turn/i);
  assert.match(line, /explicit, fresh, job-specific `APPROVE`/i);
  assert.match(line, /skills\/04-fill-and-apply\.md/);
  assert.match(line, /dry_run:\s*false/);
});

test('3. Policy-wide scan across skills/, AGENTS.md, config/invariants.txt & .agent/workflows/ finds zero conflicting bypass instructions', () => {
  const candidateTargets = [
    ...walkFiles(path.join(ROOT, 'skills')).filter(f => f.endsWith('.md')),
    path.join(ROOT, 'AGENTS.md'),
    path.join(ROOT, 'config', 'invariants.txt'),
  ];

  // .agent/workflows/ may live at PACKAGE_ROOT during isolated `init` smoke tests
  const workflowsDir = [path.join(ROOT, '.agent', 'workflows'), path.join(PACKAGE_ROOT, '.agent', 'workflows')].find(d => fs.existsSync(d));
  assert.ok(workflowsDir, 'Could not locate .agent/workflows directory');
  candidateTargets.push(...walkFiles(workflowsDir).filter(f => f.endsWith('.md')));

  const violations = [];
  for (const filePath of candidateTargets) {
    assert.ok(fs.existsSync(filePath), `Expected policy file to exist: ${filePath}`);
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (isExplicitProhibitionLine(line)) return;
      for (const { name, re } of BYPASS_PATTERNS) {
        if (re.test(line)) {
          violations.push(`${path.relative(ROOT, filePath)}:${idx + 1} matched ${name}`);
        }
      }
    });
  }
  assert.deepEqual(violations, [], `Found conflicting submission-bypass instructions:\n${violations.join('\n')}`);

  // Confirm invariants.txt still explicitly preserves fresh job-bound APPROVE
  const invariants = fs.readFileSync(path.join(ROOT, 'config', 'invariants.txt'), 'utf8');
  assert.match(invariants, /Never click Submit\/Save\/Post\/Send without fresh job-bound owner APPROVE/);
});

test('4. Frontmatter, mandatory H2 structure, line-count limit & zero invisible Unicode/BiDi chars in modified skills', () => {
  for (const [label, text] of [
    ['skills/04-fill-and-apply.md', FILL_SKILL],
    ['skills/18-condition-based-browser-waiting.md', WAIT_SKILL],
  ]) {
    const lines = text.split(/\r?\n/);
    assert.ok(lines.length < 500, `${label} must stay under 500 lines (got ${lines.length})`);
    assert.ok(text.startsWith('---'), `${label} missing YAML frontmatter`);
    const fmEnd = text.indexOf('\n---', 3);
    assert.ok(fmEnd > 0, `${label} unterminated YAML frontmatter`);
    const fm = text.slice(3, fmEnd);
    for (const key of ['name', 'version', 'description', 'triggers', 'requires_mcp', 'preconditions', 'requires_skills', 'verification']) {
      assert.match(fm, new RegExp(`^${key}:`, 'm'), `${label} missing frontmatter key: ${key}`);
    }
    for (const heading of [
      '## When to Use & Preconditions',
      '## Deterministic Step-by-Step Execution',
      '## Anti-Patterns (What NEVER To Do) & Self-Verification Check',
    ]) {
      assert.ok(text.includes(heading), `${label} missing mandatory H2 heading: ${heading}`);
    }
    assertNoInvisibleUnicodeOrBiDi(text, label);
  }
});
