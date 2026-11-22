---
name: mena-boards
version: "1.3.0"
last_verified: "2026-11-21"
description: Load when a target is Wuzzuf, Bayt, GulfTalent, or LinkedIn for MENA/GCC roles and signed-in auth checks, pagination, external ATS redirects, bilingual Arabic/English listings, or nationality/visa/notice/salary-currency rules must be handled safely.
triggers:
  - target.platform in wuzzuf/bayt/gulftalent
  - MENA or GCC region search
  - job URL on Wuzzuf, Bayt, or GulfTalent
requires_mcp:
  - playwright
preconditions:
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
requires_skills:
  - discover-and-triage
  - condition-based-browser-waiting
  - multilingual-adaptation
verification:
  - auth_check_url verified as signed-in or stopped cleanly on Sign In / Create Account gate
  - job card expanded, pagination verified via fresh browser_snapshot, and external ATS redirects routed safely
  - nationality, current residency, visa status, sponsorship, notice period, and salary currency/period captured as distinct verified facts
  - Arabic/English bilingual requirements preserved verbatim with zero invisible BiDi characters
---
# MENA & GCC job boards (Wuzzuf, Bayt, GulfTalent)

## When to Use & Preconditions

Use for regional MENA and GCC job boards (`wuzzuf`, `bayt`, `gulftalent`) and region-specific LinkedIn MENA discovery rules.

- **Load when:** `target.platform` in `wuzzuf`, `bayt`, `gulftalent`; MENA or GCC region search; job URL on Wuzzuf, Bayt, or GulfTalent.
- **Preconditions (stop if any is false):**
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
  - target is explicitly enabled by the owner in `context/targets.yaml` (all public examples ship `enabled: false`)
- **Requires skills:** `discover-and-triage`, `condition-based-browser-waiting`, `multilingual-adaptation`. **MCP:** `playwright`.

## Deterministic Step-by-Step Execution

> **Truthful Verification Status:** Live-tested: **UNVERIFIED** (no live authenticated portal browsing or live submission performed; accessibility-snapshot patterns and safety contracts are verified against offline synthetic fixtures [`evals/fixtures/boards/bayt-mock.html`](../../evals/fixtures/boards/bayt-mock.html) and [`evals/fixtures/boards/gulftalent-mock.html`](../../evals/fixtures/boards/gulftalent-mock.html)). Because Bayt and GulfTalent are not live-verified, both default to `enabled: false`, `live_verified: false`, `max_per_platform: 0`, and `manual_apply` + `needs_review` handoff until explicitly live-verified by the owner.

Enforce all `AGENTS.md` Hard Guardrails (`#1–#10`), `skills/15-multilingual-adaptation.md`, `skills/18-condition-based-browser-waiting.md`, `skills/24-circuit-breaker-and-antiban.md`, `skills/25-prompt-injection-defense.md`, and `skills/26-deduplication-and-blacklist-guard.md`.

### Semantic Locator & Condition-Waiting Contract (All MENA Boards)
- Resolve every control exclusively from a fresh `browser_snapshot` using strict semantic locator priority: **`Role -> Label -> Placeholder -> Text`** (zero brittle CSS selectors, DOM indices, or XPath).
- Wait for observable accessibility state transitions (`aria-expanded="true"`, detail region mount, active `aria-current="page"` change, or filename upload badge) before acting, followed by a single random **3–9 s** human pacing jitter between page navigations and submissions.
- **Hard Stop & Manual Handoff Rules:** Never automate account creation, automatic sign-in, legal terms acceptance, CAPTCHA/Cloudflare/2FA bypass, or unattended final submission. Any CAPTCHA, 2FA, Cloudflare challenge, or rate-limit banner trips `skills/24-circuit-breaker-and-antiban.md` and aborts the run immediately. Any hidden honeypot field (`website_url_honeypot`) must remain strictly empty.

