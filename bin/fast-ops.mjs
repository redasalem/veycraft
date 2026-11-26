// Zero-dependency Token-Efficiency Fast-Path Engine for Veycraft:
// 1. Compact Candidate Brief compiler (context/brief.json < 400 tokens, mtime+sha256 cache-invalidated, zero PII).
// 2. Zero-Token Public RSS/Atom/JSON Feed Scanner (SEC-01 SSRF-pinned, deduped, prompt-injection sanitized, local fit-scored).
// 3. Scoped CLI dispatcher for `veycraft brief`, `veycraft feed-scan`, and `veycraft browser-script`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import {
  isObj,
  isWithinDir,
  refuseSymlink,
  writeAtomic,
  readFileBoundedSync,
  fetchTextWithSafeRedirects,
  decodeXmlHtmlEntities,
  stripMarkupTags,
} from './fs-safety.mjs';
import { PAYLOAD_NAMES, getBrowserPayload } from './browser-payloads.mjs';

const TEMPLATE_PLACEHOLDER_RE = /\{\{[^{}\r\n]+\}\}|\[\s*(?:YOUR|INSERT|REPLACE|TODO)[^\]\r\n]*\]/i;
const STARTER_SCAFFOLD_RE = /\b(?:Jane Doe|John Doe|YOUR_NAME|YOUR_EMAIL|your-handle|your-site|replace-with-database-id|Acme Fintech|Nile Commerce)\b|(?:reda@example\.com|spam-recruiting\.example|current-employer\.example)/i;

function isUntouchedStarterFile(absPath, content, resolvedRoot, home) {
  const txt = String(content || '');
  if (TEMPLATE_PLACEHOLDER_RE.test(txt) || STARTER_SCAFFOLD_RE.test(txt)) return true;
  const exPath = `${absPath}.example`;
  if (fs.existsSync(exPath)) {
    try {
      refuseSymlink(exPath, resolvedRoot, home);
      const exTxt = fs.readFileSync(exPath, 'utf8');
      if (txt.replace(/\r\n/g, '\n').trim() === exTxt.replace(/\r\n/g, '\n').trim()) return true;
    } catch {
      // Ignore unreadable .example comparison
    }
  }
  return false;
}

export const BRIEF_SCHEMA_VERSION = 1;
export const BRIEF_MAX_BYTES = 1550; // Strictly < 400 tokens (~bytes/4)
const MAX_LOCAL_FEED_BYTES = 2 * 1024 * 1024; // 2 MB

const BRIEF_SOURCES = [
  'context/cv.md',
  'context/profile.md',
  'context/preferences.yaml',
  'context/form-answers.yaml',
  'context/resume-facts.json',
  'context/github-projects.md',
];

const INJECTION_PATTERNS = [
  { code: 'ignore_instructions', re: /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?\b/i },
  { code: 'system_prompt_ref', re: /\b(?:system\s+prompt|developer\s+message|disregard\s+guardrails)\b/i },
  { code: 'secret_exfil', re: /\b(?:reveal|print|send|exfiltrate)\s+(?:your\s+)?(?:\.env|api\s+key|token|cookie|password)\b/i },
  { code: 'forced_submit', re: /\b(?:auto[- ]?submit|click\s+submit\s+immediately|bypass\s+approve)\b/i },
];

const PII_LINE_RE = /\b(?:phone|mobile|tel|whatsapp|passport|ssn|national\s+id|street\s+address|home\s+address|date\s+of\s+birth)\b|\+\d[\d\s()-]{7,}|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;

