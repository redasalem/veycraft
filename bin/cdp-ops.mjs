// Zero-dependency Native Chrome DevTools Protocol (CDP) CLI Engine for Veycraft.
// Uses Node.js built-in modules only (node:http, node:fs, node:path, node:os, node:child_process + built-in WebSocket on Node >= 22).
// Security invariants:
//   - Strictly binds and connects CDP only to 127.0.0.1 (SSRF-safe).
//   - Persists Chrome session in gitignored/non-packaged workspace/.chrome-profile/ (symlink-refused).
//   - Navigation restricted to http:// and https:// (blocks file://, javascript:, data:, chrome://, metadata IPs, and CDP self-loop).
//   - Never auto-submits forms or bypasses CAPTCHA/2FA/login challenges.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertSafeCliInputPath, detectHeadlessBrowser } from './core-ops.mjs';
import { isObj, refuseSymlink } from './fs-safety.mjs';

export const CDP_HOST = '127.0.0.1';
export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_TIMEOUT_MS = 20000;
export const DEFAULT_MAX_CHARS = 12000;
export const DEFAULT_LOGIN_URL = 'https://www.linkedin.com/login';
export const MIN_CDP_NODE_MAJOR = 22;
export const CDP_SUBCOMMANDS = Object.freeze(['status', 'login', 'close', 'open', 'snapshot', 'eval', 'click', 'fill', 'upload', 'help']);

const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
]);

export function checkCdpRuntimeSupport(opts = {}) {
  const nodeVersion = Object.prototype.hasOwnProperty.call(opts, 'nodeVersion') ? opts.nodeVersion : process.versions.node;
  const WebSocketImpl = Object.prototype.hasOwnProperty.call(opts, 'WebSocketImpl') ? opts.WebSocketImpl : globalThis.WebSocket;
  const fetchImpl = Object.prototype.hasOwnProperty.call(opts, 'fetchImpl') ? opts.fetchImpl : globalThis.fetch;
  const versionStr = String(nodeVersion || '0.0.0');
  const major = Number(versionStr.split('.')[0]);
  if (!Number.isInteger(major) || major < MIN_CDP_NODE_MAJOR) {
    return {
      ok: false,
      node_version: versionStr,
      node_major: Number.isInteger(major) ? major : 0,
      error: `Veycraft native CDP requires Node.js >= ${MIN_CDP_NODE_MAJOR} with built-in WebSocket support (detected Node v${versionStr}). Upgrade Node.js to v22+ (https://nodejs.org/) or use chrome_devtools MCP.`,
    };
  }
  if (typeof WebSocketImpl !== 'function') {
    return {
      ok: false,
      node_version: versionStr,
      node_major: major,
      error: `Built-in global WebSocket is unavailable in this Node.js runtime (v${versionStr}). Upgrade to Node.js >= ${MIN_CDP_NODE_MAJOR} with WebSocket enabled.`,
    };
  }
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      node_version: versionStr,
      node_major: major,
      error: `Built-in global fetch is unavailable in this Node.js runtime (v${versionStr}). Upgrade to Node.js >= ${MIN_CDP_NODE_MAJOR}.`,
    };
  }
  return {
    ok: true,
    node_version: versionStr,
    node_major: major,
    error: null,
  };
}

export function assertCdpRuntimeSupport(opts = {}) {
  const res = checkCdpRuntimeSupport(opts);
  if (!res.ok) throw new Error(res.error);
  return res;
}

export function validateCdpPort(rawPort) {
  const str = String(rawPort ?? '').trim();
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid CDP port "${rawPort}": must be an integer between 1 and 65535.`);
  }
  const port = Number(str);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CDP port "${rawPort}": must be an integer between 1 and 65535.`);
  }
  return port;
}

export function validateCdpHttpUrl(rawUrl, expectedPort = null) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('CDP HTTP URL must be a non-empty string.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid CDP HTTP URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`Refusing non-http CDP endpoint protocol "${parsed.protocol}". Only http://127.0.0.1:<port> is allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Refusing CDP URL containing embedded credentials.');
  }
  if (parsed.hostname !== CDP_HOST) {
    throw new Error(`SSRF guard: CDP HTTP connections are strictly restricted to ${CDP_HOST} (got "${parsed.hostname}").`);
  }
  const port = validateCdpPort(parsed.port || '80');
  if (expectedPort !== null && port !== validateCdpPort(expectedPort)) {
    throw new Error(`CDP HTTP URL port mismatch: expected ${expectedPort}, got ${port}.`);
  }
  return parsed.href;
}

export function buildCdpHttpUrl(port = DEFAULT_CDP_PORT, endpointPath = '/json/list') {
  const validPort = validateCdpPort(port);
  if (typeof endpointPath !== 'string' || !endpointPath.startsWith('/') || /[\r\n@]|^\/\//.test(endpointPath)) {
    throw new Error(`Invalid CDP endpoint path: "${endpointPath}"`);
  }
  return validateCdpHttpUrl(`http://${CDP_HOST}:${validPort}${endpointPath}`, validPort);
}

export function validateCdpWsUrl(rawUrl, expectedPort = null) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('CDP WebSocket URL must be a non-empty string.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid CDP WebSocket URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'ws:') {
    throw new Error(`Refusing non-ws CDP WebSocket protocol "${parsed.protocol}". Only ws://127.0.0.1:<port>/devtools/... is allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Refusing CDP WebSocket URL containing embedded credentials.');
  }
  if (parsed.hostname !== CDP_HOST) {
    throw new Error(`SSRF guard: CDP WebSocket connections are strictly restricted to ${CDP_HOST} (got "${parsed.hostname}").`);
  }
  const port = validateCdpPort(parsed.port);
  if (expectedPort !== null && port !== validateCdpPort(expectedPort)) {
    throw new Error(`CDP WebSocket URL port mismatch: expected ${expectedPort}, got ${port}.`);
  }
  if (!parsed.pathname.startsWith('/devtools/')) {
    throw new Error(`Refusing unexpected CDP WebSocket path "${parsed.pathname}" (must start with /devtools/).`);
  }
  return parsed.href;
}

export function validateNavigationUrl(rawUrl, { cdpPort = DEFAULT_CDP_PORT } = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Navigation URL must be a non-empty string.');
  }
  if (/[\x00-\x1f\x7f]/.test(rawUrl)) {
    throw new Error('Refusing navigation URL containing control characters.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid navigation URL: "${rawUrl}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing navigation URL protocol "${parsed.protocol}". Only http:// and https:// URLs are allowed.`);
  }
  const hostLower = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (CLOUD_METADATA_HOSTS.has(hostLower)) {
    throw new Error(`SSRF guard: refusing navigation to cloud metadata host "${parsed.hostname}".`);
  }
  const effectivePort = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  const isLoopback = hostLower === '127.0.0.1' || hostLower === 'localhost' || hostLower === '::1' || hostLower === '0.0.0.0';
  if (isLoopback && effectivePort === validateCdpPort(cdpPort)) {
    throw new Error(`SSRF guard: refusing navigation to the local CDP debugging port (${cdpPort}).`);
  }
  return parsed.href;
}

export function validateLocalUploadPath(rawPath, {
  root,
  source = root,
  home = os.homedir(),
  cwd = process.cwd(),
} = {}) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('Upload file path must be a non-empty local file path.');
  }
  const trimmed = rawPath.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    throw new Error(`Refusing URL as upload file path (local file required): "${rawPath}"`);
  }
  const checked = assertSafeCliInputPath(trimmed, {
    label: 'upload file path',
    allowDirectory: false,
    root: root || cwd,
    source: source || root || cwd,
    home,
    cwd,
  });
  if (!checked.exists || !checked.stat) {
    throw new Error(`Upload file not found: ${checked.resolved}`);
  }
  return {
    resolved: checked.resolved,
    basename: path.basename(checked.resolved),
    size: checked.stat.size,
  };
}

export function resolveChromeProfileDir(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const profileDir = path.join(resolvedRoot, 'workspace', '.chrome-profile');
  refuseSymlink(profileDir, resolvedRoot, home);
  return profileDir;
}

export function buildCdpRequest(id, method, params = {}) {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`CDP request id must be a positive integer (got ${id}).`);
  }
  if (typeof method !== 'string' || !method.trim()) {
    throw new Error('CDP method must be a non-empty string.');
  }
  if (params !== undefined && !isObj(params)) {
    throw new Error('CDP params must be a plain object.');
  }
  return JSON.stringify({
    id,
    method: method.trim(),
    params: params || {},
  });
}

export function parseCdpMessage(raw) {
  let text;
  if (typeof raw === 'string') {
    text = raw;
  } else if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    text = Buffer.from(raw).toString('utf8');
  } else if (raw && typeof raw.data === 'string') {
    text = raw.data;
  } else {
    throw new Error('Unsupported CDP message frame type.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Malformed CDP JSON frame: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObj(parsed)) {
    throw new Error('CDP message frame must be a JSON object.');
  }
  if (parsed.id !== undefined) {
    if (!Number.isInteger(parsed.id)) {
      throw new Error(`Invalid CDP response id: ${parsed.id}`);
    }
    return {
      kind: 'response',
      id: parsed.id,
      result: parsed.result ?? null,
      error: isObj(parsed.error) ? parsed.error : null,
    };
  }
  if (typeof parsed.method === 'string' && parsed.method.trim()) {
    return {
      kind: 'event',
      method: parsed.method,
      params: isObj(parsed.params) ? parsed.params : {},
    };
  }
  throw new Error('CDP message frame missing both numeric "id" and string "method".');
}

export function selectCdpTarget(targets, {
  targetId = null,
  urlMatch = null,
  excludeTargetIds = [],
  port = DEFAULT_CDP_PORT,
} = {}) {
  if (!Array.isArray(targets)) return null;
  const excluded = new Set(Array.isArray(excludeTargetIds) ? excludeTargetIds.map(String) : []);
  const pages = targets.filter((t) => {
    if (!isObj(t) || t.type !== 'page' || typeof t.webSocketDebuggerUrl !== 'string') return false;
    if (excluded.size > 0 && t.id && excluded.has(String(t.id))) return false;
    try {
      validateCdpWsUrl(t.webSocketDebuggerUrl, port);
      return true;
    } catch {
      return false;
    }
  });
  if (pages.length === 0) return null;

  if (targetId) {
    const wanted = String(targetId).trim();
    const exact = pages.find(t => t.id === wanted);
    if (exact) return exact;
    const prefix = pages.find(t => typeof t.id === 'string' && t.id.startsWith(wanted));
    return prefix || null;
  }

  if (urlMatch) {
    const needle = String(urlMatch).trim().toLowerCase();
    const matched = pages.find(t => String(t.url || '').toLowerCase().includes(needle));
    if (matched) return matched;
  }

  const isInternalUrl = (u) => /^(?:devtools|chrome-extension|chrome|edge|brave):\/\//i.test(String(u || ''));
  const isHttpUrl = (u) => /^https?:\/\//i.test(String(u || ''));

  // Chrome's /json/list places the most recently active page first.
  const firstHttp = pages.find(t => isHttpUrl(t.url));
  if (firstHttp) return firstHttp;
  const firstNonInternal = pages.find(t => !isInternalUrl(t.url));
  if (firstNonInternal) return firstNonInternal;
  return pages[0];
}

export function detectNewCdpTarget(beforeTargets, afterTargets, {
  port = DEFAULT_CDP_PORT,
  preferUrlMatch = null,
} = {}) {
  const beforeIds = new Set(
    (Array.isArray(beforeTargets) ? beforeTargets : [])
      .map(t => (typeof t === 'string' ? t : t?.id))
      .filter(Boolean)
      .map(String),
  );
  return selectCdpTarget(afterTargets, {
    excludeTargetIds: [...beforeIds],
    urlMatch: preferUrlMatch,
    port,
  });
}

export async function waitForNewCdpTarget({
  port = DEFAULT_CDP_PORT,
  beforeTargetIds = [],
  timeoutMs = 5000,
  pollIntervalMs = 200,
  preferUrlMatch = null,
  activate = true,
  httpRequestImpl = httpRequestLocalCdp,
  sleepImpl = sleep,
} = {}) {
  const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 5000);
  const poll = Math.max(25, Math.min(1000, Number(pollIntervalMs) || 200));
  while (Date.now() <= deadline) {
    const targets = await fetchCdpJson(port, '/json/list', { timeoutMs: 2500, httpRequestImpl }).catch(() => []);
    const found = detectNewCdpTarget(beforeTargetIds, targets, { port, preferUrlMatch });
    if (found) {
      if (activate && found.id) {
        await httpRequestImpl({
          port,
          endpointPath: `/json/activate/${encodeURIComponent(String(found.id))}`,
          method: 'GET',
          timeoutMs: 2000,
        }).catch(() => {});
      }
      return { switched: true, target: found };
    }
    if (Date.now() + poll > deadline) break;
    await sleepImpl(poll);
  }
  return { switched: false, target: null };
}

