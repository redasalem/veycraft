import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOCAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = [
  process.env.JHO_CLI_PATH,
  path.join(LOCAL_ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI_PATH, 'Could not locate bin/cli.mjs');
const BIN_DIR = path.dirname(CLI_PATH);
const REPO_ROOT = path.resolve(BIN_DIR, '..');

const {
  CDP_HOST,
  DEFAULT_CDP_PORT,
  MIN_CDP_NODE_MAJOR,
  checkCdpRuntimeSupport,
  assertCdpRuntimeSupport,
  validateCdpPort,
  validateCdpHttpUrl,
  buildCdpHttpUrl,
  validateCdpWsUrl,
  validateNavigationUrl,
  resolveChromeProfileDir,
  buildCdpRequest,
  parseCdpMessage,
  selectCdpTarget,
  parseCdpArgs,
  CdpClient,
  buildChromeLaunchArgs,
  ensureCdpChrome,
  runCdpCli,
} = await import(pathToFileURL(path.join(BIN_DIR, 'cdp-ops.mjs')).href);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this._emit('open', {});
    });
  }

  addEventListener(type, fn, opts = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const wrapped = opts?.once
      ? (ev) => { this.listeners.get(type)?.delete(wrapped); fn(ev); }
      : fn;
    this.listeners.get(type).add(wrapped);
  }

  _emit(type, ev) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(ev);
  }

  send(payload) {
    this.sent.push(payload);
    const req = JSON.parse(payload);
    const responder = MockWebSocket.handler;
    if (typeof responder === 'function') {
      responder(this, req);
    }
  }

  receive(obj) {
    const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
    this._emit('message', { data });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this._emit('close', {}));
  }
}

test('1. Node >= 22 runtime check fails gracefully on Node < 22 or missing WebSocket', async () => {
  const oldNode = checkCdpRuntimeSupport({ nodeVersion: '20.18.0', WebSocketImpl: undefined, fetchImpl: globalThis.fetch });
  assert.equal(oldNode.ok, false);
  assert.equal(oldNode.node_major, 20);
  assert.match(oldNode.error, /Node\.js >= 22/i);
  assert.throws(() => assertCdpRuntimeSupport({ nodeVersion: '18.20.4' }), /Node\.js >= 22/i);

  const missingWs = checkCdpRuntimeSupport({ nodeVersion: '22.5.0', WebSocketImpl: undefined, fetchImpl: globalThis.fetch });
  assert.equal(missingWs.ok, false);
  assert.match(missingWs.error, /WebSocket/i);

  const okNode = checkCdpRuntimeSupport({ nodeVersion: '22.11.0', WebSocketImpl: MockWebSocket, fetchImpl: () => {} });
  assert.equal(okNode.ok, true);
  assert.equal(okNode.node_major, MIN_CDP_NODE_MAJOR);

  // CLI wrapper returns graceful exitCode=1 + JSON error on Node < 22
  const cliRes = await runCdpCli(REPO_ROOT, ['status', '--json'], { nodeVersion: '20.11.0' });
  assert.equal(cliRes.exitCode, 1);
  assert.equal(cliRes.data.ok, false);
  assert.match(cliRes.data.error, /Node\.js >= 22/i);
});

