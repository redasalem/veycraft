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
   - **Hard "Do, Don't Tell" Self-Healing Rule:** If `brief.json` is missing/stale or any detected IDE MCP config is missing or using slow `npx`, **NEVER** ask the user to run CLI setup commands (`sync-mcp`, `doctor`, `brief`, etc.) when you have terminal access — **immediately run `node ./bin/cli.mjs doctor --fix` yourself**. Only ask the user for UI-only actions you cannot execute (clicking **Reload Window** once if `ide_reload_required: true`, logging into a site, or replying `APPROVE`), or proceed immediately via CLI/draft fallback (`skills/fallback-no-mcp.md`) so the user never stalls.
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

4. **Tailor & Fact-Check (`skills/03-tailor-resume-and-verify.md`):**
   - Build an evidence map from `context/profile.md`, tailor `templates/ats-resume-template.html`, run the AI Fact-Check Guard (zero unverified metrics/employers/tools) and Anti-AI Slop filter, save/print `logs/resumes/<company>-<role>-<job-id>/resume.pdf` via Playwright MCP, and verify/link the prepared package via `veycraft career prepare --job-id <id>`.

5. **Fill Form & Approval Gate (`skills/04-fill-and-apply.md`):**
   - Upload the tailored PDF **FIRST**, wait 4 s, take a fresh `browser_snapshot`, fill verified answers and `eeo_and_compliance_defaults`, pause on any unknown question, and stop before Submit to ask for exact `APPROVE` in chat (or stop cleanly if `dry_run: true`).
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