export function computeHumanJitterMs(minMs = 3000, maxMs = 9000, { randomImpl = Math.random } = {}) {
  const lo = Math.max(0, Math.floor(Number.isFinite(Number(minMs)) ? Number(minMs) : 3000));
  const hi = Math.max(lo, Math.floor(Number.isFinite(Number(maxMs)) ? Number(maxMs) : lo));
  if (hi === lo) return lo;
  const r = Number(randomImpl());
  const clamped = Number.isFinite(r) ? Math.max(0, Math.min(0.999999, r)) : 0.5;
  return lo + Math.floor(clamped * (hi - lo + 1));
}

export async function sleepHumanJitter(minMs = 3000, maxMs = 9000, {
  randomImpl = Math.random,
  sleepImpl = sleep,
} = {}) {
  const lo = Math.max(0, Math.floor(Number.isFinite(Number(minMs)) ? Number(minMs) : 3000));
  const hi = Math.max(lo, Math.floor(Number.isFinite(Number(maxMs)) ? Number(maxMs) : lo));
  const delayMs = computeHumanJitterMs(lo, hi, { randomImpl });
  if (delayMs > 0) {
    await sleepImpl(delayMs);
  }
  return { delay_ms: delayMs, min_ms: lo, max_ms: hi };
}

const STRICT_RECEIPT_PATTERNS = [
  /your application (?:was|has been) sent/i,
  /\bapplication sent\b/i,
  /\bapplication submitted\b/i,
  /\bapplication received\b/i,
  /\byou applied on\b/i,
  /\bthank you for applying\b/i,
  /\bthanks for applying\b/i,
  /\bwe(?:'ve| have) received your application\b/i,
  /\bconfirmation (?:id|number|code)\b/i,
];

const RECEIPT_URL_PATTERN = /(?:confirmation|thank[-_]?you|application[-_]?submitted|submitted=true|applied=true)/i;

export function verifySubmissionReceipt(snapshotText = '', { modalClosed = true, url = '' } = {}) {
  const text = String(snapshotText || '').replace(/\s+/g, ' ').trim();
  const cleanUrl = String(url || '').trim();
  let matchedSignal = null;
  for (const re of STRICT_RECEIPT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      matchedSignal = m[0];
      break;
    }
  }
  const urlMatched = !matchedSignal && RECEIPT_URL_PATTERN.test(cleanUrl);
  if (urlMatched) matchedSignal = `url:${cleanUrl}`;

  const confirmed = Boolean(matchedSignal) && (Boolean(modalClosed) || /your application (?:was|has been) sent|\bapplication sent\b|\bthank you for applying\b/i.test(text));
  return {
    confirmed,
    status: confirmed ? 'submitted' : 'failed_unconfirmed',
    modal_closed: Boolean(modalClosed),
    matched_signal: matchedSignal,
    reason: confirmed
      ? null
      : (!matchedSignal
        ? 'No explicit confirmation signal found in post-submit DOM or URL.'
        : 'Application modal remained open without a final sent confirmation banner.'),
  };
}

