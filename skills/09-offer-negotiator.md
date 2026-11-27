---
name: offer-negotiator
version: "1.0.0"
description: Load when the owner receives a recruiter compensation question, B2B hourly/monthly rate check, or formal job offer; benchmarks terms against context/preferences.yaml and context/form-answers.yaml and drafts calm, humanized negotiation replies without auto-sending.
triggers:
  - recruiter asked my rate / salary expectation
  - received job offer
  - negotiate offer or compensation
requires_mcp:
  - none
preconditions:
  - recruiter message, rate prompt, or offer details supplied by the owner
  - verified compensation floor and work terms read from context/preferences.yaml or context/form-answers.yaml
requires_skills:
  - tailor-resume-and-verify
  - outreach-and-interview-prep
verification:
  - comparison table explicitly checks base pay, currency, period (hourly/monthly/annual), notice, and remote/visa terms against the owner's verified floor
  - drafted reply uses only verified experience/facts, contains 0 AI-slop clichés, and is marked DRAFT_ONLY
  - nothing was sent automatically without explicit owner approval
---
# Salary, B2B Rate & Offer Negotiator

## When to Use & Preconditions

Use whenever a recruiter asks for salary/rate expectations mid-process or sends a written/verbal offer. Helps the owner protect their floor and negotiate total compensation calmly—strictly draft-only.

- **Load when:** `recruiter asked my rate / salary expectation`; `received job offer`; `negotiate offer or compensation`.
- **Preconditions (stop if any is false):**
  - recruiter message, rate prompt, or offer details supplied by the owner
  - verified compensation floor and work terms read from `context/preferences.yaml` or `context/form-answers.yaml`
- **Requires skills:** `tailor-resume-and-verify`, `outreach-and-interview-prep`. **MCP:** none.

## Deterministic Step-by-Step Execution

0. **Zero-Config Dynamic Tech-Recruiter Compensation Engine (`salary_expectations.mode: dynamic_recruiter` — Default When Static Numbers Are Omitted):**
   When answering any ATS salary, hourly rate, or compensation prompt (during `skills/04-fill-and-apply.md` or recruiter outreach) without hardcoded numbers:
   - **Optional Override First:** If the owner explicitly configured a unit value in `salary_expectations.static_overrides` (e.g., `hourly_usd`) or an explicit `min_acceptable_floor`, respect it (never dip below `min_acceptable_floor`). Otherwise operate 100% zero-config dynamically:
   - **Step 1 — Detect Exact Field Unit & Input Type:** Inspect the live field label, placeholder, helper text, and DOM `type` (`hourly` vs `monthly` vs `annual`, currency `USD`/`EUR`/`GBP`/`EGP`, numeric-only `<input type="number">` vs free-text).
   - **Step 2 — Tier 1 (Posted Range in JD):** Position strategically inside the posted compensation band based on verified fit & seniority from `context/cv.md` (NEVER 0% bottom which signals desperation, NEVER >100% which triggers ATS auto-knockout):
     - **High fit / Seniority match (`8.5–10/10`):** **55%–70%** of the posted band.
     - **Solid core fit (`7.0–8.4/10`):** **35%–50%** of the posted band.
     - **Stretch role (`6.0–6.9/10`):** **20%–30%** of the posted band.
   - **Step 3 — Tier 2 (Unlisted Salary — Recruiter Market Calibration):** When no band is posted, calibrate across **4 signals**: (1) Company HQ market & tier (`US/UK/EU` vs `Global Async Remote` vs `GCC` vs `Local/MENA`), (2) Company size, stage & funding (perform a quick read-only lookup if unknown), (3) Role level vs. candidate's real verified years and shipped leverage in `context/cv.md`, and (4) Employment model (`FTE` vs. `Independent Contractor / B2B`, applying ~`15–25%` contractor premium for self-funded benefits/taxes). Output a realistic, competitive, cleanly rounded market figure (e.g., `55`, `3500`, `48000` — never awkward decimals).
   - **Step 4 — Field Formatting & Transparency:** Enter **pure numeric digits only** in numeric fields (never `$`, commas, or `/hr`; in free-text fields, concise `"Negotiable"` or rounded range only when appropriate). Include a crisp 1-line **Recruiter Rationale** on every reviewed/submitted job card explaining *why* that figure was chosen (company tier + seniority + fit `%` + unit).

1. **Audit the offer / inquiry against verified owner terms:**
   - Extract from the recruiter's message: base salary or B2B rate, currency, gross vs net, payment cadence (`hourly` / `monthly` / `annual`), equity/bonus, PTO, contract type (full-time vs contractor), location/timezone, and visa support.
   - Compare side-by-side in chat against the owner's verified minimum in `context/preferences.yaml` / `context/form-answers.yaml` / active persona (`skills/07-persona-switcher.md`). Flag any missing terms (e.g., undisclosed currency, gross vs net, unpaid trial, or missing sponsorship).
2. **Never invent competing offers or fake metrics:**
   - If anchoring a counter-offer or target range, base the rationale strictly on:
     - Verified years of experience and relevant shipped systems from `context/profile.md`
     - Role scope and market terms provided by the owner (never fabricate `"I have another offer for $X"` unless the owner explicitly provides that verified fact).
3. **Draft 2–3 concise, humanized reply options (`DRAFT_ONLY`):**
   - **Option A — Anchor / Counter:** Calm, collaborative counter-proposal citing role scope + verified relevant work.
   - **Option B — Clarify Terms First:** Defer exact numbers until scope, level, benefits, or contract structure are clarified.
   - **Option C — Accept / Proceed:** Clear written confirmation of agreed numbers and start date (`earliest_start_date` / `notice_period`).
   - Run every draft through the Anti-AI Slop filter (`skills/03-tailor-resume-and-verify.md`: zero clichés, zero em-dashes, concise plain tone).
4. **Save & wait for owner decision:**
   - Save the comparison and selected draft to `logs/resumes/<company>-<role>-<job-id>/negotiation-notes.md` (if a job folder exists) marked `DRAFT_ONLY`.
   - Never send any email or LinkedIn reply automatically; wait for the owner to edit, approve, or send manually.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Inventing a competing offer or inflating current salary to gain leverage → ✅ use only verified facts and role-scope rationale.
- ❌ Accepting or rejecting an offer on the owner's behalf → ✅ always present comparison + `DRAFT_ONLY` options and wait.
- ❌ Comparing monthly net vs annual gross without normalizing currency and period → ✅ always state exact currency, gross/net, and period.

### Self-verification check (before reporting this step complete)
- [ ] comparison table explicitly checks base pay, currency, period (hourly/monthly/annual), notice, and remote/visa terms against the owner's verified floor
- [ ] drafted reply uses only verified experience/facts, contains 0 AI-slop clichés, and is marked `DRAFT_ONLY`
- [ ] nothing was sent automatically without explicit owner approval
