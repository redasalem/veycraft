import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOCAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = [
  process.env.JHO_CLI_PATH,
  path.join(LOCAL_ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI, 'Could not locate bin/cli.mjs');
const BIN_DIR = path.dirname(CLI);
const REPO_ROOT = path.resolve(BIN_DIR, '..');

const {
  NOTION_DATABASE_SCHEMAS,
  NOTION_SYNC_ELIGIBLE_STATUSES,
  RECONCILE_FILTER_PROPERTY_BY_DB,
  DEFAULT_MAX_APPROVAL_AGE_MS,
  DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS,
  DEFAULT_STALE_LOCK_AGE_MS,
  DEFAULT_MAX_RETRIES,
  SYNC_STATE_TRANSITIONS,
  normalizeNotionUuid,
  makeSyncStateKey,
  resolveCanonicalSyncKey,
  formatNotionApplicationTitle,
  validateNotionDatabaseSchema,
  validateCvAttribution,
  checkApplicationSyncEligibility,
  canonicalizeJson,
  computeSyncHash,
  computeOperationId,
  computePlanHash,
  projectApplicationForNotion,
  projectDailyRunForNotion,
  projectInsightForNotion,
  scanNotionPayloadPrivacy,
  validateNotionSyncPlan,
  validateNotionSyncState,
  createEmptySyncState,
  normalizeSyncState,
  loadSyncState,
  saveSyncState,
  computeNotionSyncDiff,
  verifySyncStateIntegrity,
  validateSyncStateTransition,
  approveNotionSyncPlan,
  verifyPlanApproval,
  inspectSyncStateLock,
  releaseStaleSyncStateLock,
  reserveOperationInFlight,
  expireStaleInFlightRecords,
  inspectSyncStateRecovery,
  DEFAULT_BASE_BACKOFF_SECONDS,
  DEFAULT_MAX_BACKOFF_SECONDS,
  RETRYABLE_FAILURE_CODES,
  PERMANENT_FAILURE_CODES,
  AMBIGUOUS_FAILURE_CODES,
  verifySyncReceiptEvidence,
  applySyncReceipt,
  recordSyncFailure,
  validateReconcileQuerySnapshot,
  reconcileSyncRecord,
  resetPermanentFailure,
} = await import(pathToFileURL(path.join(BIN_DIR, 'notion-sync.mjs')).href);

const { computeApplicationId } = await import(pathToFileURL(path.join(BIN_DIR, 'career-intelligence.mjs')).href);

function makeOwnerCvRegistry(extraVersions = []) {
  return {
    schema_version: '1.0',
    updated_at: '2026-11-20T10:00:00Z',
    versions: [
      {
        cv_version_id: 'cv-base-owner-v1',
        version_number: 1,
        label: 'Owner Base Backend CV',
        kind: 'generic',
        owner_scope: 'owner',
        base_cv_version_id: null,
        local_ref_rel: 'context/cv.md',
        created_at: '2026-10-01T10:00:00Z',
        application_ids: [],
      },
      {
        cv_version_id: 'cv-tailored-owner-v1',
        version_number: 2,
        label: 'Owner Tailored Staff CV',
        kind: 'tailored',
        owner_scope: 'owner',
        base_cv_version_id: 'cv-base-owner-v1',
        local_ref_rel: 'logs/resumes/acme-2026-11/resume.html',
        created_at: '2026-11-01T10:00:00Z',
        application_ids: [],
      },
      ...extraVersions,
    ],
  };
}

function makeNotionDbObject(schemaMap, extraCols = {}) {
  const properties = {};
  for (const [k, type] of Object.entries(schemaMap)) {
    properties[k] = { id: k.toLowerCase().replace(/\s+/g, '_'), type };
  }
  for (const [k, type] of Object.entries(extraCols)) {
    properties[k] = { id: k.toLowerCase().replace(/\s+/g, '_'), type };
  }
  return { object: 'database', id: '12345678-1234-1234-1234-1234567890ab', properties };
}

test('1. Stage 3 (T7): 3-database Notion schema contract guard validates exact types, allows extra columns & fails closed on drift', () => {
  for (const db of ['applications', 'daily_runs', 'insights']) {
    const validDb = makeNotionDbObject(NOTION_DATABASE_SCHEMAS[db], { 'Owner Custom Tag': 'select' });
    const res = validateNotionDatabaseSchema(db, validDb);
    assert.equal(res.valid, true, `Expected valid ${db} schema: ${res.errors.join('; ')}`);
    assert.deepEqual(res.missing_properties, []);
    assert.deepEqual(res.type_mismatches, []);
    assert.deepEqual(res.extra_properties, ['Owner Custom Tag']);
  }

  // Missing required property fails closed
  const missingStatus = makeNotionDbObject(NOTION_DATABASE_SCHEMAS.applications);
  delete missingStatus.properties.Status;
  const missRes = validateNotionDatabaseSchema('applications', missingStatus);
  assert.equal(missRes.valid, false);
  assert.deepEqual(missRes.missing_properties, ['Status']);

  // Type mismatch fails closed
  const wrongType = makeNotionDbObject(NOTION_DATABASE_SCHEMAS.insights);
  wrongType.properties['Avg Match Score'] = { type: 'rich_text' };
  const mismatchRes = validateNotionDatabaseSchema('insights', wrongType);
  assert.equal(mismatchRes.valid, false);
  assert.deepEqual(mismatchRes.type_mismatches, [
    { property: 'Avg Match Score', expected: 'number', actual: 'rich_text' },
  ]);

  // Unknown database or non-object fails closed
  assert.equal(validateNotionDatabaseSchema('unknown_db', {}).valid, false);
  assert.equal(validateNotionDatabaseSchema('applications', null).valid, false);

  // Filter property map matches schema columns
  for (const [db, prop] of Object.entries(RECONCILE_FILTER_PROPERTY_BY_DB)) {
    assert.ok(Object.prototype.hasOwnProperty.call(NOTION_DATABASE_SCHEMAS[db], prop));
  }
});

test('2. Stage 3 (T7): Submitted-only eligibility filter accepts 6 submitted outcomes + legacy aliases and rejects pre-submission & uncertain rows', () => {
  assert.deepEqual(NOTION_SYNC_ELIGIBLE_STATUSES, [
    'applied', 'interview', 'assessment', 'offer', 'rejected', 'withdrawn',
  ]);

  const ownerCvReg = makeOwnerCvRegistry();

  // All 6 canonical submitted statuses + legacy submitted aliases are eligible
  for (const [status, expected] of [
    ['applied', 'applied'],
    ['submitted', 'applied'],
    ['interview', 'interview'],
    ['interviewing', 'interview'],
    ['assessment', 'assessment'],
    ['coding_test', 'assessment'],
    ['offer', 'offer'],
    ['accepted', 'offer'],
    ['rejected', 'rejected'],
    ['declined', 'rejected'],
    ['withdrawn', 'withdrawn'],
  ]) {
    const res = checkApplicationSyncEligibility({
      job_id: `ok-${status}`,
      title: 'Backend Engineer',
      company: 'Acme',
      status,
      cv_version_id: 'cv-base-owner-v1',
    }, { allCvRegistry: ownerCvReg });
    assert.equal(res.eligible, true, `Expected ${status} to be eligible`);
    assert.equal(res.canonical_status, expected);
    assert.equal(res.canonical_key, computeApplicationId(`ok-${status}`));
  }

  // All 7 non-submitted statuses + submission_uncertain + unusable job_id are rejected
  for (const badStatus of ['discovered', 'prepared', 'dry_run', 'skipped', 'needs_review', 'failed', 'aborted']) {
    const res = checkApplicationSyncEligibility({
      job_id: `no-${badStatus}`,
      title: 'Backend Engineer',
      company: 'Acme',
      status: badStatus,
    });
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'status_not_submitted');
    assert.equal(res.block_code, null);
  }

  const uncertain = checkApplicationSyncEligibility({
    job_id: 'uncert-1',
    title: 'Eng',
    company: 'Acme',
    status: 'applied',
    submission_uncertain: true,
  });
  assert.equal(uncertain.eligible, false);
  assert.equal(uncertain.reason, 'submission_uncertain');

  const noJobId = checkApplicationSyncEligibility({ title: 'Eng', company: 'Acme', status: 'applied' });
  assert.equal(noJobId.eligible, false);
  assert.equal(noJobId.reason, 'missing_or_unusable_job_id');

  const mismatchedAppId = checkApplicationSyncEligibility({
    job_id: 'real-1',
    application_id: 'app_000000000000',
    status: 'applied',
  });
  assert.equal(mismatchedAppId.eligible, false);
  assert.equal(mismatchedAppId.reason, 'application_id_job_id_mismatch');
});

test('3. Stage 3 (T7): Title formatting enforces "Role — Company" (Decision D), safe fallbacks, whitespace cleanup & 200-char limit', () => {
  assert.equal(
    formatNotionApplicationTitle('  Senior Backend\nEngineer ', ' Acme\tPayments ', 'app_1234567890ab'),
    'Senior Backend Engineer — Acme Payments',
  );
  assert.equal(formatNotionApplicationTitle('Staff Engineer', '', 'app_1234567890ab'), 'Staff Engineer');
  assert.equal(formatNotionApplicationTitle(null, 'Acme Corp', 'app_1234567890ab'), 'Acme Corp');
  assert.equal(formatNotionApplicationTitle('', '', 'app_1234567890ab'), 'app_1234567890ab');

  const longRole = 'Senior Principal Distributed Systems Staff Engineer '.repeat(6);
  const title = formatNotionApplicationTitle(longRole, 'Very Long Enterprise Corporation Name');
  assert.ok(title.length <= 200);
  assert.ok(title.endsWith('...'));
});

test('4. Stage 3 (T7 — Safety Resolution 4): CV attribution fails closed on missing registry, unknown ID, non-owner scope, third-party paths & kind mismatch', () => {
  const validReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-3p-client',
      version_number: 3,
      label: 'Friend CV',
      kind: 'generic',
      owner_scope: 'third_party',
      local_ref_rel: 'logs/resumes/cv-friend/cv.html',
      created_at: '2026-11-02T10:00:00Z',
      application_ids: [],
    },
  ]);

  // Unattributed legacy v1 application without cv_version_id passes when clean
  const legacyClean = validateCvAttribution({
    job_id: 'leg-1',
    status: 'applied',
    title: 'Backend Engineer',
    company: 'Acme',
  });
  assert.equal(legacyClean.valid, true);
  assert.equal(legacyClean.attributed, false);

  // Explicit owner CV passes
  const ownerOk = validateCvAttribution({
    job_id: 'own-1',
    status: 'applied',
    cv_version_id: 'cv-tailored-owner-v1',
    cv_tailoring: { is_tailored: true, base_cv_version_id: 'cv-base-owner-v1', tailored_folder_rel: 'logs/resumes/acme-2026-11/' },
  }, { allCvRegistry: validReg });
  assert.equal(ownerOk.valid, true);
  assert.equal(ownerOk.attributed, true);
  assert.equal(ownerOk.owner_cv_entry.cv_version_id, 'cv-tailored-owner-v1');

  // Missing CV registry fails closed when cv_version_id is set
  const noReg = validateCvAttribution({ job_id: 'nr-1', status: 'applied', cv_version_id: 'cv-base-owner-v1' }, { allCvRegistry: null });
  assert.equal(noReg.valid, false);
  assert.equal(noReg.violations[0].code, 'third_party_subject');

  // Unknown cv_version_id fails closed (never inferred as owner)
  const unknownCv = validateCvAttribution({ job_id: 'uk-1', status: 'applied', cv_version_id: 'cv-unregistered' }, { allCvRegistry: validReg });
  assert.equal(unknownCv.valid, false);
  assert.equal(unknownCv.violations[0].code, 'third_party_subject');

  // Third-party registry entry fails closed
  const thirdPartyCv = validateCvAttribution({ job_id: 'tp-1', status: 'applied', cv_version_id: 'cv-3p-client' }, { allCvRegistry: validReg });
  assert.equal(thirdPartyCv.valid, false);
  assert.equal(thirdPartyCv.violations[0].code, 'third_party_subject');

  // Missing / ambiguous owner_scope in malformed registry fails closed
  const ambiguousReg = makeOwnerCvRegistry();
  delete ambiguousReg.versions[0].owner_scope;
  const ambigRes = validateCvAttribution({ job_id: 'amb-1', status: 'applied', cv_version_id: 'cv-base-owner-v1' }, { allCvRegistry: ambiguousReg });
  assert.equal(ambigRes.valid, false);

  // Conflicting kind vs cv_tailoring.is_tailored fails closed
  const kindConflict = validateCvAttribution({
    job_id: 'kc-1',
    status: 'applied',
    cv_version_id: 'cv-base-owner-v1', // kind: 'generic'
    cv_tailoring: { is_tailored: true },
  }, { allCvRegistry: validReg });
  assert.equal(kindConflict.valid, false);
  assert.equal(kindConflict.violations[0].field_path, 'cv_tailoring.is_tailored');

  // Third-party folder path on tailoring metadata fails closed even without cv_version_id
  const thirdPartyFolder = validateCvAttribution({
    job_id: 'tpf-1',
    status: 'applied',
    cv_tailoring: { is_tailored: true, tailored_folder_rel: 'logs/resumes/cv-friend/' },
  });
  assert.equal(thirdPartyFolder.valid, false);

  // Ambiguous non-boolean provenance.third_party_subject fails closed
  const ambigProv = validateCvAttribution({
    job_id: 'ap-1',
    status: 'applied',
    provenance: { third_party_subject: 'unknown' },
  });
  assert.equal(ambigProv.valid, false);

  // L1: null and empty string cv_version_id are unattributed, while whitespace-only MUST fail closed
  const nullCv = validateCvAttribution({ job_id: 'l1-null', status: 'applied', cv_version_id: null });
  assert.equal(nullCv.valid, true);
  assert.equal(nullCv.attributed, false);
  const emptyCv = validateCvAttribution({ job_id: 'l1-empty', status: 'applied', cv_version_id: '' });
  assert.equal(emptyCv.valid, true);
  assert.equal(emptyCv.attributed, false);
  const wsCv = validateCvAttribution({ job_id: 'l1-ws', status: 'applied', cv_version_id: '   ' });
  assert.equal(wsCv.valid, false);
  assert.equal(wsCv.violations[0].code, 'third_party_subject');
  const wsBaseCv = validateCvAttribution({ job_id: 'l1-ws-base', status: 'applied', cv_tailoring: { is_tailored: true, base_cv_version_id: '\t ' } });
  assert.equal(wsBaseCv.valid, false);

  // H1: Transitive base_cv_version_id ancestry validation (multi-level valid, third-party ancestor, missing ancestor, cycle, root contradiction)
  const deepValidReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-grandchild-owner',
      version_number: 3,
      label: 'Grandchild Tailored CV',
      kind: 'tailored',
      owner_scope: 'owner',
      base_cv_version_id: 'cv-tailored-owner-v1', // grandchild -> tailored -> base (all owner!)
      local_ref_rel: 'logs/resumes/beta-2026-11/cv.html',
      created_at: '2026-11-05T10:00:00Z',
      application_ids: [],
    },
  ]);
  const deepOk = validateCvAttribution({ job_id: 'h1-deep-ok', status: 'applied', cv_version_id: 'cv-grandchild-owner' }, { allCvRegistry: deepValidReg });
  assert.equal(deepOk.valid, true);

  // H1: Owner CV derived from third_party ancestor fails closed even when app omits cv_tailoring.base_cv_version_id
  const thirdPartyAncestorReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-3p-ancestor',
      version_number: 3,
      label: 'Client Base CV',
      kind: 'generic',
      owner_scope: 'third_party',
      base_cv_version_id: null,
      local_ref_rel: 'logs/resumes/cv-client/base.md',
      created_at: '2026-10-01T10:00:00Z',
      application_ids: [],
    },
    {
      cv_version_id: 'cv-derived-from-3p',
      version_number: 4,
      label: 'Derived CV',
      kind: 'tailored',
      owner_scope: 'owner',
      base_cv_version_id: 'cv-3p-ancestor',
      local_ref_rel: 'logs/resumes/acme/cv.html',
      created_at: '2026-11-01T10:00:00Z',
      application_ids: [],
    },
  ]);
  const tpAncRes = validateCvAttribution({ job_id: 'h1-3p-anc', status: 'applied', cv_version_id: 'cv-derived-from-3p' }, { allCvRegistry: thirdPartyAncestorReg });
  assert.equal(tpAncRes.valid, false);
  assert.equal(tpAncRes.violations[0].code, 'third_party_subject');
  assert.match(tpAncRes.violations[0].field_path, /base_cv_version_id/);

  // H1: Missing / dangling ancestor fails closed
  const danglingAncestorReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-dangling-anc',
      version_number: 3,
      label: 'Dangling Derived CV',
      kind: 'tailored',
      owner_scope: 'owner',
      base_cv_version_id: 'cv-nonexistent-root',
      local_ref_rel: 'logs/resumes/acme/cv.html',
      created_at: '2026-11-01T10:00:00Z',
      application_ids: [],
    },
  ]);
  const dangRes = validateCvAttribution({ job_id: 'h1-dang', status: 'applied', cv_version_id: 'cv-dangling-anc' }, { allCvRegistry: danglingAncestorReg });
  assert.equal(dangRes.valid, false);

  // H1: Cyclic ancestry (A -> B -> A and self-cycle) fails closed without infinite loop
  const cyclicReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-cyc-a',
      version_number: 3,
      label: 'Cycle A',
      kind: 'tailored',
      owner_scope: 'owner',
      base_cv_version_id: 'cv-cyc-b',
      local_ref_rel: 'logs/resumes/a/cv.html',
      created_at: '2026-11-01T10:00:00Z',
      application_ids: [],
    },
    {
      cv_version_id: 'cv-cyc-b',
      version_number: 4,
      label: 'Cycle B',
      kind: 'tailored',
      owner_scope: 'owner',
      base_cv_version_id: 'cv-cyc-a',
      local_ref_rel: 'logs/resumes/b/cv.html',
      created_at: '2026-11-01T10:00:00Z',
      application_ids: [],
    },
  ]);
  const cycRes = validateCvAttribution({ job_id: 'h1-cyc', status: 'applied', cv_version_id: 'cv-cyc-a' }, { allCvRegistry: cyclicReg });
  assert.equal(cycRes.valid, false);
  assert.match(cycRes.violations[0].reason, /Cyclic/i);

  // H1: Contradiction when root CV (base_cv_version_id: null) is paired with different app base_cv_version_id
  const rootContra = validateCvAttribution({
    job_id: 'h1-contra',
    status: 'applied',
    cv_version_id: 'cv-base-owner-v1',
    cv_tailoring: { is_tailored: false, base_cv_version_id: 'cv-tailored-owner-v1' },
  }, { allCvRegistry: validReg });
  assert.equal(rootContra.valid, false);
});

test('5. Stage 3 (T7): Allowlist projection for all 3 databases strips denylisted fields & normalizes values deterministically', () => {
  const cvReg = makeOwnerCvRegistry();
  const rawApp = {
    job_id: 'li-4099182312',
    title: 'Senior Full-Stack Engineer',
    company: 'CloudScale Payments',
    platform: 'LinkedIn',
    status: 'interviewing',
    score: 8.75,
    date: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-05T14:30:00Z',
    url: 'https://www.linkedin.com/jobs/view/4099182312/',
    cv_version_id: 'cv-tailored-owner-v1',
    cv_tailoring: { is_tailored: true, base_cv_version_id: 'cv-base-owner-v1', tailored_folder_rel: 'logs/resumes/acme-2026-11/' },
    interviews: [{ interview_id: 'i1', round: 1, stage: 'recruiter_screen', status: 'scheduled' }],
    assessments: [],
    // Denylisted local-only fields (MUST NOT appear in projected payload)
    notes: 'receipt: "Submitted" | recruiter@private.example | +1-555-234-5678',
    screenshot: 'logs/screenshots/li-4099182312.png',
    open_questions: ['What is your salary expectation?'],
    salary_floor: 150000,
  };

  const projectedApp = projectApplicationForNotion(rawApp, { allCvRegistry: cvReg });
  assert.deepEqual(Object.keys(projectedApp).sort(), Object.keys(NOTION_DATABASE_SCHEMAS.applications).sort());
  assert.equal(projectedApp.Title, 'Senior Full-Stack Engineer — CloudScale Payments');
  assert.equal(projectedApp['Application ID'], computeApplicationId('li-4099182312'));
  assert.equal(projectedApp.Status, 'interview');
  assert.equal(projectedApp.Platform, 'linkedin');
  assert.equal(projectedApp['Source Channel'], 'job_board');
  assert.equal(projectedApp['Applied Date'], '2026-11-01');
  assert.equal(projectedApp['Last Updated'], '2026-11-05');
  assert.equal(projectedApp['Match Score'], 8.8);
  assert.equal(projectedApp['CV Version'], 'Owner Tailored Staff CV');
  assert.equal(projectedApp.Tailored, true);
  assert.equal(projectedApp['Interview Rounds'], 1);
  assert.equal(projectedApp.Assessments, 0);
  assert.match(projectedApp['Sync Hash'], /^[a-f0-9]{16}$/);
  assert.equal(projectedApp.notes, undefined);
  assert.equal(projectedApp.screenshot, undefined);
  assert.equal(projectedApp.salary_floor, undefined);

  // Daily run projection
  const projectedRun = projectDailyRunForNotion({
    run_id: '2026-11-23',
    started_at: '2026-11-23T09:00:00Z',
    finished_at: '2026-11-23T09:20:00Z',
    dry_run: false,
    status: 'completed',
    counts: { scanned: 20, prepared: 5, applied: 3, dry_run: 0, needs_review: 1, skipped: 11, failed: 0 },
    platforms: ['Wellfound', 'linkedin', 'wellfound'],
    notes: 'Private internal note should be excluded',
  });
  assert.deepEqual(Object.keys(projectedRun).sort(), Object.keys(NOTION_DATABASE_SCHEMAS.daily_runs).sort());
  assert.deepEqual(projectedRun.Platforms, ['linkedin', 'wellfound']);
  assert.match(projectedRun['Sync Hash'], /^[a-f0-9]{16}$/);

  // Insight projection
  const projectedInsight = projectInsightForNotion({
    schema_version: '2.0',
    type: 'monthly',
    period: '2026-11',
    generated_at: '2026-11-23T12:00:00Z',
    scanned: 25,
    applied: 10,
    avg_match_score: 8.34,
    top_skills: [{ skill: 'TypeScript', count: 8 }, { skill: 'Node.js', count: 6 }],
    skill_gaps: [{ skill: 'Kubernetes', count: 3 }, { skill: 'Go', count: 2 }],
    intelligence: {
      deterministic_facts: {},
      sample_sufficiency: { submitted_n: 10, decided_n: 7, min_threshold: 5, sufficient: true },
      ai_interpretations: [],
      hypotheses: [],
      recommended_actions: [],
    },
  });
  assert.deepEqual(Object.keys(projectedInsight).sort(), Object.keys(NOTION_DATABASE_SCHEMAS.insights).sort());
  assert.equal(projectedInsight['Period Key'], 'monthly:2026-11');
  assert.equal(projectedInsight['Avg Match Score'], 8.3);
  assert.equal(projectedInsight['Sample Sufficient'], true);
  assert.deepEqual(projectedInsight['Top Skills'], ['Node.js', 'TypeScript']);
  assert.deepEqual(projectedInsight['Skill Gaps'], ['Go', 'Kubernetes']);
});

