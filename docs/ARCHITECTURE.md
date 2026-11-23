# System Architecture & Execution Lifecycle

`veycraft` combines **52 Markdown-first skills** (loaded progressively by your existing AI IDE or CLI harness) with a **zero-dependency Node.js CLI (`bin/cli.mjs`, `dependencies: {}`, `devDependencies: {}`)**.

> **Enforcement Transparency:** Deterministic validations (`pre-submit` cap/word/cliché checks, `career` ledger lifecycle writes, run-session/checkpoint orchestration, preparation verification, `next` queue planning, analytics/migration, `career sync` offline planning/approval/locking/receipts/reconciliation, `eval`, `proof`, `audit`, `verify`, `doctor`, `backup`, `unlock`, Git pre-commit PII hook) run locally in `bin/cli.mjs`, `bin/career-intelligence.mjs`, and `bin/notion-sync.mjs`. Semantic workflow steps (CV fact-checking, prompt-injection quarantine, DOM inspection, and human `APPROVE` gating) are agent workflow requirements in `AGENTS.md` and `skills/*.md`—see [`docs/execution-safety.md`](execution-safety.md).

---

## 1. End-to-End Architecture

```text
USER CHAT: Natural-Language Request OR /demo | /quick-tailor | /setup | /daily-run | /apply-url URL | /tailor-cv URL | /weekly-report | /linkedin-growth
                               |
                               v
+--------------------------------------------------------------------+
| AI IDE + Model (Antigravity / Cursor / Claude / Codex / OpenCode)  |
| Reads AGENTS.md + skills/REGISTRY.md (Intent Router & Disclosure)  |
+-------------------------------+------------------------------------+
                                |
          +---------------------+---------------------+
          | Standalone / Fast-Start (No /setup Wall)  | Full Career OS
          v                                           v
+-------------------------------+       +------------------------------------+
| CV CRUD, /demo, /quick-tailor,|       | 00-interrogate-and-onboard (5 Gates)|
| LinkedIn, JD Rank, Prep, Logs |       | Audits context/ + live URLs -> Go  |
+-------------------------------+       +-----------------+------------------+
+-------------------------------+                         |
                                     +--------------------+--------------------+
                                     v                                         v
                       +-----------------------------+           +-------------------------------+
                       | Optional Playwright MCP     |           | Local Files (Primary Truth)   |
                       | ./browser-profile (private) |---------->| context/ + templates/         |
                       | snapshots / refs / uploads  |           | logs/applications-log.json    |
                       +-----------------------------+           | logs/cv-versions.json         |
                                                                 | logs/sync-state.json (1-way)  |
                                                                 | logs/circuit-breaker.json     |
                                                                 +---------------+---------------+
                                                                                 | (opt-in, live guardrails +
                                                                                 |  explicit owner approval)
                                                                                 v
                                                                 +-------------------------------+
                                                                 | Optional Notion MCP (1-way)   |
                                                                 | Applications / Runs / Insights|
                                                                 +-------------------------------+
```

---

## 2. Six-Phase Execution Pipeline

```text
Phase 0  READ context/ -> missing or .example placeholders or dead 404 URLs?
         +-- YES -> HARD BLOCK -> 3-4 questions in chat -> save to context/
         +-- NO  -> Mission Briefing -> wait for explicit launch confirmation

Phase 1  CIRCUIT BREAKER & AUTH CHECK (skills/24-circuit-breaker-and-antiban.md)
         -> check logs/circuit-breaker.json -> verify signed-in session (3-9 s pacing)

Phase 2  DISCOVER, INJECTION DEFENSE & DEDUPLICATION (skills/02, skills/25, skills/26, skills/28)
         -> construct URL from context/targets.yaml -> expand full JD ("See more")
         -> scan UNTRUSTED_EXTERNAL_DATA for prompt injections & recruiter codewords
         -> check blacklisted_companies / domains & canonical company::role_title fingerprint
         -> filter ghost jobs (>30d / closed) -> score 0-10 -> present Mission Control Table

Phase 3  TAILOR, KEYWORD HEATMAP & OVERFLOW GATE (skills/03, skills/21, skills/28)
         -> compute Before vs. After ATS Keyword Match % table
         -> Fact-Check Guard (0 hallucinated metrics/tools) + Humanizer (0 AI clichés)
         -> verify 1-page A4 character/line budget -> export PDF via Playwright MCP

Phase 4  UPLOAD-FIRST FILL, DOM READ-BACK & APPROVE GATE (skills/04, skills/18)
         -> upload tailored resume.pdf FIRST -> condition-based snapshot check
         -> fill verified answers + EEO/GDPR defaults (leave honeypots blank)
         -> take fresh browser_snapshot -> display Live DOM Read-Back Table
         -> dry_run stops before Submit | live mode waits for exact job-bound "APPROVE"
         -> reserve needs_review -> click Submit ONCE -> verify confirmation receipt

Phase 5  DOSSIER, OUTREACH, ANALYTICS & ONE-WAY SYNC (skills/05, skills/06)
         -> save interview-dossier.md + draft-only outreach-draft.md (<= 75 words)
         -> update logs/applications-log.json (v2) + logs/runs/YYYY-MM-DD.json + logs/runs/current-session-checkpoint.json + logs/cv-versions.json via `veycraft career` lifecycle/run commands
         -> local workflow queue, analytics & dashboard via `veycraft career next|summary|analytics|dashboard` (MIN_N = 5)
         -> optional one-way Notion sync via `veycraft career sync` (preview -> approve -> mark-in-flight
            -> external MCP -> apply-receipt / record-failure / reconcile into logs/sync-state.json)
```

---

## 3. Readiness Interrogation Transcript Example (`/setup`)

> **Developer:** `/daily-run`
>
> **Agent:** Applications are blocked until all 5 readiness gates pass:
> - ❌ Gate 1 (CV, Profile & Live Links): `context/profile.md` still has `.example` placeholders.
> - ❌ Gate 2 (Targets): `context/preferences.yaml` missing target roles/regions.
> - ❌ Gate 3 (Legal & Comp): `context/form-answers.yaml` has `owner_verified: false`.
> - ❌ Gate 4 (Skills Matrix): Core skill years unconfirmed.
> - ❌ Gate 5 (Platforms): No enabled targets in `context/targets.yaml`.
>
> First 4 questions: (1) Paste your CV or drop `assets/resume.pdf`. (2) What target roles & seniority? (3) Remote/Hybrid/Onsite, allowed regions, and timezone? (4) Any blacklisted companies or domains?
>
> **Developer:** *[Shares CV]* Senior Full-Stack Engineer, Remote (UTC+2), blacklist `Example Spam Corp`.
>
> **Agent:** Extracted your CV facts and verified your GitHub/Portfolio links return HTTP 200. Next 4 questions: (1) Minimum salary, currency, and period? (2) Notice period / earliest start date? (3) Work authorization & visa sponsorship needs? (4) Exact hands-on years for TypeScript, React, Node.js, and PostgreSQL?
>
> **Developer:** USD 5,000/month, 30 days notice, Egypt authorized / sponsorship needed for EU relocation, TypeScript 5, React 5, Node.js 5, PostgreSQL 4.
>
> **Agent:** All 5 gates ✅. Mission Briefing: Senior Full-Stack Engineer (Remote), LinkedIn + Wellfound, warm-up cap 5/day, min score 7, **dry_run: ON**. Confirm to launch?
