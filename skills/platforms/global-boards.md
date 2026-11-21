---
name: global-boards
version: "1.4.0"
last_verified: "2026-11-21"
description: Load when a target is Indeed, Glassdoor, Dice, ZipRecruiter, StepStone (DACH: .de, .at, .ch), or Naukri (India) and jobs must be discovered, expanded, localized, compliance-checked, and routed without assuming quick-apply is reversible.
triggers:
  - target.platform in indeed/glassdoor/dice/ziprecruiter/stepstone/naukri
  - job URL on Indeed, Glassdoor, Dice, ZipRecruiter, StepStone (.de, .at, .ch), or Naukri (India)
  - DACH StepStone or India Naukri regional job search
requires_mcp:
  - playwright
preconditions:
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
requires_skills:
  - discover-and-triage
  - condition-based-browser-waiting
  - multilingual-adaptation
  - circuit-breaker-and-antiban
verification:
  - stable posting IDs captured per board (including stepstone:<tld>:<id> and naukri:<id>)
  - quick-apply / Schnellbewerbung / Naukri recruiter-apply treated as final submits behind fill-and-apply or manual handoff
  - sponsored/duplicate listings deduplicated by canonical URL and platform salary estimates attributed separately
  - DACH GDPR/Anschreiben and India CTC (LPA)/notice/immediate-joiner/circuit-breaker stop rules enforced
---
# Global, DACH & India job boards

## When to Use & Preconditions

Use for global aggregators (`indeed`, `glassdoor`, `dice`, `ziprecruiter`), **StepStone DACH** (`stepstone` across `.de`, `.at`, `.ch`), and **Naukri India** (`naukri`).

- **Load when:** `target.platform` in `indeed`, `glassdoor`, `dice`, `ziprecruiter`, `stepstone`, `naukri`; job URL on any of these boards; DACH StepStone or India Naukri search.
- **Preconditions (stop if any is false):**
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
- **Requires skills:** `discover-and-triage`, `condition-based-browser-waiting`, `multilingual-adaptation`, `circuit-breaker-and-antiban`. **MCP:** `playwright`.

## Deterministic Step-by-Step Execution

Enforce all `AGENTS.md` Hard Guardrails (`#1–#10`), `skills/15-multilingual-adaptation.md`, `skills/18-condition-based-browser-waiting.md`, `skills/24-circuit-breaker-and-antiban.md`, `skills/25-prompt-injection-defense.md`, and `skills/26-deduplication-and-blacklist-guard.md`. Do not automate signup, login challenges, subscriptions, cookie-consent bypasses, or third-party OAuth.

| Platform | Search / canonical identity | Form & apply distinctions |
|---|---|---|
| **Indeed** (`indeed`) | Snapshot What/Where and visible date/remote/job-type filters. Capture canonical posting key from `jk`/`vjk` or verified `/viewjob` link as `indeed:<key>`; note repost/estimated salary separately. | "Apply now" may open Indeed Apply (multi-step modal) or redirect externally. Inspect the resulting URL/dialog via `browser_snapshot` and route through `skills/04-fill-and-apply.md`. |
| **Glassdoor** (`glassdoor`) | Use accessible Jobs search and owner-approved location/date filters; capture canonical employer posting ID from actual role URL as `glassdoor:<id>`. | Salary estimates/reviews and employer ads are not the JD. Login/review-contribution/paywall walls trip `needs_review` or circuit breaker — never bypass. |
| **Dice** (`dice`) | Title/keyword and location search with employment type and remote filters when present; capture `dice:<verified-posting-id>`. | Read recruiter vs. direct employer identity, contract duration, clearance, and US work-authorization requirements explicitly. Route external ATS or internal form through `skills/04-fill-and-apply.md`. |
| **ZipRecruiter** (`ziprecruiter`) | Snapshot search/list, verify posting ID from job page/link as `ziprecruiter:<id>`. | **"1-Click Apply" can submit immediately.** Never click it in `dry_run: true`; in live mode require full final DOM Read-Back & `APPROVE` gate BEFORE clicking. |
| **StepStone DACH** (`stepstone`) | Regional hosts `.de` (Germany, `EUR`), `.at` (Austria, `EUR`), `.ch` (Switzerland, `CHF`). Capture canonical `stepstone:<tld>:<verified-posting-id>` and full URL. | Offline/synthetic-verified only (`max_per_platform.stepstone: 0`, `manual_apply` + `needs_review`). Separate *Schnellbewerbung* (Easy Apply) from external ATS redirects, optional *Anschreiben*, and GDPR vs. marketing opt-ins (details below). |
| **Naukri India** (`naukri`) | India host `www.naukri.com` (`INR` / `LPA`). Capture canonical `naukri:<verified-posting-id>` and full URL (distinct from GCC `naukrigulf.com`). | Offline/synthetic-verified only (`max_per_platform.naukri: 0`, `manual_apply` + `needs_review`). Separate recruiter-apply / chatbot screening from external ATS redirects; enforce CTC/LPA, notice/immediate-joiner, and circuit-breaker stop rules (details below). |