function stripInvisibleAndBiDi(str) {
  let out = '';
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) {
      continue;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function sanitizeUntrustedSnippet(raw, maxLen = 220) {
  const cleaned = stripInvisibleAndBiDi(decodeXmlHtmlEntities(stripMarkupTags(String(raw || ''))))
    .replace(/\s+/g, ' ')
    .trim();
  const injectionFlags = [];
  for (const { code, re } of INJECTION_PATTERNS) {
    if (re.test(cleaned)) injectionFlags.push(code);
  }
  return {
    text: cleaned.slice(0, maxLen),
    injection_flags: injectionFlags,
  };
}

function sha256Short(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex').slice(0, 12);
}

function readOptionalText(absPath, root, home) {
  if (!fs.existsSync(absPath)) return null;
  refuseSymlink(absPath, root, home);
  const st = fs.lstatSync(absPath);
  if (!st.isFile()) return null;
  const content = readFileBoundedSync(absPath, 512 * 1024, path.basename(absPath)).toString('utf8');
  return { content, mtimeMs: Math.floor(st.mtimeMs), size: st.size, sha: sha256Short(content) };
}

function extractSimpleYamlList(yamlText, key) {
  if (!yamlText) return [];
  const lines = yamlText.split(/\r?\n/);
  const out = [];
  let inBlock = false;
  let baseIndent = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!inBlock) {
      const m = line.match(new RegExp(`^(\\s*)${key}\\s*:\\s*(.*)$`));
      if (m) {
        baseIndent = m[1].length;
        const inline = m[2].trim();
        if (inline.startsWith('[') && inline.endsWith(']')) {
          return inline.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
        inBlock = true;
      }
      continue;
    }
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= baseIndent && !line.trim().startsWith('-')) break;
    const item = line.trim().match(/^-\s*(.+)$/);
    if (item) {
      const val = item[1].trim().replace(/^["']|["']$/g, '');
      if (val && !TEMPLATE_PLACEHOLDER_RE.test(val)) out.push(val);
    }
  }
  return out;
}

function extractSimpleYamlScalar(yamlText, key) {
  if (!yamlText) return null;
  const m = yamlText.match(new RegExp(`^\\s*${key}\\s*:\\s*([^\\n#]+)`, 'm'));
  if (!m) return null;
  const val = m[1].trim().replace(/^["']|["']$/g, '');
  if (!val || TEMPLATE_PLACEHOLDER_RE.test(val)) return null;
  return val;
}

function extractHeadline(profileText, cvText) {
  for (const src of [profileText, cvText]) {
    if (!src) continue;
    const roleMatch = src.match(/(?:Headline|Title|Role)\s*:\s*([^\n]+)/i);
    if (roleMatch && !TEMPLATE_PLACEHOLDER_RE.test(roleMatch[1]) && !PII_LINE_RE.test(roleMatch[1])) {
      return roleMatch[1].replace(/[*_`#]/g, '').trim().slice(0, 100);
    }
    for (const line of src.split(/\r?\n/).slice(0, 12)) {
      const t = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
      if (!t || t.length < 10 || t.length > 120) continue;
      if (PII_LINE_RE.test(t) || TEMPLATE_PLACEHOLDER_RE.test(t)) continue;
      if (/\b(engineer|developer|architect|designer|manager|analyst|consultant|specialist|scientist|full[- ]?stack|backend|frontend)\b/i.test(t)) {
        return t.slice(0, 100);
      }
    }
  }
  return 'Verified Candidate Profile';
}

function extractSkills(factsObj, cvText, prefText) {
  const skills = [];
  const add = (s) => {
    const clean = String(s || '').replace(/[*_`]/g, '').trim();
    if (!clean || clean.length > 32 || TEMPLATE_PLACEHOLDER_RE.test(clean) || PII_LINE_RE.test(clean)) return;
    if (!skills.some(x => x.toLowerCase() === clean.toLowerCase())) skills.push(clean);
  };

  if (factsObj) {
    for (const arrKey of ['verified_skills', 'skills', 'core_skills', 'tech_stack']) {
      if (Array.isArray(factsObj[arrKey])) {
        for (const item of factsObj[arrKey]) {
          add(typeof item === 'string' ? item : item?.name || item?.skill);
        }
      }
    }
    if (isObj(factsObj.skills_years)) {
      for (const k of Object.keys(factsObj.skills_years)) add(k);
    }
  }

  for (const s of extractSimpleYamlList(prefText, 'skills')) add(s);
  for (const s of extractSimpleYamlList(prefText, 'core_skills')) add(s);

  if (cvText) {
    const lines = cvText.split(/\r?\n/);
    for (const line of lines) {
      if (/\b(skills|technologies|stack|languages|frameworks|tools)\b\s*[:|]/i.test(line)) {
        const rhs = line.split(/[:|]/).slice(1).join(',');
        for (const tok of rhs.split(/[,•·/]/)) {
          const clean = tok.replace(/[*_`()]/g, '').trim();
          if (clean.length >= 2 && clean.length <= 28 && !/\b(and|with|years?|months?)\b/i.test(clean)) {
            add(clean);
          }
        }
      }
    }
  }
  return skills.slice(0, 12);
}

function extractTopProofs(cvText, ghProjectsText) {
  const proofs = [];
  const sources = [cvText, ghProjectsText].filter(Boolean);
  for (const src of sources) {
    for (const raw of src.split(/\r?\n/)) {
      const m = raw.trim().match(/^[-*•]\s+(.+)$/);
      if (!m) continue;
      const clean = m[1].replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
      if (clean.length < 24 || TEMPLATE_PLACEHOLDER_RE.test(clean) || PII_LINE_RE.test(clean)) continue;
      const hasSignal = /\d+%|\$\d|\d+\+|\d+x\b|\b(built|shipped|reduced|improved|launched|architected|designed|delivered)\b/i.test(clean);
      if (hasSignal && !proofs.includes(clean.slice(0, 105))) {
        proofs.push(clean.slice(0, 105));
      }
      if (proofs.length >= 4) return proofs;
    }
  }
  return proofs;
}

function extractVerifiedLinks(profileText, cvText) {
  const combined = `${profileText || ''}\n${cvText || ''}`;
  const urls = combined.match(/https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=-]+/g) || [];
  const links = {};
  for (const raw of urls) {
    const u = raw.replace(/[),.;]+$/, '');
    if (TEMPLATE_PLACEHOLDER_RE.test(u) || /example\.com|your-?handle|your-site\.dev|username/i.test(u)) continue;
    if (/github\.com\/[A-Za-z0-9_-]+/i.test(u) && !links.github) links.github = u;
    else if (/linkedin\.com\/in\//i.test(u) && !links.linkedin) links.linkedin = u;
    else if (!/github\.com|linkedin\.com/i.test(u) && !links.portfolio) links.portfolio = u;
  }
  return links;
}

function trimBriefToBudget(brief, maxBytes = BRIEF_MAX_BYTES) {
  const copy = JSON.parse(JSON.stringify(brief));
  const sizeOf = (obj) => Buffer.byteLength(JSON.stringify(obj), 'utf8');
  while (sizeOf(copy) > maxBytes && copy.top_proofs.length > 1) {
    copy.top_proofs.pop();
  }
  while (sizeOf(copy) > maxBytes && copy.core_stack.length > 6) {
    copy.core_stack.pop();
  }
  if (sizeOf(copy) > maxBytes) {
    copy.top_proofs = copy.top_proofs.map(p => p.slice(0, 72));
    copy.headline = copy.headline.slice(0, 72);
  }
  while (sizeOf(copy) > maxBytes && copy.constraints?.blacklist?.length > 0) {
    copy.constraints.blacklist.pop();
  }
  if (sizeOf(copy) > maxBytes && copy.forbidden_unverified_claims?.length > 4) {
    copy.forbidden_unverified_claims = copy.forbidden_unverified_claims.slice(0, 4);
  }
  return copy;
}

export function compileCandidateBrief(root, { refresh = false, write = true, home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const briefPath = path.join(resolvedRoot, 'context', 'brief.json');

  const sourceMap = {};
  const loaded = {};
  const missingSources = [];
  let hasRealSource = false;

  for (const rel of BRIEF_SOURCES) {
    const abs = path.join(resolvedRoot, rel);
    const data = readOptionalText(abs, resolvedRoot, home);
    if (!data) {
      missingSources.push(rel);
      continue;
    }
    if (isUntouchedStarterFile(abs, data.content, resolvedRoot, home)) {
      continue;
    }
    loaded[rel] = data.content;
    sourceMap[rel] = { mtimeMs: data.mtimeMs, sha: data.sha };
    hasRealSource = true;
  }

  if (Object.keys(loaded).length === 0 || !hasRealSource) {
    return {
      ok: true,
      brief_ready: false,
      cached: false,
      path: briefPath,
      missing_sources: missingSources,
      reason: Object.keys(loaded).length === 0
        ? 'No context/ source files found (cv.md, profile.md, preferences.yaml, resume-facts.json).'
        : 'All detected context/ files still contain unresolved {{PLACEHOLDER}} template markers.',
      brief: null,
    };
  }

  const combinedHash = sha256Short(JSON.stringify(sourceMap));

  if (!refresh && fs.existsSync(briefPath)) {
    try {
      refuseSymlink(briefPath, resolvedRoot, home);
      const existingRaw = fs.readFileSync(briefPath, 'utf8');
      const existing = JSON.parse(existingRaw);
      if (
        isObj(existing) &&
        existing.schema_version === BRIEF_SCHEMA_VERSION &&
        existing._cache?.hash === combinedHash &&
        Buffer.byteLength(existingRaw, 'utf8') <= BRIEF_MAX_BYTES + 64
      ) {
        return {
          ok: true,
          brief_ready: true,
          cached: true,
          path: briefPath,
          bytes: Buffer.byteLength(existingRaw, 'utf8'),
          est_tokens: Math.ceil(Buffer.byteLength(existingRaw, 'utf8') / 4),
          brief: existing,
        };
      }
    } catch {
      // Cache corrupt or unreadable; recompile cleanly below.
    }
  }

  let factsObj = null;
  if (loaded['context/resume-facts.json']) {
    try { factsObj = JSON.parse(loaded['context/resume-facts.json']); } catch { factsObj = null; }
  }

  const prefText = loaded['context/preferences.yaml'] || '';
  const formText = loaded['context/form-answers.yaml'] || '';
  const minSalaryRaw = extractSimpleYamlScalar(prefText, 'min_salary') || extractSimpleYamlScalar(formText, 'min_salary') || extractSimpleYamlScalar(prefText, 'min_budget');
  const minHourlyRaw = extractSimpleYamlScalar(prefText, 'min_hourly_rate') || extractSimpleYamlScalar(prefText, 'min_hourly');
  const currency = extractSimpleYamlScalar(prefText, 'currency') || extractSimpleYamlScalar(formText, 'currency') || 'USD';
  const remoteRaw = extractSimpleYamlScalar(prefText, 'work_mode') || extractSimpleYamlScalar(prefText, 'remote_only');
  const blacklist = [
    ...extractSimpleYamlList(prefText, 'blacklisted_companies'),
    ...extractSimpleYamlList(prefText, 'blacklisted_domains'),
  ].slice(0, 8);
  const languages = extractSimpleYamlList(prefText, 'languages');
  const forbidden = Array.isArray(factsObj?.forbidden_skills)
    ? factsObj.forbidden_skills.filter(s => typeof s === 'string').slice(0, 8)
    : [];

  const rawBrief = {
    schema_version: BRIEF_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    headline: extractHeadline(loaded['context/profile.md'], loaded['context/cv.md']),
    core_stack: extractSkills(factsObj, loaded['context/cv.md'], prefText),
    top_proofs: extractTopProofs(loaded['context/cv.md'], loaded['context/github-projects.md']),
    rate_floor: {
      currency,
      ...(minSalaryRaw && Number.isFinite(Number(minSalaryRaw)) ? { min_budget: Number(minSalaryRaw) } : {}),
      ...(minHourlyRaw && Number.isFinite(Number(minHourlyRaw)) ? { min_hourly: Number(minHourlyRaw) } : {}),
    },
    constraints: {
      remote_only: remoteRaw ? /remote|true/i.test(remoteRaw) : true,
      languages: languages.length ? languages.slice(0, 4) : ['en'],
      blacklist,
    },
    verified_links: extractVerifiedLinks(loaded['context/profile.md'], loaded['context/cv.md']),
    forbidden_unverified_claims: forbidden,
    _cache: {
      schema_version: BRIEF_SCHEMA_VERSION,
      hash: combinedHash,
    },
  };

  const finalBrief = trimBriefToBudget(rawBrief, BRIEF_MAX_BYTES);
  const serialized = `${JSON.stringify(finalBrief)}\n`;
  if (write) {
    writeAtomic(briefPath, serialized, { boundary: resolvedRoot, home });
  }

  return {
    ok: true,
    brief_ready: true,
    cached: false,
    path: briefPath,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    est_tokens: Math.ceil(Buffer.byteLength(serialized, 'utf8') / 4),
    brief: finalBrief,
  };
}

// ---------------- Zero-Token Public RSS/Atom/JSON Feed Parser & Local Ranker ----------------

function extractXmlTag(block, tagName) {
  const lower = block.toLowerCase();
  const openTag = `<${tagName.toLowerCase()}`;
  const startIdx = lower.indexOf(openTag);
  if (startIdx < 0) return '';
  const gtIdx = block.indexOf('>', startIdx + openTag.length);
  if (gtIdx < 0) return '';
  if (block[gtIdx - 1] === '/') {
    // Self-closing tag (e.g. Atom <link href="..."/>)
    const attrs = block.slice(startIdx + openTag.length, gtIdx);
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    return hrefMatch ? hrefMatch[1].trim() : '';
  }
  const closeTag = `</${tagName.toLowerCase()}>`;
  const endIdx = lower.indexOf(closeTag, gtIdx + 1);
  if (endIdx < 0) return '';
  let inner = block.slice(gtIdx + 1, endIdx).trim();
  if (inner.startsWith('<![CDATA[') && inner.endsWith(']]>')) {
    inner = inner.slice(9, -3);
  }
  return inner.trim();
}

function splitXmlBlocks(xmlText, tagName) {
  const out = [];
  const lower = xmlText.toLowerCase();
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let cursor = 0;
  while (cursor < xmlText.length && out.length < 250) {
    const start = lower.indexOf(openToken, cursor);
    if (start < 0) break;
    const nextChar = lower[start + openToken.length];
    if (nextChar !== '>' && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\r' && nextChar !== '\n') {
      cursor = start + openToken.length;
      continue;
    }
    const end = lower.indexOf(closeToken, start + openToken.length);
    if (end < 0) break;
    out.push(xmlText.slice(start, end + closeToken.length));
    cursor = end + closeToken.length;
  }
  return out;
}

function parseBudgetNumber(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw || '');
  const m = s.match(/(?:\$|€|£|USD|EUR|SAR|AED)\s?(\d[\d,]*)/i) || s.match(/\b(\d{2,6})\b/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseFeedText(rawText, { sourceUrl = '' } = {}) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Feed content looked like JSON but failed to parse.');
    }
    const list = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.jobs) ? parsed.jobs
        : Array.isArray(parsed.items) ? parsed.items
          : Array.isArray(parsed.data) ? parsed.data
            : Array.isArray(parsed.postings) ? parsed.postings : []);

    return list.filter(isObj).map((row) => {
      const titleClean = sanitizeUntrustedSnippet(row.title || row.position || row.text || row.name || '', 110);
      const descClean = sanitizeUntrustedSnippet(row.description || row.snippet || row.summary || row.body || '', 220);
      const companyClean = sanitizeUntrustedSnippet(row.company || row.company_name || row.organization || row.client || '', 60);
      const urlVal = String(row.url || row.apply_url || row.hostedUrl || row.link || '').trim();
      const budgetRaw = row.budget || row.salary || row.compensation || row.salary_max || row.salary_min || null;
      const tags = Array.isArray(row.tags)
        ? row.tags.map(t => sanitizeUntrustedSnippet(t, 28).text).filter(Boolean).slice(0, 8)
        : [];
      return {
        title: titleClean.text,
        url: urlVal || null,
        company: companyClean.text || null,
        budget_raw: budgetRaw ? String(budgetRaw).slice(0, 48) : null,
        budget_num: parseBudgetNumber(budgetRaw),
        tags,
        posted_at: row.posted_at || row.date || row.publication_date || row.createdAt || row.posted || null,
        snippet: descClean.text,
        injection_flags: [...new Set([...titleClean.injection_flags, ...descClean.injection_flags])],
      };
    }).filter(item => item.title.length >= 3);
  }

  // RSS 2.0 (<item>) or Atom (<entry>)
  const blocks = splitXmlBlocks(trimmed, 'item');
  const entries = blocks.length > 0 ? blocks : splitXmlBlocks(trimmed, 'entry');
  return entries.map((block) => {
    const titleClean = sanitizeUntrustedSnippet(extractXmlTag(block, 'title'), 110);
    const linkVal = decodeXmlHtmlEntities(extractXmlTag(block, 'link')).trim();
    const rawDesc = extractXmlTag(block, 'description') || extractXmlTag(block, 'summary') || extractXmlTag(block, 'content');
    const descClean = sanitizeUntrustedSnippet(rawDesc, 220);
    const pubDate = extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'updated') || extractXmlTag(block, 'published') || null;
    const author = sanitizeUntrustedSnippet(extractXmlTag(block, 'author') || extractXmlTag(block, 'dc:creator') || '', 60).text || null;
    const budgetMatch = descClean.text.match(/(?:\$|€|£|USD|EUR|SAR|AED)\s?\d[\d,]*(?:\s*[-–]\s*(?:\$|€|£|USD|EUR|SAR|AED)?\s?\d[\d,]*)?/i);
    return {
      title: titleClean.text,
      url: linkVal || (sourceUrl || null),
      company: author,
      budget_raw: budgetMatch ? budgetMatch[0] : null,
      budget_num: budgetMatch ? parseBudgetNumber(budgetMatch[0]) : null,
      tags: [],
      posted_at: pubDate,
      snippet: descClean.text,
      injection_flags: [...new Set([...titleClean.injection_flags, ...descClean.injection_flags])],
    };
  }).filter(item => item.title.length >= 3);
}

function canonicalUrlKey(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(String(rawUrl));
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return String(rawUrl).trim().toLowerCase();
  }
}

export function loadExistingDedupKeys(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const urlKeys = new Set();
  const fpKeys = new Set();

  for (const rel of ['logs/applications-log.json', 'logs/skipped-jobs.json']) {
    const abs = path.join(resolvedRoot, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      refuseSymlink(abs, resolvedRoot, home);
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const list = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.applications) ? parsed.applications
          : Array.isArray(parsed.skipped) ? parsed.skipped : []);
      for (const row of list) {
        if (!isObj(row)) continue;
        const uk = canonicalUrlKey(row.url || row.job_url);
        if (uk) urlKeys.add(uk);
        if (row.company && row.role) {
          fpKeys.add(`${String(row.company).trim().toLowerCase()}::${String(row.role).trim().toLowerCase()}`);
        } else if (row.company && row.title) {
          fpKeys.add(`${String(row.company).trim().toLowerCase()}::${String(row.title).trim().toLowerCase()}`);
        }
      }
    } catch { /* ignore malformed historical logs */ }
  }

  const trackerPath = path.join(resolvedRoot, 'tracker', 'freelance-proposals.md');
  if (fs.existsSync(trackerPath)) {
    try {
      refuseSymlink(trackerPath, resolvedRoot, home);
      const text = fs.readFileSync(trackerPath, 'utf8');
      const urls = text.match(/https?:\/\/[^\s|)]+/g) || [];
      for (const u of urls) {
        const uk = canonicalUrlKey(u);
        if (uk) urlKeys.add(uk);
      }
    } catch { /* ignore */ }
  }

  return { urlKeys, fpKeys };
}

function scoreFeedItem(item, brief) {
  const stack = (brief?.core_stack || []).map(s => s.toLowerCase());
  const forbidden = (brief?.forbidden_unverified_claims || []).map(s => s.toLowerCase());
  const haystack = `${item.title} ${item.snippet} ${(item.tags || []).join(' ')}`.toLowerCase();

  let matchedSkills = [];
  for (const sk of stack) {
    if (sk.length >= 2 && haystack.includes(sk)) matchedSkills.push(sk);
  }
  const missingForbidden = forbidden.filter(f => f.length >= 2 && haystack.includes(f));

  // Score 0-100 deterministic rubric:
  // Stack overlap up to 65 pts + budget stated/above floor 20 pts + freshness 15 pts - penalties
  let score = stack.length > 0
    ? Math.min(65, Math.round((matchedSkills.length / Math.min(stack.length, 4)) * 65))
    : 45;
  if (item.budget_num !== null) score += 20;
  else score += 8;

  if (item.posted_at) {
    const ts = Date.parse(item.posted_at);
    if (Number.isFinite(ts)) {
      const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      if (ageDays <= 3) score += 15;
      else if (ageDays <= 14) score += 10;
      else if (ageDays > 45) score -= 20;
    } else if (/just now|today|\bh\b|\bmin|منذ\s+ساع/i.test(String(item.posted_at))) {
      score += 15;
    }
  }
  score -= missingForbidden.length * 15;
  score -= (item.injection_flags?.length || 0) * 25;
  score = Math.max(0, Math.min(100, score));

  return { score, matched_skills: matchedSkills.slice(0, 6), unverified_required: missingForbidden };
}

export async function scanPublicFeeds(root, {
  url = null,
  file = null,
  top = 10,
  minBudget = null,
  fetchImpl = null,
  lookupImpl = undefined,
  home = os.homedir(),
  cwd = null,
} = {}) {
  const resolvedRoot = path.resolve(root);
  if ((!url && !file) || (url && file)) {
    throw new Error('`veycraft feed-scan` requires exactly one of `--url <https-url>` or `--file <workspace-path>`.');
  }
  const topN = Number.isInteger(top) && top > 0 ? Math.min(top, 50) : 10;

  let rawText = '';
  let sourceLabel = '';
  if (file) {
    const baseDir = cwd ? path.resolve(cwd) : resolvedRoot;
    const candidate = path.isAbsolute(file) ? path.resolve(file) : path.resolve(baseDir, file);
    if (!isWithinDir(candidate, resolvedRoot)) {
      throw new Error(`Refusing feed file outside workspace boundary: ${file}`);
    }
    refuseSymlink(candidate, resolvedRoot, home);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Feed input file not found: ${candidate}`);
    }
    rawText = readFileBoundedSync(candidate, MAX_LOCAL_FEED_BYTES, 'feed file').toString('utf8');
    sourceLabel = path.relative(resolvedRoot, candidate).replace(/\\/g, '/');
  } else {
    const res = await fetchTextWithSafeRedirects(url, { fetchImpl, lookupImpl });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Feed request returned HTTP ${res.status} for ${res.finalUrl}`);
    }
    rawText = res.text;
    sourceLabel = res.finalUrl;
  }

  const parsedItems = parseFeedText(rawText, { sourceUrl: url || '' });
  const briefResult = compileCandidateBrief(resolvedRoot, { write: false, home });
  const brief = briefResult.brief || null;
  const { urlKeys, fpKeys } = loadExistingDedupKeys(resolvedRoot, { home });
  const blacklist = (brief?.constraints?.blacklist || []).map(b => b.toLowerCase());
  const effMinBudget = Number.isFinite(minBudget) ? minBudget : (brief?.rate_floor?.min_budget ?? null);

  let filteredDuplicates = 0;
  let filteredBlacklist = 0;
  let filteredBudget = 0;
  const scored = [];
  const seenLocal = new Set();

  for (const item of parsedItems) {
    const uKey = canonicalUrlKey(item.url);
    const fp = item.company ? `${item.company.toLowerCase()}::${item.title.toLowerCase()}` : null;
    if ((uKey && (urlKeys.has(uKey) || seenLocal.has(uKey))) || (fp && fpKeys.has(fp))) {
      filteredDuplicates++;
      continue;
    }
    if (uKey) seenLocal.add(uKey);

    const hay = `${item.company || ''} ${item.url || ''} ${item.title}`.toLowerCase();
    if (blacklist.some(b => b && hay.includes(b))) {
      filteredBlacklist++;
      continue;
    }

    if (effMinBudget !== null && item.budget_num !== null && item.budget_num < effMinBudget) {
      filteredBudget++;
      continue;
    }

    const fit = scoreFeedItem(item, brief);
    scored.push({
      title: item.title,
      url: item.url,
      company: item.company,
      budget: item.budget_raw,
      posted_at: item.posted_at,
      fit_score: fit.score,
      matched_skills: fit.matched_skills,
      ...(fit.unverified_required.length ? { unverified_required: fit.unverified_required } : {}),
      ...(item.injection_flags.length ? { injection_flags: item.injection_flags } : {}),
      snippet: item.snippet.slice(0, 160),
    });
  }

  scored.sort((a, b) => b.fit_score - a.fit_score);
  const topItems = scored.slice(0, topN).map((item, idx) => ({ rank: idx + 1, ...item }));

  return {
    ok: true,
    source: sourceLabel,
    untrusted_external_data: true,
    brief_used: Boolean(brief),
    total_scanned: parsedItems.length,
    filtered_duplicates: filteredDuplicates,
    filtered_blacklist: filteredBlacklist,
    filtered_budget: filteredBudget,
    returned_count: topItems.length,
    items: topItems,
  };
}

// ---------------- Multi-Feed Radar (`context/feeds.yaml` + `feed-scan --all`) ----------------

export function parseFeedsConfigYaml(yamlText) {
  const lines = String(yamlText || '').split(/\r?\n/);
  const feeds = [];
  let current = null;
  let inFeeds = false;

  for (const raw of lines) {
    const clean = raw.replace(/\s+#.*$/, '');
    const trimmed = clean.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^feeds\s*:\s*$/i.test(trimmed)) {
      inFeeds = true;
      continue;
    }
    if (!inFeeds) continue;

    if (/^-\s+/.test(trimmed)) {
      if (current && (current.url || current.file)) feeds.push(current);
      current = { name: 'Unnamed Feed', enabled: true, url: null, file: null, min_budget: null };
      const rest = trimmed.replace(/^-\s+/, '');
      const kv = rest.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (kv) applyFeedField(current, kv[1], kv[2]);
      continue;
    }

    if (current) {
      const kv = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (kv) applyFeedField(current, kv[1], kv[2]);
    }
  }
  if (current && (current.url || current.file)) feeds.push(current);
  return feeds;
}

function applyFeedField(target, key, rawVal) {
  const val = String(rawVal || '').trim().replace(/^["']|["']$/g, '');
  if (key === 'name' && val) target.name = val;
  else if (key === 'enabled') target.enabled = val.toLowerCase() === 'true';
  else if (key === 'url' && val) target.url = val;
  else if (key === 'file' && val) target.file = val;
  else if (key === 'min_budget' && val && Number.isFinite(Number(val))) target.min_budget = Number(val);
}

function escapeMdCell(val) {
  return String(val ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export async function scanAllConfiguredFeeds(root, {
  configPath = null,
  top = 15,
  minBudget = null,
  concurrency = 4,
  write = true,
  fetchImpl = null,
  lookupImpl = undefined,
  home = os.homedir(),
  cwd = null,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const baseDir = cwd ? path.resolve(cwd) : resolvedRoot;
  const cfgAbs = configPath
    ? (path.isAbsolute(configPath) ? path.resolve(configPath) : path.resolve(baseDir, configPath))
    : path.join(resolvedRoot, 'context', 'feeds.yaml');

  if (!isWithinDir(cfgAbs, resolvedRoot)) {
    throw new Error(`Refusing feeds config outside workspace boundary: ${configPath}`);
  }
  refuseSymlink(cfgAbs, resolvedRoot, home);
  if (!fs.existsSync(cfgAbs)) {
    throw new Error(`Feeds config not found at ${cfgAbs}. Copy context/feeds.yaml.example to context/feeds.yaml and enable at least one feed.`);
  }

  const allConfigured = parseFeedsConfigYaml(readFileBoundedSync(cfgAbs, 256 * 1024, 'feeds.yaml').toString('utf8'));
  const enabledFeeds = allConfigured.filter(f => f.enabled);
  const maxWorkers = Math.max(1, Math.min(4, Number.isInteger(concurrency) ? concurrency : 4));
  const topN = Number.isInteger(top) && top > 0 ? Math.min(top, 50) : 15;

  const briefResult = compileCandidateBrief(resolvedRoot, { write: false, home });
  const brief = briefResult.brief || null;
  const { urlKeys, fpKeys } = loadExistingDedupKeys(resolvedRoot, { home });
  const blacklist = (brief?.constraints?.blacklist || []).map(b => b.toLowerCase());
  const globalMinBudget = Number.isFinite(minBudget) ? minBudget : (brief?.rate_floor?.min_budget ?? null);

  // Bounded concurrency worker pool (max 4 concurrent sources) with per-source fault isolation
  let nextIdx = 0;
  let activeCount = 0;
  let peakConcurrency = 0;
  const perSourceResults = new Array(enabledFeeds.length);

  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= enabledFeeds.length) return;
      const feed = enabledFeeds[idx];
      activeCount++;
      if (activeCount > peakConcurrency) peakConcurrency = activeCount;
      try {
        let rawText = '';
        let sourceLabel = feed.url || feed.file || feed.name;
        if (feed.file) {
          const fAbs = path.isAbsolute(feed.file) ? path.resolve(feed.file) : path.resolve(resolvedRoot, feed.file);
          if (!isWithinDir(fAbs, resolvedRoot)) throw new Error(`Feed file outside workspace: ${feed.file}`);
          refuseSymlink(fAbs, resolvedRoot, home);
          rawText = readFileBoundedSync(fAbs, MAX_LOCAL_FEED_BYTES, feed.name).toString('utf8');
          sourceLabel = path.relative(resolvedRoot, fAbs).replace(/\\/g, '/');
        } else {
          const res = await fetchTextWithSafeRedirects(feed.url, { fetchImpl, lookupImpl });
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`HTTP ${res.status}`);
          }
          rawText = res.text;
          sourceLabel = res.finalUrl;
        }
        const parsed = parseFeedText(rawText, { sourceUrl: feed.url || '' });
        perSourceResults[idx] = {
          status: 'fulfilled',
          feed,
          sourceLabel,
          items: parsed,
        };
      } catch (err) {
        perSourceResults[idx] = {
          status: 'rejected',
          feed,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        activeCount--;
      }
    }
  };

  await Promise.allSettled(Array.from({ length: Math.min(maxWorkers, enabledFeeds.length) }, () => worker()));

  const sourceStatuses = [];
  const scored = [];
  const seenCrossFeedUrls = new Set();
  const seenCrossFeedFps = new Set();
  let totalScanned = 0;
  let filteredDuplicates = 0;
  let filteredBlacklist = 0;
  let filteredBudget = 0;

  for (const outcome of perSourceResults) {
    if (!outcome) continue;
    if (outcome.status === 'rejected') {
      sourceStatuses.push({
        name: outcome.feed.name,
        ok: false,
        scanned: 0,
        kept: 0,
        error: outcome.error,
      });
      continue;
    }

    const effMin = globalMinBudget !== null ? globalMinBudget : outcome.feed.min_budget;
    let keptFromSource = 0;
    totalScanned += outcome.items.length;

    for (const item of outcome.items) {
      const uKey = canonicalUrlKey(item.url);
      const fp = item.company ? `${item.company.toLowerCase()}::${item.title.toLowerCase()}` : null;
      if (
        (uKey && (urlKeys.has(uKey) || seenCrossFeedUrls.has(uKey))) ||
        (fp && (fpKeys.has(fp) || seenCrossFeedFps.has(fp)))
      ) {
        filteredDuplicates++;
        continue;
      }
      if (uKey) seenCrossFeedUrls.add(uKey);
      if (fp) seenCrossFeedFps.add(fp);

      const hay = `${item.company || ''} ${item.url || ''} ${item.title}`.toLowerCase();
      if (blacklist.some(b => b && hay.includes(b))) {
        filteredBlacklist++;
        continue;
      }
      if (effMin !== null && effMin > 0 && item.budget_num !== null && item.budget_num < effMin) {
        filteredBudget++;
        continue;
      }

      const fit = scoreFeedItem(item, brief);
      keptFromSource++;
      scored.push({
        source_name: outcome.feed.name,
        title: item.title,
        url: item.url,
        company: item.company,
        budget: item.budget_raw,
        posted_at: item.posted_at,
        fit_score: fit.score,
        matched_skills: fit.matched_skills,
        ...(fit.unverified_required.length ? { unverified_required: fit.unverified_required } : {}),
        ...(item.injection_flags.length ? { injection_flags: item.injection_flags } : {}),
        snippet: item.snippet.slice(0, 160),
      });
    }

    sourceStatuses.push({
      name: outcome.feed.name,
      ok: true,
      scanned: outcome.items.length,
      kept: keptFromSource,
      error: null,
    });
  }

  scored.sort((a, b) => b.fit_score - a.fit_score);
  const topItems = scored.slice(0, topN).map((it, i) => ({ rank: i + 1, ...it }));

  const today = new Date().toISOString().slice(0, 10);
  const digestPath = path.join(resolvedRoot, 'logs', 'radar', `${today}.md`);
  if (write) {
    const mdLines = [
      `# Veycraft Daily Opportunity Radar — ${today}`,
      '',
      '> `UNTRUSTED_EXTERNAL_DATA`: Review every listing manually before drafting or approving any bid or application. Zero automatic submissions occur.',
      '',
      `- **Enabled Sources:** ${enabledFeeds.length} (OK: ${sourceStatuses.filter(s => s.ok).length}, Failed: ${sourceStatuses.filter(s => !s.ok).length}, Peak Concurrency: ${peakConcurrency})`,
      `- **Scanned:** ${totalScanned} | **Duplicates Filtered:** ${filteredDuplicates} | **Blacklist Filtered:** ${filteredBlacklist} | **Below Budget:** ${filteredBudget} | **Top Shortlist:** ${topItems.length}`,
      '',
      '## Source Health',
      '',
      '| Source | Status | Scanned | Kept | Notes |',
      '|---|---|---|---|---|',
      ...sourceStatuses.map(s => `| ${escapeMdCell(s.name)} | ${s.ok ? 'OK' : 'FAILED'} | ${s.scanned} | ${s.kept} | ${escapeMdCell(s.error || '—')} |`),
      '',
      '## Ranked Shortlist',
      '',
      '| # | Fit | Source | Title | Budget | Matched Skills | URL | Flags |',
      '|---|---|---|---|---|---|---|---|',
      ...(topItems.length > 0
        ? topItems.map(it =>
            `| ${it.rank} | ${it.fit_score}% | ${escapeMdCell(it.source_name)} | ${escapeMdCell(it.title)} | ${escapeMdCell(it.budget || 'Unstated')} | ${escapeMdCell((it.matched_skills || []).join(', ') || '—')} | ${escapeMdCell(it.url || '—')} | ${escapeMdCell((it.injection_flags || []).join(', ') || 'clean')} |`
          )
        : ['| — | — | — | No new matching items found | — | — | — | — |']),
      '',
    ];
    writeAtomic(digestPath, mdLines.join('\n'), { boundary: resolvedRoot, home });
  }

  return {
    ok: true,
    mode: 'multi_feed_radar',
    untrusted_external_data: true,
    config_path: path.relative(resolvedRoot, cfgAbs).replace(/\\/g, '/'),
    digest_path: write ? path.relative(resolvedRoot, digestPath).replace(/\\/g, '/') : null,
    enabled_sources: enabledFeeds.length,
    succeeded_sources: sourceStatuses.filter(s => s.ok).length,
    failed_sources: sourceStatuses.filter(s => !s.ok).length,
    peak_concurrency: peakConcurrency,
    total_scanned: totalScanned,
    filtered_duplicates: filteredDuplicates,
    filtered_blacklist: filteredBlacklist,
    filtered_budget: filteredBudget,
    returned_count: topItems.length,
    source_statuses: sourceStatuses,
    items: topItems,
  };
}

// ---------------- 60-Second Interactive / Non-Interactive Onboarding (`veycraft onboard`) ----------------

function normalizeGithubUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+/i.test(s)) return s;
  const handle = s.replace(/^@/, '').replace(/^github\.com\//i, '').split('/')[0];
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle)) return `https://github.com/${handle}`;
  return null;
}

async function promptLineList(questions, { input = process.stdin, output = process.stdout } = {}) {
  const answers = [];
  if (!input) return answers;

  // For non-TTY piped stdin, read all lines upfront cleanly so EOF never hangs on any OS
  if (!input.isTTY) {
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    const rawLines = chunks.join('').split(/\r?\n/);
    for (let i = 0; i < questions.length; i++) {
      answers.push((rawLines[i] || '').trim());
    }
    return answers;
  }

  const rl = readline.createInterface({ input, output });
  try {
    for (const q of questions) {
      try {
        const ans = await rl.question(q);
        answers.push(String(ans || '').trim());
      } catch {
        answers.push('');
      }
    }
  } finally {
    rl.close();
  }
  return answers;
}

export async function runOnboardingWizard(root, {
  cvPath = null,
  role = null,
  stack = null,
  minBudget = null,
  minHourly = null,
  currency = null,
  workMode = null,
  github = null,
  portfolio = null,
  force = false,
  nonInteractive = false,
  useStdin = false,
  input = process.stdin,
  output = process.stdout,
  home = os.homedir(),
  cwd = null,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const baseDir = cwd ? path.resolve(cwd) : resolvedRoot;

  let effCv = cvPath;
  let effRole = role;
  let effStack = stack;
  let effMinBudget = minBudget;
  let effWorkMode = workMode;
  let effGithub = github;
  let effPortfolio = portfolio;
  const effCurrency = String(currency || 'USD').toUpperCase();

  const hasExplicitFlags = Boolean(effCv || effRole || effStack || effMinBudget !== null || effGithub || effWorkMode);
  const shouldPrompt = !nonInteractive && (useStdin || (!hasExplicitFlags && Boolean(input?.isTTY)));

  if (shouldPrompt) {
    const [aRole, aStack, aBudget, aMode, aGithub, aCv] = await promptLineList([
      '1/6 Target role / headline (e.g., Senior Full-Stack TypeScript Engineer): ',
      '2/6 Core skills comma-separated (e.g., TypeScript, Next.js, Node.js, PostgreSQL): ',
      '3/6 Minimum project budget / monthly floor in USD (optional, e.g., 400): ',
      '4/6 Work mode (remote / hybrid / onsite) [remote]: ',
      '5/6 GitHub handle or URL (optional): ',
      '6/6 Path to existing CV (.md/.txt/.html inside workspace, optional): ',
    ], { input, output });
    if (!effRole && aRole) effRole = aRole;
    if (!effStack && aStack) effStack = aStack;
    if (effMinBudget === null && aBudget && /^\d+(?:\.\d+)?$/.test(aBudget)) effMinBudget = Number(aBudget);
    if (!effWorkMode && aMode) effWorkMode = aMode;
    if (!effGithub && aGithub) effGithub = aGithub;
    if (!effCv && aCv) effCv = aCv;
  }

  const finalRole = String(effRole || '').trim() || 'Software Engineer';
  const finalSkills = String(effStack || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 15);
  const finalWorkMode = /^(remote|hybrid|onsite)$/i.test(String(effWorkMode || '').trim())
    ? String(effWorkMode).trim().toLowerCase()
    : 'remote';
  const finalGithubUrl = normalizeGithubUrl(effGithub);
  const finalPortfolioUrl = portfolio && /^https:\/\//i.test(String(portfolio).trim()) ? String(portfolio).trim() : null;

  const writtenFiles = [];
  const skippedExisting = [];

  const canWriteContextFile = (absPath) => {
    if (!fs.existsSync(absPath)) return true;
    if (force) return true;
    try {
      refuseSymlink(absPath, resolvedRoot, home);
      const txt = fs.readFileSync(absPath, 'utf8');
      return isUntouchedStarterFile(absPath, txt, resolvedRoot, home);
    } catch {
      return false;
    }
  };

  // 1. context/cv.md (from --cv if provided, else grounded starter summary)
  const cvDest = path.join(resolvedRoot, 'context', 'cv.md');
  if (effCv) {
    const srcAbs = path.isAbsolute(effCv) ? path.resolve(effCv) : path.resolve(baseDir, effCv);
    if (!isWithinDir(srcAbs, resolvedRoot)) {
      throw new Error(`Refusing CV source outside workspace boundary: ${effCv}`);
    }
    refuseSymlink(srcAbs, resolvedRoot, home);
    if (!fs.existsSync(srcAbs)) throw new Error(`CV file not found: ${srcAbs}`);
    const rawCv = readFileBoundedSync(srcAbs, 512 * 1024, 'CV source').toString('utf8');
    const cleanCv = /\.html?$/i.test(srcAbs) ? decodeXmlHtmlEntities(stripMarkupTags(rawCv, '\n')) : rawCv;
    if (canWriteContextFile(cvDest)) {
      writeAtomic(cvDest, cleanCv, { boundary: resolvedRoot, home });
      writtenFiles.push('context/cv.md');
    } else {
      skippedExisting.push('context/cv.md');
    }
  } else if (canWriteContextFile(cvDest)) {
    const starterCv = [
      `# ${finalRole}`,
      '',
      `Skills: ${finalSkills.length ? finalSkills.join(', ') : 'TypeScript, Node.js'}`,
      '',
      '## Experience',
      `- Add verified project outcomes and metrics for ${finalRole}.`,
      '',
    ].join('\n');
    writeAtomic(cvDest, starterCv, { boundary: resolvedRoot, home });
    writtenFiles.push('context/cv.md');
  } else {
    skippedExisting.push('context/cv.md');
  }

  // 2. context/profile.md
  const profileDest = path.join(resolvedRoot, 'context', 'profile.md');
  if (canWriteContextFile(profileDest)) {
    const profileLines = [
      '# Candidate Profile',
      '',
      `Headline: ${finalRole}`,
      `Work Mode: ${finalWorkMode}`,
      ...(finalGithubUrl ? [`GitHub: ${finalGithubUrl}`] : []),
      ...(finalPortfolioUrl ? [`Portfolio: ${finalPortfolioUrl}`] : []),
      '',
    ];
    writeAtomic(profileDest, profileLines.join('\n'), { boundary: resolvedRoot, home });
    writtenFiles.push('context/profile.md');
  } else {
    skippedExisting.push('context/profile.md');
  }

  // 3. context/preferences.yaml
  const prefDest = path.join(resolvedRoot, 'context', 'preferences.yaml');
  if (canWriteContextFile(prefDest)) {
    const prefLines = [
      `roles: [${JSON.stringify(finalRole)}]`,
      `work_mode: ${finalWorkMode}`,
      `currency: ${effCurrency}`,
      ...(effMinBudget !== null && Number.isFinite(Number(effMinBudget)) ? [`min_budget: ${Number(effMinBudget)}`] : []),
      ...(minHourly !== null && Number.isFinite(Number(minHourly)) ? [`min_hourly: ${Number(minHourly)}`] : []),
      'languages:',
      '  - en',
      ...(finalSkills.length
        ? ['skills:', ...finalSkills.map(s => `  - ${s}`)]
        : []),
      'blacklisted_companies: []',
      '',
    ];
    writeAtomic(prefDest, prefLines.join('\n'), { boundary: resolvedRoot, home });
    writtenFiles.push('context/preferences.yaml');
  } else {
    skippedExisting.push('context/preferences.yaml');
  }

  // 4. context/feeds.yaml (Option 2A: enable 2 public developer JSON feeds on fresh/untouched workspace)
  const feedsDest = path.join(resolvedRoot, 'context', 'feeds.yaml');
  const canWriteFeeds = (() => {
    if (!fs.existsSync(feedsDest)) return true;
    if (force) return true;
    try {
      refuseSymlink(feedsDest, resolvedRoot, home);
      const txt = fs.readFileSync(feedsDest, 'utf8');
      if (isUntouchedStarterFile(feedsDest, txt, resolvedRoot, home)) return true;
      const parsed = parseFeedsConfigYaml(txt);
      return parsed.length > 0 && parsed.every(f => !f.enabled) && txt.includes('Remotive Software Dev JSON');
    } catch {
      return false;
    }
  })();
  if (canWriteFeeds) {
    const starterFeedsYaml = [
      '# Veycraft Multi-Source Zero-Token Opportunity Radar Configuration',
      '# Generated by `veycraft onboard` (gitignored & never published). Run: npx veycraft feed-scan --all',
      '',
      'feeds:',
      '  - name: Remotive Software Dev JSON',
      '    enabled: true',
      '    url: https://remotive.com/api/remote-jobs?category=software-dev',
      '    min_budget: 0',
      '',
      '  - name: Arbeitnow Public Job Board JSON',
      '    enabled: true',
      '    url: https://www.arbeitnow.com/api/job-board-api',
      '    min_budget: 0',
      '',
      '  - name: RemoteOK Public JSON',
      '    enabled: false',
      '    url: https://remoteok.com/api',
      '    min_budget: 0',
      '',
      '  - name: Custom Freelance or Company RSS Feed',
      '    enabled: false',
      '    url: https://example.org/jobs.rss',
      ...(effMinBudget !== null && Number.isFinite(Number(effMinBudget)) ? [`    min_budget: ${Number(effMinBudget)}`] : ['    min_budget: 400']),
      '',
    ].join('\n');
    writeAtomic(feedsDest, starterFeedsYaml, { boundary: resolvedRoot, home });
    writtenFiles.push('context/feeds.yaml');
  }

  // 5. Immediately compile compact context/brief.json (< 400 tokens)
  const briefRes = compileCandidateBrief(resolvedRoot, { refresh: true, write: true, home });
  if (briefRes.brief_ready) writtenFiles.push('context/brief.json');

  return {
    ok: true,
    onboarded: true,
    written_files: writtenFiles,
    skipped_existing: skippedExisting,
    brief: {
      ready: briefRes.brief_ready,
      bytes: briefRes.bytes || 0,
      est_tokens: briefRes.est_tokens || 0,
      path: briefRes.brief_ready ? 'context/brief.json' : null,
    },
  };
}

// ---------------- Scoped CLI Runner for `brief`, `feed-scan`, `browser-script`, `onboard` ----------------

export async function runFastOpsCli(root, command, rawArgs = [], { home = os.homedir(), cwd = process.cwd() } = {}) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  let json = false;
  let help = false;

  if (command === 'brief') {
    let refresh = false;
    let write = true;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--json') json = true;
      else if (a === '--refresh') refresh = true;
      else if (a === '--no-write') write = false;
      else if (a === '--help' || a === '-h') help = true;
      else throw new Error(`Unknown option for \`veycraft brief\`: "${a}".`);
    }
    if (help) {
      return {
        json: false,
        exitCode: 0,
        lines: [
          'Usage: veycraft brief [--refresh] [--no-write] [--json]',
          'Compiles or reads cached context/brief.json (< 400 tokens, zero PII) with mtime+sha256 invalidation.',
        ],
      };
    }
    const res = compileCandidateBrief(root, { refresh, write, home });
    return {
      json,
      exitCode: 0,
      data: res,
      lines: res.brief_ready
        ? [
            `Candidate brief ready (${res.cached ? 'cache hit' : 'compiled'}): ${res.path}`,
            `Size: ${res.bytes} bytes (~${res.est_tokens} tokens) · Headline: ${res.brief.headline}`,
            `Core stack (${res.brief.core_stack.length}): ${res.brief.core_stack.join(', ') || 'none'}`,
          ]
        : [`Brief not ready: ${res.reason}`],
    };
  }

  if (command === 'onboard') {
    let cvPath = null;
    let role = null;
    let stack = null;
    let minBudget = null;
    let minHourly = null;
    let currency = null;
    let workMode = null;
    let github = null;
    let portfolio = null;
    let force = false;
    let nonInteractive = false;
    let useStdin = false;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--json') json = true;
      else if (a === '--help' || a === '-h') help = true;
      else if (a === '--force') force = true;
      else if (a === '--non-interactive') nonInteractive = true;
      else if (a === '--stdin') useStdin = true;
      else if (a === '--cv') { cvPath = args[++i]; if (!cvPath) throw new Error('Option --cv requires a file path.'); }
      else if (a === '--role') { role = args[++i]; if (!role) throw new Error('Option --role requires a role title.'); }
      else if (a === '--stack') { stack = args[++i]; if (!stack) throw new Error('Option --stack requires comma-separated skills.'); }
      else if (a === '--currency') { currency = args[++i]; if (!currency) throw new Error('Option --currency requires a currency code.'); }
      else if (a === '--work-mode') { workMode = args[++i]; if (!workMode) throw new Error('Option --work-mode requires remote|hybrid|onsite.'); }
      else if (a === '--github') { github = args[++i]; if (!github) throw new Error('Option --github requires a handle or URL.'); }
      else if (a === '--portfolio') { portfolio = args[++i]; if (!portfolio) throw new Error('Option --portfolio requires an HTTPS URL.'); }
      else if (a === '--min-budget') {
        const rawVal = args[++i];
        if (!rawVal || !/^\d+(?:\.\d+)?$/.test(rawVal)) throw new Error(`Invalid --min-budget value: "${rawVal}".`);
        minBudget = Number(rawVal);
      } else if (a === '--min-hourly') {
        const rawVal = args[++i];
        if (!rawVal || !/^\d+(?:\.\d+)?$/.test(rawVal)) throw new Error(`Invalid --min-hourly value: "${rawVal}".`);
        minHourly = Number(rawVal);
      } else {
        throw new Error(`Unknown option for \`veycraft onboard\`: "${a}".`);
      }
    }
    if (help) {
      return {
        json: false,
        exitCode: 0,
        lines: [
          'Usage: veycraft onboard [--cv <path>] [--role <title>] [--stack <a,b,c>] [--min-budget <n>] [--min-hourly <n>] [--currency <USD>] [--work-mode <remote|hybrid|onsite>] [--github <handle>] [--portfolio <https-url>] [--force] [--non-interactive | --stdin] [--json]',
          '60-second zero-dependency onboarding wizard: populates context/ files (preserving existing verified files unless --force) and compiles context/brief.json (< 400 tokens).',
        ],
      };
    }
    const res = await runOnboardingWizard(root, {
      cvPath, role, stack, minBudget, minHourly, currency, workMode, github, portfolio,
      force, nonInteractive, useStdin, home, cwd,
    });
    return {
      json,
      exitCode: 0,
      data: res,
      lines: [
        `Onboarding complete. Written: ${res.written_files.join(', ') || 'none'}${res.skipped_existing.length ? ` | Preserved existing: ${res.skipped_existing.join(', ')}` : ''}`,
        res.brief.ready
          ? `Candidate brief ready: ${res.brief.path} (${res.brief.bytes} bytes, ~${res.brief.est_tokens} tokens)`
          : 'Candidate brief pending real CV/profile details.',
      ],
    };
  }

  if (command === 'feed-scan') {
    let url = null;
    let file = null;
    let all = false;
    let configPath = null;
    let top = 10;
    let topExplicit = false;
    let minBudget = null;
    let concurrency = 4;
    let write = true;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--json') json = true;
      else if (a === '--help' || a === '-h') help = true;
      else if (a === '--all') all = true;
      else if (a === '--no-write') write = false;
      else if (a === '--config') {
        configPath = args[++i];
        if (!configPath || configPath.startsWith('-')) throw new Error('Option --config requires a workspace path to feeds.yaml.');
      } else if (a === '--url') {
        url = args[++i];
        if (!url || url.startsWith('-')) throw new Error('Option --url requires an HTTPS URL.');
      } else if (a === '--file') {
        file = args[++i];
        if (!file || file.startsWith('-')) throw new Error('Option --file requires a workspace file path.');
      } else if (a === '--top') {
        const rawTop = args[++i];
        if (!rawTop || !/^\d+$/.test(rawTop) || Number(rawTop) < 1) throw new Error(`Invalid --top value: "${rawTop}".`);
        top = Number(rawTop);
        topExplicit = true;
      } else if (a === '--min-budget') {
        const rawMin = args[++i];
        if (!rawMin || !/^\d+(?:\.\d+)?$/.test(rawMin)) throw new Error(`Invalid --min-budget value: "${rawMin}".`);
        minBudget = Number(rawMin);
      } else if (a === '--concurrency') {
        const rawConc = args[++i];
        if (!rawConc || !/^[1-4]$/.test(rawConc)) throw new Error(`Invalid --concurrency value (must be 1..4): "${rawConc}".`);
        concurrency = Number(rawConc);
      } else {
        throw new Error(`Unknown option for \`veycraft feed-scan\`: "${a}".`);
      }
    }
    if (help) {
      return {
        json: false,
        exitCode: 0,
        lines: [
          'Usage: veycraft feed-scan (--all [--config <feeds.yaml>] [--concurrency 1..4] [--no-write] | --url <https-url> | --file <path>) [--top <n>] [--min-budget <n>] [--json]',
          'Zero-token local RSS/Atom/JSON feed scanner with SEC-01 SSRF protection, bounded concurrency (max 4), deduplication, daily logs/radar/YYYY-MM-DD.md digest, and local Fit Score (0-100) ranking.',
        ],
      };
    }
    if (all) {
      if (url || file) throw new Error('Cannot combine --all with --url or --file.');
      const res = await scanAllConfiguredFeeds(root, {
        configPath,
        top: topExplicit ? top : 15,
        minBudget,
        concurrency,
        write,
        home,
        cwd,
      });
      return {
        json,
        exitCode: 0,
        data: res,
        lines: [
          `Radar scanned ${res.enabled_sources} source(s) (ok: ${res.succeeded_sources}, failed: ${res.failed_sources}, peak concurrency: ${res.peak_concurrency}) -> ${res.returned_count} top item(s) from ${res.total_scanned} scanned`,
          ...(res.enabled_sources === 0
            ? ['Hint: 0 feeds are enabled in context/feeds.yaml. Set "enabled: true" on a source in context/feeds.yaml (or run `veycraft onboard`), or scan one feed directly via `veycraft feed-scan --url <https-rss-or-json-url>`.']
            : []),
          ...(res.digest_path ? [`Saved daily digest -> ${res.digest_path}`] : []),
          ...res.items.map(it => `#${it.rank} [${it.fit_score}%] (${it.source_name}) ${it.title}${it.budget ? ` (${it.budget})` : ''}`),
        ],
      };
    }
    const res = await scanPublicFeeds(root, { url, file, top, minBudget, home, cwd });
    return {
      json,
      exitCode: 0,
      data: res,
      lines: [
        `Scanned ${res.total_scanned} item(s) from ${res.source} -> returning top ${res.returned_count} (deduped: ${res.filtered_duplicates}, blacklist: ${res.filtered_blacklist}, below budget: ${res.filtered_budget})`,
        ...res.items.map(it => `#${it.rank} [${it.fit_score}%] ${it.title}${it.budget ? ` (${it.budget})` : ''}${it.url ? ` — ${it.url}` : ''}`),
      ],
    };
  }

  if (command === 'browser-script') {
    let targetName = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--json') json = true;
      else if (a === '--help' || a === '-h') help = true;
      else if (a.startsWith('-')) throw new Error(`Unknown option for \`veycraft browser-script\`: "${a}".`);
      else if (!targetName) targetName = a;
      else throw new Error(`Unexpected extra argument for \`veycraft browser-script\`: "${a}".`);
    }
    if (help || !targetName) {
      return {
        json: false,
        exitCode: help ? 0 : 1,
        lines: [
          `Usage: veycraft browser-script <${PAYLOAD_NAMES.join('|')}> [--json]`,
          'Prints read-only DOM distiller or single-shot non-submitting batch-fill JS payload (never clicks Submit/Publish).',
        ],
      };
    }
    const payload = getBrowserPayload(targetName);
    return {
      json,
      exitCode: 0,
      data: payload,
      lines: [
        `Payload: ${payload.name} (read_only=${payload.read_only}, never_submits=${payload.never_submits})`,
        payload.usage,
        payload.fn_source,
      ],
    };
  }

  throw new Error(`Unknown fast-ops command: "${command}".`);
}
