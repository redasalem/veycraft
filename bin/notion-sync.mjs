// Zero-dependency Notion Sync Safety, Sync-State, Diff, Reservation & Reconciliation Foundation (Stage 3 — T7 + T8-A + T8-B + T8-C).
// Strictly transport-free: no network calls, no HTTP/fetch,
// no Notion SDK, no external writes, and no NOTION_TOKEN access.
// Local disk I/O is restricted strictly to logs/sync-state.json & logs/.sync-state.lock (never mutates the application ledger).
// Uses Node.js built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { isObj, isWithinDir, isBlockedSsrfUrl, refuseSymlink, writeAtomic } from './fs-safety.mjs';
import {
  SUBMITTED_STATUSES,
  normalizeStatus,
  isUsableJobId,
  computeApplicationId,
  isThirdPartyCvPath,
  validateCvVersionsRegistry,
  validateDailyRun,
  validateCareerInsights,
} from './career-intelligence.mjs';

export const NOTION_SYNC_ELIGIBLE_STATUSES = Object.freeze([...SUBMITTED_STATUSES]);
const SUBMITTED_STATUS_SET = new Set(NOTION_SYNC_ELIGIBLE_STATUSES);

export const NOTION_TARGET_DATABASES = Object.freeze(['applications', 'daily_runs', 'insights']);
const TARGET_DATABASE_SET = new Set(NOTION_TARGET_DATABASES);

export const RECONCILE_FILTER_PROPERTY_BY_DB = Object.freeze({
  applications: 'Application ID',
  daily_runs: 'Run ID',
  insights: 'Period Key',
});

export const NOTION_DATABASE_SCHEMAS = Object.freeze({
  applications: Object.freeze({
    Title: 'title',
    'Application ID': 'rich_text',
    'Job ID': 'rich_text',
    Company: 'rich_text',
    Role: 'rich_text',
    Status: 'select',
    Platform: 'select',
    'Source Channel': 'select',
    'Applied Date': 'date',
    'Last Updated': 'date',
    'Match Score': 'number',
    'Job URL': 'url',
    'CV Version': 'rich_text',
    Tailored: 'checkbox',
    'Interview Rounds': 'number',
    Assessments: 'number',
    'Sync Hash': 'rich_text',
  }),
  daily_runs: Object.freeze({
    'Run ID': 'title',
    Status: 'select',
    'Dry Run': 'checkbox',
    Scanned: 'number',
    Prepared: 'number',
    Applied: 'number',
    Skipped: 'number',
    'Needs Review': 'number',
    Failed: 'number',
    Platforms: 'multi_select',
    'Sync Hash': 'rich_text',
  }),
  insights: Object.freeze({
    'Period Key': 'title',
    'Report Type': 'select',
    Period: 'rich_text',
    'Generated At': 'date',
    Submitted: 'number',
    Scanned: 'number',
    'Avg Match Score': 'number',
    'Sample Sufficient': 'checkbox',
    'Top Skills': 'multi_select',
    'Skill Gaps': 'multi_select',
    'Sync Hash': 'rich_text',
  }),
});

export const NOTION_UUID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

const APP_ID_RE = /^app_[a-f0-9]{12}$/;
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX16_RE = /^[a-f0-9]{16}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TITLE_LEN = 200;
const MAX_PROJECTED_STRING_LEN = 500;

const ALLOWED_INSIGHT_TYPES = new Set(['weekly', 'monthly', 'calibration', 'rejection_audit', 'all']);
const SYNC_ITEM_STATES = new Set([
  'ineligible_not_submitted',
  'pending_sync',
  'blocked_privacy',
  'previewed',
  'in_flight',
  'synced',
  'failed_retryable',
  'failed_permanent',
  'conflict_duplicate_remote',
  'receipt_uncertain',
]);
const EXECUTABLE_OP_STATES = new Set([
  'previewed',
  'in_flight',
  'synced',
  'failed_retryable',
  'failed_permanent',
  'conflict_duplicate_remote',
  'receipt_uncertain',
]);
const PRIVACY_VIOLATION_CODES = new Set([
  'secret_token',
  'private_email',
  'phone_number',
  'local_file_path',
  'eeo_or_sensitive_key',
  'raw_cv_dump',
  'unsafe_url',
  'third_party_subject',
]);
const PLAN_MODES = new Set(['preview', 'approved_execute', 'verified']);
const OP_ACTIONS = new Set(['create', 'update', 'skip_unchanged']);

const PLAN_KEYS = new Set([
  'schema_version', 'plan_id', 'plan_hash', 'created_at', 'mode',
  'eligibility_policy', 'transport_enabled', 'dry_run', 'approval',
  'operations', 'blocked_items', 'skipped_ineligible',
]);
const APPROVAL_KEYS = new Set([
  'approved_plan_hash', 'approved_plan_id', 'approved_at', 'approved_by', 'operation_count',
]);
const PLANNED_OP_KEYS = new Set([
  'operation_id', 'database', 'canonical_key', 'application_status',
  'action', 'existing_page_id', 'sync_hash', 'payload', 'status',
]);
const BLOCKED_ITEM_KEYS = new Set(['database', 'canonical_key', 'state', 'violations']);
const PRIVACY_VIOLATION_KEYS = new Set(['field_path', 'code', 'reason']);
const SKIPPED_INELIGIBLE_KEYS = new Set(['canonical_key', 'status', 'reason']);
const SYNC_STATE_FILE_KEYS = new Set(['schema_version', 'updated_at', 'records']);
const SYNC_STATE_ENTRY_KEYS = new Set([
  'database', 'canonical_key', 'state', 'page_id', 'last_synced_hash',
  'attempted_hash', 'attempted_at', 'last_synced_at', 'operation_id',
  'approved_plan_hash', 'retry_count', 'next_retry_after',
  'conflicting_page_ids', 'last_error',
]);

// High-specificity privacy detectors (zero secret echoing in violation reasons)
const SECRET_TOKEN_PATTERNS = [
  /\bntn_[A-Za-z0-9]{10,}\b/,
  /\bsecret_[A-Za-z0-9]{10,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox(?:b|p|a|r|s)-[0-9A-Za-z-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\b(?:NOTION_TOKEN|API_KEY|ACCESS_TOKEN|AUTH_TOKEN)\s*[:=]\s*\S{6,}/i,
];
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERNS = [
  /(?:^|[\s,:(])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:$|[\s),;])/,
  /(?:^|[\s,:])\(\d{3}\)\s*\d{3}[-.\s]\d{4}(?:$|[\s),;])/,
  /(?:^|[\s,:])\d{3}[-.\s]\d{3}[-.\s]\d{4}(?:$|[\s),;])/,
];
const PHONE_SKIP_FIELDS = new Set([
  'Job URL', 'Applied Date', 'Last Updated', 'Generated At',
  'Application ID', 'Job ID', 'Run ID', 'Sync Hash',
]);
const LOCAL_PATH_PATTERNS = [
  /\bfile:\/\//i,
  /(?<![A-Za-z0-9:/])[A-Za-z]:[\\/][^\s]+/,
  /(?:^|\s)\\\\[A-Za-z0-9._-]+\\[^\s]+/,
  /(?<![:\w])\/(?:Users|home|etc|var|tmp|opt|mnt)\/[^\s]+/,
  /(?:^|\s)~\/[^\s]+/,
  /(?:^|[\s"'`:])(?:\.\.?[\\/])*(?:logs|context|assets|browser-profile)[\\/][^\s]+/i,
  /(?:^|[\s"'`:])\.\.?[\\/][^\s]+[\\/][^\s]+/,
];
const SENSITIVE_KEY_RE = /(?:gender|race|ethnicity|veteran|disability|nationality|visa|ssn|passport|salary_floor|comp_floor|password|cookie|token|secret)/i;
const RESUME_HTML_RE = /<!DOCTYPE\b|<html\b|<body\b/i;
const RESUME_HEADING_PATTERNS = [
  /\bWork Experience\b/i,
  /\bProfessional Summary\b/i,
  /\bEducation\b/i,
  /\bTechnical Skills\b/i,
  /\bCertifications\b/i,
];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidIsoDateTime(v) {
  if (typeof v !== 'string' || !ISO_DATETIME_RE.test(v)) return false;
  const match = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[7] !== 'Z') {
    const tzH = Number(match[9]);
    const tzM = Number(match[10]);
    if (tzH > 23 || tzM > 59) return false;
  }
  const calCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calCheck.getUTCFullYear() !== year ||
    calCheck.getUTCMonth() + 1 !== month ||
    calCheck.getUTCDate() !== day
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(v));
}

function normalizeString(v) {
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeDateYmd(v) {
  if (!isNonEmptyString(v)) return null;
  const ts = Date.parse(v);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function normalizeDateIso(v) {
  if (!isNonEmptyString(v)) return null;
  const ts = Date.parse(v);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}

function normalizeBoundedScore(rawScore) {
  if (rawScore === null || rawScore === undefined || rawScore === '') return null;
  const n = Number(rawScore);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

function normalizeNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function codePointCompare(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function normalizeStringList(arr, { lowercase = false, limit = null } = {}) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const clean = normalizeString(item);
    if (!clean) continue;
    const val = lowercase ? clean.toLowerCase() : clean;
    const dedupeKey = val.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(val);
    if (limit !== null && out.length >= limit) break;
  }
  return out.sort(codePointCompare);
}

function classifySourceChannel(rec) {
  const explicit = normalizeString(rec?.source_channel);
  if (explicit) return explicit.toLowerCase();
  const p = (normalizeString(rec?.platform) || '').toLowerCase();
  if (['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'breezyhr', 'taleo', 'workable'].includes(p)) {
    return 'direct_ats';
  }
  if (['toptal', 'braintrust', 'lemon', 'gunio', 'contra', 'arc', 'turing'].includes(p)) {
    return 'b2b_network';
  }
  if (p) return 'job_board';
  return 'other';
}

function isUnsafeRelativeRef(relPath) {
  if (relPath === null || relPath === undefined) return false;
  if (typeof relPath !== 'string') return true;
  const norm = relPath.replace(/\\/g, '/').trim();
  if (!norm) return false;
  if (norm.startsWith('/') || /^[A-Za-z]:\//.test(norm) || norm.startsWith('..') || norm.includes('/../')) {
    return true;
  }
  return false;
}

function checkAllowedKeys(obj, allowedSet, label, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowedSet.has(k)) {
      errors.push(`${label}: unexpected property "${k}".`);
    }
  }
}

export function normalizeNotionUuid(rawId) {
  if (typeof rawId !== 'string') return null;
  if (!NOTION_UUID_RE.test(rawId)) return null;
  const hex = rawId.toLowerCase().replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function makeSyncStateKey(database, canonicalKey) {
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`Unsupported Notion target database: "${database}".`);
  }
  if (!isNonEmptyString(canonicalKey)) {
    throw new Error('canonicalKey must be a non-empty string.');
  }
  return `${database}::${canonicalKey.trim()}`;
}

export function formatNotionApplicationTitle(role, company, fallbackKey = 'Untitled Application') {
  const cleanRole = normalizeString(role);
  const cleanCompany = normalizeString(company);
  const cleanFallback = normalizeString(fallbackKey) || 'Untitled Application';
  const rawTitle = cleanRole && cleanCompany
    ? `${cleanRole} — ${cleanCompany}`
    : (cleanRole || cleanCompany || cleanFallback);
  if (rawTitle.length <= MAX_TITLE_LEN) return rawTitle;
  return `${rawTitle.slice(0, MAX_TITLE_LEN - 3).trimEnd()}...`;
}

export function resolveCanonicalSyncKey(database, record) {
  if (!TARGET_DATABASE_SET.has(database)) {
    return { valid: false, canonical_key: null, reason: `unknown_database:${database}` };
  }
  if (!isObj(record)) {
    return { valid: false, canonical_key: null, reason: 'record_not_object' };
  }

  if (database === 'applications') {
    if (!isUsableJobId(record.job_id)) {
      return { valid: false, canonical_key: null, reason: 'missing_or_unusable_job_id' };
    }
    const derived = computeApplicationId(record.job_id);
    if (record.application_id !== undefined && record.application_id !== null) {
      if (typeof record.application_id !== 'string' || !APP_ID_RE.test(record.application_id)) {
        return { valid: false, canonical_key: null, reason: 'invalid_application_id_format' };
      }
      if (record.application_id !== derived) {
        return { valid: false, canonical_key: null, reason: 'application_id_job_id_mismatch' };
      }
    }
    return { valid: true, canonical_key: derived, reason: null };
  }

  if (database === 'daily_runs') {
    if (typeof record.run_id !== 'string' || !RUN_ID_RE.test(record.run_id)) {
      return { valid: false, canonical_key: null, reason: 'invalid_run_id' };
    }
    return { valid: true, canonical_key: record.run_id, reason: null };
  }

  if (database === 'insights') {
    if (!ALLOWED_INSIGHT_TYPES.has(record.type) || !isNonEmptyString(record.period)) {
      return { valid: false, canonical_key: null, reason: 'invalid_insight_type_or_period' };
    }
    return { valid: true, canonical_key: `${record.type}:${record.period.trim()}`, reason: null };
  }

  return { valid: false, canonical_key: null, reason: 'unsupported_database' };
}

export function validateNotionDatabaseSchema(database, retrievedDb) {
  const errors = [];
  const missingProperties = [];
  const typeMismatches = [];
  const extraProperties = [];

  if (!TARGET_DATABASE_SET.has(database)) {
    return {
      valid: false,
      database,
      missing_properties: [],
      type_mismatches: [],
      extra_properties: [],
      errors: [`Unknown Notion target database "${database}". Expected one of: ${NOTION_TARGET_DATABASES.join(', ')}.`],
    };
  }
  if (!isObj(retrievedDb)) {
    return {
      valid: false,
      database,
      missing_properties: Object.keys(NOTION_DATABASE_SCHEMAS[database]),
      type_mismatches: [],
      extra_properties: [],
      errors: [`Retrieved schema for "${database}" must be a JSON object.`],
    };
  }

  const propSource = isObj(retrievedDb.properties) ? retrievedDb.properties : retrievedDb;
  if (!isObj(propSource) || Object.keys(propSource).length === 0) {
    return {
      valid: false,
      database,
      missing_properties: Object.keys(NOTION_DATABASE_SCHEMAS[database]),
      type_mismatches: [],
      extra_properties: [],
      errors: [`Retrieved schema for "${database}" has no properties map.`],
    };
  }

  const expected = NOTION_DATABASE_SCHEMAS[database];
  for (const [propName, expectedType] of Object.entries(expected)) {
    const rawProp = propSource[propName];
    if (rawProp === undefined || rawProp === null) {
      missingProperties.push(propName);
      errors.push(`${database}: missing required Notion property "${propName}" (expected type "${expectedType}").`);
      continue;
    }
    const actualType = typeof rawProp === 'string'
      ? rawProp.trim()
      : (isObj(rawProp) && typeof rawProp.type === 'string' ? rawProp.type.trim() : null);
    if (actualType !== expectedType) {
      typeMismatches.push({ property: propName, expected: expectedType, actual: actualType });
      errors.push(`${database}: property "${propName}" has type "${actualType}" (expected "${expectedType}").`);
    }
  }

  for (const key of Object.keys(propSource)) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) {
      extraProperties.push(key);
    }
  }

  return {
    valid: errors.length === 0,
    database,
    missing_properties: missingProperties,
    type_mismatches: typeMismatches,
    extra_properties: extraProperties.sort(codePointCompare),
    errors,
  };
}

// Safety Resolution 4: Strict fail-closed CV attribution validation.
// Never infer owner status from absence of a third-party marker.
export function validateCvAttribution(raw, { allCvRegistry = null } = {}) {
  const violations = [];
  if (!isObj(raw)) {
    violations.push({
      field_path: 'record',
      code: 'third_party_subject',
      reason: 'Application record must be an object for ownership verification.',
    });
    return { valid: false, attributed: false, owner_cv_entry: null, violations };
  }

  // 1. Explicit application-level provenance check (only undefined or boolean false is allowed)
  if (raw.provenance !== undefined && raw.provenance !== null) {
    if (!isObj(raw.provenance)) {
      violations.push({
        field_path: 'provenance',
        code: 'third_party_subject',
        reason: 'Malformed provenance metadata blocks ownership verification.',
      });
    } else if (raw.provenance.third_party_subject !== undefined && raw.provenance.third_party_subject !== false) {
      violations.push({
        field_path: 'provenance.third_party_subject',
        code: 'third_party_subject',
        reason: 'Application is marked as or has ambiguous third-party subject provenance.',
      });
    }
  }

  // 2. Application-level third-party path checks
  if (raw.cv_tailoring !== undefined && raw.cv_tailoring !== null) {
    if (!isObj(raw.cv_tailoring)) {
      violations.push({
        field_path: 'cv_tailoring',
        code: 'third_party_subject',
        reason: 'Malformed cv_tailoring metadata blocks ownership verification.',
      });
    } else {
      for (const relField of ['tailored_folder_rel', 'tailoring_notes_rel']) {
        const relVal = raw.cv_tailoring[relField];
        if (relVal !== undefined && relVal !== null) {
          if (typeof relVal !== 'string' || isThirdPartyCvPath(relVal) || isUnsafeRelativeRef(relVal)) {
            violations.push({
              field_path: `cv_tailoring.${relField}`,
              code: 'third_party_subject',
              reason: 'Tailoring path references a third-party or invalid CV directory.',
            });
          }
        }
      }
    }
  }

  // L1: Reject non-string or whitespace-only cv_version_id / base_cv_version_id (null, undefined, or "" means unattributed)
  let cvId = null;
  if (raw.cv_version_id !== undefined && raw.cv_version_id !== null) {
    if (typeof raw.cv_version_id !== 'string') {
      violations.push({
        field_path: 'cv_version_id',
        code: 'third_party_subject',
        reason: 'Malformed non-string cv_version_id blocks ownership verification.',
      });
    } else if (raw.cv_version_id.length > 0 && raw.cv_version_id.trim().length === 0) {
      violations.push({
        field_path: 'cv_version_id',
        code: 'third_party_subject',
        reason: 'Whitespace-only cv_version_id is malformed and blocks ownership verification.',
      });
    } else if (raw.cv_version_id.length > 0) {
      cvId = raw.cv_version_id.trim();
    }
  }

  let baseCvId = null;
  if (isObj(raw.cv_tailoring) && raw.cv_tailoring.base_cv_version_id !== undefined && raw.cv_tailoring.base_cv_version_id !== null) {
    const rawBase = raw.cv_tailoring.base_cv_version_id;
    if (typeof rawBase !== 'string') {
      violations.push({
        field_path: 'cv_tailoring.base_cv_version_id',
        code: 'third_party_subject',
        reason: 'Malformed non-string base_cv_version_id blocks ownership verification.',
      });
    } else if (rawBase.length > 0 && rawBase.trim().length === 0) {
      violations.push({
        field_path: 'cv_tailoring.base_cv_version_id',
        code: 'third_party_subject',
        reason: 'Whitespace-only base_cv_version_id is malformed and blocks ownership verification.',
      });
    } else if (rawBase.length > 0) {
      baseCvId = rawBase.trim();
    }
  }

  // Unattributed legacy v1 application (neither cv_version_id nor base_cv_version_id set)
  if (!cvId && !baseCvId) {
    return {
      valid: violations.length === 0,
      attributed: false,
      owner_cv_entry: null,
      violations,
    };
  }

  // Any CV reference requires a valid, unambiguous CV registry
  if (!allCvRegistry || !isObj(allCvRegistry)) {
    violations.push({
      field_path: cvId ? 'cv_version_id' : 'cv_tailoring.base_cv_version_id',
      code: 'third_party_subject',
      reason: 'Referenced CV version cannot be verified because CV version registry is missing.',
    });
    return { valid: false, attributed: true, owner_cv_entry: null, violations };
  }

  const regCheck = validateCvVersionsRegistry(allCvRegistry);
  if (!regCheck.valid) {
    violations.push({
      field_path: 'cv_versions_registry',
      code: 'third_party_subject',
      reason: 'CV version registry failed schema validation; refusing unverified CV attribution.',
    });
    return { valid: false, attributed: true, owner_cv_entry: null, violations };
  }

  const byId = new Map();
  for (const v of allCvRegistry.versions) {
    if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
      byId.set(v.cv_version_id.trim(), v);
    }
  }

  // H1: Recursively verify CV entry AND entire registry base_cv_version_id ancestry chain with cycle detection
  const verifyEntryAndAncestry = (startId, rootFieldPath) => {
    const visited = new Set();
    let currentId = startId;
    let currentPath = rootFieldPath;
    let rootEntry = null;

    while (currentId !== null) {
      if (visited.has(currentId)) {
        violations.push({
          field_path: currentPath,
          code: 'third_party_subject',
          reason: 'Cyclic base_cv_version_id ancestry detected in CV version registry.',
        });
        return null;
      }
      visited.add(currentId);

      const entry = byId.get(currentId);
      if (!entry) {
        violations.push({
          field_path: currentPath,
          code: 'third_party_subject',
          reason: 'Referenced CV version or ancestor ID does not exist in owner CV registry.',
        });
        return null;
      }
      if (entry.owner_scope !== 'owner') {
        violations.push({
          field_path: currentPath,
          code: 'third_party_subject',
          reason: 'Referenced CV version or ancestor does not explicitly declare owner_scope "owner".',
        });
        return null;
      }
      if (entry.local_ref_rel !== undefined && entry.local_ref_rel !== null) {
        if (isThirdPartyCvPath(entry.local_ref_rel) || isUnsafeRelativeRef(entry.local_ref_rel)) {
          violations.push({
            field_path: `${currentPath}.local_ref_rel`,
            code: 'third_party_subject',
            reason: 'Referenced CV registry entry or ancestor points to a third-party or unsafe path.',
          });
          return null;
        }
      }
      if (rootEntry === null) rootEntry = entry;

      if (entry.base_cv_version_id === undefined || entry.base_cv_version_id === null || entry.base_cv_version_id === '') {
        currentId = null;
      } else if (typeof entry.base_cv_version_id !== 'string' || entry.base_cv_version_id.trim().length === 0) {
        violations.push({
          field_path: `${currentPath}.base_cv_version_id`,
          code: 'third_party_subject',
          reason: 'Malformed ancestor base_cv_version_id in CV version registry.',
        });
        return null;
      } else {
        currentId = entry.base_cv_version_id.trim();
        currentPath = `${currentPath}.base_cv_version_id`;
      }
    }

    return rootEntry;
  };

  let primaryEntry = null;
  if (cvId) {
    primaryEntry = verifyEntryAndAncestry(cvId, 'cv_version_id');
    if (primaryEntry && isObj(raw.cv_tailoring) && typeof raw.cv_tailoring.is_tailored === 'boolean') {
      const expectedKind = raw.cv_tailoring.is_tailored ? 'tailored' : 'generic';
      if (primaryEntry.kind !== expectedKind) {
        violations.push({
          field_path: 'cv_tailoring.is_tailored',
          code: 'third_party_subject',
          reason: 'Conflicting CV kind between application cv_tailoring.is_tailored and CV registry entry.',
        });
      }
    }
  }

  if (baseCvId) {
    const baseEntry = verifyEntryAndAncestry(baseCvId, 'cv_tailoring.base_cv_version_id');
    if (primaryEntry && baseEntry) {
      const regBase = primaryEntry.base_cv_version_id ? primaryEntry.base_cv_version_id.trim() : null;
      if (regBase !== null && regBase !== baseCvId) {
        violations.push({
          field_path: 'cv_tailoring.base_cv_version_id',
          code: 'third_party_subject',
          reason: 'Application base_cv_version_id does not match CV registry base_cv_version_id.',
        });
      } else if (regBase === null && baseCvId !== primaryEntry.cv_version_id.trim()) {
        violations.push({
          field_path: 'cv_tailoring.base_cv_version_id',
          code: 'third_party_subject',
          reason: 'Application declares a base_cv_version_id that contradicts a root CV registry entry.',
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    attributed: Boolean(cvId),
    owner_cv_entry: violations.length === 0 ? primaryEntry : null,
    violations,
  };
}

export function checkApplicationSyncEligibility(raw, { allCvRegistry = null } = {}) {
  if (!isObj(raw)) {
    return {
      eligible: false,
      canonical_key: null,
      canonical_status: null,
      block_code: null,
      violations: [],
      reason: 'record_not_object',
    };
  }

  const keyRes = resolveCanonicalSyncKey('applications', raw);
  const st = normalizeStatus(raw.status);
  const canonicalKey = keyRes.valid ? keyRes.canonical_key : (isNonEmptyString(raw.job_id) ? raw.job_id.trim() : 'unknown');

  // Check ownership/third-party attribution first so third-party data is ALWAYS blocked, never merely skipped
  const cvAuth = validateCvAttribution(raw, { allCvRegistry });
  if (!cvAuth.valid) {
    return {
      eligible: false,
      canonical_key: canonicalKey,
      canonical_status: st.valid ? st.canonical : null,
      block_code: 'third_party_subject',
      violations: cvAuth.violations,
      reason: 'blocked_cv_or_subject_ownership',
    };
  }

  if (!keyRes.valid) {
    return {
      eligible: false,
      canonical_key: canonicalKey,
      canonical_status: st.valid ? st.canonical : null,
      block_code: null,
      violations: [],
      reason: keyRes.reason,
    };
  }

  if (!st.valid) {
    return {
      eligible: false,
      canonical_key: keyRes.canonical_key,
      canonical_status: null,
      block_code: null,
      violations: [],
      reason: 'unrecognized_status',
    };
  }

  if (!SUBMITTED_STATUS_SET.has(st.canonical)) {
    return {
      eligible: false,
      canonical_key: keyRes.canonical_key,
      canonical_status: st.canonical,
      block_code: null,
      violations: [],
      reason: 'status_not_submitted',
    };
  }

  if (raw.submission_uncertain === true) {
    return {
      eligible: false,
      canonical_key: keyRes.canonical_key,
      canonical_status: st.canonical,
      block_code: null,
      violations: [],
      reason: 'submission_uncertain',
    };
  }

  return {
    eligible: true,
    canonical_key: keyRes.canonical_key,
    canonical_status: st.canonical,
    block_code: null,
    violations: [],
    owner_cv_entry: cvAuth.owner_cv_entry,
    reason: null,
  };
}

export function canonicalizeJson(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalizeJson cannot serialize non-finite numbers.');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalizeJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (isObj(value)) {
    const keys = Object.keys(value).sort(codePointCompare);
    const entries = [];
    for (const k of keys) {
      if (value[k] === undefined) continue;
      entries.push(`${JSON.stringify(k)}:${canonicalizeJson(value[k])}`);
    }
    return `{${entries.join(',')}}`;
  }
  throw new Error(`canonicalizeJson received unsupported type "${t}".`);
}

export function computeSyncHash(projectedPayload) {
  if (!isObj(projectedPayload)) {
    throw new Error('computeSyncHash requires a projected payload object.');
  }
  const withoutHash = {};
  for (const [k, v] of Object.entries(projectedPayload)) {
    if (k === 'Sync Hash') continue;
    withoutHash[k] = v;
  }
  return crypto.createHash('sha256').update(canonicalizeJson(withoutHash)).digest('hex').slice(0, 16);
}

export function computeOperationId({ database, canonical_key, action, existing_page_id = null, sync_hash }) {
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`computeOperationId: invalid database "${database}".`);
  }
  if (!isNonEmptyString(canonical_key)) {
    throw new Error('computeOperationId: canonical_key must be non-empty.');
  }
  if (!OP_ACTIONS.has(action)) {
    throw new Error(`computeOperationId: invalid action "${action}".`);
  }
  if (typeof sync_hash !== 'string' || !HEX16_RE.test(sync_hash)) {
    throw new Error('computeOperationId: sync_hash must be a 16-char lowercase hex string.');
  }
  const normPageId = existing_page_id ? (normalizeNotionUuid(existing_page_id) || String(existing_page_id).trim()) : null;
  const core = {
    database,
    canonical_key: canonical_key.trim(),
    action,
    existing_page_id: normPageId,
    sync_hash,
  };
  return crypto.createHash('sha256').update(canonicalizeJson(core)).digest('hex').slice(0, 16);
}