### StepStone (`stepstone` — DACH: `.de`, `.at`, `.ch`)

> **Truthful Verification Status:** Live-tested: **UNVERIFIED** (no live StepStone browsing, account login, or live submission performed; accessibility-snapshot patterns and safety contracts are modeled against offline synthetic fixture [`evals/fixtures/boards/stepstone-mock.html`](../../evals/fixtures/boards/stepstone-mock.html)). Because StepStone is not live-verified, it ships with `enabled: false`, `live_verified: false`, `max_per_platform.stepstone: 0`, and `apply_type: manual_apply` + `status: needs_review` handoff until explicitly live-verified by the owner.

1. **Regional Domain, Currency & Work-Authorization Distinctions:**
   - Support Germany (`www.stepstone.de`, `EUR`), Austria (`www.stepstone.at`, `EUR`), and Switzerland (`www.stepstone.ch`, `CHF`). Always preserve domain TLD in the canonical ID (`stepstone:de:<id>`, `stepstone:at:<id>`, `stepstone:ch:<id>`).
   - Keep `EUR` and `CHF` (and `Annual` vs. `Monthly` pay periods) explicit as separate verified facts—never silently convert between `EUR` and `CHF` or annualize/de-annualize salary expectations.
   - Treat EU/EEA work authorization, German/Austrian residence/Blue Card eligibility, Swiss work permits (`B`/`C`/`L`), and sponsorship need as strictly distinct legal facts from `context/form-answers.yaml` / `context/profile.md`. Never infer Swiss work authorization from EU residency or remote wording; unknown legal/permit questions -> `needs_review`.
2. **Auth Check (`auth_check_url`) & Cookie / Account-Gate Stop Rules:**
   - Open configured `auth_check_url` (e.g., `https://www.stepstone.de/my-account/` or the configured `.at`/`.ch` equivalent) and take a fresh `browser_snapshot` using strict semantic locator priority **`Role -> Label -> Placeholder -> Text`** (`skills/18-condition-based-browser-waiting.md`, zero brittle CSS selectors or XPath).
   - Confirm an observable signed-in candidate account landmark (`"Mein Konto"` / `"My Account"`). If an `Anmelden` / `Registrieren` / `Sign In` / `Create Account` gate, legal-terms checkbox, or blocking cookie-consent wall without an essential-only option appears, stop immediately—never create an account, sign in automatically, accept legal terms, or bypass consent/CAPTCHA/Cloudflare challenges (`skills/24-circuit-breaker-and-antiban.md` aborts run on CAPTCHA/2FA/rate limit).
3. **Search, Accessible Filters, Full JD Expansion & Pagination:**
   - Use accessible `role="search"` controls (`Role -> Label -> Placeholder -> Text`) for confirmed role keywords, city/radius (*Umkreis*), work mode (*Homeoffice* / *Hybrid* / *Vor Ort*), employment type, and language filters; verify applied filter state in fresh `browser_snapshot`.
   - Expand each job card via its title `link` or expand `button` (`aria-expanded="false"` -> verify `aria-expanded="true"` or full JD `role="region"` mount) and pause `>= 10` seconds to read the complete JD. Capture employer name, city/country, work mode, posting date (or `unknown`), and language requirement.
   - Distinguish **direct employers** from recruitment agencies (*Personalberatung* / *Zeitarbeit* / staffing firms) and check `skills/26-deduplication-and-blacklist-guard.md`. Separately attribute **StepStone salary estimates** (*Gehaltsschätzung*) from employer-stated compensation—never treat an algorithmic estimate as a verified offer range.
   - Paginate via the accessible pagination landmark (`role="navigation"`, `"Weiter"` / `"Next"`), verifying in a fresh `browser_snapshot` that `aria-current="page"` or result listings advanced (with 3–9 s pacing jitter); stop at `max_results` or when `"Weiter"`/`"Next"` is disabled/absent.
