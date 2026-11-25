// Zero-dependency Career Intelligence core ledger validator, normalizer,
// CV version registry, and backup-first idempotent migration engine.
// Uses Node.js built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { isObj, isWithinDir, refuseSymlink, writeAtomic, stripHtmlBlocks, stripMarkupTags } from './fs-safety.mjs';

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

    const isThirdPartyRec = rec.provenance?.third_party_subject === true;
    if (typeof rec.screenshot === 'string') {
      const scCheck = validateSafeWorkspaceRelativePath(rec.screenshot, {
        allowThirdParty: isThirdPartyRec,
        label: `${label}.screenshot`,
      });
      if (!scCheck.valid) errors.push(scCheck.error);
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
        for (const relKey of ['tailored_folder_rel', 'tailoring_notes_rel']) {
          if (typeof rec.cv_tailoring[relKey] === 'string') {
            const pCheck = validateSafeWorkspaceRelativePath(rec.cv_tailoring[relKey], {
              allowThirdParty: isThirdPartyRec,
              label: `${label}.cv_tailoring.${relKey}`,
            });
            if (!pCheck.valid) errors.push(pCheck.error);
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
          if (!isNullableString(iv.dossier_rel)) {
            errors.push(`${ivLabel}.dossier_rel must be a string or null.`);
          } else if (typeof iv.dossier_rel === 'string') {
            const dCheck = validateSafeWorkspaceRelativePath(iv.dossier_rel, {
              allowThirdParty: isThirdPartyRec,
              label: `${ivLabel}.dossier_rel`,
            });
            if (!dCheck.valid) errors.push(dCheck.error);
          }
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
          if (!isNullableString(asmt.blueprint_rel)) {
            errors.push(`${aLabel}.blueprint_rel must be a string or null.`);
          } else if (typeof asmt.blueprint_rel === 'string') {
            const bCheck = validateSafeWorkspaceRelativePath(asmt.blueprint_rel, {
              allowThirdParty: isThirdPartyRec,
              label: `${aLabel}.blueprint_rel`,
            });
            if (!bCheck.valid) errors.push(bCheck.error);
          }
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
        } else if (typeof rec.follow_up.draft_rel === 'string') {
          const drCheck = validateSafeWorkspaceRelativePath(rec.follow_up.draft_rel, {
            allowThirdParty: isThirdPartyRec,
            label: `${label}.follow_up.draft_rel`,
          });
          if (!drCheck.valid) errors.push(drCheck.error);
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
    if (typeof v.local_ref_rel === 'string' && v.local_ref_rel.length > 0) {
      const refCheck = validateSafeWorkspaceRelativePath(v.local_ref_rel, {
        allowThirdParty: true,
        label: `${label}.local_ref_rel`,
      });
      if (!refCheck.valid) {
        errors.push(refCheck.error);
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
  const trimmed = relPath.trim();
  if (!trimmed) return false;
  const slashNorm = trimmed.replace(/\\/g, '/').toLowerCase();
  const posixNorm = path.posix.normalize(slashNorm);
  return /(?:^|\/)logs\/resumes\/cv-[^/]+/.test(slashNorm) || /(?:^|\/)logs\/resumes\/cv-[^/]+/.test(posixNorm);
}

export function validateSafeWorkspaceRelativePath(relPath, {
  allowThirdParty = true,
  label = 'relative path',
} = {}) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return { valid: false, normalized: null, error: `${label} must be a non-empty relative path string.` };
  }
  if (/[\x00-\x1f\x7f"<>|?*]/.test(relPath)) {
    return { valid: false, normalized: null, error: `${label} contains forbidden control, quote, or wildcard characters.` };
  }
  const trimmed = relPath.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:/.test(trimmed)) {
    return { valid: false, normalized: null, error: `${label} must be a workspace-relative path (absolute, drive-letter, or UNC paths are forbidden): "${relPath}".` };
  }
  if (trimmed.includes(':')) {
    return { valid: false, normalized: null, error: `${label} must be a clean workspace-relative path (colon/alternate data stream syntax is forbidden): "${relPath}".` };
  }
  const slashNorm = trimmed.replace(/\\/g, '/');
  if (slashNorm.startsWith('/') || slashNorm.includes('//')) {
    return { valid: false, normalized: null, error: `${label} contains invalid leading or empty path segments: "${relPath}".` };
  }
  const withoutTrailingSlash = slashNorm.length > 1 && slashNorm.endsWith('/') ? slashNorm.slice(0, -1) : slashNorm;
  const segments = withoutTrailingSlash.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      return { valid: false, normalized: null, error: `${label} must not contain "." or ".." traversal segments: "${relPath}".` };
    }
  }
  const normalized = segments.join('/');
  if (!allowThirdParty && isThirdPartyCvPath(normalized)) {
    return { valid: false, normalized: null, error: `${label} references third-party CV path "${normalized}", which is isolated from owner records.` };
  }
  return { valid: true, normalized, error: null };
}

export function isSafeWorkspaceRelativePath(relPath, options = {}) {
  return validateSafeWorkspaceRelativePath(relPath, options).valid;
}

export function classifyCvRegistryEntryOwnership(entry, byId) {
  if (!isObj(entry) || !isNonEmptyString(entry.cv_version_id)) {
    return { isOwner: false, reason: 'malformed_cv_entry' };
  }
  const visited = new Set();
  let current = entry;

  while (current !== null) {
    if (!isObj(current) || !isNonEmptyString(current.cv_version_id)) {
      return { isOwner: false, reason: 'malformed_cv_entry' };
    }
    const id = current.cv_version_id.trim();
    if (visited.has(id)) {
      return { isOwner: false, reason: 'cyclic_cv_ancestry' };
    }
    visited.add(id);

    if (current.owner_scope !== 'owner') {
      return { isOwner: false, reason: 'third_party_owner_scope' };
    }
    if (current.local_ref_rel !== undefined && current.local_ref_rel !== null) {
      if (typeof current.local_ref_rel !== 'string') {
        return { isOwner: false, reason: 'third_party_cv_path' };
      }
      if (current.local_ref_rel.length > 0) {
        if (
          isThirdPartyCvPath(current.local_ref_rel) ||
          !validateSafeWorkspaceRelativePath(current.local_ref_rel, { allowThirdParty: false }).valid
        ) {
          return { isOwner: false, reason: 'third_party_cv_path' };
        }
      }
    }

    if (current.base_cv_version_id === undefined || current.base_cv_version_id === null || current.base_cv_version_id === '') {
      break;
    }
    if (typeof current.base_cv_version_id !== 'string' || current.base_cv_version_id.trim().length === 0) {
      return { isOwner: false, reason: 'malformed_base_cv_version_id' };
    }
    const nextId = current.base_cv_version_id.trim();
    const parent = byId instanceof Map ? byId.get(nextId) : null;
    if (!parent) {
      return { isOwner: false, reason: 'missing_base_cv_version_entry' };
    }
    current = parent;
  }

  return { isOwner: true, reason: null };
}

export function classifyApplicationOwnership(raw, cvVersionsRegistry = null) {
  if (cvVersionsRegistry !== null && cvVersionsRegistry !== undefined) {
    const regCheck = validateCvVersionsRegistry(cvVersionsRegistry);
    if (!regCheck.valid) {
      throw new Error(`Invalid CV versions registry: ${regCheck.errors.join('; ')}`);
    }
  }

  if (!isObj(raw)) {
    return { isOwner: false, isThirdPartyOrAmbiguous: false, reason: 'not_an_object' };
  }

  if (raw.provenance !== undefined && raw.provenance !== null) {
    if (!isObj(raw.provenance)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'malformed_provenance' };
    }
    if (raw.provenance.third_party_subject === true) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_provenance_flag' };
    }
    if (raw.provenance.third_party_subject !== undefined && raw.provenance.third_party_subject !== false) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'ambiguous_provenance_flag' };
    }
  }

  const isUnsafeOrThirdPartyRel = val => {
    if (typeof val !== 'string') return true;
    if (val.length === 0) return false;
    if (val.trim().length === 0) return true;
    return isThirdPartyCvPath(val) || !validateSafeWorkspaceRelativePath(val, { allowThirdParty: false }).valid;
  };

  if (raw.cv_tailoring !== undefined && raw.cv_tailoring !== null) {
    if (!isObj(raw.cv_tailoring)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'malformed_cv_tailoring' };
    }
    for (const relField of ['tailored_folder_rel', 'tailoring_notes_rel']) {
      const relVal = raw.cv_tailoring[relField];
      if (relVal !== undefined && relVal !== null) {
        if (isUnsafeOrThirdPartyRel(relVal)) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: `third_party_or_malformed_${relField}` };
        }
      }
    }
  }

  if (raw.screenshot !== undefined && raw.screenshot !== null) {
    if (isUnsafeOrThirdPartyRel(raw.screenshot)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_or_malformed_screenshot' };
    }
  }
  if (isObj(raw.follow_up) && raw.follow_up.draft_rel !== undefined && raw.follow_up.draft_rel !== null) {
    if (isUnsafeOrThirdPartyRel(raw.follow_up.draft_rel)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_or_malformed_draft_rel' };
    }
  }
  if (Array.isArray(raw.interviews)) {
    for (const iv of raw.interviews) {
      if (isObj(iv) && iv.dossier_rel !== undefined && iv.dossier_rel !== null) {
        if (isUnsafeOrThirdPartyRel(iv.dossier_rel)) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_or_malformed_dossier_rel' };
        }
      }
    }
  }
  if (Array.isArray(raw.assessments)) {
    for (const asmt of raw.assessments) {
      if (isObj(asmt) && asmt.blueprint_rel !== undefined && asmt.blueprint_rel !== null) {
        if (isUnsafeOrThirdPartyRel(asmt.blueprint_rel)) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_or_malformed_blueprint_rel' };
        }
      }
    }
  }

  let cvId = null;
  if (raw.cv_version_id !== undefined && raw.cv_version_id !== null) {
    if (typeof raw.cv_version_id !== 'string' || (raw.cv_version_id.length > 0 && raw.cv_version_id.trim().length === 0)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'malformed_cv_version_id' };
    }
    if (raw.cv_version_id.trim().length > 0) {
      cvId = raw.cv_version_id.trim();
      if (isThirdPartyCvPath(cvId)) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_cv_version_id' };
      }
    }
  }

  let baseCvId = null;
  if (isObj(raw.cv_tailoring) && raw.cv_tailoring.base_cv_version_id !== undefined && raw.cv_tailoring.base_cv_version_id !== null) {
    const rawBase = raw.cv_tailoring.base_cv_version_id;
    if (typeof rawBase !== 'string' || (rawBase.length > 0 && rawBase.trim().length === 0)) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'malformed_base_cv_version_id' };
    }
    if (rawBase.trim().length > 0) {
      baseCvId = rawBase.trim();
      if (isThirdPartyCvPath(baseCvId)) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'third_party_base_cv_version_id' };
      }
    }
  }

  if (cvVersionsRegistry === null || cvVersionsRegistry === undefined) {
    if (cvId !== null || baseCvId !== null) {
      return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'missing_cv_versions_registry' };
    }
    return { isOwner: true, isThirdPartyOrAmbiguous: false, reason: null };
  }

  if (cvVersionsRegistry !== null && cvVersionsRegistry !== undefined) {
    const byId = new Map();
    for (const v of cvVersionsRegistry.versions) {
      if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
        byId.set(v.cv_version_id.trim(), v);
      }
    }

    const appId = isUsableJobId(raw.job_id)
      ? computeApplicationId(raw.job_id)
      : (isNonEmptyString(raw.application_id) ? raw.application_id.trim() : null);
    const jobKey = isUsableJobId(raw.job_id) ? normalizeJobIdKey(raw.job_id) : null;
    for (const v of cvVersionsRegistry.versions) {
      if (!classifyCvRegistryEntryOwnership(v, byId).isOwner) {
        if (
          (appId && Array.isArray(v.application_ids) && v.application_ids.includes(appId)) ||
          (jobKey && isUsableJobId(v.tailoring_metadata?.target_job_id) && normalizeJobIdKey(v.tailoring_metadata.target_job_id) === jobKey)
        ) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'linked_from_third_party_cv_registry_entry' };
        }
      }
    }

    if (cvId !== null) {
      const primary = byId.get(cvId);
      if (!primary) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'missing_cv_version_in_registry' };
      }
      const ownCheck = classifyCvRegistryEntryOwnership(primary, byId);
      if (!ownCheck.isOwner) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: ownCheck.reason };
      }
      if (isObj(raw.cv_tailoring) && typeof raw.cv_tailoring.is_tailored === 'boolean') {
        const expectedKind = raw.cv_tailoring.is_tailored ? 'tailored' : 'generic';
        if (primary.kind !== expectedKind) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'conflicting_cv_kind' };
        }
      }
    }

    if (baseCvId !== null) {
      const baseEntry = byId.get(baseCvId);
      if (!baseEntry) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'missing_base_cv_version_in_registry' };
      }
      const baseCheck = classifyCvRegistryEntryOwnership(baseEntry, byId);
      if (!baseCheck.isOwner) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: baseCheck.reason };
      }
      if (cvId !== null) {
        const primary = byId.get(cvId);
        const regBase = isNonEmptyString(primary?.base_cv_version_id) ? primary.base_cv_version_id.trim() : null;
        if ((regBase !== null && regBase !== baseCvId) || (regBase === null && baseCvId !== primary.cv_version_id.trim())) {
          return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'contradicting_base_cv_version_id' };
        }
      }
    }
  }

  return { isOwner: true, isThirdPartyOrAmbiguous: false, reason: null };
}

export function isOwnerApplicationRecord(raw, cvVersionsRegistry = null) {
  return classifyApplicationOwnership(raw, cvVersionsRegistry).isOwner;
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
  if (entry.local_ref_rel !== undefined && entry.local_ref_rel !== null && entry.local_ref_rel !== '') {
    const refCheck = validateSafeWorkspaceRelativePath(entry.local_ref_rel, {
      allowThirdParty: false,
      label: 'CV local_ref_rel',
    });
    if (!refCheck.valid) {
      throw new Error(`Refusing unsafe CV local_ref_rel: ${refCheck.error}`);
    }
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

export function validateSessionCheckpoint(doc) {
  const errors = [];
  const warnings = [];
  if (!isObj(doc)) {
    return { valid: false, errors: ['Session checkpoint document must be a JSON object.'], warnings };
  }
  checkAllowedKeys(doc, SESSION_CHECKPOINT_KEYS, 'session_checkpoint', errors);

  if (doc.kind !== 'session_checkpoint') {
    errors.push('session_checkpoint.kind must be "session_checkpoint".');
  }
  if (doc.version !== 1) {
    errors.push('session_checkpoint.version must be 1.');
  }
  if (typeof doc.run_id !== 'string' || !RUN_ID_RE.test(doc.run_id)) {
    errors.push('session_checkpoint.run_id must match YYYY-MM-DD.');
  }
  if (!isValidIsoDateTime(doc.updated_at)) {
    errors.push('session_checkpoint.updated_at must be a valid ISO-8601 date-time.');
  }
  if (!RUN_PHASE_SET.has(doc.phase)) {
    errors.push(`session_checkpoint.phase "${doc.phase}" is invalid. Expected one of: ${RUN_PHASES.join(', ')}.`);
  }
  if (!WORKFLOW_MODE_SET.has(doc.workflow_mode)) {
    errors.push(`session_checkpoint.workflow_mode "${doc.workflow_mode}" is invalid. Expected one of: ${WORKFLOW_MODES.join(', ')}.`);
  }
  if (typeof doc.dry_run !== 'boolean') {
    errors.push('session_checkpoint.dry_run must be a boolean.');
  }
  if (doc.approval_mode !== 'approve_before_submit') {
    errors.push('session_checkpoint.approval_mode must be "approve_before_submit".');
  }
  if (doc.submission_authorized !== undefined && doc.submission_authorized !== false) {
    errors.push('session_checkpoint.submission_authorized must always be false; checkpoints never authorize submission.');
  }
  if (doc.approval_expired_on_resume !== undefined && typeof doc.approval_expired_on_resume !== 'boolean') {
    errors.push('session_checkpoint.approval_expired_on_resume must be a boolean when provided.');
  }

  if (!isObj(doc.caps)) {
    errors.push('session_checkpoint.caps must be an object.');
  } else {
    checkAllowedKeys(doc.caps, SESSION_CHECKPOINT_CAPS_KEYS, 'session_checkpoint.caps', errors);
    for (const k of ['effective_daily_cap', 'applied_today', 'reserved_unresolved']) {
      if (!Number.isInteger(doc.caps[k]) || doc.caps[k] < 0) {
        errors.push(`session_checkpoint.caps.${k} must be an integer >= 0.`);
      }
    }
    if (!isObj(doc.caps.per_platform_applied)) {
      errors.push('session_checkpoint.caps.per_platform_applied must be an object.');
    } else {
      for (const [plat, cnt] of Object.entries(doc.caps.per_platform_applied)) {
        if (!isNonEmptyString(plat) || !Number.isInteger(cnt) || cnt < 0) {
          errors.push(`session_checkpoint.caps.per_platform_applied["${plat}"] must be an integer >= 0.`);
        }
      }
    }
  }

  const processedKeys = new Set();
  if (!Array.isArray(doc.processed_job_ids)) {
    errors.push('session_checkpoint.processed_job_ids must be an array.');
  } else {
    doc.processed_job_ids.forEach((id, idx) => {
      if (!isUsableJobId(id)) {
        errors.push(`session_checkpoint.processed_job_ids[${idx}] must be a non-empty job_id string.`);
        return;
      }
      const key = normalizeJobIdKey(id);
      if (processedKeys.has(key)) {
        errors.push(`session_checkpoint.processed_job_ids[${idx}] is a duplicate of "${id}".`);
      }
      processedKeys.add(key);
    });
  }

  const queueKeys = new Set();
  if (!Array.isArray(doc.queue)) {
    errors.push('session_checkpoint.queue must be an array.');
  } else {
    if ((doc.phase === 'finished' || doc.phase === 'aborted') && doc.queue.length > 0) {
      errors.push(`session_checkpoint.queue must be empty when phase is "${doc.phase}".`);
    }
    doc.queue.forEach((id, idx) => {
      if (!isUsableJobId(id)) {
        errors.push(`session_checkpoint.queue[${idx}] must be a non-empty job_id string.`);
        return;
      }
      const key = normalizeJobIdKey(id);
      if (queueKeys.has(key)) {
        errors.push(`session_checkpoint.queue[${idx}] is a duplicate of "${id}".`);
      }
      if (processedKeys.has(key)) {
        errors.push(`session_checkpoint.queue[${idx}] ("${id}") cannot also appear in processed_job_ids.`);
      }
      queueKeys.add(key);
    });
  }

  if (!Array.isArray(doc.awaiting_owner)) {
    errors.push('session_checkpoint.awaiting_owner must be an array.');
  } else {
    doc.awaiting_owner.forEach((item, idx) => {
      const label = `session_checkpoint.awaiting_owner[${idx}]`;
      if (!isObj(item)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      checkAllowedKeys(item, AWAITING_OWNER_ITEM_KEYS, label, errors);
      if (!isUsableJobId(item.job_id)) {
        errors.push(`${label}.job_id must be a non-empty job_id string.`);
      }
      if (!isNonEmptyString(item.question)) {
        errors.push(`${label}.question must be a non-empty string.`);
      } else if (CHECKPOINT_SECRET_TOKEN_RE.test(item.question)) {
        errors.push(`${label}.question contains a prohibited credential or token pattern.`);
      }
    });
  }

  if (!isNullableString(doc.batch_selection)) {
    errors.push('session_checkpoint.batch_selection must be a string or null.');
  } else if (typeof doc.batch_selection === 'string' && CHECKPOINT_SECRET_TOKEN_RE.test(doc.batch_selection)) {
    errors.push('session_checkpoint.batch_selection contains a prohibited credential or token pattern.');
  }

  if (!Number.isInteger(doc.consecutive_errors) || doc.consecutive_errors < 0) {
    errors.push('session_checkpoint.consecutive_errors must be an integer >= 0.');
  }
  if (typeof doc.next_action !== 'string') {
    errors.push('session_checkpoint.next_action must be a string.');
  } else if (CHECKPOINT_SECRET_TOKEN_RE.test(doc.next_action)) {
    errors.push('session_checkpoint.next_action contains a prohibited credential or token pattern.');
  }
  if (typeof doc.notes !== 'string') {
    errors.push('session_checkpoint.notes must be a string.');
  } else if (CHECKPOINT_SECRET_TOKEN_RE.test(doc.notes)) {
    errors.push('session_checkpoint.notes contains a prohibited credential or token pattern.');
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

  const byId = new Map();
  for (const v of registry.versions) {
    if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
      byId.set(v.cv_version_id.trim(), v);
    }
  }

  const linkedCounts = new Map();
  if (fs.existsSync(logPath)) {
    refuseSymlink(logPath, root, home);
    const rawApps = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const apps = Array.isArray(rawApps) ? rawApps : (isObj(rawApps) && Array.isArray(rawApps.applications) ? rawApps.applications : []);
    for (const app of apps) {
      if (!isOwnerApplicationRecord(app, registryExists ? registry : null)) continue;
      if (isNonEmptyString(app.cv_version_id)) {
        linkedCounts.set(app.cv_version_id.trim(), (linkedCounts.get(app.cv_version_id.trim()) || 0) + 1);
      }
    }
  }

  const ownerVersions = [];
  let thirdPartyExcluded = 0;
  for (const v of registry.versions) {
    if (!classifyCvRegistryEntryOwnership(v, byId).isOwner) {
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

  // Build owner-only CV version metadata lookup (strictly validating registry and excluding third-party CVs + third-party ancestry)
  const cvMetaMap = new Map();
  let thirdPartyCvExcluded = 0;
  if (cvVersionsRegistry !== null && cvVersionsRegistry !== undefined) {
    const regCheck = validateCvVersionsRegistry(cvVersionsRegistry);
    if (!regCheck.valid) {
      throw new Error(`Invalid CV versions registry in computeCareerAnalytics: ${regCheck.errors.join('; ')}`);
    }
    const byId = new Map();
    for (const v of cvVersionsRegistry.versions) {
      if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
        byId.set(v.cv_version_id.trim(), v);
      }
    }
    for (const v of cvVersionsRegistry.versions) {
      if (!isObj(v) || !isNonEmptyString(v.cv_version_id)) continue;
      if (!classifyCvRegistryEntryOwnership(v, byId).isOwner) {
        thirdPartyCvExcluded++;
        continue;
      }
      cvMetaMap.set(v.cv_version_id.trim(), {
        cv_version_id: v.cv_version_id.trim(),
        label: v.label || v.cv_version_id.trim(),
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
    const own = classifyApplicationOwnership(raw, cvVersionsRegistry);
    if (!own.isOwner) {
      if (own.isThirdPartyOrAmbiguous) {
        thirdPartyAppsExcluded++;
        if (own.reason !== 'third_party_provenance_flag') {
          dataQualityWarnings.push(`records[${i}]: excluded non-owner or unverified CV attribution record (${own.reason}).`);
        }
      }
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
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch (err) {
        throw new Error(`Invalid JSON in daily run file "${fullPath}": ${err.message}`);
      }
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
    if (!isOwnerApplicationRecord(r, cvRegistry)) continue;
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

export function listOwnerApplicationsForKanban(root, { home = os.homedir(), nowIso = new Date().toISOString() } = {}) {
  const resolvedRoot = path.resolve(root);
  const logPath = path.join(resolvedRoot, 'logs', 'applications-log.json');
  const ledgerExists = fs.existsSync(logPath);
  const { records, cvRegistry } = loadLocalLedgerAndCvVersions(resolvedRoot, home);

  const columns = {
    triage: [],
    prepared: [],
    applied: [],
    interview_assessment: [],
    offer: [],
    closed: [],
  };
  const columnDefs = [
    { id: 'triage', label: 'Triage & Review', statuses: ['discovered', 'needs_review'] },
    { id: 'prepared', label: 'Prepared & Dry Run', statuses: ['prepared', 'dry_run'] },
    { id: 'applied', label: 'Applied', statuses: ['applied'] },
    { id: 'interview_assessment', label: 'Interview & Assessment', statuses: ['interview', 'assessment'] },
    { id: 'offer', label: 'Offer', statuses: ['offer'] },
    { id: 'closed', label: 'Closed & Skipped', statuses: ['rejected', 'withdrawn', 'skipped', 'failed', 'aborted'] },
  ];

  const warnings = [];
  const items = [];
  let thirdPartyExcluded = 0;

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    if (!isObj(raw)) {
      warnings.push(`records[${i}]: skipped non-object entry.`);
      continue;
    }
    const own = classifyApplicationOwnership(raw, cvRegistry);
    if (!own.isOwner) {
      if (own.isThirdPartyOrAmbiguous) {
        thirdPartyExcluded++;
      }
      continue;
    }
    const st = normalizeStatus(raw.status);
    if (!st.valid) {
      warnings.push(`records[${i}] (${raw.job_id || 'no-id'}): skipped unrecognized status "${raw.status}".`);
      continue;
    }
    const rawScore = raw.match_score !== null && raw.match_score !== undefined ? raw.match_score : raw.score;
    const numScore = rawScore !== null && rawScore !== undefined && rawScore !== '' ? Number(rawScore) : null;
    const matchScore = numScore !== null && Number.isFinite(numScore) && numScore > 0 && numScore <= 10
      ? round1(numScore)
      : null;
    const rawUrl = typeof raw.url === 'string' ? raw.url.trim() : '';
    const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    const appId = isNonEmptyString(raw.application_id)
      ? raw.application_id.trim()
      : (isUsableJobId(raw.job_id) ? computeApplicationId(raw.job_id) : `row_${i}`);
    const hasVerifiedReceipt = Boolean(
      raw.provenance?.receipt_verified === true ||
      (typeof raw.notes === 'string' && VERIFIED_RECEIPT_RE.test(raw.notes)),
    );

    const card = {
      application_id: appId,
      job_id: isNonEmptyString(raw.job_id) ? raw.job_id.trim() : null,
      company: isNonEmptyString(raw.company) ? raw.company.trim() : 'Unknown Employer',
      role_title: isNonEmptyString(raw.role_title)
        ? raw.role_title.trim()
        : (isNonEmptyString(raw.title) ? raw.title.trim() : (isNonEmptyString(raw.role) ? raw.role.trim() : 'Untitled Role')),
      platform: isNonEmptyString(raw.platform) ? raw.platform.trim().toLowerCase() : 'unknown',
      source_channel: classifySourceChannel(raw),
      work_mode: isNonEmptyString(raw.work_mode) ? raw.work_mode.trim().toLowerCase() : 'unknown',
      status: st.canonical,
      raw_status: isNonEmptyString(raw.status) ? raw.status.trim() : st.canonical,
      submission_uncertain: Boolean(raw.submission_uncertain),
      match_score: matchScore,
      applied_at: raw.applied_at || raw.date || null,
      discovered_at: raw.discovered_at || null,
      updated_at: raw.updated_at || null,
      cv_version_id: isNonEmptyString(raw.cv_version_id) ? raw.cv_version_id.trim() : null,
      resume_folder: isNonEmptyString(raw.resume_folder) ? raw.resume_folder.trim() : null,
      url: safeUrl,
      has_verified_receipt: hasVerifiedReceipt,
      interviews: Array.isArray(raw.interviews) ? raw.interviews : [],
      assessments: Array.isArray(raw.assessments) ? raw.assessments : [],
      follow_up: isObj(raw.follow_up) ? raw.follow_up : null,
      stage_history: Array.isArray(raw.stage_history) ? raw.stage_history : [],
      matched_skills: Array.isArray(raw.matched_skills) ? raw.matched_skills : [],
      true_gaps: Array.isArray(raw.true_gaps) ? raw.true_gaps : (Array.isArray(raw.missing_skills) ? raw.missing_skills : []),
      notes: typeof raw.notes === 'string' ? raw.notes : null,
    };

    items.push(card);
    if (st.canonical === 'discovered' || st.canonical === 'needs_review') columns.triage.push(card);
    else if (st.canonical === 'prepared' || st.canonical === 'dry_run') columns.prepared.push(card);
    else if (st.canonical === 'applied') columns.applied.push(card);
    else if (st.canonical === 'interview' || st.canonical === 'assessment') columns.interview_assessment.push(card);
    else if (st.canonical === 'offer') columns.offer.push(card);
    else columns.closed.push(card);
  }

  const sortNewestFirst = (a, b) => {
    const ta = Date.parse(a.updated_at || a.applied_at || a.discovered_at || '') || 0;
    const tb = Date.parse(b.updated_at || b.applied_at || b.discovered_at || '') || 0;
    if (tb !== ta) return tb - ta;
    return String(a.application_id).localeCompare(String(b.application_id));
  };
  items.sort(sortNewestFirst);
  for (const key of Object.keys(columns)) {
    columns[key].sort(sortNewestFirst);
  }

  return {
    root: resolvedRoot,
    computed_at: nowIso,
    ledger_exists: ledgerExists,
    total_owner_records: items.length,
    third_party_excluded: thirdPartyExcluded,
    canonical_statuses: CANONICAL_STATUSES,
    column_definitions: columnDefs,
    columns,
    items,
    warnings,
  };
}

// ================================================================================
// Stage 5 (T11): Ledger Lock, Atomic Persistence, Lifecycle Write-Engine,
// CV Registration & Linking Transaction, and Pre-Submit Integrity Gate
// ================================================================================

export const LEDGER_LOCK_FILENAME = '.ledger.lock';
export const LEDGER_TX_FILENAME = '.ledger-tx.json';
export const DEFAULT_LEDGER_STALE_LOCK_AGE_MS = 15 * 60 * 1000; // 15 minutes
export const DEDUP_WINDOW_DAYS = 60;
export const MAX_SKIP_REASON_LEN = 160;
export const MAX_RECEIPT_LEN = 160;

export const NON_SUBMITTED_RECORD_STATUSES = Object.freeze([
  'discovered',
  'prepared',
  'dry_run',
  'skipped',
  'needs_review',
  'failed',
  'aborted',
]);
const NON_SUBMITTED_RECORD_STATUS_SET = new Set(NON_SUBMITTED_RECORD_STATUSES);

export const ALLOWED_STAGE_TRANSITIONS = Object.freeze({
  applied: Object.freeze(['interview', 'assessment', 'offer', 'rejected', 'withdrawn']),
  interview: Object.freeze(['interview', 'assessment', 'offer', 'rejected', 'withdrawn']),
  assessment: Object.freeze(['interview', 'assessment', 'offer', 'rejected', 'withdrawn']),
  offer: Object.freeze(['offer', 'rejected', 'withdrawn']),
  rejected: Object.freeze([]),
  withdrawn: Object.freeze([]),
});

export const SKIP_REASONS = Object.freeze([
  'ghost_or_expired',
  'mismatch',
  'dealbreaker',
  'blacklisted_employer',
  'duplicate_cross_channel',
  'below_min_match_score',
]);
const SKIP_REASON_SET = new Set(SKIP_REASONS);

export const CAREER_WRITE_SUBCOMMANDS = Object.freeze([
  'record',
  'reserve',
  'confirm-submit',
  'transition',
  'skip',
  'cv-register',
  'lock-status',
  'release-stale-lock',
  'recover-tx',
  'run-start',
  'run-triage',
  'run-enqueue',
  'prepare',
  'run-checkpoint',
  'run-resume',
  'run-finish',
  'next',
]);

export const RUN_PHASES = Object.freeze([
  'readiness',
  'discovery',
  'triage',
  'awaiting_owner',
  'applying',
  'logging',
  'reporting',
  'finished',
  'aborted',
]);
const RUN_PHASE_SET = new Set(RUN_PHASES);

export const WORKFLOW_MODES = Object.freeze([
  'batch_review_first',
  'direct_auto',
]);
const WORKFLOW_MODE_SET = new Set(WORKFLOW_MODES);

const SESSION_CHECKPOINT_KEYS = new Set([
  'kind',
  'version',
  'run_id',
  'updated_at',
  'phase',
  'workflow_mode',
  'dry_run',
  'approval_mode',
  'submission_authorized',
  'approval_expired_on_resume',
  'caps',
  'processed_job_ids',
  'queue',
  'awaiting_owner',
  'batch_selection',
  'consecutive_errors',
  'next_action',
  'notes',
]);
const SESSION_CHECKPOINT_CAPS_KEYS = new Set([
  'effective_daily_cap',
  'applied_today',
  'reserved_unresolved',
  'per_platform_applied',
]);
const AWAITING_OWNER_ITEM_KEYS = new Set(['job_id', 'question']);
const CHECKPOINT_SECRET_TOKEN_RE = /\b(?:ntn_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|li_at=|session_cookie=)\b/i;

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

function assertWorkspacePathSafe(root, targetPath, { home = os.homedir(), label = 'path' } = {}) {
  if (!isNonEmptyString(root)) {
    throw new Error('Workspace root path must be a non-empty string.');
  }
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);
  if (!isWithinDir(resolvedTarget, resolvedRoot)) {
    throw new Error(`Refusing ${label} outside workspace boundary: "${targetPath}"`);
  }
  refuseSymlink(resolvedTarget, resolvedRoot, home);
  return resolvedTarget;
}

function assertOptionalSafeRelativeWorkspacePath(root, rawRelPath, {
  home = os.homedir(),
  allowThirdParty = false,
  label = 'relative path',
} = {}) {
  if (rawRelPath === undefined || rawRelPath === null) return rawRelPath;
  const check = validateSafeWorkspaceRelativePath(rawRelPath, { allowThirdParty, label });
  if (!check.valid) {
    throw new Error(check.error);
  }
  assertWorkspacePathSafe(root, check.normalized, { home, label });
  return check.normalized;
}

function resolveSafeQueueRelativePath(root, candidateRel, fallbackRel, {
  home = os.homedir(),
  allowThirdParty = false,
} = {}) {
  if (isNonEmptyString(candidateRel)) {
    const check = validateSafeWorkspaceRelativePath(candidateRel, { allowThirdParty });
    if (check.valid) {
      try {
        assertWorkspacePathSafe(root, check.normalized, { home });
        return check.normalized;
      } catch {
        // Fall back to canonical safe path if symlink or boundary violation is detected
      }
    }
  }
  return fallbackRel;
}

function getLedgerLockPath(root) {
  if (!isNonEmptyString(root)) {
    throw new Error('Workspace root path must be a non-empty string.');
  }
  return path.join(path.resolve(root), 'logs', LEDGER_LOCK_FILENAME);
}

function getLedgerTxPath(root) {
  if (!isNonEmptyString(root)) {
    throw new Error('Workspace root path must be a non-empty string.');
  }
  return path.join(path.resolve(root), 'logs', LEDGER_TX_FILENAME);
}

function acquireLedgerLock(root, { home = os.homedir(), nowIso = new Date().toISOString() } = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`acquireLedgerLock: invalid nowIso timestamp "${nowIso}".`);
  }
  const resolvedRoot = path.resolve(root);
  const logsDir = path.join(resolvedRoot, 'logs');
  const lockPath = getLedgerLockPath(resolvedRoot);
  refuseSymlink(logsDir, resolvedRoot, home);
  refuseSymlink(lockPath, resolvedRoot, home);
  fs.mkdirSync(logsDir, { recursive: true });
  refuseSymlink(lockPath, resolvedRoot, home);

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
      throw new Error(`ledger_locked: "${lockPath}" is already held; refusing concurrent write without stealing lock.`);
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

function releaseOwnLedgerLock(lockHandle, { root, home = os.homedir() } = {}) {
  if (!lockHandle) return;
  const resolvedRoot = path.resolve(root);
  refuseSymlink(lockHandle.lockPath, resolvedRoot, home);
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

export function withLedgerLock(root, { home = os.homedir(), nowIso = new Date().toISOString() } = {}, fn) {
  const handle = acquireLedgerLock(root, { home, nowIso });
  try {
    return fn(handle);
  } finally {
    releaseOwnLedgerLock(handle, { root, home });
  }
}

export function inspectLedgerLock(root, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  staleLockAgeMs = DEFAULT_LEDGER_STALE_LOCK_AGE_MS,
} = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`inspectLedgerLock: invalid nowIso timestamp "${nowIso}".`);
  }
  if (!Number.isSafeInteger(staleLockAgeMs) || staleLockAgeMs <= 0) {
    throw new Error('inspectLedgerLock: staleLockAgeMs must be a positive safe integer.');
  }
  const resolvedRoot = path.resolve(root);
  const lockPath = getLedgerLockPath(resolvedRoot);
  refuseSymlink(lockPath, resolvedRoot, home);
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
      error: `Corrupt ledger lockfile JSON: ${err.message}`,
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
      error: 'Ledger lockfile metadata is malformed (missing valid pid, acquired_at, or nonce).',
    };
  }

  const ageMs = Date.parse(nowIso) - Date.parse(parsed.acquired_at);
  const ownerAlive = isPidAlive(parsed.pid);
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

export function releaseStaleLedgerLock(root, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  staleLockAgeMs = DEFAULT_LEDGER_STALE_LOCK_AGE_MS,
  expectedNonce,
  confirmedExplicitRecovery = false,
} = {}) {
  if (confirmedExplicitRecovery !== true) {
    throw new Error('releaseStaleLedgerLock requires explicit confirmedExplicitRecovery === true.');
  }
  if (!isNonEmptyString(expectedNonce)) {
    throw new Error('releaseStaleLedgerLock requires a non-empty expectedNonce to prevent TOCTOU races.');
  }
  const resolvedRoot = path.resolve(root);
  const info = inspectLedgerLock(resolvedRoot, { home, nowIso, staleLockAgeMs });
  if (!info.locked) {
    throw new Error('No ledger lockfile exists to release.');
  }
  if (info.corrupt || !info.lock) {
    throw new Error(`Refusing automatic removal of corrupt ledger lockfile: ${info.error}`);
  }
  if (info.lock.nonce !== expectedNonce) {
    throw new Error('Ledger lockfile nonce mismatch; refusing stale-lock release because lock ownership changed.');
  }
  if (!info.stale) {
    throw new Error(`Refusing stale-lock release: lock age (${info.age_ms}ms) is below staleLockAgeMs (${staleLockAgeMs}ms).`);
  }
  if (info.lock.pid === process.pid || info.owner_alive !== false) {
    throw new Error(`Refusing stale-lock release: owning PID ${info.lock.pid} is still active or cannot be proven dead.`);
  }

  refuseSymlink(info.path, resolvedRoot, home);
  const reread = JSON.parse(fs.readFileSync(info.path, 'utf8'));
  if (!isObj(reread) || reread.nonce !== expectedNonce) {
    throw new Error('Ledger lockfile changed during stale-lock release; aborting safely.');
  }
  fs.unlinkSync(info.path);
  return {
    released: true,
    path: info.path,
    released_pid: info.lock.pid,
    released_nonce: expectedNonce,
  };
}

// Read-only inspection of incomplete cross-file transaction journal (logs/.ledger-tx.json)
export function inspectLedgerTransaction(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const txPath = getLedgerTxPath(resolvedRoot);
  refuseSymlink(txPath, resolvedRoot, home);
  if (!fs.existsSync(txPath)) {
    return { pending: false, path: txPath, corrupt: false, transaction: null, error: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(txPath, 'utf8'));
    if (!isObj(parsed) || !isNonEmptyString(parsed.tx_id) || !isNonEmptyString(parsed.operation)) {
      return {
        pending: true,
        path: txPath,
        corrupt: true,
        transaction: null,
        error: 'Incomplete transaction journal is malformed.',
      };
    }
    return {
      pending: true,
      path: txPath,
      corrupt: false,
      transaction: {
        tx_id: parsed.tx_id,
        operation: parsed.operation,
        started_at: parsed.started_at ?? null,
        stage: parsed.stage ?? 'unknown',
        files: parsed.files ?? [],
      },
      error: null,
    };
  } catch (err) {
    return {
      pending: true,
      path: txPath,
      corrupt: true,
      transaction: null,
      error: `Corrupt transaction journal JSON: ${err.message}`,
    };
  }
}

function assertNoIncompleteLedgerTransaction(root, { home = os.homedir() } = {}) {
  const tx = inspectLedgerTransaction(root, { home });
  if (tx.pending) {
    const detail = tx.corrupt
      ? tx.error
      : `tx_id=${tx.transaction.tx_id}, operation=${tx.transaction.operation}, stage=${tx.transaction.stage}`;
    throw new Error(
      `incomplete_ledger_transaction: Found unfinished cross-file transaction journal at "${tx.path}" (${detail}). Run \`veycraft career recover-tx --confirm-rollback\` to restore consistent pre-transaction state before writing.`,
    );
  }
}

export function recoverIncompleteLedgerTransaction(root, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  confirmRollback = false,
} = {}) {
  if (confirmRollback !== true) {
    throw new Error('recoverIncompleteLedgerTransaction requires explicit confirmRollback === true.');
  }
  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    const txPath = getLedgerTxPath(resolvedRoot);
    refuseSymlink(txPath, resolvedRoot, home);
    if (!fs.existsSync(txPath)) {
      throw new Error('No incomplete ledger transaction journal found to recover.');
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(txPath, 'utf8'));
    } catch (err) {
      throw new Error(`Refusing rollback of corrupt transaction journal "${txPath}": ${err.message}`);
    }
    if (!isObj(parsed) || !isNonEmptyString(parsed.tx_id) || !Array.isArray(parsed.snapshots)) {
      throw new Error(`Refusing rollback of malformed transaction journal "${txPath}".`);
    }

    const restored = [];
    for (const snap of parsed.snapshots) {
      if (!isObj(snap) || !isNonEmptyString(snap.rel_path)) {
        throw new Error('Malformed snapshot entry inside transaction journal.');
      }
      const target = assertWorkspacePathSafe(resolvedRoot, snap.rel_path, { home, label: 'transaction snapshot path' });
      if (snap.existed) {
        if (typeof snap.raw_content !== 'string') {
          throw new Error(`Transaction snapshot for "${snap.rel_path}" is missing raw_content.`);
        }
        writeAtomic(target, snap.raw_content, { mode: 0o600, boundary: resolvedRoot, home });
        restored.push({ rel_path: snap.rel_path, action: 'restored' });
      } else if (fs.existsSync(target)) {
        refuseSymlink(target, resolvedRoot, home);
        fs.unlinkSync(target);
        restored.push({ rel_path: snap.rel_path, action: 'removed_new_file' });
      } else {
        restored.push({ rel_path: snap.rel_path, action: 'already_absent' });
      }
    }

    fs.unlinkSync(txPath);
    return {
      recovered: true,
      tx_id: parsed.tx_id,
      operation: parsed.operation ?? 'unknown',
      restored,
    };
  });
}