// Non-circular immutable plan_core hash covering ALL operations (including skip_unchanged),
// blocked_items, skipped_ineligible, and guardrail snapshots; explicitly excludes plan_hash,
// mode, approval, and per-operation status.
export function computePlanHash(plan) {
  if (!isObj(plan)) {
    throw new Error('computePlanHash requires a sync plan object.');
  }
  const ops = Array.isArray(plan.operations) ? plan.operations : [];
  const blocked = Array.isArray(plan.blocked_items) ? plan.blocked_items : [];
  const skipped = Array.isArray(plan.skipped_ineligible) ? plan.skipped_ineligible : [];

  const sortedOps = ops.map(op => ({
    operation_id: op?.operation_id ?? null,
    database: op?.database ?? null,
    canonical_key: op?.canonical_key ?? null,
    application_status: op?.database === 'applications' ? (op?.application_status ?? null) : null,
    action: op?.action ?? null,
    existing_page_id: op?.existing_page_id ?? null,
    sync_hash: op?.sync_hash ?? null,
    payload: isObj(op?.payload) ? op.payload : {},
  })).sort((a, b) =>
    codePointCompare(String(a.database || ''), String(b.database || '')) ||
    codePointCompare(String(a.canonical_key || ''), String(b.canonical_key || '')) ||
    codePointCompare(String(a.operation_id || ''), String(b.operation_id || '')),
  );

  const sortedBlocked = blocked.map(item => ({
    database: item?.database ?? null,
    canonical_key: item?.canonical_key ?? null,
    state: item?.state ?? null,
    violations: Array.isArray(item?.violations)
      ? item.violations.map(v => ({
          field_path: v?.field_path ?? null,
          code: v?.code ?? null,
          reason: v?.reason ?? null,
        })).sort((a, b) =>
          codePointCompare(String(a.field_path || ''), String(b.field_path || '')) ||
          codePointCompare(String(a.code || ''), String(b.code || '')),
        )
      : [],
  })).sort((a, b) =>
    codePointCompare(String(a.database || ''), String(b.database || '')) ||
    codePointCompare(String(a.canonical_key || ''), String(b.canonical_key || '')),
  );

  const sortedSkipped = skipped.map(item => ({
    canonical_key: item?.canonical_key ?? null,
    status: item?.status ?? null,
    reason: item?.reason ?? null,
  })).sort((a, b) =>
    codePointCompare(String(a.canonical_key || ''), String(b.canonical_key || '')) ||
    codePointCompare(String(a.status || ''), String(b.status || '')) ||
    codePointCompare(String(a.reason || ''), String(b.reason || '')),
  );

  const planCore = {
    schema_version: plan.schema_version ?? null,
    plan_id: plan.plan_id ?? null,
    created_at: plan.created_at ?? null,
    eligibility_policy: plan.eligibility_policy ?? null,
    transport_enabled: Boolean(plan.transport_enabled),
    dry_run: Boolean(plan.dry_run),
    operations: sortedOps,
    blocked_items: sortedBlocked,
    skipped_ineligible: sortedSkipped,
  };

  return crypto.createHash('sha256').update(canonicalizeJson(planCore)).digest('hex');
}

