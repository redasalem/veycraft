import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
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
  refuseSymlink,
  writeAtomic,
  readJsonSafe,
  classifyIpAddress,
  isBlockedSsrfUrl,
  resolveAndValidateSsrfHost,
  fetchUrlWithSafeRedirects,
  DOCX_LIMITS,
  readFileBoundedSync,
  extractDocxText,
} = await import(pathToFileURL(path.join(BIN_DIR, 'fs-safety.mjs')).href);

const {
  MIN_SAMPLE_SIZE,
  computeApplicationId,
  computeCanonicalFingerprint,
  normalizeApplicationRecord,
  validateApplicationLedger,
  validateCvVersionsRegistry,
  validateCareerInsights,
  validateDailyRun,
  registerCvVersion,
  listOwnerCvVersions,
  migrateApplicationsLedger,
  computeSafeRate,
  parsePeriodSpec,
  computeCareerAnalytics,
  buildCareerInsightArtifact,
  runCareerAnalyticsForWorkspace,
  summarizeCareerWorkspace,
  loadCareerSyncInputs,
  BANNED_AI_CLICHES,
  LEDGER_LOCK_FILENAME,
  LEDGER_TX_FILENAME,
  withLedgerLock,
  inspectLedgerLock,
  releaseStaleLedgerLock,
  inspectLedgerTransaction,
  recoverIncompleteLedgerTransaction,
  readValidatedApplicationsLedger,
  readValidatedSkippedJobs,
  readValidatedCvRegistry,
  normalizeCanonicalUrl,
  evaluatePreSubmitGate,
  recordApplication,
  reserveApplicationSubmission,
  confirmApplicationSubmission,
  transitionApplicationStage,
  recordSkippedJob,
  registerOwnerCvVersionForWorkspace,
  computeWorkspaceStatusMetrics,
  RUN_PHASES,
  WORKFLOW_MODES,
  validateSessionCheckpoint,
  deriveRunCountsFromLedger,
  startOrUpdateDailyRun,
  writeSessionCheckpoint,
  resumeSessionCheckpoint,
  finishDailyRun,
  readWorkspaceTargetingPreferences,
  triageJobForWorkflow,
  enqueueSelectedRunJobs,
  computeCanonicalResumeFolderRel,
  selectBestOwnerCvVersion,
  prepareApplicationPackage,
  computeCareerWorkflowQueue,
  classifyCvRegistryEntryOwnership,
  classifyApplicationOwnership,
  isOwnerApplicationRecord,
  isThirdPartyCvPath,
  validateSafeWorkspaceRelativePath,
  isSafeWorkspaceRelativePath,
} = await import(pathToFileURL(path.join(BIN_DIR, 'career-intelligence.mjs')).href);

const {
  computeNotionSyncDiff,
  createEmptySyncState,
  validateCvAttribution,
} = await import(pathToFileURL(path.join(BIN_DIR, 'notion-sync.mjs')).href);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeTempWorkspace(prefix = 'veycraft-ci-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(dir, 'fake-home');
  const work = path.join(dir, 'workspace');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  return { dir, home, work };
}

function runCli(args, { cwd, home } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      CI: '1',
      ...(home ? { HOME: home, USERPROFILE: home } : {}),
    },
  });
}

test('1. Stage 1 (T1): Shared FS safety helpers enforce boundary, atomic write, safe JSON & SSRF guards', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t1-');
  try {
    // M3: refuseSymlink requires an explicit non-empty boundary
    assert.throws(
      () => refuseSymlink(path.join(work, 'logs', 'a.json')),
      /explicit non-empty boundary/i,
    );
    assert.throws(
      () => refuseSymlink(path.join(work, 'logs', 'a.json'), '   '),
      /explicit non-empty boundary/i,
    );

    const target = path.join(work, 'logs', 'sample.json');
    const written1 = writeAtomic(target, '{"ok":true}\n', { mode: 0o600, boundary: work, home });
    assert.equal(written1, true);
    assert.deepEqual(readJsonSafe(target, { boundary: work, home }), { ok: true });

    // preserve: true leaves existing file untouched
    const written2 = writeAtomic(target, '{"ok":false}\n', { preserve: true, boundary: work, home });
    assert.equal(written2, false);
    assert.deepEqual(readJsonSafe(target, { boundary: work, home }), { ok: true });

    // Zero leftover temp files
    const siblings = fs.readdirSync(path.join(work, 'logs'));
    assert.equal(siblings.filter(f => f.includes('.tmp-')).length, 0);

    // readJsonSafe rejects malformed JSON and non-object JSON roots
    const badJson = path.join(work, 'logs', 'bad.json');
    fs.writeFileSync(badJson, '{not-json');
    assert.throws(() => readJsonSafe(badJson, { boundary: work, home }), /Invalid JSON/i);

    const arrJson = path.join(work, 'logs', 'arr.json');
    fs.writeFileSync(arrJson, '[]');
    assert.throws(() => readJsonSafe(arrJson, { boundary: work, home }), /expected object/i);

    // SSRF guard
    assert.ok(isBlockedSsrfUrl(new URL('http://127.0.0.1/admin')));
    assert.ok(isBlockedSsrfUrl(new URL('http://169.254.169.254/latest/meta-data')));
    assert.ok(isBlockedSsrfUrl(new URL('http://localhost:3000')));
    assert.ok(isBlockedSsrfUrl(new URL('file:///etc/passwd')));
    assert.equal(isBlockedSsrfUrl(new URL('https://example.org/jobs/123')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. Stage 1 (T2): Draft 2020-12 schemas and JS validators enforce v2 constraints & preserve legacy parity', () => {
  const schemaNames = [
    'application-ledger.schema.json',
    'cv-versions.schema.json',
    'career-insights.schema.json',
    'notion-sync-plan.schema.json',
  ];
  const loaded = {};
  for (const name of schemaNames) {
    const p = path.join(REPO_ROOT, 'schemas', name);
    assert.ok(fs.existsSync(p), `Missing schema: ${name}`);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(parsed.$schema, 'https://json-schema.org/draft/2020-12/schema');
    loaded[name] = parsed;
  }

  // H5: notion-sync-plan.schema.json enforces submitted_only & executable_operation_state
  const notionSchema = loaded['notion-sync-plan.schema.json'];
  assert.equal(notionSchema.$defs.sync_plan.properties.eligibility_policy.const, 'submitted_only');
  assert.deepEqual(
    notionSchema.$defs.submitted_only_status.enum,
    ['applied', 'interview', 'assessment', 'offer', 'rejected', 'withdrawn'],
  );
  assert.equal(notionSchema.$defs.planned_operation.properties.status.$ref, '#/$defs/executable_operation_state');
  assert.ok(notionSchema.$defs.planned_operation.allOf.length >= 1);

  // H5: application-ledger.schema.json enforces v2.0 application_id & canonical statuses
  const ledgerSchema = loaded['application-ledger.schema.json'];
  assert.ok(ledgerSchema.$defs.application_record.allOf.length >= 1);

  // Demo fixtures validate cleanly via JS validators
  const demoApps = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'demo', 'applications-log.json'), 'utf8'));
  assert.equal(validateApplicationLedger(demoApps).valid, true);

  const demoRun = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'demo', 'runs', '2026-10-28.json'), 'utf8'));
  assert.equal(validateDailyRun(demoRun).valid, true);

  const demoWeekly = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'demo', 'insights', 'weekly-2026-W46.json'), 'utf8'));
  assert.equal(validateCareerInsights(demoWeekly).valid, true);

  const demoMonthly = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'demo', 'insights', 'monthly-2026-11.json'), 'utf8'));
  assert.equal(validateCareerInsights(demoMonthly).valid, true);

  // Reject malformed fields & non-canonical v2.0 rows
  const invalidV2 = validateApplicationLedger([
    { schema_version: '2.0', job_id: 'j1', status: 'interviewing' },
  ]);
  assert.equal(invalidV2.valid, false);
  assert.ok(invalidV2.errors.some(e => /application_id/i.test(e)));
  assert.ok(invalidV2.errors.some(e => /canonical lowercase status/i.test(e)));

  const badLegacy = validateApplicationLedger([
    { job_id: 'j2', status: 'applied', match_score: 'not-a-number', applied_at: 'not-a-date' },
  ]);
  assert.equal(badLegacy.valid, false);
  assert.ok(badLegacy.errors.some(e => /match_score/i.test(e)));
  assert.ok(badLegacy.errors.some(e => /applied_at/i.test(e)));
});

