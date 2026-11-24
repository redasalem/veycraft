# Veycraft

**Agent-native career operations, truthful CV tailoring, and Profile Intelligence for the AI coding IDE you already use.**

[![Zero Core Dependencies](https://img.shields.io/badge/Core_CLI-0_NPM_Dependencies-2ea44f)](package.json)
[![Node >= 18](https://img.shields.io/badge/Node-%3E%3D18-339933)](package.json)
[![53 Markdown Skills](https://img.shields.io/badge/Skills-53_Markdown_Skills-167d60)](skills/REGISTRY.md)
[![Cross-Platform](https://img.shields.io/badge/OS-Windows_%7C_macOS_%7C_Linux-0969da)](.github/workflows/validate-repo.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-2ea44f)](LICENSE)

**[Interactive Demo ↗](https://redasalem.github.io/veycraft/)** · **[Quick Start](#quick-start)** · **[AI Agent Onboarding](#ai-agent-onboarding)** · **[CLI Reference](#cli-commands)** · **[Upgrade & Uninstall](#upgrade--uninstall)** · **[العربية (RTL)](README.ar.md)**

> *(Formerly `job-hunter-os` — GitHub redirects, existing `~/.job-hunter-os` directories, and legacy `job-hunter` / `job-hunter-os` CLI aliases remain fully supported.)*

---

## Why Veycraft

Give your existing AI coding agent (**OpenAI Codex, Claude Code, Gemini CLI, GitHub Copilot, Cursor, Windsurf, Antigravity, Cline, OpenCode**) one CV and one job description—or ask in plain English or Arabic. Veycraft generates fact-checked resumes (`HTML` / `TXT` / Word-compatible `.doc`), transparent **Evidence Maps**, **ATS Keyword Comparisons**, schema-validated **Profile Intelligence** plans, and explicit **True Gaps**.

- **Zero fabricated experience:** Every metric, tool, employer, and date traces back to verified local facts.
- **Zero blind submissions:** `dry_run: true` by default; every live submit or profile save requires explicit human `APPROVE`.
- **Zero npm dependencies:** Pure Node.js (`>= 18`) CLI (`dependencies: {}`, `devDependencies: {}`) plus 53 portable `agentskills.io` Markdown skills. No external API keys or hosted backend.

---

## Quick Start

Choose one of three installation paths (all safe, non-destructive, and zero-dependency):

### 1. Try Without Installing (`npx`)
Run immediately from any directory without cloning or writing personal files:

```bash
# Works today directly from GitHub (Windows PowerShell/CMD, macOS, Linux):
npx --yes github:redasalem/veycraft --help
npx --yes github:redasalem/veycraft doctor

# Short npm command (package name `veycraft` is verified available & pack-ready; enabled once published to npm):
# npx --yes veycraft --help
```

### 2. Install CLI Globally (`npm install -g`)
Install the `veycraft` command once and use it from any workspace:

```bash
# Works today directly from GitHub:
npm install -g github:redasalem/veycraft

# Short npm command (once published to npm):
# npm install -g veycraft

# Verify immediately:
veycraft --help
veycraft --version
veycraft doctor
```

### 3. Clone / Source Installation (Developers & Contributors)
Run directly from source with zero build step:

```bash
git clone https://github.com/redasalem/veycraft.git
cd veycraft
node bin/cli.mjs --help
node bin/cli.mjs doctor

# Optional: link `veycraft` locally into your PATH during development
npm link
```

*(Inspectable shell installers with `--dry-run` and `--uninstall` are also available at [`scripts/install.sh`](scripts/install.sh) for macOS/Linux and [`scripts/install.ps1`](scripts/install.ps1) for Windows PowerShell—always inspect before running rather than blindly piping remote scripts into a shell.)*

---

## Requirements

| Requirement | Details |
|---|---|
| **Node.js** | `>= 18.0.0` (tested on Node 22+ across Ubuntu, macOS, and Windows) |
| **OS & Shells** | Windows 10/11 (PowerShell & CMD), macOS, Linux (respects `VEYCRAFT_HOME` and `XDG_DATA_HOME`) |
| **Dependencies** | **0 runtime / 0 dev npm dependencies** (`package.json`) |
| **Optional Tools** | Playwright MCP (only for live browser form-filling / PDF print) · Notion MCP (only if syncing to Notion) |

---

## First Run (Safe, Read-Only → Guided Setup)

```bash
# 1. Inspect runtime, provenance, and readiness (read-only; machine-readable with --json)
veycraft doctor
veycraft doctor --json

# 2. Scaffold global agent home (~/.veycraft) and non-destructively link AI IDE skills/MCP
veycraft init --global

# 3. Try an instant offline CV hygiene audit (accepts .md, .txt, .docx, .html, .doc)
veycraft audit ./resume.docx --share

# 4. Or test natural-language skill routing without modifying any files
veycraft route "Optimize my LinkedIn profile and align it with my CV" --json
```

Inside your AI IDE, start with:
- **`/demo`** — 15-second synthetic sandbox ([`examples/sandbox-demo/`](examples/sandbox-demo/sample-jds.md)), zero personal data or browser login.
- **`/quick-tailor`** — Tailor 1 real CV against 1 job description (`HTML` / `TXT` / Word `.doc` + True Gaps), no browser login.
- **`/profile-update`** — Audit & plan cross-platform profile improvements (`DRAFT_ONLY`, schema-validated).
- **`/build-portfolio`** — Build & preview a personalized portfolio site locally (`logs/portfolio/<slug>/`), then optionally deploy via hosting CLIs after `APPROVE`.
- **`/setup` → `/daily-run`** — Full optional Career OS when ready for browser-assisted workflows.

---

## AI Agent Onboarding

Veycraft works natively with **OpenAI Codex CLI**, **Claude Code**, **Gemini CLI**, **GitHub Copilot / VS Code**, **Cursor**, **Windsurf**, **Antigravity**, **Devin Desktop**, **Cline**, **Roo Code**, **OpenCode**, **AWS Kiro**, **JetBrains Junie**, **Zed**, **Goose**, and **Aider** (see [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)).

### Universal Agent Prompt (Copy & Paste Into Any AI Coding Agent)
```text
Install Veycraft, verify it with `veycraft doctor --json`, explain available capabilities,
and prepare it for this workspace. Do not modify personal data or perform live external
actions without explicit approval.
```

### Target a Specific AI Tool
```bash
veycraft init --global --ide codex       # ~/.codex/AGENTS.md + config.toml + ~/.agents/skills
veycraft init --global --ide claude      # ~/.claude/commands + ~/.claude/skills + ~/.claude.json
veycraft init --global --ide gemini      # ~/.gemini/GEMINI.md + settings.json + ~/.gemini/skills
veycraft init --global --ide copilot     # ~/.copilot/copilot-instructions.md + mcp-config.json
veycraft init --global --ide cursor      # ~/.cursor/rules/job-hunter.mdc + ~/.cursor/mcp.json
veycraft init --global --ide windsurf    # ~/.windsurf/rules/ + workflows + mcp_config.json
veycraft init --global --ide antigravity # ~/.gemini/antigravity/global_workflows + mcp_config.json
```

**Machine-readable agent discovery:** `veycraft --version --json`, `veycraft doctor --json`, `veycraft status --json`, and `veycraft route "<request>" --json` return structured JSON without altering personal files or triggering external actions.

---

## Core Capabilities & Output Preview

All names, employers, and metrics below come from synthetic repository fixtures ([`evals/fixtures/`](evals/fixtures/candidate-profile.md)):

![Veycraft — Truthful CV Tailoring Output Preview (Synthetic Demonstration Data)](assets/demo-preview.png)

```diff
- Built backend APIs for an e-commerce and payments app using Node.js.
+ Built idempotent Node.js and TypeScript webhook processors backed by PostgreSQL and AWS SQS,
+ reducing payment webhook p95 latency by 38% across $4.2M daily settlement volume [verified: candidate-profile.md].
! Blocked claim: "Managed multi-cluster Kubernetes" (0 verified years — isolated under True Gaps)
[ATS Keyword Coverage: 71.4% -> 92.8% (heuristic comparison, not an ATS guarantee)]
[Status: dry_run: true · Awaiting explicit job-specific human APPROVE]
```

| Capability | Trigger / Command | Highlights |
|---|---|---|
| **Truthful CV Tailoring** | `/quick-tailor`, `/tailor-cv`, or natural language | Single-column `HTML` + `TXT` + Word-compatible `.doc` (never fake `.docx`), Evidence Map, 4-bucket ATS Keyword Heatmap, isolated **True Gaps**, original CV preserved |
| **Profile Intelligence Engine** | `/profile-update` or *"Optimize my profile"* | 7-criteria audit across `linkedin`, `wellfound`, `ats`, `job_boards`, `portfolio`, and read/draft-only `generic` fallback; schema-validated `DRAFT_ONLY` plan (`add`/`replace` only, zero `remove`) + read-back verification |
| **GitHub CLI Audit, Marketing & CV Extraction** | `/github-audit` or *"Audit my GitHub repos"* | Full-account `gh` CLI repo inventory, code-verified `context/github-projects.md` CV extraction (`requires_user_confirmation` metrics), `DRAFT_ONLY` README/metadata marketing diffs, and tiered cleanup (`private`/`archive` first, per-repo typed `DELETE <owner>/<repo>` gate) |
| **Personalized Portfolio Builder & Deployer** | `/build-portfolio` or *"Build my portfolio website"* | Isolated local builds (`logs/portfolio/<slug>/`: Vanilla HTML/CSS/JS, Astro, Vite+React, Next.js), public PII/secret scan, `LOCAL_PREVIEW_ONLY` default, and `APPROVE`-gated deploy (`vercel`, `wrangler`, `netlify`, separate-repo `gh`, `firebase`, `surge`, or Smart Fallback) |
| **LinkedIn Growth & SEO** | `/linkedin-growth` | 3-mode guard (Read-Only → `DRAFT_ONLY` → `APPROVE`-gated live save), `0–100` recruiter SEO score, `<= 75`-word outreach drafts |
| **Multi-Source Discovery & ATS Prep** | `/daily-run`, `/apply-url <url>` | LinkedIn, Wellfound, Indeed, Glassdoor, Greenhouse, Lever, Ashby, Workday, SmartRecruiters, MENA boards, B2B networks (`skills/platforms/b2b-contract-networks.md`), or any custom HTTPS job URL |
| **Interview, Offer & Contract Ops** | Natural language | `interview-dossier.md`, take-home blueprints, grounded offer negotiation drafts, and 6-category NDA/MSA red-flag audits |
| **No-MCP Offline Fallback** | `veycraft bundle` / Capability Matrix `A–E` | Works 100% offline without Playwright or Notion; gracefully degrades with copy-paste deliverables and local JSON ledgers |

---

## CLI Commands

Legacy aliases `job-hunter` and `job-hunter-os` map to the exact same `bin/cli.mjs` binary.

| Command | Purpose |
|---|---|
| `veycraft --help` / `veycraft --version [--json]` | Safe, read-only usage guide or version & provenance metadata |
| `veycraft doctor [--global] [--strict] [--json]` | Diagnose Node runtime, provenance, 53-skill manifest, 5 gates, `<60d` playbooks, PII hook & MCP configs |
| `veycraft init [--global] [--force] [--ide <name>]` | Non-destructively scaffold `~/.veycraft` (or workspace), link IDE skills/rules & safely merge MCP configs |
| `veycraft route "<request>" [--json]` | Deterministic natural-language Task Intent Router (returns minimal skills, readiness & fallback) |
| `veycraft audit <cv.md\|txt\|docx\|html\|doc> [--share]` | Offline CV hygiene audit, fake-`.docx`/scanned-PDF/SSRF/token checks & PII-safe SVG/MD scorecard |
| `veycraft verify <dir\|file> [--facts <json\|md>]` | Post-write verification for deliverables, ledgers, session checkpoints (`logs/runs/current-session-checkpoint.json`), CV versions, Notion sync plans/state, `Profile Update Plan` JSON, and verified profile vaults |
| `veycraft career summary [--json]` | Print submitted funnel, active rounds, overdue follow-ups & sync status (`logs/sync-state.json` first) |
| `veycraft career analytics [--period <all\|YYYY-Www\|YYYY-MM>] [--write] [--json]` | Deterministic funnel, score-band, CV-version & source analytics (`MIN_N = 5`; silence `>= 14d` != rejection) |
| `veycraft career dashboard [--no-open]` | Generate local read-only Career Analytics & Kanban HTML dashboard |
| `veycraft career migrate [--dry-run \| --apply] [--json]` | Backup-first idempotent migration of `logs/applications-log.json` to schema v2.0 (`--dry-run` default) |
| `veycraft career cv-versions [--json]` | List owner CV versions in `logs/cv-versions.json` & linked application counts (isolates third-party CVs) |
| `veycraft career next [--job-id <id>] [--persona <id>] [--lang <code>] [--json]` | Read-only prioritized workflow queue surfacing `P0` safety blockers, active run/prep queue, context-aware owner CV selection, 7-day follow-ups, active rounds & `>= 14d` silence checks |
| `veycraft career run-start\|run-triage\|run-enqueue\|prepare\|run-checkpoint\|run-resume\|run-finish [--help]` | Deterministic daily-run & session-checkpoint state machine, Tier A/B/C triage, two-stage approval boundary queue (`submission_authorized: false`), and per-job preparation package verifier |
| `veycraft career record\|reserve\|confirm-submit\|transition\|skip\|cv-register [--help]` | Lock-protected (`logs/.ledger.lock`), schema-validated atomic mutations for `logs/applications-log.json`, `logs/skipped-jobs.json`, and owner `logs/cv-versions.json` (+ `lock-status`, `release-stale-lock`, `recover-tx`) |
| `veycraft career sync <subcommand> [--help]` | One-way local-to-Notion sync engine (`preview`, `status`, `verify-schema`, `approve`, `mark-in-flight`, `apply-receipt`, `record-failure`, `expire-stale`, `reconcile`, `reset-permanent`, `release-stale-lock`); zero external writes from CLI |
| `veycraft pre-submit [--draft <file> \| --text <str>] [--platform <p> --company <c> --title <t> --url <u> --job-id <id>] [--json]` | Deterministically enforce daily + Days 1–3 warm-up caps (counting `submission_uncertain: true` reservations), `max_per_platform`, circuit breakers, employer/domain blacklists, cross-channel dedup, banned AI clichés, and `<= 75`-word outreach cap |
| `veycraft eval [--baseline \| --file <json> \| --journeys]` | Run 20 deterministic safety assertions, external model grading, or full `node:test` integration suites |
| `veycraft status [--global] [--json]` | Print readiness gates, warm-up caps & pipeline funnel summary |
| `veycraft proof` / `dashboard [--global] [--no-open]` / `bundle` | Regenerate proof card SVG/MD, open classic Kanban viewer, or export web-chat master prompt |
| `veycraft sync-mcp` / `login` / `unlock` / `backup` / `update` | Sync MCP TOML/JSON, open persistent Chromium, clean stale locks, snapshot logs, or SSH-verified update |

*(Note: when passing `--global` / `-g` with scoped `career` subcommands such as `career sync`, `career record`, `career run-start`, or `career next`, place it before `career`, e.g., `veycraft --global career sync status`.)*

---

## Privacy, Safety & Approval Gates

Veycraft explicitly separates **deterministic CLI enforcement** from **agent workflow instructions** ([`docs/execution-safety.md`](docs/execution-safety.md)):

- **Deterministic CLI guards (`bin/cli.mjs`, `bin/profile-intelligence.mjs`, `bin/career-intelligence.mjs`, `bin/notion-sync.mjs`):** Registry-enforced platform capabilities, schema/fact checks (`verify`), fake-`.docx`/SSRF/token detection (`audit`), `<= 75`-word, daily/warm-up/platform cap (counting `submission_uncertain: true`), circuit-breaker, blacklist & cross-channel dedup checks (`pre-submit`), lock-protected atomic ledger & CV-version writes (`logs/.ledger.lock`, `logs/.ledger-tx.json` compensating rollback), `MIN_N = 5` & third-party CV isolation (`career`), one-way allowlisted Notion sync with execution-time `config/guardrails.yaml` kill-switch, `--plan-hash` + 24h TTL approval, exclusive lockfile (`logs/.sync-state.lock`), pre-write `in_flight` reservation, structured receipt verification, and complete-query reconciliation (`career sync`), `.git/hooks/pre-commit` PII blocker, and SSH commit verification (`update`).
- **Agent workflow guardrails (`AGENTS.md`, `skills/*.md`):** Untrusted-DOM prompt-injection defense, upload-first ATS rule, Live DOM Read-Back Table, `DRAFT_ONLY` defaults, 24-hour anti-bot circuit breaker, and unconditional job-specific human `APPROVE`.
- **Zero private leaks:** `context/*` (except `*.example`), `logs/`, `*.pdf`, `browser-profile/`, `.env`, and local MCP configs are gitignored, blocked by the pre-commit hook, and excluded from the npm package allowlist (`npm run pack:check`).

![Veycraft Reproducible Proof Card](assets/proof-card.svg)

---

## Configuration & Data Locations

Veycraft never overwrites your private `context/`, `logs/`, `config/guardrails.yaml`, or `browser-profile/` during installs or upgrades.

| Environment | Default Agent Home & User Data Location |
|---|---|
| **Windows (PowerShell / CMD)** | `%USERPROFILE%\.veycraft` (automatically preserves existing `%USERPROFILE%\.job-hunter-os`) |
| **macOS** | `~/.veycraft` (automatically preserves existing `~/.job-hunter-os`) |
| **Linux** | `~/.veycraft`, or `$XDG_DATA_HOME/veycraft` when `XDG_DATA_HOME` is explicitly set (preserves existing `~/.veycraft` / `~/.job-hunter-os`) |
| **Custom Override (All OS)** | Set `VEYCRAFT_HOME=/custom/path` |
| **Local Workspace Mode** | Current directory when initialized with `veycraft init` (marker: `.veycraft-install.json`) |

---

## Upgrade & Uninstall

### Upgrade (Preserves All User Data)
```bash
# If installed globally via GitHub / npm:
npm install -g github:redasalem/veycraft   # or `npm update -g veycraft` once published to npm
veycraft update --global                   # Refreshes playbooks/IDE links while preserving context/ & logs/

# If migrating an older `job-hunter-os` git clone:
git remote set-url origin https://github.com/redasalem/veycraft.git
git pull --ff-only origin main
```

### Uninstall (Non-Destructive by Default)
Removing the CLI **never deletes** your personal `context/`, `logs/`, or `browser-profile/` data:

```bash
# 1. Remove the global CLI binary only (your personal data in ~/.veycraft stays intact):
npm uninstall -g veycraft

# 2. Optional — permanently delete local Veycraft data ONLY if you want a full wipe:
# macOS / Linux: rm -rf ~/.veycraft
# Windows PowerShell: Remove-Item -Recurse -Force "$HOME\.veycraft"
```

---

## Development, Testing & Contributing

```bash
git clone https://github.com/redasalem/veycraft.git
cd veycraft

npm test             # Runs eval --baseline (20/20), live-agent-eval-run (20/20), and eval --journeys (node:test suites)
npm run pack:check   # Verifies npm pack --dry-run tarball contents and zero PII leaks
node bin/cli.mjs doctor
```

- **Documentation Index:** [`AGENTS.md`](AGENTS.md) · [`skills/REGISTRY.md`](skills/REGISTRY.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SKILL_CATALOG.md`](docs/SKILL_CATALOG.md) · [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) · [`docs/chat-commands.md`](docs/chat-commands.md) · [`docs/execution-safety.md`](docs/execution-safety.md) · [`ACCEPTANCE.md`](ACCEPTANCE.md) · [`examples/outputs/sample-tailoring-notes.md`](examples/outputs/sample-tailoring-notes.md) · [`PLATFORMS.md`](PLATFORMS.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)
- **Contribute:** See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`ACCEPTANCE.md`](ACCEPTANCE.md), and [`HIRED.md`](HIRED.md), or share an outcome via [Share Outcome Issue](https://github.com/redasalem/veycraft/issues/new?template=share-success.yml).

## License & Attribution

Inspired by open-source patterns from [`career-ops-hq/career-ops`](https://github.com/career-ops-hq/career-ops), [`obra/superpowers`](https://github.com/obra/superpowers), and [`anthropics/skills`](https://github.com/anthropics/skills) / [`agentskills.io`](https://agentskills.io/).

Licensed under the [MIT License](LICENSE) — Copyright (c) 2026 Reda Salem (`@redasalem`). See [`NOTICE`](NOTICE), [`AUTHORS.md`](AUTHORS.md), and [`PROVENANCE.json`](PROVENANCE.json).