function projectSafePublicUrl(rawUrl) {
  if (rawUrl === null || rawUrl === undefined || rawUrl === '') return null;
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (isBlockedSsrfUrl(parsed) !== null) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function projectApplicationForNotion(raw, { allCvRegistry = null } = {}) {
  const elig = checkApplicationSyncEligibility(raw, { allCvRegistry });
  if (!elig.eligible) {
    throw new Error(`Cannot project ineligible or blocked application (${elig.reason}).`);
  }

  const role = normalizeString(raw.title) || normalizeString(raw.role);
  const company = normalizeString(raw.company);
  const appliedDate = normalizeDateYmd(raw.applied_at || raw.date);
  const lastUpdated = normalizeDateYmd(raw.updated_at || raw.applied_at || raw.date);
  const rawScore = raw.match_score !== null && raw.match_score !== undefined ? raw.match_score : raw.score;
  const cvEntry = elig.owner_cv_entry || null;
  const cvVersionDisplay = cvEntry
    ? normalizeString(cvEntry.label || cvEntry.cv_version_id)
    : null;
  const isTailored = isObj(raw.cv_tailoring) && typeof raw.cv_tailoring.is_tailored === 'boolean'
    ? raw.cv_tailoring.is_tailored
    : (cvEntry ? cvEntry.kind === 'tailored' : false);

  const payload = {
    Title: formatNotionApplicationTitle(role, company, elig.canonical_key),
    'Application ID': elig.canonical_key,
    'Job ID': normalizeString(raw.job_id),
    Company: company,
    Role: role,
    Status: elig.canonical_status,
    Platform: (normalizeString(raw.platform) || 'other').toLowerCase(),
    'Source Channel': classifySourceChannel(raw),
    'Applied Date': appliedDate,
    'Last Updated': lastUpdated,
    'Match Score': normalizeBoundedScore(rawScore),
    'Job URL': projectSafePublicUrl(raw.url),
    'CV Version': cvVersionDisplay,
    Tailored: Boolean(isTailored),
    'Interview Rounds': Array.isArray(raw.interviews) ? raw.interviews.length : 0,
    Assessments: Array.isArray(raw.assessments) ? raw.assessments.length : 0,
  };
  payload['Sync Hash'] = computeSyncHash(payload);
  return payload;
}

export function projectDailyRunForNotion(runDoc) {
  const check = validateDailyRun(runDoc);
  if (!check.valid) {
    throw new Error(`Cannot project invalid daily run: ${check.errors.join('; ')}`);
  }
  if (runDoc.status !== 'completed' && runDoc.status !== 'aborted') {
    throw new Error(`Cannot project non-terminal daily run status "${runDoc.status}" (must be completed or aborted).`);
  }
  const counts = isObj(runDoc.counts) ? runDoc.counts : {};
  const payload = {
    'Run ID': runDoc.run_id.trim(),
    Status: runDoc.status,
    'Dry Run': Boolean(runDoc.dry_run),
    Scanned: normalizeNonNegInt(counts.scanned),
    Prepared: normalizeNonNegInt(counts.prepared ?? 0),
    Applied: normalizeNonNegInt(counts.applied),
    Skipped: normalizeNonNegInt(counts.skipped),
    'Needs Review': normalizeNonNegInt(counts.needs_review),
    Failed: normalizeNonNegInt(counts.failed),
    Platforms: normalizeStringList(runDoc.platforms, { lowercase: true }),
  };
  payload['Sync Hash'] = computeSyncHash(payload);
  return payload;
}

export function projectInsightForNotion(insightDoc) {
  const check = validateCareerInsights(insightDoc);
  if (!check.valid) {
    throw new Error(`Cannot project invalid career insight artifact: ${check.errors.join('; ')}`);
  }
  const keyRes = resolveCanonicalSyncKey('insights', insightDoc);
  if (!keyRes.valid) {
    throw new Error(`Cannot project insight without valid canonical key (${keyRes.reason}).`);
  }
  const topSkills = Array.isArray(insightDoc.top_skills)
    ? normalizeStringList(insightDoc.top_skills.map(s => s?.skill), { limit: 10 })
    : [];
  const skillGaps = Array.isArray(insightDoc.skill_gaps)
    ? normalizeStringList(insightDoc.skill_gaps.map(s => s?.skill), { limit: 10 })
    : [];
  const sampleSufficient = Boolean(insightDoc.intelligence?.sample_sufficiency?.sufficient);

  const payload = {
    'Period Key': keyRes.canonical_key,
    'Report Type': insightDoc.type,
    Period: insightDoc.period.trim(),
    'Generated At': normalizeDateIso(insightDoc.generated_at),
    Submitted: normalizeNonNegInt(insightDoc.applied),
    Scanned: normalizeNonNegInt(insightDoc.scanned),
    'Avg Match Score': normalizeBoundedScore(insightDoc.avg_match_score),
    'Sample Sufficient': sampleSufficient,
    'Top Skills': topSkills,
    'Skill Gaps': skillGaps,
  };
  payload['Sync Hash'] = computeSyncHash(payload);
  return payload;
}

function scanStringForPrivacyViolations(fieldPath, fieldName, str, violations) {
  if (typeof str !== 'string' || !str.length) return;

  // 1. Secret tokens
  if (SECRET_TOKEN_PATTERNS.some(re => re.test(str))) {
    violations.push({
      field_path: fieldPath,
      code: 'secret_token',
      reason: 'Detected secret token or credential pattern in projected value.',
    });
  }

  // 2. Private email addresses
  if (EMAIL_RE.test(str)) {
    violations.push({
      field_path: fieldPath,
      code: 'private_email',
      reason: 'Detected email address in projected value.',
    });
  }

  // 3. Phone numbers (skipped on URL, date, ID, and hash fields to prevent false positives)
  if (!PHONE_SKIP_FIELDS.has(fieldName) && PHONE_PATTERNS.some(re => re.test(str))) {
    violations.push({
      field_path: fieldPath,
      code: 'phone_number',
      reason: 'Detected phone number pattern in projected value.',
    });
  }

  // 4. Local file paths (skip valid public http(s) URLs)
  const isHttpUrl = /^https?:\/\//i.test(str.trim());
  if (!isHttpUrl && LOCAL_PATH_PATTERNS.some(re => re.test(str))) {
    violations.push({
      field_path: fieldPath,
      code: 'local_file_path',
      reason: 'Detected local filesystem path in projected value.',
    });
  }

  // 5. Raw CV / resume dump
  const headingMatches = RESUME_HEADING_PATTERNS.filter(re => re.test(str)).length;
  if (str.length > MAX_PROJECTED_STRING_LEN || RESUME_HTML_RE.test(str) || headingMatches >= 2) {
    violations.push({
      field_path: fieldPath,
      code: 'raw_cv_dump',
      reason: 'Projected value exceeds safe length or contains raw CV/HTML document content.',
    });
  }

  // 6. Unsafe URL on URL field
  if (fieldName === 'Job URL') {
    try {
      const parsed = new URL(str.trim());
      if (isBlockedSsrfUrl(parsed) !== null) {
        violations.push({
          field_path: fieldPath,
          code: 'unsafe_url',
          reason: 'Projected URL failed SSRF or protocol safety check.',
        });
      }
    } catch {
      violations.push({
        field_path: fieldPath,
        code: 'unsafe_url',
        reason: 'Projected URL is malformed.',
      });
    }
  }
}

// Two-layer fail-closed privacy scanner:
// Layer 1 inspects source ownership/CV attribution & URL safety (while ignoring excluded-by-projection fields).
// Layer 2 recursively inspects every key and value of the projected Notion payload.
export function scanNotionPayloadPrivacy(database, rawRecord, projectedPayload, { allCvRegistry = null } = {}) {
  const violations = [];

  if (!TARGET_DATABASE_SET.has(database)) {
    violations.push({
      field_path: 'database',
      code: 'eeo_or_sensitive_key',
      reason: 'Unknown Notion target database rejected fail-closed.',
    });
    return { safe: false, violations };
  }

  // Layer 1: Pre-projection source & CV attribution checks
  if (database === 'applications') {
    const cvAuth = validateCvAttribution(rawRecord, { allCvRegistry });
    if (!cvAuth.valid) {
      violations.push(...cvAuth.violations);
    }
    if (isObj(rawRecord) && rawRecord.url !== undefined && rawRecord.url !== null && rawRecord.url !== '') {
      if (typeof rawRecord.url !== 'string') {
        violations.push({
          field_path: 'source.url',
          code: 'unsafe_url',
          reason: 'Source URL is not a valid string.',
        });
      } else {
        const trimmedUrl = rawRecord.url.trim();
        if (trimmedUrl) {
          try {
            const parsed = new URL(trimmedUrl);
            if (isBlockedSsrfUrl(parsed) !== null) {
              violations.push({
                field_path: 'source.url',
                code: 'unsafe_url',
                reason: 'Source URL failed SSRF or protocol safety check.',
              });
            }
          } catch {
            violations.push({
              field_path: 'source.url',
              code: 'unsafe_url',
              reason: 'Source URL is malformed.',
            });
          }
        }
      }
    }
  } else if (isObj(rawRecord) && rawRecord.provenance?.third_party_subject === true) {
    violations.push({
      field_path: 'source.provenance.third_party_subject',
      code: 'third_party_subject',
      reason: 'Third-party subject record is excluded from Notion synchronization.',
    });
  }

  // Layer 2: Post-projection deep allowlist & content inspection
  if (!isObj(projectedPayload)) {
    violations.push({
      field_path: 'payload',
      code: 'eeo_or_sensitive_key',
      reason: 'Projected payload must be a JSON object.',
    });
    return { safe: false, violations };
  }

  const allowedSchema = NOTION_DATABASE_SCHEMAS[database];
  const inspectValue = (val, currentPath, topFieldName) => {
    if (val === null || val === undefined || typeof val === 'boolean' || typeof val === 'number') {
      return;
    }
    if (typeof val === 'string') {
      scanStringForPrivacyViolations(currentPath, topFieldName, val, violations);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((item, idx) => inspectValue(item, `${currentPath}[${idx}]`, topFieldName));
      return;
    }
    if (isObj(val)) {
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_KEY_RE.test(k)) {
          violations.push({
            field_path: `${currentPath}.${k}`,
            code: 'eeo_or_sensitive_key',
            reason: 'Detected sensitive or EEO key inside projected payload.',
          });
        }
        inspectValue(v, `${currentPath}.${k}`, topFieldName);
      }
    }
  };

  for (const [key, val] of Object.entries(projectedPayload)) {
    const fieldPath = `payload.${key}`;
    if (SENSITIVE_KEY_RE.test(key)) {
      violations.push({
        field_path: fieldPath,
        code: 'eeo_or_sensitive_key',
        reason: 'Detected sensitive or EEO property key in projected payload.',
      });
    } else if (!Object.prototype.hasOwnProperty.call(allowedSchema, key)) {
      violations.push({
        field_path: fieldPath,
        code: 'eeo_or_sensitive_key',
        reason: 'Non-allowlisted property key rejected fail-closed.',
      });
    }
    inspectValue(val, fieldPath, key);
  }

  // Deduplicate identical (field_path, code) violations deterministically
  const seen = new Set();
  const deduped = [];
  for (const v of violations) {
    const k = `${v.field_path}::${v.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(v);
  }

  return { safe: deduped.length === 0, violations: deduped };
}

export function validateNotionSyncPlan(plan) {
  const errors = [];
  const warnings = [];

  if (!isObj(plan)) {
    return { valid: false, errors: ['Sync plan must be a JSON object.'], warnings };
  }
  checkAllowedKeys(plan, PLAN_KEYS, 'sync_plan', errors);

  if (plan.schema_version !== '1.0') {
    errors.push(`sync_plan.schema_version must be "1.0" (got ${JSON.stringify(plan.schema_version)}).`);
  }
  if (!isNonEmptyString(plan.plan_id)) errors.push('sync_plan.plan_id must be a non-empty string.');
  if (typeof plan.plan_hash !== 'string' || !HEX64_RE.test(plan.plan_hash)) {
    errors.push('sync_plan.plan_hash must be a 64-char lowercase hex SHA-256.');
  }
  if (!isValidIsoDateTime(plan.created_at)) errors.push('sync_plan.created_at must be a valid ISO-8601 date-time.');
  if (!PLAN_MODES.has(plan.mode)) errors.push(`sync_plan.mode "${plan.mode}" is invalid.`);
  if (plan.eligibility_policy !== 'submitted_only') {
    errors.push('sync_plan.eligibility_policy must be "submitted_only".');
  }
  if (typeof plan.transport_enabled !== 'boolean') errors.push('sync_plan.transport_enabled must be a boolean.');
  if (typeof plan.dry_run !== 'boolean') errors.push('sync_plan.dry_run must be a boolean.');

  // H2: Execution/verified modes strictly require non-null valid approval metadata
  if ((plan.mode === 'approved_execute' || plan.mode === 'verified') && (plan.approval === undefined || plan.approval === null)) {
    errors.push(`sync_plan.approval is required and cannot be null when mode is "${plan.mode}".`);
  }

  if (plan.approval !== undefined && plan.approval !== null) {
    if (!isObj(plan.approval)) {
      errors.push('sync_plan.approval must be an object or null.');
    } else {
      checkAllowedKeys(plan.approval, APPROVAL_KEYS, 'sync_plan.approval', errors);
      if (typeof plan.approval.approved_plan_hash !== 'string' || !HEX64_RE.test(plan.approval.approved_plan_hash)) {
        errors.push('sync_plan.approval.approved_plan_hash must be a 64-char lowercase hex SHA-256.');
      } else if (typeof plan.plan_hash === 'string' && plan.approval.approved_plan_hash !== plan.plan_hash) {
        errors.push('sync_plan.approval.approved_plan_hash does not match sync_plan.plan_hash.');
      }
      if (!isNonEmptyString(plan.approval.approved_plan_id)) {
        errors.push('sync_plan.approval.approved_plan_id must be a non-empty string.');
      } else if (isNonEmptyString(plan.plan_id) && plan.approval.approved_plan_id !== plan.plan_id) {
        errors.push('sync_plan.approval.approved_plan_id does not match sync_plan.plan_id.');
      }
      if (!isValidIsoDateTime(plan.approval.approved_at)) {
        errors.push('sync_plan.approval.approved_at must be a valid ISO-8601 date-time.');
      }
      if (plan.approval.approved_by !== 'owner') {
        errors.push('sync_plan.approval.approved_by must be "owner".');
      }
      if (!Number.isInteger(plan.approval.operation_count) || plan.approval.operation_count < 0) {
        errors.push('sync_plan.approval.operation_count must be an integer >= 0.');
      } else if (Array.isArray(plan.operations) && plan.approval.operation_count !== plan.operations.length) {
        errors.push('sync_plan.approval.operation_count does not match sync_plan.operations.length.');
      }
    }
  }

  if (!Array.isArray(plan.operations)) {
    errors.push('sync_plan.operations must be an array.');
  } else {
    const seenOpIds = new Set();
    const seenTargets = new Set();
    plan.operations.forEach((op, idx) => {
      const label = `sync_plan.operations[${idx}]`;
      if (!isObj(op)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      checkAllowedKeys(op, PLANNED_OP_KEYS, label, errors);
      const hasValidOpId = typeof op.operation_id === 'string' && HEX16_RE.test(op.operation_id);
      if (!hasValidOpId) {
        errors.push(`${label}.operation_id must be a 16-char lowercase hex string.`);
      } else if (seenOpIds.has(op.operation_id)) {
        errors.push(`${label}: duplicate operation_id "${op.operation_id}".`);
      } else {
        seenOpIds.add(op.operation_id);
      }

      const hasValidDb = TARGET_DATABASE_SET.has(op.database);
      const hasValidKey = isNonEmptyString(op.canonical_key);
      if (!hasValidDb) errors.push(`${label}.database "${op.database}" is invalid.`);
      if (!hasValidKey) errors.push(`${label}.canonical_key must be a non-empty string.`);
      if (hasValidDb && hasValidKey) {
        const targetKey = makeSyncStateKey(op.database, op.canonical_key);
        if (seenTargets.has(targetKey)) {
          errors.push(`${label}: duplicate target "${targetKey}" in operations.`);
        } else {
          seenTargets.add(targetKey);
        }
      }

      if (op.database === 'applications') {
        if (!SUBMITTED_STATUS_SET.has(op.application_status)) {
          errors.push(`${label}.application_status must be a submitted-only status for applications database.`);
        }
      } else if (op.application_status !== undefined && !SUBMITTED_STATUS_SET.has(op.application_status)) {
        errors.push(`${label}.application_status "${op.application_status}" is not a submitted-only status.`);
      }
      const hasValidAction = OP_ACTIONS.has(op.action);
      if (!hasValidAction) errors.push(`${label}.action "${op.action}" is invalid.`);
      if (op.existing_page_id !== undefined && op.existing_page_id !== null && typeof op.existing_page_id !== 'string') {
        errors.push(`${label}.existing_page_id must be a string or null.`);
      }
      // R1: Strict action / existing_page_id pairing
      if (hasValidAction) {
        if (op.action === 'create') {
          if (op.existing_page_id !== null && op.existing_page_id !== undefined) {
            errors.push(`${label}: action "create" requires existing_page_id to be null.`);
          }
        } else if (op.action === 'update') {
          if (!isNonEmptyString(op.existing_page_id) || normalizeNotionUuid(op.existing_page_id) === null) {
            errors.push(`${label}: action "update" requires a valid Notion UUID existing_page_id.`);
          }
        } else if (op.action === 'skip_unchanged') {
          if (op.existing_page_id !== null && op.existing_page_id !== undefined && normalizeNotionUuid(op.existing_page_id) === null) {
            errors.push(`${label}: action "skip_unchanged" has invalid Notion UUID existing_page_id.`);
          }
        }
      }
      const hasValidHash = typeof op.sync_hash === 'string' && HEX16_RE.test(op.sync_hash);
      if (!hasValidHash) {
        errors.push(`${label}.sync_hash must be a 16-char lowercase hex string.`);
      }
      const hasObjPayload = isObj(op.payload);
      if (!hasObjPayload) errors.push(`${label}.payload must be an object.`);
      if (!EXECUTABLE_OP_STATES.has(op.status)) errors.push(`${label}.status "${op.status}" is not an executable operation state.`);

      // H2: Cryptographic & semantic cross-checks on every operation
      if (hasValidOpId && hasValidDb && hasValidKey && hasValidAction && hasValidHash) {
        const expectedOpId = computeOperationId({
          database: op.database,
          canonical_key: op.canonical_key,
          action: op.action,
          existing_page_id: op.existing_page_id ?? null,
          sync_hash: op.sync_hash,
        });
        if (op.operation_id !== expectedOpId) {
          errors.push(`${label}.operation_id "${op.operation_id}" does not match deterministic ID "${expectedOpId}".`);
        }
      }
      if (hasObjPayload && hasValidHash) {
        const expectedSyncHash = computeSyncHash(op.payload);
        if (op.sync_hash !== expectedSyncHash) {
          errors.push(`${label}.sync_hash "${op.sync_hash}" does not match computed payload hash "${expectedSyncHash}".`);
        }
        if (op.payload['Sync Hash'] !== op.sync_hash) {
          errors.push(`${label}.payload["Sync Hash"] does not match op.sync_hash.`);
        }
      }
      // R2: Database-specific canonical key binding across all 3 databases
      if (hasObjPayload && hasValidDb && hasValidKey) {
        if (op.database === 'applications') {
          if (SUBMITTED_STATUS_SET.has(op.application_status) && op.payload.Status !== op.application_status) {
            errors.push(`${label}.payload.Status "${op.payload.Status}" contradicts application_status "${op.application_status}".`);
          }
          if (op.payload['Application ID'] !== op.canonical_key) {
            errors.push(`${label}.payload["Application ID"] does not match canonical_key "${op.canonical_key}".`);
          }
        } else if (op.database === 'daily_runs') {
          if (op.payload['Run ID'] !== op.canonical_key) {
            errors.push(`${label}.payload["Run ID"] does not match canonical_key "${op.canonical_key}".`);
          }
        } else if (op.database === 'insights') {
          if (op.payload['Period Key'] !== op.canonical_key) {
            errors.push(`${label}.payload["Period Key"] does not match canonical_key "${op.canonical_key}".`);
          }
        }
      }
    });
  }

  if (!Array.isArray(plan.blocked_items)) {
    errors.push('sync_plan.blocked_items must be an array.');
  } else {
    plan.blocked_items.forEach((item, idx) => {
      const label = `sync_plan.blocked_items[${idx}]`;
      if (!isObj(item)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      checkAllowedKeys(item, BLOCKED_ITEM_KEYS, label, errors);
      if (!TARGET_DATABASE_SET.has(item.database)) errors.push(`${label}.database "${item.database}" is invalid.`);
      if (!isNonEmptyString(item.canonical_key)) errors.push(`${label}.canonical_key must be a non-empty string.`);
      if (item.state !== 'blocked_privacy') errors.push(`${label}.state must be "blocked_privacy".`);
      if (!Array.isArray(item.violations) || item.violations.length === 0) {
        errors.push(`${label}.violations must be a non-empty array.`);
      } else {
        item.violations.forEach((v, vIdx) => {
          const vLabel = `${label}.violations[${vIdx}]`;
          if (!isObj(v)) {
            errors.push(`${vLabel} must be an object.`);
            return;
          }
          checkAllowedKeys(v, PRIVACY_VIOLATION_KEYS, vLabel, errors);
          if (!isNonEmptyString(v.field_path)) errors.push(`${vLabel}.field_path must be a non-empty string.`);
          if (!PRIVACY_VIOLATION_CODES.has(v.code)) errors.push(`${vLabel}.code "${v.code}" is invalid.`);
          if (!isNonEmptyString(v.reason)) errors.push(`${vLabel}.reason must be a non-empty string.`);
        });
      }
    });
  }

  if (!Array.isArray(plan.skipped_ineligible)) {
    errors.push('sync_plan.skipped_ineligible must be an array.');
  } else {
    plan.skipped_ineligible.forEach((item, idx) => {
      const label = `sync_plan.skipped_ineligible[${idx}]`;
      if (!isObj(item)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      checkAllowedKeys(item, SKIPPED_INELIGIBLE_KEYS, label, errors);
      if (!isNonEmptyString(item.canonical_key)) errors.push(`${label}.canonical_key must be a non-empty string.`);
      if (typeof item.status !== 'string') errors.push(`${label}.status must be a string.`);
      if (!isNonEmptyString(item.reason)) errors.push(`${label}.reason must be a non-empty string.`);
    });
  }

  // Recompute plan_hash when structural shape is intact to detect tampering
  if (errors.length === 0) {
    const recomputed = computePlanHash(plan);
    if (recomputed !== plan.plan_hash) {
      errors.push(`sync_plan.plan_hash mismatch (expected ${recomputed}, got ${plan.plan_hash}); plan may have been tampered with.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateNotionSyncState(stateDoc) {
  const errors = [];
  const warnings = [];

  if (!isObj(stateDoc)) {
    return { valid: false, errors: ['Sync state file must be a JSON object.'], warnings };
  }
  checkAllowedKeys(stateDoc, SYNC_STATE_FILE_KEYS, 'sync_state', errors);

  if (stateDoc.schema_version !== '1.0') {
    errors.push(`sync_state.schema_version must be "1.0" (got ${JSON.stringify(stateDoc.schema_version)}).`);
  }
  if (stateDoc.updated_at !== null && !isValidIsoDateTime(stateDoc.updated_at)) {
    errors.push('sync_state.updated_at must be an ISO-8601 date-time or null.');
  }
  if (!isObj(stateDoc.records)) {
    errors.push('sync_state.records must be an object map.');
    return { valid: false, errors, warnings };
  }

  for (const [recKey, entry] of Object.entries(stateDoc.records)) {
    const label = `sync_state.records["${recKey}"]`;
    if (!isObj(entry)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    checkAllowedKeys(entry, SYNC_STATE_ENTRY_KEYS, label, errors);
    const hasValidDb = TARGET_DATABASE_SET.has(entry.database);
    const hasValidKey = isNonEmptyString(entry.canonical_key);
    if (!hasValidDb) errors.push(`${label}.database "${entry.database}" is invalid.`);
    if (!hasValidKey) errors.push(`${label}.canonical_key must be a non-empty string.`);
    // M1: Enforce exact map-key binding against makeSyncStateKey(database, canonical_key)
    if (hasValidDb && hasValidKey) {
      const expectedRecKey = makeSyncStateKey(entry.database, entry.canonical_key);
      if (recKey !== expectedRecKey) {
        errors.push(`${label}: record key "${recKey}" does not match expected key "${expectedRecKey}".`);
      }
    }
    if (!SYNC_ITEM_STATES.has(entry.state)) errors.push(`${label}.state "${entry.state}" is invalid.`);
    // M1: Any non-null page_id must be a valid Notion UUID across ALL states
    if (entry.page_id !== undefined && entry.page_id !== null) {
      if (typeof entry.page_id !== 'string' || normalizeNotionUuid(entry.page_id) === null) {
        errors.push(`${label}.page_id must be a valid Notion UUID or null.`);
      }
    }
    // M1: Enforce 16-hex SHA-256 format on last_synced_hash & attempted_hash
    for (const hKey of ['last_synced_hash', 'attempted_hash']) {
      if (entry[hKey] !== undefined && entry[hKey] !== null && (typeof entry[hKey] !== 'string' || !HEX16_RE.test(entry[hKey]))) {
        errors.push(`${label}.${hKey} must be a 16-char lowercase hex string or null.`);
      }
    }
    // M1: Enforce required invariants for state === "synced"
    if (entry.state === 'synced') {
      if (!isNonEmptyString(entry.page_id) || normalizeNotionUuid(entry.page_id) === null) {
        errors.push(`${label}: state "synced" requires a valid Notion UUID page_id.`);
      }
      if (typeof entry.last_synced_hash !== 'string' || !HEX16_RE.test(entry.last_synced_hash)) {
        errors.push(`${label}: state "synced" requires a valid 16-char hex last_synced_hash.`);
      }
    }
    // R3 + D5: Enforce validator contract for state === "in_flight" (requires non-null ISO-8601 attempted_at)
    if (entry.state === 'in_flight') {
      if (typeof entry.attempted_hash !== 'string' || !HEX16_RE.test(entry.attempted_hash)) {
        errors.push(`${label}: state "in_flight" requires a valid 16-char hex attempted_hash.`);
      }
      if (!isValidIsoDateTime(entry.attempted_at)) {
        errors.push(`${label}: state "in_flight" requires a valid ISO-8601 date-time attempted_at.`);
      }
      if (typeof entry.operation_id !== 'string' || !HEX16_RE.test(entry.operation_id)) {
        errors.push(`${label}: state "in_flight" requires a valid 16-char hex operation_id.`);
      }
      if (typeof entry.approved_plan_hash !== 'string' || !HEX64_RE.test(entry.approved_plan_hash)) {
        errors.push(`${label}: state "in_flight" requires a valid 64-char hex approved_plan_hash.`);
      }
    }
    for (const dtKey of ['attempted_at', 'last_synced_at', 'next_retry_after']) {
      if (entry[dtKey] !== undefined && entry[dtKey] !== null && !isValidIsoDateTime(entry[dtKey])) {
        errors.push(`${label}.${dtKey} must be a valid ISO-8601 date-time or null.`);
      }
    }
    if (entry.operation_id !== undefined && entry.operation_id !== null && (typeof entry.operation_id !== 'string' || !HEX16_RE.test(entry.operation_id))) {
      errors.push(`${label}.operation_id must be a 16-char lowercase hex string or null.`);
    }
    if (entry.approved_plan_hash !== undefined && entry.approved_plan_hash !== null && (typeof entry.approved_plan_hash !== 'string' || !HEX64_RE.test(entry.approved_plan_hash))) {
      errors.push(`${label}.approved_plan_hash must be a 64-char lowercase hex SHA-256 or null.`);
    }
    if (entry.retry_count !== undefined && (!Number.isInteger(entry.retry_count) || entry.retry_count < 0)) {
      errors.push(`${label}.retry_count must be an integer >= 0.`);
    }
    // M1: Validate conflicting_page_ids as valid Notion UUIDs, and require >= 2 distinct UUIDs for conflict_duplicate_remote
    if (entry.conflicting_page_ids !== undefined) {
      if (!Array.isArray(entry.conflicting_page_ids) || entry.conflicting_page_ids.some(id => typeof id !== 'string' || normalizeNotionUuid(id) === null)) {
        errors.push(`${label}.conflicting_page_ids must be an array of valid Notion UUID strings.`);
      }
    }
    if (entry.state === 'conflict_duplicate_remote') {
      const validConflictUuids = Array.isArray(entry.conflicting_page_ids)
        ? new Set(entry.conflicting_page_ids.map(id => normalizeNotionUuid(id)).filter(Boolean))
        : new Set();
      if (validConflictUuids.size < 2) {
        errors.push(`${label}: state "conflict_duplicate_remote" requires at least 2 distinct valid Notion UUIDs in conflicting_page_ids.`);
      }
    }
    if (entry.last_error !== undefined && entry.last_error !== null && typeof entry.last_error !== 'string') {
      errors.push(`${label}.last_error must be a string or null.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------- Stage 3 (T8-A): Sync-State Foundation & Deterministic Diff ----------------

export function createEmptySyncState(updatedAt = null) {
  if (updatedAt !== null && !isValidIsoDateTime(updatedAt)) {
    throw new Error(`Invalid updatedAt timestamp for empty sync state: "${updatedAt}".`);
  }
  return {
    schema_version: '1.0',
    updated_at: updatedAt,
    records: {},
  };
}

export function normalizeSyncState(rawState) {
  const check = verifySyncStateIntegrity(rawState);
  if (!check.valid) {
    throw new Error(`Invalid sync-state document: ${check.errors.join('; ')}`);
  }

  const sortedKeys = Object.keys(rawState.records).sort(codePointCompare);
  const normalizedRecords = {};
  for (const key of sortedKeys) {
    const entry = rawState.records[key];
    const normEntry = {
      database: entry.database,
      canonical_key: entry.canonical_key.trim(),
      state: entry.state,
    };
    if (entry.page_id !== undefined) {
      if (entry.page_id === null) {
        normEntry.page_id = null;
      } else {
        const normUuid = normalizeNotionUuid(entry.page_id);
        if (!normUuid) {
          throw new Error(`sync_state.records["${key}"].page_id is not a valid Notion UUID.`);
        }
        normEntry.page_id = normUuid;
      }
    }
    if (entry.last_synced_hash !== undefined) normEntry.last_synced_hash = entry.last_synced_hash;
    if (entry.attempted_hash !== undefined) normEntry.attempted_hash = entry.attempted_hash;
    if (entry.attempted_at !== undefined) normEntry.attempted_at = entry.attempted_at;
    if (entry.last_synced_at !== undefined) normEntry.last_synced_at = entry.last_synced_at;
    if (entry.operation_id !== undefined) normEntry.operation_id = entry.operation_id;
    if (entry.approved_plan_hash !== undefined) normEntry.approved_plan_hash = entry.approved_plan_hash;
    if (entry.retry_count !== undefined) normEntry.retry_count = entry.retry_count;
    if (entry.next_retry_after !== undefined) normEntry.next_retry_after = entry.next_retry_after;
    if (entry.conflicting_page_ids !== undefined) {
      const seenIds = new Set();
      const normConflicts = [];
      for (const cid of entry.conflicting_page_ids) {
        const norm = normalizeNotionUuid(cid);
        if (!norm) {
          throw new Error(`sync_state.records["${key}"].conflicting_page_ids contains invalid Notion UUID.`);
        }
        if (seenIds.has(norm)) continue;
        seenIds.add(norm);
        normConflicts.push(norm);
      }
      normEntry.conflicting_page_ids = normConflicts.sort(codePointCompare);
    }
    if (entry.last_error !== undefined) normEntry.last_error = entry.last_error;

    normalizedRecords[key] = normEntry;
  }

  return {
    schema_version: '1.0',
    updated_at: rawState.updated_at,
    records: normalizedRecords,
  };
}

export function loadSyncState(root, { home = os.homedir() } = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('loadSyncState requires a non-empty workspace root path.');
  }
  const statePath = path.join(root, 'logs', 'sync-state.json');
  // Unconditional symlink check catches both live and dangling symlinks before read
  refuseSymlink(statePath, root, home);
  if (!fs.existsSync(statePath)) {
    return { exists: false, path: statePath, state: createEmptySyncState(null) };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${statePath}: ${err.message}`);
  }
  const normalized = normalizeSyncState(parsed);
  return { exists: true, path: statePath, state: normalized };
}

export function saveSyncState(root, stateDoc, { home = os.homedir(), nowIso = new Date().toISOString() } = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('saveSyncState requires a non-empty workspace root path.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`Invalid nowIso timestamp: "${nowIso}".`);
  }
  const statePath = path.join(root, 'logs', 'sync-state.json');
  refuseSymlink(statePath, root, home);
  const normalized = normalizeSyncState({
    ...stateDoc,
    updated_at: nowIso,
  });
  writeAtomic(statePath, JSON.stringify(normalized, null, 2) + '\n', {
    mode: 0o600,
    boundary: root,
    home,
  });
  const reread = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const postCheck = validateNotionSyncState(reread);
  if (!postCheck.valid) {
    throw new Error(`Post-write sync-state validation failed: ${postCheck.errors.join('; ')}`);
  }
  return { path: statePath, state: normalized };
}

function validateRemoteIndexKey(stateKey) {
  if (typeof stateKey !== 'string') return false;
  const parts = stateKey.split('::');
  if (parts.length !== 2) return false;
  const [database, canonicalKey] = parts;
  if (!TARGET_DATABASE_SET.has(database)) return false;
  if (!canonicalKey || canonicalKey !== canonicalKey.trim()) return false;
  if (database === 'applications') return APP_ID_RE.test(canonicalKey);
  if (database === 'daily_runs') return RUN_ID_RE.test(canonicalKey);
  if (database === 'insights') {
    const colonIdx = canonicalKey.indexOf(':');
    if (colonIdx <= 0) return false;
    const type = canonicalKey.slice(0, colonIdx);
    const period = canonicalKey.slice(colonIdx + 1);
    return ALLOWED_INSIGHT_TYPES.has(type) && period.trim().length > 0 && period === period.trim();
  }
  return false;
}

function normalizeRemoteIndex(remoteIndex) {
  if (remoteIndex === null || remoteIndex === undefined) return null;
  if (!isObj(remoteIndex)) {
    throw new Error('remoteIndex must be an object mapping "${database}::${canonical_key}" to remote page arrays, or null.');
  }
  const normalized = new Map();
  // R6: Track normalized active page_id ownership across ALL canonical remote keys
  const globalPageOwners = new Map();
  const sortedEntries = Object.entries(remoteIndex).sort((a, b) => codePointCompare(a[0], b[0]));
  for (const [stateKey, pages] of sortedEntries) {
    // M2: Fail closed on malformed remoteIndex keys
    if (!validateRemoteIndexKey(stateKey)) {
      throw new Error(`Malformed remoteIndex key "${stateKey}"; expected "<database>::<canonical_key>" with valid database and key format.`);
    }
    if (!Array.isArray(pages)) {
      throw new Error(`remoteIndex["${stateKey}"] must be an array of remote page descriptors.`);
    }
    const cleanPages = [];
    const seenPages = new Map();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (!isObj(p)) {
        throw new Error(`remoteIndex["${stateKey}"][${i}] must be an object.`);
      }
      if (p.archived === true || p.in_trash === true) continue;
      const normId = normalizeNotionUuid(p.page_id ?? p.id);
      if (!normId) {
        throw new Error(`remoteIndex["${stateKey}"][${i}] has invalid or missing Notion UUID page_id.`);
      }
      if (p.sync_hash !== undefined && p.sync_hash !== null && (typeof p.sync_hash !== 'string' || !HEX16_RE.test(p.sync_hash))) {
        throw new Error(`remoteIndex["${stateKey}"][${i}].sync_hash must be a 16-char lowercase hex string or null.`);
      }
      const prevOwner = globalPageOwners.get(normId);
      if (prevOwner !== undefined && prevOwner !== stateKey) {
        throw new Error(`Duplicate remote page_id "${normId}" mapped to multiple canonical keys ("${prevOwner}" and "${stateKey}"); refusing ambiguous sync diff.`);
      }
      globalPageOwners.set(normId, stateKey);
      const nextHash = p.sync_hash ?? null;
      // H1: Deduplicate identical (page_id, sync_hash) pairs; fail closed on conflicting hashes for same page_id
      if (seenPages.has(normId)) {
        if (seenPages.get(normId) !== nextHash) {
          throw new Error(`Conflicting sync_hash values for duplicate remote page_id "${normId}" under "${stateKey}".`);
        }
        continue;
      }
      seenPages.set(normId, nextHash);
      cleanPages.push({
        page_id: normId,
        sync_hash: nextHash,
      });
    }
    cleanPages.sort((a, b) => codePointCompare(a.page_id, b.page_id));
    normalized.set(stateKey, cleanPages);
  }
  return normalized;
}

const HELD_LOCAL_STATES = new Set([
  'in_flight',
  'receipt_uncertain',
  'failed_retryable',
  'failed_permanent',
  'conflict_duplicate_remote',
]);

// Pure deterministic operation diff generator (T8-A).
// Never mutates input records, never writes files, never executes transport/approval/receipts/retries.
export function computeNotionSyncDiff({
  applications = [],
  dailyRuns = [],
  insights = [],
  allCvRegistry = null,
  syncState = null,
  remoteIndex = null,
  planId = null,
  createdAt = new Date().toISOString(),
  transportEnabled = false,
  dryRun = true,
} = {}) {
  if (!Array.isArray(applications)) throw new Error('computeNotionSyncDiff: applications must be an array.');
  if (!Array.isArray(dailyRuns)) throw new Error('computeNotionSyncDiff: dailyRuns must be an array.');
  if (!Array.isArray(insights)) throw new Error('computeNotionSyncDiff: insights must be an array.');
  if (!isValidIsoDateTime(createdAt)) throw new Error(`computeNotionSyncDiff: invalid createdAt "${createdAt}".`);

  const normalizedState = syncState === null ? createEmptySyncState(null) : normalizeSyncState(syncState);
  const normalizedRemote = normalizeRemoteIndex(remoteIndex);

  const operations = [];
  const blockedItems = [];
  const skippedIneligible = [];
  const heldItems = [];

  const seenLocalKeys = new Set();
  const claimLocalKey = (database, canonicalKey) => {
    const stateKey = makeSyncStateKey(database, canonicalKey);
    if (seenLocalKeys.has(stateKey)) {
      throw new Error(`Duplicate local canonical key "${stateKey}" detected; refusing ambiguous sync diff.`);
    }
    seenLocalKeys.add(stateKey);
    return stateKey;
  };

  const resolveDiffAction = ({ database, canonicalKey, applicationStatus = null, payload }) => {
    const stateKey = makeSyncStateKey(database, canonicalKey);
    const entry = normalizedState.records[stateKey] || null;
    const hasRemoteEntry = normalizedRemote !== null && normalizedRemote.has(stateKey);
    const remotePages = hasRemoteEntry ? normalizedRemote.get(stateKey) : null;
    const syncHash = payload['Sync Hash'];

    // 1. Remote duplicate conflict always holds fail-closed
    if (remotePages !== null && remotePages.length > 1) {
      heldItems.push({
        database,
        canonical_key: canonicalKey,
        state: 'conflict_duplicate_remote',
        reason: 'duplicate_remote_pages',
        conflicting_page_ids: remotePages.map(p => p.page_id),
      });
      return;
    }

    // 2. Local uncertain / in-flight / conflict / failed states never auto-create or bypass in T8-A
    if (entry !== null && HELD_LOCAL_STATES.has(entry.state)) {
      heldItems.push({
        database,
        canonical_key: canonicalKey,
        state: entry.state,
        reason: entry.state === 'conflict_duplicate_remote'
          ? 'duplicate_remote_pages'
          : 'requires_reconciliation_or_recovery',
        conflicting_page_ids: entry.conflicting_page_ids ? [...entry.conflicting_page_ids] : [],
      });
      return;
    }

    const localPageId = entry?.page_id ?? null;
    const remoteSingle = remotePages !== null && remotePages.length === 1 ? remotePages[0] : null;

    // 3. Contradictory / stale remote state checks (never blindly create or update missing remote pages!)
    // L1: Hold ANY entry with non-null localPageId when remote explicitly reports 0 matching pages
    if (localPageId !== null && hasRemoteEntry && remotePages.length === 0) {
      heldItems.push({
        database,
        canonical_key: canonicalKey,
        state: 'receipt_uncertain',
        reason: entry?.state === 'synced' ? 'synced_page_missing_remotely' : 'local_page_missing_remotely',
        conflicting_page_ids: [],
      });
      return;
    }
    if (localPageId !== null && remoteSingle !== null && localPageId !== remoteSingle.page_id) {
      heldItems.push({
        database,
        canonical_key: canonicalKey,
        state: 'receipt_uncertain',
        reason: 'local_remote_page_id_mismatch',
        conflicting_page_ids: [localPageId, remoteSingle.page_id].sort(codePointCompare),
      });
      return;
    }

    const resolvedPageId = localPageId || remoteSingle?.page_id || null;
    const knownRemoteHash = remoteSingle !== null && remoteSingle.sync_hash !== null
      ? remoteSingle.sync_hash
      : (entry?.state === 'synced' ? entry.last_synced_hash : null);

    let action;
    if (resolvedPageId !== null) {
      action = knownRemoteHash === syncHash ? 'skip_unchanged' : 'update';
    } else {
      action = 'create';
    }

    const op = {
      operation_id: computeOperationId({
        database,
        canonical_key: canonicalKey,
        action,
        existing_page_id: resolvedPageId,
        sync_hash: syncHash,
      }),
      database,
      canonical_key: canonicalKey,
      ...(database === 'applications' ? { application_status: applicationStatus } : {}),
      action,
      existing_page_id: resolvedPageId,
      sync_hash: syncHash,
      payload,
      status: 'previewed',
    };
    operations.push(op);
  };

  // H2: Detect duplicate usable local canonical keys across ALL records BEFORE eligibility filtering
  for (const raw of applications) {
    if (isObj(raw) && isUsableJobId(raw.job_id)) {
      claimLocalKey('applications', computeApplicationId(raw.job_id));
    }
  }
  for (const runDoc of dailyRuns) {
    const keyRes = resolveCanonicalSyncKey('daily_runs', runDoc);
    if (keyRes.valid) claimLocalKey('daily_runs', keyRes.canonical_key);
  }
  for (const insightDoc of insights) {
    const keyRes = resolveCanonicalSyncKey('insights', insightDoc);
    if (keyRes.valid) claimLocalKey('insights', keyRes.canonical_key);
  }

  // M3 + R4: Deterministic, PII-free, cycle/BigInt-safe, order-independent diagnostic key for missing-ID third-party records
  const safeCanonicalizeForHash = (value, seen = new WeakSet()) => {
    if (value === null) return 'null';
    const t = typeof value;
    if (t === 'undefined') return '"[undefined]"';
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'number') {
      return Number.isFinite(value)
        ? JSON.stringify(Object.is(value, -0) ? 0 : value)
        : JSON.stringify(`[number:${String(value)}]`);
    }
    if (t === 'bigint') return JSON.stringify(`[bigint:${value.toString()}]`);
    if (t === 'string') return JSON.stringify(value);
    if (t === 'symbol') return JSON.stringify(`[symbol:${String(value.description ?? '')}]`);
    if (t === 'function') return '"[function]"';
    if (typeof value === 'object') {
      if (seen.has(value)) return '"[circular]"';
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map(item => safeCanonicalizeForHash(item, seen)).join(',')}]`;
        }
        const keys = Object.keys(value).sort(codePointCompare);
        const entries = [];
        for (const k of keys) {
          let propVal;
          try {
            propVal = value[k];
          } catch {
            entries.push(`${JSON.stringify(k)}:"[unreadable_property]"`);
            continue;
          }
          if (propVal === undefined) continue;
          entries.push(`${JSON.stringify(k)}:${safeCanonicalizeForHash(propVal, seen)}`);
        }
        return `{${entries.join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    return '"[unsupported]"';
  };
  const unidentifiedCounts = new Map();
  const makeUnidentifiedBlockedKey = raw => {
    let serialized;
    try {
      serialized = canonicalizeJson(raw);
    } catch {
      serialized = safeCanonicalizeForHash(raw);
    }
    const baseKey = `unidentified_${crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 12)}`;
    const count = (unidentifiedCounts.get(baseKey) || 0) + 1;
    unidentifiedCounts.set(baseKey, count);
    return count === 1 ? baseKey : `${baseKey}_${count}`;
  };

  // 1. Applications (strictly submitted-only + fail-closed CV attribution + 2-layer privacy)
  for (const raw of applications) {
    const elig = checkApplicationSyncEligibility(raw, { allCvRegistry });
    if (!elig.eligible) {
      if (elig.block_code === 'third_party_subject') {
        const blockedKey = isObj(raw) && isUsableJobId(raw.job_id)
          ? computeApplicationId(raw.job_id)
          : makeUnidentifiedBlockedKey(raw);
        blockedItems.push({
          database: 'applications',
          canonical_key: blockedKey,
          state: 'blocked_privacy',
          violations: elig.violations,
        });
      } else {
        skippedIneligible.push({
          canonical_key: elig.canonical_key || 'unknown',
          status: typeof raw?.status === 'string' ? raw.status : 'unknown',
          reason: elig.reason || 'ineligible',
        });
      }
      continue;
    }

    const payload = projectApplicationForNotion(raw, { allCvRegistry });
    const scan = scanNotionPayloadPrivacy('applications', raw, payload, { allCvRegistry });
    if (!scan.safe) {
      blockedItems.push({
        database: 'applications',
        canonical_key: elig.canonical_key,
        state: 'blocked_privacy',
        violations: scan.violations,
      });
      continue;
    }

    resolveDiffAction({
      database: 'applications',
      canonicalKey: elig.canonical_key,
      applicationStatus: elig.canonical_status,
      payload,
    });
  }

  // 2. Daily Runs (terminal completed/aborted runs only)
  for (const runDoc of dailyRuns) {
    const keyRes = resolveCanonicalSyncKey('daily_runs', runDoc);
    const check = validateDailyRun(runDoc);
    if (!keyRes.valid || !check.valid) {
      skippedIneligible.push({
        canonical_key: keyRes.valid ? keyRes.canonical_key : 'unknown_daily_run',
        status: typeof runDoc?.status === 'string' ? runDoc.status : 'invalid',
        reason: !keyRes.valid ? keyRes.reason : 'invalid_daily_run',
      });
      continue;
    }
    if (runDoc.status !== 'completed' && runDoc.status !== 'aborted') {
      skippedIneligible.push({
        canonical_key: keyRes.canonical_key,
        status: runDoc.status,
        reason: 'run_not_terminal',
      });
      continue;
    }

    const payload = projectDailyRunForNotion(runDoc);
    const scan = scanNotionPayloadPrivacy('daily_runs', runDoc, payload);
    if (!scan.safe) {
      blockedItems.push({
        database: 'daily_runs',
        canonical_key: keyRes.canonical_key,
        state: 'blocked_privacy',
        violations: scan.violations,
      });
      continue;
    }

    resolveDiffAction({
      database: 'daily_runs',
      canonicalKey: keyRes.canonical_key,
      payload,
    });
  }

  // 3. Weekly & Monthly Insights
  for (const insightDoc of insights) {
    const keyRes = resolveCanonicalSyncKey('insights', insightDoc);
    const check = validateCareerInsights(insightDoc);
    if (!keyRes.valid || !check.valid) {
      skippedIneligible.push({
        canonical_key: keyRes.valid ? keyRes.canonical_key : 'unknown_insight',
        status: typeof insightDoc?.type === 'string' ? insightDoc.type : 'invalid',
        reason: !keyRes.valid ? keyRes.reason : 'invalid_career_insight',
      });
      continue;
    }

    const payload = projectInsightForNotion(insightDoc);
    const scan = scanNotionPayloadPrivacy('insights', insightDoc, payload);
    if (!scan.safe) {
      blockedItems.push({
        database: 'insights',
        canonical_key: keyRes.canonical_key,
        state: 'blocked_privacy',
        violations: scan.violations,
      });
      continue;
    }

    resolveDiffAction({
      database: 'insights',
      canonicalKey: keyRes.canonical_key,
      payload,
    });
  }

  // Deterministic canonical sorting on all output arrays
  operations.sort((a, b) =>
    codePointCompare(a.database, b.database) ||
    codePointCompare(a.canonical_key, b.canonical_key) ||
    codePointCompare(a.operation_id, b.operation_id),
  );
  blockedItems.sort((a, b) =>
    codePointCompare(a.database, b.database) ||
    codePointCompare(a.canonical_key, b.canonical_key),
  );
  skippedIneligible.sort((a, b) =>
    codePointCompare(a.canonical_key, b.canonical_key) ||
    codePointCompare(a.status, b.status) ||
    codePointCompare(a.reason, b.reason),
  );
  heldItems.sort((a, b) =>
    codePointCompare(a.database, b.database) ||
    codePointCompare(a.canonical_key, b.canonical_key),
  );

  const effectivePlanId = isNonEmptyString(planId)
    ? planId.trim()
    : `plan-${createdAt.slice(0, 10)}`;

  const plan = {
    schema_version: '1.0',
    plan_id: effectivePlanId,
    created_at: createdAt,
    mode: 'preview',
    eligibility_policy: 'submitted_only',
    transport_enabled: Boolean(transportEnabled),
    dry_run: Boolean(dryRun),
    approval: null,
    operations,
    blocked_items: blockedItems,
    skipped_ineligible: skippedIneligible,
  };
  plan.plan_hash = computePlanHash(plan);

  const planCheck = validateNotionSyncPlan(plan);
  if (!planCheck.valid) {
    throw new Error(`Generated sync plan failed self-validation: ${planCheck.errors.join('; ')}`);
  }

  const summary = {
    create: operations.filter(o => o.action === 'create').length,
    update: operations.filter(o => o.action === 'update').length,
    skip_unchanged: operations.filter(o => o.action === 'skip_unchanged').length,
    blocked_privacy: blockedItems.length,
    skipped_ineligible: skippedIneligible.length,
    held: heldItems.length,
  };

  return {
    plan,
    held_items: heldItems,
    summary,
  };
}

// ---------------- Stage 3 (T8-B): Approval Binding, Integrity, Locking, Reservation & Recovery ----------------

export const DEFAULT_MAX_APPROVAL_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours (D1)
export const DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (D5)
export const DEFAULT_STALE_LOCK_AGE_MS = 15 * 60 * 1000; // 15 minutes (D2)
export const DEFAULT_MAX_RETRIES = 3; // (D4)
export const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 minutes

const SYNC_STATE_LOCK_FILENAME = '.sync-state.lock';

// Canonical sync-state transition contract (D3, D4, D5):
// - t8b_allowed: edges executable in T8-B (reservation & stale in_flight -> receipt_uncertain)
// - t8c_gated: edges reserved for T8-C receipt verification, reconciliation, or failure writers (rejected in T8-B)
export const SYNC_STATE_TRANSITIONS = Object.freeze({
  none: Object.freeze({
    t8b_allowed: Object.freeze(['in_flight']),
    t8c_gated: Object.freeze([]),
  }),
  pending_sync: Object.freeze({
    t8b_allowed: Object.freeze(['in_flight']),
    t8c_gated: Object.freeze([]),
  }),
  previewed: Object.freeze({
    t8b_allowed: Object.freeze(['in_flight']),
    t8c_gated: Object.freeze([]),
  }),
  synced: Object.freeze({
    t8b_allowed: Object.freeze(['in_flight']),
    t8c_gated: Object.freeze([]),
  }),
  failed_retryable: Object.freeze({
    t8b_allowed: Object.freeze(['in_flight']),
    t8c_gated: Object.freeze(['failed_permanent']),
  }),
  in_flight: Object.freeze({
    t8b_allowed: Object.freeze(['receipt_uncertain']),
    t8c_gated: Object.freeze(['synced', 'failed_retryable', 'failed_permanent', 'conflict_duplicate_remote']),
  }),
  receipt_uncertain: Object.freeze({
    t8b_allowed: Object.freeze([]),
    t8c_gated: Object.freeze(['synced', 'pending_sync', 'conflict_duplicate_remote']),
  }),
  conflict_duplicate_remote: Object.freeze({
    t8b_allowed: Object.freeze([]),
    t8c_gated: Object.freeze(['synced', 'pending_sync']),
  }),
  failed_permanent: Object.freeze({
    t8b_allowed: Object.freeze([]),
    t8c_gated: Object.freeze([]),
  }),
  blocked_privacy: Object.freeze({
    t8b_allowed: Object.freeze([]),
    t8c_gated: Object.freeze([]),
  }),
  ineligible_not_submitted: Object.freeze({
    t8b_allowed: Object.freeze([]),
    t8c_gated: Object.freeze([]),
  }),
});

function hasDisallowedLastErrorContent(str) {
  if (typeof str !== 'string' || !str.length) return false;
  if (SECRET_TOKEN_PATTERNS.some(re => re.test(str))) return true;
  if (EMAIL_RE.test(str)) return true;
  if (LOCAL_PATH_PATTERNS.some(re => re.test(str))) return true;
  return false;
}

// D6: Structural & semantic sync-state integrity validation (cross-key page_id uniqueness,
// cross-key active in_flight operation_id uniqueness, temporal skew check, last_error privacy).
export function verifySyncStateIntegrity(stateDoc, { nowIso = null, maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS } = {}) {
  const base = validateNotionSyncState(stateDoc);
  const errors = [...base.errors];
  const warnings = [...base.warnings];

  if (nowIso !== null && !isValidIsoDateTime(nowIso)) {
    errors.push(`verifySyncStateIntegrity: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    errors.push('verifySyncStateIntegrity: maxFutureSkewMs must be a non-negative safe integer.');
  }
  if (!base.valid || errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const nowMs = nowIso !== null ? Date.parse(nowIso) : null;
  const pageOwners = new Map(); // normalized_uuid -> recKey
  const activeOpOwners = new Map(); // operation_id -> recKey
  const sortedKeys = Object.keys(stateDoc.records).sort(codePointCompare);

  for (const recKey of sortedKeys) {
    const entry = stateDoc.records[recKey];
    const label = `sync_state.records["${recKey}"]`;

    if (entry.page_id !== undefined && entry.page_id !== null) {
      const normPageId = normalizeNotionUuid(entry.page_id);
      if (normPageId) {
        const prevOwner = pageOwners.get(normPageId);
        if (prevOwner !== undefined && prevOwner !== recKey) {
          errors.push(`sync_state: duplicate page_id "${normPageId}" owned by both "${prevOwner}" and "${recKey}".`);
        } else {
          pageOwners.set(normPageId, recKey);
        }
      }
    }

    if (entry.state === 'in_flight') {
      const prevOpOwner = activeOpOwners.get(entry.operation_id);
      if (prevOpOwner !== undefined && prevOpOwner !== recKey) {
        errors.push(`sync_state: duplicate active in_flight operation_id "${entry.operation_id}" across "${prevOpOwner}" and "${recKey}".`);
      } else {
        activeOpOwners.set(entry.operation_id, recKey);
      }
      if (nowMs !== null) {
        const attemptedMs = Date.parse(entry.attempted_at);
        if (attemptedMs - nowMs > maxFutureSkewMs) {
          errors.push(`${label}.attempted_at "${entry.attempted_at}" is in the future beyond allowed skew (${maxFutureSkewMs}ms).`);
        }
      }
    }

    if (typeof entry.last_error === 'string' && hasDisallowedLastErrorContent(entry.last_error)) {
      errors.push(`${label}.last_error contains disallowed secret, email, or local file path.`);
    }
  }

  // Verify conflicting_page_ids do not collide with another canonical key's owned page_id
  for (const recKey of sortedKeys) {
    const entry = stateDoc.records[recKey];
    if (!Array.isArray(entry.conflicting_page_ids)) continue;
    for (const cid of entry.conflicting_page_ids) {
      const normCid = normalizeNotionUuid(cid);
      if (!normCid) continue;
      const owner = pageOwners.get(normCid);
      if (owner !== undefined && owner !== recKey) {
        errors.push(`sync_state.records["${recKey}"].conflicting_page_ids references page_id "${normCid}" already owned by "${owner}".`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Explicit fail-closed state-transition validator (D3, D4, D5).
export function validateSyncStateTransition(currentEntry, targetState, {
  op = null,
  nowIso = null,
  force = false,
  maxRetries = DEFAULT_MAX_RETRIES,
  staleTimeoutMs = DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS,
} = {}) {
  const fail = (code, reason) => ({
    valid: false,
    from_state: currentEntry === null || currentEntry === undefined ? 'none' : (currentEntry?.state ?? 'invalid'),
    to_state: targetState,
    code,
    reason,
  });

  if (typeof force !== 'boolean') {
    return fail('invalid_force_flag', 'force option must be an explicit boolean.');
  }
  if (!SYNC_ITEM_STATES.has(targetState)) {
    return fail('invalid_target_state', `Target state "${targetState}" is not a valid sync item state.`);
  }

  let fromState = 'none';
  if (currentEntry !== null && currentEntry !== undefined) {
    if (!isObj(currentEntry) || !SYNC_ITEM_STATES.has(currentEntry.state)) {
      return fail('invalid_current_entry', 'Current sync-state entry is malformed or has an invalid state.');
    }
    fromState = currentEntry.state;
  }

  const rule = SYNC_STATE_TRANSITIONS[fromState];
  if (!rule) {
    return fail('unknown_from_state', `No transition rule defined for state "${fromState}".`);
  }

  if (rule.t8c_gated.includes(targetState)) {
    return fail(
      'requires_t8c_receipt_or_reconciliation',
      `Transition "${fromState}" -> "${targetState}" requires T8-C receipt verification, reconciliation, or failure handling and is blocked in T8-B.`,
    );
  }

  if (!rule.t8b_allowed.includes(targetState)) {
    if (fromState === 'in_flight' && targetState === 'in_flight') {
      return fail('already_in_flight', 'Record is already in_flight; duplicate reservation is forbidden.');
    }
    if (fromState === 'failed_permanent') {
      return fail('failed_permanent_held', 'Record is in failed_permanent and remains manually held; neither force nor payload changes reset it.');
    }
    if (fromState === 'receipt_uncertain' || fromState === 'conflict_duplicate_remote') {
      return fail('requires_reconciliation', `Record is in "${fromState}" and requires remote reconciliation; force cannot bypass it.`);
    }
    if (fromState === 'blocked_privacy' || fromState === 'ineligible_not_submitted') {
      return fail('blocked_or_ineligible', `Record is in "${fromState}" and cannot enter execution.`);
    }
    return fail('transition_not_allowed', `Transition "${fromState}" -> "${targetState}" is not allowed.`);
  }

  if (targetState === 'in_flight') {
    if (!isObj(op) || (op.action !== 'create' && op.action !== 'update')) {
      return fail('non_mutating_or_missing_operation', 'Reserving in_flight requires a valid "create" or "update" operation (skip_unchanged cannot reserve).');
    }
    if (typeof op.sync_hash !== 'string' || !HEX16_RE.test(op.sync_hash)) {
      return fail('invalid_operation_hash', 'Operation sync_hash must be a 16-char lowercase hex string.');
    }

    const existingPageId = currentEntry?.page_id !== undefined && currentEntry?.page_id !== null
      ? normalizeNotionUuid(currentEntry.page_id)
      : null;

    if (op.action === 'create') {
      if (op.existing_page_id !== null && op.existing_page_id !== undefined) {
        return fail('create_with_existing_page_id', 'Create operation cannot specify a non-null existing_page_id.');
      }
      if (fromState === 'synced') {
        return fail('create_target_already_synced', 'Cannot reserve create for a canonical key already in synced state.');
      }
      if (existingPageId !== null) {
        return fail('create_target_already_has_page_id', `Cannot reserve create when sync state already holds page_id "${existingPageId}".`);
      }
    } else if (op.action === 'update') {
      const targetPageId = normalizeNotionUuid(op.existing_page_id);
      if (!targetPageId) {
        return fail('update_missing_page_id', 'Update operation requires a valid Notion UUID existing_page_id.');
      }
      if (existingPageId !== null && existingPageId !== targetPageId) {
        return fail('update_page_id_mismatch', `Plan update existing_page_id "${targetPageId}" contradicts sync-state page_id "${existingPageId}".`);
      }
      if (fromState === 'synced' && currentEntry.last_synced_hash === op.sync_hash) {
        return fail('already_synced_unchanged', 'Record is already synced with the exact same sync_hash; redundant update refused.');
      }
    }

    // D4: failed_retryable cooldown & retry cap (ONLY state where explicit force may bypass cooldown/cap)
    if (fromState === 'failed_retryable') {
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 1) {
        return fail('invalid_max_retries', 'maxRetries must be a positive safe integer.');
      }
      if (!isValidIsoDateTime(nowIso)) {
        return fail('invalid_now_iso', 'Valid ISO-8601 nowIso is required to evaluate failed_retryable cooldown.');
      }
      const retryCount = Number.isInteger(currentEntry.retry_count) ? currentEntry.retry_count : 0;
      if (!force) {
        if (retryCount >= maxRetries) {
          return fail('retry_cap_reached', `failed_retryable retry_count (${retryCount}) reached maxRetries (${maxRetries}); explicit force required to retry.`);
        }
        if (currentEntry.next_retry_after !== undefined && currentEntry.next_retry_after !== null) {
          if (!isValidIsoDateTime(currentEntry.next_retry_after)) {
            return fail('invalid_next_retry_after', 'failed_retryable entry has invalid next_retry_after timestamp.');
          }
          if (Date.parse(nowIso) < Date.parse(currentEntry.next_retry_after)) {
            return fail('retry_cooldown_active', `failed_retryable cooldown active until "${currentEntry.next_retry_after}".`);
          }
        }
      }
    }
  }

  if (fromState === 'in_flight' && targetState === 'receipt_uncertain') {
    if (!isValidIsoDateTime(nowIso)) {
      return fail('invalid_now_iso', 'Valid ISO-8601 nowIso is required to evaluate in_flight staleness.');
    }
    if (!Number.isSafeInteger(staleTimeoutMs) || staleTimeoutMs <= 0) {
      return fail('invalid_stale_timeout', 'staleTimeoutMs must be a positive safe integer.');
    }
    if (!isValidIsoDateTime(currentEntry.attempted_at)) {
      return fail('invalid_attempted_at', 'in_flight entry is missing a valid ISO-8601 attempted_at timestamp.');
    }
    const ageMs = Date.parse(nowIso) - Date.parse(currentEntry.attempted_at);
    if (ageMs < staleTimeoutMs) {
      return fail('in_flight_not_stale', `in_flight entry age (${ageMs}ms) has not reached staleTimeoutMs (${staleTimeoutMs}ms).`);
    }
  }

  return {
    valid: true,
    from_state: fromState,
    to_state: targetState,
    code: null,
    reason: null,
  };
}

// D1: Plan-bound approval tied strictly to immutable plan_hash.
export function approveNotionSyncPlan(previewPlan, {
  expectedPlanHash,
  confirmedByOwner = false,
  approvedAt = new Date().toISOString(),
} = {}) {
  if (confirmedByOwner !== true) {
    throw new Error('approveNotionSyncPlan requires explicit confirmedByOwner === true.');
  }
  if (typeof expectedPlanHash !== 'string' || !HEX64_RE.test(expectedPlanHash)) {
    throw new Error('approveNotionSyncPlan requires a valid 64-char lowercase hex expectedPlanHash.');
  }
  if (!isValidIsoDateTime(approvedAt)) {
    throw new Error(`approveNotionSyncPlan: invalid approvedAt timestamp "${approvedAt}".`);
  }

  const check = validateNotionSyncPlan(previewPlan);
  if (!check.valid) {
    throw new Error(`Cannot approve invalid sync plan: ${check.errors.join('; ')}`);
  }
  if (previewPlan.mode !== 'preview') {
    throw new Error(`Cannot approve plan in mode "${previewPlan.mode}"; only "preview" plans can be approved.`);
  }
  if (previewPlan.approval !== null && previewPlan.approval !== undefined) {
    throw new Error('Cannot approve plan that already carries approval metadata.');
  }
  if (previewPlan.dry_run !== false) {
    throw new Error('Cannot approve a dry_run=true plan for execution; generate a live-eligible preview first.');
  }
  if (previewPlan.transport_enabled !== true) {
    throw new Error('Cannot approve a transport_enabled=false plan for execution.');
  }
  if (previewPlan.plan_hash !== expectedPlanHash) {
    throw new Error(`Approval hash mismatch: expected "${expectedPlanHash}", got "${previewPlan.plan_hash}".`);
  }
  const recomputed = computePlanHash(previewPlan);
  if (recomputed !== expectedPlanHash) {
    throw new Error(`Recomputed plan_hash "${recomputed}" does not match expectedPlanHash "${expectedPlanHash}".`);
  }
  if (Date.parse(approvedAt) < Date.parse(previewPlan.created_at)) {
    throw new Error(`approvedAt "${approvedAt}" cannot predate plan created_at "${previewPlan.created_at}".`);
  }

  // Deep-clone so post-approval mutations to previewPlan cannot tamper with the approved artifact
  const approvedPlan = JSON.parse(JSON.stringify(previewPlan));
  approvedPlan.mode = 'approved_execute';
  approvedPlan.approval = {
    approved_plan_hash: recomputed,
    approved_plan_id: approvedPlan.plan_id,
    approved_at: approvedAt,
    approved_by: 'owner',
    operation_count: approvedPlan.operations.length,
  };

  const postCheck = validateNotionSyncPlan(approvedPlan);
  if (!postCheck.valid) {
    throw new Error(`Approved sync plan failed self-validation: ${postCheck.errors.join('; ')}`);
  }
  return approvedPlan;
}

// D1: Verify approved plan integrity, live flags, causality & TTL expiration.
export function verifyPlanApproval(plan, {
  nowIso = new Date().toISOString(),
  maxApprovalAgeMs = DEFAULT_MAX_APPROVAL_AGE_MS,
} = {}) {
  const errors = [];
  let code = null;
  const setErr = (errCode, msg) => {
    if (code === null) code = errCode;
    errors.push(msg);
  };

  if (!isValidIsoDateTime(nowIso)) {
    setErr('invalid_now_iso', `verifyPlanApproval: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(maxApprovalAgeMs) || maxApprovalAgeMs <= 0) {
    setErr('invalid_max_approval_age_ms', 'verifyPlanApproval: maxApprovalAgeMs must be a positive safe integer.');
  }

  const planCheck = validateNotionSyncPlan(plan);
  if (!planCheck.valid) {
    setErr('invalid_or_tampered_plan', `Plan validation failed: ${planCheck.errors.join('; ')}`);
    return { valid: false, code, errors, age_ms: null, expires_at: null };
  }

  if (plan.mode !== 'approved_execute') {
    setErr('plan_not_approved_execute', `Plan mode must be "approved_execute" (got "${plan.mode}").`);
  }
  if (plan.dry_run !== false) {
    setErr('plan_is_dry_run', 'Approved execution rejected because plan.dry_run is true.');
  }
  if (plan.transport_enabled !== true) {
    setErr('plan_transport_disabled', 'Approved execution rejected because plan.transport_enabled is false.');
  }
  if (!isObj(plan.approval)) {
    setErr('missing_approval', 'Approved plan is missing approval metadata.');
    return { valid: false, code, errors, age_ms: null, expires_at: null };
  }

  const recomputed = computePlanHash(plan);
  if (recomputed !== plan.plan_hash || recomputed !== plan.approval.approved_plan_hash) {
    setErr('plan_hash_mismatch', 'Plan hash no longer matches approved_plan_hash.');
  }

  const createdMs = Date.parse(plan.created_at);
  const approvedMs = Date.parse(plan.approval.approved_at);
  const nowMs = isValidIsoDateTime(nowIso) ? Date.parse(nowIso) : NaN;
  const expiresAt = Number.isSafeInteger(maxApprovalAgeMs) && maxApprovalAgeMs > 0
    ? new Date(approvedMs + maxApprovalAgeMs).toISOString()
    : null;

  if (approvedMs < createdMs) {
    setErr('approval_predates_plan', `approval.approved_at "${plan.approval.approved_at}" predates plan.created_at "${plan.created_at}".`);
  }

  let ageMs = null;
  if (!Number.isNaN(nowMs)) {
    ageMs = nowMs - approvedMs;
    if (ageMs < 0) {
      setErr('approval_timestamp_in_future', `approval.approved_at "${plan.approval.approved_at}" is in the future relative to nowIso "${nowIso}".`);
    } else if (Number.isSafeInteger(maxApprovalAgeMs) && maxApprovalAgeMs > 0 && ageMs > maxApprovalAgeMs) {
      setErr('approval_expired', `Approval expired at "${expiresAt}" (age ${ageMs}ms exceeds maxApprovalAgeMs ${maxApprovalAgeMs}ms).`);
    }
  }

  return {
    valid: errors.length === 0,
    code,
    errors,
    age_ms: ageMs,
    expires_at: expiresAt,
  };
}

// D2: Strict exclusive single-writer lockfile (no automatic stale-lock stealing).
function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // Fail closed: invalid PID cannot be assumed dead
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    return true; // EPERM or unknown error -> assume process exists (fail closed)
  }
}

function getSyncStateLockPath(root) {
  if (!isNonEmptyString(root)) {
    throw new Error('Workspace root path must be a non-empty string.');
  }
  return path.join(root, 'logs', SYNC_STATE_LOCK_FILENAME);
}

function acquireSyncStateLock(root, { home = os.homedir(), nowIso } = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`acquireSyncStateLock: invalid nowIso timestamp "${nowIso}".`);
  }
  const logsDir = path.join(root, 'logs');
  const lockPath = getSyncStateLockPath(root);
  refuseSymlink(logsDir, root, home);
  refuseSymlink(lockPath, root, home);
  fs.mkdirSync(logsDir, { recursive: true });
  refuseSymlink(lockPath, root, home);

  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({
    pid: process.pid,
    acquired_at: nowIso,
    nonce,
  }, null, 2) + '\n';

  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx', 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw new Error(`sync_state_locked: "${lockPath}" is already held; refusing concurrent write without stealing lock.`);
    }
    throw err;
  }

  try {
    fs.writeFileSync(fd, payload, 'utf8');
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    throw err;
  }
  fs.closeSync(fd);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(lockPath, 0o600); } catch { /* ignore */ }
  }
  return { lockPath, nonce };
}