4. **Schnellbewerbung (Easy Apply) vs. External ATS Redirect Detection:**
   - Inspect the Apply control's accessible name (`"Schnellbewerbung"` / `"Easy Apply"` vs. `"Auf Unternehmensseite bewerben"` / `"Apply on company site"`).
   - **External ATS redirects:** Open destination tab (`browser_tabs` + fresh `browser_snapshot`), verify HTTPS hostname and employer/role match, and route recognized employer ATS engines (`greenhouse`, `lever`, `ashby`, `smartrecruiters`, `breezyhr`) via `skills/platforms/ats-engines.md` while preserving `stepstone:<tld>:<id>` and logging the canonical ATS URL. Workday, Taleo, SAP SuccessFactors, Personio, Softgarden, rexx, account-gated, or unrecognized portals MUST remain `apply_type: manual_apply` + `status: needs_review`.
   - **On-board Easy Apply / Schnellbewerbung:** Never treat *Schnellbewerbung* as harmless or auto-submit; because StepStone is unverified (`max_per_platform.stepstone: 0`), stop before final submit, present the Live DOM Read-Back Table + tailored resume path + grounded answers, and log `apply_type: manual_apply` + `status: needs_review`.
5. **DACH Form Traps — Anschreiben, German/English Localization, GDPR/DSGVO & CV Overwrite:**
   - **Optional vs. Required *Anschreiben* (Cover Letter):** Inspect accessible label and `required` state (`"Optional"` / `"Freiwillig"` vs. required). Only attach/draft a grounded cover letter via `skills/03-tailor-resume-and-verify.md` + `skills/15-multilingual-adaptation.md` matching the JD language (`DE`/`EN`) with zero fabricated claims or AI clichés; if an *Anschreiben* is required and unverified -> `needs_review`.
   - **German & English Localization (`skills/15-multilingual-adaptation.md`):** Detect German vs. English JD/form language (including German chrome around an English JD). Follow `skills/15-multilingual-adaptation.md` for *Lebenslauf* register, keep Latin technical keywords (`TypeScript`, `Node.js`, `PostgreSQL`, `CI/CD`) verbatim inside German prose, preserve original German/English question labels in `open_questions`, never inflate titles, and never invent DACH photo/date-of-birth/marital-status fields.
   - **GDPR / *DSGVO* Consent vs. Optional Opt-Ins:** Strictly distinguish required candidate data-processing privacy consent (*Datenschutzerklärung* / `gdpr_privacy_consent`) from optional checkboxes (*Talentpool*, *Job-Alert*, newsletter, marketing emails, or *Kandidatenprofil sichtbar machen* recruiter visibility). Never check optional marketing, *Talentpool*, visibility, or account-terms boxes; if a required privacy/terms clause is ambiguous -> `needs_review`.
   - **Shared Profile CV Overwrite & Honeypots:** If uploading warns that it will overwrite the shared StepStone profile CV -> stop and log `needs_review` (never silently replace shared profile data). Always leave hidden honeypot inputs (`website_url_honeypot`) strictly empty.

### Naukri (`naukri` — India)

> **Truthful Verification Status:** Live-tested: **UNVERIFIED** (no live Naukri browsing, login, OTP entry, scraping, or live submission performed; accessibility-snapshot patterns and safety contracts are modeled against offline synthetic fixture [`evals/fixtures/boards/naukri-mock.html`](../../evals/fixtures/boards/naukri-mock.html)). Because Naukri is not live-verified, it ships with `enabled: false`, `live_verified: false`, `max_per_platform.naukri: 0`, and `apply_type: manual_apply` + `status: needs_review` handoff until explicitly live-verified by the owner. *(Note: Naukri India `www.naukri.com` is distinct from GCC `naukrigulf.com`.)*

