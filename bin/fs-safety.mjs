// Zero-dependency shared filesystem safety, atomic I/O & SSRF helpers for Veycraft.
// Extracted verbatim from bin/cli.mjs — uses Node.js built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

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

function classifyIpv4Octets(a, b, c, d) {
  if (
    !Number.isInteger(a) || a < 0 || a > 255 ||
    !Number.isInteger(b) || b < 0 || b > 255 ||
    !Number.isInteger(c) || c < 0 || c > 255 ||
    !Number.isInteger(d) || d < 0 || d > 255
  ) {
    return 'invalid IPv4 address';
  }
  if (a === 0) return 'unspecified IPv4 range (0.0.0.0/8)';
  if (a === 10) return 'private IPv4 range (10.0.0.0/8)';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT IPv4 range (100.64.0.0/10)';
  if (a === 127) return 'loopback IPv4 range (127.0.0.0/8)';
  if (a === 169 && b === 254) return 'link-local/metadata IPv4 range (169.254.0.0/16)';
  if (a === 172 && b >= 16 && b <= 31) return 'private IPv4 range (172.16.0.0/12)';
  if (a === 192 && b === 0 && c === 0) return 'IETF protocol assignment IPv4 range (192.0.0.0/24)';
  if (a === 192 && b === 0 && c === 2) return 'documentation IPv4 range (192.0.2.0/24)';
  if (a === 192 && b === 168) return 'private IPv4 range (192.168.0.0/16)';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking IPv4 range (198.18.0.0/15)';
  if (a === 198 && b === 51 && c === 100) return 'documentation IPv4 range (198.51.100.0/24)';
  if (a === 203 && b === 0 && c === 113) return 'documentation IPv4 range (203.0.113.0/24)';
  if (a >= 224) return 'multicast/reserved IPv4 range (224.0.0.0/3)';
  return null;
}