// Fail-closed validated readers for protected operational JSON files
export function readValidatedApplicationsLedger(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const ledgerPath = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'applications-log.json'), {
    home,
    label: 'applications ledger',
  });
  if (!fs.existsSync(ledgerPath)) {
    return { path: ledgerPath, exists: false, raw: null, records: [] };
  }
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in "${ledgerPath}"; refusing to overwrite: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Unsupported JSON root in "${ledgerPath}"; expected an array of applications.`);
  }
  const check = validateApplicationLedger(parsed);
  if (!check.valid) {
    throw new Error(`Existing "${ledgerPath}" failed validation; refusing mutation: ${check.errors.join('; ')}`);
  }
  return { path: ledgerPath, exists: true, raw, records: parsed };
}

export function readValidatedSkippedJobs(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const skippedPath = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'skipped-jobs.json'), {
    home,
    label: 'skipped jobs ledger',
  });
  if (!fs.existsSync(skippedPath)) {
    return { path: skippedPath, exists: false, raw: null, records: [] };
  }
  const raw = fs.readFileSync(skippedPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in "${skippedPath}"; refusing to overwrite: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Unsupported JSON root in "${skippedPath}"; expected a JSON array.`);
  }
  parsed.forEach((item, idx) => {
    if (!isObj(item) || !isUsableJobId(item.job_id)) {
      throw new Error(`Invalid existing skipped-jobs entry at index ${idx}: expected object with non-empty job_id.`);
    }
  });
  return { path: skippedPath, exists: true, raw, records: parsed };
}

export function readValidatedCvRegistry(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const cvPath = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'cv-versions.json'), {
    home,
    label: 'CV versions registry',
  });
  if (!fs.existsSync(cvPath)) {
    return {
      path: cvPath,
      exists: false,
      raw: null,
      registry: { schema_version: '1.0', updated_at: null, versions: [] },
    };
  }
  const raw = fs.readFileSync(cvPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in "${cvPath}"; refusing to overwrite: ${err.message}`);
  }
  const check = validateCvVersionsRegistry(parsed);
  if (!check.valid) {
    throw new Error(`Existing "${cvPath}" failed validation; refusing mutation: ${check.errors.join('; ')}`);
  }
  return { path: cvPath, exists: true, raw, registry: parsed };
}

function persistValidatedLedger(root, records, { home = os.homedir(), ledgerPath } = {}) {
  const resolvedRoot = path.resolve(root);
  const target = ledgerPath || assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'applications-log.json'), {
    home,
    label: 'applications ledger',
  });
  const check = validateApplicationLedger(records);
  if (!check.valid) {
    throw new Error(`Refusing to persist invalid applications ledger: ${check.errors.join('; ')}`);
  }
  const content = JSON.stringify(records, null, 2) + '\n';
  writeAtomic(target, content, { mode: 0o600, boundary: resolvedRoot, home });
  return { path: target, count: records.length };
}

// ---------------- Canonical URL, Guardrails, Blacklist & Pre-Submit Integrity Gate (T11.4) ----------------

const TRACKING_QUERY_PARAMS = new Set([
  'ref', 'refid', 'trackingid', 'trk', 'trkinfo', 'fbclid', 'gclid', 'source',
  'src', 'lever-source', 'gh_src', 'ashby_jid', 'icid', 'mc_cid', 'mc_eid',
]);

export function normalizeCanonicalUrl(rawUrl) {
  if (!isNonEmptyString(rawUrl)) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const keptParams = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    const kl = k.toLowerCase();
    if (kl.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(kl)) continue;
    if (kl === 'gh_jid' && /\/jobs\/[^/]+$/i.test(pathname)) continue;
    keptParams.push([k, v]);
  }
  keptParams.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const query = keptParams.length > 0
    ? '?' + keptParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  return `${parsed.protocol}//${host}${pathname}${query}`;
}

