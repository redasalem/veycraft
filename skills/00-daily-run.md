---
name: daily-run
version: "3.0.0"
description: Load when the owner starts a job hunt run (/daily-run, /apply-url, "Run today's job run", "Start applying"); orchestrates pure-Markdown skills 00 through 06 with Playwright MCP, Notion MCP, and strict safety gates.
triggers:
  - /daily-run
  - /apply-url <url>
  - Run today's job run
  - Start applying
requires_mcp:
  - playwright
preconditions:
  - Playwright MCP connected with persistent ./browser-profile
  - readiness gates audited via skills/00-interrogate-and-onboard.md and fresh launch consent given
requires_skills:
  - interrogate-and-onboard
  - discover-and-triage
  - tailor-resume-and-verify
  - fill-and-apply
  - outreach-and-interview-prep
  - log-and-insights
  - meta-self-verification
  - meta-context-compaction
verification:
  - every enabled platform's logged-in state was verified before discovery
  - every reported applied job has a fresh browser_snapshot receipt quote in logs/applications-log.json
  - logs/runs/YYYY-MM-DD.json reflects actual counts and status completed or aborted
---
# Daily Run Orchestrator

## When to Use & Preconditions

Use for `/daily-run` (multi-job discovery and batch triage) or `/apply-url <url>` (single owner-supplied HTTPS URL). **You (the AI model)** execute the workflow directly using IDE file tools, Playwright MCP, and optional Notion MCP, while deterministic pre-submit checks run via `node ./bin/cli.mjs pre-submit`.

- **Load when:** `/daily-run`; `/apply-url <url>`; `Run today's job run`; `Start applying`.
- **Preconditions (stop if any is false):**
  - Playwright MCP connected with persistent `./browser-profile`
  - readiness gates audited via `skills/00-interrogate-and-onboard.md` and fresh launch consent given
- **Requires skills:** `interrogate-and-onboard`, `discover-and-triage`, `tailor-resume-and-verify`, `fill-and-apply`, `outreach-and-interview-prep`, `log-and-insights`, `meta-self-verification`, `meta-context-compaction`. **MCP:** playwright.

## Deterministic Step-by-Step Execution

Follow this exact sequence. Never reorder steps 0–3.