export function httpRequestLocalCdp({
  port = DEFAULT_CDP_PORT,
  endpointPath = '/json/list',
  method = 'GET',
  timeoutMs = 3000,
} = {}) {
  const validPort = validateCdpPort(port);
  const fullUrl = buildCdpHttpUrl(validPort, endpointPath);
  const parsed = new URL(fullUrl);
  const reqPath = `${parsed.pathname}${parsed.search}`;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: CDP_HOST,
        port: validPort,
        family: 4,
        path: reqPath,
        method,
        headers: {
          Host: `${CDP_HOST}:${validPort}`,
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let total = 0;
        const maxBytes = 4 * 1024 * 1024;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error('CDP HTTP response exceeded 4 MB limit.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, body });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`CDP HTTP ${method} ${endpointPath} timed out after ${timeoutMs}ms.`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function fetchCdpJson(port, endpointPath, { method = 'GET', timeoutMs = 3000, httpRequestImpl = httpRequestLocalCdp } = {}) {
  const res = await httpRequestImpl({ port, endpointPath, method, timeoutMs });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`CDP HTTP ${method} ${endpointPath} failed with status ${res.status}.`);
    err.status = res.status;
    err.body = res.body;
    throw err;
  }
  try {
    return JSON.parse(res.body);
  } catch (err) {
    throw new Error(`Invalid JSON from CDP ${endpointPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function createCdpBlankTab(port, { httpRequestImpl = httpRequestLocalCdp } = {}) {
  const endpointPath = '/json/new?about:blank';
  try {
    return await fetchCdpJson(port, endpointPath, { method: 'PUT', timeoutMs: 5000, httpRequestImpl });
  } catch (err) {
    if (err && (err.status === 405 || err.status === 400)) {
      return await fetchCdpJson(port, endpointPath, { method: 'GET', timeoutMs: 5000, httpRequestImpl });
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function readRecordedCdpPort(profileDir) {
  for (const name of ['.veycraft-cdp-port', 'DevToolsActivePort']) {
    const file = path.join(profileDir, name);
    try {
      if (!fs.existsSync(file)) continue;
      const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
      if (/^\d+$/.test(firstLine)) {
        const port = validateCdpPort(firstLine);
        if (port >= 1 && port <= 65535) return port;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function writeRecordedCdpPort(profileDir, port) {
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, '.veycraft-cdp-port'), `${port}\n`, 'utf8');
  } catch { /* non-fatal */ }
}

export function isLocalPortAvailable(port) {
  const validPort = validateCdpPort(port);
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(validPort, CDP_HOST);
  });
}

export function buildChromeLaunchArgs({
  port = DEFAULT_CDP_PORT,
  profileDir,
  initialUrl = 'about:blank',
} = {}) {
  const validPort = validateCdpPort(port);
  if (typeof profileDir !== 'string' || !profileDir.trim()) {
    throw new Error('profileDir must be a non-empty string.');
  }
  return [
    `--remote-debugging-port=${validPort}`,
    `--remote-debugging-address=${CDP_HOST}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    '--window-size=1280,900',
    initialUrl,
  ];
}

export function buildLoginFallbackCommand({
  binary = null,
  port = DEFAULT_CDP_PORT,
  profileDir,
  url = DEFAULT_LOGIN_URL,
  platform = process.platform,
} = {}) {
  const validPort = validateCdpPort(port);
  const safeUrl = url || DEFAULT_LOGIN_URL;
  if (!binary) {
    return `node ./bin/cli.mjs cdp login "${safeUrl}" --port ${validPort}`;
  }
  const args = [
    `--remote-debugging-port=${validPort}`,
    `--user-data-dir="${profileDir}"`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    `"${safeUrl}"`,
  ].join(' ');
  if (platform === 'win32') {
    return `& "${binary}" ${args}`;
  }
  return `"${binary}" ${args}`;
}

export async function closeCdpBrowser({
  root = null,
  port = DEFAULT_CDP_PORT,
  portExplicit = false,
  home = os.homedir(),
  timeoutMs = 3000,
  httpRequestImpl = httpRequestLocalCdp,
  WebSocketImpl = globalThis.WebSocket,
  isPortAvailableImpl = isLocalPortAvailable,
} = {}) {
  const requestedPort = validateCdpPort(port);
  const profileDir = root ? resolveChromeProfileDir(root, { home }) : null;

  const probe = async (candidatePort) => {
    try {
      const res = await httpRequestImpl({ port: candidatePort, endpointPath: '/json/version', method: 'GET', timeoutMs: 1200 });
      if (res.status >= 200 && res.status < 300) {
        const version = JSON.parse(res.body);
        if (isObj(version) && (version.Browser || version.webSocketDebuggerUrl || version['Protocol-Version'])) {
          return version;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  let activePort = requestedPort;
  let version = await probe(requestedPort);
  if (!version && !portExplicit && profileDir) {
    const recordedPort = readRecordedCdpPort(profileDir);
    if (recordedPort && recordedPort !== requestedPort) {
      const recVer = await probe(recordedPort);
      if (recVer) {
        activePort = recordedPort;
        version = recVer;
      }
    }
  }

  if (!version) {
    return {
      ok: true,
      closed: false,
      already_stopped: true,
      port: activePort,
      port_released: true,
      profile_dir: profileDir,
    };
  }

  const wsUrl = version?.webSocketDebuggerUrl;
  let closeSent = false;
  if (typeof wsUrl === 'string' && wsUrl) {
    const client = new CdpClient(wsUrl, { port: activePort, WebSocketImpl, defaultTimeoutMs: Math.min(timeoutMs, 3000) });
    await client.connect();
    try {
      await client.send('Browser.close', {}, { timeoutMs: Math.min(timeoutMs, 2500) }).catch(() => {});
      closeSent = true;
    } finally {
      await client.close();
    }
  } else {
    // Fallback: close via active page target if browser-level wsUrl is missing
    const targets = await fetchCdpJson(activePort, '/json/list', { timeoutMs: 1500, httpRequestImpl }).catch(() => []);
    const target = selectCdpTarget(targets, { port: activePort });
    if (target?.webSocketDebuggerUrl) {
      const client = new CdpClient(target.webSocketDebuggerUrl, { port: activePort, WebSocketImpl, defaultTimeoutMs: Math.min(timeoutMs, 3000) });
      await client.connect();
      try {
        await client.send('Browser.close', {}, { timeoutMs: Math.min(timeoutMs, 2500) }).catch(() => {});
        closeSent = true;
      } finally {
        await client.close();
      }
    }
  }

  // Wait up to timeoutMs (default 3s) for the debugging port to release so workspace/.chrome-profile is unlocked.
  let portReleased = false;
  const deadline = Date.now() + Math.max(250, timeoutMs);
  while (Date.now() < deadline) {
    const stillAlive = await probe(activePort);
    if (!stillAlive) {
      const free = await isPortAvailableImpl(activePort).catch(() => true);
      if (free) {
        portReleased = true;
        break;
      }
    }
    await sleep(150);
  }

  if (profileDir) {
    try {
      const marker = path.join(profileDir, '.veycraft-cdp-port');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } catch { /* non-fatal */ }
  }

  return {
    ok: true,
    closed: closeSent,
    already_stopped: false,
    port: activePort,
    port_released: portReleased,
    profile_dir: profileDir,
  };
}

export async function surfaceCdpWindow(client, targetId, {
  left = 80,
  top = 60,
  width = 1280,
  height = 900,
  timeoutMs = 4000,
} = {}) {
  let windowId = null;
  let boundsApplied = false;
  if (targetId) {
    try {
      const winInfo = await client.send('Browser.getWindowForTarget', { targetId }, { timeoutMs });
      if (Number.isInteger(winInfo?.windowId)) {
        windowId = winInfo.windowId;
        if (winInfo.bounds?.windowState && winInfo.bounds.windowState !== 'normal') {
          await client.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal' },
          }, { timeoutMs }).catch(() => {});
        }
        await client.send('Browser.setWindowBounds', {
          windowId,
          bounds: { windowState: 'normal', left, top, width, height },
        }, { timeoutMs });
        boundsApplied = true;
      }
    } catch {
      // Browser domain may be restricted on some targets; continue to Page.bringToFront
    }
  }
  await client.send('Page.bringToFront', {}, { timeoutMs }).catch(() => {});
  return { window_id: windowId, bounds_applied: boundsApplied };
}

export async function ensureCdpChrome({
  root,
  port = DEFAULT_CDP_PORT,
  portExplicit = false,
  initialUrl = 'about:blank',
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  launch = true,
  launchTimeoutMs = 15000,
  httpRequestImpl = httpRequestLocalCdp,
  detectBrowserImpl = detectHeadlessBrowser,
  spawnImpl = spawn,
  isPortAvailableImpl = isLocalPortAvailable,
} = {}) {
  const requestedPort = validateCdpPort(port);
  const profileDir = resolveChromeProfileDir(root, { home });

  const probePort = async (candidatePort, timeoutMs = 1200) => {
    try {
      const res = await httpRequestImpl({ port: candidatePort, endpointPath: '/json/version', method: 'GET', timeoutMs });
      if (res.status >= 200 && res.status < 300) {
        const version = JSON.parse(res.body);
        if (isObj(version) && (version.Browser || version.webSocketDebuggerUrl || version['Protocol-Version'])) {
          return { state: 'cdp', version };
        }
      }
      return { state: 'occupied', status: res.status };
    } catch (err) {
      if (err && (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH')) {
        return { state: 'free' };
      }
      return { state: 'error', error: err };
    }
  };

  // 1. Probe requested port first (default 9222)
  const firstProbe = await probePort(requestedPort);
  if (firstProbe.state === 'cdp') {
    return {
      connected: true,
      launched: false,
      host: CDP_HOST,
      port: requestedPort,
      profile_dir: profileDir,
      binary: null,
      version: firstProbe.version,
    };
  }

  // 2. When --port was not explicitly forced, reuse an already-running workspace profile CDP port (e.g. if 9222 is held by another Chrome)
  if (!portExplicit) {
    const recordedPort = readRecordedCdpPort(profileDir);
    if (recordedPort && recordedPort !== requestedPort) {
      const recProbe = await probePort(recordedPort);
      if (recProbe.state === 'cdp') {
        return {
          connected: true,
          launched: false,
          host: CDP_HOST,
          port: recordedPort,
          profile_dir: profileDir,
          binary: null,
          version: recProbe.version,
        };
      }
    }
    // If default port 9222 is occupied by a non-CDP HTTP server (e.g. Chrome 136+ default profile returning 404), check fallback range for an existing CDP Chrome
    if (firstProbe.state === 'occupied') {
      for (let p = requestedPort + 1; p <= Math.min(requestedPort + 10, 65535); p++) {
        const pProbe = await probePort(p, 400);
        if (pProbe.state === 'cdp') {
          writeRecordedCdpPort(profileDir, p);
          return {
            connected: true,
            launched: false,
            host: CDP_HOST,
            port: p,
            profile_dir: profileDir,
            binary: null,
            version: pProbe.version,
          };
        }
      }
    }
  }

  if (!launch) {
    throw new Error(
      `Chrome CDP is not running on ${CDP_HOST}:${requestedPort} (--no-launch set). Run \`veycraft cdp status --port ${requestedPort}\` to auto-launch Chrome.`,
    );
  }

  // 3. Determine launch port (if explicit port is occupied by non-CDP service, fail fast instead of timing out)
  let launchPort = requestedPort;
  const requestedAvailable = firstProbe.state === 'occupied' ? false : await isPortAvailableImpl(requestedPort);
  if (!requestedAvailable) {
    if (portExplicit) {
      throw new Error(
        `Port ${requestedPort} on ${CDP_HOST} is already in use by another process (not a compatible CDP HTTP endpoint). Pass a free port with \`--port ${Math.min(requestedPort + 1, 65535)}\`.`,
      );
    }
    let foundFree = null;
    for (let p = requestedPort + 1; p <= Math.min(requestedPort + 20, 65535); p++) {
      if (await isPortAvailableImpl(p)) {
        foundFree = p;
        break;
      }
    }
    if (!foundFree) {
      throw new Error(`No free local CDP port found on ${CDP_HOST} in range ${requestedPort}..${Math.min(requestedPort + 20, 65535)}.`);
    }
    launchPort = foundFree;
  }

  const binary = detectBrowserImpl({ platform, env, home });
  if (!binary) {
    throw new Error(
      'Could not find Chrome, Chromium, or Microsoft Edge on this machine. Install Google Chrome or Microsoft Edge, or start Chrome manually with `--remote-debugging-port=' + launchPort + '`.',
    );
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const args = buildChromeLaunchArgs({
    port: launchPort,
    profileDir,
    initialUrl,
  });

  const child = spawnImpl(binary, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  if (child && typeof child.unref === 'function') {
    child.unref();
  }

  const deadline = Date.now() + launchTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const ready = await probePort(launchPort);
    if (ready.state === 'cdp') {
      writeRecordedCdpPort(profileDir, launchPort);
      return {
        connected: true,
        launched: true,
        host: CDP_HOST,
        port: launchPort,
        profile_dir: profileDir,
        binary,
        version: ready.version,
      };
    }
  }

  const fallbackCommand = buildLoginFallbackCommand({
    binary,
    port: launchPort,
    profileDir,
    url: initialUrl,
    platform,
  });
  const err = new Error(
    `Launched browser (${binary}) with profile "${profileDir}", but CDP did not become ready on ${CDP_HOST}:${launchPort} within ${launchTimeoutMs}ms.`,
  );
  err.code = 'CDP_LAUNCH_TIMEOUT';
  err.fallbackCommand = fallbackCommand;
  err.port = launchPort;
  err.profileDir = profileDir;
  throw err;
}

export class CdpClient {
  constructor(wsUrl, {
    port = DEFAULT_CDP_PORT,
    WebSocketImpl = globalThis.WebSocket,
    connectTimeoutMs = 10000,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.wsUrl = validateCdpWsUrl(wsUrl, port);
    this.WebSocketImpl = WebSocketImpl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async connect() {
    if (typeof this.WebSocketImpl !== 'function') {
      throw new Error(`Built-in WebSocket is required (Node.js >= ${MIN_CDP_NODE_MAJOR}).`);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new this.WebSocketImpl(this.wsUrl);
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`Timed out connecting to CDP WebSocket ${this.wsUrl} after ${this.connectTimeoutMs}ms.`));
      }, this.connectTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this);
      };

      const onError = (ev) => {
        const msg = ev?.message || ev?.error?.message || 'WebSocket connection error';
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`CDP WebSocket error (${this.wsUrl}): ${msg}`));
          return;
        }
        this._rejectAllPending(new Error(`CDP WebSocket error: ${msg}`));
      };

      const onClose = () => {
        this.closed = true;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`CDP WebSocket closed before opening (${this.wsUrl}).`));
          return;
        }
        this._rejectAllPending(new Error('CDP WebSocket connection closed.'));
      };

      const onMessage = (ev) => {
        let msg;
        try {
          msg = parseCdpMessage(ev?.data !== undefined ? ev.data : ev);
        } catch {
          return;
        }
        if (msg.kind === 'response') {
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            const detail = msg.error.data ? ` (${msg.error.data})` : '';
            entry.reject(new Error(`CDP error ${msg.error.code ?? ''}: ${msg.error.message || 'Unknown error'}${detail}`.trim()));
          } else {
            entry.resolve(msg.result);
          }
        } else if (msg.kind === 'event') {
          const set = this.listeners.get(msg.method);
          if (!set) return;
          for (const fn of [...set]) {
            try { fn(msg.params); } catch { /* ignore listener errors */ }
          }
        }
      };

      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);
        ws.addEventListener('message', onMessage);
      } else if (typeof ws.on === 'function') {
        ws.on('open', onOpen);
        ws.on('error', onError);
        ws.on('close', onClose);
        ws.on('message', onMessage);
      } else {
        clearTimeout(timer);
        reject(new Error('Unsupported WebSocket implementation (missing addEventListener/on).'));
      }
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.off(method, handler);
  }

  off(method, handler) {
    const set = this.listeners.get(method);
    if (set) set.delete(handler);
  }

  waitForEvent(method, { timeoutMs = this.defaultTimeoutMs, predicate = () => true } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for CDP event "${method}" after ${timeoutMs}ms.`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      const off = this.on(method, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  send(method, params = {}, { timeoutMs = this.defaultTimeoutMs } = {}) {
    if (!this.ws || this.closed) {
      return Promise.reject(new Error('CDP WebSocket is not connected.'));
    }
    const id = this.nextId++;
    const payload = buildCdpRequest(id, method, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call "${method}" (id=${id}) timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  _rejectAllPending(err) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  async close() {
    this.closed = true;
    this._rejectAllPending(new Error('CDP client closed.'));
    this.listeners.clear();
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    try {
      if (ws.readyState !== 3) {
        await new Promise((resolve) => {
          const done = () => resolve();
          const t = setTimeout(done, 400);
          if (typeof t.unref === 'function') t.unref();
          if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('close', () => { clearTimeout(t); done(); }, { once: true });
          } else if (typeof ws.once === 'function') {
            ws.once('close', () => { clearTimeout(t); done(); });
          }
          try { ws.close(); } catch { clearTimeout(t); done(); }
        });
      }
    } catch { /* ignore */ }
  }
}

async function evalInPage(client, expression, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, { timeoutMs });

  if (res?.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description
      || res.exceptionDetails.text
      || 'JavaScript evaluation failed';
    throw new Error(`Page eval error: ${desc}`);
  }
  if (!res || !res.result) return undefined;
  if (Object.prototype.hasOwnProperty.call(res.result, 'value')) {
    return res.result.value;
  }
  if (res.result.type === 'undefined') return undefined;
  return res.result.description ?? null;
}

function buildSnapshotExpression(maxChars) {
  const safeMax = Math.max(500, Math.min(100000, Number(maxChars) || DEFAULT_MAX_CHARS));
  return `(() => {
    const MAX_CHARS = ${safeMax};
    const stripInvisible = (str) => {
      let out = '';
      const s = String(str || '');
      for (let i = 0; i < s.length; i++) {
        const cp = s.codePointAt(i);
        if (cp > 0xffff) i++;
        if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) continue;
        out += String.fromCodePoint(cp);
      }
      return out.replace(/\\s+/g, ' ').trim();
    };
    const escAttr = (v) => String(v || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    const escId = (v) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(String(v))
      : String(v).replace(/[^A-Za-z0-9_-]/g, '\\\\$&');

    const isVisible = (el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.hidden) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      const cs = window.getComputedStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0;
    };

    const uniqueSel = (el) => {
      try {
        const tag = String(el.tagName || '').toLowerCase();
        if (el.id) {
          const s = '#' + escId(el.id);
          if (document.querySelectorAll(s).length === 1) return s;
        }
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        if (testId) {
          const attr = el.hasAttribute('data-testid') ? 'data-testid' : 'data-test';
          const s = '[' + attr + '="' + escAttr(testId) + '"]';
          if (document.querySelectorAll(s).length === 1) return s;
        }
        const name = el.getAttribute('name');
        if (name) {
          const s = tag + '[name="' + escAttr(name) + '"]';
          if (document.querySelectorAll(s).length === 1) return s;
        }
        const aria = el.getAttribute('aria-label');
        if (aria && aria.length <= 80) {
          const s = tag + '[aria-label="' + escAttr(aria) + '"]';
          if (document.querySelectorAll(s).length === 1) return s;
        }
        const parts = [];
        let cur = el;
        for (let depth = 0; depth < 5 && cur && cur.nodeType === 1; depth++) {
          const cTag = cur.tagName.toLowerCase();
          if (cur.id) {
            parts.unshift('#' + escId(cur.id));
            const joined = parts.join(' > ');
            if (document.querySelectorAll(joined).length === 1) return joined;
            break;
          }
          let idx = 1;
          let sib = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === cur.tagName) idx++;
            sib = sib.previousElementSibling;
          }
          parts.unshift(cTag + ':nth-of-type(' + idx + ')');
          const joined = parts.join(' > ');
          if (document.querySelectorAll(joined).length === 1) return joined;
          cur = cur.parentElement;
        }
        return parts.join(' > ') || tag;
      } catch {
        return String(el.tagName || '').toLowerCase();
      }
    };

    const resolveLabel = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return stripInvisible(aria).slice(0, 100);
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const txt = labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
        if (stripInvisible(txt)) return stripInvisible(txt).slice(0, 100);
      }
      if (el.id) {
        const lbl = document.querySelector('label[for="' + escAttr(el.id) + '"]');
        if (lbl?.textContent) return stripInvisible(lbl.textContent).slice(0, 100);
      }
      const parentLbl = el.closest('label');
      if (parentLbl?.textContent) return stripInvisible(parentLbl.textContent).slice(0, 100);
      const ph = el.getAttribute('placeholder');
      if (ph) return stripInvisible(ph).slice(0, 100);
      return stripInvisible(el.getAttribute('name') || el.id || '').slice(0, 100);
    };

    const bodyTextRaw = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    const cleanedLines = bodyTextRaw
      .split(/\\r?\\n/)
      .map(l => stripInvisible(l))
      .filter(Boolean);
    const fullText = cleanedLines.join('\\n');
    const text = fullText.slice(0, MAX_CHARS);

    const lowerSample = fullText.slice(0, 4000).toLowerCase();
    const hasCaptchaNode = Boolean(document.querySelector('[class*="captcha" i], [id*="captcha" i], iframe[src*="turnstile" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], #challenge-form'));
    const hasPw = Boolean(document.querySelector('input[type="password"]'));
    const hasLoginTitle = /\\b(sign in|log in|login|تسجيل الدخول)\\b/i.test((document.title || '') + ' ' + lowerSample.slice(0, 600));
    const authChallenge = (hasCaptchaNode || /\\b(verify you are human|just a moment|attention required|recaptcha|hcaptcha)\\b/i.test(lowerSample))
      ? 'captcha'
      : (hasPw && hasLoginTitle ? 'login' : null);

    const links = [];
    const seenHref = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      if (links.length >= 60) break;
      if (!isVisible(a)) continue;
      const href = String(a.href || a.getAttribute('href') || '').trim();
      if (!href || /^javascript:/i.test(href)) continue;
      const label = stripInvisible(a.innerText || a.textContent || a.getAttribute('aria-label') || '').slice(0, 120);
      if (!label) continue;
      const key = href + '::' + label;
      if (seenHref.has(key)) continue;
      seenHref.add(key);
      links.push({ text: label, href, selector: uniqueSel(a) });
    }

    const HONEYPOT_RE = /honeypot|trap|bot[_-]?check|website_url_honeypot|hp[_-]?field/i;
    const fields = [];
    let honeypotsDetected = 0;
    for (const el of Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="combobox"]'))) {
      if (fields.length >= 60) break;
      const tag = el.tagName.toLowerCase();
      const type = String(el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : '')).toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue;
      const name = String(el.getAttribute('name') || '');
      const id = String(el.id || '');
      if (HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id) || !isVisible(el)) {
        if (HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id)) honeypotsDetected++;
        continue;
      }
      const isCheck = type === 'checkbox' || type === 'radio';
      const isEditable = el.getAttribute('contenteditable') === 'true';
      const val = type === 'password'
        ? '[REDACTED]'
        : isEditable
          ? stripInvisible(el.textContent || '').slice(0, 120)
          : stripInvisible(el.value || '').slice(0, 120);
      const item = {
        tag,
        type: el.getAttribute('role') === 'combobox' ? 'combobox' : (isEditable ? 'contenteditable' : (type || tag)),
        label: resolveLabel(el),
        name: name || null,
        id: id || null,
        placeholder: stripInvisible(el.getAttribute('placeholder') || '').slice(0, 80) || null,
        value: val,
        required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
        disabled: Boolean(el.disabled),
        selector: uniqueSel(el),
      };
      if (isCheck) item.checked = Boolean(el.checked);
      if (tag === 'select') {
        item.options = Array.from(el.options || []).slice(0, 15).map(o => ({
          value: String(o.value || ''),
          text: stripInvisible(o.text || '').slice(0, 60),
          selected: Boolean(o.selected),
        }));
      }
      fields.push(item);
    }

    const buttons = [];
    for (const btn of Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))) {
      if (buttons.length >= 40) break;
      if (!isVisible(btn)) continue;
      const textLabel = stripInvisible(btn.innerText || btn.textContent || btn.value || btn.getAttribute('aria-label') || '').slice(0, 80);
      if (!textLabel) continue;
      buttons.push({
        text: textLabel,
        type: String(btn.getAttribute('type') || btn.getAttribute('role') || btn.tagName.toLowerCase()).toLowerCase(),
        disabled: Boolean(btn.disabled || btn.getAttribute('aria-disabled') === 'true'),
        selector: uniqueSel(btn),
      });
    }

    return {
      ok: true,
      untrusted_external_data: true,
      url: String(window.location.href || ''),
      title: stripInvisible(document.title || ''),
      ready_state: String(document.readyState || ''),
      auth_or_challenge_detected: authChallenge,
      total_chars: fullText.length,
      truncated: fullText.length > MAX_CHARS,
      text,
      links_count: links.length,
      links,
      fields_count: fields.length,
      fields,
      buttons_count: buttons.length,
      buttons,
      honeypots_detected: honeypotsDetected,
    };
  })()`;
}

function buildClickExpression(selector) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const findDeep = (root, sel) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return direct;
      } catch (e) {
        return { __selectorError: e.message };
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
          const found = findDeep(el.shadowRoot, sel);
          if (found) return found;
        }
        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument) {
              const nested = findDeep(el.contentDocument, sel);
              if (nested) return nested;
            }
          } catch { /* cross-origin iframe */ }
        }
      }
      return null;
    };
    const el = findDeep(document, selector);
    if (el && el.__selectorError) {
      return { ok: false, error: 'Invalid CSS selector: ' + el.__selectorError };
    }
    if (!el) {
      return { ok: false, error: 'Element not found for selector: ' + selector };
    }
    if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, error: 'Element is disabled: ' + selector };
    }
    const urlBefore = String(window.location.href || '');
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }
    if (typeof el.focus === 'function') el.focus();
    for (const evtName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        el.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window }));
      } catch { /* ignore */ }
    }
    el.click();
    return {
      ok: true,
      clicked: true,
      selector,
      tag: String(el.tagName || '').toLowerCase(),
      text: String(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      url_before: urlBefore,
    };
  })()`;
}

