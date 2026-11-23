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

const engine = await import(pathToFileURL(path.join(path.dirname(CLI), 'profile-intelligence.mjs')).href);

const planSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'profile-update-plan.schema.json'), 'utf8'));
const resumeSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'resume-data.schema.json'), 'utf8'));
const groundTruth = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'fixtures', 'ground-truth.json'), 'utf8'));
const skillText = fs.readFileSync(path.join(ROOT, 'skills', 'profile-intelligence-engine.md'), 'utf8');

const FACTS_CONFIG = {
  allowedMetrics: new Set(groundTruth.ground_truth_metrics.map(m => String(m).trim().toLowerCase())),
  forbiddenSkills: groundTruth.forbidden_skills,
};

function runCli(args, cwd = ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function makeValidPlan(overrides = {}) {
  return {
    schema_version: '1.0',
    plan_id: 'plan-linkedin-001',
    target_role: 'Senior Full-Stack Engineer',
    target_job_url: 'https://boards.greenhouse.io/cloudpayledger/jobs/70112',
    platform: 'linkedin',
    profile_url: 'https://www.linkedin.com/in/example-candidate',
    mode: 'draft_only',
    created_at: '2026-11-21T02:00:00Z',
    adapter: {
      platform_id: 'linkedin',
      capabilities: { read: true, draft: true, fill: true, save: true, verify: true },
      requires_approval: true,
      limitations: ['Live edit requires APPROVE'],
    },
    missing_facts: ['Kubernetes production years (not verified; excluded)'],
    skipped_unchanged: ['contact.email'],
    changes: [
      {
        section: 'intro',
        field: 'headline',
        action: 'replace',
        before: 'Software Engineer',
        after: 'Senior Full-Stack Engineer | TypeScript, Node.js, React, PostgreSQL | 38% faster payment webhooks',
        reason: 'Align headline with target backend/full-stack keywords and verified latency impact.',
        evidence: ['evals/fixtures/candidate-profile.md#L1-L12'],
        confidence: 0.96,
        requires_confirmation: false,
        fact_basis: 'verified',
        adapter_capability: 'save_and_verify_supported',
        verification_evidence: null,
        status: 'draft',
      },
    ],
    ...overrides,
  };
}

test('1. Schema: profile-update-plan & resume-data schemas enforce additive-only edits and valid structures', () => {
  assert.equal(planSchema.properties.schema_version.const, '1.0');
  assert.deepEqual(planSchema.$defs.change.properties.action.enum, ['add', 'replace']);
  assert.ok(!planSchema.$defs.change.properties.action.enum.includes('remove'));
  assert.deepEqual(planSchema.properties.mode.enum, ['draft_only', 'review', 'approved_apply']);
  assert.deepEqual(planSchema.$defs.change.properties.status.enum, [
    'draft',
    'needs_user_confirmation',
    'approved',
    'applied',
    'verified',
    'not_verified',
    'blocked',
    'needs_review',
  ]);

  // Extended universal profile schema preserves backward compatibility and adds provenance/platform fields
  for (const key of ['target_job_titles', 'career_objectives', 'publications', 'work_preferences', 'fact_provenance', 'platform_profiles']) {
    assert.ok(resumeSchema.properties[key], `Missing resume-data schema property: ${key}`);
  }
  assert.ok(resumeSchema.properties.work_history.items.properties.responsibilities);
  assert.ok(resumeSchema.properties.work_history.items.properties.achievements);
  assert.ok(resumeSchema.properties.work_history.items.properties.measurable_impact);

  const valid = engine.validateProfileUpdatePlan(makeValidPlan(), { factsConfig: FACTS_CONFIG });
  assert.equal(valid.valid, true, valid.errors.join('; '));

  // Reject destructive remove action
  const badRemove = makeValidPlan();
  badRemove.changes[0].action = 'remove';
  const removeRes = engine.validateProfileUpdatePlan(badRemove);
  assert.equal(removeRes.valid, false);
  assert.match(removeRes.errors.join('\n'), /not allowed|remove/i);

  // Reject invalid status & out-of-range confidence & extra property
  const badStruct = makeValidPlan({ extra_top_key: true });
  badStruct.changes[0].status = 'unknown_state';
  badStruct.changes[0].confidence = 1.5;
  badStruct.changes[0].evidence = [];
  const structRes = engine.validateProfileUpdatePlan(badStruct);
  assert.equal(structRes.valid, false);
  assert.ok(structRes.errors.length >= 4);
});

test('2. Fact integrity: blocks fabricated metrics/skills/slop and prevents promoting inferences without confirmation', () => {
  // Fabricated metric, forbidden skill, AI cliché, and em-dash must fail
  const hallucinated = makeValidPlan();
  hallucinated.changes[0].after = 'Spearheaded Kubernetes clusters — boosting revenue by 99%.';
  const halRes = engine.validateProfileUpdatePlan(hallucinated, { factsConfig: FACTS_CONFIG });
  assert.equal(halRes.valid, false);
  assert.match(halRes.errors.join('\n'), /unverified metric.*99%/i);
  assert.match(halRes.errors.join('\n'), /Kubernetes/i);
  assert.match(halRes.errors.join('\n'), /spearheaded/i);
  assert.match(halRes.errors.join('\n'), /em-dash/i);

  // Inferred claim cannot skip confirmation or move to approved/applied/verified
  const inferredAutoApprove = makeValidPlan({ mode: 'approved_apply' });
  inferredAutoApprove.changes[0].fact_basis = 'inferred';
  inferredAutoApprove.changes[0].requires_confirmation = false;
  inferredAutoApprove.changes[0].status = 'approved';
  const infRes = engine.validateProfileUpdatePlan(inferredAutoApprove);
  assert.equal(infRes.valid, false);
  assert.match(infRes.errors.join('\n'), /requires_confirmation must be true/i);
  assert.match(infRes.errors.join('\n'), /inferred claim cannot have status "approved"/i);

  // Profile vault provenance guard prevents duplicating inferred claims as verified_facts
  const badVault = {
    fact_provenance: {
      verified_facts: [{ claim: 'Led GraphQL migration', source: 'cv.md' }],
      inferred_info: [{ claim: 'Led GraphQL migration', basis: 'Mentioned API schema', requires_confirmation: true }],
    },
  };
  const vaultRes = engine.validateProfileVault(badVault);
  assert.equal(vaultRes.valid, false);
});

test('3. Safety: draft-first enforcement, adapter limitations, unknown-platform fallback, and workflow invariants', () => {
  // Draft-only plan cannot contain applied/verified statuses
  const draftApplied = makeValidPlan({ mode: 'draft_only' });
  draftApplied.changes[0].status = 'applied';
  assert.equal(engine.validateProfileUpdatePlan(draftApplied).valid, false);

  // Adapter contract enforces read/draft-only fallback on unknown platforms
  const unknownAdapter = engine.getPlatformAdapter('mystery-regional-board');
  assert.equal(unknownAdapter.platform_id, 'generic');
  assert.equal(unknownAdapter.unknown_platform_fallback, true);
  assert.equal(unknownAdapter.capabilities.read, true);
  assert.equal(unknownAdapter.capabilities.draft, true);
  assert.equal(unknownAdapter.capabilities.fill, false);
  assert.equal(unknownAdapter.capabilities.save, false);
  assert.equal(unknownAdapter.requires_approval, true);

  // Plan targeting an adapter without save support cannot mark applied
  const nonSavePlan = makeValidPlan({
    platform: 'mystery-regional-board',
    mode: 'approved_apply',
    adapter: {
      platform_id: 'generic',
      capabilities: { read: true, draft: true, fill: false, save: false, verify: false },
      requires_approval: true,
      limitations: ['Generic read/draft-only fallback'],
    },
  });
  nonSavePlan.changes[0].status = 'applied';
  const nonSaveRes = engine.validateProfileUpdatePlan(nonSavePlan);
  assert.equal(nonSaveRes.valid, false);
  assert.match(nonSaveRes.errors.join('\n'), /does not support save/i);

  for (const phrase of [
    'Never delete existing profile content',
    'Never invent employers, dates, titles, metrics',
    'Default to preview/draft',
    'Do not bypass authentication, CAPTCHA, MFA, rate limits',
    'Batch-fill',
    'fresh read-back',
  ]) {
    assert.ok(skillText.includes(phrase), `Missing skill invariant/workflow phrase: ${phrase}`);
  }
});

test('4. Efficiency: skips unchanged fields, consolidates single review, and avoids redundant snapshots', () => {
  const unchangedPlan = makeValidPlan();
  unchangedPlan.changes[0].before = 'Senior Full-Stack Engineer';
  unchangedPlan.changes[0].after = 'Senior Full-Stack Engineer';
  const unchRes = engine.validateProfileUpdatePlan(unchangedPlan);
  assert.equal(unchRes.valid, false);
  assert.match(unchRes.errors.join('\n'), /unchanged field/i);

  const reviewMd = engine.formatConsolidatedReview(makeValidPlan());
  assert.match(reviewMd, /Consolidated Profile Update Review/);
  assert.match(reviewMd, /Skipped Unchanged Fields/);
  assert.match(reviewMd, /contact\.email/);
  assert.match(reviewMd, /APPROVE ALL/);
  assert.ok(skillText.includes('18-condition-based-browser-waiting'));
  assert.ok(skillText.includes('19-on-demand-mcp-routing'));
});

test('5. Integration & regression: registry, manifest, wrappers, CLI route, and CLI verify work together', () => {
  const registry = fs.readFileSync(path.join(ROOT, 'skills', 'REGISTRY.md'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const entry = manifest.skills.find(s => s.name === 'profile-intelligence-engine');

  assert.ok(entry, 'Missing profile-intelligence-engine in skills-manifest.json');
  assert.deepEqual(entry.requires_mcp, ['none']);
  assert.ok(entry.optional_mcp.includes('playwright'));
  assert.equal(entry.path, 'skills/profile-intelligence-engine.md');
  assert.ok(registry.includes('skills/profile-intelligence-engine.md'));
  assert.ok(fs.existsSync(path.join(ROOT, '.agents', 'skills', 'profile-intelligence-engine', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(ROOT, '.agent', 'workflows', 'profile-update.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'commands', 'profile-update.md')));

  // Cross-platform profile prompts route to profile-intelligence-engine without forcing /setup
  for (const prompt of [
    '/profile-update',
    'Optimize my professional profile.',
    'Update my profile for this job.',
    'Sync my career profile across platforms.',
    'Improve my headline and About section.',
    'Tailor my profile for a target role.',
    'Review my professional profile.',
    'Update my job board profiles.',
  ]) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0, `route failed for "${prompt}": ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.skills.includes('profile-intelligence-engine'), `Missing profile-intelligence-engine for "${prompt}"`);
    assert.match(parsed.readiness, /task-specific/i);
  }

  // Regression check: LinkedIn-specific routes keep linkedin-growth while also surfacing profile-intelligence-engine
  const liRes = runCli(['route', 'Improve my LinkedIn headline and About section.', '--json']);
  assert.equal(liRes.status, 0);
  const liParsed = JSON.parse(liRes.stdout);
  assert.equal(liParsed.intent, 'linkedin-profile');
  assert.ok(liParsed.skills.includes('linkedin-growth'));
  assert.ok(liParsed.skills.includes('profile-intelligence-engine'));

  // CLI verify validates Profile Update Plan JSON deterministically
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-pie-verify-'));
  try {
    const factsPath = path.join(tmp, 'ground-truth.json');
    fs.copyFileSync(path.join(ROOT, 'evals', 'fixtures', 'ground-truth.json'), factsPath);
    const goodPath = path.join(tmp, 'good-plan.json');
    fs.writeFileSync(goodPath, JSON.stringify(makeValidPlan(), null, 2));
    const goodRun = runCli(['verify', goodPath, '--facts', factsPath], tmp);
    assert.equal(goodRun.status, 0, goodRun.stdout + goodRun.stderr);

    const badPlan = makeValidPlan();
    badPlan.changes[0].after = 'Built Kubernetes pipelines reducing cost by 99%.';
    const badPath = path.join(tmp, 'bad-plan.json');
    fs.writeFileSync(badPath, JSON.stringify(badPlan, null, 2));
    const badRun = runCli(['verify', badPath, '--facts', factsPath], tmp);
    assert.notEqual(badRun.status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('6. Verification outcomes: requires fresh read-back evidence for verified and summarizes all 7 lifecycle outcomes', () => {
  // Cannot claim verified without verification_evidence
  const unbackedVerified = makeValidPlan({ mode: 'approved_apply' });
  unbackedVerified.changes[0].status = 'verified';
  unbackedVerified.changes[0].verification_evidence = '';
  const unverRes = engine.validateProfileUpdatePlan(unbackedVerified);
  assert.equal(unverRes.valid, false);
  assert.match(unverRes.errors.join('\n'), /requires non-empty verification_evidence/i);

  // Valid verified change passes
  const backedVerified = makeValidPlan({ mode: 'approved_apply' });
  backedVerified.changes[0].status = 'verified';
  backedVerified.changes[0].verification_evidence = 'browser_snapshot readback 2026-11-21T02:05:00Z confirmed headline text';
  assert.equal(engine.validateProfileUpdatePlan(backedVerified, { factsConfig: FACTS_CONFIG }).valid, true);

  // Outcome summaries for all 7 truthful lifecycle states
  const makeTwo = (s1, s2) => ({
    changes: [
      { ...makeValidPlan().changes[0], status: s1 },
      { ...makeValidPlan().changes[0], field: 'about', status: s2 },
    ],
  });
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('draft', 'draft')).outcome, 'prepared');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('approved', 'approved')).outcome, 'approved');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('applied', 'applied')).outcome, 'applied');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('verified', 'verified')).outcome, 'verified');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('verified', 'blocked')).outcome, 'partially_applied');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('blocked', 'blocked')).outcome, 'blocked');
  assert.equal(engine.summarizeVerificationOutcome(makeTwo('not_verified', 'not_verified')).outcome, 'not_verified');
});

test('7. Remediation — Registry adapter enforcement blocks omitted/spoofed capabilities while preserving legitimate saves', () => {
  // 1. Generic platform with omitted adapter attempting applied -> REJECTED
  const genericOmitted = makeValidPlan({ platform: 'generic', mode: 'approved_apply' });
  delete genericOmitted.adapter;
  genericOmitted.changes[0].status = 'applied';
  delete genericOmitted.changes[0].adapter_capability;
  const r1 = engine.validateProfileUpdatePlan(genericOmitted);
  assert.equal(r1.valid, false);
  assert.match(r1.errors.join('\n'), /does not support save/i);

  // 2. Unknown platform with omitted adapter attempting applied -> REJECTED
  const unknownOmitted = makeValidPlan({ platform: 'mystery-regional-board', mode: 'approved_apply' });
  delete unknownOmitted.adapter;
  unknownOmitted.changes[0].status = 'applied';
  delete unknownOmitted.changes[0].adapter_capability;
  const r2 = engine.validateProfileUpdatePlan(unknownOmitted);
  assert.equal(r2.valid, false);
  assert.match(r2.errors.join('\n'), /does not support save/i);

  // 3. Generic platform spoofing save: true -> REJECTED
  const genericSpoofSave = makeValidPlan({
    platform: 'generic',
    mode: 'approved_apply',
    adapter: {
      platform_id: 'generic',
      capabilities: { read: true, draft: true, fill: false, save: true, verify: false },
      requires_approval: true,
    },
  });
  genericSpoofSave.changes[0].status = 'applied';
  delete genericSpoofSave.changes[0].adapter_capability;
  const r3 = engine.validateProfileUpdatePlan(genericSpoofSave);
  assert.equal(r3.valid, false);
  assert.match(r3.errors.join('\n'), /cannot exceed registered adapter/i);

  // 4. Adapter spoofing fill/verify capabilities beyond registry -> REJECTED
  const spoofFillVerify = makeValidPlan({
    platform: 'portfolio',
    mode: 'draft_only',
    adapter: {
      platform_id: 'portfolio',
      capabilities: { read: true, draft: true, fill: true, save: false, verify: true },
      requires_approval: true,
    },
  });
  spoofFillVerify.changes[0].adapter_capability = 'fill_supported';
  const r4 = engine.validateProfileUpdatePlan(spoofFillVerify);
  assert.equal(r4.valid, false);
  assert.match(r4.errors.join('\n'), /fill.*cannot exceed registered adapter|fill_supported.*exceeds/i);

  // 5. Legitimate LinkedIn approved_apply + verified with read-back evidence -> ACCEPTED
  const legitLinkedin = makeValidPlan({ platform: 'linkedin', mode: 'approved_apply' });
  legitLinkedin.changes[0].status = 'verified';
  legitLinkedin.changes[0].verification_evidence = 'Fresh snapshot confirmed updated headline';
  const r5 = engine.validateProfileUpdatePlan(legitLinkedin, { factsConfig: FACTS_CONFIG });
  assert.equal(r5.valid, true, r5.errors.join('; '));
});

test('8. Remediation — CLI routing covers advertised EN/AR profile prompts without misrouting CV or legacy LinkedIn prompts', () => {
  for (const prompt of [
    'Fill profile fields from my CV',
    'Update my LinkedIn profile for this job',
    'Audit my GitHub profile',
    'Optimize my portfolio profile',
    'حسّن ملفي المهني',
    'حدّث بروفايلي لهذه الوظيفة',
  ]) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0, `route failed for "${prompt}": ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.intent, 'profile-intelligence', `Expected profile-intelligence for "${prompt}", got ${parsed.intent}`);
    assert.ok(parsed.skills.includes('profile-intelligence-engine'));
  }

  // Negative checks: pure CV/resume requests must NOT route to profile-intelligence
  for (const [prompt, expectedIntent] of [
    ['Improve my CV summary.', 'cv-edit'],
    ['Tailor my CV to this job.', 'tailor-cv'],
    ['Create a CV from scratch.', 'cv-create'],
    ['Review my uploaded CV.', 'cv-review-import'],
    ['Find remote React jobs.', 'job-discovery-and-triage'],
  ]) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.intent, expectedIntent, `Misrouted pure non-profile prompt "${prompt}"`);
    assert.ok(!parsed.skills.includes('profile-intelligence-engine'));
  }

  // Legacy LinkedIn-specific requests preserve linkedin-profile intent + linkedin-growth
  for (const prompt of [
    'Review my LinkedIn profile.',
    'Improve my LinkedIn profile.',
    'Make my profile consistent with my CV.',
    'Optimize my profile for React and Full-Stack JavaScript roles.',
  ]) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.intent, 'linkedin-profile', `Legacy LinkedIn prompt "${prompt}" should keep linkedin-profile`);
    assert.ok(parsed.skills.includes('linkedin-growth'));
  }
});

test('9. Remediation — Full schema/validator parity rejects malformed URLs, dates, arrays, extra keys, and bad verification_summary', () => {
  const invalidCases = [
    ['empty plan_id', makeValidPlan({ plan_id: '' })],
    ['bad profile_url', makeValidPlan({ profile_url: 'not-a-uri' })],
    ['unsafe javascript target_job_url', makeValidPlan({ target_job_url: 'javascript:alert(1)' })],
    ['bad created_at', makeValidPlan({ created_at: 'yesterday' })],
    ['missing_facts string', makeValidPlan({ missing_facts: 'Kubernetes' })],
    ['missing_facts empty item', makeValidPlan({ missing_facts: [''] })],
    ['skipped_unchanged numeric item', makeValidPlan({ skipped_unchanged: [123] })],
    ['adapter extra property', makeValidPlan({ adapter: { ...makeValidPlan().adapter, extra_key: 1 } })],
    ['adapter capabilities extra property', makeValidPlan({ adapter: { ...makeValidPlan().adapter, capabilities: { ...makeValidPlan().adapter.capabilities, delete: true } } })],
    ['verification_summary missing counts', makeValidPlan({ verification_summary: { outcome: 'verified' } })],
    ['verification_summary negative verified_count', makeValidPlan({ verification_summary: { outcome: 'verified', verified_count: -1, total_changes: 1 } })],
    ['verification_summary verified_count > total_changes', makeValidPlan({ verification_summary: { outcome: 'verified', verified_count: 2, total_changes: 1 } })],
    ['verification_summary extra key', makeValidPlan({ verification_summary: { outcome: 'prepared', verified_count: 0, total_changes: 1, bogus: true } })],
    ['verification_evidence non-string', (() => { const p = makeValidPlan(); p.changes[0].verification_evidence = 12345; return p; })()],
  ];

  for (const [label, badPlan] of invalidCases) {
    const res = engine.validateProfileUpdatePlan(badPlan);
    assert.equal(res.valid, false, `Expected rejection for "${label}"`);
  }

  // Boundary test: valid optional fields, empty changes, null URLs, valid verification_summary
  const boundaryValid = makeValidPlan({
    profile_url: null,
    target_job_url: null,
    missing_facts: [],
    skipped_unchanged: ['headline'],
    changes: [],
    verification_summary: {
      outcome: 'prepared',
      verified_count: 0,
      total_changes: 0,
      verified_at: null,
      notes: 'All fields already aligned',
    },
  });
  const bv = engine.validateProfileUpdatePlan(boundaryValid);
  assert.equal(bv.valid, true, bv.errors.join('; '));
});

test('10. Remediation — Partial verification outcomes, draft_only/review lifecycle, add/replace semantics & vault validation', () => {
  const mk = (...statuses) => ({
    changes: statuses.map((s, i) => ({ ...makeValidPlan().changes[0], field: `f${i}`, status: s })),
  });
  assert.equal(engine.summarizeVerificationOutcome(mk()).outcome, 'prepared');
  assert.equal(engine.summarizeVerificationOutcome(mk('applied', 'draft')).outcome, 'partially_applied');
  assert.equal(engine.summarizeVerificationOutcome(mk('approved', 'draft')).outcome, 'prepared');
  assert.equal(engine.summarizeVerificationOutcome(mk('verified', 'verified')).outcome, 'verified');
  assert.equal(engine.summarizeVerificationOutcome(mk('applied', 'applied')).outcome, 'applied');
  assert.equal(engine.summarizeVerificationOutcome(mk('verified', 'applied')).outcome, 'partially_applied');
  assert.equal(engine.summarizeVerificationOutcome(mk('needs_review', 'needs_review')).outcome, 'prepared');
  assert.equal(engine.summarizeVerificationOutcome(mk('needs_review', 'needs_review')).needs_review_count, 2);
  assert.equal(engine.summarizeVerificationOutcome(mk('approved', 'blocked')).outcome, 'blocked');
  assert.equal(engine.summarizeVerificationOutcome(mk('blocked', 'not_verified')).outcome, 'not_verified');

  // Lifecycle: draft_only rejects approved; review rejects applied
  const draftApproved = makeValidPlan({ mode: 'draft_only' });
  draftApproved.changes[0].status = 'approved';
  assert.equal(engine.validateProfileUpdatePlan(draftApproved).valid, false);

  const reviewApplied = makeValidPlan({ mode: 'review' });
  reviewApplied.changes[0].status = 'applied';
  assert.equal(engine.validateProfileUpdatePlan(reviewApplied).valid, false);

  // Add / replace semantics
  const badAdd = makeValidPlan();
  badAdd.changes[0].action = 'add';
  badAdd.changes[0].before = 'Existing headline';
  assert.equal(engine.validateProfileUpdatePlan(badAdd).valid, false);

  const goodAdd = makeValidPlan();
  goodAdd.changes[0].action = 'add';
  goodAdd.changes[0].before = null;
  assert.equal(engine.validateProfileUpdatePlan(goodAdd).valid, true);

  const badReplace = makeValidPlan();
  badReplace.changes[0].action = 'replace';
  badReplace.changes[0].before = null;
  assert.equal(engine.validateProfileUpdatePlan(badReplace).valid, false);

  // Profile vault validation: missing source, missing basis, bad array types, user_confirmed overlap
  assert.equal(engine.validateProfileVault({ fact_provenance: { verified_facts: [{ claim: 'X' }] } }).valid, false);
  assert.equal(engine.validateProfileVault({ fact_provenance: { inferred_info: [{ claim: 'X', requires_confirmation: true }] } }).valid, false);
  assert.equal(engine.validateProfileVault({ fact_provenance: { verified_facts: 'not-an-array' } }).valid, false);
  assert.equal(
    engine.validateProfileVault({
      fact_provenance: {
        user_confirmed_facts: [{ claim: 'Led API redesign', confirmed_at: '2026-11-21T00:00:00Z' }],
        inferred_info: [{ claim: 'Led API redesign', basis: 'Mentioned API', requires_confirmation: true }],
      },
    }).valid,
    false,
  );

  // Valid vault passes both programmatic validator and CLI `verify`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-vault-verify-'));
  try {
    const validVault = {
      owner_verified: true,
      fact_provenance: {
        verified_facts: [{ claim: '6 years Node.js', source: 'context/cv.md', verified_at: '2026-11-21T00:00:00Z' }],
        user_confirmed_facts: [{ claim: 'Remote preferred', confirmed_at: '2026-11-21T00:00:00Z' }],
        inferred_info: [{ claim: 'Open to technical mentoring', basis: 'Led code reviews', requires_confirmation: true }],
        missing_info: ['Kubernetes years'],
      },
    };
    assert.equal(engine.validateProfileVault(validVault).valid, true);
    const vPath = path.join(tmp, 'resume-data.json');
    fs.writeFileSync(vPath, JSON.stringify(validVault, null, 2));
    assert.equal(runCli(['verify', vPath], tmp).status, 0);

    const badVaultPath = path.join(tmp, 'bad-resume-data.json');
    fs.writeFileSync(badVaultPath, JSON.stringify({ fact_provenance: { verified_facts: [{ claim: 'Missing source' }] } }));
    assert.notEqual(runCli(['verify', badVaultPath], tmp).status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