0. **Readiness Gatekeeper (`skills/00-interrogate-and-onboard.md`) & Self-Healing Pre-Flight (`veycraft doctor --fix`):**
   - Run `node ./bin/cli.mjs doctor --json` (<1 s) to verify `context/` readiness (`cv.md`, `profile.md`, `preferences.yaml`, `brief.json`), local Chrome/Edge Headless PDF availability, and global `chrome-devtools-mcp` binary status.
   - **Hard "Do, Don't Tell" Self-Healing & Native CDP Fallback (`veycraft cdp`):** If `brief.json` is missing/stale or IDE MCP config is outdated, **NEVER** ask the user to run CLI setup commands — **immediately run `node ./bin/cli.mjs doctor --fix` yourself**. If `chrome_devtools` MCP navigation/read tools (`navigate_page`, `take_snapshot`) are missing or restricted in the current session, **immediately use `node ./bin/cli.mjs cdp ...` (`status`, `open <url>`, `snapshot`, `eval`, `click`, `fill`) via terminal** (strictly bound to `127.0.0.1` with persistent `workspace/.chrome-profile/`) — **NEVER** stall, **NEVER** fall back to restricted browser subagents, and **NEVER** ask the user to reload MCP or paste JDs manually. Only pause for human-only actions (signing into a private account, solving a visible CAPTCHA/2FA, or replying `APPROVE`).
   - Inspect `context/profile.md`, `context/cv.md`, `context/preferences.yaml`, `context/form-answers.yaml`, `context/targets.yaml`, `config/guardrails.yaml`, and `assets/resume.pdf` (or `context/resume.pdf`).
   - If any file is missing, unverified, or still contains `.example` placeholders, STOP and interview the user in chat (3–4 questions at a time).
   - Once all 5 gates pass, show a concise **Mission Briefing** (roles, regions, platforms, warm-up daily cap, minimum score, `dry_run` vs live) and end with a compact **Next-Step Handoff** (rendered in the user's active conversation language) requesting explicit owner launch confirmation.

   **Stage-by-Stage User Guidance Rule:** After every completed stage below (Readiness, Discovery, Tailoring, Form Read-Back, Post-Submit Logging), end your response with a compact **Next-Step Handoff** in the user's active conversation language: (1) 1–2 bullets of what was completed, and (2) 1 clear choice or command needed next.

1. **Auth Verification (Playwright MCP):**
   - Open each enabled target's `auth_check_url` with 3–9 s pacing and take a `browser_snapshot`.
   - For `auth_required: true`, confirm an observable signed-in account indicator.
   - If an unexpected login wall, CAPTCHA, 2FA challenge, rate-limit banner, or account warning appears, STOP the entire run immediately, log `aborted` in `logs/runs/YYYY-MM-DD.json`, and notify the user.

2. **Load Context & Check Caps:**
   - Read `context/profile.md`, `context/cv.md`, `context/preferences.yaml`, `context/form-answers.yaml`, `config/guardrails.yaml`, and `logs/applications-log.json` (and initialize or refresh the daily run ledger + session checkpoint deterministically via `node ./bin/cli.mjs career run-start [--run-id <YYYY-MM-DD>] [--platforms <csv>] [--json]` or inspect `node ./bin/cli.mjs career next [--json]`).
   - Check active hours (`active_hours` in `config/guardrails.yaml`), today's UTC date (`YYYY-MM-DD`), distinct run-date warm-up cap (max 5/day on the first 3 distinct non-aborted run dates), and `max_per_platform`.
   - Do **not** auto-retry or push Notion writes during discovery; if the owner wants one-way Notion sync, inspect `veycraft career sync status` and follow the explicit approval & receipt workflow in `skills/06-log-and-insights.md` (requires live guardrails `storage_adapters.notion_mcp: true` AND `dry_run: false`).

3. **Discover, Filter Ghosts, Score & Mission Control (`skills/02-discover-and-triage.md`):**
   - For `/apply-url <url>`: skip broad discovery and inspect only that single URL.
   - Otherwise, scan enabled targets (or public Greenhouse/Lever/Ashby JSON feeds) up to `batch_size`, click `"See more"` on every JD, filter out closed/expired/>30-day ghost jobs (`logs/skipped-jobs.json` with `reason: "ghost_or_expired"` via `veycraft career run-triage --ghost`), score 0–10 against `context/cv.md` (`veycraft career run-triage`), and present the **Mission Control Table** in chat.
   - Wait for `APPLY ALL GREEN` or `APPLY 1,3,...` (in `batch_review_first` mode) before opening any application form, then enqueue only the selected non-Tier-C jobs via `veycraft career run-enqueue --job-ids <csv> --batch-selection "<reply>"` (which sets `submission_authorized: false` — batch selection authorizes preparation and form-filling only, never final submission).

4. **Preflight (< 5s), 60-Day Dedup, Apply-First Exhaustion & Automatic CV Decision (`skills/03-tailor-resume-and-verify.md`):**
   - **Preflight & 60-Day Duplicate Guard FIRST (Zero Wasted CV Generation):** Before tailoring any PDF or opening a form, check `logs/applications-log.json` for BOTH exact/normalized `job_url` AND `(normalized_company + normalized_role)` within the last **60 days** (skip immediately if matched), then inspect the job/portal in `< 5 s`: verify it is still open (not `"No longer accepting applications"`), has no fatal Step 2.5 mismatch (`skip_filter` -> compact 1-line note only), and no anti-AI trap (`[llm alert]` / adversarial DOM directive -> halt Autopilot and route to `skip` or explicit review).
   - **Apply-First Exhaustion & Zero-Loss `manual_handoff`:** For every qualified role (`fit >= 6.5/10`), NEVER give up on first friction — exhaust guest apply (`"Apply as Guest"` / `"Continue without account"`), external ATS redirects/new tabs (`--url-match` / `new_tab_target_id`), and up to 3 distinct trusted-CDP strategies before stopping. Only after exhausting automated paths on a genuine human-only gate (`CAPTCHA`, `Email OTP`, forced `Workday` account creation, or mandatory `Take-home`), log **`manual_handoff`** in `logs/skipped-jobs.json` and ALWAYS surface the **"🔗 جاهز للتقديم اليدوي"** 30-second card directly in chat while continuing the queue. Closed jobs and Step 2.5 disqualifications (`skip_filter`) get a 1-line note and ZERO CV tailoring, but an open qualified `manual_handoff` job STILL gets its CV strategy executed (`tailor_pdf` or verified `baseline-cv.pdf`) so the PDF is ready on disk. The card contains: (1) deepest resolved Direct Form URL after redirects (never a generic search page), (2) exact gate encountered, (3) CV recommendation (tailored vs baseline) with BOTH the folder path (`logs/resumes/.../`) and the full absolute PDF path, (4) numbered steps (open link, upload exact PDF, paste answers, submit) with pre-computed screening answers + Dynamic Recruiter salary figure (plus a concise email draft if the JD lists `careers@`/`jobs@`), and (5) a one-word logging hook: on `"قدمت على <company>"` / `"submitted <company>"`, log it in `logs/applications-log.json` via `career confirm-submit` and update tracking.
   - Never ask the owner whether to reuse the baseline CV or generate a tailored PDF. Only after preflight passes, apply the zero-question decision policy using `context/brief.json` `autopilot` thresholds: if `score >= 8.5/10` (`reuse_cv_threshold`) and the core stack/role is already covered by the baseline PDF, ensure/reuse `logs/resumes/_baseline/baseline-cv.pdf` via `node ./bin/cli.mjs brief --ensure-baseline-pdf --json` (or `assets/resume.pdf`); if `score` is `6.5–8.4/10` (`tailor_cv_threshold`) OR specific JD keywords/emphasis are not prominent in the baseline CV, build an evidence map from `context/profile.md`, tailor `templates/ats-resume-template.html`, run the AI Fact-Check Guard (zero unverified metrics/employers/tools) and Anti-AI Slop filter, auto-generate the role-named PDF in `logs/resumes/<company>-<role>-<job-id>/`, and verify/link the package via `veycraft career prepare --job-id <id>`.
   - **Fail-Fast Budget & Repo Hygiene:** Enforce max **3 distinct retries per form step** and max **90 seconds per job** (log blocker in `logs/skipped-jobs.json` and advance). NEVER create temporary `.mjs` or scratch files in the repository root — put any temporary helper ONLY inside gitignored `workspace/tmp/` and delete it right after execution.

5. **Continuous Queue Fill, CDP Upload & Safe Approval / Opt-In Autopilot (`skills/04-fill-and-apply.md`):**
   - Process queued jobs smoothly (`#1, #2, #3...`): upload the selected/tailored PDF **FIRST** via `node ./bin/cli.mjs cdp upload <selector> <abs_pdf_path>` (or active browser MCP upload), verify attachment in a fresh snapshot, populate verified answers and `eeo_and_compliance_defaults`, and run `veycraft pre-submit`.
   - **Honest Non-Blocking Login Wall Handoff:** If a queued job hits a login wall (e.g., LinkedIn), **NEVER** claim an agent-spawned Chrome window is visible on the user's desktop. First run `node ./bin/cli.mjs cdp close` to release the `workspace/.chrome-profile` lock, then give the user **ONE copy-pasteable command** (`node ./bin/cli.mjs cdp login` or `npx veycraft cdp login`) to run in their normal OS terminal and reply `"تم"` (or `"done"`), OR continue immediately with direct-apply / public ATS jobs in the queue.
   - **Interactive 1-Word Queue Flow (Default Safe Mode when `autopilot.auto_submit` is `false`/unset or `dry_run: true`):** Present ONE compact 6-line review card (Job/Company, Score, CV Attached: Baseline vs. Tailored PDF + filename, Filled Fields summary, DOM Read-Back check, Next in Queue) and ask **"أبعت؟ (آه / تخطي / تلقائي)"** (or English **"Submit? (APPROVE / SKIP / AUTOPILOT)"**). On explicit approval (`APPROVE` / `"آه"` / `"أعمل"` / `"ابعت"`), reserve, observe `3–9 s` pacing, execute final Submit once, verify receipt (`skills/meta-self-verification.md`), log via `career confirm-submit`, print a 1-line `✅` confirmation, and automatically advance to prepare the next queued job. On `SKIP` / `"تخطي"`, skip and advance to the next job.
   - **Opt-In Owner Autopilot Mode (`context/brief.json` `autopilot.auto_submit: true` with `dry_run: false`, or explicit `AUTOPILOT` / `"تلقائي"` directive):** Complete internal Live DOM Read-Back verification, run `veycraft pre-submit` and `career reserve`, observe `3–9 s` pacing, execute the final Submit action once, run `skills/meta-self-verification.md`, log the receipt via `career confirm-submit` (plus Notion sync preview if configured), post a compact `✅` summary card in chat, and advance smoothly through the remaining queue (pausing only on login walls, CAPTCHA/2FA, `pre-submit` blocks, or missing required facts).
   - Right after any Submit click, run `skills/meta-self-verification.md` before claiming `applied`.

6. **Outreach Drafts & Interview Dossier (`skills/05-outreach-and-interview-prep.md`):**
   - Save `interview-dossier.md` (archived full JD + emphasized evidence + top 5 interview questions) in `logs/resumes/<company>-<role>-<job-id>/`.
   - For `Score >= 8` jobs, save a `<= 75`-word draft-only `outreach-draft.md`. For email-only postings, save `email-draft.md` without sending.

7. **Log & Compact (`skills/06-log-and-insights.md` & `skills/meta-context-compaction.md`):**
   - Write every disposition to `logs/applications-log.json`, checkpoint progress every 3–5 applications via `veycraft career run-checkpoint` (reconciling on resume via `veycraft career run-resume`), and close the run via `veycraft career run-finish --status <completed|aborted>` so `logs/runs/YYYY-MM-DD.json` and `logs/runs/current-session-checkpoint.json` always derive counts from the ledger. If Notion sync is desired, prepare an allowlisted plan via `veycraft career sync preview` (`--live` only when `storage_adapters.notion_mcp: true` AND `dry_run: false`) and wait for explicit owner approval + verified receipt recording in `logs/sync-state.json`.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Opening job boards before auditing `context/` and getting explicit launch consent → ✅ always run `skills/00-interrogate-and-onboard.md` first.
- ❌ Treating `APPLY 1,3` in the Mission Control table as final Submit approval → ✅ `skills/04-fill-and-apply.md` still gates every Submit click.
- ❌ Claiming `"Application submitted"` without a fresh post-click confirmation receipt → ✅ run `skills/meta-self-verification.md`.

### Self-verification check (before reporting this step complete)
- [ ] every enabled platform's logged-in state was verified before discovery
- [ ] every reported `applied` job has a fresh `browser_snapshot` receipt quote in `logs/applications-log.json`
- [ ] `logs/runs/YYYY-MM-DD.json` reflects actual counts and status `completed` or `aborted`