test('2. Strict 127.0.0.1 SSRF and URL safety validation blocks remote hosts, localhost aliases, and dangerous schemes', () => {
  assert.equal(CDP_HOST, '127.0.0.1');
  assert.equal(DEFAULT_CDP_PORT, 9222);

  // Port validation
  assert.equal(validateCdpPort(9222), 9222);
  assert.equal(validateCdpPort('9333'), 9333);
  for (const badPort of [0, -1, 65536, '9222a', '', null, NaN]) {
    assert.throws(() => validateCdpPort(badPort), /Invalid CDP port/i);
  }

  // HTTP endpoint validation (strict 127.0.0.1 only)
  assert.equal(buildCdpHttpUrl(9222, '/json/list'), 'http://127.0.0.1:9222/json/list');
  assert.equal(validateCdpHttpUrl('http://127.0.0.1:9222/json/version', 9222), 'http://127.0.0.1:9222/json/version');
  for (const badHttp of [
    'http://localhost:9222/json/list',
    'http://[::1]:9222/json/list',
    'http://0.0.0.0:9222/json/list',
    'http://169.254.169.254:9222/latest/meta-data/',
    'http://evil.example:9222/json/list',
    'https://127.0.0.1:9222/json/list',
    'http://user:pass@127.0.0.1:9222/json/list',
    'http://127.0.0.1:9999/json/list',
  ]) {
    assert.throws(() => validateCdpHttpUrl(badHttp, 9222), /SSRF|Refusing|mismatch/i, `Expected rejection for ${badHttp}`);
  }
  assert.throws(() => buildCdpHttpUrl(9222, '//evil.com/json'), /Invalid CDP endpoint path/i);
  assert.throws(() => buildCdpHttpUrl(9222, '/@evil.com'), /Invalid CDP endpoint path/i);

  // WebSocket endpoint validation (strict ws://127.0.0.1:<port>/devtools/...)
  assert.equal(
    validateCdpWsUrl('ws://127.0.0.1:9222/devtools/page/ABC123', 9222),
    'ws://127.0.0.1:9222/devtools/page/ABC123',
  );
  for (const badWs of [
    'ws://localhost:9222/devtools/page/ABC',
    'ws://[::1]:9222/devtools/page/ABC',
    'ws://192.168.1.10:9222/devtools/page/ABC',
    'wss://127.0.0.1:9222/devtools/page/ABC',
    'http://127.0.0.1:9222/devtools/page/ABC',
    'ws://user:pw@127.0.0.1:9222/devtools/page/ABC',
    'ws://127.0.0.1:9223/devtools/page/ABC',
    'ws://127.0.0.1:9222/not-devtools/page/ABC',
  ]) {
    assert.throws(() => validateCdpWsUrl(badWs, 9222), /SSRF|Refusing|mismatch/i, `Expected rejection for ${badWs}`);
  }

  // Navigation URL validation
  assert.equal(validateNavigationUrl('https://www.linkedin.com/jobs/'), 'https://www.linkedin.com/jobs/');
  assert.equal(validateNavigationUrl('http://127.0.0.1:4310/'), 'http://127.0.0.1:4310/');
  for (const badNav of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<h1>hi</h1>',
    'chrome://settings',
    'chrome-extension://abcdef/index.html',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://127.0.0.1:9222/json/list',
    'http://localhost:9222/json/list',
  ]) {
    assert.throws(() => validateNavigationUrl(badNav, { cdpPort: 9222 }), /Refusing|SSRF/i, `Expected rejection for ${badNav}`);
  }
});