function parseIpv6ToWords(hostStr) {
  // Strip IPv6 zone index if present (%25... or %...)
  const zoneIdx = hostStr.indexOf('%');
  const clean = zoneIdx >= 0 ? hostStr.slice(0, zoneIdx) : hostStr;
  if (!clean || !clean.includes(':')) return null;

  let working = clean;
  // Support dotted-quad IPv4 suffix inside IPv6 (e.g. ::127.0.0.1 or ::ffff:169.254.169.254)
  const lastColon = working.lastIndexOf(':');
  const tail = working.slice(lastColon + 1);
  if (tail.includes('.')) {
    const m = tail.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const octs = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (octs.some(o => o < 0 || o > 255)) return null;
    const hi = ((octs[0] << 8) | octs[1]).toString(16);
    const lo = ((octs[2] << 8) | octs[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const dblParts = working.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = s => {
    if (!s) return [];
    const tokens = s.split(':');
    const out = [];
    for (const tok of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(tok)) return null;
      out.push(parseInt(tok, 16));
    }
    return out;
  };

  if (dblParts.length === 1) {
    const words = parseSide(dblParts[0]);
    return (words && words.length === 8) ? words : null;
  }

  const left = parseSide(dblParts[0]);
  const right = parseSide(dblParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function classifyIpv6Words(w) {
  if (!Array.isArray(w) || w.length !== 8) return 'invalid IPv6 address';
  const allZeroPrefix6 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0;
  // ::/128 unspecified
  if (allZeroPrefix6 && w[6] === 0 && w[7] === 0) return 'unspecified IPv6 address (::/128)';
  // ::1/128 loopback
  if (allZeroPrefix6 && w[6] === 0 && w[7] === 1) return 'loopback IPv6 address (::1/128)';

  // IPv4-compatible IPv6 ::/96 (deprecated RFC 4291, e.g. [::127.0.0.1] -> ::7f00:1 or [::169.254.169.254] -> ::a9fe:a9fe)
  if (allZeroPrefix6) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    const v4Reason = classifyIpv4Octets(a, b, c, d);
    return v4Reason ? `IPv4-compatible IPv6 (${v4Reason})` : 'deprecated IPv4-compatible IPv6 range (::/96)';
  }

  // IPv4-mapped IPv6 ::ffff:0:0/96
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    const v4Reason = classifyIpv4Octets(a, b, c, d);
    return v4Reason ? `IPv4-mapped IPv6 (${v4Reason})` : 'IPv4-mapped IPv6 address (::ffff:0:0/96)';
  }

  // IPv4-translated IPv6 ::ffff:0:0:0/96 (RFC 2765 SIIT)
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0xffff && w[5] === 0) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    const v4Reason = classifyIpv4Octets(a, b, c, d);
    return v4Reason ? `IPv4-translated IPv6 (${v4Reason})` : 'IPv4-translated IPv6 address (::ffff:0:0:0/96)';
  }

  // NAT64 Well-Known Prefix 64:ff9b::/96 and 64:ff9b:1::/48
  if (
    (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) ||
    (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 1)
  ) {
    const a = (w[6] >> 8) & 0xff;
    const b = w[6] & 0xff;
    const c = (w[7] >> 8) & 0xff;
    const d = w[7] & 0xff;
    const v4Reason = classifyIpv4Octets(a, b, c, d);
    return v4Reason ? `NAT64 embedded IPv4 (${v4Reason})` : 'NAT64 IPv6 prefix (64:ff9b::/96)';
  }

  // 6to4 2002::/16 (embeds IPv4 in w[1], w[2])
  if (w[0] === 0x2002) {
    const a = (w[1] >> 8) & 0xff;
    const b = w[1] & 0xff;
    const c = (w[2] >> 8) & 0xff;
    const d = w[2] & 0xff;
    const v4Reason = classifyIpv4Octets(a, b, c, d);
    if (v4Reason) return `6to4 embedded IPv4 (${v4Reason})`;
  }

  // Unique Local fc00::/7 (fc00::..fdff::)
  if ((w[0] & 0xfe00) === 0xfc00) return 'unique-local IPv6 address (fc00::/7)';
  // Link-Local fe80::/10
  if ((w[0] & 0xffc0) === 0xfe80) return 'link-local IPv6 address (fe80::/10)';
  // Deprecated Site-Local fec0::/10
  if ((w[0] & 0xffc0) === 0xfec0) return 'site-local IPv6 address (fec0::/10)';
  // Multicast ff00::/8
  if ((w[0] & 0xff00) === 0xff00) return 'multicast IPv6 address (ff00::/8)';
  // Teredo tunneling 2001:0000::/32 (can encapsulate obfuscated private/loopback IPv4)
  if (w[0] === 0x2001 && w[1] === 0x0000) return 'Teredo tunneling IPv6 range (2001:0000::/32)';
  // Discard-Only Prefix 100::/64 (RFC 6666)
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return 'discard-only IPv6 range (100::/64)';
  // Documentation 2001:db8::/32
  if (w[0] === 0x2001 && w[1] === 0x0db8) return 'documentation IPv6 address (2001:db8::/32)';

  return null;
}

export function classifyIpAddress(rawIp) {
  if (typeof rawIp !== 'string' || !rawIp.trim()) {
    return 'empty or invalid IP address';
  }
  const clean = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (clean.includes(':')) {
    if (clean.includes('%')) return 'IPv6 zone-scoped link-local address';
    const words = parseIpv6ToWords(clean);
    if (!words) return 'malformed IPv6 address';
    return classifyIpv6Words(words);
  }
  const ipv4Match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return 'malformed IPv4 address';
  return classifyIpv4Octets(
    Number(ipv4Match[1]),
    Number(ipv4Match[2]),
    Number(ipv4Match[3]),
    Number(ipv4Match[4]),
  );
}