function buildFillExpression(selector, value) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const value = ${JSON.stringify(String(value))};
    const HONEYPOT_RE = /honeypot|trap|bot[_-]?check|website_url_honeypot|hp[_-]?field/i;
    const findDeep = (root, sel) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return direct;
      } catch (e) {
        return { __selectorError: e.message };
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
          const found = findDeep(el.shadowRoot, sel);
          if (found) return found;
        }
      }
      return null;
    };
    const el = findDeep(document, selector);
    if (el && el.__selectorError) {
      return { ok: false, error: 'Invalid CSS selector: ' + el.__selectorError };
    }
    if (!el) {
      return { ok: false, error: 'Element not found for selector: ' + selector };
    }
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : '')).toLowerCase();
    const name = String(el.getAttribute?.('name') || '');
    const id = String(el.id || '');
    if (tag === 'button' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return { ok: false, error: 'Refusing to fill non-editable button/submit element: ' + selector };
    }
    if (type === 'hidden' || el.hidden || HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id)) {
      return { ok: false, error: 'Refusing to fill hidden or honeypot element: ' + selector };
    }
    if (type === 'file') {
      return { ok: false, error: 'Cannot set <input type="file"> via fill; use CDP DOM.setFileInputFiles or native upload.' };
    }
    if (el.disabled || el.readOnly) {
      return { ok: false, error: 'Element is disabled or read-only: ' + selector };
    }

    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }
    if (typeof el.focus === 'function') el.focus();

    const dispatchEvents = (target, inputData) => {
      try {
        if (typeof InputEvent === 'function') {
          target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: inputData, inputType: 'insertText' }));
        } else {
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    if (type === 'checkbox' || type === 'radio') {
      const wantChecked = /^(?:true|1|yes|on|checked)$/i.test(value.trim());
      const proto = window.HTMLInputElement?.prototype;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'checked')?.set : null;
      const prev = Boolean(el.checked);
      if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
        el._valueTracker.setValue(String(!wantChecked));
      }
      if (typeof setter === 'function') setter.call(el, wantChecked);
      else el.checked = wantChecked;
      if (prev !== wantChecked) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        // Ensure final desired state if click toggled it back
        if (Boolean(el.checked) !== wantChecked) {
          if (typeof setter === 'function') setter.call(el, wantChecked);
          else el.checked = wantChecked;
        }
      }
      dispatchEvents(el, String(wantChecked));
      return {
        ok: true,
        filled: true,
        selector,
        tag,
        type,
        read_back_value: Boolean(el.checked),
      };
    }

    if (el.getAttribute?.('contenteditable') === 'true') {
      el.textContent = value;
      dispatchEvents(el, value);
      return {
        ok: true,
        filled: true,
        selector,
        tag,
        type: 'contenteditable',
        read_back_value: String(el.textContent || ''),
      };
    }

    if (tag === 'select') {
      const options = Array.from(el.options || []);
      const norm = (s) => String(s || '').trim().toLowerCase();
      const matched = options.find(o => o.value === value)
        || options.find(o => norm(o.value) === norm(value))
        || options.find(o => norm(o.text) === norm(value))
        || options.find(o => norm(o.text).includes(norm(value)));
      if (!matched) {
        return {
          ok: false,
          error: 'No matching <option> found for value "' + value + '" in select ' + selector,
          available_options: options.slice(0, 15).map(o => ({ value: o.value, text: String(o.text || '').trim() })),
        };
      }
      const proto = window.HTMLSelectElement?.prototype;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
      const prevVal = el.value;
      if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
        el._valueTracker.setValue(prevVal === matched.value ? '' : prevVal);
      }
      if (typeof setter === 'function') setter.call(el, matched.value);
      else el.value = matched.value;
      dispatchEvents(el, matched.value);
      return {
        ok: true,
        filled: true,
        selector,
        tag,
        type: 'select',
        read_back_value: String(el.value || ''),
        selected_text: String(el.options[el.selectedIndex]?.text || '').trim(),
      };
    }

    const proto = tag === 'textarea' ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    const prevVal = el.value;
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      el._valueTracker.setValue(prevVal === value ? '' : prevVal);
    }
    if (typeof setter === 'function') setter.call(el, value);
    else el.value = value;
    dispatchEvents(el, value);

    return {
      ok: true,
      filled: true,
      selector,
      tag,
      type: type || tag,
      read_back_value: type === 'password' ? '[REDACTED]' : String(el.value || ''),
    };
  })()`;
}

function buildInspectTargetForClickExpression(selector) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const findDeep = (root, sel, offsetX = 0, offsetY = 0) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return { el: direct, root, offsetX, offsetY };
      } catch (e) {
        return { __selectorError: e.message };
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) {
          const found = findDeep(node.shadowRoot, sel, offsetX, offsetY);
          if (found) return found;
        }
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) {
              const frRect = node.getBoundingClientRect();
              const nested = findDeep(node.contentDocument, sel, offsetX + frRect.left, offsetY + frRect.top);
              if (nested) return nested;
            }
          } catch { /* cross-origin iframe */ }
        }
      }
      return null;
    };
    const found = findDeep(document, selector);
    if (found && found.__selectorError) {
      return { ok: false, error: 'Invalid CSS selector: ' + found.__selectorError };
    }
    if (!found || !found.el) {
      return { ok: false, error: 'Element not found for selector: ' + selector };
    }
    const { el, root, offsetX, offsetY } = found;
    if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, error: 'Element is disabled: ' + selector };
    }
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    let clickTarget = el;
    let resolvedViaLabel = false;
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      const r0 = el.getBoundingClientRect();
      if (r0.width <= 0 || r0.height <= 0) {
        let lbl = null;
        if (el.id) {
          const escId = String(el.id).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          lbl = root.querySelector?.('label[for="' + escId + '"]') || document.querySelector('label[for="' + escId + '"]');
        }
        if (!lbl && typeof el.closest === 'function') lbl = el.closest('label');
        if (lbl) {
          clickTarget = lbl;
          resolvedViaLabel = true;
        }
      }
    }
    if (typeof clickTarget.scrollIntoView === 'function') {
      clickTarget.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const rect = clickTarget.getBoundingClientRect();
    const hasCoords = rect.width > 0 && rect.height > 0;
    return {
      ok: true,
      __cdpInspectClick: true,
      selector,
      tag,
      type,
      text: String(clickTarget.innerText || clickTarget.textContent || el.value || el.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      url_before: String(window.location.href || ''),
      resolved_via_label: resolvedViaLabel,
      has_coords: hasCoords,
      x: hasCoords ? Math.round(offsetX + rect.left + rect.width / 2) : null,
      y: hasCoords ? Math.round(offsetY + rect.top + rect.height / 2) : null,
    };
  })()`;
}