test('6. Stage 3 (T7): 2-layer fail-closed privacy scanner blocks all 8 violation codes without leaking secrets & avoids false positives', () => {
  const cvReg = makeOwnerCvRegistry();

  // Clean realistic application (10-digit LinkedIn job URL, "Education" & "Tokenized" words, excluded local screenshot/notes) -> SAFE
  const cleanRaw = {
    job_id: 'li-4099182312',
    title: 'Senior Education Platform Engineer',
    company: 'Tokenized Payments Secretariat Inc.',
    platform: 'linkedin',
    status: 'applied',
    applied_at: '2026-11-20T10:00:00Z',
    url: 'https://www.linkedin.com/jobs/view/4099182312/',
    cv_version_id: 'cv-base-owner-v1',
    notes: 'receipt: "Submitted" | private@example.com | +1 555-867-5309',
    screenshot: 'logs/screenshots/li-4099182312.png',
  };
  const cleanProjected = projectApplicationForNotion(cleanRaw, { allCvRegistry: cvReg });
  const cleanScan = scanNotionPayloadPrivacy('applications', cleanRaw, cleanProjected, { allCvRegistry: cvReg });
  assert.equal(cleanScan.safe, true, `Unexpected false positives: ${JSON.stringify(cleanScan.violations)}`);

  // Trigger all 8 violation codes and confirm raw secrets/PII are NEVER echoed in reason strings
  const cases = [
    {
      code: 'secret_token',
      secretMarker: ['ntn', 'SUPERSECRET987654321'].join('_'),
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Company: `Acme ${['ntn', 'SUPERSECRET987654321'].join('_')}` },
    },
    {
      code: 'private_email',
      secretMarker: 'founder@stealth-private.io',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Company: 'Contact founder@stealth-private.io' },
    },
    {
      code: 'phone_number',
      secretMarker: '+20 100 555 9876',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Role: 'Call +20 100 555 9876' },
    },
    {
      code: 'local_file_path',
      secretMarker: 'C:\\Users\\Owner\\secret.pdf',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, 'CV Version': 'C:\\Users\\Owner\\secret.pdf' },
    },
    {
      code: 'eeo_or_sensitive_key',
      secretMarker: 'salary_floor',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, salary_floor: 180000 },
    },
    {
      code: 'raw_cv_dump',
      secretMarker: 'Work Experience',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Role: 'Professional Summary: Built systems. Work Experience: Acme. Education: BS CS.' },
    },
    {
      code: 'unsafe_url',
      secretMarker: '169.254.169.254',
      raw: { ...cleanRaw, url: 'http://169.254.169.254/latest/meta-data' },
      payload: { ...cleanProjected },
    },
    {
      code: 'secret_token',
      secretMarker: ['AIza', 'SyD-1234567890abcdef1234567890abcde'].join(''),
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Company: `Acme ${['AIza', 'SyD-1234567890abcdef1234567890abcde'].join('')}` },
    },
    {
      code: 'secret_token',
      secretMarker: ['xoxb', '123456789012', '123456789012', 'abcdefghijklmnop'].join('-'),
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Company: `Acme ${['xoxb', '123456789012', '123456789012', 'abcdefghijklmnop'].join('-')}` },
    },
    {
      code: 'phone_number',
      secretMarker: '555-234-5678',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, Role: 'Call:555-234-5678' },
    },
    {
      code: 'local_file_path',
      secretMarker: './logs/resumes/acme/cv.html',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, 'CV Version': './logs/resumes/acme/cv.html' },
    },
    {
      code: 'local_file_path',
      secretMarker: '../context/cv.md',
      raw: { ...cleanRaw },
      payload: { ...cleanProjected, 'CV Version': '../context/cv.md' },
    },
    {
      code: 'third_party_subject',
      secretMarker: 'client_secret',
      raw: { ...cleanRaw, provenance: { third_party_subject: true } },
      payload: { ...cleanProjected },
    },
  ];

  for (const tc of cases) {
    const res = scanNotionPayloadPrivacy('applications', tc.raw, tc.payload, { allCvRegistry: cvReg });
    assert.equal(res.safe, false, `Expected privacy block for ${tc.code}`);
    assert.ok(res.violations.some(v => v.code === tc.code), `Missing expected violation code ${tc.code}`);
    // Never echo sensitive value in reason text
    if (tc.code === 'secret_token' || tc.code === 'private_email' || tc.code === 'phone_number' || tc.code === 'local_file_path') {
      for (const v of res.violations) {
        assert.equal(v.reason.includes(tc.secretMarker), false, `Violation reason leaked raw value for ${tc.code}`);
      }
    }
  }
});

test('7. Stage 3 (T7): sync_hash, operation_id & non-circular plan_hash are deterministic, include skip_unchanged & ignore excluded/lifecycle fields', () => {
  const cvReg = makeOwnerCvRegistry();
  const baseApp = {
    job_id: 'det-1',
    title: 'Backend Engineer',
    company: 'Acme',
    platform: 'greenhouse',
    status: 'applied',
    applied_at: '2026-11-10T10:00:00Z',
    cv_version_id: 'cv-base-owner-v1',
    notes: 'Original local note',
    screenshot: 'logs/screenshots/a.png',
  };
  const p1 = projectApplicationForNotion(baseApp, { allCvRegistry: cvReg });
  const p2 = projectApplicationForNotion({
    ...baseApp,
    notes: 'Changed private local note — must NOT change sync_hash',
    screenshot: 'logs/screenshots/b.png',
    open_questions: ['Added local question'],
  }, { allCvRegistry: cvReg });
  assert.equal(p1['Sync Hash'], p2['Sync Hash']);

  // Key insertion order invariance in canonicalizeJson & computeSyncHash
  const reordered = {};
  for (const k of Object.keys(p1).reverse()) reordered[k] = p1[k];
  assert.equal(computeSyncHash(p1), computeSyncHash(reordered));
  assert.equal(canonicalizeJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');

  // Mutating an allowlisted field changes sync_hash
  const p3 = projectApplicationForNotion({ ...baseApp, job_id: 'det-2', status: 'interview' }, { allCvRegistry: cvReg });
  assert.notEqual(p1['Sync Hash'], p3['Sync Hash']);

  // Plan hash covers ALL operations (including skip_unchanged), is order-independent, and excludes mode/approval/op.status/plan_hash
  const op1 = {
    operation_id: computeOperationId({ database: 'applications', canonical_key: p1['Application ID'], action: 'create', existing_page_id: null, sync_hash: p1['Sync Hash'] }),
    database: 'applications',
    canonical_key: p1['Application ID'],
    application_status: 'applied',
    action: 'create',
    existing_page_id: null,
    sync_hash: p1['Sync Hash'],
    payload: p1,
    status: 'previewed',
  };
  const op2 = {
    operation_id: computeOperationId({ database: 'applications', canonical_key: p3['Application ID'], action: 'skip_unchanged', existing_page_id: '12345678-1234-1234-1234-1234567890ab', sync_hash: p3['Sync Hash'] }),
    database: 'applications',
    canonical_key: p3['Application ID'],
    application_status: 'interview',
    action: 'skip_unchanged',
    existing_page_id: '12345678-1234-1234-1234-1234567890ab',
    sync_hash: p3['Sync Hash'],
    payload: p3,
    status: 'previewed',
  };

  const plan = {
    schema_version: '1.0',
    plan_id: 'plan-2026-11-23-001',
    created_at: '2026-11-23T12:00:00Z',
    mode: 'preview',
    eligibility_policy: 'submitted_only',
    transport_enabled: false,
    dry_run: true,
    approval: null,
    operations: [op1, op2],
    blocked_items: [],
    skipped_ineligible: [{ canonical_key: 'app_111111111111', status: 'prepared', reason: 'status_not_submitted' }],
  };
  const h1 = computePlanHash(plan);
  assert.match(h1, /^[a-f0-9]{64}$/);

  // Non-circularity: attaching plan_hash, transitioning mode/approval/op.status, or reordering operations yields identical plan_hash
  const approvedPlan = {
    ...plan,
    plan_hash: h1,
    mode: 'approved_execute',
    approval: {
      approved_plan_hash: h1,
      approved_plan_id: plan.plan_id,
      approved_at: '2026-11-23T12:05:00Z',
      approved_by: 'owner',
      operation_count: 2,
    },
    operations: [
      { ...op2, status: 'synced' },
      { ...op1, status: 'in_flight' },
    ],
  };
  assert.equal(computePlanHash(approvedPlan), h1);
  assert.equal(validateNotionSyncPlan(approvedPlan).valid, true);

  // Tampering even a skip_unchanged operation invalidates plan_hash!
  const tamperedSkip = {
    ...approvedPlan,
    operations: [
      { ...op2, payload: { ...op2.payload, Company: 'Tampered Corp' } },
      op1,
    ],
  };
  assert.notEqual(computePlanHash(tamperedSkip), h1);
  const tamperCheck = validateNotionSyncPlan(tamperedSkip);
  assert.equal(tamperCheck.valid, false);
  assert.ok(tamperCheck.errors.some(e => /plan_hash mismatch|sync_hash/i.test(e)));

  // H2: Forged/contradictory plan scenarios MUST ALL be rejected even if plan_hash is recomputed!
  const withFreshHash = p => ({ ...p, plan_hash: computePlanHash(p) });

  // (a) approved_execute with approval: null
  const noApprovalExec = withFreshHash({ ...plan, mode: 'approved_execute', approval: null });
  assert.equal(validateNotionSyncPlan(noApprovalExec).valid, false);
  // (b) verified with approval: null
  const noApprovalVerified = withFreshHash({ ...plan, mode: 'verified', approval: null });
  assert.equal(validateNotionSyncPlan(noApprovalVerified).valid, false);
  // (c) forged operation_id
  const forgedOpIdPlan = withFreshHash({ ...plan, operations: [{ ...op1, operation_id: '0000000000000000' }] });
  assert.equal(validateNotionSyncPlan(forgedOpIdPlan).valid, false);
  assert.ok(validateNotionSyncPlan(forgedOpIdPlan).errors.some(e => /deterministic ID/i.test(e)));
  // (d) op.sync_hash contradicts computeSyncHash(payload)
  const badSyncHashOp = { ...op1, sync_hash: '1111111111111111', operation_id: computeOperationId({ database: op1.database, canonical_key: op1.canonical_key, action: op1.action, existing_page_id: null, sync_hash: '1111111111111111' }) };
  const badSyncHashPlan = withFreshHash({ ...plan, operations: [badSyncHashOp] });
  assert.equal(validateNotionSyncPlan(badSyncHashPlan).valid, false);
  assert.ok(validateNotionSyncPlan(badSyncHashPlan).errors.some(e => /computed payload hash/i.test(e)));
  // (e) payload['Sync Hash'] contradicts op.sync_hash
  const badPayloadHashPlan = withFreshHash({ ...plan, operations: [{ ...op1, payload: { ...op1.payload, 'Sync Hash': '2222222222222222' } }] });
  assert.equal(validateNotionSyncPlan(badPayloadHashPlan).valid, false);
  assert.ok(validateNotionSyncPlan(badPayloadHashPlan).errors.some(e => /Sync Hash/i.test(e)));
  // (f) application_status contradicts payload.Status
  const badStatusPlan = withFreshHash({ ...plan, operations: [{ ...op1, application_status: 'offer' }] });
  assert.equal(validateNotionSyncPlan(badStatusPlan).valid, false);
  assert.ok(validateNotionSyncPlan(badStatusPlan).errors.some(e => /contradicts application_status/i.test(e)));
  // (g) duplicate (database, canonical_key) / duplicate operation_id
  const dupOpsPlan = withFreshHash({ ...plan, operations: [op1, { ...op1 }] });
  assert.equal(validateNotionSyncPlan(dupOpsPlan).valid, false);
  assert.ok(validateNotionSyncPlan(dupOpsPlan).errors.some(e => /duplicate/i.test(e)));
});

test('8. Stage 3 (T7): validateNotionSyncPlan, validateNotionSyncState & schema file maintain 1:1 Draft 2020-12 parity', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'notion-sync-plan.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(schema.$defs.sync_plan.required.includes('plan_hash'));
  assert.ok(schema.$defs.sync_plan.allOf.length >= 1);
  assert.ok(schema.$defs.sync_state_entry.allOf.length >= 1);
  assert.ok(schema.$defs.planned_operation.required.includes('operation_id'));
  assert.ok(schema.$defs.sync_item_state.enum.includes('failed_permanent'));
  assert.equal(schema.$defs.sync_plan.properties.eligibility_policy.const, 'submitted_only');

  // UUID normalization & composite key helpers
  assert.equal(normalizeNotionUuid('123456781234123412341234567890AB'), '12345678-1234-1234-1234-1234567890ab');
  assert.equal(normalizeNotionUuid('not-a-uuid'), null);
  assert.equal(makeSyncStateKey('applications', 'app_abcdef012345'), 'applications::app_abcdef012345');
  assert.deepEqual(resolveCanonicalSyncKey('daily_runs', { run_id: '2026-11-23' }), {
    valid: true,
    canonical_key: '2026-11-23',
    reason: null,
  });

  // Valid sync-state file (including valid synced entry with UUID + 16-hex hash) passes
  const validState = {
    schema_version: '1.0',
    updated_at: '2026-11-23T12:00:00Z',
    records: {
      'applications::app_abcdef012345': {
        database: 'applications',
        canonical_key: 'app_abcdef012345',
        state: 'failed_permanent',
        page_id: null,
        last_synced_hash: null,
        attempted_hash: '0123456789abcdef',
        attempted_at: '2026-11-23T11:55:00Z',
        operation_id: 'abcdef0123456789',
        approved_plan_hash: 'a'.repeat(64),
        retry_count: 0,
        last_error: 'schema_mismatch',
      },
      'daily_runs::2026-11-23': {
        database: 'daily_runs',
        canonical_key: '2026-11-23',
        state: 'synced',
        page_id: '12345678-1234-1234-1234-1234567890ab',
        last_synced_hash: 'fedcba9876543210',
        last_synced_at: '2026-11-23T12:00:00Z',
        retry_count: 0,
      },
    },
  };
  assert.equal(validateNotionSyncState(validState).valid, true);

  // M1: Map key mismatch fails closed
  const keyMismatchState = {
    schema_version: '1.0',
    updated_at: '2026-11-23T12:00:00Z',
    records: {
      'applications::app_111111111111': {
        database: 'daily_runs',
        canonical_key: '2026-11-23',
        state: 'pending_sync',
      },
    },
  };
  assert.equal(validateNotionSyncState(keyMismatchState).valid, false);
  assert.ok(validateNotionSyncState(keyMismatchState).errors.some(e => /does not match expected key/i.test(e)));

  // M1: state === "synced" with null page_id, non-UUID page_id, or null/bad last_synced_hash fails closed
  for (const brokenSynced of [
    { page_id: null, last_synced_hash: 'fedcba9876543210' },
    { page_id: 'not-a-uuid', last_synced_hash: 'fedcba9876543210' },
    { page_id: '12345678-1234-1234-1234-1234567890ab', last_synced_hash: null },
    { page_id: '12345678-1234-1234-1234-1234567890ab', last_synced_hash: 'not-a-16-hex-hash' },
  ]) {
    const res = validateNotionSyncState({
      schema_version: '1.0',
      updated_at: '2026-11-23T12:00:00Z',
      records: {
        'daily_runs::2026-11-23': {
          database: 'daily_runs',
          canonical_key: '2026-11-23',
          state: 'synced',
          ...brokenSynced,
        },
      },
    });
    assert.equal(res.valid, false, `Expected failure for synced entry: ${JSON.stringify(brokenSynced)}`);
  }

  // Invalid extra key fails closed
  const badState = {
    ...validState,
    records: {
      'applications::app_abcdef012345': {
        ...validState.records['applications::app_abcdef012345'],
        unexpected_field: true,
      },
    },
  };
  assert.equal(validateNotionSyncState(badState).valid, false);
});

test('9. Stage 3 (T7 + T8-A): Static transport-free & ledger-isolation invariants in bin/notion-sync.mjs', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'notion-sync.mjs'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /node:https?|['"]https?['"]/);
  assert.doesNotMatch(src, /api\.notion\.com/i);
  assert.doesNotMatch(src, /process\.env\.NOTION_TOKEN/);
  // Local I/O must strictly target logs/sync-state.json and NEVER write logs/applications-log.json
  assert.doesNotMatch(src, /applications-log\.json/);
});