### Wuzzuf (`wuzzuf`)
1. Verify named session at configured `auth_check_url` (`https://wuzzuf.net/me`); open search title/location and available career-level/job-type/posted-date filters using confirmed preferences. Never modify Wuzzuf profile completeness as a side effect.
2. Open role, capture verified posting ID and canonical link (`wuzzuf:<id>`), employer, city, onsite/hybrid/remote requirement, education, language, and complete JD.
3. Apply may ask screening questions before or inside the form. Specific skill years require explicit `skills_years` in `context/form-answers.yaml`; military/national service, residency, graduation dates, and citizenship are never inferred.
4. On-platform Wuzzuf applications submit the account's single stored profile CV (per-job custom CV upload is not available on-platform); inform the owner or pause for `needs_review` when tailoring is required. Route external redirects via `skills/platforms/ats-engines.md`.

### Bayt (`bayt`)
1. **Auth Check (`auth_check_url`):** Open `https://www.bayt.com/en/myworkspace/` (or owner-configured `auth_check_url`) and take a fresh `browser_snapshot`. Confirm an observable signed-in workspace/account navigation landmark or user profile link. If a `Sign In`, `Log In`, `Register`, or `Create Account` gate or legal-terms agreement appears, stop immediately—do not create an account, sign in automatically, or accept terms; pause per `skills/04-fill-and-apply.md` Trap 5 or log `apply_type: manual_apply` + `status: needs_review`.
2. **Search & Accessible Filters:** Use `role="search"` / accessible `textbox` and `combobox` labels for confirmed role title, country/city, industry, career level/seniority, and posted-date filters (`Role -> Label -> Placeholder -> Text`). Confirm active filter state in a fresh `browser_snapshot` before reading cards; do not assume a missing filter was applied.
3. **Job Card Expansion & Full JD Capture:** Open each job card via its accessible job-title `link` or expand `button` (`aria-expanded="false"` -> verify `aria-expanded="true"` or detail heading/region mount in fresh `browser_snapshot`). Pause `>= 10` seconds to read the full JD. Capture canonical `bayt:<verified-posting-id>`, canonical URL, employer name, city/country, work mode, posting date (or `unknown`), and language requirement.
4. **Pagination Verification:** Locate the pagination landmark (`role="navigation"` containing `"Next"` / page links). After activating `"Next"` (with 3–9 s pacing), verify in a fresh `browser_snapshot` that the active page indicator (`aria-current="page"`) or visible listing set changed before reading new cards. Stop when `max_results` is reached or `"Next"` is disabled/absent.
5. **Direct Employer vs. Agency Attribution:** Separate direct employers from confidential recruitment agencies / staffing firms (`"Confidential Company"` / agency badge). Record agency attribution in notes, check `blacklisted_companies` / `blacklisted_domains` (`skills/26-deduplication-and-blacklist-guard.md`), and never mislabel an agency posting as a direct employer.
6. **External ATS Redirect Detection:** Inspect the Apply control's accessible name/description (`"Apply on company site"`, `"Apply externally"`) and destination URL after opening in a new tab (`browser_tabs` + fresh `browser_snapshot`). Bayt external redirects frequently resolve directly to `Workable` (`jobs.workable.com`) or `Teamtailor` (`careers.*`) without requiring a Bayt login. Route recognized employer ATS hosts (`greenhouse`, `lever`, `ashby`, `smartrecruiters`, `breezyhr`, `workable`, `teamtailor`) via `skills/platforms/ats-engines.md` while keeping the original discovery ID (`bayt:<id>`) and logging the canonical ATS URL in notes. Workday, Taleo, account-gated, or unknown external hosts remain `apply_type: manual_apply` + `status: needs_review`.
7. **On-Board Screening, CV Overwrite & Manual Handoff:** Apply may reuse the Bayt profile, open a screening questionnaire, or warn that uploading replaces the shared Bayt profile CV. Never silently replace the shared profile CV or mutate profile completeness (`needs_review`). Because Bayt is currently unverified (`live_verified: false`, `max_per_platform.bayt: 0`), keep on-board applications at `apply_type: manual_apply` + `status: needs_review` (delivering tailored resume path, grounded answers, and Live DOM Read-Back Table); any future live one-click or final submit still requires the full Final DOM Read-Back & explicit job-specific `APPROVE` gate (`skills/04-fill-and-apply.md`) and is strictly blocked when `dry_run: true`.