function buildInspectTargetForFillExpression(selector) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const HONEYPOT_RE = /honeypot|trap|bot[_-]?check|website_url_honeypot|hp[_-]?field/i;
    const findDeep = (root, sel, offsetX = 0, offsetY = 0) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return { el: direct, root, offsetX, offsetY };
      } catch (e) {
        return { __selectorError: e.message };
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) {
          const found = findDeep(node.shadowRoot, sel, offsetX, offsetY);
          if (found) return found;
        }
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) {
              const frRect = node.getBoundingClientRect();
              const nested = findDeep(node.contentDocument, sel, offsetX + frRect.left, offsetY + frRect.top);
              if (nested) return nested;
            }
          } catch { /* cross-origin iframe */ }
        }
      }
      return null;
    };
    const found = findDeep(document, selector);
    if (found && found.__selectorError) {
      return { ok: false, error: 'Invalid CSS selector: ' + found.__selectorError };
    }
    if (!found || !found.el) {
      return { ok: false, error: 'Element not found for selector: ' + selector };
    }
    const { el, root, offsetX, offsetY } = found;
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : '')).toLowerCase();
    const name = String(el.getAttribute?.('name') || '');
    const id = String(el.id || '');
    if (tag === 'button' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return { ok: false, error: 'Refusing to fill non-editable button/submit element: ' + selector };
    }
    if (type === 'hidden' || el.hidden || HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id)) {
      return { ok: false, error: 'Refusing to fill hidden or honeypot element: ' + selector };
    }
    if (type === 'file') {
      return { ok: false, error: 'Cannot set <input type="file"> via fill; use veycraft cdp upload.' };
    }
    if (el.disabled || el.readOnly) {
      return { ok: false, error: 'Element is disabled or read-only: ' + selector };
    }
    let clickTarget = el;
    let resolvedViaLabel = false;
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
      const r0 = el.getBoundingClientRect();
      if (r0.width <= 0 || r0.height <= 0) {
        let lbl = null;
        if (el.id) {
          const escId = String(el.id).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
          lbl = root.querySelector?.('label[for="' + escId + '"]') || document.querySelector('label[for="' + escId + '"]');
        }
        if (!lbl && typeof el.closest === 'function') lbl = el.closest('label');
        if (lbl) {
          clickTarget = lbl;
          resolvedViaLabel = true;
        }
      }
    }
    if (typeof clickTarget.scrollIntoView === 'function') {
      clickTarget.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const rect = clickTarget.getBoundingClientRect();
    const hasCoords = rect.width > 0 && rect.height > 0;
    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    const hasAutoComplete = Boolean(el.getAttribute?.('aria-autocomplete'));
    const hasExpandedControls = Boolean(el.getAttribute?.('aria-controls')) && el.getAttribute?.('aria-expanded') !== null;
    const isCombobox = role === 'combobox' || hasAutoComplete || hasExpandedControls;
    return {
      ok: true,
      __cdpInspectFill: true,
      selector,
      tag,
      type: el.getAttribute?.('contenteditable') === 'true' ? 'contenteditable' : (type || tag),
      role,
      is_combobox: isCombobox,
      is_contenteditable: el.getAttribute?.('contenteditable') === 'true',
      checked: Boolean(el.checked),
      resolved_via_label: resolvedViaLabel,
      has_coords: hasCoords,
      x: hasCoords ? Math.round(offsetX + rect.left + rect.width / 2) : null,
      y: hasCoords ? Math.round(offsetY + rect.top + rect.height / 2) : null,
    };
  })()`;
}

function buildFindComboboxOptionExpression(value) {
  return `(() => {
    const wanted = ${JSON.stringify(String(value || ''))}.trim().toLowerCase();
    const OPTION_SEL = '[role="option"], [role="listbox"] li, [class*="select__option" i], [data-test-single-typeahead-entity-form-search-result]';
    const collect = (root, offsetX = 0, offsetY = 0, out = []) => {
      for (const el of Array.from(root.querySelectorAll(OPTION_SEL))) {
        const cs = window.getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const text = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        out.push({ el, text, offsetX, offsetY });
      }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) collect(node.shadowRoot, offsetX, offsetY, out);
      }
      return out;
    };
    const options = collect(document);
    if (options.length === 0) return { found: false, __cdpComboboxOption: true, count: 0 };
    const norm = (s) => s.toLowerCase();
    const pick = options.find(o => norm(o.text) === wanted)
      || options.find(o => norm(o.text).startsWith(wanted))
      || options.find(o => norm(o.text).includes(wanted))
      || options[0];
    if (typeof pick.el.scrollIntoView === 'function') {
      pick.el.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const r = pick.el.getBoundingClientRect();
    return {
      found: true,
      __cdpComboboxOption: true,
      count: options.length,
      text: pick.text.slice(0, 120),
      x: Math.round(pick.offsetX + r.left + r.width / 2),
      y: Math.round(pick.offsetY + r.top + r.height / 2),
    };
  })()`;
}

function buildPrepareClearAndSelectExpression(selector) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const findDeep = (root, sel) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return direct;
      } catch { return null; }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) {
          const found = findDeep(node.shadowRoot, sel);
          if (found) return found;
        }
        if (node.tagName === 'IFRAME') {
          try { if (node.contentDocument) { const n = findDeep(node.contentDocument, sel); if (n) return n; } } catch {}
        }
      }
      return null;
    };
    const el = findDeep(document, selector);
    if (!el) return false;
    if (typeof el.focus === 'function') el.focus();
    if (el.getAttribute?.('contenteditable') === 'true') {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selObj = window.getSelection();
      if (selObj) { selObj.removeAllRanges(); selObj.addRange(range); }
      return true;
    }
    if (typeof el.select === 'function') {
      try { el.select(); } catch {}
    }
    return true;
  })()`;
}

function buildReadBackAndCommitFillExpression(selector, { dispatchChange = true } = {}) {
  return `(() => {
    const selector = ${JSON.stringify(String(selector))};
    const dispatchChange = ${JSON.stringify(Boolean(dispatchChange))};
    const findDeep = (root, sel) => {
      try {
        const direct = root.querySelector(sel);
        if (direct) return direct;
      } catch { return null; }
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if (node.shadowRoot) {
          const found = findDeep(node.shadowRoot, sel);
          if (found) return found;
        }
        if (node.tagName === 'IFRAME') {
          try { if (node.contentDocument) { const n = findDeep(node.contentDocument, sel); if (n) return n; } } catch {}
        }
      }
      return null;
    };
    const el = findDeep(document, selector);
    if (!el) return { found: false };
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.getAttribute?.('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : '')).toLowerCase();
    if (dispatchChange) {
      try {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      } catch {}
    }
    const isEditable = el.getAttribute?.('contenteditable') === 'true';
    const isCheck = type === 'checkbox' || type === 'radio';
    return {
      found: true,
      tag,
      type: isEditable ? 'contenteditable' : (type || tag),
      checked: isCheck ? Boolean(el.checked) : undefined,
      value: isCheck
        ? Boolean(el.checked)
        : type === 'password'
          ? '[REDACTED]'
          : isEditable
            ? String(el.textContent || '')
            : String(el.value || ''),
    };
  })()`;
}

export async function dispatchTrustedMouseClick(client, x, y, { timeoutMs = 5000 } = {}) {
  const cx = Math.round(Number(x));
  const cy = Math.round(Number(y));
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    throw new Error(`Invalid click coordinates (${x}, ${y}).`);
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: cx,
    y: cy,
    button: 'none',
    clickCount: 0,
  }, { timeoutMs });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: cx,
    y: cy,
    button: 'left',
    clickCount: 1,
  }, { timeoutMs });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: cx,
    y: cy,
    button: 'left',
    clickCount: 1,
  }, { timeoutMs });
  return { x: cx, y: cy };
}

export async function clickCdpSelector(client, selector, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const info = await evalInPage(client, buildInspectTargetForClickExpression(selector), { timeoutMs });
  if (isObj(info) && info.clicked === true && info.ok === true) {
    return info;
  }
  if (!isObj(info) || !info.ok) {
    return { ok: false, error: info?.error || `Element not found for selector: ${selector}` };
  }
  if (info.has_coords && Number.isFinite(info.x) && Number.isFinite(info.y)) {
    try {
      await dispatchTrustedMouseClick(client, info.x, info.y, { timeoutMs: Math.min(timeoutMs, 5000) });
      return {
        ok: true,
        clicked: true,
        trusted: true,
        method: info.resolved_via_label ? 'cdp_mouse_label' : 'cdp_mouse',
        selector,
        tag: info.tag,
        text: info.text,
        x: info.x,
        y: info.y,
        url_before: info.url_before,
      };
    } catch {
      // Fall through to synthetic JS click fallback
    }
  }
  const fallback = await evalInPage(client, buildClickExpression(selector), { timeoutMs });
  if (isObj(fallback) && fallback.ok) {
    return { ...fallback, trusted: false, method: 'js_click_fallback' };
  }
  return isObj(fallback) ? fallback : { ok: false, error: `Failed to click selector: ${selector}` };
}

export async function fillCdpSelector(client, selector, value, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  combobox = false,
  optionWaitMs = 450,
  sleepImpl = sleep,
} = {}) {
  const strValue = String(value ?? '');
  const info = await evalInPage(client, buildInspectTargetForFillExpression(selector), { timeoutMs });
  if (isObj(info) && info.filled === true && info.ok === true) {
    return info;
  }
  if (!isObj(info) || !info.ok) {
    return { ok: false, error: info?.error || `Element not found for selector: ${selector}` };
  }

  // 1. <select>: match by option.value OR trimmed case-insensitive option.textContent via native setter + input/change
  if (info.tag === 'select') {
    const selRes = await evalInPage(client, buildFillExpression(selector, strValue), { timeoutMs });
    if (isObj(selRes) && selRes.ok) {
      return { ...selRes, method: 'select_native_setter' };
    }
    return isObj(selRes) ? selRes : { ok: false, error: `Failed to select option for: ${selector}` };
  }

  // 2. Radio / checkbox: trusted CDP click on input or resolved <label>
  if (info.type === 'checkbox' || info.type === 'radio') {
    const wantChecked = /^(?:true|1|yes|on|checked)$/i.test(strValue.trim());
    if (Boolean(info.checked) !== wantChecked && info.has_coords && Number.isFinite(info.x) && Number.isFinite(info.y)) {
      try {
        await dispatchTrustedMouseClick(client, info.x, info.y, { timeoutMs: Math.min(timeoutMs, 5000) });
        const rb = await evalInPage(client, buildReadBackAndCommitFillExpression(selector, { dispatchChange: false }), { timeoutMs: 4000 });
        if (rb?.found && Boolean(rb.checked) === wantChecked) {
          return {
            ok: true,
            filled: true,
            trusted: true,
            method: info.resolved_via_label ? 'cdp_mouse_label' : 'cdp_mouse',
            selector,
            tag: info.tag,
            type: info.type,
            read_back_value: Boolean(rb.checked),
          };
        }
      } catch {
        // Fall through to JS fallback below
      }
    }
    const jsCheck = await evalInPage(client, buildFillExpression(selector, strValue), { timeoutMs });
    return isObj(jsCheck) ? jsCheck : { ok: false, error: `Failed to set ${info.type}: ${selector}` };
  }

  // 2.5. Combobox / Typeahead (role="combobox", aria-autocomplete, React-Select, LinkedIn Location/Skills)
  const isCombobox = Boolean(combobox || info.is_combobox);
  if (isCombobox && info.has_coords && Number.isFinite(info.x) && Number.isFinite(info.y)) {
    try {
      await dispatchTrustedMouseClick(client, info.x, info.y, { timeoutMs: Math.min(timeoutMs, 5000) });
      await evalInPage(client, buildPrepareClearAndSelectExpression(selector), { timeoutMs: 4000 }).catch(() => {});
      const selectAllMod = platform === 'darwin' ? 4 : 2;
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        modifiers: selectAllMod,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: selectAllMod,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      }, { timeoutMs: 3000 }).catch(() => {});

      if (strValue.length > 0) {
        await client.send('Input.insertText', { text: strValue }, { timeoutMs: Math.min(timeoutMs, 8000) });
      }
      if (optionWaitMs > 0) {
        await sleepImpl(optionWaitMs);
      }

      const opt = await evalInPage(client, buildFindComboboxOptionExpression(strValue), { timeoutMs: 4000 }).catch(() => null);
      let selectionMethod = 'cdp_combobox_enter';
      let selectedOptionText = null;
      if (opt?.found && Number.isFinite(opt.x) && Number.isFinite(opt.y)) {
        await dispatchTrustedMouseClick(client, opt.x, opt.y, { timeoutMs: Math.min(timeoutMs, 5000) });
        selectionMethod = 'cdp_combobox_option';
        selectedOptionText = opt.text || strValue;
      } else {
        await client.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
        }, { timeoutMs: 3000 }).catch(() => {});
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
        }, { timeoutMs: 3000 }).catch(() => {});
        await client.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
        }, { timeoutMs: 3000 }).catch(() => {});
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
        }, { timeoutMs: 3000 }).catch(() => {});
      }

      const rb = await evalInPage(client, buildReadBackAndCommitFillExpression(selector, { dispatchChange: false }), { timeoutMs: 4000 }).catch(() => null);
      const readBackVal = rb?.found ? String(rb.value || '') : (selectedOptionText || strValue);
      if (readBackVal.length > 0 || strValue.length === 0) {
        return {
          ok: true,
          filled: true,
          trusted: true,
          combobox: true,
          method: selectionMethod,
          selector,
          tag: info.tag,
          type: 'combobox',
          selected_option: selectedOptionText,
          read_back_value: readBackVal,
        };
      }
    } catch {
      // Fall through to standard text/native-setter path
    }
  }

  // 3. Text / number / email / textarea / contenteditable: trusted CDP focus click + clear + Input.insertText
  if (info.has_coords && Number.isFinite(info.x) && Number.isFinite(info.y)) {
    try {
      await dispatchTrustedMouseClick(client, info.x, info.y, { timeoutMs: Math.min(timeoutMs, 5000) });
      await evalInPage(client, buildPrepareClearAndSelectExpression(selector), { timeoutMs: 4000 }).catch(() => {});
      const selectAllMod = platform === 'darwin' ? 4 : 2; // 4 = Meta (Cmd), 2 = Ctrl
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        modifiers: selectAllMod,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: selectAllMod,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      }, { timeoutMs: 3000 }).catch(() => {});
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      }, { timeoutMs: 3000 }).catch(() => {});

      if (strValue.length > 0) {
        await client.send('Input.insertText', { text: strValue }, { timeoutMs: Math.min(timeoutMs, 8000) });
      }
      const rb = await evalInPage(client, buildReadBackAndCommitFillExpression(selector, { dispatchChange: true }), { timeoutMs: 4000 });
      const expectedReadBack = info.type === 'password' ? '[REDACTED]' : strValue;
      if (rb?.found && rb.value === expectedReadBack) {
        return {
          ok: true,
          filled: true,
          trusted: true,
          method: 'cdp_insert_text',
          selector,
          tag: info.tag,
          type: info.type,
          read_back_value: rb.value,
        };
      }
    } catch {
      // Fall through to native-setter fallback below
    }
  }

  const fallback = await evalInPage(client, buildFillExpression(selector, strValue), { timeoutMs });
  if (isObj(fallback) && fallback.ok) {
    return { ...fallback, trusted: false, method: 'native_setter_fallback' };
  }
  return isObj(fallback) ? fallback : { ok: false, error: `Failed to fill selector: ${selector}` };
}