1. **Auth Check (`auth_check_url`) & Login / Mobile-OTP Stop Rules:**
   - Check `logs/circuit-breaker.json` first (`skills/24-circuit-breaker-and-antiban.md`); if `"naukri"` has an active 24-hour cooldown (`status: "tripped"`), skip immediately.
   - Open configured `auth_check_url` (`https://www.naukri.com/mnjuser/homepage`) and inspect a fresh `browser_snapshot` via strict semantic locator priority **`Role -> Label -> Placeholder -> Text`** (`skills/18-condition-based-browser-waiting.md`, zero brittle CSS selectors or XPath).
   - Confirm an observable signed-in candidate profile/homepage landmark. If a `Login` / `Register` wall, **mobile-number OTP / 2FA challenge**, or legal-terms agreement appears, stop immediately—never create accounts, sign in automatically, enter OTPs, or accept legal terms; leave the tab open and log `apply_type: manual_apply` + `status: needs_review`.
2. **Discovery, Filter URLs, Full JD Expansion & Pagination:**
   - Start from owner-confirmed role/location filter URLs (e.g., `https://www.naukri.com/{{ROLE_SLUG}}-jobs` with verified experience/location/work-mode filters) and refine only via accessible `role="search"` controls (`Experience`, `Salary (INR/LPA)`, `Location`, `Work mode`, `Freshness`); verify applied filter state in fresh `browser_snapshot`.
   - Expand each job card via its title `link` or expand `button` (`aria-expanded="false"` -> verify `aria-expanded="true"` or full JD `role="region"` mount) and pause `>= 10` seconds to read the full JD. Capture canonical `naukri:<verified-posting-id>`, canonical URL, employer name, Indian city/work mode (`Remote`/`Hybrid`/`Onsite`), experience range, posted date (or `unknown`), and full requirements.
   - Distinguish **direct employers** from placement consultancies / recruitment agencies (`skills/26-deduplication-and-blacklist-guard.md`). Paginate via the accessible pagination landmark (`role="navigation"`, `"Next"`), verifying `aria-current="page"` or result shift in a fresh `browser_snapshot` (with 3–9 s pacing jitter); stop at `max_results` or when `"Next"` is disabled/absent.
3. **Recruiter-Apply / Screening Chatbot vs. External ATS Redirect Handling:**
   - Inspect the Apply control's accessible name (`"Apply"` / `"Apply on Naukri"` vs. `"Apply on company site"`).
   - **External ATS redirects:** Switch to the opened tab (`browser_tabs` + fresh `browser_snapshot`), verify HTTPS hostname and employer/role match, and route recognized employer ATS engines (`greenhouse`, `lever`, `ashby`, `smartrecruiters`, `breezyhr`) via `skills/platforms/ats-engines.md` while preserving `naukri:<id>` and logging the canonical ATS URL. Workday, Taleo, SAP SuccessFactors, Zoho Recruit, Darwinbox, account-gated, or unknown external portals MUST remain `apply_type: manual_apply` + `status: needs_review`.
   - **On-board Recruiter-Apply / Chatbot Screening:** Naukri `"Apply"` may submit immediately using the saved Naukri profile or open an interactive recruiter screening questionnaire (asking Current/Expected CTC, notice period, and location). Never auto-submit or click unattended one-click apply; because Naukri is unverified (`max_per_platform.naukri: 0`), stop before final submit, present the Live DOM Read-Back Table + tailored resume path + grounded answers, and log `apply_type: manual_apply` + `status: needs_review`.
4. **India-Specific Form & Profile Traps (CTC/LPA, Notice/Immediate Joiner, Location & CV Overwrite):**
   - **Current CTC & Expected CTC (`INR` / `LPA`):** Keep `Current CTC`, `Expected CTC`, and unit (`LPA` — Lakhs Per Annum vs. monthly `INR` vs. `USD`) strictly separate and verified from `context/form-answers.yaml`. Never silently convert `USD` ↔ `INR` or `LPA` ↔ monthly figures, and never fabricate or guess `Current CTC`; if Current/Expected CTC is unverified or sensitive -> `needs_review`.
   - **Notice Period & Immediate Joiner / Serving-Notice Flags:** Map enumerated options (`"Immediate Joiner"`, `"15 Days or less"`, `"1 Month"`, `"2 Months"`, `"3 Months"`, `"Serving Notice Period"`) strictly from verified `context/form-answers.yaml`. Never falsely tick `"Immediate Joiner"` or `"Negotiable notice"` without verified owner confirmation (`needs_review` if ambiguous).
   - **Location Preferences:** Keep `current_location`, `preferred_locations` (e.g., Bengaluru, Hyderabad, Pune, Delhi NCR, Mumbai), work mode (`Remote`/`Hybrid`/`Onsite`), and `willing_to_relocate` as distinct verified owner facts—never assume relocation or onsite availability across Indian cities.
   - **Shared Naukri Profile / CV Overwrite & Honeypots:** Never silently replace the candidate's default Naukri profile resume or mutate saved Naukri headline/CTC/notice fields when an apply flow warns of shared-profile overwrites (`needs_review`). Always leave hidden honeypot inputs (`website_url_honeypot`) strictly empty.