function extractUrlHost(rawUrl) {
  if (!isNonEmptyString(rawUrl)) return null;
  try {
    const u = new URL(rawUrl.trim());
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function parseYamlStringArray(yamlText, keyName) {
  const results = [];
  if (typeof yamlText !== 'string') return results;
  // 1. Inline YAML array: key: ["a", "b"] or key: [a, b]
  const inlineRe = new RegExp(`^[ \\t]*${keyName}:[ \\t]*\\[([^\\]]*)\\]`, 'gm');
  let m;
  while ((m = inlineRe.exec(yamlText)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    for (const part of inner.split(',')) {
      const cleaned = part.trim().replace(/^["']|["']$/g, '').trim();
      if (cleaned) results.push(cleaned);
    }
  }
  // 2. Block YAML list:
  // key:
  //   - "value"
  const blockRe = new RegExp(`^[ \\t]*${keyName}:[ \\t]*(?:#.*)?\\r?\\n((?:[ \\t]+-[ \\t]+.*(?:\\r?\\n|$))*)`, 'gm');
  while ((m = blockRe.exec(yamlText)) !== null) {
    const lines = m[1].split(/\r?\n/);
    for (const line of lines) {
      const itemMatch = line.match(/^[ \t]+-[ \t]+(.+?)(?:[ \t]+#.*)?$/);
      if (itemMatch) {
        const cleaned = itemMatch[1].trim().replace(/^["']|["']$/g, '').trim();
        if (cleaned) results.push(cleaned);
      }
    }
  }
  return [...new Set(results)];
}

function readPreSubmitGuardrails(root, sourceRoot, { home = os.homedir() } = {}) {
  const candidates = [
    path.join(path.resolve(root), 'config', 'guardrails.yaml'),
    ...(sourceRoot ? [path.join(path.resolve(sourceRoot), 'config', 'guardrails.yaml')] : []),
  ];
  const guardFile = candidates.find(f => fs.existsSync(f)) || null;
  const settings = {
    source_path: guardFile,
    dry_run: true,
    max_applications_per_day: 20,
    warmup_enabled: true,
    warmup_initial_cap: 5,
    warmup_stage_days: 3,
    max_per_platform: {},
  };
  if (!guardFile) return settings;

  const boundary = isWithinDir(guardFile, path.resolve(root)) ? path.resolve(root) : path.resolve(sourceRoot);
  refuseSymlink(guardFile, boundary, home);
  const gText = fs.readFileSync(guardFile, 'utf8');

  const mDry = gText.match(/^[ \t]*dry_run:[ \t]*(true|false)\b/m);
  if (mDry) settings.dry_run = mDry[1] === 'true';

  const mCap = gText.match(/^[ \t]*max_applications_per_day:[ \t]*(\d+)\b/m);
  if (mCap) settings.max_applications_per_day = Number(mCap[1]);

  const warmupBlock = gText.match(/^[ \t]*warmup_mode:[ \t]*(?:#.*)?\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m);
  if (warmupBlock) {
    const wb = warmupBlock[1];
    const mEn = wb.match(/^[ \t]+enabled:[ \t]*(true|false)\b/m);
    if (mEn) settings.warmup_enabled = mEn[1] === 'true';
    const mInit = wb.match(/^[ \t]+initial_cap:[ \t]*(\d+)\b/m);
    if (mInit) settings.warmup_initial_cap = Number(mInit[1]);
    const mDays = wb.match(/^[ \t]+stage_days:[ \t]*(\d+)\b/m);
    if (mDays) settings.warmup_stage_days = Number(mDays[1]);
  }

  const platBlock = gText.match(/^[ \t]*max_per_platform:[ \t]*(?:#.*)?\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m);
  if (platBlock) {
    for (const line of platBlock[1].split(/\r?\n/)) {
      const pm = line.match(/^[ \t]+([a-z0-9_-]+):[ \t]*(\d+)\b/i);
      if (pm) {
        settings.max_per_platform[pm[1].toLowerCase()] = Number(pm[2]);
      }
    }
  }
  return settings;
}

function readPreferencesBlacklists(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const prefPath = path.join(resolvedRoot, 'context', 'preferences.yaml');
  if (!fs.existsSync(prefPath)) {
    return { companies: [], domains: [] };
  }
  refuseSymlink(prefPath, resolvedRoot, home);
  const text = fs.readFileSync(prefPath, 'utf8');
  const companies = [
    ...parseYamlStringArray(text, 'blacklisted_companies'),
    ...parseYamlStringArray(text, 'blacklist_companies'),
  ].map(s => s.toLowerCase());
  const domains = parseYamlStringArray(text, 'blacklisted_domains')
    .map(s => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
  return {
    companies: [...new Set(companies)],
    domains: [...new Set(domains)],
  };
}

function readCircuitBreaker(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const cbPath = path.join(resolvedRoot, 'logs', 'circuit-breaker.json');
  if (!fs.existsSync(cbPath)) return null;
  refuseSymlink(cbPath, resolvedRoot, home);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cbPath, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupt JSON in "${cbPath}": ${err.message}`);
  }
  return isObj(parsed) ? parsed : null;
}

function collectDistinctNonAbortedRunDates(root, records, { home = os.homedir(), cvRegistry = null } = {}) {
  const runDates = new Set();
  for (const r of records) {
    if (!isOwnerApplicationRecord(r, cvRegistry)) continue;
    const st = normalizeStatus(r.status);
    if (!st.valid) continue;
    const isSubmitted = SUBMITTED_STATUS_SET.has(st.canonical);
    const isUncertain = r.submission_uncertain === true;
    if (!isSubmitted && !isUncertain) continue;
    const datePrefix = String(r.applied_at || r.updated_at || r.discovered_at || r.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePrefix)) runDates.add(datePrefix);
  }
  const runsDir = path.join(path.resolve(root), 'logs', 'runs');
  if (fs.existsSync(runsDir)) {
    refuseSymlink(runsDir, path.resolve(root), home);
    for (const name of fs.readdirSync(runsDir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const fullPath = path.join(runsDir, name);
      refuseSymlink(fullPath, path.resolve(root), home);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (isObj(parsed) && parsed.status !== 'aborted' && parsed.dry_run !== true) {
          const appliedCount = Number(parsed.counts?.applied ?? 0);
          if (appliedCount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(parsed.run_id || '')) {
            runDates.add(parsed.run_id);
          }
        }
      } catch { /* ignore unreadable individual run file here */ }
    }
  }
  return runDates;
}

function getCapDatePrefix(record) {
  const st = normalizeStatus(record?.status);
  if (st.valid && SUBMITTED_STATUS_SET.has(st.canonical)) {
    return String(record.applied_at || record.date || record.updated_at || '').slice(0, 10);
  }
  if (record?.submission_uncertain === true) {
    return String(record.updated_at || record.applied_at || record.discovered_at || record.date || '').slice(0, 10);
  }
  return '';
}

function getRecordActivityTimestampMs(record) {
  for (const field of ['applied_at', 'updated_at', 'discovered_at', 'date']) {
    const val = record?.[field];
    if (typeof val === 'string' && val.trim()) {
      const ts = Date.parse(val);
      if (!Number.isNaN(ts)) return ts;
    }
  }
  return null;
}

export function evaluatePreSubmitGate(root, candidate = {}, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  recordsOverride = null,
  cvRegistryOverride = undefined,
} = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`evaluatePreSubmitGate: invalid nowIso "${nowIso}".`);
  }
  const resolvedRoot = path.resolve(root);
  const guardrails = readPreSubmitGuardrails(resolvedRoot, sourceRoot, { home });
  const records = recordsOverride !== null
    ? recordsOverride
    : readValidatedApplicationsLedger(resolvedRoot, { home }).records;
  let cvRegistry = null;
  if (cvRegistryOverride !== undefined) {
    cvRegistry = cvRegistryOverride;
  } else {
    const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });
    cvRegistry = cvLoaded.exists ? cvLoaded.registry : null;
  }

  const todayStr = nowIso.slice(0, 10);
  const nowMs = Date.parse(nowIso);
  const runDates = collectDistinctNonAbortedRunDates(resolvedRoot, records, { home, cvRegistry });
  const warmupActive = guardrails.warmup_enabled && runDates.size < guardrails.warmup_stage_days;
  const effectiveCap = warmupActive
    ? Math.min(guardrails.warmup_initial_cap, guardrails.max_applications_per_day)
    : guardrails.max_applications_per_day;

  let todayApplied = 0;
  let todayUncertain = 0;
  const platformTodayCounts = new Map();

  for (const r of records) {
    if (!isOwnerApplicationRecord(r, cvRegistry)) continue;
    const st = normalizeStatus(r.status);
    if (!st.valid) continue;
    const isSubmitted = SUBMITTED_STATUS_SET.has(st.canonical);
    const isUncertain = r.submission_uncertain === true;
    if (!isSubmitted && !isUncertain) continue;

    const datePrefix = getCapDatePrefix(r);
    if (datePrefix === todayStr) {
      if (isUncertain && !isSubmitted) todayUncertain++;
      else todayApplied++;
      const plat = String(r.platform || 'other').trim().toLowerCase();
      platformTodayCounts.set(plat, (platformTodayCounts.get(plat) || 0) + 1);
    }
  }

  const todayCounted = todayApplied + todayUncertain;
  const violations = [];
  const checks = {
    daily_cap: {
      ok: todayCounted < effectiveCap,
      today_counted: todayCounted,
      today_applied: todayApplied,
      today_submission_uncertain: todayUncertain,
      effective_cap: effectiveCap,
      max_per_day: guardrails.max_applications_per_day,
      warmup_active: warmupActive,
      distinct_run_dates: runDates.size,
      dry_run: guardrails.dry_run,
    },
    platform_cap: null,
    circuit_breaker: null,
    blacklist: null,
    deduplication: null,
  };

  if (todayCounted >= effectiveCap) {
    violations.push({
      code: 'daily_cap_reached',
      message: `Daily Cap REACHED: ${todayCounted}/${effectiveCap} (${warmupActive ? `Warm-up Days 1-${guardrails.warmup_stage_days} cap: ${guardrails.warmup_initial_cap}/day` : `Standard cap: ${guardrails.max_applications_per_day}/day`}; applied=${todayApplied}, submission_uncertain=${todayUncertain}). Submission BLOCKED.`,
    });
  }

  const candPlatform = isNonEmptyString(candidate.platform) ? candidate.platform.trim().toLowerCase() : null;
  if (candPlatform) {
    const hasPlatformCap = Object.prototype.hasOwnProperty.call(guardrails.max_per_platform, candPlatform);
    const platformCap = hasPlatformCap ? guardrails.max_per_platform[candPlatform] : null;
    const platformToday = platformTodayCounts.get(candPlatform) || 0;
    const platOk = platformCap === null ? true : (platformCap > 0 && platformToday < platformCap);
    checks.platform_cap = {
      platform: candPlatform,
      today_counted: platformToday,
      cap: platformCap,
      ok: platOk,
    };
    if (!platOk) {
      violations.push({
        code: platformCap === 0 ? 'platform_disabled' : 'platform_cap_reached',
        message: platformCap === 0
          ? `Platform "${candPlatform}" has max_per_platform=0 (manual_apply/disabled). Submission BLOCKED.`
          : `Platform Cap REACHED for "${candPlatform}": ${platformToday}/${platformCap}. Submission BLOCKED.`,
      });
    }

    // Circuit breaker check
    const cb = readCircuitBreaker(resolvedRoot, { home });
    const platCb = cb?.platforms?.[candPlatform] || null;
    let cbBlocked = false;
    if (platCb && platCb.status === 'tripped' && isValidIsoDateTime(platCb.cooldown_until)) {
      if (Date.parse(platCb.cooldown_until) > nowMs) {
        cbBlocked = true;
      }
    }
    checks.circuit_breaker = {
      platform: candPlatform,
      tripped: cbBlocked,
      cooldown_until: cbBlocked ? platCb.cooldown_until : null,
      trigger_signal: cbBlocked ? (platCb.trigger_signal || null) : null,
      ok: !cbBlocked,
    };
    if (cbBlocked) {
      violations.push({
        code: 'circuit_breaker_active',
        message: `Circuit breaker active for "${candPlatform}" until ${platCb.cooldown_until} (${platCb.trigger_signal || 'anti-bot cooldown'}). Submission BLOCKED.`,
      });
    }
  }

  // Employer & domain blacklist check
  const candCompany = isNonEmptyString(candidate.company) ? candidate.company.trim() : null;
  const candUrl = isNonEmptyString(candidate.url) ? candidate.url.trim() : null;
  if (candCompany || candUrl) {
    const blacklists = readPreferencesBlacklists(resolvedRoot, { home });
    const matchedCompany = candCompany
      ? blacklists.companies.find(b => b && candCompany.toLowerCase().includes(b)) || null
      : null;
    const urlHost = extractUrlHost(candUrl);
    const matchedDomain = urlHost
      ? blacklists.domains.find(d => d && (urlHost === d || urlHost.endsWith(`.${d}`))) || null
      : null;
    checks.blacklist = {
      ok: !matchedCompany && !matchedDomain,
      matched_company: matchedCompany,
      matched_domain: matchedDomain,
    };
    if (matchedCompany) {
      violations.push({
        code: 'blacklisted_employer',
        message: `Company "${candCompany}" matches blacklisted employer "${matchedCompany}". Submission BLOCKED.`,
      });
    }
    if (matchedDomain) {
      violations.push({
        code: 'blacklisted_domain',
        message: `Destination host "${urlHost}" matches blacklisted domain "${matchedDomain}". Submission BLOCKED.`,
      });
    }
  }

  // Deduplication check: job_id, canonical URL, and 60-day cross-channel canonical fingerprint
  const candJobIdKey = isUsableJobId(candidate.job_id) ? normalizeJobIdKey(candidate.job_id) : null;
  const candCanonUrl = normalizeCanonicalUrl(candUrl);
  const candTitle = isNonEmptyString(candidate.title) ? candidate.title.trim() : null;
  const candFingerprint = (candCompany && candTitle) ? computeCanonicalFingerprint(candCompany, candTitle) : null;

  if (candJobIdKey || candCanonUrl || candFingerprint) {
    const matches = [];
    for (const r of records) {
      if (!isOwnerApplicationRecord(r, cvRegistry)) continue;
      const st = normalizeStatus(r.status);
      if (!st.valid) continue;
      const isActive = SUBMITTED_STATUS_SET.has(st.canonical) || r.submission_uncertain === true;
      if (!isActive) continue;

      if (candJobIdKey && isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === candJobIdKey) {
        matches.push({ kind: 'duplicate_job_id', matched_job_id: r.job_id, platform: r.platform || null, status: st.canonical });
        continue;
      }
      if (candCanonUrl && normalizeCanonicalUrl(r.url) === candCanonUrl) {
        matches.push({ kind: 'duplicate_canonical_url', matched_job_id: r.job_id, platform: r.platform || null, status: st.canonical });
        continue;
      }
      if (candFingerprint) {
        const recTitle = isNonEmptyString(r.title) ? r.title : (isNonEmptyString(r.role) ? r.role : '');
        const recFp = isNonEmptyString(r.canonical_fingerprint)
          ? r.canonical_fingerprint
          : computeCanonicalFingerprint(r.company, recTitle);
        if (recFp && recFp === candFingerprint) {
          const recTs = getRecordActivityTimestampMs(r);
          const ageDays = recTs !== null ? (nowMs - recTs) / DAY_MS : 0;
          if (ageDays <= DEDUP_WINDOW_DAYS) {
            matches.push({
              kind: 'duplicate_cross_channel',
              matched_job_id: r.job_id,
              platform: r.platform || null,
              status: st.canonical,
              fingerprint: recFp,
            });
          }
        }
      }
    }

    checks.deduplication = {
      ok: matches.length === 0,
      matches,
    };
    for (const dup of matches) {
      violations.push({
        code: dup.kind,
        message: `Duplicate application detected (${dup.kind}): matches existing record "${dup.matched_job_id}" (platform=${dup.platform || 'unknown'}, status=${dup.status}). Submission BLOCKED.`,
      });
    }
  }

  return {
    allowed: violations.length === 0,
    dry_run: guardrails.dry_run,
    violations,
    checks,
  };
}

// ---------------- Application Lifecycle Mutation Engine (T11.2) ----------------

function makeStageEventId(prefix, toStatus, atIso, seq = 0) {
  const hash = crypto.createHash('sha256')
    .update(`${prefix}|${toStatus}|${atIso}|${seq}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
  return `evt_${prefix}_${hash}`;
}

function sanitizeReceiptQuote(rawReceipt) {
  if (typeof rawReceipt !== 'string') {
    throw new Error('confirmApplicationSubmission requires a non-empty receipt quote string.');
  }
  const cleaned = rawReceipt.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) {
    throw new Error('Receipt quote must be at least 3 non-whitespace characters.');
  }
  if (/\{\{[^}]+\}\}/.test(cleaned)) {
    throw new Error('Receipt quote contains unresolved template placeholder(s); refusing fabricated receipt.');
  }
  if (cleaned.length > MAX_RECEIPT_LEN) {
    throw new Error(`Receipt quote exceeds maximum length (${MAX_RECEIPT_LEN} chars).`);
  }
  // Escape double quotes so `receipt: "..."` always satisfies VERIFIED_RECEIPT_RE cleanly
  return cleaned.replace(/"/g, "'");
}

function assertValidOptionalHttpUrl(rawUrl, fieldName = 'url') {
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') return null;
  if (typeof rawUrl !== 'string') {
    throw new Error(`${fieldName} must be an HTTP(S) URL string or null.`);
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid ${fieldName} "${trimmed}"; expected a valid http:// or https:// URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTP(S) ${fieldName} protocol "${parsed.protocol}".`);
  }
  return trimmed;
}

function appendNotesPart(existingNotes, addition) {
  const base = typeof existingNotes === 'string' ? existingNotes.trim() : '';
  const part = typeof addition === 'string' ? addition.trim() : '';
  if (!part) return base;
  if (!base) return part;
  if (base.includes(part)) return base;
  return `${base} | ${part}`;
}

function assertChronologicalTimestamp(existing, atIso, label = 'event timestamp') {
  if (!isValidIsoDateTime(atIso)) {
    throw new Error(`Invalid ${label} "${atIso}"; expected valid ISO-8601 date-time.`);
  }
  const atMs = Date.parse(atIso);
  if (isValidIsoDateTime(existing?.applied_at) && atMs < Date.parse(existing.applied_at)) {
    throw new Error(`${label} (${atIso}) cannot precede applied_at (${existing.applied_at}).`);
  }
  if (Array.isArray(existing?.stage_history) && existing.stage_history.length > 0) {
    const lastEvt = existing.stage_history[existing.stage_history.length - 1];
    if (isValidIsoDateTime(lastEvt?.at) && atMs < Date.parse(lastEvt.at)) {
      throw new Error(`${label} (${atIso}) cannot precede previous stage_history event (${lastEvt.at}).`);
    }
  }
}

export function recordApplication(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  sourceRoot = null,
} = {}) {
  if (!isObj(input)) throw new Error('recordApplication requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('recordApplication requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`recordApplication: invalid nowIso "${nowIso}".`);

  const statusInfo = normalizeStatus(input.status || 'discovered');
  if (!statusInfo.valid || !NON_SUBMITTED_RECORD_STATUS_SET.has(statusInfo.canonical)) {
    throw new Error(
      `recordApplication only accepts non-submission statuses (${NON_SUBMITTED_RECORD_STATUSES.join(', ')}); received "${input.status}". Use confirm-submit or transition for submitted outcomes.`,
    );
  }
  const targetStatus = statusInfo.canonical;

  if (input.match_score !== undefined && input.match_score !== null) {
    if (typeof input.match_score !== 'number' || !Number.isFinite(input.match_score) || input.match_score < 0 || input.match_score > 10) {
      throw new Error('recordApplication: match_score must be a number in 0..10 or null.');
    }
  }
  if (input.apply_type !== undefined && input.apply_type !== null && !APPLY_TYPES.has(input.apply_type)) {
    throw new Error(`recordApplication: invalid apply_type "${input.apply_type}".`);
  }
  if (input.source_channel !== undefined && input.source_channel !== null && !SOURCE_CHANNELS.has(input.source_channel)) {
    throw new Error(`recordApplication: invalid source_channel "${input.source_channel}".`);
  }
  if (input.work_mode !== undefined && input.work_mode !== null && !WORK_MODES.has(input.work_mode)) {
    throw new Error(`recordApplication: invalid work_mode "${input.work_mode}".`);
  }
  if (input.employment_type !== undefined && input.employment_type !== null && !EMPLOYMENT_TYPES.has(input.employment_type)) {
    throw new Error(`recordApplication: invalid employment_type "${input.employment_type}".`);
  }
  const validatedUrl = input.url !== undefined ? assertValidOptionalHttpUrl(input.url, 'url') : undefined;

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const loaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const records = [...loaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const existingIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    const existing = existingIdx >= 0 ? normalizeApplicationRecord(records[existingIdx]) : null;

    if (existing) {
      if (SUBMITTED_STATUS_SET.has(existing.status)) {
        throw new Error(
          `cannot_downgrade_submitted: Application "${existing.job_id}" is already "${existing.status}" (applied_at=${existing.applied_at || 'set'}); refusing to overwrite or downgrade via record.`,
        );
      }
      if (existing.submission_uncertain === true) {
        throw new Error(
          `reservation_active: Application "${existing.job_id}" has an unresolved submission_uncertain reservation; resolve via confirm-submit instead of overwriting via record.`,
        );
      }
    } else if (targetStatus !== 'skipped' && input.third_party_subject !== true) {
      // Check canonical URL & 60-day fingerprint duplicates against active submitted/uncertain records
      const dupGate = evaluatePreSubmitGate(resolvedRoot, {
        company: input.company,
        title: input.title,
        url: input.url,
        job_id: input.job_id,
      }, { home, nowIso, sourceRoot, recordsOverride: records });
      const dupViolation = dupGate.violations.find(v => v.code.startsWith('duplicate_'));
      if (dupViolation) {
        throw new Error(`duplicate_application: ${dupViolation.message}`);
      }
    }

    const company = input.company !== undefined ? input.company : (existing?.company ?? null);
    const title = input.title !== undefined ? input.title : (existing?.title ?? null);
    const fingerprint = computeCanonicalFingerprint(company, title) ?? existing?.canonical_fingerprint ?? null;
    const eventSource = targetStatus === 'prepared' ? 'preparation' : 'discovery';
    const stageHistory = existing ? [...existing.stage_history] : [];

    // Check idempotency if existing record already matches requested state & metadata
    if (
      existing &&
      existing.status === targetStatus &&
      (input.company === undefined || existing.company === input.company) &&
      (input.title === undefined || existing.title === input.title) &&
      (input.platform === undefined || existing.platform === input.platform) &&
      (input.url === undefined || existing.url === input.url) &&
      (input.notes === undefined || existing.notes === input.notes) &&
      (input.match_score === undefined || existing.match_score === input.match_score)
    ) {
      return {
        action: 'idempotent_no_op',
        application_id: existing.application_id,
        job_id: existing.job_id,
        status: existing.status,
        canonical_fingerprint: existing.canonical_fingerprint,
        path: loaded.path,
        record: existing,
      };
    }

    if (!existing || existing.status !== targetStatus) {
      if (existing) assertChronologicalTimestamp(existing, nowIso, 'record timestamp');
      stageHistory.push({
        event_id: makeStageEventId('rec', targetStatus, nowIso, stageHistory.length),
        from_status: existing ? existing.status : null,
        to_status: targetStatus,
        at: nowIso,
        source: eventSource,
        verified: false,
        notes: typeof input.notes === 'string' ? input.notes.slice(0, 200) : '',
      });
    }

    const thirdParty = input.third_party_subject === true || existing?.provenance?.third_party_subject === true;
    const validatedScreenshot = input.screenshot !== undefined
      ? assertOptionalSafeRelativeWorkspacePath(resolvedRoot, input.screenshot, {
        home,
        allowThirdParty: thirdParty,
        label: 'screenshot path',
      })
      : (existing?.screenshot ?? null);
    const nextRec = normalizeApplicationRecord({
      ...(existing || {}),
      job_id: existing ? existing.job_id : input.job_id.trim(),
      title,
      company,
      platform: input.platform !== undefined ? input.platform : (existing?.platform ?? null),
      source_channel: input.source_channel !== undefined ? input.source_channel : (existing?.source_channel ?? null),
      url: validatedUrl !== undefined ? validatedUrl : (existing?.url ?? null),
      location: input.location !== undefined ? input.location : (existing?.location ?? null),
      work_mode: input.work_mode !== undefined ? input.work_mode : (existing?.work_mode ?? null),
      employment_type: input.employment_type !== undefined ? input.employment_type : (existing?.employment_type ?? null),
      apply_type: input.apply_type !== undefined ? input.apply_type : (existing?.apply_type ?? null),
      discovered_at: existing?.discovered_at ?? (isValidIsoDateTime(input.discovered_at) ? input.discovered_at : nowIso),
      applied_at: null,
      updated_at: nowIso,
      run_id: input.run_id !== undefined ? input.run_id : (existing?.run_id ?? nowIso.slice(0, 10)),
      status: targetStatus,
      match_score: input.match_score !== undefined ? input.match_score : (existing?.match_score ?? null),
      matched_skills: Array.isArray(input.matched_skills) ? [...new Set(input.matched_skills)] : (existing?.matched_skills ?? []),
      missing_skills: Array.isArray(input.missing_skills) ? [...new Set(input.missing_skills)] : (existing?.missing_skills ?? []),
      open_questions: Array.isArray(input.open_questions) ? input.open_questions : (existing?.open_questions ?? []),
      persona_id: input.persona_id !== undefined ? input.persona_id : (existing?.persona_id ?? null),
      screenshot: validatedScreenshot,
      notes: input.notes !== undefined ? String(input.notes) : (existing?.notes ?? ''),
      submission_uncertain: false,
      canonical_fingerprint: fingerprint,
      stage_history: stageHistory,
      provenance: {
        created_by: existing?.provenance?.created_by ?? 'cli_record',
        created_at: existing?.provenance?.created_at ?? nowIso,
        last_updated_by: 'cli_record',
        receipt_verified: false,
        third_party_subject: thirdParty,
      },
      notion_sync: {
        state: 'ineligible_not_submitted',
        page_id: null,
        last_synced_at: null,
        last_synced_hash: null,
        retry_count: 0,
        last_error: null,
      },
    });

    if (existingIdx >= 0) records[existingIdx] = nextRec;
    else records.push(nextRec);

    const saved = persistValidatedLedger(resolvedRoot, records, { home, ledgerPath: loaded.path });
    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      application_id: nextRec.application_id,
      job_id: nextRec.job_id,
      status: nextRec.status,
      canonical_fingerprint: nextRec.canonical_fingerprint,
      path: saved.path,
      record: nextRec,
    };
  });
}

export function reserveApplicationSubmission(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  sourceRoot = null,
} = {}) {
  if (!isObj(input)) throw new Error('reserveApplicationSubmission requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('reserveApplicationSubmission requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`reserveApplicationSubmission: invalid nowIso "${nowIso}".`);

  if (input.url !== undefined) assertValidOptionalHttpUrl(input.url, 'url');
  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const loaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const records = [...loaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const existingIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    const existing = existingIdx >= 0 ? normalizeApplicationRecord(records[existingIdx]) : null;

    const cvLoadedForReserve = readValidatedCvRegistry(resolvedRoot, { home });
    const cvRegForReserve = cvLoadedForReserve.exists ? cvLoadedForReserve.registry : null;
    if (existing) {
      if (SUBMITTED_STATUS_SET.has(existing.status)) {
        throw new Error(`already_submitted: Application "${existing.job_id}" is already "${existing.status}"; refusing reservation.`);
      }
      if (existing.submission_uncertain === true) {
        throw new Error(`already_reserved: Application "${existing.job_id}" already has an active submission_uncertain reservation; never double-submit.`);
      }
      const ownCheck = classifyApplicationOwnership(existing, cvRegForReserve);
      if (!ownCheck.isOwner) {
        throw new Error(`third_party_blocked: Refusing to reserve submission for third-party or unverified subject "${existing.job_id}" (${ownCheck.reason}).`);
      }
    }
    if (input.third_party_subject === true) {
      throw new Error('third_party_blocked: Refusing to reserve submission for a third-party subject.');
    }

    const company = input.company !== undefined ? input.company : (existing?.company ?? null);
    const title = input.title !== undefined ? input.title : (existing?.title ?? null);
    const platform = input.platform !== undefined ? input.platform : (existing?.platform ?? null);
    const url = input.url !== undefined ? input.url : (existing?.url ?? null);

    // Run deterministic pre-submit gate inside the lock to prevent cap/dedup races
    const gate = evaluatePreSubmitGate(resolvedRoot, {
      job_id: input.job_id,
      company,
      title,
      platform,
      url,
    }, { home, nowIso, sourceRoot, recordsOverride: records });

    if (!gate.allowed) {
      const reasons = gate.violations.map(v => `${v.code}: ${v.message}`).join(' | ');
      const err = new Error(`pre_submit_gate_blocked: ${reasons}`);
      err.gate = gate;
      throw err;
    }

    if (existing) assertChronologicalTimestamp(existing, nowIso, 'reservation timestamp');
    const stageHistory = existing ? [...existing.stage_history] : [];
    stageHistory.push({
      event_id: makeStageEventId('res', 'needs_review', nowIso, stageHistory.length),
      from_status: existing ? existing.status : null,
      to_status: 'needs_review',
      at: nowIso,
      source: 'preparation',
      verified: false,
      notes: 'pre_submit_reservation (submission_uncertain=true)',
    });

    const fingerprint = computeCanonicalFingerprint(company, title) ?? existing?.canonical_fingerprint ?? null;
    const nextRec = normalizeApplicationRecord({
      ...(existing || {}),
      job_id: existing ? existing.job_id : input.job_id.trim(),
      title,
      company,
      platform,
      url,
      apply_type: input.apply_type !== undefined ? input.apply_type : (existing?.apply_type ?? null),
      discovered_at: existing?.discovered_at ?? nowIso,
      applied_at: null,
      updated_at: nowIso,
      run_id: existing?.run_id ?? nowIso.slice(0, 10),
      status: 'needs_review',
      submission_uncertain: true,
      canonical_fingerprint: fingerprint,
      notes: appendNotesPart(existing?.notes, input.notes || 'pre_submit_reservation'),
      stage_history: stageHistory,
      provenance: {
        created_by: existing?.provenance?.created_by ?? 'cli_reserve',
        created_at: existing?.provenance?.created_at ?? nowIso,
        last_updated_by: 'cli_reserve',
        receipt_verified: false,
        third_party_subject: false,
      },
      notion_sync: {
        state: 'ineligible_not_submitted',
        page_id: null,
        last_synced_at: null,
        last_synced_hash: null,
        retry_count: 0,
        last_error: null,
      },
    });

    if (existingIdx >= 0) records[existingIdx] = nextRec;
    else records.push(nextRec);

    const saved = persistValidatedLedger(resolvedRoot, records, { home, ledgerPath: loaded.path });
    return {
      reserved: true,
      application_id: nextRec.application_id,
      job_id: nextRec.job_id,
      status: nextRec.status,
      submission_uncertain: nextRec.submission_uncertain,
      applied_at: nextRec.applied_at,
      gate,
      path: saved.path,
      record: nextRec,
    };
  });
}

export function confirmApplicationSubmission(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
} = {}) {
  if (!isObj(input)) throw new Error('confirmApplicationSubmission requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('confirmApplicationSubmission requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`confirmApplicationSubmission: invalid nowIso "${nowIso}".`);

  const appliedAt = input.applied_at !== undefined ? input.applied_at : nowIso;
  if (!isValidIsoDateTime(appliedAt)) {
    throw new Error(`confirmApplicationSubmission: invalid applied_at timestamp "${appliedAt}".`);
  }
  const receiptQuote = sanitizeReceiptQuote(input.receipt);
  const validatedConfirmUrl = input.url !== undefined ? assertValidOptionalHttpUrl(input.url, 'url') : undefined;

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const loaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const records = [...loaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const existingIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    if (existingIdx < 0) {
      throw new Error(`application_not_found: No application record exists for job_id "${input.job_id}". Reserve or record it before confirming submission.`);
    }

    const existing = normalizeApplicationRecord(records[existingIdx]);
    if (SUBMITTED_STATUS_SET.has(existing.status) || existing.applied_at !== null || existing.provenance?.receipt_verified === true) {
      throw new Error(
        `already_confirmed: Application "${existing.job_id}" already has verified submission status "${existing.status}" (applied_at=${existing.applied_at}); refusing duplicate confirmation or receipt overwrite.`,
      );
    }
    if (existing.status === 'skipped' || existing.status === 'dry_run' || existing.status === 'aborted' || existing.status === 'failed') {
      throw new Error(
        `invalid_confirm_source_status: Cannot confirm submission for application "${existing.job_id}" from status "${existing.status}". Reserve it first.`,
      );
    }

    assertChronologicalTimestamp(existing, appliedAt, 'applied_at');

    const cvLoadedForConfirm = readValidatedCvRegistry(resolvedRoot, { home });
    const cvRegForConfirm = cvLoadedForConfirm.exists ? cvLoadedForConfirm.registry : null;
    const cvByIdForConfirm = new Map();
    if (cvRegForConfirm) {
      for (const v of cvRegForConfirm.versions) {
        if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
          cvByIdForConfirm.set(v.cv_version_id.trim(), v);
        }
      }
    }
    const existingOwnCheck = classifyApplicationOwnership(existing, cvRegForConfirm);
    if (!existingOwnCheck.isOwner) {
      throw new Error(`third_party_blocked: Refusing to confirm owner submission for third-party or unverified application "${existing.job_id}" (${existingOwnCheck.reason}).`);
    }

    let finalCvVersionId = existing.cv_version_id;
    let nextCvTailoring = existing.cv_tailoring;
    if (input.cv_version_id !== undefined) {
      if (input.cv_version_id === null) {
        finalCvVersionId = null;
      } else if (!isNonEmptyString(input.cv_version_id)) {
        throw new Error('confirmApplicationSubmission: cv_version_id must be a non-empty string or null.');
      } else {
        const reqCvId = input.cv_version_id.trim();
        const foundCv = cvByIdForConfirm.get(reqCvId);
        if (!foundCv) {
          throw new Error(`cv_version_not_found: CV version "${reqCvId}" is not registered in logs/cv-versions.json.`);
        }
        const cvOwnCheck = classifyCvRegistryEntryOwnership(foundCv, cvByIdForConfirm);
        if (!cvOwnCheck.isOwner) {
          throw new Error(`third_party_blocked: Refusing to link third-party or unverified CV version "${reqCvId}" to owner application "${existing.job_id}" (${cvOwnCheck.reason}).`);
        }
        finalCvVersionId = foundCv.cv_version_id;
        if (isObj(existing.cv_tailoring)) {
          nextCvTailoring = {
            ...existing.cv_tailoring,
            is_tailored: foundCv.kind === 'tailored',
            base_cv_version_id: foundCv.base_cv_version_id ?? null,
          };
        }
      }
    }

    const finalUrl = validatedConfirmUrl !== undefined ? validatedConfirmUrl : (existing.url || null);
    const receiptParts = [`receipt: "${receiptQuote}"`];
    if (finalUrl) receiptParts.push(`url: ${finalUrl}`);
    receiptParts.push(`observed_at: ${nowIso}`);
    const receiptSegment = receiptParts.join(' | ');
    if (!VERIFIED_RECEIPT_RE.test(receiptSegment)) {
      throw new Error('Constructed receipt note failed VERIFIED_RECEIPT_RE validation.');
    }

    const updatedNotes = appendNotesPart(existing.notes, receiptSegment);
    const stageHistory = [...existing.stage_history, {
      event_id: makeStageEventId('sub', 'applied', appliedAt, existing.stage_history.length),
      from_status: existing.status,
      to_status: 'applied',
      at: appliedAt,
      source: 'ats_submission_receipt',
      verified: true,
      notes: receiptSegment.slice(0, 240),
    }];

    const nextNotionSync = existing.provenance?.third_party_subject === true
      ? {
        state: 'ineligible_not_submitted',
        page_id: null,
        last_synced_at: null,
        last_synced_hash: null,
        retry_count: 0,
        last_error: null,
      }
      : {
        state: 'pending_sync',
        page_id: existing.notion_sync?.page_id ?? null,
        last_synced_at: existing.notion_sync?.last_synced_at ?? null,
        last_synced_hash: existing.notion_sync?.last_synced_hash ?? null,
        retry_count: existing.notion_sync?.retry_count ?? 0,
        last_error: null,
      };

    const isThirdPartyConfirm = existing.provenance?.third_party_subject === true;
    const validatedConfirmScreenshot = input.screenshot !== undefined
      ? assertOptionalSafeRelativeWorkspacePath(resolvedRoot, input.screenshot, {
        home,
        allowThirdParty: isThirdPartyConfirm,
        label: 'screenshot path',
      })
      : existing.screenshot;

    const nextRec = normalizeApplicationRecord({
      ...existing,
      status: 'applied',
      applied_at: appliedAt,
      updated_at: Date.parse(nowIso) >= Date.parse(appliedAt) ? nowIso : appliedAt,
      url: finalUrl,
      screenshot: validatedConfirmScreenshot,
      cv_version_id: finalCvVersionId,
      cv_tailoring: nextCvTailoring,
      submission_uncertain: false,
      notes: updatedNotes,
      stage_history: stageHistory,
      provenance: {
        ...existing.provenance,
        last_updated_by: 'cli_confirm_submit',
        receipt_verified: true,
      },
      notion_sync: nextNotionSync,
    });

    records[existingIdx] = nextRec;
    const saved = persistValidatedLedger(resolvedRoot, records, { home, ledgerPath: loaded.path });
    return {
      confirmed: true,
      application_id: nextRec.application_id,
      job_id: nextRec.job_id,
      status: nextRec.status,
      applied_at: nextRec.applied_at,
      receipt_verified: true,
      path: saved.path,
      record: nextRec,
    };
  });
}

export function transitionApplicationStage(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
} = {}) {
  if (!isObj(input)) throw new Error('transitionApplicationStage requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('transitionApplicationStage requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`transitionApplicationStage: invalid nowIso "${nowIso}".`);

  const atIso = input.at !== undefined ? input.at : nowIso;
  if (!isValidIsoDateTime(atIso)) {
    throw new Error(`transitionApplicationStage: invalid event timestamp "${atIso}".`);
  }

  const targetInfo = normalizeStatus(input.to_status);
  if (!targetInfo.valid || !SUBMITTED_STATUS_SET.has(targetInfo.canonical)) {
    throw new Error(
      `transitionApplicationStage requires to_status in [applied (follow-up only), interview, assessment, offer, rejected, withdrawn]; received "${input.to_status}".`,
    );
  }
  const toStatus = targetInfo.canonical;

  const source = input.source || 'owner_manual_update';
  if (!STAGE_EVENT_SOURCES.has(source)) {
    throw new Error(`transitionApplicationStage: invalid source "${source}".`);
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const loaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const records = [...loaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const existingIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    if (existingIdx < 0) {
      throw new Error(`application_not_found: No application record exists for job_id "${input.job_id}".`);
    }

    const existing = normalizeApplicationRecord(records[existingIdx]);
    if (!SUBMITTED_STATUS_SET.has(existing.status) || existing.submission_uncertain === true) {
      throw new Error(
        `cannot_transition_unsubmitted: Application "${existing.job_id}" has status "${existing.status}" (submission_uncertain=${existing.submission_uncertain === true}); cannot transition to "${toStatus}" without verified submission.`,
      );
    }

    const allowedTargets = ALLOWED_STAGE_TRANSITIONS[existing.status] || [];
    const isFollowUpOnApplied = existing.status === 'applied' && toStatus === 'applied' && Boolean(input.follow_up);
    const hasSupplementalUpdate = Boolean(input.interview || input.assessment || input.follow_up || isNonEmptyString(input.notes));

    // Terminal state handling: allow idempotent repeat of exact same terminal state with no conflicting changes
    if (!allowedTargets.includes(toStatus) && !isFollowUpOnApplied) {
      if (existing.status === toStatus && !hasSupplementalUpdate) {
        return {
          action: 'idempotent_no_op',
          application_id: existing.application_id,
          job_id: existing.job_id,
          from_status: existing.status,
          to_status: existing.status,
          path: loaded.path,
          record: existing,
        };
      }
      throw new Error(
        `invalid_stage_transition: Cannot transition application "${existing.job_id}" from "${existing.status}" to "${toStatus}". Allowed targets: [${allowedTargets.join(', ')}].`,
      );
    }

    // Idempotency: exact same status with no new structured metadata or notes
    if (existing.status === toStatus && !hasSupplementalUpdate) {
      return {
        action: 'idempotent_no_op',
        application_id: existing.application_id,
        job_id: existing.job_id,
        from_status: existing.status,
        to_status: existing.status,
        path: loaded.path,
        record: existing,
      };
    }

    assertChronologicalTimestamp(existing, atIso, 'transition timestamp');

    const interviews = [...existing.interviews];
    if (input.interview) {
      if (!isObj(input.interview)) throw new Error('transitionApplicationStage: interview must be an object.');
      const stage = input.interview.stage || 'other';
      if (!INTERVIEW_STAGES.has(stage)) throw new Error(`Invalid interview stage "${stage}".`);
      const ivStatus = input.interview.status || 'invited';
      if (!INTERVIEW_STATUSES.has(ivStatus)) throw new Error(`Invalid interview status "${ivStatus}".`);
      const ivOutcome = input.interview.outcome || 'pending';
      if (!INTERVIEW_OUTCOMES.has(ivOutcome)) throw new Error(`Invalid interview outcome "${ivOutcome}".`);
      const round = input.interview.round !== undefined ? Number(input.interview.round) : (interviews.length + 1);
      if (!Number.isInteger(round) || round < 1) throw new Error('Interview round must be an integer >= 1.');
      const ivId = isNonEmptyString(input.interview.interview_id)
        ? input.interview.interview_id.trim()
        : `iv_r${round}_${stage}`;
      const validatedDossierRel = input.interview.dossier_rel !== undefined
        ? assertOptionalSafeRelativeWorkspacePath(resolvedRoot, input.interview.dossier_rel, {
          home,
          allowThirdParty: existing.provenance?.third_party_subject === true,
          label: 'interview.dossier_rel',
        })
        : null;
      const ivObj = {
        interview_id: ivId,
        round,
        stage,
        scheduled_at: input.interview.scheduled_at ?? null,
        timezone: input.interview.timezone ?? null,
        status: ivStatus,
        outcome: ivOutcome,
        dossier_rel: validatedDossierRel,
        notes: typeof input.interview.notes === 'string' ? input.interview.notes : '',
      };
      const idx = interviews.findIndex(x => x.interview_id === ivId);
      if (idx >= 0) interviews[idx] = ivObj;
      else interviews.push(ivObj);
    }

    const assessments = [...existing.assessments];
    if (input.assessment) {
      if (!isObj(input.assessment)) throw new Error('transitionApplicationStage: assessment must be an object.');
      const aType = input.assessment.type || 'other';
      if (!ASSESSMENT_TYPES.has(aType)) throw new Error(`Invalid assessment type "${aType}".`);
      const aStatus = input.assessment.status || 'assigned';
      if (!ASSESSMENT_STATUSES.has(aStatus)) throw new Error(`Invalid assessment status "${aStatus}".`);
      const aOutcome = input.assessment.outcome || 'pending';
      if (!ASSESSMENT_OUTCOMES.has(aOutcome)) throw new Error(`Invalid assessment outcome "${aOutcome}".`);
      const aId = isNonEmptyString(input.assessment.assessment_id)
        ? input.assessment.assessment_id.trim()
        : `asmt_${assessments.length + 1}_${aType}`;
      const validatedBlueprintRel = input.assessment.blueprint_rel !== undefined
        ? assertOptionalSafeRelativeWorkspacePath(resolvedRoot, input.assessment.blueprint_rel, {
          home,
          allowThirdParty: existing.provenance?.third_party_subject === true,
          label: 'assessment.blueprint_rel',
        })
        : null;
      const aObj = {
        assessment_id: aId,
        type: aType,
        received_at: input.assessment.received_at ?? atIso,
        due_at: input.assessment.due_at ?? null,
        submitted_at: input.assessment.submitted_at ?? null,
        status: aStatus,
        outcome: aOutcome,
        blueprint_rel: validatedBlueprintRel,
        notes: typeof input.assessment.notes === 'string' ? input.assessment.notes : '',
      };
      const idx = assessments.findIndex(x => x.assessment_id === aId);
      if (idx >= 0) assessments[idx] = aObj;
      else assessments.push(aObj);
    }

    let followUp = existing.follow_up ? { ...existing.follow_up } : null;
    if (input.follow_up) {
      if (!isObj(input.follow_up)) throw new Error('transitionApplicationStage: follow_up must be an object.');
      const fStatus = input.follow_up.status ?? followUp?.status ?? 'pending';
      if (!FOLLOW_UP_STATUSES.has(fStatus)) throw new Error(`Invalid follow_up status "${fStatus}".`);
      const prevCount = Number.isInteger(followUp?.follow_up_count) ? followUp.follow_up_count : 0;
      let nextCount = prevCount;
      if (input.follow_up.follow_up_count !== undefined) {
        if (!Number.isInteger(input.follow_up.follow_up_count) || input.follow_up.follow_up_count < 0) {
          throw new Error('follow_up.follow_up_count must be an integer >= 0.');
        }
        nextCount = input.follow_up.follow_up_count;
      } else if (input.follow_up.increment_count === true || (fStatus === 'sent' && followUp?.status !== 'sent')) {
        nextCount = prevCount + 1;
      }
      const validatedDraftRel = input.follow_up.draft_rel !== undefined
        ? assertOptionalSafeRelativeWorkspacePath(resolvedRoot, input.follow_up.draft_rel, {
          home,
          allowThirdParty: existing.provenance?.third_party_subject === true,
          label: 'follow_up.draft_rel',
        })
        : (followUp?.draft_rel ?? null);
      followUp = {
        next_due_at: input.follow_up.next_due_at !== undefined ? input.follow_up.next_due_at : (followUp?.next_due_at ?? null),
        last_followed_up_at: input.follow_up.last_followed_up_at !== undefined
          ? input.follow_up.last_followed_up_at
          : (fStatus === 'sent' ? atIso : (followUp?.last_followed_up_at ?? null)),
        follow_up_count: nextCount,
        status: fStatus,
        draft_rel: validatedDraftRel,
      };
    }

    const stageHistory = [...existing.stage_history, {
      event_id: makeStageEventId('trn', toStatus, atIso, existing.stage_history.length),
      from_status: existing.status,
      to_status: toStatus,
      at: atIso,
      source,
      verified: input.verified === true || source === 'owner_manual_update' || source === 'recruiter_inbox_triage',
      notes: typeof input.notes === 'string' ? input.notes.slice(0, 240) : '',
    }];

    // Preserve original applied_at & receipt quotes in notes immutably
    const outcomeNote = isNonEmptyString(input.notes)
      ? `outcome: ${toStatus} | ${input.notes.trim()} | updated_at: ${atIso}`
      : `outcome: ${toStatus} | updated_at: ${atIso}`;
    const updatedNotes = appendNotesPart(existing.notes, outcomeNote);

    const nextRec = normalizeApplicationRecord({
      ...existing,
      status: toStatus,
      applied_at: existing.applied_at, // strictly immutable
      updated_at: Date.parse(nowIso) >= Date.parse(atIso) ? nowIso : atIso,
      notes: updatedNotes,
      stage_history: stageHistory,
      interviews,
      assessments,
      follow_up: followUp,
      provenance: {
        ...existing.provenance,
        last_updated_by: `cli_transition:${source}`,
        receipt_verified: existing.provenance?.receipt_verified === true,
      },
    });

    records[existingIdx] = nextRec;
    const saved = persistValidatedLedger(resolvedRoot, records, { home, ledgerPath: loaded.path });
    return {
      action: 'transitioned',
      application_id: nextRec.application_id,
      job_id: nextRec.job_id,
      from_status: existing.status,
      to_status: nextRec.status,
      applied_at: nextRec.applied_at,
      path: saved.path,
      record: nextRec,
    };
  });
}

export function recordSkippedJob(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
} = {}) {
  if (!isObj(input)) throw new Error('recordSkippedJob requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('recordSkippedJob requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`recordSkippedJob: invalid nowIso "${nowIso}".`);
  if (!SKIP_REASON_SET.has(input.reason)) {
    throw new Error(`recordSkippedJob: invalid reason "${input.reason}". Expected one of: ${SKIP_REASONS.join(', ')}.`);
  }
  const skipReason = typeof input.skip_reason === 'string' ? input.skip_reason.trim() : '';
  if (!skipReason) {
    throw new Error('recordSkippedJob requires a non-empty skip_reason (<= 160 chars).');
  }
  if (skipReason.length > MAX_SKIP_REASON_LEN) {
    throw new Error(`recordSkippedJob: skip_reason exceeds maximum length (${MAX_SKIP_REASON_LEN} chars).`);
  }
  if (input.match_score !== undefined && input.match_score !== null) {
    if (typeof input.match_score !== 'number' || !Number.isFinite(input.match_score) || input.match_score < 0 || input.match_score > 10) {
      throw new Error('recordSkippedJob: match_score must be a number in 0..10 or null.');
    }
  }

  const validatedUrl = input.url !== undefined ? assertValidOptionalHttpUrl(input.url, 'url') : undefined;
  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const loaded = readValidatedSkippedJobs(resolvedRoot, { home });
    const records = [...loaded.records];
    const key = normalizeJobIdKey(input.job_id);
    const existingIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === key);
    const existing = existingIdx >= 0 ? records[existingIdx] : null;

    const candidate = {
      job_id: existing ? existing.job_id : input.job_id.trim(),
      platform: input.platform !== undefined ? input.platform : (existing?.platform ?? null),
      company: input.company !== undefined ? input.company : (existing?.company ?? null),
      title: input.title !== undefined ? input.title : (existing?.title ?? null),
      url: validatedUrl !== undefined ? validatedUrl : (existing?.url ?? null),
      match_score: input.match_score !== undefined ? input.match_score : (existing?.match_score ?? null),
      tier: 'C',
      reason: input.reason,
      skip_reason: skipReason,
      ...(isUsableJobId(input.matched_job_id) ? { matched_job_id: input.matched_job_id.trim() } : (existing?.matched_job_id ? { matched_job_id: existing.matched_job_id } : {})),
      skipped_at: existing?.skipped_at ?? nowIso,
      run_id: input.run_id ?? existing?.run_id ?? nowIso.slice(0, 10),
    };

    if (
      existing &&
      existing.reason === candidate.reason &&
      existing.skip_reason === candidate.skip_reason &&
      (existing.company ?? null) === candidate.company &&
      (existing.title ?? null) === candidate.title &&
      (existing.platform ?? null) === candidate.platform &&
      (existing.url ?? null) === candidate.url
    ) {
      return {
        action: 'idempotent_no_op',
        job_id: existing.job_id,
        reason: existing.reason,
        path: loaded.path,
        record: existing,
      };
    }

    if (existingIdx >= 0) records[existingIdx] = candidate;
    else records.push(candidate);

    writeAtomic(loaded.path, JSON.stringify(records, null, 2) + '\n', { mode: 0o600, boundary: resolvedRoot, home });
    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      job_id: candidate.job_id,
      reason: candidate.reason,
      path: loaded.path,
      record: candidate,
    };
  });
}