export function parseCdpArgs(argv = [], { defaultJson = false } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {
    subcommand: null,
    positionals: [],
    port: DEFAULT_CDP_PORT,
    portExplicit: false,
    maxChars: DEFAULT_MAX_CHARS,
    targetId: null,
    urlMatch: null,
    trigger: null,
    combobox: false,
    jitterMinMs: null,
    jitterMaxMs: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    newTab: false,
    noLaunch: false,
    json: Boolean(defaultJson),
    help: false,
    error: null,
  };

  let passthrough = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (passthrough) {
      parsed.positionals.push(a);
      continue;
    }
    if (a === '--') {
      passthrough = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      parsed.help = true;
      continue;
    }
    if (a === '--json') {
      parsed.json = true;
      continue;
    }
    if (a === '--new-tab') {
      parsed.newTab = true;
      continue;
    }
    if (a === '--no-launch') {
      parsed.noLaunch = true;
      continue;
    }
    if (a === '--combobox') {
      parsed.combobox = true;
      continue;
    }
    if (a === '--url-match') {
      const next = args[++i];
      if (!next || next.startsWith('-')) {
        parsed.error = '--url-match requires a URL substring.';
        return parsed;
      }
      parsed.urlMatch = next;
      continue;
    }
    if (a.startsWith('--url-match=')) {
      const val = a.slice(12);
      if (!val) {
        parsed.error = '--url-match= requires a URL substring.';
        return parsed;
      }
      parsed.urlMatch = val;
      continue;
    }
    if (a === '--jitter-min') {
      const next = args[++i];
      const n = next !== undefined && /^\d+$/.test(next) ? Number(next) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 120000) {
        parsed.error = '--jitter-min requires an integer between 0 and 120000 ms.';
        return parsed;
      }
      parsed.jitterMinMs = n;
      continue;
    }
    if (a.startsWith('--jitter-min=')) {
      const raw = a.slice(13);
      const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 120000) {
        parsed.error = '--jitter-min= requires an integer between 0 and 120000 ms.';
        return parsed;
      }
      parsed.jitterMinMs = n;
      continue;
    }
    if (a === '--jitter-max') {
      const next = args[++i];
      const n = next !== undefined && /^\d+$/.test(next) ? Number(next) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 120000) {
        parsed.error = '--jitter-max requires an integer between 0 and 120000 ms.';
        return parsed;
      }
      parsed.jitterMaxMs = n;
      continue;
    }
    if (a.startsWith('--jitter-max=')) {
      const raw = a.slice(13);
      const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > 120000) {
        parsed.error = '--jitter-max= requires an integer between 0 and 120000 ms.';
        return parsed;
      }
      parsed.jitterMaxMs = n;
      continue;
    }
    if (a === '--port') {
      const next = args[++i];
      try {
        parsed.port = validateCdpPort(next);
        parsed.portExplicit = true;
      } catch (err) {
        parsed.error = err.message;
        return parsed;
      }
      continue;
    }
    if (a.startsWith('--port=')) {
      try {
        parsed.port = validateCdpPort(a.slice(7));
        parsed.portExplicit = true;
      } catch (err) {
        parsed.error = err.message;
        return parsed;
      }
      continue;
    }
    if (a === '--max-chars') {
      const next = args[++i];
      const n = next !== undefined && /^\d+$/.test(next) ? Number(next) : NaN;
      if (!Number.isInteger(n) || n < 500 || n > 100000) {
        parsed.error = '--max-chars requires an integer between 500 and 100000.';
        return parsed;
      }
      parsed.maxChars = n;
      continue;
    }
    if (a.startsWith('--max-chars=')) {
      const raw = a.slice(12);
      const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 500 || n > 100000) {
        parsed.error = '--max-chars= requires an integer between 500 and 100000.';
        return parsed;
      }
      parsed.maxChars = n;
      continue;
    }
    if (a === '--target') {
      const next = args[++i];
      if (!next || next.startsWith('-')) {
        parsed.error = '--target requires a CDP target ID.';
        return parsed;
      }
      parsed.targetId = next;
      continue;
    }
    if (a.startsWith('--target=')) {
      const val = a.slice(9);
      if (!val) {
        parsed.error = '--target= requires a CDP target ID.';
        return parsed;
      }
      parsed.targetId = val;
      continue;
    }
    if (a === '--trigger') {
      const next = args[++i];
      if (!next || next.startsWith('-')) {
        parsed.error = '--trigger requires a CSS selector for the upload trigger button.';
        return parsed;
      }
      parsed.trigger = next;
      continue;
    }
    if (a.startsWith('--trigger=')) {
      const val = a.slice(10);
      if (!val) {
        parsed.error = '--trigger= requires a CSS selector for the upload trigger button.';
        return parsed;
      }
      parsed.trigger = val;
      continue;
    }
    if (a === '--timeout') {
      const next = args[++i];
      const n = next !== undefined && /^\d+$/.test(next) ? Number(next) : NaN;
      if (!Number.isInteger(n) || n < 500 || n > 120000) {
        parsed.error = '--timeout requires an integer between 500 and 120000 ms.';
        return parsed;
      }
      parsed.timeoutMs = n;
      continue;
    }
    if (a.startsWith('--timeout=')) {
      const raw = a.slice(10);
      const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 500 || n > 120000) {
        parsed.error = '--timeout= requires an integer between 500 and 120000 ms.';
        return parsed;
      }
      parsed.timeoutMs = n;
      continue;
    }

    // Allow negative numbers or JS expressions starting with '-' as values for eval or fill value
    const allowDashValue =
      (parsed.subcommand === 'eval' && parsed.positionals.length === 0)
      || (parsed.subcommand === 'fill' && parsed.positionals.length === 1);
    if (a.startsWith('-') && !allowDashValue) {
      parsed.error = `Unknown option for \`veycraft cdp\`: ${a}. Run \`veycraft cdp --help\` for usage.`;
      return parsed;
    }

    if (!parsed.subcommand) {
      parsed.subcommand = a.toLowerCase();
    } else {
      parsed.positionals.push(a);
    }
  }

  if (parsed.help || !parsed.subcommand) {
    parsed.subcommand = 'help';
    return parsed;
  }

  if (!CDP_SUBCOMMANDS.includes(parsed.subcommand)) {
    parsed.error = `Unknown cdp subcommand "${parsed.subcommand}". Supported: ${CDP_SUBCOMMANDS.filter(s => s !== 'help').join(', ')}.`;
    return parsed;
  }

  if (parsed.subcommand === 'open' && !parsed.positionals[0]) {
    parsed.error = 'Usage: veycraft cdp open <url> [--port <n>] [--new-tab] [--target <id>] [--json]';
  } else if (parsed.subcommand === 'eval' && !parsed.positionals[0]) {
    parsed.error = 'Usage: veycraft cdp eval <js> [--port <n>] [--target <id>] [--json]';
  } else if (parsed.subcommand === 'click' && !parsed.positionals[0]) {
    parsed.error = 'Usage: veycraft cdp click <selector> [--port <n>] [--target <id>] [--json]';
  } else if (parsed.subcommand === 'fill' && (parsed.positionals.length < 2)) {
    parsed.error = 'Usage: veycraft cdp fill <selector> <value> [--port <n>] [--target <id>] [--json]';
  } else if (parsed.subcommand === 'upload' && (parsed.trigger ? parsed.positionals.length < 1 : parsed.positionals.length < 2)) {
    parsed.error = 'Usage: veycraft cdp upload <selector> <filePath> [--trigger <buttonSelector>] [--port <n>] [--target <id>] [--json]';
  }

  if (parsed.jitterMinMs !== null && parsed.jitterMaxMs !== null && parsed.jitterMinMs > parsed.jitterMaxMs) {
    parsed.error = '--jitter-min cannot exceed --jitter-max.';
    return parsed;
  }

  return parsed;
}

export function getCdpHelpLines() {
  return [
    'Veycraft Native Chrome DevTools Protocol (CDP) CLI (Zero-Dependency · 127.0.0.1 only):',
    '  veycraft cdp status [--port 9222] [--no-launch] [--json]               Ensure Chrome CDP is running & list open tabs',
    '  veycraft cdp login [url] [--port 9222] [--new-tab] [--json]            Reset stale CDP, launch Chrome directly for one-time sign-in (default: LinkedIn login)',
    '  veycraft cdp close [--port 9222] [--json]                              Cleanly shut down active CDP Chrome (Browser.close) & unlock workspace/.chrome-profile',
    '  veycraft cdp open <url> [--port 9222] [--new-tab] [--target <id>] [--url-match <s>] [--jitter-min <ms> --jitter-max <ms>] [--json]',
    '  veycraft cdp snapshot [--max-chars 12000] [--port 9222] [--target <id>] [--url-match <s>] [--json] Extract clean visible text, links & interactive fields',
    '  veycraft cdp eval <js> [--port 9222] [--target <id>] [--url-match <s>] [--json] Evaluate JS expression on active tab & return serialized result',
    '  veycraft cdp click <selector> [--port 9222] [--target <id>] [--url-match <s>] [--jitter-min <ms> --jitter-max <ms>] [--json] Trusted mouse click + new-tab detection',
    '  veycraft cdp fill <selector> <value> [--combobox] [--port 9222] [--target <id>] [--url-match <s>] [--jitter-min <ms> --jitter-max <ms>] [--json]',
    '  veycraft cdp upload <selector> <filePath> [--trigger <btnSel>] [--port 9222] [--target <id>] [--url-match <s>] [--json] Attach local file via DOM.setFileInputFiles or File Chooser Interception',
    '',
    'Profile persistence: workspace/.chrome-profile/ (gitignored & excluded from npm pack).',
    'Requirements: Node.js >= 22 (built-in WebSocket) and local Chrome, Chromium, or Microsoft Edge.',
  ];
}

