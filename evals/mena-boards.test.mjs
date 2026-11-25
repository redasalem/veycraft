import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = [
  process.env.JHO_CLI_PATH,
  path.join(ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI, 'Could not locate bin/cli.mjs');
const PACKAGE_ROOT = path.resolve(path.dirname(CLI), '..');

const engine = await import(pathToFileURL(path.join(path.dirname(CLI), 'profile-intelligence.mjs')).href);

const BOARDS_DIR = path.join(ROOT, 'evals', 'fixtures', 'boards');
const FORMS_DIR = path.join(ROOT, 'evals', 'fixtures', 'forms');
const GULFTALENT_PATH = path.join(BOARDS_DIR, 'gulftalent-mock.html');
const BAYT_PATH = path.join(BOARDS_DIR, 'bayt-mock.html');
const MENA_SKILL_PATH = path.join(ROOT, 'skills', 'platforms', 'mena-boards.md');

const GULFTALENT_HTML = fs.readFileSync(GULFTALENT_PATH, 'utf8');
const BAYT_HTML = fs.readFileSync(BAYT_PATH, 'utf8');
const MENA_SKILL = fs.readFileSync(MENA_SKILL_PATH, 'utf8');

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

function assertNoInvisibleUnicodeOrBiDi(text, label) {
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    assert.ok(
      !(cp >= 0xE0000 && cp <= 0xE007F) && !(cp >= 0x202A && cp <= 0x202E) && !(cp >= 0x2066 && cp <= 0x2069),
      `${label} contains prohibited invisible Unicode/BiDi char U+${cp.toString(16).toUpperCase()} at offset ${i}`,
    );
  }
}

function getYamlBlock(yamlText, keyValuePattern) {
  const re = new RegExp(`(^|\\n)  - name:[^\\n]*\\n([\\s\\S]*?)(?=\\n  - name:|\\n\\s*# Curated|$)`, 'g');
  for (const m of yamlText.matchAll(re)) {
    const block = m[0];
    if (keyValuePattern.test(block)) return block;
  }
  return null;
}