// ---------------- CV Version Registration & Cross-File Transaction Linking (T11.3) ----------------

export function registerOwnerCvVersionForWorkspace(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('registerOwnerCvVersionForWorkspace requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`registerOwnerCvVersionForWorkspace: invalid nowIso "${nowIso}".`);
  if (input.owner_scope === 'third_party') {
    throw new Error('Refusing to register third-party CV into owner CV version registry (third-party isolation enforced).');
  }
  if (!isNonEmptyString(input.cv_version_id)) {
    throw new Error('registerOwnerCvVersionForWorkspace requires a non-empty cv_version_id.');
  }
  if (!isNonEmptyString(input.label)) {
    throw new Error('registerOwnerCvVersionForWorkspace requires a non-empty label.');
  }
  if (input.kind !== 'generic' && input.kind !== 'tailored') {
    throw new Error('registerOwnerCvVersionForWorkspace requires kind "generic" or "tailored".');
  }
  if (!isNonEmptyString(input.file)) {
    throw new Error('registerOwnerCvVersionForWorkspace requires a workspace file path (--file) to compute SHA-256.');
  }

  const resolvedRoot = path.resolve(root);
  const resolvedCvFile = assertWorkspacePathSafe(resolvedRoot, input.file, { home, label: 'CV file path' });
  if (!fs.existsSync(resolvedCvFile)) {
    throw new Error(`CV file not found: "${resolvedCvFile}"`);
  }
  const fStat = fs.lstatSync(resolvedCvFile);
  if (fStat.isSymbolicLink() || !fStat.isFile()) {
    throw new Error(`CV file must be a regular non-symlink file: "${resolvedCvFile}"`);
  }

  const localRefRel = path.relative(resolvedRoot, resolvedCvFile).replace(/\\/g, '/');
  if (isThirdPartyCvPath(localRefRel)) {
    throw new Error(`Refusing to register third-party CV path "${localRefRel}" into owner CV registry (third-party isolation enforced).`);
  }

  const contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(resolvedCvFile)).digest('hex');

  let atsMetrics = null;
  if (
    input.ats_keyword_before_pct !== undefined ||
    input.ats_keyword_after_pct !== undefined ||
    input.hygiene_score !== undefined ||
    input.page_count !== undefined
  ) {
    atsMetrics = {
      keyword_match_before_pct: input.ats_keyword_before_pct ?? null,
      keyword_match_after_pct: input.ats_keyword_after_pct ?? null,
      hygiene_score: input.hygiene_score ?? null,
      page_count: input.page_count ?? null,
    };
  }

  let tailoringMetadata = null;
  if (isNonEmptyString(input.target_role)) {
    tailoringMetadata = {
      target_job_id: isUsableJobId(input.target_job_id) ? input.target_job_id.trim() : (isUsableJobId(input.link_job_id) ? input.link_job_id.trim() : null),
      target_role: input.target_role.trim(),
      emphasized_skills: Array.isArray(input.emphasized_skills) ? input.emphasized_skills : [],
      true_gaps_excluded: Array.isArray(input.true_gaps_excluded) ? input.true_gaps_excluded : [],
    };
  }

  const linkJobId = isUsableJobId(input.link_job_id) ? input.link_job_id.trim() : null;

  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });

    // Validate optional base_cv_version_id against self-cycle, missing ancestry, and third-party isolation
    const cvById = new Map();
    for (const v of cvLoaded.registry.versions) {
      if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
        cvById.set(v.cv_version_id.trim(), v);
      }
    }
    let normalizedBaseCvId = null;
    if (input.base_cv_version_id !== undefined && input.base_cv_version_id !== null) {
      if (!isNonEmptyString(input.base_cv_version_id)) {
        throw new Error('registerOwnerCvVersionForWorkspace: base_cv_version_id must be a non-empty string or null.');
      }
      normalizedBaseCvId = input.base_cv_version_id.trim();
      if (normalizedBaseCvId === input.cv_version_id.trim()) {
        throw new Error(`invalid_base_cv_version: base_cv_version_id "${normalizedBaseCvId}" cannot reference itself.`);
      }
      const baseVer = cvById.get(normalizedBaseCvId);
      if (!baseVer) {
        throw new Error(`invalid_base_cv_version: base_cv_version_id "${normalizedBaseCvId}" is not registered in logs/cv-versions.json.`);
      }
      const baseOwnCheck = classifyCvRegistryEntryOwnership(baseVer, cvById);
      if (!baseOwnCheck.isOwner) {
        throw new Error(`third_party_blocked: Refusing third-party or unverified base_cv_version_id "${normalizedBaseCvId}" (${baseOwnCheck.reason}).`);
      }
    }

    // Single-file registration (no application link)
    const existingVer = cvLoaded.registry.versions.find(v => v.cv_version_id === input.cv_version_id.trim());
    if (!linkJobId) {
      const nextRegistry = registerCvVersion(cvLoaded.registry, {
        cv_version_id: input.cv_version_id.trim(),
        version_number: input.version_number,
        label: input.label.trim(),
        kind: input.kind,
        owner_scope: 'owner',
        base_cv_version_id: normalizedBaseCvId,
        content_sha256: contentSha256,
        persona_id: input.persona_id ?? null,
        language: input.language || 'en',
        local_ref_rel: localRefRel,
        tailoring_metadata: tailoringMetadata,
        ats_metrics: atsMetrics,
        created_at: existingVer?.created_at ?? nowIso,
        updated_at: nowIso,
      });
      const check = validateCvVersionsRegistry(nextRegistry);
      if (!check.valid) {
        throw new Error(`Invalid CV version registry: ${check.errors.join('; ')}`);
      }
      writeAtomic(cvLoaded.path, JSON.stringify(nextRegistry, null, 2) + '\n', { mode: 0o600, boundary: resolvedRoot, home });
      const registered = nextRegistry.versions.find(v => v.cv_version_id === input.cv_version_id.trim());
      return {
        registered: true,
        linked_application_id: null,
        content_sha256: contentSha256,
        local_ref_rel: localRefRel,
        cv_registry_path: cvLoaded.path,
        ledger_path: null,
        version: registered,
      };
    }

    // Two-file journaled transaction: logs/cv-versions.json + logs/applications-log.json
    const ledgerLoaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const records = [...ledgerLoaded.records];
    const linkKey = normalizeJobIdKey(linkJobId);
    const appIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === linkKey);
    if (appIdx < 0) {
      throw new Error(`application_not_found: Cannot link CV version "${input.cv_version_id}" to missing job_id "${linkJobId}".`);
    }
    const existingApp = normalizeApplicationRecord(records[appIdx]);
    const existingAppOwn = classifyApplicationOwnership(existingApp, cvLoaded.exists ? cvLoaded.registry : null);
    if (!existingAppOwn.isOwner) {
      throw new Error(`third_party_blocked: Refusing to link owner CV "${input.cv_version_id}" to third-party or unverified application "${linkJobId}" (${existingAppOwn.reason}).`);
    }

    // 1. Prepare and validate BOTH documents in memory before writing anything to disk
    const nextRegistry = registerCvVersion(cvLoaded.registry, {
      cv_version_id: input.cv_version_id.trim(),
      version_number: input.version_number,
      label: input.label.trim(),
      kind: input.kind,
      owner_scope: 'owner',
      base_cv_version_id: normalizedBaseCvId,
      content_sha256: contentSha256,
      persona_id: input.persona_id ?? null,
      language: input.language || 'en',
      local_ref_rel: localRefRel,
      tailoring_metadata: tailoringMetadata,
      ats_metrics: atsMetrics,
      application_ids: [existingApp.application_id],
      created_at: existingVer?.created_at ?? nowIso,
      updated_at: nowIso,
    });
    const cvCheck = validateCvVersionsRegistry(nextRegistry);
    if (!cvCheck.valid) {
      throw new Error(`Invalid CV version registry before commit: ${cvCheck.errors.join('; ')}`);
    }

    const registeredEntry = nextRegistry.versions.find(v => v.cv_version_id === input.cv_version_id.trim());
    const nextApp = normalizeApplicationRecord({
      ...existingApp,
      cv_version_id: input.cv_version_id.trim(),
      cv_tailoring: {
        is_tailored: input.kind === 'tailored',
        base_cv_version_id: registeredEntry?.base_cv_version_id ?? null,
        ats_keyword_before_pct: input.ats_keyword_before_pct !== undefined
          ? input.ats_keyword_before_pct
          : (existingApp.cv_tailoring?.ats_keyword_before_pct ?? null),
        ats_keyword_after_pct: input.ats_keyword_after_pct !== undefined
          ? input.ats_keyword_after_pct
          : (existingApp.cv_tailoring?.ats_keyword_after_pct ?? null),
        tailored_folder_rel: input.kind === 'tailored'
          ? path.dirname(localRefRel).replace(/\\/g, '/')
          : (existingApp.cv_tailoring?.tailored_folder_rel ?? null),
        tailoring_notes_rel: existingApp.cv_tailoring?.tailoring_notes_rel ?? null,
      },
      updated_at: existingApp.applied_at && Date.parse(nowIso) < Date.parse(existingApp.applied_at)
        ? existingApp.applied_at
        : nowIso,
      provenance: {
        ...existingApp.provenance,
        last_updated_by: 'cli_cv_register_link',
      },
    });
    records[appIdx] = nextApp;
    const ledgerCheck = validateApplicationLedger(records);
    if (!ledgerCheck.valid) {
      throw new Error(`Invalid applications ledger before commit: ${ledgerCheck.errors.join('; ')}`);
    }

    // 2. Write crash-detectable pre-transaction journal (logs/.ledger-tx.json)
    const txPath = getLedgerTxPath(resolvedRoot);
    const txId = `tx_${crypto.randomBytes(8).toString('hex')}`;
    const txJournal = {
      tx_id: txId,
      operation: 'cv_register_link',
      started_at: nowIso,
      stage: 'prepared',
      files: ['logs/cv-versions.json', 'logs/applications-log.json'],
      snapshots: [
        { rel_path: 'logs/cv-versions.json', existed: cvLoaded.exists, raw_content: cvLoaded.raw },
        { rel_path: 'logs/applications-log.json', existed: ledgerLoaded.exists, raw_content: ledgerLoaded.raw },
      ],
    };
    writeAtomic(txPath, JSON.stringify(txJournal, null, 2) + '\n', { mode: 0o600, boundary: resolvedRoot, home });

    const cvJson = JSON.stringify(nextRegistry, null, 2) + '\n';
    const ledgerJson = JSON.stringify(records, null, 2) + '\n';

    // 3. Persist file 1 (logs/cv-versions.json), then file 2 (logs/applications-log.json)
    // On failure during file 2, execute immediate compensating rollback of file 1.
    try {
      if (_testHooks?.beforeFirstWrite) _testHooks.beforeFirstWrite({ txId, txPath });
      writeAtomic(cvLoaded.path, cvJson, { mode: 0o600, boundary: resolvedRoot, home });
      if (_testHooks?.afterFirstWrite) _testHooks.afterFirstWrite({ txId, txPath });
    } catch (firstErr) {
      // First write failed before mutating file 2; clean up prepared journal if file 1 wasn't mutated
      try {
        if (cvLoaded.exists) {
          writeAtomic(cvLoaded.path, cvLoaded.raw, { mode: 0o600, boundary: resolvedRoot, home });
        } else if (fs.existsSync(cvLoaded.path)) {
          fs.unlinkSync(cvLoaded.path);
        }
        if (fs.existsSync(txPath)) fs.unlinkSync(txPath);
      } catch { /* leave tx journal for explicit recovery */ }
      throw new Error(`cv_register_link_aborted_step1: ${firstErr.message}`);
    }

    try {
      if (_testHooks?.beforeSecondWrite) _testHooks.beforeSecondWrite({ txId, txPath });
      writeAtomic(ledgerLoaded.path, ledgerJson, { mode: 0o600, boundary: resolvedRoot, home });
      if (_testHooks?.afterSecondWrite) _testHooks.afterSecondWrite({ txId, txPath });
    } catch (secondErr) {
      // Compensating rollback of file 1 (logs/cv-versions.json)
      let rollbackOk = false;
      try {
        if (_testHooks?.onRollback) _testHooks.onRollback({ txId, txPath });
        if (cvLoaded.exists) {
          writeAtomic(cvLoaded.path, cvLoaded.raw, { mode: 0o600, boundary: resolvedRoot, home });
        } else if (fs.existsSync(cvLoaded.path)) {
          refuseSymlink(cvLoaded.path, resolvedRoot, home);
          fs.unlinkSync(cvLoaded.path);
        }
        rollbackOk = true;
      } catch {
        rollbackOk = false;
      }

      if (rollbackOk) {
        try { if (fs.existsSync(txPath)) fs.unlinkSync(txPath); } catch { /* ignore */ }
        throw new Error(`cv_register_link_rolled_back: Second write failed and logs/cv-versions.json was rolled back cleanly: ${secondErr.message}`);
      } else {
        try {
          writeAtomic(txPath, JSON.stringify({ ...txJournal, stage: 'rollback_failed' }, null, 2) + '\n', {
            mode: 0o600,
            boundary: resolvedRoot,
            home,
          });
        } catch { /* preserve existing txPath */ }
        throw new Error(`cv_register_link_rollback_failed: Second write failed (${secondErr.message}) AND automatic rollback failed; transaction journal preserved at "${txPath}" for explicit recovery.`);
      }
    }

    // 4. Both writes succeeded — remove transaction journal
    if (fs.existsSync(txPath)) fs.unlinkSync(txPath);

    const registered = nextRegistry.versions.find(v => v.cv_version_id === input.cv_version_id.trim());
    return {
      registered: true,
      tx_id: txId,
      linked_application_id: existingApp.application_id,
      linked_job_id: existingApp.job_id,
      content_sha256: contentSha256,
      local_ref_rel: localRefRel,
      cv_registry_path: cvLoaded.path,
      ledger_path: ledgerLoaded.path,
      version: registered,
      application: nextApp,
    };
  });
}

// ---------------- Aligned Status Metrics Helper (T11.4) ----------------

export function computeWorkspaceStatusMetrics(root, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const loaded = readValidatedApplicationsLedger(resolvedRoot, { home });
  const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });
  const cvRegistry = cvLoaded.exists ? cvLoaded.registry : null;
  const records = loaded.records;
  const gate = evaluatePreSubmitGate(resolvedRoot, {}, { home, sourceRoot, nowIso, recordsOverride: records, cvRegistryOverride: cvRegistry });
  const analytics = computeCareerAnalytics(records, cvRegistry, { nowIso, period: 'all' });

  const f = analytics.funnel;
  // Find best platform respecting MIN_N = 5 (never misleadingly claiming 100% on n < 5)
  const platforms = analytics.source_performance.by_platform;
  let topPlatform = 'n/a (no submitted applications yet)';
  if (platforms.length > 0) {
    const sufficient = platforms.filter(p => p.callback_rate.sample_sufficient);
    if (sufficient.length > 0) {
      sufficient.sort((a, b) =>
        (b.callback_rate.rate_pct - a.callback_rate.rate_pct) ||
        (b.submitted - a.submitted) ||
        a.platform.localeCompare(b.platform),
      );
      const top = sufficient[0];
      topPlatform = `${top.platform} (${top.callbacks}/${top.submitted} callbacks · ${top.callback_rate.rate_pct}%)`;
    } else {
      const mostActive = platforms[0];
      topPlatform = `n/a (insufficient sample: ${mostActive.platform} has ${mostActive.submitted} submitted < MIN_N=${MIN_SAMPLE_SIZE})`;
    }
  }

  return {
    daily_cap: {
      today: gate.checks.daily_cap.today_counted,
      today_applied: gate.checks.daily_cap.today_applied,
      submission_uncertain_today: gate.checks.daily_cap.today_submission_uncertain,
      effective_cap: gate.checks.daily_cap.effective_cap,
      max_per_day: gate.checks.daily_cap.max_per_day,
      warmup_active: gate.checks.daily_cap.warmup_active,
      dry_run: gate.checks.daily_cap.dry_run,
    },
    pipeline: {
      applied: f.submitted_count,
      interviewing: f.ever_interviewed_count,
      assessment: f.ever_assessed_count,
      offers: f.offer_count,
      rejected: f.rejected_count,
      withdrawn: f.withdrawn_count,
      silent_14d: f.silent_14d_count,
      // Backward-compatible key: reflects confirmed rejected + withdrawn ONLY (never >= 14d silence)
      rejected_or_ghosted: f.rejected_count + f.withdrawn_count,
    },
    sample_sufficiency: analytics.sample_sufficiency,
    third_party_excluded: analytics.isolation.third_party_applications_excluded,
    top_platform: topPlatform,
  };
}

// ---------------- Stage 6 (T12.1): Run Ledger & Session Checkpoint State Machine ----------------

function commitTwoFileLedgerTransaction(root, {
  operation,
  nowIso,
  home = os.homedir(),
  file1Rel,
  file1Path,
  file1Exists,
  file1OldRaw,
  file1NewContent,
  file2Rel,
  file2Path,
  file2Exists,
  file2OldRaw,
  file2NewContent,
  _testHooks = null,
}) {
  const resolvedRoot = path.resolve(root);
  const txPath = getLedgerTxPath(resolvedRoot);
  const txId = `tx_${crypto.randomBytes(8).toString('hex')}`;
  const txJournal = {
    tx_id: txId,
    operation,
    started_at: nowIso,
    stage: 'prepared',
    files: [file1Rel, file2Rel],
    snapshots: [
      { rel_path: file1Rel, existed: Boolean(file1Exists), raw_content: file1Exists ? file1OldRaw : null },
      { rel_path: file2Rel, existed: Boolean(file2Exists), raw_content: file2Exists ? file2OldRaw : null },
    ],
  };
  writeAtomic(txPath, JSON.stringify(txJournal, null, 2) + '\n', { mode: 0o600, boundary: resolvedRoot, home });

  try {
    if (_testHooks?.beforeFirstWrite) _testHooks.beforeFirstWrite({ txId, txPath });
    writeAtomic(file1Path, file1NewContent, { mode: 0o600, boundary: resolvedRoot, home });
    if (_testHooks?.afterFirstWrite) _testHooks.afterFirstWrite({ txId, txPath });
  } catch (firstErr) {
    try {
      if (file1Exists && typeof file1OldRaw === 'string') {
        writeAtomic(file1Path, file1OldRaw, { mode: 0o600, boundary: resolvedRoot, home });
      } else if (!file1Exists && fs.existsSync(file1Path)) {
        refuseSymlink(file1Path, resolvedRoot, home);
        fs.unlinkSync(file1Path);
      }
      if (fs.existsSync(txPath)) fs.unlinkSync(txPath);
    } catch { /* preserve txPath for explicit recovery */ }
    throw new Error(`${operation}_aborted_step1: ${firstErr.message}`);
  }

  try {
    if (_testHooks?.beforeSecondWrite) _testHooks.beforeSecondWrite({ txId, txPath });
    writeAtomic(file2Path, file2NewContent, { mode: 0o600, boundary: resolvedRoot, home });
    if (_testHooks?.afterSecondWrite) _testHooks.afterSecondWrite({ txId, txPath });
  } catch (secondErr) {
    let rollbackOk = false;
    try {
      if (_testHooks?.onRollback) _testHooks.onRollback({ txId, txPath });
      if (file1Exists && typeof file1OldRaw === 'string') {
        writeAtomic(file1Path, file1OldRaw, { mode: 0o600, boundary: resolvedRoot, home });
      } else if (!file1Exists && fs.existsSync(file1Path)) {
        refuseSymlink(file1Path, resolvedRoot, home);
        fs.unlinkSync(file1Path);
      }
      rollbackOk = true;
    } catch {
      rollbackOk = false;
    }

    if (rollbackOk) {
      try { if (fs.existsSync(txPath)) fs.unlinkSync(txPath); } catch { /* ignore */ }
      throw new Error(`${operation}_rolled_back: Second write failed and "${file1Rel}" was rolled back cleanly: ${secondErr.message}`);
    }
    try {
      writeAtomic(txPath, JSON.stringify({ ...txJournal, stage: 'rollback_failed' }, null, 2) + '\n', {
        mode: 0o600,
        boundary: resolvedRoot,
        home,
      });
    } catch { /* preserve existing txPath */ }
    throw new Error(`${operation}_rollback_failed: Second write failed (${secondErr.message}) AND automatic rollback failed; transaction journal preserved at "${txPath}" for explicit recovery.`);
  }

  if (fs.existsSync(txPath)) fs.unlinkSync(txPath);
  return { tx_id: txId, file1_path: file1Path, file2_path: file2Path };
}

export function readValidatedDailyRunFile(root, runId, { home = os.homedir() } = {}) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run_id "${runId}"; expected YYYY-MM-DD.`);
  }
  const resolvedRoot = path.resolve(root);
  const relPath = `logs/runs/${runId}.json`;
  const runPath = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs', `${runId}.json`), {
    home,
    label: 'daily run log',
  });
  if (!fs.existsSync(runPath)) {
    return { path: runPath, rel_path: relPath, exists: false, raw: null, doc: null };
  }
  const raw = fs.readFileSync(runPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in "${runPath}"; refusing mutation: ${err.message}`);
  }
  const check = validateDailyRun(parsed);
  if (!check.valid) {
    throw new Error(`Existing "${runPath}" failed daily-run validation: ${check.errors.join('; ')}`);
  }
  return { path: runPath, rel_path: relPath, exists: true, raw, doc: parsed };
}

export function readValidatedSessionCheckpointFile(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const relPath = 'logs/runs/current-session-checkpoint.json';
  const cpPath = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs', 'current-session-checkpoint.json'), {
    home,
    label: 'session checkpoint',
  });
  if (!fs.existsSync(cpPath)) {
    return { path: cpPath, rel_path: relPath, exists: false, raw: null, doc: null };
  }
  const raw = fs.readFileSync(cpPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in "${cpPath}"; refusing mutation: ${err.message}`);
  }
  const check = validateSessionCheckpoint(parsed);
  if (!check.valid) {
    throw new Error(`Existing "${cpPath}" failed session-checkpoint validation: ${check.errors.join('; ')}`);
  }
  return { path: cpPath, rel_path: relPath, exists: true, raw, doc: parsed };
}

export function deriveRunCountsFromLedger(root, runId, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  recordsOverride = null,
  skippedOverride = null,
} = {}) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
    throw new Error(`deriveRunCountsFromLedger: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
  }
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`deriveRunCountsFromLedger: invalid nowIso "${nowIso}".`);
  }
  const resolvedRoot = path.resolve(root);
  const records = recordsOverride !== null
    ? recordsOverride
    : readValidatedApplicationsLedger(resolvedRoot, { home }).records;
  const skippedRecords = skippedOverride !== null
    ? skippedOverride
    : readValidatedSkippedJobs(resolvedRoot, { home }).records;
  const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });
  const cvRegistry = cvLoaded.exists ? cvLoaded.registry : null;

  let applied = 0;
  let prepared = 0;
  let dryRunCount = 0;
  let needsReview = 0;
  let skipped = 0;
  let failed = 0;
  let discovered = 0;

  const seenRunJobKeys = new Set();
  const allLedgerJobMap = new Map();
  const handledJobKeys = new Set();
  const uncertainJobKeys = new Set();
  const uncertainForRunKeys = new Set();
  const platformsSeen = new Set();
  const perPlatformApplied = {};

  for (const raw of records) {
    if (!isObj(raw) || !isUsableJobId(raw.job_id)) continue;
    if (!isOwnerApplicationRecord(raw, cvRegistry)) continue;
    const st = normalizeStatus(raw.status);
    if (!st.valid) continue;
    const key = normalizeJobIdKey(raw.job_id);
    const norm = normalizeApplicationRecord(raw);
    allLedgerJobMap.set(key, norm);

    const isSubmitted = SUBMITTED_STATUS_SET.has(st.canonical) && norm.submission_uncertain !== true;
    const isUncertain = norm.submission_uncertain === true;
    if (isUncertain) uncertainJobKeys.add(key);

    if (
      isSubmitted ||
      isUncertain ||
      st.canonical === 'skipped' ||
      st.canonical === 'dry_run' ||
      st.canonical === 'failed' ||
      st.canonical === 'aborted'
    ) {
      handledJobKeys.add(key);
    }

    const recRunId = isNonEmptyString(norm.run_id)
      ? norm.run_id.trim()
      : String(norm.applied_at || norm.discovered_at || norm.updated_at || '').slice(0, 10);

    if (recRunId === runId) {
      seenRunJobKeys.add(key);
      if (isNonEmptyString(norm.platform)) platformsSeen.add(norm.platform.trim().toLowerCase());
      if (isUncertain) {
        needsReview++;
        uncertainForRunKeys.add(key);
      } else if (isSubmitted) {
        applied++;
        const plat = String(norm.platform || 'other').trim().toLowerCase();
        perPlatformApplied[plat] = (perPlatformApplied[plat] || 0) + 1;
      } else if (st.canonical === 'prepared') {
        prepared++;
      } else if (st.canonical === 'dry_run') {
        dryRunCount++;
      } else if (st.canonical === 'needs_review') {
        needsReview++;
      } else if (st.canonical === 'skipped') {
        skipped++;
      } else if (st.canonical === 'failed' || st.canonical === 'aborted') {
        failed++;
      } else if (st.canonical === 'discovered') {
        discovered++;
      }
    }
  }

  for (const s of skippedRecords) {
    if (!isObj(s) || !isUsableJobId(s.job_id)) continue;
    const key = normalizeJobIdKey(s.job_id);
    handledJobKeys.add(key);
    const sRunId = isNonEmptyString(s.run_id)
      ? s.run_id.trim()
      : String(s.skipped_at || '').slice(0, 10);
    if (sRunId === runId && !seenRunJobKeys.has(key)) {
      seenRunJobKeys.add(key);
      skipped++;
      if (isNonEmptyString(s.platform)) platformsSeen.add(s.platform.trim().toLowerCase());
    }
  }

  const scanned = applied + prepared + dryRunCount + needsReview + skipped + failed + discovered;
  const gateNowIso = nowIso.slice(0, 10) === runId ? nowIso : `${runId}T12:00:00Z`;
  const gate = evaluatePreSubmitGate(resolvedRoot, {}, {
    home,
    sourceRoot,
    nowIso: gateNowIso,
    recordsOverride: records,
  });

  const counts = {
    scanned,
    prepared,
    applied,
    dry_run: dryRunCount,
    needs_review: needsReview,
    skipped,
    failed,
  };

  const caps = {
    effective_daily_cap: gate.checks.daily_cap.effective_cap,
    applied_today: gate.checks.daily_cap.today_applied,
    reserved_unresolved: gate.checks.daily_cap.today_submission_uncertain,
    per_platform_applied: perPlatformApplied,
  };

  return {
    run_id: runId,
    dry_run: gate.dry_run,
    counts,
    caps,
    all_ledger_jobs: allLedgerJobMap,
    handled_job_keys: handledJobKeys,
    uncertain_job_keys: uncertainJobKeys,
    uncertain_for_run_keys: uncertainForRunKeys,
    platforms_seen: [...platformsSeen].sort(),
  };
}

