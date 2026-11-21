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
const STEPSTONE_PATH = path.join(BOARDS_DIR, 'stepstone-mock.html');
const GLOBAL_SKILL_PATH = path.join(ROOT, 'skills', 'platforms', 'global-boards.md');

const STEPSTONE_HTML = fs.readFileSync(STEPSTONE_PATH, 'utf8');
const GLOBAL_SKILL = fs.readFileSync(GLOBAL_SKILL_PATH, 'utf8');

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

test('1. Offline StepStone DACH fixture integrity: synthetic .example host, zero remote assets, local-only JS', () => {
  assert.ok(fs.existsSync(STEPSTONE_PATH), 'evals/fixtures/boards/stepstone-mock.html must exist');
  assert.doesNotMatch(STEPSTONE_HTML, /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, 'Fixture must not load external assets');
  assert.doesNotMatch(STEPSTONE_HTML, /<form\b[^>]*\baction\s*=\s*["']https?:\/\//i, 'Fixture must not submit to a remote URL');
  assert.doesNotMatch(
    STEPSTONE_HTML,
    /https?:\/\/[^"'\s]*(?:stepstone\.(?:de|at|ch)|myworkdayjobs\.com|greenhouse\.io)/i,
    'Fixture must never reference live StepStone or live ATS URLs',
  );
  assert.match(STEPSTONE_HTML, /data-platform="stepstone"/);
  assert.match(STEPSTONE_HTML, /data-synthetic-host="www\.stepstone\.example"/);
  assert.match(STEPSTONE_HTML, /data-dach-domains="\.de,\.at,\.ch"/);
  assert.match(STEPSTONE_HTML, /Not proof of live StepStone compatibility/i, 'Fixture must clearly state synthetic scope');

  const scriptMatch = STEPSTONE_HTML.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, 'Fixture must include minimal local inline script');
  assert.match(scriptMatch[1], /event\.preventDefault\(\)/, 'Submit handler must prevent default navigation');
  assert.doesNotMatch(scriptMatch[1], /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|window\.open)\b/, 'Fixture JS must never perform network calls or popups');
});

test('2. Signed-in state, synthetic account gate & manual-handoff disabled submit controls', () => {
  assert.match(STEPSTONE_HTML, /data-auth-check-url="https:\/\/www\.stepstone\.example\/my-account\/"/i);
  assert.match(STEPSTONE_HTML, /<header\b[^>]*data-auth-state="signed-in"/i);
  assert.match(STEPSTONE_HTML, /data-signed-in-indicator="true"/i);

  const gateMatch = STEPSTONE_HTML.match(/<section\b[^>]*id="stepstone-account-gate"[^>]*data-auth-gate="sign-in-required"[^>]*>([\s\S]*?)<\/section>/i);
  assert.ok(gateMatch, 'Missing synthetic account gate #stepstone-account-gate');
  assert.match(gateMatch[1], /data-account-action="sign-in"/i);
  assert.match(gateMatch[1], /data-account-action="create-account"/i);
  assert.match(gateMatch[1], /data-legal-terms="true"/i);

  const formMatch = STEPSTONE_HTML.match(/<form\b[^>]*id="stepstone-easy-apply-form"[^>]*data-manual-handoff="true"[^>]*>([\s\S]*?)<\/form>/i);
  assert.ok(formMatch, 'Missing manual-handoff Easy Apply form #stepstone-easy-apply-form');
  assert.match(formMatch[1], /data-manual-handoff-notice="true"/i);
  assert.match(
    formMatch[1],
    /<button\b[^>]*type="submit"[^>]*aria-disabled="true"[^>]*data-requires-manual-handoff="true"[^>]*data-one-click-guarded="true"/i,
    'Submit control must enforce aria-disabled="true", manual-handoff, and one-click guard',
  );
});

test('3. Semantic job-card expansion, pagination, direct vs. agency attribution, salary estimates & external ATS handoff', () => {
  const articles = getElementsByTag(STEPSTONE_HTML, 'article');
  assert.ok(articles.length >= 2, 'Fixture must model >= 2 job cards');
  const employerTypes = new Set(articles.map(a => a.attrs['data-employer-type']));
  assert.ok(employerTypes.has('direct'), 'Fixture must model a direct employer card');
  assert.ok(employerTypes.has('agency'), 'Fixture must model a Personalberatung / recruitment agency card');
  assert.match(STEPSTONE_HTML, /data-attribution-badge="direct"/i);
  assert.match(STEPSTONE_HTML, /data-attribution-badge="agency"/i);

  // Canonical stepstone:<tld>:<id> IDs covering multiple DACH domains
  const postingIds = articles.map(a => a.attrs['data-posting-id'] || '');
  assert.ok(postingIds.every(id => /^stepstone:(?:de|at|ch):[a-z0-9-]+$/i.test(id)), `Unexpected posting IDs: ${postingIds.join(', ')}`);
  assert.ok(postingIds.some(id => id.startsWith('stepstone:de:')), 'Expected .de posting ID');
  assert.ok(postingIds.some(id => id.startsWith('stepstone:ch:')), 'Expected .ch posting ID');

  // Platform salary estimate vs. employer-stated range attribution
  assert.match(STEPSTONE_HTML, /data-salary-attribution="platform-estimate"/i);
  assert.match(STEPSTONE_HTML, /data-salary-attribution="employer-stated"/i);

  // Every expand button maps aria-controls to an existing role="region" JD container
  const expandBtns = getElementsByTag(STEPSTONE_HTML, 'button').filter(b => (b.attrs.class || '').includes('expand-card'));
  assert.ok(expandBtns.length >= 2, 'Expected >= 2 expandable job cards');
  for (const btn of expandBtns) {
    assert.equal(btn.attrs['aria-expanded'], 'false');
    const targetId = btn.attrs['aria-controls'];
    assert.ok(targetId, 'Expand button must specify aria-controls');
    assert.match(STEPSTONE_HTML, new RegExp(`<div\\b[^>]*id="${targetId}"[^>]*role="region"[^>]*>`, 'i'));
  }

  // External ATS redirect link with synthetic .example host
  const extLink = getElementsByTag(STEPSTONE_HTML, 'a').find(a => a.attrs['data-apply-type'] === 'external-ats');
  assert.ok(extLink, 'Missing external ATS redirect trigger');
  assert.match(extLink.attrs['data-external-ats-host'] || '', /\.example$/i);

  // Accessible pagination landmark with active page indicator and Prev/Next controls
  const navMatch = STEPSTONE_HTML.match(/<nav\b[^>]*id="st-pagination"[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(navMatch, 'Missing accessible pagination <nav id="st-pagination">');
  assert.match(navMatch[1], /data-page-number="1"[^>]*aria-current="page"/i);
  assert.match(navMatch[1], /data-page-nav="prev"/i);
  assert.match(navMatch[1], /data-page-nav="next"/i);
  assert.match(STEPSTONE_HTML, /id="st-page-status"[^>]*role="status"[^>]*aria-live="polite"/i);
});

test('4. DACH form contracts: GDPR vs. optional marketing/Talentpool, optional Anschreiben, EUR/CHF, CV overwrite & honeypot', () => {
  const inputs = getElementsByTag(STEPSTONE_HTML, 'input');
  const byName = new Map(inputs.map(i => [i.attrs.name, i]));
  const labels = getElementsByTag(STEPSTONE_HTML, 'label');
  const labelForIds = new Set(labels.map(l => l.attrs.for).filter(Boolean));

  // Required GDPR privacy consent checkbox
  const gdprBox = byName.get('gdpr_privacy_consent');
  assert.ok(gdprBox && gdprBox.attrs.type === 'checkbox', 'Missing gdpr_privacy_consent checkbox');
  assert.equal(gdprBox.attrs['data-consent-type'], 'required-gdpr');
  assert.ok(Object.prototype.hasOwnProperty.call(gdprBox.attrs, 'required'), 'gdpr_privacy_consent must be marked required');
  assert.ok(gdprBox.attrs.id && labelForIds.has(gdprBox.attrs.id), 'gdpr_privacy_consent must have explicit <label>');

  // Optional Talentpool, marketing, and visibility boxes MUST NOT be required or pre-checked
  for (const [optName, consentType] of [
    ['talent_pool_opt_in', 'optional-talent-pool'],
    ['marketing_job_alerts', 'optional-marketing'],
    ['recruiter_profile_visibility', 'optional-visibility'],
  ]) {
    const box = byName.get(optName);
    assert.ok(box && box.attrs.type === 'checkbox', `Missing optional checkbox "${optName}"`);
    assert.equal(box.attrs['data-consent-type'], consentType);
    assert.ok(!Object.prototype.hasOwnProperty.call(box.attrs, 'required'), `${optName} must remain optional`);
    assert.ok(!Object.prototype.hasOwnProperty.call(box.attrs, 'checked'), `${optName} must not be pre-checked`);
  }

  // Optional Anschreiben file + text controls MUST NOT carry required
  const anschreibenFile = byName.get('anschreiben_file');
  assert.ok(anschreibenFile && anschreibenFile.attrs.type === 'file', 'Missing optional anschreiben_file upload');
  assert.ok(!Object.prototype.hasOwnProperty.call(anschreibenFile.attrs, 'required'), 'Optional Anschreiben file must not be required');
  const anschreibenText = getElementsByTag(STEPSTONE_HTML, 'textarea').find(t => t.attrs.name === 'anschreiben_text');
  assert.ok(anschreibenText, 'Missing optional anschreiben_text textarea');
  assert.ok(!Object.prototype.hasOwnProperty.call(anschreibenText.attrs, 'required'), 'Optional Anschreiben text must not be required');

  // Separate EUR/CHF currency select + Annual/Monthly radio group + distinct DACH work-auth select
  const selects = getElementsByTag(STEPSTONE_HTML, 'select');
  const selectByName = new Map(selects.map(s => [s.attrs.name, s]));
  for (const reqSelect of ['dach_work_authorization', 'salary_currency']) {
    const sel = selectByName.get(reqSelect);
    assert.ok(sel && sel.attrs.id && labelForIds.has(sel.attrs.id), `Missing labeled <select name="${reqSelect}">`);
  }
  const currencyBlock = STEPSTONE_HTML.match(/<select\b[^>]*name="salary_currency"[^>]*>([\s\S]*?)<\/select>/i);
  assert.ok(currencyBlock, 'Missing salary_currency select block');
  const currencyValues = new Set(getElementsByTag(currencyBlock[1], 'option').map(o => o.attrs.value));
  assert.ok(currencyValues.has('EUR') && currencyValues.has('CHF'), 'salary_currency must separate EUR and CHF');

  const periodRadios = inputs.filter(i => i.attrs.name === 'salary_period' && i.attrs.type === 'radio');
  const periodVals = new Set(periodRadios.map(r => r.attrs.value));
  assert.ok(periodVals.has('annual') && periodVals.has('monthly'), 'salary_period must separate Annual and Monthly');

  // Required CV upload + shared profile overwrite warning
  const resumeInput = byName.get('resume');
  assert.ok(resumeInput && resumeInput.attrs.type === 'file', 'Missing CV upload file input');
  assert.ok(Object.prototype.hasOwnProperty.call(resumeInput.attrs, 'required'), 'CV upload must be required');
  assert.match(resumeInput.attrs.accept || '', /\.pdf/i);
  assert.match(STEPSTONE_HTML, /data-profile-overwrite-warning="true"/i);

  // Hidden honeypot
  const hpWrap = STEPSTONE_HTML.match(/<div\b[^>]*aria-hidden="true"[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(hpWrap, 'Honeypot wrapper must set aria-hidden="true" and display:none');
  const hpInput = getElementsByTag(hpWrap[1], 'input').find(i => i.attrs.name === 'website_url_honeypot');
  assert.ok(hpInput, 'Missing website_url_honeypot inside hidden wrapper');
  assert.equal(hpInput.attrs.tabindex, '-1');
  assert.equal(hpInput.attrs.autocomplete, 'off');
  assert.ok(!Object.prototype.hasOwnProperty.call(hpInput.attrs, 'required'), 'Honeypot must not be required');
});

test('5. German localization preserves Latin technical keywords & zero invisible Unicode/BiDi chars', () => {
  const deJdMatch = STEPSTONE_HTML.match(/<div\b[^>]*id="st-jd-81204"[^>]*lang="de"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(deJdMatch, 'Missing German lang="de" JD container #st-jd-81204');
  assert.match(deJdMatch[1], /Ihre Aufgaben/i);
  for (const tech of ['TypeScript', 'Node.js', 'PostgreSQL', 'CI/CD']) {
    assert.ok(deJdMatch[1].includes(tech), `German JD must preserve Latin technical keyword "${tech}"`);
  }

  assertNoInvisibleUnicodeOrBiDi(STEPSTONE_HTML, 'evals/fixtures/boards/stepstone-mock.html');
  assertNoInvisibleUnicodeOrBiDi(GLOBAL_SKILL, 'skills/platforms/global-boards.md');
});

test('6. Playbook metadata, required structure & StepStone DACH safety invariants in skills/platforms/global-boards.md', () => {
  const lines = GLOBAL_SKILL.split(/\r?\n/);
  assert.ok(lines.length < 500, `global-boards.md must stay under 500 lines (got ${lines.length})`);

  assert.ok(GLOBAL_SKILL.startsWith('---'), 'global-boards.md missing YAML frontmatter');
  const fmEnd = GLOBAL_SKILL.indexOf('\n---', 3);
  assert.ok(fmEnd > 0, 'global-boards.md unterminated frontmatter');
  const fm = GLOBAL_SKILL.slice(3, fmEnd);
  for (const key of ['name', 'version', 'last_verified', 'description', 'triggers', 'requires_mcp', 'preconditions', 'requires_skills', 'verification']) {
    assert.match(fm, new RegExp(`^${key}:`, 'm'), `global-boards.md missing frontmatter key: ${key}`);
  }
  assert.match(fm, /^last_verified:\s*"?\d{4}-\d{2}-\d{2}"?/m);

  for (const heading of [
    '## When to Use & Preconditions',
    '## Deterministic Step-by-Step Execution',
    '## Anti-Patterns (What NEVER To Do) & Self-Verification Check',
  ]) {
    assert.ok(GLOBAL_SKILL.includes(heading), `global-boards.md missing mandatory heading: ${heading}`);
  }

  // Required StepStone DACH & safety invariants
  assert.match(GLOBAL_SKILL, /Live-tested:\s*\*\*UNVERIFIED\*\*/i, 'Must truthfully disclose UNVERIFIED live-testing status');
  assert.match(GLOBAL_SKILL, /Role -> Label -> Placeholder -> Text/);
  assert.match(GLOBAL_SKILL, /\.de.*\.at.*\.ch/i);
  assert.match(GLOBAL_SKILL, /EUR.*CHF/i);
  assert.match(GLOBAL_SKILL, /auth_check_url/i);
  assert.match(GLOBAL_SKILL, /aria-expanded/i);
  assert.match(GLOBAL_SKILL, /aria-current="page"/i);
  assert.match(GLOBAL_SKILL, /Schnellbewerbung/i);
  assert.match(GLOBAL_SKILL, /Anschreiben/i);
  assert.match(GLOBAL_SKILL, /GDPR|DSGVO/i);
  assert.match(GLOBAL_SKILL, /Talentpool/i);
  assert.match(GLOBAL_SKILL, /skills\/15-multilingual-adaptation\.md/);
  assert.match(GLOBAL_SKILL, /skills\/platforms\/ats-engines\.md/);
  assert.match(GLOBAL_SKILL, /manual_apply/i);
  assert.match(GLOBAL_SKILL, /needs_review/i);
  assert.match(GLOBAL_SKILL, /overwrite/i);
  assert.match(GLOBAL_SKILL, /website_url_honeypot/);
});

test('7. Config, manifest, registry, guardrails, docs & Profile Intelligence adapter parity', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const globalEntry = manifest.skills.find(s => s.name === 'global-boards');
  assert.ok(globalEntry, 'global-boards entry missing in skills/skills-manifest.json');
  assert.equal(globalEntry.path, 'skills/platforms/global-boards.md');
  assert.match(GLOBAL_SKILL, new RegExp(`^version:\\s*"?${globalEntry.version.replace(/\./g, '\\.')}"?`, 'm'));
  assert.match(GLOBAL_SKILL, new RegExp(`^last_verified:\\s*"?${globalEntry.last_verified}"?`, 'm'));
  assert.match(globalEntry.description, /StepStone/i);
  assert.ok(globalEntry.triggers.some(t => /stepstone/i.test(t)), 'manifest triggers must include stepstone');

  // Registry & docs parity (PLATFORMS.md lives in PACKAGE_ROOT during isolated `init` smoke tests)
  for (const rel of ['skills/REGISTRY.md', 'PLATFORMS.md', 'docs/platform-registry.md', 'docs/SKILL_CATALOG.md']) {
    const filePath = [path.join(ROOT, rel), path.join(PACKAGE_ROOT, rel)].find(p => fs.existsSync(p));
    assert.ok(filePath, `Could not locate ${rel}`);
    const text = fs.readFileSync(filePath, 'utf8');
    assert.match(text, /stepstone/i, `${rel} must list StepStone`);
    assert.match(text, /skills\/platforms\/global-boards\.md/, `${rel} must reference skills/platforms/global-boards.md`);
  }

  // targets.yaml.example: stepstone disabled, unverified, manual-handoff mode
  const targetsYaml = fs.readFileSync(path.join(ROOT, 'context', 'targets.yaml.example'), 'utf8');
  const block = getYamlBlock(targetsYaml, /platform:\s*"stepstone"/);
  assert.ok(block, 'context/targets.yaml.example missing target block for stepstone');
  assert.match(block, /enabled:\s*false/);
  assert.match(block, /live_verified:\s*false/);
  assert.match(block, /auth_check_url:\s*"https:\/\/www\.stepstone\.de\/my-account\/"/);
  assert.match(block, /playbook:\s*"skills\/platforms\/global-boards\.md"/);
  assert.match(block, /automation_mode:\s*"manual_apply_or_ats_redirect"/);

  // guardrails.yaml: unverified stepstone capped at 0
  const guardrails = fs.readFileSync(path.join(ROOT, 'config', 'guardrails.yaml'), 'utf8');
  assert.match(guardrails, /^\s+stepstone:\s*0\s*$/m, 'config/guardrails.yaml must cap unverified stepstone at 0');

  // Profile Intelligence adapter maps stepstone -> job_boards with save: false and requires_approval: true
  const adapter = engine.getPlatformAdapter('stepstone');
  assert.equal(adapter.platform_id, 'job_boards');
  assert.equal(adapter.unknown_platform_fallback, false);
  assert.equal(adapter.capabilities.save, false);
  assert.equal(adapter.requires_approval, true);
});

test('8. Employer ATS fixture isolation & EVAL-01..20 baseline compatibility', () => {
  const atsFiles = fs.readdirSync(FORMS_DIR).filter(f => f.endsWith('.html'));
  assert.ok(!atsFiles.some(f => /stepstone/i.test(f)), 'StepStone board fixture must not live inside evals/fixtures/forms/');

  const evalRes = spawnSync(process.execPath, [CLI, 'eval', '--baseline'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(evalRes.status, 0, evalRes.stdout + evalRes.stderr);
  assert.match(evalRes.stdout, /20\/20 assertions PASSED/);
});