5. **Anti-Bot / CAPTCHA / Rate-Limit Stop Signals (`skills/24-circuit-breaker-and-antiban.md`):**
   - Immediately halt with **zero retries** if any `browser_snapshot`, title, or URL shows CAPTCHA, Cloudflare/Akamai/PerimeterX interstitials, `"Verify you are human"`, HTTP `429` / `403`, `"Unusual activity"`, rapid-apply throttle warnings, or an unexpected mid-run login/OTP redirect.
   - Persist a 24-hour `"naukri"` cooldown (`status: "tripped"`, `tripped_at`, `cooldown_until`, `trigger_signal`, `url`) in `logs/circuit-breaker.json`, leave the tab open untouched, log `aborted` (`reason: "circuit_breaker_tripped"`), and alert the owner.

### Per-job procedure
1. Verify named owner auth if required. Snapshot applied filters/result state; never assert an unavailable "last 24h" filter exists.
2. Open full JD, extract employer/title/location/restrictions/date/description and canonical identity. Ratings, estimated pay, or promoted labels are separately attributed; unknown fields remain unknown.
3. Score vs. verified CV and exclusions. Check journal and canonical ATS destination for duplicates across platforms. Observe bounded results and caps; unsupported identity/form -> `needs_review`.
4. Inspect Apply semantics before clicking; a possible one-click submission invokes final gate first. External recognized host -> `skills/platforms/ats-engines.md`. No automatic account creation, legal-terms acceptance, messaging, or shared profile modifications.
5. Resolve fields through `skills/04-fill-and-apply.md` and upload exact verified per-job PDF. Unknown factual/legal fields or cached-resume overwrite warnings -> `needs_review`, local screenshot, open tab, and chat question.
6. Only a permitted final submission (non-zero cap, `dry_run: false`, explicit job-specific `APPROVE`), after reservation and fresh checks, may occur once. Verify actual receipt/role, keep uncertain outcome reserved, journal locally and optionally sync Notion. Security/login/rate-limit banners abort the run.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Assuming "Apply now", *Schnellbewerbung*, or Naukri `"Apply"` opens a safe draft → ✅ it may submit immediately; guard behind manual handoff / `APPROVE` gate.
- ❌ Ticking *Talentpool*, *Job-Alert*, recruiter visibility, or marketing boxes alongside required GDPR/DSGVO privacy consent → ✅ leave all optional boxes unchecked.
- ❌ Silently converting `EUR` ↔ `CHF` or `USD` ↔ `INR`/`LPA`, fabricating Current CTC, falsely ticking `"Immediate Joiner"`, or overwriting a shared board profile CV → ✅ keep facts separate and route unknowns/overwrites to `needs_review`.
- ❌ Retrying past CAPTCHA, OTP, or rate-limit banners or logging in through third-party SSO/auto-account creation → ✅ trip `skills/24-circuit-breaker-and-antiban.md` immediately and require manual login only.

### Self-verification check (before reporting this step complete)
- [ ] stable posting IDs captured per board (including `stepstone:<tld>:<id>` and `naukri:<id>`)
- [ ] quick-apply / *Schnellbewerbung* / Naukri recruiter-apply treated as final submits behind `fill-and-apply` or manual handoff
- [ ] sponsored/duplicate listings deduplicated by canonical URL and platform salary estimates attributed separately
- [ ] DACH GDPR/*Anschreiben* and India CTC (`LPA`)/notice/immediate-joiner/circuit-breaker stop rules enforced

Evidence comes from a fresh snapshot, a file read, or a command exit code observed after the action (`skills/meta-self-verification.md`). If any box cannot be ticked, report the step as unverified or `needs_review` — never as done.