function reconcileCheckpointQueueWithLedger(rawQueue, rawProcessed, derived, { requireTrackedInLedger = false } = {}) {
  const processedOut = [];
  const processedKeys = new Set();
  const pushProcessed = id => {
    if (!isUsableJobId(id)) return;
    const key = normalizeJobIdKey(id);
    if (processedKeys.has(key)) return;
    const canonicalId = derived.all_ledger_jobs.get(key)?.job_id || id.trim();
    processedKeys.add(key);
    processedOut.push(canonicalId);
  };

  if (Array.isArray(rawProcessed)) {
    for (const id of rawProcessed) pushProcessed(id);
  }

  const queueOut = [];
  const queueKeys = new Set();
  const movedToProcessed = [];
  const untrackedRemoved = [];

  if (Array.isArray(rawQueue)) {
    for (const id of rawQueue) {
      if (!isUsableJobId(id)) continue;
      const key = normalizeJobIdKey(id);
      const canonicalId = derived.all_ledger_jobs.get(key)?.job_id || id.trim();
      if (processedKeys.has(key)) {
        movedToProcessed.push(canonicalId);
        continue;
      }
      if (derived.handled_job_keys.has(key)) {
        pushProcessed(canonicalId);
        movedToProcessed.push(canonicalId);
        continue;
      }
      if (requireTrackedInLedger && !derived.all_ledger_jobs.has(key)) {
        untrackedRemoved.push(canonicalId);
        continue;
      }
      if (!queueKeys.has(key)) {
        queueKeys.add(key);
        queueOut.push(canonicalId);
      }
    }
  }

  return {
    queue: queueOut,
    processed_job_ids: processedOut,
    moved_to_processed: movedToProcessed,
    untracked_removed: untrackedRemoved,
  };
}

export function startOrUpdateDailyRun(root, input = {}, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('startOrUpdateDailyRun requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`startOrUpdateDailyRun: invalid nowIso "${nowIso}".`);

  const runId = input.run_id !== undefined ? String(input.run_id).trim() : nowIso.slice(0, 10);
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`startOrUpdateDailyRun: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
  }
  const workflowMode = input.workflow_mode !== undefined ? String(input.workflow_mode).trim() : 'batch_review_first';
  if (!WORKFLOW_MODE_SET.has(workflowMode)) {
    throw new Error(`startOrUpdateDailyRun: invalid workflow_mode "${workflowMode}". Expected one of: ${WORKFLOW_MODES.join(', ')}.`);
  }
  const requestedPhase = input.phase !== undefined ? String(input.phase).trim() : null;
  if (requestedPhase !== null && (!RUN_PHASE_SET.has(requestedPhase) || requestedPhase === 'finished' || requestedPhase === 'aborted')) {
    throw new Error(`startOrUpdateDailyRun: invalid starting phase "${requestedPhase}". Use finishDailyRun to close a run.`);
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const runsDir = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs'), { home, label: 'runs directory' });
    fs.mkdirSync(runsDir, { recursive: true });
    refuseSymlink(runsDir, resolvedRoot, home);

    const existingRunLoaded = readValidatedDailyRunFile(resolvedRoot, runId, { home });
    const existingCpLoaded = readValidatedSessionCheckpointFile(resolvedRoot, { home });
    const existingRun = existingRunLoaded.doc;
    const existingCp = existingCpLoaded.doc;

    if (existingRun && (existingRun.status === 'completed' || existingRun.status === 'aborted')) {
      throw new Error(`cannot_restart_closed_run: Daily run "${runId}" is already "${existingRun.status}"; refusing to reopen a closed run.`);
    }

    const derived = deriveRunCountsFromLedger(resolvedRoot, runId, { home, sourceRoot, nowIso });
    const sameActiveCp = existingCp && existingCp.run_id === runId && existingCp.phase !== 'finished' && existingCp.phase !== 'aborted'
      ? existingCp
      : null;

    const reconciled = reconcileCheckpointQueueWithLedger(
      sameActiveCp?.queue || [],
      sameActiveCp?.processed_job_ids || [],
      derived,
    );

    const inputPlatforms = Array.isArray(input.platforms)
      ? input.platforms.filter(isNonEmptyString).map(p => p.trim().toLowerCase())
      : [];
    const mergedPlatforms = [...new Set([
      ...(existingRun?.platforms || []),
      ...inputPlatforms,
      ...derived.platforms_seen,
    ])];

    const stepDetail = isNonEmptyString(input.notes)
      ? input.notes.trim()
      : `workflow_mode=${workflowMode}, dry_run=${derived.dry_run}`;
    const nextRunDoc = {
      run_id: runId,
      started_at: existingRun?.started_at ?? nowIso,
      finished_at: null,
      dry_run: derived.dry_run,
      status: 'running',
      counts: derived.counts,
      platforms: mergedPlatforms,
      errors: Array.isArray(existingRun?.errors) ? [...existingRun.errors] : [],
      steps: [
        ...(existingRun?.steps || []),
        {
          at: nowIso,
          step: existingRun ? 'run_updated' : 'run_started',
          detail: stepDetail,
        },
      ],
      notes: input.notes !== undefined ? String(input.notes) : (existingRun?.notes ?? ''),
    };

    const runCheck = validateDailyRun(nextRunDoc);
    if (!runCheck.valid) {
      throw new Error(`Invalid daily run document before write: ${runCheck.errors.join('; ')}`);
    }

    const nextCpDoc = {
      kind: 'session_checkpoint',
      version: 1,
      run_id: runId,
      updated_at: nowIso,
      phase: requestedPhase || sameActiveCp?.phase || 'readiness',
      workflow_mode: input.workflow_mode !== undefined ? workflowMode : (sameActiveCp?.workflow_mode || workflowMode),
      dry_run: derived.dry_run,
      approval_mode: 'approve_before_submit',
      submission_authorized: false,
      approval_expired_on_resume: false,
      caps: derived.caps,
      processed_job_ids: reconciled.processed_job_ids,
      queue: reconciled.queue,
      awaiting_owner: sameActiveCp?.awaiting_owner ? [...sameActiveCp.awaiting_owner] : [],
      batch_selection: sameActiveCp?.batch_selection ?? null,
      consecutive_errors: sameActiveCp?.consecutive_errors ?? 0,
      next_action: isNonEmptyString(input.next_action)
        ? input.next_action.trim()
        : (sameActiveCp?.next_action || 'Verify readiness gates and discover candidate jobs.'),
      notes: input.notes !== undefined ? String(input.notes) : (sameActiveCp?.notes ?? ''),
    };

    const cpCheck = validateSessionCheckpoint(nextCpDoc);
    if (!cpCheck.valid) {
      throw new Error(`Invalid session checkpoint document before write: ${cpCheck.errors.join('; ')}`);
    }

    commitTwoFileLedgerTransaction(resolvedRoot, {
      operation: 'run_start',
      nowIso,
      home,
      file1Rel: existingRunLoaded.rel_path,
      file1Path: existingRunLoaded.path,
      file1Exists: existingRunLoaded.exists,
      file1OldRaw: existingRunLoaded.raw,
      file1NewContent: JSON.stringify(nextRunDoc, null, 2) + '\n',
      file2Rel: existingCpLoaded.rel_path,
      file2Path: existingCpLoaded.path,
      file2Exists: existingCpLoaded.exists,
      file2OldRaw: existingCpLoaded.raw,
      file2NewContent: JSON.stringify(nextCpDoc, null, 2) + '\n',
      _testHooks,
    });

    return {
      action: existingRun ? 'updated' : 'started',
      run_id: runId,
      run_path: existingRunLoaded.path,
      checkpoint_path: existingCpLoaded.path,
      run: nextRunDoc,
      checkpoint: nextCpDoc,
    };
  });
}

export function writeSessionCheckpoint(root, input = {}, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('writeSessionCheckpoint requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`writeSessionCheckpoint: invalid nowIso "${nowIso}".`);
  if (input.submission_authorized === true) {
    throw new Error('checkpoint_cannot_authorize_submission: Session checkpoints never authorize application submission.');
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const runsDir = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs'), { home, label: 'runs directory' });
    fs.mkdirSync(runsDir, { recursive: true });
    refuseSymlink(runsDir, resolvedRoot, home);

    const existingCpLoaded = readValidatedSessionCheckpointFile(resolvedRoot, { home });
    const existingCp = existingCpLoaded.doc;

    const runId = input.run_id !== undefined
      ? String(input.run_id).trim()
      : (existingCp?.run_id || nowIso.slice(0, 10));
    if (!RUN_ID_RE.test(runId)) {
      throw new Error(`writeSessionCheckpoint: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
    }
    if (existingCp && existingCp.run_id === runId && (existingCp.phase === 'finished' || existingCp.phase === 'aborted')) {
      throw new Error(`cannot_checkpoint_closed_run: Run "${runId}" is already "${existingCp.phase}"; refusing checkpoint mutation.`);
    }

    const existingRunLoaded = readValidatedDailyRunFile(resolvedRoot, runId, { home });
    const existingRun = existingRunLoaded.doc;
    if (existingRun && (existingRun.status === 'completed' || existingRun.status === 'aborted')) {
      throw new Error(`cannot_checkpoint_closed_run: Daily run "${runId}" is already "${existingRun.status}"; refusing checkpoint mutation.`);
    }

    const derived = deriveRunCountsFromLedger(resolvedRoot, runId, { home, sourceRoot, nowIso });
    const baseCp = existingCp && existingCp.run_id === runId ? existingCp : null;

    let targetPhase = input.phase !== undefined ? String(input.phase).trim() : (baseCp?.phase || 'applying');
    if (!RUN_PHASE_SET.has(targetPhase)) {
      throw new Error(`writeSessionCheckpoint: invalid phase "${targetPhase}". Expected one of: ${RUN_PHASES.join(', ')}.`);
    }

    // Fail closed if attempting to advance past applying into logging/reporting/finished while an uncertain reservation exists
    if (
      (targetPhase === 'logging' || targetPhase === 'reporting' || targetPhase === 'finished') &&
      derived.uncertain_job_keys.size > 0
    ) {
      throw new Error(
        `unresolved_submission_uncertain: Cannot advance checkpoint to "${targetPhase}" while ${derived.uncertain_job_keys.size} application(s) have unresolved submission_uncertain=true reservations.`,
      );
    }

    const consecutiveErrors = input.consecutive_errors !== undefined
      ? input.consecutive_errors
      : (baseCp?.consecutive_errors ?? 0);
    if (!Number.isInteger(consecutiveErrors) || consecutiveErrors < 0) {
      throw new Error('writeSessionCheckpoint: consecutive_errors must be an integer >= 0.');
    }

    const autoAborted = consecutiveErrors >= 3;
    if (autoAborted) {
      targetPhase = 'aborted';
    }

    const workflowMode = input.workflow_mode !== undefined
      ? String(input.workflow_mode).trim()
      : (baseCp?.workflow_mode || 'batch_review_first');
    if (!WORKFLOW_MODE_SET.has(workflowMode)) {
      throw new Error(`writeSessionCheckpoint: invalid workflow_mode "${workflowMode}".`);
    }

    const rawQueue = input.queue !== undefined ? input.queue : (baseCp?.queue || []);
    const rawProcessed = input.processed_job_ids !== undefined ? input.processed_job_ids : (baseCp?.processed_job_ids || []);
    const reconciled = reconcileCheckpointQueueWithLedger(rawQueue, rawProcessed, derived);
    const finalQueue = (targetPhase === 'finished' || targetPhase === 'aborted') ? [] : reconciled.queue;

    let awaitingOwner = Array.isArray(input.awaiting_owner)
      ? input.awaiting_owner.map(item => ({ job_id: String(item.job_id || '').trim(), question: String(item.question || '').trim() }))
      : [...(baseCp?.awaiting_owner || [])];

    if (isUsableJobId(input.clear_awaiting_job_id)) {
      const clearKey = normalizeJobIdKey(input.clear_awaiting_job_id);
      awaitingOwner = awaitingOwner.filter(item => normalizeJobIdKey(item.job_id) !== clearKey);
    }
    if (isUsableJobId(input.awaiting_job_id) || input.awaiting_question !== undefined) {
      if (!isUsableJobId(input.awaiting_job_id) || !isNonEmptyString(input.awaiting_question)) {
        throw new Error('writeSessionCheckpoint: both awaiting_job_id and awaiting_question are required when adding an awaiting-owner prompt.');
      }
      const qKey = normalizeJobIdKey(input.awaiting_job_id);
      const qEntry = { job_id: input.awaiting_job_id.trim(), question: input.awaiting_question.trim() };
      const existingQIdx = awaitingOwner.findIndex(item => normalizeJobIdKey(item.job_id) === qKey);
      if (existingQIdx >= 0) awaitingOwner[existingQIdx] = qEntry;
      else awaitingOwner.push(qEntry);
    }

    const nextAction = autoAborted
      ? 'Run auto-aborted after 3 consecutive errors (stop condition enforced). Inspect logs and resolve root cause before starting a new run.'
      : (input.next_action !== undefined
        ? String(input.next_action)
        : (baseCp?.next_action || (finalQueue.length > 0 ? `Process next queued job: ${finalQueue[0]}` : 'Review Mission Control or finish run.')));

    const nextCpDoc = {
      kind: 'session_checkpoint',
      version: 1,
      run_id: runId,
      updated_at: nowIso,
      phase: targetPhase,
      workflow_mode: workflowMode,
      dry_run: derived.dry_run,
      approval_mode: 'approve_before_submit',
      submission_authorized: false,
      approval_expired_on_resume: Boolean(baseCp?.approval_expired_on_resume),
      caps: derived.caps,
      processed_job_ids: reconciled.processed_job_ids,
      queue: finalQueue,
      awaiting_owner: awaitingOwner,
      batch_selection: input.batch_selection !== undefined ? input.batch_selection : (baseCp?.batch_selection ?? null),
      consecutive_errors: consecutiveErrors,
      next_action: nextAction,
      notes: input.notes !== undefined ? String(input.notes) : (baseCp?.notes ?? ''),
    };

    const cpCheck = validateSessionCheckpoint(nextCpDoc);
    if (!cpCheck.valid) {
      throw new Error(`Invalid session checkpoint before write: ${cpCheck.errors.join('; ')}`);
    }

    const runErrors = Array.isArray(existingRun?.errors) ? [...existingRun.errors] : [];
    if (autoAborted) {
      runErrors.push(`Auto-aborted at ${nowIso}: consecutive_errors=${consecutiveErrors} reached stop threshold (>=3).`);
    }
    const runStatus = autoAborted
      ? 'aborted'
      : (targetPhase === 'finished' ? 'completed' : (targetPhase === 'aborted' ? 'aborted' : 'running'));

    const nextRunDoc = {
      run_id: runId,
      started_at: existingRun?.started_at ?? nowIso,
      finished_at: (runStatus === 'completed' || runStatus === 'aborted') ? nowIso : null,
      dry_run: derived.dry_run,
      status: runStatus,
      counts: derived.counts,
      platforms: [...new Set([...(existingRun?.platforms || []), ...derived.platforms_seen])],
      errors: runErrors,
      steps: [
        ...(existingRun?.steps || []),
        {
          at: nowIso,
          step: autoAborted ? 'run_auto_aborted_consecutive_errors' : `checkpoint_${targetPhase}`,
          detail: nextAction.slice(0, 200),
        },
      ],
      notes: input.notes !== undefined ? String(input.notes) : (existingRun?.notes ?? ''),
    };

    const runCheck = validateDailyRun(nextRunDoc);
    if (!runCheck.valid) {
      throw new Error(`Invalid daily run document before write: ${runCheck.errors.join('; ')}`);
    }

    commitTwoFileLedgerTransaction(resolvedRoot, {
      operation: 'run_checkpoint',
      nowIso,
      home,
      file1Rel: existingCpLoaded.rel_path,
      file1Path: existingCpLoaded.path,
      file1Exists: existingCpLoaded.exists,
      file1OldRaw: existingCpLoaded.raw,
      file1NewContent: JSON.stringify(nextCpDoc, null, 2) + '\n',
      file2Rel: existingRunLoaded.rel_path,
      file2Path: existingRunLoaded.path,
      file2Exists: existingRunLoaded.exists,
      file2OldRaw: existingRunLoaded.raw,
      file2NewContent: JSON.stringify(nextRunDoc, null, 2) + '\n',
      _testHooks,
    });

    return {
      checkpointed: true,
      auto_aborted: autoAborted,
      run_id: runId,
      phase: nextCpDoc.phase,
      run_status: nextRunDoc.status,
      reconciled_from_queue: reconciled.moved_to_processed,
      checkpoint_path: existingCpLoaded.path,
      run_path: existingRunLoaded.path,
      checkpoint: nextCpDoc,
      run: nextRunDoc,
    };
  });
}

export function resumeSessionCheckpoint(root, input = {}, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('resumeSessionCheckpoint requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`resumeSessionCheckpoint: invalid nowIso "${nowIso}".`);

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const existingCpLoaded = readValidatedSessionCheckpointFile(resolvedRoot, { home });
    if (!existingCpLoaded.exists || !existingCpLoaded.doc) {
      throw new Error('checkpoint_not_found: No session checkpoint found at logs/runs/current-session-checkpoint.json.');
    }
    const existingCp = existingCpLoaded.doc;
    if (isNonEmptyString(input.run_id) && input.run_id.trim() !== existingCp.run_id) {
      throw new Error(`run_id_mismatch: Checkpoint run_id is "${existingCp.run_id}", but requested "${input.run_id}".`);
    }
    if (existingCp.phase === 'finished' || existingCp.phase === 'aborted') {
      throw new Error(`cannot_resume_closed_run: Checkpoint for run "${existingCp.run_id}" has terminal phase "${existingCp.phase}". Start a new run instead.`);
    }

    const runId = existingCp.run_id;
    const existingRunLoaded = readValidatedDailyRunFile(resolvedRoot, runId, { home });
    const existingRun = existingRunLoaded.doc;
    if (existingRun && (existingRun.status === 'completed' || existingRun.status === 'aborted')) {
      throw new Error(`cannot_resume_closed_run: Daily run "${runId}" is already "${existingRun.status}". Start a new run instead.`);
    }

    const derived = deriveRunCountsFromLedger(resolvedRoot, runId, { home, sourceRoot, nowIso });
    const reconciled = reconcileCheckpointQueueWithLedger(
      existingCp.queue,
      existingCp.processed_job_ids,
      derived,
      { requireTrackedInLedger: true },
    );

    // Filter awaiting_owner to remove any jobs already handled in the ledger
    const awaitingOwner = (existingCp.awaiting_owner || []).filter(
      item => !derived.handled_job_keys.has(normalizeJobIdKey(item.job_id)),
    );

    const capsChanged = JSON.stringify(existingCp.caps) !== JSON.stringify(derived.caps);
    const queueChanged =
      reconciled.moved_to_processed.length > 0 ||
      reconciled.untracked_removed.length > 0 ||
      JSON.stringify(existingCp.queue) !== JSON.stringify(reconciled.queue);
    const discrepanciesReconciled = capsChanged || queueChanged;

    const nextAction = derived.uncertain_job_keys.size > 0
      ? `Resolve ${derived.uncertain_job_keys.size} uncertain submission reservation(s) before continuing queue.`
      : (reconciled.queue.length > 0
        ? `Re-verify browser auth, then resume next queued job: ${reconciled.queue[0]} (prior submit approvals expired).`
        : 'Queue empty after ledger reconciliation; proceed to logging/reporting or finish run.');

    const nextCpDoc = {
      ...existingCp,
      updated_at: nowIso,
      dry_run: derived.dry_run,
      approval_mode: 'approve_before_submit',
      submission_authorized: false,
      approval_expired_on_resume: true,
      caps: derived.caps,
      processed_job_ids: reconciled.processed_job_ids,
      queue: reconciled.queue,
      awaiting_owner: awaitingOwner,
      next_action: nextAction,
    };

    const cpCheck = validateSessionCheckpoint(nextCpDoc);
    if (!cpCheck.valid) {
      throw new Error(`Invalid session checkpoint on resume: ${cpCheck.errors.join('; ')}`);
    }

    const nextRunDoc = {
      run_id: runId,
      started_at: existingRun?.started_at ?? existingCp.updated_at,
      finished_at: null,
      dry_run: derived.dry_run,
      status: 'running',
      counts: derived.counts,
      platforms: [...new Set([...(existingRun?.platforms || []), ...derived.platforms_seen])],
      errors: Array.isArray(existingRun?.errors) ? [...existingRun.errors] : [],
      steps: [
        ...(existingRun?.steps || []),
        {
          at: nowIso,
          step: 'run_resumed_reconciled',
          detail: `reconciled=${discrepanciesReconciled}, moved_to_processed=${reconciled.moved_to_processed.length}, queue_remaining=${reconciled.queue.length}, approval_expired=true`,
        },
      ],
      notes: existingRun?.notes ?? existingCp.notes ?? '',
    };

    const runCheck = validateDailyRun(nextRunDoc);
    if (!runCheck.valid) {
      throw new Error(`Invalid daily run document on resume: ${runCheck.errors.join('; ')}`);
    }

    commitTwoFileLedgerTransaction(resolvedRoot, {
      operation: 'run_resume',
      nowIso,
      home,
      file1Rel: existingCpLoaded.rel_path,
      file1Path: existingCpLoaded.path,
      file1Exists: existingCpLoaded.exists,
      file1OldRaw: existingCpLoaded.raw,
      file1NewContent: JSON.stringify(nextCpDoc, null, 2) + '\n',
      file2Rel: existingRunLoaded.rel_path,
      file2Path: existingRunLoaded.path,
      file2Exists: existingRunLoaded.exists,
      file2OldRaw: existingRunLoaded.raw,
      file2NewContent: JSON.stringify(nextRunDoc, null, 2) + '\n',
      _testHooks,
    });

    return {
      resumed: true,
      run_id: runId,
      phase: nextCpDoc.phase,
      approval_expired_on_resume: true,
      submission_authorized: false,
      discrepancies_reconciled: discrepanciesReconciled,
      moved_to_processed: reconciled.moved_to_processed,
      untracked_removed: reconciled.untracked_removed,
      unresolved_uncertain_count: derived.uncertain_job_keys.size,
      checkpoint_path: existingCpLoaded.path,
      run_path: existingRunLoaded.path,
      checkpoint: nextCpDoc,
      run: nextRunDoc,
    };
  });
}