### GulfTalent (`gulftalent`)
1. **Auth Check (`auth_check_url`):** Open `https://www.gulftalent.com/account/` (or owner-configured `auth_check_url`) and take a fresh `browser_snapshot`. Confirm an observable signed-in candidate account/dashboard navigation landmark. If `Sign In`, `Register`, `Create Account`, or terms-of-service acceptance blocks access, stop immediately—never create an account, sign in automatically, or accept legal terms; log `apply_type: manual_apply` + `status: needs_review` and leave the tab open for owner action.
2. **Search & GCC Filter Flow:** Use accessible search controls (`Role -> Label -> Placeholder -> Text`) for confirmed role keywords, GCC/MENA country or city, job category, seniority, and recency filters. Verify applied filters in fresh `browser_snapshot` before reading listings.
3. **Job Card Expansion & Full JD Capture:** Activate each job card's title `link` or expand `button` (`aria-expanded="false"` -> verify `aria-expanded="true"` or full JD heading/region mount). Always verify the full job page before recommending—GulfTalent search/summary cards can understate required years compared with the full details (e.g., `"3+ years"` on a card vs. `"Seven or more years"` inside the full posting). Read `>= 10` seconds and capture canonical `gulftalent:<verified-posting-id>`, canonical URL, employer/agency name, GCC city/country, work mode, posting date (or `unknown`), and full description.
4. **Pagination Verification:** Use the accessible pagination landmark (`role="navigation"`, `"Next"` link/button). Confirm in a fresh `browser_snapshot` that `aria-current="page"` or result titles advanced before continuing; stop at `max_results` or when `"Next"` is disabled/absent.
5. **Direct Employer vs. Recruitment Agency Distinction:** GulfTalent mixes direct GCC employers with recruitment agencies and `"Confidential"` mandates. Record whether the poster is a direct employer or recruitment agency, run `skills/26-deduplication-and-blacklist-guard.md` against both employer name and destination domain, and flag undisclosed-employer agency roles explicitly in triage notes.
6. **External ATS Redirect Detection:** Inspect the Apply button/link accessible name (`"Apply on Company Site"`, external link text) and verify the landing tab hostname via `browser_tabs` + `browser_snapshot`. Route recognized employer ATS engines via `skills/platforms/ats-engines.md` (preserving `gulftalent:<id>` + recording canonical ATS URL). Route Workday, Taleo, account-gated portals, or unrecognized corporate hosts immediately to `apply_type: manual_apply` + `status: needs_review`.
7. **Manual Handoff & Zero-Auto-Submit Policy:** Because GulfTalent is offline/synthetic-verified (`live_verified: false`, `max_per_platform.gulftalent: 0`), never auto-submit on GulfTalent, never overwrite a shared GulfTalent CV/profile, and never click final Submit automatically. Prepare the verified tailored resume path, grounded screening answers, and Live DOM Read-Back Table, log `apply_type: manual_apply` + `status: needs_review`, and hand off to the owner.