function releaseOwnSyncStateLock(lockHandle, { root, home = os.homedir() } = {}) {
  if (!lockHandle) return;
  refuseSymlink(lockHandle.lockPath, root, home);
  if (!fs.existsSync(lockHandle.lockPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockHandle.lockPath, 'utf8'));
  } catch {
    return; // Never unlink a lock we cannot prove is ours
  }
  if (isObj(parsed) && parsed.nonce === lockHandle.nonce) {
    fs.unlinkSync(lockHandle.lockPath);
  }
}

function withSyncStateLock(root, { home = os.homedir(), nowIso } = {}, fn) {
  const handle = acquireSyncStateLock(root, { home, nowIso });
  try {
    return fn();
  } finally {
    releaseOwnSyncStateLock(handle, { root, home });
  }
}

// D2: Read-only lockfile inspection (never modifies or deletes the lock).
export function inspectSyncStateLock(root, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  staleLockAgeMs = DEFAULT_STALE_LOCK_AGE_MS,
} = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`inspectSyncStateLock: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(staleLockAgeMs) || staleLockAgeMs <= 0) {
    throw new Error('inspectSyncStateLock: staleLockAgeMs must be a positive safe integer.');
  }
  const lockPath = getSyncStateLockPath(root);
  refuseSymlink(lockPath, root, home);
  if (!fs.existsSync(lockPath)) {
    return {
      locked: false,
      path: lockPath,
      corrupt: false,
      stale: false,
      owner_alive: null,
      age_ms: null,
      lock: null,
      error: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    return {
      locked: true,
      path: lockPath,
      corrupt: true,
      stale: false,
      owner_alive: null,
      age_ms: null,
      lock: null,
      error: `Corrupt lockfile JSON: ${err.message}`,
    };
  }

  const validShape = isObj(parsed) &&
    Number.isSafeInteger(parsed.pid) && parsed.pid > 0 &&
    isValidIsoDateTime(parsed.acquired_at) &&
    isNonEmptyString(parsed.nonce);
  if (!validShape) {
    return {
      locked: true,
      path: lockPath,
      corrupt: true,
      stale: false,
      owner_alive: null,
      age_ms: null,
      lock: null,
      error: 'Lockfile metadata is malformed (missing valid pid, acquired_at, or nonce).',
    };
  }

  const ageMs = Date.parse(nowIso) - Date.parse(parsed.acquired_at);
  const ownerAlive = isProcessAlive(parsed.pid);
  return {
    locked: true,
    path: lockPath,
    corrupt: false,
    stale: ageMs >= staleLockAgeMs,
    owner_alive: ownerAlive,
    age_ms: ageMs,
    lock: {
      pid: parsed.pid,
      acquired_at: parsed.acquired_at,
      nonce: parsed.nonce,
    },
    error: null,
  };
}

// D2: Separate explicit stale-lock recovery action — never called automatically.
// Refuses removal unless explicitly confirmed, expectedNonce matches, lock is stale, and owning PID is confirmed dead.
export function releaseStaleSyncStateLock(root, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  staleLockAgeMs = DEFAULT_STALE_LOCK_AGE_MS,
  expectedNonce,
  confirmedExplicitRecovery = false,
} = {}) {
  if (confirmedExplicitRecovery !== true) {
    throw new Error('releaseStaleSyncStateLock requires explicit confirmedExplicitRecovery === true.');
  }
  if (!isNonEmptyString(expectedNonce)) {
    throw new Error('releaseStaleSyncStateLock requires a non-empty expectedNonce to prevent TOCTOU races.');
  }
  const info = inspectSyncStateLock(root, { home, nowIso, staleLockAgeMs });
  if (!info.locked) {
    throw new Error('No sync-state lockfile exists to release.');
  }
  if (info.corrupt || !info.lock) {
    throw new Error(`Refusing automatic removal of corrupt lockfile: ${info.error}`);
  }
  if (info.lock.nonce !== expectedNonce) {
    throw new Error('Lockfile nonce mismatch; refusing stale-lock release because lock ownership changed.');
  }
  if (!info.stale) {
    throw new Error(`Refusing stale-lock release: lock age (${info.age_ms}ms) is below staleLockAgeMs (${staleLockAgeMs}ms).`);
  }
  if (info.lock.pid === process.pid || info.owner_alive !== false) {
    throw new Error(`Refusing stale-lock release: owning PID ${info.lock.pid} is still active or cannot be proven dead.`);
  }

  // Final re-check immediately before unlink to guard against concurrent replacement
  refuseSymlink(info.path, root, home);
  const reread = JSON.parse(fs.readFileSync(info.path, 'utf8'));
  if (!isObj(reread) || reread.nonce !== expectedNonce) {
    throw new Error('Lockfile changed during stale-lock release; aborting safely.');
  }
  fs.unlinkSync(info.path);
  return {
    released: true,
    path: info.path,
    released_pid: info.lock.pid,
    released_nonce: info.lock.nonce,
    age_ms: info.age_ms,
  };
}

// Atomic, verified pre-write in_flight reservation (D1, D2, D4, D5, D6).
export function reserveOperationInFlight(root, {
  approvedPlan,
  operationId,
  nowIso = new Date().toISOString(),
  force = false,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxApprovalAgeMs = DEFAULT_MAX_APPROVAL_AGE_MS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('reserveOperationInFlight requires a non-empty workspace root path.');
  }
  if (typeof operationId !== 'string' || !HEX16_RE.test(operationId)) {
    throw new Error('reserveOperationInFlight requires a valid 16-char lowercase hex operationId.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`reserveOperationInFlight: invalid nowIso timestamp "${nowIso}".`);
  }
  if (typeof force !== 'boolean') {
    throw new Error('reserveOperationInFlight: force must be an explicit boolean.');
  }

  const approvalCheck = verifyPlanApproval(approvedPlan, { nowIso, maxApprovalAgeMs });
  if (!approvalCheck.valid) {
    throw new Error(`Approved plan verification failed (${approvalCheck.code}): ${approvalCheck.errors.join('; ')}`);
  }

  const matchingOps = approvedPlan.operations.filter(o => o.operation_id === operationId);
  if (matchingOps.length === 0) {
    throw new Error(`Operation "${operationId}" does not exist in approved plan "${approvedPlan.plan_id}".`);
  }
  if (matchingOps.length > 1) {
    throw new Error(`Duplicate operation_id "${operationId}" detected in approved plan.`);
  }
  const op = matchingOps[0];
  if (op.action === 'skip_unchanged') {
    throw new Error(`Operation "${operationId}" has action "skip_unchanged" and cannot be reserved in_flight.`);
  }

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const stateKey = makeSyncStateKey(op.database, op.canonical_key);
    const currentEntry = loaded.state.records[stateKey] || null;

    // Cross-key page_id & operation_id collision checks against all other sync-state records
    const opNormPageId = op.existing_page_id ? normalizeNotionUuid(op.existing_page_id) : null;
    for (const [otherKey, otherEntry] of Object.entries(loaded.state.records)) {
      if (otherKey === stateKey) continue;
      if (opNormPageId && otherEntry.page_id && normalizeNotionUuid(otherEntry.page_id) === opNormPageId) {
        throw new Error(`Plan drift/conflict: page_id "${opNormPageId}" is already owned by "${otherKey}".`);
      }
      if (otherEntry.state === 'in_flight' && otherEntry.operation_id === op.operation_id) {
        throw new Error(`Duplicate active operation_id "${op.operation_id}" already in_flight under "${otherKey}".`);
      }
    }

    const transition = validateSyncStateTransition(currentEntry, 'in_flight', {
      op,
      nowIso,
      force,
      maxRetries,
    });
    if (!transition.valid) {
      throw new Error(`Cannot reserve "${stateKey}" in_flight (${transition.code}): ${transition.reason}`);
    }

    const resolvedPageId = op.action === 'update'
      ? opNormPageId
      : null;

    const nextEntry = {
      database: op.database,
      canonical_key: op.canonical_key,
      state: 'in_flight',
      page_id: resolvedPageId,
      last_synced_hash: currentEntry?.last_synced_hash ?? null,
      attempted_hash: op.sync_hash,
      attempted_at: nowIso,
      last_synced_at: currentEntry?.last_synced_at ?? null,
      operation_id: op.operation_id,
      approved_plan_hash: approvedPlan.plan_hash,
      retry_count: Number.isInteger(currentEntry?.retry_count) ? currentEntry.retry_count : 0,
      next_retry_after: null,
      last_error: null,
    };

    const nextStateDoc = {
      schema_version: '1.0',
      updated_at: nowIso,
      records: {
        ...loaded.state.records,
        [stateKey]: nextEntry,
      },
    };

    const nextIntegrity = verifySyncStateIntegrity(nextStateDoc, { nowIso, maxFutureSkewMs });
    if (!nextIntegrity.valid) {
      throw new Error(`Refusing to persist invalid post-reservation sync state: ${nextIntegrity.errors.join('; ')}`);
    }

    const saved = saveSyncState(root, nextStateDoc, { home, nowIso });
    return {
      reserved: true,
      state_key: stateKey,
      database: op.database,
      canonical_key: op.canonical_key,
      action: op.action,
      operation_id: op.operation_id,
      approved_plan_hash: approvedPlan.plan_hash,
      attempted_hash: op.sync_hash,
      attempted_at: nowIso,
      existing_page_id: resolvedPageId,
      previous_state: currentEntry?.state ?? null,
      force_applied: Boolean(force && currentEntry?.state === 'failed_retryable'),
      path: saved.path,
      state: saved.state,
    };
  });
}

// D5: Transition stale in_flight records ONLY to receipt_uncertain (never pending_sync or failed_retryable).
export function expireStaleInFlightRecords(root, {
  nowIso = new Date().toISOString(),
  staleTimeoutMs = DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('expireStaleInFlightRecords requires a non-empty workspace root path.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`expireStaleInFlightRecords: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(staleTimeoutMs) || staleTimeoutMs <= 0) {
    throw new Error('expireStaleInFlightRecords: staleTimeoutMs must be a positive safe integer.');
  }

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    if (!loaded.exists) {
      return {
        expired_count: 0,
        expired_keys: [],
        path: loaded.path,
        state: loaded.state,
      };
    }

    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const nextRecords = { ...loaded.state.records };
    const expiredKeys = [];
    const sortedKeys = Object.keys(loaded.state.records).sort(codePointCompare);

    for (const key of sortedKeys) {
      const entry = loaded.state.records[key];
      if (entry.state !== 'in_flight') continue;
      const check = validateSyncStateTransition(entry, 'receipt_uncertain', { nowIso, staleTimeoutMs });
      if (!check.valid) continue;
      nextRecords[key] = {
        ...entry,
        state: 'receipt_uncertain',
        last_error: 'stale_in_flight_timeout',
      };
      expiredKeys.push(key);
    }

    if (expiredKeys.length === 0) {
      return {
        expired_count: 0,
        expired_keys: [],
        path: loaded.path,
        state: loaded.state,
      };
    }

    const saved = saveSyncState(root, {
      schema_version: '1.0',
      updated_at: nowIso,
      records: nextRecords,
    }, { home, nowIso });

    return {
      expired_count: expiredKeys.length,
      expired_keys: expiredKeys,
      path: saved.path,
      state: saved.state,
    };
  });
}