export function finishDailyRun(root, input = {}, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('finishDailyRun requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`finishDailyRun: invalid nowIso "${nowIso}".`);

  const targetStatus = input.status !== undefined ? String(input.status).trim().toLowerCase() : 'completed';
  if (targetStatus !== 'completed' && targetStatus !== 'aborted') {
    throw new Error(`finishDailyRun: status must be "completed" or "aborted"; received "${input.status}".`);
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const runsDir = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs'), { home, label: 'runs directory' });
    fs.mkdirSync(runsDir, { recursive: true });
    refuseSymlink(runsDir, resolvedRoot, home);

    const existingCpLoaded = readValidatedSessionCheckpointFile(resolvedRoot, { home });
    const existingCp = existingCpLoaded.doc;
    const runId = input.run_id !== undefined
      ? String(input.run_id).trim()
      : (existingCp?.run_id || nowIso.slice(0, 10));
    if (!RUN_ID_RE.test(runId)) {
      throw new Error(`finishDailyRun: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
    }

    const existingRunLoaded = readValidatedDailyRunFile(resolvedRoot, runId, { home });
    const existingRun = existingRunLoaded.doc;
    const derived = deriveRunCountsFromLedger(resolvedRoot, runId, { home, sourceRoot, nowIso });

    if (targetStatus === 'completed' && derived.uncertain_job_keys.size > 0) {
      throw new Error(
        `unresolved_submission_uncertain: Cannot complete run "${runId}" while ${derived.uncertain_job_keys.size} application(s) have unresolved submission_uncertain=true reservations. Confirm receipt or abort run.`,
      );
    }

    const baseCp = existingCp && existingCp.run_id === runId ? existingCp : null;
    const allProcessed = reconcileCheckpointQueueWithLedger(
      [],
      [...(baseCp?.processed_job_ids || []), ...(baseCp?.queue || []).filter(id => derived.handled_job_keys.has(normalizeJobIdKey(id)))],
      derived,
    ).processed_job_ids;

    const terminalPhase = targetStatus === 'aborted' ? 'aborted' : 'finished';
    const errors = Array.isArray(existingRun?.errors) ? [...existingRun.errors] : [];
    if (isNonEmptyString(input.error)) {
      errors.push(input.error.trim());
    }

    const nextRunDoc = {
      run_id: runId,
      started_at: existingRun?.started_at ?? baseCp?.updated_at ?? nowIso,
      finished_at: nowIso,
      dry_run: derived.dry_run,
      status: targetStatus,
      counts: derived.counts,
      platforms: [...new Set([...(existingRun?.platforms || []), ...derived.platforms_seen])],
      errors,
      steps: [
        ...(existingRun?.steps || []),
        {
          at: nowIso,
          step: targetStatus === 'aborted' ? 'run_aborted' : 'run_completed',
          detail: isNonEmptyString(input.error)
            ? input.error.trim()
            : (isNonEmptyString(input.notes) ? input.notes.trim() : `counts=${JSON.stringify(derived.counts)}`),
        },
      ],
      notes: input.notes !== undefined ? String(input.notes) : (existingRun?.notes ?? baseCp?.notes ?? ''),
    };

    const runCheck = validateDailyRun(nextRunDoc);
    if (!runCheck.valid) {
      throw new Error(`Invalid daily run document on finish: ${runCheck.errors.join('; ')}`);
    }

    const nextCpDoc = {
      kind: 'session_checkpoint',
      version: 1,
      run_id: runId,
      updated_at: nowIso,
      phase: terminalPhase,
      workflow_mode: baseCp?.workflow_mode || 'batch_review_first',
      dry_run: derived.dry_run,
      approval_mode: 'approve_before_submit',
      submission_authorized: false,
      approval_expired_on_resume: Boolean(baseCp?.approval_expired_on_resume),
      caps: derived.caps,
      processed_job_ids: allProcessed,
      queue: [],
      awaiting_owner: baseCp?.awaiting_owner || [],
      batch_selection: baseCp?.batch_selection ?? null,
      consecutive_errors: baseCp?.consecutive_errors ?? 0,
      next_action: targetStatus === 'aborted' ? 'Run aborted.' : 'Run completed.',
      notes: input.notes !== undefined ? String(input.notes) : (baseCp?.notes ?? ''),
    };

    const cpCheck = validateSessionCheckpoint(nextCpDoc);
    if (!cpCheck.valid) {
      throw new Error(`Invalid session checkpoint on finish: ${cpCheck.errors.join('; ')}`);
    }

    commitTwoFileLedgerTransaction(resolvedRoot, {
      operation: 'run_finish',
      nowIso,
      home,
      file1Rel: existingRunLoaded.rel_path,
      file1Path: existingRunLoaded.path,
      file1Exists: existingRunLoaded.exists,
      file1OldRaw: existingRunLoaded.raw,
      file1NewContent: JSON.stringify(nextRunDoc, null, 2) + '\n',
      file2Rel: existingCpLoaded.rel_path,
      file2Path: existingCpLoaded.path,
      file2Exists: existingCpLoaded.exists,
      file2OldRaw: existingCpLoaded.raw,
      file2NewContent: JSON.stringify(nextCpDoc, null, 2) + '\n',
      _testHooks,
    });

    return {
      finished: true,
      run_id: runId,
      status: nextRunDoc.status,
      phase: nextCpDoc.phase,
      counts: nextRunDoc.counts,
      run_path: existingRunLoaded.path,
      checkpoint_path: existingCpLoaded.path,
      run: nextRunDoc,
      checkpoint: nextCpDoc,
    };
  });
}

// ---------------- Stage 6 (T12.2): Deterministic Job Triage & Mission Control Queue ----------------

export function readWorkspaceTargetingPreferences(root, { home = os.homedir() } = {}) {
  const resolvedRoot = path.resolve(root);
  const prefPath = path.join(resolvedRoot, 'context', 'preferences.yaml');
  const defaults = {
    source_path: null,
    min_match_score: 7,
    active_persona: null,
    exclude_keywords: [],
    blacklisted_companies: [],
    blacklisted_domains: [],
  };
  if (!fs.existsSync(prefPath)) return defaults;
  refuseSymlink(prefPath, resolvedRoot, home);
  const text = fs.readFileSync(prefPath, 'utf8');

  let minMatchScore = 7;
  const mMin = text.match(/^[ \t]*min_match_score:[ \t]*([0-9]+(?:\.[0-9]+)?)\b/m);
  if (mMin) {
    const parsed = Number(mMin[1]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) {
      minMatchScore = parsed;
    }
  }

  let activePersona = null;
  const mPersona = text.match(/^[ \t]*active_persona:[ \t]*["']?([A-Za-z0-9_-]+)["']?/m);
  if (mPersona && mPersona[1] && mPersona[1].toLowerCase() !== 'null' && mPersona[1].toLowerCase() !== 'none') {
    activePersona = mPersona[1].trim();
  }

  const excludeKeywords = parseYamlStringArray(text, 'exclude_keywords').map(s => s.toLowerCase());
  const blacklists = readPreferencesBlacklists(resolvedRoot, { home });

  return {
    source_path: prefPath,
    min_match_score: minMatchScore,
    active_persona: activePersona,
    exclude_keywords: [...new Set(excludeKeywords)],
    blacklisted_companies: blacklists.companies,
    blacklisted_domains: blacklists.domains,
  };
}

export function triageJobForWorkflow(root, input, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('triageJobForWorkflow requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('triageJobForWorkflow requires a non-empty job_id.');
  if (!isNonEmptyString(input.company)) throw new Error('triageJobForWorkflow requires a non-empty company.');
  if (!isNonEmptyString(input.title)) throw new Error('triageJobForWorkflow requires a non-empty title.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`triageJobForWorkflow: invalid nowIso "${nowIso}".`);
  if (input.third_party_subject === true) {
    throw new Error('third_party_blocked: Refusing workflow job triage for third-party subject.');
  }
  if (typeof input.match_score !== 'number' || !Number.isFinite(input.match_score) || input.match_score < 0 || input.match_score > 10) {
    throw new Error('triageJobForWorkflow requires a numeric match_score in 0..10.');
  }
  if (input.apply_type !== undefined && input.apply_type !== null && !APPLY_TYPES.has(input.apply_type)) {
    throw new Error(`triageJobForWorkflow: invalid apply_type "${input.apply_type}".`);
  }
  if (input.source_channel !== undefined && input.source_channel !== null && !SOURCE_CHANNELS.has(input.source_channel)) {
    throw new Error(`triageJobForWorkflow: invalid source_channel "${input.source_channel}".`);
  }
  if (input.work_mode !== undefined && input.work_mode !== null && !WORK_MODES.has(input.work_mode)) {
    throw new Error(`triageJobForWorkflow: invalid work_mode "${input.work_mode}".`);
  }
  if (input.employment_type !== undefined && input.employment_type !== null && !EMPLOYMENT_TYPES.has(input.employment_type)) {
    throw new Error(`triageJobForWorkflow: invalid employment_type "${input.employment_type}".`);
  }

  const validatedUrl = input.url !== undefined ? assertValidOptionalHttpUrl(input.url, 'url') : null;
  const runId = input.run_id !== undefined ? String(input.run_id).trim() : nowIso.slice(0, 10);
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`triageJobForWorkflow: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const appLoaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const skipLoaded = readValidatedSkippedJobs(resolvedRoot, { home });
    const prefs = readWorkspaceTargetingPreferences(resolvedRoot, { home });

    const appRecords = [...appLoaded.records];
    const skipRecords = [...skipLoaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const existingIdx = appRecords.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    const existing = existingIdx >= 0 ? normalizeApplicationRecord(appRecords[existingIdx]) : null;

    const cvLoadedForTriage = readValidatedCvRegistry(resolvedRoot, { home });
    const cvRegForTriage = cvLoadedForTriage.exists ? cvLoadedForTriage.registry : null;
    if (existing) {
      const ownCheck = classifyApplicationOwnership(existing, cvRegForTriage);
      if (!ownCheck.isOwner) {
        throw new Error(`third_party_blocked: Application "${existing.job_id}" belongs to an isolated third-party or unverified subject (${ownCheck.reason}).`);
      }
      if (SUBMITTED_STATUS_SET.has(existing.status)) {
        throw new Error(`cannot_downgrade_submitted: Application "${existing.job_id}" is already "${existing.status}"; refusing to re-triage.`);
      }
      if (existing.submission_uncertain === true) {
        throw new Error(`reservation_active: Application "${existing.job_id}" has an unresolved submission_uncertain reservation; refusing to re-triage.`);
      }
    }

    const company = input.company.trim();
    const title = input.title.trim();
    const platform = isNonEmptyString(input.platform) ? input.platform.trim().toLowerCase() : (existing?.platform ?? null);
    const url = validatedUrl !== null ? validatedUrl : (existing?.url ?? null);
    const score = input.match_score;

    const gate = evaluatePreSubmitGate(resolvedRoot, {
      job_id: input.job_id,
      company,
      title,
      platform,
      url,
    }, { home, nowIso, sourceRoot, recordsOverride: appRecords });

    const blViolation = gate.violations.find(v => v.code === 'blacklisted_employer' || v.code === 'blacklisted_domain') || null;
    const dupViolation = gate.violations.find(v => v.code.startsWith('duplicate_')) || null;
    const matchedExcludeKw = prefs.exclude_keywords.find(kw => kw && title.toLowerCase().includes(kw)) || null;

    let skipCode = null;
    let skipReason = null;
    let matchedJobId = null;

    if (input.ghost_or_expired === true) {
      skipCode = 'ghost_or_expired';
      skipReason = isNonEmptyString(input.notes)
        ? input.notes.trim().slice(0, MAX_SKIP_REASON_LEN)
        : 'Listing closed, expired, or >30-day ghost job.';
    } else if (blViolation) {
      skipCode = 'blacklisted_employer';
      skipReason = blViolation.message.slice(0, MAX_SKIP_REASON_LEN);
    } else if (dupViolation) {
      skipCode = 'duplicate_cross_channel';
      skipReason = dupViolation.message.slice(0, MAX_SKIP_REASON_LEN);
      matchedJobId = gate.checks.deduplication?.matches?.[0]?.matched_job_id || null;
    } else if (isNonEmptyString(input.dealbreaker)) {
      skipCode = 'dealbreaker';
      skipReason = `Dealbreaker: ${input.dealbreaker.trim()}`.slice(0, MAX_SKIP_REASON_LEN);
    } else if (matchedExcludeKw) {
      skipCode = 'dealbreaker';
      skipReason = `Role title matches excluded keyword "${matchedExcludeKw}".`.slice(0, MAX_SKIP_REASON_LEN);
    } else if (score < 5) {
      skipCode = 'mismatch';
      skipReason = `Match score ${score}/10 is below Tier B threshold (5.0).`;
    }

    const fingerprint = computeCanonicalFingerprint(company, title) ?? existing?.canonical_fingerprint ?? null;
    const matchedSkills = Array.isArray(input.matched_skills) ? [...new Set(input.matched_skills)] : (existing?.matched_skills ?? []);
    const missingSkills = Array.isArray(input.missing_skills) ? [...new Set(input.missing_skills)] : (existing?.missing_skills ?? []);

    // Tier C: record consistently in both logs/skipped-jobs.json and logs/applications-log.json under one lock + tx journal
    if (skipCode !== null) {
      const stageHistory = existing ? [...existing.stage_history] : [];
      if (!existing || existing.status !== 'skipped') {
        if (existing) assertChronologicalTimestamp(existing, nowIso, 'triage skip timestamp');
        stageHistory.push({
          event_id: makeStageEventId('trg', 'skipped', nowIso, stageHistory.length),
          from_status: existing ? existing.status : null,
          to_status: 'skipped',
          at: nowIso,
          source: 'discovery',
          verified: false,
          notes: `${skipCode}: ${skipReason}`.slice(0, 200),
        });
      }

      const nextApp = normalizeApplicationRecord({
        ...(existing || {}),
        job_id: existing ? existing.job_id : input.job_id.trim(),
        title,
        company,
        platform,
        source_channel: input.source_channel !== undefined ? input.source_channel : (existing?.source_channel ?? null),
        url,
        location: input.location !== undefined ? input.location : (existing?.location ?? null),
        work_mode: input.work_mode !== undefined ? input.work_mode : (existing?.work_mode ?? null),
        employment_type: input.employment_type !== undefined ? input.employment_type : (existing?.employment_type ?? null),
        apply_type: input.apply_type !== undefined ? input.apply_type : (existing?.apply_type ?? null),
        discovered_at: existing?.discovered_at ?? nowIso,
        applied_at: null,
        updated_at: nowIso,
        run_id: runId,
        status: 'skipped',
        match_score: score,
        matched_skills: matchedSkills,
        missing_skills: missingSkills,
        persona_id: input.persona_id !== undefined ? input.persona_id : (existing?.persona_id ?? prefs.active_persona),
        notes: appendNotesPart(existing?.notes, `${skipCode}: ${skipReason}`),
        submission_uncertain: false,
        canonical_fingerprint: fingerprint,
        stage_history: stageHistory,
        provenance: {
          created_by: existing?.provenance?.created_by ?? 'cli_triage',
          created_at: existing?.provenance?.created_at ?? nowIso,
          last_updated_by: 'cli_triage',
          receipt_verified: false,
          third_party_subject: false,
        },
        notion_sync: {
          state: 'ineligible_not_submitted',
          page_id: null,
          last_synced_at: null,
          last_synced_hash: null,
          retry_count: 0,
          last_error: null,
        },
      });

      if (existingIdx >= 0) appRecords[existingIdx] = nextApp;
      else appRecords.push(nextApp);

      const ledgerCheck = validateApplicationLedger(appRecords);
      if (!ledgerCheck.valid) {
        throw new Error(`Invalid applications ledger during Tier C triage: ${ledgerCheck.errors.join('; ')}`);
      }

      const skipExistingIdx = skipRecords.findIndex(s => isUsableJobId(s.job_id) && normalizeJobIdKey(s.job_id) === jobKey);
      const skipExisting = skipExistingIdx >= 0 ? skipRecords[skipExistingIdx] : null;
      const nextSkip = {
        job_id: skipExisting ? skipExisting.job_id : nextApp.job_id,
        platform,
        company,
        title,
        url,
        match_score: score,
        tier: 'C',
        reason: skipCode,
        skip_reason: skipReason,
        ...(matchedJobId ? { matched_job_id: matchedJobId } : {}),
        skipped_at: skipExisting?.skipped_at ?? nowIso,
        run_id: runId,
      };
      if (skipExistingIdx >= 0) skipRecords[skipExistingIdx] = nextSkip;
      else skipRecords.push(nextSkip);

      commitTwoFileLedgerTransaction(resolvedRoot, {
        operation: 'triage_tier_c_skip',
        nowIso,
        home,
        file1Rel: 'logs/skipped-jobs.json',
        file1Path: skipLoaded.path,
        file1Exists: skipLoaded.exists,
        file1OldRaw: skipLoaded.raw,
        file1NewContent: JSON.stringify(skipRecords, null, 2) + '\n',
        file2Rel: 'logs/applications-log.json',
        file2Path: appLoaded.path,
        file2Exists: appLoaded.exists,
        file2OldRaw: appLoaded.raw,
        file2NewContent: JSON.stringify(appRecords, null, 2) + '\n',
        _testHooks,
      });

      return {
        job_id: nextApp.job_id,
        application_id: nextApp.application_id,
        tier: 'C',
        disposition: 'skipped',
        status: 'skipped',
        match_score: score,
        min_match_score: prefs.min_match_score,
        eligible_for_queue: false,
        tailoring_needed: false,
        skip_reason_code: skipCode,
        skip_reason: skipReason,
        reasons: [skipReason],
        record: nextApp,
        skipped_record: nextSkip,
      };
    }

    // Tier A (>= 8 and >= min_match_score) vs Tier B (5 to < 8 or below min_match_score)
    const isTierA = score >= 8 && score >= prefs.min_match_score;
    const tier = isTierA ? 'A' : 'B';
    const belowMinScore = score < prefs.min_match_score;
    const targetStatus = existing?.status === 'prepared'
      ? 'prepared'
      : (belowMinScore ? 'needs_review' : 'discovered');
    const disposition = isTierA
      ? 'ready_for_prep'
      : (belowMinScore ? 'stretch_needs_review' : 'eligible_stretch');
    const tailoringNeeded = Boolean(missingSkills.length > 0 || isTierA || targetStatus !== 'prepared');

    const stageHistory = existing ? [...existing.stage_history] : [];
    if (!existing || existing.status !== targetStatus) {
      if (existing) assertChronologicalTimestamp(existing, nowIso, 'triage timestamp');
      stageHistory.push({
        event_id: makeStageEventId('trg', targetStatus, nowIso, stageHistory.length),
        from_status: existing ? existing.status : null,
        to_status: targetStatus,
        at: nowIso,
        source: targetStatus === 'prepared' ? 'preparation' : 'discovery',
        verified: false,
        notes: `Tier ${tier} (${score}/10, min=${prefs.min_match_score})`.slice(0, 200),
      });
    }

    const nextApp = normalizeApplicationRecord({
      ...(existing || {}),
      job_id: existing ? existing.job_id : input.job_id.trim(),
      title,
      company,
      platform,
      source_channel: input.source_channel !== undefined ? input.source_channel : (existing?.source_channel ?? null),
      url,
      location: input.location !== undefined ? input.location : (existing?.location ?? null),
      work_mode: input.work_mode !== undefined ? input.work_mode : (existing?.work_mode ?? null),
      employment_type: input.employment_type !== undefined ? input.employment_type : (existing?.employment_type ?? null),
      apply_type: input.apply_type !== undefined ? input.apply_type : (existing?.apply_type ?? null),
      discovered_at: existing?.discovered_at ?? nowIso,
      applied_at: null,
      updated_at: nowIso,
      run_id: runId,
      status: targetStatus,
      match_score: score,
      matched_skills: matchedSkills,
      missing_skills: missingSkills,
      persona_id: input.persona_id !== undefined ? input.persona_id : (existing?.persona_id ?? prefs.active_persona),
      notes: isNonEmptyString(input.notes) ? appendNotesPart(existing?.notes, input.notes.trim()) : (existing?.notes ?? ''),
      submission_uncertain: false,
      canonical_fingerprint: fingerprint,
      stage_history: stageHistory,
      provenance: {
        created_by: existing?.provenance?.created_by ?? 'cli_triage',
        created_at: existing?.provenance?.created_at ?? nowIso,
        last_updated_by: 'cli_triage',
        receipt_verified: false,
        third_party_subject: false,
      },
      notion_sync: {
        state: 'ineligible_not_submitted',
        page_id: null,
        last_synced_at: null,
        last_synced_hash: null,
        retry_count: 0,
        last_error: null,
      },
    });

    if (existingIdx >= 0) appRecords[existingIdx] = nextApp;
    else appRecords.push(nextApp);

    persistValidatedLedger(resolvedRoot, appRecords, { home, ledgerPath: appLoaded.path });

    const reasons = [
      `Tier ${tier} match (${score}/10 vs min_match_score=${prefs.min_match_score}).`,
      ...(missingSkills.length > 0 ? [`Missing/gap skills to note honestly: ${missingSkills.join(', ')}.`] : []),
    ];

    return {
      job_id: nextApp.job_id,
      application_id: nextApp.application_id,
      tier,
      disposition,
      status: nextApp.status,
      match_score: score,
      min_match_score: prefs.min_match_score,
      eligible_for_queue: true,
      tailoring_needed: tailoringNeeded,
      skip_reason_code: null,
      skip_reason: null,
      reasons,
      record: nextApp,
      skipped_record: null,
    };
  });
}

export function enqueueSelectedRunJobs(root, input, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('enqueueSelectedRunJobs requires an input object.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`enqueueSelectedRunJobs: invalid nowIso "${nowIso}".`);
  if (!Array.isArray(input.job_ids) || input.job_ids.length === 0 || input.job_ids.some(id => !isUsableJobId(id))) {
    throw new Error('enqueueSelectedRunJobs requires a non-empty array of usable job_ids.');
  }
  if (input.submission_authorized === true) {
    throw new Error('selection_never_authorizes_submit: Batch job selection only authorizes preparation and form-filling, never final submission.');
  }

  const resolvedRoot = path.resolve(root);
  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const runsDir = assertWorkspacePathSafe(resolvedRoot, path.join('logs', 'runs'), { home, label: 'runs directory' });
    fs.mkdirSync(runsDir, { recursive: true });
    refuseSymlink(runsDir, resolvedRoot, home);

    const appLoaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const skipLoaded = readValidatedSkippedJobs(resolvedRoot, { home });
    const existingCpLoaded = readValidatedSessionCheckpointFile(resolvedRoot, { home });
    const existingCp = existingCpLoaded.doc;

    const runId = input.run_id !== undefined
      ? String(input.run_id).trim()
      : (existingCp?.run_id || nowIso.slice(0, 10));
    if (!RUN_ID_RE.test(runId)) {
      throw new Error(`enqueueSelectedRunJobs: invalid run_id "${runId}"; expected YYYY-MM-DD.`);
    }
    if (existingCp && existingCp.run_id === runId && (existingCp.phase === 'finished' || existingCp.phase === 'aborted')) {
      throw new Error(`cannot_enqueue_closed_run: Run "${runId}" is already "${existingCp.phase}".`);
    }

    const existingRunLoaded = readValidatedDailyRunFile(resolvedRoot, runId, { home });
    const existingRun = existingRunLoaded.doc;
    if (existingRun && (existingRun.status === 'completed' || existingRun.status === 'aborted')) {
      throw new Error(`cannot_enqueue_closed_run: Daily run "${runId}" is already "${existingRun.status}".`);
    }

    const ledgerMap = new Map();
    for (const raw of appLoaded.records) {
      if (isObj(raw) && isUsableJobId(raw.job_id)) {
        ledgerMap.set(normalizeJobIdKey(raw.job_id), normalizeApplicationRecord(raw));
      }
    }
    const skippedKeys = new Set(
      skipLoaded.records
        .filter(s => isObj(s) && isUsableJobId(s.job_id))
        .map(s => normalizeJobIdKey(s.job_id)),
    );

    const cvLoadedForEnqueue = readValidatedCvRegistry(resolvedRoot, { home });
    const cvRegForEnqueue = cvLoadedForEnqueue.exists ? cvLoadedForEnqueue.registry : null;
    const requestedCanonicalIds = [];
    const seenRequestedKeys = new Set();
    for (const rawId of input.job_ids) {
      const key = normalizeJobIdKey(rawId);
      if (seenRequestedKeys.has(key)) continue;
      seenRequestedKeys.add(key);

      const rec = ledgerMap.get(key);
      if (!rec) {
        throw new Error(`job_not_found_in_ledger: Job "${rawId}" does not exist in logs/applications-log.json. Triage or record it before enqueueing.`);
      }
      const recOwn = classifyApplicationOwnership(rec, cvRegForEnqueue);
      if (!recOwn.isOwner) {
        throw new Error(`third_party_blocked: Refusing to enqueue third-party or unverified record "${rec.job_id}" (${recOwn.reason}).`);
      }
      if (SUBMITTED_STATUS_SET.has(rec.status)) {
        throw new Error(`already_submitted: Job "${rec.job_id}" already has submitted status "${rec.status}".`);
      }
      if (rec.submission_uncertain === true) {
        throw new Error(`reservation_active: Job "${rec.job_id}" has an unresolved submission_uncertain reservation and cannot be re-enqueued.`);
      }
      if (skippedKeys.has(key) || rec.status === 'skipped' || rec.status === 'dry_run' || rec.status === 'failed' || rec.status === 'aborted') {
        throw new Error(`ineligible_job_status: Job "${rec.job_id}" has status "${rec.status}" (or is in logs/skipped-jobs.json) and cannot be enqueued.`);
      }
      if (typeof rec.match_score === 'number' && rec.match_score < 5) {
        throw new Error(`tier_c_rejected: Job "${rec.job_id}" is Tier C (match_score=${rec.match_score} < 5.0) and cannot be enqueued.`);
      }

      const gate = evaluatePreSubmitGate(resolvedRoot, {
        job_id: rec.job_id,
        company: rec.company,
        title: rec.title,
        platform: rec.platform,
        url: rec.url,
      }, { home, nowIso, sourceRoot, recordsOverride: appLoaded.records });

      const candViolation = gate.violations.find(v =>
        v.code === 'blacklisted_employer' ||
        v.code === 'blacklisted_domain' ||
        v.code === 'platform_disabled' ||
        v.code.startsWith('duplicate_'),
      );
      if (candViolation) {
        throw new Error(`pre_submit_ineligible: Job "${rec.job_id}" blocked by ${candViolation.code}: ${candViolation.message}`);
      }

      requestedCanonicalIds.push(rec.job_id);
    }

    const derived = deriveRunCountsFromLedger(resolvedRoot, runId, {
      home,
      sourceRoot,
      nowIso,
      recordsOverride: appLoaded.records,
      skippedOverride: skipLoaded.records,
    });
    const baseCp = existingCp && existingCp.run_id === runId ? existingCp : null;
    const mergedQueueInput = [...(baseCp?.queue || []), ...requestedCanonicalIds];
    const reconciled = reconcileCheckpointQueueWithLedger(
      mergedQueueInput,
      baseCp?.processed_job_ids || [],
      derived,
    );

    const batchSelection = isNonEmptyString(input.batch_selection)
      ? input.batch_selection.trim()
      : (baseCp?.batch_selection || `APPLY ${requestedCanonicalIds.join(',')}`);

    const nextAction = reconciled.queue.length > 0
      ? `Prepare and fill queued job: ${reconciled.queue[0]} (selection authorizes prep/fill only; stop before Submit for Live DOM Read-Back and explicit per-job APPROVE).`
      : 'No eligible jobs remaining in queue.';

    const nextCpDoc = {
      kind: 'session_checkpoint',
      version: 1,
      run_id: runId,
      updated_at: nowIso,
      phase: 'applying',
      workflow_mode: baseCp?.workflow_mode || 'batch_review_first',
      dry_run: derived.dry_run,
      approval_mode: 'approve_before_submit',
      submission_authorized: false,
      approval_expired_on_resume: Boolean(baseCp?.approval_expired_on_resume),
      caps: derived.caps,
      processed_job_ids: reconciled.processed_job_ids,
      queue: reconciled.queue,
      awaiting_owner: baseCp?.awaiting_owner || [],
      batch_selection: batchSelection,
      consecutive_errors: baseCp?.consecutive_errors ?? 0,
      next_action: nextAction,
      notes: input.notes !== undefined ? String(input.notes) : (baseCp?.notes ?? ''),
    };

    const cpCheck = validateSessionCheckpoint(nextCpDoc);
    if (!cpCheck.valid) {
      throw new Error(`Invalid session checkpoint on enqueue: ${cpCheck.errors.join('; ')}`);
    }

    const nextRunDoc = {
      run_id: runId,
      started_at: existingRun?.started_at ?? baseCp?.updated_at ?? nowIso,
      finished_at: null,
      dry_run: derived.dry_run,
      status: 'running',
      counts: derived.counts,
      platforms: [...new Set([...(existingRun?.platforms || []), ...derived.platforms_seen])],
      errors: Array.isArray(existingRun?.errors) ? [...existingRun.errors] : [],
      steps: [
        ...(existingRun?.steps || []),
        {
          at: nowIso,
          step: 'mission_control_queue_selected',
          detail: `${batchSelection} -> enqueued=[${requestedCanonicalIds.join(', ')}] (submission_authorized=false)`,
        },
      ],
      notes: existingRun?.notes ?? '',
    };

    const runCheck = validateDailyRun(nextRunDoc);
    if (!runCheck.valid) {
      throw new Error(`Invalid daily run document on enqueue: ${runCheck.errors.join('; ')}`);
    }

    commitTwoFileLedgerTransaction(resolvedRoot, {
      operation: 'run_enqueue',
      nowIso,
      home,
      file1Rel: existingCpLoaded.rel_path,
      file1Path: existingCpLoaded.path,
      file1Exists: existingCpLoaded.exists,
      file1OldRaw: existingCpLoaded.raw,
      file1NewContent: JSON.stringify(nextCpDoc, null, 2) + '\n',
      file2Rel: existingRunLoaded.rel_path,
      file2Path: existingRunLoaded.path,
      file2Exists: existingRunLoaded.exists,
      file2OldRaw: existingRunLoaded.raw,
      file2NewContent: JSON.stringify(nextRunDoc, null, 2) + '\n',
      _testHooks,
    });

    return {
      enqueued: true,
      run_id: runId,
      submission_authorized: false,
      batch_selection: batchSelection,
      enqueued_job_ids: requestedCanonicalIds,
      queue: nextCpDoc.queue,
      checkpoint_path: existingCpLoaded.path,
      run_path: existingRunLoaded.path,
      checkpoint: nextCpDoc,
      run: nextRunDoc,
    };
  });
}

// ---------------- Stage 6 (T12.3): Context-Aware CV Selection & Preparation Verification ----------------

export const BANNED_AI_CLICHES = Object.freeze([
  'delve',
  'testament',
  'tapestry',
  'spearheaded',
  'synergy',
  'thrilled to apply',
  'fast-paced environment',
  'moreover',
  'furthermore',
  'leveraged',
  'orchestrated',
  'passionate about',
  'dynamic environment',
  'proven track record',
  'hit the ground running',
  'deeply excited',
  'results-driven',
  'seasoned professional',
  'dynamic team player',
]);

const PREP_BANNED_AI_CLICHES = BANNED_AI_CLICHES;

function stripHtmlTagsForVerify(html) {
  return stripMarkupTags(stripHtmlBlocks(String(html || ''), ['style', 'script']), ' ')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findBannedClichesInText(plainText) {
  const found = [];
  const text = String(plainText || '');
  for (const phrase of PREP_BANNED_AI_CLICHES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i');
    if (re.test(text)) found.push(phrase);
  }
  return found;
}

function verifyPreparationArtifactFile(filePath, resolvedRoot, home) {
  refuseSymlink(filePath, resolvedRoot, home);
  const st = fs.lstatSync(filePath);
  if (st.isSymbolicLink() || !st.isFile()) {
    return { name: path.basename(filePath), errors: [`${path.basename(filePath)}: must be a regular non-symlink file.`] };
  }
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const errors = [];

  if (buf.length === 0) {
    errors.push(`${name}: file is empty (0 bytes).`);
    return { name, errors };
  }

  if (ext === '.pdf') {
    if (buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
      errors.push(`${name}: invalid PDF header (does not start with %PDF-).`);
    }
    if (buf.length > 200 * 1024) {
      errors.push(`${name}: PDF size (${Math.round(buf.length / 1024)} KB) exceeds 200 KB limit.`);
    }
    return { name, errors };
  }

  const rawText = buf.toString('utf8');
  if (/\{\{[A-Za-z0-9_]+\}\}/.test(rawText)) {
    const matches = rawText.match(/\{\{[A-Za-z0-9_]+\}\}/g) || [];
    errors.push(`${name}: unresolved template placeholder(s): ${[...new Set(matches)].join(', ')}.`);
  }

  const isNotesOrDossier = /^(?:tailoring-notes|interview-dossier)\b/i.test(name);
  const isOutreachDraft = /^(?:outreach-draft|followup-draft)\b/i.test(name);

  if (!isNotesOrDossier) {
    let prose = rawText;
    let fullPlain = rawText;
    if (ext === '.html' || ext === '.htm' || (ext === '.doc' && /<html|<body/i.test(rawText))) {
      const bodyWithoutTitle = rawText.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, ' ');
      const proseMatches = [...bodyWithoutTitle.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)];
      prose = proseMatches.map(m => stripHtmlTagsForVerify(m[1])).join('\n') || stripHtmlTagsForVerify(bodyWithoutTitle);
      fullPlain = stripHtmlTagsForVerify(bodyWithoutTitle);
    } else {
      const nonHeadingLines = rawText
        .split(/\r?\n/)
        .filter(l => !/^\s*(?:#{1,6}\s|\*\*[^*]+—[^*]+\*\*)/.test(l));
      prose = nonHeadingLines.join('\n');
    }

    const cliches = findBannedClichesInText(fullPlain);
    if (cliches.length > 0) {
      errors.push(`${name}: banned AI cliché(s) found: ${cliches.join(', ')}.`);
    }
    if (prose.includes('—')) {
      errors.push(`${name}: prose em-dash (—) detected inside paragraph/bullet text.`);
    }
  }

  if (isOutreachDraft) {
    const words = rawText.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      errors.push(`${name}: outreach draft is empty (0 words).`);
    } else if (words.length > 75) {
      errors.push(`${name}: outreach word cap exceeded (${words.length}/75 words).`);
    }
  }

  return { name, errors };
}

export function computeCanonicalResumeFolderRel(company, title, jobId) {
  if (!isUsableJobId(jobId)) {
    throw new Error('computeCanonicalResumeFolderRel requires a non-empty jobId.');
  }
  const cSlug = slugifySegment(company) || 'company';
  const tSlug = slugifySegment(title) || 'role';
  const jSlug = slugifySegment(jobId) || 'job';
  let folderSlug = `${cSlug}-${tSlug}-${jSlug}`;
  // Prevent owner folder slugs from ever colliding with reserved third-party `logs/resumes/cv-<slug>/` namespace
  if (/^cv(?:-|$)/i.test(folderSlug)) {
    folderSlug = `job-${folderSlug}`;
  }
  return `logs/resumes/${folderSlug}`;
}

export function selectBestOwnerCvVersion(root, candidate = {}, {
  home = os.homedir(),
} = {}) {
  if (!isObj(candidate)) {
    throw new Error('selectBestOwnerCvVersion requires a candidate object.');
  }
  const resolvedRoot = path.resolve(root);
  const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });
  const prefs = readWorkspaceTargetingPreferences(resolvedRoot, { home });

  const targetJobKey = isUsableJobId(candidate.job_id) ? normalizeJobIdKey(candidate.job_id) : null;
  const targetAppId = isUsableJobId(candidate.job_id) ? computeApplicationId(candidate.job_id) : null;
  const reqPersona = isNonEmptyString(candidate.persona_id)
    ? candidate.persona_id.trim().toLowerCase()
    : (prefs.active_persona ? prefs.active_persona.toLowerCase() : null);
  const reqLang = isNonEmptyString(candidate.language)
    ? candidate.language.trim().toLowerCase()
    : 'en';
  const candSkills = (Array.isArray(candidate.matched_skills) ? candidate.matched_skills : [])
    .filter(isNonEmptyString)
    .map(s => s.trim().toLowerCase());
  const missingSkills = (Array.isArray(candidate.missing_skills) ? candidate.missing_skills : [])
    .filter(isNonEmptyString)
    .map(s => s.trim());
  const titleTokens = slugifySegment(candidate.title || '')
    .split('-')
    .filter(t => t.length >= 2);

  let thirdPartyExcluded = 0;
  const scored = [];
  const byId = new Map();
  for (const v of cvLoaded.registry.versions) {
    if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
      byId.set(v.cv_version_id.trim(), v);
    }
  }

  for (const v of cvLoaded.registry.versions) {
    if (!isObj(v) || !isNonEmptyString(v.cv_version_id)) continue;
    if (!classifyCvRegistryEntryOwnership(v, byId).isOwner) {
      thirdPartyExcluded++;
      continue;
    }
    if (isNonEmptyString(v.local_ref_rel)) {
      try {
        const fullRef = assertWorkspacePathSafe(resolvedRoot, v.local_ref_rel, { home, label: 'CV local_ref_rel' });
        if (!fs.existsSync(fullRef)) continue;
      } catch {
        continue;
      }
    }

    let score = 0;
    let exactJobMatch = false;
    const metaTargetJob = v.tailoring_metadata?.target_job_id;
    if (
      (targetJobKey && isUsableJobId(metaTargetJob) && normalizeJobIdKey(metaTargetJob) === targetJobKey) ||
      (targetAppId && Array.isArray(v.application_ids) && v.application_ids.includes(targetAppId))
    ) {
      score += 100;
      exactJobMatch = true;
    }

    if (reqPersona && isNonEmptyString(v.persona_id) && v.persona_id.trim().toLowerCase() === reqPersona) {
      score += 25;
    }
    if (isNonEmptyString(v.language) && v.language.trim().toLowerCase() === reqLang) {
      score += 15;
    }

    const vSkills = new Set([
      ...((v.tailoring_metadata?.emphasized_skills || []).map(s => String(s).trim().toLowerCase())),
      ...slugifySegment(v.label || '').split('-'),
    ]);
    let skillPoints = 0;
    for (const sk of candSkills) {
      if (vSkills.has(sk) || [...vSkills].some(vs => vs.includes(sk) || sk.includes(vs))) {
        skillPoints += 5;
      }
    }
    score += Math.min(20, skillPoints);

    const roleTokens = new Set(
      slugifySegment(`${v.tailoring_metadata?.target_role || ''} ${v.label || ''}`)
        .split('-')
        .filter(t => t.length >= 2),
    );
    let rolePoints = 0;
    for (const tk of titleTokens) {
      if (roleTokens.has(tk)) rolePoints += 2;
    }
    score += Math.min(10, rolePoints);

    const afterPct = v.ats_metrics?.keyword_match_after_pct;
    if (typeof afterPct === 'number' && Number.isFinite(afterPct)) {
      score += Math.round((Math.max(0, Math.min(100, afterPct)) / 100) * 10);
    }
    const hyg = v.ats_metrics?.hygiene_score;
    if (typeof hyg === 'number' && Number.isFinite(hyg)) {
      score += Math.round((Math.max(0, Math.min(100, hyg)) / 100) * 10);
    }

    scored.push({
      cv_version_id: v.cv_version_id,
      score,
      exact_job_match: exactJobMatch,
      version: v,
    });
  }

  scored.sort((a, b) =>
    (b.score - a.score) ||
    (Number(b.exact_job_match) - Number(a.exact_job_match)) ||
    ((b.version.version_number || 0) - (a.version.version_number || 0)) ||
    a.cv_version_id.localeCompare(b.cv_version_id),
  );

  const best = scored[0] || null;
  let tailoringRecommended = false;
  let tailoringReason = 'existing_owner_cv_matches_context';

  if (!best) {
    tailoringRecommended = true;
    tailoringReason = 'no_registered_owner_cv';
  } else if (best.exact_job_match) {
    tailoringRecommended = false;
    tailoringReason = 'exact_job_tailored_cv_registered';
  } else if (missingSkills.length > 0) {
    tailoringRecommended = true;
    tailoringReason = 'missing_skills_require_tailored_framing';
  } else if (typeof candidate.match_score === 'number' && candidate.match_score >= 8 && best.version.kind === 'generic') {
    tailoringRecommended = true;
    tailoringReason = 'tier_a_role_benefits_from_tailored_cv';
  }

  return {
    selected_cv_version_id: best ? best.cv_version_id : null,
    selected_version: best ? best.version : null,
    selection_score: best ? best.score : null,
    exact_job_match: best ? best.exact_job_match : false,
    tailoring_recommended: tailoringRecommended,
    tailoring_reason: tailoringReason,
    candidate_count: scored.length,
    third_party_excluded: thirdPartyExcluded,
  };
}