export function isBlockedSsrfUrl(inputUrl) {
  let parsedUrl = inputUrl;
  if (typeof inputUrl === 'string') {
    try {
      parsedUrl = new URL(inputUrl);
    } catch {
      return 'malformed URL';
    }
  }
  if (!parsedUrl || typeof parsedUrl !== 'object') {
    return 'invalid URL object';
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return 'non-HTTP(S) protocol';
  }
  if (parsedUrl.username || parsedUrl.password) {
    return 'embedded URL credentials not allowed';
  }
  const rawHost = String(parsedUrl.hostname || '').toLowerCase().replace(/\.+$/, '');
  const host = rawHost.replace(/^\[|\]$/g, '');
  if (!host) {
    return 'empty host';
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data'
  ) {
    return 'loopback/localhost/internal host';
  }

  // IPv6 check (either bracketed or containing colons)
  if (rawHost.startsWith('[') || host.includes(':')) {
    if (host.includes('%')) {
      return 'IPv6 zone-scoped link-local address';
    }
    const words = parseIpv6ToWords(host);
    if (!words) return 'malformed IPv6 host';
    return classifyIpv6Words(words);
  }

  // Canonical dotted IPv4 check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    return classifyIpv4Octets(
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    );
  }

  // Block non-standard numeric/hex/octal IPv4 host representations that may slip past URL parser
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return 'non-canonical numeric IP literal';
  }

  return null;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

async function defaultDnsLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

