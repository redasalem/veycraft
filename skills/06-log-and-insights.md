---
name: log-and-insights
version: "3.0.0"
description: Load whenever tracking or updating applications in logs/applications-log.json, migrating to ledger v2, inspecting CV versions, running deterministic career analytics/dashboards (MIN_N = 5), exporting /weekly-report insights, or planning/approving/reconciling one-way Notion sync via logs/sync-state.json.
triggers:
  - track applications or update existing application record
  - write to logs/applications-log.json, logs/skipped-jobs.json, or logs/cv-versions.json
  - end of daily run summary or career analytics / dashboard
  - /weekly-report, export application report, or Notion sync preview / recovery
requires_mcp:
  - none
optional_mcp:
  - notion
preconditions:
  - exact observed disposition and receipt (for applied) recorded
  - config/guardrails.yaml storage_adapters.notion_mcp and dry_run checked before any live Notion sync action
requires_skills:
  - meta-self-verification
verification:
  - logs/applications-log.json has unique job_id / application_id entries, preserved stage_history, and applied_at set only when a receipt was observed
  - logs/runs/YYYY-MM-DD.json counts match actual journal dispositions (dry_run counted separately from applied) and third-party CVs stay isolated from owner analytics and Notion sync
  - Notion sync (if enabled and dry_run is false) used one-way allowlisted plan + explicit owner approval (--confirm-approve + --plan-hash) + mark-in-flight + apply-receipt into logs/sync-state.json without writing sync state back to logs/applications-log.json
---
# Local Career Ledger, Analytics & One-Way Notion Sync

## When to Use & Preconditions

Local JSON files under `logs/` are the authoritative source of truth (`logs/applications-log.json`, `logs/skipped-jobs.json`, `logs/runs/YYYY-MM-DD.json`, `logs/cv-versions.json`, `logs/insights/`). Optional Notion sync is strictly **one-way (local -> Notion)**, governed by `logs/sync-state.json` and `bin/notion-sync.mjs`, and disabled by default (`storage_adapters.notion_mcp: false`, `dry_run: true`).

- **Load when:** tracking or updating applications; migrating v1 logs to v2; viewing CV versions, summaries, or dashboards; generating `/weekly-report` analytics; planning, approving, or recovering one-way Notion sync.
- **Preconditions (stop if any is false):**
  - exact observed disposition and receipt (for `applied`) or owner-supplied status update recorded
  - current `config/guardrails.yaml` checked (`storage_adapters.notion_mcp` and `dry_run`) before any live Notion sync operation
- **Requires skills:** `meta-self-verification`. **MCP:** none (`notion` optional for external writes after explicit owner approval).

## Deterministic Step-by-Step Execution

### 1. Maintain `logs/applications-log.json` & `logs/cv-versions.json` (Deterministic Write CLI)
Always prefer the lock-protected, schema-validated `veycraft career` write CLI (backed by `logs/.ledger.lock` and `writeAtomic`) over hand-editing operational JSON files:
- **Canonical identity (v2):** Each record maps deterministically to `application_id = app_<12hex>` derived from `job_id` plus `canonical_fingerprint`. Upgrade legacy v1 logs safely with backup-first idempotent migration: `veycraft career migrate` (`--dry-run` default; pass `--apply` after reviewing the preview).
- **Record non-submitted states:** `veycraft career record --job-id <id> --status <discovered|prepared|dry_run|skipped|needs_review|failed|aborted> [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--match-score <0-10>] [--notes <txt>] [--json]` (refuses to downgrade an already-submitted or reserved application).
- **Pre-submit reservation & receipt confirmation:** Before clicking live Submit, run `veycraft career reserve --job-id <id> [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--json]` (enforces `evaluatePreSubmitGate` inside `logs/.ledger.lock` and sets `status: "needs_review"`, `submission_uncertain: true`, `applied_at: null`). Only after `skills/meta-self-verification.md` captures a fresh browser confirmation quote, run `veycraft career confirm-submit --job-id <id> --receipt "<quote>" [--url <u>] [--json]` (sets `status: "applied"`, `applied_at`, `submission_uncertain: false`, `provenance.receipt_verified: true`, and refuses duplicate overwrite).
- **Outcome transitions & follow-ups:** `veycraft career transition --job-id <id> --to <interview|assessment|offer|rejected|withdrawn|applied> [--source <src>] [--stage <iv_stage>] [--round <n>] [--assessment-type <type>] [--follow-up-status <st>] [--notes <txt>] [--json]` appends chronological `stage_history[]` events and structured interview/assessment/follow-up metadata while preserving original `applied_at` and receipt quotes immutably (`--to applied` is allowed only for follow-up updates on an already-`applied` record).
- **CV versions & third-party isolation:** Register owner CVs via `veycraft career cv-register --id <cv_id> --label "<label>" --kind <generic|tailored> --file <workspace_rel_path> [--link-job-id <job_id>] [--ats-before <pct>] [--ats-after <pct>] [--json]` (computes file SHA-256, rejects symlinks/traversal/third-party paths `logs/resumes/cv-<slug>/`, and uses a journaled compensating-rollback transaction `logs/.ledger-tx.json` when linking to an application—detectable via `veycraft career lock-status` and recoverable via `veycraft career recover-tx --confirm-rollback`; note this provides crash detection and compensating rollback rather than kernel multi-file ACID). List owner versions via `veycraft career cv-versions [--json]`. Third-party CVs (`owner_scope: "third_party"` or `provenance.third_party_subject: true`) stay strictly excluded from owner caps, analytics, status, and Notion sync.

