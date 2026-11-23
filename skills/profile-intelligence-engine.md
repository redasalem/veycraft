---
name: profile-intelligence-engine
version: "1.2.0"
description: Load when optimizing, auditing, syncing, or updating a professional profile across LinkedIn, job boards, ATS portals, or portfolios (/profile-update); normalizes profile data, drafts an evidence-grounded Profile Update Plan, maps fields via platform adapters, and supports batch fill with fresh read-back verification.
triggers:
  - /profile-update
  - optimize my professional profile
  - update my profile for this job
  - sync my career profile across platforms
  - update my job board profiles
  - fill profile fields from my CV
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - verified candidate facts available in context/ (or user-confirmed session CV)
  - target role, job description, or general positioning goal supplied
  - platform access is legitimate and supported for any live read or write
requires_skills:
  - resume-ingestion
  - tailor-resume-and-verify
  - recruiter-brand-and-domain-intelligence
  - meta-self-verification
verification:
  - every proposed claim traces to verified candidate evidence or is flagged needs_user_confirmation
  - plan validated against schemas/profile-update-plan.schema.json via node ./bin/cli.mjs verify
  - existing profile content preserved (add/replace actions only; zero remove actions)
  - fresh read-back verification confirms saved state before reporting verified
---
# Profile Intelligence Engine

Shared, platform-agnostic intelligence layer for optimizing, updating, and verifying professional profiles across LinkedIn, job boards, ATS forms, and portfolios. Orchestrates existing playbooks (`skills/linkedin-growth.md`, `skills/01-resume-ingestion.md`, `skills/03-tailor-resume-and-verify.md`, `skills/04-fill-and-apply.md`, `skills/28-recruiter-brand-and-domain-intelligence.md`, `skills/18-condition-based-browser-waiting.md`, `skills/19-on-demand-mcp-routing.md`, `skills/24-circuit-breaker-and-antiban.md`, `skills/25-prompt-injection-defense.md`, `skills/meta-dom-recovery.md`, `skills/meta-self-verification.md`) without replacing or weakening them.

## When to Use & Preconditions

- **Load when:** `/profile-update`, `"Optimize my professional profile"`, `"Update my profile for this job"`, `"Sync my career profile across platforms"`, `"Tailor my profile for a target role"`, `"Review my professional profile"`, `"Update my job board profiles"`, or alongside `/linkedin-growth` when multi-section updates or plan artifacts are helpful.
- **Preconditions:**
  - Verified CV/profile facts loaded from `context/` (`resume-facts.json`, `resume-data.json`, `cv.md`, `profile.md`) or confirmed in the active session (do NOT force `/setup` for standalone profile optimization).
  - Target role, JD, or career positioning goal specified.
  - Legitimate authorized session for any live browser action (never equate Playwright availability with permission).

### Hard Invariants
- **Never delete existing profile content** as part of optimization. Use only `add` or `replace` actions (`schemas/profile-update-plan.schema.json` intentionally omits `remove`).
- **Never invent employers, dates, titles, metrics**, credentials, skills, links, or achievements. Separate `verified_facts`, `user_confirmed_facts`, `inferred_info` (`requires_confirmation: true`), and `missing_info` (`schemas/resume-data.schema.json`). Never convert an inference into a verified fact without user confirmation.
- **Default to preview/draft** (`mode: "draft_only"`). Apply live writes only through an authorized platform method after explicit approval of the reviewed field changes (`APPROVE`).
- **Do not bypass authentication, CAPTCHA, MFA, rate limits**, account warnings, or platform restrictions (`skills/24-circuit-breaker-and-antiban.md`). Stop and report immediately on any challenge.
- Preserve original source CVs (`context/cv.md` / uploaded files) and keep private profile vaults strictly inside local `context/` (never in repo fixtures, examples, or commits).

## Deterministic Step-by-Step Execution

1. **Load Local Profile Vault Once:**
   - Read compact verified facts first (`context/resume-facts.json` or `context/resume-data.json` + `context/cv.md` / `context/profile.md` if needed) without re-asking already confirmed details.
2. **Select Platform Adapter & Inspect Safely:**
   - Resolve the target adapter via `bin/profile-intelligence.mjs` (`linkedin`, `wellfound`, `ats`, `job_boards`, `portfolio`, or conservative `generic` fallback).
   - Check declared capabilities (`read`, `draft`, `fill`, `save`, `verify`), `supported_sections`, `required_permissions`, and `limitations`. Unknown platforms default to read/draft preview only and never assume fill or save support.
   - Inspect only relevant sections through an authorized path (pasted text, PDF export, screenshot, or signed-in browser session using targeted extraction rather than dumping entire pages).
   - **GitHub Repository & `gh` CLI Delegation:** While Profile Intelligence Engine handles additive (`add`/`replace`) profile field drafting across platforms including GitHub (`portfolio` adapter), full-account `gh` CLI repository audits, repo metadata/README marketing mutations, tiered repository cleanup (`private`/`archive`/gated `delete`), and `context/github-projects.md` project extraction delegate to `skills/11-portfolio-and-github-auditor.md`.
