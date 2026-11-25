# Veycraft

**Agent-native career operations, truthful CV tailoring, and Profile Intelligence for the AI coding IDE you already use.**

[![Zero Core Dependencies](https://img.shields.io/badge/Core_CLI-0_NPM_Dependencies-2ea44f)](package.json)
[![Node >= 18](https://img.shields.io/badge/Node-%3E%3D18-339933)](package.json)
[![56 Markdown Skills](https://img.shields.io/badge/Skills-56_Markdown_Skills-167d60)](skills/REGISTRY.md)
[![Cross-Platform](https://img.shields.io/badge/OS-Windows_%7C_macOS_%7C_Linux-0969da)](.github/workflows/validate-repo.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-2ea44f)](LICENSE)
[![Veycraft MCP server](https://glama.ai/mcp/servers/redasalem/veycraft/badges/score.svg)](https://glama.ai/mcp/servers/redasalem/veycraft)

**[Interactive Demo ↗](https://redasalem.github.io/veycraft/)** · **[Quick Start](#quick-start)** · **[AI Agent Onboarding](#ai-agent-onboarding)** · **[CLI Reference](#cli-commands)** · **[Upgrade & Uninstall](#upgrade--uninstall)** · **[العربية (RTL)](README.ar.md)**

> *(Formerly `job-hunter-os` — GitHub redirects, existing `~/.job-hunter-os` directories, and legacy `job-hunter` / `job-hunter-os` CLI aliases remain fully supported.)*

- **Zero fabricated experience:** Every metric, tool, employer, and date traces back to verified local facts; unconfirmed JD requirements stay isolated under **True Gaps**.
- **Zero blind submissions:** `dry_run: true` by default; every live submit, profile save, post, or portfolio deploy requires explicit human `APPROVE`.
- **Zero npm dependencies:** Pure Node.js (`>= 18.0.0`) CLI (`dependencies: {}`, `devDependencies: {}`) plus **56 portable `agentskills.io` Markdown skills**. No external API keys or hosted backend.

All names, employers, and metrics below come from synthetic repository fixtures ([`evals/fixtures/`](evals/fixtures/candidate-profile.md)):

![Veycraft v2.7.0 10-second animated terminal demo: doctor, route, and pre-submit safety gate](assets/demo.svg)

```diff
- Built backend APIs for an e-commerce and payments app using Node.js.
+ Built idempotent Node.js and TypeScript webhook processors backed by PostgreSQL and AWS SQS,
+ reducing payment webhook p95 latency by 38% across $4.2M daily settlement volume [verified: candidate-profile.md].
! Blocked claim: "Managed multi-cluster Kubernetes" (0 verified years — isolated under True Gaps)
[ATS Keyword Coverage: 71.4% -> 92.8% (heuristic comparison, not an ATS guarantee)]
[Status: dry_run: true · Awaiting explicit job-specific human APPROVE]
```

---

## Quick Start

Requires **Node.js `>= 18.0.0`** (Windows PowerShell/CMD, macOS, Linux; **0 runtime / 0 dev npm dependencies**; Playwright & Notion MCP strictly optional).

```bash
# Step 1 — Run instantly or install globally from npm
npx --yes veycraft doctor        # or: npm install -g veycraft

# Step 2 — Link your AI coding IDE non-destructively (~/.veycraft)
veycraft init --global

# Step 3 — Launch the read-only local Web UI (127.0.0.1) or audit a CV offline
npx --yes veycraft ui            # 5-tab local UI: Readiness, Kanban, Analytics, Studio, 56 Skills
veycraft audit ./resume.docx --share
```

Inside your AI IDE chat, start immediately with:
- **`/demo`** — 15-second synthetic sandbox ([`examples/sandbox-demo/`](examples/sandbox-demo/sample-jds.md)), zero personal data or browser login.
- **`/quick-tailor`** — Tailor 1 real CV against 1 JD (`HTML` / `TXT` / Word-compatible `.doc` + True Gaps), no browser login.
- **`/profile-update`** · **`/github-audit`** · **`/build-portfolio`** · **`/portfolio-design`** · **`/linkedin-growth`** — Standalone profile, GitHub, portfolio, and LinkedIn workflows.
- **`/setup` → `/daily-run`** — Full optional Career OS when ready for browser-assisted job discovery & ATS prep.

<details>
<summary>Alternative Installs (GitHub Latest, Git Clone, Shell Installers &amp; OS Data Paths)</summary>

```bash
# Latest main directly from GitHub
npx --yes github:redasalem/veycraft doctor
npm install -g github:redasalem/veycraft

# Developers & Contributors (source install, zero build step)
git clone https://github.com/redasalem/veycraft.git && cd veycraft
node bin/cli.mjs doctor
npm link   # optional local PATH link
```

Inspectable shell installers (`--dry-run` / `--uninstall`) live at [`scripts/install.sh`](scripts/install.sh) (macOS/Linux) and [`scripts/install.ps1`](scripts/install.ps1) (Windows PowerShell) — always inspect before running.

| Environment | Default Agent Home & User Data Location (Preserved on Upgrade) |
|---|---|
| **Windows (PowerShell / CMD)** | `%USERPROFILE%\.veycraft` (preserves existing `%USERPROFILE%\.job-hunter-os`) |
| **macOS** | `~/.veycraft` (preserves existing `~/.job-hunter-os`) |
| **Linux** | `~/.veycraft`, or `$XDG_DATA_HOME/veycraft` when `XDG_DATA_HOME` is set |
| **Custom Override / Local Mode** | `VEYCRAFT_HOME=/custom/path` or current folder via `veycraft init` (`.veycraft-install.json`) |

</details>

---

## AI Agent Onboarding

Works natively with **OpenAI Codex CLI**, **Claude Code**, **Gemini CLI**, **GitHub Copilot / VS Code**, **Cursor**, **Windsurf**, **Antigravity**, **Devin Desktop**, **Cline**, **Roo Code**, **OpenCode**, **AWS Kiro**, **JetBrains Junie**, **Zed**, **Goose**, and **Aider** (see [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) and [`docs/chat-commands.md`](docs/chat-commands.md)).

```text
Install Veycraft, verify it with `veycraft doctor --json`, explain available capabilities,
and prepare it for this workspace. Do not modify personal data or perform live external
actions without explicit approval.
```

**Machine-readable agent discovery:** `veycraft --version --json`, `veycraft doctor --json`, `veycraft status --json`, and `veycraft route "<request>" --json` return structured JSON without modifying personal files or performing external actions. For MCP hosts, `npx -y veycraft mcp` starts the built-in zero-dependency `stdio` MCP server exposing 8 read-only offline tools and allowlisted `veycraft://` resources ([`mcp/README.md`](mcp/README.md)); preview or wire it into your IDE configs in one command via `veycraft sync-mcp --with-veycraft --dry-run` (then drop `--dry-run` to apply with automatic `.veycraft.bak` backups).

<details>
<summary>Target a Specific AI Tool (<code>--ide</code> Flags)</summary>

```bash
veycraft init --global --ide codex       # ~/.codex/AGENTS.md + config.toml + ~/.agents/skills
veycraft init --global --ide claude      # ~/.claude/commands + ~/.claude/skills + ~/.claude.json
veycraft init --global --ide gemini      # ~/.gemini/GEMINI.md + settings.json + ~/.gemini/skills
veycraft init --global --ide copilot     # ~/.copilot/copilot-instructions.md + mcp-config.json
veycraft init --global --ide cursor      # ~/.cursor/rules/job-hunter.mdc + ~/.cursor/mcp.json
veycraft init --global --ide windsurf    # ~/.windsurf/rules/ + workflows + mcp_config.json
veycraft init --global --ide antigravity # ~/.gemini/antigravity/global_workflows + mcp_config.json
```

</details>

---

## Core Capabilities

| Capability | Trigger / Command | Highlights |
|---|---|---|
| **Truthful CV Tailoring** | `/quick-tailor`, `/tailor-cv`, or natural language | Single-column `HTML` + `TXT` + Word-compatible `.doc` (never fake `.docx`), Evidence Map, 4-bucket ATS Keyword Heatmap, isolated **True Gaps**, original CV preserved |
| **Profile Intelligence Engine** | `/profile-update` or *"Optimize my profile"* | 7-criteria audit across `linkedin`, `wellfound`, `ats`, `job_boards`, `portfolio`, and read/draft-only `generic` fallback; schema-validated `DRAFT_ONLY` plan (`add`/`replace` only) + read-back verification |
| **GitHub CLI Audit & CV Extraction** | `/github-audit` or *"Audit my GitHub repos"* | Full-account `gh` CLI repo inventory, code-verified `context/github-projects.md` extraction (`requires_user_confirmation` metrics), `DRAFT_ONLY` README/metadata diffs, and tiered cleanup (`private`/`archive` first, per-repo `DELETE <owner>/<repo>` gate) |
| **Portfolio Builder & Deployer** | `/build-portfolio` or *"Build my portfolio website"* | Isolated local builds (`logs/portfolio/<slug>/`: Vanilla HTML/CSS/JS, Astro, Vite+React, Next.js), public PII/secret scan, `LOCAL_PREVIEW_ONLY` default, and `APPROVE`-gated deploy (`vercel`, `wrangler`, `netlify`, separate-repo `gh`, `firebase`, `surge`, or Smart Fallback) |
| **Portfolio Design System & QA Studio** | `/portfolio-design` or *"Redesign my portfolio colors"* | Pre-code `DESIGN_PLAN.md` + separated `portfolio-data`, 7 curated agency palettes + `Custom` WCAG 2.1 AA `tokens.css` (incl. Arabic RTL), 3-layer automated QA (`node --test`/isolated `vitest` + `375px`/`768px`/`1440px` → `qa-report.md`), and bounded 3-cycle Self-Healing Loop |
| **LinkedIn Growth & SEO** | `/linkedin-growth` | Dual-Engine Recruiter Search (`0–100` SEO, multi-role skills, 3-stage funnel) + Feed Algorithm (Topical Authority, Dwell Time, Comment-First, Native Format Matrix), Anti-Myth/Anti-Pod, `<= 75`-word outreach (`DRAFT_ONLY` → `APPROVE`) |
| **Multi-Source Discovery & ATS Prep** | `/daily-run`, `/apply-url <url>` | LinkedIn, Wellfound, Indeed, Glassdoor, Greenhouse, Lever, Ashby, Workday, SmartRecruiters, MENA boards, B2B networks ([`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md)), or any custom HTTPS job URL |
| **Interview, Offer & Contract Ops** | Natural language | `interview-dossier.md`, take-home blueprints, grounded offer negotiation drafts, and 6-category NDA/MSA red-flag audits |
| **No-MCP Offline Fallback** | `veycraft bundle` / Capability Matrix `A–E` | Works 100% offline without Playwright or Notion; gracefully degrades with copy-paste deliverables and local JSON ledgers |

---

## CLI Commands

Legacy aliases `job-hunter` and `job-hunter-os` map to the exact same `bin/cli.mjs` binary.

| Command | Purpose |
|---|---|
| `veycraft --help` / `--version [--json]` | Safe, read-only usage guide or version & provenance metadata |
| `veycraft doctor [--global] [--strict] [--json]` | Diagnose Node runtime, provenance, 56-skill manifest, 5 gates, `<60d` playbooks, PII hook & MCP configs |
| `veycraft init [--global] [--force] [--ide <name>]` | Non-destructively scaffold `~/.veycraft` (or workspace), link IDE skills/rules & safely merge MCP configs |
| `veycraft route "<request>" [--json]` | Deterministic natural-language Task Intent Router (minimal skills, readiness & fallback) |
| `veycraft audit <cv.md\|txt\|docx\|html\|doc> [--share]` | Offline CV hygiene audit, fake-`.docx`/scanned-PDF/SSRF/token checks & PII-safe SVG/MD scorecard |
| `veycraft verify <dir\|file> [--facts <json\|md>]` | Post-write verification for deliverables, ledgers, checkpoints, CV versions, Notion plans, and `Profile Update Plan` JSON |
| `veycraft career summary\|analytics\|dashboard\|next [--json]` | Local Career Intelligence funnel, score-band analytics (`MIN_N = 5`), read-only HTML Kanban, and prioritized action queue |
| `veycraft ui [--port <n>] [--no-open] [--workspace <dir> \| -g]` | Read-only offline local Web UI on `127.0.0.1` (Overview, Kanban, Analytics, in-memory Studio & 56 Skills explorer) |
| `veycraft mcp [--global]` | Native zero-dependency MCP `stdio` server (8 read-only offline tools + allowlisted `veycraft://` resources — [`mcp/README.md`](mcp/README.md)) |
| `veycraft pre-submit` / `veycraft eval` | Enforce daily/warm-up/platform caps, circuit breakers, dedup, banned AI clichés & `<= 75`-word cap; run `20/20` & `129/129` eval suites |

<details>
<summary>Advanced CLI Reference (Run State Machine, Atomic Ledger, Notion Sync &amp; Maintenance)</summary>

| Command | Purpose |
|---|---|
| `veycraft career run-start\|run-triage\|run-enqueue\|prepare\|run-checkpoint\|run-resume\|run-finish [--help]` | Deterministic daily-run & session-checkpoint state machine, Tier A/B/C triage, two-stage approval queue (`submission_authorized: false`), and prep package verifier |
| `veycraft career record\|reserve\|confirm-submit\|transition\|skip\|cv-register [--help]` | Lock-protected (`logs/.ledger.lock`), schema-validated atomic mutations for `logs/applications-log.json`, `logs/skipped-jobs.json`, and `logs/cv-versions.json` (+ `lock-status`, `release-stale-lock`, `recover-tx`) |
| `veycraft career migrate [--dry-run \| --apply]` / `cv-versions [--json]` | Backup-first idempotent schema v2.0 migration (`--dry-run` default) and owner CV version registry (isolates third-party CVs) |
| `veycraft career sync <subcommand> [--help]` | One-way local-to-Notion sync engine (`preview`, `status`, `verify-schema`, `approve`, `mark-in-flight`, `apply-receipt`, `record-failure`, `expire-stale`, `reconcile`, `reset-permanent`, `release-stale-lock`); zero external writes from CLI |
| `veycraft status [--global] [--json]` | Print readiness gates, warm-up caps & pipeline funnel summary |
| `veycraft proof` / `dashboard [--global] [--no-open]` / `bundle` | Regenerate proof card SVG/MD, open classic Kanban viewer, or export web-chat master prompt |
| `veycraft sync-mcp [--with-veycraft] [--dry-run]` / `login` / `unlock` / `backup` / `update` | Sync MCP TOML/JSON (with `.veycraft.bak` backups), open persistent Chromium, clean stale locks, snapshot logs, or SSH-verified update |

*(Note: when passing `--global` / `-g` with scoped `career` subcommands such as `career sync`, `career record`, `career run-start`, or `career next`, place it before `career`, e.g., `veycraft --global career sync status`.)*

</details>

---

## Privacy, Safety & Approval Gates

Veycraft separates **deterministic CLI enforcement** from **agent workflow rules** ([`docs/execution-safety.md`](docs/execution-safety.md) · [`ACCEPTANCE.md`](ACCEPTANCE.md)):

- **Deterministic CLI guards:** Registry-enforced adapters, schema/fact/cliché checks (`verify`, `audit`, `pre-submit`), lock-protected atomic ledger writes, fail-closed one-way Notion sync (`--plan-hash` + 24h TTL), `.git/hooks/pre-commit` PII blocker, and SSH-verified `update`.
- **Agent workflow guardrails:** Untrusted-DOM prompt-injection defense, upload-first ATS rule, Live DOM Read-Back Table, `DRAFT_ONLY` defaults, 24-hour anti-bot circuit breaker, and unconditional job-specific human `APPROVE`.
- **Zero private leaks:** `context/*` (except `*.example`), `logs/`, `*.pdf`, `browser-profile/`, `.env`, and local MCP configs are gitignored, blocked by pre-commit hook, and excluded from npm tarballs (`npm run pack:check`).

![Veycraft Reproducible Proof Card](assets/proof-card.svg)

---

## Upgrade & Uninstall

Upgrades and CLI uninstalls **never delete or overwrite** your private `context/`, `logs/`, `config/guardrails.yaml`, or `browser-profile/`.

```bash
# Upgrade global CLI & refresh IDE playbooks safely
npm update -g veycraft && veycraft update --global

# Uninstall CLI only (keeps ~/.veycraft data intact)
npm uninstall -g veycraft
# Optional full wipe: rm -rf ~/.veycraft  (Windows: Remove-Item -Recurse -Force "$HOME\.veycraft")
```

---

## Development, Testing & Contributing

```bash
git clone https://github.com/redasalem/veycraft.git && cd veycraft
npm test             # eval --baseline (20/20), live-agent-eval-run (20/20), and eval --journeys (116/116)
npm run pack:check   # Verifies npm pack --dry-run tarball contents and zero PII leaks
node bin/cli.mjs doctor
```

- **Documentation Index:** [`AGENTS.md`](AGENTS.md) · [`skills/REGISTRY.md`](skills/REGISTRY.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SKILL_CATALOG.md`](docs/SKILL_CATALOG.md) · [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) · [`docs/chat-commands.md`](docs/chat-commands.md) · [`docs/execution-safety.md`](docs/execution-safety.md) · [`ACCEPTANCE.md`](ACCEPTANCE.md) · [`examples/outputs/sample-tailoring-notes.md`](examples/outputs/sample-tailoring-notes.md) · [`PLATFORMS.md`](PLATFORMS.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)
- **Contribute:** See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`ACCEPTANCE.md`](ACCEPTANCE.md), and [`HIRED.md`](HIRED.md), or share an outcome via [Share Outcome Issue](https://github.com/redasalem/veycraft/issues/new?template=share-success.yml).

## License & Attribution

Inspired by open-source patterns from [`career-ops-hq/career-ops`](https://github.com/career-ops-hq/career-ops), [`obra/superpowers`](https://github.com/obra/superpowers), and [`anthropics/skills`](https://github.com/anthropics/skills) / [`agentskills.io`](https://agentskills.io/).

Licensed under the [MIT License](LICENSE) — Copyright (c) 2026 Reda Salem (`@redasalem`). See [`NOTICE`](NOTICE), [`AUTHORS.md`](AUTHORS.md), and [`PROVENANCE.json`](PROVENANCE.json).
