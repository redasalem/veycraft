// Zero-dependency Career Intelligence core ledger validator, normalizer,
// CV version registry, and backup-first idempotent migration engine.
// Uses Node.js built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { isObj, refuseSymlink, writeAtomic } from './fs-safety.mjs';

export const MIN_SAMPLE_SIZE = 5;

export const CANONICAL_STATUSES = Object.freeze([
  'discovered',
  'prepared',
  'dry_run',
  'skipped',
  'needs_review',
  'failed',
  'aborted',
  'applied',
  'interview',
  'assessment',
  'offer',
  'rejected',
  'withdrawn',
]);

export const SUBMITTED_STATUSES = Object.freeze([
  'applied',
  'interview',
  'assessment',
  'offer',
  'rejected',
  'withdrawn',
]);

export const LEGACY_STATUS_MAP = Object.freeze({
  new: 'discovered',
  scanned: 'discovered',
  ready: 'prepared',
  tailored: 'prepared',
  'dry-run': 'dry_run',
  filtered: 'skipped',
  ghost: 'skipped',
  blacklisted: 'skipped',
  pending_review: 'needs_review',
  manual_apply: 'needs_review',
  error: 'failed',
  stopped: 'aborted',
  submitted: 'applied',
  interviewing: 'interview',
  screen: 'interview',
  responded: 'interview',
  phone_screen: 'interview',
  take_home: 'assessment',
  challenge: 'assessment',
  coding_test: 'assessment',
  hired: 'offer',
  accepted: 'offer',
  offer_received: 'offer',
  declined: 'rejected',
  closed: 'rejected',
  withdraw: 'withdrawn',
});

const CANONICAL_STATUS_SET = new Set(CANONICAL_STATUSES);
const SUBMITTED_STATUS_SET = new Set(SUBMITTED_STATUSES);
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const APP_ID_RE = /^app_[a-f0-9]{12}$/;
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}$/;
// Matches documented skills/meta-self-verification.md receipt quote format only:
// `receipt: "<quoted text>"` at start of notes or after a `|` delimiter.
const VERIFIED_RECEIPT_RE = /(?:^|\|\s*)receipt:\s*"[^"\r\n]{3,}"/i;
const INSIGHTS_INTELLIGENCE_KEYS = new Set([
  'deterministic_facts', 'sample_sufficiency', 'ai_interpretations', 'hypotheses', 'recommended_actions',
]);
const SAMPLE_SUFFICIENCY_KEYS = new Set(['submitted_n', 'decided_n', 'min_threshold', 'sufficient']);
const AI_STATEMENT_KEYS = new Set(['claim', 'evidence_refs', 'confidence']);
const AI_CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);

const SOURCE_CHANNELS = new Set([
  'job_board', 'direct_ats', 'b2b_network', 'referral',
  'company_site', 'recruiter_inbound', 'email_direct', 'other',
]);
const WORK_MODES = new Set(['remote', 'hybrid', 'onsite', 'unknown']);
const EMPLOYMENT_TYPES = new Set(['full_time', 'contract', 'b2b', 'part_time', 'internship', 'unknown']);
const APPLY_TYPES = new Set(['easy_apply', 'external', 'manual_apply']);
const STAGE_EVENT_SOURCES = new Set([
  'discovery', 'preparation', 'ats_submission_receipt', 'owner_manual_update',
  'recruiter_inbox_triage', 'follow_up_radar', 'email_intelligence_approved', 'migration_backfill',
]);
const INTERVIEW_STAGES = new Set([
  'recruiter_screen', 'hiring_manager', 'technical_screen', 'system_design',
  'live_coding', 'panel', 'culture_bar_raiser', 'executive', 'final', 'other',
]);
const INTERVIEW_STATUSES = new Set(['invited', 'scheduled', 'completed', 'rescheduled', 'cancelled', 'no_show']);
const INTERVIEW_OUTCOMES = new Set(['pending', 'passed', 'failed', 'withdrew', 'unknown']);
const ASSESSMENT_TYPES = new Set([
  'take_home', 'coding_challenge', 'system_design_doc', 'case_study',
  'live_pair', 'questionnaire', 'other',
]);
const ASSESSMENT_STATUSES = new Set(['assigned', 'in_progress', 'submitted', 'expired', 'declined']);
const ASSESSMENT_OUTCOMES = new Set(['pending', 'passed', 'failed', 'no_feedback', 'unknown']);
const FOLLOW_UP_STATUSES = new Set(['not_needed', 'pending', 'overdue', 'drafted', 'sent', 'closed']);
const NOTION_SYNC_STATES = new Set([
  'ineligible_not_submitted', 'pending_sync', 'blocked_privacy', 'previewed',
  'in_flight', 'synced', 'failed_retryable', 'conflict_duplicate_remote', 'receipt_uncertain',
]);

const CV_TAILORING_KEYS = new Set([
  'is_tailored', 'base_cv_version_id', 'ats_keyword_before_pct',
  'ats_keyword_after_pct', 'tailored_folder_rel', 'tailoring_notes_rel',
]);
const STAGE_EVENT_KEYS = new Set(['event_id', 'from_status', 'to_status', 'at', 'source', 'verified', 'notes']);
const INTERVIEW_KEYS = new Set([
  'interview_id', 'round', 'stage', 'scheduled_at', 'timezone',
  'status', 'outcome', 'dossier_rel', 'notes',
]);
const ASSESSMENT_KEYS = new Set([
  'assessment_id', 'type', 'received_at', 'due_at', 'submitted_at',
  'status', 'outcome', 'blueprint_rel', 'notes',
]);
const FOLLOW_UP_KEYS = new Set(['next_due_at', 'last_followed_up_at', 'follow_up_count', 'status', 'draft_rel']);
const PROVENANCE_KEYS = new Set([
  'created_by', 'created_at', 'last_updated_by', 'receipt_verified',
  'third_party_subject', 'email_message_id',
]);
const NOTION_SYNC_KEYS = new Set(['state', 'page_id', 'last_synced_at', 'last_synced_hash', 'retry_count', 'last_error']);
const CV_REGISTRY_KEYS = new Set(['schema_version', 'updated_at', 'versions']);
const CV_VERSION_KEYS = new Set([
  'cv_version_id', 'version_number', 'label', 'kind', 'owner_scope',
  'base_cv_version_id', 'content_sha256', 'persona_id', 'language',
  'created_at', 'updated_at', 'local_ref_rel', 'tailoring_metadata',
  'ats_metrics', 'application_ids',
]);
const CV_TAILORING_META_KEYS = new Set(['target_job_id', 'target_role', 'emphasized_skills', 'true_gaps_excluded']);
const CV_ATS_METRICS_KEYS = new Set(['keyword_match_before_pct', 'keyword_match_after_pct', 'hygiene_score', 'page_count']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNullableString(v) {
  return v === undefined || v === null || typeof v === 'string';
}

function isValidIsoDateTime(v) {
  return typeof v === 'string' && ISO_DATETIME_RE.test(v) && !Number.isNaN(Date.parse(v));
}

function slugifySegment(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function checkAllowedKeys(obj, allowed, prefix, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      errors.push(`${prefix}: unexpected property "${k}".`);
    }
  }
}

export function isUsableJobId(jobId) {
  return typeof jobId === 'string' && jobId.trim().length > 0;
}

export function normalizeJobIdKey(jobId) {
  if (!isUsableJobId(jobId)) {
    throw new Error('Cannot normalize unusable or missing job_id.');
  }
  return jobId.trim().toLowerCase();
}

export function computeApplicationId(jobId) {
  const normalized = normalizeJobIdKey(jobId);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
  return `app_${digest}`;
}

// Strictly a secondary deduplication signal — NEVER a primary identity or merge key.
export function computeCanonicalFingerprint(company, title) {
  const c = slugifySegment(company);
  const t = slugifySegment(title);
  if (!c || !t) return null;
  return `${c}::${t}`;
}

export function normalizeStatus(rawStatus) {
  if (!isNonEmptyString(rawStatus)) {
    return { canonical: null, legacyStatus: null, valid: false };
  }
  const trimmed = rawStatus.trim();
  const lower = trimmed.toLowerCase();
  if (CANONICAL_STATUS_SET.has(lower)) {
    return {
      canonical: lower,
      legacyStatus: trimmed !== lower ? trimmed : null,
      valid: true,
    };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS_MAP, lower)) {
    return {
      canonical: LEGACY_STATUS_MAP[lower],
      legacyStatus: trimmed,
      valid: true,
    };
  }
  return { canonical: null, legacyStatus: trimmed, valid: false };
}

export function checkUniqueUsableJobIds(records) {
  const errors = [];
  if (!Array.isArray(records)) {
    return { valid: false, errors: ['Application ledger root must be a JSON array.'] };
  }
  const seen = new Map();
  records.forEach((rec, idx) => {
    if (!isObj(rec)) {
      errors.push(`records[${idx}]: entry must be a JSON object.`);
      return;
    }
    if (!isUsableJobId(rec.job_id)) {
      errors.push(`records[${idx}]: missing or empty job_id; aborting rather than guessing or fabricating an ID.`);
      return;
    }
    const key = normalizeJobIdKey(rec.job_id);
    if (seen.has(key)) {
      errors.push(
        `records[${idx}]: duplicate job_id "${rec.job_id}" (collides with records[${seen.get(key)}]); aborting rather than silently merging.`,
      );
      return;
    }
    seen.set(key, idx);
  });
  return { valid: errors.length === 0, errors };
}