### Common Bayt & GulfTalent Form Traps (Mandatory Handling)
- **Nationality, Current Residency, GCC Visa & Sponsorship (4 Distinct Facts):** Never collapse or infer these fields. Map (1) nationality/citizenship, (2) current country of residence, (3) current GCC/local visa status & transferability (`UAE`, `KSA`, `Qatar`, `Kuwait`, `Bahrain`, `Oman`, `Egypt`), and (4) visa sponsorship need strictly from verified `context/form-answers.yaml` / `context/profile.md`. Never infer GCC authorization from Egypt/MENA residency or nationality. Any missing or ambiguous value -> screenshot, `open_questions`, `needs_review`.
- **Notice Period Selectors:** Match enumerated options (`"Immediate"`, `"1 Month"`, `"2 Months"`, `"3 Months"`, etc.) strictly against verified `notice period` in `context/form-answers.yaml`. Never round down or guess an unlisted option; if ambiguous -> `needs_review`.
- **Salary Currency & Period Toggles:** Inspect currency (`AED`, `SAR`, `QAR`, `KWD`, `BHD`, `OMR`, `EGP`, `USD`) and period (`Monthly` vs. `Annual`) as separate semantic controls in fresh `browser_snapshot`. Never silently convert currencies or annualize/de-annualize salary expectations. If the form forces a currency or period without a verified owner figure -> `needs_review`.
- **Arabic / English Bilingual Listings & RTL Handling:** Detect `/ar/` vs. `/en/` routes and `lang="ar"` / `dir="rtl"` containers. Follow `skills/15-multilingual-adaptation.md`: preserve original Arabic/English question text verbatim alongside any translation in `open_questions`/notes, keep Latin technical keywords (`TypeScript`, `Node.js`, `PostgreSQL`, `Playwright`) intact inside Arabic prose, never inflate job titles during translation, and never emit invisible Unicode BiDi control characters (`U+202A..202E`, `U+2066..2069`).
- **CV / Profile Overwrite Warnings & Honeypots:** Never overwrite a shared Bayt/GulfTalent profile CV silently when a form warns that upload updates the shared profile (`needs_review`). Always leave hidden honeypot inputs (`website_url_honeypot`) strictly empty.

### LinkedIn MENA radar
Use `skills/platforms/linkedin.md` with explicitly chosen countries/cities (Egypt, UAE, Saudi Arabia or other owner choices—not automatic regional assumptions). Past 24h and remote/hybrid filters must be verified in snapshot. Arabic/English title variants come from confirmed preferences. Do not infer GCC authorization from Egypt residency or "remote" wording.

### Shared review/submission
Pause to read descriptions, score honest fit, and check duplicate posting/ATS URL (`skills/26-deduplication-and-blacklist-guard.md`). Motivation text follows `skills/04-fill-and-apply.md` in the form's requested language with identical factual meaning. Unknown legal/factual answers: screenshot, `open_questions`, `needs_review`, leave tab open, ask in chat. `dry_run: true` never clicks Submit; any real live submission requires non-zero cap, full Final DOM Read-Back Table, explicit job-specific `APPROVE`, reservation, and post-submit receipt verification (`skills/meta-self-verification.md`). CAPTCHA, 2FA, warning, or rate limit aborts the entire run; a mid-run login wall pauses per `skills/04-fill-and-apply.md` Trap 5 and aborts if unresolved.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Inferring GCC/regional work authorization from nationality or another MENA country's residency → ✅ treat nationality, residency, visa status, and sponsorship as separate verified facts, or block as `needs_review`.
- ❌ Silently converting salary currency (`EGP`/`AED`/`SAR`/`USD`) or toggling `Monthly`/`Annual` without verified owner numbers → ✅ verify both currency and period controls in snapshot, else `needs_review`.
- ❌ Replacing a shared Bayt/GulfTalent profile CV, auto-creating an account, accepting legal terms, or bypassing a login/CAPTCHA wall → ✅ stop and hand off (`manual_apply` + `needs_review`, or abort run on CAPTCHA/2FA).
- ❌ Targeting job cards, pagination, or dropdowns via brittle CSS classes or XPath → ✅ resolve strictly via `Role -> Label -> Placeholder -> Text` from fresh `browser_snapshot`.
- ❌ Ignoring an Arabic-only requirement or inserting invisible Unicode BiDi control chars → ✅ capture verbatim using `lang="ar"`/`dir="rtl"` norms and score fit honestly.

### Self-verification check (before reporting this step complete)
- [ ] `auth_check_url` verified as signed-in or stopped cleanly on Sign In / Create Account gate
- [ ] job card expanded, pagination verified via fresh `browser_snapshot`, and external ATS redirects routed safely
- [ ] nationality, current residency, visa status, sponsorship, notice period, and salary currency/period captured as distinct verified facts
- [ ] Arabic/English bilingual requirements preserved verbatim with zero invisible BiDi characters

Evidence comes from a fresh snapshot, a file read, or a command exit code observed after the action (`skills/meta-self-verification.md`). If any box cannot be ticked, report the step as unverified or `needs_review` — never as done.
