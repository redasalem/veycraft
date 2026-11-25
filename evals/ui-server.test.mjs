import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOCAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = [
  process.env.JHO_CLI_PATH,
  path.join(LOCAL_ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find((p) => p && fs.existsSync(p));
assert.ok(CLI_PATH, 'Could not locate bin/cli.mjs');

const BIN_DIR = path.dirname(CLI_PATH);
const REPO_ROOT = path.resolve(BIN_DIR, '..');
const UI_SERVER_PATH = path.join(BIN_DIR, 'ui-server.mjs');
const CORE_OPS_PATH = path.join(BIN_DIR, 'core-ops.mjs');
const CAREER_INTEL_PATH = path.join(BIN_DIR, 'career-intelligence.mjs');
const { startUiServer } = await import(pathToFileURL(UI_SERVER_PATH).href);
const { syncMcpConfigs } = await import(pathToFileURL(CORE_OPS_PATH).href);
const { computeApplicationId } = await import(pathToFileURL(CAREER_INTEL_PATH).href);

function rawHttpRequest(port, reqPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

test('glama.json manifest and static ui/ zero-XSS invariants hold', () => {
  const glamaPath = path.join(REPO_ROOT, 'glama.json');
  assert.ok(fs.existsSync(glamaPath), 'glama.json must exist at repository root');
  const glama = JSON.parse(fs.readFileSync(glamaPath, 'utf8'));
  assert.equal(glama.$schema, 'https://glama.ai/mcp/schemas/server.json');
  assert.deepEqual(glama.maintainers, ['redasalem']);

  const uiDir = path.join(REPO_ROOT, 'ui');
  for (const file of ['index.html', 'styles.css', 'app.js', 'favicon.svg']) {
    const full = path.join(uiDir, file);
    assert.ok(fs.existsSync(full), `Missing ui/${file}`);
    const content = fs.readFileSync(full, 'utf8');
    // Forbid dangerous DOM sinks & inline style/script attributes
    const forbiddenTokens = ['inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML', 'document.' + 'write'];
    for (const tok of forbiddenTokens) {
      assert.equal(content.includes(tok), false, `Forbidden DOM sink "${tok}" found in ui/${file}`);
    }
    if (file === 'index.html') {
      assert.equal(/\sstyle\s*=/i.test(content), false, 'Inline style="" forbidden in ui/index.html');
      assert.equal(/<script(?![^>]*\bsrc=)/i.test(content), false, 'Inline <script> forbidden in ui/index.html');
    }
  }
});

test('UI server binds strictly to 127.0.0.1, serves static assets with CSP, and handles empty workspace gracefully', async (t) => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-ui-empty-'));
  const handle = await startUiServer({
    root: emptyDir,
    source: REPO_ROOT,
    port: 0,
    openBrowser: false,
  });
  t.after(async () => {
    await handle.close();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  assert.equal(handle.host, '127.0.0.1');
  assert.equal(handle.server.address().address, '127.0.0.1');
  assert.ok(handle.port > 0);

  for (const [route, expectedType] of [
    ['/', 'text/html; charset=utf-8'],
    ['/index.html', 'text/html; charset=utf-8'],
    ['/styles.css', 'text/css; charset=utf-8'],
    ['/app.js', 'text/javascript; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
  ]) {
    const res = await rawHttpRequest(handle.port, route);
    assert.equal(res.status, 200, `Expected 200 on ${route}`);
    assert.equal(res.headers['content-type'], expectedType);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.ok(String(res.headers['content-security-policy']).includes("default-src 'none'"));
    assert.ok(String(res.headers['content-security-policy']).includes("script-src 'self'"));
  }

  for (const apiRoute of ['/api/overview', '/api/doctor', '/api/applications', '/api/analytics', '/api/next', '/api/skills']) {
    const res = await rawHttpRequest(handle.port, apiRoute);
    assert.equal(res.status, 200, `Expected 200 on ${apiRoute} for empty workspace`);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.ok, true);
  }

  const overview = JSON.parse((await rawHttpRequest(handle.port, '/api/overview')).body);
  assert.equal(overview.doctor.payload.initialized, false);
  assert.equal(overview.doctor.payload.offline_mode, true);
  assert.equal(overview.summary.funnel.total_tracked, 0);

  const skills = JSON.parse((await rawHttpRequest(handle.port, '/api/skills')).body);
  assert.equal(skills.skills_count, 54);

  const skillDetail = JSON.parse((await rawHttpRequest(handle.port, '/api/skills/daily-run')).body);
  assert.equal(skillDetail.uri, 'veycraft://skill/daily-run');
  assert.ok(skillDetail.content.includes('## When to Use & Preconditions'));

  const remoteSkillDetail = JSON.parse((await rawHttpRequest(handle.port, '/api/skills/github-cli-remote-manager')).body);
  assert.equal(remoteSkillDetail.uri, 'veycraft://skill/github-cli-remote-manager');
  assert.ok(remoteSkillDetail.content.includes('## Deterministic Step-by-Step Execution'));

  // Empty workspace remains 100% empty on disk (read-only guarantee)
  assert.deepEqual(fs.readdirSync(emptyDir), []);
});

test('UI server enforces Host/Origin/Content-Type/size/method/path-traversal guards and auto-falls back on EADDRINUSE', async (t) => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-ui-sec-'));
  fs.writeFileSync(path.join(wsDir, '.env'), 'SECRET_KEY=top_secret_do_not_expose\n', 'utf8');

  const handle1 = await startUiServer({
    root: wsDir,
    source: REPO_ROOT,
    port: 0,
    openBrowser: false,
  });
  // Occupy handle1.port and verify non-explicit port auto-falls back cleanly while explicit port rejects
  const handleFallback = await startUiServer({
    root: wsDir,
    source: REPO_ROOT,
    port: handle1.port,
    portExplicit: false,
    openBrowser: false,
    stderr: { write: () => {} },
  });
  assert.notEqual(handleFallback.port, handle1.port);

  await assert.rejects(
    () => startUiServer({ root: wsDir, source: REPO_ROOT, port: handle1.port, portExplicit: true, openBrowser: false }),
    /already in use/,
  );

  t.after(async () => {
    await handleFallback.close();
    await handle1.close();
    fs.rmSync(wsDir, { recursive: true, force: true });
  });

  // 1. DNS-rebinding Host spoof -> 403
  const badHost = await rawHttpRequest(handle1.port, '/api/overview', {
    headers: { Host: 'evil.attacker.example:4310' },
  });
  assert.equal(badHost.status, 403);
  assert.equal(JSON.parse(badHost.body).error.code, 'invalid_host');

  // 2. Cross-origin Origin header -> 403
  const badOrigin = await rawHttpRequest(handle1.port, '/api/route', {
    method: 'POST',
    headers: {
      Origin: 'http://evil.attacker.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '/demo' }),
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(JSON.parse(badOrigin.body).error.code, 'cross_origin_blocked');

  // 3. Non-JSON Content-Type on POST -> 415
  const badMedia = await rawHttpRequest(handle1.port, '/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"query":"/demo"}',
  });
  assert.equal(badMedia.status, 415);

  // 4. Disallowed HTTP method -> 405
  const badMethod = await rawHttpRequest(handle1.port, '/api/applications', { method: 'DELETE' });
  assert.equal(badMethod.status, 405);

  // 5. Static & API path-traversal attempts -> 404/400/403 (zero file disclosure)
  for (const attempt of ['/../package.json', '/%2e%2e/package.json', '/api/skills/..%2Fpackage.json']) {
    const res = await rawHttpRequest(handle1.port, attempt);
    assert.equal(res.status, 404, `Expected 404 for ${attempt}`);
    assert.equal(res.body.includes('dependencies'), false);
  }

  for (const badPath of ['../package.json', '.env']) {
    const res = await rawHttpRequest(handle1.port, '/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: badPath }),
    });
    assert.ok([400, 403, 404].includes(res.status));
    assert.equal(res.body.includes('top_secret_do_not_expose'), false);
  }

  // 6. Oversized body (> 512 KB) -> 413
  const hugeBody = JSON.stringify({ text: 'x'.repeat(540 * 1024) });
  const oversized = await rawHttpRequest(handle1.port, '/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: hugeBody,
  });
  assert.equal(oversized.status, 413);
});

test('UI server isolates third-party ledger records, preserves disk immutability, and executes Studio APIs', async (t) => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-ui-ledger-'));
  fs.mkdirSync(path.join(wsDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(wsDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(wsDir, 'drafts'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(wsDir, 'config', 'guardrails.yaml'));
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(wsDir, 'config', 'invariants.txt'));

  const ledgerFile = path.join(wsDir, 'logs', 'applications-log.json');
  const ledgerContent = JSON.stringify([
    {
      schema_version: '2.0',
      application_id: computeApplicationId('gh-owner-01'),
      job_id: 'gh-owner-01',
      company: 'Owner Fintech',
      title: 'Senior Backend Engineer',
      platform: 'greenhouse',
      status: 'applied',
      match_score: 8.7,
      applied_at: '2026-11-20T10:00:00Z',
      updated_at: '2026-11-20T10:00:00Z',
      provenance: { created_by: 'test', third_party_subject: false, receipt_verified: true },
      notes: 'receipt: "Thank you for applying to Owner Fintech"',
    },
    {
      schema_version: '2.0',
      application_id: computeApplicationId('gh-friend-02'),
      job_id: 'gh-friend-02',
      company: 'ThirdParty Corp',
      title: 'Data Analyst',
      platform: 'lever',
      status: 'prepared',
      provenance: { created_by: 'test', third_party_subject: true },
    },
  ], null, 2);
  fs.writeFileSync(ledgerFile, ledgerContent, 'utf8');

  const sampleCv = path.join(wsDir, 'drafts', 'sample-cv.md');
  fs.writeFileSync(
    sampleCv,
    [
      '# Backend Profile',
      ...Array.from({ length: 16 }, (_, i) => `- Engineered payment service ${i + 1} reducing p95 latency by ${15 + i}% across 4 regions.`),
      '',
    ].join('\n'),
    'utf8',
  );

  const handle = await startUiServer({
    root: wsDir,
    source: REPO_ROOT,
    port: 0,
    openBrowser: false,
  });
  t.after(async () => {
    await handle.close();
    fs.rmSync(wsDir, { recursive: true, force: true });
  });

  const appsRes = JSON.parse((await rawHttpRequest(handle.port, '/api/applications')).body);
  assert.equal(appsRes.kanban.total_owner_records, 1);
  assert.equal(appsRes.kanban.third_party_excluded, 1);
  assert.equal(appsRes.kanban.columns.applied.length, 1);
  assert.equal(appsRes.kanban.columns.applied[0].company, 'Owner Fintech');
  assert.equal(JSON.stringify(appsRes).includes('ThirdParty Corp'), false);

  const routeRes = JSON.parse((await rawHttpRequest(handle.port, '/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '/quick-tailor' }),
  })).body);
  assert.equal(routeRes.route.intent, 'tailor-cv');

  const inlineAudit = JSON.parse((await rawHttpRequest(handle.port, '/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: fs.readFileSync(sampleCv, 'utf8'), format: 'md' }),
  })).body);
  assert.ok(inlineAudit.audit.total_score >= 80);

  const fileAudit = JSON.parse((await rawHttpRequest(handle.port, '/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'drafts/sample-cv.md' }),
  })).body);
  assert.equal(fileAudit.audit.total_score, inlineAudit.audit.total_score);

  const verifyBad = JSON.parse((await rawHttpRequest(handle.port, '/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '<p>Hello {{CANDIDATE_NAME}} with 999% and Kubernetes.</p>',
      format: 'html',
      facts_json: { ground_truth_metrics: ['38%'], forbidden_skills: ['Kubernetes'] },
    }),
  })).body);
  assert.equal(verifyBad.verification.ok, false);
  assert.ok(verifyBad.verification.error_count >= 2);

  const preSubmitRes = JSON.parse((await rawHttpRequest(handle.port, '/api/pre-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'greenhouse',
      company: 'New Co',
      title: 'Platform Engineer',
      text: 'Concise hiring manager note highlighting verified Node.js reliability work.',
    }),
  })).body);
  assert.equal(preSubmitRes.evaluation.allowed, true);

  // Confirm ledger on disk is byte-for-byte unchanged
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), ledgerContent);
});

