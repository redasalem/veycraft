#!/usr/bin/env node
// Zero-dependency, strictly read-only & offline local Web UI server for Veycraft.
// Binds exclusively to 127.0.0.1 using Node.js built-in modules only.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveGlobalRoot,
  isGlobalRoot,
  readPackageMeta,
  loadSkillManifest,
  readSkillByName,
  evaluateDoctorSnapshot,
  auditCvFile,
  auditCvText,
  matchNaturalLanguageRoute,
  verifyArtifactTarget,
  verifyArtifactText,
  evaluatePreSubmitWithDraft,
} from './core-ops.mjs';
import {
  summarizeCareerWorkspace,
  runCareerAnalyticsForWorkspace,
  computeCareerWorkflowQueue,
  listOwnerApplicationsForKanban,
  listOwnerCvVersions,
  inspectLedgerLock,
  inspectLedgerTransaction,
  parsePeriodSpec,
} from './career-intelligence.mjs';
import { isObj } from './fs-safety.mjs';

export const LOOPBACK_HOST = '127.0.0.1';
export const DEFAULT_UI_PORT = 4310;
export const MAX_BODY_BYTES = 512 * 1024; // 512 KB
export const WORKSPACE_SCAN_MAX_DEPTH = 5;
export const WORKSPACE_SCAN_MAX_FILES = 500;

export const UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'browser-profile',
  '.chrome-profile',
  '.cursor',
  '.gemini',
  '.vscode',
  '.codex',
  '.claude',
  '.windsurf',
  '.roo',
  '.kiro',
  '.junie',
  '.aiassistant',
  '.trae',
  '.continue',
  '.openhands',
  '.augment',
  '.amazonq',
]);

const ALLOWED_SCAN_EXT_RE = /\.(?:md|markdown|txt|html|htm|doc|docx|json|yaml|yml|pdf)$/i;

class HttpApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isExcludedFileName(name) {
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  if (lower.startsWith('browser-profile') || lower.startsWith('.chrome-profile')) return true;
  if (lower.endsWith('.veycraft.bak') || lower.endsWith('.bak')) return true;
  if (lower === '.mcp.json' || lower === '.ledger.lock' || lower === '.ledger-tx.json') return true;
  return false;
}

export function enumerateSafeWorkspaceIndex(workspaceRoot, {
  maxDepth = WORKSPACE_SCAN_MAX_DEPTH,
  maxFiles = WORKSPACE_SCAN_MAX_FILES,
} = {}) {
  const rootResolved = path.resolve(workspaceRoot);
  const files = new Map();
  const dirs = new Map();
  const publicList = [];

  if (!fs.existsSync(rootResolved)) {
    return { files, dirs, publicList };
  }
  let rootStat;
  try {
    rootStat = fs.lstatSync(rootResolved);
  } catch {
    return { files, dirs, publicList };
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { files, dirs, publicList };
  }

  function walk(currentAbs, relPrefix, depth) {
    if (depth > maxDepth || files.size >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.size >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      const name = entry.name;
      const relPosix = relPrefix ? `${relPrefix}/${name}` : name;
      const childAbs = path.join(currentAbs, name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(name) || name.startsWith('browser-profile')) continue;
        dirs.set(relPosix, { rel_path: relPosix, abs_path: childAbs });
        walk(childAbs, relPosix, depth + 1);
      } else if (entry.isFile()) {
        if (isExcludedFileName(name)) continue;
        if (!ALLOWED_SCAN_EXT_RE.test(name)) continue;
        let st;
        try {
          st = fs.lstatSync(childAbs);
        } catch {
          continue;
        }
        if (st.isSymbolicLink() || !st.isFile()) continue;
        const ext = path.extname(name).toLowerCase().replace(/^\./, '');
        const item = {
          rel_path: relPosix,
          abs_path: childAbs,
          ext,
          size: st.size,
        };
        files.set(relPosix, item);
        publicList.push({
          rel_path: relPosix,
          ext,
          size: st.size,
        });
      }
    }
  }

  walk(rootResolved, '', 0);
  return { files, dirs, publicList };
}