3. **Evaluate Across 7 Domain-Adaptive Optimization Criteria (`skills/28` Lenses):**
   - First infer the target **Domain Archetype** and extract the **Buyer Pain Point** + mandatory credentials via `skills/28-recruiter-brand-and-domain-intelligence.md` (Steps 1–4), then score and diagnose fields using concrete HR & Recruiter-SEO heuristics:
     - **Relevance:** Prioritize verified experience and credentials solving the buyer pain point; separate true knock-outs from wishlist items.
     - **Keyword coverage:** Align canonical **Experience titles**, **Recruiter Boolean** keywords (`(Title A OR B) AND (Core Skill 1 OR 2)`), spelling/casing, and Experience-linked skill tagging within platform caps (natural, zero stuffing).
     - **Clarity:** Enforce 6–10s scanability above the fold (`<= 220` chars Headline/About hook) in domain-authentic peer tone.
     - **Impact:** Rank claims by Proof Density Hierarchy (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact > Credential`), zero fabricated metrics.
     - **Consistency:** Eliminate cross-platform CV/LinkedIn/board date, title, and credential contradictions while preserving honest risk-framing labels without hiding dates.
     - **Discoverability:** Surface domain authority sections (`Licenses & Certifications`, `Publications`, `Services`, `Featured`, `Projects`) and `Open to Work (Recruiters only)` cues where supported.
     - **Quality:** Remove redundancy, passive duty filler, and AI-slop clichés while keeping `add` / `replace`-only plan actions.
   - **PDF-Import OCR & Date-Conflict Guard:** On job boards that auto-import CVs (e.g., Wellfound), scan for OCR typos (`Al -> AI`, `Ul -> UI`), duplicate employer/education entries, and unverified template skills. Never silently delete entries or alter conflicting dates across CV, LinkedIn, and job boards—flag them with `requires_confirmation: true` first.
   - When a target JD is supplied: extract requirements/keywords via `skills/28` Step 2, compare against verified vault facts, list strengths/gaps/mismatches, prioritize high-impact fields, tailor without inventing qualifications, and explain material edits concisely.
4. **Build & Validate the Profile Update Plan:**
   - Generate one comprehensive plan conforming to `schemas/profile-update-plan.schema.json` and save it to `logs/insights/profile-update-plan-<platform>-YYYY-MM-DD.json`.
   - Skip unchanged fields (record them in `skipped_unchanged` rather than emitting redundant edits).
   - Use `add` for empty fields and `replace` for improvements; mark uncertain items `fact_basis: "inferred"` with `requires_confirmation: true` and `status: "needs_user_confirmation"`.
   - Run `node ./bin/cli.mjs verify <plan.json> [--facts <facts>]` to enforce schema rules, zero AI-slop clichés/em-dashes, and zero unverified claims.
5. **Present One Consolidated Review (`DRAFT_ONLY` Default):**
   - Display a single field-level diff table showing `Section`, `Field`, `Before`, `After`, `Reason`, `Evidence`, `Confidence`, `Requires Confirmation`, and `Status`.
   - Support **Approve all**, **Reject all**, or **individual approve/reject** decisions, plus explicit confirmation prompts for any flagged `missing_facts` or `needs_user_confirmation` items.
6. **Execute Approved Edits Efficiently:**
   - Only when authorized (`mode: "approved_apply"`) and supported by the adapter:
     - Reuse the active authorized browser session (no redundant logins or reloads).
     - Map controls semantically (`Role -> Label -> Placeholder -> Text`, using `skills/meta-dom-recovery.md` for modals/iframes); ambiguous mappings remain `needs_review`.
     - **Batch-fill** unambiguous fields in one pass per form/section (`0.3-1 s` between inputs), using `skills/18-condition-based-browser-waiting.md` instead of blind sleeps and keeping `3-9 s` pacing between page navigations/saves.
     - Route routine rewriting/mapping to fast models and escalate conflicts/ambiguity per `skills/19-on-demand-mcp-routing.md`.
     - Treat saving, posting, messaging, and submitting as separate consequential actions governed by existing approval gates.
7. **Verify with Fresh Read-Back & Report Truthfully:**
   - Re-read every affected field from a fresh `browser_snapshot` after saving (`skills/meta-self-verification.md`).
   - Compare actual persisted values against the approved plan and report honest outcomes only (`prepared`, `approved`, `applied`, `verified`, `partially_applied`, `blocked`, `not_verified`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** treat browser tool availability as platform authorization or overwrite existing fields without reviewing a consolidated diff and obtaining required approval.
- **NEVER** implement or run a destructive `remove` action or promote `inferred_info` into `verified_facts` silently.
- **NEVER** guess ambiguous semantic field mappings, bypass CAPTCHA/MFA/rate limits, or claim `verified` without fresh post-save read-back evidence.
- **Self-Verification Check:**
  - [ ] Plan saved and verified via `node ./bin/cli.mjs verify <plan.json>` against `schemas/profile-update-plan.schema.json`
  - [ ] Inferences isolated with `requires_confirmation: true`; zero fabricated metrics, dates, titles, or skills
  - [ ] Unchanged fields skipped cleanly; consolidated field-level diff reviewed before any live write
  - [ ] Every reported `verified` item has fresh post-save read-back `verification_evidence`