test('10. Stage 3 (R1, R2, R3): Action/page pairing, DB canonical-key binding & in_flight validator contracts', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'notion-sync-plan.schema.json'), 'utf8'));
  assert.ok(schema.$defs.planned_operation.allOf.length >= 3, 'R1 schema must enforce create/update existing_page_id rules');
  assert.ok(schema.$defs.sync_state_entry.allOf.length >= 2, 'R3 schema must enforce in_flight invariants');

  const cvReg = makeOwnerCvRegistry();
  const appPayload = projectApplicationForNotion({
    job_id: 'r1-app-1',
    title: 'Backend Engineer',
    company: 'Acme',
    status: 'applied',
    applied_at: '2026-11-10T10:00:00Z',
    cv_version_id: 'cv-base-owner-v1',
  }, { allCvRegistry: cvReg });
  const runPayload = projectDailyRunForNotion({
    run_id: '2026-11-23',
    started_at: '2026-11-23T09:00:00Z',
    dry_run: false,
    status: 'completed',
    counts: { scanned: 5, applied: 2, dry_run: 0, needs_review: 0, skipped: 3, failed: 0 },
  });
  const insightPayload = projectInsightForNotion({
    schema_version: '2.0',
    type: 'monthly',
    period: '2026-11',
    generated_at: '2026-11-23T12:00:00Z',
    scanned: 10,
    applied: 5,
    avg_match_score: 8.2,
    intelligence: {
      deterministic_facts: {},
      sample_sufficiency: { submitted_n: 5, decided_n: 5, min_threshold: 5, sufficient: true },
      ai_interpretations: [],
      hypotheses: [],
      recommended_actions: [],
    },
  });

  const validUuid = '12345678-1234-1234-1234-1234567890ab';
  const wrapPlan = ops => {
    const p = {
      schema_version: '1.0',
      plan_id: 'plan-r123',
      created_at: '2026-11-23T12:00:00Z',
      mode: 'preview',
      eligibility_policy: 'submitted_only',
      transport_enabled: false,
      dry_run: true,
      approval: null,
      operations: ops,
      blocked_items: [],
      skipped_ineligible: [],
    };
    p.plan_hash = computePlanHash(p);
    return p;
  };
  const mkOp = ({ database, canonical_key, application_status, action, existing_page_id, payload }) => ({
    operation_id: computeOperationId({ database, canonical_key, action, existing_page_id, sync_hash: payload['Sync Hash'] }),
    database,
    canonical_key,
    ...(database === 'applications' ? { application_status } : {}),
    action,
    existing_page_id,
    sync_hash: payload['Sync Hash'],
    payload,
    status: 'previewed',
  });

  // R1: valid create (null page_id) and valid update (UUID page_id) pass
  assert.equal(validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'applications', canonical_key: appPayload['Application ID'], application_status: 'applied', action: 'create', existing_page_id: null, payload: appPayload }),
  ])).valid, true);
  assert.equal(validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'applications', canonical_key: appPayload['Application ID'], application_status: 'applied', action: 'update', existing_page_id: validUuid, payload: appPayload }),
  ])).valid, true);

  // R1: invalid pairings MUST fail closed
  const badUpdateNull = validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'applications', canonical_key: appPayload['Application ID'], application_status: 'applied', action: 'update', existing_page_id: null, payload: appPayload }),
  ]));
  assert.equal(badUpdateNull.valid, false);
  assert.ok(badUpdateNull.errors.some(e => /action "update" requires a valid Notion UUID/i.test(e)));

  const badUpdateNonUuid = validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'applications', canonical_key: appPayload['Application ID'], application_status: 'applied', action: 'update', existing_page_id: 'not-a-uuid', payload: appPayload }),
  ]));
  assert.equal(badUpdateNonUuid.valid, false);

  const badCreateWithPage = validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'applications', canonical_key: appPayload['Application ID'], application_status: 'applied', action: 'create', existing_page_id: validUuid, payload: appPayload }),
  ]));
  assert.equal(badCreateWithPage.valid, false);
  assert.ok(badCreateWithPage.errors.some(e => /action "create" requires existing_page_id to be null/i.test(e)));

  // R2: daily_runs & insights canonical key binding
  assert.equal(validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'daily_runs', canonical_key: '2026-11-23', action: 'create', existing_page_id: null, payload: runPayload }),
    mkOp({ database: 'insights', canonical_key: 'monthly:2026-11', action: 'create', existing_page_id: null, payload: insightPayload }),
  ])).valid, true);

  const badRunKey = validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'daily_runs', canonical_key: '2026-11-24', action: 'create', existing_page_id: null, payload: runPayload }),
  ]));
  assert.equal(badRunKey.valid, false);
  assert.ok(badRunKey.errors.some(e => /Run ID/i.test(e)));

  const badInsightKey = validateNotionSyncPlan(wrapPlan([
    mkOp({ database: 'insights', canonical_key: 'monthly:2026-10', action: 'create', existing_page_id: null, payload: insightPayload }),
  ]));
  assert.equal(badInsightKey.valid, false);
  assert.ok(badInsightKey.errors.some(e => /Period Key/i.test(e)));

  // M1: Sync-state validator, normalizer & schema parity for UUID page_id & conflict_duplicate_remote
  assert.ok(schema.$defs.notion_uuid, 'Schema must define notion_uuid');
  assert.ok(schema.$defs.sync_state_entry.allOf.length >= 3, 'Schema must enforce synced, in_flight & conflict_duplicate_remote invariants');

  // Non-UUID page_id rejected even on pending_sync
  const badPendingPage = {
    schema_version: '1.0',
    updated_at: null,
    records: {
      'applications::app_abcdef012345': {
        database: 'applications',
        canonical_key: 'app_abcdef012345',
        state: 'pending_sync',
        page_id: 'not-a-uuid',
      },
    },
  };
  assert.equal(validateNotionSyncState(badPendingPage).valid, false);
  assert.throws(() => normalizeSyncState(badPendingPage), /Invalid sync-state/i);

  // conflict_duplicate_remote requires >= 2 distinct valid Notion UUIDs
  for (const badConflict of [
    undefined,
    [],
    ['12345678-1234-1234-1234-1234567890ab'],
    ['12345678-1234-1234-1234-1234567890ab', '123456781234123412341234567890AB'], // same UUID after normalization!
    ['12345678-1234-1234-1234-1234567890ab', 'not-a-uuid'],
  ]) {
    const entry = {
      database: 'applications',
      canonical_key: 'app_abcdef012345',
      state: 'conflict_duplicate_remote',
      ...(badConflict !== undefined ? { conflicting_page_ids: badConflict } : {}),
    };
    const st = { schema_version: '1.0', updated_at: null, records: { 'applications::app_abcdef012345': entry } };
    assert.equal(validateNotionSyncState(st).valid, false, `Expected conflict failure for ${JSON.stringify(badConflict)}`);
    assert.throws(() => normalizeSyncState(st), /Invalid sync-state/i);
  }
  const okConflict = {
    schema_version: '1.0',
    updated_at: null,
    records: {
      'applications::app_abcdef012345': {
        database: 'applications',
        canonical_key: 'app_abcdef012345',
        state: 'conflict_duplicate_remote',
        conflicting_page_ids: [
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
        ],
      },
    },
  };
  assert.equal(validateNotionSyncState(okConflict).valid, true);
  assert.deepEqual(normalizeSyncState(okConflict).records['applications::app_abcdef012345'].conflicting_page_ids, [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ]);

  // R3: in_flight validator contract
  const validInFlight = {
    schema_version: '1.0',
    updated_at: '2026-11-23T12:00:00Z',
    records: {
      'applications::app_abcdef012345': {
        database: 'applications',
        canonical_key: 'app_abcdef012345',
        state: 'in_flight',
        page_id: null,
        attempted_hash: '0123456789abcdef',
        attempted_at: '2026-11-23T12:00:00Z',
        operation_id: 'fedcba9876543210',
        approved_plan_hash: 'b'.repeat(64),
      },
    },
  };
  assert.equal(validateNotionSyncState(validInFlight).valid, true);

  for (const brokenInFlight of [
    { attempted_hash: null, attempted_at: '2026-11-23T12:00:00Z', operation_id: 'fedcba9876543210', approved_plan_hash: 'b'.repeat(64) },
    { attempted_hash: '0123456789abcdef', attempted_at: null, operation_id: 'fedcba9876543210', approved_plan_hash: 'b'.repeat(64) },
    { attempted_hash: '0123456789abcdef', operation_id: 'fedcba9876543210', approved_plan_hash: 'b'.repeat(64) }, // missing attempted_at (D5)
    { attempted_hash: '0123456789abcdef', attempted_at: '2026-02-30T12:00:00Z', operation_id: 'fedcba9876543210', approved_plan_hash: 'b'.repeat(64) }, // calendar-invalid
    { attempted_hash: '0123456789abcdef', attempted_at: '2026-11-23T12:00:00Z', operation_id: null, approved_plan_hash: 'b'.repeat(64) },
    { attempted_hash: '0123456789abcdef', attempted_at: '2026-11-23T12:00:00Z', operation_id: 'fedcba9876543210', approved_plan_hash: null },
    { attempted_hash: 'bad', attempted_at: '2026-11-23T12:00:00Z', operation_id: 'fedcba9876543210', approved_plan_hash: 'b'.repeat(64) },
  ]) {
    const res = validateNotionSyncState({
      schema_version: '1.0',
      updated_at: '2026-11-23T12:00:00Z',
      records: {
        'applications::app_abcdef012345': {
          database: 'applications',
          canonical_key: 'app_abcdef012345',
          state: 'in_flight',
          ...brokenInFlight,
        },
      },
    });
    assert.equal(res.valid, false, `Expected in_flight validation failure for ${JSON.stringify(brokenInFlight)}`);
  }
});

test('11. Stage 3 (T8-A): Sync-state foundation persists logs/sync-state.json atomically without touching logs/applications-log.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8a-state-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  try {
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([{ job_id: 'j1', status: 'applied' }], null, 2));
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');

    // Empty workspace returns deterministic empty state
    const initial = loadSyncState(work, { home });
    assert.equal(initial.exists, false);
    assert.deepEqual(initial.state, createEmptySyncState(null));

    // Normalization sorts keys, normalizes uppercase/undashed UUIDs, deduplicates & sorts conflicting_page_ids
    const rawState = {
      schema_version: '1.0',
      updated_at: null,
      records: {
        'daily_runs::2026-11-23': {
          database: 'daily_runs',
          canonical_key: '2026-11-23',
          state: 'synced',
          page_id: '123456781234123412341234567890AB',
          last_synced_hash: '0123456789abcdef',
          last_synced_at: '2026-11-23T12:00:00Z',
        },
        'applications::app_abcdef012345': {
          database: 'applications',
          canonical_key: 'app_abcdef012345',
          state: 'conflict_duplicate_remote',
          page_id: null,
          conflicting_page_ids: [
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
          ],
        },
      },
    };

    const saved = saveSyncState(work, rawState, { home, nowIso: '2026-11-23T12:30:00Z' });
    assert.ok(fs.existsSync(saved.path));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
    }
    // Zero leftover temp files
    assert.equal(fs.readdirSync(path.join(work, 'logs')).filter(f => f.includes('.tmp-')).length, 0);

    const reloaded = loadSyncState(work, { home });
    assert.equal(reloaded.exists, true);
    assert.deepEqual(Object.keys(reloaded.state.records), [
      'applications::app_abcdef012345',
      'daily_runs::2026-11-23',
    ]);
    assert.equal(reloaded.state.records['daily_runs::2026-11-23'].page_id, '12345678-1234-1234-1234-1234567890ab');
    assert.deepEqual(reloaded.state.records['applications::app_abcdef012345'].conflicting_page_ids, [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);

    // Never mutates logs/applications-log.json
    const ledgerShaAfter = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');
    assert.equal(ledgerShaAfter, ledgerShaBefore);

    // Fail closed on corrupt JSON and contradictory state on disk
    fs.writeFileSync(saved.path, '{corrupt');
    assert.throws(() => loadSyncState(work, { home }), /Invalid JSON/i);

    fs.writeFileSync(saved.path, JSON.stringify({
      schema_version: '1.0',
      updated_at: '2026-11-23T12:30:00Z',
      records: {
        'daily_runs::2026-11-23': {
          database: 'daily_runs',
          canonical_key: '2026-11-23',
          state: 'synced',
          page_id: null,
          last_synced_hash: '0123456789abcdef',
        },
      },
    }));
    assert.throws(() => loadSyncState(work, { home }), /Invalid sync-state document/i);
    assert.throws(() => normalizeSyncState({
      schema_version: '1.0',
      updated_at: null,
      records: {
        'daily_runs::2026-11-23': {
          database: 'daily_runs',
          canonical_key: '2026-11-23',
          state: 'pending_sync',
          page_id: 'not-a-valid-uuid',
        },
      },
    }), /valid Notion UUID/i);

    // Symlinked parent directory refusal (cross-platform: junction on Windows, dir symlink on POSIX)
    const outsideDir = path.join(dir, 'outside-dir');
    const symWork = path.join(dir, 'sym-work');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(symWork, { recursive: true });
    let linkCreated = false;
    try {
      fs.symlinkSync(outsideDir, path.join(symWork, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
      linkCreated = true;
    } catch { /* ignore if OS disallows symlinks */ }
    if (linkCreated) {
      assert.throws(() => loadSyncState(symWork, { home }), /symbolic-link/i);
      assert.throws(() => saveSyncState(symWork, createEmptySyncState(null), { home, nowIso: '2026-11-23T12:30:00Z' }), /symbolic-link/i);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('12. Stage 3 (T8-A): Deterministic diff generator handles creates, updates, unchanged, conflicts, uncertain states, duplicates & privacy fail-closed', () => {
  const cvReg = makeOwnerCvRegistry([
    {
      cv_version_id: 'cv-3p-client',
      version_number: 3,
      label: 'Client CV',
      kind: 'generic',
      owner_scope: 'third_party',
      base_cv_version_id: null,
      local_ref_rel: 'logs/resumes/cv-client/cv.html',
      created_at: '2026-11-01T10:00:00Z',
      application_ids: [],
    },
  ]);

  const appNew = { job_id: 'diff-new', title: 'Backend Eng', company: 'NewCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appPending = { job_id: 'diff-pend', title: 'Staff Eng', company: 'PendCo', platform: 'lever', status: 'applied', applied_at: '2026-11-19T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appUnchanged = { job_id: 'diff-same', title: 'Platform Eng', company: 'SameCo', platform: 'linkedin', status: 'interview', applied_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appChanged = { job_id: 'diff-chg', title: 'Principal Eng', company: 'ChgCo', platform: 'ashby', status: 'offer', applied_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-21T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appMissingRemote = { job_id: 'diff-miss-rem', title: 'SRE', company: 'GhostPageCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-08T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appRemoteDup = { job_id: 'diff-rem-dup', title: 'DevOps', company: 'DupRemCo', platform: 'lever', status: 'applied', applied_at: '2026-11-07T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appUncertain = { job_id: 'diff-uncert-state', title: 'SecEng', company: 'UncertStateCo', platform: 'ashby', status: 'applied', applied_at: '2026-11-06T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appInFlight = { job_id: 'diff-inflight', title: 'AI Eng', company: 'FlightCo', platform: 'linkedin', status: 'applied', applied_at: '2026-11-05T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appPageMismatch = { job_id: 'diff-mismatch', title: 'Data Eng', company: 'MismatchCo', platform: 'linkedin', status: 'applied', applied_at: '2026-11-04T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appPrepared = { job_id: 'diff-prep', title: 'Draft Eng', company: 'PrepCo', status: 'prepared' };
  const appSecret = { job_id: 'diff-secret', title: 'Eng', company: `Acme ${['ntn', 'SECRETTOKEN123456'].join('_')}`, status: 'applied', applied_at: '2026-11-10T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appThirdParty = { job_id: 'diff-3p', title: 'Eng', company: 'ClientCo', status: 'offer', applied_at: '2026-11-10T10:00:00Z', cv_version_id: 'cv-3p-client' };

  const unchangedHash = projectApplicationForNotion(appUnchanged, { allCvRegistry: cvReg })['Sync Hash'];
  const missingRemHash = projectApplicationForNotion(appMissingRemote, { allCvRegistry: cvReg })['Sync Hash'];

  const keyPend = computeApplicationId(appPending.job_id);
  const keySame = computeApplicationId(appUnchanged.job_id);
  const keyChg = computeApplicationId(appChanged.job_id);
  const keyMissRem = computeApplicationId(appMissingRemote.job_id);
  const keyRemDup = computeApplicationId(appRemoteDup.job_id);
  const keyUncert = computeApplicationId(appUncertain.job_id);
  const keyInFlight = computeApplicationId(appInFlight.job_id);
  const keyMismatch = computeApplicationId(appPageMismatch.job_id);

  const uuidSame = '11111111-1111-1111-1111-111111111111';
  const uuidChg = '22222222-2222-2222-2222-222222222222';
  const uuidMissRem = '33333333-3333-3333-3333-333333333333';
  const uuidMismatchLocal = '44444444-4444-4444-4444-444444444444';
  const uuidMismatchRemote = '55555555-5555-5555-5555-555555555555';

  const syncState = {
    schema_version: '1.0',
    updated_at: '2026-11-22T12:00:00Z',
    records: {
      [`applications::${keyPend}`]: { database: 'applications', canonical_key: keyPend, state: 'pending_sync', page_id: null },
      [`applications::${keySame}`]: { database: 'applications', canonical_key: keySame, state: 'synced', page_id: uuidSame, last_synced_hash: unchangedHash },
      [`applications::${keyChg}`]: { database: 'applications', canonical_key: keyChg, state: 'synced', page_id: uuidChg, last_synced_hash: '0000000000000000' },
      [`applications::${keyMissRem}`]: { database: 'applications', canonical_key: keyMissRem, state: 'synced', page_id: uuidMissRem, last_synced_hash: missingRemHash },
      [`applications::${keyUncert}`]: { database: 'applications', canonical_key: keyUncert, state: 'receipt_uncertain', page_id: null, attempted_hash: '1111111111111111' },
      [`applications::${keyInFlight}`]: { database: 'applications', canonical_key: keyInFlight, state: 'in_flight', page_id: null, attempted_hash: '2222222222222222', attempted_at: '2026-11-22T12:00:00Z', operation_id: '3333333333333333', approved_plan_hash: 'c'.repeat(64) },
      [`applications::${keyMismatch}`]: { database: 'applications', canonical_key: keyMismatch, state: 'synced', page_id: uuidMismatchLocal, last_synced_hash: '4444444444444444' },
    },
  };

  const remoteIndex = {
    [`applications::${keyMissRem}`]: [], // synced locally, missing remotely -> HOLD (never blind create!)
    [`applications::${keyRemDup}`]: [
      { page_id: '66666666-6666-6666-6666-666666666666', sync_hash: null },
      { page_id: '77777777-7777-7777-7777-777777777777', sync_hash: null },
    ],
    [`applications::${keyMismatch}`]: [{ page_id: uuidMismatchRemote, sync_hash: null }],
  };

  const runCompleted = { run_id: '2026-11-23', started_at: '2026-11-23T09:00:00Z', dry_run: false, status: 'completed', counts: { scanned: 10, applied: 4, dry_run: 0, needs_review: 0, skipped: 6, failed: 0 } };
  const runRunning = { run_id: '2026-11-24', started_at: '2026-11-24T09:00:00Z', dry_run: false, status: 'running', counts: { scanned: 2, applied: 0, dry_run: 0, needs_review: 0, skipped: 0, failed: 0 } };
  const insightMonthly = {
    schema_version: '2.0', type: 'monthly', period: '2026-11', generated_at: '2026-11-23T12:00:00Z',
    scanned: 20, applied: 8, avg_match_score: 8.5,
    intelligence: { deterministic_facts: {}, sample_sufficiency: { submitted_n: 8, decided_n: 6, min_threshold: 5, sufficient: true }, ai_interpretations: [], hypotheses: [], recommended_actions: [] },
  };

  const appsList = [
    appNew, appPending, appUnchanged, appChanged, appMissingRemote,
    appRemoteDup, appUncertain, appInFlight, appPageMismatch, appPrepared,
    appSecret, appThirdParty,
  ];
  const createdAt = '2026-11-23T12:00:00Z';

  const diffA = computeNotionSyncDiff({
    applications: appsList,
    dailyRuns: [runCompleted, runRunning],
    insights: [insightMonthly],
    allCvRegistry: cvReg,
    syncState,
    remoteIndex,
    planId: 'plan-t8a-001',
    createdAt,
  });

  // Determinism: reversed input order produces byte-identical diff & plan_hash
  const diffB = computeNotionSyncDiff({
    applications: [...appsList].reverse(),
    dailyRuns: [runRunning, runCompleted],
    insights: [insightMonthly],
    allCvRegistry: cvReg,
    syncState,
    remoteIndex,
    planId: 'plan-t8a-001',
    createdAt,
  });
  assert.deepEqual(diffA, diffB);
  assert.equal(validateNotionSyncPlan(diffA.plan).valid, true);

  // Verify exact counts and actions
  assert.equal(diffA.summary.create, 4); // appNew, appPending, runCompleted, insightMonthly
  assert.equal(diffA.summary.update, 1); // appChanged
  assert.equal(diffA.summary.skip_unchanged, 1); // appUnchanged
  assert.equal(diffA.summary.blocked_privacy, 2); // appSecret, appThirdParty
  assert.equal(diffA.summary.skipped_ineligible, 2); // appPrepared, runRunning
  assert.equal(diffA.summary.held, 5); // appMissingRemote, appRemoteDup, appUncertain, appInFlight, appPageMismatch

  const opByKey = new Map(diffA.plan.operations.map(o => [`${o.database}::${o.canonical_key}`, o]));
  assert.equal(opByKey.get(`applications::${computeApplicationId(appNew.job_id)}`).action, 'create');
  assert.equal(opByKey.get(`applications::${keyPend}`).action, 'create');
  assert.equal(opByKey.get(`applications::${keySame}`).action, 'skip_unchanged');
  assert.equal(opByKey.get(`applications::${keyChg}`).action, 'update');
  assert.equal(opByKey.get(`applications::${keyChg}`).existing_page_id, uuidChg);
  assert.equal(opByKey.get('daily_runs::2026-11-23').action, 'create');
  assert.equal(opByKey.get('insights::monthly:2026-11').action, 'create');

  // Held items never leak into operations[]
  const heldByKey = new Map(diffA.held_items.map(h => [`${h.database}::${h.canonical_key}`, h]));
  assert.equal(heldByKey.get(`applications::${keyMissRem}`).reason, 'synced_page_missing_remotely');
  assert.equal(heldByKey.get(`applications::${keyRemDup}`).state, 'conflict_duplicate_remote');
  assert.equal(heldByKey.get(`applications::${keyUncert}`).state, 'receipt_uncertain');
  assert.equal(heldByKey.get(`applications::${keyInFlight}`).state, 'in_flight');
  assert.equal(heldByKey.get(`applications::${keyMismatch}`).reason, 'local_remote_page_id_mismatch');

  // Duplicate local canonical keys fail closed (including mixed eligible + ineligible in BOTH orders — H2)
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appNew, { ...appNew }], allCvRegistry: cvReg, createdAt }),
    /Duplicate local canonical key/i,
  );
  const dupPrepared = { job_id: 'dup-mix-1', title: 'Eng', company: 'MixCo', status: 'prepared' };
  const dupApplied = { job_id: 'dup-mix-1', title: 'Eng', company: 'MixCo', status: 'applied', applied_at: '2026-11-10T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const dupUncertain = { job_id: 'dup-mix-1', title: 'Eng', company: 'MixCo', status: 'applied', submission_uncertain: true };
  assert.throws(
    () => computeNotionSyncDiff({ applications: [dupPrepared, dupApplied], allCvRegistry: cvReg, createdAt }),
    /Duplicate local canonical key/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ applications: [dupApplied, dupPrepared], allCvRegistry: cvReg, createdAt }),
    /Duplicate local canonical key/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ applications: [dupUncertain, dupApplied], allCvRegistry: cvReg, createdAt }),
    /Duplicate local canonical key/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ dailyRuns: [runCompleted, { ...runRunning, run_id: runCompleted.run_id }], createdAt }),
    /Duplicate local canonical key/i,
  );

  // H1: Duplicate remote page_id with IDENTICAL sync_hash deduplicates cleanly, while CONFLICTING sync_hash fails closed in BOTH orders
  const appNewHash = projectApplicationForNotion(appNew, { allCvRegistry: cvReg })['Sync Hash'];
  const appNewKey = computeApplicationId(appNew.job_id);
  const dupRemoteSame = computeNotionSyncDiff({
    applications: [appNew],
    allCvRegistry: cvReg,
    remoteIndex: {
      [`applications::${appNewKey}`]: [
        { page_id: uuidSame, sync_hash: appNewHash },
        { page_id: uuidSame.toUpperCase().replace(/-/g, ''), sync_hash: appNewHash },
      ],
    },
    createdAt,
  });
  assert.equal(dupRemoteSame.plan.operations.length, 1);
  assert.equal(dupRemoteSame.plan.operations[0].action, 'skip_unchanged');

  const conflictPairA = [{ page_id: uuidSame, sync_hash: appNewHash }, { page_id: uuidSame, sync_hash: 'ffffffffffffffff' }];
  const conflictPairB = [...conflictPairA].reverse();
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appNew], allCvRegistry: cvReg, remoteIndex: { [`applications::${appNewKey}`]: conflictPairA }, createdAt }),
    /Conflicting sync_hash/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appNew], allCvRegistry: cvReg, remoteIndex: { [`applications::${appNewKey}`]: conflictPairB }, createdAt }),
    /Conflicting sync_hash/i,
  );

  // M2: Malformed remoteIndex keys fail closed (never silently fall back to unintended create)
  for (const badRemoteKey of [
    'bad-key-format',
    'unknown_db::app_1234567890ab',
    'applications::',
    'applications::not-an-app-id',
    `applications::${appNewKey}::extra`,
  ]) {
    assert.throws(
      () => computeNotionSyncDiff({ applications: [appNew], allCvRegistry: cvReg, remoteIndex: { [badRemoteKey]: [{ page_id: uuidSame }] }, createdAt }),
      /Malformed remoteIndex key/i,
      `Expected malformed remoteIndex key failure for "${badRemoteKey}"`,
    );
  }

  // M3: Multiple third-party records missing job_id block cleanly, deterministically & without leaking third-party data
  const tpMissing1 = { title: 'Confidential Role A', company: 'SecretClientAlpha', status: 'applied', provenance: { third_party_subject: true }, cv_tailoring: { is_tailored: true, tailored_folder_rel: 'logs/resumes/cv-alpha/' } };
  const tpMissing2 = { title: 'Confidential Role B', company: 'SecretClientBeta', status: 'offer', provenance: { third_party_subject: true }, cv_tailoring: { is_tailored: false, tailored_folder_rel: 'logs/resumes/cv-beta/' } };
  const m3Forward = computeNotionSyncDiff({ applications: [appNew, tpMissing1, tpMissing2], allCvRegistry: cvReg, createdAt });
  const m3Reverse = computeNotionSyncDiff({ applications: [tpMissing2, tpMissing1, appNew], allCvRegistry: cvReg, createdAt });
  assert.deepEqual(m3Forward, m3Reverse);
  assert.equal(m3Forward.plan.operations.length, 1);
  assert.equal(m3Forward.plan.blocked_items.length, 2);
  assert.notEqual(m3Forward.plan.blocked_items[0].canonical_key, m3Forward.plan.blocked_items[1].canonical_key);
  assert.ok(m3Forward.plan.blocked_items.every(b => /^unidentified_[a-f0-9]{12}$/.test(b.canonical_key)));
  const m3Json = JSON.stringify(m3Forward.plan);
  assert.equal(m3Json.includes('SecretClientAlpha'), false);
  assert.equal(m3Json.includes('SecretClientBeta'), false);
  assert.equal(m3Json.includes('cv-alpha'), false);
  assert.equal(m3Json.includes('cv-beta'), false);

  // L1: pending_sync with non-null local page_id + explicit empty remote match holds as receipt_uncertain (never update or blind create!)
  const l1Diff = computeNotionSyncDiff({
    applications: [appNew],
    allCvRegistry: cvReg,
    syncState: {
      schema_version: '1.0',
      updated_at: '2026-11-22T12:00:00Z',
      records: {
        [`applications::${appNewKey}`]: {
          database: 'applications',
          canonical_key: appNewKey,
          state: 'pending_sync',
          page_id: uuidSame,
        },
      },
    },
    remoteIndex: { [`applications::${appNewKey}`]: [] },
    createdAt,
  });
  assert.equal(l1Diff.plan.operations.length, 0);
  assert.equal(l1Diff.held_items.length, 1);
  assert.equal(l1Diff.held_items[0].state, 'receipt_uncertain');
  assert.equal(l1Diff.held_items[0].reason, 'local_page_missing_remotely');

  // Malformed syncState and malformed remoteIndex fail closed
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appNew], allCvRegistry: cvReg, syncState: { schema_version: '9.9', updated_at: null, records: {} }, createdAt }),
    /Invalid sync-state/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appNew], allCvRegistry: cvReg, remoteIndex: { [`applications::${appNewKey}`]: [{ page_id: 'not-a-uuid' }] }, createdAt }),
    /invalid or missing Notion UUID/i,
  );
});

