import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = [
  process.env.JHO_CLI_PATH,
  path.join(ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI, 'Could not locate bin/cli.mjs');

const FORMS_DIR = path.join(ROOT, 'evals', 'fixtures', 'forms');
const WORKDAY_PATH = path.join(FORMS_DIR, 'workday-mock.html');
const WORKDAY_HTML = fs.readFileSync(WORKDAY_PATH, 'utf8');
const WORKDAY_SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'ats', 'workday.md'), 'utf8');
const ATS_ENGINES_SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'platforms', 'ats-engines.md'), 'utf8');

function extractTagAttributes(tagText) {
  const attrs = {};
  for (const m of tagText.matchAll(/([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = m[1].toLowerCase();
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function getElementsByTag(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return [...html.matchAll(re)].map(m => ({ raw: m[0], index: m.index, attrs: extractTagAttributes(m[0]) }));
}

function getSectionInnerHtml(html, id) {
  const re = new RegExp(`<section\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

test('1. Dynamic ATS form fixture discovery & shared offline safety invariants', () => {
  const htmlFiles = fs.readdirSync(FORMS_DIR).filter(f => f.endsWith('.html')).sort();
  assert.ok(htmlFiles.length >= 4, `Expected at least 4 ATS mock fixtures, found ${htmlFiles.length}`);
  assert.ok(htmlFiles.includes('workday-mock.html'), 'workday-mock.html must exist in evals/fixtures/forms/');

  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(FORMS_DIR, file), 'utf8');
    // Offline-only: zero external script, stylesheet, image, or remote form action URLs
    assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, `${file} must not load remote assets`);
    assert.doesNotMatch(html, /<form\b[^>]*\baction\s*=\s*["']https?:\/\//i, `${file} must not submit to a remote URL`);
    assert.match(html, /type="file"/i, `${file} must include a CV upload file input`);
    assert.match(html, /name="website_url_honeypot"/i, `${file} must include website_url_honeypot`);
    assert.match(html, /Decline to self-identify/i, `${file} must provide neutral EEO opt-out option`);
  }
});

test('2. Workday 4-step wizard structure, ordered steps, navigation & validation alert', () => {
  const expectedSteps = [
    ['1', 'step-1', 'My Information'],
    ['2', 'step-2', 'My Experience'],
    ['3', 'step-3', 'Voluntary Disclosures'],
    ['4', 'step-4', 'Review'],
  ];

  // Progress indicator list has all 4 steps in exact order with Step 1 active
  const progressMatch = WORKDAY_HTML.match(/<nav\b[^>]*aria-label="Application Progress"[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(progressMatch, 'Missing Application Progress navigation landmark');
  let prevIdx = -1;
  for (const [num, , label] of expectedSteps) {
    const stepRe = new RegExp(`<li\\b[^>]*data-step-indicator="${num}"[^>]*>[^<]*${label}[^<]*<\\/li>`, 'i');
    const m = progressMatch[1].match(stepRe);
    assert.ok(m, `Missing progress indicator for step ${num} (${label})`);
    assert.ok(m.index > prevIdx, `Step ${num} (${label}) is out of order`);
    prevIdx = m.index;
  }
  assert.match(progressMatch[1], /data-step-indicator="1"[^>]*aria-current="step"/i, 'Step 1 must carry aria-current="step"');

  // Four wizard <section> blocks inside <form> with navigation controls
  const formMatch = WORKDAY_HTML.match(/<form\b[^>]*id="workday-wizard-form"[^>]*>([\s\S]*?)<\/form>/i);
  assert.ok(formMatch, 'Missing #workday-wizard-form');
  const formInner = formMatch[1];

  for (const [num, id, label] of expectedSteps) {
    const secInner = getSectionInnerHtml(formInner, id);
    assert.ok(secInner, `Missing wizard section #${id} inside form`);
    assert.match(secInner, new RegExp(`<h2\\b[^>]*>${label}<\\/h2>`, 'i'), `Section #${id} must declare heading "${label}"`);
    if (num !== '4') {
      assert.match(secInner, new RegExp(`data-wizard-next="${Number(num) + 1}"`), `Step ${num} must provide Next navigation to step ${Number(num) + 1}`);
    }
    if (num !== '1') {
      assert.match(secInner, new RegExp(`data-wizard-prev="${Number(num) - 1}"`), `Step ${num} must provide Back navigation to step ${Number(num) - 1}`);
    }
  }

  // Step validation alert landmark
  assert.match(WORKDAY_HTML, /<div\b[^>]*id="wd-step-alert"[^>]*role="alert"[^>]*aria-live="polite"/i, 'Missing accessible step validation alert container');
});

test('3. React-Select-style ARIA comboboxes & detached portal listboxes strictly outside </form>', () => {
  const formCloseIndex = WORKDAY_HTML.search(/<\/form>/i);
  assert.ok(formCloseIndex > 0, 'Missing </form> closing tag');

  const comboboxes = getElementsByTag(WORKDAY_HTML, 'button').filter(el => el.attrs.role === 'combobox');
  assert.ok(comboboxes.length >= 2, `Expected >= 2 ARIA combobox triggers, found ${comboboxes.length}`);

  const portalMatch = WORKDAY_HTML.match(/<div\b[^>]*id="wd-portal-root"[^>]*data-portal-root="true"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(portalMatch, 'Missing detached #wd-portal-root container');
  assert.ok(portalMatch.index > formCloseIndex, 'Detached portal root MUST be mounted outside </form>');

  for (const combo of comboboxes) {
    assert.equal(combo.attrs['aria-haspopup'], 'listbox', `Combobox ${combo.attrs.id} must set aria-haspopup="listbox"`);
    assert.ok(
      combo.attrs['aria-expanded'] === 'false' || combo.attrs['aria-expanded'] === 'true',
      `Combobox ${combo.attrs.id} must declare boolean aria-expanded`,
    );
    const controlsId = combo.attrs['aria-controls'];
    assert.ok(controlsId, `Combobox ${combo.attrs.id} must declare aria-controls`);
    assert.ok(combo.index < formCloseIndex, `Combobox ${combo.attrs.id} should live inside the form`);

    const lbRe = new RegExp(`<ul\\b[^>]*id="${controlsId}"[^>]*role="listbox"[^>]*>([\\s\\S]*?)<\\/ul>`, 'i');
    const lbMatch = portalMatch[1].match(lbRe);
    assert.ok(lbMatch, `Portal listbox #${controlsId} must exist inside detached #wd-portal-root outside </form>`);

    const options = getElementsByTag(lbMatch[1], 'li').filter(li => li.attrs.role === 'option');
    assert.ok(options.length >= 3, `Listbox #${controlsId} must provide >= 3 role="option" items`);
    for (const opt of options) {
      assert.ok(
        opt.attrs['aria-selected'] === 'false' || opt.attrs['aria-selected'] === 'true',
        `Option ${opt.attrs.id} in #${controlsId} must set aria-selected`,
      );
      assert.ok(opt.attrs['data-value'], `Option ${opt.attrs.id} in #${controlsId} must carry a non-empty data-value`);
    }
  }
});

test('4. Required vs. optional fields, CV file upload & hidden honeypot attributes', () => {
  const inputs = getElementsByTag(WORKDAY_HTML, 'input');
  const byName = new Map(inputs.map(el => [el.attrs.name, el]));

  // Required inputs
  for (const reqName of ['first_name', 'last_name', 'email', 'phone', 'resume', 'recent_job_title', 'recent_company', 'gdpr_consent']) {
    const el = byName.get(reqName);
    assert.ok(el, `Missing expected required input[name="${reqName}"]`);
    assert.ok(Object.prototype.hasOwnProperty.call(el.attrs, 'required'), `Input "${reqName}" must be marked required`);
  }

  // Optional inputs MUST NOT carry required
  for (const optName of ['linkedin_url', 'marketing_opt_in']) {
    const el = byName.get(optName);
    assert.ok(el, `Missing expected optional input[name="${optName}"]`);
    assert.ok(!Object.prototype.hasOwnProperty.call(el.attrs, 'required'), `Optional input "${optName}" must not be marked required`);
  }
  const skillsTextarea = getElementsByTag(WORKDAY_HTML, 'textarea').find(t => t.attrs.name === 'skills_summary');
  assert.ok(skillsTextarea, 'Missing optional textarea[name="skills_summary"]');
  assert.ok(!Object.prototype.hasOwnProperty.call(skillsTextarea.attrs, 'required'), 'skills_summary must remain optional');

  // CV upload control + upload status badge
  const resumeInput = byName.get('resume');
  assert.equal(resumeInput.attrs.type, 'file');
  assert.match(resumeInput.attrs.accept || '', /\.pdf/i);
  assert.match(WORKDAY_HTML, /id="wd-upload-status"[^>]*role="status"/i, 'Missing upload status live region');

  // Hidden honeypot attributes
  const honeypotWrapper = WORKDAY_HTML.match(/<div\b[^>]*aria-hidden="true"[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(honeypotWrapper, 'Honeypot wrapper must set aria-hidden="true" and display:none');
  const honeypotInput = getElementsByTag(honeypotWrapper[1], 'input').find(el => el.attrs.name === 'website_url_honeypot');
  assert.ok(honeypotInput, 'website_url_honeypot input must live inside hidden honeypot wrapper');
  assert.equal(honeypotInput.attrs.tabindex, '-1');
  assert.equal(honeypotInput.attrs.autocomplete, 'off');
  assert.ok(!Object.prototype.hasOwnProperty.call(honeypotInput.attrs, 'required'), 'Honeypot must never be marked required');
});

test('5. Account-gate detection, manual-handoff markers & local-only inline script safety', () => {
  // Synthetic host (never real myworkdayjobs.com)
  assert.doesNotMatch(WORKDAY_HTML, /https?:\/\/[^"'\s]*myworkdayjobs\.com/i, 'Fixture must never reference a real Workday URL');
  assert.match(WORKDAY_HTML, /data-synthetic-host="cloudpay\.myworkdayjobs\.example"/i);

  // Account gate landmark
  const gateInner = getSectionInnerHtml(WORKDAY_HTML, 'workday-account-gate');
  assert.ok(gateInner, 'Missing #workday-account-gate section');
  assert.match(WORKDAY_HTML, /id="workday-account-gate"[^>]*data-workday-gate="account-required"/i);
  assert.match(gateInner, /data-account-action="create-account"/i);
  assert.match(gateInner, /data-account-action="sign-in"/i);
  assert.match(gateInner, /data-legal-terms="true"/i);

  // Final Review step manual-handoff enforcement
  const reviewInner = getSectionInnerHtml(WORKDAY_HTML, 'step-4');
  assert.ok(reviewInner, 'Missing #step-4 Review section');
  assert.match(reviewInner, /data-review-summary="true"/i);
  assert.match(reviewInner, /data-manual-handoff="true"/i);
  assert.match(reviewInner, /type="submit"[^>]*aria-disabled="true"[^>]*data-requires-manual-handoff="true"/i);

  // Inline script must prevent default submit and never perform network calls
  const scriptMatch = WORKDAY_HTML.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, 'Expected minimal inline script for offline deterministic testing');
  const js = scriptMatch[1];
  assert.match(js, /event\.preventDefault\(\)/, 'Submit handler must call event.preventDefault()');
  assert.doesNotMatch(js, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|window\.open)\b/, 'Fixture JS must never make network calls or open popups');
});

test('6. Workday skill & ATS-engine policy invariants and frontmatter contract', () => {
  // Mandatory manual_apply + needs_review policy in both skills/ats/workday.md and skills/platforms/ats-engines.md
  for (const [label, text] of [
    ['skills/ats/workday.md', WORKDAY_SKILL],
    ['skills/platforms/ats-engines.md', ATS_ENGINES_SKILL],
  ]) {
    assert.match(text, /manual_apply/i, `${label} must enforce manual_apply`);
    assert.match(text, /needs_review/i, `${label} must enforce needs_review`);
    assert.match(text, /aria-expanded/i, `${label} must document aria-expanded snapshot wait condition`);
    assert.match(text, /listbox/i, `${label} must document portal listbox snapshot wait condition`);
    assert.match(text, /role="alert"|step-validation/i, `${label} must document step-validation error recovery`);

    // 8 required YAML frontmatter keys + 3 mandatory H2 sections + zero invisible Unicode/BiDi
    assert.ok(text.startsWith('---'), `${label} missing YAML frontmatter`);
    const fmEnd = text.indexOf('\n---', 3);
    assert.ok(fmEnd > 0, `${label} unterminated frontmatter`);
    const fm = text.slice(3, fmEnd);
    for (const key of ['name', 'version', 'description', 'triggers', 'requires_mcp', 'preconditions', 'requires_skills', 'verification']) {
      assert.match(fm, new RegExp(`^${key}:`, 'm'), `${label} missing frontmatter key: ${key}`);
    }
    for (const heading of [
      '## When to Use & Preconditions',
      '## Deterministic Step-by-Step Execution',
      '## Anti-Patterns (What NEVER To Do) & Self-Verification Check',
    ]) {
      assert.ok(text.includes(heading), `${label} missing mandatory heading: ${heading}`);
    }
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i);
      assert.ok(
        !(cp >= 0xE0000 && cp <= 0xE007F) && !(cp >= 0x202A && cp <= 0x202E) && !(cp >= 0x2066 && cp <= 0x2069),
        `${label} contains invisible Unicode/BiDi char U+${cp.toString(16)}`,
      );
    }
  }

  // Workday skill explicitly prohibits account creation, legal terms acceptance, and auto-submission
  assert.match(WORKDAY_SKILL, /no account created|do not create accounts/i);
  assert.match(WORKDAY_SKILL, /no terms accepted|accept new legal terms/i);
  assert.match(WORKDAY_SKILL, /no Submit clicked|click Submit automatically/i);
  assert.match(WORKDAY_SKILL, /read-only inspection|pre-handoff|synthetic/i, 'Workday snapshot guidance must remain scoped to read-only/pre-handoff/synthetic testing');
});

test('7. Dynamic proof output includes Workday without label clipping & preserves EVAL-01..20', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-workday-proof-'));
  try {
    const env = { ...process.env, HOME: tmp, USERPROFILE: tmp, NO_COLOR: '1' };
    const proofRes = spawnSync(process.execPath, [CLI, 'proof'], { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(proofRes.status, 0, proofRes.stdout + proofRes.stderr);

    const svg = fs.readFileSync(path.join(tmp, 'logs', 'exports', 'proof-card.svg'), 'utf8');
    const md = fs.readFileSync(path.join(tmp, 'logs', 'exports', 'proof-card.md'), 'utf8');

    assert.match(svg, /Ashby · Greenhouse · Lever · Workday/);
    assert.match(md, /Workday/);
    assert.match(svg, />20\/20</, 'EVAL-01..20 baseline count must remain 20/20');

    // Verify responsive font-size prevents clipping inside the 182px fourth metric card
    const labelMatch = svg.match(/<text\b[^>]*font-size="([0-9.]+)"[^>]*>Ashby · Greenhouse · Lever · Workday<\/text>/);
    assert.ok(labelMatch, 'Missing dynamic ATS fixture label text element in proof-card.svg');
    assert.ok(Number(labelMatch[1]) <= 9.5, `Expected responsive font-size <= 9.5 to prevent clipping, got ${labelMatch[1]}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