test('sync-mcp --with-veycraft supports --dry-run, atomic .veycraft.bak backups, and custom entry preservation', () => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-sync-mcp-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-sync-home-'));
  try {
    // 1. Default sync-mcp (without --with-veycraft) does NOT inject veycraft
    syncMcpConfigs({
      root: wsDir,
      isGlobal: false,
      source: REPO_ROOT,
      home: fakeHome,
      env: {},
      platform: 'linux',
      withVeycraft: false,
      dryRun: false,
    });
    const initialMcp = JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8'));
    assert.ok(initialMcp.mcpServers.playwright);
    assert.equal(initialMcp.mcpServers.veycraft, undefined);

    // 2. --with-veycraft --dry-run plans updates with ZERO disk writes
    const dryRes = syncMcpConfigs({
      root: wsDir,
      isGlobal: false,
      source: REPO_ROOT,
      home: fakeHome,
      env: {},
      platform: 'linux',
      withVeycraft: true,
      dryRun: true,
    });
    assert.equal(dryRes.dry_run, true);
    assert.ok(dryRes.updated > 0);
    assert.equal(fs.existsSync(path.join(wsDir, '.mcp.json.veycraft.bak')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8')).mcpServers.veycraft, undefined);

    // 3. --with-veycraft writes veycraft across JSON, VS Code, and Codex TOML + creates .veycraft.bak backups
    const applyRes = syncMcpConfigs({
      root: wsDir,
      isGlobal: false,
      source: REPO_ROOT,
      home: fakeHome,
      env: {},
      platform: 'win32',
      withVeycraft: true,
      dryRun: false,
    });
    assert.ok(applyRes.updated > 0);
    assert.equal(fs.existsSync(path.join(wsDir, '.mcp.json.veycraft.bak')), true);

    const updatedMcp = JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8'));
    assert.equal(updatedMcp.mcpServers.veycraft.command, 'cmd');
    assert.deepEqual(updatedMcp.mcpServers.veycraft.args, ['/c', 'npx', '-y', 'veycraft', 'mcp']);

    const vsMcp = JSON.parse(fs.readFileSync(path.join(wsDir, '.vscode', 'mcp.json'), 'utf8'));
    assert.equal(vsMcp.servers.veycraft.type, 'stdio');

    const codexToml = fs.readFileSync(path.join(wsDir, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexToml.includes('[mcp_servers.veycraft]'));

    // 4. Custom user veycraft entry is preserved and never clobbered
    updatedMcp.mcpServers.veycraft = { command: 'node', args: ['/custom/veycraft-mcp.mjs'] };
    fs.writeFileSync(path.join(wsDir, '.mcp.json'), JSON.stringify(updatedMcp, null, 2) + '\n', 'utf8');

    const preserveRes = syncMcpConfigs({
      root: wsDir,
      isGlobal: false,
      source: REPO_ROOT,
      home: fakeHome,
      env: {},
      platform: 'win32',
      withVeycraft: true,
      dryRun: false,
    });
    assert.ok(preserveRes.warnings.some((w) => w.includes('Preserved existing custom veycraft MCP server')));
    const afterPreserve = JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8'));
    assert.equal(afterPreserve.mcpServers.veycraft.command, 'node');

    // 5. CLI subprocess check for `veycraft sync-mcp --with-veycraft --dry-run --json`
    const cliDry = spawnSync(process.execPath, [CLI_PATH, 'sync-mcp', '--with-veycraft', '--dry-run', '--json'], {
      cwd: wsDir,
      env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      encoding: 'utf8',
    });
    assert.equal(cliDry.status, 0, cliDry.stderr);
    assert.equal(JSON.parse(cliDry.stdout).with_veycraft, true);
  } finally {
    fs.rmSync(wsDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('CLI subprocess `veycraft ui --port 0 --no-open --workspace <dir>` boots cleanly and serves /api/overview', async (t) => {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-ui-cli-'));
  const child = spawn(process.execPath, [CLI_PATH, 'ui', '--port', '0', '--no-open', '--workspace', wsDir], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exitPromise;
    }
    fs.rmSync(wsDir, { recursive: true, force: true });
  });

  const url = await new Promise((resolve, reject) => {
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for UI banner. stdout=${out} stderr=${errOut}`));
    }, 8000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], port: Number(m[1]) });
      }
    });
    child.stderr.on('data', (chunk) => {
      errOut += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`UI CLI exited prematurely (${code}). stdout=${out} stderr=${errOut}`));
    });
  });

  const res = await rawHttpRequest(url.port, '/api/overview');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(fs.realpathSync(body.meta.workspace_root), fs.realpathSync(wsDir));

  if (process.platform !== 'win32') {
    child.kill('SIGINT');
    const exited = await exitPromise;
    assert.equal(exited.code, 0);
  } else {
    child.kill();
    await exitPromise;
  }
});