test('13. Stage 3 (T8-A R4–R7): Circular/BigInt fallback, strict UUID parity, cross-key remote page_id conflicts & regression sweep', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'notion-sync-plan.schema.json'), 'utf8'));
  const schemaUuidRe = new RegExp(schema.$defs.notion_uuid.pattern);
  const cvReg = makeOwnerCvRegistry();
  const createdAt = '2026-11-23T12:00:00Z';

  const appA = { job_id: 'r47-app-a', title: 'Staff Eng', company: 'AlphaCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const appB = { job_id: 'r47-app-b', title: 'Lead Eng', company: 'BetaCo', platform: 'lever', status: 'interview', applied_at: '2026-11-21T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
  const keyA = computeApplicationId(appA.job_id);
  const keyB = computeApplicationId(appB.job_id);
  const hashA = projectApplicationForNotion(appA, { allCvRegistry: cvReg })['Sync Hash'];
  const uuid1 = 'aaaaaaaa-1111-2222-3333-444444444444';
  const uuid1UpperNoDash = 'AAAAAAAA111122223333444444444444';
  const uuid2 = 'bbbbbbbb-1111-2222-3333-444444444444';

  // ---- R4 + R7 (M3): Circular objects, BigInt, non-finite numbers, exact duplicates & malformed rows ----
  const circ3p = {
    title: 'Circular Secret Role',
    company: 'SecretCircularClient',
    status: 'applied',
    provenance: { third_party_subject: true },
    cv_tailoring: { tailored_folder_rel: 'logs/resumes/cv-circ/' },
  };
  circ3p.self = circ3p;
  const bigInt3p = {
    title: 'BigInt Secret Role',
    company: 'SecretBigIntClient',
    status: 'offer',
    comp_raw: 250000n,
    weird_num: Number.NaN,
    provenance: { third_party_subject: true },
    cv_tailoring: { tailored_folder_rel: 'logs/resumes/cv-bigint/' },
  };
  const dupUnid1 = { title: 'Dup Role', company: 'SecretDupClient', status: 'applied', provenance: { third_party_subject: true } };
  const dupUnid2 = { ...dupUnid1 };
  const malformedRows = [null, undefined, 42, 'bad-row', {}, { status: 'applied' }];

  const r4Fwd = computeNotionSyncDiff({
    applications: [appA, circ3p, bigInt3p, dupUnid1, dupUnid2, ...malformedRows],
    allCvRegistry: cvReg,
    createdAt,
  });
  const r4Rev = computeNotionSyncDiff({
    applications: [...malformedRows.slice().reverse(), dupUnid2, dupUnid1, bigInt3p, circ3p, appA],
    allCvRegistry: cvReg,
    createdAt,
  });
  assert.deepEqual(r4Fwd, r4Rev);
  assert.equal(validateNotionSyncPlan(r4Fwd.plan).valid, true);
  assert.equal(r4Fwd.plan.operations.length, 1);
  assert.equal(r4Fwd.plan.blocked_items.length, 4);
  const r4Keys = r4Fwd.plan.blocked_items.map(b => b.canonical_key);
  assert.equal(new Set(r4Keys).size, 4);
  assert.ok(r4Keys.every(k => /^unidentified_[a-f0-9]{12}(?:_\d+)?$/.test(k)));
  assert.ok(r4Keys.some(k => /_2$/.test(k)), 'Exact-duplicate unidentified 3P records must get deterministic _2 suffix');
  const r4Json = JSON.stringify(r4Fwd);
  for (const leaked of ['SecretCircularClient', 'SecretBigIntClient', 'SecretDupClient', 'cv-circ', 'cv-bigint', 'Circular Secret Role']) {
    assert.equal(r4Json.includes(leaked), false, `Third-party token "${leaked}" must not leak into diff output`);
  }

  // ---- R5: Strict UUID parity between JS & JSON Schema (reject partial-dash & whitespace-padded) ----
  for (const badUuid of [
    '11111111-11111111-1111111111111111',
    '11111111-1111-11111111-111111111111',
    '111111111111-1111-1111-111111111111',
    ` ${uuid1}`,
    `${uuid1} `,
    ` ${uuid1} `,
    `${uuid1}\n`,
    `\t${uuid1UpperNoDash}`,
  ]) {
    assert.equal(schemaUuidRe.test(badUuid), false, `Schema must reject malformed/padded UUID "${JSON.stringify(badUuid)}"`);
    assert.equal(normalizeNotionUuid(badUuid), null, `normalizeNotionUuid must reject "${JSON.stringify(badUuid)}"`);
    const badState = {
      schema_version: '1.0',
      updated_at: null,
      records: {
        [`applications::${keyA}`]: {
          database: 'applications',
          canonical_key: keyA,
          state: 'pending_sync',
          page_id: badUuid,
        },
      },
    };
    assert.equal(validateNotionSyncState(badState).valid, false);
    assert.throws(() => normalizeSyncState(badState), /Invalid sync-state/i);
  }
  for (const goodUuid of [uuid1, uuid1.toUpperCase(), uuid1UpperNoDash, uuid1UpperNoDash.toLowerCase()]) {
    assert.equal(schemaUuidRe.test(goodUuid), true);
    assert.equal(normalizeNotionUuid(goodUuid), uuid1);
  }

  // ---- R6: Cross-key duplicate remote page_id fails closed across keys & databases ----
  assert.throws(
    () => computeNotionSyncDiff({
      applications: [appA, appB],
      allCvRegistry: cvReg,
      remoteIndex: {
        [`applications::${keyA}`]: [{ page_id: uuid1, sync_hash: null }],
        [`applications::${keyB}`]: [{ page_id: uuid1UpperNoDash, sync_hash: null }],
      },
      createdAt,
    }),
    /Duplicate remote page_id/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({
      applications: [appA, appB],
      allCvRegistry: cvReg,
      remoteIndex: {
        [`applications::${keyB}`]: [{ page_id: uuid1UpperNoDash, sync_hash: null }],
        [`applications::${keyA}`]: [{ page_id: uuid1, sync_hash: null }],
      },
      createdAt,
    }),
    /Duplicate remote page_id/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({
      applications: [appA],
      allCvRegistry: cvReg,
      remoteIndex: {
        [`applications::${keyA}`]: [{ page_id: uuid1, sync_hash: null }],
        'daily_runs::2026-11-23': [{ page_id: uuid1, sync_hash: null }],
      },
      createdAt,
    }),
    /Duplicate remote page_id/i,
  );
  // Archived entry with same page_id under another key does NOT cause false collision
  const r6ArchOk = computeNotionSyncDiff({
    applications: [appA, appB],
    allCvRegistry: cvReg,
    remoteIndex: {
      [`applications::${keyA}`]: [{ page_id: uuid1, sync_hash: hashA }],
      [`applications::${keyB}`]: [{ page_id: uuid1, sync_hash: null, archived: true }],
    },
    createdAt,
  });
  assert.equal(r6ArchOk.plan.operations.length, 2);

  // ---- R7 (H1): sync_hash vs null conflict (both orders) + archived filtered before dedupe ----
  const hashNullPair = [{ page_id: uuid1, sync_hash: hashA }, { page_id: uuid1UpperNoDash, sync_hash: null }];
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appA], allCvRegistry: cvReg, remoteIndex: { [`applications::${keyA}`]: hashNullPair }, createdAt }),
    /Conflicting sync_hash/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ applications: [appA], allCvRegistry: cvReg, remoteIndex: { [`applications::${keyA}`]: [...hashNullPair].reverse() }, createdAt }),
    /Conflicting sync_hash/i,
  );
  const h1ArchivedFiltered = computeNotionSyncDiff({
    applications: [appA],
    allCvRegistry: cvReg,
    remoteIndex: {
      [`applications::${keyA}`]: [
        { page_id: uuid1, sync_hash: 'ffffffffffffffff', archived: true },
        { page_id: uuid1, sync_hash: hashA },
      ],
    },
    createdAt,
  });
  assert.equal(h1ArchivedFiltered.plan.operations[0].action, 'skip_unchanged');

  // ---- R7 (H2): Duplicate canonical key across insights (valid + invalid in both orders) ----
  const validInsight = {
    schema_version: '2.0',
    type: 'weekly',
    period: '2026-W47',
    generated_at: createdAt,
    scanned: 5,
    applied: 5,
    avg_match_score: 8,
    intelligence: {
      deterministic_facts: {},
      sample_sufficiency: { submitted_n: 5, decided_n: 5, min_threshold: 5, sufficient: true },
      ai_interpretations: [],
      hypotheses: [],
      recommended_actions: [],
    },
  };
  const invalidInsightDup = { type: 'weekly', period: '2026-W47' };
  assert.throws(
    () => computeNotionSyncDiff({ insights: [validInsight, invalidInsightDup], createdAt }),
    /Duplicate local canonical key/i,
  );
  assert.throws(
    () => computeNotionSyncDiff({ insights: [invalidInsightDup, validInsight], createdAt }),
    /Duplicate local canonical key/i,
  );

  // ---- R7 (M1): All 10 states invalid page_id, non-conflict bad conflicting_page_ids & normalize idempotency ----
  for (const state of schema.$defs.sync_item_state.enum) {
    const entry = {
      database: 'applications',
      canonical_key: keyA,
      state,
      page_id: 'not-a-uuid',
      ...(state === 'synced' ? { last_synced_hash: hashA } : {}),
      ...(state === 'in_flight' ? { attempted_hash: hashA, attempted_at: createdAt, operation_id: '0123456789abcdef', approved_plan_hash: 'a'.repeat(64) } : {}),
      ...(state === 'conflict_duplicate_remote' ? { conflicting_page_ids: [uuid1, uuid2] } : {}),
    };
    const st = { schema_version: '1.0', updated_at: null, records: { [`applications::${keyA}`]: entry } };
    assert.equal(validateNotionSyncState(st).valid, false, `Expected invalid page_id rejection for state "${state}"`);
    assert.throws(() => normalizeSyncState(st), /Invalid sync-state/i);
  }
  const badNonConflictIds = {
    schema_version: '1.0',
    updated_at: null,
    records: {
      [`applications::${keyA}`]: {
        database: 'applications',
        canonical_key: keyA,
        state: 'pending_sync',
        conflicting_page_ids: ['not-a-uuid'],
      },
    },
  };
  assert.equal(validateNotionSyncState(badNonConflictIds).valid, false);
  assert.throws(() => normalizeSyncState(badNonConflictIds), /Invalid sync-state/i);

  const normOnce = normalizeSyncState({
    schema_version: '1.0',
    updated_at: createdAt,
    records: {
      [`applications::${keyA}`]: {
        database: 'applications',
        canonical_key: keyA,
        state: 'conflict_duplicate_remote',
        page_id: uuid1UpperNoDash,
        conflicting_page_ids: [uuid2.toUpperCase(), uuid1UpperNoDash],
      },
    },
  });
  const normTwice = normalizeSyncState(normOnce);
  assert.deepEqual(normOnce, normTwice);
  assert.equal(normOnce.records[`applications::${keyA}`].page_id, uuid1);
  assert.deepEqual(normOnce.records[`applications::${keyA}`].conflicting_page_ids, [uuid1, uuid2]);

  // ---- R7 (L1): Remote entry containing only archived/in_trash pages holds as receipt_uncertain ----
  for (const [stName, expectedReason] of [
    ['synced', 'synced_page_missing_remotely'],
    ['pending_sync', 'local_page_missing_remotely'],
  ]) {
    const syncSt = {
      schema_version: '1.0',
      updated_at: createdAt,
      records: {
        [`applications::${keyA}`]: {
          database: 'applications',
          canonical_key: keyA,
          state: stName,
          page_id: uuid1,
          ...(stName === 'synced' ? { last_synced_hash: hashA } : {}),
        },
      },
    };
    for (const deadRemote of [[{ page_id: uuid1, archived: true }], [{ page_id: uuid1, in_trash: true }]]) {
      const heldDiff = computeNotionSyncDiff({
        applications: [appA],
        allCvRegistry: cvReg,
        syncState: syncSt,
        remoteIndex: { [`applications::${keyA}`]: deadRemote },
        createdAt,
      });
      assert.equal(heldDiff.plan.operations.length, 0);
      assert.equal(heldDiff.held_items.length, 1);
      assert.equal(heldDiff.held_items[0].state, 'receipt_uncertain');
      assert.equal(heldDiff.held_items[0].reason, expectedReason);
    }
  }
});

test('14. Stage 3 (T8-B D1): Plan-bound approval enforces immutable plan_hash, live flags, causality & 24h TTL', () => {
  const cvReg = makeOwnerCvRegistry();
  const createdAt = '2026-11-23T10:00:00Z';
  const approvedAt = '2026-11-23T10:05:00Z';
  const app1 = {
    job_id: 't8b-app-1',
    title: 'Staff Engineer',
    company: 'Acme Corp',
    platform: 'greenhouse',
    status: 'applied',
    applied_at: '2026-11-20T10:00:00Z',
    cv_version_id: 'cv-base-owner-v1',
  };

  const livePreview = computeNotionSyncDiff({
    applications: [app1],
    allCvRegistry: cvReg,
    planId: 'plan-t8b-live-001',
    createdAt,
    transportEnabled: true,
    dryRun: false,
  }).plan;

  const dryRunPreview = computeNotionSyncDiff({
    applications: [app1],
    allCvRegistry: cvReg,
    planId: 'plan-t8b-dry-001',
    createdAt,
    transportEnabled: true,
    dryRun: true,
  }).plan;

  const offlinePreview = computeNotionSyncDiff({
    applications: [app1],
    allCvRegistry: cvReg,
    planId: 'plan-t8b-off-001',
    createdAt,
    transportEnabled: false,
    dryRun: false,
  }).plan;

  // Reject unconfirmed, wrong hash, dry_run, offline, predating approval, and calendar-invalid timestamps
  assert.throws(() => approveNotionSyncPlan(livePreview, { expectedPlanHash: livePreview.plan_hash, confirmedByOwner: false, approvedAt }), /confirmedByOwner/i);
  assert.throws(() => approveNotionSyncPlan(livePreview, { expectedPlanHash: '0'.repeat(64), confirmedByOwner: true, approvedAt }), /hash mismatch/i);
  assert.throws(() => approveNotionSyncPlan(dryRunPreview, { expectedPlanHash: dryRunPreview.plan_hash, confirmedByOwner: true, approvedAt }), /dry_run=true/i);
  assert.throws(() => approveNotionSyncPlan(offlinePreview, { expectedPlanHash: offlinePreview.plan_hash, confirmedByOwner: true, approvedAt }), /transport_enabled=false/i);
  assert.throws(() => approveNotionSyncPlan(livePreview, { expectedPlanHash: livePreview.plan_hash, confirmedByOwner: true, approvedAt: '2026-11-23T09:59:59Z' }), /predate/i);
  assert.throws(() => approveNotionSyncPlan(livePreview, { expectedPlanHash: livePreview.plan_hash, confirmedByOwner: true, approvedAt: '2026-02-30T10:05:00Z' }), /invalid approvedAt/i);

  // Valid approval returns deep-cloned approved_execute plan
  const approved = approveNotionSyncPlan(livePreview, {
    expectedPlanHash: livePreview.plan_hash,
    confirmedByOwner: true,
    approvedAt,
  });
  assert.equal(approved.mode, 'approved_execute');
  assert.equal(approved.plan_hash, livePreview.plan_hash);
  assert.equal(approved.approval.approved_plan_hash, livePreview.plan_hash);
  assert.equal(approved.approval.approved_plan_id, livePreview.plan_id);
  assert.equal(approved.approval.approved_by, 'owner');
  assert.equal(approved.approval.operation_count, livePreview.operations.length);

  // Mutating original preview does NOT mutate approved plan
  livePreview.operations[0].payload.Company = 'MutatedOriginal';
  assert.equal(approved.operations[0].payload.Company, 'Acme Corp');

  // Re-approving an already-approved plan fails closed
  assert.throws(() => approveNotionSyncPlan(approved, { expectedPlanHash: approved.plan_hash, confirmedByOwner: true, approvedAt }), /only "preview" plans/i);

  // TTL boundary: exact 24h passes; 24h + 1ms fails; future approval fails; invalid TTL fails
  assert.equal(DEFAULT_MAX_APPROVAL_AGE_MS, 24 * 60 * 60 * 1000);
  const exactExpiryIso = new Date(Date.parse(approvedAt) + DEFAULT_MAX_APPROVAL_AGE_MS).toISOString();
  const expiredIso = new Date(Date.parse(approvedAt) + DEFAULT_MAX_APPROVAL_AGE_MS + 1).toISOString();
  const beforeApprovalIso = new Date(Date.parse(approvedAt) - 1000).toISOString();

  assert.equal(verifyPlanApproval(approved, { nowIso: exactExpiryIso }).valid, true);
  const expRes = verifyPlanApproval(approved, { nowIso: expiredIso });
  assert.equal(expRes.valid, false);
  assert.equal(expRes.code, 'approval_expired');

  const futRes = verifyPlanApproval(approved, { nowIso: beforeApprovalIso });
  assert.equal(futRes.valid, false);
  assert.equal(futRes.code, 'approval_timestamp_in_future');

  assert.equal(verifyPlanApproval(approved, { nowIso: approvedAt, maxApprovalAgeMs: 0 }).valid, false);
  assert.equal(verifyPlanApproval(approved, { nowIso: approvedAt, maxApprovalAgeMs: -100 }).valid, false);
  assert.equal(verifyPlanApproval(approved, { nowIso: '2026-02-30T10:05:00Z' }).valid, false);

  // Post-approval drift / tampering detection across all security-relevant fields
  const tamperVariants = [
    p => { p.operations[0].payload.Company = 'TamperedCo'; },
    p => { p.operations[0].action = 'update'; },
    p => { p.dry_run = true; },
    p => { p.transport_enabled = false; },
    p => { p.plan_id = 'plan-hijacked'; },
    p => { p.blocked_items.push({ database: 'applications', canonical_key: 'unidentified_000000000000', state: 'blocked_privacy', violations: [{ field_path: 'x', code: 'secret_token', reason: 'r' }] }); },
    p => { p.skipped_ineligible.push({ canonical_key: 'x', status: 'prepared', reason: 'status_not_submitted' }); },
    p => { p.approval.operation_count = 99; },
  ];
  for (const mutate of tamperVariants) {
    const clone = JSON.parse(JSON.stringify(approved));
    mutate(clone);
    assert.equal(verifyPlanApproval(clone, { nowIso: approvedAt }).valid, false);
  }
});

