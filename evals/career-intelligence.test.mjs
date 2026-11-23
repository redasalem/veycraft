import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
  isBlockedSsrfUrl,
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
} = await import(pathToFileURL(path.join(BIN_DIR, 'career-intelligence.mjs')).href);

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

    const smallStats = computeCareerAnalytics(smallRecords, null, { nowIso });
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

    const fullStats = computeCareerAnalytics(fullRecords, null, { nowIso });
    // Determinism check: identical inputs produce byte-identical analytics
    const fullStatsRepeat = computeCareerAnalytics(fullRecords, null, { nowIso });
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
    const novStats = computeCareerAnalytics(fullRecords, null, { nowIso, period: '2026-11' });
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