// Strictly read-only recovery inspection (D3, D4, D5). Never writes disk or mutates input.
export function inspectSyncStateRecovery(stateDoc, {
  nowIso = new Date().toISOString(),
  staleTimeoutMs = DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
} = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`inspectSyncStateRecovery: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(staleTimeoutMs) || staleTimeoutMs <= 0) {
    throw new Error('inspectSyncStateRecovery: staleTimeoutMs must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 1) {
    throw new Error('inspectSyncStateRecovery: maxRetries must be a positive safe integer.');
  }

  const integrity = verifySyncStateIntegrity(stateDoc, { nowIso, maxFutureSkewMs });
  if (!integrity.valid) {
    throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
  }

  const nowMs = Date.parse(nowIso);
  const counts = {
    stale_in_flight: 0,
    active_in_flight: 0,
    receipt_uncertain: 0,
    conflict_duplicate_remote: 0,
    failed_retryable_ready: 0,
    failed_retryable_cooldown: 0,
    failed_retryable_cap_reached: 0,
    failed_permanent: 0,
    healthy_or_pending: 0,
  };
  const items = [];
  const sortedKeys = Object.keys(stateDoc.records).sort(codePointCompare);

  for (const key of sortedKeys) {
    const entry = stateDoc.records[key];
    let classification = 'healthy_or_pending';
    let recommendedAction = 'none';
    let forceEligible = false;
    let ageMs = null;

    if (entry.state === 'in_flight') {
      ageMs = nowMs - Date.parse(entry.attempted_at);
      if (ageMs >= staleTimeoutMs) {
        classification = 'stale_in_flight';
        recommendedAction = 'expire_to_receipt_uncertain_then_reconcile';
      } else {
        classification = 'active_in_flight';
        recommendedAction = 'wait_or_reconcile';
      }
    } else if (entry.state === 'receipt_uncertain') {
      classification = 'receipt_uncertain';
      recommendedAction = 'reconcile_remote';
    } else if (entry.state === 'conflict_duplicate_remote') {
      classification = 'conflict_duplicate_remote';
      recommendedAction = 'deduplicate_remote_pages_then_reconcile';
    } else if (entry.state === 'failed_retryable') {
      const retryCount = Number.isInteger(entry.retry_count) ? entry.retry_count : 0;
      const inCooldown = Boolean(entry.next_retry_after && nowMs < Date.parse(entry.next_retry_after));
      forceEligible = true;
      if (retryCount >= maxRetries) {
        classification = 'failed_retryable_cap_reached';
        recommendedAction = 'retry_cap_reached_requires_force_or_review';
      } else if (inCooldown) {
        classification = 'failed_retryable_cooldown';
        recommendedAction = 'wait_for_cooldown_or_force_retry';
      } else {
        classification = 'failed_retryable_ready';
        recommendedAction = 'eligible_for_new_approved_retry';
      }
    } else if (entry.state === 'failed_permanent') {
      classification = 'failed_permanent';
      recommendedAction = 'manual_remediation_and_explicit_reset';
    }

    counts[classification] += 1;
    items.push({
      state_key: key,
      database: entry.database,
      canonical_key: entry.canonical_key,
      state: entry.state,
      classification,
      recommended_action: recommendedAction,
      force_eligible: forceEligible,
      age_ms: ageMs,
      retry_count: Number.isInteger(entry.retry_count) ? entry.retry_count : 0,
      next_retry_after: entry.next_retry_after ?? null,
      page_id: entry.page_id ? normalizeNotionUuid(entry.page_id) : null,
      operation_id: entry.operation_id ?? null,
    });
  }

  const requiresAttention = (
    counts.stale_in_flight +
    counts.active_in_flight +
    counts.receipt_uncertain +
    counts.conflict_duplicate_remote +
    counts.failed_retryable_ready +
    counts.failed_retryable_cooldown +
    counts.failed_retryable_cap_reached +
    counts.failed_permanent
  ) > 0;

  return {
    inspected_at: nowIso,
    total_records: sortedKeys.length,
    counts,
    items,
    requires_attention: requiresAttention,
  };
}

// ---------------- Stage 3 (T8-C): Receipt Verification, Failure/Backoff, Reconciliation & Explicit Reset ----------------

export const DEFAULT_BASE_BACKOFF_SECONDS = 60;
export const DEFAULT_MAX_BACKOFF_SECONDS = 3600;

export const RETRYABLE_FAILURE_CODES = Object.freeze([
  'rate_limited',
  'service_unavailable',
  'conflict_retryable',
  'transient_upstream',
]);
const RETRYABLE_FAILURE_SET = new Set(RETRYABLE_FAILURE_CODES);

export const PERMANENT_FAILURE_CODES = Object.freeze([
  'schema_mismatch',
  'validation_error',
  'permission_denied',
  'invalid_database',
  'object_not_found',
  'payload_rejected',
]);
const PERMANENT_FAILURE_SET = new Set(PERMANENT_FAILURE_CODES);

export const AMBIGUOUS_FAILURE_CODES = Object.freeze([
  'timeout',
  'network_drop',
  'bad_gateway',
  'gateway_timeout',
  'unknown_outcome',
  'ambiguous_response',
]);
const AMBIGUOUS_FAILURE_SET = new Set(AMBIGUOUS_FAILURE_CODES);

const RECEIPT_TRUST_NOTE =
  'Structured MCP workflow evidence (not independent cryptographic proof of Notion execution); reconcile remotely whenever execution outcome or evidence authenticity is uncertain.';

function sanitizeSafeErrorText(raw, fallbackCode = 'sync_error') {
  const safeFallback = typeof fallbackCode === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(fallbackCode)
    ? fallbackCode.toLowerCase()
    : 'sync_error';
  if (typeof raw !== 'string') return safeFallback;
  const cleaned = raw.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) return safeFallback;
  if (hasDisallowedLastErrorContent(cleaned) || PHONE_PATTERNS.some(re => re.test(cleaned))) {
    return safeFallback;
  }
  return cleaned.length <= 120 ? cleaned : `${cleaned.slice(0, 117).trimEnd()}...`;
}

function findCrossKeyPageCollision(records, targetStateKey, normPageId) {
  if (!normPageId) return null;
  const sortedKeys = Object.keys(records).sort(codePointCompare);
  for (const otherKey of sortedKeys) {
    if (otherKey === targetStateKey) continue;
    const other = records[otherKey];
    if (other?.page_id && normalizeNotionUuid(other.page_id) === normPageId) {
      return otherKey;
    }
    if (Array.isArray(other?.conflicting_page_ids)) {
      for (const cid of other.conflicting_page_ids) {
        if (normalizeNotionUuid(cid) === normPageId) {
          return otherKey;
        }
      }
    }
  }
  return null;
}

// Safety Resolution 1: Validate structured MCP execution receipt + read-back properties.
// Structured evidence is NOT cryptographic proof; any mismatch/omission fails closed.
export function verifySyncReceiptEvidence(inFlightEntry, receipt, {
  expectedDatabaseId = null,
  nowIso = null,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
} = {}) {
  const errors = [];
  let code = null;
  const setErr = (errCode, msg) => {
    if (code === null) code = errCode;
    errors.push(msg);
  };

  if (!isObj(inFlightEntry) || inFlightEntry.state !== 'in_flight') {
    setErr('entry_not_in_flight', 'Receipt verification requires an active in_flight sync-state entry.');
    return { valid: false, verified_page_id: null, verified_at: null, code, errors, trust_note: RECEIPT_TRUST_NOTE };
  }
  if (
    !TARGET_DATABASE_SET.has(inFlightEntry.database) ||
    !isNonEmptyString(inFlightEntry.canonical_key) ||
    typeof inFlightEntry.operation_id !== 'string' || !HEX16_RE.test(inFlightEntry.operation_id) ||
    typeof inFlightEntry.approved_plan_hash !== 'string' || !HEX64_RE.test(inFlightEntry.approved_plan_hash) ||
    typeof inFlightEntry.attempted_hash !== 'string' || !HEX16_RE.test(inFlightEntry.attempted_hash) ||
    !isValidIsoDateTime(inFlightEntry.attempted_at)
  ) {
    setErr('invalid_in_flight_entry', 'in_flight sync-state entry is missing required binding metadata.');
    return { valid: false, verified_page_id: null, verified_at: null, code, errors, trust_note: RECEIPT_TRUST_NOTE };
  }
  if (nowIso !== null && !isValidIsoDateTime(nowIso)) {
    setErr('invalid_now_iso', `verifySyncReceiptEvidence: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    setErr('invalid_future_skew', 'verifySyncReceiptEvidence: maxFutureSkewMs must be a non-negative safe integer.');
  }

  let expectedNormDbId = null;
  if (expectedDatabaseId !== null) {
    expectedNormDbId = normalizeNotionUuid(expectedDatabaseId);
    if (!expectedNormDbId) {
      setErr('invalid_expected_database_id', 'expectedDatabaseId must be a valid Notion UUID or null.');
    }
  }

  if (!isObj(receipt)) {
    setErr('missing_or_invalid_receipt', 'Structured mcp_evidence receipt must be a JSON object.');
    return { valid: false, verified_page_id: null, verified_at: null, code, errors, trust_note: RECEIPT_TRUST_NOTE };
  }

  if (receipt.operation_id !== inFlightEntry.operation_id) {
    setErr('receipt_operation_id_mismatch', 'Receipt operation_id does not match active in_flight reservation.');
  }
  if (receipt.approved_plan_hash !== inFlightEntry.approved_plan_hash) {
    setErr('receipt_plan_hash_mismatch', 'Receipt approved_plan_hash does not match active in_flight reservation.');
  }
  if (receipt.database !== inFlightEntry.database || receipt.canonical_key !== inFlightEntry.canonical_key) {
    setErr('receipt_target_mismatch', 'Receipt database/canonical_key does not match active in_flight reservation.');
  }
  if (receipt.sync_hash !== inFlightEntry.attempted_hash) {
    setErr('receipt_sync_hash_mismatch', 'Receipt sync_hash does not match active in_flight attempted_hash.');
  }
  if (receipt.archived === true || receipt.in_trash === true) {
    setErr('receipt_page_archived_or_trashed', 'Receipt indicates target Notion page is archived or in_trash.');
  }

  const verifiedPageId = normalizeNotionUuid(receipt.page_id);
  if (!verifiedPageId) {
    setErr('invalid_receipt_page_id', 'Receipt page_id must be a valid Notion UUID.');
  } else if (inFlightEntry.page_id !== undefined && inFlightEntry.page_id !== null) {
    const expectedPageId = normalizeNotionUuid(inFlightEntry.page_id);
    if (expectedPageId && verifiedPageId !== expectedPageId) {
      setErr('receipt_page_id_mismatch', `Receipt page_id "${verifiedPageId}" contradicts reserved update page_id "${expectedPageId}".`);
    }
  }

  const receiptDbId = normalizeNotionUuid(receipt.database_id);
  if (!receiptDbId) {
    setErr('invalid_receipt_database_id', 'Receipt database_id must be a valid Notion UUID.');
  } else if (expectedNormDbId && receiptDbId !== expectedNormDbId) {
    setErr('receipt_database_id_mismatch', `Receipt database_id "${receiptDbId}" does not match expectedDatabaseId "${expectedNormDbId}".`);
  }

  let verifiedAt = null;
  if (!isValidIsoDateTime(receipt.verified_at)) {
    setErr('invalid_receipt_verified_at', 'Receipt verified_at must be a valid ISO-8601 date-time.');
  } else {
    verifiedAt = receipt.verified_at;
    if (Date.parse(verifiedAt) < Date.parse(inFlightEntry.attempted_at)) {
      setErr('receipt_predates_attempt', `Receipt verified_at "${verifiedAt}" predates in_flight attempted_at "${inFlightEntry.attempted_at}".`);
    }
    if (nowIso !== null && isValidIsoDateTime(nowIso) && Number.isSafeInteger(maxFutureSkewMs) && maxFutureSkewMs >= 0) {
      if (Date.parse(verifiedAt) - Date.parse(nowIso) > maxFutureSkewMs) {
        setErr('receipt_verified_at_in_future', `Receipt verified_at "${verifiedAt}" is in the future beyond allowed skew (${maxFutureSkewMs}ms).`);
      }
    }
  }

  // Mandatory read-back verification of canonical key property & Sync Hash
  const expectedFilterProp = RECONCILE_FILTER_PROPERTY_BY_DB[inFlightEntry.database];
  if (!isObj(receipt.readback_properties)) {
    setErr('missing_readback_properties', 'Receipt requires readback_properties confirming persisted canonical key and Sync Hash.');
  } else {
    if (receipt.readback_properties[expectedFilterProp] !== inFlightEntry.canonical_key) {
      setErr('readback_canonical_key_mismatch', `Read-back property "${expectedFilterProp}" does not match canonical_key "${inFlightEntry.canonical_key}".`);
    }
    if (receipt.readback_properties['Sync Hash'] !== inFlightEntry.attempted_hash) {
      setErr('readback_sync_hash_mismatch', 'Read-back "Sync Hash" does not match active in_flight attempted_hash.');
    }
  }

  return {
    valid: errors.length === 0,
    verified_page_id: errors.length === 0 ? verifiedPageId : null,
    verified_at: errors.length === 0 ? verifiedAt : null,
    code,
    errors,
    trust_note: RECEIPT_TRUST_NOTE,
  };
}