export function normalizeApplicationRecord(raw) {
  if (!isObj(raw)) {
    throw new Error('Application record must be a JSON object.');
  }
  if (!isUsableJobId(raw.job_id)) {
    throw new Error('Application record is missing a usable job_id.');
  }
  const statusInfo = normalizeStatus(raw.status);
  if (!statusInfo.valid) {
    throw new Error(`Application "${raw.job_id}" has unrecognized status "${raw.status}".`);
  }

  // M1: Refuse to silently overwrite malformed legacy fields
  for (const arrField of ['stage_history', 'interviews', 'assessments']) {
    if (raw[arrField] !== undefined && !Array.isArray(raw[arrField])) {
      throw new Error(`Application "${raw.job_id}" has malformed non-array "${arrField}"; refusing to silently overwrite.`);
    }
  }
  for (const objField of ['provenance', 'notion_sync']) {
    if (raw[objField] !== undefined && !isObj(raw[objField])) {
      throw new Error(`Application "${raw.job_id}" has malformed non-object "${objField}"; refusing to silently overwrite.`);
    }
  }
  for (const optObjField of ['cv_tailoring', 'follow_up']) {
    if (raw[optObjField] !== undefined && raw[optObjField] !== null && !isObj(raw[optObjField])) {
      throw new Error(`Application "${raw.job_id}" has malformed "${optObjField}"; expected object or null.`);
    }
  }

  // H3: Reject invalid or backward timestamps before backfilling history
  for (const dtKey of ['discovered_at', 'applied_at', 'updated_at']) {
    if (raw[dtKey] !== undefined && raw[dtKey] !== null && !isValidIsoDateTime(raw[dtKey])) {
      throw new Error(`Application "${raw.job_id}" has invalid ${dtKey} timestamp "${raw[dtKey]}"; expected ISO-8601 date-time or null.`);
    }
  }
  const hasAppliedAt = isValidIsoDateTime(raw.applied_at);
  const hasUpdatedAt = isValidIsoDateTime(raw.updated_at);
  if (hasAppliedAt && hasUpdatedAt && Date.parse(raw.updated_at) < Date.parse(raw.applied_at)) {
    throw new Error(`Application "${raw.job_id}" has backward timestamps: updated_at (${raw.updated_at}) precedes applied_at (${raw.applied_at}).`);
  }

  const canonicalStatus = statusInfo.canonical;
  const applicationId = computeApplicationId(raw.job_id);
  const titleText = typeof raw.title === 'string' && raw.title.trim() ? raw.title : (typeof raw.role === 'string' ? raw.role : '');
  const fingerprint = raw.canonical_fingerprint !== undefined
    ? raw.canonical_fingerprint
    : computeCanonicalFingerprint(raw.company, titleText);

  const notesStr = typeof raw.notes === 'string' ? raw.notes : '';
  const isSubmittedEligible = SUBMITTED_STATUS_SET.has(canonicalStatus) && raw.submission_uncertain !== true;
  // H2: Only treat receipt as verified when status is submitted-eligible AND notes match documented meta-self-verification quote format
  const hasVerifiedReceipt = isSubmittedEligible && VERIFIED_RECEIPT_RE.test(notesStr);

  let stageHistory;
  if (raw.stage_history !== undefined) {
    stageHistory = raw.stage_history;
  } else {
    stageHistory = [];
    // H2: Only backfill applied event for submitted-eligible records (never dry_run/prepared/needs_review/submission_uncertain)
    if (isSubmittedEligible && hasAppliedAt) {
      stageHistory.push({
        event_id: 'evt_mig_applied',
        from_status: null,
        to_status: 'applied',
        at: raw.applied_at,
        source: 'migration_backfill',
        verified: hasVerifiedReceipt,
        notes: '',
      });
    }
    // H3: Backfill post-apply status transition ONLY if strictly later than applied_at (skip identical timestamps); never fabricate predecessor
    if (
      canonicalStatus !== 'applied' &&
      isSubmittedEligible &&
      hasUpdatedAt &&
      (!hasAppliedAt || Date.parse(raw.updated_at) > Date.parse(raw.applied_at))
    ) {
      stageHistory.push({
        event_id: 'evt_mig_status',
        from_status: null,
        to_status: canonicalStatus,
        at: raw.updated_at,
        source: 'migration_backfill',
        verified: false,
        notes: '',
      });
    }
  }

  const provenance = raw.provenance !== undefined
    ? raw.provenance
    : {
        created_by: 'legacy_migration',
        created_at: isValidIsoDateTime(raw.discovered_at)
          ? raw.discovered_at
          : (hasAppliedAt ? raw.applied_at : null),
        last_updated_by: null,
        receipt_verified: hasVerifiedReceipt,
        third_party_subject: false,
      };

  let notionSync;
  if (raw.notion_sync !== undefined) {
    notionSync = raw.notion_sync;
  } else {
    const existingPageId = isNonEmptyString(raw.notion_page_id) ? raw.notion_page_id.trim() : null;
    let initialState = 'ineligible_not_submitted';
    if (isSubmittedEligible && provenance.third_party_subject !== true) {
      initialState = (raw.notion_synced === true && existingPageId) ? 'synced' : 'pending_sync';
    }
    notionSync = {
      state: initialState,
      page_id: existingPageId,
      last_synced_at: null,
      last_synced_hash: null,
      retry_count: 0,
      last_error: null,
    };
  }

  // L1: Preserve existing non-empty legacy_status; if null/undefined, capture newly remapped legacy alias
  const legacyStatus = isNonEmptyString(raw.legacy_status)
    ? raw.legacy_status
    : statusInfo.legacyStatus;

  const enriched = {
    ...raw,
    schema_version: '2.0',
    application_id: applicationId,
    canonical_fingerprint: fingerprint,
    status: canonicalStatus,
    legacy_status: legacyStatus,
    cv_version_id: raw.cv_version_id !== undefined ? raw.cv_version_id : null,
    cv_tailoring: raw.cv_tailoring !== undefined ? raw.cv_tailoring : null,
    stage_history: stageHistory,
    interviews: raw.interviews !== undefined ? raw.interviews : [],
    assessments: raw.assessments !== undefined ? raw.assessments : [],
    follow_up: raw.follow_up !== undefined ? raw.follow_up : null,
    provenance,
    notion_page_id: raw.notion_page_id !== undefined ? raw.notion_page_id : (notionSync.page_id ?? null),
    notion_sync: notionSync,
  };

  return enriched;
}