test('3. Stage 1 (H1 & H4): CLI flag scoping rejects misplaced flags and verify avoids skipped-jobs misclassification', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-h1h4-');
  try {
    // H1: --dry-run and --apply rejected on unrelated commands with zero writes
    for (const badArgs of [
      ['init', '--dry-run'],
      ['init', '--apply'],
      ['status', '--dry-run'],
      ['doctor', '--apply'],
      ['career', 'cv-versions', '--apply'],
      ['status', '--write'],
      ['career', 'summary', '--period', '2026-11'],
      ['career', 'migrate', '--write'],
    ]) {
      const res = runCli(badArgs, { cwd: work, home });
      assert.notEqual(res.status, 0, `Expected failure for: ${badArgs.join(' ')}`);
    }
    assert.equal(fs.existsSync(path.join(work, 'AGENTS.md')), false, 'Rejected init --dry-run must not write files');

    // H4: verify skipped-jobs.json passes cleanly without being treated as application ledger
    const skippedPath = path.join(work, 'logs', 'skipped-jobs.json');
    fs.writeFileSync(skippedPath, JSON.stringify([
      { job_id: 'skip-1', company: 'Example Corp', reason: 'below_min_match_score', skipped_at: '2026-11-01T10:00:00Z' },
    ], null, 2));
    const vSkip = runCli(['verify', skippedPath], { cwd: work, home });
    assert.equal(vSkip.status, 0, vSkip.stdout + vSkip.stderr);

    // verify demo/applications-log.json passes
    const vDemo = runCli(['verify', path.join(REPO_ROOT, 'demo', 'applications-log.json')], { cwd: work, home });
    assert.equal(vDemo.status, 0, vDemo.stdout + vDemo.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. Stage 1 (T3, H2, H3, M1, M2, L1, B1): Migration integrity, provenance, backup safety & B1 rollback truthfulness', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t3-');
  try {
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');

    // 4a. Missing or duplicate job_id aborts safely without modifying the file
    for (const badSet of [
      [{ company: 'Acme', title: 'Eng', status: 'applied' }],
      [{ job_id: '   ', company: 'Acme', title: 'Eng', status: 'applied' }],
      [
        { job_id: 'dup-1', company: 'Acme', title: 'Eng', status: 'applied' },
        { job_id: ' DUP-1 ', company: 'Beta', title: 'Staff', status: 'applied' },
      ],
    ]) {
      fs.writeFileSync(ledgerPath, JSON.stringify(badSet, null, 2));
      const beforeHash = sha256File(ledgerPath);
      assert.throws(() => migrateApplicationsLedger(work, { apply: true, home }), /job_id/i);
      assert.equal(sha256File(ledgerPath), beforeHash);
    }

    // 4b. H2, H3, M1, L1 normalization rules
    // M1: malformed legacy structured fields throw instead of silent loss
    assert.throws(
      () => normalizeApplicationRecord({ job_id: 'bad-1', status: 'applied', stage_history: 'corrupted' }),
      /stage_history/i,
    );
    assert.throws(
      () => normalizeApplicationRecord({ job_id: 'bad-1b', status: 'applied', provenance: 'corrupted' }),
      /provenance/i,
    );
    assert.throws(
      () => normalizeApplicationRecord({ job_id: 'bad-2', status: 'interview', applied_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' }),
      /precedes applied_at/i,
    );

    // H2: "No receipt:" must NOT mark verified: true
    const noReceipt = normalizeApplicationRecord({
      job_id: 'h2-no-receipt',
      company: 'Alpha',
      title: 'Backend Engineer',
      status: 'applied',
      applied_at: '2026-11-01T10:00:00Z',
      notes: 'No receipt: tab crashed before confirmation',
    });
    assert.equal(noReceipt.stage_history.length, 1);
    assert.equal(noReceipt.stage_history[0].to_status, 'applied');
    assert.equal(noReceipt.stage_history[0].verified, false);

    // H2: documented receipt quote DOES mark verified: true
    const goodReceipt = normalizeApplicationRecord({
      job_id: 'h2-good-receipt',
      company: 'Alpha',
      title: 'Backend Engineer',
      status: 'applied',
      applied_at: '2026-11-01T10:00:00Z',
      notes: 'receipt: "Application submitted — ID #8821"',
    });
    assert.equal(goodReceipt.stage_history[0].verified, true);

    // H2: submission_uncertain: true NEVER backfills applied or verified: true
    const uncertain = normalizeApplicationRecord({
      job_id: 'h2-uncertain',
      company: 'Alpha',
      title: 'Backend Engineer',
      status: 'applied',
      submission_uncertain: true,
      applied_at: '2026-11-01T10:00:00Z',
      notes: 'receipt: "Application submitted"',
    });
    assert.equal(uncertain.stage_history.length, 0);

    // H3 + L1: post-apply backfill uses from_status: null, never fabricates predecessor, captures legacy_status even when null
    const postApply = normalizeApplicationRecord({
      job_id: 'h3-l1-post',
      company: 'Alpha',
      title: 'Backend Engineer',
      status: 'interviewing',
      legacy_status: null,
      applied_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-04T15:00:00Z',
    });
    assert.equal(postApply.status, 'interview');
    assert.equal(postApply.legacy_status, 'interviewing');
    assert.equal(postApply.stage_history.length, 2);
    assert.equal(postApply.stage_history[0].to_status, 'applied');
    assert.equal(postApply.stage_history[1].to_status, 'interview');
    assert.equal(postApply.stage_history[1].from_status, null);

    // H3: identical updated_at === applied_at does not emit duplicate event
    const sameTs = normalizeApplicationRecord({
      job_id: 'h3-same-ts',
      company: 'Alpha',
      title: 'Backend Engineer',
      status: 'rejected',
      applied_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    });
    assert.equal(sameTs.stage_history.length, 1);
    assert.equal(sameTs.stage_history[0].to_status, 'applied');

    // Distinct job_id with identical company + title stay separate with distinct application_id
    const distinctPair = [
      { job_id: 'li-100', company: 'SameCo', title: 'Staff Engineer', status: 'applied', applied_at: '2026-11-01T10:00:00Z' },
      { job_id: 'li-101', company: 'SameCo', title: 'Staff Engineer', status: 'interview', applied_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' },
    ];
    assert.notEqual(computeApplicationId('li-100'), computeApplicationId('li-101'));
    assert.equal(computeCanonicalFingerprint('SameCo', 'Staff Engineer'), computeCanonicalFingerprint('sameco', 'staff engineer'));

    // 4c. Dry-run writes zero files; --dry-run --apply conflict aborts via CLI
    fs.writeFileSync(ledgerPath, JSON.stringify(distinctPair, null, 2));
    // Add a corrupt sibling log to verify non-blocking warning (M2)
    fs.writeFileSync(path.join(work, 'logs', 'skipped-jobs.json'), '{broken');

    const conflict = runCli(['career', 'migrate', '--dry-run', '--apply'], { cwd: work, home });
    assert.notEqual(conflict.status, 0);

    const beforeDryHash = sha256File(ledgerPath);
    const dryRes = migrateApplicationsLedger(work, { apply: false, home });
    assert.equal(dryRes.mode, 'dry_run');
    assert.equal(dryRes.total_records, 2);
    assert.equal(dryRes.to_enrich, 2);
    assert.equal(sha256File(ledgerPath), beforeDryHash);
    assert.equal(fs.existsSync(path.join(work, 'logs', 'backups')), false);

    // 4d. TOCTOU concurrent mutation guard aborts before overwrite
    const toctouSourceHash = sha256File(ledgerPath);
    assert.throws(
      () => migrateApplicationsLedger(work, {
        apply: true,
        home,
        _beforeWriteHook: () => {
          fs.writeFileSync(ledgerPath, JSON.stringify([...distinctPair, { job_id: 'li-102', status: 'applied' }]));
        },
      }),
      /Concurrent modification detected/i,
    );
    // Restore clean pair for subsequent rollback tests
    fs.writeFileSync(ledgerPath, JSON.stringify(distinctPair, null, 2));
    assert.equal(sha256File(ledgerPath), toctouSourceHash);

    // 4e. B1 Scenario 1: Post-write ledger corruption triggers verified atomic auto-restore
    const origHash = sha256File(ledgerPath);
    let err1 = null;
    try {
      migrateApplicationsLedger(work, {
        apply: true,
        home,
        _afterWriteHook: ({ logPath: lp }) => {
          fs.writeFileSync(lp, '{"corrupted": true}');
        },
      });
    } catch (e) {
      err1 = e;
    }
    assert.ok(err1, 'Expected post-write validation error');
    assert.match(err1.message, /auto-restored and SHA-256 verified/i);
    assert.doesNotMatch(err1.message, /AUTO-RESTORE FAILED/);
    assert.equal(sha256File(ledgerPath), origHash, 'Live ledger must match original SHA-256 after verified auto-restore');

    // 4f. B1 Scenario 2a: Corrupted backup prevents restore and reports AUTO-RESTORE FAILED truthfully
    let err2a = null;
    try {
      migrateApplicationsLedger(work, {
        apply: true,
        home,
        _afterWriteHook: ({ logPath: lp, backup }) => {
          fs.writeFileSync(lp, '{"corrupted": true}');
          fs.writeFileSync(backup.backupLogPath, '{"tampered-backup": true}');
        },
      });
    } catch (e) {
      err2a = e;
    }
    assert.ok(err2a);
    assert.match(err2a.message, /AUTO-RESTORE FAILED/);
    assert.match(err2a.message, /SHA-256 verification failed/i);
    assert.doesNotMatch(err2a.message, /auto-restored/i);

    // 4g. B1 Scenario 2b: Deleted backup reports AUTO-RESTORE FAILED truthfully with backup path
    fs.writeFileSync(ledgerPath, JSON.stringify(distinctPair, null, 2));
    let err2b = null;
    try {
      migrateApplicationsLedger(work, {
        apply: true,
        home,
        _afterWriteHook: ({ logPath: lp, backup }) => {
          fs.writeFileSync(lp, '{"corrupted": true}');
          fs.unlinkSync(backup.backupLogPath);
        },
      });
    } catch (e) {
      err2b = e;
    }
    assert.ok(err2b);
    assert.match(err2b.message, /AUTO-RESTORE FAILED/);
    assert.match(err2b.message, /backup file is missing/i);
    assert.doesNotMatch(err2b.message, /auto-restored/i);

    // 4h. Clean apply succeeds, creates SHA-256 backup with random suffix, warns on corrupt sibling log (M2), preserves 2 distinct records, and repeat apply is idempotent
    fs.writeFileSync(ledgerPath, JSON.stringify(distinctPair, null, 2));
    const applyRes = migrateApplicationsLedger(work, { apply: true, home });
    assert.equal(applyRes.mode, 'apply');
    assert.equal(applyRes.total_records, 2);
    assert.equal(applyRes.to_enrich, 2);
    assert.ok(fs.existsSync(applyRes.backup_log_path));
    assert.equal(sha256File(applyRes.backup_log_path), applyRes.backup_sha256);
    assert.ok(applyRes.backup_warnings.some(w => /skipped-jobs\.json/i.test(w)));

    const migrated = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    assert.equal(migrated.length, 2);
    assert.notEqual(migrated[0].application_id, migrated[1].application_id);
    assert.equal(validateApplicationLedger(migrated).valid, true);

    const repeatRes = migrateApplicationsLedger(work, { apply: true, home });
    assert.equal(repeatRes.to_enrich, 0);
    assert.equal(repeatRes.idempotent_no_op, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('5. Stage 1 (M5): CV version registry preserves created_at and enforces third-party isolation', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-cv-');
  try {
    let reg = { schema_version: '2.0', updated_at: '2026-11-01T00:00:00Z', versions: [] };
    reg = registerCvVersion(reg, {
      cv_version_id: 'cv-base-v1',
      version_number: 1,
      label: 'Core Backend CV',
      kind: 'generic',
      owner_scope: 'owner',
      local_ref_rel: 'context/cv.md',
      created_at: '2026-10-01T09:00:00Z',
    });

    // Updating existing CV version without overriding created_at preserves original created_at (M5)
    reg = registerCvVersion(reg, {
      cv_version_id: 'cv-base-v1',
      version_number: 1,
      label: 'Core Backend CV (Updated)',
      kind: 'generic',
      owner_scope: 'owner',
      local_ref_rel: 'context/cv.md',
      updated_at: '2026-11-20T12:00:00Z',
    });
    assert.equal(reg.versions.length, 1);
    assert.equal(reg.versions[0].created_at, '2026-10-01T09:00:00Z');
    assert.equal(reg.versions[0].label, 'Core Backend CV (Updated)');

    // Blocks third_party scope and logs/resumes/cv-* paths
    assert.throws(
      () => registerCvVersion(reg, {
        cv_version_id: 'cv-friend-1',
        version_number: 1,
        label: 'Friend CV',
        kind: 'generic',
        owner_scope: 'third_party',
        local_ref_rel: 'context/other.md',
      }),
      /third-party/i,
    );
    assert.throws(
      () => registerCvVersion(reg, {
        cv_version_id: 'cv-friend-2',
        version_number: 1,
        label: 'Friend CV',
        kind: 'generic',
        owner_scope: 'owner',
        local_ref_rel: 'logs/resumes/cv-friend/cv.html',
      }),
      /third-party/i,
    );

    // listOwnerCvVersions filters out any manually injected third-party row
    const mixed = {
      schema_version: '1.0',
      updated_at: '2026-11-20T12:00:00Z',
      versions: [
        ...reg.versions,
        {
          cv_version_id: 'cv-leak-test',
          version_number: 2,
          label: 'Client CV',
          kind: 'generic',
          owner_scope: 'third_party',
          local_ref_rel: 'logs/resumes/cv-client/cv.html',
          created_at: '2026-11-01T00:00:00Z',
          application_ids: [],
        },
      ],
    };
    assert.equal(validateCvVersionsRegistry(mixed).valid, true);
    fs.writeFileSync(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(mixed, null, 2));

    const listed = listOwnerCvVersions(work, { home });
    assert.equal(listed.total_owner_versions, 1);
    assert.equal(listed.third_party_excluded, 1);
    assert.equal(listed.versions[0].cv_version_id, 'cv-base-v1');

    const cliRes = runCli(['career', 'cv-versions', '--json'], { cwd: work, home });
    assert.equal(cliRes.status, 0, cliRes.stdout + cliRes.stderr);
    const parsed = JSON.parse(cliRes.stdout);
    assert.equal(parsed.total_owner_versions, 1);
    assert.equal(parsed.third_party_excluded, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('6. Stage 2 (T4): Deterministic analytics engine enforces MIN_N = 5, silence != rejection, CV/platform cohorts, timing, periods & artifact schema', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t4-');
  try {
    const nowIso = '2026-11-23T12:00:00Z';

    // 6a. computeSafeRate exact boundary around MIN_SAMPLE_SIZE = 5
    assert.equal(MIN_SAMPLE_SIZE, 5);
    assert.equal(computeSafeRate(0, 0).rate_pct, null);
    assert.equal(computeSafeRate(0, 0).sample_sufficient, false);
    assert.equal(computeSafeRate(2, 4).rate_pct, null);
    assert.equal(computeSafeRate(2, 4).sample_sufficient, false);
    assert.equal(computeSafeRate(2, 5).rate_pct, 40);
    assert.equal(computeSafeRate(2, 5).sample_sufficient, true);

    // 6b. parsePeriodSpec validation
    assert.deepEqual(parsePeriodSpec('all'), { type: 'all', period: 'all' });
    assert.deepEqual(parsePeriodSpec('2026-W46'), { type: 'weekly', period: '2026-W46' });
    assert.deepEqual(parsePeriodSpec('2026-11'), { type: 'monthly', period: '2026-11' });
    assert.throws(() => parsePeriodSpec('2026-13'), /Invalid --period/i);
    assert.throws(() => parsePeriodSpec('last-week'), /Invalid --period/i);

    // 6c. Small-sample dataset (n = 4 submitted + non-submitted noise + silence >= 14d + third-party isolation)
    const smallRecords = [
      // Excluded non-submitted records
      { job_id: 'ex-dry', company: 'DryCo', title: 'Eng', status: 'dry_run', match_score: 8, discovered_at: '2026-11-10T10:00:00Z' },
      { job_id: 'ex-prep', company: 'PrepCo', title: 'Eng', status: 'prepared', match_score: 8, discovered_at: '2026-11-10T10:00:00Z' },
      { job_id: 'ex-skip', company: 'SkipCo', title: 'Eng', status: 'skipped', match_score: 4, discovered_at: '2026-11-10T10:00:00Z' },
      { job_id: 'ex-uncert', company: 'UncertCo', title: 'Eng', status: 'applied', submission_uncertain: true, applied_at: '2026-11-10T10:00:00Z' },
      { job_id: 'ex-3p', company: 'ClientCo', title: 'Eng', status: 'offer', applied_at: '2026-11-10T10:00:00Z', provenance: { third_party_subject: true } },
      // 4 submitted records (below MIN_N = 5)
      {
        job_id: 'sub-1',
        company: 'FreshCo',
        title: 'Backend',
        platform: 'linkedin',
        status: 'applied',
        match_score: 8,
        cv_version_id: 'cv-tailored-1',
        cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-20T12:00:00Z', // 3d ago -> fresh_0_6d
      },
      {
        job_id: 'sub-2',
        company: 'FollowCo',
        title: 'Backend',
        platform: 'greenhouse',
        status: 'applied',
        match_score: 8.5,
        cv_version_id: 'cv-tailored-1',
        cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-13T12:00:00Z', // 10d ago -> followup_window_7_13d + overdue follow-up
      },
      {
        job_id: 'sub-3',
        company: 'Silent15Co',
        title: 'Platform',
        platform: 'lever',
        status: 'applied',
        match_score: 7.5,
        cv_version_id: 'cv-base-1',
        cv_tailoring: { is_tailored: false },
        applied_at: '2026-11-05T12:00:00Z', // 18d ago -> silent_14_29d, NEVER rejected!
        notes: 'followup_sent: 2026-11-14', // already followed up -> NOT in overdueFollowUps
      },
      {
        job_id: 'sub-4',
        company: 'Stale35Co',
        title: 'Platform',
        platform: 'lever',
        status: 'applied',
        match_score: 7,
        cv_version_id: 'cv-base-1',
        cv_tailoring: { is_tailored: false },
        applied_at: '2026-10-19T12:00:00Z', // 35d ago -> stale_30d_plus, NEVER rejected!
      },
    ];

    const t4OwnerCvRegistry = {
      schema_version: '1.0',
      updated_at: nowIso,
      versions: [
        { cv_version_id: 'cv-tailored-1', version_number: 1, label: 'Tailored 1', kind: 'tailored', owner_scope: 'owner', base_cv_version_id: null, content_sha256: '1'.repeat(64), local_ref_rel: 'logs/resumes/2026-11-01-tailored/resume.html', created_at: nowIso, application_ids: [] },
        { cv_version_id: 'cv-base-1', version_number: 1, label: 'Base 1', kind: 'generic', owner_scope: 'owner', base_cv_version_id: null, content_sha256: '2'.repeat(64), local_ref_rel: 'context/cv.md', created_at: nowIso, application_ids: [] },
        { cv_version_id: 'cv-t', version_number: 1, label: 'Tailored T', kind: 'tailored', owner_scope: 'owner', base_cv_version_id: null, content_sha256: '3'.repeat(64), local_ref_rel: 'logs/resumes/2026-11-01-t/resume.html', created_at: nowIso, application_ids: [] },
        { cv_version_id: 'cv-g', version_number: 1, label: 'Generic G', kind: 'generic', owner_scope: 'owner', base_cv_version_id: null, content_sha256: '4'.repeat(64), local_ref_rel: 'context/cv.md', created_at: nowIso, application_ids: [] },
      ],
    };
    const smallStats = computeCareerAnalytics(smallRecords, t4OwnerCvRegistry, { nowIso });
    assert.equal(smallStats.isolation.third_party_applications_excluded, 1);
    assert.equal(smallStats.funnel.submitted_count, 4);
    assert.equal(smallStats.funnel.prepared_only_count, 1);
    assert.equal(smallStats.funnel.excluded_non_submitted_count, 4);
    // Silence must NEVER be counted as rejected OR decided (B1)
    assert.equal(smallStats.funnel.silent_14d_count, 2);
    assert.equal(smallStats.funnel.rejected_count, 0);
    assert.equal(smallStats.funnel.decided_count, 0);
    assert.equal(smallStats.funnel.rates.decided_callback_rate.denominator, 0);
    assert.equal(smallStats.funnel.rates.decided_callback_rate.rate_pct, null);
    assert.equal(smallStats.timing.aging_buckets.fresh_0_6d, 1);
    assert.equal(smallStats.timing.aging_buckets.followup_window_7_13d, 1);
    assert.equal(smallStats.timing.aging_buckets.silent_14_29d, 1);
    assert.equal(smallStats.timing.aging_buckets.stale_30d_plus, 1);
    // Overdue follow-ups: sub-2 (10d) and sub-4 (35d); sub-3 excluded by followup_sent:
    assert.deepEqual(smallStats.timing.overdue_follow_ups.map(x => x.job_id), ['sub-4', 'sub-2']);
    // MIN_N = 5 suppresses aggregate rates when n = 4
    assert.equal(smallStats.sample_sufficiency.sufficient, false);
    assert.equal(smallStats.funnel.rates.callback_rate.rate_pct, null);
    assert.equal(smallStats.cv_performance.tailored_vs_generic.comparable, false);

    // B1 explicit test: 2 interviews + 4 silent (>=14d) + 0 rejections -> decided_count MUST be 2 (< 5), NOT 6
    const silentNotDecidedRecords = [
      { job_id: 'b1-i1', company: 'I1', title: 'Eng', status: 'interview', applied_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-04T10:00:00Z' },
      { job_id: 'b1-i2', company: 'I2', title: 'Eng', status: 'interview', applied_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' },
      { job_id: 'b1-s1', company: 'S1', title: 'Eng', status: 'applied', applied_at: '2026-11-01T10:00:00Z' },
      { job_id: 'b1-s2', company: 'S2', title: 'Eng', status: 'applied', applied_at: '2026-11-01T10:00:00Z' },
      { job_id: 'b1-s3', company: 'S3', title: 'Eng', status: 'applied', applied_at: '2026-11-02T10:00:00Z' },
      { job_id: 'b1-s4', company: 'S4', title: 'Eng', status: 'applied', applied_at: '2026-11-03T10:00:00Z' },
    ];
    const b1Stats = computeCareerAnalytics(silentNotDecidedRecords, null, { nowIso });
    assert.equal(b1Stats.funnel.submitted_count, 6);
    assert.equal(b1Stats.funnel.silent_14d_count, 4);
    assert.equal(b1Stats.funnel.decided_count, 2);
    assert.equal(b1Stats.sample_sufficiency.decided_n, 2);
    assert.equal(b1Stats.funnel.rates.decided_callback_rate.denominator, 2);
    assert.equal(b1Stats.funnel.rates.decided_callback_rate.rate_pct, null);
    assert.equal(b1Stats.funnel.rates.decided_callback_rate.sample_sufficient, false);
    // M2: response_time suppressed when sample_n = 2 (< 5)
    assert.equal(b1Stats.timing.response_time.sample_n, 2);
    assert.equal(b1Stats.timing.response_time.sample_sufficient, false);
    assert.equal(b1Stats.timing.response_time.median_days, null);
    assert.equal(b1Stats.timing.response_time.p75_days, null);
    // L1: deterministic job_id tie-breaker when days_since_applied is equal
    assert.deepEqual(
      b1Stats.timing.overdue_follow_ups.map(x => x.job_id),
      ['b1-s1', 'b1-s2', 'b1-s3', 'b1-s4'],
    );

    // 6d. Full dataset (>= 5 in both tailored and generic cohorts) + response timing + negative delta guard + skills
    const fullRecords = [
      // 5 tailored applications (3 callbacks: 1 interview, 1 assessment, 1 offer; 1 rejected after interview; 1 applied)
      {
        job_id: 't-1', company: 'T1', title: 'Sr Eng', platform: 'linkedin', status: 'interview', match_score: 9,
        cv_version_id: 'cv-t', cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-03T10:00:00Z', // 2d response
        matched_skills: ['TypeScript', 'Node.js'], missing_skills: ['Rust'],
      },
      {
        job_id: 't-2', company: 'T2', title: 'Sr Eng', platform: 'linkedin', status: 'assessment', match_score: 8.5,
        cv_version_id: 'cv-t', cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-06T10:00:00Z', // 4d response
        matched_skills: ['TypeScript'], missing_skills: ['Kubernetes'],
      },
      {
        job_id: 't-3', company: 'T3', title: 'Staff', platform: 'linkedin', status: 'offer', match_score: 9.5,
        cv_version_id: 'cv-t', cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-03T10:00:00Z',
        stage_history: [
          { from_status: null, to_status: 'applied', at: '2026-11-03T10:00:00Z', verified: true },
          { from_status: 'applied', to_status: 'interview', at: '2026-11-09T10:00:00Z', verified: true }, // 6d response
          { from_status: 'interview', to_status: 'offer', at: '2026-11-18T10:00:00Z', verified: true },
        ],
        matched_skills: ['Node.js'], missing_skills: ['Kubernetes'],
      },
      {
        job_id: 't-4', company: 'T4', title: 'Sr Eng', platform: 'linkedin', status: 'rejected', match_score: 8,
        cv_version_id: 'cv-t', cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-14T10:00:00Z', // 10d response
        interviews: [{ round_id: 'r1', type: 'recruiter_screen', status: 'completed', scheduled_at: '2026-11-08T10:00:00Z' }], // 4d earliest response -> counts as callback!
      },
      {
        job_id: 't-5', company: 'T5', title: 'Sr Eng', platform: 'linkedin', status: 'applied', match_score: 8,
        cv_version_id: 'cv-t', cv_tailoring: { is_tailored: true },
        applied_at: '2026-11-20T10:00:00Z',
      },
      // 5 generic applications (1 callback, 1 withdrawn, 1 rejected with negative bad timestamp ignored, 2 silent >= 14d)
      {
        job_id: 'g-1', company: 'G1', title: 'Eng', platform: 'greenhouse', status: 'interview', match_score: 7.5,
        cv_version_id: 'cv-g', cv_tailoring: { is_tailored: false },
        applied_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-11T10:00:00Z', // 10d response
      },
      {
        job_id: 'g-2', company: 'G2', title: 'Eng', platform: 'greenhouse', status: 'withdrawn', match_score: 7,
        cv_version_id: 'cv-g', cv_tailoring: { is_tailored: false },
        applied_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-05T10:00:00Z', // 3d response
      },
      {
        job_id: 'g-3', company: 'G3', title: 'Eng', platform: 'greenhouse', status: 'rejected', match_score: 7,
        cv_version_id: 'cv-g', cv_tailoring: { is_tailored: false },
        applied_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', // negative delta -> must be ignored!
      },
      {
        job_id: 'g-4', company: 'G4', title: 'Eng', platform: 'greenhouse', status: 'applied', match_score: 7,
        cv_version_id: 'cv-g', cv_tailoring: { is_tailored: false },
        applied_at: '2026-11-01T10:00:00Z', // 22d silent
      },
      {
        job_id: 'g-5', company: 'G5', title: 'Eng', platform: 'greenhouse', status: 'applied', match_score: 7,
        cv_version_id: 'cv-g', cv_tailoring: { is_tailored: false },
        applied_at: '2026-10-15T10:00:00Z', // 39d stale (outside 2026-11 month filter)
      },
    ];

    const fullStats = computeCareerAnalytics(fullRecords, t4OwnerCvRegistry, { nowIso });
    // Determinism check: identical inputs produce byte-identical analytics
    const fullStatsRepeat = computeCareerAnalytics(fullRecords, t4OwnerCvRegistry, { nowIso });
    assert.deepEqual(fullStats, fullStatsRepeat);

    assert.equal(fullStats.sample_sufficiency.sufficient, true);
    assert.equal(fullStats.funnel.submitted_count, 10);
    // B1: 1 fresh applied (t-5) + 2 silent applied (g-4, g-5) are NOT decided -> decided_count = 7
    assert.equal(fullStats.funnel.decided_count, 7);
    assert.equal(fullStats.funnel.rates.decided_callback_rate.denominator, 7);
    // Callbacks: t-1 (interview), t-2 (assessment), t-3 (offer+interview), t-4 (rejected after interview), g-1 (interview) = 5 / 10 = 50%
    assert.equal(fullStats.funnel.positive_callbacks_count, 5);
    assert.equal(fullStats.funnel.rates.callback_rate.rate_pct, 50);
    assert.equal(fullStats.funnel.rejected_count, 2);
    assert.equal(fullStats.funnel.withdrawn_count, 1);
    assert.equal(fullStats.funnel.silent_14d_count, 2);
    // Tailored vs Generic both >= 5 -> comparable === true (tailored 4/5 = 80%, generic 1/5 = 20%)
    assert.equal(fullStats.cv_performance.tailored_vs_generic.comparable, true);
    assert.equal(fullStats.cv_performance.tailored_vs_generic.tailored.callback_rate.rate_pct, 80);
    assert.equal(fullStats.cv_performance.tailored_vs_generic.generic.callback_rate.rate_pct, 20);
    // Source causal humility note present + per-platform M2 median_response_days suppressed when < 5
    assert.match(fullStats.source_performance.causal_humility_note, /do not establish ATS bias or causation/i);
    const liPlat = fullStats.source_performance.by_platform.find(p => p.platform === 'linkedin');
    assert.equal(liPlat.response_time_sample_n, 4);
    assert.equal(liPlat.response_time_sample_sufficient, false);
    assert.equal(liPlat.median_response_days, null);
    // H3: withdrawn (g-2) excluded from employer response time!
    // Employer response deltas: [2 (t-1), 4 (t-2), 4 (t-4), 6 (t-3), 10 (g-1)] -> sample_n = 5, median = 4, p75 = 6, negative delta ignored = 1
    assert.equal(fullStats.timing.response_time.sample_n, 5);
    assert.equal(fullStats.timing.response_time.sample_sufficient, true);
    assert.equal(fullStats.timing.response_time.median_days, 4);
    assert.equal(fullStats.timing.response_time.p75_days, 6);
    assert.equal(fullStats.timing.response_time.invalid_timestamps_ignored, 1);
    // Top skill gap: Kubernetes (count 2)
    assert.equal(fullStats.skills_summary.skill_gaps[0].skill, 'Kubernetes');
    assert.equal(fullStats.skills_summary.skill_gaps[0].count, 2);

    // H2: Legacy v1 aliases (interviewing, declined, coding_test, accepted), legacy `date`, legacy `score`, and out-of-range match_score > 10
    const legacyRecords = [
      { job_id: 'leg-i', company: 'L1', role: 'Dev', status: 'interviewing', score: 8, date: '2026-11-01T10:00:00Z', updated_at: '2026-11-03T10:00:00Z' },
      { job_id: 'leg-a', company: 'L2', role: 'Dev', status: 'coding_test', score: 9, date: '2026-11-02T10:00:00Z', updated_at: '2026-11-05T10:00:00Z' },
      { job_id: 'leg-o', company: 'L3', role: 'Dev', status: 'accepted', score: 10, date: '2026-11-03T10:00:00Z', updated_at: '2026-11-07T10:00:00Z' },
      { job_id: 'leg-r', company: 'L4', role: 'Dev', status: 'declined', match_score: 85, date: '2026-11-04T10:00:00Z', updated_at: '2026-11-10T10:00:00Z' }, // out-of-range 85 ignored!
      { job_id: 'leg-r2', company: 'L5', role: 'Dev', status: 'closed', score: 7, date: '2026-11-05T10:00:00Z', updated_at: '2026-11-12T10:00:00Z' },
      { job_id: 'leg-s', company: 'L6', role: 'Dev', status: 'submitted', score: 6, date: '2026-11-01T10:00:00Z' }, // 22d silent via legacy `date`
    ];
    const legStats = computeCareerAnalytics(legacyRecords, null, { nowIso });
    assert.equal(legStats.funnel.submitted_count, 6);
    assert.equal(legStats.funnel.silent_14d_count, 1);
    assert.equal(legStats.funnel.rejected_count, 2);
    assert.equal(legStats.funnel.decided_count, 5);
    assert.equal(legStats.funnel.avg_match_score, 8); // (8+9+10+7+6)/5 = 8.0, out-of-range 85 excluded!
    assert.ok(legStats.data_quality_warnings.some(w => /out-of-range/i.test(w)));
    assert.equal(legStats.timing.response_time.sample_n, 5);
    assert.equal(legStats.timing.response_time.median_days, 4); // [2, 3, 4, 6, 7]
    assert.equal(legStats.timing.overdue_follow_ups.map(x => x.job_id).includes('leg-s'), true);
    const legArtifact = buildCareerInsightArtifact(legStats);
    assert.equal(validateCareerInsights(legArtifact).valid, true);

    // Pre-Stage 3 Regression (H2 date precedence): legacy record with `date` in Oct, `updated_at` in Nov, and no `applied_at`
    // must be filtered and bucketed into Oct (original application date), NOT Nov (updated_at).
    const crossMonthLegacy = [
      {
        job_id: 'leg-oct-to-nov',
        company: 'OctAppliedCo',
        role: 'Backend Engineer',
        platform: 'linkedin',
        status: 'interviewing',
        score: 8.5,
        date: '2026-10-20T10:00:00Z',
        updated_at: '2026-11-05T10:00:00Z',
      },
    ];
    const crossAll = computeCareerAnalytics(crossMonthLegacy, null, { nowIso });
    assert.deepEqual(crossAll.timing.activity.monthly.map(m => m.period), ['2026-10']);
    assert.equal(crossAll.timing.activity.monthly[0].submitted, 1);
    const crossOct = computeCareerAnalytics(crossMonthLegacy, null, { nowIso, period: '2026-10' });
    const crossNov = computeCareerAnalytics(crossMonthLegacy, null, { nowIso, period: '2026-11' });
    assert.equal(crossOct.funnel.submitted_count, 1);
    assert.equal(crossNov.funnel.submitted_count, 0);

    const legacyWs = makeTempWorkspace('veycraft-legdate-');
    try {
      fs.writeFileSync(path.join(legacyWs.work, 'logs', 'applications-log.json'), JSON.stringify(crossMonthLegacy, null, 2));
      const octCli = runCli(['career', 'analytics', '--period', '2026-10', '--json'], { cwd: legacyWs.work, home: legacyWs.home });
      const novCli = runCli(['career', 'analytics', '--period', '2026-11', '--json'], { cwd: legacyWs.work, home: legacyWs.home });
      assert.equal(octCli.status, 0, octCli.stdout + octCli.stderr);
      assert.equal(novCli.status, 0, novCli.stdout + novCli.stderr);
      const octJson = JSON.parse(octCli.stdout);
      const novJson = JSON.parse(novCli.stdout);
      assert.equal(octJson.funnel.submitted_count, 1);
      assert.deepEqual(octJson.timing.activity.monthly.map(m => m.period), ['2026-10']);
      assert.equal(novJson.funnel.submitted_count, 0);
    } finally {
      fs.rmSync(legacyWs.dir, { recursive: true, force: true });
    }

    // Period filtering: 2026-11 excludes g-5 (2026-10-15) -> 9 records
    const novStats = computeCareerAnalytics(fullRecords, t4OwnerCvRegistry, { nowIso, period: '2026-11' });
    assert.equal(novStats.period_type, 'monthly');
    assert.equal(novStats.funnel.submitted_count, 9);

    // Artifact strictly separates deterministic facts from empty AI arrays and validates against schema
    const artifact = buildCareerInsightArtifact(novStats);
    assert.equal(validateCareerInsights(artifact).valid, true);
    assert.deepEqual(artifact.intelligence.ai_interpretations, []);
    assert.deepEqual(artifact.intelligence.hypotheses, []);
    assert.deepEqual(artifact.intelligence.recommended_actions, []);
    assert.equal(artifact.intelligence.deterministic_facts.funnel.submitted_count, 9);

    // 6e. Workspace CLI, H1 post-migration summary, M4 all-time filename & error paths
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    fs.writeFileSync(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(t4OwnerCvRegistry, null, 2));
    fs.writeFileSync(ledgerPath, JSON.stringify(fullRecords, null, 2));
    const ledgerHashBefore = sha256File(ledgerPath);

    const summaryRes = runCli(['career', 'summary', '--json'], { cwd: work, home });
    assert.equal(summaryRes.status, 0, summaryRes.stdout + summaryRes.stderr);
    const summaryJson = JSON.parse(summaryRes.stdout);
    assert.equal(summaryJson.funnel.submitted_count, 10);
    assert.equal(summaryJson.active_interviews, 2); // t-1, g-1
    assert.equal(summaryJson.active_assessments, 1); // t-2
    assert.equal(summaryJson.pending_notion_sync_count, 10);

    // H1: Migrated v2.0 records with empty interviews: [] / assessments: [] preserve active counts
    const migWork = makeTempWorkspace('veycraft-h1-mig-');
    try {
      const migLedger = path.join(migWork.work, 'logs', 'applications-log.json');
      fs.writeFileSync(migLedger, JSON.stringify([
        { job_id: 'm-int', company: 'IntCo', title: 'Sr', status: 'interview', applied_at: '2026-11-01T10:00:00Z' },
        { job_id: 'm-asmt', company: 'AsmtCo', title: 'Sr', status: 'assessment', applied_at: '2026-11-02T10:00:00Z' },
      ], null, 2));
      migrateApplicationsLedger(migWork.work, { apply: true, home: migWork.home });
      const migratedRows = JSON.parse(fs.readFileSync(migLedger, 'utf8'));
      assert.deepEqual(migratedRows[0].interviews, []);
      assert.deepEqual(migratedRows[1].assessments, []);
      const postMigSum = summarizeCareerWorkspace(migWork.work, { home: migWork.home, nowIso });
      assert.equal(postMigSum.active_interviews, 1);
      assert.equal(postMigSum.active_assessments, 1);
    } finally {
      fs.rmSync(migWork.dir, { recursive: true, force: true });
    }

    const analyticsWrite = runCli(['career', 'analytics', '--period', '2026-11', '--write', '--json'], { cwd: work, home });
    assert.equal(analyticsWrite.status, 0, analyticsWrite.stdout + analyticsWrite.stderr);
    const writeJson = JSON.parse(analyticsWrite.stdout);
    assert.ok(writeJson.written_path && fs.existsSync(writeJson.written_path));
    assert.equal(path.basename(writeJson.written_path), 'monthly-2026-11.json');

    // M4: --period all --write writes all-time.json (not all-all.json) and passes verify
    const allWrite = runCli(['career', 'analytics', '--period', 'all', '--write', '--json'], { cwd: work, home });
    assert.equal(allWrite.status, 0, allWrite.stdout + allWrite.stderr);
    const allWriteJson = JSON.parse(allWrite.stdout);
    assert.equal(path.basename(allWriteJson.written_path), 'all-time.json');
    const verifyAllInsight = runCli(['verify', allWriteJson.written_path], { cwd: work, home });
    assert.equal(verifyAllInsight.status, 0, verifyAllInsight.stdout + verifyAllInsight.stderr);

    // Verify generated monthly insights artifact passes `veycraft verify`
    const verifyInsight = runCli(['verify', writeJson.written_path], { cwd: work, home });
    assert.equal(verifyInsight.status, 0, verifyInsight.stdout + verifyInsight.stderr);

    // Ledger remains completely unmodified
    assert.equal(sha256File(ledgerPath), ledgerHashBefore);

    // CLI error paths: invalid --period, empty workspace, corrupt ledger
    const badPeriodCli = runCli(['career', 'analytics', '--period', 'invalid-period'], { cwd: work, home });
    assert.notEqual(badPeriodCli.status, 0);
    assert.match(badPeriodCli.stderr, /Invalid --period/i);

    const emptyWs = makeTempWorkspace('veycraft-empty-');
    try {
      const emptySum = runCli(['career', 'summary', '--json'], { cwd: emptyWs.work, home: emptyWs.home });
      assert.equal(emptySum.status, 0, emptySum.stdout + emptySum.stderr);
      assert.equal(JSON.parse(emptySum.stdout).funnel.submitted_count, 0);

      fs.writeFileSync(path.join(emptyWs.work, 'logs', 'applications-log.json'), '{corrupt-json');
      const corruptSum = runCli(['career', 'summary'], { cwd: emptyWs.work, home: emptyWs.home });
      assert.notEqual(corruptSum.status, 0);
      const corruptAn = runCli(['career', 'analytics'], { cwd: emptyWs.work, home: emptyWs.home });
      assert.notEqual(corruptAn.status, 0);
    } finally {
      fs.rmSync(emptyWs.dir, { recursive: true, force: true });
    }

    // Direct API helper matches CLI
    const directRun = runCareerAnalyticsForWorkspace(work, { home, period: '2026-11', write: false, nowIso });
    assert.equal(directRun.analytics.funnel.submitted_count, 9);
    const directSum = summarizeCareerWorkspace(work, { home, nowIso });
    assert.equal(directSum.funnel.submitted_count, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('7. Stage 2 (T5): Local analytics dashboard is read-only, XSS-safe, offline, MIN_N=5 guarded, parity-aligned & excludes third-party data', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t5-');
  try {
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    const records = [
      {
        job_id: 'xss-1',
        company: 'Evil </script><script>alert(1)</script> Corp',
        title: 'Security Engineer',
        platform: 'linkedin',
        status: 'applied',
        match_score: 8.5,
        cv_version_id: 'cv-v2',
        cv_tailoring: { is_tailored: true },
        applied_at: '2026-10-01T10:00:00Z',
        url: 'javascript:alert(1)',
        notes: '<img src=x onerror=alert(1)>',
      },
      {
        job_id: 'leg-1',
        company: 'Legacy V1 Corp',
        role: 'Backend Developer',
        platform: 'greenhouse',
        status: 'interviewing',
        score: 9,
        date: '2026-11-18T10:00:00Z',
        updated_at: '2026-11-20T10:00:00Z',
        url: 'https://boards.greenhouse.io/legacy/jobs/1',
      },
      {
        job_id: 'leg-declined',
        company: 'DeclinedCo',
        role: 'Infra Eng',
        platform: 'lever',
        status: 'declined',
        match_score: 99, // out-of-range score ignored
        date: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-15T10:00:00Z',
      },
      {
        job_id: 'leg-withdrawn',
        company: 'WithdrawnCo',
        role: 'Staff Eng',
        platform: 'lever',
        status: 'withdrawn',
        match_score: 8,
        applied_at: '2026-11-12T10:00:00Z',
        updated_at: '2026-11-13T10:00:00Z', // self-withdrawal must NOT count as employer response time
      },
      {
        job_id: 'third-party-secret',
        company: 'ThirdPartyClientPrivateXYZ',
        title: 'Confidential Role',
        platform: 'linkedin',
        status: 'offer',
        applied_at: '2026-11-10T10:00:00Z',
        provenance: { third_party_subject: true },
      },
    ];
    fs.writeFileSync(
      path.join(work, 'logs', 'cv-versions.json'),
      JSON.stringify({
        schema_version: '1.0',
        updated_at: '2026-11-20T10:00:00Z',
        versions: [
          {
            cv_version_id: 'cv-v2',
            version_number: 2,
            label: 'Owner Tailored v2',
            kind: 'tailored',
            owner_scope: 'owner',
            base_cv_version_id: null,
            content_sha256: '5'.repeat(64),
            local_ref_rel: 'logs/resumes/2026-10-01-sec/resume.html',
            created_at: '2026-10-01T09:00:00Z',
            application_ids: [],
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(ledgerPath, JSON.stringify(records, null, 2));
    const beforeHash = sha256File(ledgerPath);

    const res = runCli(['dashboard', '--no-open'], { cwd: work, home });
    assert.equal(res.status, 0, res.stdout + res.stderr);

    // Read-only guarantee: dashboard never modifies applications-log.json
    assert.equal(sha256File(ledgerPath), beforeHash);

    const dashPath = path.join(work, 'logs', 'exports', 'dashboard.html');
    assert.ok(fs.existsSync(dashPath));
    // M3: File permissions 0o600 on POSIX
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(dashPath).mode & 0o777, 0o600);
    }
    const html = fs.readFileSync(dashPath, 'utf8');

    // M3: Third-party application record must NOT be embedded anywhere in dashboard.html
    assert.doesNotMatch(html, /ThirdPartyClientPrivateXYZ/);
    assert.doesNotMatch(html, /third-party-secret/);

    // Both records and deterministic analytics injected (no unreplaced placeholders)
    assert.doesNotMatch(html, /\/\*__APPLICATIONS_DATA__\*\//);
    assert.doesNotMatch(html, /\/\*__CAREER_ANALYTICS__\*\//);
    assert.match(html, /window\.__JOB_HUNTER_LOGS__\s*=/);
    assert.match(html, /window\.__VEYCRAFT_ANALYTICS__\s*=/);

    // XSS script-breakout escaped via \u003c / \u003e
    assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/i);
    assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e/);

    // Strictly offline, zero external CDNs/network APIs, zero browser storage mutations
    assert.doesNotMatch(html, /\bfetch\s*\(/);
    assert.doesNotMatch(html, /\bXMLHttpRequest\b/);
    assert.doesNotMatch(html, /\bWebSocket\b/);
    assert.doesNotMatch(html, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
    assert.doesNotMatch(html, /fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/i);

    // Separate Silent (>=14d) column and MIN_SAMPLE_SIZE = 5 guard present
    assert.match(html, /Silent \(≥14d\)/);
    assert.match(html, /Rejected \/ Withdrawn/);
    assert.doesNotMatch(html, /Rejected \/ Ghosted/);
    assert.match(html, /const MIN_SAMPLE_SIZE = 5;/);

    // M1 & M2: Execute extracted dashboard script in a sandboxed VM with mock DOM to verify actual runtime parity
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Expected inline <script> block in dashboard.html');
    const elements = new Map();
    const makeEl = id => {
      const el = {
        id,
        textContent: '',
        innerHTML: '',
        className: '',
        value: '',
        classList: { add() {}, remove() {} },
        addEventListener() {},
      };
      elements.set(id, el);
      return el;
    };
    const sandbox = {
      window: {},
      document: {
        getElementById: id => elements.get(id) || makeEl(id),
        createElement: () => {
          let txt = '';
          return {
            set textContent(v) {
              txt = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            },
            get innerHTML() { return txt; },
          };
        },
      },
      URL,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      JSON,
      RegExp,
      Error,
      FileReader: function FileReader() {},
    };
    vm.runInNewContext(
      `${scriptMatch[1]}\nthis.__exports = { canonicalStatus, classifyBucket, hasPositiveCallback, formatRateDisplay, safeHref, computeClientAnalytics };`,
      sandbox,
    );
    const { canonicalStatus, classifyBucket, formatRateDisplay, safeHref, computeClientAnalytics } = sandbox.__exports;
    const injectedAnalytics = sandbox.window.__VEYCRAFT_ANALYTICS__;
    const refNowTs = Date.parse(injectedAnalytics.computed_at);

    // Assert actual rendered KPI DOM values match server analytics 1:1
    assert.equal(elements.get('kpi-applied').textContent, String(injectedAnalytics.funnel.submitted_count));
    assert.equal(elements.get('kpi-silent').textContent, String(injectedAnalytics.funnel.silent_14d_count));
    assert.equal(elements.get('kpi-overdue').textContent, String(injectedAnalytics.timing.overdue_follow_ups.length));
    assert.match(elements.get('kpi-callback').textContent, /n\/a \(n=4 < 5\)/);
    assert.match(elements.get('response-timing-summary').textContent, /n\/a \(sample n=2 < 5/);
    // XSS payload escaped in rendered Kanban HTML
    assert.doesNotMatch(elements.get('kanban-board').innerHTML, /<img src=x onerror=/i);
    assert.doesNotMatch(elements.get('kanban-board').innerHTML, /javascript:alert/i);

    // Assert client helpers match server analytics 1:1 (M1, M2, H2, H3)
    assert.equal(canonicalStatus('declined'), 'rejected');
    assert.equal(canonicalStatus('coding_test'), 'assessment');
    assert.equal(canonicalStatus('accepted'), 'offer');
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('https://boards.greenhouse.io/legacy/jobs/1'), 'https://boards.greenhouse.io/legacy/jobs/1');
    assert.equal(formatRateDisplay(2, 4).pct, null);
    assert.equal(formatRateDisplay(2, 5).pct, 40);
    assert.equal(classifyBucket(records[0], refNowTs), 'silent14d');
    assert.equal(classifyBucket(records[2], refNowTs), 'rejected');
    assert.equal(classifyBucket(records[4], refNowTs), 'excluded');

    const clientStats = computeClientAnalytics(sandbox.window.__JOB_HUNTER_LOGS__, refNowTs);
    assert.deepEqual(clientStats.timing.aging_buckets, injectedAnalytics.timing.aging_buckets);
    assert.equal(clientStats.timing.response_time.sample_n, injectedAnalytics.timing.response_time.sample_n);
    assert.equal(clientStats.timing.response_time.median_days, null); // M2: n=2 < 5
    assert.equal(clientStats.timing.response_time.p75_days, null);

    // M3: Symlink refusal on logs/applications-log.json in cmdDashboard
    const symWork = makeTempWorkspace('veycraft-sym-');
    try {
      const outside = path.join(symWork.dir, 'outside.json');
      fs.writeFileSync(outside, '[]');
      const symLedger = path.join(symWork.work, 'logs', 'applications-log.json');
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outside, symLedger);
        symlinkCreated = true;
      } catch {
        // Windows without Developer Mode / admin privileges may disallow file symlinks
      }
      if (symlinkCreated) {
        const symRes = runCli(['dashboard', '--no-open'], { cwd: symWork.work, home: symWork.home });
        assert.notEqual(symRes.status, 0);
        assert.match(symRes.stderr, /symbolic-link/i);
      } else {
        // Verify cli.mjs cmdDashboard explicitly enforces refuseSymlink on ledger + cv-versions and writes 0o600
        const cliSrc = fs.readFileSync(CLI, 'utf8');
        const dashFn = cliSrc.slice(cliSrc.indexOf('function cmdDashboard()'), cliSrc.indexOf('function isPidAlive'));
        assert.match(dashFn, /refuseSymlink\(logFile\)/);
        assert.match(dashFn, /refuseSymlink\(cvPath\)/);
        assert.match(dashFn, /writeAtomic\(outFile,\s*injected,\s*\{\s*mode:\s*0o600\s*\}\)/);
      }
    } finally {
      fs.rmSync(symWork.dir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------- Stage 5 (T11): Ledger Locking, Lifecycle Write-Engine, CV Linking, Pre-Submit Gate & CLI ----------------

test('8. Stage 5 (T11.1): Ledger lock contention, nonce-safe release, dead-PID recovery, corrupt JSON & symlink refusal', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t11-lock-');
  const nowIso = '2026-11-23T12:00:00Z';
  const lockPath = path.join(work, 'logs', LEDGER_LOCK_FILENAME);
  const ledgerPath = path.join(work, 'logs', 'applications-log.json');
  const skippedPath = path.join(work, 'logs', 'skipped-jobs.json');
  const cvPath = path.join(work, 'logs', 'cv-versions.json');

  try {
    // 8a. Exclusive lock acquisition, nested contention refusal & clean release
    let seenNonce = null;
    withLedgerLock(work, { home, nowIso }, handle => {
      seenNonce = handle.nonce;
      assert.ok(fs.existsSync(lockPath));
      const inspected = inspectLedgerLock(work, { home, nowIso });
      assert.equal(inspected.locked, true);
      assert.equal(inspected.owner_alive, true);
      assert.equal(inspected.lock.pid, process.pid);
      assert.equal(inspected.lock.nonce, seenNonce);

      // Concurrent writer MUST fail closed without stealing lock
      assert.throws(
        () => recordApplication(work, { job_id: 'gh:contend-1', status: 'discovered', company: 'Acme', title: 'SWE' }, { home, nowIso }),
        /ledger_locked/i,
      );
      // Live PID lock cannot be released via releaseStaleLedgerLock even with future timestamp
      assert.throws(
        () => releaseStaleLedgerLock(work, {
          home,
          nowIso: '2026-11-23T13:00:00Z',
          expectedNonce: seenNonce,
          confirmedExplicitRecovery: true,
        }),
        /still active|cannot be proven dead/i,
      );
    });
    assert.equal(fs.existsSync(lockPath), false, 'Lockfile should be released cleanly after callback');

    // 8b. Nonce-safe release: if lockfile was replaced by another nonce during execution, release must NOT delete the other lock
    const foreignNonce = 'foreign_nonce_abcdef123456';
    withLedgerLock(work, { home, nowIso }, () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquired_at: nowIso, nonce: foreignNonce }, null, 2));
    });
    assert.equal(fs.existsSync(lockPath), true, 'Foreign nonce lock must NOT be unlinked');
    fs.unlinkSync(lockPath);

    // 8c. Dead-PID stale lock diagnostics & explicit recovery
    const deadPid = 99999999; // non-existent PID
    const staleNonce = 'dead_pid_nonce_123456';
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquired_at: '2026-11-23T11:00:00Z', nonce: staleNonce }, null, 2));
    const staleInfo = inspectLedgerLock(work, { home, nowIso });
    assert.equal(staleInfo.locked, true);
    assert.equal(staleInfo.stale, true);
    assert.equal(staleInfo.owner_alive, false);

    // Must fail without explicit confirmation, wrong nonce, or non-stale age
    assert.throws(
      () => releaseStaleLedgerLock(work, { home, nowIso, expectedNonce: staleNonce, confirmedExplicitRecovery: false }),
      /confirmedExplicitRecovery/i,
    );
    assert.throws(
      () => releaseStaleLedgerLock(work, { home, nowIso, expectedNonce: 'wrong-nonce', confirmedExplicitRecovery: true }),
      /nonce mismatch/i,
    );
    assert.throws(
      () => releaseStaleLedgerLock(work, { home, nowIso: '2026-11-23T11:05:00Z', expectedNonce: staleNonce, confirmedExplicitRecovery: true }),
      /below staleLockAgeMs/i,
    );
    // Valid explicit recovery succeeds
    const released = releaseStaleLedgerLock(work, { home, nowIso, expectedNonce: staleNonce, confirmedExplicitRecovery: true });
    assert.equal(released.released, true);
    assert.equal(released.released_pid, deadPid);
    assert.equal(fs.existsSync(lockPath), false);

    // Corrupt lockfile refused for automatic removal
    fs.writeFileSync(lockPath, '{bad json');
    const corruptLock = inspectLedgerLock(work, { home, nowIso });
    assert.equal(corruptLock.locked, true);
    assert.equal(corruptLock.corrupt, true);
    assert.throws(
      () => releaseStaleLedgerLock(work, { home, nowIso, expectedNonce: 'any', confirmedExplicitRecovery: true }),
      /corrupt/i,
    );
    fs.unlinkSync(lockPath);

    // 8d. Corrupt JSON refusal on all 3 operational ledgers (never silently reset to empty!)
    fs.writeFileSync(ledgerPath, '[{"job_id": broken');
    const badLedgerHash = sha256File(ledgerPath);
    assert.throws(
      () => recordApplication(work, { job_id: 'gh:1', status: 'discovered', company: 'Acme', title: 'SWE' }, { home, nowIso }),
      /Corrupt JSON/i,
    );
    assert.equal(sha256File(ledgerPath), badLedgerHash, 'Corrupt applications-log.json must remain untouched');
    fs.unlinkSync(ledgerPath);

    fs.writeFileSync(skippedPath, '{"not": "an array"}');
    assert.throws(
      () => recordSkippedJob(work, { job_id: 'gh:skip1', reason: 'mismatch', skip_reason: 'Wrong stack' }, { home, nowIso }),
      /expected a JSON array/i,
    );
    fs.unlinkSync(skippedPath);

    fs.writeFileSync(cvPath, '{bad cv registry');
    const sampleCv = path.join(work, 'context', 'cv.md');
    fs.mkdirSync(path.dirname(sampleCv), { recursive: true });
    fs.writeFileSync(sampleCv, '# Synthetic Owner CV\nBuilt Node.js systems.\n');
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, { cv_version_id: 'cv-1', label: 'Base', kind: 'generic', file: 'context/cv.md' }, { home, nowIso }),
      /Corrupt JSON/i,
    );
    fs.unlinkSync(cvPath);

    // 8e. Validation failure before persistence leaves valid existing ledger untouched
    recordApplication(work, { job_id: 'gh:valid-1', status: 'discovered', company: 'CloudPay', title: 'Backend Engineer' }, { home, nowIso });
    const beforeValidHash = sha256File(ledgerPath);
    assert.throws(
      () => recordApplication(work, { job_id: 'gh:bad-score', status: 'discovered', match_score: 99 }, { home, nowIso }),
      /match_score/i,
    );
    assert.equal(sha256File(ledgerPath), beforeValidHash);

    // 8f. Symlink refusal on protected ledger (when OS allows symlinks)
    const outsideFile = path.join(dir, 'outside-ledger.json');
    fs.writeFileSync(outsideFile, '[]');
    const symWork = makeTempWorkspace('veycraft-t11-sym-');
    try {
      const symTarget = path.join(symWork.work, 'logs', 'applications-log.json');
      let madeSym = false;
      try {
        fs.symlinkSync(outsideFile, symTarget);
        madeSym = true;
      } catch { /* Windows without symlink privilege */ }
      if (madeSym) {
        assert.throws(
          () => readValidatedApplicationsLedger(symWork.work, { home: symWork.home }),
          /symbolic-link/i,
        );
      }
    } finally {
      fs.rmSync(symWork.dir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('9. Stage 5 (T11.2): Lifecycle write-engine enforces dedup, reservation, receipt immutability, transitions & skip dedup', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t11-life-');
  const t0 = '2026-11-23T09:00:00Z';
  const t1 = '2026-11-23T09:05:00Z';
  const t2 = '2026-11-23T09:10:00Z';
  const t3 = '2026-11-24T10:00:00Z';
  const t4 = '2026-11-25T11:00:00Z';
  const t5 = '2026-11-26T12:00:00Z';
  const t6 = '2026-11-27T13:00:00Z';

  try {
    // 9a. recordApplication: create, idempotent repeat, non-submitted update, reject direct submitted status & non-HTTP(S) URLs
    assert.throws(
      () => recordApplication(work, { job_id: 'gh:badurl', status: 'discovered', url: 'javascript:alert(1)' }, { home, nowIso: t0 }),
      /non-HTTP\(S\)/i,
    );
    assert.throws(
      () => recordApplication(work, { job_id: 'gh:100', status: 'applied', company: 'CloudPay', title: 'Backend Engineer' }, { home, nowIso: t0 }),
      /only accepts non-submission statuses/i,
    );
    const created = recordApplication(work, {
      job_id: 'greenhouse:cloudpay-100',
      status: 'discovered',
      company: 'CloudPay Ledger',
      title: 'Senior Backend Engineer',
      platform: 'greenhouse',
      url: 'https://boards.greenhouse.io/cloudpay/jobs/100?utm_source=linkedin',
      match_score: 9.0,
      matched_skills: ['Node.js', 'TypeScript', 'PostgreSQL'],
      missing_skills: ['Kubernetes'],
    }, { home, nowIso: t0 });
    assert.equal(created.action, 'created');
    assert.equal(created.application_id, computeApplicationId('greenhouse:cloudpay-100'));
    assert.equal(created.canonical_fingerprint, 'cloudpay-ledger::senior-backend-engineer');

    // Idempotent repeat makes no duplicate entry
    const repeat = recordApplication(work, {
      job_id: 'greenhouse:cloudpay-100',
      status: 'discovered',
      company: 'CloudPay Ledger',
      title: 'Senior Backend Engineer',
    }, { home, nowIso: t0 });
    assert.equal(repeat.action, 'idempotent_no_op');

    // Update non-submitted to prepared
    const prepared = recordApplication(work, {
      job_id: 'greenhouse:cloudpay-100',
      status: 'prepared',
      notes: 'Tailored CV generated',
    }, { home, nowIso: t1 });
    assert.equal(prepared.action, 'updated');
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.record.stage_history.length, 2);

    // 9b. reserveApplicationSubmission: sets needs_review + submission_uncertain=true + applied_at=null
    const reserved = reserveApplicationSubmission(work, {
      job_id: 'greenhouse:cloudpay-100',
    }, { home, nowIso: t1, sourceRoot: REPO_ROOT });
    assert.equal(reserved.reserved, true);
    assert.equal(reserved.status, 'needs_review');
    assert.equal(reserved.submission_uncertain, true);
    assert.equal(reserved.applied_at, null);

    // Refuses duplicate reservation & refuses downgrading active reservation via record
    assert.throws(
      () => reserveApplicationSubmission(work, { job_id: 'greenhouse:cloudpay-100' }, { home, nowIso: t2, sourceRoot: REPO_ROOT }),
      /already_reserved/i,
    );
    assert.throws(
      () => recordApplication(work, { job_id: 'greenhouse:cloudpay-100', status: 'prepared' }, { home, nowIso: t2 }),
      /reservation_active/i,
    );
    // Refuses transitioning unsubmitted reservation directly to interview
    assert.throws(
      () => transitionApplicationStage(work, { job_id: 'greenhouse:cloudpay-100', to_status: 'interview' }, { home, nowIso: t2 }),
      /cannot_transition_unsubmitted/i,
    );

    // 9c. confirmApplicationSubmission: rejects blank/invalid/placeholder/too-long receipts
    for (const badReceipt of ['', '   ', 'ok', 'Thank you {{COMPANY}}', 'x'.repeat(161)]) {
      assert.throws(
        () => confirmApplicationSubmission(work, { job_id: 'greenhouse:cloudpay-100', receipt: badReceipt }, { home, nowIso: t2 }),
        /Receipt quote/i,
      );
    }

    const confirmed = confirmApplicationSubmission(work, {
      job_id: 'greenhouse:cloudpay-100',
      receipt: 'Thank you for applying to CloudPay Ledger',
      url: 'https://boards.greenhouse.io/cloudpay/jobs/100/confirmation',
    }, { home, nowIso: t2 });
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.status, 'applied');
    assert.equal(confirmed.applied_at, t2);
    assert.equal(confirmed.record.submission_uncertain, false);
    assert.equal(confirmed.record.provenance.receipt_verified, true);
    assert.match(confirmed.record.notes, /receipt:\s*"Thank you for applying to CloudPay Ledger"/);

    // Refuses duplicate confirmation, receipt overwrite, or record downgrade
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'greenhouse:cloudpay-100', receipt: 'Another receipt' }, { home, nowIso: t3 }),
      /already_confirmed/i,
    );
    assert.throws(
      () => recordApplication(work, { job_id: 'greenhouse:cloudpay-100', status: 'prepared' }, { home, nowIso: t3 }),
      /cannot_downgrade_submitted/i,
    );
    // Refuses cross-channel duplicate via record
    assert.throws(
      () => recordApplication(work, {
        job_id: 'linkedin:dup-999',
        status: 'discovered',
        company: 'CloudPay Ledger',
        title: 'Senior Backend Engineer',
        platform: 'linkedin',
      }, { home, nowIso: t3, sourceRoot: REPO_ROOT }),
      /duplicate_application/i,
    );

    // Refuses confirming a dry_run or skipped record
    recordApplication(work, { job_id: 'lever:dry-1', status: 'dry_run', company: 'DryCo', title: 'Eng' }, { home, nowIso: t2 });
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'lever:dry-1', receipt: 'Application received' }, { home, nowIso: t3 }),
      /invalid_confirm_source_status/i,
    );

    // 9d. transitionApplicationStage: follow-up on applied, interview + assessment + offer + withdrawn; preserves applied_at & receipt
    const followed = transitionApplicationStage(work, {
      job_id: 'greenhouse:cloudpay-100',
      to_status: 'applied',
      source: 'follow_up_radar',
      follow_up: { status: 'sent', draft_rel: 'logs/resumes/cloudpay-100/followup-draft.md' },
      notes: 'Sent 7d check-in',
    }, { home, nowIso: t3 });
    assert.equal(followed.record.follow_up.status, 'sent');
    assert.equal(followed.record.follow_up.follow_up_count, 1);
    assert.equal(followed.record.applied_at, t2);

    const iv = transitionApplicationStage(work, {
      job_id: 'greenhouse:cloudpay-100',
      to_status: 'interview',
      source: 'recruiter_inbox_triage',
      interview: { stage: 'technical_screen', round: 1, scheduled_at: t4, timezone: 'UTC', status: 'scheduled', outcome: 'pending' },
      notes: 'Invited to technical screen',
    }, { home, nowIso: t4 });
    assert.equal(iv.to_status, 'interview');
    assert.equal(iv.record.interviews.length, 1);
    assert.equal(iv.record.interviews[0].stage, 'technical_screen');
    assert.equal(iv.record.applied_at, t2);
    assert.match(iv.record.notes, /receipt:\s*"Thank you for applying to CloudPay Ledger"/);

    // Idempotent repeat of exact same status without supplemental update
    const ivNoOp = transitionApplicationStage(work, {
      job_id: 'greenhouse:cloudpay-100',
      to_status: 'interview',
    }, { home, nowIso: t4 });
    assert.equal(ivNoOp.action, 'idempotent_no_op');

    // Backward timestamp rejected
    assert.throws(
      () => transitionApplicationStage(work, { job_id: 'greenhouse:cloudpay-100', to_status: 'assessment', at: t0 }, { home, nowIso: t5 }),
      /cannot precede/i,
    );

    const asmt = transitionApplicationStage(work, {
      job_id: 'greenhouse:cloudpay-100',
      to_status: 'assessment',
      source: 'recruiter_inbox_triage',
      assessment: { type: 'take_home', due_at: t6, status: 'assigned', outcome: 'pending' },
    }, { home, nowIso: t5 });
    assert.equal(asmt.record.assessments.length, 1);
    assert.equal(asmt.record.assessments[0].type, 'take_home');

    const rej = transitionApplicationStage(work, {
      job_id: 'greenhouse:cloudpay-100',
      to_status: 'rejected',
      source: 'recruiter_inbox_triage',
      notes: 'Role filled internally',
    }, { home, nowIso: t6 });
    assert.equal(rej.to_status, 'rejected');
    assert.equal(rej.record.applied_at, t2);

    // Terminal state rejects invalid transitions (e.g., rejected -> offer)
    assert.throws(
      () => transitionApplicationStage(work, { job_id: 'greenhouse:cloudpay-100', to_status: 'offer' }, { home, nowIso: t6 }),
      /invalid_stage_transition/i,
    );

    // 9e. recordSkippedJob: dedup, update, >160 char rejection
    assert.throws(
      () => recordSkippedJob(work, { job_id: 'gh:s1', reason: 'ghost_or_expired', skip_reason: 'a'.repeat(161) }, { home, nowIso: t0 }),
      /exceeds maximum length/i,
    );
    const sk1 = recordSkippedJob(work, {
      job_id: 'gh:s1',
      company: 'GhostCo',
      title: 'Old Role',
      platform: 'greenhouse',
      reason: 'ghost_or_expired',
      skip_reason: 'Closed banner observed',
    }, { home, nowIso: t0 });
    assert.equal(sk1.action, 'created');
    const skDup = recordSkippedJob(work, {
      job_id: 'GH:S1',
      company: 'GhostCo',
      title: 'Old Role',
      platform: 'greenhouse',
      reason: 'ghost_or_expired',
      skip_reason: 'Closed banner observed',
    }, { home, nowIso: t1 });
    assert.equal(skDup.action, 'idempotent_no_op');
    assert.equal(readValidatedSkippedJobs(work, { home }).records.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('10. Stage 5 (T11.3): CV registration computes SHA-256, enforces isolation/path safety & handles cross-file transaction failure/recovery', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t11-cv-');
  const t0 = '2026-11-23T10:00:00Z';
  const t1 = '2026-11-23T10:05:00Z';

  try {
    const ownerCv = path.join(work, 'logs', 'resumes', 'cloudpay-100', 'resume.html');
    fs.mkdirSync(path.dirname(ownerCv), { recursive: true });
    fs.writeFileSync(ownerCv, '<html><body><h1>Synthetic Candidate</h1><p>Node.js & PostgreSQL</p></body></html>');
    const expectedSha = sha256File(ownerCv);

    // 10a. Single-file registration + SHA-256 + re-registration preserves created_at
    const reg1 = registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-cloudpay-v1',
      label: 'CloudPay Backend Tailored CV',
      kind: 'tailored',
      file: 'logs/resumes/cloudpay-100/resume.html',
      target_role: 'Senior Backend Engineer',
      ats_keyword_before_pct: 68,
      ats_keyword_after_pct: 91,
    }, { home, nowIso: t0 });
    assert.equal(reg1.registered, true);
    assert.equal(reg1.content_sha256, expectedSha);
    assert.equal(reg1.version.created_at, t0);

    const reg2 = registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-cloudpay-v1',
      label: 'CloudPay Backend Tailored CV (Rev 2)',
      kind: 'tailored',
      file: 'logs/resumes/cloudpay-100/resume.html',
    }, { home, nowIso: t1 });
    assert.equal(reg2.version.created_at, t0, 'Re-registration must preserve original created_at');
    assert.equal(reg2.version.label, 'CloudPay Backend Tailored CV (Rev 2)');

    // 10b. Security & third-party isolation refusals
    const tpCv = path.join(work, 'logs', 'resumes', 'cv-friend-alex', 'resume.html');
    fs.mkdirSync(path.dirname(tpCv), { recursive: true });
    fs.writeFileSync(tpCv, '<html><body><h1>Third Party</h1></body></html>');
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-tp-1',
        label: 'Friend CV',
        kind: 'generic',
        file: 'logs/resumes/cv-friend-alex/resume.html',
      }, { home, nowIso: t1 }),
      /third-party/i,
    );
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-tp-2',
        label: 'Marked 3P',
        kind: 'generic',
        file: 'logs/resumes/cloudpay-100/resume.html',
        owner_scope: 'third_party',
      }, { home, nowIso: t1 }),
      /third-party/i,
    );

    // Path traversal refusal
    const outsideCv = path.join(dir, 'outside-cv.md');
    fs.writeFileSync(outsideCv, '# Outside');
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-escape',
        label: 'Escape',
        kind: 'generic',
        file: '../outside-cv.md',
      }, { home, nowIso: t1 }),
      /outside workspace boundary/i,
    );

    // Symlink refusal (when OS permits symlink creation)
    const symCv = path.join(work, 'context', 'sym-cv.md');
    fs.mkdirSync(path.dirname(symCv), { recursive: true });
    let madeSym = false;
    try {
      fs.symlinkSync(outsideCv, symCv);
      madeSym = true;
    } catch { /* ignore if OS blocks symlinks */ }
    if (madeSym) {
      assert.throws(
        () => registerOwnerCvVersionForWorkspace(work, {
          cv_version_id: 'cv-sym',
          label: 'Sym',
          kind: 'generic',
          file: 'context/sym-cv.md',
        }, { home, nowIso: t1 }),
        /symbolic-link/i,
      );
      fs.unlinkSync(symCv);
    }

    // 10c. Cross-file application linking transaction (success, step-2 rollback, crash-recovery detection)
    recordApplication(work, {
      job_id: 'gh:link-100',
      status: 'prepared',
      company: 'CloudPay',
      title: 'Senior Backend Engineer',
      platform: 'greenhouse',
    }, { home, nowIso: t0 });
    recordApplication(work, {
      job_id: 'gh:tp-app',
      status: 'prepared',
      company: 'FriendCo',
      title: 'Designer',
      third_party_subject: true,
    }, { home, nowIso: t0 });

    // Refuses linking owner CV to third-party application
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-cloudpay-v1',
        label: 'Owner CV',
        kind: 'tailored',
        file: 'logs/resumes/cloudpay-100/resume.html',
        link_job_id: 'gh:tp-app',
      }, { home, nowIso: t1 }),
      /third_party_blocked/i,
    );

    const cvRegPath = path.join(work, 'logs', 'cv-versions.json');
    const ledgerPath = path.join(work, 'logs', 'applications-log.json');
    const txPath = path.join(work, 'logs', LEDGER_TX_FILENAME);
    const cvHashBefore = sha256File(cvRegPath);
    const ledgerHashBefore = sha256File(ledgerPath);

    // Simulate failure right before second file write -> automatic compensating rollback must restore BOTH files!
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-rollback-test',
        label: 'Rollback Test CV',
        kind: 'tailored',
        file: 'logs/resumes/cloudpay-100/resume.html',
        link_job_id: 'gh:link-100',
      }, {
        home,
        nowIso: t1,
        _testHooks: {
          beforeSecondWrite: () => { throw new Error('Simulated disk error before ledger write'); },
        },
      }),
      /cv_register_link_rolled_back/i,
    );
    assert.equal(sha256File(cvRegPath), cvHashBefore, 'cv-versions.json must be rolled back identically');
    assert.equal(sha256File(ledgerPath), ledgerHashBefore, 'applications-log.json must remain unchanged');
    assert.equal(fs.existsSync(txPath), false, 'tx journal cleaned up after clean rollback');

    // Simulate crash / failed rollback leaving logs/.ledger-tx.json -> subsequent mutations MUST fail closed until explicit recovery!
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-crash-test',
        label: 'Crash Test CV',
        kind: 'tailored',
        file: 'logs/resumes/cloudpay-100/resume.html',
        link_job_id: 'gh:link-100',
      }, {
        home,
        nowIso: t1,
        _testHooks: {
          beforeSecondWrite: () => { throw new Error('Simulated crash during step 2'); },
          onRollback: () => { throw new Error('Simulated crash during rollback'); },
        },
      }),
      /cv_register_link_rollback_failed/i,
    );
    assert.equal(fs.existsSync(txPath), true, 'tx journal must remain for crash detection');
    const txInfo = inspectLedgerTransaction(work, { home });
    assert.equal(txInfo.pending, true);
    assert.equal(txInfo.transaction.stage, 'rollback_failed');

    // Subsequent writes MUST fail closed while tx journal exists
    assert.throws(
      () => recordApplication(work, { job_id: 'gh:blocked-by-tx', status: 'discovered' }, { home, nowIso: t1 }),
      /incomplete_ledger_transaction/i,
    );
    assert.throws(
      () => recoverIncompleteLedgerTransaction(work, { home, nowIso: t1, confirmRollback: false }),
      /confirmRollback/i,
    );

    // Explicit rollback recovery restores exact pre-crash bytes and clears journal
    const recovered = recoverIncompleteLedgerTransaction(work, { home, nowIso: t1, confirmRollback: true });
    assert.equal(recovered.recovered, true);
    assert.equal(sha256File(cvRegPath), cvHashBefore);
    assert.equal(sha256File(ledgerPath), ledgerHashBefore);
    assert.equal(fs.existsSync(txPath), false);

    // Clean cross-file link succeeds and reflects in both cv-versions and applications-log
    const linked = registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-cloudpay-v1',
      label: 'CloudPay Backend Tailored CV',
      kind: 'tailored',
      file: 'logs/resumes/cloudpay-100/resume.html',
      link_job_id: 'gh:link-100',
      ats_keyword_before_pct: 70,
      ats_keyword_after_pct: 92,
    }, { home, nowIso: t1 });
    assert.equal(linked.linked_application_id, computeApplicationId('gh:link-100'));
    assert.equal(fs.existsSync(txPath), false);
    const listed = listOwnerCvVersions(work, { home });
    assert.equal(listed.versions.find(v => v.cv_version_id === 'cv-cloudpay-v1').linked_applications_count, 1);
    const ledgerAfter = readValidatedApplicationsLedger(work, { home }).records;
    const linkedApp = ledgerAfter.find(r => r.job_id === 'gh:link-100');
    assert.equal(linkedApp.cv_version_id, 'cv-cloudpay-v1');
    assert.equal(linkedApp.cv_tailoring.is_tailored, true);
    assert.equal(linkedApp.cv_tailoring.ats_keyword_after_pct, 92);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('11. Stage 5 (T11.4): Pre-submit integrity gate (caps, uncertain reservations, platform, circuit breaker, blacklists, dedup) & cmdStatus alignment', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t11-gate-');
  const today = '2026-11-23';
  const nowIso = `${today}T12:00:00Z`;

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.writeFileSync(
      path.join(work, 'context', 'preferences.yaml'),
      [
        'blacklisted_companies: ["ToxicStaffing Global", "OldEmployer"]',
        'blacklisted_domains:',
        '  - "spam-agency.example"',
        '  - "blocked.corp"',
      ].join('\n') + '\n',
    );

    // Seed 3 applied + 1 unresolved submission_uncertain reservation today + 2 excluded (dry_run, third_party) + 1 old 20-day silent applied
    const seed = [
      normalizeApplicationRecord({ job_id: 'gh:a1', company: 'AlphaCo', title: 'Backend Eng', platform: 'greenhouse', url: 'https://boards.greenhouse.io/alpha/jobs/1', status: 'applied', applied_at: `${today}T08:00:00Z`, notes: 'receipt: "Submitted alpha"' }),
      normalizeApplicationRecord({ job_id: 'gh:a2', company: 'BetaCo', title: 'Platform Eng', platform: 'greenhouse', url: 'https://boards.greenhouse.io/beta/jobs/2', status: 'applied', applied_at: `${today}T08:30:00Z`, notes: 'receipt: "Submitted beta"' }),
      normalizeApplicationRecord({ job_id: 'gh:a3', company: 'GammaCo', title: 'API Eng', platform: 'greenhouse', url: 'https://boards.greenhouse.io/gamma/jobs/3', status: 'applied', applied_at: `${today}T09:00:00Z`, notes: 'receipt: "Submitted gamma"' }),
      normalizeApplicationRecord({ job_id: 'li:res1', company: 'DeltaCo', title: 'Fullstack Eng', platform: 'linkedin', url: 'https://www.linkedin.com/jobs/view/5001', status: 'needs_review', submission_uncertain: true, applied_at: null, updated_at: `${today}T09:30:00Z` }),
      normalizeApplicationRecord({ job_id: 'li:dry1', company: 'DryCo', title: 'Eng', platform: 'linkedin', status: 'dry_run', applied_at: null, updated_at: `${today}T09:35:00Z` }),
      normalizeApplicationRecord({ job_id: 'li:tp1', company: 'ThirdPartyCo', title: 'Designer', platform: 'linkedin', status: 'applied', applied_at: `${today}T09:40:00Z`, provenance: { created_by: 'test', created_at: `${today}T09:40:00Z`, last_updated_by: null, receipt_verified: true, third_party_subject: true } }),
      normalizeApplicationRecord({ job_id: 'li:silent20', company: 'QuietCo', title: 'Old Role', platform: 'linkedin', url: 'https://www.linkedin.com/jobs/view/100', status: 'applied', applied_at: '2026-11-01T10:00:00Z', notes: 'receipt: "Submitted quiet"' }),
    ];
    fs.writeFileSync(path.join(work, 'logs', 'applications-log.json'), JSON.stringify(seed, null, 2));

    // 11a. Uncertain reservation MUST count toward daily/warm-up cap (4/5: 3 applied + 1 uncertain; dry_run & 3P excluded)
    const gate4 = evaluatePreSubmitGate(work, { platform: 'linkedin', company: 'FreshCo', title: 'Staff Eng', url: 'https://www.linkedin.com/jobs/view/9999', job_id: 'li:fresh-1' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gate4.allowed, true);
    assert.equal(gate4.checks.daily_cap.today_applied, 3);
    assert.equal(gate4.checks.daily_cap.today_submission_uncertain, 1);
    assert.equal(gate4.checks.daily_cap.today_counted, 4);
    assert.equal(gate4.checks.daily_cap.effective_cap, 5);

    // 11b. Per-platform cap: greenhouse has 3/3 -> BLOCKED; workday has cap 0 -> BLOCKED
    const gateGh = evaluatePreSubmitGate(work, { platform: 'greenhouse', company: 'NewCo', title: 'Eng', job_id: 'gh:new' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateGh.allowed, false);
    assert.ok(gateGh.violations.some(v => v.code === 'platform_cap_reached'));

    const gateWd = evaluatePreSubmitGate(work, { platform: 'workday', company: 'NewCo', title: 'Eng', job_id: 'wd:new' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateWd.allowed, false);
    assert.ok(gateWd.violations.some(v => v.code === 'platform_disabled'));

    // 11c. Blacklists: company substring & subdomain domain match -> BLOCKED
    const gateBlCo = evaluatePreSubmitGate(work, { platform: 'linkedin', company: 'ToxicStaffing Global LLC', title: 'Eng', job_id: 'li:bl1' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateBlCo.allowed, false);
    assert.ok(gateBlCo.violations.some(v => v.code === 'blacklisted_employer'));

    const gateBlDom = evaluatePreSubmitGate(work, { platform: 'linkedin', company: 'CleanName', title: 'Eng', url: 'https://careers.spam-agency.example/jobs/1', job_id: 'li:bl2' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateBlDom.allowed, false);
    assert.ok(gateBlDom.violations.some(v => v.code === 'blacklisted_domain'));

    // 11d. Circuit breaker: active cooldown blocks, expired cooldown passes
    fs.writeFileSync(path.join(work, 'logs', 'circuit-breaker.json'), JSON.stringify({
      platforms: {
        linkedin: { status: 'tripped', tripped_at: `${today}T10:00:00Z`, cooldown_until: '2026-11-24T10:00:00Z', trigger_signal: 'HTTP 429' },
        wellfound: { status: 'tripped', tripped_at: '2026-11-20T10:00:00Z', cooldown_until: '2026-11-21T10:00:00Z', trigger_signal: 'Old' },
      },
    }, null, 2));
    const gateCb = evaluatePreSubmitGate(work, { platform: 'linkedin', company: 'NewCo', title: 'Eng', job_id: 'li:cb1' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateCb.allowed, false);
    assert.ok(gateCb.violations.some(v => v.code === 'circuit_breaker_active'));

    const gateCbExpired = evaluatePreSubmitGate(work, { platform: 'wellfound', company: 'NewCo', title: 'Eng', job_id: 'wf:ok1' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateCbExpired.allowed, true);
    fs.unlinkSync(path.join(work, 'logs', 'circuit-breaker.json'));

    // 11e. Deduplication: job_id, canonical URL (ignoring utm_*), and cross-channel 60-day fingerprint
    assert.equal(
      normalizeCanonicalUrl('https://www.boards.greenhouse.io/alpha/jobs/1/?utm_source=x&refId=abc&gh_jid=1'),
      'https://boards.greenhouse.io/alpha/jobs/1',
    );
    const gateDupId = evaluatePreSubmitGate(work, { platform: 'linkedin', job_id: 'LI:RES1' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateDupId.allowed, false);
    assert.ok(gateDupId.violations.some(v => v.code === 'duplicate_job_id'));

    const gateDupUrl = evaluatePreSubmitGate(work, { platform: 'wellfound', url: 'https://boards.greenhouse.io/alpha/jobs/1?utm_campaign=job', job_id: 'wf:dupurl' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateDupUrl.allowed, false);
    assert.ok(gateDupUrl.violations.some(v => v.code === 'duplicate_canonical_url'));

    const gateDupFp = evaluatePreSubmitGate(work, { platform: 'wellfound', company: 'AlphaCo', title: 'Backend Eng', job_id: 'wf:dupfp' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(gateDupFp.allowed, false);
    assert.ok(gateDupFp.violations.some(v => v.code === 'duplicate_cross_channel'));

    // 11f. Adding 5th reservation blocks the 6th at warm-up cap 5/5!
    const res5 = reserveApplicationSubmission(work, { job_id: 'wf:fifth', company: 'FifthCo', title: 'Staff Eng', platform: 'wellfound' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(res5.reserved, true);
    assert.throws(
      () => reserveApplicationSubmission(work, { job_id: 'wf:sixth', company: 'SixthCo', title: 'Staff Eng', platform: 'wellfound' }, { home, nowIso, sourceRoot: REPO_ROOT }),
      /daily_cap_reached/i,
    );

    // 11g. computeWorkspaceStatusMetrics / cmdStatus alignment: 22-day silent applied is silent_14d, NOT rejected; 3P excluded; MIN_N=5 respected
    const st = computeWorkspaceStatusMetrics(work, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(st.daily_cap.today, 5);
    assert.equal(st.daily_cap.submission_uncertain_today, 2);
    assert.equal(st.pipeline.applied, 4); // 3 today + 1 silent20 (3P excluded, uncertain not counted as applied)
    assert.equal(st.pipeline.rejected, 0, '14+ day silence must NEVER be counted as confirmed rejection');
    assert.equal(st.pipeline.rejected_or_ghosted, 0);
    assert.equal(st.pipeline.silent_14d, 1);
    assert.equal(st.third_party_excluded, 1);
    assert.match(st.top_platform, /insufficient sample|MIN_N=5/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('12. Stage 5 (T11.5): End-to-end scoped CLI lifecycle, pre-submit JSON/flags, recovery commands & error handling', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t11-cli-');
  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
    const cvFile = path.join(work, 'logs', 'resumes', 'acme-901', 'resume.html');
    fs.mkdirSync(path.dirname(cvFile), { recursive: true });
    fs.writeFileSync(cvFile, '<html><body><h1>Synthetic Owner</h1><p>TypeScript</p></body></html>');

    // 1. career record
    const r1 = runCli([
      'career', 'record',
      '--job-id', 'lever:acme-901',
      '--status', 'prepared',
      '--company', 'Acme Cloud',
      '--title', 'Senior Full-Stack Engineer',
      '--platform', 'lever',
      '--url', 'https://jobs.lever.co/acme/901',
      '--match-score', '8.8',
      '--json',
    ], { cwd: work, home });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const r1j = JSON.parse(r1.stdout);
    assert.equal(r1j.action, 'created');
    assert.equal(r1j.status, 'prepared');

    // 2. career cv-register with application link
    const rCv = runCli([
      'career', 'cv-register',
      '--id', 'cv-acme-901',
      '--label', 'Acme Fullstack Tailored',
      '--kind', 'tailored',
      '--file', 'logs/resumes/acme-901/resume.html',
      '--link-job-id', 'lever:acme-901',
      '--ats-before', '72',
      '--ats-after', '93',
      '--json',
    ], { cwd: work, home });
    assert.equal(rCv.status, 0, rCv.stdout + rCv.stderr);
    const rCvJ = JSON.parse(rCv.stdout);
    assert.equal(rCvJ.registered, true);
    assert.equal(rCvJ.linked_application_id, r1j.application_id);

    // 3. pre-submit with candidate flags & --json
    const rPre = runCli([
      'pre-submit',
      '--platform', 'lever',
      '--company', 'Acme Cloud',
      '--title', 'Senior Full-Stack Engineer',
      '--url', 'https://jobs.lever.co/acme/901',
      '--job-id', 'lever:acme-901',
      '--text', 'Short grounded note under seventy-five words.',
      '--json',
    ], { cwd: work, home });
    assert.equal(rPre.status, 0, rPre.stdout + rPre.stderr);
    assert.equal(JSON.parse(rPre.stdout).allowed, true);

    // 4. career reserve -> pre-submit now blocks duplicate reservation!
    const rRes = runCli(['career', 'reserve', '--job-id', 'lever:acme-901', '--json'], { cwd: work, home });
    assert.equal(rRes.status, 0, rRes.stdout + rRes.stderr);
    assert.equal(JSON.parse(rRes.stdout).submission_uncertain, true);

    const rPreDup = runCli(['pre-submit', '--job-id', 'lever:acme-901', '--json'], { cwd: work, home });
    assert.notEqual(rPreDup.status, 0);
    assert.equal(JSON.parse(rPreDup.stdout).allowed, false);

    // 5. career confirm-submit
    const rConf = runCli([
      'career', 'confirm-submit',
      '--job-id', 'lever:acme-901',
      '--receipt', 'Application received by Acme Cloud',
      '--json',
    ], { cwd: work, home });
    assert.equal(rConf.status, 0, rConf.stdout + rConf.stderr);
    assert.equal(JSON.parse(rConf.stdout).status, 'applied');

    // 6. career transition (interview + assessment)
    const rTrn = runCli([
      'career', 'transition',
      '--job-id', 'lever:acme-901',
      '--to', 'interview',
      '--source', 'recruiter_inbox_triage',
      '--stage', 'technical_screen',
      '--round', '1',
      '--notes', 'Recruiter call booked',
      '--json',
    ], { cwd: work, home });
    assert.equal(rTrn.status, 0, rTrn.stdout + rTrn.stderr);
    assert.equal(JSON.parse(rTrn.stdout).to_status, 'interview');

    // 7. career skip
    const rSkip = runCli([
      'career', 'skip',
      '--job-id', 'gh:ghost-404',
      '--reason', 'ghost_or_expired',
      '--skip-reason', 'Listing shows closed banner',
      '--company', 'GhostCo',
      '--title', 'Old Eng',
      '--json',
    ], { cwd: work, home });
    assert.equal(rSkip.status, 0, rSkip.stdout + rSkip.stderr);
    assert.equal(JSON.parse(rSkip.stdout).action, 'created');

    // 8. career lock-status, summary, analytics, status --json
    const rLock = runCli(['career', 'lock-status', '--json'], { cwd: work, home });
    assert.equal(rLock.status, 0, rLock.stdout + rLock.stderr);
    assert.equal(JSON.parse(rLock.stdout).lock.locked, false);
    assert.equal(JSON.parse(rLock.stdout).transaction.pending, false);

    const rSum = runCli(['career', 'summary', '--json'], { cwd: work, home });
    assert.equal(rSum.status, 0, rSum.stdout + rSum.stderr);
    assert.equal(JSON.parse(rSum.stdout).funnel.submitted_count, 1);
    assert.equal(JSON.parse(rSum.stdout).active_interviews, 1);

    const rSt = runCli(['status', '--json'], { cwd: work, home });
    assert.equal(rSt.status, 0, rSt.stdout + rSt.stderr);
    const stJson = JSON.parse(rSt.stdout);
    assert.equal(stJson.pipeline.applied, 1);
    assert.equal(stJson.pipeline.interviewing, 1);
    assert.equal(stJson.pipeline.silent_14d, 0);

    // 9. Unknown flags, missing required args & invalid transitions fail non-zero cleanly
    for (const badCmd of [
      ['career', 'record'],
      ['career', 'record', '--job-id', 'x:1', '--unknown-flag', 'val'],
      ['career', 'confirm-submit', '--job-id', 'lever:acme-901'],
      ['career', 'transition', '--job-id', 'lever:acme-901', '--to', 'invalid_status'],
      ['career', 'skip', '--job-id', 'x:2'],
      ['career', 'cv-register', '--id', 'only-id'],
      ['pre-submit', '--bogus-flag'],
    ]) {
      const bad = runCli(badCmd, { cwd: work, home });
      assert.notEqual(bad.status, 0, `Expected non-zero exit for: ${badCmd.join(' ')}`);
    }

    // 10. Verify logs/sync-state.json was NEVER created or mutated by T11 ledger writes
    assert.equal(fs.existsSync(path.join(work, 'logs', 'sync-state.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('13. Stage 6 (T12.1): Run ledger & session checkpoint state machine, ledger-derived counts, 3-error auto-abort, and resume reconciliation', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t12-run-cp-');
  const runId = '2026-11-23';
  const t0 = `${runId}T09:00:00Z`;
  const t1 = `${runId}T09:15:00Z`;
  const t2 = `${runId}T09:30:00Z`;
  const t3 = `${runId}T09:45:00Z`;

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));

    // 13a. validateSessionCheckpoint enforces schema, submission_authorized === false, and secret token checks
    assert.ok(RUN_PHASES.includes('applying') && WORKFLOW_MODES.includes('batch_review_first'));
    const badCp = validateSessionCheckpoint({
      kind: 'session_checkpoint',
      version: 1,
      run_id: runId,
      updated_at: t0,
      phase: 'applying',
      workflow_mode: 'batch_review_first',
      dry_run: true,
      approval_mode: 'approve_before_submit',
      submission_authorized: true,
      caps: { effective_daily_cap: 5, applied_today: 0, reserved_unresolved: 0, per_platform_applied: {} },
      processed_job_ids: ['gh:dup-1'],
      queue: ['gh:dup-1'],
      awaiting_owner: [{ job_id: 'gh:q1', question: `Token ${['sk', '1234567890abcdef123456'].join('-')}` }],
      batch_selection: null,
      consecutive_errors: 0,
      next_action: 'ok',
      notes: '',
    });
    assert.equal(badCp.valid, false);
    assert.ok(badCp.errors.some(e => /submission_authorized must always be false/i.test(e)));
    assert.ok(badCp.errors.some(e => /cannot also appear in processed_job_ids/i.test(e)));
    assert.ok(badCp.errors.some(e => /prohibited credential or token pattern/i.test(e)));

    // 13b. Start daily run and seed ledger records (including third-party record that must be excluded)
    const started = startOrUpdateDailyRun(work, {
      run_id: runId,
      workflow_mode: 'batch_review_first',
      platforms: ['greenhouse', 'linkedin'],
      notes: 'Morning run',
    }, { home, sourceRoot: REPO_ROOT, nowIso: t0 });
    assert.equal(started.action, 'started');
    assert.equal(started.run.status, 'running');
    assert.equal(started.checkpoint.phase, 'readiness');
    assert.equal(started.checkpoint.submission_authorized, false);

    recordApplication(work, { job_id: 'gh:job-1', company: 'Alpha', title: 'Backend Eng', platform: 'greenhouse', status: 'prepared', match_score: 8.7, run_id: runId }, { home, nowIso: t0, sourceRoot: REPO_ROOT });
    recordApplication(work, { job_id: 'gh:job-2', company: 'Beta', title: 'Platform Eng', platform: 'greenhouse', status: 'discovered', match_score: 8.2, run_id: runId }, { home, nowIso: t0, sourceRoot: REPO_ROOT });
    recordApplication(work, { job_id: 'li:job-dry', company: 'DryCo', title: 'API Eng', platform: 'linkedin', status: 'dry_run', match_score: 8.0, run_id: runId }, { home, nowIso: t0, sourceRoot: REPO_ROOT });
    recordApplication(work, { job_id: 'li:3p-job', company: 'ThirdParty', title: 'Eng', platform: 'linkedin', status: 'prepared', run_id: runId, third_party_subject: true }, { home, nowIso: t0, sourceRoot: REPO_ROOT });
    recordSkippedJob(work, { job_id: 'gh:ghost-9', company: 'Ghost', title: 'Old', platform: 'greenhouse', reason: 'ghost_or_expired', skip_reason: 'Closed 60d ago', run_id: runId }, { home, nowIso: t0 });

    // 13c. writeSessionCheckpoint derives counts from ledger and reconciles dry_run out of queue
    const cp1 = writeSessionCheckpoint(work, {
      run_id: runId,
      phase: 'applying',
      queue: ['gh:job-1', 'gh:job-2', 'li:job-dry'],
      batch_selection: 'APPLY 1,2',
      awaiting_job_id: 'gh:job-2',
      awaiting_question: 'Notice period in weeks?',
    }, { home, sourceRoot: REPO_ROOT, nowIso: t1 });
    assert.equal(cp1.checkpointed, true);
    assert.deepEqual(cp1.checkpoint.queue, ['gh:job-1', 'gh:job-2'], 'li:job-dry is already handled in ledger and moved out of queue');
    assert.ok(cp1.checkpoint.processed_job_ids.includes('li:job-dry'));
    assert.equal(cp1.run.counts.scanned, 4, '3 owner apps + 1 skipped job (3P excluded)');
    assert.equal(cp1.run.counts.prepared, 1);
    assert.equal(cp1.run.counts.dry_run, 1);
    assert.equal(cp1.run.counts.skipped, 1);
    assert.equal(cp1.run.counts.applied, 0);

    // 13d. Reserve and confirm gh:job-1 out-of-band, then test resumeSessionCheckpoint: ledger wins & expires prior approval!
    reserveApplicationSubmission(work, { job_id: 'gh:job-1', company: 'Alpha', title: 'Backend Eng', platform: 'greenhouse' }, { home, nowIso: t2, sourceRoot: REPO_ROOT });
    // While gh:job-1 has unresolved submission_uncertain=true, attempting to advance checkpoint to "logging" or finish as "completed" MUST fail closed!
    assert.throws(
      () => writeSessionCheckpoint(work, { run_id: runId, phase: 'logging' }, { home, sourceRoot: REPO_ROOT, nowIso: t2 }),
      /unresolved_submission_uncertain/i,
    );
    assert.throws(
      () => finishDailyRun(work, { run_id: runId, status: 'completed' }, { home, sourceRoot: REPO_ROOT, nowIso: t2 }),
      /unresolved_submission_uncertain/i,
    );

    // Confirm submission receipt for gh:job-1
    confirmApplicationSubmission(work, { job_id: 'gh:job-1', receipt: 'Application submitted to Alpha' }, { home, nowIso: t2 });

    // Resume checkpoint: gh:job-1 must be removed from queue -> processed_job_ids, caps updated to applied_today=1, approval_expired_on_resume=true
    const resumed = resumeSessionCheckpoint(work, { run_id: runId }, { home, sourceRoot: REPO_ROOT, nowIso: t3 });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.approval_expired_on_resume, true);
    assert.equal(resumed.submission_authorized, false);
    assert.equal(resumed.discrepancies_reconciled, true);
    assert.deepEqual(resumed.moved_to_processed, ['gh:job-1']);
    assert.deepEqual(resumed.checkpoint.queue, ['gh:job-2']);
    assert.equal(resumed.checkpoint.caps.applied_today, 1);
    assert.equal(resumed.run.counts.applied, 1);

    // 13e. Finish daily run cleanly -> status=completed, phase=finished, queue=[], and refusing subsequent resume
    const finished = finishDailyRun(work, { run_id: runId, status: 'completed', notes: 'Completed batch' }, { home, sourceRoot: REPO_ROOT, nowIso: t3 });
    assert.equal(finished.status, 'completed');
    assert.equal(finished.phase, 'finished');
    assert.deepEqual(finished.checkpoint.queue, []);
    assert.throws(
      () => resumeSessionCheckpoint(work, { run_id: runId }, { home, sourceRoot: REPO_ROOT, nowIso: t3 }),
      /cannot_resume_closed_run/i,
    );

    // 13f. 3 consecutive errors MUST auto-abort an active run fail-closed
    const runId2 = '2026-11-24';
    startOrUpdateDailyRun(work, { run_id: runId2 }, { home, sourceRoot: REPO_ROOT, nowIso: `${runId2}T10:00:00Z` });
    const abortedCp = writeSessionCheckpoint(work, {
      run_id: runId2,
      phase: 'applying',
      consecutive_errors: 3,
    }, { home, sourceRoot: REPO_ROOT, nowIso: `${runId2}T10:10:00Z` });
    assert.equal(abortedCp.auto_aborted, true);
    assert.equal(abortedCp.phase, 'aborted');
    assert.equal(abortedCp.run_status, 'aborted');
    assert.ok(abortedCp.run.errors.some(e => /consecutive_errors=3/i.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('14. Stage 6 (T12.2): Deterministic job triage (Tier A/B/C, ghost/blacklist/dealbreaker) & Mission Control queue two-stage approval boundary', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t12-triage-');
  const runId = '2026-11-23';
  const nowIso = `${runId}T10:00:00Z`;

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.writeFileSync(
      path.join(work, 'context', 'preferences.yaml'),
      [
        'min_match_score: 7.5',
        'active_persona: "backend-architect"',
        'exclude_keywords: ["Intern", "Unpaid"]',
        'blacklisted_companies: ["BadVendor Corp"]',
        'blacklisted_domains: ["spamboard.example"]',
      ].join('\n') + '\n',
    );

    const prefs = readWorkspaceTargetingPreferences(work, { home });
    assert.equal(prefs.min_match_score, 7.5);
    assert.equal(prefs.active_persona, 'backend-architect');
    assert.deepEqual(prefs.exclude_keywords, ['intern', 'unpaid']);

    startOrUpdateDailyRun(work, { run_id: runId }, { home, sourceRoot: REPO_ROOT, nowIso });

    // 14a. Tier A role (score >= 8.0 and >= min_match_score)
    const tierA = triageJobForWorkflow(work, {
      job_id: 'gh:tier-a-1',
      company: 'NovaPay',
      title: 'Senior Backend Engineer',
      platform: 'greenhouse',
      url: 'https://boards.greenhouse.io/novapay/jobs/101',
      match_score: 8.8,
      matched_skills: ['Node.js', 'PostgreSQL'],
      missing_skills: ['Go'],
      run_id: runId,
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(tierA.tier, 'A');
    assert.equal(tierA.status, 'discovered');
    assert.equal(tierA.eligible_for_queue, true);
    assert.equal(tierA.tailoring_needed, true);
    assert.equal(tierA.record.persona_id, 'backend-architect');

    // 14b. Tier B role below min_match_score (score 6.5 < 7.5 -> needs_review, still eligible if owner selects)
    const tierB = triageJobForWorkflow(work, {
      job_id: 'gh:tier-b-2',
      company: 'OrbitCloud',
      title: 'Platform Engineer',
      platform: 'greenhouse',
      url: 'https://boards.greenhouse.io/orbit/jobs/102',
      match_score: 6.5,
      matched_skills: ['Docker'],
      missing_skills: ['Kubernetes'],
      run_id: runId,
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(tierB.tier, 'B');
    assert.equal(tierB.status, 'needs_review');
    assert.equal(tierB.disposition, 'stretch_needs_review');
    assert.equal(tierB.eligible_for_queue, true);

    // 14c. Tier C roles (ghost, blacklisted, excluded keyword, score < 5) recorded atomically in both skipped-jobs.json & applications-log.json
    const tierCGhost = triageJobForWorkflow(work, {
      job_id: 'gh:tier-c-ghost',
      company: 'OldCo',
      title: 'Backend Engineer',
      platform: 'greenhouse',
      match_score: 8.5,
      ghost_or_expired: true,
      notes: 'Job closed banner visible',
      run_id: runId,
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(tierCGhost.tier, 'C');
    assert.equal(tierCGhost.status, 'skipped');
    assert.equal(tierCGhost.skip_reason_code, 'ghost_or_expired');
    assert.equal(tierCGhost.eligible_for_queue, false);

    const tierCBlack = triageJobForWorkflow(work, {
      job_id: 'li:tier-c-bl',
      company: 'BadVendor Corp Global',
      title: 'Backend Engineer',
      platform: 'linkedin',
      match_score: 9.0,
      run_id: runId,
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(tierCBlack.tier, 'C');
    assert.equal(tierCBlack.skip_reason_code, 'blacklisted_employer');

    const tierCLow = triageJobForWorkflow(work, {
      job_id: 'li:tier-c-low',
      company: 'MismatchCo',
      title: 'iOS Swift Engineer',
      platform: 'linkedin',
      match_score: 3.2,
      run_id: runId,
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(tierCLow.tier, 'C');
    assert.equal(tierCLow.skip_reason_code, 'mismatch');

    const skippedLedger = readValidatedSkippedJobs(work, { home }).records;
    assert.equal(skippedLedger.length, 3);

    // 14d. enqueueSelectedRunJobs enforces Boundary 1: accepts Tier A/B, rejects Tier C, skipped, submitted, uncertain, third-party, and keeps submission_authorized=false
    assert.throws(
      () => enqueueSelectedRunJobs(work, { run_id: runId, job_ids: ['gh:tier-a-1', 'gh:tier-c-ghost'] }, { home, sourceRoot: REPO_ROOT, nowIso }),
      /ineligible_job_status/i,
    );
    assert.throws(
      () => enqueueSelectedRunJobs(work, { run_id: runId, job_ids: ['gh:unknown-job'] }, { home, sourceRoot: REPO_ROOT, nowIso }),
      /job_not_found_in_ledger/i,
    );
    recordApplication(work, { job_id: 'li:3p-isolated', company: '3P', title: 'Eng', status: 'discovered', third_party_subject: true }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.throws(
      () => enqueueSelectedRunJobs(work, { run_id: runId, job_ids: ['li:3p-isolated'] }, { home, sourceRoot: REPO_ROOT, nowIso }),
      /third_party_blocked/i,
    );

    const enq = enqueueSelectedRunJobs(work, {
      run_id: runId,
      job_ids: ['gh:tier-a-1', 'gh:tier-b-2'],
      batch_selection: 'APPLY 1,2',
    }, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(enq.enqueued, true);
    assert.equal(enq.submission_authorized, false, 'Batch selection must NEVER authorize final submission');
    assert.deepEqual(enq.queue, ['gh:tier-a-1', 'gh:tier-b-2']);
    assert.equal(enq.checkpoint.phase, 'applying');
    assert.equal(enq.checkpoint.submission_authorized, false);

    // Verify neither job was marked applied or reserved by enqueueing
    const appsAfterEnq = readValidatedApplicationsLedger(work, { home }).records;
    for (const id of ['gh:tier-a-1', 'gh:tier-b-2']) {
      const rec = appsAfterEnq.find(r => r.job_id === id);
      assert.notEqual(rec.status, 'applied');
      assert.equal(rec.submission_uncertain, false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('15. Stage 6 (T12.3): Context-aware owner CV selection, cv-* folder collision guard, third-party exclusion & preparation package verification', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t12-prep-');
  const nowIso = '2026-11-23T11:00:00Z';

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.writeFileSync(path.join(work, 'context', 'preferences.yaml'), 'active_persona: "ai-engineer"\n');

    // 15a. computeCanonicalResumeFolderRel prevents owner company "CV" from colliding with reserved logs/resumes/cv-<slug>/
    const safeRel = computeCanonicalResumeFolderRel('CV Partners', 'Backend Engineer', 'gh:101');
    assert.match(safeRel, /^logs\/resumes\/job-cv-partners-/);
    assert.equal( safeRel.startsWith('logs/resumes/cv-'), false );

    // 15b. Register owner CVs + seed a third-party entry in cv-versions.json to verify strict exclusion
    const genericHtml = path.join(work, 'logs', 'resumes', 'base-generic', 'resume.html');
    const aiHtml = path.join(work, 'logs', 'resumes', 'base-ai', 'resume.html');
    const jobTailoredHtml = path.join(work, 'logs', 'resumes', 'novapay-senior-ai-engineer-gh-201', 'resume.html');
    for (const f of [genericHtml, aiHtml, jobTailoredHtml]) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, '<!doctype html><html><head><title>Synthetic Candidate</title></head><body><h1>Synthetic Candidate</h1><p>Built Node.js and TypeScript distributed systems.</p><ul><li>Shipped API gateway handling 1200 requests per second.</li></ul></body></html>');
    }

    registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-owner-generic-v1',
      label: 'Generic Fullstack Resume',
      kind: 'generic',
      file: 'logs/resumes/base-generic/resume.html',
      persona_id: 'fullstack',
      language: 'en',
      hygiene_score: 88,
    }, { home, nowIso });

    registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-owner-ai-v2',
      label: 'AI Engineer Persona Resume',
      kind: 'generic',
      file: 'logs/resumes/base-ai/resume.html',
      version_number: 2,
      persona_id: 'ai-engineer',
      language: 'en',
      target_role: 'Senior AI Engineer',
      emphasized_skills: ['TypeScript', 'Node.js', 'LLM'],
      hygiene_score: 95,
    }, { home, nowIso });

    // Inject an isolated third-party CV version directly into cv-versions.json to prove selectBestOwnerCvVersion & prepareApplicationPackage never select or link it
    const cvRegLoaded = readValidatedCvRegistry(work, { home });
    cvRegLoaded.registry.versions.push({
      cv_version_id: 'cv-third-party-friend',
      version_number: 99,
      label: 'Friend Senior AI Engineer CV',
      kind: 'tailored',
      owner_scope: 'third_party',
      base_cv_version_id: null,
      content_sha256: null,
      persona_id: 'ai-engineer',
      language: 'en',
      created_at: nowIso,
      updated_at: nowIso,
      local_ref_rel: 'logs/resumes/cv-friend-john/resume.html',
      tailoring_metadata: { target_job_id: 'gh:201-tp-sel', target_role: 'Senior AI Engineer', emphasized_skills: ['TypeScript', 'Node.js', 'LLM'] },
      ats_metrics: { keyword_match_before_pct: 90, keyword_match_after_pct: 99, hygiene_score: 100, page_count: 1 },
      application_ids: [],
    });
    fs.writeFileSync(cvRegLoaded.path, JSON.stringify(cvRegLoaded.registry, null, 2));

    // Select for gh:201-tp-sel before job-specific CV is registered: must pick cv-owner-ai-v2 (never cv-third-party-friend even with exact target_job_id match!)
    const sel1 = selectBestOwnerCvVersion(work, {
      job_id: 'gh:201-tp-sel',
      title: 'Senior AI Engineer',
      matched_skills: ['TypeScript', 'Node.js'],
      missing_skills: ['Rust'],
      match_score: 8.9,
    }, { home });
    assert.equal(sel1.selected_cv_version_id, 'cv-owner-ai-v2');
    assert.equal(sel1.third_party_excluded, 1);
    assert.equal(sel1.tailoring_recommended, true);

    // 15c. Triage gh:201 and test prepareApplicationPackage failure on missing/bad artifacts (placeholders, AI cliché, em-dash, >75w outreach)
    triageJobForWorkflow(work, {
      job_id: 'gh:201',
      company: 'NovaPay',
      title: 'Senior AI Engineer',
      platform: 'greenhouse',
      match_score: 8.9,
      matched_skills: ['TypeScript', 'Node.js'],
    }, { home, sourceRoot: REPO_ROOT, nowIso });

    const jobFolder = path.dirname(jobTailoredHtml);
    // Missing tailoring-notes.md -> must fail when require_ready=true
    assert.throws(
      () => prepareApplicationPackage(work, { job_id: 'gh:201' }, { home, nowIso }),
      /missing tailoring-notes\.md/i,
    );

    // Write tailoring-notes.md, but inject a {{PLACEHOLDER}}, banned cliché, and prose em-dash into resume.txt & outreach-draft.md
    fs.writeFileSync(path.join(jobFolder, 'tailoring-notes.md'), '# Tailoring Notes\n- Emphasized Node.js — verified.\n');
    fs.writeFileSync(path.join(jobFolder, 'resume.txt'), 'Synthetic Candidate\nSpearheaded synergy — {{UNRESOLVED_TOKEN}}\n');
    fs.writeFileSync(path.join(jobFolder, 'outreach-draft.md'), Array(80).fill('word').join(' '));

    assert.throws(
      () => prepareApplicationPackage(work, { job_id: 'gh:201' }, { home, nowIso }),
      /unresolved template placeholder|banned AI cliché|prose em-dash|outreach word cap exceeded/i,
    );

    // Refuses linking third-party CV version
    assert.throws(
      () => prepareApplicationPackage(work, { job_id: 'gh:201', cv_version_id: 'cv-third-party-friend', require_ready: false }, { home, nowIso }),
      /third_party_blocked/i,
    );

    // Clean artifacts -> prepareApplicationPackage succeeds, transitions to status="prepared", links cv_version_id & cv_tailoring
    fs.writeFileSync(path.join(jobFolder, 'resume.txt'), 'Synthetic Candidate\nBuilt Node.js and TypeScript distributed systems.\n');
    fs.writeFileSync(path.join(jobFolder, 'outreach-draft.md'), 'Hi NovaPay team, I applied for the Senior AI Engineer role and built high-throughput Node.js and TypeScript services.');

    registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-novapay-201',
      label: 'NovaPay Tailored AI Resume',
      kind: 'tailored',
      file: 'logs/resumes/novapay-senior-ai-engineer-gh-201/resume.html',
      base_cv_version_id: 'cv-owner-ai-v2',
      persona_id: 'ai-engineer',
      target_role: 'Senior AI Engineer',
      target_job_id: 'gh:201',
      ats_keyword_before_pct: 68,
      ats_keyword_after_pct: 94,
    }, { home, nowIso });

    const prep = prepareApplicationPackage(work, {
      job_id: 'gh:201',
      ats_keyword_before_pct: 68,
      ats_keyword_after_pct: 94,
    }, { home, nowIso });
    assert.equal(prep.prepared, true);
    assert.equal(prep.submission_authorized, false);
    assert.equal(prep.status, 'prepared');
    assert.equal(prep.cv_version_id, 'cv-novapay-201');
    assert.equal(prep.cv_tailoring.is_tailored, true);
    assert.equal(prep.cv_tailoring.base_cv_version_id, 'cv-owner-ai-v2');
    assert.equal(prep.cv_tailoring.ats_keyword_after_pct, 94);
    assert.equal(prep.cv_tailoring.tailored_folder_rel, 'logs/resumes/novapay-senior-ai-engineer-gh-201');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('16. Stage 6 (T12.4): Read-only workflow & post-application action queue planner (blockers, prep queue, 7d follow-ups, interviews/assessments, 14d silence != rejection)', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t12-next-');
  const nowIso = '2026-11-23T12:00:00Z';

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));

    // Empty workspace works safely and read-only
    const emptyPlan = computeCareerWorkflowQueue(work, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.equal(emptyPlan.read_only, true);
    assert.equal(emptyPlan.blockers.length, 0);

    // Seed:
    // 1) An unresolved submission_uncertain reservation (P0_BLOCKER)
    // 2) A prepared role in active run queue (P1_ACTIVE_RUN)
    // 3) An applied role 9 days old needing 7d follow-up (P3_POST_APPLY)
    // 4) An applied role 18 days old with zero reply (silent_14d — never rejected!)
    // 5) An interview role + assessment role (P3_POST_APPLY)
    // 6) An isolated third-party role (must be excluded)
    recordApplication(work, { job_id: 'gh:prep-1', company: 'PrepCo', title: 'Backend Eng', platform: 'greenhouse', status: 'prepared', match_score: 9.1 }, { home, nowIso, sourceRoot: REPO_ROOT });
    recordApplication(work, { job_id: 'gh:uncertain-1', company: 'UncertainCo', title: 'API Eng', platform: 'greenhouse', status: 'discovered', match_score: 8.4 }, { home, nowIso, sourceRoot: REPO_ROOT });
    reserveApplicationSubmission(work, { job_id: 'gh:uncertain-1', company: 'UncertainCo', title: 'API Eng', platform: 'greenhouse' }, { home, nowIso, sourceRoot: REPO_ROOT });

    // Applied 9 days ago (overdue 7d follow-up)
    recordApplication(work, { job_id: 'li:fu-9d', company: 'FollowCo', title: 'Fullstack Eng', platform: 'linkedin', status: 'prepared', match_score: 8.5, discovered_at: '2026-11-14T09:00:00Z' }, { home, nowIso: '2026-11-14T09:00:00Z', sourceRoot: REPO_ROOT });
    confirmApplicationSubmission(work, { job_id: 'li:fu-9d', receipt: 'Submitted to FollowCo', applied_at: '2026-11-14T10:00:00Z' }, { home, nowIso: '2026-11-14T10:00:00Z' });

    // Applied 18 days ago (silent >=14d AND overdue follow-up, never classified as rejected)
    recordApplication(work, { job_id: 'li:silent-18d', company: 'SilentCo', title: 'Platform Eng', platform: 'linkedin', status: 'prepared', match_score: 8.2, discovered_at: '2026-11-05T09:00:00Z' }, { home, nowIso: '2026-11-05T09:00:00Z', sourceRoot: REPO_ROOT });
    confirmApplicationSubmission(work, { job_id: 'li:silent-18d', receipt: 'Submitted to SilentCo', applied_at: '2026-11-05T10:00:00Z' }, { home, nowIso: '2026-11-05T10:00:00Z' });

    // Active interview & assessment
    recordApplication(work, { job_id: 'lv:iv-1', company: 'InterviewCo', title: 'Staff Eng', platform: 'lever', status: 'prepared', match_score: 9.3, discovered_at: '2026-11-10T09:00:00Z' }, { home, nowIso: '2026-11-10T09:00:00Z', sourceRoot: REPO_ROOT });
    confirmApplicationSubmission(work, { job_id: 'lv:iv-1', receipt: 'Submitted to InterviewCo', applied_at: '2026-11-10T10:00:00Z' }, { home, nowIso: '2026-11-10T10:00:00Z' });
    transitionApplicationStage(work, {
      job_id: 'lv:iv-1',
      to_status: 'interview',
      source: 'recruiter_inbox_triage',
      at: '2026-11-15T10:00:00Z',
      interview: { round: 1, stage: 'technical_screen', status: 'scheduled', scheduled_at: '2026-11-25T15:00:00Z' },
    }, { home, nowIso: '2026-11-15T10:00:00Z' });

    // Isolated third-party record
    recordApplication(work, { job_id: 'li:3p-ignored', company: 'ThirdParty', title: 'Eng', status: 'prepared', match_score: 9.9, third_party_subject: true }, { home, nowIso, sourceRoot: REPO_ROOT });

    const ledgerHashBefore = sha256File(path.join(work, 'logs', 'applications-log.json'));
    const plan = computeCareerWorkflowQueue(work, { home, sourceRoot: REPO_ROOT, nowIso });
    const ledgerHashAfter = sha256File(path.join(work, 'logs', 'applications-log.json'));
    assert.equal(ledgerHashAfter, ledgerHashBefore, 'computeCareerWorkflowQueue must be strictly read-only');

    assert.equal(plan.third_party_excluded, 1);
    assert.ok(plan.blockers.some(b => b.code === 'unresolved_submission_uncertain' && b.job_id === 'gh:uncertain-1'));
    assert.equal(plan.next_actions[0].priority, 'P0_BLOCKER');
    assert.equal(plan.next_actions[0].code, 'unresolved_submission_uncertain');
    assert.equal(plan.preparation_queue.length, 1);
    assert.equal(plan.preparation_queue[0].job_id, 'gh:prep-1');
    assert.equal(plan.post_application.overdue_follow_ups.length, 2);
    assert.equal(plan.post_application.active_interviews.length, 1);
    assert.equal(plan.post_application.silent_14d_hygiene.length, 1);
    assert.equal(plan.post_application.silent_14d_hygiene[0].job_id, 'li:silent-18d');
    assert.equal(plan.post_application.silent_14d_hygiene[0].classification, 'silent_14d');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('17. Stage 6 (T12.5): End-to-end CLI workflow (run-start -> run-triage -> run-enqueue -> cv-register -> prepare -> run-checkpoint -> run-resume -> next -> run-finish -> verify checkpoint)', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t12-cli-e2e-');
  const runId = '2026-11-23';

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
    fs.writeFileSync(path.join(work, 'context', 'preferences.yaml'), 'min_match_score: 7\nactive_persona: "backend"\n');

    // 1. run-start
    const rStart = runCli(['career', 'run-start', '--run-id', runId, '--platforms', 'greenhouse,lever', '--json'], { cwd: work, home });
    assert.equal(rStart.status, 0, rStart.stdout + rStart.stderr);
    assert.equal(JSON.parse(rStart.stdout).run_id, runId);

    // 2. run-triage (Tier A, Tier B, Tier C ghost)
    const rTrA = runCli([
      'career', 'run-triage',
      '--job-id', 'gh:nova-501',
      '--company', 'Nova Systems',
      '--title', 'Senior Backend Engineer',
      '--platform', 'greenhouse',
      '--url', 'https://boards.greenhouse.io/nova/jobs/501',
      '--match-score', '9.0',
      '--matched-skills', 'Node.js,PostgreSQL',
      '--run-id', runId,
      '--json',
    ], { cwd: work, home });
    assert.equal(rTrA.status, 0, rTrA.stdout + rTrA.stderr);
    assert.equal(JSON.parse(rTrA.stdout).tier, 'A');

    const rTrB = runCli([
      'career', 'run-triage',
      '--job-id', 'lv:orbit-502',
      '--company', 'Orbit Labs',
      '--title', 'Platform Engineer',
      '--platform', 'lever',
      '--match-score', '7.2',
      '--run-id', runId,
      '--json',
    ], { cwd: work, home });
    assert.equal(rTrB.status, 0, rTrB.stderr);
    assert.equal(JSON.parse(rTrB.stdout).tier, 'B');

    const rTrC = runCli([
      'career', 'run-triage',
      '--job-id', 'gh:ghost-503',
      '--company', 'Ghost Corp',
      '--title', 'Legacy Eng',
      '--platform', 'greenhouse',
      '--match-score', '8.1',
      '--ghost',
      '--run-id', runId,
      '--json',
    ], { cwd: work, home });
    assert.equal(rTrC.status, 0, rTrC.stderr);
    assert.equal(JSON.parse(rTrC.stdout).tier, 'C');

    // 3. run-enqueue (Tier A + Tier B; verify Tier C is rejected)
    const rEnqBad = runCli(['career', 'run-enqueue', '--job-ids', 'gh:ghost-503', '--run-id', runId, '--json'], { cwd: work, home });
    assert.notEqual(rEnqBad.status, 0);

    const rEnq = runCli([
      'career', 'run-enqueue',
      '--job-ids', 'gh:nova-501,lv:orbit-502',
      '--batch-selection', 'APPLY 1,2',
      '--run-id', runId,
      '--json',
    ], { cwd: work, home });
    assert.equal(rEnq.status, 0, rEnq.stdout + rEnq.stderr);
    const enqJ = JSON.parse(rEnq.stdout);
    assert.equal(enqJ.submission_authorized, false);
    assert.deepEqual(enqJ.queue, ['gh:nova-501', 'lv:orbit-502']);

    // 4. Scaffold tailored deliverables for gh:nova-501, register CV version, and run `career prepare`
    const folderRel = computeCanonicalResumeFolderRel('Nova Systems', 'Senior Backend Engineer', 'gh:nova-501');
    const folderAbs = path.join(work, folderRel);
    fs.mkdirSync(folderAbs, { recursive: true });
    fs.writeFileSync(path.join(folderAbs, 'resume.html'), '<!doctype html><html><body><h1>Synthetic Owner</h1><p>Built Node.js and PostgreSQL backends.</p></body></html>');
    fs.writeFileSync(path.join(folderAbs, 'resume.txt'), 'Synthetic Owner\nBuilt Node.js and PostgreSQL backends.\n');
    fs.writeFileSync(path.join(folderAbs, 'tailoring-notes.md'), '# Tailoring Notes\n- Highlighted Node.js and PostgreSQL.\n');

    const rCvReg = runCli([
      'career', 'cv-register',
      '--id', 'cv-nova-501',
      '--label', 'Nova Senior Backend Tailored CV',
      '--kind', 'tailored',
      '--file', `${folderRel}/resume.html`,
      '--persona', 'backend',
      '--target-role', 'Senior Backend Engineer',
      '--target-job-id', 'gh:nova-501',
      '--ats-before', '70',
      '--ats-after', '95',
      '--json',
    ], { cwd: work, home });
    assert.equal(rCvReg.status, 0, rCvReg.stdout + rCvReg.stderr);

    const rPrep = runCli([
      'career', 'prepare',
      '--job-id', 'gh:nova-501',
      '--ats-before', '70',
      '--ats-after', '95',
      '--json',
    ], { cwd: work, home });
    assert.equal(rPrep.status, 0, rPrep.stdout + rPrep.stderr);
    const prepJ = JSON.parse(rPrep.stdout);
    assert.equal(prepJ.prepared, true);
    assert.equal(prepJ.status, 'prepared');
    assert.equal(prepJ.cv_version_id, 'cv-nova-501');

    // 5. Verify `--json pre-submit` flag-order fix (both `--json pre-submit` and `pre-submit --json` output valid JSON)
    const rPreLeadingJson = runCli(['--json', 'pre-submit', '--job-id', 'gh:nova-501'], { cwd: work, home });
    assert.equal(rPreLeadingJson.status, 0, rPreLeadingJson.stdout + rPreLeadingJson.stderr);
    assert.equal(JSON.parse(rPreLeadingJson.stdout).allowed, true);

    // 6. run-checkpoint, reserve + confirm-submit gh:nova-501, then run-resume
    const rCp = runCli([
      'career', 'run-checkpoint',
      '--run-id', runId,
      '--phase', 'applying',
      '--awaiting-job-id', 'lv:orbit-502',
      '--awaiting-question', 'Preferred start date?',
      '--json',
    ], { cwd: work, home });
    assert.equal(rCp.status, 0, rCp.stdout + rCp.stderr);

    const rResv = runCli(['career', 'reserve', '--job-id', 'gh:nova-501', '--json'], { cwd: work, home });
    assert.equal(rResv.status, 0, rResv.stderr);
    const rConf = runCli(['career', 'confirm-submit', '--job-id', 'gh:nova-501', '--receipt', 'Application received by Nova Systems', '--json'], { cwd: work, home });
    assert.equal(rConf.status, 0, rConf.stderr);

    const rResume = runCli(['career', 'run-resume', '--run-id', runId, '--json'], { cwd: work, home });
    assert.equal(rResume.status, 0, rResume.stdout + rResume.stderr);
    const resumeJ = JSON.parse(rResume.stdout);
    assert.equal(resumeJ.approval_expired_on_resume, true);
    assert.equal(resumeJ.submission_authorized, false);
    assert.deepEqual(resumeJ.moved_to_processed, ['gh:nova-501']);
    assert.deepEqual(resumeJ.checkpoint.queue, ['lv:orbit-502']);

    // 7. career next (both JSON and text modes)
    const rNext = runCli(['career', 'next', '--job-id', 'lv:orbit-502', '--json'], { cwd: work, home });
    assert.equal(rNext.status, 0, rNext.stdout + rNext.stderr);
    const nextJ = JSON.parse(rNext.stdout);
    assert.equal(nextJ.read_only, true);
    assert.equal(nextJ.cap_budget.today_applied, 1);
    assert.equal(nextJ.awaiting_owner.length, 1);

    const rNextText = runCli(['career', 'next'], { cwd: work, home });
    assert.equal(rNextText.status, 0, rNextText.stdout + rNextText.stderr);
    assert.match(rNextText.stdout, /Cap Budget Today:/);

    // 8. run-finish and `veycraft verify logs/runs/current-session-checkpoint.json`
    const rFin = runCli(['career', 'run-finish', '--run-id', runId, '--status', 'completed', '--json'], { cwd: work, home });
    assert.equal(rFin.status, 0, rFin.stdout + rFin.stderr);
    assert.equal(JSON.parse(rFin.stdout).counts.applied, 1);
    assert.equal(JSON.parse(rFin.stdout).counts.skipped, 1);

    const cpFile = path.join(work, 'logs', 'runs', 'current-session-checkpoint.json');
    const runFile = path.join(work, 'logs', 'runs', `${runId}.json`);
    const rVerCp = runCli(['verify', cpFile], { cwd: work, home });
    assert.equal(rVerCp.status, 0, rVerCp.stdout + rVerCp.stderr);
    const rVerRun = runCli(['verify', runFile], { cwd: work, home });
    assert.equal(rVerRun.status, 0, rVerRun.stdout + rVerRun.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('18. Stage 7 (T13): Regression tests for CV attribution parity, confirm-submit/cv-register guards, object open_questions, BANNED_AI_CLICHES parity, backup runs/*.json & sync input error diagnostics', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-t13-reg-');
  const nowIso = '2026-11-23T14:00:00Z';

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));

    // Register a generic owner CV and a third-party CV
    const genericRel = 'context/cv.md';
    fs.writeFileSync(path.join(work, genericRel), '# Synthetic Owner\nBuilt TypeScript and Node.js systems.\n');
    registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-generic-owner-v1',
      label: 'Generic Owner CV',
      kind: 'generic',
      file: genericRel,
    }, { home, nowIso });

    const cvRegPath = path.join(work, 'logs', 'cv-versions.json');
    const cvRegRaw = JSON.parse(fs.readFileSync(cvRegPath, 'utf8'));
    cvRegRaw.versions.push({
      cv_version_id: 'cv-third-party-99',
      version_number: 1,
      label: 'Friend CV',
      kind: 'generic',
      owner_scope: 'third_party',
      base_cv_version_id: null,
      content_sha256: 'a'.repeat(64),
      persona_id: null,
      language: 'en',
      local_ref_rel: 'logs/resumes/cv-friend-99/resume.html',
      tailoring_metadata: null,
      ats_metrics: null,
      application_ids: [],
      created_at: nowIso,
      updated_at: nowIso,
    });
    fs.writeFileSync(cvRegPath, JSON.stringify(cvRegRaw, null, 2) + '\n');

    // D3: registerOwnerCvVersionForWorkspace must reject third-party base_cv_version_id and self-referencing base_cv_version_id
    const tFileRel = 'logs/resumes/reg-tailored/resume.html';
    fs.mkdirSync(path.dirname(path.join(work, tFileRel)), { recursive: true });
    fs.writeFileSync(path.join(work, tFileRel), '<!doctype html><html><body><h1>Synthetic Owner</h1><p>Node.js</p></body></html>');
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-bad-base-tp',
        label: 'Bad Base TP',
        kind: 'tailored',
        file: tFileRel,
        base_cv_version_id: 'cv-third-party-99',
      }, { home, nowIso }),
      /third_party_blocked/i,
    );
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-self-cycle',
        label: 'Self Cycle',
        kind: 'tailored',
        file: tFileRel,
        base_cv_version_id: 'cv-self-cycle',
      }, { home, nowIso }),
      /invalid_base_cv_version/i,
    );

    // D1: prepareApplicationPackage with ONLY a generic CV registered + tailoring-notes.md must NOT attach generic CV as tailored cv_version_id (records as base_cv_version_id instead)
    recordApplication(work, {
      job_id: 'gh:t13-1',
      company: 'SyncSafe Labs',
      title: 'Backend Engineer',
      platform: 'greenhouse',
      url: 'https://boards.greenhouse.io/syncsafe/jobs/1',
      status: 'discovered',
      match_score: 8.8,
    }, { home, nowIso, sourceRoot: REPO_ROOT });
    const folderRel = computeCanonicalResumeFolderRel('SyncSafe Labs', 'Backend Engineer', 'gh:t13-1');
    const folderAbs = path.join(work, folderRel);
    fs.mkdirSync(folderAbs, { recursive: true });
    fs.writeFileSync(path.join(folderAbs, 'resume.html'), '<!doctype html><html><body><h1>Synthetic Owner</h1><p>Built reliable APIs.</p></body></html>');
    fs.writeFileSync(path.join(folderAbs, 'tailoring-notes.md'), '# Notes\n- Emphasized Node.js.\n');

    const prep1 = prepareApplicationPackage(work, { job_id: 'gh:t13-1' }, { home, nowIso });
    assert.equal(prep1.prepared, true);
    assert.equal(prep1.cv_version_id, null, 'must not link generic CV directly as tailored cv_version_id');
    assert.equal(prep1.cv_tailoring.is_tailored, true);
    assert.equal(prep1.cv_tailoring.base_cv_version_id, 'cv-generic-owner-v1');

    // D1b: explicit base_cv_version_id contradicting root CV must fail closed
    assert.throws(
      () => prepareApplicationPackage(work, {
        job_id: 'gh:t13-1',
        cv_version_id: 'cv-generic-owner-v1',
        base_cv_version_id: 'cv-nonexistent-other',
      }, { home, nowIso }),
      /base_cv_version_mismatch/i,
    );

    // D3b: linking a root CV via cv-register --link-job-id must clear any stale base_cv_version_id on the application
    registerOwnerCvVersionForWorkspace(work, {
      cv_version_id: 'cv-root-tailored-v1',
      label: 'Root Tailored CV',
      kind: 'tailored',
      file: `${folderRel}/resume.html`,
      link_job_id: 'gh:t13-1',
    }, { home, nowIso });
    const afterLink = readValidatedApplicationsLedger(work, { home }).records.find(r => r.job_id === 'gh:t13-1');
    assert.equal(afterLink.cv_version_id, 'cv-root-tailored-v1');
    assert.equal(afterLink.cv_tailoring.base_cv_version_id, null, 'root CV link must not leave stale contradicting base_cv_version_id');

    // D2: confirmApplicationSubmission must reject unregistered or third-party --cv-version-id
    reserveApplicationSubmission(work, { job_id: 'gh:t13-1', company: 'SyncSafe Labs', title: 'Backend Engineer', platform: 'greenhouse' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'gh:t13-1', receipt: 'Submitted ok', cv_version_id: 'cv-does-not-exist' }, { home, nowIso }),
      /cv_version_not_found/i,
    );
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'gh:t13-1', receipt: 'Submitted ok', cv_version_id: 'cv-third-party-99' }, { home, nowIso }),
      /third_party_blocked/i,
    );
    const confOk = confirmApplicationSubmission(work, {
      job_id: 'gh:t13-1',
      receipt: 'Application received by SyncSafe Labs',
      cv_version_id: 'cv-generic-owner-v1',
    }, { home, nowIso });
    assert.equal(confOk.confirmed, true);
    assert.equal(confOk.record.cv_version_id, 'cv-generic-owner-v1');
    assert.equal(confOk.record.cv_tailoring.is_tailored, false, 'confirmApplicationSubmission must reconcile cv_tailoring.is_tailored with CV kind');

    // D6: computeCareerWorkflowQueue must surface object-shaped open_questions ({ question, field_type })
    recordApplication(work, {
      job_id: 'lv:t13-q1',
      company: 'QuestionCo',
      title: 'Staff Engineer',
      platform: 'lever',
      status: 'needs_review',
      match_score: 8.5,
      open_questions: [{ question: 'Do you hold EU work authorization?', field_type: 'select' }],
    }, { home, nowIso, sourceRoot: REPO_ROOT });
    const nextPlan = computeCareerWorkflowQueue(work, { home, sourceRoot: REPO_ROOT, nowIso });
    assert.ok(
      nextPlan.awaiting_owner.some(a => a.job_id === 'lv:t13-q1' && a.question === 'Do you hold EU work authorization?'),
      'object-shaped open_questions must be surfaced in awaiting_owner',
    );

    // D4: BANNED_AI_CLICHES parity — cmdAudit catches items beyond index 14 ('proven track record', 'leveraged', 'deeply excited'), and pre-submit blocks banned clichés on --text
    assert.ok(BANNED_AI_CLICHES.includes('proven track record'));
    assert.ok(BANNED_AI_CLICHES.includes('dynamic environment'));
    assert.ok(BANNED_AI_CLICHES.includes('results-driven'));
    const clichéCv = path.join(work, 'cliche-cv.md');
    fs.writeFileSync(clichéCv, '# Candidate\n- Leveraged a proven track record in a fast-paced environment and deeply excited to build APIs (50% faster).\n');
    const rAudit = runCli(['audit', clichéCv], { cwd: work, home });
    assert.equal(rAudit.status, 0, rAudit.stderr);
    assert.match(rAudit.stdout, /proven track record|leveraged|deeply excited/i);

    const rPreCliche = runCli(['pre-submit', '--text', 'Hi team, I am thrilled to apply and deeply excited to leverage synergy for your backend team.', '--json'], { cwd: work, home });
    assert.equal(rPreCliche.status, 1);
    const preClicheJson = JSON.parse(rPreCliche.stdout);
    assert.equal(preClicheJson.allowed, false);
    assert.ok(preClicheJson.violations.some(v => v.code === 'draft_banned_cliches'));
    assert.ok(preClicheJson.checks.draft.banned_cliches.includes('thrilled to apply'));
    assert.ok(preClicheJson.checks.draft.banned_cliches.includes('deeply excited'));

    // D7: cmdBackup includes logs/runs/*.json (daily run + session checkpoint)
    startOrUpdateDailyRun(work, { run_id: '2026-11-23', platforms: ['greenhouse'] }, { home, nowIso });
    const rBackup = runCli(['backup'], { cwd: work, home });
    assert.equal(rBackup.status, 0, rBackup.stdout + rBackup.stderr);
    const backupDirs = fs.readdirSync(path.join(work, 'logs', 'backups')).filter(d => d.startsWith('backup-'));
    assert.equal(backupDirs.length, 1);
    const backedUpRun = path.join(work, 'logs', 'backups', backupDirs[0], 'logs', 'runs', '2026-11-23.json');
    const backedUpCp = path.join(work, 'logs', 'backups', backupDirs[0], 'logs', 'runs', 'current-session-checkpoint.json');
    assert.equal(fs.existsSync(backedUpRun), true, 'backup must include logs/runs/YYYY-MM-DD.json');
    assert.equal(fs.existsSync(backedUpCp), true, 'backup must include logs/runs/current-session-checkpoint.json');

    // D5: loadCareerSyncInputs reports the exact corrupt daily run filename on malformed JSON
    const badRunPath = path.join(work, 'logs', 'runs', '2026-11-24.json');
    fs.writeFileSync(badRunPath, '{corrupt json');
    assert.throws(
      () => loadCareerSyncInputs(work, { home }),
      /Invalid JSON in daily run file .*2026-11-24\.json/i,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test 19: SEC-02 — Third-Party CV & Application Data Leakage Prevention
// ===========================================================================
test('19. SEC-02: centralized third-party CV and application ownership isolation prevents leakage across analytics, summary, dashboard, next queue, status metrics, and Notion sync', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-sec02-');

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
    fs.writeFileSync(path.join(work, 'context', 'cv.md'), '# Synthetic Owner\nBuilt TypeScript and Node.js systems.\n');
    const nowIso = '2026-07-10T10:00:00Z';

    // Build CV versions registry covering:
    // - cv-owner-base: legitimate owner master CV
    // - cv-owner-tailored: legitimate owner tailored CV derived from cv-owner-base
    // - cv-tp-direct: third-party CV (owner_scope: 'third_party')
    // - cv-tp-child-masked: entry marked owner_scope: 'owner' but derived from cv-tp-direct (base_cv_version_id ancestry leak)
    // - cv-tp-path-masked: entry marked owner_scope: 'owner' but pointing to logs/resumes/cv-friend/resume.html
    // - cv-tp-reverse-link: third-party entry linking application_ids / target_job_id
    const cvRegistry = {
      schema_version: '1.0',
      updated_at: nowIso,
      versions: [
        {
          cv_version_id: 'cv-owner-base',
          version_number: 1,
          label: 'Owner Master CV',
          kind: 'generic',
          owner_scope: 'owner',
          base_cv_version_id: null,
          content_sha256: '1'.repeat(64),
          persona_id: 'backend',
          language: 'en',
          local_ref_rel: 'context/cv.md',
          tailoring_metadata: null,
          ats_metrics: null,
          application_ids: ['app-owner-1'],
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          cv_version_id: 'cv-owner-tailored',
          version_number: 1,
          label: 'Owner Tailored CV',
          kind: 'tailored',
          owner_scope: 'owner',
          base_cv_version_id: 'cv-owner-base',
          content_sha256: '2'.repeat(64),
          persona_id: 'backend',
          language: 'en',
          local_ref_rel: 'logs/resumes/2026-07-10-acme-owner-1/resume.html',
          tailoring_metadata: { target_job_id: 'gh:owner-2', target_role: 'Staff Backend Engineer 2', emphasized_skills: ['Node.js'], true_gaps_excluded: [] },
          ats_metrics: null,
          application_ids: ['app-owner-2'],
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          cv_version_id: 'cv-tp-direct',
          version_number: 1,
          label: 'Third Party Direct CV',
          kind: 'tailored',
          owner_scope: 'third_party',
          base_cv_version_id: null,
          content_sha256: '3'.repeat(64),
          persona_id: null,
          language: 'en',
          local_ref_rel: 'logs/resumes/cv-alice-client/resume.html',
          tailoring_metadata: { target_job_id: 'gh:tp-2', target_role: 'Third Party Beta Role', emphasized_skills: [], true_gaps_excluded: [] },
          ats_metrics: null,
          application_ids: [],
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          cv_version_id: 'cv-tp-child-masked',
          version_number: 1,
          label: 'Masked Child of Third Party Base',
          kind: 'tailored',
          owner_scope: 'owner',
          base_cv_version_id: 'cv-tp-direct',
          content_sha256: '4'.repeat(64),
          persona_id: null,
          language: 'en',
          local_ref_rel: 'logs/resumes/2026-07-10-masked-child/resume.html',
          tailoring_metadata: { target_job_id: null, target_role: 'Third Party Delta Role', emphasized_skills: [], true_gaps_excluded: [] },
          ats_metrics: null,
          application_ids: [],
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          cv_version_id: 'cv-tp-path-masked',
          version_number: 1,
          label: 'Masked Path Third Party CV',
          kind: 'generic',
          owner_scope: 'owner',
          base_cv_version_id: null,
          content_sha256: '5'.repeat(64),
          persona_id: null,
          language: 'en',
          local_ref_rel: 'logs/resumes/cv-bob-client/resume.html',
          tailoring_metadata: null,
          ats_metrics: null,
          application_ids: [],
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
    };
    const cvVal = validateCvVersionsRegistry(cvRegistry);
    assert.equal(cvVal.valid, true, cvVal.errors.join('; '));
    writeAtomic(path.join(work, 'logs', 'cv-versions.json'), `${JSON.stringify(cvRegistry, null, 2)}\n`, { boundary: work, home });

    // Verify listOwnerCvVersions & selectBestOwnerCvVersion filter out third-party CVs AND masked descendants/paths
    const ownerCvs = listOwnerCvVersions(work, { home });
    assert.deepEqual(ownerCvs.versions.map(v => v.cv_version_id), ['cv-owner-base', 'cv-owner-tailored']);
    assert.equal(ownerCvs.third_party_excluded, 3);

    const makeOwnerApp = (idx, cvId, isTailored, baseCvId = null) => normalizeApplicationRecord({
      job_id: `gh:owner-${idx}`,
      applied_at: '2026-07-05T10:00:00Z',
      updated_at: '2026-07-05T10:00:00Z',
      company: `OwnerSecretCleanCo${idx}`,
      title: `Staff Backend Engineer ${idx}`,
      url: `https://boards.greenhouse.io/ownersecretcleanco${idx}/jobs/${100 + idx}`,
      platform: 'greenhouse',
      source_channel: 'direct_ats',
      status: idx <= 2 ? 'interview' : 'applied',
      match_score: 8.5,
      cv_version_id: cvId,
      cv_tailoring: {
        is_tailored: isTailored,
        base_cv_version_id: baseCvId,
        tailored_folder_rel: isTailored ? `logs/resumes/2026-07-05-owner-${idx}` : null,
        tailoring_notes_rel: isTailored ? `logs/resumes/2026-07-05-owner-${idx}/evidence-map.md` : null,
        ats_keyword_before_pct: 60,
        ats_keyword_after_pct: 85,
      },
      provenance: {
        created_by: '04-fill-and-apply',
        created_at: nowIso,
        last_updated_by: null,
        receipt_verified: true,
        third_party_subject: false,
      },
    });

    const ownerRecords = [
      makeOwnerApp(1, 'cv-owner-base', false, null),
      makeOwnerApp(2, 'cv-owner-tailored', true, 'cv-owner-base'),
      makeOwnerApp(3, 'cv-owner-base', false, null),
      makeOwnerApp(4, 'cv-owner-tailored', true, 'cv-owner-base'),
      makeOwnerApp(5, 'cv-owner-base', false, null),
    ];

    // 1. Third-party record marked via provenance flag
    const tp1Provenance = normalizeApplicationRecord({
      job_id: 'gh:tp-1',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryAlphaCorp',
      title: 'Third Party Alpha Role',
      url: 'https://boards.greenhouse.io/leakcanaryalpha/jobs/1',
      platform: 'workday',
      status: 'offer',
      match_score: 9.5,
      cv_version_id: 'cv-owner-base',
      provenance: { created_by: '27-universal-cv-builder', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: true },
    });

    // 2. Third-party record linked via cv_version_id in cv-versions.json WITHOUT provenance.third_party_subject = true
    const tp2RegistryCv = normalizeApplicationRecord({
      job_id: 'gh:tp-2',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryBetaCorp',
      title: 'Third Party Beta Role',
      url: 'https://boards.greenhouse.io/leakcanarybeta/jobs/2',
      platform: 'workday',
      status: 'interview',
      match_score: 9.2,
      cv_version_id: 'cv-tp-direct',
      cv_tailoring: { is_tailored: true, base_cv_version_id: null, tailored_folder_rel: null, tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    // 3a. Third-party record linked indirectly via cv_tailoring.base_cv_version_id
    const tp3BaseCv = normalizeApplicationRecord({
      job_id: 'gh:tp-3a',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryGammaCorp',
      title: 'Third Party Gamma Role',
      url: 'https://boards.greenhouse.io/leakcanarygamma/jobs/3',
      platform: 'workday',
      status: 'interview',
      match_score: 9.1,
      cv_version_id: null,
      cv_tailoring: { is_tailored: true, base_cv_version_id: 'cv-tp-direct', tailored_folder_rel: null, tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    // 3b. Third-party record linked via a registry CV whose ancestor base_cv_version_id is third-party
    const tp3AncestryCv = normalizeApplicationRecord({
      job_id: 'gh:tp-3b',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryDeltaCorp',
      title: 'Third Party Delta Role',
      url: 'https://boards.greenhouse.io/leakcanarydelta/jobs/4',
      platform: 'workday',
      status: 'interview',
      match_score: 9.0,
      cv_version_id: 'cv-tp-child-masked',
      cv_tailoring: { is_tailored: true, base_cv_version_id: 'cv-tp-direct', tailored_folder_rel: null, tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    // 4. Third-party record linked via cv_tailoring.tailored_folder_rel under logs/resumes/cv-<slug>/
    const tp4FolderRel = normalizeApplicationRecord({
      job_id: 'gh:tp-4',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryEpsilonCorp',
      title: 'Third Party Epsilon Role',
      url: 'https://boards.greenhouse.io/leakcanaryepsilon/jobs/5',
      platform: 'workday',
      status: 'applied',
      match_score: 8.8,
      cv_version_id: 'cv-owner-base',
      cv_tailoring: { is_tailored: false, base_cv_version_id: null, tailored_folder_rel: 'logs/resumes/cv-external-friend', tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    // 5. Third-party record linked via cv_tailoring.tailoring_notes_rel under logs/resumes/cv-<slug>/
    const tp5NotesRel = normalizeApplicationRecord({
      job_id: 'gh:tp-5',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryZetaCorp',
      title: 'Third Party Zeta Role',
      url: 'https://boards.greenhouse.io/leakcanaryzeta/jobs/6',
      platform: 'workday',
      status: 'applied',
      match_score: 8.7,
      cv_version_id: 'cv-owner-base',
      cv_tailoring: { is_tailored: false, base_cv_version_id: null, tailored_folder_rel: null, tailoring_notes_rel: 'logs/resumes/cv-external-friend/evidence-map.md' },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    // 6. Missing registry entry / ambiguous ownership -> excluded fail-closed
    const tp6MissingCv = normalizeApplicationRecord({
      job_id: 'gh:tp-6',
      applied_at: '2026-07-05T10:00:00Z',
      company: 'LeakCanaryEtaCorp',
      title: 'Third Party Eta Role',
      url: 'https://boards.greenhouse.io/leakcanaryeta/jobs/7',
      platform: 'workday',
      status: 'interview',
      match_score: 8.9,
      cv_version_id: 'cv-unknown-orphan-id',
      cv_tailoring: { is_tailored: true, base_cv_version_id: null, tailored_folder_rel: null, tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });

    const allThirdPartyRecords = [
      tp1Provenance,
      tp2RegistryCv,
      tp3BaseCv,
      tp3AncestryCv,
      tp4FolderRel,
      tp5NotesRel,
      tp6MissingCv,
    ];

    for (const tpRec of allThirdPartyRecords) {
      const cls = classifyApplicationOwnership(tpRec, cvRegistry);
      assert.equal(cls.isOwner, false, `Expected ${tpRec.application_id} to be excluded, got reason=${cls.reason}`);
      assert.equal(isOwnerApplicationRecord(tpRec, cvRegistry), false);
    }

    for (const ownRec of ownerRecords) {
      const cls = classifyApplicationOwnership(ownRec, cvRegistry);
      assert.equal(cls.isOwner, true, `Expected ${ownRec.application_id} to be owner, got reason=${cls.reason}`);
      assert.equal(isOwnerApplicationRecord(ownRec, cvRegistry), true);
    }

    // 7. Malformed registry data -> fails closed with validation error
    assert.throws(
      () => classifyApplicationOwnership(ownerRecords[0], { schema_version: '999', versions: 'corrupt' }),
      /Invalid CV versions registry/i,
    );
    assert.throws(
      () => computeCareerAnalytics(ownerRecords, { schema_version: '999', versions: 'corrupt' }, { period: 'all', now: new Date(nowIso) }),
      /Invalid CV versions registry/i,
    );

    // 8 & 9. Owner-only dataset vs Mixed (owner + third-party) dataset must produce identical analytics counts & rates
    const ownerOnlyAnalytics = computeCareerAnalytics(ownerRecords, cvRegistry, { period: 'all', now: new Date(nowIso) });
    const mixedRecords = [...ownerRecords, ...allThirdPartyRecords];
    const mixedAnalytics = computeCareerAnalytics(mixedRecords, cvRegistry, { period: 'all', now: new Date(nowIso) });

    assert.equal(ownerOnlyAnalytics.funnel.total_tracked, 5);
    assert.equal(ownerOnlyAnalytics.isolation.third_party_applications_excluded, 0);
    assert.equal(mixedAnalytics.funnel.total_tracked, 5);
    assert.equal(mixedAnalytics.isolation.third_party_applications_excluded, allThirdPartyRecords.length);
    assert.deepEqual(mixedAnalytics.funnel, ownerOnlyAnalytics.funnel);
    assert.deepEqual(mixedAnalytics.source_performance, ownerOnlyAnalytics.source_performance);
    assert.deepEqual(mixedAnalytics.cv_performance, ownerOnlyAnalytics.cv_performance);

    // 10. Persist mixed ledger & cv-versions.json to workspace and verify zero third-party identifiers leak into
    // analytics artifact, summary, dashboard, status metrics, run counts, workflow queue (career next), or Notion sync inputs
    // Note: Keep persisted ledger schema-valid while testing registry-linked third-party records (tp1Provenance, tp2RegistryCv, tp3BaseCv, tp3AncestryCv, tp6MissingCv)
    const persistedMixedRecords = [
      ...ownerRecords,
      tp1Provenance,
      tp2RegistryCv,
      tp3BaseCv,
      tp3AncestryCv,
      tp6MissingCv,
    ];
    writeAtomic(path.join(work, 'logs', 'cv-versions.json'), `${JSON.stringify(cvRegistry, null, 2)}\n`, { boundary: work, home });
    writeAtomic(path.join(work, 'logs', 'applications-log.json'), `${JSON.stringify(persistedMixedRecords, null, 2)}\n`, { boundary: work, home });

    const wsAnalytics = runCareerAnalyticsForWorkspace(work, { period: 'all', nowIso, write: true, home });
    const wsSummary = summarizeCareerWorkspace(work, { nowIso, home });
    const wsMetrics = computeWorkspaceStatusMetrics(work, { home, nowIso });
    const wsNext = computeCareerWorkflowQueue(work, { home, sourceRoot: REPO_ROOT, nowIso });
    const wsSyncInputs = loadCareerSyncInputs(work, { home });
    const rDashboard = runCli(['career', 'dashboard'], { cwd: work, home });
    assert.equal(rDashboard.status, 0, rDashboard.stderr);

    assert.equal(wsSummary.funnel.total_tracked, 5);
    assert.equal(wsMetrics.pipeline.applied, 5);
    assert.equal(wsMetrics.third_party_excluded, 5);

    const combinedOutputs = JSON.stringify({
      artifact: wsAnalytics.artifact,
      summary: wsSummary,
      metrics: wsMetrics,
      next: wsNext,
      dashboardHtml: fs.readFileSync(path.join(work, 'logs', 'exports', 'dashboard.html'), 'utf8'),
    });

    for (const forbidden of [
      'LeakCanaryAlphaCorp',
      'LeakCanaryBetaCorp',
      'LeakCanaryGammaCorp',
      'LeakCanaryDeltaCorp',
      'LeakCanaryEpsilonCorp',
      'LeakCanaryZetaCorp',
      'LeakCanaryEtaCorp',
      'cv-tp-direct',
      'cv-tp-child-masked',
      'cv-tp-path-masked',
      'cv-unknown-orphan-id',
      'gh:tp-1',
      'gh:tp-2',
      'gh:tp-3a',
      'gh:tp-3b',
      'gh:tp-6',
    ]) {
      assert.equal(
        combinedOutputs.includes(forbidden),
        false,
        `Third-party identifier "${forbidden}" must never leak into analytics, summary, metrics, next queue, or dashboard`,
      );
    }
    assert.ok(wsSyncInputs.applications.length === 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test 19b: SEC-02 Closure — F-01 (path canonicalization), F-04 (missing registry fail-closed),
// and F-05 (lifecycle write & Notion sync ownership centralization)
// ===========================================================================
test('19b. SEC-02 closure: F-01 path canonicalization, F-04 missing CV registry fail-closed, and F-05 lifecycle/Notion ownership centralization', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-sec02-closure-');
  const nowIso = '2026-07-10T10:00:00Z';

  try {
    fs.mkdirSync(path.join(work, 'config'), { recursive: true });
    fs.mkdirSync(path.join(work, 'context'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
    fs.writeFileSync(path.join(work, 'context', 'cv.md'), '# Owner CV\nBuilt Node.js systems.\n');

    // F-01: Alternate non-canonical third-party path representations must be detected & rejected
    const thirdPartyVariants = [
      'logs/resumes/./cv-alice/resume.html',
      'logs//resumes/cv-alice/resume.html',
      'logs/resumes/foo/../cv-alice/resume.html',
      'logs\\resumes\\.\\cv-alice\\resume.html',
      'logs/resumes\\cv-alice/resume.html',
      'logs/resumes/cv-alice/resume.html',
    ];
    for (const p of thirdPartyVariants) {
      assert.equal(isThirdPartyCvPath(p), true, `isThirdPartyCvPath must detect "${p}"`);
    }
    for (const safeOwnerPath of ['context/cv.md', 'logs/resumes/2026-07-10-acme-1/resume.html', 'logs/resumes/acme-2026-11/']) {
      assert.equal(isThirdPartyCvPath(safeOwnerPath), false, `Valid owner path must not be flagged third-party: "${safeOwnerPath}"`);
    }

    // F-01: Non-canonical paths in CV registry must fail validation and ownership checks
    for (const badPath of ['logs/resumes/./cv-alice/resume.html', 'logs//resumes/cv-alice/resume.html', 'logs/resumes/foo/../cv-alice/resume.html']) {
      const badReg = {
        schema_version: '1.0',
        updated_at: nowIso,
        versions: [{
          cv_version_id: 'cv-bad-path',
          version_number: 1,
          label: 'Bad Path CV',
          kind: 'generic',
          owner_scope: 'owner',
          base_cv_version_id: null,
          content_sha256: 'a'.repeat(64),
          local_ref_rel: badPath,
          created_at: nowIso,
          application_ids: [],
        }],
      };
      assert.equal(validateCvVersionsRegistry(badReg).valid, false, `Registry must reject non-canonical path "${badPath}"`);
      assert.equal(classifyCvRegistryEntryOwnership(badReg.versions[0], new Map([['cv-bad-path', badReg.versions[0]]])).isOwner, false);
      assert.throws(() => registerCvVersion(null, badReg.versions[0]), /third-party|unsafe/i);
    }

    // F-04: Missing registry (null) must fail closed for CV-attributed records while preserving unattributed owner records
    const recWithCv = normalizeApplicationRecord({
      job_id: 'gh:f04-cv',
      company: 'MissingRegCvCorp',
      title: 'Engineer',
      url: 'https://boards.greenhouse.io/missingregcv/jobs/1',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      cv_version_id: 'cv-tp-or-unknown',
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
    });
    const recWithBaseCv = normalizeApplicationRecord({
      job_id: 'gh:f04-base',
      company: 'MissingRegBaseCorp',
      title: 'Engineer',
      url: 'https://boards.greenhouse.io/missingregbase/jobs/2',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      cv_version_id: null,
      cv_tailoring: { is_tailored: true, base_cv_version_id: 'cv-tp-base', tailored_folder_rel: null, tailoring_notes_rel: null },
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
    });
    const recUnattributed = normalizeApplicationRecord({
      job_id: 'gh:f04-unattr',
      company: 'UnattributedOwnerCorp',
      title: 'Engineer',
      url: 'https://boards.greenhouse.io/unattrowner/jobs/3',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      cv_version_id: null,
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
    });

    assert.equal(classifyApplicationOwnership(recWithCv, null).isOwner, false);
    assert.equal(classifyApplicationOwnership(recWithCv, null).reason, 'missing_cv_versions_registry');
    assert.equal(classifyApplicationOwnership(recWithBaseCv, null).isOwner, false);
    assert.equal(classifyApplicationOwnership(recWithBaseCv, null).reason, 'missing_cv_versions_registry');
    assert.equal(classifyApplicationOwnership(recUnattributed, null).isOwner, true);

    const emptyReg = { schema_version: '1.0', updated_at: nowIso, versions: [] };
    assert.equal(classifyApplicationOwnership(recWithCv, emptyReg).isOwner, false);
    assert.equal(classifyApplicationOwnership(recWithBaseCv, emptyReg).isOwner, false);
    assert.equal(classifyApplicationOwnership(recUnattributed, emptyReg).isOwner, true);
    assert.throws(() => classifyApplicationOwnership(recUnattributed, { schema_version: 'bad', versions: 'nope' }), /Invalid CV versions registry/i);

    // Workspace without logs/cv-versions.json: CV-attributed records excluded from analytics, summary, status metrics, run counts, queue & dashboard
    writeAtomic(path.join(work, 'logs', 'applications-log.json'), JSON.stringify([recWithCv, recWithBaseCv, recUnattributed], null, 2) + '\n', { boundary: work, home });
    const f04Sum = summarizeCareerWorkspace(work, { home, nowIso });
    const f04Metrics = computeWorkspaceStatusMetrics(work, { home, nowIso });
    const f04Counts = deriveRunCountsFromLedger(work, '2026-07-10', { home });
    const f04Queue = computeCareerWorkflowQueue(work, { home, sourceRoot: REPO_ROOT, nowIso });
    const f04Dash = runCli(['career', 'dashboard'], { cwd: work, home });
    assert.equal(f04Dash.status, 0, f04Dash.stderr);
    const f04DashHtml = fs.readFileSync(path.join(work, 'logs', 'exports', 'dashboard.html'), 'utf8');

    assert.equal(f04Sum.funnel.total_tracked, 1);
    assert.equal(f04Metrics.pipeline.applied, 1);
    assert.equal(f04Metrics.third_party_excluded, 2);
    assert.equal(f04Counts.counts.applied, 1);
    const f04Combined = JSON.stringify({ f04Sum, f04Metrics, f04Queue, f04DashHtml });
    assert.equal(f04Combined.includes('MissingRegCvCorp'), false);
    assert.equal(f04Combined.includes('MissingRegBaseCorp'), false);
    assert.equal(f04DashHtml.includes('UnattributedOwnerCorp'), true);

    // F-05: Ownership centralization across lifecycle mutations and Notion sync
    const revJobId = 'gh:f05-rev';
    const revAppId = computeApplicationId(revJobId);
    const f05Reg = {
      schema_version: '1.0',
      updated_at: nowIso,
      versions: [
        {
          cv_version_id: 'cv-owner-valid',
          version_number: 1,
          label: 'Valid Owner CV',
          kind: 'generic',
          owner_scope: 'owner',
          base_cv_version_id: null,
          content_sha256: '1'.repeat(64),
          local_ref_rel: 'context/cv.md',
          created_at: nowIso,
          application_ids: [],
        },
        {
          cv_version_id: 'cv-tp-root',
          version_number: 1,
          label: 'Third Party Root',
          kind: 'tailored',
          owner_scope: 'third_party',
          base_cv_version_id: null,
          content_sha256: '2'.repeat(64),
          local_ref_rel: 'logs/resumes/cv-alice/resume.html',
          tailoring_metadata: { target_job_id: revJobId, target_role: 'Rev Role', emphasized_skills: [], true_gaps_excluded: [] },
          created_at: nowIso,
          application_ids: [revAppId],
        },
        {
          cv_version_id: 'cv-tp-child-masked',
          version_number: 1,
          label: 'Masked Child of TP Root',
          kind: 'tailored',
          owner_scope: 'owner',
          base_cv_version_id: 'cv-tp-root',
          content_sha256: '3'.repeat(64),
          local_ref_rel: 'logs/resumes/2026-07-10-masked/resume.html',
          created_at: nowIso,
          application_ids: [],
        },
      ],
    };
    writeAtomic(path.join(work, 'logs', 'cv-versions.json'), JSON.stringify(f05Reg, null, 2) + '\n', { boundary: work, home });

    // Valid owner CV & third-party CV with registry
    const recOwnerWithCv = normalizeApplicationRecord({
      job_id: 'gh:f05-owner',
      company: 'OwnerValidCo',
      title: 'Engineer',
      url: 'https://boards.greenhouse.io/ownervalid/jobs/1',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      cv_version_id: 'cv-owner-valid',
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
    });
    assert.equal(classifyApplicationOwnership(recOwnerWithCv, f05Reg).isOwner, true);
    assert.equal(validateCvAttribution(recOwnerWithCv, { allCvRegistry: f05Reg }).valid, true);

    // registerOwnerCvVersionForWorkspace must reject masked third-party child base_cv_version_id & missing base_cv_version_id
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-laundered-1',
        label: 'Laundered',
        kind: 'tailored',
        file: 'context/cv.md',
        base_cv_version_id: 'cv-tp-child-masked',
      }, { home, nowIso }),
      /third_party_blocked/i,
    );
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-missing-base',
        label: 'Missing Base',
        kind: 'tailored',
        file: 'context/cv.md',
        base_cv_version_id: 'cv-does-not-exist',
      }, { home, nowIso }),
      /invalid_base_cv_version/i,
    );

    // confirmApplicationSubmission must reject masked third-party child CV
    writeAtomic(path.join(work, 'logs', 'applications-log.json'), JSON.stringify([recOwnerWithCv], null, 2) + '\n', { boundary: work, home });
    reserveApplicationSubmission(work, { job_id: 'gh:f05-res', company: 'ReserveCo', title: 'Eng', platform: 'greenhouse' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'gh:f05-res', receipt: 'Received', cv_version_id: 'cv-tp-child-masked' }, { home, nowIso }),
      /third_party_blocked/i,
    );

    // prepareApplicationPackage must reject masked third-party child CV, masked base CV, and reverse-linked third-party records
    const pkgDir = path.join(work, 'logs', 'resumes', '2026-07-10-f05-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'resume.txt'), 'Alex Rivera\nBuilt Node.js systems.');
    const recRevPrepared = normalizeApplicationRecord({
      job_id: revJobId,
      company: 'RevLinkCo',
      title: 'Engineer',
      platform: 'greenhouse',
      status: 'discovered',
      updated_at: nowIso,
      provenance: { created_by: '02-discover-and-triage', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });
    const recPrepOwner = normalizeApplicationRecord({
      job_id: 'gh:f05-prep-owner',
      company: 'PrepOwnerCo',
      title: 'Engineer',
      platform: 'greenhouse',
      status: 'discovered',
      updated_at: nowIso,
      provenance: { created_by: '02-discover-and-triage', created_at: nowIso, last_updated_by: null, receipt_verified: false, third_party_subject: false },
    });
    writeAtomic(path.join(work, 'logs', 'applications-log.json'), JSON.stringify([recOwnerWithCv, recRevPrepared, recPrepOwner], null, 2) + '\n', { boundary: work, home });
    assert.throws(
      () => prepareApplicationPackage(work, { job_id: revJobId, folder_rel: 'logs/resumes/2026-07-10-f05-pkg', require_ready: false }, { home, nowIso }),
      /third_party_blocked/i,
    );
    assert.throws(
      () => prepareApplicationPackage(work, { job_id: 'gh:f05-prep-owner', folder_rel: 'logs/resumes/2026-07-10-f05-pkg', cv_version_id: 'cv-tp-child-masked', require_ready: false }, { home, nowIso }),
      /third_party_blocked/i,
    );
    assert.throws(
      () => prepareApplicationPackage(work, { job_id: 'gh:f05-prep-owner', folder_rel: 'logs/resumes/2026-07-10-f05-pkg', base_cv_version_id: 'cv-tp-child-masked', require_ready: false }, { home, nowIso }),
      /third_party_blocked/i,
    );
    // registerOwnerCvVersionForWorkspace must also reject linking owner CV to reverse-linked third-party application
    assert.throws(
      () => registerOwnerCvVersionForWorkspace(work, {
        cv_version_id: 'cv-owner-link-rev',
        label: 'Owner Link Rev',
        kind: 'generic',
        file: 'context/cv.md',
        link_job_id: revJobId,
      }, { home, nowIso }),
      /third_party_blocked/i,
    );

    // Notion sync eligibility must block reverse-linked records and third-party paths in screenshot, dossier_rel, blueprint_rel, draft_rel
    const recRevSubmitted = normalizeApplicationRecord({
      job_id: revJobId,
      company: 'RevLinkNotionCo',
      title: 'Engineer',
      url: 'https://boards.greenhouse.io/revlink/jobs/1',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
    });
    const makeArtifactTpRec = (id, patch) => normalizeApplicationRecord({
      job_id: id,
      company: `TpArtifactCo-${id}`,
      title: 'Engineer',
      url: `https://boards.greenhouse.io/tpartifact/jobs/${id.replace(/\W/g, '')}`,
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
      provenance: { created_by: '04-fill-and-apply', created_at: nowIso, last_updated_by: null, receipt_verified: true, third_party_subject: false },
      ...patch,
    });
    const recTpShot = makeArtifactTpRec('gh:f05-shot', { screenshot: 'logs/resumes/cv-alice/shot.png' });
    const recTpDraft = makeArtifactTpRec('gh:f05-draft', { follow_up: { follow_up_count: 0, status: 'drafted', next_due_at: null, last_followed_up_at: null, draft_rel: 'logs/resumes/./cv-alice/draft.md' } });
    const recTpDossier = makeArtifactTpRec('gh:f05-dossier', { interviews: [{ interview_id: 'iv1', round: 1, stage: 'technical_screen', status: 'scheduled', outcome: 'pending', scheduled_at: null, timezone: null, dossier_rel: 'logs/resumes/cv-alice/dossier.md', notes: '' }] });
    const recTpBlueprint = makeArtifactTpRec('gh:f05-blueprint', { assessments: [{ assessment_id: 'as1', type: 'take_home', status: 'assigned', outcome: 'pending', received_at: nowIso, due_at: null, submitted_at: null, blueprint_rel: 'logs/resumes/cv-alice/blueprint.md', notes: '' }] });

    const notionRes = computeNotionSyncDiff({
      applications: [recOwnerWithCv, recRevSubmitted, recTpShot, recTpDraft, recTpDossier, recTpBlueprint],
      dailyRuns: [],
      insights: [],
      allCvRegistry: f05Reg,
      syncState: createEmptySyncState(),
      createdAt: nowIso,
    });
    assert.deepEqual(
      notionRes.plan.operations.map(o => o.canonical_key),
      [recOwnerWithCv.application_id],
      'Only legitimate verified owner application may enter Notion sync operations',
    );
    assert.equal(notionRes.plan.blocked_items.length, 5, 'All 5 third-party/reverse-linked/artifact-path applications must be blocked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test 20: SEC-04 — Path Traversal & Symlink Bypass Prevention
// ===========================================================================
test('20. SEC-04: relative path validation, workspace containment, third-party path isolation & CLI symlink refusal', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-sec04-');
  const outsideDir = path.join(dir, 'outside-secret');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(path.join(work, 'config'), { recursive: true });
  fs.mkdirSync(path.join(work, 'context'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(work, 'config', 'guardrails.yaml'));
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(work, 'config', 'invariants.txt'));
  const nowIso = '2026-07-10T12:00:00Z';

  try {
    // 1. ../secret.txt traversal, 2. nested logs/resumes/../../../../etc/passwd, 3. absolute POSIX /etc/passwd,
    // 4. Windows drive C:\Windows\System32\drivers\etc\hosts, 5. UNC \\server\share\file, 13. mixed separators / quotes
    const unsafePaths = [
      '../secret.txt',
      'logs/resumes/../../../../etc/passwd',
      '/etc/passwd',
      'C:\\Windows\\System32\\drivers\\etc\\hosts',
      '\\\\server\\share\\file',
      '//server/share/file',
      'logs/resumes/./bad',
      'logs/resumes/bad"quote/file.md',
      'logs/resumes/bad\x00null.md',
    ];
    for (const bad of unsafePaths) {
      assert.equal(isSafeWorkspaceRelativePath(bad), false, `Expected unsafe path to be rejected: ${bad}`);
    }

    // 8. Third-party CV path in owner record (logs/resumes/cv-client/...) rejected when allowThirdParty=false
    assert.equal(isSafeWorkspaceRelativePath('logs/resumes/cv-client/resume.html', { allowThirdParty: false }), false);
    assert.equal(isSafeWorkspaceRelativePath('logs/resumes/cv-client/resume.html', { allowThirdParty: true }), true);

    // 12. Legitimate relative paths inside workspace continue to work
    assert.equal(isSafeWorkspaceRelativePath('logs/screenshots/gh-101.png', { allowThirdParty: false }), true);
    assert.equal(isSafeWorkspaceRelativePath('logs\\resumes\\2026-07-10-acme-101\\interview-dossier.md', { allowThirdParty: false }), true);

    // 9. Persisted ledger containing invalid relative paths in screenshot, cv_tailoring, interviews, assessments, follow_up
    const validBaseRec = normalizeApplicationRecord({
      job_id: 'gh:sec04-valid',
      company: 'SafePathCo',
      title: 'Backend Engineer',
      platform: 'greenhouse',
      status: 'applied',
      applied_at: nowIso,
      updated_at: nowIso,
    });
    for (const [label, mutator] of [
      ['screenshot ../', r => ({ ...r, screenshot: '../secret.png' })],
      ['screenshot third-party on owner', r => ({ ...r, screenshot: 'logs/resumes/cv-other/shot.png' })],
      ['tailored_folder_rel traversal', r => ({ ...r, cv_tailoring: { is_tailored: true, base_cv_version_id: null, tailored_folder_rel: '../../etc', tailoring_notes_rel: null } })],
      ['tailoring_notes_rel drive path', r => ({ ...r, cv_tailoring: { is_tailored: true, base_cv_version_id: null, tailored_folder_rel: null, tailoring_notes_rel: 'C:\\secret\\notes.md' } })],
      ['tailored_folder_rel third-party on owner', r => ({ ...r, cv_tailoring: { is_tailored: true, base_cv_version_id: null, tailored_folder_rel: 'logs/resumes/cv-friend', tailoring_notes_rel: null } })],
      ['interviews.dossier_rel UNC', r => ({ ...r, interviews: [{ interview_id: 'iv_1', round: 1, stage: 'technical_screen', status: 'scheduled', outcome: 'pending', scheduled_at: null, timezone: null, dossier_rel: '\\\\server\\share\\dossier.md', notes: '' }] })],
      ['assessments.blueprint_rel absolute', r => ({ ...r, assessments: [{ assessment_id: 'asmt_1', type: 'take_home', status: 'assigned', outcome: 'pending', received_at: nowIso, due_at: null, submitted_at: null, blueprint_rel: '/etc/passwd', notes: '' }] })],
      ['follow_up.draft_rel traversal', r => ({ ...r, follow_up: { follow_up_count: 0, status: 'drafted', next_due_at: null, last_followed_up_at: null, draft_rel: 'logs/resumes/../../../secret.md' } })],
    ]) {
      const badLedgerCheck = validateApplicationLedger([mutator(validBaseRec)]);
      assert.equal(badLedgerCheck.valid, false, `Expected validateApplicationLedger to reject: ${label}`);
    }

    // Lifecycle write functions must reject unsafe relative paths before mutating ledger
    for (const badPath of ['../secret.png', '/etc/passwd', 'C:\\Windows\\win.ini', '\\\\server\\share\\a.png', 'logs/resumes/cv-client/shot.png']) {
      assert.throws(
        () => recordApplication(work, { job_id: 'gh:sec04-1', company: 'Acme', title: 'Engineer', status: 'discovered', screenshot: badPath }, { home, nowIso, sourceRoot: REPO_ROOT }),
        /relative path|traversal|third-party|outside workspace/i,
      );
    }

    // Legitimate record + reserve + confirm + transition with safe relative paths succeeds
    const recOk = recordApplication(work, {
      job_id: 'gh:sec04-1',
      company: 'AcmeSafe',
      title: 'Staff Engineer',
      platform: 'greenhouse',
      status: 'prepared',
      screenshot: 'logs/screenshots/gh-sec04-1.png',
    }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.equal(recOk.record.screenshot, 'logs/screenshots/gh-sec04-1.png');

    reserveApplicationSubmission(work, { job_id: 'gh:sec04-1', company: 'AcmeSafe', title: 'Staff Engineer', platform: 'greenhouse' }, { home, nowIso, sourceRoot: REPO_ROOT });
    assert.throws(
      () => confirmApplicationSubmission(work, { job_id: 'gh:sec04-1', receipt: 'Application received', screenshot: '../escape.png' }, { home, nowIso }),
      /relative path|traversal/i,
    );
    confirmApplicationSubmission(work, {
      job_id: 'gh:sec04-1',
      receipt: 'Application received',
      screenshot: 'logs/screenshots/gh-sec04-1-confirmed.png',
    }, { home, nowIso });

    for (const badRel of ['../escape.md', '/etc/passwd', 'C:\\Windows\\System32\\drivers\\etc\\hosts', '\\\\server\\share\\file', 'logs/resumes/cv-client/doc.md']) {
      assert.throws(
        () => transitionApplicationStage(work, {
          job_id: 'gh:sec04-1',
          to_status: 'interview',
          interview: { stage: 'technical_screen', status: 'scheduled', dossier_rel: badRel },
        }, { home, nowIso }),
        /relative path|traversal|third-party|outside workspace/i,
      );
      assert.throws(
        () => transitionApplicationStage(work, {
          job_id: 'gh:sec04-1',
          to_status: 'assessment',
          assessment: { type: 'take_home', status: 'assigned', blueprint_rel: badRel },
        }, { home, nowIso }),
        /relative path|traversal|third-party|outside workspace/i,
      );
      assert.throws(
        () => transitionApplicationStage(work, {
          job_id: 'gh:sec04-1',
          to_status: 'applied',
          follow_up: { status: 'drafted', draft_rel: badRel },
        }, { home, nowIso }),
        /relative path|traversal|third-party|outside workspace/i,
      );
    }

    // 10 & 11. CLI reader commands (audit, verify, pre-submit --draft, verify --facts) reject outside-workspace paths and traversal
    const outsideFile = path.join(outsideDir, 'outside-resume.md');
    fs.writeFileSync(outsideFile, '# Secret Outside File\n- Built systems reducing latency by 40%.\n');

    const rAuditOutside = runCli(['audit', outsideFile], { cwd: work, home });
    assert.notEqual(rAuditOutside.status, 0, 'audit must reject file outside workspace');
    assert.match(rAuditOutside.stderr, /outside workspace boundary/i);

    const rAuditTraversal = runCli(['audit', '../outside-secret/outside-resume.md'], { cwd: work, home });
    assert.notEqual(rAuditTraversal.status, 0, 'audit must reject ../ traversal');
    assert.match(rAuditTraversal.stderr, /traversal|outside workspace/i);

    const rVerifyOutside = runCli(['verify', outsideFile], { cwd: work, home });
    assert.notEqual(rVerifyOutside.status, 0, 'verify must reject file outside workspace');
    assert.match(rVerifyOutside.stderr, /outside workspace boundary/i);

    const insideResume = path.join(work, 'logs', 'resumes', 'safe-pkg', 'resume.txt');
    fs.mkdirSync(path.dirname(insideResume), { recursive: true });
    fs.writeFileSync(insideResume, 'Alex Rivera\nSenior Engineer building Node.js services reducing latency by 38%.');

    const rVerifyOutsideFacts = runCli(['verify', insideResume, '--facts', outsideFile], { cwd: work, home });
    assert.notEqual(rVerifyOutsideFacts.status, 0, 'verify --facts must reject facts file outside workspace');
    assert.match(rVerifyOutsideFacts.stderr, /outside workspace boundary/i);

    const rPreSubmitOutside = runCli(['pre-submit', '--draft', outsideFile], { cwd: work, home });
    assert.notEqual(rPreSubmitOutside.status, 0, 'pre-submit --draft must reject draft file outside workspace');
    assert.match(rPreSubmitOutside.stderr, /outside workspace boundary/i);

    const rPreSubmitUNC = runCli(['pre-submit', '--draft', '\\\\server\\share\\draft.md'], { cwd: work, home });
    assert.notEqual(rPreSubmitUNC.status, 0, 'pre-submit --draft must reject UNC path');
    assert.match(rPreSubmitUNC.stderr, /Refusing UNC/i);

    // Legitimate in-workspace files succeed for audit, verify, and pre-submit --draft
    const rVerifyInside = runCli(['verify', 'logs/resumes/safe-pkg/resume.txt'], { cwd: work, home });
    assert.equal(rVerifyInside.status, 0, rVerifyInside.stderr);
    const rPreSubmitInside = runCli(['pre-submit', '--draft', 'logs/resumes/safe-pkg/resume.txt'], { cwd: work, home });
    assert.equal(rPreSubmitInside.status, 0, rPreSubmitInside.stderr);

    // 6 & 7. Symlinked file inside workspace pointing outside & symlinked parent directory inside workspace
    const symFile = path.join(work, 'logs', 'symlink-resume.md');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(outsideFile, symFile, 'file');
      symlinkCreated = true;
    } catch {
      // Windows without Developer Mode / elevation may disallow file symlinks; test directory junction as fallback
    }
    if (symlinkCreated) {
      const rAuditSym = runCli(['audit', 'logs/symlink-resume.md'], { cwd: work, home });
      assert.notEqual(rAuditSym.status, 0, 'audit must reject symlinked file');
      assert.match(rAuditSym.stderr, /symbolic-link/i);

      const rVerifySym = runCli(['verify', 'logs/symlink-resume.md'], { cwd: work, home });
      assert.notEqual(rVerifySym.status, 0, 'verify must reject symlinked file');
      assert.match(rVerifySym.stderr, /symbolic-link/i);

      const rPreSym = runCli(['pre-submit', '--draft', 'logs/symlink-resume.md'], { cwd: work, home });
      assert.notEqual(rPreSym.status, 0, 'pre-submit must reject symlinked draft');
      assert.match(rPreSym.stderr, /symbolic-link/i);
    }

    const symDir = path.join(work, 'logs', 'symlink-dir');
    let dirLinkCreated = false;
    try {
      fs.symlinkSync(outsideDir, symDir, process.platform === 'win32' ? 'junction' : 'dir');
      dirLinkCreated = true;
    } catch {
      // ignore if OS blocks symlink/junction creation
    }
    if (dirLinkCreated) {
      const rVerifySymDir = runCli(['verify', 'logs/symlink-dir'], { cwd: work, home });
      assert.notEqual(rVerifySymDir.status, 0, 'verify must reject symlinked/junction directory');
      assert.match(rVerifySymDir.stderr, /symbolic-link/i);

      const rAuditViaSymParent = runCli(['audit', 'logs/symlink-dir/outside-resume.md'], { cwd: work, home });
      assert.notEqual(rAuditViaSymParent.status, 0, 'audit must reject file under symlinked parent directory');
      assert.match(rAuditViaSymParent.stderr, /symbolic-link/i);

    assert.throws(
      () => recordApplication(work, {
        job_id: 'gh:sec04-sym',
        company: 'SymCo',
        title: 'Engineer',
        status: 'discovered',
        screenshot: 'logs/symlink-dir/outside-resume.md',
      }, { home, nowIso, sourceRoot: REPO_ROOT }),
      /symbolic-link/i,
    );
    fs.rmSync(symDir, { recursive: true, force: true });
  }
  if (symlinkCreated) {
    fs.rmSync(symFile, { force: true });
  }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test 20b: SEC-04 Closure — F-02 (remove arbitrary outside evals/fixtures bypass),
// F-06 (validateCvVersionsRegistry local_ref_rel), F-10 (cmdEval --file & ADS)
// ===========================================================================
test('20b. SEC-04 closure: blocks F-02 outside evals/fixtures bypass, F-06 unsafe registry local_ref_rel, and F-10 eval --file/ADS', () => {
  const { dir, home, work } = makeTempWorkspace('veycraft-sec04-closure-');
  const outsideDir = path.join(dir, 'outside-spoofed');
  const outsideFixtures = path.join(outsideDir, 'evals', 'fixtures');
  fs.mkdirSync(outsideFixtures, { recursive: true });
  fs.mkdirSync(path.join(work, 'logs', 'resumes', 'safe-pkg'), { recursive: true });

  try {
    // F-02: Outside directory containing a spoofed evals/fixtures/ground-truth.json MUST NOT be trusted
    const spoofedGt = path.join(outsideFixtures, 'ground-truth.json');
    const spoofedDoc = path.join(outsideFixtures, 'secret-outside.md');
    fs.writeFileSync(spoofedGt, JSON.stringify({ ground_truth_metrics: ['38%'], forbidden_skills: [] }));
    fs.writeFileSync(spoofedDoc, '# Outside Secret\n- Improved latency by 38%.\n');

    const safeInside = path.join(work, 'logs', 'resumes', 'safe-pkg', 'resume.txt');
    fs.writeFileSync(safeInside, 'Alex Rivera\nBuilt Node.js services improving latency by 38%.');

    for (const [label, args] of [
      ['audit outside evals/fixtures', ['audit', spoofedDoc]],
      ['verify outside evals/fixtures', ['verify', spoofedDoc]],
      ['verify --facts outside evals/fixtures', ['verify', safeInside, '--facts', spoofedGt]],
      ['pre-submit --draft outside evals/fixtures', ['pre-submit', '--draft', spoofedDoc]],
    ]) {
      const res = runCli(args, { cwd: work, home });
      assert.notEqual(res.status, 0, `${label} must be rejected`);
      assert.match(res.stderr, /outside workspace boundary/i, `${label} must report boundary error`);
    }

    // Legitimate in-workspace file and legitimate SOURCE/evals/fixtures/ground-truth.json remain allowed
    const legitVerify = runCli(['verify', 'logs/resumes/safe-pkg/resume.txt', '--facts', path.join(REPO_ROOT, 'evals', 'fixtures', 'ground-truth.json')], { cwd: work, home });
    assert.equal(legitVerify.status, 0, legitVerify.stdout + legitVerify.stderr);

    // F-06: validateCvVersionsRegistry rejects traversal, absolute, drive, UNC, and mixed-separator unsafe local_ref_rel
    const nowIso = '2026-07-10T12:00:00Z';
    const makeReg = ref => ({
      schema_version: '1.0',
      updated_at: nowIso,
      versions: [{
        cv_version_id: 'cv-ref-test',
        version_number: 1,
        label: 'Ref Test',
        kind: 'generic',
        owner_scope: 'owner',
        base_cv_version_id: null,
        content_sha256: '1'.repeat(64),
        local_ref_rel: ref,
        created_at: nowIso,
        application_ids: [],
      }],
    });
    for (const badRef of [
      '../../../etc/passwd',
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\cv.html',
      'logs\\resumes\\..\\..\\secret.html',
      'logs/resumes/./cv-alice/resume.html',
      'logs/resumes/cv.html:ads',
    ]) {
      assert.equal(validateCvVersionsRegistry(makeReg(badRef)).valid, false, `Registry must reject unsafe local_ref_rel: ${badRef}`);
    }
    assert.equal(validateCvVersionsRegistry(makeReg('context/cv.md')).valid, true);
    assert.equal(validateCvVersionsRegistry(makeReg('logs/resumes/2026-07-10-acme/resume.html')).valid, true);
    const validTpReg = makeReg('logs/resumes/cv-client/resume.html');
    validTpReg.versions[0].owner_scope = 'third_party';
    assert.equal(validateCvVersionsRegistry(validTpReg).valid, true);

    // F-10: ADS rejection in validateSafeWorkspaceRelativePath & CLI assertSafeCliInputPath + cmdEval --file boundary & symlink safety
    assert.equal(isSafeWorkspaceRelativePath('logs/file.md:ads'), false);
    assert.equal(isSafeWorkspaceRelativePath('logs/file.md:Zone.Identifier'), false);
    assert.equal(isSafeWorkspaceRelativePath('logs/2026-07-10-acme/resume.md'), true);

    const rAdsAudit = runCli(['audit', 'logs/resumes/safe-pkg/resume.txt:ads'], { cwd: work, home });
    assert.notEqual(rAdsAudit.status, 0);
    assert.match(rAdsAudit.stderr, /alternate data stream|colon/i);

    const outsideEvalJson = path.join(outsideDir, 'external-eval.json');
    fs.writeFileSync(outsideEvalJson, JSON.stringify({ jd_evaluations: {} }));
    const rEvalOutside = runCli(['eval', '--file', outsideEvalJson], { cwd: work, home });
    assert.notEqual(rEvalOutside.status, 0, 'eval --file must reject outside-workspace path');
    assert.match(rEvalOutside.stderr, /outside workspace boundary/i);

    const rEvalTraversal = runCli(['eval', '--file', '../outside-spoofed/external-eval.json'], { cwd: work, home });
    assert.notEqual(rEvalTraversal.status, 0, 'eval --file must reject ../ traversal');
    assert.match(rEvalTraversal.stderr, /traversal/i);

    // Symlink / junction parent refusal on eval --file
    const evalJunc = path.join(work, 'logs', 'eval-junc');
    let juncCreated = false;
    try {
      fs.symlinkSync(outsideDir, evalJunc, process.platform === 'win32' ? 'junction' : 'dir');
      juncCreated = true;
    } catch { /* ignore if OS forbids links */ }
    if (juncCreated) {
      const rEvalJunc = runCli(['eval', '--file', 'logs/eval-junc/external-eval.json'], { cwd: work, home });
      assert.notEqual(rEvalJunc.status, 0, 'eval --file must reject symlinked/junction parent directory');
      assert.match(rEvalJunc.stderr, /symbolic-link/i);
      fs.rmSync(evalJunc, { recursive: true, force: true });
    }

    // Valid in-workspace eval JSON still works cleanly
    const insideEvalJson = path.join(work, 'logs', 'valid-eval.json');
    fs.copyFileSync(path.join(REPO_ROOT, 'evals', 'results', 'baseline-verified-run.json'), insideEvalJson);
    const rEvalInside = runCli(['eval', '--file', 'logs/valid-eval.json'], { cwd: work, home });
    assert.equal(rEvalInside.status, 0, rEvalInside.stdout + rEvalInside.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test 21: SEC-01 — SSRF Guard Bypass & Redirect Validation
// ===========================================================================
test('21. SEC-01: SSRF guard blocks IPv4/IPv6 private, loopback, link-local, CGNAT, IPv4-compatible/mapped/NAT64/6to4, and unsafe redirects', async () => {
  // 1-9. Direct URL classification across IPv4, IPv6, and alternate encodings
  const blockedUrls = [
    // 1. IPv4 loopback
    'http://127.0.0.1/admin',
    'http://127.255.255.254:8080/internal',
    // 2. IPv4 private RFC1918
    'http://10.0.0.1/secret',
    'http://172.16.0.1/secret',
    'http://172.31.255.255/secret',
    'http://192.168.1.1/secret',
    // 3. IPv4 link-local / cloud metadata
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.0.1/status',
    // 4. Carrier-grade NAT 100.64.0.0/10
    'http://100.64.0.1/cgnat',
    'http://100.100.100.200/latest/meta-data/',
    'http://100.127.255.254/cgnat',
    // 5. IPv4-mapped IPv6
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:100.64.0.1]/',
    'http://[0:0:0:0:0:ffff:10.0.0.1]/',
    // 6. IPv4-compatible IPv6
    'http://[::127.0.0.1]/',
    'http://[::169.254.169.254]/latest/meta-data/',
    'http://[::10.0.0.1]/',
    'http://[::192.168.0.1]/',
    'http://[::100.64.1.1]/',
    // 7. IPv6 loopback (canonical & expanded)
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[0000:0000:0000:0000:0000:0000:0000:0001]/',
    // 8. IPv6 unspecified, unique-local, link-local, site-local, multicast, NAT64, 6to4
    'http://[::]/',
    'http://[0:0:0:0:0:0:0:0]/',
    'http://[fc00::1]/',
    'http://[fd12:3456:789a::1]/',
    'http://[fe80::1]/',
    'http://[fe80::1%25eth0]/',
    'http://[fec0::1]/',
    'http://[ff02::1]/',
    'http://[64:ff9b::127.0.0.1]/',
    'http://[64:ff9b::169.254.169.254]/',
    'http://[2002:7f00:0001::1]/',
    'http://[2002:a9fe:a9fe::1]/',
    // 9. Alternate URL forms, decimal/octal/hex normalized by WHATWG URL, credentials, internal domains, non-HTTP
    'http://2130706433/', // 127.0.0.1 decimal
    'http://0x7f000001/', // 127.0.0.1 hex
    'http://0177.0.0.1/', // 127.0.0.1 octal
    'http://0.0.0.0/',
    'http://localhost:3000/',
    'http://api.localhost/',
    'http://service.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://user:pass@example.com/private',
    'ftp://example.com/file',
    'file:///etc/passwd',
  ];

  for (const raw of blockedUrls) {
    const reason = isBlockedSsrfUrl(raw);
    assert.ok(reason !== null, `Expected SSRF guard to block "${raw}", but got null`);
  }

  // 14. Safe public destinations remain permitted
  const allowedUrls = [
    'https://github.com/redasalem/veycraft',
    'https://boards.greenhouse.io/acme/jobs/12345',
    'https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555',
    'https://93.184.216.34/jobs', // public IPv4
    'https://100.63.255.254/public', // just below 100.64.0.0/10
    'https://100.128.0.1/public', // just above 100.64.0.0/10
    'https://[2606:4700:4700::1111]/', // public IPv6
  ];
  for (const raw of allowedUrls) {
    assert.equal(isBlockedSsrfUrl(raw), null, `Expected safe public URL "${raw}" to be allowed`);
  }

  // Helper to build synthetic mock fetch responses without any network traffic
  const makeResp = (status, location = null) => ({
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'location' ? location : null;
      },
    },
  });
  const mockPublicDns = async () => [{ address: '93.184.216.34', family: 4 }];

  // 10. Public URL redirecting (302) to private/loopback/metadata address -> blocked before redirect request is issued
  const calls10 = [];
  const mockFetch10 = async (url, opts) => {
    calls10.push({ url, redirect: opts.redirect });
    if (url === 'https://jobs.example.com/apply') {
      return makeResp(302, 'http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    }
    throw new Error(`Unexpected network call to ${url}`);
  };
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://jobs.example.com/apply', { fetchImpl: mockFetch10, lookupImpl: mockPublicDns }),
    /Redirect target blocked by SSRF guard/i,
  );
  assert.equal(calls10.length, 1, 'Must never issue fetch request to blocked redirect target');
  assert.equal(calls10[0].redirect, 'manual');

  // 11. Multi-hop redirect ending in blocked address ([::127.0.0.1] and 100.64.0.1)
  const calls11 = [];
  const mockFetch11 = async url => {
    calls11.push(url);
    if (url === 'https://short.example.com/1') return makeResp(301, 'https://careers.example.org/2');
    if (url === 'https://careers.example.org/2') return makeResp(307, 'http://[::127.0.0.1]:8080/internal');
    throw new Error(`Unexpected call to ${url}`);
  };
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://short.example.com/1', { fetchImpl: mockFetch11, lookupImpl: mockPublicDns }),
    /Redirect target blocked by SSRF guard/i,
  );
  assert.equal(calls11.length, 2);

  // 12a. Redirect loop detection
  const mockFetchLoop = async url => {
    if (url === 'https://loop.example.com/a') return makeResp(302, 'https://loop.example.com/b');
    if (url === 'https://loop.example.com/b') return makeResp(302, 'https://loop.example.com/a');
    return makeResp(200);
  };
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://loop.example.com/a', { fetchImpl: mockFetchLoop, lookupImpl: mockPublicDns }),
    /Redirect loop detected/i,
  );

  // 12b. Excessive redirect hops
  const mockFetchExcessive = async url => {
    const m = url.match(/\/hop-(\d+)$/);
    const n = m ? Number(m[1]) : 0;
    return makeResp(302, `https://hops.example.com/hop-${n + 1}`);
  };
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://hops.example.com/hop-0', { fetchImpl: mockFetchExcessive, lookupImpl: mockPublicDns, maxRedirects: 3 }),
    /Maximum redirect limit \(3\) exceeded/i,
  );

  // 13. Missing or malformed redirect Location header
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://badloc.example.com/missing', {
      fetchImpl: async () => makeResp(302, null),
      lookupImpl: mockPublicDns,
    }),
    /missing Location header/i,
  );
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://badloc.example.com/bad', {
      fetchImpl: async () => makeResp(302, 'http://[::invalid-ipv6'),
      lookupImpl: mockPublicDns,
    }),
    /Malformed redirect Location/i,
  );

  // 14b. Safe multi-hop public redirect succeeds
  const safeRes = await fetchUrlWithSafeRedirects('https://jobs.example.com/start', {
    fetchImpl: async url => {
      if (url === 'https://jobs.example.com/start') return makeResp(301, '/roles/backend');
      if (url === 'https://jobs.example.com/roles/backend') return makeResp(200);
      throw new Error(`Unexpected URL ${url}`);
    },
    lookupImpl: mockPublicDns,
  });
  assert.equal(safeRes.response.status, 200);
  assert.equal(safeRes.finalUrl, 'https://jobs.example.com/roles/backend');
  assert.equal(safeRes.redirects, 1);
});

// ===========================================================================
// Test 21b: SEC-01 Closure — F-03 (DNS resolution / DNS rebinding / pinned IP)
// and F-08 (trailing dots, Teredo 2001:0000::/32, discard 100::/64, TEST-NET)
// ===========================================================================
test('21b. SEC-01 closure: F-03 DNS resolution & rebinding defense + F-08 trailing dots, Teredo, discard & TEST-NET blocks', async () => {
  // F-08: Trailing dots, Teredo, IPv6 discard, and RFC 5737 TEST-NET ranges
  const f08Blocked = [
    'http://localhost../',
    'http://localhost.../',
    'http://api.localhost../',
    'http://service.local../',
    'http://[2001:0000:4136:e378:8000:63bf:80ff:fffe]/', // Teredo 2001:0000::/32
    'http://[2001:0:4136:e378::1]/',
    'http://[100::1]/', // RFC 6666 discard 100::/64
    'http://192.0.2.1/', // TEST-NET-1
    'http://198.51.100.1/', // TEST-NET-2
    'http://203.0.113.1/', // TEST-NET-3
  ];
  for (const u of f08Blocked) {
    assert.ok(isBlockedSsrfUrl(u) !== null, `F-08 expected SSRF guard to block "${u}"`);
  }
  assert.equal(isBlockedSsrfUrl('https://93.184.216.34/public'), null);
  assert.equal(isBlockedSsrfUrl('https://[2606:4700:4700::1111]/public'), null);
  assert.equal(classifyIpAddress('93.184.216.34'), null);
  assert.ok(classifyIpAddress('127.0.0.1') !== null);
  assert.ok(classifyIpAddress('169.254.169.254') !== null);
  assert.ok(classifyIpAddress('fe80::1') !== null);

  const makeResp = (status, location = null) => ({
    status,
    headers: { get: name => (String(name).toLowerCase() === 'location' ? location : null) },
  });

  // F-03: Hostnames resolving to loopback, RFC1918, metadata, IPv6 loopback/ULA/link-local, or mixed public+private must NEVER reach fetchImpl
  const dnsCases = [
    ['loopback IPv4', 'http://127.0.0.1.nip.io/admin', [{ address: '127.0.0.1', family: 4 }]],
    ['RFC1918 10/8', 'http://intranet.example.com/', [{ address: '10.0.0.15', family: 4 }]],
    ['RFC1918 172.16/12', 'http://corp.example.com/', [{ address: '172.16.4.2', family: 4 }]],
    ['RFC1918 192.168/16', 'http://router.example.com/', [{ address: '192.168.1.1', family: 4 }]],
    ['metadata link-local', 'http://169.254.169.254.nip.io/latest/meta-data/', [{ address: '169.254.169.254', family: 4 }]],
    ['IPv6 loopback', 'http://v6loop.example.com/', [{ address: '::1', family: 6 }]],
    ['IPv6 ULA', 'http://v6ula.example.com/', [{ address: 'fd12:3456:789a::1', family: 6 }]],
    ['IPv6 link-local', 'http://v6ll.example.com/', [{ address: 'fe80::1', family: 6 }]],
    ['multi-address with 1 private', 'http://dual.example.com/', [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]],
  ];

  for (const [label, url, answers] of dnsCases) {
    let called = false;
    await assert.rejects(
      () => fetchUrlWithSafeRedirects(url, {
        lookupImpl: async () => answers,
        fetchImpl: async () => {
          called = true;
          return makeResp(200);
        },
      }),
      /Blocked by SSRF guard/i,
      `F-03 must block DNS case: ${label}`,
    );
    assert.equal(called, false, `Mock request layer must NEVER be called for ${label}`);
  }

  // F-03: DNS lookup error fails closed without calling fetchImpl
  let errCalled = false;
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://nxdomain.example.invalid/', {
      lookupImpl: async () => { throw new Error('ENOTFOUND'); },
      fetchImpl: async () => {
        errCalled = true;
        return makeResp(200);
      },
    }),
    /DNS lookup failed/i,
  );
  assert.equal(errCalled, false);

  // F-03: Redirect from public hostname to hostname resolving to private/metadata IP must be blocked before 2nd hop request
  const hopCalls = [];
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://public-start.example.com/go', {
      lookupImpl: async host => {
        if (host === 'public-start.example.com') return [{ address: '93.184.216.34', family: 4 }];
        if (host === 'rebind-target.example.com') return [{ address: '169.254.169.254', family: 4 }];
        return [{ address: '93.184.216.34', family: 4 }];
      },
      fetchImpl: async url => {
        hopCalls.push(url);
        if (url === 'https://public-start.example.com/go') return makeResp(302, 'https://rebind-target.example.com/secret');
        throw new Error(`Unexpected fetch to ${url}`);
      },
    }),
    /Blocked by SSRF guard/i,
  );
  assert.deepEqual(hopCalls, ['https://public-start.example.com/go']);

  // F-03: Multi-hop redirect chain containing prohibited DNS target on hop 3
  const chainCalls = [];
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://hop1.example.com/', {
      lookupImpl: async host => {
        if (host === 'hop3-private.example.com') return [{ address: '127.0.0.1', family: 4 }];
        return [{ address: '93.184.216.34', family: 4 }];
      },
      fetchImpl: async url => {
        chainCalls.push(url);
        if (url === 'https://hop1.example.com/') return makeResp(301, 'https://hop2.example.com/');
        if (url === 'https://hop2.example.com/') return makeResp(307, 'https://hop3-private.example.com/internal');
        throw new Error(`Unexpected fetch to ${url}`);
      },
    }),
    /Blocked by SSRF guard/i,
  );
  assert.deepEqual(chainCalls, ['https://hop1.example.com/', 'https://hop2.example.com/']);

  // F-03: HEAD-to-GET fallback revalidates DNS (blocks DNS rebinding between HEAD 405 and GET retry)
  let lookupCount = 0;
  const fallbackMethods = [];
  const rebindLookup = async () => {
    lookupCount++;
    if (lookupCount === 1) return [{ address: '93.184.216.34', family: 4 }];
    return [{ address: '127.0.0.1', family: 4 }]; // rebinds on second lookup
  };
  const headRes = await fetchUrlWithSafeRedirects('https://rebind-head-get.example.com/profile', {
    method: 'HEAD',
    lookupImpl: rebindLookup,
    fetchImpl: async (_url, opts) => {
      fallbackMethods.push({ method: opts.method, pinned: opts.resolvedAddresses });
      return makeResp(405);
    },
  });
  assert.equal(headRes.response.status, 405);
  assert.deepEqual(headRes.resolvedAddresses, [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(
    () => fetchUrlWithSafeRedirects('https://rebind-head-get.example.com/profile', {
      method: 'GET',
      lookupImpl: rebindLookup,
      fetchImpl: async (_url, opts) => {
        fallbackMethods.push({ method: opts.method, pinned: opts.resolvedAddresses });
        return makeResp(200);
      },
    }),
    /Blocked by SSRF guard/i,
  );
  assert.equal(fallbackMethods.length, 1, 'Rebound GET fallback must never reach request layer');

  // F-03: Public hostname with safe addresses succeeds and passes pinned addresses
  let receivedPinned = null;
  const okRes = await fetchUrlWithSafeRedirects('https://safe-public.example.com/cv', {
    method: 'HEAD',
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }],
    fetchImpl: async (_url, opts) => {
      receivedPinned = opts.resolvedAddresses;
      return makeResp(200);
    },
  });
  assert.equal(okRes.response.status, 200);
  assert.deepEqual(receivedPinned, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  const validatedDirect = await resolveAndValidateSsrfHost(new URL('https://93.184.216.34/ok'));
  assert.deepEqual(validatedDirect, [{ address: '93.184.216.34', family: 4 }]);
});

// ===========================================================================
// Test 22: SEC-03 — DOCX Zip Bomb & Decompression DoS Defense
// ===========================================================================
test('22. SEC-03: hardened extractDocxText enforces input size, entry count, compressed/uncompressed budgets, duplicate/overlapping offsets, and integrity checks', () => {
  // Helper to construct synthetic ZIP/DOCX buffers with fine-grained control over headers & offsets
  function buildCustomDocxZip(entries, { eocdEntryCountOverride = null } = {}) {
    const locals = [];
    const centrals = [];
    const offsets = [];
    let offset = 0;

    for (let i = 0; i < entries.length; i++) {
      const f = entries[i];
      const nameBuf = Buffer.from(f.name, 'utf8');
      const method = f.method ?? 8;
      const rawData = Buffer.isBuffer(f.rawData) ? f.rawData : Buffer.from(String(f.rawData || ''), 'utf8');
      const compData = f.compressedData
        ? f.compressedData
        : (method === 8 ? zlib.deflateRawSync(rawData) : rawData);
      const uncompSize = f.declaredUncompressedSize !== undefined ? f.declaredUncompressedSize : rawData.length;
      const compSize = f.declaredCompressedSize !== undefined ? f.declaredCompressedSize : compData.length;

      let localOffset = offset;
      if (f.shareLocalOffsetWithIndex !== undefined) {
        localOffset = offsets[f.shareLocalOffsetWithIndex];
      } else {
        const lh = Buffer.alloc(30 + nameBuf.length);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(f.flags ?? 0, 6);
        lh.writeUInt16LE(method, 8);
        lh.writeUInt32LE(0, 14);
        lh.writeUInt32LE(compSize, 18);
        lh.writeUInt32LE(uncompSize, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        nameBuf.copy(lh, 30);
        locals.push(lh, compData);
        offsets.push(offset);
        offset += lh.length + compData.length;
      }

      if (f.customLocalOffset !== undefined) {
        localOffset = f.customLocalOffset;
      }

      const cd = Buffer.alloc(46 + nameBuf.length);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(f.flags ?? 0, 8);
      cd.writeUInt16LE(method, 10);
      cd.writeUInt32LE(0, 16);
      cd.writeUInt32LE(compSize, 20);
      cd.writeUInt32LE(uncompSize, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(localOffset, 42);
      nameBuf.copy(cd, 46);
      centrals.push(cd);
    }

    const cdBuf = Buffer.concat(centrals);
    const totalCount = eocdEntryCountOverride !== null ? eocdEntryCountOverride : entries.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(totalCount, 8);
    eocd.writeUInt16LE(totalCount, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, eocd]);
  }

  // 1 & 12. Normal valid DOCX + legitimate multi-header/footer DOCX succeed
  const validMultiPartDocx = buildCustomDocxZip([
    { name: '[Content_Types].xml', method: 0, rawData: '<Types/>' },
    { name: 'word/header1.xml', method: 8, rawData: '<w:hdr><w:p><w:t>Alex Rivera Header</w:t></w:p></w:hdr>' },
    { name: 'word/document.xml', method: 8, rawData: '<w:document><w:body><w:p><w:t>Senior Backend Engineer building Node.js systems (38% faster).</w:t></w:p></w:body></w:document>' },
    { name: 'word/footer1.xml', method: 8, rawData: '<w:ftr><w:p><w:t>Page 1 Footer</w:t></w:p></w:ftr>' },
  ]);
  const extractedText = extractDocxText(validMultiPartDocx);
  assert.match(extractedText, /Senior Backend Engineer building Node\.js systems/);
  assert.match(extractedText, /Alex Rivera Header/);
  assert.match(extractedText, /Page 1 Footer/);

  // 2. Oversized DOCX input buffer rejected before parsing
  const tinyValid = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:document><w:p><w:t>Valid Text</w:t></w:p></w:document>' },
  ]);
  assert.throws(
    () => extractDocxText(tinyValid, { maxInputBytes: 50 }),
    /Oversized \.docx file/i,
  );

  // 3a. Excessive total ZIP central directory entry count
  const manyEntriesDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:document><w:p><w:t>Hello</w:t></w:p></w:document>' },
    { name: 'word/extra1.xml', method: 0, rawData: '<x/>' },
    { name: 'word/extra2.xml', method: 0, rawData: '<x/>' },
    { name: 'word/extra3.xml', method: 0, rawData: '<x/>' },
  ]);
  assert.throws(
    () => extractDocxText(manyEntriesDocx, { maxTotalEntries: 3 }),
    /Excessive \.docx ZIP entry count/i,
  );

  // 3b. Excessive accepted word/(document|header*|footer*).xml parts
  const manyXmlPartsDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:p><w:t>Body</w:t></w:p>' },
    { name: 'word/header1.xml', method: 8, rawData: '<w:p><w:t>H1</w:t></w:p>' },
    { name: 'word/header2.xml', method: 8, rawData: '<w:p><w:t>H2</w:t></w:p>' },
    { name: 'word/footer1.xml', method: 8, rawData: '<w:p><w:t>F1</w:t></w:p>' },
  ]);
  assert.throws(
    () => extractDocxText(manyXmlPartsDocx, { maxXmlEntries: 2 }),
    /Excessive \.docx XML document\/header\/footer parts/i,
  );

  // 4. Oversized compressed entry
  assert.throws(
    () => extractDocxText(tinyValid, { maxCompressedEntryBytes: 10 }),
    /Oversized compressed \.docx entry/i,
  );

  // 5. Small compressed entry expanding to excessive decompressed output (classic single-entry zip bomb)
  // Also tests spoofed declaredUncompressedSize (declaring 100 bytes when actual payload inflates to 64 KB)
  const bombPayload = Buffer.from('<w:document><w:p><w:t>' + 'A'.repeat(65536) + '</w:t></w:p></w:document>', 'utf8');
  const spoofedBombDocx = buildCustomDocxZip([
    {
      name: 'word/document.xml',
      method: 8,
      rawData: bombPayload,
      declaredUncompressedSize: 100, // spoofing a tiny header size
    },
  ]);
  assert.throws(
    () => extractDocxText(spoofedBombDocx, { maxEntryUncompressedBytes: 4096, maxTotalUncompressedBytes: 8192 }),
    /Decompression limit exceeded/i,
  );

  // 5b. Honest declared uncompressed size exceeding per-entry cap rejected before inflate
  const declaredHugeDocx = buildCustomDocxZip([
    {
      name: 'word/document.xml',
      method: 8,
      rawData: bombPayload,
    },
  ]);
  assert.throws(
    () => extractDocxText(declaredHugeDocx, { maxEntryUncompressedBytes: 4096 }),
    /Oversized uncompressed \.docx entry/i,
  );

  // 6. Multiple entries whose cumulative uncompressed size exceeds total cap while each entry is individually under per-entry cap
  const part20k = '<w:p><w:t>' + 'B'.repeat(20000) + '</w:t></w:p>';
  const cumulativeOverflowDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: part20k },
    { name: 'word/header1.xml', method: 8, rawData: part20k },
    { name: 'word/footer1.xml', method: 8, rawData: part20k },
  ]);
  assert.throws(
    () => extractDocxText(cumulativeOverflowDocx, {
      maxEntryUncompressedBytes: 30000,
      maxTotalUncompressedBytes: 45000,
    }),
    /Cumulative \.docx uncompressed size exceeds/i,
  );

  // 7a. Duplicate entry names in central directory
  const duplicateNameDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:p><w:t>First</w:t></w:p>' },
    { name: 'word/document.xml', method: 8, rawData: '<w:p><w:t>Second</w:t></w:p>' },
  ]);
  assert.throws(
    () => extractDocxText(duplicateNameDocx),
    /Duplicate \.docx ZIP entry/i,
  );

  // 7b & 8. Shared/overlapping local file header offsets (classic non-recursive zip bomb where N central directory headers point to the same compressed stream)
  const sharedOffsetBombDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:p><w:t>Shared Bomb Payload</w:t></w:p>' },
    { name: 'word/header1.xml', method: 8, rawData: '<w:p><w:t>Shared Bomb Payload</w:t></w:p>', shareLocalOffsetWithIndex: 0 },
  ]);
  assert.throws(
    () => extractDocxText(sharedOffsetBombDocx),
    /overlapping or shared local file header\/data offsets/i,
  );

  // 9. Truncated ZIP / invalid central directory
  const truncatedDocx = tinyValid.subarray(0, tinyValid.length - 10);
  assert.throws(
    () => extractDocxText(truncatedDocx),
    /Corrupted \.docx/i,
  );

  // 10. Malformed compression stream
  const corruptDeflateDocx = buildCustomDocxZip([
    {
      name: 'word/document.xml',
      method: 8,
      compressedData: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
      declaredUncompressedSize: 50,
    },
  ]);
    assert.throws(
      () => extractDocxText(corruptDeflateDocx),
      /Corrupted deflate stream/i,
    );

    // 11. Boundary-size cases: exact limit succeeds, 1 byte over limit fails closed
  const boundaryXml = '<w:document><w:p><w:t>ExactBoundaryCheck</w:t></w:p></w:document>';
  const boundaryLen = Buffer.byteLength(boundaryXml, 'utf8');
  const boundaryDocx = buildCustomDocxZip([
    { name: 'word/document.xml', method: 8, rawData: boundaryXml },
  ]);
  assert.equal(
    extractDocxText(boundaryDocx, {
      maxInputBytes: boundaryDocx.length,
      maxEntryUncompressedBytes: boundaryLen,
      maxTotalUncompressedBytes: boundaryLen,
    }),
    'ExactBoundaryCheck',
  );
  assert.throws(
    () => extractDocxText(boundaryDocx, {
      maxInputBytes: boundaryDocx.length - 1,
    }),
    /Oversized \.docx file/i,
  );
  assert.throws(
    () => extractDocxText(boundaryDocx, {
      maxEntryUncompressedBytes: boundaryLen - 1,
    }),
    /Oversized uncompressed \.docx entry/i,
  );
  assert.throws(
    () => extractDocxText(boundaryDocx, {
      maxEntryUncompressedBytes: boundaryLen,
      maxTotalUncompressedBytes: boundaryLen - 1,
    }),
    /Cumulative \.docx uncompressed size exceeds/i,
  );
});

// ===========================================================================
// Test 22b: SEC-03 Closure — F-07 (pre-read bounded DOCX size limit in audit/verify)
// and F-09 (Central Directory gap-overlap rejection & zero-byte deflated XML at budget=0)
// ===========================================================================
test('22b. SEC-03 closure: F-07 pre-read DOCX size enforcement in audit/verify + F-09 CD gap-overlap & zero-byte inflate edge case', () => {
  function buildAdvancedZip(entries, { cdPaddingBeforeEocd = 0, dataDescriptor = false } = {}) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of entries) {
      const nameBuf = Buffer.from(f.name, 'utf8');
      const method = f.method ?? 8;
      const rawData = Buffer.isBuffer(f.rawData) ? f.rawData : Buffer.from(String(f.rawData || ''), 'utf8');
      const compData = f.compressedData || (method === 8 ? zlib.deflateRawSync(rawData) : rawData);
      const flags = f.flags ?? (dataDescriptor ? 0x0008 : 0);
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(flags, 6);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt32LE(dataDescriptor ? 0 : compData.length, 18);
      lh.writeUInt32LE(dataDescriptor ? 0 : rawData.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      nameBuf.copy(lh, 30);

      const dd = dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
      if (dataDescriptor) {
        dd.writeUInt32LE(0x08074b50, 0);
        dd.writeUInt32LE(compData.length, 8);
        dd.writeUInt32LE(rawData.length, 12);
      }
      locals.push(lh, compData, dd);

      const cd = Buffer.alloc(46 + nameBuf.length);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(flags, 8);
      cd.writeUInt16LE(method, 10);
      cd.writeUInt32LE(f.cdCompSize ?? compData.length, 20);
      cd.writeUInt32LE(f.cdUncompSize ?? rawData.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(offset, 42);
      nameBuf.copy(cd, 46);
      centrals.push(cd);

      offset += lh.length + compData.length + dd.length;
    }

    const cdBuf = Buffer.concat(centrals);
    const pad = Buffer.alloc(cdPaddingBeforeEocd);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, pad, eocd]);
  }

  // F-09a: Central Directory gap-overlap (padding before EOCD + local entry data extending past cdStart) MUST be rejected
  const cdGapOverlapZip = buildAdvancedZip([
    { name: 'word/document.xml', method: 8, rawData: '<w:p><w:t>Valid</w:t></w:p>' },
    { name: 'word/other.bin', method: 0, rawData: 'A'.repeat(10), cdCompSize: 60, cdUncompSize: 60 },
  ], { cdPaddingBeforeEocd: 100 });
  assert.throws(
    () => extractDocxText(cdGapOverlapZip),
    /Truncated or out-of-bounds \.docx entry data/i,
  );

  // F-09b: Zero-byte deflated XML part when remainingBudget === 0 succeeds (no false positive)
  const exactDocXml = '<w:p><w:t>ExactBudgetOk</w:t></w:p>';
  const exactDocLen = Buffer.byteLength(exactDocXml, 'utf8');
  const zeroByteFooterZip = buildAdvancedZip([
    { name: 'word/document.xml', method: 8, rawData: exactDocXml },
    { name: 'word/footer1.xml', method: 8, rawData: '' },
  ]);
  assert.equal(
    extractDocxText(zeroByteFooterZip, { maxTotalUncompressedBytes: exactDocLen }),
    'ExactBudgetOk',
  );

  // Spoofed 0-byte declared entry that actually inflates to >0 bytes when remainingBudget === 0 MUST still fail closed
  const spoofedZeroFooterZip = buildAdvancedZip([
    { name: 'word/document.xml', method: 8, rawData: exactDocXml },
    { name: 'word/footer1.xml', method: 8, rawData: 'X', cdUncompSize: 0 },
  ]);
  assert.throws(
    () => extractDocxText(spoofedZeroFooterZip, { maxTotalUncompressedBytes: exactDocLen }),
    /Decompression limit exceeded/i,
  );

  // Existing Data Descriptor (bit 3) compatibility & ordinary DOCX extraction preserved
  const ddZip = buildAdvancedZip([
    { name: 'word/', method: 0, rawData: '' },
    { name: 'word/document.xml', method: 8, rawData: '<w:document><w:p><w:t>Alex Rivera Data Descriptor Resume 38%</w:t></w:p></w:document>' },
    { name: 'word/header1.xml', method: 8, rawData: '<w:hdr><w:p><w:t>Header DD</w:t></w:p></w:hdr>' },
  ], { dataDescriptor: true });
  const ddText = extractDocxText(ddZip);
  assert.match(ddText, /Alex Rivera Data Descriptor Resume 38%/);
  assert.match(ddText, /Header DD/);

  // F-07: Pre-read bounded file reader & CLI audit/verify enforce DOCX_LIMITS.MAX_INPUT_BYTES before full file allocation
  const { dir, home, work } = makeTempWorkspace('veycraft-sec03-closure-');
  try {
    const exactLimitFile = path.join(work, 'logs', 'exact-limit.bin');
    fs.writeFileSync(exactLimitFile, Buffer.alloc(1024, 0x41));
    assert.equal(readFileBoundedSync(exactLimitFile, 1024, '.docx file').length, 1024);
    assert.throws(
      () => readFileBoundedSync(exactLimitFile, 1023, '.docx file'),
      /Oversized \.docx file/i,
    );

    // Sparse oversized file (> DOCX_LIMITS.MAX_INPUT_BYTES) created via ftruncateSync without allocating huge heap buffer
    const oversizedDocx = path.join(work, 'logs', 'oversized.docx');
    const fd = fs.openSync(oversizedDocx, 'w');
    try {
      fs.writeSync(fd, Buffer.from('PK\x03\x04', 'latin1'));
      fs.ftruncateSync(fd, DOCX_LIMITS.MAX_INPUT_BYTES + 1);
    } finally {
      fs.closeSync(fd);
    }
    assert.throws(
      () => readFileBoundedSync(oversizedDocx, DOCX_LIMITS.MAX_INPUT_BYTES, '.docx file'),
      /Oversized \.docx file/i,
    );

    // CLI audit and verify reject oversized .docx via bounded pre-read check
    const rAuditOver = runCli(['audit', 'logs/oversized.docx'], { cwd: work, home });
    assert.notEqual(rAuditOver.status, 0, 'audit must reject oversized .docx');
    assert.match(rAuditOver.stderr, /Oversized \.docx file/i);

    const rVerifyOver = runCli(['verify', 'logs/oversized.docx'], { cwd: work, home });
    assert.notEqual(rVerifyOver.status, 0, 'verify must reject oversized .docx');
    assert.match(rVerifyOver.stdout + rVerifyOver.stderr, /Oversized \.docx file/i);

    // Valid ordinary .docx and normal text files continue to pass audit and verify
    const validDocxPath = path.join(work, 'logs', 'valid.docx');
    fs.writeFileSync(validDocxPath, ddZip);
    const rAuditOk = runCli(['audit', 'logs/valid.docx'], { cwd: work, home });
    assert.equal(rAuditOk.status, 0, rAuditOk.stderr);
    const rVerifyOk = runCli(['verify', 'logs/valid.docx'], { cwd: work, home });
    assert.equal(rVerifyOk.status, 0, rVerifyOk.stdout + rVerifyOk.stderr);

    // Exact maximum permitted DOCX size (padded ZIP comment up to DOCX_LIMITS.MAX_INPUT_BYTES) passes readFileBoundedSync + verify
    const baseZip = buildAdvancedZip([
      { name: 'word/document.xml', method: 8, rawData: '<w:document><w:p><w:t>Exact Max Size Resume 38%</w:t></w:p></w:document>' },
    ]);
    const exactMaxPadFile = path.join(work, 'logs', 'exact-max.docx');
    // Put a harmless stored padding entry so total file size equals DOCX_LIMITS.MAX_INPUT_BYTES exactly
    const padSize = DOCX_LIMITS.MAX_INPUT_BYTES - baseZip.length - (30 + 46 + 'word/pad.bin'.length * 2);
    const exactMaxZip = buildAdvancedZip([
      { name: 'word/document.xml', method: 8, rawData: '<w:document><w:p><w:t>Exact Max Size Resume 38%</w:t></w:p></w:document>' },
      { name: 'word/pad.bin', method: 0, rawData: Buffer.alloc(padSize, 0x20) },
    ]);
    assert.equal(exactMaxZip.length, DOCX_LIMITS.MAX_INPUT_BYTES);
    fs.writeFileSync(exactMaxPadFile, exactMaxZip);
    const rVerifyExactMax = runCli(['verify', 'logs/exact-max.docx'], { cwd: work, home });
    assert.equal(rVerifyExactMax.status, 0, rVerifyExactMax.stdout + rVerifyExactMax.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