// Apply structured receipt under exclusive lock:
// - Valid operation-bound evidence + read-back -> synced
// - Incomplete/mismatched/colliding evidence -> receipt_uncertain (fail closed)
export function applySyncReceipt(root, {
  database,
  canonicalKey,
  operationId,
  approvedPlanHash,
  receipt,
  expectedDatabaseId = null,
  nowIso = new Date().toISOString(),
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('applySyncReceipt requires a non-empty workspace root path.');
  }
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`applySyncReceipt: invalid database "${database}".`);
  }
  if (!isNonEmptyString(canonicalKey)) {
    throw new Error('applySyncReceipt requires a non-empty canonicalKey.');
  }
  if (typeof operationId !== 'string' || !HEX16_RE.test(operationId)) {
    throw new Error('applySyncReceipt requires a valid 16-char lowercase hex operationId.');
  }
  if (typeof approvedPlanHash !== 'string' || !HEX64_RE.test(approvedPlanHash)) {
    throw new Error('applySyncReceipt requires a valid 64-char lowercase hex approvedPlanHash.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`applySyncReceipt: invalid nowIso timestamp "${nowIso}".`);
  }
  if (expectedDatabaseId !== null && normalizeNotionUuid(expectedDatabaseId) === null) {
    throw new Error('applySyncReceipt: expectedDatabaseId must be a valid Notion UUID or null.');
  }

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    if (!loaded.exists) {
      throw new Error('applySyncReceipt: logs/sync-state.json does not exist; no active in_flight reservation found.');
    }
    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const stateKey = makeSyncStateKey(database, canonicalKey);
    const entry = loaded.state.records[stateKey];
    if (!entry || entry.state !== 'in_flight') {
      throw new Error(`applySyncReceipt: "${stateKey}" is not in_flight (current state: "${entry?.state ?? 'none'}").`);
    }
    if (entry.operation_id !== operationId) {
      throw new Error(`applySyncReceipt: operationId "${operationId}" does not match active in_flight operation_id "${entry.operation_id}".`);
    }
    if (entry.approved_plan_hash !== approvedPlanHash) {
      throw new Error('applySyncReceipt: approvedPlanHash does not match active in_flight reservation.');
    }

    const check = verifySyncReceiptEvidence(entry, receipt, { expectedDatabaseId, nowIso, maxFutureSkewMs });
    let nextEntry;
    let applied = false;
    let resultCode = check.code;
    let resultErrors = [...check.errors];

    if (check.valid) {
      const collisionKey = findCrossKeyPageCollision(loaded.state.records, stateKey, check.verified_page_id);
      if (collisionKey) {
        resultCode = 'receipt_page_id_cross_key_collision';
        resultErrors = [`Receipt page_id "${check.verified_page_id}" collides with existing key "${collisionKey}".`];
        nextEntry = {
          ...entry,
          state: 'receipt_uncertain',
          last_error: 'receipt_page_id_cross_key_collision',
        };
      } else {
        applied = true;
        nextEntry = {
          database: entry.database,
          canonical_key: entry.canonical_key,
          state: 'synced',
          page_id: check.verified_page_id,
          last_synced_hash: entry.attempted_hash,
          attempted_hash: null,
          attempted_at: null,
          last_synced_at: check.verified_at,
          operation_id: null,
          approved_plan_hash: null,
          retry_count: 0,
          next_retry_after: null,
          last_error: null,
        };
      }
    } else {
      nextEntry = {
        ...entry,
        state: 'receipt_uncertain',
        last_error: sanitizeSafeErrorText(`receipt_verification_failed:${check.code || 'invalid'}`, 'receipt_verification_failed'),
      };
    }

    const nextStateDoc = {
      schema_version: '1.0',
      updated_at: nowIso,
      records: {
        ...loaded.state.records,
        [stateKey]: nextEntry,
      },
    };
    const nextIntegrity = verifySyncStateIntegrity(nextStateDoc, { nowIso, maxFutureSkewMs });
    if (!nextIntegrity.valid) {
      throw new Error(`Refusing to persist invalid post-receipt sync state: ${nextIntegrity.errors.join('; ')}`);
    }

    const saved = saveSyncState(root, nextStateDoc, { home, nowIso });
    return {
      applied,
      state_key: stateKey,
      state: nextEntry.state,
      page_id: applied ? nextEntry.page_id : (nextEntry.page_id ?? null),
      last_synced_hash: applied ? nextEntry.last_synced_hash : (nextEntry.last_synced_hash ?? null),
      last_synced_at: applied ? nextEntry.last_synced_at : (nextEntry.last_synced_at ?? null),
      code: resultCode,
      errors: resultErrors,
      trust_note: RECEIPT_TRUST_NOTE,
      path: saved.path,
      sync_state: saved.state,
    };
  });
}