test('15. Stage 3 (T8-B D3–D6): Explicit transition matrix, sync-state integrity & strict --force boundaries', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'notion-sync-plan.schema.json'), 'utf8'));
  const inFlightRule = schema.$defs.sync_state_entry.allOf.find(r => r?.if?.properties?.state?.const === 'in_flight');
  assert.ok(inFlightRule.then.required.includes('attempted_at'), 'D5 schema must require attempted_at for in_flight');

  const nowIso = '2026-11-23T12:00:00Z';
  const uuid1 = '11111111-1111-1111-1111-111111111111';
  const uuid2 = '22222222-2222-2222-2222-222222222222';
  const uuid3 = '33333333-3333-3333-3333-333333333333';
  const key1 = 'app_111111111111';
  const key2 = 'app_222222222222';
  const opCreate = { action: 'create', existing_page_id: null, sync_hash: 'aaaaaaaaaaaaaaaa' };
  const opUpdate = { action: 'update', existing_page_id: uuid1, sync_hash: 'bbbbbbbbbbbbbbbb' };
  const opSkip = { action: 'skip_unchanged', existing_page_id: uuid1, sync_hash: 'aaaaaaaaaaaaaaaa' };

  // Transition table completeness & T8-C gated edges rejected in T8-B
  assert.ok(SYNC_STATE_TRANSITIONS.in_flight.t8b_allowed.includes('receipt_uncertain'));
  assert.equal(SYNC_STATE_TRANSITIONS.in_flight.t8b_allowed.includes('synced'), false);
  for (const [fromEntry, toState] of [
    [{ state: 'in_flight', attempted_at: '2026-11-23T11:00:00Z' }, 'synced'],
    [{ state: 'in_flight', attempted_at: '2026-11-23T11:00:00Z' }, 'failed_retryable'],
    [{ state: 'in_flight', attempted_at: '2026-11-23T11:00:00Z' }, 'failed_permanent'],
    [{ state: 'in_flight', attempted_at: '2026-11-23T11:00:00Z' }, 'conflict_duplicate_remote'],
    [{ state: 'receipt_uncertain' }, 'synced'],
    [{ state: 'receipt_uncertain' }, 'pending_sync'],
    [{ state: 'conflict_duplicate_remote' }, 'synced'],
    [{ state: 'conflict_duplicate_remote' }, 'pending_sync'],
  ]) {
    const res = validateSyncStateTransition(fromEntry, toState, { op: opUpdate, nowIso, force: true });
    assert.equal(res.valid, false);
    assert.equal(res.code, 'requires_t8c_receipt_or_reconciliation');
  }

  // Forbidden edges strictly rejected even with force: true and changed sync_hash (D4)
  for (const [fromEntry, toState, expectedCode] of [
    [{ state: 'in_flight', attempted_at: nowIso }, 'in_flight', 'already_in_flight'],
    [{ state: 'failed_permanent', attempted_hash: '0000000000000000' }, 'in_flight', 'failed_permanent_held'],
    [{ state: 'receipt_uncertain' }, 'in_flight', 'requires_reconciliation'],
    [{ state: 'conflict_duplicate_remote' }, 'in_flight', 'requires_reconciliation'],
    [{ state: 'blocked_privacy' }, 'in_flight', 'blocked_or_ineligible'],
    [{ state: 'ineligible_not_submitted' }, 'in_flight', 'blocked_or_ineligible'],
    [{ state: 'previewed' }, 'synced', 'transition_not_allowed'],
  ]) {
    const res = validateSyncStateTransition(fromEntry, toState, { op: opCreate, nowIso, force: true });
    assert.equal(res.valid, false);
    assert.equal(res.code, expectedCode);
  }

  // skip_unchanged and non-boolean force fail closed
  assert.equal(validateSyncStateTransition(null, 'in_flight', { op: opSkip, nowIso }).code, 'non_mutating_or_missing_operation');
  assert.equal(validateSyncStateTransition(null, 'in_flight', { op: opCreate, nowIso, force: 'yes' }).code, 'invalid_force_flag');

  // D4: failed_retryable cooldown & retry cap enforced normally, bypassed ONLY by force: true
  const retryCooldownEntry = {
    database: 'applications',
    canonical_key: key1,
    state: 'failed_retryable',
    page_id: null,
    retry_count: 1,
    next_retry_after: '2026-11-23T12:05:00Z',
  };
  assert.equal(validateSyncStateTransition(retryCooldownEntry, 'in_flight', { op: opCreate, nowIso, force: false }).code, 'retry_cooldown_active');
  assert.equal(validateSyncStateTransition(retryCooldownEntry, 'in_flight', { op: opCreate, nowIso, force: true }).valid, true);
  assert.equal(validateSyncStateTransition(retryCooldownEntry, 'in_flight', { op: opCreate, nowIso: '2026-11-23T12:05:00Z', force: false }).valid, true);

  const retryCappedEntry = {
    database: 'applications',
    canonical_key: key1,
    state: 'failed_retryable',
    page_id: null,
    retry_count: DEFAULT_MAX_RETRIES,
    next_retry_after: null,
  };
  assert.equal(validateSyncStateTransition(retryCappedEntry, 'in_flight', { op: opCreate, nowIso, force: false }).code, 'retry_cap_reached');
  assert.equal(validateSyncStateTransition(retryCappedEntry, 'in_flight', { op: opCreate, nowIso, force: true }).valid, true);

  // D6: verifySyncStateIntegrity catches cross-key page_id, conflict overlap, active op_id dup, future skew & secret last_error
  const dupPageState = {
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'synced', page_id: uuid1, last_synced_hash: 'aaaaaaaaaaaaaaaa' },
      [`applications::${key2}`]: { database: 'applications', canonical_key: key2, state: 'pending_sync', page_id: uuid1.toUpperCase() },
    },
  };
  assert.equal(verifySyncStateIntegrity(dupPageState).valid, false);
  assert.throws(() => normalizeSyncState(dupPageState), /duplicate page_id/i);

  const conflictOverlapState = {
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'synced', page_id: uuid1, last_synced_hash: 'aaaaaaaaaaaaaaaa' },
      [`applications::${key2}`]: { database: 'applications', canonical_key: key2, state: 'conflict_duplicate_remote', conflicting_page_ids: [uuid1, uuid2] },
    },
  };
  assert.equal(verifySyncStateIntegrity(conflictOverlapState).valid, false);

  const dupActiveOpState = {
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'in_flight', page_id: null, attempted_hash: 'aaaaaaaaaaaaaaaa', attempted_at: nowIso, operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64) },
      [`applications::${key2}`]: { database: 'applications', canonical_key: key2, state: 'in_flight', page_id: null, attempted_hash: 'bbbbbbbbbbbbbbbb', attempted_at: nowIso, operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64) },
    },
  };
  assert.equal(verifySyncStateIntegrity(dupActiveOpState).valid, false);

  const futureInFlightState = {
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'in_flight', page_id: null, attempted_hash: 'aaaaaaaaaaaaaaaa', attempted_at: '2026-11-23T12:30:00Z', operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64) },
    },
  };
  assert.equal(verifySyncStateIntegrity(futureInFlightState, { nowIso }).valid, false);

  const secretErrorState = {
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'failed_retryable', last_error: `failed with ${['ntn', 'SECRETTOKEN123456'].join('_')}` },
    },
  };
  assert.equal(verifySyncStateIntegrity(secretErrorState).valid, false);
  assert.throws(() => normalizeSyncState(secretErrorState), /disallowed secret/i);
  assert.equal(verifySyncStateIntegrity({
    schema_version: '1.0',
    updated_at: nowIso,
    records: {
      [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'synced', page_id: uuid3, last_synced_hash: 'aaaaaaaaaaaaaaaa' },
    },
  }, { nowIso }).valid, true);
});

