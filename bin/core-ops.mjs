// Pure, zero-stdout deterministic operations shared by bin/cli.mjs and bin/mcp-server.mjs.
// Uses Node.js built-in modules and local pure helpers only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateProfileUpdatePlan, validateProfileVault } from './profile-intelligence.mjs';
import {
  validateApplicationLedger,
  validateCvVersionsRegistry,
  validateCareerInsights,
  validateDailyRun,
  validateSessionCheckpoint,
  BANNED_AI_CLICHES,
  evaluatePreSubmitGate,
} from './career-intelligence.mjs';
import {
  validateNotionSyncPlan,
  verifySyncStateIntegrity,
} from './notion-sync.mjs';
import {
  isSamePath,
  isObj,
  isWithinDir,
  refuseSymlink as refuseSymlinkBase,
  writeAtomic as writeAtomicBase,
  readJsonSafe as readJsonSafeBase,
  isBlockedSsrfUrl,
  fetchUrlWithSafeRedirects,
  DOCX_LIMITS,
  readFileBoundedSync,
  extractDocxText,
  decodeXmlHtmlEntities,
  stripHtmlBlocks,
  stripMarkupTags,
} from './fs-safety.mjs';

export const PINNED_SIGNING_PRINCIPAL = '192090175+redasalem@users.noreply.github.com';
export const PLACEHOLDER_RE = /\b(?:Jane Doe|John Doe|YOUR_NAME|YOUR_EMAIL|your-handle|your-site|replace-with|Acme Fintech|Nile Commerce)\b|(?:example\.com|example\.invalid|reda@example\.com)/i;
export const SECRET_LEAK_RE = /(ntn_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/;

export function resolveGlobalRoot(home = os.homedir(), env = process.env, platform = process.platform) {
  const customHome = env.VEYCRAFT_HOME && env.VEYCRAFT_HOME.trim();
  if (customHome) return path.resolve(customHome);
  const primary = path.join(home, '.veycraft');
  const legacy = path.join(home, '.job-hunter-os');
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(legacy)) return legacy;
  if (platform === 'linux' && env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME.trim())) {
    return path.join(env.XDG_DATA_HOME.trim(), 'veycraft');
  }
  return primary;
}

export function hasInstallMarker(dir) {
  return (
    fs.existsSync(path.join(dir, '.veycraft-install.json')) ||
    fs.existsSync(path.join(dir, '.job-hunter-install.json'))
  );
}

export function isGlobalRoot(root, home = os.homedir()) {
  const candidates = [
    path.join(home, '.veycraft'),
    path.join(home, '.job-hunter-os'),
    resolveGlobalRoot(home),
  ];
  return candidates.some(c => isSamePath(root, c));
}

export function resolveCodexHome(home = os.homedir(), env = process.env) {
  const custom = env.CODEX_HOME && env.CODEX_HOME.trim();
  return custom ? path.resolve(custom) : path.join(home, '.codex');
}

export function mcpTargetFiles(root, isGlobal, home = os.homedir()) {
  if (isGlobal) {
    return [
      path.join(home, '.claude.json'),
      path.join(home, '.cursor', 'mcp.json'),
      path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
      path.join(home, '.gemini', 'settings.json'),
      path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      path.join(home, '.copilot', 'mcp-config.json'),
    ];
  }
  return [
    path.join(root, '.mcp.json'),
    path.join(root, '.cursor', 'mcp.json'),
    path.join(root, '.gemini', 'settings.json'),
  ];
}

export function codexConfigTomlPath(root, isGlobal, home = os.homedir()) {
  return isGlobal ? path.join(resolveCodexHome(home), 'config.toml') : path.join(root, '.codex', 'config.toml');
}

export function readPackageMeta(root, source) {
  const pkgPath = [path.join(root, 'package.json'), path.join(source, 'package.json')].find(f => fs.existsSync(f));
  let pkg = {};
  if (pkgPath) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* ignore */ }
  }
  return {
    version: pkg.version || '1.4.1',
    runtimeDeps: Object.keys(pkg.dependencies || {}).length,
    devDeps: Object.keys(pkg.devDependencies || {}).length,
  };
}

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSkillRegex(skill) {
  const escaped = escapeRegex(skill);
  const left = /^[A-Za-z0-9_]/.test(skill) ? '(?<![A-Za-z0-9_])' : '(?<!\\.)';
  const right = /[A-Za-z0-9_]$/.test(skill) ? '(?![A-Za-z0-9_])' : '(?![A-Za-z0-9_+])';
  return new RegExp(`${left}${escaped}${right}`, 'i');
}

export function hasParentTraversalSegment(rawPath) {
  if (typeof rawPath !== 'string') return true;
  const slashNorm = rawPath.trim().replace(/\\/g, '/');
  return slashNorm.split('/').some(seg => seg === '..');
}

export function assertSafeCliInputPath(rawPath, {
  label = 'file path',
  allowDirectory = false,
  root,
  source,
  home = os.homedir(),
  cwd = process.cwd(),
} = {}) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error(`Invalid ${label}: path must be a non-empty string.`);
  }
  if (/[\x00-\x1f\x7f]/.test(rawPath)) {
    throw new Error(`Refusing ${label} containing control characters.`);
  }
  const trimmed = rawPath.trim();
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    throw new Error(`Refusing UNC or network ${label}: "${rawPath}"`);
  }
  const afterDrive = /^[A-Za-z]:/.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (afterDrive.includes(':')) {
    throw new Error(`Refusing ${label} containing unsafe alternate data stream or colon syntax: "${rawPath}"`);
  }
  if (hasParentTraversalSegment(trimmed)) {
    throw new Error(`Refusing ${label} with ".." parent traversal segments: "${rawPath}"`);
  }
  const cwdResolved = path.resolve(cwd);
  const rootResolved = path.resolve(root);
  const sourceResolved = path.resolve(source);
  const resolved = path.resolve(cwdResolved, trimmed);

  const allowedRoots = [rootResolved, cwdResolved, sourceResolved];
  for (const b of [rootResolved, cwdResolved, sourceResolved]) {
    for (const fn of [fs.realpathSync, fs.realpathSync?.native].filter(Boolean)) {
      try {
        const rp = fn(b);
        if (rp && !allowedRoots.some(x => isSamePath(x, rp))) {
          allowedRoots.push(rp);
        }
        if (process.platform === 'darwin' && rp.startsWith('/private/')) {
          const alias = rp.slice('/private'.length);
          if (alias && !allowedRoots.some(x => isSamePath(x, alias))) {
            allowedRoots.push(alias);
          }
        }
      } catch { /* ignore */ }
    }
  }

  let matchedBoundary = allowedRoots.find(b => isWithinDir(resolved, b));
  if (!matchedBoundary) {
    let probe = resolved;
    while (probe && !fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (probe && fs.existsSync(probe)) {
      let hasSymlinkInChain = false;
      let cursor = probe;
      while (cursor) {
        try {
          if (fs.lstatSync(cursor).isSymbolicLink()) {
            hasSymlinkInChain = true;
            break;
          }
        } catch {
          break;
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      if (!hasSymlinkInChain) {
        for (const fn of [fs.realpathSync?.native, fs.realpathSync].filter(Boolean)) {
          try {
            const realProbe = fn(probe);
            const relTail = path.relative(probe, resolved);
            const canonicalCandidate = relTail ? path.resolve(realProbe, relTail) : realProbe;
            const realMatched = allowedRoots.find(b => isWithinDir(canonicalCandidate, b));
            if (realMatched) {
              matchedBoundary = probe;
              break;
            }
          } catch { /* ignore */ }
        }
      }
    }
  }
  if (!matchedBoundary) {
    throw new Error(`Refusing ${label} outside workspace boundary: "${rawPath}"`);
  }

  refuseSymlinkBase(resolved, matchedBoundary, home);
  if (!fs.existsSync(resolved)) {
    return { resolved, boundary: matchedBoundary, exists: false, stat: null };
  }
  const lstat = fs.lstatSync(resolved);
  if (lstat.isSymbolicLink()) {
    throw new Error(`Refusing symbolic-link ${label}: ${resolved}`);
  }
  if (!allowDirectory && !lstat.isFile()) {
    throw new Error(`Expected regular file for ${label}: ${resolved}`);
  }
  if (allowDirectory && !lstat.isFile() && !lstat.isDirectory()) {
    throw new Error(`Expected regular file or directory for ${label}: ${resolved}`);
  }
  return { resolved, boundary: matchedBoundary, exists: true, stat: lstat };
}

export function loadSkillManifest(root, source) {
  const manifestPath = [
    path.join(root, 'skills', 'skills-manifest.json'),
    path.join(source, 'skills', 'skills-manifest.json'),
  ].find(f => fs.existsSync(f));
  if (!manifestPath) {
    throw new Error('skills/skills-manifest.json not found.');
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isObj(parsed) || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid skills/skills-manifest.json structure.');
  }
  const baseDir = path.dirname(path.dirname(manifestPath));
  return { manifestPath, baseDir, manifest: parsed };
}

export function readSkillByName(name, { root, source, home = os.homedir() } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('Skill name must be a non-empty string.');
  }
  const { baseDir, manifest } = loadSkillManifest(root, source);
  const entry = manifest.skills.find(s => s && s.name === trimmed);
  if (!entry) {
    throw new Error(`Unknown skill "${trimmed}".`);
  }
  const skillsDir = path.join(baseDir, 'skills');
  const skillPath = path.resolve(baseDir, entry.path);
  if (!isWithinDir(skillPath, skillsDir)) {
    throw new Error(`Refusing skill path outside skills/ directory: ${entry.path}`);
  }
  refuseSymlinkBase(skillPath, baseDir, home);
  if (!fs.existsSync(skillPath) || fs.lstatSync(skillPath).isSymbolicLink() || !fs.lstatSync(skillPath).isFile()) {
    throw new Error(`Skill file missing or invalid: ${entry.path}`);
  }
  const content = fs.readFileSync(skillPath, 'utf8');
  return {
    skill: entry,
    uri: `veycraft://skill/${entry.name}`,
    content,
  };
}

export function isGitPreCommitHookActive(root) {
  const gitDir = path.join(root, '.git');
  try {
    if (!fs.existsSync(gitDir) || !fs.lstatSync(gitDir).isDirectory()) return false;
    const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
    if (!fs.existsSync(hookFile) || fs.lstatSync(hookFile).isSymbolicLink()) return false;
    return fs.lstatSync(hookFile).isFile();
  } catch {
    return false;
  }
}

export function installGitPreCommitHook(root, home = os.homedir()) {
  const gitDir = path.join(root, '.git');
  try {
    if (!fs.existsSync(gitDir) || !fs.lstatSync(gitDir).isDirectory()) return false;
  } catch {
    return false;
  }
  const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
  const marker = '# veycraft pre-commit pii shield';
  const legacyMarker = '# job-hunter-os pre-commit pii shield';
  if (fs.existsSync(hookFile)) {
    try {
      const existing = fs.readFileSync(hookFile, 'utf8');
      if (!existing.includes(marker) && !existing.includes(legacyMarker)) return true;
    } catch {
      return false;
    }
  }
  const script = [
    '#!/usr/bin/env sh',
    marker,
    'set -e',
    'STAGED=$(git diff --cached --name-only --diff-filter=ACM || true)',
    'if [ -z "$STAGED" ]; then exit 0; fi',
    'for f in $STAGED; do',
    '  case "$f" in',
    '    context/*.example|context/DROP_YOUR_FILES_HERE.md) ;;',
    '    context/*|logs/*|browser-profile/*|*.pdf|.env|.env.*|*.veycraft.bak|.mcp.json|.cursor/mcp.json|.codex/config.toml|.gemini/settings.json|.vscode/mcp.json)',
    '      echo "[veycraft PII Shield] BLOCKED commit of private file: $f" >&2',
    '      exit 1',
    '      ;;',
    '  esac',
    'done',
    'if git diff --cached -U0 | grep -E "^\\+.*(ntn_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})" >/dev/null 2>&1; then',
    '  echo "[veycraft PII Shield] BLOCKED commit containing an API token signature (ntn_ / sk- / ghp_)." >&2',
    '  exit 1',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  writeAtomicBase(hookFile, script, { preserve: false, mode: 0o755, boundary: root, home });
  return true;
}

export function isPopulated(root, relPath) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) return { exists: false, ready: false };
  const text = fs.readFileSync(file, 'utf8');
  const ex = path.join(root, `${relPath}.example`);
  const sameAsEx = fs.existsSync(ex) && text === fs.readFileSync(ex, 'utf8');
  const ready = text.trim().length > 20 && !sameAsEx && !PLACEHOLDER_RE.test(text);
  return { exists: true, ready };
}