export async function resolveAndValidateSsrfHost(parsedUrl, { lookupImpl = defaultDnsLookup } = {}) {
  const staticBlock = isBlockedSsrfUrl(parsedUrl);
  if (staticBlock) {
    throw new Error(`Blocked by SSRF guard (${staticBlock}): ${parsedUrl.href}`);
  }
  const normalizedHost = String(parsedUrl.hostname || '').toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(normalizedHost);
  if (literalFamily === 4 || literalFamily === 6) {
    const ipReason = classifyIpAddress(normalizedHost);
    if (ipReason) {
      throw new Error(`Blocked by SSRF guard (${ipReason}): ${parsedUrl.href}`);
    }
    return [{ address: normalizedHost, family: literalFamily }];
  }

  if (typeof lookupImpl !== 'function') {
    throw new Error(`Blocked by SSRF guard (DNS lookup implementation unavailable for "${normalizedHost}"): ${parsedUrl.href}`);
  }

  let records;
  try {
    records = await lookupImpl(normalizedHost, { all: true, verbatim: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Blocked by SSRF guard (DNS lookup failed for "${normalizedHost}": ${msg}): ${parsedUrl.href}`);
  }

  const normalizedRecords = (Array.isArray(records) ? records : [records])
    .filter(r => r && typeof r.address === 'string' && r.address.trim())
    .map(r => {
      const addr = r.address.trim();
      const fam = r.family === 4 || r.family === 6 ? r.family : net.isIP(addr);
      return { address: addr, family: fam };
    });

  if (normalizedRecords.length === 0) {
    throw new Error(`Blocked by SSRF guard (DNS lookup returned no addresses for "${normalizedHost}"): ${parsedUrl.href}`);
  }

  for (const rec of normalizedRecords) {
    const reason = classifyIpAddress(rec.address);
    if (reason) {
      throw new Error(`Blocked by SSRF guard (DNS for "${normalizedHost}" resolved to ${reason}: ${rec.address}): ${parsedUrl.href}`);
    }
    if (rec.family !== 4 && rec.family !== 6) {
      throw new Error(`Blocked by SSRF guard (DNS for "${normalizedHost}" returned invalid address family for ${rec.address}): ${parsedUrl.href}`);
    }
  }

  return normalizedRecords;
}

function pinnedHttpRequest(targetUrl, {
  method = 'HEAD',
  headers = {},
  timeoutMs = 3500,
  resolvedAddresses,
}) {
  const isHttps = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const normalizedHost = String(targetUrl.hostname || '').toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  const primary = resolvedAddresses[0];

  const pinnedLookup = (_hostname, optionsOrCb, maybeCb) => {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    const opts = typeof optionsOrCb === 'object' && optionsOrCb !== null ? optionsOrCb : {};
    if (opts.all) {
      cb(null, resolvedAddresses.map(r => ({ address: r.address, family: r.family })));
    } else {
      cb(null, primary.address, primary.family);
    }
  };

  return new Promise((resolve, reject) => {
    const reqOpts = {
      protocol: targetUrl.protocol,
      hostname: normalizedHost,
      port: targetUrl.port ? Number(targetUrl.port) : (isHttps ? 443 : 80),
      path: `${targetUrl.pathname || '/'}${targetUrl.search || ''}`,
      method,
      headers,
      agent: false,
      lookup: pinnedLookup,
      ...(isHttps && net.isIP(normalizedHost) === 0 ? { servername: normalizedHost } : {}),
    };

    const req = transport.request(reqOpts, res => {
      // Drain response body without buffering to avoid memory blowup on HEAD/GET link checks
      res.resume();
      const rawHeaders = res.headers || {};
      resolve({
        status: res.statusCode || 0,
        headers: {
          get(name) {
            const val = rawHeaders[String(name).toLowerCase()];
            if (Array.isArray(val)) return val.join(', ');
            return val === undefined ? null : String(val);
          },
        },
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', err => reject(err));
    req.end();
  });
}

export async function fetchUrlWithSafeRedirects(initialUrl, {
  fetchImpl = null,
  lookupImpl = defaultDnsLookup,
  method = 'HEAD',
  maxRedirects = 5,
  timeoutMs = 3500,
  headers = { 'User-Agent': 'veycraft-link-check/2.0' },
} = {}) {
  let currentUrl;
  try {
    currentUrl = initialUrl instanceof URL ? new URL(initialUrl.href) : new URL(String(initialUrl));
  } catch {
    throw new Error(`Malformed URL: "${initialUrl}"`);
  }
  const initialBlock = isBlockedSsrfUrl(currentUrl);
  if (initialBlock) {
    throw new Error(`Blocked by SSRF guard (${initialBlock}): ${currentUrl.href}`);
  }

  let currentMethod = method;
  const visited = new Set([currentUrl.href]);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // F-03: Resolve and validate all DNS addresses on EVERY hop before issuing any network request
    const resolvedAddresses = await resolveAndValidateSsrfHost(currentUrl, { lookupImpl });

    let res;
    if (typeof fetchImpl === 'function') {
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
      res = await fetchImpl(currentUrl.href, {
        method: currentMethod,
        redirect: 'manual',
        ...(signal ? { signal } : {}),
        headers,
        resolvedAddresses,
      });
    } else {
      res = await pinnedHttpRequest(currentUrl, {
        method: currentMethod,
        headers,
        timeoutMs,
        resolvedAddresses,
      });
    }

    if (!REDIRECT_STATUS_CODES.has(res.status)) {
      return { response: res, finalUrl: currentUrl.href, redirects: hop, resolvedAddresses };
    }

    if (hop >= maxRedirects) {
      throw new Error(`Maximum redirect limit (${maxRedirects}) exceeded at ${currentUrl.href}`);
    }

    const locationHeader = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('location')
      : (res.headers && (res.headers.location || res.headers.Location));
    if (typeof locationHeader !== 'string' || !locationHeader.trim()) {
      throw new Error(`Redirect response (HTTP ${res.status}) missing Location header.`);
    }

    let nextUrl;
    try {
      nextUrl = new URL(locationHeader.trim(), currentUrl);
    } catch {
      throw new Error(`Malformed redirect Location "${locationHeader}" from ${currentUrl.href}`);
    }

    const redirectBlock = isBlockedSsrfUrl(nextUrl);
    if (redirectBlock) {
      throw new Error(`Redirect target blocked by SSRF guard (${redirectBlock}): ${nextUrl.href}`);
    }

    if (visited.has(nextUrl.href)) {
      throw new Error(`Redirect loop detected to ${nextUrl.href}`);
    }
    visited.add(nextUrl.href);

    if (res.status === 303 && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
      currentMethod = 'GET';
    }
    currentUrl = nextUrl;
  }

  throw new Error(`Maximum redirect limit (${maxRedirects}) exceeded.`);
}

// ---------------- SEC-03: Hardened OOXML (.docx) ZIP Parser with Decompression Limits ----------------

export const DOCX_LIMITS = Object.freeze({
  MAX_INPUT_BYTES: 10 * 1024 * 1024, // 10 MB max input .docx file size
  MAX_TOTAL_ENTRIES: 512, // max total ZIP central directory entries
  MAX_XML_ENTRIES: 24, // max accepted word/(document|header*|footer*).xml entries
  MAX_COMPRESSED_ENTRY_BYTES: 5 * 1024 * 1024, // 5 MB max compressed entry size
  MAX_ENTRY_UNCOMPRESSED_BYTES: 5 * 1024 * 1024, // 5 MB max per-entry decompressed size
  MAX_TOTAL_UNCOMPRESSED_BYTES: 10 * 1024 * 1024, // 10 MB max cumulative decompressed size
});

export function readFileBoundedSync(filePath, maxBytes, label = 'file') {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error(`Invalid maxBytes limit for ${label}: ${maxBytes}`);
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`Expected regular file for ${label}: ${filePath}`);
    }
    if (stat.size > maxBytes) {
      throw new Error(`Oversized ${label} (${stat.size} bytes exceeds ${maxBytes} byte limit).`);
    }
    if (stat.size === 0) {
      return Buffer.alloc(0);
    }
    // Read bounded chunks up to maxBytes + 1 so concurrent file growth cannot cause unbounded allocation
    const chunkSize = Math.min(65536, maxBytes + 1);
    const chunks = [];
    let totalRead = 0;
    while (totalRead <= maxBytes) {
      const toRead = Math.min(chunkSize, maxBytes + 1 - totalRead);
      const buf = Buffer.allocUnsafe(toRead);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, null);
      if (bytesRead === 0) break;
      totalRead += bytesRead;
      if (totalRead > maxBytes) {
        throw new Error(`Oversized ${label} (exceeds ${maxBytes} byte limit).`);
      }
      chunks.push(bytesRead === toRead ? buf : buf.subarray(0, bytesRead));
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalRead);
  } finally {
    fs.closeSync(fd);
  }
}

function decodeDocxXmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

export function extractDocxText(rawBuf, limits = {}) {
  const maxInputBytes = limits.maxInputBytes ?? DOCX_LIMITS.MAX_INPUT_BYTES;
  const maxTotalEntries = limits.maxTotalEntries ?? DOCX_LIMITS.MAX_TOTAL_ENTRIES;
  const maxXmlEntries = limits.maxXmlEntries ?? DOCX_LIMITS.MAX_XML_ENTRIES;
  const maxCompressedEntryBytes = limits.maxCompressedEntryBytes ?? DOCX_LIMITS.MAX_COMPRESSED_ENTRY_BYTES;
  const maxEntryUncompressedBytes = limits.maxEntryUncompressedBytes ?? DOCX_LIMITS.MAX_ENTRY_UNCOMPRESSED_BYTES;
  const maxTotalUncompressedBytes = limits.maxTotalUncompressedBytes ?? DOCX_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES;

  if (!Buffer.isBuffer(rawBuf)) {
    throw new Error('Invalid .docx file (not a genuine OOXML ZIP archive). Do not rename HTML/text files to .docx.');
  }
  if (rawBuf.length > maxInputBytes) {
    throw new Error(`Oversized .docx file (${rawBuf.length} bytes exceeds ${maxInputBytes} byte limit).`);
  }
  if (rawBuf.length < 22 || rawBuf.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') {
    throw new Error('Invalid .docx file (not a genuine OOXML ZIP archive). Do not rename HTML/text files to .docx.');
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, rawBuf.length - 65557);
  for (let i = rawBuf.length - 22; i >= minOffset; i--) {
    if (rawBuf.readUInt32LE(i) === 0x06054b50) {
      const commentLen = rawBuf.readUInt16LE(i + 20);
      if (i + 22 + commentLen === rawBuf.length) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    // Fallback scan if trailing comment length was non-strict in a synthetic archive, still verifying bounds
    for (let i = rawBuf.length - 22; i >= minOffset; i--) {
      if (rawBuf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Corrupted .docx archive (missing ZIP central directory).');
  }

  const diskEntries = rawBuf.readUInt16LE(eocdOffset + 8);
  const entryCount = rawBuf.readUInt16LE(eocdOffset + 10);
  const cdSize = rawBuf.readUInt32LE(eocdOffset + 12);
  let cdOffset = rawBuf.readUInt32LE(eocdOffset + 16);

  if (diskEntries !== entryCount) {
    throw new Error('Corrupted or multi-disk .docx ZIP archive (central directory entry count mismatch).');
  }
  if (entryCount > maxTotalEntries) {
    throw new Error(`Excessive .docx ZIP entry count (${entryCount} exceeds limit of ${maxTotalEntries}).`);
  }
  if (cdOffset > eocdOffset || cdOffset + cdSize > eocdOffset) {
    throw new Error('Corrupted .docx central directory bounds.');
  }

  const cdStartOffset = cdOffset;
  const cdEndOffset = cdOffset + cdSize;
  const xmlParts = [];
  const seenNames = new Set();
  const occupiedLocalRanges = [];
  let totalUncompressedBytes = 0;

  for (let idx = 0; idx < entryCount; idx++) {
    if (cdOffset + 46 > cdEndOffset || cdOffset + 46 > rawBuf.length || rawBuf.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error('Corrupted .docx central directory entry.');
    }
    const flags = rawBuf.readUInt16LE(cdOffset + 8);
    const method = rawBuf.readUInt16LE(cdOffset + 10);
    const compSize = rawBuf.readUInt32LE(cdOffset + 20);
    const uncompSize = rawBuf.readUInt32LE(cdOffset + 24);
    const nameLen = rawBuf.readUInt16LE(cdOffset + 28);
    const extraLen = rawBuf.readUInt16LE(cdOffset + 30);
    const commentLen = rawBuf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = rawBuf.readUInt32LE(cdOffset + 42);
    const nextCdOffset = cdOffset + 46 + nameLen + extraLen + commentLen;
    if (nextCdOffset > cdEndOffset || nextCdOffset > rawBuf.length) {
      throw new Error('Corrupted .docx central directory entry bounds.');
    }
    const fileName = rawBuf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');
    cdOffset = nextCdOffset;

    if (!fileName || fileName.includes('\x00')) {
      throw new Error('Corrupted .docx central directory filename.');
    }
    const normName = fileName.replace(/\\/g, '/').toLowerCase();
    if (seenNames.has(normName)) {
      throw new Error(`Duplicate .docx ZIP entry "${fileName}" rejected.`);
    }
    seenNames.add(normName);

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error('ZIP64 .docx archives are not supported.');
    }

    if (localHeaderOffset + 30 > cdStartOffset || localHeaderOffset + 30 > rawBuf.length || rawBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Corrupted .docx local file header.');
    }
    const lhNameLen = rawBuf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = rawBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataStart > rawBuf.length || dataEnd > rawBuf.length || dataEnd > cdStartOffset) {
      throw new Error('Truncated or out-of-bounds .docx entry data.');
    }

    // Reject duplicate or overlapping local entry ranges (anti-bomb shared-payload defense)
    for (const prev of occupiedLocalRanges) {
      if (localHeaderOffset < prev.end && dataEnd > prev.start) {
        throw new Error('Corrupted .docx archive: overlapping or shared local file header/data offsets detected.');
      }
    }
    occupiedLocalRanges.push({ start: localHeaderOffset, end: Math.max(dataEnd, localHeaderOffset + 30) });

    if (!/^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(normName)) continue;

    if (xmlParts.length >= maxXmlEntries) {
      throw new Error(`Excessive .docx XML document/header/footer parts (exceeds limit of ${maxXmlEntries}).`);
    }
    if (flags & 1) {
      throw new Error('Encrypted .docx file is not supported; save an unencrypted .docx or export .md/.txt.');
    }
    if (compSize > maxCompressedEntryBytes) {
      throw new Error(`Oversized compressed .docx entry "${fileName}" (${compSize} bytes exceeds ${maxCompressedEntryBytes} byte limit).`);
    }
    if (uncompSize > maxEntryUncompressedBytes) {
      throw new Error(`Oversized uncompressed .docx entry "${fileName}" (${uncompSize} bytes exceeds ${maxEntryUncompressedBytes} byte limit).`);
    }
    if (totalUncompressedBytes + uncompSize > maxTotalUncompressedBytes) {
      throw new Error(`Cumulative .docx uncompressed size exceeds ${maxTotalUncompressedBytes} byte limit.`);
    }

    const compressed = rawBuf.subarray(dataStart, dataEnd);
    const remainingBudget = maxTotalUncompressedBytes - totalUncompressedBytes;
    const entryBudget = Math.min(maxEntryUncompressedBytes, remainingBudget);

    let xmlBuf;
    if (method === 0) {
      if (compSize !== uncompSize) {
        throw new Error(`Corrupted .docx stored entry "${fileName}" (compressed size ${compSize} != uncompressed size ${uncompSize}).`);
      }
      if (compressed.length > entryBudget) {
        throw new Error(`Oversized .docx entry "${fileName}" exceeds decompression budget (${entryBudget} bytes).`);
      }
      xmlBuf = compressed;
    } else if (method === 8) {
      if (compSize === 0) {
        throw new Error(`Corrupted .docx deflate entry "${fileName}" (0 compressed bytes).`);
      }
      const inflateCap = Math.max(1, entryBudget);
      try {
        xmlBuf = zlib.inflateRawSync(compressed, { maxOutputLength: inflateCap });
      } catch (err) {
        if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|Cannot create a Buffer larger than/i.test(String(err.message)))) {
          throw new Error(`Decompression limit exceeded for .docx entry "${fileName}" (max ${entryBudget} bytes).`);
        }
        throw new Error(`Corrupted deflate stream in .docx entry "${fileName}": ${err.message}`);
      }
      if (xmlBuf.length > entryBudget) {
        throw new Error(`Decompression limit exceeded for .docx entry "${fileName}" (max ${entryBudget} bytes).`);
      }
      if (xmlBuf.length !== uncompSize) {
        throw new Error(`Corrupted .docx entry "${fileName}" (declared uncompressed size ${uncompSize} != actual ${xmlBuf.length}).`);
      }
    } else {
      throw new Error(`Unsupported .docx compression method (${method}); export .md or .txt instead.`);
    }

    totalUncompressedBytes += xmlBuf.length;
    if (totalUncompressedBytes > maxTotalUncompressedBytes) {
      throw new Error(`Cumulative .docx uncompressed size exceeds ${maxTotalUncompressedBytes} byte limit.`);
    }

    xmlParts.push({ name: normName, xml: xmlBuf.toString('utf8') });
  }

  if (cdOffset !== cdEndOffset) {
    throw new Error('Corrupted .docx central directory (size mismatch).');
  }

  const hasMainDoc = xmlParts.some(p => p.name === 'word/document.xml');
  if (!hasMainDoc) {
    throw new Error('Invalid .docx package (missing word/document.xml). Do not rename HTML/text files to .docx.');
  }
  const combined = xmlParts
    .sort((a, b) => (a.name === 'word/document.xml' ? -1 : b.name === 'word/document.xml' ? 1 : a.name.localeCompare(b.name)))
    .map(p =>
      decodeDocxXmlEntities(
        p.xml
          .replace(/<\/w:p>/gi, '\n')
          .replace(/<\/w:tr>/gi, '\n')
          .replace(/<w:br\b[^>]*\/>/gi, '\n')
          .replace(/<w:tab\b[^>]*\/>/gi, ' ')
          .replace(/<[^>]+>/g, ''),
      ),
    )
    .join('\n')
    .split(/\r?\n/)
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  if (!combined.trim()) {
    throw new Error('No readable text found inside .docx (possibly image-only content); paste your CV text or provide .md/.txt.');
  }
  return combined;
}