test('1. Offline regional board fixtures exist under evals/fixtures/boards/ with zero external network dependencies', () => {
  assert.ok(fs.existsSync(BOARDS_DIR), 'evals/fixtures/boards/ directory must exist');
  const boardFiles = fs.readdirSync(BOARDS_DIR).filter(f => f.endsWith('.html')).sort();
  assert.ok(boardFiles.includes('gulftalent-mock.html'), 'gulftalent-mock.html must exist in evals/fixtures/boards/');
  assert.ok(boardFiles.includes('bayt-mock.html'), 'bayt-mock.html must exist in evals/fixtures/boards/');

  for (const [name, html, expectedHost] of [
    ['gulftalent-mock.html', GULFTALENT_HTML, 'www.gulftalent.example'],
    ['bayt-mock.html', BAYT_HTML, 'www.bayt.example'],
  ]) {
    assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, `${name} must not load external assets`);
    assert.doesNotMatch(html, /<form\b[^>]*\baction\s*=\s*["']https?:\/\//i, `${name} must not submit to a remote URL`);
    assert.doesNotMatch(html, /https?:\/\/[^"'\s]*(?:bayt\.com|gulftalent\.com|myworkdayjobs\.com|greenhouse\.io)/i, `${name} must never reference live portal URLs`);
    assert.ok(html.includes(`data-synthetic-host="${expectedHost}"`), `${name} must declare synthetic host ${expectedHost}`);

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, `${name} must include local deterministic inline script`);
    assert.match(scriptMatch[1], /event\.preventDefault\(\)/, `${name} script must call event.preventDefault()`);
    assert.doesNotMatch(scriptMatch[1], /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|window\.open)\b/, `${name} script must never perform network calls or popups`);
  }
});

test('2. Signed-in state, synthetic account gates & manual-handoff disabled submit controls', () => {
  for (const [name, html, gateId, formId] of [
    ['gulftalent-mock.html', GULFTALENT_HTML, 'gulftalent-account-gate', 'gulftalent-screening-form'],
    ['bayt-mock.html', BAYT_HTML, 'bayt-account-gate', 'bayt-screening-form'],
  ]) {
    // Signed-in header & auth_check_url attribute
    assert.match(html, /data-auth-check-url="https:\/\/www\.(?:gulftalent|bayt)\.example\/[^"]+"/i, `${name} must declare synthetic data-auth-check-url`);
    assert.match(html, /<header\b[^>]*data-auth-state="signed-in"/i, `${name} must model signed-in header state`);
    assert.match(html, /data-signed-in-indicator="true"/i, `${name} must expose observable signed-in link indicator`);

    // Synthetic account gate landmark with sign-in, create-account, and legal terms markers
    const gateRe = new RegExp(`<section\\b[^>]*id="${gateId}"[^>]*data-auth-gate="sign-in-required"[^>]*>([\\s\\S]*?)<\\/section>`, 'i');
    const gateMatch = html.match(gateRe);
    assert.ok(gateMatch, `${name} missing synthetic account gate #${gateId}`);
    assert.match(gateMatch[1], /data-account-action="sign-in"/i, `${name} gate must expose sign-in action`);
    assert.match(gateMatch[1], /data-account-action="create-account"/i, `${name} gate must expose create-account action`);
    assert.match(gateMatch[1], /data-legal-terms="true"/i, `${name} gate must mark legal terms checkbox`);

    // Manual-handoff form & disabled submit button
    const formRe = new RegExp(`<form\\b[^>]*id="${formId}"[^>]*data-manual-handoff="true"[^>]*>([\\s\\S]*?)<\\/form>`, 'i');
    const formMatch = html.match(formRe);
    assert.ok(formMatch, `${name} missing manual-handoff screening form #${formId}`);
    assert.match(formMatch[1], /data-manual-handoff-notice="true"/i, `${name} must render manual-handoff notice`);
    assert.match(
      formMatch[1],
      /<button\b[^>]*type="submit"[^>]*aria-disabled="true"[^>]*data-requires-manual-handoff="true"/i,
      `${name} submit control must be aria-disabled="true" and marked data-requires-manual-handoff="true"`,
    );
  }
});

test('3. Job-card expansion, accessible pagination, direct vs. agency attribution & external ATS handoff', () => {
  for (const [name, html, prefix] of [
    ['gulftalent-mock.html', GULFTALENT_HTML, 'gulftalent'],
    ['bayt-mock.html', BAYT_HTML, 'bayt'],
  ]) {
    // Direct employer AND recruitment agency cards both modeled with distinct badges
    const articles = getElementsByTag(html, 'article');
    const employerTypes = new Set(articles.map(a => a.attrs['data-employer-type']));
    assert.ok(employerTypes.has('direct'), `${name} must model a direct employer listing`);
    assert.ok(employerTypes.has('agency'), `${name} must model a recruitment agency listing`);
    assert.match(html, /data-attribution-badge="direct"/i, `${name} missing direct employer badge`);
    assert.match(html, /data-attribution-badge="agency"/i, `${name} missing agency attribution badge`);
    assert.ok(
      articles.every(a => (a.attrs['data-posting-id'] || '').startsWith(`${prefix}:`)),
      `${name} posting IDs must carry canonical ${prefix}: prefix`,
    );

    // Every expand-card button references an existing role="region" JD container via aria-controls
    const expandBtns = getElementsByTag(html, 'button').filter(b => (b.attrs.class || '').includes('expand-card'));
    assert.ok(expandBtns.length >= 2, `${name} must expose >= 2 expandable job cards`);
    for (const btn of expandBtns) {
      assert.equal(btn.attrs['aria-expanded'], 'false', `${name} expand button should start collapsed`);
      const targetId = btn.attrs['aria-controls'];
      assert.ok(targetId, `${name} expand button must declare aria-controls`);
      assert.match(
        html,
        new RegExp(`<div\\b[^>]*id="${targetId}"[^>]*role="region"[^>]*>`, 'i'),
        `${name} missing role="region" JD container #${targetId} referenced by aria-controls`,
      );
    }

    // External ATS redirect link with synthetic host
    const externalLink = getElementsByTag(html, 'a').find(a => a.attrs['data-apply-type'] === 'external-ats');
    assert.ok(externalLink, `${name} must include an external ATS redirect trigger`);
    assert.match(externalLink.attrs['data-external-ats-host'] || '', /\.example$/i, `${name} external ATS host must be synthetic .example`);

    // Pagination landmark with active page indicator, Prev/Next controls & live status region
    const navMatch = html.match(/<nav\b[^>]*aria-label="Search Results Pagination"[^>]*>([\s\S]*?)<\/nav>/i);
    assert.ok(navMatch, `${name} missing accessible pagination <nav> landmark`);
    assert.match(navMatch[1], /data-page-number="1"[^>]*aria-current="page"/i, `${name} page 1 must carry aria-current="page"`);
    assert.match(navMatch[1], /data-page-nav="prev"/i, `${name} pagination missing Previous control`);
    assert.match(navMatch[1], /data-page-nav="next"/i, `${name} pagination missing Next control`);
    assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*>Showing Page 1/i, `${name} missing accessible page status live region`);
  }
});

