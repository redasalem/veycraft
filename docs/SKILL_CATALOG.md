# Consolidated 56-Skill Catalog & URL Construction Guide

Every skill in `veycraft` (`56` consolidated skills total: `38` core/career playbooks, `4` `meta-*` skills, `7` platform playbooks, and `7` ATS engines) follows the **`agentskills.io` / `SKILL.md` progressive disclosure standard** (`skills/REGISTRY.md` & `skills/skills-manifest.json`), loading only when its trigger matches the active phase of work.

---

## 1. Core & Career-Ops Playbooks (38 Skills)

| # | Skill File | Responsibility |
|---|---|---|
| `00` | [`skills/00-daily-run.md`](../skills/00-daily-run.md) | End-to-end orchestrator for `/daily-run` and `/apply-url` |
| `00` | [`skills/00-interrogate-and-onboard.md`](../skills/00-interrogate-and-onboard.md) | 5-gate readiness audit, live profile URL reachability check, and 3–4-question batched interview |
| `01` | [`skills/01-resume-ingestion.md`](../skills/01-resume-ingestion.md) | Pure-AI CV extraction from chat, Markdown, or PDF into `context/profile.md` & `context/cv.md` |
| `02` | [`skills/02-discover-and-triage.md`](../skills/02-discover-and-triage.md) | Search URL construction, ghost-job filter (`>30d` / closed), `0–10` scoring, and Mission Control Table |
| `03` | [`skills/03-tailor-resume-and-verify.md`](../skills/03-tailor-resume-and-verify.md) | Anti-hallucination evidence mapping, anti-AI-slop humanizer, 1-page A4 overflow budget, and PDF export |
| `04` | [`skills/04-fill-and-apply.md`](../skills/04-fill-and-apply.md) | Upload-first form filling, EEO/GDPR compliance defaults, Live DOM Read-Back Table, and `APPROVE` gate |
| `05` | [`skills/05-outreach-and-interview-prep.md`](../skills/05-outreach-and-interview-prep.md) | `interview-dossier.md`, `<= 75`-word `outreach-draft.md`, `email-draft.md`, and `/linkedin-growth` |
| `06` | [`skills/06-log-and-insights.md`](../skills/06-log-and-insights.md) | Local-first v2 ledger (`logs/applications-log.json`, `logs/cv-versions.json`), `veycraft career` analytics (`MIN_N = 5`), `/weekly-report`, and one-way approval-gated Notion sync (`logs/sync-state.json`) |
| `07` | [`skills/07-persona-switcher.md`](../skills/07-persona-switcher.md) | Multi-persona career tracks under `context/personas/` |
| `08` | [`skills/08-follow-up-radar.md`](../skills/08-follow-up-radar.md) | 7-day `applied` follow-up radar (`<= 75`-word draft-only check-ins) |
| `09` | [`skills/09-offer-negotiator.md`](../skills/09-offer-negotiator.md) | Salary & B2B hourly/monthly rate negotiation drafter (`DRAFT_ONLY`) |
| `10` | [`skills/10-autonomous-scheduler-loop.md`](../skills/10-autonomous-scheduler-loop.md) | Scheduled `/loop` runner inside `active_hours` and Days 1–3 warm-up caps |
| `11` | [`skills/11-portfolio-and-github-auditor.md`](../skills/11-portfolio-and-github-auditor.md) | `gh` CLI full-account GitHub auditor (`requires_mcp: none`, optional `playwright`), recruiter README/metadata marketing optimizer, tiered safe repo cleanup (`private`/`archive`/per-repo `DELETE` gate), verified `context/github-projects.md` CV extractor, and live portfolio link checker |
| `12` | [`skills/12-recruiter-inbox-triage.md`](../skills/12-recruiter-inbox-triage.md) | Recruiter message classification, `logs/applications-log.json` status update, and slot drafting |
| `13` | [`skills/13-company-due-diligence.md`](../skills/13-company-due-diligence.md) | Employer domain verification, layoff/repost churn signals, and `GREEN`/`YELLOW`/`RED` Health Badges |
| `14` | [`skills/14-privacy-pii-shield.md`](../skills/14-privacy-pii-shield.md) | PII, token, cookie, and pre-commit redaction shield |
| `15` | [`skills/15-multilingual-adaptation.md`](../skills/15-multilingual-adaptation.md) | Arabic (`dir="rtl"`), German, French, and Spanish resume & outreach localization |
| `16` | [`skills/16-rejection-pattern-analyzer.md`](../skills/16-rejection-pattern-analyzer.md) | Rejection & `>= 14d` silence pattern detector (`n >= 5` floor, causal humility) |
| `17` | [`skills/17-score-calibration.md`](../skills/17-score-calibration.md) | Score-band callback yield verifier (`separating`/`flat`/`inverted`/`insufficient`) |
| `18` | [`skills/18-condition-based-browser-waiting.md`](../skills/18-condition-based-browser-waiting.md) | Snapshot readiness checks & `Role -> Label -> Placeholder -> Text` locator priority |
| `19` | [`skills/19-on-demand-mcp-routing.md`](../skills/19-on-demand-mcp-routing.md) | Phase-gated Playwright & Notion MCP invocation to eliminate token bloat |
| `20` | [`skills/20-skill-authoring-standard.md`](../skills/20-skill-authoring-standard.md) | Contributor TDD, progressive disclosure (`< 500` lines), and CI contract guide |
| `21` | [`skills/21-ats-keyword-heatmap.md`](../skills/21-ats-keyword-heatmap.md) | Deterministic Before vs. After ATS Keyword Match % across 4 buckets |
| `22` | [`skills/22-technical-assessment-architect.md`](../skills/22-technical-assessment-architect.md) | Take-home challenge & system design blueprint, edge-case matrix, and live defense Q&A |
| `23` | [`skills/23-contract-and-nda-auditor.md`](../skills/23-contract-and-nda-auditor.md) | Employment contract, B2B MSA, and NDA red-flag clause auditor & counter-clause drafter |
| `24` | [`skills/24-circuit-breaker-and-antiban.md`](../skills/24-circuit-breaker-and-antiban.md) | Anti-bot circuit breaker & 24-hour platform cooldown (`logs/circuit-breaker.json`) |
| `25` | [`skills/25-prompt-injection-defense.md`](../skills/25-prompt-injection-defense.md) | Untrusted-DOM prompt-injection defense, honeypot guard, and recruiter attention-check detector |
| `26` | [`skills/26-deduplication-and-blacklist-guard.md`](../skills/26-deduplication-and-blacklist-guard.md) | Employer/domain blacklist & cross-channel canonical job fingerprinting (`company::role_title`) |
| `27` | [`skills/27-universal-cv-builder.md`](../skills/27-universal-cv-builder.md) | Universal CV builder for any person/field with persistent `cv-profile.json` and third-party isolation (`logs/resumes/cv-<slug>/`, `owner_scope: "third_party"`) |
| `28` | [`skills/28-recruiter-brand-and-domain-intelligence.md`](../skills/28-recruiter-brand-and-domain-intelligence.md) | Cross-cutting Senior HR JD decoder, 6–10s CV scan & truthful risk framing, LinkedIn Recruiter SEO & dynamic multi-industry adapter |
| `29` | [`skills/29-portfolio-builder-and-deployer.md`](../skills/29-portfolio-builder-and-deployer.md) | Isolated portfolio website builder (`logs/portfolio/<slug>/`: Vanilla HTML/CSS/JS, Astro, Vite+React, Next.js), pre-publish PII/secret gate, and `APPROVE`-gated multi-CLI deployer (`vercel`, `wrangler`, `netlify`, dedicated-repo `gh`, `firebase`, `surge`, or Smart Fallback) |
| `30` | [`skills/30-portfolio-design-system-and-qa.md`](../skills/30-portfolio-design-system-and-qa.md) | Agency-grade portfolio design system studio (`7` palettes + `Custom` WCAG AA `tokens.css`, LTR & Arabic RTL typography), pre-code `DESIGN_PLAN.md` + separated `portfolio-data`, 3-layer QA (`node --test`/isolated `vitest` + `375px`/`768px`/`1440px` -> `qa-report.md`), and bounded 3-cycle Self-Healing Loop |
| `54` | [`skills/54-github-cli-remote-manager.md`](../skills/54-github-cli-remote-manager.md) | Model-agnostic no-clone GitHub CLI & REST/GraphQL remote operations (`gh api` Contents/Git Data commits, `LICENSE`/topics/visibility updates, PR/issue/Actions ops & read-back verification) |
| `55` | [`skills/55-freelance-profile-and-service-publisher.md`](../skills/55-freelance-profile-and-service-publisher.md) | Universal freelance marketplace profile auditor & SEO gig/service publisher with custom cover image generation, live browser fill, and explicit `APPROVE PUBLISH` gate (`/freelance-service`) |
| `56` | [`skills/56-freelance-offer-radar-and-batch-bidder.md`](../skills/56-freelance-offer-radar-and-batch-bidder.md) | Global freelance open-project scanner, 4-signal filter, `Fit Score (0–100%)` ranking, concise IP-safe proposal drafts, `APPROVE <numbers>` paced submission & `tracker/freelance-proposals.md` logging (`/freelance-bid`) |
| `—` | [`skills/linkedin-growth.md`](../skills/linkedin-growth.md) | Dual-Engine LinkedIn Recruiter Search (`0–100` SEO, multi-role skills, 3-stage funnel) & Feed Algorithm Strategist (Topical Authority, Dwell Time, Comment-First, Native Format Matrix, Anti-Myth & Anti-Pod; `DRAFT_ONLY` default, `APPROVE`-gated live edits) |
| `—` | [`skills/profile-intelligence-engine.md`](../skills/profile-intelligence-engine.md) | Cross-platform Profile Intelligence Engine: schema-validated update plans, adapter contracts, batch-fill & fresh read-back |
| `—` | [`skills/fallback-no-mcp.md`](../skills/fallback-no-mcp.md) | Non-MCP & missing-capability fallback (Web AI chats & manual-assisted IDE flows) |