// Deterministic failure classification & exponential backoff recording (D3/D4/Safety Resolution 3):
// - Ambiguous/timeout/unknown or mutationNotApplied !== true -> ALWAYS receipt_uncertain
// - Confirmed non-applied retryable -> failed_retryable (stays failed_retryable at cap for --force)
// - Confirmed non-applied permanent -> failed_permanent (held until explicit resetPermanentFailure)
export function recordSyncFailure(root, {
  database,
  canonicalKey,
  operationId,
  approvedPlanHash,
  errorCode,
  errorMessage = null,
  mutationNotApplied = false,
  nowIso = new Date().toISOString(),
  baseBackoffSeconds = DEFAULT_BASE_BACKOFF_SECONDS,
  maxBackoffSeconds = DEFAULT_MAX_BACKOFF_SECONDS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('recordSyncFailure requires a non-empty workspace root path.');
  }
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`recordSyncFailure: invalid database "${database}".`);
  }
  if (!isNonEmptyString(canonicalKey)) {
    throw new Error('recordSyncFailure requires a non-empty canonicalKey.');
  }
  if (typeof operationId !== 'string' || !HEX16_RE.test(operationId)) {
    throw new Error('recordSyncFailure requires a valid 16-char lowercase hex operationId.');
  }
  if (typeof approvedPlanHash !== 'string' || !HEX64_RE.test(approvedPlanHash)) {
    throw new Error('recordSyncFailure requires a valid 64-char lowercase hex approvedPlanHash.');
  }
  if (typeof mutationNotApplied !== 'boolean') {
    throw new Error('recordSyncFailure: mutationNotApplied must be an explicit boolean.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`recordSyncFailure: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(baseBackoffSeconds) || baseBackoffSeconds <= 0) {
    throw new Error('recordSyncFailure: baseBackoffSeconds must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxBackoffSeconds) || maxBackoffSeconds < baseBackoffSeconds) {
    throw new Error('recordSyncFailure: maxBackoffSeconds must be a safe integer >= baseBackoffSeconds.');
  }

  const normCode = typeof errorCode === 'string' && errorCode.trim().length > 0
    ? errorCode.trim().toLowerCase()
    : 'unknown_outcome';

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    if (!loaded.exists) {
      throw new Error('recordSyncFailure: logs/sync-state.json does not exist; no active in_flight reservation found.');
    }
    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const stateKey = makeSyncStateKey(database, canonicalKey);
    const entry = loaded.state.records[stateKey];
    if (!entry || entry.state !== 'in_flight') {
      throw new Error(`recordSyncFailure: "${stateKey}" is not in_flight (current state: "${entry?.state ?? 'none'}").`);
    }
    if (entry.operation_id !== operationId) {
      throw new Error(`recordSyncFailure: operationId "${operationId}" does not match active in_flight operation_id "${entry.operation_id}".`);
    }
    if (entry.approved_plan_hash !== approvedPlanHash) {
      throw new Error('recordSyncFailure: approvedPlanHash does not match active in_flight reservation.');
    }

    const rawErrText = isNonEmptyString(errorMessage) ? `${normCode}: ${errorMessage}` : normCode;
    let nextEntry;
    let classification;

    if (mutationNotApplied === true && RETRYABLE_FAILURE_SET.has(normCode)) {
      classification = 'retryable';
      const nextRetryCount = (Number.isInteger(entry.retry_count) ? entry.retry_count : 0) + 1;
      const exponent = Math.min(nextRetryCount - 1, 20);
      const delaySeconds = Math.min(baseBackoffSeconds * (2 ** exponent), maxBackoffSeconds);
      const nextRetryAfter = new Date(Date.parse(nowIso) + delaySeconds * 1000).toISOString();
      nextEntry = {
        ...entry,
        state: 'failed_retryable',
        retry_count: nextRetryCount,
        next_retry_after: nextRetryAfter,
        last_error: sanitizeSafeErrorText(rawErrText, normCode),
      };
    } else if (mutationNotApplied === true && PERMANENT_FAILURE_SET.has(normCode)) {
      classification = 'permanent';
      nextEntry = {
        ...entry,
        state: 'failed_permanent',
        next_retry_after: null,
        last_error: sanitizeSafeErrorText(rawErrText, normCode),
      };
    } else {
      // Ambiguous / timeout / network_drop / unknown OR mutationNotApplied === false -> ALWAYS receipt_uncertain
      classification = 'ambiguous_uncertain';
      const safeFallback = AMBIGUOUS_FAILURE_SET.has(normCode) ? normCode : 'ambiguous_outcome';
      nextEntry = {
        ...entry,
        state: 'receipt_uncertain',
        next_retry_after: null,
        last_error: sanitizeSafeErrorText(rawErrText, safeFallback),
      };
    }

    const nextStateDoc = {
      schema_version: '1.0',
      updated_at: nowIso,
      records: {
        ...loaded.state.records,
        [stateKey]: nextEntry,
      },
    };
    const nextIntegrity = verifySyncStateIntegrity(nextStateDoc, { nowIso, maxFutureSkewMs });
    if (!nextIntegrity.valid) {
      throw new Error(`Refusing to persist invalid post-failure sync state: ${nextIntegrity.errors.join('; ')}`);
    }

    const saved = saveSyncState(root, nextStateDoc, { home, nowIso });
    return {
      recorded: true,
      state_key: stateKey,
      previous_state: 'in_flight',
      classification,
      state: nextEntry.state,
      retry_count: Number.isInteger(nextEntry.retry_count) ? nextEntry.retry_count : 0,
      next_retry_after: nextEntry.next_retry_after ?? null,
      last_error: nextEntry.last_error,
      path: saved.path,
      sync_state: saved.state,
    };
  });
}

// Safety Resolution 2: Validate all 6 minimum query-snapshot completeness invariants.
// Incomplete, errored, timed-out, mis-filtered, or predating snapshots MUST fail closed.
export function validateReconcileQuerySnapshot(snapshot, {
  expectedDatabase,
  expectedCanonicalKey,
  expectedDatabaseId,
  minQueriedAt = null,
  nowIso = null,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
} = {}) {
  const errors = [];
  let code = null;
  const setErr = (errCode, msg) => {
    if (code === null) code = errCode;
    errors.push(msg);
  };

  if (!TARGET_DATABASE_SET.has(expectedDatabase)) {
    setErr('invalid_expected_database', `Unknown expectedDatabase "${expectedDatabase}".`);
  }
  if (!isNonEmptyString(expectedCanonicalKey)) {
    setErr('invalid_expected_canonical_key', 'expectedCanonicalKey must be a non-empty string.');
  }
  const normExpectedDbId = normalizeNotionUuid(expectedDatabaseId);
  if (!normExpectedDbId) {
    setErr('invalid_expected_database_id', 'expectedDatabaseId must be a valid Notion UUID.');
  }
  if (minQueriedAt !== null && !isValidIsoDateTime(minQueriedAt)) {
    setErr('invalid_min_queried_at', `Invalid minQueriedAt timestamp "${minQueriedAt}".`);
  }
  if (nowIso !== null && !isValidIsoDateTime(nowIso)) {
    setErr('invalid_now_iso', `Invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    setErr('invalid_future_skew', 'maxFutureSkewMs must be a non-negative safe integer.');
  }

  if (!isObj(snapshot)) {
    setErr('snapshot_not_object', 'Reconciliation query snapshot must be a JSON object.');
    return { valid: false, complete: false, code, errors, active_pages: [], queried_at: null };
  }

  // 1. Target database & database_id
  if (snapshot.database !== expectedDatabase) {
    setErr('snapshot_database_mismatch', `Snapshot database "${snapshot.database}" does not match expected "${expectedDatabase}".`);
  }
  const snapDbId = normalizeNotionUuid(snapshot.database_id);
  if (!snapDbId || (normExpectedDbId && snapDbId !== normExpectedDbId)) {
    setErr('snapshot_database_id_mismatch', 'Snapshot database_id is invalid or does not match expectedDatabaseId.');
  }

  // 2. Exact canonical filter property & value
  const expectedProp = TARGET_DATABASE_SET.has(expectedDatabase) ? RECONCILE_FILTER_PROPERTY_BY_DB[expectedDatabase] : null;
  if (snapshot.filter_property !== expectedProp) {
    setErr('snapshot_filter_property_mismatch', `Snapshot filter_property "${snapshot.filter_property}" must equal "${expectedProp}".`);
  }
  if (snapshot.filter_value !== expectedCanonicalKey) {
    setErr('snapshot_filter_value_mismatch', `Snapshot filter_value "${snapshot.filter_value}" must equal "${expectedCanonicalKey}".`);
  }

  // 3. Explicit query success
  if (snapshot.query_succeeded !== true) {
    setErr('snapshot_query_failed', 'Snapshot query_succeeded must be explicitly true.');
  }

  // 4. Complete pagination (zero missing pages)
  if (snapshot.pagination_complete !== true || snapshot.has_more !== false || snapshot.next_cursor !== null) {
    setErr('snapshot_pagination_incomplete', 'Snapshot pagination is incomplete (requires pagination_complete=true, has_more=false, next_cursor=null).');
  }

  // 5. Zero unresolved query errors or timeouts
  if (snapshot.timed_out !== false) {
    setErr('snapshot_timed_out', 'Snapshot timed_out must be explicitly false.');
  }
  if (snapshot.errors !== undefined && snapshot.errors !== null) {
    if (!Array.isArray(snapshot.errors) || snapshot.errors.length > 0) {
      setErr('snapshot_has_errors', 'Snapshot contains unresolved query errors.');
    }
  }

  // 6. Strict ISO-8601 queried_at + causality check
  let queriedAt = null;
  if (!isValidIsoDateTime(snapshot.queried_at)) {
    setErr('invalid_queried_at', 'Snapshot queried_at must be a valid ISO-8601 date-time.');
  } else {
    queriedAt = snapshot.queried_at;
    if (minQueriedAt !== null && isValidIsoDateTime(minQueriedAt) && Date.parse(queriedAt) < Date.parse(minQueriedAt)) {
      setErr('snapshot_predates_attempt', `Snapshot queried_at "${queriedAt}" predates in_flight attempted_at "${minQueriedAt}".`);
    }
    if (nowIso !== null && isValidIsoDateTime(nowIso) && Number.isSafeInteger(maxFutureSkewMs) && maxFutureSkewMs >= 0) {
      if (Date.parse(queriedAt) - Date.parse(nowIso) > maxFutureSkewMs) {
        setErr('snapshot_queried_at_in_future', `Snapshot queried_at "${queriedAt}" is in the future beyond allowed skew (${maxFutureSkewMs}ms).`);
      }
    }
  }

  // Validate & deduplicate active remote pages
  const activePages = [];
  if (!Array.isArray(snapshot.pages)) {
    setErr('snapshot_pages_not_array', 'Snapshot pages must be an array.');
  } else {
    const seenPages = new Map();
    for (let i = 0; i < snapshot.pages.length; i++) {
      const p = snapshot.pages[i];
      if (!isObj(p)) {
        setErr('snapshot_page_invalid', `Snapshot pages[${i}] must be an object.`);
        continue;
      }
      if (p.archived === true || p.in_trash === true) continue;
      const normPageId = normalizeNotionUuid(p.page_id ?? p.id);
      if (!normPageId) {
        setErr('snapshot_page_invalid_uuid', `Snapshot pages[${i}] has invalid or missing Notion UUID page_id.`);
        continue;
      }
      if (p.canonical_key !== undefined && p.canonical_key !== null && p.canonical_key !== expectedCanonicalKey) {
        setErr('snapshot_page_canonical_key_mismatch', `Snapshot pages[${i}] canonical_key does not match expected "${expectedCanonicalKey}".`);
        continue;
      }
      if (p.sync_hash !== undefined && p.sync_hash !== null && (typeof p.sync_hash !== 'string' || !HEX16_RE.test(p.sync_hash))) {
        setErr('snapshot_page_invalid_sync_hash', `Snapshot pages[${i}].sync_hash must be a 16-char lowercase hex string or null.`);
        continue;
      }
      const nextHash = p.sync_hash ?? null;
      if (seenPages.has(normPageId)) {
        if (seenPages.get(normPageId) !== nextHash) {
          setErr('snapshot_conflicting_page_hash', `Conflicting sync_hash values for duplicate page_id "${normPageId}" in query snapshot.`);
        }
        continue;
      }
      seenPages.set(normPageId, nextHash);
      activePages.push({ page_id: normPageId, sync_hash: nextHash });
    }
    activePages.sort((a, b) => codePointCompare(a.page_id, b.page_id));
  }

  return {
    valid: errors.length === 0,
    complete: errors.length === 0,
    code,
    errors,
    active_pages: errors.length === 0 ? activePages : [],
    queried_at: errors.length === 0 ? queriedAt : null,
  };
}

const RECONCILABLE_STATES = new Set(['in_flight', 'receipt_uncertain', 'conflict_duplicate_remote']);

// Safe reconciliation of in_flight, receipt_uncertain, or conflict_duplicate_remote records
// from a validated complete remote query snapshot (Safety Resolution 2).
export function reconcileSyncRecord(root, {
  database,
  canonicalKey,
  expectedDatabaseId,
  querySnapshot,
  confirmRemotePageDeleted = false,
  nowIso = new Date().toISOString(),
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('reconcileSyncRecord requires a non-empty workspace root path.');
  }
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`reconcileSyncRecord: invalid database "${database}".`);
  }
  if (!isNonEmptyString(canonicalKey)) {
    throw new Error('reconcileSyncRecord requires a non-empty canonicalKey.');
  }
  if (normalizeNotionUuid(expectedDatabaseId) === null) {
    throw new Error('reconcileSyncRecord requires a valid Notion UUID expectedDatabaseId.');
  }
  if (typeof confirmRemotePageDeleted !== 'boolean') {
    throw new Error('reconcileSyncRecord: confirmRemotePageDeleted must be an explicit boolean.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`reconcileSyncRecord: invalid nowIso timestamp "${nowIso}".`);
  }

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    if (!loaded.exists) {
      throw new Error('reconcileSyncRecord: logs/sync-state.json does not exist.');
    }
    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const stateKey = makeSyncStateKey(database, canonicalKey);
    const entry = loaded.state.records[stateKey];
    if (!entry || !RECONCILABLE_STATES.has(entry.state)) {
      throw new Error(`reconcileSyncRecord: "${stateKey}" is in state "${entry?.state ?? 'none'}", which is not reconcilable.`);
    }

    const snapCheck = validateReconcileQuerySnapshot(querySnapshot, {
      expectedDatabase: database,
      expectedCanonicalKey: canonicalKey,
      expectedDatabaseId,
      minQueriedAt: entry.attempted_at ?? null,
      nowIso,
      maxFutureSkewMs,
    });

    const persistNext = nextEntry => {
      const nextStateDoc = {
        schema_version: '1.0',
        updated_at: nowIso,
        records: {
          ...loaded.state.records,
          [stateKey]: nextEntry,
        },
      };
      const nextIntegrity = verifySyncStateIntegrity(nextStateDoc, { nowIso, maxFutureSkewMs });
      if (!nextIntegrity.valid) {
        throw new Error(`Refusing to persist invalid post-reconciliation sync state: ${nextIntegrity.errors.join('; ')}`);
      }
      return saveSyncState(root, nextStateDoc, { home, nowIso });
    };

    // Incomplete or invalid snapshot MUST NEVER clear uncertainty or authorize a create
    if (!snapCheck.valid) {
      if (entry.state === 'in_flight') {
        const heldEntry = {
          ...entry,
          state: 'receipt_uncertain',
          last_error: sanitizeSafeErrorText(`incomplete_reconcile_query:${snapCheck.code || 'invalid'}`, 'incomplete_reconcile_query'),
        };
        const saved = persistNext(heldEntry);
        return {
          reconciled: false,
          state_key: stateKey,
          previous_state: 'in_flight',
          state: 'receipt_uncertain',
          resolution: 'held_incomplete_query',
          code: snapCheck.code,
          errors: snapCheck.errors,
          path: saved.path,
          sync_state: saved.state,
        };
      }
      return {
        reconciled: false,
        state_key: stateKey,
        previous_state: entry.state,
        state: entry.state,
        resolution: 'held_incomplete_query',
        code: snapCheck.code,
        errors: snapCheck.errors,
        path: loaded.path,
        sync_state: loaded.state,
      };
    }

    // Check cross-key page_id collisions across all active pages in the snapshot
    for (const page of snapCheck.active_pages) {
      const collisionKey = findCrossKeyPageCollision(loaded.state.records, stateKey, page.page_id);
      if (collisionKey) {
        const errMsg = `Reconciled page_id "${page.page_id}" collides with existing key "${collisionKey}".`;
        if (entry.state === 'in_flight') {
          const heldEntry = {
            ...entry,
            state: 'receipt_uncertain',
            last_error: 'reconcile_page_id_cross_key_collision',
          };
          const saved = persistNext(heldEntry);
          return {
            reconciled: false,
            state_key: stateKey,
            previous_state: 'in_flight',
            state: 'receipt_uncertain',
            resolution: 'held_cross_key_page_collision',
            code: 'reconcile_page_id_cross_key_collision',
            errors: [errMsg],
            path: saved.path,
            sync_state: saved.state,
          };
        }
        return {
          reconciled: false,
          state_key: stateKey,
          previous_state: entry.state,
          state: entry.state,
          resolution: 'held_cross_key_page_collision',
          code: 'reconcile_page_id_cross_key_collision',
          errors: [errMsg],
          path: loaded.path,
          sync_state: loaded.state,
        };
      }
    }

    const activePages = snapCheck.active_pages;
    let nextEntry;
    let resolution;
    let reconciled = true;

    if (activePages.length >= 2) {
      resolution = 'conflict_duplicate_remote';
      nextEntry = {
        database: entry.database,
        canonical_key: entry.canonical_key,
        state: 'conflict_duplicate_remote',
        page_id: null,
        last_synced_hash: entry.last_synced_hash ?? null,
        attempted_hash: entry.attempted_hash ?? null,
        attempted_at: entry.attempted_at ?? null,
        last_synced_at: entry.last_synced_at ?? null,
        operation_id: entry.operation_id ?? null,
        approved_plan_hash: entry.approved_plan_hash ?? null,
        retry_count: Number.isInteger(entry.retry_count) ? entry.retry_count : 0,
        next_retry_after: null,
        conflicting_page_ids: activePages.map(p => p.page_id),
        last_error: 'duplicate_remote_pages',
      };
    } else if (activePages.length === 1) {
      const remote = activePages[0];
      const expectedHash = entry.attempted_hash ?? entry.last_synced_hash ?? null;
      if (expectedHash !== null && remote.sync_hash === expectedHash) {
        resolution = 'verified_synced';
        nextEntry = {
          database: entry.database,
          canonical_key: entry.canonical_key,
          state: 'synced',
          page_id: remote.page_id,
          last_synced_hash: expectedHash,
          attempted_hash: null,
          attempted_at: null,
          last_synced_at: snapCheck.queried_at,
          operation_id: null,
          approved_plan_hash: null,
          retry_count: 0,
          next_retry_after: null,
          last_error: null,
        };
      } else {
        // Remote page exists but has older/missing/different hash -> bind page_id so next plan emits safe update (never create!)
        resolution = 'rebound_pending_update';
        nextEntry = {
          database: entry.database,
          canonical_key: entry.canonical_key,
          state: 'pending_sync',
          page_id: remote.page_id,
          last_synced_hash: remote.sync_hash ?? entry.last_synced_hash ?? null,
          attempted_hash: null,
          attempted_at: null,
          last_synced_at: entry.last_synced_at ?? null,
          operation_id: null,
          approved_plan_hash: null,
          retry_count: 0,
          next_retry_after: null,
          last_error: null,
        };
      }
    } else {
      // activePages.length === 0 with all 6 completeness checks passed
      const hadKnownPageId = entry.page_id !== undefined && entry.page_id !== null;
      if (hadKnownPageId && !confirmRemotePageDeleted) {
        reconciled = false;
        resolution = 'held_deleted_page_confirmation_required';
        nextEntry = {
          ...entry,
          state: 'receipt_uncertain',
          last_error: 'remote_page_deleted_requires_confirmation',
        };
      } else {
        resolution = hadKnownPageId ? 'confirmed_remote_deleted_pending_create' : 'confirmed_absent_pending_create';
        nextEntry = {
          database: entry.database,
          canonical_key: entry.canonical_key,
          state: 'pending_sync',
          page_id: null,
          last_synced_hash: null,
          attempted_hash: null,
          attempted_at: null,
          last_synced_at: entry.last_synced_at ?? null,
          operation_id: null,
          approved_plan_hash: null,
          retry_count: 0,
          next_retry_after: null,
          last_error: null,
        };
      }
    }

    const saved = persistNext(nextEntry);
    return {
      reconciled,
      state_key: stateKey,
      previous_state: entry.state,
      state: nextEntry.state,
      resolution,
      page_id: nextEntry.page_id ?? null,
      conflicting_page_ids: nextEntry.conflicting_page_ids ?? [],
      code: reconciled ? null : (nextEntry.last_error ?? null),
      errors: [],
      path: saved.path,
      sync_state: saved.state,
    };
  });
}

// D4: Separate explicit owner-confirmed reset for failed_permanent -> pending_sync.
// Never triggered automatically, never triggered by payload changes, never triggered by --force.
export function resetPermanentFailure(root, {
  database,
  canonicalKey,
  expectedLastError,
  resetReason,
  confirmedByOwner = false,
  nowIso = new Date().toISOString(),
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS,
  home = os.homedir(),
} = {}) {
  if (confirmedByOwner !== true) {
    throw new Error('resetPermanentFailure requires explicit confirmedByOwner === true.');
  }
  if (!isNonEmptyString(root)) {
    throw new Error('resetPermanentFailure requires a non-empty workspace root path.');
  }
  if (!TARGET_DATABASE_SET.has(database)) {
    throw new Error(`resetPermanentFailure: invalid database "${database}".`);
  }
  if (!isNonEmptyString(canonicalKey)) {
    throw new Error('resetPermanentFailure requires a non-empty canonicalKey.');
  }
  if (expectedLastError === undefined) {
    throw new Error('resetPermanentFailure requires explicit expectedLastError (string or null) matching the reviewed error.');
  }
  if (!isNonEmptyString(resetReason) || hasDisallowedLastErrorContent(resetReason)) {
    throw new Error('resetPermanentFailure requires a non-empty safe resetReason without secrets, emails, or local paths.');
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`resetPermanentFailure: invalid nowIso timestamp "${nowIso}".`);
  }

  return withSyncStateLock(root, { home, nowIso }, () => {
    const loaded = loadSyncState(root, { home });
    if (!loaded.exists) {
      throw new Error('resetPermanentFailure: logs/sync-state.json does not exist.');
    }
    const integrity = verifySyncStateIntegrity(loaded.state, { nowIso, maxFutureSkewMs });
    if (!integrity.valid) {
      throw new Error(`Sync-state integrity check failed: ${integrity.errors.join('; ')}`);
    }

    const stateKey = makeSyncStateKey(database, canonicalKey);
    const entry = loaded.state.records[stateKey];
    if (!entry || entry.state !== 'failed_permanent') {
      throw new Error(`resetPermanentFailure: "${stateKey}" is not in failed_permanent (current state: "${entry?.state ?? 'none'}").`);
    }
    const currentError = entry.last_error ?? null;
    if (currentError !== expectedLastError) {
      throw new Error(`resetPermanentFailure: expectedLastError "${expectedLastError}" does not match current last_error "${currentError}".`);
    }

    const nextEntry = {
      database: entry.database,
      canonical_key: entry.canonical_key,
      state: 'pending_sync',
      page_id: entry.page_id ?? null,
      last_synced_hash: entry.last_synced_hash ?? null,
      attempted_hash: null,
      attempted_at: null,
      last_synced_at: entry.last_synced_at ?? null,
      operation_id: null,
      approved_plan_hash: null,
      retry_count: 0,
      next_retry_after: null,
      last_error: null,
    };

    const nextStateDoc = {
      schema_version: '1.0',
      updated_at: nowIso,
      records: {
        ...loaded.state.records,
        [stateKey]: nextEntry,
      },
    };
    const nextIntegrity = verifySyncStateIntegrity(nextStateDoc, { nowIso, maxFutureSkewMs });
    if (!nextIntegrity.valid) {
      throw new Error(`Refusing to persist invalid post-reset sync state: ${nextIntegrity.errors.join('; ')}`);
    }

    const saved = saveSyncState(root, nextStateDoc, { home, nowIso });
    return {
      reset: true,
      state_key: stateKey,
      previous_state: 'failed_permanent',
      previous_error: currentError,
      state: 'pending_sync',
      page_id: nextEntry.page_id,
      reset_reason: resetReason.trim(),
      path: saved.path,
      sync_state: saved.state,
    };
  });
}

// ---------------- Stage 3 (T9): Thin CLI Command Adapter for `veycraft career sync` ----------------

function readGuardrailsSyncSettings(root, sourceRoot = null, { home = os.homedir() } = {}) {
  const workspaceConfig = path.join(root, 'config', 'guardrails.yaml');
  const fallbackConfig = sourceRoot ? path.join(sourceRoot, 'config', 'guardrails.yaml') : null;
  const workspaceExists = fs.existsSync(workspaceConfig);
  const found = workspaceExists
    ? workspaceConfig
    : (fallbackConfig && fs.existsSync(fallbackConfig) ? fallbackConfig : null);

  let dryRun = true;
  let notionMcpEnabled = false;
  let explicitDryRun = false;
  let explicitNotionMcp = false;
  let parseError = null;

  if (!found) {
    parseError = 'config/guardrails.yaml not found';
  } else {
    try {
      if (workspaceExists) {
        refuseSymlink(workspaceConfig, root, home);
      }
      const text = fs.readFileSync(found, 'utf8');
      if (!isNonEmptyString(text)) {
        parseError = 'config/guardrails.yaml is empty';
      } else {
        const dryMatches = [...text.matchAll(/^[ \t]*dry_run:[ \t]*([^\s#]+)[ \t]*(?:#.*)?$/gm)];
        if (dryMatches.length === 1 && (dryMatches[0][1] === 'true' || dryMatches[0][1] === 'false')) {
          explicitDryRun = true;
          dryRun = dryMatches[0][1] === 'true';
        } else if (dryMatches.length > 0) {
          parseError = 'malformed or duplicate dry_run setting in config/guardrails.yaml';
        }

        const adapterBlock = text.match(/^[ \t]*storage_adapters:[ \t]*(?:#.*)?\r?\n((?:[ \t]+.*\r?\n?)*)/m);
        if (adapterBlock) {
          const nmMatches = [...adapterBlock[1].matchAll(/^[ \t]+notion_mcp:[ \t]*([^\s#]+)[ \t]*(?:#.*)?$/gm)];
          if (nmMatches.length === 1 && (nmMatches[0][1] === 'true' || nmMatches[0][1] === 'false')) {
            explicitNotionMcp = true;
            notionMcpEnabled = nmMatches[0][1] === 'true';
          } else if (nmMatches.length > 0) {
            parseError = parseError || 'malformed or duplicate storage_adapters.notion_mcp setting in config/guardrails.yaml';
          }
        }
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    config_path: found,
    workspace_config_present: workspaceExists,
    dry_run: dryRun,
    notion_mcp_enabled: notionMcpEnabled,
    explicit_dry_run: explicitDryRun,
    explicit_notion_mcp: explicitNotionMcp,
    parse_error: parseError,
  };
}

function assertLiveSyncGuardrails(guardrails, subcommandLabel) {
  if (!guardrails || guardrails.parse_error) {
    throw new Error(`Refusing \`career sync ${subcommandLabel}\`: invalid or unreadable config/guardrails.yaml (${guardrails?.parse_error || 'missing'}).`);
  }
  if (!guardrails.explicit_notion_mcp || guardrails.notion_mcp_enabled !== true) {
    throw new Error(`Refusing \`career sync ${subcommandLabel}\`: config/guardrails.yaml has storage_adapters.notion_mcp: false (or unset).`);
  }
  if (!guardrails.explicit_dry_run || guardrails.dry_run !== false) {
    throw new Error(`Refusing \`career sync ${subcommandLabel}\`: config/guardrails.yaml has dry_run: true (or unset).`);
  }
}

