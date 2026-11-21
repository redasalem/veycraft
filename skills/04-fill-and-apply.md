---
name: fill-and-apply
version: "2.0.0"
description: Load when filling any Easy Apply modal or external ATS application form; enforces the Upload-First rule, absolute paths, EEO/GDPR compliance defaults, unknown-question pause, and job-bound APPROVE gate before Submit.
triggers:
  - selected job from APPLY reply
  - Easy Apply modal or external ATS form open
  - about to click Submit / Apply
requires_mcp:
  - playwright
preconditions:
  - job is not a duplicate in logs/applications-log.json and caps / active hours allow it
  - verified context/form-answers.yaml, context/resume-data.json, and exact tailored resume.pdf path ready
requires_skills:
  - tailor-resume-and-verify
  - condition-based-browser-waiting
  - deduplication-and-blacklist-guard
  - prompt-injection-defense
  - circuit-breaker-and-antiban
  - meta-dom-recovery
  - meta-structured-debugging
  - meta-self-verification
verification:
  - resume was uploaded FIRST and verified by filename badge in a fresh condition-based browser_snapshot (no blind fixed sleeps)
  - every filled answer and EEO/GDPR option matches verified context/form-answers.yaml or context/resume-data.json
  - final DOM Read-Back Verification table was generated from a fresh browser_snapshot confirming phone country code, dropdown values, and attached resume.pdf were not corrupted
  - dry_run stopped before Submit; every live submit received exact job-bound owner APPROVE after displaying the Live DOM Read-Back Table and 3-9s human pacing jitter, and was verified by skills/meta-self-verification.md
---
# Form Filling, Upload-First Rule, EEO/Consent Defaults & Approval Gate

## When to Use & Preconditions

Use for every internal Easy Apply modal and external ATS redirect (Greenhouse, Lever, Ashby, SmartRecruiters, BreezyHR; Workday/Taleo remain `manual_apply` + `needs_review`). Always use fresh `browser_snapshot` refs and roles/labels—never CSS selectors.

- **Two-Way Upload Boundary:** Providing a CV *from the user to Veycraft* uses `skills/01-resume-ingestion.md`. Uploading a tailored CV *from Veycraft to an employer ATS form* uses this skill (`04-fill-and-apply.md`)—requiring company + role verification, exact tailored file path verification, fresh post-upload `browser_snapshot` filename confirmation, populated DOM Read-Back Table, and explicit job-specific `APPROVE`. If Playwright automation is unavailable, deliver the complete manual application package (`resume.html`/`.doc`/`.txt`/optional `.pdf`, `interview-dossier.md`, copy-paste answers, and manual upload steps via `skills/fallback-no-mcp.md`).

- **Load when:** selected job from `APPLY` reply; Easy Apply modal or external ATS form open; about to click Submit / Apply; prepare or upload an application.
- **Preconditions (stop if any is false):**
  - job is not a duplicate in `logs/applications-log.json` and daily/platform caps & active hours allow it
  - verified `context/form-answers.yaml`, `context/resume-data.json`, and exact tailored resume file path ready
- **Requires skills:** `tailor-resume-and-verify`, `meta-dom-recovery`, `meta-structured-debugging`, `meta-self-verification`. **MCP:** playwright (required for live ATS upload/fill; falls back to manual prep when unavailable).

## Deterministic Step-by-Step Execution

### 1. Redirect, Iframe & Portal Check
- If clicking Apply opens a new tab, switch to it (`browser_tabs`), take a `browser_snapshot`, verify HTTPS hostname and that company + role match the original posting.
- **Embedded ATS Iframes (e.g., Greenhouse `#grnhse_iframe`):** If the employer embeds the ATS inside an `<iframe>`, verify the frame tree in `browser_snapshot` and switch/target inside that frame (`skills/meta-dom-recovery.md`) before filling fields or uploading files.
- Load the matching playbook (`skills/ats/<engine>.md` or `skills/platforms/<platform>.md`).
- If the site requires creating a new account, solving a CAPTCHA/2FA, or is Workday/Taleo/unsupported, set `apply_type: "manual_apply"`, `status: "needs_review"`, keep the tab open, **print the exact absolute path to `resume.pdf` (plus `resume.txt`/`resume.doc` and grounded form answers ready to copy-paste)**, and inform the owner so they can finish in one pass without redoing any prep.
- **Mid-run expired session:** Pause, ask the owner to log in privately in the open browser and reply `CONTINUE`, re-verify auth, then resume this same job.
- **Handling `EDIT <field>` or newly confirmed facts:** If the owner replies `EDIT <field>` or supplies a real answer/fact during review, save confirmed reusable answers to `context/form-answers.yaml` (or `context/profile.md`), update the form/resume, take a fresh `browser_snapshot`, re-display the **Live DOM Read-Back Table**, and request a fresh explicit `APPROVE`.

