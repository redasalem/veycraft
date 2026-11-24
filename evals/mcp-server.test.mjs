import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const MCP_SERVER_PATH = path.join(BIN_DIR, 'mcp-server.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-mcp-test-'));
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'drafts'), { recursive: true });

  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(dir, 'config', 'guardrails.yaml'));
  fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(dir, 'config', 'invariants.txt'));

  fs.writeFileSync(
    path.join(dir, 'drafts', 'clean-cv.md'),
    [
      '# Career Profile',
      '',
      '## Experience',
      '- Built Node.js payment APIs handling 120k requests per day with 99.95% uptime across 3 regions.',
      '- Reduced p95 latency by 38% across 14 backend microservices over 18 months.',
      '- Automated deployment pipelines saving 6 hours per week for 12 engineers.',
      '- Authored deterministic schema validators catching 45 production edge cases.',
      '- Migrated 8 PostgreSQL clusters with 0 minutes unplanned downtime.',
      '- Delivered observability dashboards tracking 25 core SLA metrics.',
      '',
      ...Array.from({ length: 18 }, (_, i) => `- Delivered reliable platform component ${i + 1} improving throughput by ${10 + i}% across staging and production clusters.`),
      '',
      'https://github.com/valid-user/veycraft-sample',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'sloppy-cv.md'),
    [
      '# Summary',
      'Results-driven engineer — passionate about excellence and dynamic thinker vibes.',
      '- Built stuff.',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'tailored-good.html'),
    '<html><body><h1>Resume</h1><p>Built APIs improving latency by 38% across 3 regions.</p></body></html>\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'tailored-bad.html'),
    '<html><body><p>Unresolved {{CANDIDATE_NAME}} metric 999% — with Kubernetes.</p></body></html>\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'facts.json'),
    JSON.stringify({
      ground_truth_metrics: ['38%', '3'],
      forbidden_skills: ['Kubernetes'],
    }, null, 2),
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'outreach-short.txt'),
    'Hi team, I saw your Backend Engineer opening and shared my resume showing 38% latency improvements on Node.js services.',
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'drafts', 'outreach-long.txt'),
    Array.from({ length: 85 }, (_, i) => `word${i}`).join(' '),
    'utf8',
  );

  return dir;
}

