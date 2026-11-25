# Veycraft — Claude Code

Read [AGENTS.md](./AGENTS.md) and [skills/REGISTRY.md](./skills/REGISTRY.md) first; route natural-language requests via the Intent Router in `skills/REGISTRY.md` without forcing `/setup` for standalone tasks, and load only the active skill bodies needed.

This is a **Markdown-first career operations repository with a zero-dependency Node.js CLI (`bin/cli.mjs`)** and optional Playwright/Notion MCP. You execute workflows directly using your file tools and optional MCP tools:
- `/demo` -> `.agent/workflows/demo.md` (15-second synthetic sandbox with immediate Job #1 tailored preview; zero personal data or browser login)
- `/quick-tailor` -> `.agent/workflows/quick-tailor.md` (real CV + 1 JD fact-checked HTML/TXT tailoring; no browser login required)
- `/setup` or "Check my folder" -> `skills/00-interrogate-and-onboard.md` + `skills/01-resume-ingestion.md` (optional full Career OS onboarding)
- `/daily-run` or `/apply-url <url>` -> `skills/00-daily-run.md` (Step 0 `00-interrogate-and-onboard.md` -> `02` -> `03` -> `04` -> `05` -> `06`)
- `/tailor-cv <url>` -> `skills/03-tailor-resume-and-verify.md` (never submits)
- `/weekly-report` -> `skills/06-log-and-insights.md`
- `/linkedin-growth` -> `skills/linkedin-growth.md` (`v3.0.0` Dual-Engine Recruiter Search `0-100` SEO & Feed Algorithm, Comment-First, Native Format Matrix, Anti-Myth & Anti-Pod) + `skills/05-outreach-and-interview-prep.md` (`DRAFT_ONLY` default; explicit `APPROVE` + snapshot verification for live edits)
- `/profile-update` -> `skills/profile-intelligence-engine.md` (multi-platform profile audit, schema-valid `schemas/profile-update-plan.schema.json`, `DRAFT_ONLY` consolidated diff, batch-fill & read-back verification)
- `/github-audit` -> `skills/11-portfolio-and-github-auditor.md` (`gh` CLI full-account repo audit, recruiter README/metadata polish, tiered safe cleanup with `private`/`archive` first & per-repo `DELETE <owner>/<repo>` gate, and verified `context/github-projects.md` extraction for CV tailoring)
- `/github-remote` -> `skills/54-github-cli-remote-manager.md` (and `.agents/skills/github-cli-remote-manager/SKILL.md`: model-agnostic no-clone remote GitHub file/tree/commit/metadata/PR/Actions workflows via `gh` CLI & REST/GraphQL APIs)
- `/freelance-service` -> `skills/55-freelance-profile-and-service-publisher.md` (and `.agents/skills/freelance-profile-and-service-publisher/SKILL.md`: freelance profile audit, SEO gig/service package, custom cover image, browser fill & `APPROVE PUBLISH` gate across Upwork/Fiverr/Freelancer/Malt/Mostaql/Khamsat)
- `/freelance-bid` -> `skills/56-freelance-offer-radar-and-batch-bidder.md` (and `.agents/skills/freelance-offer-radar-and-batch-bidder/SKILL.md`: live open-project scanner, `0–100%` Fit Score ranking, concise IP-safe proposal drafts, `APPROVE <numbers>` human-paced batch submit & `tracker/freelance-proposals.md` logging)
- `/build-portfolio` -> `skills/29-portfolio-builder-and-deployer.md` + `skills/30-portfolio-design-system-and-qa.md` (isolated `logs/portfolio/<slug>/` portfolio builder across Vanilla HTML/CSS/JS, Astro, Vite+React, Next.js, pre-code `DESIGN_PLAN.md` + WCAG token lock, 3-layer QA & self-healing, pre-publish PII/secret scan, and `APPROVE`-gated `vercel`/`wrangler`/`netlify`/dedicated-`gh`/`firebase`/`surge` or Smart Fallback deploy)
- `/portfolio-design` -> `skills/30-portfolio-design-system-and-qa.md` (pre-code blueprint & separated `portfolio-data`, 7 curated palettes + `Custom` WCAG AA `tokens.css`, Arabic RTL typography, `node --test`/isolated `vitest` + `375px`/`768px`/`1440px` visual QA -> `qa-report.md`, bounded 3-cycle Self-Healing Loop)
- Cross-cutting HR JD decoding, 6–10s CV scan/risk framing, LinkedIn Recruiter SEO & domain adaptation -> `skills/28-recruiter-brand-and-domain-intelligence.md`

Connect MCP using `mcp/mcp.template.json` (or `mcp/claude_desktop_config.example.json` for Claude Desktop; persistent `./browser-profile` for Playwright and optional `NOTION_TOKEN` for Notion), and discover/load skills programmatically via the built-in `veycraft` MCP server (`veycraft_route`, `veycraft_get_skill`, `veycraft://manifest`, `veycraft://skill/<name>`). See `adapters/models/claude.md` for Claude Sonnet/Opus XML verification tuning. Local JSON under `logs/` is primary. Never invent facts, bypass challenges, or submit without gate checks.