### 2. Maintain `logs/skipped-jobs.json`, `logs/runs/YYYY-MM-DD.json` & Workflow Orchestration
- **Tier C, Ghost & Blocked jobs (`logs/skipped-jobs.json`):** Record deterministically with `veycraft career skip --job-id <id> --reason <ghost_or_expired|mismatch|dealbreaker|blacklisted_employer|duplicate_cross_channel|below_min_match_score> --skip-reason "<text<=160>" [--company <c>] [--title <t>] [--platform <p>] [--url <u>] [--json]` (or `veycraft career run-triage`, which classifies Tier A/B/C and atomically records Tier C skips across both `logs/skipped-jobs.json` and `logs/applications-log.json`).
- **Daily Run & Session Checkpoint Lifecycle (`logs/runs/YYYY-MM-DD.json` & `logs/runs/current-session-checkpoint.json`):** Use the deterministic lock-protected run commands so `counts` (`scanned`, `prepared`, `applied`, `dry_run`, `needs_review`, `skipped`, `failed`) and `caps` are always derived from `logs/applications-log.json` and `logs/skipped-jobs.json` (counting `dry_run` separately from `applied`, and auto-aborting on `consecutive_errors >= 3`):
  - `veycraft career run-start [--run-id <YYYY-MM-DD>] [--workflow-mode <batch_review_first|direct_auto>] [--platforms <csv>] [--notes <txt>] [--json]`
  - `veycraft career run-triage --job-id <id> --company <c> --title <t> --match-score <0-10> [--platform <p>] [--url <u>] [--matched-skills <csv>] [--missing-skills <csv>] [--dealbreaker <reason>] [--ghost] [--run-id <YYYY-MM-DD>] [--json]`
  - `veycraft career run-enqueue --job-ids <csv> [--batch-selection "<label>"] [--run-id <YYYY-MM-DD>] [--json]` (enqueues eligible Tier A/B roles with `submission_authorized: false`)
  - `veycraft career prepare --job-id <id> [--folder <workspace_rel_dir>] [--cv-version-id <id>] [--base-cv-version-id <id>] [--persona <id>] [--lang <code>] [--ats-before <pct>] [--ats-after <pct>] [--json]` (verifies deliverables in `logs/resumes/<folder>/`, selects/links owner `cv_version_id` & `cv_tailoring`, and transitions to `status: "prepared"`)
  - `veycraft career run-checkpoint [--run-id <YYYY-MM-DD>] [--phase <phase>] [--next-action "<txt>"] [--awaiting-job-id <id> --awaiting-question "<q>"] [--clear-awaiting-job-id <id>] [--consecutive-errors <n>] [--json]`
  - `veycraft career run-resume [--run-id <YYYY-MM-DD>] [--json]` (reconciles checkpoint queue/counts against the authoritative ledger and sets `approval_expired_on_resume: true`, `submission_authorized: false`)
  - `veycraft career run-finish [--run-id <YYYY-MM-DD>] [--status <completed|aborted>] [--error "<reason>"] [--notes <txt>] [--json]` (refuses `completed` while any `submission_uncertain: true` reservation remains unresolved)
  - `veycraft career next [--job-id <id>] [--persona <id>] [--lang <code>] [--json]` (read-only prioritized workflow queue surfacing `P0_BLOCKER` locks/transactions/circuit-breakers/uncertain reservations, `P1_ACTIVE_RUN` / `P2_PREPARATION` roles with owner CV recommendations, and `P3_POST_APPLY` 7-day overdue follow-ups, active interviews/assessments, and `>= 14d` silent hygiene checks)
