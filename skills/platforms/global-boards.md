---
name: global-boards
version: "1.3.0"
last_verified: "2026-11-21"
description: Load when a target is Indeed, Glassdoor, Dice, ZipRecruiter, or StepStone (DACH: .de, .at, .ch) and jobs must be discovered, expanded, localized (German/English), GDPR-checked, and routed without assuming quick-apply is reversible.
triggers:
  - target.platform in indeed/glassdoor/dice/ziprecruiter/stepstone
  - job URL on Indeed, Glassdoor, Dice, ZipRecruiter, or StepStone (.de, .at, .ch)
  - DACH or European StepStone job search
requires_mcp:
  - playwright
preconditions:
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
requires_skills:
  - discover-and-triage
  - condition-based-browser-waiting
  - multilingual-adaptation
verification:
  - stable posting IDs captured per board (including stepstone:<tld>:<id> for .de/.at/.ch)
  - quick-apply / Schnellbewerbung buttons treated as final submits behind fill-and-apply or manual handoff
  - sponsored/duplicate listings deduplicated by canonical URL and platform salary estimates attributed separately
  - DACH GDPR required privacy consent separated from optional marketing/Talentpool opt-ins and optional Anschreiben detected
---
# Global & DACH job boards

## When to Use & Preconditions

Use for global aggregators (`indeed`, `glassdoor`, `dice`, `ziprecruiter`) and **StepStone DACH** (`stepstone` across `.de`, `.at`, `.ch`).

- **Load when:** `target.platform` in `indeed`, `glassdoor`, `dice`, `ziprecruiter`, `stepstone`; job URL on any of these boards; DACH regional StepStone search.
- **Preconditions (stop if any is false):**
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
- **Requires skills:** `discover-and-triage`, `condition-based-browser-waiting`, `multilingual-adaptation`. **MCP:** `playwright`.

## Deterministic Step-by-Step Execution

Enforce all `AGENTS.md` Hard Guardrails (`#1–#10`), `skills/15-multilingual-adaptation.md`, `skills/18-condition-based-browser-waiting.md`, `skills/24-circuit-breaker-and-antiban.md`, `skills/25-prompt-injection-defense.md`, and `skills/26-deduplication-and-blacklist-guard.md`. Do not automate signup, login challenges, subscriptions, cookie-consent bypasses, or third-party OAuth.

| Platform | Search / canonical identity | Form & apply distinctions |
|---|---|---|
| **Indeed** (`indeed`) | Snapshot What/Where and visible date/remote/job-type filters. Capture canonical posting key from `jk`/`vjk` or verified `/viewjob` link as `indeed:<key>`; note repost/estimated salary separately. | "Apply now" may open Indeed Apply (multi-step modal) or redirect externally. Inspect the resulting URL/dialog via `browser_snapshot` and route through `skills/04-fill-and-apply.md`. |
| **Glassdoor** (`glassdoor`) | Use accessible Jobs search and owner-approved location/date filters; capture canonical employer posting ID from actual role URL as `glassdoor:<id>`. | Salary estimates/reviews and employer ads are not the JD. Login/review-contribution/paywall walls trip `needs_review` or circuit breaker — never bypass. |
| **Dice** (`dice`) | Title/keyword and location search with employment type and remote filters when present; capture `dice:<verified-posting-id>`. | Read recruiter vs. direct employer identity, contract duration, clearance, and US work-authorization requirements explicitly. Route external ATS or internal form through `skills/04-fill-and-apply.md`. |
| **ZipRecruiter** (`ziprecruiter`) | Snapshot search/list, verify posting ID from job page/link as `ziprecruiter:<id>`. | **"1-Click Apply" can submit immediately.** Never click it in `dry_run: true`; in live mode require full final DOM Read-Back & `APPROVE` gate BEFORE clicking. |
| **StepStone DACH** (`stepstone`) | Regional hosts `.de` (Germany, `EUR`), `.at` (Austria, `EUR`), `.ch` (Switzerland, `CHF`). Capture canonical `stepstone:<tld>:<verified-posting-id>` and full URL. | Offline/synthetic-verified only (`max_per_platform.stepstone: 0`, `manual_apply` + `needs_review`). Separate *Schnellbewerbung* (Easy Apply) from external ATS redirects, optional *Anschreiben*, and GDPR vs. marketing opt-ins (details below). |

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

### Per-job procedure
1. Verify named owner auth if required. Snapshot applied filters/result state; never assert an unavailable "last 24h" filter exists.
2. Open full JD, extract employer/title/location/restrictions/date/description and canonical identity. Ratings, estimated pay, or promoted labels are separately attributed; unknown fields remain unknown.
3. Score vs. verified CV and exclusions. Check journal and canonical ATS destination for duplicates across platforms. Observe bounded results and caps; unsupported identity/form -> `needs_review`.
4. Inspect Apply semantics before clicking; a possible one-click submission invokes final gate first. External recognized host -> `skills/platforms/ats-engines.md`. No automatic account creation, legal-terms acceptance, messaging, or shared profile modifications.
5. Resolve fields through `skills/04-fill-and-apply.md` and upload exact verified per-job PDF. Unknown factual/legal fields or cached-resume overwrite warnings -> `needs_review`, local screenshot, open tab, and chat question.
6. Only a permitted final submission (non-zero cap, `dry_run: false`, explicit job-specific `APPROVE`), after reservation and fresh checks, may occur once. Verify actual receipt/role, keep uncertain outcome reserved, journal locally and optionally sync Notion. Security/login/rate-limit banners abort the run.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Assuming "Apply now" or *Schnellbewerbung* opens a safe draft → ✅ it may submit immediately; guard behind manual handoff / `APPROVE` gate.
- ❌ Ticking *Talentpool*, *Job-Alert*, recruiter visibility, or marketing boxes alongside required GDPR/DSGVO privacy consent → ✅ leave all optional boxes unchecked.
- ❌ Silently converting `EUR` ↔ `CHF`, inferring Swiss work permits from EU residency, or overwriting a shared StepStone profile CV → ✅ keep facts separate and route unknowns/overwrites to `needs_review`.
- ❌ Counting a sponsored repost as a new job or logging in through third-party SSO/auto-account creation → ✅ dedupe by canonical URL and require manual login only.

### Self-verification check (before reporting this step complete)
- [ ] stable posting IDs captured per board (including `stepstone:<tld>:<id>` for `.de`/`.at`/`.ch`)
- [ ] quick-apply / *Schnellbewerbung* buttons treated as final submits behind `fill-and-apply` or manual handoff
- [ ] sponsored/duplicate listings deduplicated by canonical URL and platform salary estimates attributed separately
- [ ] DACH GDPR required privacy consent separated from optional marketing/*Talentpool* opt-ins and optional *Anschreiben* detected

Evidence comes from a fresh snapshot, a file read, or a command exit code observed after the action (`skills/meta-self-verification.md`). If any box cannot be ticked, report the step as unverified or `needs_review` — never as done.