class McpStdioClient {
  constructor(entryPath, { cwd, env } = {}) {
    this.child = spawn(process.execPath, [entryPath, ...(entryPath === CLI_PATH ? ['mcp'] : [])], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stdoutLines = [];
    this.stderrText = '';
    this._buf = '';
    this._waiters = new Map();
    this._anyWaiters = [];
    this._nextId = 1;

    this.exitPromise = new Promise((resolve) => {
      this.child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    this.child.stdout.on('data', (chunk) => {
      this._buf += chunk.toString('utf8');
      let idx;
      while ((idx = this._buf.indexOf('\n')) !== -1) {
        const line = this._buf.slice(0, idx).replace(/\r$/, '');
        this._buf = this._buf.slice(idx + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          throw new Error(`Non-JSON line emitted on MCP stdout: ${JSON.stringify(line)} (${err.message})`);
        }
        assert.equal(parsed.jsonrpc, '2.0', `Expected jsonrpc "2.0" on stdout frame: ${line}`);
        this.stdoutLines.push(parsed);
        if (parsed.id !== undefined && parsed.id !== null && this._waiters.has(parsed.id)) {
          const resolve = this._waiters.get(parsed.id);
          this._waiters.delete(parsed.id);
          resolve(parsed);
        } else if (this._anyWaiters.length > 0) {
          const resolve = this._anyWaiters.shift();
          resolve(parsed);
        }
      }
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderrText += chunk.toString('utf8');
    });
  }

  sendRaw(payload) {
    this.child.stdin.write(payload);
  }

  request(method, params = undefined, { id = this._nextId++, eol = '\n' } = {}) {
    const req = params === undefined
      ? { jsonrpc: '2.0', id, method }
      : { jsonrpc: '2.0', id, method, params };
    const p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters.delete(id);
        reject(new Error(`Timeout waiting for MCP response to ${method} (id=${id}). stderr=${this.stderrText}`));
      }, 10000);
      this._waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    this.child.stdin.write(`${JSON.stringify(req)}${eol}`);
    return p;
  }

  notify(method, params = undefined) {
    const note = params === undefined
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', method, params };
    this.child.stdin.write(`${JSON.stringify(note)}\n`);
  }

  nextUnmatchedMessage() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for error frame. stderr=${this.stderrText}`));
      }, 5000);
      this._anyWaiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async close() {
    this.child.stdin.end();
    const res = await this.exitPromise;
    assert.equal(this._buf.trim(), '', `Trailing non-terminated stdout buffer: ${JSON.stringify(this._buf)}`);
    return res;
  }

  async dispose() {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try { this.child.kill(); } catch { /* ignore */ }
    }
    await Promise.race([
      this.exitPromise,
      new Promise((r) => setTimeout(r, 1000)),
    ]);
  }
}

function safeRm(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    // Windows best-effort temp cleanup
  }
}

test('MCP stdio protocol lifecycle, version negotiation, notifications, ping, and EOF exit', async () => {
  const ws = createTempWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-mcp-home-'));
  try {
    for (const [requested, expected] of [
      ['2025-06-18', '2025-06-18'],
      ['2025-03-26', '2025-03-26'],
      ['2024-11-05', '2024-11-05'],
      ['1999-01-01', '2025-06-18'],
    ]) {
      const client = new McpStdioClient(CLI_PATH, {
        cwd: ws,
        env: { VEYCRAFT_HOME: homeDir, CI: '' },
      });
      const initRes = await client.request('initialize', {
        protocolVersion: requested,
        capabilities: {},
        clientInfo: { name: 'eval-suite', version: '1.0.0' },
      });
      assert.equal(initRes.result.protocolVersion, expected);
      assert.equal(initRes.result.serverInfo.name, 'veycraft');
      assert.equal(initRes.result.serverInfo.version, PKG_VERSION);
      assert.deepEqual(initRes.result.capabilities, {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      });

      const countBeforeNotes = client.stdoutLines.length;
      client.notify('notifications/initialized');
      client.notify('notifications/cancelled', { requestId: 999 });
      const pingRes = await client.request('ping');
      assert.deepEqual(pingRes.result, {});
      // Notifications must emit zero frames: only the ping response should be added.
      assert.equal(client.stdoutLines.length, countBeforeNotes + 1);

      const exit = await client.close();
      assert.equal(exit.code, 0);
      assert.equal(exit.signal, null);
    }
  } finally {
    safeRm(ws);
    safeRm(homeDir);
  }
});

test('MCP tools/list, all 8 read-only offline tools, and resources read/templates', async () => {
  const ws = createTempWorkspace();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-mcp-home-'));
  // Add .git/hooks dir and an external URL in context/profile.md to assert doctor stays readOnly & offline
  fs.mkdirSync(path.join(ws, '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, 'context', 'profile.md'),
    '# Candidate Profile\nFull Name: Real Engineer\nGitHub: https://github.com/nonexistent-veycraft-offline-check-404\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(ws, 'logs', 'applications-log.json'),
    JSON.stringify([
      {
        application_id: 'app_3edce856709a',
        job_id: 'gh-123',
        company: 'Acme Cloud',
        role_title: 'Backend Engineer',
        platform: 'greenhouse',
        job_url: 'https://boards.greenhouse.io/acme/jobs/123',
        status: 'applied',
        applied_at: '2026-10-01T12:00:00Z',
        match_score: 8,
      },
    ], null, 2),
    'utf8',
  );

  const client = new McpStdioClient(CLI_PATH, {
    cwd: ws,
    env: { VEYCRAFT_HOME: homeDir, CI: '' },
  });

  try {
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    client.notify('notifications/initialized');

    // 1. tools/list
    const listRes = await client.request('tools/list');
    const tools = listRes.result.tools;
    assert.equal(tools.length, 8);
    assert.deepEqual(
      tools.map((t) => t.name),
      [
        'veycraft_doctor',
        'veycraft_route',
        'veycraft_audit',
        'veycraft_verify',
        'veycraft_pre_submit',
        'veycraft_career_summary',
        'veycraft_career_next',
        'veycraft_get_skill',
      ],
    );
    for (const tool of tools) {
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      assert.equal(tool.inputSchema.additionalProperties, false);
    }

    // 2. veycraft_doctor (must be offline + readOnly)
    const docRes = await client.request('tools/call', {
      name: 'veycraft_doctor',
      arguments: {},
    });
    assert.equal(docRes.result.isError, undefined);
    const docData = JSON.parse(docRes.result.content[0].text);
    assert.equal(docData.version, PKG_VERSION);
    assert.equal(docData.git_pre_commit_shield, false);
    assert.equal(fs.existsSync(path.join(ws, '.git', 'hooks', 'pre-commit')), false);
    assert.equal(docData.offline_mode, true);
    assert.equal(docData.link_audit.checked_reachable, 0);
    assert.equal(docData.link_audit.dead_urls.length, 0);

    // 3. veycraft_route
    const routeRes = await client.request('tools/call', {
      name: 'veycraft_route',
      arguments: { query: 'tailor my cv for a backend engineer job' },
    });
    const routeData = JSON.parse(routeRes.result.content[0].text);
    assert.equal(routeData.intent, 'tailor-cv');
    assert.ok(routeData.skills.includes('03-tailor-resume-and-verify'));

    // 4. veycraft_audit (clean vs sloppy)
    const cleanAuditRes = await client.request('tools/call', {
      name: 'veycraft_audit',
      arguments: { path: 'drafts/clean-cv.md' },
    });
    const cleanAudit = JSON.parse(cleanAuditRes.result.content[0].text);
    assert.equal(cleanAudit.cliches_found.length, 0);
    assert.equal(cleanAudit.em_dash_count, 0);
    assert.ok(cleanAudit.total_score >= 85);
    assert.equal(fs.existsSync(path.join(ws, 'logs', 'exports', 'cv-hygiene-card.svg')), false);

    const sloppyAuditRes = await client.request('tools/call', {
      name: 'veycraft_audit',
      arguments: { path: 'drafts/sloppy-cv.md' },
    });
    const sloppyAudit = JSON.parse(sloppyAuditRes.result.content[0].text);
    assert.ok(sloppyAudit.cliches_found.length > 0);
    assert.equal(sloppyAudit.em_dash_count, 1);

    // 5. veycraft_verify (good vs bad with facts_path)
    const verifyGoodRes = await client.request('tools/call', {
      name: 'veycraft_verify',
      arguments: { path: 'drafts/tailored-good.html', facts_path: 'drafts/facts.json' },
    });
    const verifyGood = JSON.parse(verifyGoodRes.result.content[0].text);
    assert.equal(verifyGood.ok, true);
    assert.equal(verifyGood.error_count, 0);

    const verifyBadRes = await client.request('tools/call', {
      name: 'veycraft_verify',
      arguments: { path: 'drafts/tailored-bad.html', facts_path: 'drafts/facts.json' },
    });
    const verifyBad = JSON.parse(verifyBadRes.result.content[0].text);
    assert.equal(verifyBad.ok, false);
    assert.ok(verifyBad.error_count >= 3);

    // 6. veycraft_pre_submit (short ok vs over max_words / cliche)
    const preGoodRes = await client.request('tools/call', {
      name: 'veycraft_pre_submit',
      arguments: {
        platform: 'greenhouse',
        company: 'Beta Labs',
        title: 'Platform Engineer',
        draft: 'drafts/outreach-short.txt',
      },
    });
    const preGood = JSON.parse(preGoodRes.result.content[0].text);
    assert.equal(preGood.allowed, true);
    assert.equal(preGood.dry_run, true);
    assert.equal(preGood.checks.draft.ok, true);

    const preBadRes = await client.request('tools/call', {
      name: 'veycraft_pre_submit',
      arguments: {
        platform: 'greenhouse',
        company: 'Beta Labs',
        title: 'Platform Engineer',
        draft: 'drafts/outreach-long.txt',
        max_words: 75,
      },
    });
    const preBad = JSON.parse(preBadRes.result.content[0].text);
    assert.equal(preBad.allowed, false);
    assert.ok(preBad.violations.some((v) => v.code === 'draft_word_cap_exceeded'));

    // 7. veycraft_career_summary (with offline analytics check)
    const sumRes = await client.request('tools/call', {
      name: 'veycraft_career_summary',
      arguments: { period: 'all' },
    });
    const sumData = JSON.parse(sumRes.result.content[0].text);
    assert.equal(sumData.summary.funnel.total_tracked, 1);
    assert.equal(sumData.summary.funnel.submitted_count, 1);
    assert.ok(sumData.analytics);
    assert.equal(fs.readdirSync(path.join(ws, 'logs')).filter((f) => f === 'insights').length, 0);

    // 8. veycraft_career_next
    const nextRes = await client.request('tools/call', {
      name: 'veycraft_career_next',
      arguments: {},
    });
    const nextData = JSON.parse(nextRes.result.content[0].text);
    assert.ok(nextData && typeof nextData === 'object');

    // 9. veycraft_get_skill
    const skillRes = await client.request('tools/call', {
      name: 'veycraft_get_skill',
      arguments: { name: 'tailor-resume-and-verify' },
    });
    const skillData = JSON.parse(skillRes.result.content[0].text);
    assert.equal(skillData.skill.name, 'tailor-resume-and-verify');
    assert.equal(skillData.uri, 'veycraft://skill/tailor-resume-and-verify');
    assert.ok(skillData.content.length > 100);

    // 10. resources/list + resources/templates/list + resources/read
    const resList = await client.request('resources/list');
    assert.deepEqual(
      resList.result.resources.map((r) => r.uri),
      ['veycraft://manifest', 'veycraft://registry', 'veycraft://invariants'],
    );
    const tplList = await client.request('resources/templates/list');
    assert.equal(tplList.result.resourceTemplates[0].uriTemplate, 'veycraft://skill/{name}');

    const manifestRead = await client.request('resources/read', { uri: 'veycraft://manifest' });
    assert.equal(manifestRead.result.contents[0].mimeType, 'application/json');
    assert.equal(JSON.parse(manifestRead.result.contents[0].text).skills.length, 53);

    const registryRead = await client.request('resources/read', { uri: 'veycraft://registry' });
    assert.equal(registryRead.result.contents[0].mimeType, 'text/markdown');
    assert.ok(registryRead.result.contents[0].text.includes('Natural-Language'));

    const invRead = await client.request('resources/read', { uri: 'veycraft://invariants' });
    assert.equal(invRead.result.contents[0].mimeType, 'text/plain');
    assert.ok(invRead.result.contents[0].text.length > 20);

    const skillUriRead = await client.request('resources/read', { uri: 'veycraft://skill/tailor-resume-and-verify' });
    assert.equal(skillUriRead.result.contents[0].uri, 'veycraft://skill/tailor-resume-and-verify');
    assert.ok(skillUriRead.result.contents[0].text.length > 100);

    const exit = await client.close();
    assert.equal(exit.code, 0);
  } finally {
    await client.dispose();
    safeRm(ws);
    safeRm(homeDir);
  }
});

test('MCP security boundaries, JSON-RPC errors, CRLF, chunked messages, and split UTF-8', async () => {
  const ws = createTempWorkspace();
  const outsideFile = path.join(os.tmpdir(), `veycraft-outside-${Date.now()}.md`);
  fs.writeFileSync(outsideFile, '# Outside Workspace Fixture\n- Unrelated external markdown file\n', 'utf8');
  const symlinkPath = path.join(ws, 'drafts', 'symlink-escape.md');
  let symlinkCreated = false;
  try {
    fs.symlinkSync(outsideFile, symlinkPath);
    symlinkCreated = true;
  } catch {
    // Symlink creation without admin/Developer Mode on Windows may fail cleanly; skip symlink-specific assertion if unsupported
  }

  const client = new McpStdioClient(MCP_SERVER_PATH, { cwd: ws });
  try {
  // 1. CRLF + leading UTF-8 BOM (\uFEFF) initialize (Windows PowerShell pipeline compatibility)
    const initRes = await client.request(
      'initialize',
      { protocolVersion: '2025-06-18', capabilities: {} },
      { eol: '\r\n' },
    );
    assert.equal(initRes.result.protocolVersion, '2025-06-18');
    const bomId = 707;
    const bomWait = new Promise((resolve) => client._waiters.set(bomId, resolve));
    client.sendRaw(`\uFEFF${JSON.stringify({ jsonrpc: '2.0', id: bomId, method: 'ping' })}\r\n`);
    const bomRes = await bomWait;
    assert.deepEqual(bomRes.result, {});

    // 2. Malformed JSON -> -32700
    const parseErrPromise = client.nextUnmatchedMessage();
    client.sendRaw('{bad json\n');
    const parseErr = await parseErrPromise;
    assert.equal(parseErr.error.code, -32700);
    assert.equal(parseErr.id, null);

    // 3. Invalid JSON-RPC structure -> -32600
    const invReqPromise = client.nextUnmatchedMessage();
    client.sendRaw(JSON.stringify({ jsonrpc: '1.0', id: 77, method: 'ping' }) + '\n');
    const invReq = await invReqPromise;
    assert.equal(invReq.error.code, -32600);

    // 4. Batch array rejected cleanly -> -32600
    const batchErrPromise = client.nextUnmatchedMessage();
    client.sendRaw('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n');
    const batchErr = await batchErrPromise;
    assert.equal(batchErr.error.code, -32600);

    // 5. Unknown method -> -32601
    const unknownMethod = await client.request('unknown/method');
    assert.equal(unknownMethod.error.code, -32601);

    // 6. Strict schema rejection (-32602) on unexpected argument or missing required arg
    const extraArgRes = await client.request('tools/call', {
      name: 'veycraft_doctor',
      arguments: { unexpected: true },
    });
    assert.equal(extraArgRes.error.code, -32602);

    const missingArgRes = await client.request('tools/call', {
      name: 'veycraft_route',
      arguments: {},
    });
    assert.equal(missingArgRes.error.code, -32602);

    // 7. Path traversal / UNC / ADS / symlink / unknown skill -> isError: true
    for (const badPath of ['../AGENTS.md', 'drafts/../../package.json', '\\\\server\\share\\cv.md', 'drafts/clean-cv.md:ads']) {
      const toolErr = await client.request('tools/call', {
        name: 'veycraft_audit',
        arguments: { path: badPath },
      });
      assert.equal(toolErr.result.isError, true, `Expected isError=true for ${badPath}`);
    }
    if (symlinkCreated) {
      const symErr = await client.request('tools/call', {
        name: 'veycraft_audit',
        arguments: { path: 'drafts/symlink-escape.md' },
      });
      assert.equal(symErr.result.isError, true);
    }

    const badSkillTool = await client.request('tools/call', {
      name: 'veycraft_get_skill',
      arguments: { name: '../AGENTS.md' },
    });
    assert.equal(badSkillTool.result.isError, true);

    // 8. Disallowed / traversal resource URIs -> -32602
    for (const badUri of [
      'file:///etc/passwd',
      'veycraft://context/profile.md',
      'veycraft://skill/../AGENTS.md',
      'veycraft://skill/03-tailor-resume-and-verify%2f..',
      'veycraft://skill/nonexistent-skill',
    ]) {
      const resErr = await client.request('resources/read', { uri: badUri });
      assert.equal(resErr.error.code, -32602, `Expected -32602 for URI ${badUri}`);
    }

    // 9. Message split across 3 chunks + mid-codepoint UTF-8 split (Arabic + emoji)
    const utf8Query = 'حسن السيرة الذاتية لمطور برمجيات 🚀';
    const splitId = 505;
    const rawMsgBytes = Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id: splitId, method: 'tools/call', params: { name: 'veycraft_route', arguments: { query: utf8Query } } })}\n`,
      'utf8',
    );
    const rocketIdx = rawMsgBytes.indexOf(Buffer.from('🚀', 'utf8'));
    const c1 = rawMsgBytes.subarray(0, 25);
    const c2 = rawMsgBytes.subarray(25, rocketIdx + 2); // splits 4-byte emoji right in the middle!
    const c3 = rawMsgBytes.subarray(rocketIdx + 2);

    const waitSplit = new Promise((resolve) => client._waiters.set(splitId, resolve));
    client.sendRaw(c1);
    await new Promise((r) => setTimeout(r, 15));
    client.sendRaw(c2);
    await new Promise((r) => setTimeout(r, 15));
    client.sendRaw(c3);
    const splitRes = await waitSplit;
    const splitPayload = JSON.parse(splitRes.result.content[0].text);
    assert.equal(splitPayload.query, utf8Query);

    // 10. Oversized (> 2 MB) frame rejection + clean stream recovery
    const oversizedErrPromise = client.nextUnmatchedMessage();
    client.sendRaw(`${'x'.repeat(2 * 1024 * 1024 + 64)}\n`);
    const oversizedErr = await oversizedErrPromise;
    assert.equal(oversizedErr.error.code, -32600);
    const recoverPing = await client.request('ping');
    assert.deepEqual(recoverPing.result, {});

    const exit = await client.close();
    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
  } finally {
    await client.dispose();
    safeRm(ws);
    if (fs.existsSync(outsideFile)) safeRm(outsideFile);
  }
});