function normalizeLookupRelKey(rawInput, label = 'path') {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    throw new HttpApiError(400, 'invalid_path', `Missing or empty ${label}.`);
  }
  const raw = rawInput.trim();
  if (raw.length > 512 || /[\x00-\x1f\x7f]/.test(raw)) {
    throw new HttpApiError(400, 'invalid_path', `Invalid characters or length in ${label}.`);
  }
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:/.test(raw)) {
    throw new HttpApiError(400, 'invalid_workspace_path', `${label} must be a workspace-relative path.`);
  }
  const norm = raw.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  const parts = norm.split('/');
  if (!norm || parts.some((p) => !p || p === '.' || p === '..')) {
    throw new HttpApiError(400, 'invalid_workspace_path', `Refusing parent traversal or malformed ${label}.`);
  }
  if (parts.some((p) => EXCLUDED_DIR_NAMES.has(p) || isExcludedFileName(p))) {
    throw new HttpApiError(403, 'forbidden_workspace_path', `Access to sensitive path is blocked for ${label}.`);
  }
  return norm;
}

function lookupIndexedWorkspaceEntry(index, rawInput, { allowDirectory = false, label = 'path' } = {}) {
  const key = normalizeLookupRelKey(rawInput, label);
  const fileEntry = index.files.get(key);
  if (fileEntry) return fileEntry.abs_path;
  if (allowDirectory) {
    const dirEntry = index.dirs.get(key);
    if (dirEntry) return dirEntry.abs_path;
  }
  throw new HttpApiError(404, 'workspace_file_not_found', `Workspace ${label} not found or excluded: "${key}".`);
}

function applySecurityHeaders(res, contentType) {
  res.setHeader('Content-Security-Policy', UI_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
}

function sendJson(res, statusCode, payload, { isHead = false, extraHeaders = null } = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  applySecurityHeaders(res, 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.setHeader(k, v);
    }
  }
  res.statusCode = statusCode;
  if (isHead) {
    res.end();
  } else {
    res.end(body);
  }
}

function sendStaticBuffer(res, buf, contentType, { isHead = false } = {}) {
  applySecurityHeaders(res, contentType);
  res.setHeader('Content-Length', String(buf.length));
  res.statusCode = 200;
  if (isHead) {
    res.end();
  } else {
    res.end(buf);
  }
}

function readJsonBodyBounded(req, maxBytes = MAX_BODY_BYTES) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) {
    return Promise.reject(
      new HttpApiError(415, 'unsupported_media_type', 'POST requests must use Content-Type: application/json.'),
    );
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    function failWith(err) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        req.resume();
        failWith(new HttpApiError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', () => {
      failWith(new HttpApiError(400, 'request_stream_error', 'Failed reading request stream.'));
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!isObj(parsed)) {
          reject(new HttpApiError(400, 'invalid_json_body', 'JSON request body must be an object.'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpApiError(400, 'invalid_json', 'Malformed JSON in request body.'));
      }
    });
  });
}