export function prepareApplicationPackage(root, input, {
  home = os.homedir(),
  nowIso = new Date().toISOString(),
  _testHooks = null,
} = {}) {
  if (!isObj(input)) throw new Error('prepareApplicationPackage requires an input object.');
  if (!isUsableJobId(input.job_id)) throw new Error('prepareApplicationPackage requires a non-empty job_id.');
  if (!isValidIsoDateTime(nowIso)) throw new Error(`prepareApplicationPackage: invalid nowIso "${nowIso}".`);

  for (const pctKey of ['ats_keyword_before_pct', 'ats_keyword_after_pct']) {
    const val = input[pctKey];
    if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 100)) {
      throw new Error(`prepareApplicationPackage: ${pctKey} must be a number in 0..100 or null.`);
    }
  }

  const requireReady = input.require_ready !== false;
  const resolvedRoot = path.resolve(root);

  return withLedgerLock(resolvedRoot, { home, nowIso }, () => {
    assertNoIncompleteLedgerTransaction(resolvedRoot, { home });
    const appLoaded = readValidatedApplicationsLedger(resolvedRoot, { home });
    const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });

    const records = [...appLoaded.records];
    const jobKey = normalizeJobIdKey(input.job_id);
    const appIdx = records.findIndex(r => isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === jobKey);
    if (appIdx < 0) {
      throw new Error(`application_not_found: No application record exists for job_id "${input.job_id}". Record or triage it first.`);
    }
    const cvRegForPrep = cvLoaded.exists ? cvLoaded.registry : null;
    const cvByIdForPrep = new Map();
    if (cvRegForPrep) {
      for (const v of cvRegForPrep.versions) {
        if (isObj(v) && isNonEmptyString(v.cv_version_id)) {
          cvByIdForPrep.set(v.cv_version_id.trim(), v);
        }
      }
    }
    const existing = normalizeApplicationRecord(records[appIdx]);
    const existingPrepOwn = classifyApplicationOwnership(existing, cvRegForPrep);
    if (!existingPrepOwn.isOwner) {
      throw new Error(`third_party_blocked: Refusing to prepare owner application package for third-party or unverified record "${existing.job_id}" (${existingPrepOwn.reason}).`);
    }
    if (SUBMITTED_STATUS_SET.has(existing.status)) {
      throw new Error(`already_submitted: Application "${existing.job_id}" is already "${existing.status}"; refusing to overwrite preparation state.`);
    }
    if (existing.submission_uncertain === true) {
      throw new Error(`reservation_active: Application "${existing.job_id}" has an unresolved submission_uncertain reservation.`);
    }

    if (isNonEmptyString(input.folder_rel)) {
      const fCheck = validateSafeWorkspaceRelativePath(input.folder_rel, {
        allowThirdParty: false,
        label: 'application preparation folder',
      });
      if (!fCheck.valid) {
        throw new Error(fCheck.error);
      }
    }
    const rawFolderRel = isNonEmptyString(input.folder_rel)
      ? input.folder_rel.trim()
      : (existing.cv_tailoring?.tailored_folder_rel || computeCanonicalResumeFolderRel(existing.company, existing.title, existing.job_id));
    const folderPath = assertWorkspacePathSafe(resolvedRoot, rawFolderRel, {
      home,
      label: 'application preparation folder',
    });
    const normFolderRel = path.relative(resolvedRoot, folderPath).replace(/\\/g, '/');
    if (isThirdPartyCvPath(normFolderRel)) {
      throw new Error(`third_party_blocked: Refusing third-party CV path "${normFolderRel}" for owner application preparation.`);
    }

    // Validate explicit or existing owner CV version
    const explicitCvRequested = isNonEmptyString(input.cv_version_id);
    let linkedCvVersion = null;
    if (explicitCvRequested) {
      const reqId = input.cv_version_id.trim();
      const found = cvByIdForPrep.get(reqId);
      if (!found) {
        throw new Error(`cv_version_not_found: CV version "${reqId}" is not registered in logs/cv-versions.json.`);
      }
      const foundOwn = classifyCvRegistryEntryOwnership(found, cvByIdForPrep);
      if (!foundOwn.isOwner) {
        throw new Error(`third_party_blocked: Refusing to link third-party or unverified CV version "${reqId}" to owner application "${existing.job_id}" (${foundOwn.reason}).`);
      }
      linkedCvVersion = found;
    } else if (isNonEmptyString(existing.cv_version_id)) {
      const found = cvByIdForPrep.get(existing.cv_version_id.trim());
      if (found && classifyCvRegistryEntryOwnership(found, cvByIdForPrep).isOwner) {
        linkedCvVersion = found;
      }
    }

    const cvSelection = selectBestOwnerCvVersion(resolvedRoot, {
      job_id: existing.job_id,
      title: existing.title,
      persona_id: input.persona_id ?? existing.persona_id,
      language: input.language,
      matched_skills: existing.matched_skills,
      missing_skills: existing.missing_skills,
      match_score: existing.match_score,
    }, { home });

    if (isNonEmptyString(input.base_cv_version_id)) {
      const baseId = input.base_cv_version_id.trim();
      const baseFound = cvByIdForPrep.get(baseId);
      if (baseFound) {
        const baseOwn = classifyCvRegistryEntryOwnership(baseFound, cvByIdForPrep);
        if (!baseOwn.isOwner) {
          throw new Error(`third_party_blocked: Refusing third-party or unverified base_cv_version_id "${baseId}" (${baseOwn.reason}).`);
        }
      }
    }

    // Inspect and verify deliverable files inside folderPath
    const verifiedFiles = [];
    const artifactErrors = [];
    const missingRequired = [];
    let hasPrimaryResume = false;
    let hasTailoringNotes = false;

    if (!fs.existsSync(folderPath)) {
      missingRequired.push(`preparation folder "${normFolderRel}" does not exist`);
    } else {
      const dirStat = fs.lstatSync(folderPath);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        artifactErrors.push(`"${normFolderRel}" must be a regular non-symlink directory.`);
      } else {
        const entries = fs.readdirSync(folderPath).sort();
        for (const entryName of entries) {
          if (!/\.(?:html|htm|doc|txt|md|pdf)$/i.test(entryName)) continue;
          const fullFile = path.join(folderPath, entryName);
          const check = verifyPreparationArtifactFile(fullFile, resolvedRoot, home);
          verifiedFiles.push(entryName);
          if (check.errors.length > 0) {
            artifactErrors.push(...check.errors);
          }
          if (/^resume\.html$/i.test(entryName) || /\.pdf$/i.test(entryName)) {
            hasPrimaryResume = true;
          }
          if (/^tailoring-notes\.md$/i.test(entryName)) {
            hasTailoringNotes = true;
          }
        }
        if (!hasPrimaryResume) {
          missingRequired.push('missing primary resume deliverable (resume.html or *.pdf)');
        }
        if (!hasTailoringNotes) {
          missingRequired.push('missing tailoring-notes.md');
        }
      }
    }

    const packageReady = missingRequired.length === 0 && artifactErrors.length === 0;
    if (!packageReady && requireReady) {
      throw new Error(
        `preparation_package_incomplete: Application "${existing.job_id}" package at "${normFolderRel}" failed verification: ${[...missingRequired, ...artifactErrors].join('; ')}`,
      );
    }

    // Resolve auto-selected owner CV without creating a kind/is_tailored contradiction with Notion sync attribution.
    // When tailoring artifacts exist and only a generic owner CV was auto-selected, record it as base_cv_version_id
    // instead of attaching a generic CV as the tailored application's cv_version_id.
    let autoBaseCvId = null;
    if (!linkedCvVersion && cvSelection.selected_version) {
      const selected = cvSelection.selected_version;
      if (selected.kind === 'generic' && hasTailoringNotes) {
        autoBaseCvId = selected.cv_version_id;
      } else {
        linkedCvVersion = selected;
      }
    }

    if (linkedCvVersion && isNonEmptyString(input.base_cv_version_id)) {
      const reqBase = input.base_cv_version_id.trim();
      const regBase = isNonEmptyString(linkedCvVersion.base_cv_version_id)
        ? linkedCvVersion.base_cv_version_id.trim()
        : null;
      if (regBase !== null && regBase !== reqBase) {
        throw new Error(
          `base_cv_version_mismatch: Provided base_cv_version_id "${reqBase}" contradicts CV version "${linkedCvVersion.cv_version_id}" registry base "${regBase}".`,
        );
      }
      if (regBase === null && reqBase !== linkedCvVersion.cv_version_id.trim()) {
        throw new Error(
          `base_cv_version_mismatch: Provided base_cv_version_id "${reqBase}" contradicts root CV version "${linkedCvVersion.cv_version_id}".`,
        );
      }
    }
    if (isNonEmptyString(input.base_cv_version_id)) {
      const reqBase = input.base_cv_version_id.trim();
      if (!cvByIdForPrep.get(reqBase)) {
        throw new Error(`invalid_base_cv_version: base_cv_version_id "${reqBase}" is not registered in logs/cv-versions.json.`);
      }
    }

    const baseCvId = linkedCvVersion
      ? (isNonEmptyString(input.base_cv_version_id) ? input.base_cv_version_id.trim() : (linkedCvVersion.base_cv_version_id ?? null))
      : (input.base_cv_version_id !== undefined
        ? (isNonEmptyString(input.base_cv_version_id) ? input.base_cv_version_id.trim() : null)
        : (existing.cv_tailoring?.base_cv_version_id ?? autoBaseCvId ?? null));
    const atsBefore = input.ats_keyword_before_pct !== undefined
      ? input.ats_keyword_before_pct
      : (existing.cv_tailoring?.ats_keyword_before_pct ?? linkedCvVersion?.ats_metrics?.keyword_match_before_pct ?? null);
    const atsAfter = input.ats_keyword_after_pct !== undefined
      ? input.ats_keyword_after_pct
      : (existing.cv_tailoring?.ats_keyword_after_pct ?? linkedCvVersion?.ats_metrics?.keyword_match_after_pct ?? null);

    const cvTailoring = {
      is_tailored: linkedCvVersion
        ? linkedCvVersion.kind === 'tailored'
        : (hasTailoringNotes || Boolean(existing.cv_tailoring?.is_tailored)),
      base_cv_version_id: baseCvId,
      ats_keyword_before_pct: atsBefore,
      ats_keyword_after_pct: atsAfter,
      tailored_folder_rel: normFolderRel,
      tailoring_notes_rel: hasTailoringNotes ? `${normFolderRel}/tailoring-notes.md` : (existing.cv_tailoring?.tailoring_notes_rel ?? null),
    };

    const targetStatus = packageReady ? 'prepared' : existing.status;
    const stageHistory = [...existing.stage_history];
    if (packageReady && existing.status !== 'prepared') {
      assertChronologicalTimestamp(existing, nowIso, 'preparation timestamp');
      stageHistory.push({
        event_id: makeStageEventId('prp', 'prepared', nowIso, stageHistory.length),
        from_status: existing.status,
        to_status: 'prepared',
        at: nowIso,
        source: 'preparation',
        verified: true,
        notes: `Verified package in ${normFolderRel} (${verifiedFiles.join(', ')})`.slice(0, 200),
      });
    }

    const nextApp = normalizeApplicationRecord({
      ...existing,
      status: targetStatus,
      updated_at: nowIso,
      persona_id: input.persona_id !== undefined ? input.persona_id : existing.persona_id,
      cv_version_id: linkedCvVersion ? linkedCvVersion.cv_version_id : existing.cv_version_id,
      cv_tailoring: cvTailoring,
      stage_history: stageHistory,
      provenance: {
        ...existing.provenance,
        last_updated_by: 'cli_prepare',
      },
    });
    records[appIdx] = nextApp;

    const ledgerCheck = validateApplicationLedger(records);
    if (!ledgerCheck.valid) {
      throw new Error(`Invalid applications ledger during prepare: ${ledgerCheck.errors.join('; ')}`);
    }

    // If linkedCvVersion is in registry and does not yet include this application_id, update both files transactionally
    if (linkedCvVersion && !linkedCvVersion.application_ids.includes(nextApp.application_id)) {
      const nextRegistry = registerCvVersion(cvLoaded.registry, {
        ...linkedCvVersion,
        created_at: linkedCvVersion.created_at,
        updated_at: nowIso,
        application_ids: [...linkedCvVersion.application_ids, nextApp.application_id],
      });
      commitTwoFileLedgerTransaction(resolvedRoot, {
        operation: 'prepare_link_cv',
        nowIso,
        home,
        file1Rel: 'logs/cv-versions.json',
        file1Path: cvLoaded.path,
        file1Exists: cvLoaded.exists,
        file1OldRaw: cvLoaded.raw,
        file1NewContent: JSON.stringify(nextRegistry, null, 2) + '\n',
        file2Rel: 'logs/applications-log.json',
        file2Path: appLoaded.path,
        file2Exists: appLoaded.exists,
        file2OldRaw: appLoaded.raw,
        file2NewContent: JSON.stringify(records, null, 2) + '\n',
        _testHooks,
      });
    } else {
      persistValidatedLedger(resolvedRoot, records, { home, ledgerPath: appLoaded.path });
    }

    return {
      prepared: packageReady,
      submission_authorized: false,
      application_id: nextApp.application_id,
      job_id: nextApp.job_id,
      status: nextApp.status,
      folder_rel: normFolderRel,
      verified_files: verifiedFiles,
      missing_required: missingRequired,
      artifact_errors: artifactErrors,
      cv_version_id: nextApp.cv_version_id,
      cv_selection: cvSelection,
      cv_tailoring: nextApp.cv_tailoring,
      record: nextApp,
    };
  });
}

// ---------------- Stage 6 (T12.4): Deterministic Workflow & Post-Application Action Queue ----------------

export function computeCareerWorkflowQueue(root, {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
  jobId = null,
  personaId = null,
  language = 'en',
} = {}) {
  if (!isValidIsoDateTime(nowIso)) {
    throw new Error(`computeCareerWorkflowQueue: invalid nowIso "${nowIso}".`);
  }
  const resolvedRoot = path.resolve(root);
  const nowMs = Date.parse(nowIso);
  const blockers = [];
  const nextActions = [];

  // 1. Inspect lock, transaction journal, and circuit breaker (read-only)
  const lockInfo = inspectLedgerLock(resolvedRoot, { home, nowIso });
  if (lockInfo.locked) {
    blockers.push({
      code: lockInfo.corrupt ? 'corrupt_ledger_lock' : (lockInfo.stale ? 'stale_ledger_lock' : 'active_ledger_lock'),
      message: lockInfo.corrupt
        ? lockInfo.error
        : `Ledger lock is held by PID ${lockInfo.lock?.pid} (stale=${lockInfo.stale}, owner_alive=${lockInfo.owner_alive}).`,
      recommended_command: lockInfo.stale && lockInfo.owner_alive === false
        ? `veycraft career release-stale-lock --nonce ${lockInfo.lock?.nonce} --confirm-unlock`
        : 'veycraft career lock-status',
    });
  }

  const txInfo = inspectLedgerTransaction(resolvedRoot, { home });
  if (txInfo.pending) {
    blockers.push({
      code: 'incomplete_ledger_transaction',
      message: txInfo.corrupt
        ? txInfo.error
        : `Incomplete cross-file ledger transaction "${txInfo.transaction.tx_id}" (operation=${txInfo.transaction.operation}, stage=${txInfo.transaction.stage}).`,
      recommended_command: 'veycraft career recover-tx --confirm-rollback',
    });
  }

  let records = [];
  let skippedRecords = [];
  try {
    records = readValidatedApplicationsLedger(resolvedRoot, { home }).records;
  } catch (err) {
    blockers.push({
      code: 'corrupt_applications_ledger',
      message: err.message,
      recommended_command: 'veycraft verify logs/applications-log.json',
    });
  }

  try {
    skippedRecords = readValidatedSkippedJobs(resolvedRoot, { home }).records;
  } catch (err) {
    blockers.push({
      code: 'corrupt_skipped_jobs_ledger',
      message: err.message,
      recommended_command: 'veycraft verify logs/skipped-jobs.json',
    });
  }

  let cbDoc = null;
  try {
    cbDoc = readCircuitBreaker(resolvedRoot, { home });
  } catch (err) {
    blockers.push({
      code: 'corrupt_circuit_breaker',
      message: err.message,
      recommended_command: 'veycraft status',
    });
  }

  let cvRegistry = null;
  let cvRegistryCorrupt = false;
  try {
    const cvLoaded = readValidatedCvRegistry(resolvedRoot, { home });
    cvRegistry = cvLoaded.exists ? cvLoaded.registry : null;
  } catch (err) {
    cvRegistryCorrupt = true;
    blockers.push({
      code: 'corrupt_cv_versions_registry',
      message: err.message,
      recommended_command: 'veycraft verify logs/cv-versions.json',
    });
  }

  const checkRecordOwnershipSafe = raw => {
    if (!isObj(raw)) return { isOwner: false, isThirdPartyOrAmbiguous: false };
    if (cvRegistryCorrupt) {
      const hasCvRef = (raw.cv_version_id !== undefined && raw.cv_version_id !== null && raw.cv_version_id !== '') ||
        (isObj(raw.cv_tailoring) && raw.cv_tailoring.base_cv_version_id !== undefined && raw.cv_tailoring.base_cv_version_id !== null && raw.cv_tailoring.base_cv_version_id !== '');
      if (hasCvRef) {
        return { isOwner: false, isThirdPartyOrAmbiguous: true, reason: 'corrupt_cv_versions_registry' };
      }
    }
    return classifyApplicationOwnership(raw, cvRegistry);
  };

  const activeCircuitBreakers = [];
  if (isObj(cbDoc?.platforms)) {
    for (const [plat, info] of Object.entries(cbDoc.platforms)) {
      if (isObj(info) && info.status === 'tripped' && isValidIsoDateTime(info.cooldown_until) && Date.parse(info.cooldown_until) > nowMs) {
        activeCircuitBreakers.push({
          platform: plat,
          cooldown_until: info.cooldown_until,
          trigger_signal: info.trigger_signal || null,
        });
        blockers.push({
          code: 'circuit_breaker_active',
          platform: plat,
          message: `Circuit breaker active for "${plat}" until ${info.cooldown_until} (${info.trigger_signal || 'anti-bot cooldown'}).`,
          recommended_command: 'veycraft status',
        });
      }
    }
  }

  // Unresolved submission_uncertain reservations (owner only)
  const uncertainReservations = [];
  for (const raw of records) {
    if (!isObj(raw) || !checkRecordOwnershipSafe(raw).isOwner) continue;
    if (raw.submission_uncertain === true) {
      const norm = normalizeApplicationRecord(raw);
      uncertainReservations.push({
        job_id: norm.job_id,
        application_id: norm.application_id,
        company: norm.company,
        title: norm.title,
        platform: norm.platform,
        updated_at: norm.updated_at,
      });
      blockers.push({
        code: 'unresolved_submission_uncertain',
        job_id: norm.job_id,
        message: `Application "${norm.job_id}" (${norm.company || 'Unknown'} - ${norm.title || 'Role'}) has submission_uncertain=true. Verify ATS confirmation receipt before submitting new applications.`,
        recommended_command: `veycraft career confirm-submit --job-id "${norm.job_id}" --receipt "<verified_receipt_quote>"`,
      });
    }
  }

  for (const b of blockers) {
    nextActions.push({
      priority: 'P0_BLOCKER',
      code: b.code,
      job_id: b.job_id || null,
      summary: b.message,
      recommended_command: b.recommended_command,
    });
  }

  // 2. Cap budget & preferences (read-only)
  const prefs = readWorkspaceTargetingPreferences(resolvedRoot, { home });
  const gate = evaluatePreSubmitGate(resolvedRoot, {}, { home, sourceRoot, nowIso, recordsOverride: records, cvRegistryOverride: cvRegistry });
  const dc = gate.checks.daily_cap;
  const capBudget = {
    dry_run: dc.dry_run,
    warmup_active: dc.warmup_active,
    today_counted: dc.today_counted,
    today_applied: dc.today_applied,
    today_submission_uncertain: dc.today_submission_uncertain,
    effective_cap: dc.effective_cap,
    remaining_today: Math.max(0, dc.effective_cap - dc.today_counted),
  };

  // 3. Active session checkpoint inspection (read-only)
  let activeRun = null;
  const checkpointJobOrder = new Map();
  const awaitingOwner = [];
  const cpPath = path.join(resolvedRoot, 'logs', 'runs', 'current-session-checkpoint.json');
  if (fs.existsSync(cpPath)) {
    try {
      const loadedCp = readValidatedSessionCheckpointFile(resolvedRoot, { home });
      const cp = loadedCp.doc;
      if (cp) {
        const derived = deriveRunCountsFromLedger(resolvedRoot, cp.run_id, {
          home,
          sourceRoot,
          nowIso,
          recordsOverride: records,
          skippedOverride: skippedRecords,
        });
        const reconciled = reconcileCheckpointQueueWithLedger(cp.queue, cp.processed_job_ids, derived, { requireTrackedInLedger: true });
        const inSync =
          JSON.stringify(cp.caps) === JSON.stringify(derived.caps) &&
          JSON.stringify(cp.queue) === JSON.stringify(reconciled.queue);

        activeRun = {
          run_id: cp.run_id,
          phase: cp.phase,
          workflow_mode: cp.workflow_mode,
          dry_run: cp.dry_run,
          submission_authorized: false,
          approval_expired_on_resume: Boolean(cp.approval_expired_on_resume),
          checkpoint_in_sync: inSync,
          queue: cp.queue,
          reconciled_queue: reconciled.queue,
          awaiting_owner: cp.awaiting_owner,
          next_action: cp.next_action,
        };

        reconciled.queue.forEach((id, idx) => checkpointJobOrder.set(normalizeJobIdKey(id), idx));
        for (const item of cp.awaiting_owner || []) {
          if (!derived.handled_job_keys.has(normalizeJobIdKey(item.job_id))) {
            awaitingOwner.push({ job_id: item.job_id, question: item.question, source: 'session_checkpoint' });
          }
        }

        if (cp.phase !== 'finished' && cp.phase !== 'aborted' && !inSync) {
          nextActions.push({
            priority: 'P1_ACTIVE_RUN',
            code: 'checkpoint_reconcile_needed',
            job_id: null,
            summary: `Session checkpoint for run "${cp.run_id}" is out of sync with ledger counts/queue; run resume reconciliation.`,
            recommended_command: `veycraft career run-resume --run-id ${cp.run_id}`,
          });
        }
      }
    } catch (err) {
      nextActions.push({
        priority: 'P0_BLOCKER',
        code: 'corrupt_session_checkpoint',
        job_id: null,
        summary: err.message,
        recommended_command: 'veycraft verify logs/runs/current-session-checkpoint.json',
      });
    }
  }

  // 4. Preparation queue & post-application tracking (owner records only)
  const preparationQueue = [];
  const overdueFollowUps = [];
  const activeInterviews = [];
  const activeAssessments = [];
  const silent14dHygiene = [];
  let thirdPartyExcluded = 0;

  for (const raw of records) {
    if (!isObj(raw) || !isUsableJobId(raw.job_id)) continue;
    const own = checkRecordOwnershipSafe(raw);
    if (!own.isOwner) {
      if (own.isThirdPartyOrAmbiguous) thirdPartyExcluded++;
      continue;
    }
    const norm = normalizeApplicationRecord(raw);
    const key = normalizeJobIdKey(norm.job_id);
    if (norm.submission_uncertain === true) continue;

    // Awaiting owner questions from needs_review records (supports both string and { question } items per schema)
    if (norm.status === 'needs_review' && Array.isArray(norm.open_questions) && norm.open_questions.length > 0) {
      for (const q of norm.open_questions) {
        const qText = isNonEmptyString(q)
          ? q.trim()
          : (isObj(q) && isNonEmptyString(q.question) ? q.question.trim() : null);
        if (qText && !awaitingOwner.some(a => normalizeJobIdKey(a.job_id) === key && a.question === qText)) {
          awaitingOwner.push({ job_id: norm.job_id, question: qText, source: 'application_ledger' });
        }
      }
    }

    // Preparation / apply candidates
    if (norm.status === 'prepared' || norm.status === 'discovered' || norm.status === 'needs_review') {
      const score = typeof norm.match_score === 'number' ? norm.match_score : null;
      if (score !== null && score < 5) continue;
      let cvRec = null;
      try {
        cvRec = selectBestOwnerCvVersion(resolvedRoot, {
          job_id: norm.job_id,
          title: norm.title,
          persona_id: personaId ?? norm.persona_id,
          language,
          matched_skills: norm.matched_skills,
          missing_skills: norm.missing_skills,
          match_score: score,
        }, { home });
      } catch {
        cvRec = null;
      }
      const canonicalFolderRel = computeCanonicalResumeFolderRel(norm.company, norm.title, norm.job_id);
      const folderRel = resolveSafeQueueRelativePath(resolvedRoot, norm.cv_tailoring?.tailored_folder_rel, canonicalFolderRel, { home, allowThirdParty: false });
      preparationQueue.push({
        job_id: norm.job_id,
        application_id: norm.application_id,
        company: norm.company,
        title: norm.title,
        platform: norm.platform,
        status: norm.status,
        match_score: score,
        in_active_run_queue: checkpointJobOrder.has(key),
        queue_order: checkpointJobOrder.has(key) ? checkpointJobOrder.get(key) : 999999,
        folder_rel: folderRel,
        cv_version_id: norm.cv_version_id ?? cvRec?.selected_cv_version_id ?? null,
        tailoring_recommended: cvRec ? cvRec.tailoring_recommended : true,
        tailoring_reason: cvRec ? cvRec.tailoring_reason : null,
      });
    }

    // Post-application tracking on submitted records
    if (SUBMITTED_STATUS_SET.has(norm.status)) {
      const canonicalFolderRel = computeCanonicalResumeFolderRel(norm.company, norm.title, norm.job_id);
      const folderRel = resolveSafeQueueRelativePath(resolvedRoot, norm.cv_tailoring?.tailored_folder_rel, canonicalFolderRel, { home, allowThirdParty: false });
      const appliedMs = isValidIsoDateTime(norm.applied_at) ? Date.parse(norm.applied_at) : null;
      const ageDays = appliedMs !== null ? Math.floor((nowMs - appliedMs) / DAY_MS) : null;

      if (Array.isArray(norm.interviews)) {
        for (const iv of norm.interviews) {
          if (isObj(iv) && (iv.status === 'invited' || iv.status === 'scheduled' || iv.status === 'rescheduled')) {
            const safeDossierRel = resolveSafeQueueRelativePath(resolvedRoot, iv.dossier_rel, `${folderRel}/interview-dossier.md`, { home, allowThirdParty: false });
            activeInterviews.push({
              job_id: norm.job_id,
              company: norm.company,
              title: norm.title,
              interview_id: iv.interview_id,
              stage: iv.stage,
              round: iv.round,
              status: iv.status,
              scheduled_at: iv.scheduled_at ?? null,
              dossier_rel: safeDossierRel,
            });
          }
        }
      }

      if (Array.isArray(norm.assessments)) {
        for (const asmt of norm.assessments) {
          if (isObj(asmt) && (asmt.status === 'assigned' || asmt.status === 'in_progress')) {
            const safeBlueprintRel = resolveSafeQueueRelativePath(resolvedRoot, asmt.blueprint_rel, `${folderRel}/assessment-blueprint.md`, { home, allowThirdParty: false });
            activeAssessments.push({
              job_id: norm.job_id,
              company: norm.company,
              title: norm.title,
              assessment_id: asmt.assessment_id,
              type: asmt.type,
              status: asmt.status,
              due_at: asmt.due_at ?? null,
              blueprint_rel: safeBlueprintRel,
            });
          }
        }
      }

      if (norm.status === 'applied' && ageDays !== null) {
        const fuStatus = norm.follow_up?.status || null;
        const followUpDone = fuStatus === 'sent' || fuStatus === 'closed' || fuStatus === 'not_needed' || /followup_sent:/i.test(norm.notes || '');
        if (ageDays >= 7 && !followUpDone) {
          const safeDraftRel = resolveSafeQueueRelativePath(resolvedRoot, norm.follow_up?.draft_rel, `${folderRel}/followup-draft.md`, { home, allowThirdParty: false });
          overdueFollowUps.push({
            job_id: norm.job_id,
            company: norm.company,
            title: norm.title,
            applied_at: norm.applied_at,
            age_days: ageDays,
            follow_up_status: fuStatus || 'overdue',
            followup_draft_rel: safeDraftRel,
          });
        }
        if (ageDays >= 14) {
          silent14dHygiene.push({
            job_id: norm.job_id,
            company: norm.company,
            title: norm.title,
            applied_at: norm.applied_at,
            age_days: ageDays,
            classification: 'silent_14d',
            note: '14+ days silent without logged employer response; never classified as confirmed rejection.',
          });
        }
      }
    }
  }

  preparationQueue.sort((a, b) =>
    (Number(b.in_active_run_queue) - Number(a.in_active_run_queue)) ||
    (a.queue_order - b.queue_order) ||
    (Number(b.status === 'prepared') - Number(a.status === 'prepared')) ||
    ((b.match_score ?? -1) - (a.match_score ?? -1)) ||
    a.job_id.localeCompare(b.job_id),
  );
  overdueFollowUps.sort((a, b) => (b.age_days - a.age_days) || a.job_id.localeCompare(b.job_id));
  silent14dHygiene.sort((a, b) => (b.age_days - a.age_days) || a.job_id.localeCompare(b.job_id));
  activeAssessments.sort((a, b) => String(a.due_at || '9999').localeCompare(String(b.due_at || '9999')) || a.job_id.localeCompare(b.job_id));
  activeInterviews.sort((a, b) => String(a.scheduled_at || '9999').localeCompare(String(b.scheduled_at || '9999')) || a.job_id.localeCompare(b.job_id));

  for (const item of awaitingOwner) {
    nextActions.push({
      priority: 'P1_ACTIVE_RUN',
      code: 'awaiting_owner_input',
      job_id: item.job_id,
      summary: `Awaiting owner answer for "${item.job_id}": ${item.question}`,
      recommended_command: `veycraft career record --job-id "${item.job_id}" --status prepared --notes "<confirmed_answer>"`,
    });
  }

  for (const item of preparationQueue) {
    const prio = item.in_active_run_queue ? 'P1_ACTIVE_RUN' : 'P2_PREPARATION';
    if (item.status !== 'prepared') {
      nextActions.push({
        priority: prio,
        code: item.in_active_run_queue ? 'prepare_queued_job' : 'prepare_discovered_job',
        job_id: item.job_id,
        summary: `Prepare & verify package for "${item.job_id}" (${item.company || 'Company'} - ${item.title || 'Role'}, score=${item.match_score ?? 'n/a'}) in ${item.folder_rel}.`,
        recommended_command: `veycraft career prepare --job-id "${item.job_id}"`,
      });
    } else if (capBudget.remaining_today > 0 && uncertainReservations.length === 0) {
      nextActions.push({
        priority: prio,
        code: item.in_active_run_queue ? 'fill_and_review_queued_job' : 'ready_for_application_fill',
        job_id: item.job_id,
        summary: `Package verified for "${item.job_id}" (CV=${item.cv_version_id || 'unlinked'}). Run pre-submit check, fill form, display Live DOM Read-Back Table, and wait for explicit per-job APPROVE.`,
        recommended_command: `veycraft pre-submit --job-id "${item.job_id}"`,
      });
    }
  }

  for (const asmt of activeAssessments) {
    nextActions.push({
      priority: 'P3_POST_APPLY',
      code: 'active_assessment_due',
      job_id: asmt.job_id,
      summary: `Active assessment (${asmt.type}, status=${asmt.status}, due=${asmt.due_at || 'unspecified'}) for "${asmt.job_id}" (${asmt.company}).`,
      recommended_command: `veycraft verify "${asmt.blueprint_rel}"`,
    });
  }

  for (const iv of activeInterviews) {
    nextActions.push({
      priority: 'P3_POST_APPLY',
      code: 'upcoming_interview_prep',
      job_id: iv.job_id,
      summary: `Active interview (round ${iv.round}: ${iv.stage}, status=${iv.status}, at=${iv.scheduled_at || 'TBD'}) for "${iv.job_id}" (${iv.company}).`,
      recommended_command: `veycraft verify "${iv.dossier_rel}"`,
    });
  }

  for (const fu of overdueFollowUps) {
    nextActions.push({
      priority: 'P3_POST_APPLY',
      code: 'follow_up_overdue_7d',
      job_id: fu.job_id,
      summary: `Follow-up overdue (${fu.age_days}d since applied_at) for "${fu.job_id}" (${fu.company}). Draft <=75-word DRAFT_ONLY follow-up in ${fu.followup_draft_rel}.`,
      recommended_command: `veycraft career transition --job-id "${fu.job_id}" --to applied --source follow_up_radar --follow-up-status drafted --draft-rel "${fu.followup_draft_rel}"`,
    });
  }

  for (const sl of silent14dHygiene) {
    nextActions.push({
      priority: 'P3_POST_APPLY',
      code: 'silent_14d_inbox_check',
      job_id: sl.job_id,
      summary: `Application "${sl.job_id}" (${sl.company}) is ${sl.age_days}d silent (silent_14d — never assumed rejected). Check inbox for unlogged reply.`,
      recommended_command: `veycraft career summary`,
    });
  }

  // Optional single-job CV selection lookup when --job-id is passed to `career next`
  let focusedCvSelection = null;
  if (isUsableJobId(jobId)) {
    const tKey = normalizeJobIdKey(jobId);
    const foundRec = records.find(r => isObj(r) && isUsableJobId(r.job_id) && normalizeJobIdKey(r.job_id) === tKey && checkRecordOwnershipSafe(r).isOwner);
    try {
      focusedCvSelection = selectBestOwnerCvVersion(resolvedRoot, {
        job_id: jobId,
        title: foundRec?.title || '',
        persona_id: personaId ?? foundRec?.persona_id ?? null,
        language,
        matched_skills: foundRec?.matched_skills || [],
        missing_skills: foundRec?.missing_skills || [],
        match_score: foundRec?.match_score ?? null,
      }, { home });
    } catch {
      focusedCvSelection = null;
    }
  }

  return {
    root: resolvedRoot,
    generated_at: nowIso,
    read_only: true,
    blockers,
    cap_budget: capBudget,
    active_run: activeRun,
    awaiting_owner: awaitingOwner,
    preparation_queue: preparationQueue,
    post_application: {
      overdue_follow_ups: overdueFollowUps,
      active_interviews: activeInterviews,
      active_assessments: activeAssessments,
      silent_14d_hygiene: silent14dHygiene,
    },
    focused_cv_selection: focusedCvSelection,
    third_party_excluded: thirdPartyExcluded,
    next_actions: nextActions,
  };
}