### 2. Five Mandatory ATS Form Traps & Unified Waiting Rule
Apply one timing rule across all steps: **condition-based `browser_snapshot` verification first** (`skills/18-condition-based-browser-waiting.md`), followed by a **single 3–9 s human pacing jitter** between page navigations and submissions:
1. **Trap 1 — Upload FIRST:** Upload the job's exact tailored `resume.pdf` BEFORE typing anything into text boxes (ATS parsers overwrite fields!). Wait for the upload spinner to clear and the `resume.pdf` filename/`Remove` badge to render in a fresh `browser_snapshot`, then inspect and fix every auto-parsed field against `context/resume-data.json`.
2. **Trap 2 — Absolute paths only:** Pass the exact absolute OS path (never `./logs/...` or `~`) to `browser_file_upload`.
3. **Trap 3 — Hidden drag-and-drop zones:** Click the visible upload button (`"Upload resume"`, `"Attach"`, `"Browse"`). Never inject JS to unhide inputs. If a cross-origin dropzone blocks the chooser, print the exact absolute path in chat and wait for the owner to drag-and-drop and reply `CONTINUE`.
4. **Trap 4 — Split fields & portal listbox click-to-mount cycles:** Match `first_name`/`last_name`, select `phone_country_code` by dialling code (e.g. `+20`) before `phone_national`. For React-Select / Ashby / Location typeahead portals, **click** the combobox trigger first so the portal menu mounts, type `city_autocomplete` / query text, confirm rendered `listbox` -> `option` nodes in a fresh `browser_snapshot` (often mounted at `<body>` root outside `<form>`), and click the exact option `ref`.
5. **Trap 5 — Unknown questions:** Never guess numbers, salary, visa/sponsorship, or legal answers. Leave the tab open, save a screenshot to `logs/screenshots/<job_id>.png` (redact/avoid secrets), log `needs_review` with `open_questions`, ask the exact question in chat, and **save the owner's confirmed answer back into `context/form-answers.yaml`** (`questions[]` with context comment) before resuming.

### 3. EEO, Demographics & Consent Auto-Handler (`context/form-answers.yaml`)
Read `eeo_and_compliance_defaults` (or `eeo`) from `context/form-answers.yaml`:
- `gender`, `ethnicity`, `veteran_status`, `disability_status`: Select the owner's configured value or closest neutral opt-out option (`"Decline to self-identify"`, `"Prefer not to say"`, `"I do not wish to answer"`).
- `referral_source`: Match `"LinkedIn"` / `"Company Careers Page"` / configured default (never invent an employee referral name).
- `gdpr_privacy_consent: true`: Automatically check ONLY the required candidate privacy policy / GDPR data-processing consent box at the bottom of Greenhouse/Lever/Ashby forms. Leave optional marketing, newsletter, `"Future job alerts"`, and `"Follow company"` checkboxes **unchecked**.
- Free-text `"Why us?"` questions: Draft 2–3 grounded sentences using `context/profile.md` + observed JD text, filtered through `skills/03-tailor-resume-and-verify.md` (zero AI slop, zero em-dashes).