function loadStaticAssets(packageSource) {
  const uiDir = path.join(path.resolve(packageSource), 'ui');
  const readSafeAsset = (filename) => {
    const full = path.join(uiDir, filename);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing required UI asset: ${full}`);
    }
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new Error(`Refusing symbolic-link or non-regular UI asset: ${full}`);
    }
    return fs.readFileSync(full);
  };
  return {
    indexHtml: readSafeAsset('index.html'),
    stylesCss: readSafeAsset('styles.css'),
    appJs: readSafeAsset('app.js'),
    faviconSvg: readSafeAsset('favicon.svg'),
  };
}

function loadInvariantsText(workspaceRoot, packageSource) {
  for (const base of [workspaceRoot, packageSource]) {
    const candidate = path.join(base, 'config', 'invariants.txt');
    try {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isFile()) {
        return fs.readFileSync(candidate, 'utf8').trim();
      }
    } catch {
      // ignore
    }
  }
  return '';
}

export function openUrlInBrowser(actualPort, {
  platform = process.platform,
  env = process.env,
  openBrowser = true,
} = {}) {
  if (!openBrowser || Boolean(env.CI)) return false;
  const portNum = Number(actualPort);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return false;
  const safeUrl = `http://127.0.0.1:${portNum}/`;

  try {
    if (platform === 'win32') {
      const child = execFile('rundll32.exe', ['url.dll,FileProtocolHandler', safeUrl], { windowsHide: true }, () => {});
      child.unref?.();
      return true;
    }
    if (platform === 'darwin') {
      const child = execFile('open', [safeUrl], { windowsHide: true }, () => {});
      child.unref?.();
      return true;
    }
    const child = execFile('xdg-open', [safeUrl], { windowsHide: true }, () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

function sanitizeRoutePayload(res) {
  return {
    query: res.query,
    intent: res.intent,
    skills: res.skills,
    workflow: res.workflow ?? null,
    readiness: res.readiness,
    required_inputs: res.required_inputs,
    optional_tools: res.optional_tools,
    fallback: res.fallback,
    outputs: res.outputs,
  };
}

export async function startUiServer({
  root = process.cwd(),
  source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  home = os.homedir(),
  isGlobal = undefined,
  port = DEFAULT_UI_PORT,
  portExplicit = false,
  openBrowser = true,
  env = process.env,
  platform = process.platform,
  stderr = process.stderr,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid UI port "${port}". Expected integer 0..65535.`);
  }

  const workspaceRoot = path.resolve(root);
  const packageSource = path.resolve(source);
  const effectiveGlobal = isGlobal !== undefined ? Boolean(isGlobal) : isGlobalRoot(workspaceRoot, home);
  const assets = loadStaticAssets(packageSource);

  let boundPort = port;

  const createHttpInstance = () => http.createServer(async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();
    const isHead = method === 'HEAD';

    try {
      // 1. Strict DNS-rebinding Host validation
      const hostHeader = String(req.headers.host || '').trim().toLowerCase();
      const allowedHosts = new Set([
        `127.0.0.1:${boundPort}`,
        `localhost:${boundPort}`,
      ]);
      if (!allowedHosts.has(hostHeader)) {
        throw new HttpApiError(403, 'invalid_host', 'Forbidden Host header (loopback access only).');
      }

      // 2. Strict Origin & Fetch-Metadata cross-origin guard
      const originHeader = req.headers.origin;
      if (originHeader !== undefined) {
        const normOrigin = String(originHeader).trim().toLowerCase();
        const allowedOrigins = new Set([
          `http://127.0.0.1:${boundPort}`,
          `http://localhost:${boundPort}`,
        ]);
        if (!allowedOrigins.has(normOrigin)) {
          throw new HttpApiError(403, 'cross_origin_blocked', 'Cross-origin requests are forbidden.');
        }
      }

      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite !== undefined) {
        const normSite = String(secFetchSite).trim().toLowerCase();
        if (normSite !== 'same-origin' && normSite !== 'none') {
          throw new HttpApiError(403, 'cross_site_blocked', 'Cross-site requests are forbidden.');
        }
      }

      // 3. Safe URL parsing
      const rawUrl = String(req.url || '/');
      if (rawUrl.length > 2048 || !rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('\\')) {
        throw new HttpApiError(400, 'invalid_request_url', 'Invalid request target.');
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl, `http://127.0.0.1:${boundPort}`);
      } catch {
        throw new HttpApiError(400, 'invalid_request_url', 'Malformed request URL.');
      }
      const pathname = parsedUrl.pathname;

      // Reject raw or percent-encoded traversal sequences up front on any route
      const rawPathPortion = rawUrl.split('?')[0].toLowerCase();
      if (rawPathPortion.includes('..') || rawPathPortion.includes('%2e') || rawPathPortion.includes('%2f') || rawPathPortion.includes('%5c')) {
        throw new HttpApiError(404, 'not_found', 'Route not found.');
      }

      // 4. Fixed 4-entry static asset allowlist (zero user taint in fs paths)
      if (pathname === '/' || pathname === '/index.html' || pathname === '/styles.css' || pathname === '/app.js' || pathname === '/favicon.svg') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, {
            extraHeaders: { Allow: 'GET, HEAD' },
          });
          return;
        }
        switch (pathname) {
          case '/':
          case '/index.html':
            sendStaticBuffer(res, assets.indexHtml, 'text/html; charset=utf-8', { isHead });
            return;
          case '/styles.css':
            sendStaticBuffer(res, assets.stylesCss, 'text/css; charset=utf-8', { isHead });
            return;
          case '/app.js':
            sendStaticBuffer(res, assets.appJs, 'text/javascript; charset=utf-8', { isHead });
            return;
          case '/favicon.svg':
            sendStaticBuffer(res, assets.faviconSvg, 'image/svg+xml', { isHead });
            return;
        }
      }

      // 5. Read-only GET /api/* endpoints
      if (pathname === '/api/overview') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const pkgMeta = readPackageMeta(workspaceRoot, packageSource);
        const doctorSnap = await evaluateDoctorSnapshot({
          root: workspaceRoot,
          source: packageSource,
          home,
          isGlobal: effectiveGlobal,
          strict: false,
          offline: true,
          readOnly: true,
          env,
        });
        let summary = null;
        let ledgerError = null;
        try {
          summary = summarizeCareerWorkspace(workspaceRoot, { home });
        } catch (err) {
          ledgerError = err && err.message ? String(err.message) : 'Ledger validation error.';
        }
        let nextQueue = null;
        try {
          nextQueue = computeCareerWorkflowQueue(workspaceRoot, {
            home,
            sourceRoot: packageSource,
            language: 'en',
          });
        } catch (err) {
          if (!ledgerError) ledgerError = err && err.message ? String(err.message) : 'Workflow queue error.';
        }
        const lockInfo = inspectLedgerLock(workspaceRoot, { home });
        const txInfo = inspectLedgerTransaction(workspaceRoot, { home });
        const index = enumerateSafeWorkspaceIndex(workspaceRoot);

        sendJson(res, 200, {
          ok: true,
          meta: {
            product: 'veycraft',
            version: pkgMeta.version,
            host: LOOPBACK_HOST,
            port: boundPort,
            workspace_root: workspaceRoot,
            scope: effectiveGlobal ? 'global' : 'local',
            read_only: true,
            offline: true,
            zero_dependencies: { runtime: pkgMeta.runtimeDeps, dev: pkgMeta.devDeps },
          },
          doctor: {
            payload: doctorSnap.payload,
            events: doctorSnap.events,
          },
          summary,
          next: nextQueue,
          ledger_health: {
            error: ledgerError,
            lock: {
              locked: lockInfo.locked,
              stale: lockInfo.stale,
              corrupt: lockInfo.corrupt,
            },
            transaction: {
              pending: txInfo.pending,
              corrupt: txInfo.corrupt,
            },
          },
          workspace_files: index.publicList,
        }, { isHead });
        return;
      }

      if (pathname === '/api/doctor') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const strictParam = parsedUrl.searchParams.get('strict');
        const strict = strictParam === '1' || strictParam === 'true';
        const snap = await evaluateDoctorSnapshot({
          root: workspaceRoot,
          source: packageSource,
          home,
          isGlobal: effectiveGlobal,
          strict,
          offline: true,
          readOnly: true,
          env,
        });
        sendJson(res, 200, { ok: true, payload: snap.payload, events: snap.events }, { isHead });
        return;
      }

      if (pathname === '/api/applications') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        let kanban;
        let cvVersions;
        try {
          kanban = listOwnerApplicationsForKanban(workspaceRoot, { home });
          cvVersions = listOwnerCvVersions(workspaceRoot, { home });
        } catch (err) {
          throw new HttpApiError(422, 'ledger_validation_failed', err && err.message ? String(err.message) : 'Invalid ledger format.');
        }
        const lockInfo = inspectLedgerLock(workspaceRoot, { home });
        const txInfo = inspectLedgerTransaction(workspaceRoot, { home });
        sendJson(res, 200, {
          ok: true,
          kanban,
          cv_versions: cvVersions,
          lock: { locked: lockInfo.locked, stale: lockInfo.stale, corrupt: lockInfo.corrupt },
          transaction: { pending: txInfo.pending, corrupt: txInfo.corrupt },
        }, { isHead });
        return;
      }

      if (pathname === '/api/analytics') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const rawPeriod = parsedUrl.searchParams.get('period') || 'all';
        try {
          parsePeriodSpec(rawPeriod);
        } catch (err) {
          throw new HttpApiError(400, 'invalid_period', err.message);
        }
        let result;
        try {
          result = runCareerAnalyticsForWorkspace(workspaceRoot, {
            home,
            period: rawPeriod,
            write: false,
          });
        } catch (err) {
          throw new HttpApiError(422, 'analytics_failed', err && err.message ? String(err.message) : 'Failed computing analytics.');
        }
        sendJson(res, 200, { ok: true, analytics: result.analytics }, { isHead });
        return;
      }

      if (pathname === '/api/next') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const jobId = parsedUrl.searchParams.get('job_id') || null;
        const personaId = parsedUrl.searchParams.get('persona_id') || null;
        const language = parsedUrl.searchParams.get('language') || 'en';
        let queue;
        try {
          queue = computeCareerWorkflowQueue(workspaceRoot, {
            home,
            sourceRoot: packageSource,
            jobId,
            personaId,
            language,
          });
        } catch (err) {
          throw new HttpApiError(422, 'queue_failed', err && err.message ? String(err.message) : 'Failed computing workflow queue.');
        }
        sendJson(res, 200, { ok: true, queue }, { isHead });
        return;
      }

      if (pathname === '/api/skills') {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const { manifest } = loadSkillManifest(workspaceRoot, packageSource);
        const invariantsText = loadInvariantsText(workspaceRoot, packageSource);
        sendJson(res, 200, {
          ok: true,
          manifest_version: manifest.manifest_version,
          progressive_disclosure: manifest.progressive_disclosure,
          skills_count: manifest.skills.length,
          skills: manifest.skills,
          invariants_text: invariantsText,
        }, { isHead });
        return;
      }

      if (pathname.startsWith('/api/skills/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'GET, HEAD' } });
          return;
        }
        const rawName = pathname.slice('/api/skills/'.length);
        if (!rawName || rawName.length > 120 || !/^[A-Za-z0-9_-]+$/.test(rawName)) {
          throw new HttpApiError(400, 'invalid_skill_name', 'Invalid skill name.');
        }
        let skillData;
        try {
          skillData = readSkillByName(rawName, {
            root: workspaceRoot,
            source: packageSource,
            home,
          });
        } catch (err) {
          throw new HttpApiError(404, 'skill_not_found', err && err.message ? String(err.message) : 'Skill not found.');
        }
        sendJson(res, 200, { ok: true, ...skillData }, { isHead });
        return;
      }

      // 6. Stateless / Read-Only POST /api/* Studio endpoints
      if (pathname === '/api/route') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'POST' } });
          return;
        }
        const body = await readJsonBodyBounded(req);
        if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 2000) {
          throw new HttpApiError(400, 'invalid_query', 'Field "query" must be a string between 1 and 2000 characters.');
        }
        const routed = matchNaturalLanguageRoute(body.query);
        sendJson(res, 200, { ok: true, route: sanitizeRoutePayload(routed) });
        return;
      }

      if (pathname === '/api/audit') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'POST' } });
          return;
        }
        const body = await readJsonBodyBounded(req);
        if (typeof body.text === 'string' && body.text.trim()) {
          const format = typeof body.format === 'string' ? body.format : 'md';
          let report;
          try {
            report = auditCvText(body.text, { format, resolved: '<studio-inline>', root: workspaceRoot, source: packageSource });
          } catch (err) {
            throw new HttpApiError(400, 'audit_failed', err && err.message ? String(err.message) : 'CV audit failed.');
          }
          sendJson(res, 200, { ok: true, mode: 'inline', audit: report });
          return;
        }
        if (typeof body.path === 'string' && body.path.trim()) {
          const index = enumerateSafeWorkspaceIndex(workspaceRoot);
          const safeAbsPath = lookupIndexedWorkspaceEntry(index, body.path, { allowDirectory: false, label: 'CV path' });
          let report;
          try {
            report = auditCvFile(safeAbsPath, {
              root: workspaceRoot,
              source: packageSource,
              home,
              cwd: workspaceRoot,
            });
          } catch (err) {
            throw new HttpApiError(400, 'audit_failed', err && err.message ? String(err.message) : 'CV audit failed.');
          }
          sendJson(res, 200, { ok: true, mode: 'workspace_file', audit: report });
          return;
        }
        throw new HttpApiError(400, 'missing_input', 'Provide either non-empty "text" or a workspace-relative "path".');
      }

      if (pathname === '/api/verify') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'POST' } });
          return;
        }
        const body = await readJsonBodyBounded(req);
        if (typeof body.text === 'string' && body.text.length > 0) {
          const format = typeof body.format === 'string' ? body.format : 'html';
          const name = `inline.${String(format).replace(/^\./, '') || 'html'}`;
          let item;
          try {
            item = verifyArtifactText(body.text, {
              format,
              name,
              factsText: typeof body.facts_text === 'string' ? body.facts_text : null,
              factsJson: isObj(body.facts_json) ? body.facts_json : null,
            });
          } catch (err) {
            throw new HttpApiError(400, 'verify_failed', err && err.message ? String(err.message) : 'Artifact verify failed.');
          }
          sendJson(res, 200, {
            ok: true,
            mode: 'inline',
            verification: {
              resolved: '<studio-inline>',
              file_count: 1,
              error_count: item.errors.length,
              warning_count: item.warnings.length,
              ok: item.ok,
              results: [item],
            },
          });
          return;
        }
        if (typeof body.path === 'string' && body.path.trim()) {
          const index = enumerateSafeWorkspaceIndex(workspaceRoot);
          const safeTarget = lookupIndexedWorkspaceEntry(index, body.path, { allowDirectory: true, label: 'verify path' });
          let safeFactsPath = null;
          if (typeof body.facts_path === 'string' && body.facts_path.trim()) {
            safeFactsPath = lookupIndexedWorkspaceEntry(index, body.facts_path, { allowDirectory: false, label: 'facts_path' });
          }
          let verification;
          try {
            verification = verifyArtifactTarget(safeTarget, {
              factsPath: safeFactsPath,
              root: workspaceRoot,
              source: packageSource,
              home,
              cwd: workspaceRoot,
            });
          } catch (err) {
            throw new HttpApiError(400, 'verify_failed', err && err.message ? String(err.message) : 'Artifact verify failed.');
          }
          sendJson(res, 200, { ok: true, mode: 'workspace_path', verification });
          return;
        }
        throw new HttpApiError(400, 'missing_input', 'Provide either non-empty "text" or a workspace-relative "path".');
      }

      if (pathname === '/api/pre-submit') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, { extraHeaders: { Allow: 'POST' } });
          return;
        }
        const body = await readJsonBodyBounded(req);
        let safeDraftPath = null;
        if (typeof body.draft === 'string' && body.draft.trim()) {
          const index = enumerateSafeWorkspaceIndex(workspaceRoot);
          safeDraftPath = lookupIndexedWorkspaceEntry(index, body.draft, { allowDirectory: false, label: 'draft path' });
        }
        const maxWords = body.max_words !== undefined ? Number(body.max_words) : 75;
        if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > 5000) {
          throw new HttpApiError(400, 'invalid_max_words', 'Field "max_words" must be an integer between 1 and 5000.');
        }
        let evaluation;
        try {
          evaluation = evaluatePreSubmitWithDraft(workspaceRoot, {
            platform: typeof body.platform === 'string' && body.platform.trim() ? body.platform.trim() : null,
            company: typeof body.company === 'string' && body.company.trim() ? body.company.trim() : null,
            title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null,
            url: typeof body.url === 'string' && body.url.trim() ? body.url.trim() : null,
            jobId: typeof body.job_id === 'string' && body.job_id.trim() ? body.job_id.trim() : null,
            draft: safeDraftPath,
            text: typeof body.text === 'string' ? body.text : null,
            maxWords,
          }, {
            home,
            source: packageSource,
            cwd: workspaceRoot,
          });
        } catch (err) {
          throw new HttpApiError(400, 'pre_submit_failed', err && err.message ? String(err.message) : 'Pre-submit evaluation failed.');
        }
        sendJson(res, 200, { ok: true, evaluation });
        return;
      }

      throw new HttpApiError(404, 'not_found', 'Route not found.');
    } catch (err) {
      if (err instanceof HttpApiError) {
        sendJson(res, err.statusCode, {
          ok: false,
          error: { code: err.code, message: err.message },
        }, { isHead });
        return;
      }
      try {
        stderr?.write?.(`[veycraft ui] internal error: ${err?.message || err}\n`);
      } catch {
        // ignore stderr failures
      }
      sendJson(res, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'Internal UI server error.' },
      }, { isHead });
    }
  });

  function listenOnce(targetPort) {
    return new Promise((resolve, reject) => {
      const server = createHttpInstance();
      server.requestTimeout = 15_000;
      server.headersTimeout = 10_000;
      server.keepAliveTimeout = 5_000;

      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(targetPort, LOOPBACK_HOST);
    });
  }

  let server;
  try {
    server = await listenOnce(port);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE' && !portExplicit && port > 0) {
      server = await listenOnce(0);
      const fallbackAddr = server.address();
      const fallbackPort = isObj(fallbackAddr) ? fallbackAddr.port : 0;
      try {
        stderr?.write?.(`[!] Port ${port} is already in use on ${LOOPBACK_HOST}; bound ephemeral port ${fallbackPort} instead.\n`);
      } catch {
        // ignore stderr errors
      }
    } else if (err && err.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} on ${LOOPBACK_HOST} is already in use. Pass --port <other> or --port 0.`);
    } else {
      throw err;
    }
  }

  const addr = server.address();
  boundPort = isObj(addr) && typeof addr.port === 'number' ? addr.port : port;
  const url = `http://${LOOPBACK_HOST}:${boundPort}/`;

  openUrlInBrowser(boundPort, { platform, env, openBrowser });

  let closed = false;
  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  return {
    server,
    host: LOOPBACK_HOST,
    port: boundPort,
    url,
    close,
  };
}

function isDirectEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectEntrypoint()) {
  const customHome = process.env.VEYCRAFT_HOME && process.env.VEYCRAFT_HOME.trim();
  const root = customHome ? path.resolve(customHome) : resolveGlobalRoot();
  startUiServer({ root, openBrowser: false }).then((handle) => {
    process.stderr.write(`Veycraft UI listening on ${handle.url}\n`);
    const stop = () => {
      handle.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch((err) => {
    process.stderr.write(`veycraft ui fatal: ${err?.message || err}\n`);
    process.exitCode = 1;
  });
}
