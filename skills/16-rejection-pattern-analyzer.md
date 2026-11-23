---
name: rejection-pattern-analyzer
version: "1.0.0"
description: Load when the owner asks why applications are getting rejected or ghosted, requests a rejection pattern analysis, or wants to audit logs/applications-log.json and logs/skipped-jobs.json (>= 14 days silent or rejected) to surface skill gaps, ATS channel bottlenecks, and concrete context/preferences.yaml targeting updates.
triggers:
  - analyze rejection patterns
  - why am I getting rejected or ghosted
  - audit rejected and stale applications
  - optimize targeting from logs
requires_mcp:
  - none
preconditions:
  - logs/applications-log.json exists and contains at least 5 real submitted (applied/interview/rejected/offer) records
  - context/preferences.yaml and context/cv.md are readable for comparison against observed gaps
requires_skills:
  - log-and-insights
  - follow-up-radar
  - persona-switcher
verification:
  - dry_run and skipped rows were excluded from submission yield denominators
  - silent applications >= 14 days old are flagged with causal humility (no fabricated ATS bias claims or insufficient-sample percentages)
  - every proposed context/preferences.yaml targeting or skill-gap adjustment traces directly to observed logs and waits for explicit owner approval before editing config
---
# Rejection Pattern Analyzer (Adapted from `career-ops` `patterns`)

## When to Use & Preconditions

Diagnoses recurring rejection and silence blockers across local application logs without token bloat or guesswork, turning real outcomes into sharper role targeting and CV framing.

- **Load when:** `analyze rejection patterns`; `why am I getting rejected or ghosted`; `audit rejected and stale applications`; `optimize targeting from logs`.
- **Preconditions (stop if any is false):**
  - `logs/applications-log.json` exists and contains at least **5** real submitted entries (`applied`, `interview`, `assessment`, `offer`, `rejected`). Stop honestly and report `N/5` submitted entries if fewer exist.
  - `context/preferences.yaml` and `context/cv.md` are readable.
- **Requires skills:** `log-and-insights`, `follow-up-radar`, `persona-switcher`. **MCP:** none (pure local file analysis).

## Deterministic Step-by-Step Execution

1. **Hygiene Check & Minimum Sample Gate (`MIN_N = 5`):**
   - Read `logs/applications-log.json` and `logs/skipped-jobs.json` directly using IDE file tools (or run `veycraft career summary --json` and `veycraft career analytics --json`; do not invoke Playwright or Notion MCP).
   - Partition entries: exclude `dry_run`, `skipped`, and `aborted` rows (as well as isolated third-party subjects) from **submitted yield** denominators.
   - Flag any `applied` entry older than **14 days** with zero logged status transition as `silent_14d`—never classify `silent_14d` as a confirmed `rejected` outcome—and prompt the owner to confirm whether any unlogged email/reply arrived before updating status.
2. **Blocker & Gap Clustering:**
   - Read `reason` / `notes` / matching `interview-dossier.md` gaps across `rejected`, `silent_14d`, and high-volume `skipped` entries.
   - Bucket blockers cleanly: `geo_visa_mismatch`, `tech_stack_gap`, `seniority_level_mismatch`, `onsite_or_timezone_conflict`, `compensation_gap`, and `stale_or_ghost_posting`.
3. **Channel & ATS Yield Lens (Causal Humility Required):**
   - Group submitted rows by `platform` and detected ATS host (`greenhouse`, `lever`, `ashby`, `workday`, `smartrecruiters`, or `direct/easy_apply`).
   - Compute advance rate (`interview` / `assessment` / `offer` divided by submitted count) **only** when a bucket has `n >= 5`; label buckets with `n < 5` as `(n too small to conclude)`.
   - Frame low-yield channels factually (e.g., *"X of your last Y cold Greenhouse forms received no reply — consider prioritizing direct/referral or curated boards"*), never claiming algorithmic bias.
4. **Cross-Check CV Framing & Persona Alignment:**
   - Compare top winning traits (entries that reached `interview` or `offer`) against rejected roles and active track settings in `context/preferences.yaml` (`persona-switcher` if multiple personas exist).
5. **Propose Concrete Targeting Updates (Wait for Owner Confirmation):**
   - Present a crisp Markdown report: Sample Size, Funnel Snapshot, Top 3 Blockers, Channel Yield Table, and 2–3 exact proposed diffs to `context/preferences.yaml` (tightening `exclude_keywords`, raising `min_match_score`, or switching target seniority/persona).
   - Never mutate `context/preferences.yaml` until the owner explicitly confirms which changes to apply.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** count `dry_run` or `skipped` records in response/rejection rate denominators.
- **NEVER** turn 1–4 samples into sweeping statistical claims or accuse an ATS of discrimination.
- **NEVER** edit `context/preferences.yaml` or `context/targets.yaml` silently without showing the exact proposed rules first.
- **Self-Verification Check:** Verify exact counts match `logs/applications-log.json`, buckets below `n = 5` are marked `(n too small)`, silent rows `>= 14d` prompt a stale-log hygiene check, and no MCP tools were invoked unnecessarily.