test('4. Distinct MENA form controls, separate salary currency/period toggles, CV overwrite warning & honeypot', () => {
  for (const [name, html] of [
    ['gulftalent-mock.html', GULFTALENT_HTML],
    ['bayt-mock.html', BAYT_HTML],
  ]) {
    const selects = getElementsByTag(html, 'select');
    const selectByName = new Map(selects.map(s => [s.attrs.name, s]));
    const labels = getElementsByTag(html, 'label');
    const labelForIds = new Set(labels.map(l => l.attrs.for).filter(Boolean));

    // Distinct required selects for nationality, residency, visa, sponsorship, notice period, and salary currency
    for (const fieldName of ['nationality', 'residence_country', 'visa_status', 'requires_sponsorship', 'notice_period', 'salary_currency']) {
      const sel = selectByName.get(fieldName);
      assert.ok(sel, `${name} missing distinct <select name="${fieldName}">`);
      assert.ok(sel.attrs.id && labelForIds.has(sel.attrs.id), `${name} select "${fieldName}" must be associated with an explicit <label for="...">`);
    }

    // Notice period select exposes multiple explicit options
    const noticeBlock = html.match(/<select\b[^>]*name="notice_period"[^>]*>([\s\S]*?)<\/select>/i);
    assert.ok(noticeBlock, `${name} missing notice_period select block`);
    assert.ok(getElementsByTag(noticeBlock[1], 'option').length >= 4, `${name} notice_period must offer >= 4 options`);

    // Salary amount, salary currency, and salary pay period (Monthly / Annual) are strictly separate controls
    const inputs = getElementsByTag(html, 'input');
    const salaryAmount = inputs.find(i => i.attrs.name === 'expected_salary_amount');
    assert.ok(salaryAmount, `${name} missing expected_salary_amount input`);
    const periodRadios = inputs.filter(i => i.attrs.name === 'salary_period' && i.attrs.type === 'radio');
    const periodValues = new Set(periodRadios.map(r => r.attrs.value));
    assert.ok(periodValues.has('monthly') && periodValues.has('annual'), `${name} must separate Monthly and Annual salary_period radio controls`);
    assert.match(html, /<fieldset\b[^>]*data-salary-period-control="true"/i, `${name} must group salary period controls inside a labeled <fieldset>`);

    // CV upload + shared profile CV overwrite warning
    const resumeInput = inputs.find(i => i.attrs.name === 'resume');
    assert.ok(resumeInput && resumeInput.attrs.type === 'file', `${name} missing CV upload file input`);
    assert.match(resumeInput.attrs.accept || '', /\.pdf/i, `${name} CV upload must accept .pdf`);
    assert.match(html, /data-profile-overwrite-warning="true"/i, `${name} must include shared profile CV overwrite warning`);

    // Hidden honeypot attributes
    const hpWrap = html.match(/<div\b[^>]*aria-hidden="true"[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    assert.ok(hpWrap, `${name} honeypot wrapper must set aria-hidden="true" and display:none`);
    const hpInput = getElementsByTag(hpWrap[1], 'input').find(i => i.attrs.name === 'website_url_honeypot');
    assert.ok(hpInput, `${name} missing website_url_honeypot inside hidden wrapper`);
    assert.equal(hpInput.attrs.tabindex, '-1');
    assert.equal(hpInput.attrs.autocomplete, 'off');
    assert.ok(!Object.prototype.hasOwnProperty.call(hpInput.attrs, 'required'), `${name} honeypot must not be required`);
  }
});

test('5. Bayt bilingual Arabic RTL block preserves Latin technical keywords & zero invisible Unicode/BiDi chars everywhere', () => {
  // Bayt fixture must include Arabic RTL job description & bilingual screening question with Latin tech terms
  const rtlJdMatch = BAYT_HTML.match(/<div\b[^>]*lang="ar"[^>]*dir="rtl"[^>]*data-bilingual-rtl="true"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(rtlJdMatch, 'bayt-mock.html missing Arabic RTL job description block (lang="ar" dir="rtl")');
  assert.match(rtlJdMatch[1], /[\u0600-\u06FF]/, 'Arabic RTL JD block must contain actual Arabic script');
  for (const tech of ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Playwright']) {
    assert.ok(rtlJdMatch[1].includes(tech), `Arabic RTL JD block must preserve Latin technical keyword "${tech}"`);
  }

  const rtlQuestionMatch = BAYT_HTML.match(/<div\b[^>]*lang="ar"[^>]*dir="rtl"[^>]*data-bilingual-question="true"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(rtlQuestionMatch, 'bayt-mock.html missing bilingual Arabic RTL screening question block');
  assert.match(rtlQuestionMatch[1], /[\u0600-\u06FF]/, 'Bilingual screening question must contain Arabic script');
  assert.ok(rtlQuestionMatch[1].includes('TypeScript') && rtlQuestionMatch[1].includes('PostgreSQL'));

  // Zero invisible Unicode Tag or BiDi control characters across fixtures and playbook
  assertNoInvisibleUnicodeOrBiDi(GULFTALENT_HTML, 'evals/fixtures/boards/gulftalent-mock.html');
  assertNoInvisibleUnicodeOrBiDi(BAYT_HTML, 'evals/fixtures/boards/bayt-mock.html');
  assertNoInvisibleUnicodeOrBiDi(MENA_SKILL, 'skills/platforms/mena-boards.md');
});

test('6. Playbook metadata, required structure, semantic locators & safety contracts in skills/platforms/mena-boards.md', () => {
  const lines = MENA_SKILL.split(/\r?\n/);
  assert.ok(lines.length < 500, `mena-boards.md must stay under 500 lines (got ${lines.length})`);

  // YAML frontmatter keys + valid ISO last_verified
  assert.ok(MENA_SKILL.startsWith('---'), 'mena-boards.md missing YAML frontmatter');
  const fmEnd = MENA_SKILL.indexOf('\n---', 3);
  assert.ok(fmEnd > 0, 'mena-boards.md unterminated YAML frontmatter');
  const fm = MENA_SKILL.slice(3, fmEnd);
  for (const key of ['name', 'version', 'last_verified', 'description', 'triggers', 'requires_mcp', 'preconditions', 'requires_skills', 'verification']) {
    assert.match(fm, new RegExp(`^${key}:`, 'm'), `mena-boards.md missing frontmatter key: ${key}`);
  }
  const lvMatch = fm.match(/^last_verified:\s*"?(\d{4}-\d{2}-\d{2})"?/m);
  assert.ok(lvMatch, 'mena-boards.md last_verified must be ISO YYYY-MM-DD');

  // 3 mandatory H2 headings
  for (const heading of [
    '## When to Use & Preconditions',
    '## Deterministic Step-by-Step Execution',
    '## Anti-Patterns (What NEVER To Do) & Self-Verification Check',
  ]) {
    assert.ok(MENA_SKILL.includes(heading), `mena-boards.md missing mandatory heading: ${heading}`);
  }

  // Required coverage & safety invariants
  assert.match(MENA_SKILL, /Live-tested:\s*\*\*UNVERIFIED\*\*/i, 'Playbook must truthfully disclose UNVERIFIED live-testing status');
  assert.match(MENA_SKILL, /Role -> Label -> Placeholder -> Text/, 'Playbook must enforce semantic locator priority');
  assert.match(MENA_SKILL, /### Bayt \(`bayt`\)/);
  assert.match(MENA_SKILL, /### GulfTalent \(`gulftalent`\)/);
  assert.match(MENA_SKILL, /auth_check_url/i);
  assert.match(MENA_SKILL, /aria-expanded/i);
  assert.match(MENA_SKILL, /aria-current="page"/i);
  assert.match(MENA_SKILL, /skills\/platforms\/ats-engines\.md/);
  assert.match(MENA_SKILL, /recruitment agenc/i);
  assert.match(MENA_SKILL, /nationality/i);
  assert.match(MENA_SKILL, /notice period/i);
  assert.match(MENA_SKILL, /Monthly.*Annual/i);
  assert.match(MENA_SKILL, /dir="rtl"/i);
  assert.match(MENA_SKILL, /overwrite/i);
  assert.match(MENA_SKILL, /manual_apply/i);
  assert.match(MENA_SKILL, /needs_review/i);
  assert.match(MENA_SKILL, /never automate account creation|do not create an account|never create an account/i);
  assert.match(MENA_SKILL, /legal terms/i);
  assert.match(MENA_SKILL, /CAPTCHA/i);
});

test('7. Config, manifest, registry, guardrails, docs & Profile Intelligence adapter parity', () => {
  // Manifest parity with mena-boards.md frontmatter
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const menaEntry = manifest.skills.find(s => s.name === 'mena-boards');
  assert.ok(menaEntry, 'mena-boards entry missing in skills/skills-manifest.json');
  assert.equal(menaEntry.path, 'skills/platforms/mena-boards.md');
  assert.match(MENA_SKILL, new RegExp(`^version:\\s*"?${menaEntry.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'm'));
  assert.match(MENA_SKILL, new RegExp(`^last_verified:\\s*"?${menaEntry.last_verified}"?`, 'm'));
  assert.match(menaEntry.description, /GulfTalent/i);
  assert.match(menaEntry.description, /Bayt/i);
  assert.ok(menaEntry.triggers.some(t => /gulftalent/i.test(t)), 'manifest triggers must include gulftalent');

  // Registry & documentation parity (PLATFORMS.md lives in PACKAGE_ROOT when running inside an isolated `init` workspace)
  for (const rel of ['skills/REGISTRY.md', 'PLATFORMS.md', 'docs/platform-registry.md', 'docs/SKILL_CATALOG.md']) {
    const filePath = [path.join(ROOT, rel), path.join(PACKAGE_ROOT, rel)].find(p => fs.existsSync(p));
    assert.ok(filePath, `Could not locate ${rel}`);
    const text = fs.readFileSync(filePath, 'utf8');
    assert.match(text, /bayt/i, `${rel} must list Bayt`);
    assert.match(text, /gulftalent/i, `${rel} must list GulfTalent`);
    assert.match(text, /skills\/platforms\/mena-boards\.md/, `${rel} must reference skills/platforms/mena-boards.md`);
  }

  // targets.yaml.example: both bayt & gulftalent present, disabled, unverified, manual-handoff mode
  const targetsYaml = fs.readFileSync(path.join(ROOT, 'context', 'targets.yaml.example'), 'utf8');
  for (const platform of ['bayt', 'gulftalent']) {
    const block = getYamlBlock(targetsYaml, new RegExp(`platform:\\s*"${platform}"`));
    assert.ok(block, `context/targets.yaml.example missing target block for ${platform}`);
    assert.match(block, /enabled:\s*false/, `${platform} target must ship disabled`);
    assert.match(block, /live_verified:\s*false/, `${platform} target must ship live_verified: false`);
    assert.match(block, /auth_check_url:\s*"https:\/\//, `${platform} target must specify auth_check_url`);
    assert.match(block, /playbook:\s*"skills\/platforms\/mena-boards\.md"/, `${platform} target must route to mena-boards.md`);
    assert.match(block, /automation_mode:\s*"manual_apply_or_ats_redirect"/, `${platform} target must default to manual_apply_or_ats_redirect`);
  }

  // guardrails.yaml: both unverified MENA boards capped at 0
  const guardrails = fs.readFileSync(path.join(ROOT, 'config', 'guardrails.yaml'), 'utf8');
  assert.match(guardrails, /^\s+bayt:\s*0\s*$/m, 'config/guardrails.yaml must cap unverified bayt at 0');
  assert.match(guardrails, /^\s+gulftalent:\s*0\s*$/m, 'config/guardrails.yaml must cap unverified gulftalent at 0');

  // Profile Intelligence adapter aliases preserve job_boards routing and save: false policy
  for (const alias of ['bayt', 'gulftalent']) {
    const adapter = engine.getPlatformAdapter(alias);
    assert.equal(adapter.platform_id, 'job_boards', `${alias} must map to job_boards adapter`);
    assert.equal(adapter.unknown_platform_fallback, false, `${alias} must not fall back to generic`);
    assert.equal(adapter.capabilities.save, false, `${alias} adapter must preserve save: false`);
    assert.equal(adapter.requires_approval, true, `${alias} adapter must require approval`);
  }
});

test('8. Employer ATS form fixture isolation & EVAL-01..20 baseline compatibility', () => {
  // Board fixtures MUST stay isolated from employer ATS mocks in evals/fixtures/forms/
  const atsFiles = fs.readdirSync(FORMS_DIR).filter(f => f.endsWith('.html'));
  assert.ok(!atsFiles.some(f => /bayt|gulftalent/i.test(f)), 'MENA board fixtures must not live inside evals/fixtures/forms/');

  // Baseline eval remains 20/20 PASS unchanged
  const evalRes = spawnSync(process.execPath, [CLI, 'eval', '--baseline'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(evalRes.status, 0, evalRes.stdout + evalRes.stderr);
  assert.match(evalRes.stdout, /20\/20 assertions PASSED/);
});