### 4. Final DOM Read-Back Verification & Hard `APPROVE` Trust Boundary
- Re-read `config/invariants.txt` (`<500` bytes) and run `node ./bin/cli.mjs pre-submit` (passing `--draft <file>` for any outreach note) so daily/warm-up caps and `<= 75`-word limits are deterministically enforced even after IDE context compaction.
- Recheck `logs/applications-log.json` via `skills/26-deduplication-and-blacklist-guard.md` (canonical `company::role_title` fingerprint + today's `applied` / `submission_uncertain` counts vs daily & platform caps) and active hours.
- **Hard Operational Trust Boundary (`APPROVE` + 3–9 s Human Pacing):** The `APPROVE` gate and human pacing jitter (`3–9 s`) are **non-negotiable operational trust boundaries**. Never auto-submit, batch-approve across multiple jobs, or skip a fresh `browser_snapshot` read-back.
- **Mandatory Final DOM Read-Back Gate:** Before asking for `APPROVE` (or logging `dry_run`), take a **fresh `browser_snapshot`** of the completed form and inspect the *actual live values currently rendered in the browser DOM* (never rely on what you intended to type earlier, because ATS resume parsers or autocomplete widgets frequently overwrite or reset fields!).
- Display a compact **Live DOM Read-Back Table** in chat:
  `| Form Field (DOM Label) | Live Populated Value in Browser | Verified Source Check |`
  Specifically confirm:
  1. **Attached Resume Badge:** exact tailored `resume.pdf` filename is still attached and not replaced or cleared.
  2. **Phone Country Code & Number:** dialling code dropdown (`+20`, `+1`, etc.) and national number were not mangled by ATS auto-fill.
  3. **Dropdowns & Autocomplete:** Location/City, Work Authorization, and EEO selections show the intended selected option text (not `"Select..."` or a wrong default country).
  4. **Honeypot Check (`skills/25-prompt-injection-defense.md`):** any hidden/honeypot `"Leave blank"` field is confirmed empty.
- **If `dry_run: true`:** Present the Live DOM Read-Back Table, stop BEFORE clicking final Submit, take a screenshot if helpful, discard draft if needed, and log `dry_run`.
- **Mandatory Live Submission Gate (No Exceptions, No Automatic Bypass):** Before ANY live Submit click, confirm: (1) company and role title match the posting, (2) destination HTTPS domain is verified, (3) exact tailored `resume.pdf` filename badge is attached, (4) actual live values rendered in the current DOM match verified answers and consent settings, (5) daily/warm-up/platform caps, active hours, deduplication, and safety checks pass. Display the complete **Live DOM Read-Back Table** in chat and ask: **"Reply `APPROVE` to submit this exact application, `EDIT <field>` to revise, or `SKIP`."** Wait for an explicit, job-specific `APPROVE`. Never auto-submit based on match score, never batch-approve multiple jobs, and immediately invalidate approval if any field, attachment, consent, or page state changes afterward.
- **Submit once:** Before clicking Submit, write a `needs_review` + `submission_uncertain: true` reservation in `logs/applications-log.json`. Respect the `3–9 s` human pacing jitter, click Submit **once**, verify the post-submit state in a fresh `browser_snapshot` (`skills/meta-self-verification.md`) before updating the entry to `applied`. Never retry an uncertain/timed-out submit.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Filling contact/experience fields before uploading the resume → ✅ upload first, verify attachment badge in `browser_snapshot`, then correct.
- ❌ Ticking `"Subscribe to talent community"` alongside GDPR consent → ✅ check only required privacy policy consent when `gdpr_privacy_consent: true`.
- ❌ Clicking Submit twice when a spinner is slow → ✅ keep `submission_uncertain: true` and `needs_review`; never double-submit.

### Self-verification check (before reporting this step complete)
- [ ] resume was uploaded FIRST and verified by filename badge in a fresh condition-based `browser_snapshot`
- [ ] every filled answer and EEO/GDPR option matches verified `context/form-answers.yaml` or `context/resume-data.json`
- [ ] Live DOM Read-Back Table displayed and hard `APPROVE` + `3–9 s` human pacing boundary respected (`dry_run` stopped before Submit)

### Proactive Apply Offer
After tailoring a CV or reviewing a job posting, you may proactively offer to prepare and fill out the application up to the review step:
> *"Would you like me to prepare and fill out the application fields for you? I will stop before final submission to show you the complete Live DOM Read-Back Table and wait for your explicit job-specific `APPROVE`."*
Never submit without displaying the Live DOM Read-Back Table and receiving explicit, fresh, job-specific `APPROVE`.

### Multi-Step Form Filling (Hard Stop Before Final Submit)
Selecting a job or expressing intent to apply (e.g., `"1"`, `"APPLY 1"`, `"APPLY ALL GREEN"`, `"apply"`, or `"قدم"`) authorizes **preparation and non-submitting form filling ONLY — NEVER final submission**:
1. You may advance through safe **intermediate non-submitting pages** (e.g., Page 1/4 → Page 2/4 → Page 3/4) using verified `context/cv.md`, `context/resume-data.json`, and `context/form-answers.yaml` without pausing per intermediate step.
2. Pause immediately if any unknown/legal required question, account-creation/terms wall, or CAPTCHA/2FA challenge appears.
3. **Unconditional Hard Stop Before Submit:** Stop before ANY final `Submit` / `Apply` (or one-click apply) action, take a fresh `browser_snapshot`, display the complete **Live DOM Read-Back Table**, run `node ./bin/cli.mjs pre-submit`, and wait for a **separate, explicit, fresh, job-specific `APPROVE`** in chat (`dry_run: true` must never permit submission).
4. **No Implicit or Carried-Over Consent:** No inferred, ambiguous, previous-turn, blanket, batch, or general approval may authorize submission. Any material field, attachment, consent, or page-state change invalidates prior approval and requires a fresh read-back and new `APPROVE`.
5. **Submit Once & Verify:** Only after valid approval (and `dry_run: false`), reserve `needs_review` + `submission_uncertain: true`, click Submit **once**, and verify the post-submit receipt/state in a fresh `browser_snapshot` (`skills/meta-self-verification.md`).