export function validateApplicationLedger(records) {
  const errors = [];
  const warnings = [];

  const idCheck = checkUniqueUsableJobIds(records);
  if (!idCheck.valid) {
    return { valid: false, errors: idCheck.errors, warnings };
  }

  const seenAppIds = new Map();

  records.forEach((rec, idx) => {
    const label = `records[${idx}] (${rec.job_id})`;

    if (rec.schema_version !== undefined && rec.schema_version !== '2.0') {
      errors.push(`${label}: schema_version must be "2.0" when provided.`);
    }

    if (rec.schema_version === '2.0' && rec.application_id === undefined) {
      errors.push(`${label}: schema_version "2.0" requires application_id.`);
    }

    if (rec.application_id !== undefined) {
      if (typeof rec.application_id !== 'string' || !APP_ID_RE.test(rec.application_id)) {
        errors.push(`${label}: application_id must match ^app_[a-f0-9]{12}$.`);
      } else {
        const expected = computeApplicationId(rec.job_id);
        if (rec.application_id !== expected) {
          errors.push(`${label}: application_id "${rec.application_id}" does not match deterministic ID "${expected}" for job_id.`);
        }
        if (seenAppIds.has(rec.application_id)) {
          errors.push(`${label}: duplicate application_id "${rec.application_id}".`);
        }
        seenAppIds.set(rec.application_id, idx);
      }
    }

    for (const strKey of [
      'canonical_fingerprint', 'title', 'role', 'company', 'platform', 'url',
      'location', 'verified_at', 'date', 'run_id', 'legacy_status', 'persona_id',
      'cv_version_id', 'screenshot', 'notes', 'notion_page_id',
    ]) {
      if (!isNullableString(rec[strKey])) {
        errors.push(`${label}: ${strKey} must be a string or null.`);
      }
    }

    const statusInfo = normalizeStatus(rec.status);
    if (!statusInfo.valid) {
      errors.push(`${label}: unrecognized status "${rec.status}".`);
    } else if (rec.schema_version === '2.0' && !CANONICAL_STATUS_SET.has(rec.status)) {
      errors.push(`${label}: schema_version "2.0" requires canonical lowercase status (got "${rec.status}").`);
    }

    if (rec.source_channel !== undefined && rec.source_channel !== null && !SOURCE_CHANNELS.has(rec.source_channel)) {
      errors.push(`${label}: invalid source_channel "${rec.source_channel}".`);
    }
    if (rec.work_mode !== undefined && rec.work_mode !== null && !WORK_MODES.has(rec.work_mode)) {
      errors.push(`${label}: invalid work_mode "${rec.work_mode}".`);
    }
    if (rec.employment_type !== undefined && rec.employment_type !== null && !EMPLOYMENT_TYPES.has(rec.employment_type)) {
      errors.push(`${label}: invalid employment_type "${rec.employment_type}".`);
    }
    if (rec.apply_type !== undefined && rec.apply_type !== null && !APPLY_TYPES.has(rec.apply_type)) {
      errors.push(`${label}: invalid apply_type "${rec.apply_type}".`);
    }

    for (const dtKey of ['discovered_at', 'applied_at', 'updated_at']) {
      if (rec[dtKey] !== undefined && rec[dtKey] !== null && !isValidIsoDateTime(rec[dtKey])) {
        errors.push(`${label}: ${dtKey} must be a valid ISO-8601 date-time or null.`);
      }
    }
    if (isValidIsoDateTime(rec.applied_at) && isValidIsoDateTime(rec.updated_at) && Date.parse(rec.updated_at) < Date.parse(rec.applied_at)) {
      errors.push(`${label}: updated_at (${rec.updated_at}) precedes applied_at (${rec.applied_at}).`);
    }

    if (rec.match_score !== undefined && rec.match_score !== null) {
      if (typeof rec.match_score !== 'number' || !Number.isFinite(rec.match_score) || rec.match_score < 0 || rec.match_score > 10) {
        errors.push(`${label}: match_score must be a number between 0 and 10 (or null).`);
      }
    }

    for (const arrKey of ['matched_skills', 'missing_skills']) {
      if (rec[arrKey] !== undefined && (!Array.isArray(rec[arrKey]) || rec[arrKey].some(s => typeof s !== 'string'))) {
        errors.push(`${label}: ${arrKey} must be an array of strings.`);
      }
    }
    if (rec.open_questions !== undefined) {
      if (!Array.isArray(rec.open_questions) || rec.open_questions.some(q => typeof q !== 'string' && !(isObj(q) && isNonEmptyString(q.question)))) {
        errors.push(`${label}: open_questions must be an array of strings or { question } objects.`);
      }
    }

    if (rec.submission_uncertain !== undefined && typeof rec.submission_uncertain !== 'boolean') {
      errors.push(`${label}: submission_uncertain must be a boolean.`);
    }
    if (rec.notion_synced !== undefined && typeof rec.notion_synced !== 'boolean') {
      errors.push(`${label}: notion_synced must be a boolean.`);
    }

    if (rec.cv_tailoring !== undefined && rec.cv_tailoring !== null) {
      if (!isObj(rec.cv_tailoring)) {
        errors.push(`${label}: cv_tailoring must be an object or null.`);
      } else {
        checkAllowedKeys(rec.cv_tailoring, CV_TAILORING_KEYS, `${label}.cv_tailoring`, errors);
        if (typeof rec.cv_tailoring.is_tailored !== 'boolean') {
          errors.push(`${label}.cv_tailoring.is_tailored must be a boolean.`);
        }
        for (const sKey of ['base_cv_version_id', 'tailored_folder_rel', 'tailoring_notes_rel']) {
          if (!isNullableString(rec.cv_tailoring[sKey])) {
            errors.push(`${label}.cv_tailoring.${sKey} must be a string or null.`);
          }
        }
        for (const pctKey of ['ats_keyword_before_pct', 'ats_keyword_after_pct']) {
          const val = rec.cv_tailoring[pctKey];
          if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100)) {
            errors.push(`${label}.cv_tailoring.${pctKey} must be 0..100 or null.`);
          }
        }
      }
    }

    if (rec.stage_history !== undefined) {
      if (!Array.isArray(rec.stage_history)) {
        errors.push(`${label}: stage_history must be an array.`);
      } else {
        rec.stage_history.forEach((ev, eIdx) => {
          const evLabel = `${label}.stage_history[${eIdx}]`;
          if (!isObj(ev)) {
            errors.push(`${evLabel} must be an object.`);
            return;
          }
          checkAllowedKeys(ev, STAGE_EVENT_KEYS, evLabel, errors);
          if (!isNonEmptyString(ev.event_id)) errors.push(`${evLabel}.event_id must be a non-empty string.`);
          if (ev.from_status !== null && !CANONICAL_STATUS_SET.has(ev.from_status)) {
            errors.push(`${evLabel}.from_status must be a canonical status or null.`);
          }
          if (!CANONICAL_STATUS_SET.has(ev.to_status)) {
            errors.push(`${evLabel}.to_status must be a canonical status.`);
          }
          if (!isValidIsoDateTime(ev.at)) errors.push(`${evLabel}.at must be a valid ISO-8601 date-time.`);
          if (!STAGE_EVENT_SOURCES.has(ev.source)) errors.push(`${evLabel}.source "${ev.source}" is invalid.`);
          if (typeof ev.verified !== 'boolean') errors.push(`${evLabel}.verified must be a boolean.`);
          if (ev.notes !== undefined && typeof ev.notes !== 'string') errors.push(`${evLabel}.notes must be a string.`);
        });
      }
    }

    if (rec.interviews !== undefined) {
      if (!Array.isArray(rec.interviews)) {
        errors.push(`${label}: interviews must be an array.`);
      } else {
        rec.interviews.forEach((iv, iIdx) => {
          const ivLabel = `${label}.interviews[${iIdx}]`;
          if (!isObj(iv)) {
            errors.push(`${ivLabel} must be an object.`);
            return;
          }
          checkAllowedKeys(iv, INTERVIEW_KEYS, ivLabel, errors);
          if (!isNonEmptyString(iv.interview_id)) errors.push(`${ivLabel}.interview_id must be a non-empty string.`);
          if (!Number.isInteger(iv.round) || iv.round < 1) errors.push(`${ivLabel}.round must be an integer >= 1.`);
          if (!INTERVIEW_STAGES.has(iv.stage)) errors.push(`${ivLabel}.stage "${iv.stage}" is invalid.`);
          if (iv.scheduled_at !== undefined && iv.scheduled_at !== null && !isValidIsoDateTime(iv.scheduled_at)) {
            errors.push(`${ivLabel}.scheduled_at must be a valid ISO-8601 date-time or null.`);
          }
          if (!isNullableString(iv.timezone)) errors.push(`${ivLabel}.timezone must be a string or null.`);
          if (!isNullableString(iv.dossier_rel)) errors.push(`${ivLabel}.dossier_rel must be a string or null.`);
          if (iv.notes !== undefined && typeof iv.notes !== 'string') errors.push(`${ivLabel}.notes must be a string.`);
          if (!INTERVIEW_STATUSES.has(iv.status)) errors.push(`${ivLabel}.status "${iv.status}" is invalid.`);
          if (!INTERVIEW_OUTCOMES.has(iv.outcome)) errors.push(`${ivLabel}.outcome "${iv.outcome}" is invalid.`);
        });
      }
    }

    if (rec.assessments !== undefined) {
      if (!Array.isArray(rec.assessments)) {
        errors.push(`${label}: assessments must be an array.`);
      } else {
        rec.assessments.forEach((asmt, aIdx) => {
          const aLabel = `${label}.assessments[${aIdx}]`;
          if (!isObj(asmt)) {
            errors.push(`${aLabel} must be an object.`);
            return;
          }
          checkAllowedKeys(asmt, ASSESSMENT_KEYS, aLabel, errors);
          if (!isNonEmptyString(asmt.assessment_id)) errors.push(`${aLabel}.assessment_id must be a non-empty string.`);
          if (!ASSESSMENT_TYPES.has(asmt.type)) errors.push(`${aLabel}.type "${asmt.type}" is invalid.`);
          for (const dtKey of ['received_at', 'due_at', 'submitted_at']) {
            if (asmt[dtKey] !== undefined && asmt[dtKey] !== null && !isValidIsoDateTime(asmt[dtKey])) {
              errors.push(`${aLabel}.${dtKey} must be a valid ISO-8601 date-time or null.`);
            }
          }
          if (!isNullableString(asmt.blueprint_rel)) errors.push(`${aLabel}.blueprint_rel must be a string or null.`);
          if (asmt.notes !== undefined && typeof asmt.notes !== 'string') errors.push(`${aLabel}.notes must be a string.`);
          if (!ASSESSMENT_STATUSES.has(asmt.status)) errors.push(`${aLabel}.status "${asmt.status}" is invalid.`);
          if (!ASSESSMENT_OUTCOMES.has(asmt.outcome)) errors.push(`${aLabel}.outcome "${asmt.outcome}" is invalid.`);
        });
      }
    }

    if (rec.follow_up !== undefined && rec.follow_up !== null) {
      if (!isObj(rec.follow_up)) {
        errors.push(`${label}: follow_up must be an object or null.`);
      } else {
        checkAllowedKeys(rec.follow_up, FOLLOW_UP_KEYS, `${label}.follow_up`, errors);
        if (!Number.isInteger(rec.follow_up.follow_up_count) || rec.follow_up.follow_up_count < 0) {
          errors.push(`${label}.follow_up.follow_up_count must be an integer >= 0.`);
        }
        if (!FOLLOW_UP_STATUSES.has(rec.follow_up.status)) {
          errors.push(`${label}.follow_up.status "${rec.follow_up.status}" is invalid.`);
        }
        for (const dtKey of ['next_due_at', 'last_followed_up_at']) {
          if (rec.follow_up[dtKey] !== undefined && rec.follow_up[dtKey] !== null && !isValidIsoDateTime(rec.follow_up[dtKey])) {
            errors.push(`${label}.follow_up.${dtKey} must be a valid ISO-8601 date-time or null.`);
          }
        }
        if (!isNullableString(rec.follow_up.draft_rel)) {
          errors.push(`${label}.follow_up.draft_rel must be a string or null.`);
        }
      }
    }

    if (rec.provenance !== undefined) {
      if (!isObj(rec.provenance)) {
        errors.push(`${label}: provenance must be an object.`);
      } else {
        checkAllowedKeys(rec.provenance, PROVENANCE_KEYS, `${label}.provenance`, errors);
        if (!isNonEmptyString(rec.provenance.created_by)) {
          errors.push(`${label}.provenance.created_by must be a non-empty string.`);
        }
        if (typeof rec.provenance.third_party_subject !== 'boolean') {
          errors.push(`${label}.provenance.third_party_subject must be a boolean.`);
        }
        if (rec.provenance.receipt_verified !== undefined && typeof rec.provenance.receipt_verified !== 'boolean') {
          errors.push(`${label}.provenance.receipt_verified must be a boolean.`);
        }
        if (!isNullableString(rec.provenance.last_updated_by)) {
          errors.push(`${label}.provenance.last_updated_by must be a string or null.`);
        }
        if (!isNullableString(rec.provenance.email_message_id)) {
          errors.push(`${label}.provenance.email_message_id must be a string or null.`);
        }
        if (rec.provenance.created_at !== undefined && rec.provenance.created_at !== null && !isValidIsoDateTime(rec.provenance.created_at)) {
          errors.push(`${label}.provenance.created_at must be a valid ISO-8601 date-time or null.`);
        }
      }
    }

    if (rec.notion_sync !== undefined) {
      if (!isObj(rec.notion_sync)) {
        errors.push(`${label}: notion_sync must be an object.`);
      } else {
        checkAllowedKeys(rec.notion_sync, NOTION_SYNC_KEYS, `${label}.notion_sync`, errors);
        if (!NOTION_SYNC_STATES.has(rec.notion_sync.state)) {
          errors.push(`${label}.notion_sync.state "${rec.notion_sync.state}" is invalid.`);
        }
        for (const sKey of ['page_id', 'last_synced_hash', 'last_error']) {
          if (!isNullableString(rec.notion_sync[sKey])) {
            errors.push(`${label}.notion_sync.${sKey} must be a string or null.`);
          }
        }
        if (rec.notion_sync.last_synced_at !== undefined && rec.notion_sync.last_synced_at !== null && !isValidIsoDateTime(rec.notion_sync.last_synced_at)) {
          errors.push(`${label}.notion_sync.last_synced_at must be a valid ISO-8601 date-time or null.`);
        }
        if (rec.notion_sync.retry_count !== undefined && (!Number.isInteger(rec.notion_sync.retry_count) || rec.notion_sync.retry_count < 0)) {
          errors.push(`${label}.notion_sync.retry_count must be an integer >= 0.`);
        }
      }
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

export function validateCvVersionsRegistry(registry) {
  const errors = [];
  const warnings = [];

  if (!isObj(registry)) {
    return { valid: false, errors: ['CV versions registry root must be a JSON object.'], warnings };
  }
  checkAllowedKeys(registry, CV_REGISTRY_KEYS, 'cv_versions', errors);
  if (registry.schema_version !== '1.0') {
    errors.push(`cv_versions.schema_version must be "1.0" (got ${JSON.stringify(registry.schema_version)}).`);
  }
  if (registry.updated_at !== undefined && registry.updated_at !== null && !isValidIsoDateTime(registry.updated_at)) {
    errors.push('cv_versions.updated_at must be a valid ISO-8601 date-time or null.');
  }
  if (!Array.isArray(registry.versions)) {
    errors.push('cv_versions.versions must be an array.');
    return { valid: false, errors, warnings };
  }

  const seenIds = new Set();
  registry.versions.forEach((v, idx) => {
    const label = `cv_versions.versions[${idx}]`;
    if (!isObj(v)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    checkAllowedKeys(v, CV_VERSION_KEYS, label, errors);
    if (!isNonEmptyString(v.cv_version_id)) {
      errors.push(`${label}.cv_version_id must be a non-empty string.`);
    } else if (seenIds.has(v.cv_version_id)) {
      errors.push(`${label}: duplicate cv_version_id "${v.cv_version_id}".`);
    } else {
      seenIds.add(v.cv_version_id);
    }
    if (!Number.isInteger(v.version_number) || v.version_number < 1) {
      errors.push(`${label}.version_number must be an integer >= 1.`);
    }
    if (!isNonEmptyString(v.label)) errors.push(`${label}.label must be a non-empty string.`);
    if (v.kind !== 'generic' && v.kind !== 'tailored') {
      errors.push(`${label}.kind must be "generic" or "tailored".`);
    }
    if (v.owner_scope !== 'owner' && v.owner_scope !== 'third_party') {
      errors.push(`${label}.owner_scope must be "owner" or "third_party".`);
    }
    if (v.content_sha256 !== undefined && v.content_sha256 !== null && (typeof v.content_sha256 !== 'string' || !SHA256_HEX_RE.test(v.content_sha256))) {
      errors.push(`${label}.content_sha256 must be a 64-char lowercase hex SHA-256 or null.`);
    }
    for (const sKey of ['base_cv_version_id', 'persona_id', 'local_ref_rel']) {
      if (!isNullableString(v[sKey])) {
        errors.push(`${label}.${sKey} must be a string or null.`);
      }
    }
    if (v.language !== undefined && (typeof v.language !== 'string' || v.language.length < 2 || v.language.length > 12)) {
      errors.push(`${label}.language must be a string of length 2..12.`);
    }
    if (!isValidIsoDateTime(v.created_at)) {
      errors.push(`${label}.created_at must be a valid ISO-8601 date-time.`);
    }
    if (v.updated_at !== undefined && v.updated_at !== null && !isValidIsoDateTime(v.updated_at)) {
      errors.push(`${label}.updated_at must be a valid ISO-8601 date-time or null.`);
    }
    if (!Array.isArray(v.application_ids) || v.application_ids.some(id => !isNonEmptyString(id))) {
      errors.push(`${label}.application_ids must be an array of non-empty strings.`);
    }
    if (v.tailoring_metadata !== undefined && v.tailoring_metadata !== null) {
      if (!isObj(v.tailoring_metadata)) {
        errors.push(`${label}.tailoring_metadata must be an object or null.`);
      } else {
        checkAllowedKeys(v.tailoring_metadata, CV_TAILORING_META_KEYS, `${label}.tailoring_metadata`, errors);
        if (!isNullableString(v.tailoring_metadata.target_job_id)) {
          errors.push(`${label}.tailoring_metadata.target_job_id must be a string or null.`);
        }
        if (!isNonEmptyString(v.tailoring_metadata.target_role)) {
          errors.push(`${label}.tailoring_metadata.target_role must be a non-empty string.`);
        }
        for (const arrK of ['emphasized_skills', 'true_gaps_excluded']) {
          const val = v.tailoring_metadata[arrK];
          if (val !== undefined && (!Array.isArray(val) || val.some(s => !isNonEmptyString(s)))) {
            errors.push(`${label}.tailoring_metadata.${arrK} must be an array of non-empty strings.`);
          }
        }
      }
    }
    if (v.ats_metrics !== undefined && v.ats_metrics !== null) {
      if (!isObj(v.ats_metrics)) {
        errors.push(`${label}.ats_metrics must be an object or null.`);
      } else {
        checkAllowedKeys(v.ats_metrics, CV_ATS_METRICS_KEYS, `${label}.ats_metrics`, errors);
        for (const k of ['keyword_match_before_pct', 'keyword_match_after_pct', 'hygiene_score']) {
          const val = v.ats_metrics[k];
          if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100)) {
            errors.push(`${label}.ats_metrics.${k} must be 0..100 or null.`);
          }
        }
        if (v.ats_metrics.page_count !== undefined && v.ats_metrics.page_count !== null && (!Number.isInteger(v.ats_metrics.page_count) || v.ats_metrics.page_count < 1 || v.ats_metrics.page_count > 10)) {
          errors.push(`${label}.ats_metrics.page_count must be an integer 1..10 or null.`);
        }
      }
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

export function isThirdPartyCvPath(relPath) {
  if (typeof relPath !== 'string') return false;
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)logs\/resumes\/cv-[^/]+/.test(norm);
}

export function registerCvVersion(registry, entry) {
  const base = isObj(registry) && Array.isArray(registry.versions)
    ? { schema_version: '1.0', updated_at: registry.updated_at ?? null, versions: [...registry.versions] }
    : { schema_version: '1.0', updated_at: null, versions: [] };

  if (!isObj(entry)) {
    throw new Error('CV version entry must be an object.');
  }
  if (entry.owner_scope === 'third_party' || isThirdPartyCvPath(entry.local_ref_rel)) {
    throw new Error('Refusing to register third-party CV into owner CV version registry (third-party isolation enforced).');
  }

  const existingIdx = base.versions.findIndex(v => v.cv_version_id === entry.cv_version_id);
  const existing = existingIdx >= 0 ? base.versions[existingIdx] : null;
  const nowIso = new Date().toISOString();

  // M5: Preserve existing created_at when updating an existing CV version
  const candidate = {
    cv_version_id: entry.cv_version_id,
    version_number: entry.version_number ?? existing?.version_number ?? 1,
    label: entry.label ?? existing?.label,
    kind: entry.kind ?? existing?.kind,
    owner_scope: 'owner',
    base_cv_version_id: entry.base_cv_version_id !== undefined ? entry.base_cv_version_id : (existing?.base_cv_version_id ?? null),
    content_sha256: entry.content_sha256 !== undefined ? entry.content_sha256 : (existing?.content_sha256 ?? null),
    persona_id: entry.persona_id !== undefined ? entry.persona_id : (existing?.persona_id ?? null),
    language: entry.language ?? existing?.language ?? 'en',
    created_at: entry.created_at ?? existing?.created_at ?? nowIso,
    updated_at: entry.updated_at ?? nowIso,
    local_ref_rel: entry.local_ref_rel !== undefined ? entry.local_ref_rel : (existing?.local_ref_rel ?? null),
    tailoring_metadata: entry.tailoring_metadata !== undefined ? entry.tailoring_metadata : (existing?.tailoring_metadata ?? null),
    ats_metrics: entry.ats_metrics !== undefined ? entry.ats_metrics : (existing?.ats_metrics ?? null),
    application_ids: Array.isArray(entry.application_ids) ? [...new Set(entry.application_ids)] : [],
  };

  if (existingIdx >= 0) {
    const mergedApps = [...new Set([...(existing.application_ids || []), ...candidate.application_ids])];
    base.versions[existingIdx] = { ...candidate, application_ids: mergedApps };
  } else {
    base.versions.push(candidate);
  }
  base.updated_at = nowIso;

  const check = validateCvVersionsRegistry(base);
  if (!check.valid) {
    throw new Error(`Invalid CV version registry after update: ${check.errors.join('; ')}`);
  }
  return base;
}

export function validateCareerInsights(doc) {
  const errors = [];
  const warnings = [];
  if (!isObj(doc)) {
    return { valid: false, errors: ['Career insights document must be a JSON object.'], warnings };
  }
  if (doc.schema_version !== undefined && doc.schema_version !== '2.0') {
    errors.push(`insights.schema_version must be "2.0" when provided.`);
  }
  const allowedTypes = new Set(['weekly', 'monthly', 'calibration', 'rejection_audit', 'all']);
  if (!allowedTypes.has(doc.type)) {
    errors.push(`insights.type "${doc.type}" is invalid.`);
  }
  if (!isNonEmptyString(doc.period)) errors.push('insights.period must be a non-empty string.');
  if (!isValidIsoDateTime(doc.generated_at)) errors.push('insights.generated_at must be a valid ISO-8601 date-time.');
  for (const k of ['scanned', 'applied']) {
    if (!Number.isInteger(doc[k]) || doc[k] < 0) errors.push(`insights.${k} must be an integer >= 0.`);
  }
  if (doc.prepared !== undefined && (!Number.isInteger(doc.prepared) || doc.prepared < 0)) {
    errors.push('insights.prepared must be an integer >= 0.');
  }
  if (doc.match_rate !== undefined && doc.match_rate !== null && (typeof doc.match_rate !== 'number' || !Number.isFinite(doc.match_rate) || doc.match_rate < 0 || doc.match_rate > 1)) {
    errors.push('insights.match_rate must be a number in 0..1 or null.');
  }
  if (doc.avg_match_score !== undefined && doc.avg_match_score !== null && (typeof doc.avg_match_score !== 'number' || !Number.isFinite(doc.avg_match_score) || doc.avg_match_score < 0 || doc.avg_match_score > 10)) {
    errors.push('insights.avg_match_score must be a number in 0..10 or null.');
  }
  for (const skKey of ['top_skills', 'skill_gaps']) {
    if (doc[skKey] !== undefined) {
      if (!Array.isArray(doc[skKey])) {
        errors.push(`insights.${skKey} must be an array.`);
      } else {
        doc[skKey].forEach((item, idx) => {
          if (!isObj(item) || !isNonEmptyString(item.skill) || !Number.isInteger(item.count) || item.count < 0 || Object.keys(item).some(k => k !== 'skill' && k !== 'count')) {
            errors.push(`insights.${skKey}[${idx}] must be { skill: non-empty string, count: int >= 0 }.`);
          }
        });
      }
    }
  }
  if (doc.recommendations !== undefined && (!Array.isArray(doc.recommendations) || doc.recommendations.some(r => typeof r !== 'string'))) {
    errors.push('insights.recommendations must be an array of strings.');
  }
  if (doc.notion_synced !== undefined && typeof doc.notion_synced !== 'boolean') {
    errors.push('insights.notion_synced must be a boolean.');
  }
  if (doc.intelligence !== undefined) {
    if (!isObj(doc.intelligence)) {
      errors.push('insights.intelligence must be an object.');
    } else {
      checkAllowedKeys(doc.intelligence, INSIGHTS_INTELLIGENCE_KEYS, 'insights.intelligence', errors);
      if (!isObj(doc.intelligence.deterministic_facts)) {
        errors.push('insights.intelligence.deterministic_facts must be an object.');
      }
      const suf = doc.intelligence.sample_sufficiency;
      if (!isObj(suf)) {
        errors.push('insights.intelligence.sample_sufficiency must be an object.');
      } else {
        checkAllowedKeys(suf, SAMPLE_SUFFICIENCY_KEYS, 'insights.intelligence.sample_sufficiency', errors);
        if (!Number.isInteger(suf.submitted_n) || suf.submitted_n < 0 || !Number.isInteger(suf.decided_n) || suf.decided_n < 0 || !Number.isInteger(suf.min_threshold) || suf.min_threshold < 1 || typeof suf.sufficient !== 'boolean') {
          errors.push('insights.intelligence.sample_sufficiency must contain submitted_n >= 0, decided_n >= 0, min_threshold >= 1, and boolean sufficient.');
        }
      }
      for (const aiKey of ['ai_interpretations', 'hypotheses', 'recommended_actions']) {
        if (doc.intelligence[aiKey] !== undefined) {
          if (!Array.isArray(doc.intelligence[aiKey])) {
            errors.push(`insights.intelligence.${aiKey} must be an array.`);
          } else {
            doc.intelligence[aiKey].forEach((st, idx) => {
              const sLabel = `insights.intelligence.${aiKey}[${idx}]`;
              if (!isObj(st)) {
                errors.push(`${sLabel} must be an object.`);
                return;
              }
              checkAllowedKeys(st, AI_STATEMENT_KEYS, sLabel, errors);
              if (!isNonEmptyString(st.claim)) errors.push(`${sLabel}.claim must be a non-empty string.`);
              if (!Array.isArray(st.evidence_refs) || st.evidence_refs.some(e => !isNonEmptyString(e))) {
                errors.push(`${sLabel}.evidence_refs must be an array of non-empty strings.`);
              }
              if (st.confidence !== undefined && !AI_CONFIDENCE_VALUES.has(st.confidence)) {
                errors.push(`${sLabel}.confidence "${st.confidence}" is invalid.`);
              }
            });
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateDailyRun(doc) {
  const errors = [];
  const warnings = [];
  if (!isObj(doc)) {
    return { valid: false, errors: ['Daily run document must be a JSON object.'], warnings };
  }
  if (typeof doc.run_id !== 'string' || !RUN_ID_RE.test(doc.run_id)) {
    errors.push('daily_run.run_id must match YYYY-MM-DD.');
  }
  if (!isValidIsoDateTime(doc.started_at)) errors.push('daily_run.started_at must be a valid ISO-8601 date-time.');
  if (doc.finished_at !== undefined && doc.finished_at !== null && !isValidIsoDateTime(doc.finished_at)) {
    errors.push('daily_run.finished_at must be a valid ISO-8601 date-time or null.');
  }
  if (typeof doc.dry_run !== 'boolean') errors.push('daily_run.dry_run must be a boolean.');
  if (!new Set(['running', 'completed', 'aborted']).has(doc.status)) {
    errors.push(`daily_run.status "${doc.status}" is invalid.`);
  }
  if (!isObj(doc.counts)) {
    errors.push('daily_run.counts must be an object.');
  } else {
    for (const k of ['scanned', 'applied', 'dry_run', 'needs_review', 'skipped', 'failed']) {
      if (!Number.isInteger(doc.counts[k]) || doc.counts[k] < 0) {
        errors.push(`daily_run.counts.${k} must be an integer >= 0.`);
      }
    }
    if (doc.counts.prepared !== undefined && (!Number.isInteger(doc.counts.prepared) || doc.counts.prepared < 0)) {
      errors.push('daily_run.counts.prepared must be an integer >= 0.');
    }
  }
  for (const arrK of ['platforms', 'errors']) {
    if (doc[arrK] !== undefined && (!Array.isArray(doc[arrK]) || doc[arrK].some(s => typeof s !== 'string'))) {
      errors.push(`daily_run.${arrK} must be an array of strings.`);
    }
  }
  if (doc.steps !== undefined) {
    if (!Array.isArray(doc.steps)) {
      errors.push('daily_run.steps must be an array.');
    } else {
      doc.steps.forEach((step, idx) => {
        if (!isObj(step) || !isValidIsoDateTime(step.at) || !isNonEmptyString(step.step) || (step.detail !== undefined && typeof step.detail !== 'string')) {
          errors.push(`daily_run.steps[${idx}] must have valid ISO at, non-empty step, and optional string detail.`);
        }
      });
    }
  }
  if (doc.notes !== undefined && typeof doc.notes !== 'string') {
    errors.push('daily_run.notes must be a string.');
  }
  return { valid: errors.length === 0, errors, warnings };
}

function createVerifiedBackup(root, logPath, sourceBytes, home) {
  const backupsParent = path.join(root, 'logs', 'backups');
  refuseSymlink(backupsParent, root, home);
  fs.mkdirSync(backupsParent, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(4).toString('hex');
  const destDir = path.join(backupsParent, `backup-migrate-${stamp}-${suffix}`);
  refuseSymlink(destDir, root, home);
  fs.mkdirSync(destDir, { recursive: false });

  const backupWarnings = [];
  try {
    const backupLogPath = path.join(destDir, 'logs', 'applications-log.json');
    writeAtomic(backupLogPath, sourceBytes, { mode: 0o600, boundary: root, home });

    // Snapshot sibling core log files non-destructively (warn if an unrelated sibling log is corrupt)
    for (const rel of ['logs/skipped-jobs.json', 'logs/circuit-breaker.json', 'logs/cv-versions.json', 'logs/sync-state.json']) {
      const src = path.join(root, rel);
      if (!fs.existsSync(src)) continue;
      refuseSymlink(src, root, home);
      const bytes = fs.readFileSync(src);
      try {
        JSON.parse(bytes.toString('utf8'));
      } catch (e) {
        backupWarnings.push(`Skipped corrupt sibling log ${rel} during backup (${e.message}).`);
        continue;
      }
      writeAtomic(path.join(destDir, rel), bytes, { mode: 0o600, boundary: root, home });
    }

    // Re-read & cryptographically verify backed-up applications-log.json before allowing migration writes
    if (!fs.existsSync(backupLogPath)) {
      throw new Error(`Backup verification failed: ${backupLogPath} was not written.`);
    }
    const verifyBytes = fs.readFileSync(backupLogPath);
    const srcHash = crypto.createHash('sha256').update(sourceBytes).digest('hex');
    const bakHash = crypto.createHash('sha256').update(verifyBytes).digest('hex');
    if (srcHash !== bakHash) {
      throw new Error('Backup verification failed: SHA-256 mismatch between live ledger and backup copy.');
    }
    JSON.parse(verifyBytes.toString('utf8'));
    return { backupDir: destDir, backupLogPath, sha256: bakHash, backupWarnings };
  } catch (err) {
    // Clean up incomplete backup directory if backup creation/verification fails
    try {
      fs.rmSync(destDir, { recursive: true, force: true });
    } catch { /* preserve primary backup error */ }
    throw err;
  }
}

export function migrateApplicationsLedger(root, { apply = false, home = os.homedir(), _beforeWriteHook = null, _afterWriteHook = null } = {}) {
  const logPath = path.join(root, 'logs', 'applications-log.json');
  refuseSymlink(logPath, root, home);

  if (!fs.existsSync(logPath)) {
    throw new Error(`Application ledger not found: ${logPath}`);
  }

  const sourceBytes = fs.readFileSync(logPath);
  const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
  let parsed;
  try {
    parsed = JSON.parse(sourceBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`Corrupt JSON in ${logPath}: ${err.message}. Restore from logs/backups/ before migrating.`);
  }

  // Strict pre-migration job_id usability & uniqueness gate (abort on missing/duplicate IDs)
  const idCheck = checkUniqueUsableJobIds(parsed);
  if (!idCheck.valid) {
    throw new Error(`Migration aborted (job_id integrity check failed):\n- ${idCheck.errors.join('\n- ')}`);
  }

  const migrated = [];
  let changedCount = 0;
  let alreadyV2Count = 0;
  const statusRemaps = [];

  for (const raw of parsed) {
    const next = normalizeApplicationRecord(raw);
    const same = JSON.stringify(raw) === JSON.stringify(next);
    if (same) {
      alreadyV2Count++;
    } else {
      changedCount++;
      if (raw.status !== next.status) {
        statusRemaps.push({ job_id: raw.job_id, from: raw.status, to: next.status });
      }
    }
    migrated.push(next);
  }

  const postValidation = validateApplicationLedger(migrated);
  if (!postValidation.valid) {
    throw new Error(`Migration aborted (post-normalization validation failed):\n- ${postValidation.errors.join('\n- ')}`);
  }

  // Dry-run default: strictly zero disk writes
  if (!apply) {
    return {
      mode: 'dry_run',
      applied: false,
      idempotent_no_op: changedCount === 0,
      ledger_path: logPath,
      total_records: parsed.length,
      to_enrich: changedCount,
      already_v2: alreadyV2Count,
      status_remaps: statusRemaps,
      backup_dir: null,
      backup_log_path: null,
      backup_warnings: [],
    };
  }

  // Idempotent no-op when all records are already normalized at v2.0
  if (changedCount === 0) {
    return {
      mode: 'apply',
      applied: false,
      idempotent_no_op: true,
      ledger_path: logPath,
      total_records: parsed.length,
      to_enrich: 0,
      already_v2: alreadyV2Count,
      status_remaps: [],
      backup_dir: null,
      backup_log_path: null,
      backup_warnings: [],
    };
  }

  // Backup-first with SHA-256 verification before touching live file
  const backup = createVerifiedBackup(root, logPath, sourceBytes, home);
  const nextText = JSON.stringify(migrated, null, 2) + '\n';

  if (typeof _beforeWriteHook === 'function') {
    _beforeWriteHook({ logPath, backup });
  }

  // M2: Protect against concurrent source changes (TOCTOU) before replacing live ledger
  const liveBytesNow = fs.readFileSync(logPath);
  const liveShaNow = crypto.createHash('sha256').update(liveBytesNow).digest('hex');
  if (liveShaNow !== sourceSha256) {
    throw new Error(
      `Concurrent modification detected in ${logPath} during migration; aborting without overwriting (pre-migration backup preserved at ${backup.backupLogPath}).`,
    );
  }

  writeAtomic(logPath, nextText, { mode: 0o600, boundary: root, home });

  if (typeof _afterWriteHook === 'function') {
    _afterWriteHook({ logPath, backup });
  }

  // Re-read written file to verify post-write integrity; perform SHA-256-verified atomic restore if invalid
  let verifyWritten;
  try {
    const reread = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    verifyWritten = validateApplicationLedger(reread);
  } catch (readErr) {
    verifyWritten = { valid: false, errors: [readErr.message] };
  }
  if (!verifyWritten.valid) {
    const validationDetail = verifyWritten.errors.join('; ');
    let restoreVerified = false;
    let restoreFailureReason = null;
    try {
      if (!fs.existsSync(backup.backupLogPath)) {
        throw new Error('backup file is missing');
      }
      const backupBytes = fs.readFileSync(backup.backupLogPath);
      const currentBackupSha = crypto.createHash('sha256').update(backupBytes).digest('hex');
      if (currentBackupSha !== backup.sha256 || currentBackupSha !== sourceSha256) {
        throw new Error(`backup SHA-256 verification failed (expected ${backup.sha256}, got ${currentBackupSha})`);
      }
      JSON.parse(backupBytes.toString('utf8'));
      writeAtomic(logPath, backupBytes, { mode: 0o600, boundary: root, home });
      const restoredBytes = fs.readFileSync(logPath);
      const restoredSha = crypto.createHash('sha256').update(restoredBytes).digest('hex');
      if (restoredSha !== sourceSha256) {
        throw new Error(`post-restore live ledger SHA-256 mismatch (expected ${sourceSha256}, got ${restoredSha})`);
      }
      restoreVerified = true;
    } catch (restoreErr) {
      restoreFailureReason = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
    }

    if (restoreVerified) {
      throw new Error(
        `Post-write ledger verification failed (auto-restored and SHA-256 verified from backup ${backup.backupLogPath}): ${validationDetail}`,
      );
    }
    throw new Error(
      `Post-write ledger verification failed (${validationDetail}). AUTO-RESTORE FAILED — live ledger may be invalid; manual recovery required from ${backup.backupLogPath} (restore error: ${restoreFailureReason}).`,
    );
  }

  return {
    mode: 'apply',
    applied: true,
    idempotent_no_op: false,
    ledger_path: logPath,
    total_records: migrated.length,
    to_enrich: changedCount,
    already_v2: alreadyV2Count,
    status_remaps: statusRemaps,
    backup_dir: backup.backupDir,
    backup_log_path: backup.backupLogPath,
    backup_sha256: backup.sha256,
    backup_warnings: backup.backupWarnings,
  };
}

export function listOwnerCvVersions(root, { home = os.homedir() } = {}) {
  const regPath = path.join(root, 'logs', 'cv-versions.json');
  const logPath = path.join(root, 'logs', 'applications-log.json');

  let registry = { schema_version: '1.0', updated_at: null, versions: [] };
  let registryExists = false;
  if (fs.existsSync(regPath)) {
    refuseSymlink(regPath, root, home);
    registryExists = true;
    const parsed = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const check = validateCvVersionsRegistry(parsed);
    if (!check.valid) {
      throw new Error(`Invalid logs/cv-versions.json: ${check.errors.join('; ')}`);
    }
    registry = parsed;
  }

  const linkedCounts = new Map();
  if (fs.existsSync(logPath)) {
    refuseSymlink(logPath, root, home);
    const rawApps = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const apps = Array.isArray(rawApps) ? rawApps : (isObj(rawApps) && Array.isArray(rawApps.applications) ? rawApps.applications : []);
    for (const app of apps) {
      if (!isObj(app) || app.provenance?.third_party_subject === true) continue;
      if (isNonEmptyString(app.cv_version_id)) {
        linkedCounts.set(app.cv_version_id, (linkedCounts.get(app.cv_version_id) || 0) + 1);
      }
    }
  }

  const ownerVersions = [];
  let thirdPartyExcluded = 0;
  for (const v of registry.versions) {
    if (v.owner_scope !== 'owner' || isThirdPartyCvPath(v.local_ref_rel)) {
      thirdPartyExcluded++;
      continue;
    }
    const ledgerCount = linkedCounts.get(v.cv_version_id) || 0;
    const explicitCount = Array.isArray(v.application_ids) ? v.application_ids.length : 0;
    ownerVersions.push({
      cv_version_id: v.cv_version_id,
      version_number: v.version_number,
      label: v.label,
      kind: v.kind,
      base_cv_version_id: v.base_cv_version_id ?? null,
      persona_id: v.persona_id ?? null,
      language: v.language ?? 'en',
      created_at: v.created_at,
      updated_at: v.updated_at ?? null,
      ats_metrics: v.ats_metrics ?? null,
      linked_applications_count: Math.max(ledgerCount, explicitCount),
    });
  }

  return {
    registry_exists: registryExists,
    total_owner_versions: ownerVersions.length,
    third_party_excluded: thirdPartyExcluded,
    versions: ownerVersions,
  };
}

// ---------------- Stage 2 (T4): Deterministic Career Analytics & Insights ----------------

const PERIOD_WEEK_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const PERIOD_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86400000;

export function formatIsoWeekUtc(dateObj) {
  const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function parsePeriodSpec(period = 'all') {
  const raw = String(period ?? 'all').trim();
  if (!raw || raw.toLowerCase() === 'all') {
    return { type: 'all', period: 'all' };
  }
  if (PERIOD_WEEK_RE.test(raw)) {
    return { type: 'weekly', period: raw };
  }
  if (PERIOD_MONTH_RE.test(raw)) {
    return { type: 'monthly', period: raw };
  }
  throw new Error(`Invalid --period "${raw}". Expected "all", ISO week "YYYY-Www" (e.g., 2026-W46), or month "YYYY-MM" (e.g., 2026-11).`);
}

function recordMatchesPeriod(isoOrDateStr, periodSpec) {
  if (periodSpec.type === 'all') return true;
  if (typeof isoOrDateStr !== 'string' || !isoOrDateStr.trim()) return false;
  const ts = Date.parse(isoOrDateStr);
  if (Number.isNaN(ts)) return false;
  const d = new Date(ts);
  if (periodSpec.type === 'monthly') {
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return ym === periodSpec.period;
  }
  if (periodSpec.type === 'weekly') {
    return formatIsoWeekUtc(d) === periodSpec.period;
  }
  return false;
}

function round1(num) {
  return Math.round(num * 10) / 10;
}

export function computeSafeRate(numerator, denominator, minN = MIN_SAMPLE_SIZE) {
  const sufficient = denominator >= minN;
  return {
    numerator,
    denominator,
    rate_pct: sufficient ? round1((numerator / denominator) * 100) : null,
    sample_sufficient: sufficient,
    reason: sufficient ? null : `insufficient_sample (n=${denominator} < ${minN})`,
  };
}

function computeQuantileSorted(sortedNums, q) {
  if (!sortedNums.length) return null;
  if (sortedNums.length === 1) return round1(sortedNums[0]);
  const pos = (sortedNums.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const val = sortedNums[base + 1] !== undefined
    ? sortedNums[base] + rest * (sortedNums[base + 1] - sortedNums[base])
    : sortedNums[base];
  return round1(val);
}

const EMPLOYER_RESPONSE_STATUS_SET = new Set(['interview', 'assessment', 'offer', 'rejected']);

function resolveEarliestResponseTs(rec, appliedTs) {
  const candidates = [];
  if (Array.isArray(rec.stage_history)) {
    for (const ev of rec.stage_history) {
      if (!isObj(ev)) continue;
      const evStatus = normalizeStatus(ev.to_status);
      if (!evStatus.valid || !EMPLOYER_RESPONSE_STATUS_SET.has(evStatus.canonical)) continue;
      const ts = Date.parse(ev.at);
      if (!Number.isNaN(ts)) candidates.push(ts);
    }
  }
  if (Array.isArray(rec.interviews)) {
    for (const iv of rec.interviews) {
      if (!isObj(iv) || !iv.scheduled_at) continue;
      const ts = Date.parse(iv.scheduled_at);
      if (!Number.isNaN(ts)) candidates.push(ts);
    }
  }
  if (Array.isArray(rec.assessments)) {
    for (const asmt of rec.assessments) {
      if (!isObj(asmt) || !asmt.received_at) continue;
      const ts = Date.parse(asmt.received_at);
      if (!Number.isNaN(ts)) candidates.push(ts);
    }
  }
  // Fallback: updated_at on employer-originated post-apply outcome (never withdrawn) when no stage/interview/assessment timestamp exists
  const canonicalSt = rec.canonical_status || normalizeStatus(rec.status).canonical;
  if (candidates.length === 0 && EMPLOYER_RESPONSE_STATUS_SET.has(canonicalSt) && rec.updated_at) {
    const ts = Date.parse(rec.updated_at);
    if (!Number.isNaN(ts)) candidates.push(ts);
  }
  if (candidates.length === 0) return { ts: null, negativeIgnored: false };
  const valid = candidates.filter(t => t >= appliedTs).sort((a, b) => a - b);
  if (valid.length === 0) return { ts: null, negativeIgnored: true };
  return { ts: valid[0], negativeIgnored: valid.length < candidates.length };
}

function classifySourceChannel(rec) {
  if (isNonEmptyString(rec.source_channel)) return rec.source_channel.trim().toLowerCase();
  const p = String(rec.platform || '').trim().toLowerCase();
  if (['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'breezyhr', 'taleo', 'workable'].includes(p)) {
    return 'direct_ats';
  }
  if (['toptal', 'braintrust', 'lemon', 'gunio', 'contra', 'arc', 'turing'].includes(p)) {
    return 'b2b_network';
  }
  if (p) return 'job_board';
  return 'other';
}

export function computeCareerAnalytics(records, cvVersionsRegistry = null, { nowIso = new Date().toISOString(), period = 'all', minSampleSize = MIN_SAMPLE_SIZE } = {}) {
  if (!Array.isArray(records)) {
    throw new Error('computeCareerAnalytics requires an array of application records.');
  }
  const nowTs = Date.parse(nowIso);
  if (Number.isNaN(nowTs)) {
    throw new Error(`Invalid nowIso timestamp: "${nowIso}".`);
  }
  const periodSpec = parsePeriodSpec(period);

  // Build owner-only CV version metadata lookup (strictly excluding third-party CVs)
  const cvMetaMap = new Map();
  let thirdPartyCvExcluded = 0;
  if (isObj(cvVersionsRegistry) && Array.isArray(cvVersionsRegistry.versions)) {
    for (const v of cvVersionsRegistry.versions) {
      if (!isObj(v) || !isNonEmptyString(v.cv_version_id)) continue;
      if (v.owner_scope !== 'owner' || isThirdPartyCvPath(v.local_ref_rel)) {
        thirdPartyCvExcluded++;
        continue;
      }
      cvMetaMap.set(v.cv_version_id, {
        cv_version_id: v.cv_version_id,
        label: v.label || v.cv_version_id,
        kind: v.kind || 'unknown',
      });
    }
  }

  const dataQualityWarnings = [];
  let thirdPartyAppsExcluded = 0;
  const scoped = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    if (!isObj(raw)) {
      dataQualityWarnings.push(`records[${i}]: skipped non-object entry.`);
      continue;
    }
    if (raw.provenance?.third_party_subject === true) {
      thirdPartyAppsExcluded++;
      continue;
    }
    const st = normalizeStatus(raw.status);
    if (!st.valid) {
      dataQualityWarnings.push(`records[${i}] (${raw.job_id || 'no-id'}): skipped unrecognized status "${raw.status}".`);
      continue;
    }
    const effectiveDate = raw.applied_at || raw.date || raw.discovered_at || raw.updated_at || null;
    if (!recordMatchesPeriod(effectiveDate, periodSpec)) continue;

    scoped.push({
      ...raw,
      canonical_status: st.canonical,
      effective_date: effectiveDate,
    });
  }

  let preparedOnlyCount = 0;
  let excludedNonSubmittedCount = 0;
  const submitted = [];
  const allMatchScores = [];
  const skillFreq = new Map();
  const gapFreq = new Map();
  const activityDaily = new Map();
  const activityWeekly = new Map();
  const activityMonthly = new Map();

  const bumpActivity = (map, key, field) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { period: key, scanned: 0, prepared: 0, submitted: 0, callbacks: 0 });
    map.get(key)[field]++;
  };

  const parseValidMatchScore = rec => {
    const rawScore = rec.match_score !== null && rec.match_score !== undefined ? rec.match_score : rec.score;
    if (rawScore === null || rawScore === undefined || rawScore === '') return null;
    const sc = Number(rawScore);
    if (!Number.isFinite(sc) || sc <= 0 || sc > 10) {
      dataQualityWarnings.push(`${rec.job_id || 'unknown'}: ignored out-of-range or invalid match_score (${JSON.stringify(rawScore)}).`);
      return null;
    }
    return sc;
  };

  for (const r of scoped) {
    const validScore = parseValidMatchScore(r);
    if (validScore !== null) {
      allMatchScores.push(validScore);
    }
    if (Array.isArray(r.matched_skills)) {
      for (const s of r.matched_skills) {
        if (isNonEmptyString(s)) skillFreq.set(s.trim(), (skillFreq.get(s.trim()) || 0) + 1);
      }
    }
    if (Array.isArray(r.missing_skills)) {
      for (const s of r.missing_skills) {
        if (isNonEmptyString(s)) {
          const k = s.trim();
          skillFreq.set(k, (skillFreq.get(k) || 0) + 1);
          gapFreq.set(k, (gapFreq.get(k) || 0) + 1);
        }
      }
    }

    const effTs = r.effective_date ? Date.parse(r.effective_date) : Number.NaN;
    let dayKey = null;
    let weekKey = null;
    let monthKey = null;
    if (!Number.isNaN(effTs)) {
      const d = new Date(effTs);
      dayKey = d.toISOString().slice(0, 10);
      weekKey = formatIsoWeekUtc(d);
      monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      bumpActivity(activityDaily, dayKey, 'scanned');
      bumpActivity(activityWeekly, weekKey, 'scanned');
      bumpActivity(activityMonthly, monthKey, 'scanned');
    }

    const isSubmitted = SUBMITTED_STATUS_SET.has(r.canonical_status) && r.submission_uncertain !== true;
    if (!isSubmitted) {
      excludedNonSubmittedCount++;
      if (r.canonical_status === 'prepared') {
        preparedOnlyCount++;
        bumpActivity(activityDaily, dayKey, 'prepared');
        bumpActivity(activityWeekly, weekKey, 'prepared');
        bumpActivity(activityMonthly, monthKey, 'prepared');
      }
      continue;
    }

    submitted.push({ ...r, _dayKey: dayKey, _weekKey: weekKey, _monthKey: monthKey });
    bumpActivity(activityDaily, dayKey, 'submitted');
    bumpActivity(activityWeekly, weekKey, 'submitted');
    bumpActivity(activityMonthly, monthKey, 'submitted');
  }

  let everInterviewedCount = 0;
  let everAssessedCount = 0;
  let offerCount = 0;
  let rejectedCount = 0;
  let withdrawnCount = 0;
  let pendingActiveCount = 0;
  let silent14dCount = 0;
  let positiveCallbacksCount = 0;

  const agingBuckets = {
    fresh_0_6d: 0,
    followup_window_7_13d: 0,
    silent_14_29d: 0,
    stale_30d_plus: 0,
    unknown_applied_date: 0,
  };
  const overdueFollowUps = [];
  const responseDeltasDays = [];
  let invalidTimestampsIgnored = 0;

  const cvGroups = new Map();
  const tailoredCohort = { submitted: 0, callbacks: 0, interviews: 0, assessments: 0, offers: 0 };
  const genericCohort = { submitted: 0, callbacks: 0, interviews: 0, assessments: 0, offers: 0 };
  let unknownTailoringCount = 0;

  const platformGroups = new Map();
  const channelGroups = new Map();

  const ensureGroup = (map, key, extra = {}) => {
    if (!map.has(key)) {
      map.set(key, {
        ...extra,
        submitted: 0,
        callbacks: 0,
        interviews: 0,
        assessments: 0,
        offers: 0,
        scores: [],
        response_days: [],
      });
    }
    return map.get(key);
  };

  for (const r of submitted) {
    const historyStatuses = new Set(
      Array.isArray(r.stage_history) ? r.stage_history.map(ev => ev?.to_status).filter(Boolean) : [],
    );
    const everInterviewed = r.canonical_status === 'interview' || (Array.isArray(r.interviews) && r.interviews.length > 0) || historyStatuses.has('interview');
    const everAssessed = r.canonical_status === 'assessment' || (Array.isArray(r.assessments) && r.assessments.length > 0) || historyStatuses.has('assessment');
    const hasOffer = r.canonical_status === 'offer' || historyStatuses.has('offer');
    const isCallback = everInterviewed || everAssessed || hasOffer;

    if (everInterviewed) everInterviewedCount++;
    if (everAssessed) everAssessedCount++;
    if (hasOffer) offerCount++;
    if (isCallback) {
      positiveCallbacksCount++;
      bumpActivity(activityDaily, r._dayKey, 'callbacks');
      bumpActivity(activityWeekly, r._weekKey, 'callbacks');
      bumpActivity(activityMonthly, r._monthKey, 'callbacks');
    }

    // Never classify silent 'applied' rows as 'rejected'
    if (r.canonical_status === 'rejected') rejectedCount++;
    else if (r.canonical_status === 'withdrawn') withdrawnCount++;

    const appliedDateStr = r.applied_at || r.date || null;
    const appliedTs = appliedDateStr ? Date.parse(appliedDateStr) : Number.NaN;
    let ageDays = null;
    if (!Number.isNaN(appliedTs)) {
      ageDays = Math.floor((nowTs - appliedTs) / DAY_MS);
    }

    if (r.canonical_status === 'applied') {
      if (ageDays === null || ageDays < 0) {
        agingBuckets.unknown_applied_date++;
        pendingActiveCount++;
        if (ageDays === null) {
          dataQualityWarnings.push(`${r.job_id || 'unknown'}: applied status missing valid applied_at/date.`);
        }
      } else if (ageDays < 7) {
        agingBuckets.fresh_0_6d++;
        pendingActiveCount++;
      } else if (ageDays < 14) {
        agingBuckets.followup_window_7_13d++;
        pendingActiveCount++;
      } else if (ageDays < 30) {
        agingBuckets.silent_14_29d++;
        silent14dCount++;
      } else {
        agingBuckets.stale_30d_plus++;
        silent14dCount++;
      }

      const notesStr = typeof r.notes === 'string' ? r.notes : '';
      const alreadyFollowedUp = Boolean(r.follow_up?.last_followed_up_at) || /followup_sent:/i.test(notesStr);
      if (ageDays !== null && ageDays >= 7 && !alreadyFollowedUp) {
        overdueFollowUps.push({
          job_id: r.job_id || null,
          application_id: r.application_id || (isUsableJobId(r.job_id) ? computeApplicationId(r.job_id) : null),
          company: r.company || null,
          title: r.title || r.role || null,
          platform: r.platform || null,
          applied_at: appliedDateStr,
          days_since_applied: ageDays,
        });
      }
    }

    // Response time delta (only when both applied_at and a post-apply timestamp exist)
    let responseDelta = null;
    if (!Number.isNaN(appliedTs)) {
      const resp = resolveEarliestResponseTs(r, appliedTs);
      if (resp.negativeIgnored) invalidTimestampsIgnored++;
      if (resp.ts !== null) {
        responseDelta = (resp.ts - appliedTs) / DAY_MS;
        responseDeltasDays.push(responseDelta);
      }
    }

    // CV version attribution (never fabricate missing cv_version_id)
    const cvId = isNonEmptyString(r.cv_version_id) ? r.cv_version_id.trim() : 'unattributed_legacy';
    const cvMeta = cvMetaMap.get(cvId);
    const cvBucket = ensureGroup(cvGroups, cvId, {
      cv_version_id: cvId,
      label: cvMeta ? cvMeta.label : (cvId === 'unattributed_legacy' ? 'Unattributed (Legacy / No CV Version Logged)' : cvId),
      kind: cvMeta ? cvMeta.kind : (typeof r.cv_tailoring?.is_tailored === 'boolean' ? (r.cv_tailoring.is_tailored ? 'tailored' : 'generic') : 'unknown'),
    });
    cvBucket.submitted++;
    if (isCallback) cvBucket.callbacks++;
    if (everInterviewed) cvBucket.interviews++;
    if (everAssessed) cvBucket.assessments++;
    if (hasOffer) cvBucket.offers++;

    if (typeof r.cv_tailoring?.is_tailored === 'boolean') {
      const targetCohort = r.cv_tailoring.is_tailored ? tailoredCohort : genericCohort;
      targetCohort.submitted++;
      if (isCallback) targetCohort.callbacks++;
      if (everInterviewed) targetCohort.interviews++;
      if (everAssessed) targetCohort.assessments++;
      if (hasOffer) targetCohort.offers++;
    } else if (cvMeta && (cvMeta.kind === 'tailored' || cvMeta.kind === 'generic')) {
      const targetCohort = cvMeta.kind === 'tailored' ? tailoredCohort : genericCohort;
      targetCohort.submitted++;
      if (isCallback) targetCohort.callbacks++;
      if (everInterviewed) targetCohort.interviews++;
      if (everAssessed) targetCohort.assessments++;
      if (hasOffer) targetCohort.offers++;
    } else {
      unknownTailoringCount++;
    }

    // Platform & Source Channel groups
    const platKey = isNonEmptyString(r.platform) ? r.platform.trim().toLowerCase() : 'other';
    const chanKey = classifySourceChannel(r);
    const rawScore = r.match_score !== null && r.match_score !== undefined ? r.match_score : r.score;
    const sc = Number(rawScore);
    const validScore = rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(sc) && sc > 0 && sc <= 10 ? sc : null;

    for (const [grpMap, grpKey, idField] of [
      [platformGroups, platKey, 'platform'],
      [channelGroups, chanKey, 'source_channel'],
    ]) {
      const g = ensureGroup(grpMap, grpKey, { [idField]: grpKey });
      g.submitted++;
      if (isCallback) g.callbacks++;
      if (everInterviewed) g.interviews++;
      if (everAssessed) g.assessments++;
      if (hasOffer) g.offers++;
      if (validScore !== null) g.scores.push(validScore);
      if (responseDelta !== null) g.response_days.push(responseDelta);
    }
  }

  overdueFollowUps.sort((a, b) => (b.days_since_applied - a.days_since_applied) || String(a.job_id || '').localeCompare(String(b.job_id || '')));
  const sortedResponseDeltas = [...responseDeltasDays].sort((a, b) => a - b);

  const submittedCount = submitted.length;
  // B1: Exclude BOTH pendingActiveCount (<14d) AND silent14dCount (>=14d) so silence is never treated as decided/rejected
  const decidedCount = Math.max(0, submittedCount - pendingActiveCount - silent14dCount);
  const avgMatchScore = allMatchScores.length > 0
    ? round1(allMatchScores.reduce((a, b) => a + b, 0) / allMatchScores.length)
    : null;

  const formatCvBucket = g => ({
    cv_version_id: g.cv_version_id,
    label: g.label,
    kind: g.kind,
    submitted: g.submitted,
    callbacks: g.callbacks,
    interviews: g.interviews,
    assessments: g.assessments,
    offers: g.offers,
    callback_rate: computeSafeRate(g.callbacks, g.submitted, minSampleSize),
    interview_rate: computeSafeRate(g.interviews, g.submitted, minSampleSize),
    assessment_rate: computeSafeRate(g.assessments, g.submitted, minSampleSize),
    offer_rate: computeSafeRate(g.offers, g.submitted, minSampleSize),
  });

  const formatSourceBucket = (g, idField) => {
    const sortedDays = [...g.response_days].sort((a, b) => a - b);
    const rtSufficient = sortedDays.length >= minSampleSize;
    return {
      [idField]: g[idField],
      submitted: g.submitted,
      callbacks: g.callbacks,
      interviews: g.interviews,
      assessments: g.assessments,
      offers: g.offers,
      callback_rate: computeSafeRate(g.callbacks, g.submitted, minSampleSize),
      interview_rate: computeSafeRate(g.interviews, g.submitted, minSampleSize),
      offer_rate: computeSafeRate(g.offers, g.submitted, minSampleSize),
      avg_match_score: g.scores.length > 0 ? round1(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null,
      median_response_days: rtSufficient ? computeQuantileSorted(sortedDays, 0.5) : null,
      response_time_sample_n: sortedDays.length,
      response_time_sample_sufficient: rtSufficient,
    };
  };

  const formatCohortSummary = c => ({
    submitted: c.submitted,
    callbacks: c.callbacks,
    interviews: c.interviews,
    assessments: c.assessments,
    offers: c.offers,
    callback_rate: computeSafeRate(c.callbacks, c.submitted, minSampleSize),
    interview_rate: computeSafeRate(c.interviews, c.submitted, minSampleSize),
    offer_rate: computeSafeRate(c.offers, c.submitted, minSampleSize),
  });

  const topSkills = [...skillFreq.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }));
  const skillGaps = [...gapFreq.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }));

  const sortActivity = map => [...map.values()].sort((a, b) => a.period.localeCompare(b.period));

  return {
    period_type: periodSpec.type,
    period: periodSpec.period,
    computed_at: nowIso,
    min_sample_size: minSampleSize,
    sample_sufficiency: {
      submitted_n: submittedCount,
      decided_n: decidedCount,
      min_threshold: minSampleSize,
      sufficient: submittedCount >= minSampleSize,
    },
    funnel: {
      total_tracked: scoped.length,
      prepared_only_count: preparedOnlyCount,
      excluded_non_submitted_count: excludedNonSubmittedCount,
      submitted_count: submittedCount,
      decided_count: decidedCount,
      pending_active_count: pendingActiveCount,
      silent_14d_count: silent14dCount,
      ever_interviewed_count: everInterviewedCount,
      ever_assessed_count: everAssessedCount,
      offer_count: offerCount,
      rejected_count: rejectedCount,
      withdrawn_count: withdrawnCount,
      positive_callbacks_count: positiveCallbacksCount,
      avg_match_score: avgMatchScore,
      rates: {
        callback_rate: computeSafeRate(positiveCallbacksCount, submittedCount, minSampleSize),
        decided_callback_rate: computeSafeRate(positiveCallbacksCount, decidedCount, minSampleSize),
        interview_rate: computeSafeRate(everInterviewedCount, submittedCount, minSampleSize),
        assessment_rate: computeSafeRate(everAssessedCount, submittedCount, minSampleSize),
        offer_rate: computeSafeRate(offerCount, submittedCount, minSampleSize),
        interview_to_offer_rate: computeSafeRate(offerCount, everInterviewedCount, minSampleSize),
      },
    },
    cv_performance: {
      by_cv_version: [...cvGroups.values()]
        .sort((a, b) => (b.submitted - a.submitted) || a.cv_version_id.localeCompare(b.cv_version_id))
        .map(formatCvBucket),
      tailored_vs_generic: {
        tailored: formatCohortSummary(tailoredCohort),
        generic: formatCohortSummary(genericCohort),
        unknown_count: unknownTailoringCount,
        comparable: tailoredCohort.submitted >= minSampleSize && genericCohort.submitted >= minSampleSize,
      },
      third_party_cv_excluded: thirdPartyCvExcluded,
    },
    source_performance: {
      causal_humility_note: 'Observational platform/channel differences reflect sample history only and do not establish ATS bias or causation.',
      by_platform: [...platformGroups.values()]
        .sort((a, b) => (b.submitted - a.submitted) || a.platform.localeCompare(b.platform))
        .map(g => formatSourceBucket(g, 'platform')),
      by_channel: [...channelGroups.values()]
        .sort((a, b) => (b.submitted - a.submitted) || a.source_channel.localeCompare(b.source_channel))
        .map(g => formatSourceBucket(g, 'source_channel')),
    },
    timing: {
      response_time: {
        sample_n: sortedResponseDeltas.length,
        sample_sufficient: sortedResponseDeltas.length >= minSampleSize,
        median_days: sortedResponseDeltas.length >= minSampleSize ? computeQuantileSorted(sortedResponseDeltas, 0.5) : null,
        p75_days: sortedResponseDeltas.length >= minSampleSize ? computeQuantileSorted(sortedResponseDeltas, 0.75) : null,
        invalid_timestamps_ignored: invalidTimestampsIgnored,
      },
      aging_buckets: agingBuckets,
      overdue_follow_ups: overdueFollowUps,
      activity: {
        daily: sortActivity(activityDaily),
        weekly: sortActivity(activityWeekly),
        monthly: sortActivity(activityMonthly),
      },
    },
    skills_summary: {
      top_skills: topSkills,
      skill_gaps: skillGaps,
    },
    isolation: {
      third_party_applications_excluded: thirdPartyAppsExcluded,
      third_party_cv_excluded: thirdPartyCvExcluded,
    },
    data_quality_warnings: dataQualityWarnings,
  };
}

export function buildCareerInsightArtifact(analytics) {
  const scanned = analytics.funnel.total_tracked;
  const applied = analytics.funnel.submitted_count;
  const matchRate = scanned > 0 ? Math.round((applied / scanned) * 10000) / 10000 : null;
  const artifact = {
    schema_version: '2.0',
    type: analytics.period_type,
    period: analytics.period,
    generated_at: analytics.computed_at,
    scanned,
    prepared: analytics.funnel.prepared_only_count,
    applied,
    match_rate: matchRate,
    avg_match_score: analytics.funnel.avg_match_score,
    top_skills: analytics.skills_summary.top_skills,
    skill_gaps: analytics.skills_summary.skill_gaps,
    recommendations: [],
    notion_synced: false,
    intelligence: {
      deterministic_facts: {
        funnel: analytics.funnel,
        cv_performance: analytics.cv_performance,
        source_performance: analytics.source_performance,
        timing: analytics.timing,
      },
      sample_sufficiency: analytics.sample_sufficiency,
      ai_interpretations: [],
      hypotheses: [],
      recommended_actions: [],
    },
  };
  const check = validateCareerInsights(artifact);
  if (!check.valid) {
    throw new Error(`Generated career insight artifact failed schema validation: ${check.errors.join('; ')}`);
  }
  return artifact;
}

function loadLocalLedgerAndCvVersions(root, home) {
  const logPath = path.join(root, 'logs', 'applications-log.json');
  const cvPath = path.join(root, 'logs', 'cv-versions.json');

  let records = [];
  if (fs.existsSync(logPath)) {
    refuseSymlink(logPath, root, home);
    const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    if (Array.isArray(parsed)) records = parsed;
    else if (isObj(parsed) && Array.isArray(parsed.applications)) records = parsed.applications;
    else throw new Error(`Unsupported JSON root in ${logPath}; expected an array of applications.`);
  }

  let cvRegistry = null;
  if (fs.existsSync(cvPath)) {
    refuseSymlink(cvPath, root, home);
    cvRegistry = JSON.parse(fs.readFileSync(cvPath, 'utf8'));
    const check = validateCvVersionsRegistry(cvRegistry);
    if (!check.valid) {
      throw new Error(`Invalid logs/cv-versions.json: ${check.errors.join('; ')}`);
    }
  }
  return { records, cvRegistry };
}

export function runCareerAnalyticsForWorkspace(root, { home = os.homedir(), period = 'all', write = false, nowIso = new Date().toISOString() } = {}) {
  const { records, cvRegistry } = loadLocalLedgerAndCvVersions(root, home);
  const analytics = computeCareerAnalytics(records, cvRegistry, { nowIso, period });
  const artifact = buildCareerInsightArtifact(analytics);

  let writtenPath = null;
  if (write) {
    const filename = artifact.type === 'all' ? 'all-time.json' : `${artifact.type}-${artifact.period}.json`;
    const outPath = path.join(root, 'logs', 'insights', filename);
    writeAtomic(outPath, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600, boundary: root, home });
    writtenPath = outPath;
  }

  return { analytics, artifact, written_path: writtenPath };
}

export function loadCareerSyncInputs(root, { home = os.homedir() } = {}) {
  const { records: applications, cvRegistry } = loadLocalLedgerAndCvVersions(root, home);

  const dailyRuns = [];
  const runsDir = path.join(root, 'logs', 'runs');
  if (fs.existsSync(runsDir)) {
    refuseSymlink(runsDir, root, home);
    const entries = fs.readdirSync(runsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const name of entries) {
      const fullPath = path.join(runsDir, name);
      refuseSymlink(fullPath, root, home);
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      dailyRuns.push(parsed);
    }
  }

  const insights = [];
  const insightsDir = path.join(root, 'logs', 'insights');
  if (fs.existsSync(insightsDir)) {
    refuseSymlink(insightsDir, root, home);
    const entries = fs.readdirSync(insightsDir).filter(f => f.endsWith('.json')).sort();
    for (const name of entries) {
      const fullPath = path.join(insightsDir, name);
      refuseSymlink(fullPath, root, home);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        continue;
      }
      if (isObj(parsed) && typeof parsed.type === 'string' && typeof parsed.period === 'string' && typeof parsed.generated_at === 'string') {
        insights.push(parsed);
      }
    }
  }

  return {
    applications,
    cvRegistry,
    dailyRuns,
    insights,
  };
}

export function summarizeCareerWorkspace(root, { home = os.homedir(), nowIso = new Date().toISOString() } = {}) {
  const { records, cvRegistry } = loadLocalLedgerAndCvVersions(root, home);
  const analytics = computeCareerAnalytics(records, cvRegistry, { nowIso, period: 'all' });

  // Stage 3 Decision A: Read logs/sync-state.json first as authoritative sync state;
  // fall back to legacy notion_sync / notion_synced fields only when absent from sync-state.json.
  let syncStateRecords = null;
  const syncStatePath = path.join(root, 'logs', 'sync-state.json');
  if (fs.existsSync(syncStatePath)) {
    refuseSymlink(syncStatePath, root, home);
    const parsedState = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
    if (!isObj(parsedState) || parsedState.schema_version !== '1.0' || !isObj(parsedState.records)) {
      throw new Error(`Invalid logs/sync-state.json format at ${syncStatePath}.`);
    }
    syncStateRecords = parsedState.records;
  }

  let activeInterviews = 0;
  let activeAssessments = 0;
  let pendingNotionSync = 0;

  for (const r of records) {
    if (!isObj(r) || r.provenance?.third_party_subject === true) continue;
    const st = normalizeStatus(r.status);
    if (!st.valid) continue;
    if (Array.isArray(r.interviews) && r.interviews.length > 0) {
      activeInterviews += r.interviews.filter(iv => iv?.status === 'invited' || iv?.status === 'scheduled' || iv?.status === 'rescheduled').length;
    } else if (st.canonical === 'interview') {
      activeInterviews++;
    }
    if (Array.isArray(r.assessments) && r.assessments.length > 0) {
      activeAssessments += r.assessments.filter(a => a?.status === 'assigned' || a?.status === 'in_progress').length;
    } else if (st.canonical === 'assessment') {
      activeAssessments++;
    }
    const isSubmitted = SUBMITTED_STATUS_SET.has(st.canonical) && r.submission_uncertain !== true;
    if (isSubmitted) {
      const appId = isUsableJobId(r.job_id) ? computeApplicationId(r.job_id) : null;
      const stateKey = appId ? `applications::${appId}` : null;
      const syncEntry = (syncStateRecords && stateKey && Object.prototype.hasOwnProperty.call(syncStateRecords, stateKey))
        ? syncStateRecords[stateKey]
        : null;
      const isSynced = syncEntry !== null
        ? syncEntry?.state === 'synced'
        : (r.notion_sync?.state === 'synced' || (r.notion_synced === true && isNonEmptyString(r.notion_page_id)));
      if (!isSynced) pendingNotionSync++;
    }
  }

  return {
    root,
    computed_at: nowIso,
    sample_sufficiency: analytics.sample_sufficiency,
    funnel: analytics.funnel,
    active_interviews: activeInterviews,
    active_assessments: activeAssessments,
    overdue_follow_ups_count: analytics.timing.overdue_follow_ups.length,
    overdue_follow_ups: analytics.timing.overdue_follow_ups.slice(0, 10),
    aging_buckets: analytics.timing.aging_buckets,
    pending_notion_sync_count: pendingNotionSync,
    sync_state_source: syncStateRecords !== null ? 'sync_state' : 'legacy_fallback',
  };
}
