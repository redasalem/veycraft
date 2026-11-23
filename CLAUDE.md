# Veycraft — Claude Code

Read [AGENTS.md](./AGENTS.md) and [skills/REGISTRY.md](./skills/REGISTRY.md) first; route natural-language requests via the Intent Router in `skills/REGISTRY.md` without forcing `/setup` for standalone tasks, and load only the active skill bodies needed.

This is a **Markdown-first career operations repository with a zero-dependency Node.js CLI (`bin/cli.mjs`)** and optional Playwright/Notion MCP. You execute workflows directly using your file tools and optional MCP tools:
- `/demo` -> `.agent/workflows/demo.md` (15-second synthetic sandbox with immediate Job #1 tailored preview; zero personal data or browser login)
- `/quick-tailor` -> `.agent/workflows/quick-tailor.md` (real CV + 1 JD fact-checked HTML/TXT tailoring; no browser login required)
- `/setup` or "Check my folder" -> `skills/00-interrogate-and-onboard.md` + `skills/01-resume-ingestion.md` (optional full Career OS onboarding)
- `/daily-run` or `/apply-url <url>` -> `skills/00-daily-run.md` (Step 0 `00-interrogate-and-onboard.md` -> `02` -> `03` -> `04` -> `05` -> `06`)
- `/tailor-cv <url>` -> `skills/03-tailor-resume-and-verify.md` (never submits)
- `/weekly-report` -> `skills/06-log-and-insights.md`
- `/linkedin-growth` -> `skills/linkedin-growth.md` + `skills/05-outreach-and-interview-prep.md` (`DRAFT_ONLY` default; explicit `APPROVE` + snapshot verification for live edits)
- `/profile-update` -> `skills/profile-intelligence-engine.md` (multi-platform profile audit, schema-valid `schemas/profile-update-plan.schema.json`, `DRAFT_ONLY` consolidated diff, batch-fill & read-back verification)
- Cross-cutting HR JD decoding, 6–10s CV scan/risk framing, LinkedIn Recruiter SEO & domain adaptation -> `skills/28-recruiter-brand-and-domain-intelligence.md`

Connect MCP using `mcp/mcp.template.json` (or `mcp/claude_desktop_config.example.json` for Claude Desktop; persistent `./browser-profile` for Playwright and optional `NOTION_TOKEN` for Notion). See `adapters/models/claude.md` for Claude Sonnet/Opus XML verification tuning. Local JSON under `logs/` is primary. Never invent facts, bypass challenges, or submit without gate checks.