async function connectToActiveTarget({
  root,
  port,
  portExplicit = false,
  initialUrl = 'about:blank',
  targetId,
  urlMatch = null,
  newTab = false,
  noLaunch = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  launchTimeoutMs = 15000,
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  httpRequestImpl = httpRequestLocalCdp,
  WebSocketImpl = globalThis.WebSocket,
  detectBrowserImpl = detectHeadlessBrowser,
  spawnImpl = spawn,
  isPortAvailableImpl = isLocalPortAvailable,
}) {
  const chrome = await ensureCdpChrome({
    root,
    port,
    portExplicit,
    initialUrl,
    home,
    env,
    platform,
    launch: !noLaunch,
    launchTimeoutMs,
    httpRequestImpl,
    detectBrowserImpl,
    spawnImpl,
    isPortAvailableImpl,
  });
  const activePort = chrome.port;

  let target = null;
  if (newTab) {
    target = await createCdpBlankTab(activePort, { httpRequestImpl });
  } else {
    const targets = await fetchCdpJson(activePort, '/json/list', { timeoutMs: 4000, httpRequestImpl });
    target = selectCdpTarget(targets, { targetId, urlMatch, port: activePort });
    if (!target) {
      if (targetId) {
        throw new Error(`No CDP page target found matching --target "${targetId}" on ${CDP_HOST}:${activePort}.`);
      }
      target = await createCdpBlankTab(activePort, { httpRequestImpl });
    }
  }

  if (!target || typeof target.webSocketDebuggerUrl !== 'string') {
    throw new Error(`CDP target on ${CDP_HOST}:${activePort} did not return a valid webSocketDebuggerUrl.`);
  }

  const client = new CdpClient(target.webSocketDebuggerUrl, {
    port: activePort,
    WebSocketImpl,
    defaultTimeoutMs: timeoutMs,
  });
  await client.connect();
  return { chrome, target, client };
}