test('3. selectCdpTarget filters non-page & untrusted targets, prefers active HTTP(S) pages, and honors --target', () => {
  const targets = [
    { id: 'sw-1', type: 'service_worker', url: 'https://www.linkedin.com/sw.js', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/sw1' },
    { id: 'bad-host', type: 'page', url: 'https://evil.example/', webSocketDebuggerUrl: 'ws://evil.example:9222/devtools/page/bad' },
    { id: 'ext-1', type: 'page', url: 'chrome-extension://xyz/popup.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ext1' },
    { id: 'dt-1', type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/dt1' },
    { id: 'blank-1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/blank1' },
    { id: 'li-1', type: 'page', url: 'https://www.linkedin.com/jobs/', title: 'LinkedIn Jobs', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/li1' },
    { id: 'gh-2', type: 'page', url: 'https://boards.greenhouse.io/acme', title: 'Acme Careers', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/gh2' },
  ];

  // Prefers active HTTP(S) page over chrome-extension, devtools, and about:blank
  const primary = selectCdpTarget(targets, { port: 9222 });
  assert.equal(primary?.id, 'li-1');

  // Exact and prefix --target selection
  assert.equal(selectCdpTarget(targets, { targetId: 'gh-2', port: 9222 })?.id, 'gh-2');
  assert.equal(selectCdpTarget(targets, { targetId: 'gh-', port: 9222 })?.id, 'gh-2');
  assert.equal(selectCdpTarget(targets, { targetId: 'nonexistent', port: 9222 }), null);
  // Untrusted host target is never selectable even by ID
  assert.equal(selectCdpTarget(targets, { targetId: 'bad-host', port: 9222 }), null);

  // URL substring match
  assert.equal(selectCdpTarget(targets, { urlMatch: 'greenhouse', port: 9222 })?.id, 'gh-2');

  // Falls back to about:blank when no HTTP(S) page exists
  const onlyBlank = selectCdpTarget([targets[2], targets[4]], { port: 9222 });
  assert.equal(onlyBlank?.id, 'blank-1');
});

test('4. CDP JSON-RPC message framing (buildCdpRequest & parseCdpMessage) validates frames strictly', () => {
  const reqStr = buildCdpRequest(7, 'Page.navigate', { url: 'https://example.org' });
  assert.deepEqual(JSON.parse(reqStr), {
    id: 7,
    method: 'Page.navigate',
    params: { url: 'https://example.org' },
  });
  assert.throws(() => buildCdpRequest(0, 'Page.enable'), /positive integer/i);
  assert.throws(() => buildCdpRequest(1, ''), /non-empty string/i);
  assert.throws(() => buildCdpRequest(1, 'Page.enable', ['bad']), /plain object/i);

  const resp = parseCdpMessage(JSON.stringify({ id: 7, result: { frameId: 'F1' } }));
  assert.deepEqual(resp, { kind: 'response', id: 7, result: { frameId: 'F1' }, error: null });

  const errResp = parseCdpMessage(Buffer.from(JSON.stringify({ id: 8, error: { code: -32000, message: 'No node found' } })));
  assert.equal(errResp.kind, 'response');
  assert.equal(errResp.id, 8);
  assert.equal(errResp.error.message, 'No node found');

  const evt = parseCdpMessage(JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 123.4 } }));
  assert.deepEqual(evt, { kind: 'event', method: 'Page.loadEventFired', params: { timestamp: 123.4 } });

  assert.throws(() => parseCdpMessage('{bad json'), /Malformed CDP JSON/i);
  assert.throws(() => parseCdpMessage('{}'), /missing both/i);
});

test('5. parseCdpArgs parses subcommands, flags, negative values, and error diagnostics', () => {
  assert.equal(parseCdpArgs([]).subcommand, 'help');
  assert.equal(parseCdpArgs(['--help']).subcommand, 'help');

  const st = parseCdpArgs(['status', '--port', '9333', '--no-launch', '--json']);
  assert.equal(st.error, null);
  assert.equal(st.subcommand, 'status');
  assert.equal(st.port, 9333);
  assert.equal(st.noLaunch, true);
  assert.equal(st.json, true);

  const snap = parseCdpArgs(['snapshot', '--max-chars=4000', '--target=TAB1']);
  assert.equal(snap.error, null);
  assert.equal(snap.subcommand, 'snapshot');
  assert.equal(snap.maxChars, 4000);
  assert.equal(snap.targetId, 'TAB1');

  const fillNeg = parseCdpArgs(['fill', '#delta', '-5%']);
  assert.equal(fillNeg.error, null);
  assert.equal(fillNeg.subcommand, 'fill');
  assert.deepEqual(fillNeg.positionals, ['#delta', '-5%']);

  const evalNeg = parseCdpArgs(['eval', '-1 + 42']);
  assert.equal(evalNeg.error, null);
  assert.equal(evalNeg.subcommand, 'eval');
  assert.deepEqual(evalNeg.positionals, ['-1 + 42']);

  assert.match(parseCdpArgs(['open']).error, /Usage: veycraft cdp open/i);
  assert.match(parseCdpArgs(['fill', '#only-selector']).error, /Usage: veycraft cdp fill/i);
  assert.match(parseCdpArgs(['unknown']).error, /Unknown cdp subcommand/i);
  assert.match(parseCdpArgs(['status', '--port', '99999']).error, /Invalid CDP port/i);
  assert.match(parseCdpArgs(['snapshot', '--max-chars', '10']).error, /--max-chars requires/i);
  assert.match(parseCdpArgs(['status', '--bogus']).error, /Unknown option/i);
});

test('6. End-to-end mock CDP runCdpCli executes status, open, snapshot, eval, click, and fill without GUI Chrome', async () => {
  const wsDir = makeTempDir('veycraft-cdp-mock-');
  try {
    const mockHttp = async ({ endpointPath }) => {
      if (endpointPath === '/json/version') {
        return { status: 200, body: JSON.stringify({ Browser: 'Chrome/134.0.0.0', 'Protocol-Version': '1.3' }) };
      }
      if (endpointPath === '/json/list') {
        return {
          status: 200,
          body: JSON.stringify([
            {
              id: 'TAB-1',
              type: 'page',
              title: 'LinkedIn Jobs',
              url: 'https://www.linkedin.com/jobs/',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/TAB-1',
            },
          ]),
        };
      }
      throw new Error(`Unexpected HTTP path ${endpointPath}`);
    };

    MockWebSocket.handler = (sock, req) => {
      if (req.method === 'Page.enable' || req.method === 'Runtime.enable') {
        sock.receive({ id: req.id, result: {} });
        return;
      }
      if (req.method === 'Page.navigate') {
        sock.receive({ id: req.id, result: { frameId: 'FRAME-1' } });
        setTimeout(() => sock.receive({ method: 'Page.loadEventFired', params: { timestamp: 1 } }), 10);
        return;
      }
      if (req.method === 'Runtime.evaluate') {
        const expr = String(req.params?.expression || '');
        if (expr.includes('document.title') && expr.includes('window.location.href') && !expr.includes('MAX_CHARS')) {
          sock.receive({ id: req.id, result: { result: { type: 'object', value: { url: 'https://www.linkedin.com/jobs/view/123/', title: 'Senior Engineer | LinkedIn' } } } });
          return;
        }
        if (expr.includes('MAX_CHARS')) {
          sock.receive({
            id: req.id,
            result: {
              result: {
                type: 'object',
                value: {
                  ok: true,
                  untrusted_external_data: true,
                  url: 'https://www.linkedin.com/jobs/view/123/',
                  title: 'Senior Engineer | LinkedIn',
                  ready_state: 'complete',
                  auth_or_challenge_detected: null,
                  total_chars: 42,
                  truncated: false,
                  text: 'Senior Full-Stack Engineer — Remote (EMEA)',
                  links_count: 1,
                  links: [{ text: 'Apply', href: 'https://boards.greenhouse.io/acme/1', selector: '#apply-link' }],
                  fields_count: 1,
                  fields: [{ tag: 'input', type: 'text', label: 'Full Name', name: 'name', id: 'full_name', value: '', required: true, disabled: false, selector: '#full_name' }],
                  buttons_count: 1,
                  buttons: [{ text: 'Next', type: 'button', disabled: false, selector: '#next-btn' }],
                  honeypots_detected: 0,
                },
              },
            },
          });
          return;
        }
        if (expr.includes('clicked: true')) {
          sock.receive({ id: req.id, result: { result: { type: 'object', value: { ok: true, clicked: true, selector: '#next-btn', tag: 'button', text: 'Next', url_before: 'https://www.linkedin.com/jobs/view/123/' } } } });
          return;
        }
        if (expr.includes('filled: true')) {
          sock.receive({ id: req.id, result: { result: { type: 'object', value: { ok: true, filled: true, selector: '#full_name', tag: 'input', type: 'text', read_back_value: 'Alex Morgan' } } } });
          return;
        }
        if (expr === 'String(window.location.href || "")') {
          sock.receive({ id: req.id, result: { result: { type: 'string', value: 'https://www.linkedin.com/jobs/view/123/step2' } } });
          return;
        }
        sock.receive({ id: req.id, result: { result: { type: 'number', value: 42 } } });
      }
    };

    const mockDeps = {
      nodeVersion: '22.12.0',
      WebSocketImpl: MockWebSocket,
      fetchImpl: () => {},
      httpRequestImpl: mockHttp,
    };

    const statusRes = await runCdpCli(wsDir, ['status', '--json'], mockDeps);
    assert.equal(statusRes.exitCode, 0);
    assert.equal(statusRes.data.connected, true);
    assert.equal(statusRes.data.host, '127.0.0.1');
    assert.equal(statusRes.data.tabs_count, 1);
    assert.ok(statusRes.data.profile_dir.endsWith(path.join('workspace', '.chrome-profile')));

    const openRes = await runCdpCli(wsDir, ['open', 'https://www.linkedin.com/jobs/view/123/', '--json'], mockDeps);
    assert.equal(openRes.exitCode, 0);
    assert.equal(openRes.data.url, 'https://www.linkedin.com/jobs/view/123/');
    assert.equal(openRes.data.title, 'Senior Engineer | LinkedIn');

    const snapRes = await runCdpCli(wsDir, ['snapshot', '--max-chars', '2000', '--json'], mockDeps);
    assert.equal(snapRes.exitCode, 0);
    assert.equal(snapRes.data.untrusted_external_data, true);
    assert.equal(snapRes.data.fields_count, 1);
    assert.equal(snapRes.data.fields[0].selector, '#full_name');

    const evalRes = await runCdpCli(wsDir, ['eval', '21 * 2', '--json'], mockDeps);
    assert.equal(evalRes.exitCode, 0);
    assert.equal(evalRes.data.result, 42);

    const clickRes = await runCdpCli(wsDir, ['click', '#next-btn', '--json'], mockDeps);
    assert.equal(clickRes.exitCode, 0);
    assert.equal(clickRes.data.clicked, true);
    assert.equal(clickRes.data.url_after, 'https://www.linkedin.com/jobs/view/123/step2');

    const fillRes = await runCdpCli(wsDir, ['fill', '#full_name', 'Alex Morgan', '--json'], mockDeps);
    assert.equal(fillRes.exitCode, 0);
    assert.equal(fillRes.data.filled, true);
    assert.equal(fillRes.data.read_back_value, 'Alex Morgan');

    // Direct CdpClient verifies rejection of remote WebSocket URLs
    assert.throws(() => new CdpClient('ws://example.com:9222/devtools/page/1', { port: 9222, WebSocketImpl: MockWebSocket }), /SSRF/i);
  } finally {
    MockWebSocket.handler = null;
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});

test('7. Packaging hygiene, .gitignore exclusions, CLI help wiring, and agent rules enforce native CDP fallback', () => {
  const ws = makeTempDir('veycraft-cdp-cli-');
  try {
    assert.equal(resolveChromeProfileDir(ws), path.join(ws, 'workspace', '.chrome-profile'));

    const cdpHelp = spawnSync(process.execPath, [CLI_PATH, 'cdp', '--help'], { cwd: ws, encoding: 'utf8' });
    assert.equal(cdpHelp.status, 0, cdpHelp.stderr);
    assert.match(cdpHelp.stdout, /veycraft cdp status/i);
    assert.match(cdpHelp.stdout, /veycraft cdp snapshot/i);
    assert.match(cdpHelp.stdout, /workspace\/\.chrome-profile\//i);

    const rootHelp = spawnSync(process.execPath, [CLI_PATH, '--help'], { cwd: ws, encoding: 'utf8' });
    assert.equal(rootHelp.status, 0, rootHelp.stderr);
    assert.match(rootHelp.stdout, /veycraft cdp <status\|open\|snapshot\|eval\|click\|fill>/i);

    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /workspace\/\.chrome-profile\//);

    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies, {});
    assert.deepEqual(pkg.devDependencies, {});
    assert.ok(pkg.files.includes('!workspace/.chrome-profile/**'));
    assert.match(pkg.scripts['pack:check'], /bin\/cdp-ops\.mjs/);
    assert.match(pkg.scripts['pack:check'], /chrome-profile/);
    assert.match(pkg.scripts.prepublishOnly, /bin\/cdp-ops\.mjs/);

    for (const rel of [
      'AGENTS.md',
      'skills/00-daily-run.md',
      'skills/02-discover-and-triage.md',
      'skills/04-fill-and-apply.md',
    ]) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.match(text, /node \.\/bin\/cli\.mjs cdp/i, `${rel} must instruct immediate fallback to node ./bin/cli.mjs cdp`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('8. ensureCdpChrome auto-resolves fallback port when 127.0.0.1:9222 is occupied (HTTP 404), and fails fast on explicit conflict', async () => {
  const ws = makeTempDir('veycraft-cdp-port-fallback-');
  try {
    const httpMock = async ({ port, endpointPath }) => {
      if (port === 9222 && endpointPath === '/json/version') {
        return { status: 404, body: '' };
      }
      if (port === 9223 && endpointPath === '/json/version') {
        return { status: 200, body: JSON.stringify({ Browser: 'Chrome/158.0.0.0', 'Protocol-Version': '1.3' }) };
      }
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    };

    const attached = await ensureCdpChrome({
      root: ws,
      port: 9222,
      portExplicit: false,
      httpRequestImpl: httpMock,
    });
    assert.equal(attached.connected, true);
    assert.equal(attached.launched, false);
    assert.equal(attached.port, 9223);
    assert.equal(attached.host, '127.0.0.1');

    await assert.rejects(
      () => ensureCdpChrome({
        root: ws,
        port: 9222,
        portExplicit: true,
        httpRequestImpl: httpMock,
        isPortAvailableImpl: async () => false,
      }),
      /already in use/i,
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('9. Default CDP Chrome launch uses windowsHide: false, --new-window, visible URL, and never passes --headless', async () => {
  const ws = makeTempDir('veycraft-cdp-launch-');
  try {
    let callCount = 0;
    const httpMock = async ({ port, endpointPath }) => {
      if (port === 9222 && endpointPath === '/json/version') {
        callCount++;
        if (callCount >= 2) {
          return { status: 200, body: JSON.stringify({ Browser: 'Chrome/158.0.0.0', 'Protocol-Version': '1.3' }) };
        }
      }
      const err = new Error('connect ECONNREFUSED');
      err.code = 'ECONNREFUSED';
      throw err;
    };

    let capturedSpawn = null;
    const spawnMock = (binary, args, options) => {
      capturedSpawn = { binary, args, options };
      return { unref() {} };
    };

    const res = await ensureCdpChrome({
      root: ws,
      port: 9222,
      portExplicit: true,
      initialUrl: 'https://www.linkedin.com/login',
      httpRequestImpl: httpMock,
      detectBrowserImpl: () => 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      isPortAvailableImpl: async () => true,
      spawnImpl: spawnMock,
    });

    assert.equal(res.launched, true);
    assert.ok(capturedSpawn, 'spawnImpl must be invoked');
    assert.equal(capturedSpawn.options.windowsHide, false);
    assert.equal(capturedSpawn.options.detached, true);
    assert.equal(capturedSpawn.options.stdio, 'ignore');
    assert.ok(capturedSpawn.args.includes('--new-window'), 'Must include --new-window so Chrome creates a visible window');
    assert.ok(capturedSpawn.args.includes('https://www.linkedin.com/login'), 'Must pass initial URL');
    assert.ok(!capturedSpawn.args.some(a => /--headless|--no-startup-window/i.test(a)), 'Must never pass --headless or --no-startup-window');

    const defaultArgs = buildChromeLaunchArgs({ port: 9222, profileDir: path.join(ws, 'workspace', '.chrome-profile') });
    assert.ok(defaultArgs.includes('--new-window'));
    assert.ok(defaultArgs.includes('about:blank'));
    assert.ok(!defaultArgs.some(a => /--headless/i.test(a)));
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
