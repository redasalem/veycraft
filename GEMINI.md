# Veycraft — Gemini CLI & Antigravity

Read [AGENTS.md](./AGENTS.md) and [skills/REGISTRY.md](./skills/REGISTRY.md) first; route natural-language requests via the Intent Router in `skills/REGISTRY.md` without forcing `/setup` for standalone tasks, and load only the active skill bodies needed.

This is a **Markdown-first career operations repository with a zero-dependency Node.js CLI (`bin/cli.mjs`)** and optional Playwright/Notion MCP. Execute workflows directly using your file tools and optional MCP tools:
- `/demo` -> `.agent/workflows/demo.md` + `examples/sandbox-demo/expected-mission-control.md` (instant synthetic preview; no personal data or browser login)
- `/quick-tailor` -> `.agent/workflows/quick-tailor.md` (1 real CV + 1 JD fact-checked HTML/TXT tailoring; no browser login)
- `/setup` or "Check my folder" -> `skills/00-interrogate-and-onboard.md` + `skills/01-resume-ingestion.md`
- `/daily-run` or `/apply-url <url>` -> `skills/00-daily-run.md`
- `/tailor-cv <url>` -> `skills/03-tailor-resume-and-verify.md`
- `/weekly-report` -> `skills/06-log-and-insights.md`
- `/linkedin-growth` -> `skills/linkedin-growth.md` + `skills/05-outreach-and-interview-prep.md`
- `/profile-update` -> `skills/profile-intelligence-engine.md` (multi-platform Profile Intelligence Engine, `schemas/profile-update-plan.schema.json`, `DRAFT_ONLY` consolidated diff, batch-fill & fresh read-back)
- Persona switch -> `skills/07-persona-switcher.md`
- 7-day follow-up -> `skills/08-follow-up-radar.md`
- Offer negotiation -> `skills/09-offer-negotiator.md`
- Scheduled `/loop` -> `skills/10-autonomous-scheduler-loop.md`
- `/github-audit` or GitHub/Portfolio audit, cleanup & CV extraction -> `skills/11-portfolio-and-github-auditor.md` (`gh` CLI inventory, `context/github-projects.md`, `DRAFT_ONLY` marketing diffs, `private`/`archive` first, per-repo typed `DELETE <owner>/<repo>` gate)
- Recruiter inbox triage -> `skills/12-recruiter-inbox-triage.md`
- Company due diligence -> `skills/13-company-due-diligence.md`
- Privacy & PII redaction shield -> `skills/14-privacy-pii-shield.md`
- Multilingual CV adaptation -> `skills/15-multilingual-adaptation.md`
- Rejection pattern analyzer -> `skills/16-rejection-pattern-analyzer.md`
- Score calibration report -> `skills/17-score-calibration.md`
- Condition-based browser waiting -> `skills/18-condition-based-browser-waiting.md`
- On-demand MCP routing -> `skills/19-on-demand-mcp-routing.md`
- Authoring new skills -> `skills/20-skill-authoring-standard.md`
- ATS keyword heatmap -> `skills/21-ats-keyword-heatmap.md`
- Take-home / system design architect -> `skills/22-technical-assessment-architect.md`
- Contract & B2B NDA auditor -> `skills/23-contract-and-nda-auditor.md`
- Anti-bot circuit breaker & 24h cooldown -> `skills/24-circuit-breaker-and-antiban.md`
- Untrusted-DOM prompt-injection defense -> `skills/25-prompt-injection-defense.md`
- Cross-channel deduplication & blacklist guard -> `skills/26-deduplication-and-blacklist-guard.md`
- Universal CV builder (any person/field, with/without prior CV & iterative edits) -> `skills/27-universal-cv-builder.md`
- Recruiter, personal-brand, LinkedIn SEO & domain-agnostic market intelligence -> `skills/28-recruiter-brand-and-domain-intelligence.md`
- `/build-portfolio` or personalized portfolio website build & deploy -> `skills/29-portfolio-builder-and-deployer.md` (isolated `logs/portfolio/<slug>/`, 4-tier stack matrix, PII/secret scan, `LOCAL_PREVIEW_ONLY` -> `APPROVE`-gated CLI deploy)

See `adapters/models/gemini.md` for Gemini-specific multimodal & snapshot verification guidance. Respect `dry_run: true`, verified facts only, caps, and explicit `APPROVE` gates.