function readSyncCliJsonFile(rawPath, { root, home }) {
  if (!isNonEmptyString(rawPath)) {
    throw new Error('JSON file path must be a non-empty string.');
  }
  const resolved = path.resolve(process.cwd(), rawPath);
  if (isWithinDir(resolved, root) || isWithinDir(resolved, home)) {
    refuseSymlink(resolved, root, home);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input JSON file not found: ${resolved}`);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${resolved}: ${err.message}`);
  }
}

function writeSyncCliJsonOut(rawOutPath, payload, { root, home }) {
  const resolved = path.resolve(root, rawOutPath);
  if (!isWithinDir(resolved, root)) {
    throw new Error(`Refusing --out path outside workspace root "${root}": ${resolved}`);
  }
  refuseSymlink(resolved, root, home);
  writeAtomic(resolved, JSON.stringify(payload, null, 2) + '\n', {
    mode: 0o600,
    boundary: root,
    home,
  });
  return resolved;
}

function parseScopedSyncFlags(rawArgs, { booleans = [], values = [] } = {}) {
  const boolSet = new Set(['--json', '--help', '-h', ...booleans]);
  const valSet = new Set(values);
  const parsed = { json: false, help: false };
  const extras = [];

  const toCamel = flag => flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i];
    if (tok === '--help' || tok === '-h') {
      parsed.help = true;
      continue;
    }
    if (tok === '--json') {
      parsed.json = true;
      continue;
    }
    if (boolSet.has(tok)) {
      parsed[toCamel(tok)] = true;
      continue;
    }
    const eqIdx = tok.indexOf('=');
    const flagName = eqIdx !== -1 ? tok.slice(0, eqIdx) : tok;
    if (valSet.has(flagName)) {
      let val;
      if (eqIdx !== -1) {
        val = tok.slice(eqIdx + 1);
      } else {
        val = rawArgs[++i];
      }
      if (val === undefined || val === '') {
        throw new Error(`Option ${flagName} requires a value.`);
      }
      parsed[toCamel(flagName)] = val;
      continue;
    }
    if (tok.startsWith('-')) {
      throw new Error(`Unsupported option "${tok}" for this \`veycraft career sync\` subcommand.`);
    }
    extras.push(tok);
  }
  if (extras.length > 0) {
    throw new Error(`Unexpected positional argument(s): ${extras.join(', ')}`);
  }
  return parsed;
}

export const CAREER_SYNC_SUBCOMMANDS = Object.freeze([
  'preview',
  'status',
  'verify-schema',
  'approve',
  'mark-in-flight',
  'apply-receipt',
  'record-failure',
  'expire-stale',
  'reconcile',
  'reset-permanent',
  'release-stale-lock',
]);

function formatCareerSyncHelp() {
  return [
    'Usage: veycraft career sync <subcommand> [options]',
    '',
    'Offline / Read-Only Subcommands (work even when storage_adapters.notion_mcp is false):',
    '  preview [--file <remote-index.json>] [--out <plan.json>] [--live] [--json]',
    '  status [--json]',
    '  verify-schema --database <applications|daily_runs|insights> --file <schema.json> [--json]',
    '',
    'Approval, Pre-Write Reservation & Lifecycle Subcommands (local state only; zero external writes):',
    '  approve --file <plan.json> --plan-hash <64hex> --confirm-approve [--out <approved.json>] [--json]',
    '  mark-in-flight --file <approved.json> --op <operation_id> [--force] [--json]',
    '  apply-receipt --database <db> --key <key> --op <op_id> --plan-hash <64hex> --file <receipt.json> [--database-id <uuid>] [--json]',
    '  record-failure --database <db> --key <key> --op <op_id> --plan-hash <64hex> --error-code <code> [--error-message <msg>] [--mutation-not-applied] [--json]',
    '  expire-stale [--timeout-minutes <n>] [--json]',
    '  reconcile --database <db> --key <key> --database-id <uuid> --file <snapshot.json> [--confirm-remote-deleted] [--json]',
    '  reset-permanent --database <db> --key <key> --expected-error <err|null> --reason <text> --confirm-reset [--json]',
    '  release-stale-lock --nonce <nonce> --confirm-unlock [--json]',
  ];
}

// Thin, transport-free CLI adapter dispatching `veycraft career sync <subcommand>` to T7/T8-A/T8-B/T8-C APIs.
export function runNotionSyncCli(root, argv = [], {
  home = os.homedir(),
  sourceRoot = null,
  loadInputs = null,
  nowIso = new Date().toISOString(),
} = {}) {
  const first = (argv[0] || '').toLowerCase();
  if (!first || first === 'help' || first === '--help' || first === '-h') {
    return {
      json: false,
      exitCode: 0,
      data: { subcommands: CAREER_SYNC_SUBCOMMANDS },
      lines: formatCareerSyncHelp(),
    };
  }

  const sub = first;
  const rest = argv.slice(1);
  const guardrails = readGuardrailsSyncSettings(root, sourceRoot, { home });

  if (sub === 'status') {
    const flags = parseScopedSyncFlags(rest);
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    const loaded = loadSyncState(root, { home });
    const recovery = inspectSyncStateRecovery(loaded.state, { nowIso });
    const lock = inspectSyncStateLock(root, { home, nowIso });
    const data = {
      root,
      sync_state_exists: loaded.exists,
      sync_state_path: loaded.path,
      guardrails: {
        dry_run: guardrails.dry_run,
        notion_mcp_enabled: guardrails.notion_mcp_enabled,
        parse_error: guardrails.parse_error ?? null,
      },
      lock,
      recovery,
    };
    const c = recovery.counts;
    const lines = [
      `Sync State File:     ${loaded.exists ? loaded.path : 'not created yet (clean local state)'}`,
      `Guardrails:          dry_run=${guardrails.dry_run ? 'ON' : 'OFF'} | storage_adapters.notion_mcp=${guardrails.notion_mcp_enabled ? 'ENABLED' : 'DISABLED (offline preview/status available)'}`,
      ...(guardrails.parse_error ? [`Guardrails Warning:  ${guardrails.parse_error}`] : []),
      `Lock Status:         ${lock.locked ? `LOCKED (pid=${lock.lock?.pid ?? 'corrupt'}, stale=${lock.stale}, owner_alive=${lock.owner_alive})` : 'unlocked'}`,
      `Records (${recovery.total_records}):         Healthy/Pending: ${c.healthy_or_pending} | Active In-Flight: ${c.active_in_flight} | Stale In-Flight: ${c.stale_in_flight} | Uncertain: ${c.receipt_uncertain} | Conflicts: ${c.conflict_duplicate_remote} | Retryable: ${c.failed_retryable_ready + c.failed_retryable_cooldown + c.failed_retryable_cap_reached} | Permanent: ${c.failed_permanent}`,
    ];
    return { json: flags.json, exitCode: 0, data, lines };
  }

  if (sub === 'verify-schema') {
    const flags = parseScopedSyncFlags(rest, { values: ['--database', '--file'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.database || !flags.file) {
      throw new Error('Usage: veycraft career sync verify-schema --database <applications|daily_runs|insights> --file <schema.json> [--json]');
    }
    const retrieved = readSyncCliJsonFile(flags.file, { root, home });
    const res = validateNotionDatabaseSchema(flags.database, retrieved);
    const lines = res.valid
      ? [`Schema "${flags.database}" verified (${Object.keys(NOTION_DATABASE_SCHEMAS[flags.database]).length} required properties matched, ${res.extra_properties.length} extra column(s) preserved).`]
      : [`Schema "${flags.database}" FAILED validation:`, ...res.errors.map(e => `  - ${e}`)];
    return { json: flags.json, exitCode: res.valid ? 0 : 1, data: res, lines };
  }

  if (sub === 'preview') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--live'], values: ['--file', '--out', '--plan-id'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (typeof loadInputs !== 'function') {
      throw new Error('career sync preview requires a workspace input loader.');
    }
    const wantLive = Boolean(flags.live);
    if (wantLive) {
      assertLiveSyncGuardrails(guardrails, 'preview --live');
    }
    const inputs = loadInputs(root, { home });
    const loadedState = loadSyncState(root, { home });
    const remoteIndex = flags.file ? readSyncCliJsonFile(flags.file, { root, home }) : null;
    const diff = computeNotionSyncDiff({
      applications: inputs.applications,
      dailyRuns: inputs.dailyRuns,
      insights: inputs.insights,
      allCvRegistry: inputs.cvRegistry,
      syncState: loadedState.exists ? loadedState.state : null,
      remoteIndex,
      planId: flags.planId || null,
      createdAt: nowIso,
      transportEnabled: wantLive,
      dryRun: !wantLive,
    });
    let writtenPath = null;
    if (flags.out) {
      writtenPath = writeSyncCliJsonOut(flags.out, diff.plan, { root, home });
    }
    const s = diff.summary;
    const data = {
      ...diff,
      guardrails: {
        dry_run: guardrails.dry_run,
        notion_mcp_enabled: guardrails.notion_mcp_enabled,
      },
      written_path: writtenPath,
    };
    const lines = [
      `Plan ID:             ${diff.plan.plan_id} (${wantLive ? 'live-eligible preview' : 'offline dry-run preview'})`,
      `Plan Hash:           ${diff.plan.plan_hash}`,
      `Operations:          Create: ${s.create} | Update: ${s.update} | Skip Unchanged: ${s.skip_unchanged}`,
      `Safeguards:          Blocked Privacy: ${s.blocked_privacy} | Skipped Ineligible: ${s.skipped_ineligible} | Held: ${s.held}`,
      ...(writtenPath ? [`Saved Preview Plan:  ${writtenPath}`] : []),
    ];
    return { json: flags.json, exitCode: 0, data, lines };
  }

  if (sub === 'approve') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--confirm-approve'], values: ['--file', '--plan-hash', '--out'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.file || !flags.planHash) {
      throw new Error('Usage: veycraft career sync approve --file <plan.json> --plan-hash <64hex> --confirm-approve [--out <approved.json>] [--json]');
    }
    assertLiveSyncGuardrails(guardrails, 'approve');
    const previewPlan = readSyncCliJsonFile(flags.file, { root, home });
    const approvedPlan = approveNotionSyncPlan(previewPlan, {
      expectedPlanHash: flags.planHash,
      confirmedByOwner: Boolean(flags.confirmApprove),
      approvedAt: nowIso,
    });
    let writtenPath = null;
    if (flags.out) {
      writtenPath = writeSyncCliJsonOut(flags.out, approvedPlan, { root, home });
    }
    const data = { approved: true, plan: approvedPlan, written_path: writtenPath };
    const lines = [
      `Approved Plan:       ${approvedPlan.plan_id} (${approvedPlan.operations.length} operation(s))`,
      `Approved Plan Hash:  ${approvedPlan.plan_hash}`,
      ...(writtenPath ? [`Saved Approved Plan: ${writtenPath}`] : []),
    ];
    return { json: flags.json, exitCode: 0, data, lines };
  }

  if (sub === 'mark-in-flight') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--force'], values: ['--file', '--op'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.file || !flags.op) {
      throw new Error('Usage: veycraft career sync mark-in-flight --file <approved-plan.json> --op <operation_id> [--force] [--json]');
    }
    assertLiveSyncGuardrails(guardrails, 'mark-in-flight');
    const approvedPlan = readSyncCliJsonFile(flags.file, { root, home });
    const res = reserveOperationInFlight(root, {
      approvedPlan,
      operationId: flags.op,
      nowIso,
      force: Boolean(flags.force),
      home,
    });
    const lines = [
      `Reserved In-Flight:  ${res.state_key} (${res.action}, op=${res.operation_id})`,
      `Sync State Path:     ${res.path}`,
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  if (sub === 'apply-receipt') {
    const flags = parseScopedSyncFlags(rest, { values: ['--database', '--key', '--op', '--plan-hash', '--file', '--database-id'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.database || !flags.key || !flags.op || !flags.planHash || !flags.file) {
      throw new Error('Usage: veycraft career sync apply-receipt --database <db> --key <key> --op <op_id> --plan-hash <64hex> --file <receipt.json> [--database-id <uuid>] [--json]');
    }
    const receipt = readSyncCliJsonFile(flags.file, { root, home });
    const res = applySyncReceipt(root, {
      database: flags.database,
      canonicalKey: flags.key,
      operationId: flags.op,
      approvedPlanHash: flags.planHash,
      receipt,
      expectedDatabaseId: flags.databaseId || null,
      nowIso,
      home,
    });
    const lines = res.applied
      ? [`Receipt Verified:    ${res.state_key} -> synced (page_id=${res.page_id})`, `Trust Note:          ${res.trust_note}`]
      : [`Receipt Held:        ${res.state_key} -> ${res.state} (${res.code || 'verification_failed'})`];
    return { json: flags.json, exitCode: res.applied ? 0 : 1, data: res, lines };
  }

  if (sub === 'record-failure') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--mutation-not-applied'], values: ['--database', '--key', '--op', '--plan-hash', '--error-code', '--error-message'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.database || !flags.key || !flags.op || !flags.planHash || !flags.errorCode) {
      throw new Error('Usage: veycraft career sync record-failure --database <db> --key <key> --op <op_id> --plan-hash <64hex> --error-code <code> [--error-message <msg>] [--mutation-not-applied] [--json]');
    }
    const res = recordSyncFailure(root, {
      database: flags.database,
      canonicalKey: flags.key,
      operationId: flags.op,
      approvedPlanHash: flags.planHash,
      errorCode: flags.errorCode,
      errorMessage: flags.errorMessage || null,
      mutationNotApplied: Boolean(flags.mutationNotApplied),
      nowIso,
      home,
    });
    const lines = [
      `Recorded Failure:    ${res.state_key} -> ${res.state} (${res.classification}, retries=${res.retry_count})`,
      ...(res.next_retry_after ? [`Next Retry After:    ${res.next_retry_after}`] : []),
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  if (sub === 'expire-stale') {
    const flags = parseScopedSyncFlags(rest, { values: ['--timeout-minutes'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    let staleTimeoutMs = DEFAULT_STALE_IN_FLIGHT_TIMEOUT_MS;
    if (flags.timeoutMinutes !== undefined) {
      const mins = Number(flags.timeoutMinutes);
      if (!Number.isSafeInteger(mins) || mins < 1) {
        throw new Error('--timeout-minutes must be a positive integer.');
      }
      staleTimeoutMs = mins * 60 * 1000;
    }
    const res = expireStaleInFlightRecords(root, { nowIso, staleTimeoutMs, home });
    const lines = [
      `Expired Stale Ops:   ${res.expired_count} record(s) moved to receipt_uncertain`,
      ...(res.expired_keys.length > 0 ? [`Expired Keys:        ${res.expired_keys.join(', ')}`] : []),
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  if (sub === 'reconcile') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--confirm-remote-deleted'], values: ['--database', '--key', '--database-id', '--file'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.database || !flags.key || !flags.databaseId || !flags.file) {
      throw new Error('Usage: veycraft career sync reconcile --database <db> --key <key> --database-id <uuid> --file <snapshot.json> [--confirm-remote-deleted] [--json]');
    }
    const snapshot = readSyncCliJsonFile(flags.file, { root, home });
    const res = reconcileSyncRecord(root, {
      database: flags.database,
      canonicalKey: flags.key,
      expectedDatabaseId: flags.databaseId,
      querySnapshot: snapshot,
      confirmRemotePageDeleted: Boolean(flags.confirmRemoteDeleted),
      nowIso,
      home,
    });
    const lines = [
      `Reconciliation:      ${res.state_key} -> ${res.state} (${res.resolution})`,
    ];
    return { json: flags.json, exitCode: res.reconciled ? 0 : 1, data: res, lines };
  }

  if (sub === 'reset-permanent') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--confirm-reset'], values: ['--database', '--key', '--expected-error', '--reason'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.database || !flags.key || flags.expectedError === undefined || !flags.reason) {
      throw new Error('Usage: veycraft career sync reset-permanent --database <db> --key <key> --expected-error <err|null> --reason <text> --confirm-reset [--json]');
    }
    const expectedLastError = flags.expectedError === 'null' ? null : flags.expectedError;
    const res = resetPermanentFailure(root, {
      database: flags.database,
      canonicalKey: flags.key,
      expectedLastError,
      resetReason: flags.reason,
      confirmedByOwner: Boolean(flags.confirmReset),
      nowIso,
      home,
    });
    const lines = [
      `Reset Permanent:     ${res.state_key} -> ${res.state} (cleared: ${res.previous_error ?? 'null'})`,
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  if (sub === 'release-stale-lock') {
    const flags = parseScopedSyncFlags(rest, { booleans: ['--confirm-unlock'], values: ['--nonce'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerSyncHelp() };
    if (!flags.nonce) {
      throw new Error('Usage: veycraft career sync release-stale-lock --nonce <nonce> --confirm-unlock [--json]');
    }
    const res = releaseStaleSyncStateLock(root, {
      home,
      nowIso,
      expectedNonce: flags.nonce,
      confirmedExplicitRecovery: Boolean(flags.confirmUnlock),
    });
    const lines = [
      `Released Stale Lock: ${res.path} (dead PID=${res.released_pid})`,
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  throw new Error(`Unknown career sync subcommand "${sub}". Supported: ${CAREER_SYNC_SUBCOMMANDS.join(', ')}.`);
}
