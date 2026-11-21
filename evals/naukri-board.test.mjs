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
const NAUKRI_PATH = path.join(BOARDS_DIR, 'naukri-mock.html');
const GLOBAL_SKILL_PATH = path.join(ROOT, 'skills', 'platforms', 'global-boards.md');

const NAUKRI_HTML = fs.readFileSync(NAUKRI_PATH, 'utf8');
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

test('1. Offline Naukri India fixture integrity: synthetic .example host, zero external assets, local-only JS', () => {
  assert.ok(fs.existsSync(NAUKRI_PATH), 'evals/fixtures/boards/naukri-mock.html must exist');
  assert.doesNotMatch(NAUKRI_HTML, /<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, 'Fixture must not load external assets');
  assert.doesNotMatch(NAUKRI_HTML, /<form\b[^>]*\baction\s*=\s*["']https?:\/\//i, 'Fixture must not submit to a remote URL');
  assert.doesNotMatch(
    NAUKRI_HTML,
    /https?:\/\/[^"'\s]*(?:naukri\.com|naukrigulf\.com|myworkdayjobs\.com|greenhouse\.io)/i,
    'Fixture must never reference live Naukri or live ATS URLs',
  );
  assert.match(NAUKRI_HTML, /data-platform="naukri"/);
  assert.match(NAUKRI_HTML, /data-synthetic-host="www\.naukri\.example"/);
  assert.match(NAUKRI_HTML, /Not proof of live Naukri compatibility/i, 'Fixture must clearly state synthetic scope');

  const scriptMatch = NAUKRI_HTML.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, 'Fixture must include minimal local inline script');
  assert.match(scriptMatch[1], /event\.preventDefault\(\)/, 'Submit handler must prevent default navigation');
  assert.doesNotMatch(scriptMatch[1], /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|window\.open)\b/, 'Fixture JS must never perform network calls or popups');
});

test('2. Signed-in state, Login/OTP gate, anti-bot/CAPTCHA circuit-breaker signal & manual-handoff submit', () => {
  assert.match(NAUKRI_HTML, /data-auth-check-url="https:\/\/www\.naukri\.example\/mnjuser\/homepage"/i);
  assert.match(NAUKRI_HTML, /<header\b[^>]*data-auth-state="signed-in"/i);
  assert.match(NAUKRI_HTML, /data-signed-in-indicator="true"/i);

  const gateMatch = NAUKRI_HTML.match(/<section\b[^>]*id="naukri-account-gate"[^>]*data-auth-gate="sign-in-or-otp-required"[^>]*>([\s\S]*?)<\/section>/i);
  assert.ok(gateMatch, 'Missing synthetic Login/OTP gate #naukri-account-gate');
  assert.match(gateMatch[1], /data-account-action="sign-in"/i);
  assert.match(gateMatch[1], /data-account-action="create-account"/i);
  assert.match(gateMatch[1], /data-otp-challenge="true"/i, 'Gate must model mobile OTP challenge stop condition');
  assert.match(gateMatch[1], /data-legal-terms="true"/i);

  const cbMatch = NAUKRI_HTML.match(/<section\b[^>]*id="naukri-circuit-breaker-banner"[^>]*role="alert"[^>]*data-circuit-breaker-signal="captcha-or-rate-limit"[^>]*>([\s\S]*?)<\/section>/i);
  assert.ok(cbMatch, 'Missing anti-bot/CAPTCHA circuit-breaker alert #naukri-circuit-breaker-banner');
  assert.match(cbMatch[1], /Verify you are human|HTTP 429/i);

  const formMatch = NAUKRI_HTML.match(/<form\b[^>]*id="naukri-recruiter-screening-form"[^>]*data-manual-handoff="true"[^>]*>([\s\S]*?)<\/form>/i);
  assert.ok(formMatch, 'Missing manual-handoff recruiter screening form #naukri-recruiter-screening-form');
  assert.match(formMatch[1], /data-manual-handoff-notice="true"/i);
  assert.match(
    formMatch[1],
    /<button\b[^>]*type="submit"[^>]*aria-disabled="true"[^>]*data-requires-manual-handoff="true"[^>]*data-one-click-guarded="true"/i,
    'Submit control must enforce aria-disabled="true", manual-handoff, and one-click guard',
  );
});

test('3. Semantic job-card expansion, pagination, direct vs. agency attribution & external ATS handoff', () => {
  const articles = getElementsByTag(NAUKRI_HTML, 'article');
  assert.ok(articles.length >= 2, 'Fixture must model >= 2 job cards');
  const employerTypes = new Set(articles.map(a => a.attrs['data-employer-type']));
  assert.ok(employerTypes.has('direct'), 'Fixture must model a direct employer card');
  assert.ok(employerTypes.has('agency'), 'Fixture must model a placement consultancy / agency card');
  assert.match(NAUKRI_HTML, /data-attribution-badge="direct"/i);
  assert.match(NAUKRI_HTML, /data-attribution-badge="agency"/i);

  const postingIds = articles.map(a => a.attrs['data-posting-id'] || '');
  assert.ok(postingIds.every(id => /^naukri:[a-z0-9-]+$/i.test(id)), `Unexpected posting IDs: ${postingIds.join(', ')}`);

  // Every expand button maps aria-controls to an existing role="region" JD container
  const expandBtns = getElementsByTag(NAUKRI_HTML, 'button').filter(b => (b.attrs.class || '').includes('expand-card'));
  assert.ok(expandBtns.length >= 2, 'Expected >= 2 expandable job cards');
  for (const btn of expandBtns) {
    assert.equal(btn.attrs['aria-expanded'], 'false');
    const targetId = btn.attrs['aria-controls'];
    assert.ok(targetId, 'Expand button must specify aria-controls');
    assert.match(NAUKRI_HTML, new RegExp(`<div\\b[^>]*id="${targetId}"[^>]*role="region"[^>]*>`, 'i'));
  }

  // On-board recruiter screening AND external ATS redirect triggers both modeled
  const links = getElementsByTag(NAUKRI_HTML, 'a');
  assert.ok(links.some(a => a.attrs['data-apply-type'] === 'on-board-recruiter'), 'Missing on-board recruiter screening trigger');
  const extLink = links.find(a => a.attrs['data-apply-type'] === 'external-ats');
  assert.ok(extLink, 'Missing external ATS redirect trigger');
  assert.match(extLink.attrs['data-external-ats-host'] || '', /\.example$/i);

  // Accessible pagination landmark with active page indicator & Prev/Next controls
  const navMatch = NAUKRI_HTML.match(/<nav\b[^>]*id="nk-pagination"[^>]*>([\s\S]*?)<\/nav>/i);
  assert.ok(navMatch, 'Missing accessible pagination <nav id="nk-pagination">');
  assert.match(navMatch[1], /data-page-number="1"[^>]*aria-current="page"/i);
  assert.match(navMatch[1], /data-page-nav="prev"/i);
  assert.match(navMatch[1], /data-page-nav="next"/i);
  assert.match(NAUKRI_HTML, /id="nk-page-status"[^>]*role="status"[^>]*aria-live="polite"/i);
});

test('4. India form controls: Current/Expected CTC (LPA), notice/immediate joiner, locations, CV overwrite & honeypot', () => {
  const inputs = getElementsByTag(NAUKRI_HTML, 'input');
  const inputByName = new Map(inputs.map(i => [i.attrs.name, i]));
  const selects = getElementsByTag(NAUKRI_HTML, 'select');
  const selectByName = new Map(selects.map(s => [s.attrs.name, s]));
  const labels = getElementsByTag(NAUKRI_HTML, 'label');
  const labelForIds = new Set(labels.map(l => l.attrs.for).filter(Boolean));

  // Separate Current CTC (non-required / never fabricated) & Expected CTC
  const currentCtc = inputByName.get('current_ctc_lpa');
  assert.ok(currentCtc && currentCtc.attrs.id && labelForIds.has(currentCtc.attrs.id), 'Missing labeled current_ctc_lpa input');
  assert.ok(!Object.prototype.hasOwnProperty.call(currentCtc.attrs, 'required'), 'current_ctc_lpa must remain optional so it is never fabricated');

  const expectedCtc = inputByName.get('expected_ctc_lpa');
  assert.ok(expectedCtc && expectedCtc.attrs.id && labelForIds.has(expectedCtc.attrs.id), 'Missing labeled expected_ctc_lpa input');

  // Separate CTC unit control (INR_LPA vs INR_MONTHLY)
  const unitSel = selectByName.get('ctc_currency_unit');
  assert.ok(unitSel && unitSel.attrs.id && labelForIds.has(unitSel.attrs.id), 'Missing labeled ctc_currency_unit select');
  const unitBlock = NAUKRI_HTML.match(/<select\b[^>]*name="ctc_currency_unit"[^>]*>([\s\S]*?)<\/select>/i);
  const unitValues = new Set(getElementsByTag(unitBlock[1], 'option').map(o => o.attrs.value));
  assert.ok(unitValues.has('INR_LPA') && unitValues.has('INR_MONTHLY'), 'ctc_currency_unit must separate INR_LPA and INR_MONTHLY');

  // Notice period select + unchecked non-required immediate joiner flag
  const noticeSel = selectByName.get('notice_period');
  assert.ok(noticeSel && noticeSel.attrs.id && labelForIds.has(noticeSel.attrs.id), 'Missing labeled notice_period select');
  const noticeBlock = NAUKRI_HTML.match(/<select\b[^>]*name="notice_period"[^>]*>([\s\S]*?)<\/select>/i);
  const noticeVals = new Set(getElementsByTag(noticeBlock[1], 'option').map(o => o.attrs.value));
  assert.ok(noticeVals.has('immediate') && noticeVals.has('serving_notice'), 'notice_period must include immediate and serving_notice options');

  const immBox = inputByName.get('immediate_joiner_flag');
  assert.ok(immBox && immBox.attrs.type === 'checkbox', 'Missing immediate_joiner_flag checkbox');
  assert.ok(!Object.prototype.hasOwnProperty.call(immBox.attrs, 'required'), 'immediate_joiner_flag must not be required');
  assert.ok(!Object.prototype.hasOwnProperty.call(immBox.attrs, 'checked'), 'immediate_joiner_flag must not be pre-checked');

  // Distinct current_location, preferred_locations, and willing_to_relocate
  const curLoc = inputByName.get('current_location');
  assert.ok(curLoc && curLoc.attrs.id && labelForIds.has(curLoc.attrs.id), 'Missing labeled current_location input');
  for (const selName of ['preferred_locations', 'willing_to_relocate']) {
    const sel = selectByName.get(selName);
    assert.ok(sel && sel.attrs.id && labelForIds.has(sel.attrs.id), `Missing labeled <select name="${selName}">`);
  }

  // CV upload + shared Naukri profile overwrite warning
  const resumeInput = inputByName.get('resume');
  assert.ok(resumeInput && resumeInput.attrs.type === 'file', 'Missing CV upload file input');
  assert.match(resumeInput.attrs.accept || '', /\.pdf/i);
  assert.match(NAUKRI_HTML, /data-profile-overwrite-warning="true"/i);

  // Hidden honeypot
  const hpWrap = NAUKRI_HTML.match(/<div\b[^>]*aria-hidden="true"[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(hpWrap, 'Honeypot wrapper must set aria-hidden="true" and display:none');
  const hpInput = getElementsByTag(hpWrap[1], 'input').find(i => i.attrs.name === 'website_url_honeypot');
  assert.ok(hpInput, 'Missing website_url_honeypot inside hidden wrapper');
  assert.equal(hpInput.attrs.tabindex, '-1');
  assert.equal(hpInput.attrs.autocomplete, 'off');
  assert.ok(!Object.prototype.hasOwnProperty.call(hpInput.attrs, 'required'), 'Honeypot must not be required');
});

test('5. Playbook metadata, required structure & Naukri India safety invariants in skills/platforms/global-boards.md', () => {
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
  assert.match(fm, /circuit-breaker-and-antiban/);

  for (const heading of [
    '## When to Use & Preconditions',
    '## Deterministic Step-by-Step Execution',
    '## Anti-Patterns (What NEVER To Do) & Self-Verification Check',
  ]) {
    assert.ok(GLOBAL_SKILL.includes(heading), `global-boards.md missing mandatory heading: ${heading}`);
  }

  // Required Naukri India & safety invariants
  assert.match(GLOBAL_SKILL, /### Naukri \(`naukri` — India\)/);
  assert.match(GLOBAL_SKILL, /mnjuser\/homepage/);
  assert.match(GLOBAL_SKILL, /naukri:<verified-posting-id>|naukri:<id>/);
  assert.match(GLOBAL_SKILL, /Current CTC.*Expected CTC|Expected CTC.*LPA/i);
  assert.match(GLOBAL_SKILL, /Immediate Joiner/i);
  assert.match(GLOBAL_SKILL, /preferred_locations/i);
  assert.match(GLOBAL_SKILL, /OTP/);
  assert.match(GLOBAL_SKILL, /skills\/24-circuit-breaker-and-antiban\.md/);
  assert.match(GLOBAL_SKILL, /logs\/circuit-breaker\.json/);
  assert.match(GLOBAL_SKILL, /max_per_platform\.naukri:\s*0/);
  assert.match(GLOBAL_SKILL, /distinct from GCC `naukrigulf\.com`/i);
});

test('6. Zero invisible Unicode/BiDi chars across naukri-mock.html and global-boards.md', () => {
  assertNoInvisibleUnicodeOrBiDi(NAUKRI_HTML, 'evals/fixtures/boards/naukri-mock.html');
  assertNoInvisibleUnicodeOrBiDi(GLOBAL_SKILL, 'skills/platforms/global-boards.md');
});

test('7. Config, manifest, registry, guardrails, docs & Profile Intelligence adapter parity (Naukrigulf untouched)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const globalEntry = manifest.skills.find(s => s.name === 'global-boards');
  assert.ok(globalEntry, 'global-boards entry missing in skills/skills-manifest.json');
  assert.equal(globalEntry.path, 'skills/platforms/global-boards.md');
  assert.match(GLOBAL_SKILL, new RegExp(`^version:\\s*"?${globalEntry.version.replace(/\./g, '\\.')}"?`, 'm'));
  assert.match(GLOBAL_SKILL, new RegExp(`^last_verified:\\s*"?${globalEntry.last_verified}"?`, 'm'));
  assert.match(globalEntry.description, /Naukri/i);
  assert.ok(globalEntry.triggers.some(t => /naukri/i.test(t)), 'manifest triggers must include naukri');
  assert.ok(globalEntry.requires_skills.includes('circuit-breaker-and-antiban'), 'manifest requires_skills must include circuit-breaker-and-antiban');

  for (const rel of ['skills/REGISTRY.md', 'PLATFORMS.md', 'docs/platform-registry.md', 'docs/SKILL_CATALOG.md']) {
    const filePath = [path.join(ROOT, rel), path.join(PACKAGE_ROOT, rel)].find(p => fs.existsSync(p));
    assert.ok(filePath, `Could not locate ${rel}`);
    const text = fs.readFileSync(filePath, 'utf8');
    assert.match(text, /\bnaukri\b/i, `${rel} must list Naukri`);
    assert.match(text, /skills\/platforms\/global-boards\.md/, `${rel} must reference skills/platforms/global-boards.md`);
  }

  // Confirm Naukrigulf remains separate under MENA / Gulf in PLATFORMS.md
  const platformsPath = [path.join(ROOT, 'PLATFORMS.md'), path.join(PACKAGE_ROOT, 'PLATFORMS.md')].find(p => fs.existsSync(p));
  const platformsMd = fs.readFileSync(platformsPath, 'utf8');
  assert.match(platformsMd, /\*\*MENA \/ Gulf\*\* \| \*\*Naukrigulf\*\* \| English \/ Arabic \| Help Wanted \| \[`skills\/platforms\/mena-boards\.md`\]/);
  assert.match(platformsMd, /\*\*APAC \(India\)\*\* \| \*\*Naukri\*\* \| English \| Core \/ Router \| \[`skills\/platforms\/global-boards\.md`\]/);

  // targets.yaml.example: naukri disabled, unverified, manual-handoff mode
  const targetsYaml = fs.readFileSync(path.join(ROOT, 'context', 'targets.yaml.example'), 'utf8');
  const block = getYamlBlock(targetsYaml, /platform:\s*"naukri"/);
  assert.ok(block, 'context/targets.yaml.example missing target block for naukri');
  assert.match(block, /enabled:\s*false/);
  assert.match(block, /live_verified:\s*false/);
  assert.match(block, /auth_check_url:\s*"https:\/\/www\.naukri\.com\/mnjuser\/homepage"/);
  assert.match(block, /playbook:\s*"skills\/platforms\/global-boards\.md"/);
  assert.match(block, /automation_mode:\s*"manual_apply_or_ats_redirect"/);

  // guardrails.yaml: unverified naukri capped at 0 (StepStone & MENA caps preserved)
  const guardrails = fs.readFileSync(path.join(ROOT, 'config', 'guardrails.yaml'), 'utf8');
  assert.match(guardrails, /^\s+naukri:\s*0\s*$/m, 'config/guardrails.yaml must cap unverified naukri at 0');
  assert.match(guardrails, /^\s+stepstone:\s*0\s*$/m, 'stepstone cap must remain 0');

  // Profile Intelligence adapter maps naukri -> job_boards with save: false and requires_approval: true
  const adapter = engine.getPlatformAdapter('naukri');
  assert.equal(adapter.platform_id, 'job_boards');
  assert.equal(adapter.unknown_platform_fallback, false);
  assert.equal(adapter.capabilities.save, false);
  assert.equal(adapter.requires_approval, true);
});

test('8. Employer ATS fixture isolation & EVAL-01..20 baseline compatibility', () => {
  const atsFiles = fs.readdirSync(FORMS_DIR).filter(f => f.endsWith('.html'));
  assert.ok(!atsFiles.some(f => /naukri/i.test(f)), 'Naukri board fixture must not live inside evals/fixtures/forms/');

  const evalRes = spawnSync(process.execPath, [CLI, 'eval', '--baseline'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(evalRes.status, 0, evalRes.stdout + evalRes.stderr);
  assert.match(evalRes.stdout, /20\/20 assertions PASSED/);
});