- **Lock & crash recovery diagnostics:** Inspect `logs/.ledger.lock` and pending `logs/.ledger-tx.json` with `veycraft career lock-status [--json]`; recover a proven dead-PID stale lock only via `veycraft career release-stale-lock --nonce <nonce> --confirm-unlock [--json]`.

### 3. Deterministic Career Analytics, Dashboard & `/weekly-report`
Use the local zero-dependency CLI (`bin/cli.mjs` -> `bin/career-intelligence.mjs`) before drafting narrative reports:
- `veycraft career summary [--json]` — Submitted funnel, active rounds, overdue follow-ups, and sync summary (reads `logs/sync-state.json` first; falls back to legacy fields only when `logs/sync-state.json` is absent).
- `veycraft career analytics [--period <all|YYYY-Www|YYYY-MM>] [--write] [--json]` — Deterministic funnel, score-band, CV-version, and source analytics (`--write` saves validated output to `logs/insights/`).
- `veycraft career dashboard [--no-open]` — Generates a local read-only Career Analytics & Kanban HTML dashboard (classic Kanban viewer: `veycraft dashboard [--global | -g] [--no-open]`).
- **Statistical honesty rules:** Enforce **`MIN_N = 5`** before reporting conversion rates or conclusions (label `< 5` buckets as insufficient sample). Never interpret `>= 14d` silence (`silent_14d`) as a confirmed rejection (`rejected`).
- **Report exports (`/weekly-report`):** Save period JSON to `logs/insights/<type>-<period>.json` and, when requested, Markdown (`logs/exports/applications-report-YYYY-MM-DD.md`) or CSV (`logs/exports/applications-report-YYYY-MM-DD.csv`). Validate outputs with `veycraft verify <path>` and re-read files (`skills/meta-self-verification.md`).

### 4. One-Way Approval-Gated Notion Sync (`veycraft career sync`)
Notion sync is strictly **one-way (local -> Notion)** across 3 allowlisted databases (`applications`, `daily_runs`, `insights`). `logs/sync-state.json` is the sole authoritative sync ledger—**never** write Notion page IDs or sync flags back into `logs/applications-log.json`, and **never** pull Notion edits back into local logs. All payloads pass a 2-layer fail-closed privacy filter (allowlisted fields only, PII/token/raw-resume/screenshot redaction, third-party & transitive CV ancestry exclusion).

