// Zero-dependency shared filesystem safety, atomic I/O & SSRF helpers for Veycraft.
// Extracted verbatim from bin/cli.mjs — uses Node.js built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function normalizePathForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSamePath(a, b) {
  return path.relative(normalizePathForCompare(a), normalizePathForCompare(b)) === '';
}

export function isObj(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isWithinDir(targetPath, dirPath) {
  const rel = path.relative(normalizePathForCompare(dirPath), normalizePathForCompare(targetPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function refuseSymlink(target, boundary, home = os.homedir()) {
  if (typeof boundary !== 'string' || !boundary.trim()) {
    throw new Error('refuseSymlink requires an explicit non-empty boundary path.');
  }
  let cursor = path.resolve(target);
  const resolvedRoot = path.resolve(boundary);
  const resolvedHome = path.resolve(home);

  let stop;
  let stopInclusive = true;
  if (isWithinDir(cursor, resolvedRoot)) {
    stop = resolvedRoot;
    stopInclusive = true;
  } else if (isWithinDir(cursor, resolvedHome)) {
    stop = resolvedHome;
    stopInclusive = false;
  } else {
    stop = cursor;
    stopInclusive = true;
  }

  while (true) {
    if (!stopInclusive && cursor === stop) return;
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat?.isSymbolicLink()) {
      throw new Error(`Refusing symbolic-link destination: ${cursor}`);
    }
    if (cursor === stop) return;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function writeAtomic(file, content, { preserve = false, mode = 0o644, boundary, home = os.homedir() } = {}) {
  refuseSymlink(file, boundary, home);
  if (preserve && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, content, { flag: 'wx', mode });
  try {
    const retryDelays = [50, 150, 300];
    let lastErr = null;
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        fs.renameSync(tmp, file);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < retryDelays.length && (err?.code === 'EPERM' || err?.code === 'EBUSY')) {
          sleepSync(retryDelays[attempt]);
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
    if (process.platform !== 'win32') {
      try { fs.chmodSync(file, mode); } catch { /* ignore */ }
    }
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch { /* ignore cleanup error so primary error is preserved */ }
  }
  return true;
}

export function readJsonSafe(file, { boundary, home = os.homedir() } = {}) {
  refuseSymlink(file, boundary, home);
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Invalid JSON in ${file}; refusing to overwrite.`);
  }
  if (!isObj(parsed)) throw new Error(`Unsupported JSON root in ${file}; expected object.`);
  return parsed;
}

export function isBlockedSsrfUrl(parsedUrl) {
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return 'non-HTTP(S) protocol';
  }
  const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:1') {
    return 'loopback/localhost host';
  }
  // Check IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (host.startsWith('::ffff:') || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return 'private/link-local IPv6 address';
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return 'private/loopback/link-local IPv4 range';
    }
  }
  return null;
}