// ---------------- Scoped CLI Adapter for Career Write & Pre-Submit Commands (T11.5) ----------------

function parseScopedCareerFlags(argv, { booleans = [], values = [] } = {}) {
  const boolSet = new Set(['--json', '--help', '-h', ...booleans]);
  const valSet = new Set(values);
  const out = { json: false, help: false };
  const toCamel = flag => flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (boolSet.has(a)) {
      out[toCamel(a)] = true;
      continue;
    }
    const eqIdx = a.indexOf('=');
    if (eqIdx > 0) {
      const k = a.slice(0, eqIdx);
      const v = a.slice(eqIdx + 1);
      if (valSet.has(k)) {
        out[toCamel(k)] = v;
        continue;
      }
      throw new Error(`Unknown option "${k}" for career command. Run with --help for usage.`);
    }
    if (valSet.has(a)) {
      const next = argv[++i];
      if (next === undefined) {
        throw new Error(`Option "${a}" requires a value.`);
      }
      out[toCamel(a)] = next;
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`Unknown option "${a}" for career command. Run with --help for usage.`);
    }
    throw new Error(`Unexpected positional argument "${a}". Pass named flags instead (run with --help).`);
  }
  return out;
}

function parseOptionalNumberFlag(raw, name) {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) throw new Error(`${name} must be a valid finite number.`);
  return num;
}

function parseOptionalIntFlag(raw, name) {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num)) throw new Error(`${name} must be an integer.`);
  return num;
}

function parseCsvFlag(raw) {
  if (raw === undefined) return undefined;
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

export function formatCareerWriteHelp(sub = null) {
  const lines = [
    'Usage: veycraft career <subcommand> [options]',
    '',
    'Deterministic Ledger Lifecycle, Workflow Orchestrator & CV Registry Subcommands (local-only; zero external writes):',
    '  record --job-id <id> [--status <discovered|prepared|dry_run|skipped|needs_review|failed|aborted>] [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--match-score <0-10>] [--notes <txt>] [--json]',
    '  reserve --job-id <id> [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--notes <txt>] [--json]',
    '  confirm-submit --job-id <id> --receipt "<quote>" [--applied-at <iso>] [--url <u>] [--screenshot <path>] [--cv-version-id <id>] [--json]',
    '  transition --job-id <id> --to <interview|assessment|offer|rejected|withdrawn> [--source <src>] [--at <iso>] [--notes <txt>] [--stage <iv_stage>] [--round <n>] [--scheduled-at <iso>] [--assessment-type <type>] [--due-at <iso>] [--follow-up-status <st>] [--json]',
    '  skip --job-id <id> --reason <ghost_or_expired|mismatch|dealbreaker|blacklisted_employer|duplicate_cross_channel|below_min_match_score> --skip-reason "<text<=160>" [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--match-score <0-10>] [--json]',
    '  cv-register --id <cv_id> --label "<label>" --kind <generic|tailored> --file <workspace_rel_path> [--version-number <n>] [--base-id <id>] [--persona <id>] [--lang <code>] [--target-role <role>] [--link-job-id <job_id>] [--ats-before <pct>] [--ats-after <pct>] [--json]',
    '  run-start [--run-id <YYYY-MM-DD>] [--workflow-mode <batch_review_first|direct_auto>] [--platforms <csv>] [--notes <txt>] [--json]',
    '  run-triage --job-id <id> --company <c> --title <t> --match-score <0-10> [--platform <p>] [--url <u>] [--matched-skills <csv>] [--missing-skills <csv>] [--dealbreaker <reason>] [--ghost] [--run-id <YYYY-MM-DD>] [--notes <txt>] [--json]',
    '  run-enqueue --job-ids <csv> [--batch-selection "<label>"] [--run-id <YYYY-MM-DD>] [--json]',
    '  prepare --job-id <id> [--folder <workspace_rel_dir>] [--cv-version-id <id>] [--base-cv-version-id <id>] [--persona <id>] [--lang <code>] [--ats-before <pct>] [--ats-after <pct>] [--require-ready] [--json]',
    '  run-checkpoint [--run-id <YYYY-MM-DD>] [--phase <phase>] [--next-action "<txt>"] [--awaiting-job-id <id> --awaiting-question "<q>"] [--clear-awaiting-job-id <id>] [--consecutive-errors <n>] [--notes <txt>] [--json]',
    '  run-resume [--run-id <YYYY-MM-DD>] [--json]',
    '  run-finish [--run-id <YYYY-MM-DD>] [--status <completed|aborted>] [--error "<reason>"] [--notes <txt>] [--json]',
    '  next [--job-id <id>] [--persona <id>] [--lang <code>] [--json]',
    '  lock-status [--json]',
    '  release-stale-lock --nonce <nonce> --confirm-unlock [--json]',
    '  recover-tx --confirm-rollback [--json]',
  ];
  if (sub) return [`Help for \`veycraft career ${sub}\`:`, '', ...lines];
  return lines;
}

export function runCareerWriteCli(root, subcommand, argv = [], {
  home = os.homedir(),
  sourceRoot = null,
  nowIso = new Date().toISOString(),
} = {}) {
  const sub = String(subcommand || '').toLowerCase();

  if (sub === 'lock-status') {
    const flags = parseScopedCareerFlags(argv);
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const lock = inspectLedgerLock(root, { home, nowIso });
    const tx = inspectLedgerTransaction(root, { home });
    const data = { root, lock, transaction: tx };
    const lines = [
      `Ledger Lock:         ${lock.locked ? `LOCKED (pid=${lock.lock?.pid ?? 'corrupt'}, stale=${lock.stale}, owner_alive=${lock.owner_alive}, nonce=${lock.lock?.nonce ?? 'n/a'})` : 'unlocked'}`,
      `Pending Transaction: ${tx.pending ? `INCOMPLETE (tx_id=${tx.transaction?.tx_id ?? 'corrupt'}, stage=${tx.transaction?.stage ?? 'corrupt'})` : 'none (clean)'}`,
    ];
    return { json: flags.json, exitCode: 0, data, lines };
  }

  if (sub === 'release-stale-lock') {
    const flags = parseScopedCareerFlags(argv, { booleans: ['--confirm-unlock'], values: ['--nonce'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.nonce) {
      throw new Error('Usage: veycraft career release-stale-lock --nonce <nonce> --confirm-unlock [--json]');
    }
    const res = releaseStaleLedgerLock(root, {
      home,
      nowIso,
      expectedNonce: flags.nonce,
      confirmedExplicitRecovery: Boolean(flags.confirmUnlock),
    });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [`Released Stale Ledger Lock: ${res.path} (dead PID=${res.released_pid})`],
    };
  }

  if (sub === 'recover-tx') {
    const flags = parseScopedCareerFlags(argv, { booleans: ['--confirm-rollback'] });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = recoverIncompleteLedgerTransaction(root, {
      home,
      nowIso,
      confirmRollback: Boolean(flags.confirmRollback),
    });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [`Recovered Incomplete Transaction: ${res.tx_id} (${res.restored.map(r => `${r.rel_path}:${r.action}`).join(', ')})`],
    };
  }

  if (sub === 'record') {
    const flags = parseScopedCareerFlags(argv, {
      booleans: ['--third-party'],
      values: [
        '--job-id', '--status', '--company', '--title', '--platform', '--url',
        '--location', '--apply-type', '--source-channel', '--work-mode', '--employment-type',
        '--match-score', '--matched-skills', '--missing-skills', '--persona', '--notes', '--screenshot', '--run-id',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId) {
      throw new Error('Usage: veycraft career record --job-id <id> [--status <discovered|prepared|dry_run|skipped|needs_review|failed|aborted>] [options]');
    }
    const res = recordApplication(root, {
      job_id: flags.jobId,
      status: flags.status || 'discovered',
      company: flags.company,
      title: flags.title,
      platform: flags.platform,
      url: flags.url,
      location: flags.location,
      apply_type: flags.applyType,
      source_channel: flags.sourceChannel,
      work_mode: flags.workMode,
      employment_type: flags.employmentType,
      match_score: parseOptionalNumberFlag(flags.matchScore, '--match-score'),
      matched_skills: parseCsvFlag(flags.matchedSkills),
      missing_skills: parseCsvFlag(flags.missingSkills),
      persona_id: flags.persona,
      notes: flags.notes,
      screenshot: flags.screenshot,
      run_id: flags.runId,
      third_party_subject: Boolean(flags.thirdParty),
    }, { home, nowIso, sourceRoot });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [`Application ${res.action}: ${res.job_id} (${res.application_id}) -> status=${res.status}`],
    };
  }

  if (sub === 'reserve') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--job-id', '--company', '--title', '--platform', '--url', '--apply-type', '--notes'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId) {
      throw new Error('Usage: veycraft career reserve --job-id <id> [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--json]');
    }
    const res = reserveApplicationSubmission(root, {
      job_id: flags.jobId,
      company: flags.company,
      title: flags.title,
      platform: flags.platform,
      url: flags.url,
      apply_type: flags.applyType,
      notes: flags.notes,
    }, { home, nowIso, sourceRoot });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Reserved Submission: ${res.job_id} (${res.application_id}) -> status=needs_review, submission_uncertain=true`,
        `Pre-Submit Gate:     OK (${res.gate.checks.daily_cap.today_counted + 1}/${res.gate.checks.daily_cap.effective_cap} after reservation, dry_run=${res.gate.dry_run ? 'ON' : 'OFF'})`,
      ],
    };
  }

  if (sub === 'confirm-submit') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--job-id', '--receipt', '--applied-at', '--url', '--screenshot', '--cv-version-id'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId || flags.receipt === undefined) {
      throw new Error('Usage: veycraft career confirm-submit --job-id <id> --receipt "<quote>" [--applied-at <iso>] [--url <u>] [--json]');
    }
    const res = confirmApplicationSubmission(root, {
      job_id: flags.jobId,
      receipt: flags.receipt,
      applied_at: flags.appliedAt,
      url: flags.url,
      screenshot: flags.screenshot,
      cv_version_id: flags.cvVersionId,
    }, { home, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Confirmed Submission: ${res.job_id} (${res.application_id}) -> status=applied (applied_at=${res.applied_at})`,
        `Receipt Verified:     true`,
      ],
    };
  }

  if (sub === 'transition') {
    const flags = parseScopedCareerFlags(argv, {
      booleans: ['--verified', '--increment-follow-up'],
      values: [
        '--job-id', '--to', '--source', '--at', '--notes',
        '--stage', '--round', '--scheduled-at', '--timezone', '--interview-status', '--interview-outcome', '--interview-id', '--dossier-rel',
        '--assessment-type', '--received-at', '--due-at', '--submitted-at', '--assessment-status', '--assessment-outcome', '--assessment-id', '--blueprint-rel',
        '--follow-up-status', '--next-due-at', '--last-followed-up-at', '--follow-up-count', '--draft-rel',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId || !flags.to) {
      throw new Error('Usage: veycraft career transition --job-id <id> --to <interview|assessment|offer|rejected|withdrawn> [options]');
    }

    const hasInterview = Boolean(
      flags.stage || flags.round !== undefined || flags.scheduledAt || flags.interviewStatus || flags.interviewOutcome || flags.interviewId || flags.dossierRel,
    );
    const hasAssessment = Boolean(
      flags.assessmentType || flags.receivedAt || flags.dueAt || flags.submittedAt || flags.assessmentStatus || flags.assessmentOutcome || flags.assessmentId || flags.blueprintRel,
    );
    const hasFollowUp = Boolean(
      flags.followUpStatus || flags.nextDueAt || flags.lastFollowedUpAt || flags.followUpCount !== undefined || flags.draftRel || flags.incrementFollowUp,
    );

    const res = transitionApplicationStage(root, {
      job_id: flags.jobId,
      to_status: flags.to,
      source: flags.source || 'owner_manual_update',
      at: flags.at,
      notes: flags.notes,
      verified: Boolean(flags.verified),
      interview: hasInterview ? {
        interview_id: flags.interviewId,
        round: parseOptionalIntFlag(flags.round, '--round'),
        stage: flags.stage,
        scheduled_at: flags.scheduledAt ?? null,
        timezone: flags.timezone ?? null,
        status: flags.interviewStatus,
        outcome: flags.interviewOutcome,
        dossier_rel: flags.dossierRel ?? null,
        notes: flags.notes || '',
      } : null,
      assessment: hasAssessment ? {
        assessment_id: flags.assessmentId,
        type: flags.assessmentType,
        received_at: flags.receivedAt,
        due_at: flags.dueAt ?? null,
        submitted_at: flags.submittedAt ?? null,
        status: flags.assessmentStatus,
        outcome: flags.assessmentOutcome,
        blueprint_rel: flags.blueprintRel ?? null,
        notes: flags.notes || '',
      } : null,
      follow_up: hasFollowUp ? {
        status: flags.followUpStatus,
        next_due_at: flags.nextDueAt,
        last_followed_up_at: flags.lastFollowedUpAt,
        follow_up_count: parseOptionalIntFlag(flags.followUpCount, '--follow-up-count'),
        increment_count: Boolean(flags.incrementFollowUp),
        draft_rel: flags.draftRel,
      } : null,
    }, { home, nowIso });

    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [`Application ${res.action}: ${res.job_id} (${res.application_id}) ${res.from_status} -> ${res.to_status}`],
    };
  }

  if (sub === 'skip') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--job-id', '--reason', '--skip-reason', '--company', '--title', '--platform', '--url', '--match-score', '--matched-job-id', '--run-id'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId || !flags.reason || flags.skipReason === undefined) {
      throw new Error('Usage: veycraft career skip --job-id <id> --reason <reason> --skip-reason "<text<=160>" [options]');
    }
    const res = recordSkippedJob(root, {
      job_id: flags.jobId,
      reason: flags.reason,
      skip_reason: flags.skipReason,
      company: flags.company,
      title: flags.title,
      platform: flags.platform,
      url: flags.url,
      match_score: parseOptionalNumberFlag(flags.matchScore, '--match-score'),
      matched_job_id: flags.matchedJobId,
      run_id: flags.runId,
    }, { home, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [`Skipped Job ${res.action}: ${res.job_id} (reason=${res.reason})`],
    };
  }

  if (sub === 'cv-register') {
    const flags = parseScopedCareerFlags(argv, {
      values: [
        '--id', '--label', '--kind', '--file', '--version-number', '--base-id',
        '--persona', '--lang', '--target-role', '--target-job-id', '--link-job-id',
        '--emphasized-skills', '--true-gaps', '--ats-before', '--ats-after',
        '--hygiene-score', '--page-count', '--owner-scope',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.id || !flags.label || !flags.kind || !flags.file) {
      throw new Error('Usage: veycraft career cv-register --id <cv_id> --label "<label>" --kind <generic|tailored> --file <path> [options]');
    }
    const res = registerOwnerCvVersionForWorkspace(root, {
      cv_version_id: flags.id,
      label: flags.label,
      kind: flags.kind,
      file: flags.file,
      version_number: parseOptionalIntFlag(flags.versionNumber, '--version-number'),
      base_cv_version_id: flags.baseId ?? null,
      persona_id: flags.persona ?? null,
      language: flags.lang || 'en',
      target_role: flags.targetRole,
      target_job_id: flags.targetJobId,
      link_job_id: flags.linkJobId,
      emphasized_skills: parseCsvFlag(flags.emphasizedSkills),
      true_gaps_excluded: parseCsvFlag(flags.trueGaps),
      ats_keyword_before_pct: parseOptionalNumberFlag(flags.atsBefore, '--ats-before'),
      ats_keyword_after_pct: parseOptionalNumberFlag(flags.atsAfter, '--ats-after'),
      hygiene_score: parseOptionalNumberFlag(flags.hygieneScore, '--hygiene-score'),
      page_count: parseOptionalIntFlag(flags.pageCount, '--page-count'),
      owner_scope: flags.ownerScope,
    }, { home, nowIso });
    const lines = [
      `Registered CV Version: ${res.version.cv_version_id} (v${res.version.version_number} · ${res.version.kind})`,
      `Content SHA-256:       ${res.content_sha256}`,
      `Local Ref:             ${res.local_ref_rel}`,
      ...(res.linked_application_id ? [`Linked Application:    ${res.linked_job_id} (${res.linked_application_id})`] : []),
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  if (sub === 'run-start') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--run-id', '--workflow-mode', '--phase', '--platforms', '--next-action', '--notes'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = startOrUpdateDailyRun(root, {
      run_id: flags.runId,
      workflow_mode: flags.workflowMode,
      phase: flags.phase,
      platforms: parseCsvFlag(flags.platforms),
      next_action: flags.nextAction,
      notes: flags.notes,
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Daily Run ${res.action}: ${res.run_id} (status=${res.run.status}, phase=${res.checkpoint.phase}, dry_run=${res.run.dry_run})`,
        `Effective Cap:        ${res.checkpoint.caps.applied_today}/${res.checkpoint.caps.effective_daily_cap} (uncertain=${res.checkpoint.caps.reserved_unresolved})`,
      ],
    };
  }

  if (sub === 'run-triage') {
    const flags = parseScopedCareerFlags(argv, {
      booleans: ['--ghost', '--third-party'],
      values: [
        '--job-id', '--company', '--title', '--match-score', '--platform', '--url',
        '--location', '--apply-type', '--source-channel', '--work-mode', '--employment-type',
        '--matched-skills', '--missing-skills', '--dealbreaker', '--persona', '--run-id', '--notes',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId || !flags.company || !flags.title || flags.matchScore === undefined) {
      throw new Error('Usage: veycraft career run-triage --job-id <id> --company <c> --title <t> --match-score <0-10> [options]');
    }
    const res = triageJobForWorkflow(root, {
      job_id: flags.jobId,
      company: flags.company,
      title: flags.title,
      match_score: parseOptionalNumberFlag(flags.matchScore, '--match-score'),
      platform: flags.platform,
      url: flags.url,
      location: flags.location,
      apply_type: flags.applyType,
      source_channel: flags.sourceChannel,
      work_mode: flags.workMode,
      employment_type: flags.employmentType,
      matched_skills: parseCsvFlag(flags.matchedSkills),
      missing_skills: parseCsvFlag(flags.missingSkills),
      dealbreaker: flags.dealbreaker,
      ghost_or_expired: Boolean(flags.ghost),
      persona_id: flags.persona,
      run_id: flags.runId,
      notes: flags.notes,
      third_party_subject: Boolean(flags.thirdParty),
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Triage Verdict:       ${res.job_id} -> Tier ${res.tier} (${res.disposition}, status=${res.status}, score=${res.match_score}/10)`,
        `Queue Eligible:       ${res.eligible_for_queue} | Tailoring Needed: ${res.tailoring_needed}`,
      ],
    };
  }

  if (sub === 'run-enqueue') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--job-ids', '--batch-selection', '--run-id', '--notes'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const jobIds = parseCsvFlag(flags.jobIds);
    if (!jobIds || jobIds.length === 0) {
      throw new Error('Usage: veycraft career run-enqueue --job-ids <id1,id2,...> [--batch-selection "<label>"] [--run-id <YYYY-MM-DD>] [--json]');
    }
    const res = enqueueSelectedRunJobs(root, {
      job_ids: jobIds,
      batch_selection: flags.batchSelection,
      run_id: flags.runId,
      notes: flags.notes,
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Enqueued Jobs (${res.enqueued_job_ids.length}):    ${res.queue.join(', ')}`,
        `Approval Boundary:    submission_authorized=false (prep/fill only; explicit per-job APPROVE required before submit)`,
      ],
    };
  }

  if (sub === 'prepare') {
    const flags = parseScopedCareerFlags(argv, {
      booleans: ['--require-ready', '--allow-incomplete'],
      values: [
        '--job-id', '--folder', '--cv-version-id', '--base-cv-version-id',
        '--persona', '--lang', '--ats-before', '--ats-after',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    if (!flags.jobId) {
      throw new Error('Usage: veycraft career prepare --job-id <id> [--folder <workspace_rel_dir>] [--cv-version-id <id>] [--json]');
    }
    const res = prepareApplicationPackage(root, {
      job_id: flags.jobId,
      folder_rel: flags.folder,
      cv_version_id: flags.cvVersionId,
      base_cv_version_id: flags.baseCvVersionId,
      persona_id: flags.persona,
      language: flags.lang,
      ats_keyword_before_pct: parseOptionalNumberFlag(flags.atsBefore, '--ats-before'),
      ats_keyword_after_pct: parseOptionalNumberFlag(flags.atsAfter, '--ats-after'),
      require_ready: flags.allowIncomplete ? false : true,
    }, { home, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Application Prepared: ${res.job_id} (${res.application_id}) -> status=${res.status}, prepared=${res.prepared}`,
        `Package Folder:       ${res.folder_rel} (verified files: ${res.verified_files.join(', ') || 'none'})`,
        `Linked CV Version:    ${res.cv_version_id || 'none'} (submission_authorized=false)`,
      ],
    };
  }

  if (sub === 'run-checkpoint') {
    const flags = parseScopedCareerFlags(argv, {
      values: [
        '--run-id', '--phase', '--workflow-mode', '--queue', '--processed-job-ids',
        '--batch-selection', '--next-action', '--awaiting-job-id', '--awaiting-question',
        '--clear-awaiting-job-id', '--consecutive-errors', '--notes',
      ],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = writeSessionCheckpoint(root, {
      run_id: flags.runId,
      phase: flags.phase,
      workflow_mode: flags.workflowMode,
      queue: flags.queue !== undefined ? parseCsvFlag(flags.queue) : undefined,
      processed_job_ids: flags.processedJobIds !== undefined ? parseCsvFlag(flags.processedJobIds) : undefined,
      batch_selection: flags.batchSelection,
      next_action: flags.nextAction,
      awaiting_job_id: flags.awaitingJobId,
      awaiting_question: flags.awaitingQuestion,
      clear_awaiting_job_id: flags.clearAwaitingJobId,
      consecutive_errors: parseOptionalIntFlag(flags.consecutiveErrors, '--consecutive-errors'),
      notes: flags.notes,
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Session Checkpoint:   run_id=${res.run_id}, phase=${res.phase}, run_status=${res.run_status}, auto_aborted=${res.auto_aborted}`,
        `Queue Remaining:      ${res.checkpoint.queue.length} | Processed: ${res.checkpoint.processed_job_ids.length}`,
      ],
    };
  }

  if (sub === 'run-resume') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--run-id'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = resumeSessionCheckpoint(root, {
      run_id: flags.runId,
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Resumed Checkpoint:   run_id=${res.run_id}, phase=${res.phase}, reconciled=${res.discrepancies_reconciled}`,
        `Approval Boundary:    approval_expired_on_resume=true, submission_authorized=false`,
        `Queue Remaining:      ${res.checkpoint.queue.join(', ') || 'none'}`,
      ],
    };
  }

  if (sub === 'run-finish') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--run-id', '--status', '--error', '--notes'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = finishDailyRun(root, {
      run_id: flags.runId,
      status: flags.status || 'completed',
      error: flags.error,
      notes: flags.notes,
    }, { home, sourceRoot, nowIso });
    return {
      json: flags.json,
      exitCode: 0,
      data: res,
      lines: [
        `Finished Daily Run:   ${res.run_id} -> status=${res.status}, phase=${res.phase}`,
        `Ledger Counts:        scanned=${res.counts.scanned}, prepared=${res.counts.prepared}, applied=${res.counts.applied}, dry_run=${res.counts.dry_run}, needs_review=${res.counts.needs_review}, skipped=${res.counts.skipped}`,
      ],
    };
  }

  if (sub === 'next') {
    const flags = parseScopedCareerFlags(argv, {
      values: ['--job-id', '--persona', '--lang'],
    });
    if (flags.help) return { json: false, exitCode: 0, data: {}, lines: formatCareerWriteHelp(sub) };
    const res = computeCareerWorkflowQueue(root, {
      home,
      sourceRoot,
      nowIso,
      jobId: flags.jobId,
      personaId: flags.persona,
      language: flags.lang || 'en',
    });
    const lines = [
      `Cap Budget Today:     ${res.cap_budget.today_counted}/${res.cap_budget.effective_cap} (${res.cap_budget.remaining_today} remaining, warmup=${res.cap_budget.warmup_active}, dry_run=${res.cap_budget.dry_run})`,
      `Safety Blockers:      ${res.blockers.length}`,
      `Active Run:           ${res.active_run ? `${res.active_run.run_id} (phase=${res.active_run.phase}, queue=${res.active_run.queue.length}, in_sync=${res.active_run.checkpoint_in_sync})` : 'none'}`,
      `Preparation Queue:    ${res.preparation_queue.length} role(s) | Awaiting Owner: ${res.awaiting_owner.length}`,
      `Post-Apply Radar:     Overdue 7d Follow-Ups: ${res.post_application.overdue_follow_ups.length} | Active Interviews: ${res.post_application.active_interviews.length} | Active Assessments: ${res.post_application.active_assessments.length} | Silent >=14d: ${res.post_application.silent_14d_hygiene.length}`,
      ...(res.focused_cv_selection ? [`CV Recommendation:    selected=${res.focused_cv_selection.selected_cv_version_id || 'none'}, tailoring_recommended=${res.focused_cv_selection.tailoring_recommended} (${res.focused_cv_selection.tailoring_reason})`] : []),
      ...(res.next_actions.slice(0, 5).map((a, idx) => `Next [${idx + 1}] (${a.priority}): ${a.summary} -> \`${a.recommended_command}\``)),
    ];
    return { json: flags.json, exitCode: 0, data: res, lines };
  }

  throw new Error(`Unknown career write subcommand "${sub}". Supported: ${CAREER_WRITE_SUBCOMMANDS.join(', ')}.`);
}
