# Chat Commands & IDE Portability

All slash commands below (plus natural-language requests routed via [`skills/REGISTRY.md`](../skills/REGISTRY.md)) are executed directly by the AI model inside your IDE or CLI harness (accompanied by a lightweight zero-dependency Node.js CLI in `bin/cli.mjs` for offline audit, artifact/ledger verification, local Career Intelligence analytics/dashboard/migration, one-way Notion sync planning/approval/recovery, intent routing, proof generation, pre-submit cap/word checks, and IDE setup). Standalone CV, LinkedIn, interview-prep, offer/contract, and reporting tasks run independently without requiring `/setup`. Read `AGENTS.md` and `skills/REGISTRY.md` first.

| Alias | Fast-Start / Scope | Fallback Chat Prompt | Workflow | Primary Skill(s) |
|---|---|---|---|---|
| `/demo` | **No CV / No Browser Login** | Run the synthetic sandbox demo with immediate Job #1 tailored preview | [demo](../.agent/workflows/demo.md) | [02-discover-and-triage](../skills/02-discover-and-triage.md), [03-tailor-resume-and-verify](../skills/03-tailor-resume-and-verify.md) |
| `/quick-tailor` | **1 CV + 1 JD / No Browser Login** | Tailor my CV for this one job description with fact confirmation | [quick-tailor](../.agent/workflows/quick-tailor.md) | [01-resume-ingestion](../skills/01-resume-ingestion.md), [03-tailor-resume-and-verify](../skills/03-tailor-resume-and-verify.md), [21-ats-keyword-heatmap](../skills/21-ats-keyword-heatmap.md) |
| `/setup` | Full Career OS (optional browser login) | Setup my profile from this CV and help me log in | [setup](../.agent/workflows/setup.md) | [00-interrogate-and-onboard](../skills/00-interrogate-and-onboard.md), [01-resume-ingestion](../skills/01-resume-ingestion.md) |
| `/daily-run` | Full Career OS (`dry_run: true` default) | Run today's job discovery, CV tailoring, and gated applications | [daily-run](../.agent/workflows/daily-run.md) | [00-daily-run](../skills/00-daily-run.md) |
| `/tailor-cv` | Single URL (never submits) | Tailor my CV for this job URL; do not apply | [tailor-cv](../.agent/workflows/tailor-cv.md) | [03-tailor-resume-and-verify](../skills/03-tailor-resume-and-verify.md) |
| `/apply-url` | Single URL (`APPROVE`-gated) | Score, tailor, and safely process this one job URL | [apply-url](../.agent/workflows/apply-url.md) | [00-daily-run](../skills/00-daily-run.md) |
| `/weekly-report` | Local logs only (no MCP needed) | Generate my weekly market and skill-gap report | [weekly-report](../.agent/workflows/weekly-report.md) | [06-log-and-insights](../skills/06-log-and-insights.md) |
| `/linkedin-growth` | `DRAFT_ONLY` default (`APPROVE` for live edits) | Review my LinkedIn profile, sync it with my CV, or draft `<=75`-word outreach | [linkedin-growth](../.agent/workflows/linkedin-growth.md) | [linkedin-growth](../skills/linkedin-growth.md), [05-outreach-and-interview-prep](../skills/05-outreach-and-interview-prep.md) |
| `/profile-update` | `DRAFT_ONLY` plan (`schemas/profile-update-plan.schema.json`) | Optimize or sync my professional profile across LinkedIn and job boards | [profile-update](../.agent/workflows/profile-update.md) | [profile-intelligence-engine](../skills/profile-intelligence-engine.md), [03-tailor-resume-and-verify](../skills/03-tailor-resume-and-verify.md) |

| IDE / Harness | Canonical Instruction Entry | Workflow / Command Discovery |
|---|---|---|
| Antigravity | `AGENTS.md` + `skills/REGISTRY.md` | `.agent/workflows/` (or `~/.gemini/antigravity/global_workflows/`) |
| Cursor | `.cursor/rules/job-hunter.mdc` | `.agents/skills/` + `.agent/workflows/<command>.md` |
| Claude Code | `CLAUDE.md` | `commands/*.md` + `.agents/skills/` (global: `~/.claude/commands/` + `~/.claude/skills/`) |
| OpenAI Codex CLI | `AGENTS.md` + `$CODEX_HOME/AGENTS.md` | `.agents/skills/*/SKILL.md` (global: `~/.agents/skills/`) + `config.toml` `[mcp_servers.*]` |
| Google Gemini CLI | `GEMINI.md` + `~/.gemini/GEMINI.md` | `.agents/skills/` (global: `~/.gemini/skills/`) + `settings.json` |
| OpenCode / Zed / Goose | `AGENTS.md` / `opencode.json` / `.rules` | `.agents/skills/*/SKILL.md` (global: `~/.agents/skills/`) |
| Windsurf / Devin Desktop | `.windsurfrules` | `.agent/workflows/` (global: `~/.windsurf/workflows/`) |
| Cline / Roo / Kiro / Junie | `.clinerules` / `.roo/rules/` / `.kiro/steering/` / `.junie/` | Chat prompt + `init --ide <name>` + optional MCP settings |
| GitHub Copilot & VS Code | `.github/copilot-instructions.md` + `~/.copilot/copilot-instructions.md` | `.github/prompts/` + `.agents/skills/` + `.vscode/mcp.json` / `~/.copilot/mcp-config.json` |