export async function runCdpCli(root, argv = [], {
  defaultJson = false,
  home = os.homedir(),
  cwd = process.cwd(),
  source = root,
  env = process.env,
  platform = process.platform,
  nodeVersion = process.versions.node,
  WebSocketImpl = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  httpRequestImpl = httpRequestLocalCdp,
  detectBrowserImpl = detectHeadlessBrowser,
  spawnImpl = spawn,
  isPortAvailableImpl = isLocalPortAvailable,
} = {}) {
  const parsed = parseCdpArgs(argv, { defaultJson });
  if (parsed.error) {
    return {
      exitCode: 1,
      json: parsed.json,
      data: { ok: false, error: parsed.error },
      lines: [parsed.error],
    };
  }

  if (parsed.subcommand === 'help') {
    const lines = getCdpHelpLines();
    return {
      exitCode: 0,
      json: parsed.json,
      data: { ok: true, subcommands: CDP_SUBCOMMANDS.filter(s => s !== 'help'), usage: lines },
      lines,
    };
  }

  const runtime = checkCdpRuntimeSupport({ nodeVersion, WebSocketImpl, fetchImpl });
  if (!runtime.ok) {
    return {
      exitCode: 1,
      json: parsed.json,
      data: { ok: false, error: runtime.error, node_version: runtime.node_version, required_node_major: MIN_CDP_NODE_MAJOR },
      lines: [runtime.error],
    };
  }

  const { port, portExplicit, targetId, urlMatch, trigger, combobox, jitterMinMs, jitterMaxMs, timeoutMs, maxChars, newTab, noLaunch } = parsed;
  const applyOptionalJitter = async () => {
    if (jitterMinMs === null && jitterMaxMs === null) return null;
    const min = jitterMinMs ?? jitterMaxMs ?? 0;
    const max = jitterMaxMs ?? jitterMinMs ?? min;
    return sleepHumanJitter(min, max);
  };

  if (parsed.subcommand === 'close') {
    const closeRes = await closeCdpBrowser({
      root,
      port,
      portExplicit,
      home,
      timeoutMs: Math.min(timeoutMs, 3000),
      httpRequestImpl,
      WebSocketImpl,
      isPortAvailableImpl,
    });
    const lines = closeRes.already_stopped
      ? [`No active CDP Chrome found on ${CDP_HOST}:${closeRes.port} (profile already unlocked).`]
      : [`Closed CDP Chrome on ${CDP_HOST}:${closeRes.port} (port_released=${closeRes.port_released}) — workspace/.chrome-profile unlocked.`];
    return { exitCode: 0, json: parsed.json, data: closeRes, lines };
  }

  if (parsed.subcommand === 'status') {
    const chrome = await ensureCdpChrome({
      root,
      port,
      portExplicit,
      home,
      env,
      platform,
      launch: !noLaunch,
      httpRequestImpl,
      detectBrowserImpl,
      spawnImpl,
    });
    const activePort = chrome.port;
    const rawTargets = await fetchCdpJson(activePort, '/json/list', { timeoutMs: 4000, httpRequestImpl });
    const pageTargets = (Array.isArray(rawTargets) ? rawTargets : []).filter(t => isObj(t) && t.type === 'page');
    const active = selectCdpTarget(pageTargets, { targetId, port: activePort });
    const tabs = pageTargets.map((t, idx) => ({
      index: idx + 1,
      id: t.id || null,
      title: String(t.title || ''),
      url: String(t.url || ''),
      active: Boolean(active && t.id === active.id),
    }));
    const data = {
      ok: true,
      connected: true,
      launched: chrome.launched,
      host: CDP_HOST,
      port: activePort,
      browser: chrome.version?.Browser || 'Chromium',
      protocol_version: chrome.version?.['Protocol-Version'] || null,
      profile_dir: chrome.profile_dir,
      tabs_count: tabs.length,
      tabs,
    };
    const lines = [
      `CDP Connected: http://${CDP_HOST}:${activePort} (${data.browser}${chrome.launched ? ' · auto-launched' : ' · attached'})`,
      `Profile Dir:   ${data.profile_dir}`,
      `Open Tabs:     ${tabs.length}`,
      ...tabs.map(t => `  ${t.active ? '*' : ' '} [${t.index}] ${t.title || '(untitled)'} — ${t.url} (id=${t.id})`),
    ];
    return { exitCode: 0, json: parsed.json, data, lines };
  }

  if (parsed.subcommand === 'open' || parsed.subcommand === 'login') {
    const isLogin = parsed.subcommand === 'login';
    const rawUrl = parsed.positionals[0] || (isLogin ? DEFAULT_LOGIN_URL : '');
    const safeUrl = validateNavigationUrl(rawUrl, { cdpPort: port });

    // In `cdp login`, close any stale/hidden CDP instance on that port first so Chrome launches fresh with a clean window.
    let closedStale = false;
    if (isLogin && !noLaunch) {
      const closeRes = await closeCdpBrowser({
        root,
        port,
        portExplicit,
        home,
        timeoutMs: 3000,
        httpRequestImpl,
        WebSocketImpl,
        isPortAvailableImpl,
      }).catch(() => null);
      closedStale = Boolean(closeRes?.closed);
    }

    let conn;
    try {
      await applyOptionalJitter();
      conn = await connectToActiveTarget({
        root,
        port,
        portExplicit,
        initialUrl: safeUrl,
        targetId,
        urlMatch,
        newTab,
        noLaunch,
        timeoutMs,
        launchTimeoutMs: Math.min(timeoutMs, 15000),
        home,
        env,
        platform,
        httpRequestImpl,
        WebSocketImpl,
        detectBrowserImpl,
        spawnImpl,
        isPortAvailableImpl,
      });
    } catch (err) {
      if (isLogin) {
        const profileDir = resolveChromeProfileDir(root, { home });
        const detectedBin = detectBrowserImpl({ platform, env, home });
        const fallbackCommand = err?.fallbackCommand || buildLoginFallbackCommand({
          binary: detectedBin,
          port: err?.port || port,
          profileDir: err?.profileDir || profileDir,
          url: safeUrl,
          platform,
        });
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          exitCode: 1,
          json: parsed.json,
          data: {
            ok: false,
            mode: 'login',
            error: errMsg,
            port: err?.port || port,
            profile_dir: err?.profileDir || profileDir,
            fallbackCommand,
          },
          lines: [
            errMsg,
            `Run this directly in your normal OS terminal, sign in once, and reply "done":`,
            `  ${fallbackCommand}`,
          ],
        };
      }
      throw err;
    }

    const { chrome, target, client } = conn;
    try {
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      const loadPromise = client.waitForEvent('Page.loadEventFired', { timeoutMs }).catch(() => null);
      const nav = await client.send('Page.navigate', { url: safeUrl }, { timeoutMs });
      if (nav?.errorText) {
        throw new Error(`Navigation to "${safeUrl}" failed: ${nav.errorText}`);
      }
      await loadPromise;
      await sleep(250);
      const windowSurface = await surfaceCdpWindow(client, target.id, { timeoutMs: Math.min(timeoutMs, 4000) });
      const info = await evalInPage(
        client,
        '({ url: String(window.location.href || ""), title: String(document.title || "").trim() })',
        { timeoutMs: Math.min(timeoutMs, 8000) },
      );
      const fallbackCommand = isLogin
        ? buildLoginFallbackCommand({
            binary: chrome.binary || detectBrowserImpl({ platform, env, home }),
            port: chrome.port,
            profileDir: chrome.profile_dir,
            url: safeUrl,
            platform,
          })
        : null;
      const data = {
        ok: true,
        mode: isLogin ? 'login' : 'open',
        port: chrome.port,
        launched: chrome.launched,
        closed_stale: closedStale,
        profile_dir: chrome.profile_dir,
        target_id: target.id || null,
        url: info?.url || safeUrl,
        title: info?.title || '',
        navigated_to: safeUrl,
        window_surfaced: true,
        window_id: windowSurface.window_id,
        bounds_applied: windowSurface.bounds_applied,
        ...(fallbackCommand ? { fallbackCommand } : {}),
      };
      return {
        exitCode: 0,
        json: parsed.json,
        data,
        lines: [
          `${isLogin ? 'Login window ready' : 'Opened'}: ${data.url}`,
          `Title:  ${data.title || '(untitled)'}`,
          `Target: ${data.target_id || 'default'} (http://${CDP_HOST}:${chrome.port})`,
        ],
      };
    } finally {
      await client.close();
    }
  }

  if (parsed.subcommand === 'snapshot') {
    const { target, client } = await connectToActiveTarget({
      root,
      port,
      portExplicit,
      targetId,
      urlMatch,
      noLaunch,
      timeoutMs,
      home,
      env,
      platform,
      httpRequestImpl,
      WebSocketImpl,
      detectBrowserImpl,
      spawnImpl,
    });
    try {
      await client.send('Runtime.enable');
      const snap = await evalInPage(client, buildSnapshotExpression(maxChars), { timeoutMs });
      const data = {
        ...(isObj(snap) ? snap : { ok: true, text: '' }),
        target_id: target.id || null,
      };
      const lines = [
        `URL:    ${data.url || ''}`,
        `Title:  ${data.title || '(untitled)'}`,
        `Stats:  ${data.total_chars || 0} chars${data.truncated ? ` (truncated to ${maxChars})` : ''} · ${data.links_count || 0} links · ${data.fields_count || 0} fields · ${data.buttons_count || 0} buttons`,
        ...(data.auth_or_challenge_detected ? [`Warning: auth_or_challenge_detected=${data.auth_or_challenge_detected}`] : []),
        '',
        data.text || '',
      ];
      return { exitCode: 0, json: parsed.json, data, lines };
    } finally {
      await client.close();
    }
  }

  if (parsed.subcommand === 'eval') {
    const jsExpr = parsed.positionals.join(' ');
    const { target, client } = await connectToActiveTarget({
      root,
      port,
      portExplicit,
      targetId,
      urlMatch,
      noLaunch,
      timeoutMs,
      home,
      env,
      platform,
      httpRequestImpl,
      WebSocketImpl,
      detectBrowserImpl,
      spawnImpl,
    });
    try {
      await client.send('Runtime.enable');
      const result = await evalInPage(client, jsExpr, { timeoutMs });
      const data = {
        ok: true,
        target_id: target.id || null,
        result: result === undefined ? null : result,
      };
      return {
        exitCode: 0,
        json: parsed.json,
        data,
        lines: [typeof result === 'string' ? result : JSON.stringify(result, null, 2)],
      };
    } finally {
      await client.close();
    }
  }

  if (parsed.subcommand === 'click') {
    const selector = parsed.positionals[0];
    const jitter = await applyOptionalJitter();
    const { chrome, target, client } = await connectToActiveTarget({
      root,
      port,
      portExplicit,
      targetId,
      urlMatch,
      noLaunch,
      timeoutMs,
      home,
      env,
      platform,
      httpRequestImpl,
      WebSocketImpl,
      detectBrowserImpl,
      spawnImpl,
    });
    try {
      await client.send('Runtime.enable');
      const beforeTargets = await fetchCdpJson(chrome.port, '/json/list', { timeoutMs: 2500, httpRequestImpl }).catch(() => []);
      const res = await clickCdpSelector(client, selector, { timeoutMs });
      if (!isObj(res) || !res.ok) {
        const errMsg = res?.error || `Failed to click selector "${selector}".`;
        return {
          exitCode: 1,
          json: parsed.json,
          data: { ok: false, target_id: target.id || null, selector, error: errMsg },
          lines: [errMsg],
        };
      }
      await sleep(200);
      const afterTargets = await fetchCdpJson(chrome.port, '/json/list', { timeoutMs: 2500, httpRequestImpl }).catch(() => []);
      const newTabTarget = detectNewCdpTarget(beforeTargets, afterTargets, { port: chrome.port });
      const urlAfter = await evalInPage(client, 'String(window.location.href || "")', { timeoutMs: 5000 }).catch(() => res.url_before);
      const data = {
        ...res,
        target_id: target.id || null,
        url_after: urlAfter,
        ...(newTabTarget ? { new_tab_target_id: newTabTarget.id || null, new_tab_url: newTabTarget.url || '' } : {}),
        ...(jitter ? { jitter_delay_ms: jitter.delay_ms } : {}),
      };
      return {
        exitCode: 0,
        json: parsed.json,
        data,
        lines: [
          `Clicked <${data.tag}> (${selector})${data.text ? ` "${data.text}"` : ''}`,
          ...(newTabTarget ? [`New tab opened: ${newTabTarget.url || '(loading)'} (--target ${newTabTarget.id})`] : []),
        ],
      };
    } finally {
      await client.close();
    }
  }

  if (parsed.subcommand === 'fill') {
    const selector = parsed.positionals[0];
    const value = parsed.positionals.slice(1).join(' ');
    const jitter = await applyOptionalJitter();
    const { target, client } = await connectToActiveTarget({
      root,
      port,
      portExplicit,
      targetId,
      urlMatch,
      noLaunch,
      timeoutMs,
      home,
      env,
      platform,
      httpRequestImpl,
      WebSocketImpl,
      detectBrowserImpl,
      spawnImpl,
    });
    try {
      await client.send('Runtime.enable');
      const res = await fillCdpSelector(client, selector, value, { timeoutMs, platform, combobox });
      if (!isObj(res) || !res.ok) {
        const errMsg = res?.error || `Failed to fill selector "${selector}".`;
        return {
          exitCode: 1,
          json: parsed.json,
          data: { ok: false, target_id: target.id || null, selector, error: errMsg, ...(res?.available_options ? { available_options: res.available_options } : {}) },
          lines: [errMsg],
        };
      }
      const data = {
        ...res,
        target_id: target.id || null,
        ...(jitter ? { jitter_delay_ms: jitter.delay_ms } : {}),
      };
      return {
        exitCode: 0,
        json: parsed.json,
        data,
        lines: [`Filled <${data.tag}> (${selector}) -> read-back: ${JSON.stringify(data.read_back_value)}`],
      };
    } finally {
      await client.close();
    }
  }

  if (parsed.subcommand === 'upload') {
    const hasExplicitTrigger = Boolean(trigger);
    const selector = hasExplicitTrigger && parsed.positionals.length === 1 ? null : parsed.positionals[0];
    const rawFilePath = hasExplicitTrigger && parsed.positionals.length === 1
      ? parsed.positionals[0]
      : parsed.positionals.slice(1).join(' ');
    const validatedFile = validateLocalUploadPath(rawFilePath, { root, source, home, cwd });
    await applyOptionalJitter();
    const { target, client } = await connectToActiveTarget({
      root,
      port,
      portExplicit,
      targetId,
      urlMatch,
      noLaunch,
      timeoutMs,
      home,
      env,
      platform,
      httpRequestImpl,
      WebSocketImpl,
      detectBrowserImpl,
      spawnImpl,
      isPortAvailableImpl,
    });

    const runFileChooserInterception = async (triggerSelector) => {
      await client.send('Page.enable', {}, { timeoutMs });
      await client.send('DOM.enable', {}, { timeoutMs });
      await client.send('Runtime.enable', {}, { timeoutMs });
      await client.send('Page.setInterceptFileChooserDialog', { enabled: true }, { timeoutMs });
      try {
        const chooserPromise = client.waitForEvent('Page.fileChooserOpened', {
          timeoutMs: Math.min(timeoutMs, 10000),
        });
        const clickRes = await clickCdpSelector(client, triggerSelector, { timeoutMs });
        if (!isObj(clickRes) || !clickRes.ok) {
          chooserPromise.catch(() => {});
          const errMsg = clickRes?.error || `Upload trigger element not found for selector: ${triggerSelector}`;
          return {
            exitCode: 1,
            json: parsed.json,
            data: { ok: false, target_id: target.id || null, selector: selector || triggerSelector, trigger: triggerSelector, error: errMsg },
            lines: [errMsg],
          };
        }
        const chooserEvt = await chooserPromise;
        const chooserBackendNodeId = chooserEvt?.backendNodeId;
        if (!Number.isInteger(chooserBackendNodeId) || chooserBackendNodeId <= 0) {
          const errMsg = `Page.fileChooserOpened did not provide a valid backendNodeId for trigger: ${triggerSelector}`;
          return {
            exitCode: 1,
            json: parsed.json,
            data: { ok: false, target_id: target.id || null, selector: selector || triggerSelector, trigger: triggerSelector, error: errMsg },
            lines: [errMsg],
          };
        }
        await client.send('DOM.setFileInputFiles', {
          backendNodeId: chooserBackendNodeId,
          files: [validatedFile.resolved],
        }, { timeoutMs });
        const data = {
          ok: true,
          uploaded: true,
          method: 'file_chooser_interception',
          target_id: target.id || null,
          selector: selector || triggerSelector,
          trigger: triggerSelector,
          backend_node_id: chooserBackendNodeId,
          file_path: validatedFile.resolved,
          filename: validatedFile.basename,
          size_bytes: validatedFile.size,
          attached_files: [validatedFile.basename],
        };
        return {
          exitCode: 0,
          json: parsed.json,
          data,
          lines: [`Uploaded "${data.filename}" (${data.size_bytes} bytes) via CDP file chooser interception -> ${triggerSelector}`],
        };
      } finally {
        await client.send('Page.setInterceptFileChooserDialog', { enabled: false }, { timeoutMs: 3000 }).catch(() => {});
      }
    };

    try {
      // Explicit --trigger without a separate <input type="file"> selector goes straight to File Chooser Interception.
      if (hasExplicitTrigger && !selector) {
        return await runFileChooserInterception(trigger);
      }

      await client.send('DOM.enable', {}, { timeoutMs });
      await client.send('Runtime.enable', {}, { timeoutMs });

      const doc = await client.send('DOM.getDocument', { depth: -1, pierce: true }, { timeoutMs });
      const rootNodeId = doc?.root?.nodeId;
      let nodeId = 0;
      let backendNodeId = null;

      if (Number.isInteger(rootNodeId) && rootNodeId > 0) {
        const queried = await client.send('DOM.querySelector', { nodeId: rootNodeId, selector }, { timeoutMs }).catch(() => null);
        if (Number.isInteger(queried?.nodeId) && queried.nodeId > 0) {
          nodeId = queried.nodeId;
        }
      }

      // Deep discovery fallback: light DOM + open Shadow DOM + same-origin iframes
      if (!nodeId) {
        const deepEval = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const sel = ${JSON.stringify(String(selector))};
            const findDeep = (rootNode) => {
              try {
                const direct = rootNode.querySelector(sel);
                if (direct) return direct;
              } catch { return null; }
              for (const el of Array.from(rootNode.querySelectorAll('*'))) {
                if (el.shadowRoot) {
                  const nested = findDeep(el.shadowRoot);
                  if (nested) return nested;
                }
                if (el.tagName === 'IFRAME') {
                  try {
                    if (el.contentDocument) {
                      const inFrame = findDeep(el.contentDocument);
                      if (inFrame) return inFrame;
                    }
                  } catch { /* cross-origin iframe */ }
                }
              }
              return null;
            };
            return findDeep(document);
          })()`,
          returnByValue: false,
        }, { timeoutMs });
        const objectId = deepEval?.result?.objectId;
        if (objectId) {
          const requested = await client.send('DOM.requestNode', { objectId }, { timeoutMs }).catch(() => null);
          if (Number.isInteger(requested?.nodeId) && requested.nodeId > 0) {
            nodeId = requested.nodeId;
          } else {
            const described = await client.send('DOM.describeNode', { objectId }, { timeoutMs }).catch(() => null);
            if (Number.isInteger(described?.node?.backendNodeId) && described.node.backendNodeId > 0) {
              backendNodeId = described.node.backendNodeId;
            }
          }
        }
      }

      // If no <input type="file"> matched directly, fall back to CDP File Chooser Interception when --trigger is set.
      if (!nodeId && !backendNodeId) {
        if (hasExplicitTrigger) {
          return await runFileChooserInterception(trigger);
        }
        const errMsg = `File input element not found for selector: ${selector}`;
        return {
          exitCode: 1,
          json: parsed.json,
          data: { ok: false, target_id: target.id || null, selector, error: errMsg },
          lines: [errMsg],
        };
      }

      const setFilesParams = nodeId
        ? { nodeId, files: [validatedFile.resolved] }
        : { backendNodeId, files: [validatedFile.resolved] };
      try {
        await client.send('DOM.setFileInputFiles', setFilesParams, { timeoutMs });
      } catch (setErr) {
        // Auto-fallback when <selector> matched a trigger button/label instead of <input type="file">
        const triggerTarget = hasExplicitTrigger ? trigger : selector;
        if (/not a file input|file input|invalid node/i.test(String(setErr?.message || '')) || hasExplicitTrigger) {
          return await runFileChooserInterception(triggerTarget);
        }
        throw setErr;
      }

      const readBack = await evalInPage(client, `(() => {
        const sel = ${JSON.stringify(String(selector))};
        const findDeep = (rootNode) => {
          try {
            const direct = rootNode.querySelector(sel);
            if (direct) return direct;
          } catch { return null; }
          for (const el of Array.from(rootNode.querySelectorAll('*'))) {
            if (el.shadowRoot) {
              const nested = findDeep(el.shadowRoot);
              if (nested) return nested;
            }
            if (el.tagName === 'IFRAME') {
              try {
                if (el.contentDocument) {
                  const inFrame = findDeep(el.contentDocument);
                  if (inFrame) return inFrame;
                }
              } catch { /* cross-origin iframe */ }
            }
          }
          return null;
        };
        const el = findDeep(document);
        if (!el) return { found: false, names: [] };
        try {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch { /* ignore */ }
        const names = Array.from(el.files || []).map(f => String(f.name || ''));
        return { found: true, names };
      })()`, { timeoutMs: Math.min(timeoutMs, 5000) }).catch(() => ({ found: true, names: [validatedFile.basename] }));

      const data = {
        ok: true,
        uploaded: true,
        method: 'direct_file_input',
        target_id: target.id || null,
        selector,
        file_path: validatedFile.resolved,
        filename: validatedFile.basename,
        size_bytes: validatedFile.size,
        attached_files: Array.isArray(readBack?.names) && readBack.names.length > 0 ? readBack.names : [validatedFile.basename],
      };
      return {
        exitCode: 0,
        json: parsed.json,
        data,
        lines: [`Uploaded "${data.filename}" (${data.size_bytes} bytes) -> ${selector}`],
      };
    } finally {
      await client.close();
    }
  }

  return {
    exitCode: 1,
    json: parsed.json,
    data: { ok: false, error: `Unhandled cdp subcommand "${parsed.subcommand}".` },
    lines: [`Unhandled cdp subcommand "${parsed.subcommand}".`],
  };
}