---

## 2. Four Agent Reliability Meta-Skills

- [`skills/meta-self-verification.md`](../skills/meta-self-verification.md) — Forbids reporting `"applied"` or `"updated"` without a fresh post-click `browser_snapshot` receipt quote.
- [`skills/meta-dom-recovery.md`](../skills/meta-dom-recovery.md) — Recovers from stale refs after modal transitions, iframes, overlays, and lazy-loaded job lists.
- [`skills/meta-context-compaction.md`](../skills/meta-context-compaction.md) — Checkpoints long runs to `logs/runs/current-session-checkpoint.json` every 3–5 applications.
- [`skills/meta-structured-debugging.md`](../skills/meta-structured-debugging.md) — Diagnoses inline form validation errors from the accessibility tree and repairs only with verified facts.

---

## 3. Consolidated Platform & Employer ATS Playbooks (14 Playbooks)

All platform playbooks carry `last_verified: "2026-11-18"` in YAML frontmatter (audited for 60-day freshness by `npx github:redasalem/veycraft doctor`):

| Platform / Family | URL Template Pattern | Consolidated Playbook |
|---|---|---|
| **LinkedIn Jobs** | `https://www.linkedin.com/jobs/search/?keywords={{ROLE_ENCODED}}&f_WT=2&f_TPR=r86400` | [`skills/platforms/linkedin.md`](../skills/platforms/linkedin.md) |
| **Wellfound (AngelList)** | `https://wellfound.com/role/r/{{ROLE_SLUG}}` | [`skills/platforms/wellfound.md`](../skills/platforms/wellfound.md) |
| **Indeed / Glassdoor / Dice / ZipRecruiter / StepStone (DACH) / Naukri (India)** | Global, DACH & India search templates in [`context/targets.yaml.example`](../context/targets.yaml.example) | [`skills/platforms/global-boards.md`](../skills/platforms/global-boards.md) |
| **WeWorkRemotely / RemoteOK / Welcome to the Jungle / BuiltIn** | Remote search templates in [`context/targets.yaml.example`](../context/targets.yaml.example) | [`skills/platforms/remote-boards.md`](../skills/platforms/remote-boards.md) |
| **Wuzzuf / Bayt / GulfTalent (MENA / GCC)** | Search templates in [`context/targets.yaml.example`](../context/targets.yaml.example) | [`skills/platforms/mena-boards.md`](../skills/platforms/mena-boards.md) |
| **Toptal / Braintrust / Lemon.io / Gun.io / Contra / Arc.dev / Turing** | Curated B2B contract portals + rate-card floor checks | [`skills/platforms/b2b-contract-networks.md`](../skills/platforms/b2b-contract-networks.md) |
| **Unified ATS Router + 7 Dedicated Engine Playbooks** | [`greenhouse.md`](../skills/ats/greenhouse.md), [`lever.md`](../skills/ats/lever.md), [`ashby.md`](../skills/ats/ashby.md), [`smartrecruiters.md`](../skills/ats/smartrecruiters.md), [`breezyhr.md`](../skills/ats/breezyhr.md), [`workday.md`](../skills/ats/workday.md), [`taleo.md`](../skills/ats/taleo.md) | [`skills/platforms/ats-engines.md`](../skills/platforms/ats-engines.md) |