export function extractProfileUrls(root) {
  const urls = new Set();
  for (const rel of ['context/profile.md', 'context/resume-data.json']) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const matches = text.match(/https?:\/\/[^\s)"'>\],]+/gi) || [];
    for (const raw of matches) {
      const cleaned = raw.replace(/[.;:]+$/, '');
      if (cleaned) urls.add(cleaned);
    }
  }
  return [...urls];
}

export async function verifyProfileLinks(root, isProfileReady, { offline = false } = {}) {
  const urls = extractProfileUrls(root);
  if (!urls.length) {
    return { validSyntax: 0, placeholderCount: 0, deadUrls: [], checkedReachable: 0, total: 0 };
  }
  let validSyntax = 0;
  let placeholderCount = 0;
  let checkedReachable = 0;
  const deadUrls = [];

  for (const u of urls) {
    let parsed;
    try {
      parsed = new URL(u);
      validSyntax++;
    } catch {
      deadUrls.push(`${u} (malformed URL)`);
      continue;
    }
    const ssrfReason = isBlockedSsrfUrl(parsed);
    if (ssrfReason) {
      deadUrls.push(`${u} (blocked by SSRF guard: ${ssrfReason})`);
      continue;
    }
    if (PLACEHOLDER_RE.test(u) || /example\.|your-handle|your-site/i.test(parsed.hostname)) {
      placeholderCount++;
      continue;
    }
    if (!offline && isProfileReady && typeof fetch === 'function' && !process.env.CI) {
      checkedReachable++;
      try {
        let { response: res } = await fetchUrlWithSafeRedirects(u, {
          method: 'HEAD',
          maxRedirects: 5,
          timeoutMs: 3500,
          headers: { 'User-Agent': 'veycraft-link-check/2.0' },
        });
        if (res.status === 405 || res.status === 403) {
          ({ response: res } = await fetchUrlWithSafeRedirects(u, {
            method: 'GET',
            maxRedirects: 5,
            timeoutMs: 3500,
            headers: { 'User-Agent': 'veycraft-link-check/2.0' },
          }));
        }
        if (res.status === 404 || res.status === 410 || res.status >= 500) {
          deadUrls.push(`${u} (HTTP ${res.status})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/SSRF guard/i.test(msg)) {
          deadUrls.push(`${u} (${msg})`);
        } else {
          deadUrls.push(`${u} (unreachable)`);
        }
      }
    }
  }
  return { validSyntax, placeholderCount, deadUrls, checkedReachable, total: urls.length };
}

export function evaluateGates(root) {
  const prof = isPopulated(root, 'context/profile.md');
  const cv = isPopulated(root, 'context/cv.md');
  const hasPdf = ['assets/resume.pdf', 'context/resume.pdf'].some(rel => {
    const f = path.join(root, rel);
    try { return fs.existsSync(f) && fs.readFileSync(f).subarray(0, 5).toString() === '%PDF-'; } catch { return false; }
  });
  const g1 = prof.ready && cv.ready && hasPdf;
  const g2 = isPopulated(root, 'context/preferences.yaml').ready;
  const ansFile = path.join(root, 'context', 'form-answers.yaml');
  const ans = isPopulated(root, 'context/form-answers.yaml');
  const ownerVerified = fs.existsSync(ansFile) && /^\s*owner_verified:\s*true\b(?:\s*#.*)?$/im.test(fs.readFileSync(ansFile, 'utf8'));
  const g3 = ans.ready && ownerVerified;
  const targetsFile = path.join(root, 'context', 'targets.yaml');
  const g5 = fs.existsSync(targetsFile) && /^\s*enabled:\s*true\b(?:\s*#.*)?$/im.test(fs.readFileSync(targetsFile, 'utf8'));
  const gates = [g1, g2, g3, g5];
  const passed = gates.filter(Boolean).length;
  return { g1, g2, g3, g5, passed, total: gates.length, profReady: prof.ready };
}

export async function evaluateDoctorSnapshot({
  root,
  source,
  home = os.homedir(),
  isGlobal = false,
  strict = false,
  offline = false,
  readOnly = false,
  env = process.env,
} = {}) {
  let criticalFailures = 0;
  let readinessPending = 0;
  const events = [];
  const logOk = message => events.push({ level: 'ok', message });
  const logWarn = message => events.push({ level: 'warn', message });
  const logInfo = message => events.push({ level: 'info', message });
  const logFail = message => events.push({ level: 'fail', message });

  const { version, runtimeDeps, devDeps } = readPackageMeta(root, source);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeOk = nodeMajor >= 18;
  if (nodeOk) logOk(`OS & Runtime: ${process.platform} (${os.arch()}) · Node ${process.versions.node}`);
  else { logFail(`Node.js >= 18 required (found ${process.versions.node}). Upgrade from https://nodejs.org/.`); criticalFailures++; }

  const installed = hasInstallMarker(root) || fs.existsSync(path.join(root, 'AGENTS.md'));
  if (installed) {
    logOk(`Agent Home: ${root} (${isGlobal ? 'global' : 'local'})`);
  } else {
    logWarn(`Agent Home: not yet initialized at ${root} — run \`veycraft init --global\` (recommended) or \`veycraft init\``);
    readinessPending++;
  }

  const registryRoot = fs.existsSync(path.join(root, 'skills', 'REGISTRY.md'))
    ? root
    : (fs.existsSync(path.join(source, 'skills', 'REGISTRY.md')) ? source : null);
  let manifestCount = null;
  if (registryRoot) {
    try {
      const mPath = [path.join(registryRoot, 'skills', 'skills-manifest.json'), path.join(source, 'skills', 'skills-manifest.json')].find(f => fs.existsSync(f));
      if (mPath) {
        const parsed = JSON.parse(fs.readFileSync(mPath, 'utf8'));
        if (Array.isArray(parsed?.skills)) manifestCount = parsed.skills.length;
      }
    } catch { /* ignore */ }
    const suffix = registryRoot === root ? '' : ' (bundled in CLI package)';
    logOk(`Skill Registry: skills/REGISTRY.md present${manifestCount !== null ? ` (${manifestCount} skills in manifest)` : ''}${suffix}`);
  } else {
    logFail('Missing skills/REGISTRY.md');
    criticalFailures++;
  }

  const provenanceRoot = installed ? root : source;
  const missingOrTampered = [];
  for (const rel of ['NOTICE', 'AUTHORS.md', 'PROVENANCE.json']) {
    const f = path.join(provenanceRoot, rel);
    if (!fs.existsSync(f)) {
      missingOrTampered.push(`${rel} (missing)`);
      continue;
    }
    try {
      const txt = fs.readFileSync(f, 'utf8');
      if (rel === 'PROVENANCE.json') {
        const prov = JSON.parse(txt);
        if (prov?.github_handle !== 'redasalem') {
          missingOrTampered.push('PROVENANCE.json (github_handle mismatch)');
        }
        if (prov?.original_author !== 'Reda Salem') {
          missingOrTampered.push('PROVENANCE.json (original_author mismatch)');
        }
        if (prov?.canonical_repository !== 'https://github.com/redasalem/veycraft') {
          missingOrTampered.push('PROVENANCE.json (canonical_repository mismatch)');
        }
        if (prov?.verified_noreply_email !== PINNED_SIGNING_PRINCIPAL) {
          missingOrTampered.push('PROVENANCE.json (verified_noreply_email mismatch)');
        }
      } else if (rel === 'NOTICE') {
        if (!txt.includes('Copyright (c) 2026 Reda Salem (@redasalem)') || !hasCanonicalGitHubUrl(txt, '/redasalem/veycraft')) {
          missingOrTampered.push('NOTICE (canonical copyright or repository URL missing/tampered)');
        }
      } else if (rel === 'AUTHORS.md') {
        if (!txt.includes('Reda Salem') || !hasCanonicalGitHubUrl(txt, '/redasalem', { allowSubpath: true })) {
          missingOrTampered.push('AUTHORS.md (canonical author attribution missing/tampered)');
        }
      }
    } catch {
      missingOrTampered.push(`${rel} (unreadable/invalid)`);
    }
  }
  const provenanceVerified = missingOrTampered.length === 0;
  if (!provenanceVerified) {
    logFail(`Provenance verification FAILED (tampered or uncredited clone): ${missingOrTampered.join(', ')}`);
    criticalFailures++;
  } else {
    logOk(`Provenance & Attribution: NOTICE, AUTHORS.md & PROVENANCE.json canonical fields verified (@redasalem)${installed ? '' : ' [package]'}`);
  }

  const platDir = [path.join(root, 'skills', 'platforms'), path.join(source, 'skills', 'platforms')].find(d => fs.existsSync(d));
  let verifiedPlaybooks = 0;
  const stalePlaybooks = [];
  if (platDir) {
    for (const entry of fs.readdirSync(platDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('_') || entry.name === 'README.md') continue;
      const text = fs.readFileSync(path.join(platDir, entry.name), 'utf8');
      const m = text.match(/^last_verified:\s*"?(\d{4}-\d{2}-\d{2})"?/m);
      if (!m) {
        stalePlaybooks.push(`${entry.name} (missing last_verified)`);
        continue;
      }
      const ageDays = (Date.now() - Date.parse(`${m[1]}T00:00:00Z`)) / 86400000;
      if (Number.isNaN(ageDays) || ageDays > 60) {
        stalePlaybooks.push(`${entry.name} (${Math.floor(ageDays)}d old)`);
      } else {
        verifiedPlaybooks++;
      }
    }
    if (stalePlaybooks.length > 0) {
      logWarn(`Platform Playbook Freshness (>60d stale): ${stalePlaybooks.join(', ')}`);
    } else if (verifiedPlaybooks > 0) {
      logOk(`Platform Playbook Freshness: ${verifiedPlaybooks} playbook(s) verified within 60 days`);
    }
  }

  const checkGate = (label, cond, hint) => {
    if (cond) logOk(label);
    else { logWarn(`${label} — ${hint}`); readinessPending++; }
  };

  const gates = evaluateGates(root);
  checkGate('Gate 1 · CV & Profile', gates.g1, 'run /setup in your IDE to confirm CV & add resume.pdf');
  checkGate('Gate 2 · Target Preferences', gates.g2, 'confirm target roles, regions & work modes in /setup');
  checkGate('Gate 3/4 · Legal, Comp & Skills', gates.g3, 'confirm salary, visa, and skill years in /setup');
  checkGate('Gate 5 · Enabled Targets', gates.g5, 'enable at least one board in context/targets.yaml via /setup');

  const linkAudit = await verifyProfileLinks(root, gates.profReady, { offline });
  if (linkAudit.deadUrls.length > 0) {
    logWarn(`Profile & Resume Links: ${linkAudit.deadUrls.length} broken/dead URL(s): ${linkAudit.deadUrls.join(', ')}`);
    readinessPending++;
  } else if (linkAudit.placeholderCount > 0) {
    logInfo(`Profile & Resume Links: ${linkAudit.placeholderCount} placeholder URL(s) in context/ (replace via /setup)`);
  } else if (linkAudit.validSyntax > 0) {
    logOk(`Profile & Resume Links: ${linkAudit.validSyntax} well-formed URL(s) verified`);
  }

  const profileExists = fs.existsSync(path.join(root, 'browser-profile'));
  checkGate('Browser Profile Directory', profileExists, 'run `login` to initialize browser-profile/');

  const preCommitActive = readOnly
    ? isGitPreCommitHookActive(root)
    : installGitPreCommitHook(root, home);
  if (preCommitActive) {
    logOk('Git Pre-Commit PII Shield: .git/hooks/pre-commit active');
  }

  const mcpStatus = [];
  for (const file of mcpTargetFiles(root, isGlobal, home)) {
    if (!fs.existsSync(file)) {
      logInfo(`MCP Config: ${file} (not created yet — run sync-mcp if using this IDE)`);
      mcpStatus.push({ file, status: 'not_created' });
      continue;
    }
    try {
      const cfg = readJsonSafeBase(file, { boundary: root, home });
      const args = cfg?.mcpServers?.playwright?.args || [];
      const hasDir = Array.isArray(args) && args.some(a => typeof a === 'string' && a.startsWith('--user-data-dir='));
      if (hasDir) {
        logOk(`MCP Config: ${file}`);
        mcpStatus.push({ file, status: 'ok' });
      } else {
        logWarn(`MCP Config: ${file} missing playwright --user-data-dir`);
        mcpStatus.push({ file, status: 'missing_user_data_dir' });
        readinessPending++;
      }
    } catch {
      logFail(`MCP Config invalid JSON: ${file}`);
      mcpStatus.push({ file, status: 'invalid_json' });
      criticalFailures++;
    }
  }
  if (!isGlobal) {
    const vsFile = path.join(root, '.vscode', 'mcp.json');
    if (fs.existsSync(vsFile)) {
      try {
        const cfg = readJsonSafeBase(vsFile, { boundary: root, home });
        const args = cfg?.servers?.playwright?.args || [];
        if (Array.isArray(args) && args.some(a => typeof a === 'string' && a.startsWith('--user-data-dir='))) {
          logOk(`VS Code MCP Config: ${vsFile}`);
          mcpStatus.push({ file: vsFile, status: 'ok' });
        } else {
          logWarn(`VS Code MCP Config: ${vsFile} missing playwright --user-data-dir`);
          mcpStatus.push({ file: vsFile, status: 'missing_user_data_dir' });
        }
      } catch {
        logFail(`VS Code MCP Config invalid JSON: ${vsFile}`);
        mcpStatus.push({ file: vsFile, status: 'invalid_json' });
        criticalFailures++;
      }
    } else {
      logInfo(`VS Code MCP Config: ${vsFile} (not created yet — run sync-mcp if using VS Code/Copilot)`);
      mcpStatus.push({ file: vsFile, status: 'not_created' });
    }
  }
  const codexToml = codexConfigTomlPath(root, isGlobal, home);
  if (fs.existsSync(codexToml)) {
    const toml = fs.readFileSync(codexToml, 'utf8');
    if (/^\s*\[mcp_servers\.playwright\]/m.test(toml) && toml.includes('--user-data-dir=')) {
      logOk(`Codex MCP Config: ${codexToml}`);
      mcpStatus.push({ file: codexToml, status: 'ok' });
    } else {
      logWarn(`Codex MCP Config: ${codexToml} missing [mcp_servers.playwright] --user-data-dir`);
      mcpStatus.push({ file: codexToml, status: 'missing_user_data_dir' });
    }
  } else {
    logInfo(`Codex MCP Config: ${codexToml} (not created yet — run sync-mcp if using OpenAI Codex CLI)`);
    mcpStatus.push({ file: codexToml, status: 'not_created' });
  }

  const globalIdePaths = [];
  if (isGlobal) {
    for (const [label, p] of [
      ['~/.agents/skills', path.join(home, '.agents', 'skills')],
      ['~/.codex/AGENTS.md', path.join(resolveCodexHome(home, env), 'AGENTS.md')],
      ['~/.gemini/GEMINI.md', path.join(home, '.gemini', 'GEMINI.md')],
      ['~/.gemini/skills', path.join(home, '.gemini', 'skills')],
      ['~/.copilot/copilot-instructions.md', path.join(home, '.copilot', 'copilot-instructions.md')],
      ['~/.claude/skills', path.join(home, '.claude', 'skills')],
      ['~/.cursor/rules/job-hunter.mdc', path.join(home, '.cursor', 'rules', 'job-hunter.mdc')],
      ['~/.gemini/antigravity/global_workflows', path.join(home, '.gemini', 'antigravity', 'global_workflows')],
    ]) {
      const exists = fs.existsSync(p);
      globalIdePaths.push({ label, path: p, present: exists });
      if (exists) logOk(`Global IDE Path: ${label}`);
      else logWarn(`Global IDE Path missing: ${label} (run init --global)`);
    }
  }

  logInfo(`Optional NOTION_TOKEN: ${env.NOTION_TOKEN ? 'present (value hidden)' : 'not set (local JSON mode active)'}`);
  const nextSteps = [];
  if (!installed) {
    nextSteps.push('Run `veycraft init --global` (recommended) or `veycraft init` in your workspace to scaffold skills and IDE configs.');
  }
  nextSteps.push('Start safely in your AI IDE with `/demo` (zero personal data) or `/quick-tailor` (1 CV + 1 JD, no browser login).');
  if (gates.passed < gates.total) {
    nextSteps.push('For full browser-assisted workflows later, run `veycraft login` and `/setup` in your AI IDE.');
  }

  const okFlag = criticalFailures === 0 && (!strict || readinessPending === 0);
  const payload = {
    product: 'veycraft',
    version,
    node: process.versions.node,
    node_ok: nodeOk,
    platform: process.platform,
    arch: os.arch(),
    scope: isGlobal ? 'global' : 'local',
    root,
    global_root: resolveGlobalRoot(home, env, process.platform),
    package_source: source,
    initialized: installed,
    skills_count: manifestCount,
    provenance_verified: provenanceVerified,
    provenance_source: provenanceRoot,
    provenance_issues: missingOrTampered,
    playbooks_verified: verifiedPlaybooks,
    stale_playbooks: stalePlaybooks,
    gates: {
      cv_and_profile: gates.g1,
      target_preferences: gates.g2,
      legal_comp_skills: gates.g3,
      enabled_targets: gates.g5,
      passed: gates.passed,
      total: gates.total,
    },
    browser_profile_present: profileExists,
    git_pre_commit_shield: preCommitActive,
    notion_token_set: Boolean(env.NOTION_TOKEN),
    mcp_configs: mcpStatus,
    global_ide_paths: globalIdePaths,
    zero_dependencies: { runtime: runtimeDeps, dev: devDeps },
    safe_defaults: { dry_run_default: true, explicit_approve_required: true },
    readiness_pending: readinessPending,
    critical_failures: criticalFailures,
    ok: okFlag,
    next_steps: nextSteps,
  };
  if (offline) {
    payload.offline_mode = true;
    payload.link_audit = {
      valid_syntax: linkAudit.validSyntax,
      placeholder_count: linkAudit.placeholderCount,
      dead_urls: linkAudit.deadUrls,
      checked_reachable: linkAudit.checkedReachable,
    };
  }

  return {
    payload,
    events,
    installed,
    readinessPending,
    criticalFailures,
    exitCode: okFlag ? 0 : 1,
  };
}

function hasCanonicalGitHubUrl(text, expectedPath, { allowSubpath = false } = {}) {
  const matches = String(text || '').match(/https:\/\/[^\s)"'>\],]+/gi) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.;:]+$/, '');
    try {
      const parsed = new URL(cleaned);
      if (parsed.origin !== 'https://github.com') continue;
      const normPath = parsed.pathname.replace(/\/+$/, '');
      if (normPath === expectedPath || (allowSubpath && normPath.startsWith(`${expectedPath}/`))) {
        return true;
      }
    } catch { /* ignore invalid URL */ }
  }
  return false;
}

export function decodeHtmlEntities(str) {
  return decodeXmlHtmlEntities(str);
}

export function extractHtmlText(html) {
  const withoutBlocks = stripHtmlBlocks(String(html || ''), ['style', 'script']);
  const withNewlines = withoutBlocks.replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|header|main|article)\b[^>]*>/gi, '\n');
  return decodeHtmlEntities(stripMarkupTags(withNewlines, ' '))
    .split(/\r?\n/)
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function readCvInputText(resolved) {
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.docx') {
    const rawBuf = readFileBoundedSync(resolved, DOCX_LIMITS.MAX_INPUT_BYTES, '.docx file');
    return { text: extractDocxText(rawBuf), format: 'docx' };
  }
  const rawBuf = fs.readFileSync(resolved);
  if (rawBuf.subarray(0, 5).toString('utf8') === '%PDF-' || ext === '.pdf') {
    throw new Error('Binary/PDF file detected. Read natively if your AI IDE supports PDFs, open via Playwright MCP file:///..., or paste/export as .md/.txt/.docx for instant CLI audit.');
  }
  if (ext === '.doc' && rawBuf.length >= 4 && rawBuf[0] === 0xd0 && rawBuf[1] === 0xcf && rawBuf[2] === 0x11 && rawBuf[3] === 0xe0) {
    throw new Error('Legacy binary .doc (OLE2) detected. Save as .docx/.txt/.md or paste your CV text in chat.');
  }
  if (rawBuf.includes(0)) {
    throw new Error('Binary file detected. Pass a readable .md, .txt, .docx, .html, or Word-compatible .doc CV file.');
  }
  const rawText = rawBuf.toString('utf8');
  if (ext === '.html' || ext === '.htm' || (ext === '.doc' && /<html|<body|<p|<div/i.test(rawText))) {
    return { text: extractHtmlText(rawText), format: ext === '.doc' ? 'word-html-doc' : 'html' };
  }
  if (ext && ext !== '.md' && ext !== '.txt' && ext !== '.markdown' && ext !== '.doc') {
    throw new Error(`Unsupported file extension "${ext}". Pass .md, .txt, .docx, .html, or Word-compatible .doc.`);
  }
  return { text: rawText, format: ext.replace(/^\./, '') || 'txt' };
}

export function auditCvText(rawText, {
  format = 'md',
  resolved = '<inline>',
  root = process.cwd(),
  source = root,
  isPreExtracted = false,
} = {}) {
  if (typeof rawText !== 'string') {
    throw new Error('CV text must be a string.');
  }
  const normFormat = String(format || 'md').toLowerCase().replace(/^\./, '') || 'txt';
  const extracted = !isPreExtracted && (normFormat === 'html' || normFormat === 'htm' || normFormat === 'word-html-doc')
    ? extractHtmlText(rawText)
    : rawText;
  const trimmed = extracted.trim();
  if (!trimmed) {
    throw new Error(`CV file is empty: ${resolved}`);
  }

  const clichesFound = BANNED_AI_CLICHES.filter(cl => buildSkillRegex(cl).test(trimmed));
  const emDashCount = (trimmed.match(/—/g) || []).length;
  const tonePenalty = Math.min(25, clichesFound.length * 6 + Math.min(10, emDashCount * 2));
  const toneScore = 25 - tonePenalty;

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-*•]\s+/.test(l));
  const metricPattern = '(?<![A-Za-z0-9_])(?:\\$?\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:%|k|m|b|x|ms|sec|seconds|min|minutes|hrs|hours|days|weeks|months|years)\\b|%|[KMBX]\\b|\\+))';
  const metricGlobalRe = new RegExp(metricPattern, 'gi');
  const metricSingleRe = new RegExp(metricPattern, 'i');
  const totalMetrics = (trimmed.match(metricGlobalRe) || []).length;
  const quantifiedBullets = bullets.filter(b => metricSingleRe.test(b)).length;
  let impactScore = 0;
  if (bullets.length > 0) {
    const ratio = quantifiedBullets / bullets.length;
    impactScore = Math.min(30, Math.round(ratio * 24) + Math.min(6, totalMetrics));
  } else {
    impactScore = Math.min(30, totalMetrics * 5);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lineCount = lines.length;
  let lengthStatus = '1-Page A4 Fit';
  let lengthCategory = '1-Page A4 Fit';
  let lengthScore = 25;
  if (wordCount < 120) {
    lengthStatus = 'Too Short (<120 words)';
    lengthCategory = 'Too Short';
    lengthScore = 12;
  } else if (wordCount > 750 || lineCount > 55) {
    lengthStatus = `Overflow Risk (${wordCount} words / ${lineCount} lines)`;
    lengthCategory = 'Overflow Risk';
    lengthScore = 15;
  } else if (wordCount > 620 || lineCount > 45) {
    lengthStatus = `Tight 1-Page (${wordCount} words / ${lineCount} lines)`;
    lengthCategory = 'Tight 1-Page';
    lengthScore = 21;
  }

  const hasPlaceholder = PLACEHOLDER_RE.test(trimmed);
  const hasSecretLeak = SECRET_LEAK_RE.test(trimmed);
  const rawUrls = trimmed.match(/https?:\/\/[^\s)"'>\],]+/gi) || [];
  let badUrls = 0;
  for (const raw of rawUrls) {
    const cleaned = raw.replace(/[.;:]+$/, '');
    try {
      const parsed = new URL(cleaned);
      if (isBlockedSsrfUrl(parsed)) badUrls++;
    } catch {
      badUrls++;
    }
  }
  let hygieneScore = 20;
  if (hasPlaceholder) hygieneScore -= 8;
  if (hasSecretLeak) hygieneScore -= 12;
  if (badUrls > 0) hygieneScore -= Math.min(8, badUrls * 4);
  hygieneScore = Math.max(0, hygieneScore);

  const totalScore = toneScore + impactScore + lengthScore + hygieneScore;
  const { version } = readPackageMeta(root, source);
  const hygieneLabel = hasSecretLeak
    ? 'token flagged'
    : (hasPlaceholder ? 'placeholders' : 'clean');

  return {
    resolved,
    format: normFormat === 'htm' ? 'html' : normFormat,
    version,
    total_score: totalScore,
    tone_score: toneScore,
    impact_score: impactScore,
    length_score: lengthScore,
    hygiene_score: hygieneScore,
    cliches_found: clichesFound,
    em_dash_count: emDashCount,
    total_metrics: totalMetrics,
    quantified_bullets: quantifiedBullets,
    bullet_count: bullets.length,
    word_count: wordCount,
    line_count: lineCount,
    length_status: lengthStatus,
    length_category: lengthCategory,
    has_placeholder: hasPlaceholder,
    has_secret_leak: hasSecretLeak,
    bad_urls: badUrls,
    hygiene_label: hygieneLabel,
    scope: 'Local heuristic CV hygiene check — not an ATS acceptance probability or verification of factual claims.',
  };
}

export function auditCvFile(targetArg, { root, source, home = os.homedir(), cwd = process.cwd() } = {}) {
  const targetInfo = assertSafeCliInputPath(targetArg, { label: 'resume file', root, source, home, cwd });
  if (!targetInfo.exists) {
    throw new Error(`Resume file not found: ${targetInfo.resolved}`);
  }
  const resolved = targetInfo.resolved;
  const { text, format } = readCvInputText(resolved);
  return auditCvText(text, { format, resolved, root, source, isPreExtracted: true });
}

export const ROUTE_RULES = [
  {
    intent: 'sandbox-demo',
    matches: q => /(^|\s)\/demo\b|\bsandbox demo\b/i.test(q),
    skills: ['02-discover-and-triage', '03-tailor-resume-and-verify', '13-company-due-diligence', '14-privacy-pii-shield', '21-ats-keyword-heatmap'],
    workflow: '.agent/workflows/demo.md',
    readiness: 'none (zero personal data or browser login required)',
    required_inputs: [],
    optional_tools: [],
    fallback: 'Works offline from examples/sandbox-demo/',
    outputs: ['Mission Control table', 'Synthetic Job #1 tailored preview'],
  },
  {
    intent: 'setup-full-career-os',
    matches: q => /(^|\s)\/setup\b|\bcheck my folder\b|\b5 readiness gates\b/i.test(q),
    skills: ['00-interrogate-and-onboard', '01-resume-ingestion', '11-portfolio-and-github-auditor'],
    workflow: '.agent/workflows/setup.md',
    readiness: 'full-5-gate-onboarding',
    required_inputs: ['CV file or pasted CV', 'target roles/regions', 'comp/legal/skills_years', 'enabled platforms'],
    optional_tools: ['playwright (for live login & PDF)'],
    fallback: 'Gates 1-4 complete locally without Playwright; standalone tasks never require /setup',
    outputs: ['context/profile.md', 'context/cv.md', 'context/resume-data.json', 'context/preferences.yaml', 'context/form-answers.yaml', 'context/targets.yaml'],
  },
  {
    intent: 'daily-run',
    matches: q => /(^|\s)\/daily-run\b|\brun today'?s job run\b|\bstart applying\b/i.test(q),
    skills: ['00-daily-run', '00-interrogate-and-onboard', '02-discover-and-triage', '03-tailor-resume-and-verify', '04-fill-and-apply', '05-outreach-and-interview-prep', '06-log-and-insights'],
    workflow: '.agent/workflows/daily-run.md',
    readiness: 'full-5-gate-readiness + launch consent + browser auth',
    required_inputs: ['5 passed readiness gates', 'fresh launch confirmation'],
    optional_tools: ['playwright (required for live board automation)', 'notion'],
    fallback: 'If Playwright is absent, offer /quick-tailor or URL/pasted-JD manual prep',
    outputs: ['Mission Control table', 'logs/resumes/<job>/', 'logs/applications-log.json', 'logs/runs/YYYY-MM-DD.json'],
  },
  {
    intent: 'linkedin-profile',
    matches: q =>
      /(^|\s)\/linkedin-growth\b/i.test(q) ||
      (
        /\blinkedin\b/i.test(q) &&
        /\b(profile|headline|about|consistent|optimize|audit|review|improve|fix|seo|setup|branding|post|posts|outreach|algorithm|reach|impressions|dwell time|carousel|pdf document|comment[- ]first|comment strategy|comments?|content strategy|content pillars?|topical authority|growth|grow|engagement|funnel|services?|service page|freelance|inbound clients?|client requests?|proposal|reviews?|credibility|trust signals?)\b/i.test(q) &&
        !/\b(job|apply|jobs)\b/i.test(q)
      ) ||
      (
        /(?:لينكد\s?[إاأ]ن|لينكدان|\blinkedin\b)/i.test(q) &&
        /(?:ظبط|ضبط|تظبيط|تضبيط|عدل|عدّل|تعديل|حسن|حسّن|تحسين|راجع|مراجعة|طور|طوّر|تطوير|تجهيز|خدمات|صفحة\s+الخدمات|فريلانس|عملاء|بوست|منشور|خوارزمية|بروفايل|ملف|حساب)/i.test(q) &&
        !/(?:وظيف|وظائف|تقديم\s+على|\bjobs?\b|\bapply\b)/i.test(q)
      ) ||
      /\b(profile consistent with my cv|optimize my profile|grow my linkedin)\b/i.test(q),
    skills: ['linkedin-growth', 'profile-intelligence-engine', '03-tailor-resume-and-verify', '05-outreach-and-interview-prep', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: '.agent/workflows/linkedin-growth.md',
    readiness: 'task-specific (profile text/PDF/screenshot or signed-in Playwright + CV facts; no /setup required)',
    required_inputs: ['LinkedIn profile (pasted, PDF, screenshot, or signed-in Playwright)', 'verified CV facts'],
    optional_tools: ['playwright (for read-only profile read or APPROVE-gated live edit)'],
    fallback: 'Works 100% offline from pasted profile text, Save-to-PDF, or screenshots as DRAFT_ONLY',
    outputs: ['0-100 Recruiter-SEO & Credibility scorecard, 3-stage funnel & CV consistency gaps', 'Engine D LinkedIn Services Page & EN/AR <=75-word proposals + Feed/Comment-First/Carousel drafts in logs/insights/linkedin-seo-audit-YYYY-MM-DD.md'],
  },
  {
    intent: 'profile-intelligence',
    matches: q =>
      /(^|\s)\/profile-update\b/i.test(q) ||
      /(?:بروفايل|ملفي المهني|الملف المهني)/i.test(q) ||
      (
        /\b(optimize|improve|update|sync|tailor|review|fill|audit)\b/i.test(q) &&
        /\b(professional profile|career profile|job profile|job board profiles?|linkedin profile|github profile|portfolio profile|my profile|profile fields?|profiles? across|headline and about)\b/i.test(q) &&
        !/\bfind\b.*\bjobs?\b/i.test(q)
      ),
    skills: ['profile-intelligence-engine', '01-resume-ingestion', '03-tailor-resume-and-verify', '11-portfolio-and-github-auditor', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: '.agent/workflows/profile-update.md',
    readiness: 'task-specific (verified CV/profile facts + target role/goal; no /setup required)',
    required_inputs: ['verified CV/profile facts', 'target role, JD, or positioning goal'],
    optional_tools: ['playwright (optional for live platform read, batch-fill, and read-back verification)', 'gh CLI (optional for GitHub repo audits, marketing edits, and safe cleanup)'],
    fallback: 'Works 100% offline as a DRAFT_ONLY Profile Update Plan (schemas/profile-update-plan.schema.json) from pasted/exported profile data',
    outputs: ['logs/insights/profile-update-plan-<platform>-YYYY-MM-DD.json', 'Consolidated field-level diff & truthful verification summary'],
  },
  {
    intent: 'portfolio-design-qa',
    matches: q =>
      /(^|\s)\/portfolio-design\b/i.test(q) ||
      (
        /\bportfolio\b/i.test(q) &&
        /\b(design system|color palettes?|palettes?|colors?|typography|design tokens?|tokens?|wcag|contrast|unit tests?|component tests?|visual qa|responsive qa|overflow|console errors?|self-heal|wireframe|blueprint)\b/i.test(q) &&
        !/\b(deploy|host|publish|launch|vercel|wrangler|cloudflare|netlify|github pages|firebase|surge|audit|check\s+(?:my\s+)?portfolio\s+links?)\b/i.test(q)
      ),
    skills: ['30-portfolio-design-system-and-qa', '29-portfolio-builder-and-deployer', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: '.agent/workflows/portfolio-design.md',
    readiness: 'task-specific (verified candidate facts + isolated logs/portfolio/<site-slug>/; no /setup or Playwright required)',
    required_inputs: ['verified candidate facts / Domain Archetype', 'isolated portfolio workspace path'],
    optional_tools: ['playwright (optional for live 375px/768px/1440px viewport, overflow, and console QA)'],
    fallback: 'Works 100% offline with node --test / isolated Vitest unit suites and an automated local Node DOM/CSS verification script writing qa-report.md',
    outputs: ['DESIGN_PLAN.md & separated portfolio-data', 'WCAG-validated design-tokens.json + tokens.css', '3-layer qa-report.md within <= 3 self-healing cycles'],
  },
  {
    intent: 'build-portfolio',
    matches: q =>
      /(^|\s)\/build-portfolio\b/i.test(q) ||
      (/\bportfolio\b/i.test(q) && /\b(build|create|generate|design|scaffold|make|deploy|host|publish|launch|vercel|wrangler|cloudflare|netlify|firebase|surge)\b/i.test(q) && !/\b(audit|check)\b/i.test(q)) ||
      (/\b(update|edit|customize|redesign)\b/i.test(q) && /\bportfolio\s+(?:site|website|page|theme|layout)\b/i.test(q)),
    skills: ['29-portfolio-builder-and-deployer', '30-portfolio-design-system-and-qa', '01-resume-ingestion', '03-tailor-resume-and-verify', '11-portfolio-and-github-auditor', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: '.agent/workflows/build-portfolio.md',
    readiness: 'task-specific (verified CV/project facts + batched style/stack/hosting choices; no /setup or Playwright required)',
    required_inputs: ['verified CV/profile facts', 'style/stack/public-contact/hosting choices'],
    optional_tools: ['hosting CLI (vercel, wrangler, netlify, gh, firebase, surge)', 'playwright (optional for local/live visual preview)'],
    fallback: 'Builds locally inside isolated logs/portfolio/<site-slug>/ (LOCAL_PREVIEW_ONLY default) and exports ready-to-upload static dist/ + DNS/HTTPS instructions when no hosting CLI is used',
    outputs: ['Isolated portfolio project in logs/portfolio/<site-slug>/', 'Pre-publish PII/secret scan + local preview', 'Optional APPROVE-gated live HTTPS deployment + HTTP 200 verification'],
  },
  {
    intent: 'github-remote-ops',
    matches: q =>
      /(^|\s)\/github-remote\b|\b(no[- ]clone|without cloning|gh api|contents api|git data api|pull requests?|gh pr|gh issue|gh workflow|github actions?|workflow runs?|push commit remotely)\b/i.test(q) ||
      (/\bgithub\b/i.test(q) && /\b(license|workflows?|branches?|tags?|releases?|issues?|prs?)\b/i.test(q) && !/\b(cv|resume|portfolio|recruiter|audit)\b/i.test(q)),
    skills: ['54-github-cli-remote-manager', '14-privacy-pii-shield', 'meta-self-verification'],
    workflow: null,
    readiness: 'task-specific (authenticated gh CLI session + explicit target <owner>/<repo>; no /setup or local clone required)',
    required_inputs: ['authenticated gh CLI session (`gh auth status`)', 'target <owner>/<repo> and requested remote operation'],
    optional_tools: ['gh CLI (required for remote execution)'],
    fallback: 'Generates exact copy-pasteable `gh` CLI / `gh api` commands if `gh` is unavailable or unauthenticated',
    outputs: ['Zero-clone `gh api` file/tree commits, topics/visibility/license edits, or PR/CI status with fresh read-back verification'],
  },
  {
    intent: 'github-portfolio-audit',
    matches: q =>
      /(^|\s)\/github-audit\b/i.test(q) ||
      /\b(github audit|portfolio audit|audit (?:my )?(?:github|portfolio)|check (?:my )?portfolio links?|clean\s?up (?:my )?github|delete (?:junk|old|unused) repos?|archive (?:old|unused) repos?|extract (?:real )?projects from github|github readme|profile readme)\b/i.test(q) ||
      (/\bgithub\b/i.test(q) && /\b(repos?|repositories|readme|topics?|pinned|archive|private|delete|clean\s?up|extract|audit|optimize|polish)\b/i.test(q)),
    skills: ['11-portfolio-and-github-auditor', '01-resume-ingestion', '03-tailor-resume-and-verify', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: '.agent/workflows/github-audit.md',
    readiness: 'task-specific (gh CLI auth or GitHub/portfolio URLs + target role/goal; no /setup or Playwright required)',
    required_inputs: ['authenticated gh CLI session or GitHub/portfolio URLs', 'target role or positioning goal'],
    optional_tools: ['gh CLI (for full repo inventory, codebase inspection, and APPROVE-gated edits/cleanup)', 'playwright (optional for live portfolio visual/link verification)'],
    fallback: 'Works read-only from Playwright or pasted repo URLs/READMEs if gh CLI is unavailable; all mutations default to DRAFT_ONLY with APPROVE (and per-repo typed DELETE <owner>/<repo> for deletions)',
    outputs: ['5-tier GitHub Inventory Scorecard', 'context/github-projects.md verified CV project dossier', 'DRAFT_ONLY Before/After marketing diff & tiered cleanup matrix'],
  },
  {
    intent: 'freelance-service-publisher',
    matches: q =>
      /(^|\s)\/freelance-service\b/i.test(q) ||
      (
        !/\blinkedin\b/i.test(q) &&
        (/\b(fiverr|khamsat|upwork|mostaql|freelancer(?:\.com)?|malt)\b/i.test(q) || /\b(?:freelance|gig)\b/i.test(q) || /(?:خمسات|مستقل|فريلانس|خدمة\s+فريلانس)/i.test(q)) &&
        (/\b(publish|create|launch|build|write|setup|set up|list|listing|gig|service|package|cover image|pricing tiers?)\b/i.test(q) || /(?:انشر|نشر|انشاء|إنشاء|اضافة|إضافة|خدمة|باقات|غلاف)/i.test(q)) &&
        !/\b(bid|bids|bidding|proposal|proposals|open projects?|offers?|radar|filter|rank|batch)\b/i.test(q) &&
        !/(?:عروض|تقديم\s+عرض|فلترة|مشاريع\s+مفتوحة)/i.test(q)
      ),
    skills: ['55-freelance-profile-and-service-publisher', '14-privacy-pii-shield', '18-condition-based-browser-waiting', '24-circuit-breaker-and-antiban', 'meta-self-verification'],
    workflow: null,
    readiness: 'task-specific (service description + target freelance platform URL + verified CV/project facts; no /setup required)',
    required_inputs: ['plain-language service description', 'target freelance marketplace URL or platform name', 'verified CV/project facts'],
    optional_tools: ['playwright (optional for live profile audit, cover upload, and form filling)', 'native image generator (optional for cover artwork)'],
    fallback: 'Generates complete SEO service copy, pricing tiers, FAQs, and cover visual prompt/HTML asset locally as DRAFT_ONLY',
    outputs: ['SEO service package + pricing tiers + FAQs', 'Custom cover image asset', 'Live DOM Read-Back Table paused for APPROVE PUBLISH'],
  },
  {
    intent: 'freelance-offer-radar',
    matches: q =>
      /(^|\s)\/freelance-bid\b/i.test(q) ||
      (
        !/\blinkedin\b/i.test(q) &&
        (/\b(fiverr|khamsat|upwork|mostaql|freelancer(?:\.com)?|malt|freelance)\b/i.test(q) || /(?:مستقل|خمسات|فريلانس|عروض\s+المشاريع|تقديم\s+عرض)/i.test(q)) &&
        (/\b(bid|bids|bidding|proposal|proposals|open projects?|offers?|radar|filter|rank|batch)\b/i.test(q) || /(?:عروض|عرض|تقديم|فلترة|مشاريع\s+مفتوحة)/i.test(q))
      ),
    skills: ['56-freelance-offer-radar-and-batch-bidder', '14-privacy-pii-shield', '18-condition-based-browser-waiting', '24-circuit-breaker-and-antiban', '25-prompt-injection-defense', 'meta-self-verification'],
    workflow: null,
    readiness: 'task-specific (target freelance feed URL or pasted listings + verified stack/rate floor; no /setup required)',
    required_inputs: ['target marketplace open-projects URL or pasted listings', 'verified stack & minimum rate/budget floor'],
    optional_tools: ['playwright (optional for live feed scanning and APPROVE-gated batch bidding)'],
    fallback: 'Scores pasted open projects offline and produces concise DRAFT_ONLY proposals + tracker/freelance-proposals.md rows',
    outputs: ['Numbered Freelance Offer Radar Table (Fit Score 0-100%)', 'Concise IP-safe proposal drafts', 'tracker/freelance-proposals.md log after APPROVE <numbers>'],
  },
  {
    intent: 'interview-prep',
    matches: q => /\b(interview|take-home|coding challenge|system design)\b/i.test(q) && !/\b(rejected|rejection|rate|offer|history)\b/i.test(q),
    skills: ['05-outreach-and-interview-prep', '22-technical-assessment-architect'],
    workflow: null,
    readiness: 'task-specific (target JD/prompt + CV facts; no prior application submission required)',
    required_inputs: ['target job description / company / prompt', 'verified CV facts'],
    optional_tools: ['playwright'],
    fallback: 'Works 100% locally from pasted JD/prompt and CV facts',
    outputs: ['logs/resumes/<folder>/interview-dossier.md or assessment-blueprint.md', 'targeted technical & behavioral prep Q&As'],
  },
  {
    intent: 'offer-and-contract',
    matches: q => /\b(job offer|negotiate|salary expectation|rate check|contract|nda|msa|sow|agreement)\b/i.test(q),
    skills: ['09-offer-negotiator', '23-contract-and-nda-auditor'],
    workflow: null,
    readiness: 'task-specific (offer/contract text + verified compensation/notice floor; no /setup required)',
    required_inputs: ['offer/rate message or contract/NDA text', 'verified comp/work terms'],
    optional_tools: [],
    fallback: 'Works 100% locally as DRAFT_ONLY comparison and redline proposals',
    outputs: ['Grounded offer comparison or 6-category contract red-flag audit', 'DRAFT_ONLY reply/counter-clauses'],
  },
  {
    intent: 'application-prep-and-fill',
    matches: q => /(^|\s)\/apply-url\b|\b(prepare (?:my |an )?application|upload (?:my |the tailored )?resume to|answer (?:this |these )?application question|ats form|easy apply)\b/i.test(q),
    skills: ['03-tailor-resume-and-verify', '04-fill-and-apply', '05-outreach-and-interview-prep', '06-log-and-insights', 'meta-self-verification'],
    workflow: '.agent/workflows/apply-url.md',
    readiness: 'task-specific for prep (CV + JD + relevant answers); full gate + DOM Read-Back + explicit APPROVE for live ATS Submit',
    required_inputs: ['target job URL or JD', 'verified CV facts', 'application question answers'],
    optional_tools: ['playwright (required for live ATS upload/submit; manual prep fallback if unavailable)'],
    fallback: 'Generates complete manual package (resume.html/.doc/.txt, cover letter, answers, dossier, local tracking) via skills/fallback-no-mcp.md',
    outputs: ['logs/resumes/<folder>/ artifacts', 'Live DOM Read-Back Table + APPROVE gate (or manual upload guide)', 'logs/applications-log.json entry'],
  },
  {
    intent: 'tracking-and-insights',
    matches: q => /(^|\s)\/weekly-report\b|\b(track (?:my )?applications|application history|analy[sz]e (?:my )?rejections|why am i getting rejected|ghosted|export (?:my )?application report|update (?:an )?existing application|follow-?up|calibrate|recruiter (?:email|message|replied))\b/i.test(q),
    skills: ['06-log-and-insights', '08-follow-up-radar', '12-recruiter-inbox-triage', '16-rejection-pattern-analyzer', '17-score-calibration'],
    workflow: '.agent/workflows/weekly-report.md',
    readiness: 'task-specific (logs/applications-log.json; no Playwright or Notion required)',
    required_inputs: ['local logs/applications-log.json (and update/message if provided)'],
    optional_tools: ['notion'],
    fallback: 'Local JSON is primary truth; exports Markdown/CSV/JSON/HTML dashboard without Notion',
    outputs: ['Updated logs/applications-log.json', 'logs/insights/ or logs/exports/ report'],
  },
  {
    intent: 'job-discovery-and-triage',
    matches: q => /\b(find .*jobs?|jobs? in |remote .*jobs?|analy[sz]e this .*job|should i apply|compare these jobs|rank them|discover jobs)\b/i.test(q),
    skills: ['02-discover-and-triage', '25-prompt-injection-defense', '26-deduplication-and-blacklist-guard', '28-recruiter-brand-and-domain-intelligence', 'platforms/linkedin'],
    workflow: null,
    readiness: 'task-specific (verified CV facts + query or URLs/JDs/screenshots; no /setup wall for read-only analysis)',
    required_inputs: ['verified CV facts', 'search query or job URLs/pasted JDs/screenshots'],
    optional_tools: ['playwright (for live multi-board search; URL/JD/screenshot fallback if absent or unauthenticated)'],
    fallback: 'Searches legitimate accessible boards when authorized; otherwise scores/ranks user-supplied URLs, JDs, or screenshots without fabricating live listings',
    outputs: ['Evidence-backed shortlist/ranking with source URL + verification date', 'Verified matches vs. unknown requirements'],
  },
  {
    intent: 'tailor-cv',
    matches: q => /(^|\s)\/(?:quick-tailor|tailor-cv)\b|\b(tailor (?:my )?cv|compare (?:my )?cv against)\b/i.test(q),
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify', '21-ats-keyword-heatmap', '28-recruiter-brand-and-domain-intelligence'],
    workflow: '.agent/workflows/quick-tailor.md',
    readiness: 'task-specific (CV + 1 JD; zero browser login or /setup required)',
    required_inputs: ['candidate CV', 'target job description (or URL)'],
    optional_tools: ['playwright (optional for PDF print or URL read)'],
    fallback: 'Ask for pasted JD if URL blocked; deliver HTML + Word-compatible .doc + TXT + Print-to-PDF guidance',
    outputs: ['resume.html', 'resume.doc (Word-compatible HTML)', 'resume.txt', 'tailoring-notes.md (Evidence Map, ATS Heatmap, True Gaps)', 'optional resume.pdf'],
  },
  {
    intent: 'cv-translate',
    matches: q => /\b(arabic|english|german|french|spanish|rtl|translate)\b/i.test(q) && /\b(cv|resume)\b/i.test(q),
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify', '15-multilingual-adaptation'],
    workflow: null,
    readiness: 'task-specific (source CV + target language; preserves original file)',
    required_inputs: ['source CV', 'target language'],
    optional_tools: ['playwright (optional for PDF export)'],
    fallback: 'Outputs translated HTML/Word-compatible .doc/TXT locally without browser',
    outputs: ['Preserved original CV', 'Translated resume.html / resume.doc / resume.txt in logs/resumes/<slug>-<lang>/'],
  },
  {
    intent: 'cv-convert',
    matches: q => /\b(convert|export|make|create)\b/i.test(q) && /\b(pdf|word|word-compatible|docx|doc|html|txt)\b/i.test(q) && /\b(cv|resume)\b/i.test(q),
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify'],
    workflow: null,
    readiness: 'task-specific (source CV; no /setup required)',
    required_inputs: ['source CV'],
    optional_tools: ['playwright (for PDF export)'],
    fallback: 'If PDF/native DOCX unavailable, outputs HTML + Word-compatible .doc + TXT + Print-to-PDF instructions (never renames HTML to .docx)',
    outputs: ['resume.html', 'resume.doc (Word-compatible HTML)', 'resume.txt', 'resume.pdf (when PDF export exists)'],
  },
  {
    intent: 'cv-create',
    matches: q => /\b(create|build|write|make)\b/i.test(q) && /\b(new cv|cv from scratch|resume from scratch|from scratch)\b/i.test(q),
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify', '28-recruiter-brand-and-domain-intelligence'],
    workflow: null,
    readiness: 'task-specific (guided interview; zero /setup or browser login required)',
    required_inputs: ['guided interview answers (contact, roles/dates, projects, skills, education)'],
    optional_tools: ['playwright (optional for PDF export)'],
    fallback: 'Writes confirmed profile + ATS HTML/Word-compatible .doc/TXT locally',
    outputs: ['Confirmed Fact Table', 'context/profile.md + cv.md (when saving)', 'ATS resume.html / resume.doc / resume.txt'],
  },
  {
    intent: 'cv-edit',
    matches: q => /\b(improve|edit|update|rewrite|strengthen|shorten|reorder|remove|add .*project|change .*summary|summary|bullet)\b/i.test(q) && /\b(cv|resume|summary|project|skills|bullets|section|page)\b/i.test(q),
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify', '28-recruiter-brand-and-domain-intelligence', 'meta-self-verification'],
    workflow: null,
    readiness: 'task-specific (existing CV or session CV + requested edit; preserves original)',
    required_inputs: ['existing CV (if not already loaded)', 'requested section change'],
    optional_tools: ['playwright (optional for PDF export)'],
    fallback: 'Modifies only requested sections locally, preserves original, re-reads outputs to verify',
    outputs: ['Preserved original CV', 'Verified revised resume.html / resume.doc / resume.txt + diff summary'],
  },
  {
    intent: 'cv-review-import',
    matches: q => /\b(upload|import|review|audit|check|read|parse)\b/i.test(q) && /\b(cv|resume)\b/i.test(q),
    skills: ['01-resume-ingestion', '14-privacy-pii-shield'],
    workflow: null,
    readiness: 'task-specific (CV file or pasted text; no /setup or browser login required)',
    required_inputs: ['CV file (.md/.txt/.docx/.html/readable .pdf) or pasted text'],
    optional_tools: ['playwright (optional only for PDF reading when native PDF reader unavailable)'],
    fallback: 'Built-in CLI/text extraction; warns if PDF is scanned/unreadable and requests pasted text',
    outputs: ['Extracted Fact Table for confirmation', 'Actionable CV hygiene & structure review'],
  },
];

export function matchNaturalLanguageRoute(query) {
  const q = String(query || '').trim();
  if (!q) {
    throw new Error('Usage: veycraft route "<natural-language request>" [--json]');
  }
  const hit = ROUTE_RULES.find(r => r.matches(q)) || {
    intent: 'general-career-assistant',
    skills: ['01-resume-ingestion', '03-tailor-resume-and-verify'],
    workflow: null,
    readiness: 'task-specific (ask one clarifying question for missing goal/file)',
    required_inputs: ['clarify desired career outcome or share CV/JD'],
    optional_tools: ['playwright', 'notion'],
    fallback: 'Inspect context/ first and ask 1 targeted question',
    outputs: ['Focused next step without forcing /setup'],
  };
  return { query: q, ...hit };
}

export function verifyArtifactFile(filePath, factsConfig = null) {
  const errors = [];
  const warnings = [];
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  if (ext === '.docx') {
    let rawBuf;
    try {
      rawBuf = readFileBoundedSync(filePath, DOCX_LIMITS.MAX_INPUT_BYTES, '.docx file');
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      return { name, errors, warnings };
    }
    if (rawBuf.length === 0) {
      errors.push(`${name}: file is empty (0 bytes)`);
      return { name, errors, warnings };
    }
    try {
      extractDocxText(rawBuf);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
    return { name, errors, warnings };
  }
  const rawBuf = fs.readFileSync(filePath);

  if (rawBuf.length === 0) {
    errors.push(`${name}: file is empty (0 bytes)`);
    return { name, errors, warnings };
  }
  if (ext === '.pdf') {
    if (rawBuf.subarray(0, 5).toString('utf8') !== '%PDF-') {
      errors.push(`${name}: invalid PDF header (does not start with %PDF-)`);
    } else if (rawBuf.length > 200 * 1024) {
      warnings.push(`${name}: PDF size is ${Math.round(rawBuf.length / 1024)} KB (target <= 200 KB)`);
    }
    return { name, errors, warnings };
  }
  if (ext === '.json') {
    let parsed;
    try {
      parsed = JSON.parse(rawBuf.toString('utf8'));
    } catch (e) {
      errors.push(`${name}: invalid JSON (${e.message})`);
      return { name, errors, warnings };
    }
    if (isObj(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'schema_version') && Object.prototype.hasOwnProperty.call(parsed, 'changes')) {
      const res = validateProfileUpdatePlan(parsed, { factsConfig });
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'fact_provenance')) {
      const res = validateProfileVault(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    const isSkippedJobsArray = Array.isArray(parsed) && (
      /^skipped-jobs\.json$/i.test(name) ||
      (parsed.length > 0 && parsed.every(item => isObj(item) && (Object.prototype.hasOwnProperty.call(item, 'skip_reason') || Object.prototype.hasOwnProperty.call(item, 'skipped_at')) && !Object.prototype.hasOwnProperty.call(item, 'status')))
    );
    const isApplicationLedgerArray = Array.isArray(parsed) && !isSkippedJobsArray && (
      /^applications-log\.json$/i.test(name) ||
      (parsed.length > 0 && parsed.some(item => isObj(item) && (Object.prototype.hasOwnProperty.call(item, 'application_id') || (Object.prototype.hasOwnProperty.call(item, 'job_id') && Object.prototype.hasOwnProperty.call(item, 'status')))))
    );
    if (isApplicationLedgerArray) {
      const res = validateApplicationLedger(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'schema_version') && Array.isArray(parsed.versions)) {
      const res = validateCvVersionsRegistry(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'run_id') && Object.prototype.hasOwnProperty.call(parsed, 'counts')) {
      const res = validateDailyRun(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && parsed.kind === 'session_checkpoint') {
      const res = validateSessionCheckpoint(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'type') && Object.prototype.hasOwnProperty.call(parsed, 'period') && Object.prototype.hasOwnProperty.call(parsed, 'generated_at')) {
      const res = validateCareerInsights(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && parsed.eligibility_policy === 'submitted_only' && Array.isArray(parsed.operations)) {
      const res = validateNotionSyncPlan(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    if (isObj(parsed) && parsed.schema_version === '1.0' && isObj(parsed.records) && Object.prototype.hasOwnProperty.call(parsed, 'updated_at')) {
      const res = verifySyncStateIntegrity(parsed);
      return { name, errors: res.errors.map(err => `${name}: ${err}`), warnings: res.warnings };
    }
    return { name, errors, warnings };
  }

  const rawText = rawBuf.toString('utf8');
  const textRes = verifyArtifactText(rawText, { format: ext, name, factsConfig });
  return { name: textRes.name, errors: textRes.errors, warnings: textRes.warnings };
}

export function verifyArtifactText(rawText, {
  format = 'html',
  name = 'inline.html',
  factsConfig = null,
  factsText = null,
  factsJson = null,
} = {}) {
  if (typeof rawText !== 'string') {
    throw new Error('Artifact text must be a string.');
  }
  const errors = [];
  const warnings = [];
  const cleanFormat = String(format || path.extname(name) || 'html').toLowerCase().replace(/^\./, '') || 'html';
  const ext = `.${cleanFormat}`;
  if (rawText.length === 0) {
    errors.push(`${name}: file is empty (0 bytes)`);
    return { name, format: cleanFormat, ok: false, errors, warnings };
  }

  let effectiveFacts = factsConfig;
  if (!effectiveFacts && isObj(factsJson)) {
    const allowedMetrics = new Set(
      (Array.isArray(factsJson.ground_truth_metrics) ? factsJson.ground_truth_metrics : []).map(m => String(m).trim().toLowerCase()),
    );
    const forbiddenSkills = Array.isArray(factsJson.forbidden_skills)
      ? factsJson.forbidden_skills.filter(s => typeof s === 'string' && s.trim())
      : [];
    effectiveFacts = { allowedMetrics, forbiddenSkills };
  } else if (!effectiveFacts && typeof factsText === 'string' && factsText.trim()) {
    const metricTokenRe = /(?<![A-Za-z0-9_])\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|k|m|b|x|ms|sec|seconds|min|minutes|hrs|hours|days|weeks|months|years)\b|%|[KMBX]\b|\+)/gi;
    const allowedMetrics = new Set((factsText.match(metricTokenRe) || []).map(m => m.trim().toLowerCase()));
    effectiveFacts = { allowedMetrics, forbiddenSkills: [] };
  }

  if (/\{\{[A-Za-z0-9_]+\}\}/.test(rawText)) {
    const matches = rawText.match(/\{\{[A-Za-z0-9_]+\}\}/g) || [];
    errors.push(`${name}: unresolved template placeholder(s): ${[...new Set(matches)].join(', ')}`);
  }

  let prose = rawText;
  const isNotesDoc = /^(?:tailoring-notes|interview-dossier)\b/i.test(name);
  const isLinkedinAudit = /^linkedin-seo-audit\b/i.test(name);
  if (ext === '.html' || ext === '.htm' || (ext === '.doc' && /<html|<body/i.test(rawText))) {
    const bodyWithoutTitle = rawText.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ');
    const proseMatches = [...bodyWithoutTitle.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)];
    prose = proseMatches.map(m => extractHtmlText(m[1])).join('\n') || extractHtmlText(bodyWithoutTitle);
    const fullPlain = extractHtmlText(bodyWithoutTitle);
    const cliches = BANNED_AI_CLICHES.filter(cl => buildSkillRegex(cl).test(fullPlain));
    if (cliches.length > 0) errors.push(`${name}: banned AI cliché(s) found: ${cliches.join(', ')}`);
  } else if (!isNotesDoc) {
    const nonHeadingLines = rawText
      .split(/\r?\n/)
      .filter(l => !/^\s*(?:#{1,6}\s|\*\*[^*]+—[^*]+\*\*)/.test(l));
    prose = nonHeadingLines.join('\n');
    const cliches = BANNED_AI_CLICHES.filter(cl => buildSkillRegex(cl).test(rawText));
    if (cliches.length > 0) errors.push(`${name}: banned AI cliché(s) found: ${cliches.join(', ')}`);
  }

  if (!isNotesDoc && prose.includes('—')) {
    errors.push(`${name}: prose em-dash (—) detected inside paragraph/bullet text`);
  }

  if (effectiveFacts && (ext === '.html' || ext === '.htm' || ext === '.doc' || ext === '.txt' || ext === '.md') && !isNotesDoc) {
    let plain = (ext === '.html' || ext === '.htm' || ext === '.doc') ? extractHtmlText(rawText) : rawText;
    if (isLinkedinAudit) {
      plain = plain.split(/\r?\n/).filter(l => !/True Gaps/i.test(l)).join('\n');
    }
    const metricTokenRe = /(?<![A-Za-z0-9_])\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|k|m|b|x|ms|sec|seconds|min|minutes|hrs|hours|days|weeks|months|years)\b|%|[KMBX]\b|\+)/gi;
    const foundMetrics = plain.match(metricTokenRe) || [];
    const unverified = foundMetrics.filter(tok => !effectiveFacts.allowedMetrics.has(tok.trim().toLowerCase()));
    if (unverified.length > 0) {
      errors.push(`${name}: unverified metric token(s) not in source facts: ${[...new Set(unverified)].join(', ')}`);
    }
    const forbidden = effectiveFacts.forbiddenSkills.filter(sk => buildSkillRegex(sk).test(plain));
    if (forbidden.length > 0) {
      errors.push(`${name}: forbidden/unclaimed skill(s) found: ${forbidden.join(', ')}`);
    }
  }
  return { name, format: cleanFormat, ok: errors.length === 0, errors, warnings };
}

export function loadFactsConfig(factsPath, { root, source, home = os.homedir(), cwd = process.cwd() } = {}) {
  const factsInfo = assertSafeCliInputPath(factsPath, { label: 'facts file', root, source, home, cwd });
  if (!factsInfo.exists) throw new Error(`Facts file not found: ${factsInfo.resolved}`);
  const resolved = factsInfo.resolved;
  const text = fs.readFileSync(resolved, 'utf8');
  if (resolved.endsWith('.json')) {
    const parsed = JSON.parse(text);
    const allowedMetrics = new Set(
      (Array.isArray(parsed.ground_truth_metrics) ? parsed.ground_truth_metrics : []).map(m => String(m).trim().toLowerCase()),
    );
    const forbiddenSkills = Array.isArray(parsed.forbidden_skills) ? parsed.forbidden_skills : [];
    return { allowedMetrics, forbiddenSkills };
  }
  const metricTokenRe = /(?<![A-Za-z0-9_])\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|k|m|b|x|ms|sec|seconds|min|minutes|hrs|hours|days|weeks|months|years)\b|%|[KMBX]\b|\+)/gi;
  const allowedMetrics = new Set((text.match(metricTokenRe) || []).map(m => m.trim().toLowerCase()));
  return { allowedMetrics, forbiddenSkills: [] };
}

export function verifyArtifactTarget(targetArg, {
  factsPath = null,
  root,
  source,
  home = os.homedir(),
  cwd = process.cwd(),
} = {}) {
  const targetInfo = assertSafeCliInputPath(targetArg, {
    label: 'verify target',
    allowDirectory: true,
    root,
    source,
    home,
    cwd,
  });
  if (!targetInfo.exists) {
    throw new Error(`Target path not found: ${targetInfo.resolved}`);
  }
  const resolved = targetInfo.resolved;
  const factsConfig = factsPath ? loadFactsConfig(factsPath, { root, source, home, cwd }) : null;
  const stat = targetInfo.stat;
  const files = stat.isDirectory()
    ? fs.readdirSync(resolved)
        .filter(f => /\.(html|doc|docx|txt|pdf|md)$/i.test(f))
        .sort()
        .map(f => {
          const childPath = path.join(resolved, f);
          refuseSymlinkBase(childPath, targetInfo.boundary, home);
          const childStat = fs.lstatSync(childPath);
          if (childStat.isSymbolicLink() || !childStat.isFile()) {
            throw new Error(`Refusing symbolic-link or non-regular file in verify directory: ${childPath}`);
          }
          return childPath;
        })
    : [resolved];

  if (files.length === 0) {
    throw new Error(`No resume/deliverable files found in ${resolved}`);
  }

  let errorCount = 0;
  let warningCount = 0;
  const results = [];
  for (const f of files) {
    const res = verifyArtifactFile(f, factsConfig);
    errorCount += res.errors.length;
    warningCount += res.warnings.length;
    results.push({
      name: res.name,
      path: f,
      ok: res.errors.length === 0,
      errors: res.errors,
      warnings: res.warnings,
    });
  }

  return {
    resolved,
    file_count: files.length,
    error_count: errorCount,
    warning_count: warningCount,
    ok: errorCount === 0,
    results,
  };
}

export function evaluatePreSubmitWithDraft(root, {
  platform = null,
  company = null,
  title = null,
  url = null,
  jobId = null,
  draft = null,
  text = null,
  maxWords = 75,
} = {}, {
  home = os.homedir(),
  source,
  cwd = process.cwd(),
} = {}) {
  const gate = evaluatePreSubmitGate(root, {
    platform,
    company,
    title,
    url,
    job_id: jobId,
  }, { home, sourceRoot: source });

  const violations = [...gate.violations];
  const warnings = [];
  let draftReport = null;

  let draftContent = null;
  let draftSource = null;
  if (draft) {
    const draftInfo = assertSafeCliInputPath(draft, { label: 'draft file', root, source, home, cwd });
    if (!draftInfo.exists) {
      throw new Error(`Draft file not found: ${draftInfo.resolved}`);
    }
    draftContent = fs.readFileSync(draftInfo.resolved, 'utf8');
    draftSource = draftInfo.resolved;
  } else if (text !== null && text !== undefined) {
    draftContent = String(text);
    draftSource = '--text';
  }

  if (draftContent !== null) {
    const words = draftContent.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const hasEmDash = draftContent.includes('—');
    const bannedCliches = BANNED_AI_CLICHES.filter(cl => buildSkillRegex(cl).test(draftContent));
    draftReport = {
      source: draftSource,
      word_count: wordCount,
      max_words: maxWords,
      ok: wordCount > 0 && wordCount <= maxWords && bannedCliches.length === 0 && !hasEmDash,
      has_em_dash: hasEmDash,
      banned_cliches: bannedCliches,
    };
    if (wordCount === 0) {
      violations.push({ code: 'draft_empty', message: `Draft (${draftSource}) is empty (0 words).` });
    } else if (wordCount > maxWords) {
      violations.push({ code: 'draft_word_cap_exceeded', message: `Draft Word Cap EXCEEDED: ${wordCount}/${maxWords} words (${draftSource}). Trim before sending.` });
    }
    if (bannedCliches.length > 0) {
      violations.push({
        code: 'draft_banned_cliches',
        message: `Draft contains banned AI cliché(s) in ${draftSource}: ${bannedCliches.join(', ')}. Rewrite with plain, grounded language.`,
      });
    }
    if (hasEmDash) {
      violations.push({
        code: 'draft_prose_em_dash',
        message: `Draft contains prose em-dash (—) in ${draftSource}; replace with periods or commas before sending.`,
      });
    }
  }

  const invFile = [path.join(root, 'config', 'invariants.txt'), path.join(source, 'config', 'invariants.txt')].find(f => fs.existsSync(f));
  const invariantsText = invFile ? fs.readFileSync(invFile, 'utf8').trim() : null;

  return {
    root,
    allowed: violations.length === 0,
    dry_run: gate.dry_run,
    violations,
    warnings,
    checks: { ...gate.checks, draft: draftReport },
    invariants_file: invFile || null,
    invariants_text: invariantsText,
  };
}

export const MCP_QUIET_NPM_ENV = Object.freeze({
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_LOGLEVEL: 'error',
});

export function toPlatformMcpServer(cfg, platform = process.platform) {
  const env = { ...MCP_QUIET_NPM_ENV, ...(isObj(cfg.env) ? cfg.env : {}) };
  if (platform === 'win32' && cfg.command === 'npx') {
    return {
      ...cfg,
      command: 'cmd',
      args: ['/c', 'npx', ...cfg.args],
      env,
    };
  }
  return { ...cfg, env };
}

export function formatTomlMcpSection(name, cfg) {
  const q = v => JSON.stringify(String(v));
  const argsList = (cfg.args || []).map(q).join(', ');
  const envEntries = Object.entries(cfg.env || {})
    .map(([k, v]) => `${q(k)} = ${q(v)}`)
    .join(', ');
  const lines = [
    `[mcp_servers.${name}]`,
    `command = ${q(cfg.command)}`,
    `args = [${argsList}]`,
  ];
  if (envEntries) lines.push(`env = { ${envEntries} }`);
  return lines.join('\n') + '\n';
}

export function findTomlSectionRange(lines, sectionHeader) {
  const start = lines.findIndex(line => line.trim() === sectionHeader);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function upsertTomlMcpServer(tomlText, name, cfg) {
  const section = formatTomlMcpSection(name, cfg);
  const lines = tomlText ? tomlText.replace(/\r\n/g, '\n').split('\n') : [];
  const header = `[mcp_servers.${name}]`;
  const range = findTomlSectionRange(lines, header);
  if (range) {
    const existingBlock = lines
      .slice(range.start, range.end)
      .filter(l => l.trim() !== '')
      .join('\n') + '\n';
    const expectedBlock = section.trimEnd() + '\n';
    if (existingBlock === expectedBlock) return { status: 'unchanged', text: tomlText };
    return { status: 'preserved', text: tomlText };
  }
  const trimmed = tomlText.replace(/\r\n/g, '\n').trimEnd();
  const next = trimmed ? `${trimmed}\n\n${section}` : section;
  return { status: 'added', text: next };
}

export function syncMcpConfigs({
  root,
  isGlobal = false,
  source = root,
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  withVeycraft = false,
  dryRun = false,
  backup = true,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedSource = path.resolve(source);
  const templatePath = [
    path.join(resolvedRoot, 'mcp', 'mcp.template.json'),
    path.join(resolvedSource, 'mcp', 'mcp.template.json'),
  ].find(f => fs.existsSync(f));
  if (!templatePath) throw new Error('mcp/mcp.template.json not found. Run init first.');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const tplPlaywright = template?.mcpServers?.playwright;
  if (!isObj(tplPlaywright) || !Array.isArray(tplPlaywright.args)) {
    throw new Error('Invalid mcp/mcp.template.json playwright server definition.');
  }

  const profileDir = path.join(resolvedRoot, 'browser-profile');
  const rawPlaywrightCfg = {
    ...tplPlaywright,
    args: tplPlaywright.args.map(a => (a.startsWith('--user-data-dir=') ? `--user-data-dir=${profileDir}` : a)),
  };
  if (!rawPlaywrightCfg.args.some(a => a.startsWith('--user-data-dir='))) {
    rawPlaywrightCfg.args.push(`--user-data-dir=${profileDir}`);
  }
  const playwrightCfg = toPlatformMcpServer(rawPlaywrightCfg, platform);
  const notionCfg = isObj(template.mcpServers?.notion) && Array.isArray(template.mcpServers.notion.args)
    ? toPlatformMcpServer(template.mcpServers.notion, platform)
    : null;

  let veycraftCfg = null;
  if (withVeycraft) {
    const rawVeycraftArgs = ['-y', 'veycraft', 'mcp', ...(isGlobal ? ['--global'] : [])];
    const rawVeycraftEnv = env.VEYCRAFT_HOME && String(env.VEYCRAFT_HOME).trim()
      ? { VEYCRAFT_HOME: path.resolve(String(env.VEYCRAFT_HOME).trim()) }
      : {};
    veycraftCfg = toPlatformMcpServer({
      command: 'npx',
      args: rawVeycraftArgs,
      env: rawVeycraftEnv,
    }, platform);
  }

  let updated = 0;
  const warnings = [];
  const operations = [];

  function writeTargetSafe(file, nextText, label) {
    refuseSymlinkBase(file, resolvedRoot, home);
    const existed = fs.existsSync(file);
    const prevText = existed ? fs.readFileSync(file, 'utf8') : null;
    if (existed && prevText === nextText) {
      operations.push({ file, label, action: 'unchanged', backup_path: null });
      return false;
    }
    const backupPath = existed && backup ? `${file}.veycraft.bak` : null;
    if (dryRun) {
      updated++;
      operations.push({
        file,
        label,
        action: existed ? 'would_update' : 'would_create',
        backup_path: backupPath,
      });
      return true;
    }
    if (existed && backupPath) {
      refuseSymlinkBase(backupPath, resolvedRoot, home);
      writeAtomicBase(backupPath, prevText, { preserve: false, mode: 0o600, boundary: resolvedRoot, home });
    }
    writeAtomicBase(file, nextText, { preserve: false, mode: 0o600, boundary: resolvedRoot, home });
    updated++;
    operations.push({
      file,
      label,
      action: existed ? 'updated' : 'created',
      backup_path: backupPath,
    });
    return true;
  }

  const targets = mcpTargetFiles(resolvedRoot, isGlobal, home);
  for (const file of targets) {
    const current = readJsonSafeBase(file, { boundary: resolvedRoot, home });
    const servers = isObj(current.mcpServers) ? { ...current.mcpServers } : {};
    let allowPlaywrightMerge = true;
    if (servers.playwright && JSON.stringify(servers.playwright) !== JSON.stringify(playwrightCfg)) {
      warnings.push(`Preserved existing custom playwright MCP server in ${file}`);
      allowPlaywrightMerge = false;
      if (!withVeycraft) {
        operations.push({ file, label: 'Playwright MCP', action: 'preserved', backup_path: null });
        continue;
      }
    }
    if (allowPlaywrightMerge) {
      servers.playwright = playwrightCfg;
      if (env.NOTION_TOKEN && notionCfg && !servers.notion) {
        servers.notion = notionCfg;
      }
    }
    if (withVeycraft && veycraftCfg) {
      if (servers.veycraft && JSON.stringify(servers.veycraft) !== JSON.stringify(veycraftCfg)) {
        warnings.push(`Preserved existing custom veycraft MCP server in ${file}`);
      } else {
        servers.veycraft = veycraftCfg;
      }
    }
    const nextText = JSON.stringify({ ...current, mcpServers: servers }, null, 2) + '\n';
    writeTargetSafe(file, nextText, withVeycraft ? 'Playwright + Veycraft MCP' : 'Playwright MCP');
  }

  if (!isGlobal) {
    const vscodeMcp = path.join(resolvedRoot, '.vscode', 'mcp.json');
    const current = readJsonSafeBase(vscodeMcp, { boundary: resolvedRoot, home });
    const servers = isObj(current.servers) ? { ...current.servers } : {};
    const vsPlaywright = { type: 'stdio', ...playwrightCfg };
    let allowVsPlaywright = true;
    if (servers.playwright && JSON.stringify(servers.playwright) !== JSON.stringify(vsPlaywright)) {
      warnings.push(`Preserved existing custom playwright MCP server in ${vscodeMcp}`);
      allowVsPlaywright = false;
    }
    if (allowVsPlaywright) {
      servers.playwright = vsPlaywright;
      if (env.NOTION_TOKEN && notionCfg && !servers.notion) {
        servers.notion = { type: 'stdio', ...notionCfg };
      }
    }
    if (withVeycraft && veycraftCfg) {
      const vsVeycraft = { type: 'stdio', ...veycraftCfg };
      if (servers.veycraft && JSON.stringify(servers.veycraft) !== JSON.stringify(vsVeycraft)) {
        warnings.push(`Preserved existing custom veycraft MCP server in ${vscodeMcp}`);
      } else {
        servers.veycraft = vsVeycraft;
      }
    }
    if (allowVsPlaywright || withVeycraft) {
      const nextText = JSON.stringify({ ...current, servers }, null, 2) + '\n';
      writeTargetSafe(vscodeMcp, nextText, 'VS Code MCP');
    } else {
      operations.push({ file: vscodeMcp, label: 'VS Code MCP', action: 'preserved', backup_path: null });
    }
  }

  const codexToml = isGlobal
    ? path.join(resolveCodexHome(home, env), 'config.toml')
    : path.join(resolvedRoot, '.codex', 'config.toml');
  refuseSymlinkBase(codexToml, resolvedRoot, home);
  let tomlText = fs.existsSync(codexToml) ? fs.readFileSync(codexToml, 'utf8') : '';
  let tomlChanged = false;
  const pwRes = upsertTomlMcpServer(tomlText, 'playwright', playwrightCfg);
  if (pwRes.status === 'preserved') {
    warnings.push(`Preserved existing custom playwright MCP server in ${codexToml}`);
  } else {
    tomlText = pwRes.text;
    if (pwRes.status === 'added') tomlChanged = true;
    if (env.NOTION_TOKEN && notionCfg) {
      const notionRes = upsertTomlMcpServer(tomlText, 'notion', notionCfg);
      if (notionRes.status === 'added') {
        tomlText = notionRes.text;
        tomlChanged = true;
      }
    }
  }
  if (withVeycraft && veycraftCfg) {
    const vcRes = upsertTomlMcpServer(tomlText, 'veycraft', veycraftCfg);
    if (vcRes.status === 'preserved') {
      warnings.push(`Preserved existing custom veycraft MCP server in ${codexToml}`);
    } else if (vcRes.status === 'added') {
      tomlText = vcRes.text;
      tomlChanged = true;
    }
  }
  if (tomlChanged) {
    writeTargetSafe(codexToml, tomlText, 'Codex CLI MCP');
  } else {
    operations.push({
      file: codexToml,
      label: 'Codex CLI MCP',
      action: pwRes.status === 'preserved' ? 'preserved' : 'unchanged',
      backup_path: null,
    });
  }

  if (!dryRun && notionCfg) {
    writeAtomicBase(
      path.join(resolvedRoot, 'mcp', 'notion.import.json'),
      JSON.stringify({ mcpServers: { notion: notionCfg } }, null, 2) + '\n',
      { preserve: true, mode: 0o600, boundary: resolvedRoot, home },
    );
  }

  return {
    root: resolvedRoot,
    is_global: Boolean(isGlobal),
    dry_run: Boolean(dryRun),
    with_veycraft: Boolean(withVeycraft),
    updated,
    operations,
    warnings,
  };
}