**A. Offline, Read-Only & Recovery Commands** (work locally even when `storage_adapters.notion_mcp: false` or `dry_run: true`; zero external writes):
- `veycraft career sync preview [--file <remote-index.json>] [--out <plan.json>] [--plan-id <id>] [--json]` — Build deterministic offline diff plan + `plan_hash` (covers all `operations[]`, including `skip_unchanged`).
- `veycraft career sync status [--json]` — Inspect `logs/sync-state.json` statuses, lock health, retries, and uncertain/blocked records.
- `veycraft career sync verify-schema --database <applications|daily_runs|insights> --file <schema.json> [--json]` — Validate remote DB schema snapshot against the allowlisted contract before syncing.
- `veycraft career sync apply-receipt --database <db> --key <key> --op <op_id> --plan-hash <64hex> --file <receipt.json> [--database-id <uuid>] [--json]` — Verify operation-bound `mcp_evidence` + read-back fields and transition `in_flight -> synced` (structured evidence, **not** cryptographic proof).
- `veycraft career sync record-failure --database <db> --key <key> --op <op_id> --plan-hash <64hex> --error-code <code> [--error-message <msg>] [--mutation-not-applied] [--json]` — Deterministically classify failures: retryable errors record capped backoff (`failed_retryable`), ambiguous/timeout outcomes become `receipt_uncertain` (never blindly retry), and permanent errors become `failed_permanent`.
- `veycraft career sync expire-stale [--timeout-minutes <n>] [--json]` — Transition stale `in_flight` locks (default `15` min) to `receipt_uncertain`.
- `veycraft career sync reconcile --database <db> --key <key> --database-id <uuid> --file <snapshot.json> [--confirm-remote-deleted] [--json]` — 6-point complete-query snapshot reconciliation (incomplete pagination or cross-key page ID collisions fail closed and never authorize creates).
- `veycraft career sync reset-permanent --database <db> --key <key> --expected-error <err|null> --reason <text> --confirm-reset [--json]` — Explicit owner-confirmed reset of `failed_permanent` back to pending.
- `veycraft career sync release-stale-lock --nonce <nonce> --confirm-unlock [--json]` — Explicit dead-PID recovery for `logs/.sync-state.lock` (single-writer lock never auto-steals).

**B. Live-Guardrails-Gated Commands** (require current `config/guardrails.yaml` `storage_adapters.notion_mcp: true` AND `dry_run: false` at execution time; missing/malformed guardrails fail closed; previously saved plans never override the live kill-switch):
1. `veycraft career sync preview --live [--file <remote-index.json>] [--out <plan.json>] [--plan-id <id>] [--json]` — Generate a live-mode plan and show the owner the exact diff and `plan_hash`.
2. `veycraft career sync approve --file <plan.json> --plan-hash <64hex> --confirm-approve [--out <approved.json>] [--json]` — Bind explicit owner approval to the exact `plan_hash` (`24h` TTL).
3. `veycraft career sync mark-in-flight --file <approved.json> --op <operation_id> [--force] [--json]` — Acquire `logs/.sync-state.lock` and atomically reserve `in_flight` **before** invoking Notion MCP (`--force` bypasses ONLY `failed_retryable` cooldown/cap, never `receipt_uncertain` or `failed_permanent`).
4. Execute the single approved Notion MCP write, read back the page, and immediately run `apply-receipt` (or `record-failure` on error/ambiguity). Never claim Notion sync succeeded without verified `apply-receipt` state in `logs/sync-state.json`.
*(Note: global flag `--global` / `-g`, when targeting `~/.veycraft`, must precede `career sync`, e.g., `veycraft --global career sync status`.)*

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Appending a duplicate record for the same `job_id` or overwriting `applied_at` → ✅ upsert by `job_id` and append transitions to `stage_history` / `notes`.
- ❌ Counting `dry_run` jobs in `applied`, claiming rates on `< 5` samples, or labeling `>= 14d` silence as `rejected` → ✅ keep `dry_run` separate, enforce `MIN_N = 5`, and keep `silent_14d` distinct from confirmed rejections.
- ❌ Writing Notion sync status into `logs/applications-log.json`, invoking Notion MCP without `approve` + `mark-in-flight`, or blindly retrying after a timeout → ✅ keep `logs/sync-state.json` authoritative, respect the live guardrails kill-switch, and move ambiguous outcomes to `receipt_uncertain` + `reconcile`.
- ❌ Mixing third-party CVs into owner analytics or Notion payloads → ✅ isolate third-party subjects (`owner_scope: "third_party"`, `logs/resumes/cv-<slug>/`).

### Self-verification check (before reporting this step complete)
- [ ] `logs/applications-log.json` has unique `job_id` / `application_id` entries, preserved `stage_history`, and `applied_at` set only when a receipt was observed
- [ ] `logs/runs/YYYY-MM-DD.json` counts match actual journal dispositions (`dry_run` counted separately from `applied`) and `MIN_N = 5` / silence-not-rejection rules were respected
- [ ] Any Notion sync action honored current `config/guardrails.yaml`, explicit `--confirm-approve` + `--plan-hash`, pre-write `mark-in-flight`, and verified `apply-receipt` in `logs/sync-state.json` (never claiming sync without receipt evidence)
