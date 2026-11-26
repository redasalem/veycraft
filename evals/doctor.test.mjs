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
  resolveChromeDevtoolsJsEntrypoint,
  resolveNodeCommand,
  buildChromeDevtoolsMcpServer,
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

    const expectedWinBin = process.platform === 'win32' ? fakeBinPath.replace(/\\/g, '/') : fakeBinPath;

    // Verify Antigravity config upgraded slow npx to direct binary while preserving context7 + creating .veycraft.bak
    const updatedAg = JSON.parse(fs.readFileSync(agConfig, 'utf8'));
    assert.deepEqual(updatedAg.mcpServers.context7, { command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
    assert.deepEqual(updatedAg.mcpServers.chrome_devtools, { command: expectedWinBin, args: [] });
    assert.ok(fs.existsSync(`${agConfig}.veycraft.bak`), 'Expected atomic backup for updated Antigravity config');

    // Verify workspace IDE configs (.gemini/settings.json, .cursor/mcp.json, .vscode/mcp.json) also received direct binary path (never npx)
    const geminiWs = JSON.parse(fs.readFileSync(path.join(ws, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(geminiWs.mcpServers.chrome_devtools, { command: expectedWinBin, args: [] });
    const vscodeWs = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'mcp.json'), 'utf8'));
    assert.deepEqual(vscodeWs.servers.chrome_devtools, { type: 'stdio', command: expectedWinBin, args: [] });

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

test('7. Windows .cmd shim resolves to node + POSIX JS entrypoint and doctor --fix auto-upgrades existing .cmd MCP entries', async () => {
  const ws = makeTempDir('veycraft-doctor-win-shim-');
  const fakeHome = makeTempDir('veycraft-doctor-win-home-');
  try {
    // 1. Pure cross-platform unit check for Windows .cmd shim -> package.json bin JS entrypoint
    const winNpmDir = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
    const winCmd = `${winNpmDir}\\chrome-devtools-mcp.cmd`;
    const winPkgJson = `${winNpmDir}\\node_modules\\chrome-devtools-mcp\\package.json`;
    const winJsWinPath = `${winNpmDir}\\node_modules\\chrome-devtools-mcp\\out\\Default\\gen\\src\\bin\\chrome-devtools-mcp.js`;
    const expectedPosix = 'C:/Users/dev/AppData/Roaming/npm/node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js';
    const mockExists = p => p === winCmd || p === winPkgJson || p === winJsWinPath;
    const mockRead = p => {
      assert.equal(p, winPkgJson);
      return JSON.stringify({
        name: 'chrome-devtools-mcp',
        bin: { 'chrome-devtools-mcp': './out/Default/gen/src/bin/chrome-devtools-mcp.js' },
      });
    };

    assert.equal(
      resolveChromeDevtoolsJsEntrypoint(winCmd, { platform: 'win32', existsSync: mockExists, readFileSync: mockRead }),
      expectedPosix,
    );
    assert.equal(
      detectChromeDevtoolsMcp({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming', PATH: '' },
        home: 'C:\\Users\\dev',
        existsSync: mockExists,
        readFileSync: mockRead,
      }),
      expectedPosix,
    );
    assert.deepEqual(
      buildChromeDevtoolsMcpServer(winCmd, {
        platform: 'win32',
        nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
        existsSync: mockExists,
        readFileSync: mockRead,
      }),
      { command: 'C:/Program Files/nodejs/node.exe', args: [expectedPosix] },
    );
    assert.deepEqual(
      buildChromeDevtoolsMcpServer(winCmd, {
        platform: 'win32',
        nodeExecPath: '',
        existsSync: mockExists,
        readFileSync: mockRead,
      }),
      { command: 'node', args: [expectedPosix] },
    );

    // 2. End-to-end runDoctorFix on real temp filesystem: .cmd shim + node_modules/chrome-devtools-mcp/package.json
    const fakeBinDir = path.join(fakeHome, 'fake-npm');
    const fakePkgDir = path.join(fakeBinDir, 'node_modules', 'chrome-devtools-mcp');
    const fakeJsRel = './out/Default/gen/src/bin/chrome-devtools-mcp.js';
    const fakeJsAbs = path.resolve(fakePkgDir, fakeJsRel);
    const fakeJsPosix = fakeJsAbs.replace(/\\/g, '/');
    fs.mkdirSync(path.dirname(fakeJsAbs), { recursive: true });
    fs.writeFileSync(fakeJsAbs, '// fake chrome-devtools-mcp entrypoint\n', 'utf8');
    fs.writeFileSync(path.join(fakePkgDir, 'package.json'), JSON.stringify({
      name: 'chrome-devtools-mcp',
      bin: { 'chrome-devtools-mcp': fakeJsRel },
    }), 'utf8');
    const fakeBinName = process.platform === 'win32' ? 'chrome-devtools-mcp.cmd' : 'chrome-devtools-mcp';
    const fakeShimPath = path.join(fakeBinDir, fakeBinName);
    fs.writeFileSync(fakeShimPath, '@echo off\n', 'utf8');

    // Existing Antigravity mcp_config.json with broken Windows .cmd shim entry + custom servers
    const agDir = path.join(fakeHome, '.gemini', 'antigravity');
    fs.mkdirSync(agDir, { recursive: true });
    const agConfig = path.join(agDir, 'mcp_config.json');
    fs.writeFileSync(agConfig, JSON.stringify({
      mcpServers: {
        context7: { command: 'npx.cmd', args: ['-y', '@upstash/context7-mcp'] },
        chrome_devtools: { command: 'C:/Users/dev/AppData/Roaming/npm/chrome-devtools-mcp.cmd' },
      },
    }, null, 2), 'utf8');

    // Existing workspace .codex/config.toml with broken .cmd shim entry
    fs.mkdirSync(path.join(ws, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.codex', 'config.toml'),
      '[mcp_servers.chrome_devtools]\ncommand = "C:\\\\Users\\\\dev\\\\AppData\\\\Roaming\\\\npm\\\\chrome-devtools-mcp.cmd"\nargs = []\n',
      'utf8',
    );

    const res = await runDoctorFix({
      root: ws,
      source: SOURCE_ROOT,
      home: fakeHome,
      isGlobal: false,
      offline: true,
      env: { ...process.env, PATH: fakeBinDir },
      platform: process.platform,
    });

    const expectedNodeCmd = resolveNodeCommand({ platform: process.platform, nodeExecPath: process.execPath });

    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.chrome_devtools_binary, fakeJsPosix);
    assert.equal(res.payload.ide_reload_required, true);

    const upgradedAg = JSON.parse(fs.readFileSync(agConfig, 'utf8'));
    assert.deepEqual(upgradedAg.mcpServers.context7, { command: 'npx.cmd', args: ['-y', '@upstash/context7-mcp'] });
    assert.deepEqual(upgradedAg.mcpServers.chrome_devtools, { command: expectedNodeCmd, args: [fakeJsPosix] });

    const wsGemini = JSON.parse(fs.readFileSync(path.join(ws, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(wsGemini.mcpServers.chrome_devtools, { command: expectedNodeCmd, args: [fakeJsPosix] });

    const wsVscode = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'mcp.json'), 'utf8'));
    assert.deepEqual(wsVscode.servers.chrome_devtools, { type: 'stdio', command: expectedNodeCmd, args: [fakeJsPosix] });

    const wsCodex = fs.readFileSync(path.join(ws, '.codex', 'config.toml'), 'utf8');
    assert.ok(wsCodex.includes(`command = ${JSON.stringify(expectedNodeCmd)}`), 'Expected Codex TOML to use resolved node command');
    assert.ok(wsCodex.includes(fakeJsPosix), 'Expected Codex TOML to be upgraded to POSIX JS entrypoint');
    assert.ok(!wsCodex.includes('chrome-devtools-mcp.cmd'), 'Expected broken .cmd shim to be removed from Codex TOML');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('8. macOS/Linux symlinked global binary & stripped-PATH nvm/Homebrew resolve to absolute node + JS entrypoint and auto-upgrade slow npx / bare binary', async () => {
  const ws = makeTempDir('veycraft-doctor-unix-');
  const fakeHome = makeTempDir('veycraft-doctor-unix-home-');
  try {
    // 1. Homebrew symlink resolution on macOS (stripped PATH)
    const brewBin = '/opt/homebrew/bin/chrome-devtools-mcp';
    const brewJs = '/opt/homebrew/lib/node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js';
    const brewNode = '/opt/homebrew/bin/node';
    const brewExists = p => p === brewBin || p === brewJs;
    const brewRealpath = p => (p === brewBin ? brewJs : p);

    assert.equal(
      resolveChromeDevtoolsJsEntrypoint(brewBin, { platform: 'darwin', existsSync: brewExists, realpathSync: brewRealpath }),
      brewJs,
    );
    assert.equal(
      detectChromeDevtoolsMcp({
        platform: 'darwin',
        env: { PATH: '/usr/bin:/bin' },
        home: '/Users/dev',
        nodeExecPath: brewNode,
        existsSync: brewExists,
        realpathSync: brewRealpath,
      }),
      brewJs,
    );
    assert.deepEqual(
      buildChromeDevtoolsMcpServer(brewBin, {
        platform: 'darwin',
        nodeExecPath: brewNode,
        existsSync: brewExists,
        realpathSync: brewRealpath,
      }),
      { command: brewNode, args: [brewJs] },
    );

    // 2. Linux nvm installation discovered even when GUI IDE strips PATH completely
    const nvmDir = '/home/dev/.nvm/versions/node';
    const nvmBin = '/home/dev/.nvm/versions/node/v22.14.0/bin/chrome-devtools-mcp';
    const nvmPkg = '/home/dev/.nvm/versions/node/v22.14.0/lib/node_modules/chrome-devtools-mcp/package.json';
    const nvmJs = '/home/dev/.nvm/versions/node/v22.14.0/lib/node_modules/chrome-devtools-mcp/out/Default/gen/src/bin/chrome-devtools-mcp.js';
    const nvmNode = '/home/dev/.nvm/versions/node/v22.14.0/bin/node';
    const nvmExists = p => p === nvmDir || p === nvmBin || p === nvmPkg || p === nvmJs;
    const nvmReaddir = p => (p === nvmDir ? ['v20.11.0', 'v22.14.0'] : []);
    const nvmRead = p => {
      assert.equal(p, nvmPkg);
      return JSON.stringify({ bin: { 'chrome-devtools-mcp': './out/Default/gen/src/bin/chrome-devtools-mcp.js' } });
    };

    assert.equal(
      detectChromeDevtoolsMcp({
        platform: 'linux',
        env: { PATH: '' },
        home: '/home/dev',
        nodeExecPath: '/usr/bin/node',
        existsSync: nvmExists,
        readdirSync: nvmReaddir,
        readFileSync: nvmRead,
      }),
      nvmJs,
    );
    assert.deepEqual(
      buildChromeDevtoolsMcpServer(nvmJs, {
        platform: 'linux',
        nodeExecPath: nvmNode,
        existsSync: nvmExists,
      }),
      { command: nvmNode, args: [nvmJs] },
    );

    // 3. End-to-end runDoctorFix auto-upgrades both slow npx AND bare binary entries on disk
    const fakeBinDir = path.join(fakeHome, 'unix-prefix', 'bin');
    const fakePkgDir = path.join(fakeHome, 'unix-prefix', 'lib', 'node_modules', 'chrome-devtools-mcp');
    const fakeJsAbs = path.join(fakePkgDir, 'out', 'Default', 'gen', 'src', 'bin', 'chrome-devtools-mcp.js');
    const fakeJsPosix = fakeJsAbs.replace(/\\/g, '/');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(path.dirname(fakeJsAbs), { recursive: true });
    fs.writeFileSync(fakeJsAbs, '// fake unix chrome-devtools-mcp\n', 'utf8');
    fs.writeFileSync(path.join(fakePkgDir, 'package.json'), JSON.stringify({
      name: 'chrome-devtools-mcp',
      bin: './out/Default/gen/src/bin/chrome-devtools-mcp.js',
    }), 'utf8');
    const binName = process.platform === 'win32' ? 'chrome-devtools-mcp.cmd' : 'chrome-devtools-mcp';
    fs.writeFileSync(path.join(fakeBinDir, binName), '#!/usr/bin/env node\n', 'utf8');

    // Antigravity config with slow npx + Cursor global config with bare binary
    const agDir = path.join(fakeHome, '.gemini', 'antigravity');
    const cursorDir = path.join(fakeHome, '.cursor');
    fs.mkdirSync(agDir, { recursive: true });
    fs.mkdirSync(cursorDir, { recursive: true });
    const agConfig = path.join(agDir, 'mcp_config.json');
    const cursorConfig = path.join(cursorDir, 'mcp.json');
    fs.writeFileSync(agConfig, JSON.stringify({
      mcpServers: {
        chrome_devtools: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(cursorConfig, JSON.stringify({
      mcpServers: {
        chrome_devtools: { command: '/usr/local/bin/chrome-devtools-mcp', args: [] },
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

    const expectedNode = resolveNodeCommand({ platform: process.platform, nodeExecPath: process.execPath });
    assert.equal(res.exitCode, 0);
    assert.equal(res.payload.ide_reload_required, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(agConfig, 'utf8')).mcpServers.chrome_devtools,
      { command: expectedNode, args: [fakeJsPosix] },
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(cursorConfig, 'utf8')).mcpServers.chrome_devtools,
      { command: expectedNode, args: [fakeJsPosix] },
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