test('16. Stage 3 (T8-B D2): Exclusive single-writer lock fails closed on contention & requires explicit verified dead-PID stale recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8b-lock-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    const cvReg = makeOwnerCvRegistry();
    const createdAt = '2026-11-23T10:00:00Z';
    const approvedAt = '2026-11-23T10:01:00Z';
    const nowIso = '2026-11-23T10:30:00Z';
    const app1 = { job_id: 't8b-lock-1', title: 'Eng', company: 'LockCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const preview = computeNotionSyncDiff({ applications: [app1], allCvRegistry: cvReg, planId: 'plan-lock', createdAt, transportEnabled: true, dryRun: false }).plan;
    const approved = approveNotionSyncPlan(preview, { expectedPlanHash: preview.plan_hash, confirmedByOwner: true, approvedAt });
    const opId = approved.operations[0].operation_id;

    // Empty workspace reports unlocked
    const emptyLock = inspectSyncStateLock(work, { home, nowIso });
    assert.equal(emptyLock.locked, false);

    // Pre-existing stale lock owned by CURRENT live PID: contention must fail closed & NEVER steal/modify the lock
    const lockPath = path.join(work, 'logs', '.sync-state.lock');
    const liveLockContent = JSON.stringify({ pid: process.pid, acquired_at: '2026-11-23T09:00:00Z', nonce: 'live-nonce-1111' }, null, 2) + '\n';
    fs.writeFileSync(lockPath, liveLockContent);
    const liveLockShaBefore = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');

    assert.throws(
      () => reserveOperationInFlight(work, { approvedPlan: approved, operationId: opId, nowIso, home }),
      /sync_state_locked/i,
    );
    assert.throws(
      () => expireStaleInFlightRecords(work, { nowIso, home }),
      /sync_state_locked/i,
    );
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex'), liveLockShaBefore);

    // Inspect sees stale=true & owner_alive=true; explicit stale release MUST refuse live PID
    const liveInfo = inspectSyncStateLock(work, { home, nowIso });
    assert.equal(liveInfo.locked, true);
    assert.equal(liveInfo.stale, true);
    assert.equal(liveInfo.owner_alive, true);
    assert.throws(
      () => releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: 'live-nonce-1111', confirmedExplicitRecovery: true }),
      /still active/i,
    );

    // Corrupt lockfile MUST NOT be auto-removed
    fs.writeFileSync(lockPath, '{bad-json');
    assert.equal(inspectSyncStateLock(work, { home, nowIso }).corrupt, true);
    assert.throws(
      () => releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: 'any', confirmedExplicitRecovery: true }),
      /corrupt lockfile/i,
    );

    // Dead PID stale lock: spawn a tiny process that immediately exits to get a real dead PID cross-platform
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const deadPid = child.pid;
    assert.ok(Number.isSafeInteger(deadPid) && deadPid > 0 && deadPid !== process.pid);

    const deadLockNonce = 'dead-nonce-2222';
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquired_at: '2026-11-23T10:25:00Z', nonce: deadLockNonce }));
    // Not yet stale (only 5m old < 15m default) -> refuse release!
    assert.throws(
      () => releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: deadLockNonce, confirmedExplicitRecovery: true }),
      /below staleLockAgeMs/i,
    );

    // Make it stale (30m old >= 15m): still refuses without confirmation or with wrong nonce
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquired_at: '2026-11-23T10:00:00Z', nonce: deadLockNonce }));
    assert.equal(DEFAULT_STALE_LOCK_AGE_MS, 15 * 60 * 1000);
    assert.throws(
      () => releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: deadLockNonce, confirmedExplicitRecovery: false }),
      /confirmedExplicitRecovery/i,
    );
    assert.throws(
      () => releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: 'wrong-nonce', confirmedExplicitRecovery: true }),
      /nonce mismatch/i,
    );

    // Explicit confirmed recovery with matching nonce + stale age + dead PID succeeds cleanly
    const released = releaseStaleSyncStateLock(work, { home, nowIso, expectedNonce: deadLockNonce, confirmedExplicitRecovery: true });
    assert.equal(released.released, true);
    assert.equal(released.released_pid, deadPid);
    assert.equal(fs.existsSync(lockPath), false);

    // Symlinked logs/ parent refuses lock acquisition
    const outside = path.join(dir, 'outside');
    const symWork = path.join(dir, 'sym-work');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(symWork, { recursive: true });
    let linkOk = false;
    try {
      fs.symlinkSync(outside, path.join(symWork, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
      linkOk = true;
    } catch { /* ignore if OS disallows symlinks */ }
    if (linkOk) {
      assert.throws(() => reserveOperationInFlight(symWork, { approvedPlan: approved, operationId: opId, nowIso, home }), /symbolic-link/i);
      assert.throws(() => inspectSyncStateLock(symWork, { home, nowIso }), /symbolic-link/i);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('17. Stage 3 (T8-B): Atomic in_flight reservation enforces plan-vs-state drift, duplicate prevention, --force rules & ledger immutability', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8b-reserve-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([{ job_id: 't8b-res-1', status: 'applied' }], null, 2) + '\n');
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');

    const cvReg = makeOwnerCvRegistry();
    const createdAt = '2026-11-23T10:00:00Z';
    const approvedAt = '2026-11-23T10:02:00Z';
    const nowIso = '2026-11-23T10:05:00Z';
    const uuid1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const uuid2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const appCreate = { job_id: 't8b-res-1', title: 'Backend Eng', company: 'CreateCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const appUpdate = { job_id: 't8b-res-2', title: 'Staff Eng', company: 'UpdateCo', platform: 'lever', status: 'offer', applied_at: '2026-11-18T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const appSame = { job_id: 't8b-res-3', title: 'SRE', company: 'SameCo', platform: 'ashby', status: 'applied', applied_at: '2026-11-15T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const keyCreate = computeApplicationId(appCreate.job_id);
    const keyUpdate = computeApplicationId(appUpdate.job_id);
    const keySame = computeApplicationId(appSame.job_id);
    const hashSame = projectApplicationForNotion(appSame, { allCvRegistry: cvReg })['Sync Hash'];

    // Seed initial sync-state with synced appUpdate (old hash) and synced appSame (unchanged hash)
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: createdAt,
      records: {
        [`applications::${keyUpdate}`]: { database: 'applications', canonical_key: keyUpdate, state: 'synced', page_id: uuid1, last_synced_hash: '0000000000000000', last_synced_at: '2026-11-19T10:00:00Z', retry_count: 0 },
        [`applications::${keySame}`]: { database: 'applications', canonical_key: keySame, state: 'synced', page_id: uuid2, last_synced_hash: hashSame, last_synced_at: '2026-11-19T10:00:00Z', retry_count: 0 },
      },
    }, { home, nowIso: createdAt });

    const diff = computeNotionSyncDiff({
      applications: [appCreate, appUpdate, appSame],
      allCvRegistry: cvReg,
      syncState: loadSyncState(work, { home }).state,
      planId: 'plan-t8b-res-1',
      createdAt,
      transportEnabled: true,
      dryRun: false,
    });
    const approved = approveNotionSyncPlan(diff.plan, { expectedPlanHash: diff.plan.plan_hash, confirmedByOwner: true, approvedAt });
    const opCreate = approved.operations.find(o => o.canonical_key === keyCreate);
    const opUpdate = approved.operations.find(o => o.canonical_key === keyUpdate);
    const opSkip = approved.operations.find(o => o.canonical_key === keySame);
    assert.equal(opCreate.action, 'create');
    assert.equal(opUpdate.action, 'update');
    assert.equal(opSkip.action, 'skip_unchanged');

    // skip_unchanged and unknown operationId fail closed
    assert.throws(() => reserveOperationInFlight(work, { approvedPlan: approved, operationId: opSkip.operation_id, nowIso, home }), /skip_unchanged/i);
    assert.throws(() => reserveOperationInFlight(work, { approvedPlan: approved, operationId: 'ffffffffffffffff', nowIso, home }), /does not exist/i);

    // Reserve create & update atomically
    const rCreate = reserveOperationInFlight(work, { approvedPlan: approved, operationId: opCreate.operation_id, nowIso, home });
    assert.equal(rCreate.reserved, true);
    assert.equal(rCreate.previous_state, null);
    assert.equal(rCreate.existing_page_id, null);
    assert.equal(rCreate.state.records[`applications::${keyCreate}`].state, 'in_flight');
    assert.equal(rCreate.state.records[`applications::${keyCreate}`].attempted_at, nowIso);
    assert.equal(rCreate.state.records[`applications::${keyCreate}`].approved_plan_hash, approved.plan_hash);

    const rUpdate = reserveOperationInFlight(work, { approvedPlan: approved, operationId: opUpdate.operation_id, nowIso, home });
    assert.equal(rUpdate.reserved, true);
    assert.equal(rUpdate.previous_state, 'synced');
    assert.equal(rUpdate.existing_page_id, uuid1);
    assert.equal(rUpdate.state.records[`applications::${keyUpdate}`].page_id, uuid1);
    assert.equal(rUpdate.state.records[`applications::${keyUpdate}`].last_synced_hash, '0000000000000000');

    // Zero leftover lock or temp files after reservation
    assert.equal(fs.existsSync(path.join(work, 'logs', '.sync-state.lock')), false);
    assert.equal(fs.readdirSync(path.join(work, 'logs')).filter(f => f.includes('.tmp-')).length, 0);

    // Re-reserving same operation_id (simulated crash-restart) MUST fail closed even with force: true!
    assert.throws(() => reserveOperationInFlight(work, { approvedPlan: approved, operationId: opCreate.operation_id, nowIso, force: true, home }), /already_in_flight/i);

    // Drift checks: create when sync-state now has a page_id -> rejected; update when page_id mismatches -> rejected; update when synced hash already matches -> rejected
    const workDrift = path.join(dir, 'work-drift');
    fs.mkdirSync(path.join(workDrift, 'logs'), { recursive: true });
    saveSyncState(workDrift, {
      schema_version: '1.0',
      updated_at: createdAt,
      records: {
        [`applications::${keyCreate}`]: { database: 'applications', canonical_key: keyCreate, state: 'pending_sync', page_id: uuid2 },
        [`applications::${keyUpdate}`]: { database: 'applications', canonical_key: keyUpdate, state: 'synced', page_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', last_synced_hash: '0000000000000000' },
      },
    }, { home, nowIso: createdAt });
    assert.throws(() => reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opCreate.operation_id, nowIso, home }), /create_target_already_has_page_id/i);
    assert.throws(() => reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opUpdate.operation_id, nowIso, home }), /update_page_id_mismatch/i);

    // Update against already-synced matching hash fails closed
    saveSyncState(workDrift, {
      schema_version: '1.0',
      updated_at: createdAt,
      records: {
        [`applications::${keyUpdate}`]: { database: 'applications', canonical_key: keyUpdate, state: 'synced', page_id: uuid1, last_synced_hash: opUpdate.sync_hash },
      },
    }, { home, nowIso: createdAt });
    assert.throws(() => reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opUpdate.operation_id, nowIso, home }), /already_synced_unchanged/i);

    // failed_retryable capped item blocked normally, allowed with force: true; failed_permanent blocked even with force: true & changed hash
    saveSyncState(workDrift, {
      schema_version: '1.0',
      updated_at: createdAt,
      records: {
        [`applications::${keyCreate}`]: { database: 'applications', canonical_key: keyCreate, state: 'failed_retryable', page_id: null, retry_count: 3, next_retry_after: '2026-11-23T12:00:00Z', last_error: 'rate_limited' },
        [`applications::${keyUpdate}`]: { database: 'applications', canonical_key: keyUpdate, state: 'failed_permanent', page_id: uuid1, attempted_hash: '1111111111111111', last_error: 'schema_mismatch' },
      },
    }, { home, nowIso: createdAt });
    assert.throws(() => reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opCreate.operation_id, nowIso, force: false, home }), /retry_cap_reached/i);
    const forced = reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opCreate.operation_id, nowIso, force: true, home });
    assert.equal(forced.reserved, true);
    assert.equal(forced.force_applied, true);
    assert.equal(forced.state.records[`applications::${keyCreate}`].retry_count, 3);
    assert.throws(() => reserveOperationInFlight(workDrift, { approvedPlan: approved, operationId: opUpdate.operation_id, nowIso, force: true, home }), /failed_permanent_held/i);

    // Ledger remains byte-for-byte untouched
    const ledgerShaAfter = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');
    assert.equal(ledgerShaAfter, ledgerShaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('18. Stage 3 (T8-B D5): Stale in_flight expires ONLY to receipt_uncertain & recovery inspection is strictly read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8b-recover-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    assert.equal(DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS, 15 * 60 * 1000);
    const nowIso = '2026-11-23T12:00:00Z';

    // Empty workspace: expireStaleInFlightRecords does NOT create logs/sync-state.json
    const emptyExp = expireStaleInFlightRecords(work, { nowIso, home });
    assert.equal(emptyExp.expired_count, 0);
    assert.equal(fs.existsSync(path.join(work, 'logs', 'sync-state.json')), false);

    // Populate all recovery classifications
    const seed = {
      schema_version: '1.0',
      updated_at: '2026-11-23T11:55:00Z',
      records: {
        'applications::app_000000000001': {
          database: 'applications', canonical_key: 'app_000000000001', state: 'in_flight', page_id: null,
          attempted_hash: '1111111111111111', attempted_at: '2026-11-23T11:44:59Z', // 15m 1s old -> STALE
          operation_id: '1111111111111111', approved_plan_hash: 'a'.repeat(64), retry_count: 1,
        },
        'applications::app_000000000002': {
          database: 'applications', canonical_key: 'app_000000000002', state: 'in_flight', page_id: null,
          attempted_hash: '2222222222222222', attempted_at: '2026-11-23T11:55:00Z', // 5m old -> ACTIVE
          operation_id: '2222222222222222', approved_plan_hash: 'a'.repeat(64), retry_count: 0,
        },
        'applications::app_000000000003': {
          database: 'applications', canonical_key: 'app_000000000003', state: 'receipt_uncertain', page_id: null,
          attempted_hash: '3333333333333333', operation_id: '3333333333333333',
        },
        'applications::app_000000000004': {
          database: 'applications', canonical_key: 'app_000000000004', state: 'conflict_duplicate_remote', page_id: null,
          conflicting_page_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
        },
        'applications::app_000000000005': {
          database: 'applications', canonical_key: 'app_000000000005', state: 'failed_retryable', page_id: null,
          retry_count: 1, next_retry_after: '2026-11-23T11:59:00Z',
        },
        'applications::app_000000000006': {
          database: 'applications', canonical_key: 'app_000000000006', state: 'failed_retryable', page_id: null,
          retry_count: 1, next_retry_after: '2026-11-23T12:10:00Z',
        },
        'applications::app_000000000007': {
          database: 'applications', canonical_key: 'app_000000000007', state: 'failed_retryable', page_id: null,
          retry_count: 3, next_retry_after: null,
        },
        'applications::app_000000000008': {
          database: 'applications', canonical_key: 'app_000000000008', state: 'failed_permanent', page_id: null,
          last_error: 'schema_mismatch',
        },
        'applications::app_000000000009': {
          database: 'applications', canonical_key: 'app_000000000009', state: 'synced',
          page_id: '33333333-3333-3333-3333-333333333333', last_synced_hash: '9999999999999999',
        },
      },
    };
    saveSyncState(work, seed, { home, nowIso: '2026-11-23T11:55:00Z' });

    // Read-only recovery inspection classifies all 9 buckets without mutating input
    const loadedBefore = loadSyncState(work, { home }).state;
    const snapBefore = JSON.stringify(loadedBefore);
    const inspection = inspectSyncStateRecovery(loadedBefore, { nowIso });
    assert.equal(JSON.stringify(loadedBefore), snapBefore);
    assert.equal(inspection.total_records, 9);
    assert.equal(inspection.requires_attention, true);
    assert.deepEqual(inspection.counts, {
      stale_in_flight: 1,
      active_in_flight: 1,
      receipt_uncertain: 1,
      conflict_duplicate_remote: 1,
      failed_retryable_ready: 1,
      failed_retryable_cooldown: 1,
      failed_retryable_cap_reached: 1,
      failed_permanent: 1,
      healthy_or_pending: 1,
    });
    // Only failed_retryable_* buckets are force_eligible
    for (const item of inspection.items) {
      assert.equal(item.force_eligible, item.state === 'failed_retryable');
    }

    // Expire stale in_flight: ONLY app_000000000001 transitions -> receipt_uncertain, preserving audit metadata
    const exp = expireStaleInFlightRecords(work, { nowIso, home });
    assert.equal(exp.expired_count, 1);
    assert.deepEqual(exp.expired_keys, ['applications::app_000000000001']);
    const expiredRec = exp.state.records['applications::app_000000000001'];
    assert.equal(expiredRec.state, 'receipt_uncertain');
    assert.equal(expiredRec.last_error, 'stale_in_flight_timeout');
    assert.equal(expiredRec.operation_id, '1111111111111111');
    assert.equal(expiredRec.approved_plan_hash, 'a'.repeat(64));
    assert.equal(expiredRec.attempted_hash, '1111111111111111');
    assert.equal(expiredRec.attempted_at, '2026-11-23T11:44:59Z');
    assert.equal(expiredRec.retry_count, 1);
    // Fresh in_flight remains untouched
    assert.equal(exp.state.records['applications::app_000000000002'].state, 'in_flight');

    // Second run with no stale records is a clean no-op
    const exp2 = expireStaleInFlightRecords(work, { nowIso, home });
    assert.equal(exp2.expired_count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('19. Stage 3 (T8-C Safety Resolution 1): Structured receipt verification promotes valid read-back to synced & fails closed to receipt_uncertain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8c-receipt-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    const cvReg = makeOwnerCvRegistry();
    const createdAt = '2026-11-23T10:00:00Z';
    const approvedAt = '2026-11-23T10:01:00Z';
    const reserveAt = '2026-11-23T10:02:00Z';
    const verifyAt = '2026-11-23T10:02:15Z';
    const dbUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const pageUuid1 = '11111111-1111-1111-1111-111111111111';
    const pageUuid1Upper = '11111111111111111111111111111111';
    const pageUuid2 = '22222222-2222-2222-2222-222222222222';

    const app1 = { job_id: 't8c-rec-1', title: 'Staff Eng', company: 'ReceiptCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app2 = { job_id: 't8c-rec-2', title: 'Lead Eng', company: 'OtherCo', platform: 'lever', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const key1 = computeApplicationId(app1.job_id);
    const key2 = computeApplicationId(app2.job_id);

    const preview = computeNotionSyncDiff({ applications: [app1, app2], allCvRegistry: cvReg, planId: 'plan-t8c-rec', createdAt, transportEnabled: true, dryRun: false }).plan;
    const approved = approveNotionSyncPlan(preview, { expectedPlanHash: preview.plan_hash, confirmedByOwner: true, approvedAt });
    const op1 = approved.operations.find(o => o.canonical_key === key1);
    const op2 = approved.operations.find(o => o.canonical_key === key2);

    reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: reserveAt, home });

    const validReceipt = {
      operation_id: op1.operation_id,
      approved_plan_hash: approved.plan_hash,
      database: 'applications',
      canonical_key: key1,
      sync_hash: op1.sync_hash,
      page_id: pageUuid1Upper,
      database_id: dbUuid,
      verified_at: verifyAt,
      readback_properties: {
        'Application ID': key1,
        'Sync Hash': op1.sync_hash,
      },
    };

    // Pure verifier check + trust limitation note
    const inFlightBefore = loadSyncState(work, { home }).state.records[`applications::${key1}`];
    const pureCheck = verifySyncReceiptEvidence(inFlightBefore, validReceipt, { expectedDatabaseId: dbUuid, nowIso: verifyAt });
    assert.equal(pureCheck.valid, true);
    assert.equal(pureCheck.verified_page_id, pageUuid1);
    assert.match(pureCheck.trust_note, /not independent cryptographic proof/i);

    // Wrong caller operationId or approvedPlanHash throws fail-closed without mutating disk
    assert.throws(
      () => applySyncReceipt(work, { database: 'applications', canonicalKey: key1, operationId: 'ffffffffffffffff', approvedPlanHash: approved.plan_hash, receipt: validReceipt, expectedDatabaseId: dbUuid, nowIso: verifyAt, home }),
      /does not match active in_flight operation_id/i,
    );
    assert.throws(
      () => applySyncReceipt(work, { database: 'applications', canonicalKey: key1, operationId: op1.operation_id, approvedPlanHash: '0'.repeat(64), receipt: validReceipt, expectedDatabaseId: dbUuid, nowIso: verifyAt, home }),
      /approvedPlanHash does not match/i,
    );
    assert.equal(loadSyncState(work, { home }).state.records[`applications::${key1}`].state, 'in_flight');

    // Valid receipt promotes in_flight -> synced with canonical lowercase UUID & cleared attempt fields
    const ok = applySyncReceipt(work, {
      database: 'applications',
      canonicalKey: key1,
      operationId: op1.operation_id,
      approvedPlanHash: approved.plan_hash,
      receipt: validReceipt,
      expectedDatabaseId: dbUuid,
      nowIso: verifyAt,
      home,
    });
    assert.equal(ok.applied, true);
    assert.equal(ok.state, 'synced');
    assert.equal(ok.page_id, pageUuid1);
    assert.equal(ok.last_synced_hash, op1.sync_hash);
    assert.equal(ok.last_synced_at, verifyAt);
    const syncedRec = loadSyncState(work, { home }).state.records[`applications::${key1}`];
    assert.equal(syncedRec.state, 'synced');
    assert.equal(syncedRec.operation_id, null);
    assert.equal(syncedRec.approved_plan_hash, null);
    assert.equal(syncedRec.attempted_hash, null);
    assert.equal(syncedRec.attempted_at, null);
    assert.equal(syncedRec.retry_count, 0);

    // Applying receipt to already-synced record throws fail-closed
    assert.throws(
      () => applySyncReceipt(work, { database: 'applications', canonicalKey: key1, operationId: op1.operation_id, approvedPlanHash: approved.plan_hash, receipt: validReceipt, expectedDatabaseId: dbUuid, nowIso: verifyAt, home }),
      /is not in_flight/i,
    );

    // Every bad/incomplete receipt variant routes in_flight -> receipt_uncertain (NEVER synced!)
    const badReceiptMutations = [
      ['missing_readback', r => { delete r.readback_properties; }, 'missing_readback_properties'],
      ['bad_readback_key', r => { r.readback_properties['Application ID'] = 'app_000000000000'; }, 'readback_canonical_key_mismatch'],
      ['bad_readback_hash', r => { r.readback_properties['Sync Hash'] = '0000000000000000'; }, 'readback_sync_hash_mismatch'],
      ['wrong_db_id', r => { r.database_id = pageUuid2; }, 'receipt_database_id_mismatch'],
      ['predating_verified_at', r => { r.verified_at = '2026-11-23T10:01:59Z'; }, 'receipt_predates_attempt'],
      ['future_verified_at', r => { r.verified_at = '2026-11-23T10:20:00Z'; }, 'receipt_verified_at_in_future'],
      ['archived_page', r => { r.archived = true; }, 'receipt_page_archived_or_trashed'],
      ['cross_key_page_collision', r => { r.page_id = pageUuid1; }, 'receipt_page_id_cross_key_collision'],
    ];

    for (const [label, mutate, expectedCode] of badReceiptMutations) {
      const subWork = path.join(dir, `sub-${label}`);
      fs.mkdirSync(path.join(subWork, 'logs'), { recursive: true });
      // Seed key1 as synced owning pageUuid1 so cross-key collision is active
      saveSyncState(subWork, {
        schema_version: '1.0',
        updated_at: createdAt,
        records: {
          [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'synced', page_id: pageUuid1, last_synced_hash: op1.sync_hash, last_synced_at: verifyAt, retry_count: 0 },
        },
      }, { home, nowIso: createdAt });
      reserveOperationInFlight(subWork, { approvedPlan: approved, operationId: op2.operation_id, nowIso: reserveAt, home });

      const rec = {
        operation_id: op2.operation_id,
        approved_plan_hash: approved.plan_hash,
        database: 'applications',
        canonical_key: key2,
        sync_hash: op2.sync_hash,
        page_id: pageUuid2,
        database_id: dbUuid,
        verified_at: verifyAt,
        readback_properties: { 'Application ID': key2, 'Sync Hash': op2.sync_hash },
      };
      mutate(rec);
      const res = applySyncReceipt(subWork, {
        database: 'applications',
        canonicalKey: key2,
        operationId: op2.operation_id,
        approvedPlanHash: approved.plan_hash,
        receipt: rec,
        expectedDatabaseId: dbUuid,
        nowIso: verifyAt,
        home,
      });
      assert.equal(res.applied, false, `Expected applied=false for ${label}`);
      assert.equal(res.state, 'receipt_uncertain', `Expected receipt_uncertain for ${label}`);
      assert.equal(res.code, expectedCode, `Expected code ${expectedCode} for ${label}`);
      assert.equal(loadSyncState(subWork, { home }).state.records[`applications::${key2}`].state, 'receipt_uncertain');
    }

    // Update receipt with mismatched page_id fails closed -> receipt_uncertain
    const app1Updated = { ...app1, status: 'interview', updated_at: '2026-11-22T10:00:00Z' };
    const updPreview = computeNotionSyncDiff({
      applications: [app1Updated],
      allCvRegistry: cvReg,
      syncState: loadSyncState(work, { home }).state,
      planId: 'plan-t8c-upd',
      createdAt: '2026-11-23T11:00:00Z',
      transportEnabled: true,
      dryRun: false,
    }).plan;
    const updApproved = approveNotionSyncPlan(updPreview, { expectedPlanHash: updPreview.plan_hash, confirmedByOwner: true, approvedAt: '2026-11-23T11:01:00Z' });
    const updOp = updApproved.operations[0];
    assert.equal(updOp.action, 'update');
    reserveOperationInFlight(work, { approvedPlan: updApproved, operationId: updOp.operation_id, nowIso: '2026-11-23T11:02:00Z', home });
    const badUpdRes = applySyncReceipt(work, {
      database: 'applications',
      canonicalKey: key1,
      operationId: updOp.operation_id,
      approvedPlanHash: updApproved.plan_hash,
      receipt: {
        operation_id: updOp.operation_id,
        approved_plan_hash: updApproved.plan_hash,
        database: 'applications',
        canonical_key: key1,
        sync_hash: updOp.sync_hash,
        page_id: pageUuid2, // contradicts reserved pageUuid1!
        database_id: dbUuid,
        verified_at: '2026-11-23T11:02:10Z',
        readback_properties: { 'Application ID': key1, 'Sync Hash': updOp.sync_hash },
      },
      expectedDatabaseId: dbUuid,
      nowIso: '2026-11-23T11:02:10Z',
      home,
    });
    assert.equal(badUpdRes.applied, false);
    assert.equal(badUpdRes.state, 'receipt_uncertain');
    assert.equal(badUpdRes.code, 'receipt_page_id_mismatch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('20. Stage 3 (T8-C): Deterministic failure classification, capped exponential backoff, D4 retry cap & error sanitization', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8c-fail-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    assert.equal(DEFAULT_BASE_BACKOFF_SECONDS, 60);
    assert.equal(DEFAULT_MAX_BACKOFF_SECONDS, 3600);
    assert.ok(RETRYABLE_FAILURE_CODES.includes('rate_limited'));
    assert.ok(PERMANENT_FAILURE_CODES.includes('schema_mismatch'));
    assert.ok(AMBIGUOUS_FAILURE_CODES.includes('timeout'));

    const cvReg = makeOwnerCvRegistry();
    const createdAt = '2026-11-23T10:00:00Z';
    const approvedAt = '2026-11-23T10:01:00Z';
    const app1 = { job_id: 't8c-fail-1', title: 'Backend Eng', company: 'FailCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app2 = { job_id: 't8c-fail-2', title: 'Staff Eng', company: 'AmbCo', platform: 'lever', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app3 = { job_id: 't8c-fail-3', title: 'SRE', company: 'PermCo', platform: 'ashby', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const key1 = computeApplicationId(app1.job_id);
    const key2 = computeApplicationId(app2.job_id);
    const key3 = computeApplicationId(app3.job_id);

    const preview = computeNotionSyncDiff({ applications: [app1, app2, app3], allCvRegistry: cvReg, planId: 'plan-t8c-fail', createdAt, transportEnabled: true, dryRun: false }).plan;
    const approved = approveNotionSyncPlan(preview, { expectedPlanHash: preview.plan_hash, confirmedByOwner: true, approvedAt });
    const op1 = approved.operations.find(o => o.canonical_key === key1);
    const op2 = approved.operations.find(o => o.canonical_key === key2);
    const op3 = approved.operations.find(o => o.canonical_key === key3);

    // 1. Ambiguous / timeout OR mutationNotApplied: false ALWAYS routes to receipt_uncertain (never failed_retryable!)
    reserveOperationInFlight(work, { approvedPlan: approved, operationId: op2.operation_id, nowIso: '2026-11-23T10:02:00Z', home });
    const synthSecretToken = ['ntn', 'SECRETTOKEN123456'].join('_');
    const ambRes = recordSyncFailure(work, {
      database: 'applications',
      canonicalKey: key2,
      operationId: op2.operation_id,
      approvedPlanHash: approved.plan_hash,
      errorCode: 'rate_limited',
      errorMessage: `leaked ${synthSecretToken} at C:\\Users\\dev\\secret.env`,
      mutationNotApplied: false, // ambiguous!
      nowIso: '2026-11-23T10:02:10Z',
      home,
    });
    assert.equal(ambRes.state, 'receipt_uncertain');
    assert.equal(ambRes.classification, 'ambiguous_uncertain');
    assert.equal(ambRes.last_error.includes(synthSecretToken), false);
    assert.equal(ambRes.last_error.includes('C:\\Users'), false);

    // 2. Confirmed non-applied retryable error: exponential backoff 60s -> 120s -> 240s, capped at 180s here; stays failed_retryable at cap!
    let t = Date.parse('2026-11-23T10:05:00Z');
    const expectedDelays = [60, 120, 180];
    for (let attempt = 0; attempt < 3; attempt++) {
      const resIso = new Date(t).toISOString();
      reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: resIso, force: false, home });
      const failIso = new Date(t + 1000).toISOString();
      const f = recordSyncFailure(work, {
        database: 'applications',
        canonicalKey: key1,
        operationId: op1.operation_id,
        approvedPlanHash: approved.plan_hash,
        errorCode: 'rate_limited',
        errorMessage: 'HTTP 429 retry later alice@example.com', // email triggers full scrub to safe code
        mutationNotApplied: true,
        nowIso: failIso,
        baseBackoffSeconds: 60,
        maxBackoffSeconds: 180,
        home,
      });
      assert.equal(f.state, 'failed_retryable');
      assert.equal(f.retry_count, attempt + 1);
      assert.equal(f.next_retry_after, new Date(Date.parse(failIso) + expectedDelays[attempt] * 1000).toISOString());
      assert.equal(f.last_error, 'rate_limited'); // email scrubbed cleanly!
      // Cooldown enforced immediately after failure
      if (attempt < 2) {
        assert.throws(
          () => reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: new Date(Date.parse(failIso) + 5000).toISOString(), force: false, home }),
          /retry_cooldown_active/i,
        );
      }
      t = Date.parse(f.next_retry_after);
    }
    // After 3 retries: stays in failed_retryable, normal retry blocked by retry_cap_reached, explicit force: true allowed!
    assert.throws(
      () => reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: new Date(t + 1000).toISOString(), force: false, home }),
      /retry_cap_reached/i,
    );
    const forced = reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: new Date(t + 1000).toISOString(), force: true, home });
    assert.equal(forced.reserved, true);
    assert.equal(forced.force_applied, true);

    // 3. Confirmed non-applied permanent error routes to failed_permanent (held even with force: true!)
    reserveOperationInFlight(work, { approvedPlan: approved, operationId: op3.operation_id, nowIso: '2026-11-23T10:12:00Z', home });
    const permRes = recordSyncFailure(work, {
      database: 'applications',
      canonicalKey: key3,
      operationId: op3.operation_id,
      approvedPlanHash: approved.plan_hash,
      errorCode: 'schema_mismatch',
      errorMessage: 'Property Status type mismatch',
      mutationNotApplied: true,
      nowIso: '2026-11-23T10:12:10Z',
      home,
    });
    assert.equal(permRes.state, 'failed_permanent');
    assert.equal(permRes.classification, 'permanent');
    assert.equal(permRes.next_retry_after, null);
    assert.equal(permRes.last_error, 'schema_mismatch: Property Status type mismatch');
    assert.throws(
      () => reserveOperationInFlight(work, { approvedPlan: approved, operationId: op3.operation_id, nowIso: '2026-11-23T10:13:00Z', force: true, home }),
      /failed_permanent_held/i,
    );

    // Non-boolean mutationNotApplied fails closed
    assert.throws(
      () => recordSyncFailure(work, { database: 'applications', canonicalKey: key1, operationId: op1.operation_id, approvedPlanHash: approved.plan_hash, errorCode: 'rate_limited', mutationNotApplied: 'yes', nowIso: '2026-11-23T10:20:00Z', home }),
      /explicit boolean/i,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('21. Stage 3 (T8-C Safety Resolution 2): Complete query-snapshot validation & safe reconciliation across 0, 1, >=2 pages and cross-key collisions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8c-reconcile-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    const dbUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const uuid1 = '11111111-1111-1111-1111-111111111111';
    const uuid2 = '22222222-2222-2222-2222-222222222222';
    const uuid3 = '33333333-3333-3333-3333-333333333333';
    const key1 = 'app_111111111111';
    const key2 = 'app_222222222222';
    const attemptAt = '2026-11-23T11:00:00Z';
    const queryAt = '2026-11-23T11:05:00Z';

    const makeCompleteSnap = (overrides = {}) => ({
      database: 'applications',
      database_id: dbUuid,
      filter_property: 'Application ID',
      filter_value: key1,
      query_succeeded: true,
      pagination_complete: true,
      has_more: false,
      next_cursor: null,
      timed_out: false,
      errors: [],
      queried_at: queryAt,
      pages: [],
      ...overrides,
    });

    // All 6 Safety Resolution 2 completeness checks fail closed on incomplete/errored snapshots
    const badSnaps = [
      ['wrong_db_id', { database_id: uuid3 }, 'snapshot_database_id_mismatch'],
      ['wrong_filter_prop', { filter_property: 'Title' }, 'snapshot_filter_property_mismatch'],
      ['wrong_filter_val', { filter_value: key2 }, 'snapshot_filter_value_mismatch'],
      ['query_failed', { query_succeeded: false }, 'snapshot_query_failed'],
      ['pagination_incomplete', { pagination_complete: false }, 'snapshot_pagination_incomplete'],
      ['has_more_true', { has_more: true }, 'snapshot_pagination_incomplete'],
      ['next_cursor_set', { next_cursor: 'cursor-123' }, 'snapshot_pagination_incomplete'],
      ['timed_out', { timed_out: true }, 'snapshot_timed_out'],
      ['query_errors', { errors: ['partial_failure'] }, 'snapshot_has_errors'],
      ['predates_attempt', { queried_at: '2026-11-23T10:59:59Z' }, 'snapshot_predates_attempt'],
      ['page_key_mismatch', { pages: [{ page_id: uuid1, canonical_key: key2, sync_hash: null }] }, 'snapshot_page_canonical_key_mismatch'],
      ['conflicting_page_hash', { pages: [{ page_id: uuid1, sync_hash: 'aaaaaaaaaaaaaaaa' }, { page_id: uuid1, sync_hash: 'bbbbbbbbbbbbbbbb' }] }, 'snapshot_conflicting_page_hash'],
    ];

    for (const [label, overrides, expectedCode] of badSnaps) {
      const check = validateReconcileQuerySnapshot(makeCompleteSnap(overrides), {
        expectedDatabase: 'applications',
        expectedCanonicalKey: key1,
        expectedDatabaseId: dbUuid,
        minQueriedAt: attemptAt,
        nowIso: queryAt,
      });
      assert.equal(check.valid, false, `Expected invalid snapshot for ${label}`);
      assert.equal(check.code, expectedCode, `Expected ${expectedCode} for ${label}`);
    }

    // Incomplete snapshot on in_flight transitions -> receipt_uncertain; on receipt_uncertain stays held (never pending_sync!)
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: attemptAt,
      records: {
        [`applications::${key1}`]: {
          database: 'applications', canonical_key: key1, state: 'in_flight', page_id: null,
          attempted_hash: 'aaaaaaaaaaaaaaaa', attempted_at: attemptAt, operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64),
        },
        [`applications::${key2}`]: {
          database: 'applications', canonical_key: key2, state: 'synced', page_id: uuid3, last_synced_hash: '9999999999999999',
        },
      },
    }, { home, nowIso: attemptAt });

    const heldIncomplete = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ has_more: true }),
      nowIso: queryAt,
      home,
    });
    assert.equal(heldIncomplete.reconciled, false);
    assert.equal(heldIncomplete.state, 'receipt_uncertain');
    assert.equal(heldIncomplete.resolution, 'held_incomplete_query');

    // Cross-key page_id collision (snapshot returns uuid3 owned by key2) fails closed
    const heldCollision = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ pages: [{ page_id: uuid3, sync_hash: 'aaaaaaaaaaaaaaaa' }] }),
      nowIso: queryAt,
      home,
    });
    assert.equal(heldCollision.reconciled, false);
    assert.equal(heldCollision.state, 'receipt_uncertain');
    assert.equal(heldCollision.resolution, 'held_cross_key_page_collision');

    // Case >= 2 active pages (ignoring archived page!) -> conflict_duplicate_remote
    const dupRes = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({
        pages: [
          { page_id: uuid2, sync_hash: 'aaaaaaaaaaaaaaaa' },
          { page_id: uuid1, sync_hash: 'aaaaaaaaaaaaaaaa' },
          { page_id: uuid3, sync_hash: 'aaaaaaaaaaaaaaaa', archived: true },
        ],
      }),
      nowIso: queryAt,
      home,
    });
    assert.equal(dupRes.reconciled, true);
    assert.equal(dupRes.state, 'conflict_duplicate_remote');
    assert.deepEqual(dupRes.conflicting_page_ids, [uuid1, uuid2]);

    // Case === 1 active page with matching attempted_hash resolves conflict_duplicate_remote -> synced!
    const syncedRes = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({
        pages: [
          { page_id: uuid1, sync_hash: 'aaaaaaaaaaaaaaaa' },
          { page_id: uuid2, sync_hash: 'aaaaaaaaaaaaaaaa', in_trash: true },
        ],
      }),
      nowIso: queryAt,
      home,
    });
    assert.equal(syncedRes.reconciled, true);
    assert.equal(syncedRes.state, 'synced');
    assert.equal(syncedRes.resolution, 'verified_synced');
    assert.equal(syncedRes.page_id, uuid1);

    // Case === 1 active page with older/different hash binds page_id -> pending_sync (safe update, never duplicate create!)
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: attemptAt,
      records: {
        [`applications::${key1}`]: {
          database: 'applications', canonical_key: key1, state: 'receipt_uncertain', page_id: null,
          attempted_hash: 'bbbbbbbbbbbbbbbb', attempted_at: attemptAt, operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64),
        },
      },
    }, { home, nowIso: attemptAt });
    const rebound = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ pages: [{ page_id: uuid1, sync_hash: 'aaaaaaaaaaaaaaaa' }] }),
      nowIso: queryAt,
      home,
    });
    assert.equal(rebound.reconciled, true);
    assert.equal(rebound.state, 'pending_sync');
    assert.equal(rebound.resolution, 'rebound_pending_update');
    assert.equal(rebound.page_id, uuid1);
    assert.equal(rebound.sync_state.records[`applications::${key1}`].last_synced_hash, 'aaaaaaaaaaaaaaaa');

    // Case === 0 active pages on uncertain CREATE (page_id: null) with complete snapshot -> pending_sync
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: attemptAt,
      records: {
        [`applications::${key1}`]: {
          database: 'applications', canonical_key: key1, state: 'receipt_uncertain', page_id: null,
          attempted_hash: 'bbbbbbbbbbbbbbbb', attempted_at: attemptAt,
        },
      },
    }, { home, nowIso: attemptAt });
    const zeroCreate = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ pages: [{ page_id: uuid1, archived: true }] }),
      nowIso: queryAt,
      home,
    });
    assert.equal(zeroCreate.reconciled, true);
    assert.equal(zeroCreate.state, 'pending_sync');
    assert.equal(zeroCreate.resolution, 'confirmed_absent_pending_create');
    assert.equal(zeroCreate.page_id, null);

    // Case === 0 active pages when record previously had a non-null page_id: holds until confirmRemotePageDeleted: true!
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: attemptAt,
      records: {
        [`applications::${key1}`]: {
          database: 'applications', canonical_key: key1, state: 'receipt_uncertain', page_id: uuid1,
          last_synced_hash: 'aaaaaaaaaaaaaaaa', attempted_hash: 'bbbbbbbbbbbbbbbb', attempted_at: attemptAt,
        },
      },
    }, { home, nowIso: attemptAt });
    const heldDeleted = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ pages: [] }),
      confirmRemotePageDeleted: false,
      nowIso: queryAt,
      home,
    });
    assert.equal(heldDeleted.reconciled, false);
    assert.equal(heldDeleted.state, 'receipt_uncertain');
    assert.equal(heldDeleted.resolution, 'held_deleted_page_confirmation_required');

    const confirmedDeleted = reconcileSyncRecord(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedDatabaseId: dbUuid,
      querySnapshot: makeCompleteSnap({ pages: [] }),
      confirmRemotePageDeleted: true,
      nowIso: queryAt,
      home,
    });
    assert.equal(confirmedDeleted.reconciled, true);
    assert.equal(confirmedDeleted.state, 'pending_sync');
    assert.equal(confirmedDeleted.resolution, 'confirmed_remote_deleted_pending_create');
    assert.equal(confirmedDeleted.page_id, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('22. Stage 3 (T8-C D4): Explicit owner-confirmed failed_permanent reset & full lifecycle ledger immutability', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t8c-reset-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([{ job_id: 't8c-e2e-1', status: 'applied' }], null, 2) + '\n');
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');

    const cvReg = makeOwnerCvRegistry();
    const dbUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const pageUuid = '55555555-5555-5555-5555-555555555555';
    const app1 = { job_id: 't8c-e2e-1', title: 'Principal Eng', company: 'ResetCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const key1 = computeApplicationId(app1.job_id);

    const preview = computeNotionSyncDiff({ applications: [app1], allCvRegistry: cvReg, planId: 'plan-t8c-e2e', createdAt: '2026-11-23T10:00:00Z', transportEnabled: true, dryRun: false }).plan;
    const approved = approveNotionSyncPlan(preview, { expectedPlanHash: preview.plan_hash, confirmedByOwner: true, approvedAt: '2026-11-23T10:01:00Z' });
    const op1 = approved.operations[0];

    // 1. Reserve -> permanent failure
    reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: '2026-11-23T10:02:00Z', home });
    recordSyncFailure(work, {
      database: 'applications',
      canonicalKey: key1,
      operationId: op1.operation_id,
      approvedPlanHash: approved.plan_hash,
      errorCode: 'schema_mismatch',
      mutationNotApplied: true,
      nowIso: '2026-11-23T10:02:10Z',
      home,
    });

    // 2. Reset rejects unconfirmed, wrong expectedLastError, secret resetReason, and non-permanent state
    assert.throws(
      () => resetPermanentFailure(work, { database: 'applications', canonicalKey: key1, expectedLastError: 'schema_mismatch', resetReason: 'Fixed Notion column', confirmedByOwner: false, nowIso: '2026-11-23T10:05:00Z', home }),
      /confirmedByOwner/i,
    );
    assert.throws(
      () => resetPermanentFailure(work, { database: 'applications', canonicalKey: key1, expectedLastError: 'wrong_error', resetReason: 'Fixed Notion column', confirmedByOwner: true, nowIso: '2026-11-23T10:05:00Z', home }),
      /does not match current last_error/i,
    );
    assert.throws(
      () => resetPermanentFailure(work, { database: 'applications', canonicalKey: key1, expectedLastError: 'schema_mismatch', resetReason: `Fixed using ${['ntn', 'SECRET1234567890'].join('_')}`, confirmedByOwner: true, nowIso: '2026-11-23T10:05:00Z', home }),
      /safe resetReason/i,
    );

    // 3. Explicit confirmed reset succeeds -> pending_sync
    const resetRes = resetPermanentFailure(work, {
      database: 'applications',
      canonicalKey: key1,
      expectedLastError: 'schema_mismatch',
      resetReason: 'Fixed Status property type in Notion database',
      confirmedByOwner: true,
      nowIso: '2026-11-23T10:05:00Z',
      home,
    });
    assert.equal(resetRes.reset, true);
    assert.equal(resetRes.state, 'pending_sync');
    assert.equal(resetRes.previous_error, 'schema_mismatch');

    // Resetting a non-failed_permanent record fails closed
    assert.throws(
      () => resetPermanentFailure(work, { database: 'applications', canonicalKey: key1, expectedLastError: null, resetReason: 'Retry', confirmedByOwner: true, nowIso: '2026-11-23T10:05:10Z', home }),
      /is not in failed_permanent/i,
    );

    // 4. Re-reserve & apply valid receipt -> synced
    reserveOperationInFlight(work, { approvedPlan: approved, operationId: op1.operation_id, nowIso: '2026-11-23T10:06:00Z', home });
    const applied = applySyncReceipt(work, {
      database: 'applications',
      canonicalKey: key1,
      operationId: op1.operation_id,
      approvedPlanHash: approved.plan_hash,
      receipt: {
        operation_id: op1.operation_id,
        approved_plan_hash: approved.plan_hash,
        database: 'applications',
        canonical_key: key1,
        sync_hash: op1.sync_hash,
        page_id: pageUuid,
        database_id: dbUuid,
        verified_at: '2026-11-23T10:06:15Z',
        readback_properties: { 'Application ID': key1, 'Sync Hash': op1.sync_hash },
      },
      expectedDatabaseId: dbUuid,
      nowIso: '2026-11-23T10:06:15Z',
      home,
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.state, 'synced');
    assert.equal(applied.page_id, pageUuid);

    // Zero leftover locks/tmp files and byte-identical applications-log.json
    assert.equal(fs.existsSync(path.join(work, 'logs', '.sync-state.lock')), false);
    assert.equal(fs.readdirSync(path.join(work, 'logs')).filter(f => f.includes('.tmp-')).length, 0);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'), ledgerShaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runVeycraftCli(args, { cwd, home }) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'cli.mjs'), ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, VEYCRAFT_HOME: path.join(home, '.veycraft'), NO_COLOR: '1' },
    encoding: 'utf8',
  });
}

