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
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI_PATH, 'Could not locate bin/cli.mjs');
const BIN_DIR = path.dirname(CLI_PATH);
const SOURCE_ROOT = path.resolve(BIN_DIR, '..');

const {
  evaluateWorkspaceContext,
  detectHeadlessBrowser,
  detectChromeDevtoolsMcp,
  evaluateDoctorSnapshot,
  runDoctorFix,
} = await import(pathToFileURL(path.join(BIN_DIR, 'core-ops.mjs')).href);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('1. evaluateWorkspaceContext detects missing vs ready cv.md, profile.md, preferences.yaml, and brief.json', () => {
  const ws = makeTempDir('veycraft-doctor-ctx-');
  try {
    const emptyRes = evaluateWorkspaceContext(ws);
    assert.equal(emptyRes.all_ready, false);
    assert.equal(emptyRes.ready_count, 0);
    assert.equal(emptyRes.total, 4);
    assert.deepEqual(emptyRes.missing, ['cv.md', 'profile.md', 'preferences.yaml', 'brief.json']);

    fs.mkdirSync(path.join(ws, 'context'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'context', 'cv.md'), '# Alex Morgan\nFull-Stack Software Engineer with React, Node.js, PostgreSQL experience.\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'context', 'profile.md'), '# Candidate Profile\nName: Alex Morgan\nHeadline: Full-Stack Software Engineer\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'context', 'preferences.yaml'), 'target_roles:\n  - Full-Stack Software Engineer\nwork_mode: remote\n', 'utf8');
    fs.writeFileSync(
      path.join(ws, 'context', 'brief.json'),
      JSON.stringify({ schema_version: 1, headline: 'Full-Stack Software Engineer | React, Node.js' }),
      'utf8',
    );

    const readyRes = evaluateWorkspaceContext(ws);
    assert.equal(readyRes.all_ready, true);
    assert.equal(readyRes.ready_count, 4);
    assert.deepEqual(readyRes.missing, []);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('2. detectHeadlessBrowser and detectChromeDevtoolsMcp resolve cross-platform binaries without subprocesses', () => {
  const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(
    detectHeadlessBrowser({
      platform: 'win32',
      env: { PROGRAMFILES: 'C:\\Program Files', PATH: '' },
      home: 'C:\\Users\\dev',
      existsSync: p => p === winChrome,
    }),
    winChrome,
  );
  assert.equal(
    detectHeadlessBrowser({
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      home: '/home/dev',
      existsSync: p => p === '/usr/bin/chromium',
    }),
    '/usr/bin/chromium',
  );
  assert.equal(
    detectHeadlessBrowser({
      platform: 'darwin',
      env: { PATH: '' },
      home: '/Users/dev',
      existsSync: () => false,
    }),
    null,
  );

  const winMcp = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\chrome-devtools-mcp.cmd';
  assert.equal(
    detectChromeDevtoolsMcp({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming', PATH: '' },
      home: 'C:\\Users\\dev',
      existsSync: p => p === winMcp,
    }),
    winMcp,
  );
  const macMcp = '/opt/homebrew/bin/chrome-devtools-mcp';
  assert.equal(
    detectChromeDevtoolsMcp({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      home: '/Users/dev',
      existsSync: p => p === macMcp,
    }),
    macMcp,
  );
  assert.equal(
    detectChromeDevtoolsMcp({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      home: '/home/dev',
      existsSync: () => false,
    }),
    null,
  );
});

test('3. evaluateDoctorSnapshot prints exact 1-line fix when chrome-devtools-mcp is missing and passes in <1s', async () => {
  const ws = makeTempDir('veycraft-doctor-snap-');
  const fakeHome = makeTempDir('veycraft-doctor-home-');
  try {
    const startMs = Date.now();
    const snap = await evaluateDoctorSnapshot({
      root: ws,
      source: SOURCE_ROOT,
      home: fakeHome,
      env: { PATH: '' },
      platform: 'linux',
      offline: true,
      readOnly: true,
      existsSync: () => false,
    });
    const elapsedMs = Date.now() - startMs;

    assert.ok(elapsedMs < 1000, `evaluateDoctorSnapshot took ${elapsedMs}ms (expected < 1000ms)`);
    assert.equal(snap.exitCode, 0);
    assert.equal(snap.payload.headless_browser.available, false);
    assert.equal(snap.payload.chrome_devtools_mcp.available, false);
    assert.equal(snap.payload.chrome_devtools_mcp.fix_command, 'npm i -g chrome-devtools-mcp');
    assert.match(snap.payload.chrome_devtools_mcp.config_tip, /direct/i);
    assert.ok(
      snap.events.some(ev => ev.level === 'warn' && ev.message.includes('npm i -g chrome-devtools-mcp')),
      'Expected doctor warning event with exact 1-line npm i -g chrome-devtools-mcp fix',
    );
    assert.ok(
      snap.payload.next_steps.some(s => s.includes('npm i -g chrome-devtools-mcp')),
      'Expected next_steps to include exact 1-line chrome-devtools-mcp install fix',
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('4. CLI `veycraft doctor --json` and `--help` expose fast pre-flight checks in <1s without mutating empty workspace', () => {
  const ws = makeTempDir('veycraft-doctor-cli-');
  const fakeHome = makeTempDir('veycraft-doctor-cli-home-');
  try {
    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, VEYCRAFT_HOME: path.join(fakeHome, '.veycraft'), NO_COLOR: '1' };

    const helpRes = spawnSync(process.execPath, [CLI_PATH, '--help'], { cwd: ws, env, encoding: 'utf8' });
    assert.equal(helpRes.status, 0, helpRes.stderr);
    assert.match(helpRes.stdout, /veycraft doctor \[--json\].*chrome-devtools-mcp/i);

    const startMs = Date.now();
    const docRes = spawnSync(process.execPath, [CLI_PATH, 'doctor', '--json'], { cwd: ws, env, encoding: 'utf8' });
    const elapsedMs = Date.now() - startMs;

    assert.equal(docRes.status, 0, docRes.stdout + docRes.stderr);
    assert.ok(elapsedMs < 1000, `CLI doctor took ${elapsedMs}ms (expected < 1000ms)`);
    const parsed = JSON.parse(docRes.stdout);
    assert.equal(parsed.product, 'veycraft');
    assert.equal(parsed.offline_mode, true);
    assert.equal(parsed.workspace_context.total, 4);
    assert.equal(typeof parsed.headless_browser.available, 'boolean');
    assert.equal(typeof parsed.chrome_devtools_mcp.available, 'boolean');
    assert.equal(parsed.chrome_devtools_mcp.fix_command, 'npm i -g chrome-devtools-mcp');
    assert.deepEqual(fs.readdirSync(ws), [], 'doctor must not create any files in an empty workspace');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('5. runDoctorFix syncs IDE MCP configs to direct chrome-devtools-mcp binary, preserves custom servers, and rebuilds stale brief.json', async () => {
  const ws = makeTempDir('veycraft-doctor-fix-');
  const fakeHome = makeTempDir('veycraft-doctor-fix-home-');
  try {
    // Prepare realistic context/ files WITHOUT brief.json
    fs.mkdirSync(path.join(ws, 'context'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'context', 'cv.md'), '# Jordan Lee\nFull-Stack Software Engineer building React, Node.js, PostgreSQL SaaS platforms.\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'context', 'profile.md'), '# Candidate Profile\n- Name: Jordan Lee\n- Headline: Full-Stack Software Engineer | React, TypeScript, Node.js\n- GitHub: https://github.com/jordanlee\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'context', 'preferences.yaml'), 'target_roles:\n  - Full-Stack Software Engineer\nlocations:\n  - Remote\n', 'utf8');

    // Prepare fake global chrome-devtools-mcp binary + an existing Antigravity config with slow npx chrome_devtools & existing custom servers
    const fakeBinDir = path.join(fakeHome, 'fake-npm-bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeBinName = process.platform === 'win32' ? 'chrome-devtools-mcp.cmd' : 'chrome-devtools-mcp';
    const fakeBinPath = path.join(fakeBinDir, fakeBinName);
    fs.writeFileSync(fakeBinPath, '@echo off\n', 'utf8');

    const agDir = path.join(fakeHome, '.gemini', 'antigravity');
    fs.mkdirSync(agDir, { recursive: true });
    const agConfig = path.join(agDir, 'mcp_config.json');
    fs.writeFileSync(agConfig, JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        chrome_devtools: { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      },
    }, null, 2), 'utf8');

    const res = await runDoctorFix({
      root: ws,
      source: SOURCE_ROOT,
      home: fakeHome,
      isGlobal: false,
      offline: true,
      env: { ...process.env, PATH: fakeBinDir },
      platform: process.platform,
    });

    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.fix_applied, true);
    assert.equal(res.payload.chrome_devtools_binary, fakeBinPath);
    assert.equal(res.payload.ide_reload_required, true);
    assert.equal(res.payload.brief.status, 'rebuilt');
    assert.ok(fs.existsSync(path.join(ws, 'context', 'brief.json')), 'Expected context/brief.json to be rebuilt');

    // Verify Antigravity config upgraded slow npx to direct binary while preserving context7 + creating .veycraft.bak
    const updatedAg = JSON.parse(fs.readFileSync(agConfig, 'utf8'));
    assert.deepEqual(updatedAg.mcpServers.context7, { command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
    assert.deepEqual(updatedAg.mcpServers.chrome_devtools, { command: fakeBinPath, args: [] });
    assert.ok(fs.existsSync(`${agConfig}.veycraft.bak`), 'Expected atomic backup for updated Antigravity config');

    // Verify workspace IDE configs (.gemini/settings.json, .cursor/mcp.json, .vscode/mcp.json) also received direct binary path (never npx)
    const geminiWs = JSON.parse(fs.readFileSync(path.join(ws, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(geminiWs.mcpServers.chrome_devtools, { command: fakeBinPath, args: [] });
    const vscodeWs = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'mcp.json'), 'utf8'));
    assert.deepEqual(vscodeWs.servers.chrome_devtools, { type: 'stdio', command: fakeBinPath, args: [] });

    // Second run must be idempotent: 0 MCP updates, ide_reload_required: false, brief up_to_date
    const second = await runDoctorFix({
      root: ws,
      source: SOURCE_ROOT,
      home: fakeHome,
      isGlobal: false,
      offline: true,
      env: { ...process.env, PATH: fakeBinDir },
      platform: process.platform,
    });
    assert.equal(second.payload.ide_reload_required, false);
    assert.equal(second.payload.brief.status, 'up_to_date');
    assert.equal(second.payload.fixed_count, 0);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('6. CLI `veycraft doctor --fix --json` works end-to-end and rejects `--fix` on unrelated commands', () => {
  const ws = makeTempDir('veycraft-doctor-fix-cli-');
  const fakeHome = makeTempDir('veycraft-doctor-fix-cli-home-');
  try {
    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, VEYCRAFT_HOME: path.join(fakeHome, '.veycraft'), NO_COLOR: '1' };
    fs.mkdirSync(path.join(ws, 'context'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'context', 'cv.md'), '# Sam Rivera\nBackend Engineer with Node.js and PostgreSQL.\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'context', 'profile.md'), '# Profile\nHeadline: Backend Engineer\n', 'utf8');

    const fixRes = spawnSync(process.execPath, [CLI_PATH, 'doctor', '--fix', '--json'], { cwd: ws, env, encoding: 'utf8' });
    assert.equal(fixRes.status, 0, fixRes.stdout + fixRes.stderr);
    const parsed = JSON.parse(fixRes.stdout);
    assert.equal(parsed.fix_applied, true);
    assert.equal(parsed.brief.status, 'rebuilt');
    assert.equal(typeof parsed.ide_reload_required, 'boolean');
    assert.ok(Array.isArray(parsed.fixed_items));
    assert.ok(Array.isArray(parsed.remaining_actions));

    // `--fix` on another command must fail cleanly
    const badRes = spawnSync(process.execPath, [CLI_PATH, 'status', '--fix'], { cwd: ws, env, encoding: 'utf8' });
    assert.notEqual(badRes.status, 0);
    assert.match(badRes.stderr, /Option --fix is only supported with `veycraft doctor`/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