test('23. Stage 3 (T9): CLI career sync offline commands, verify-schema, career dashboard, summary sync-state precedence & strict flag scoping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t9-cli-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(work, 'config'), { recursive: true });
  // Mark local workspace so CLI resolves ROOT = work
  fs.writeFileSync(path.join(work, '.veycraft-install.json'), JSON.stringify({ product: 'veycraft', version: '2.0.1' }));
  // Default safe guardrails: dry_run: true, notion_mcp: false
  fs.writeFileSync(path.join(work, 'config', 'guardrails.yaml'), 'dry_run: true\nstorage_adapters:\n  local_json: true\n  notion_mcp: false\n');

  try {
    const cvReg = makeOwnerCvRegistry();
    fs.writeFileSync(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(cvReg, null, 2));
    const app1 = { job_id: 't9-sum-1', title: 'Staff Eng', company: 'SumCo1', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app2 = { job_id: 't9-sum-2', title: 'Lead Eng', company: 'SumCo2', platform: 'lever', status: 'interview', applied_at: '2026-11-18T10:00:00Z', cv_version_id: 'cv-base-owner-v1', notion_sync: { state: 'synced' } };
    fs.writeFileSync(path.join(work, 'logs', 'applications-log.json'), JSON.stringify([app1, app2], null, 2));
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(work, 'logs', 'applications-log.json'))).digest('hex');

    // Help surface exposes career dashboard & career sync
    const helpRes = runVeycraftCli(['--help'], { cwd: work, home });
    assert.equal(helpRes.status, 0);
    assert.match(helpRes.stdout, /career dashboard/);
    assert.match(helpRes.stdout, /career sync/);

    const syncHelp = runVeycraftCli(['career', 'sync', '--help'], { cwd: work, home });
    assert.equal(syncHelp.status, 0);
    assert.match(syncHelp.stdout, /mark-in-flight/);
    assert.match(syncHelp.stdout, /reconcile/);

    // Offline status & preview work even when notion_mcp: false and dry_run: true
    const stRes = runVeycraftCli(['career', 'sync', 'status', '--json'], { cwd: work, home });
    assert.equal(stRes.status, 0, stRes.stderr);
    const stJson = JSON.parse(stRes.stdout);
    assert.equal(stJson.sync_state_exists, false);
    assert.equal(stJson.guardrails.notion_mcp_enabled, false);
    assert.equal(stJson.guardrails.dry_run, true);

    const prevRes = runVeycraftCli(['career', 'sync', 'preview', '--out', 'logs/insights/offline-plan.json', '--json'], { cwd: work, home });
    assert.equal(prevRes.status, 0, prevRes.stderr);
    const prevJson = JSON.parse(prevRes.stdout);
    assert.equal(prevJson.plan.dry_run, true);
    assert.equal(prevJson.plan.transport_enabled, false);
    assert.equal(prevJson.summary.create, 2);

    // `veycraft verify` validates generated Notion sync plan cleanly
    const verPlan = runVeycraftCli(['verify', path.join(work, 'logs', 'insights', 'offline-plan.json')], { cwd: work, home });
    assert.equal(verPlan.status, 0, verPlan.stdout + verPlan.stderr);

    // --live fails closed when guardrails has notion_mcp: false or dry_run: true
    const liveBlocked = runVeycraftCli(['career', 'sync', 'preview', '--live', '--json'], { cwd: work, home });
    assert.notEqual(liveBlocked.status, 0);
    assert.match(liveBlocked.stderr, /notion_mcp: false/i);

    // Path traversal --out outside workspace fails closed
    const escapeOut = runVeycraftCli(['career', 'sync', 'preview', '--out', '../escaped-plan.json'], { cwd: work, home });
    assert.notEqual(escapeOut.status, 0);
    assert.match(escapeOut.stderr, /outside workspace root/i);

    // verify-schema passes on valid schema and exits 1 on drifted schema
    const validSchemaPath = path.join(work, 'logs', 'schema-ok.json');
    fs.writeFileSync(validSchemaPath, JSON.stringify({ properties: NOTION_DATABASE_SCHEMAS.applications }));
    const vsOk = runVeycraftCli(['career', 'sync', 'verify-schema', '--database', 'applications', '--file', validSchemaPath, '--json'], { cwd: work, home });
    assert.equal(vsOk.status, 0, vsOk.stderr);
    assert.equal(JSON.parse(vsOk.stdout).valid, true);

    const badSchemaPath = path.join(work, 'logs', 'schema-bad.json');
    fs.writeFileSync(badSchemaPath, JSON.stringify({ properties: { Title: 'rich_text' } }));
    const vsBad = runVeycraftCli(['career', 'sync', 'verify-schema', '--database', 'applications', '--file', badSchemaPath, '--json'], { cwd: work, home });
    assert.equal(vsBad.status, 1);
    assert.equal(JSON.parse(vsBad.stdout).valid, false);

    // Stage 3 Decision A: career summary uses legacy fallback when sync-state.json absent, then sync-state.json first when present
    const sumLegacy = runVeycraftCli(['career', 'summary', '--json'], { cwd: work, home });
    assert.equal(sumLegacy.status, 0, sumLegacy.stderr);
    const sumLegacyJson = JSON.parse(sumLegacy.stdout);
    assert.equal(sumLegacyJson.sync_state_source, 'legacy_fallback');
    assert.equal(sumLegacyJson.pending_notion_sync_count, 1); // app1 pending, app2 legacy synced

    const key1 = computeApplicationId(app1.job_id);
    const key2 = computeApplicationId(app2.job_id);
    saveSyncState(work, {
      schema_version: '1.0',
      updated_at: '2026-11-23T12:00:00Z',
      records: {
        [`applications::${key1}`]: { database: 'applications', canonical_key: key1, state: 'synced', page_id: '11111111-1111-1111-1111-111111111111', last_synced_hash: 'aaaaaaaaaaaaaaaa' },
        [`applications::${key2}`]: { database: 'applications', canonical_key: key2, state: 'in_flight', page_id: null, attempted_hash: 'bbbbbbbbbbbbbbbb', attempted_at: '2026-11-23T12:00:00Z', operation_id: '1234567890abcdef', approved_plan_hash: 'a'.repeat(64) },
      },
    }, { home, nowIso: '2026-11-23T12:00:00Z' });
    const sumAuth = runVeycraftCli(['career', 'summary', '--json'], { cwd: work, home });
    assert.equal(sumAuth.status, 0, sumAuth.stderr);
    const sumAuthJson = JSON.parse(sumAuth.stdout);
    assert.equal(sumAuthJson.sync_state_source, 'sync_state');
    assert.equal(sumAuthJson.pending_notion_sync_count, 1); // app1 synced via sync-state, app2 in_flight overrides legacy!

    // `veycraft verify` validates sync-state.json
    const verState = runVeycraftCli(['verify', path.join(work, 'logs', 'sync-state.json')], { cwd: work, home });
    assert.equal(verState.status, 0, verState.stdout + verState.stderr);

    // `veycraft career dashboard --no-open` generates read-only local dashboard
    const dashRes = runVeycraftCli(['career', 'dashboard', '--no-open'], { cwd: work, home });
    assert.equal(dashRes.status, 0, dashRes.stderr);
    assert.equal(fs.existsSync(path.join(work, 'logs', 'exports', 'dashboard.html')), true);

    // Invalid subcommands & misplaced flags fail closed
    for (const bad of [
      ['career', 'sync', 'unknown-cmd'],
      ['career', 'sync', 'status', '--live'],
      ['career', 'sync', 'preview', '--bogus'],
      ['career', 'sync', 'mark-in-flight'],
    ]) {
      const r = runVeycraftCli(bad, { cwd: work, home });
      assert.notEqual(r.status, 0, `Expected failure for: ${bad.join(' ')}`);
    }

    // Ledger remains byte-for-byte unchanged
    const ledgerShaAfter = crypto.createHash('sha256').update(fs.readFileSync(path.join(work, 'logs', 'applications-log.json'))).digest('hex');
    assert.equal(ledgerShaAfter, ledgerShaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('24. Stage 3 (T9): End-to-end local CLI sync lifecycle (preview --live -> approve -> mark-in-flight -> failure -> reset -> receipt -> reconcile)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t9-e2e-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(work, 'config'), { recursive: true });
  fs.writeFileSync(path.join(work, '.veycraft-install.json'), JSON.stringify({ product: 'veycraft', version: '2.0.1' }));
  fs.writeFileSync(path.join(work, 'config', 'guardrails.yaml'), 'dry_run: false\nstorage_adapters:\n  local_json: true\n  notion_mcp: true\n');

  try {
    const cvReg = makeOwnerCvRegistry();
    fs.writeFileSync(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(cvReg, null, 2));
    const app1 = { job_id: 't9-e2e-1', title: 'Principal Eng', company: 'LifecycleCo', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app2 = { job_id: 't9-e2e-2', title: 'Staff Eng', company: 'ReconcileCo', platform: 'lever', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const key1 = computeApplicationId(app1.job_id);
    const key2 = computeApplicationId(app2.job_id);
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([app1, app2], null, 2));
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');

    const dbUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const page1 = '11111111-1111-1111-1111-111111111111';
    const page2 = '22222222-2222-2222-2222-222222222222';

    // 1. Live-eligible preview
    const prev = runVeycraftCli(['career', 'sync', 'preview', '--live', '--out', 'logs/insights/live-preview.json', '--json'], { cwd: work, home });
    assert.equal(prev.status, 0, prev.stderr);
    const previewPlan = JSON.parse(prev.stdout).plan;
    assert.equal(previewPlan.dry_run, false);
    assert.equal(previewPlan.transport_enabled, true);
    const op1 = previewPlan.operations.find(o => o.canonical_key === key1);
    const op2 = previewPlan.operations.find(o => o.canonical_key === key2);

    // 2. Approve requires --confirm-approve & exact --plan-hash
    const unconfirmed = runVeycraftCli(['career', 'sync', 'approve', '--file', 'logs/insights/live-preview.json', '--plan-hash', previewPlan.plan_hash], { cwd: work, home });
    assert.notEqual(unconfirmed.status, 0);
    const approvedRes = runVeycraftCli([
      'career', 'sync', 'approve',
      '--file', 'logs/insights/live-preview.json',
      '--plan-hash', previewPlan.plan_hash,
      '--confirm-approve',
      '--out', 'logs/insights/live-approved.json',
      '--json',
    ], { cwd: work, home });
    assert.equal(approvedRes.status, 0, approvedRes.stderr);
    const approvedPlan = JSON.parse(approvedRes.stdout).plan;
    assert.equal(approvedPlan.mode, 'approved_execute');

    // 3. mark-in-flight reserves op1; second call refuses duplicate reservation
    const mif1 = runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/live-approved.json', '--op', op1.operation_id, '--json'], { cwd: work, home });
    assert.equal(mif1.status, 0, mif1.stderr);
    assert.equal(JSON.parse(mif1.stdout).reserved, true);

    const mifDup = runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/live-approved.json', '--op', op1.operation_id, '--force', '--json'], { cwd: work, home });
    assert.notEqual(mifDup.status, 0);
    assert.match(mifDup.stderr, /already_in_flight/i);

    // 4. record-failure (permanent) -> reset-permanent (requires --confirm-reset)
    const failPerm = runVeycraftCli([
      'career', 'sync', 'record-failure',
      '--database', 'applications', '--key', key1, '--op', op1.operation_id, '--plan-hash', approvedPlan.plan_hash,
      '--error-code', 'schema_mismatch', '--mutation-not-applied', '--json',
    ], { cwd: work, home });
    assert.equal(failPerm.status, 0, failPerm.stderr);
    assert.equal(JSON.parse(failPerm.stdout).state, 'failed_permanent');

    const resetBlocked = runVeycraftCli([
      'career', 'sync', 'reset-permanent',
      '--database', 'applications', '--key', key1, '--expected-error', 'schema_mismatch', '--reason', 'Fixed column',
    ], { cwd: work, home });
    assert.notEqual(resetBlocked.status, 0);

    const resetOk = runVeycraftCli([
      'career', 'sync', 'reset-permanent',
      '--database', 'applications', '--key', key1, '--expected-error', 'schema_mismatch', '--reason', 'Fixed column',
      '--confirm-reset', '--json',
    ], { cwd: work, home });
    assert.equal(resetOk.status, 0, resetOk.stderr);
    assert.equal(JSON.parse(resetOk.stdout).state, 'pending_sync');

    // 5. Re-reserve op1 & apply valid receipt -> synced
    const mif1Retry = runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/live-approved.json', '--op', op1.operation_id, '--json'], { cwd: work, home });
    assert.equal(mif1Retry.status, 0, mif1Retry.stderr);
    const verifiedAt = new Date(Date.now() + 1000).toISOString();
    const receiptPath = path.join(work, 'logs', 'receipt-op1.json');
    fs.writeFileSync(receiptPath, JSON.stringify({
      operation_id: op1.operation_id,
      approved_plan_hash: approvedPlan.plan_hash,
      database: 'applications',
      canonical_key: key1,
      sync_hash: op1.sync_hash,
      page_id: page1,
      database_id: dbUuid,
      verified_at: verifiedAt,
      readback_properties: { 'Application ID': key1, 'Sync Hash': op1.sync_hash },
    }));
    const recRes = runVeycraftCli([
      'career', 'sync', 'apply-receipt',
      '--database', 'applications', '--key', key1, '--op', op1.operation_id, '--plan-hash', approvedPlan.plan_hash,
      '--database-id', dbUuid, '--file', receiptPath, '--json',
    ], { cwd: work, home });
    assert.equal(recRes.status, 0, recRes.stderr);
    assert.equal(JSON.parse(recRes.stdout).state, 'synced');

    // 6. Reserve op2 -> ambiguous failure -> reconcile incomplete (exit 1, held) -> reconcile complete (exit 0, synced)
    const mif2 = runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/live-approved.json', '--op', op2.operation_id, '--json'], { cwd: work, home });
    assert.equal(mif2.status, 0, mif2.stderr);
    const ambFail = runVeycraftCli([
      'career', 'sync', 'record-failure',
      '--database', 'applications', '--key', key2, '--op', op2.operation_id, '--plan-hash', approvedPlan.plan_hash,
      '--error-code', 'timeout', '--json',
    ], { cwd: work, home });
    assert.equal(ambFail.status, 0, ambFail.stderr);
    assert.equal(JSON.parse(ambFail.stdout).state, 'receipt_uncertain');

    const queriedAt = new Date(Date.now() + 2000).toISOString();
    const incSnapPath = path.join(work, 'logs', 'snap-incomplete.json');
    fs.writeFileSync(incSnapPath, JSON.stringify({
      database: 'applications', database_id: dbUuid, filter_property: 'Application ID', filter_value: key2,
      query_succeeded: true, pagination_complete: false, has_more: true, next_cursor: 'c1', timed_out: false, errors: [], queried_at: queriedAt, pages: [],
    }));
    const recInc = runVeycraftCli([
      'career', 'sync', 'reconcile',
      '--database', 'applications', '--key', key2, '--database-id', dbUuid, '--file', incSnapPath, '--json',
    ], { cwd: work, home });
    assert.equal(recInc.status, 1);
    assert.equal(JSON.parse(recInc.stdout).state, 'receipt_uncertain');

    const okSnapPath = path.join(work, 'logs', 'snap-complete.json');
    fs.writeFileSync(okSnapPath, JSON.stringify({
      database: 'applications', database_id: dbUuid, filter_property: 'Application ID', filter_value: key2,
      query_succeeded: true, pagination_complete: true, has_more: false, next_cursor: null, timed_out: false, errors: [], queried_at: queriedAt,
      pages: [{ page_id: page2, sync_hash: op2.sync_hash }],
    }));
    const recOk = runVeycraftCli([
      'career', 'sync', 'reconcile',
      '--database', 'applications', '--key', key2, '--database-id', dbUuid, '--file', okSnapPath, '--json',
    ], { cwd: work, home });
    assert.equal(recOk.status, 0, recOk.stderr);
    assert.equal(JSON.parse(recOk.stdout).state, 'synced');

    // 7. expire-stale runs cleanly with 0 stale records & ledger stays byte-identical
    const expRes = runVeycraftCli(['career', 'sync', 'expire-stale', '--json'], { cwd: work, home });
    assert.equal(expRes.status, 0, expRes.stderr);
    assert.equal(JSON.parse(expRes.stdout).expired_count, 0);

    assert.equal(fs.existsSync(path.join(work, 'logs', '.sync-state.lock')), false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'), ledgerShaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('25. Stage 3 (T9 Blocker Remediation): Live guardrails kill-switch blocks approve & mark-in-flight while preserving offline/recovery commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t9-killswitch-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(work, 'config'), { recursive: true });
  fs.writeFileSync(path.join(work, '.veycraft-install.json'), JSON.stringify({ product: 'veycraft', version: '2.0.1' }));

  const guardPath = path.join(work, 'config', 'guardrails.yaml');
  const setGuardrails = yaml => fs.writeFileSync(guardPath, yaml);

  try {
    const cvReg = makeOwnerCvRegistry();
    fs.writeFileSync(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(cvReg, null, 2));
    const app1 = { job_id: 't9-ks-1', title: 'Staff Eng', company: 'KillCo1', platform: 'greenhouse', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app2 = { job_id: 't9-ks-2', title: 'Lead Eng', company: 'KillCo2', platform: 'lever', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const app3 = { job_id: 't9-ks-3', title: 'SRE', company: 'KillCo3', platform: 'ashby', status: 'applied', applied_at: '2026-11-20T10:00:00Z', cv_version_id: 'cv-base-owner-v1' };
    const key1 = computeApplicationId(app1.job_id);
    const key2 = computeApplicationId(app2.job_id);
    const key3 = computeApplicationId(app3.job_id);
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(ledgerPath, JSON.stringify([app1, app2, app3], null, 2));
    const ledgerShaBefore = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');

    // Step 1: Temporarily enable live guardrails to produce a real saved live preview & approved plan
    setGuardrails('dry_run: false\nstorage_adapters:\n  local_json: true\n  notion_mcp: true\n');
    const prev = runVeycraftCli(['career', 'sync', 'preview', '--live', '--out', 'logs/insights/ks-preview.json', '--json'], { cwd: work, home });
    assert.equal(prev.status, 0, prev.stderr);
    const previewPlan = JSON.parse(prev.stdout).plan;
    const op1 = previewPlan.operations.find(o => o.canonical_key === key1);
    const op2 = previewPlan.operations.find(o => o.canonical_key === key2);
    const op3 = previewPlan.operations.find(o => o.canonical_key === key3);

    const appOk = runVeycraftCli([
      'career', 'sync', 'approve',
      '--file', 'logs/insights/ks-preview.json',
      '--plan-hash', previewPlan.plan_hash,
      '--confirm-approve',
      '--out', 'logs/insights/ks-approved.json',
      '--json',
    ], { cwd: work, home });
    assert.equal(appOk.status, 0, appOk.stderr);

    // Reserve op2 & op3 while live is enabled so we can verify recovery commands still work AFTER kill-switch is engaged
    assert.equal(runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/ks-approved.json', '--op', op2.operation_id, '--json'], { cwd: work, home }).status, 0);
    assert.equal(runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/ks-approved.json', '--op', op3.operation_id, '--json'], { cwd: work, home }).status, 0);

    const syncStatePath = path.join(work, 'logs', 'sync-state.json');
    const syncStateShaBefore = crypto.createHash('sha256').update(fs.readFileSync(syncStatePath)).digest('hex');

    // Step 2: Test ALL kill-switch / invalid guardrails configurations deny approve & mark-in-flight with zero side effects
    const blockedConfigs = [
      ['dry_run_true', 'dry_run: true\nstorage_adapters:\n  notion_mcp: true\n', /dry_run: true/i],
      ['notion_mcp_false', 'dry_run: false\nstorage_adapters:\n  notion_mcp: false\n', /notion_mcp: false/i],
      ['both_disabled', 'dry_run: true\nstorage_adapters:\n  notion_mcp: false\n', /notion_mcp: false/i],
      ['malformed_dry_run', 'dry_run: maybe\nstorage_adapters:\n  notion_mcp: true\n', /malformed|invalid/i],
      ['missing_notion_mcp', 'dry_run: false\nstorage_adapters:\n  local_json: true\n', /notion_mcp: false/i],
      ['empty_file', '', /empty|invalid/i],
    ];

    for (const [label, yaml, errRe] of blockedConfigs) {
      setGuardrails(yaml);
      const deniedOutRel = `logs/insights/denied-${label}.json`;
      const deniedOutAbs = path.join(work, deniedOutRel);

      const appDenied = runVeycraftCli([
        'career', 'sync', 'approve',
        '--file', 'logs/insights/ks-preview.json',
        '--plan-hash', previewPlan.plan_hash,
        '--confirm-approve',
        '--out', deniedOutRel,
        '--json',
      ], { cwd: work, home });
      assert.notEqual(appDenied.status, 0, `approve must fail when ${label}`);
      assert.match(appDenied.stderr, errRe, `approve stderr mismatch for ${label}: ${appDenied.stderr}`);
      assert.equal(fs.existsSync(deniedOutAbs), false, `approve must not write --out artifact when ${label}`);

      const mifDenied = runVeycraftCli([
        'career', 'sync', 'mark-in-flight',
        '--file', 'logs/insights/ks-approved.json',
        '--op', op1.operation_id,
        '--json',
      ], { cwd: work, home });
      assert.notEqual(mifDenied.status, 0, `mark-in-flight must fail when ${label}`);
      assert.match(mifDenied.stderr, errRe, `mark-in-flight stderr mismatch for ${label}: ${mifDenied.stderr}`);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(syncStatePath)).digest('hex'), syncStateShaBefore, `sync-state.json must be unchanged after denied mark-in-flight (${label})`);
      assert.equal(fs.existsSync(path.join(work, 'logs', '.sync-state.lock')), false);
    }

    // Missing workspace guardrails.yaml falls back to repo safe defaults (dry_run: true, notion_mcp: false) -> denied!
    fs.unlinkSync(guardPath);
    assert.notEqual(runVeycraftCli(['career', 'sync', 'approve', '--file', 'logs/insights/ks-preview.json', '--plan-hash', previewPlan.plan_hash, '--confirm-approve', '--out', 'logs/insights/denied-missing.json'], { cwd: work, home }).status, 0);
    assert.equal(fs.existsSync(path.join(work, 'logs', 'insights', 'denied-missing.json')), false);
    assert.notEqual(runVeycraftCli(['career', 'sync', 'mark-in-flight', '--file', 'logs/insights/ks-approved.json', '--op', op1.operation_id], { cwd: work, home }).status, 0);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(syncStatePath)).digest('hex'), syncStateShaBefore);

    // Step 3: With kill-switch ACTIVE (dry_run: true, notion_mcp: false), ALL 9 offline & recovery commands remain usable!
    setGuardrails('dry_run: true\nstorage_adapters:\n  local_json: true\n  notion_mcp: false\n');
    const dbUuid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const page2 = '22222222-2222-2222-2222-222222222222';
    const page3 = '33333333-3333-3333-3333-333333333333';

    // 1. offline preview
    assert.equal(runVeycraftCli(['career', 'sync', 'preview', '--json'], { cwd: work, home }).status, 0);
    // 2. status
    assert.equal(runVeycraftCli(['career', 'sync', 'status', '--json'], { cwd: work, home }).status, 0);
    // 3. verify-schema
    const schemaPath = path.join(work, 'logs', 'ks-schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify({ properties: NOTION_DATABASE_SCHEMAS.applications }));
    assert.equal(runVeycraftCli(['career', 'sync', 'verify-schema', '--database', 'applications', '--file', schemaPath, '--json'], { cwd: work, home }).status, 0);
    // 4. apply-receipt (for already in-flight op2)
    const receiptPath = path.join(work, 'logs', 'ks-receipt2.json');
    fs.writeFileSync(receiptPath, JSON.stringify({
      operation_id: op2.operation_id,
      approved_plan_hash: previewPlan.plan_hash,
      database: 'applications',
      canonical_key: key2,
      sync_hash: op2.sync_hash,
      page_id: page2,
      database_id: dbUuid,
      verified_at: new Date(Date.now() + 1000).toISOString(),
      readback_properties: { 'Application ID': key2, 'Sync Hash': op2.sync_hash },
    }));
    const recRes = runVeycraftCli(['career', 'sync', 'apply-receipt', '--database', 'applications', '--key', key2, '--op', op2.operation_id, '--plan-hash', previewPlan.plan_hash, '--database-id', dbUuid, '--file', receiptPath, '--json'], { cwd: work, home });
    assert.equal(recRes.status, 0, recRes.stderr);
    assert.equal(JSON.parse(recRes.stdout).state, 'synced');
    // 5. record-failure (for already in-flight op3 -> permanent)
    const failRes = runVeycraftCli(['career', 'sync', 'record-failure', '--database', 'applications', '--key', key3, '--op', op3.operation_id, '--plan-hash', previewPlan.plan_hash, '--error-code', 'schema_mismatch', '--mutation-not-applied', '--json'], { cwd: work, home });
    assert.equal(failRes.status, 0, failRes.stderr);
    assert.equal(JSON.parse(failRes.stdout).state, 'failed_permanent');
    // 6. reset-permanent
    const rstRes = runVeycraftCli(['career', 'sync', 'reset-permanent', '--database', 'applications', '--key', key3, '--expected-error', 'schema_mismatch', '--reason', 'Fixed schema', '--confirm-reset', '--json'], { cwd: work, home });
    assert.equal(rstRes.status, 0, rstRes.stderr);
    assert.equal(JSON.parse(rstRes.stdout).state, 'pending_sync');
    // 7. expire-stale
    assert.equal(runVeycraftCli(['career', 'sync', 'expire-stale', '--json'], { cwd: work, home }).status, 0);
    // 8. reconcile (seed receipt_uncertain on key3 and reconcile while kill-switch is active)
    const stNow = loadSyncState(work, { home }).state;
    stNow.records[`applications::${key3}`] = {
      database: 'applications', canonical_key: key3, state: 'receipt_uncertain', page_id: null,
      attempted_hash: op3.sync_hash, attempted_at: new Date(Date.now() - 60000).toISOString(),
    };
    saveSyncState(work, stNow, { home, nowIso: new Date().toISOString() });
    const snapPath = path.join(work, 'logs', 'ks-snap3.json');
    fs.writeFileSync(snapPath, JSON.stringify({
      database: 'applications', database_id: dbUuid, filter_property: 'Application ID', filter_value: key3,
      query_succeeded: true, pagination_complete: true, has_more: false, next_cursor: null, timed_out: false, errors: [],
      queried_at: new Date().toISOString(), pages: [{ page_id: page3, sync_hash: op3.sync_hash }],
    }));
    const rec3 = runVeycraftCli(['career', 'sync', 'reconcile', '--database', 'applications', '--key', key3, '--database-id', dbUuid, '--file', snapPath, '--json'], { cwd: work, home });
    assert.equal(rec3.status, 0, rec3.stderr);
    assert.equal(JSON.parse(rec3.stdout).state, 'synced');
    // 9. release-stale-lock (with a real dead child PID & stale timestamp)
    const deadChild = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    const staleLockPath = path.join(work, 'logs', '.sync-state.lock');
    fs.writeFileSync(staleLockPath, JSON.stringify({ pid: deadChild.pid, acquired_at: '2026-01-01T00:00:00Z', nonce: 'ks-stale-nonce' }));
    const unlRes = runVeycraftCli(['career', 'sync', 'release-stale-lock', '--nonce', 'ks-stale-nonce', '--confirm-unlock', '--json'], { cwd: work, home });
    assert.equal(unlRes.status, 0, unlRes.stderr);
    assert.equal(JSON.parse(unlRes.stdout).released, true);
    assert.equal(fs.existsSync(staleLockPath), false);

    // Ledger byte-for-byte intact
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'), ledgerShaBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('26. Stage 7 (T13): T12-generated applications + daily_runs Notion sync compatibility & guardrails parse_error status reporting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-t13-notion-compat-'));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'config'), { recursive: true });
  fs.mkdirSync(path.join(work, 'context'), { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });

  try {
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
    fs.writeFileSync(path.join(work, 'context', 'cv.md'), '# Synthetic Owner\nBuilt TypeScript services.\n');

    // Run T12 workflow with ONLY a generic CV registered + tailored folder -> confirm-submit -> run-finish
    const runId = '2026-11-23';
    assert.equal(runVeycraftCli(['career', 'cv-register', '--id', 'cv-gen-v1', '--label', 'Generic Base CV', '--kind', 'generic', '--file', 'context/cv.md', '--json'], { cwd: work, home }).status, 0);
    assert.equal(runVeycraftCli(['career', 'run-start', '--run-id', runId, '--platforms', 'greenhouse', '--json'], { cwd: work, home }).status, 0);
    assert.equal(runVeycraftCli(['career', 'run-triage', '--job-id', 'gh:t13-sync-1', '--company', 'Aurora Cloud', '--title', 'Staff Engineer', '--platform', 'greenhouse', '--url', 'https://boards.greenhouse.io/aurora/jobs/1', '--match-score', '9.2', '--run-id', runId, '--json'], { cwd: work, home }).status, 0);

    const prepDir = path.join(work, 'logs', 'resumes', 'aurora-cloud-staff-engineer-gh-t13-sync-1');
    fs.mkdirSync(prepDir, { recursive: true });
    fs.writeFileSync(path.join(prepDir, 'resume.html'), '<!doctype html><html><body><h1>Synthetic Owner</h1><p>TypeScript</p></body></html>');
    fs.writeFileSync(path.join(prepDir, 'tailoring-notes.md'), '# Tailoring\n- Focused on TypeScript.\n');

    const rPrep = runVeycraftCli(['career', 'prepare', '--job-id', 'gh:t13-sync-1', '--json'], { cwd: work, home });
    assert.equal(rPrep.status, 0, rPrep.stdout + rPrep.stderr);
    assert.equal(runVeycraftCli(['career', 'reserve', '--job-id', 'gh:t13-sync-1', '--json'], { cwd: work, home }).status, 0);
    assert.equal(runVeycraftCli(['career', 'confirm-submit', '--job-id', 'gh:t13-sync-1', '--receipt', 'Submitted to Aurora Cloud', '--json'], { cwd: work, home }).status, 0);
    assert.equal(runVeycraftCli(['career', 'run-finish', '--run-id', runId, '--status', 'completed', '--json'], { cwd: work, home }).status, 0);

    // Offline preview MUST project BOTH the submitted application AND the daily run cleanly with zero privacy blocks!
    const rPreview = runVeycraftCli(['career', 'sync', 'preview', '--json'], { cwd: work, home });
    assert.equal(rPreview.status, 0, rPreview.stdout + rPreview.stderr);
    const previewData = JSON.parse(rPreview.stdout);
    assert.equal(previewData.summary.blocked_privacy, 0, 'T12-prepared owner application must NOT be blocked by validateCvAttribution');
    assert.equal(previewData.summary.create, 2, 'Expected 1 application create + 1 daily_run create');
    assert.ok(previewData.plan.operations.some(op => op.database === 'applications' && op.action === 'create'));
    assert.ok(previewData.plan.operations.some(op => op.database === 'daily_runs' && op.action === 'create' && op.canonical_key === runId));

    // D5: career sync status surfaces guardrails.parse_error when config/guardrails.yaml has malformed settings
    fs.writeFileSync(path.join(work, 'config', 'guardrails.yaml'), 'dry_run: maybe\nstorage_adapters:\n  notion_mcp: maybe\n');
    const rStatus = runVeycraftCli(['career', 'sync', 'status', '--json'], { cwd: work, home });
    assert.equal(rStatus.status, 0, rStatus.stderr);
    const stJson = JSON.parse(rStatus.stdout);
    assert.equal(stJson.guardrails.dry_run, true);
    assert.equal(stJson.guardrails.notion_mcp_enabled, false);
    assert.ok(typeof stJson.guardrails.parse_error === 'string' && stJson.guardrails.parse_error.length > 0, 'status must expose guardrails.parse_error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
