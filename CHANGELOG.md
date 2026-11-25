# Changelog

All notable changes to **`Veycraft`** *(formerly `job-hunter-os`)* will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.1] - 2026-11-25 — MCP Windows Hardening, Security Fixes & Pages Sync

### Fixed
- **Native MCP Windows Pipeline & Isolated `cli-smoke` Resolution (`bin/mcp-server.mjs`, `evals/mcp-server.test.mjs`, `.github/workflows/validate-repo.yml`):** Stripped leading UTF-8 BOM (`\uFEFF`) from incoming JSON-RPC frames in `processRawLine()` for Windows PowerShell `stdio` pipelines, resolved `JHO_CLI_PATH` cleanly across isolated `veycraft init` workspaces in `evals/mcp-server.test.mjs`, and hardened the cross-platform CI `mcp` pipe assertion in `validate-repo.yml`.

### Security
- **CodeQL Remediation & Zero Open Alerts (`bin/fs-safety.mjs`, `bin/core-ops.mjs`, `bin/career-intelligence.mjs`, `bin/profile-intelligence.mjs`, `evals/*.test.mjs`):** Replaced sequential entity decoding with single-pass `decodeXmlHtmlEntities()` (`#2`, `#19`), replaced regex `<script>`/`<style>` and tag stripping with regex-free O(n) `stripHtmlBlocks()` and `stripMarkupTags()` (`#4`, `#7`, `#18`), escaped backslashes before pipes in Markdown table cells (`#8`), enforced strict `new URL()` origin/pathname checks for GitHub provenance verification (`#16`, `#17`), renamed `ROUTE_RULES[].match` → `matches` (`#15`), and hardened test assertions (`#6`, `#9`–`#12`) — reducing open CodeQL alerts from `14` to `0`.

### Changed
- **GitHub Pages & Release Asset Sync (`docs/index.html`, `assets/demo.svg`, `assets/proof-card.svg`, `README.md`, `README.ar.md`):** Updated the live GitHub Pages preview (`redasalem.github.io/veycraft/`) to `v2.3.1` with a dedicated **Native Zero-Dependency MCP Server (`npx -y veycraft mcp`)** setup card (`8` tools + `veycraft://` resources) and synced `116/116` journey / `20/20` eval / `53`-skill metrics, plus regenerated SVG badges.

## [2.3.0] - 2026-11-24 — Native Zero-Dependency MCP Server & Animated Demo

### Added
- **Zero-Dependency Native MCP Server & Shared Core-Ops Layer (`bin/core-ops.mjs`, `bin/mcp-server.mjs`, `bin/cli.mjs`, `evals/mcp-server.test.mjs`, `mcp/README.md`, `mcp/claude_desktop_config.example.json`, `docs/COMPATIBILITY.md`):** Extracted pure zero-stdout operations into `bin/core-ops.mjs` and added a built-in newline-delimited JSON-RPC 2.0 `stdio` MCP server (`veycraft mcp` / `npx -y veycraft mcp`) with `0/0` npm dependencies, protocol version negotiation (`2025-06-18` / `2025-03-26` / `2024-11-05`), 8 strictly offline read-only tools (`veycraft_doctor`, `veycraft_route`, `veycraft_audit`, `veycraft_verify`, `veycraft_pre_submit`, `veycraft_career_summary`, `veycraft_career_next`, `veycraft_get_skill`), allowlisted zero-PII `veycraft://` resources (`manifest`, `registry`, `invariants`, `skill/{name}`), end-to-end `stdio` tests (`113 -> 116` journey tests), CI `stdio` smoke checks, and multi-client MCP onboarding guides while preserving `sync-mcp` backwards compatibility.
- **Pure CSS-Animated Terminal Demo (`assets/demo.svg`, `README.md`, `README.ar.md`):** Added a 10.5-second, zero-script, `prefers-reduced-motion`-safe animated SVG terminal demo showcasing authentic `v2.2.0` CLI output (`doctor`, `route`, and `pre-submit` safety gate) in both English and Arabic READMEs while preserving `0/0` npm dependencies.

## [2.2.0] - 2026-11-24 — Portfolio Design System Studio, Dual-Engine LinkedIn Growth & Streamlined Onboarding

### Added
- **Agency-Grade Portfolio Design System Studio, Automated Testing & Bounded Self-Healing QA (`skills/30-portfolio-design-system-and-qa.md` v1.0.0, `.agent/workflows/portfolio-design.md`, `commands/portfolio-design.md`, `/portfolio-design`):** Added pre-code `DESIGN_PLAN.md` + separated `portfolio-data` enforcement, Anti-AI-Slop Design System Studio (`7` curated WCAG 2.1 AA palettes + full `Custom` hex derivation, `Display + Body + Mono` + Arabic RTL webfont/logical-CSS pairings, locked in `design-tokens.json` + `tokens.css`), 3-layer automated QA inside `<portfolio-dir>` (TypeScript/static/build gate, `node --test` or isolated `<portfolio-dir>` `vitest` behavioral suites keeping root `package.json` at `0/0` deps, and `375px`/`768px`/`1440px` visual/overflow/console QA writing `qa-report.md`), and a 3-cycle Bounded Self-Healing Loop blocking `localhost` sign-off and deployment until green (`52 -> 53` skills).
- **Portfolio Design & QA Journey Tests (`evals/journeys/`):** Added `PF03`/`PF04` journey cases, updated `PF01`/`Test 2`/`Test 12`, and added `Test 13` covering manifest parity, acyclic DAG checks, collision-free `portfolio-design-qa` (`4/7`) + `build-portfolio` (`7/7`) routing, and Skill 30 contract enforcement (`112/112` journey tests).

### Changed
- **Streamlined Onboarding Docs & Release Readiness (`README.md`, `README.ar.md`, `CONTRIBUTING.md`, `package.json`):** Refactored `README.md` and `README.ar.md` with Progressive Disclosure (above-the-fold proof preview, 3-Step Quick Start, collapsible `<details>` advanced CLI/install references, synced `53`-skill / `113/113` counts and `/portfolio-design` coverage), added the 5-step Maintainer Release & npm Publish Checklist to `CONTRIBUTING.md`, and added `github-audit`, `portfolio-builder`, and `linkedin-seo` discovery keywords to `package.json`.
- **Dual-Engine LinkedIn Growth, Recruiter Search & Feed Algorithm Upgrade (`skills/linkedin-growth.md` v3.0.0, `.agents/skills/linkedin-growth/SKILL.md`, `.agent/workflows/linkedin-growth.md`, `commands/linkedin-growth.md`, `bin/cli.mjs`):** Upgraded `/linkedin-growth` to a Dual-Engine system separating Confirmed Platform Mechanics from Observed Distribution Heuristics (`0` fake multipliers), adding Engine A multi-role Skills-to-Experience depth, Likely-to-Respond/geo-radius signals, mobile About fold (`~140-210` chars), `1-3` Featured proof curation & 3-stage funnel diagnostics, Engine B Topical Authority (`2-3` pillars), Dwell Time hooks, `DRAFT_ONLY` Comment-First strategy & goal-driven Native Format Tradeoffs Matrix, and Engine C Anti-Pod/Anti-Automation ToS guardrails with full 19-cliché parity and `0` prose em-dashes; expanded `linkedin-profile` CLI routing (`6/7` skills) and added `LI05`/`LI06` + `Test 14` (`113/113` journey tests).
- **Portfolio Builder Blueprint & QA Delegation (`skills/29-portfolio-builder-and-deployer.md` v1.1.0, `skills/19-on-demand-mcp-routing.md` v1.1.2, `bin/cli.mjs`):** Wired Skill 30 pre-code Blueprint/Token Lock and 3-layer QA / 3-cycle Self-Healing gates into Skill 29 without changing `/setup` independence, registered the standalone `portfolio-design-qa` CLI route (`4/7` skills) cleanly ahead of `build-portfolio` (`7/7` skills), and regenerated `assets/proof-card.svg` (`53` skills).

## [2.1.0] - 2026-11-24 — Recruiter & Domain Intelligence, GitHub CLI Engine & Portfolio Deployer

### Added
- **Recruiter, Personal Brand & Domain-Agnostic Market Intelligence (`skills/28-recruiter-brand-and-domain-intelligence.md` v1.0.0, PR `#18`):** Added a cross-cutting Senior TA Recruiter & Hiring Manager JD decoder (separating True Knock-Outs from HR Wishlist Inflation, organizational flags, and 90-day Buyer Pain Points), 6-10s CV visual scan & Proof Density Hierarchy, truthful red-flag framing, LinkedIn Recruiter SEO & Boolean mechanics, and dynamic 7-archetype multi-industry adaptation (`50 -> 51` skills).
- **Isolated Personalized Portfolio Builder & Multi-CLI Deployer (`skills/29-portfolio-builder-and-deployer.md` v1.0.0, `.agent/workflows/build-portfolio.md`, `commands/build-portfolio.md`):** Added `/build-portfolio` supporting isolated local builds in `logs/portfolio/<site-slug>/` (`SEC-02` third-party isolation in `logs/portfolio/third-party-<slug>/`) across a 4-tier tech stack matrix (`Vanilla HTML/CSS/JS`, `Astro`, `Vite + React`, `Next.js` + custom stacks), pre-publish PII/NDA/secret scanning (`VITE_*`/`NEXT_PUBLIC_*`/`PUBLIC_*`), `LOCAL_PREVIEW_ONLY` default, and `APPROVE`-gated deployment via `vercel`, `wrangler`, `netlify`, separate-repo `gh` Pages (hard-blocking `redasalem/veycraft`), `firebase`, `surge`, or Smart Fallback for non-CLI hosts (`51 -> 52` skills).
- **Contributor Governance & Synthetic Reference Assets (`ACCEPTANCE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `examples/outputs/sample-tailoring-notes.md`, ported from `#6`):** Added a human-readable contributor acceptance matrix (`A1-E1`) mapped to CI/CLI checks, upgraded PR template professionalism/risk/test-plan sections, and added a grounded synthetic Evidence Map + domain-adaptive ATS Keyword Heatmap + True Gaps tailoring-notes reference.
- **Expanded Regression & Journey Coverage (`evals/journeys/`):** Expanded integration suites to `111/111` tests (adding Tests 9, 10, 11, and 12 plus `GH01`, `GH02`, `PF01`, and `PF02` journey cases).

### Changed
- **GitHub CLI Engine Upgrade (`skills/11-portfolio-and-github-auditor.md` v2.0.0, `.agent/workflows/github-audit.md`, `commands/github-audit.md`):** Upgraded Skill 11 (`/github-audit`) to `requires_mcp: ["none"]` (`optional_mcp: ["playwright"]`) with full-account `gh` CLI inventory, `DRAFT_ONLY -> APPROVE` recruiter README/metadata polish with fresh `gh` read-back, tiered safe cleanup (`private`/`archive` before blast-radius warning + per-repo typed `DELETE <owner>/<repo>`), and verified GitHub-to-CV project extraction into `context/github-projects.md`.
- **Multi-Industry Skill De-Biasing & GitHub Read-Hooks (`skills/02`, `03`, `07`, `21`, `27`, `linkedin-growth`, `profile-intelligence-engine`):** Removed software-engineering-only assumptions across 7 core skills, unified `02-discover-and-triage.md` into a single domain-agnostic `0-10` rubric (`Match % = round(Score * 10)%`), upgraded `21-ats-keyword-heatmap.md` to 4 domain-adaptive buckets, and wired `context/github-projects.md` read-hooks into `03` (`v2.2.0`) and `27` (`v1.2.0`).
- **Intent Router & Proof Assets (`bin/cli.mjs`, `bin/profile-intelligence.mjs`, `assets/proof-card.svg`):** Wired `build-portfolio`, `github-portfolio-audit`, and updated standalone routes while preserving the `<= 7` skills-per-intent cap (`daily-run` kept at `7/7`), and regenerated `assets/proof-card.svg` for `v2.1.0` (`52` skills).

### Security
- **Unified 19-Item Anti-Slop & Pre-Submit Hardening (`bin/cli.mjs`, `bin/profile-intelligence.mjs`, `evals/fixtures/ground-truth.json`, `config/invariants.txt`, PR `#16` superseding `#5`):** Synced the 19-item banned AI-cliche contract across CLI/career/profile modules and eval fixtures, upgraded `veycraft pre-submit --draft|--text` to hard-fail on prose em-dashes alongside banned cliches, and expanded compact `< 500`-byte Veycraft invariants.
- **Immutable Workflow SHA Pinning & Repository Hardening (`.github/workflows/*.yml`, PR `#17`):** Pinned all GitHub Actions workflows to full-length commit SHAs and hardened release-tag immutability, explicit Actions allowlisting, CodeQL scanning, external fork PR approval, and squash-only merge settings.

## [2.0.1] - 2026-11-23 — Career Intelligence, Workflow Orchestrator, npm Packaging & Phase 1 Security Hardening

### Added
- **Deterministic Career Intelligence, Lifecycle Write-Engine & Workflow Orchestrator (`bin/career-intelligence.mjs`, `bin/cli.mjs`, `schemas/`):** Added v2 local-first application ledger validation and safe rollback migration, single-writer ledger locking and journaled cross-file transactions, submission reservation (`reserve`) and receipt-verified confirmation (`confirm-submit`), stage transitions, owner CV version registry (`cv-register`, `cv-versions`), deterministic `MIN_N = 5` analytics (`analytics`, `summary`, `dashboard`), pre-submit integrity gating (`pre-submit`), and run-session checkpoint orchestration (`run-start`, `run-triage`, `run-enqueue`, `prepare`, `run-checkpoint`, `run-resume`, `run-finish`, `next`).
- **One-Way Approval-Gated Notion Sync Foundation (`bin/notion-sync.mjs`):** Added transport-free, local-authoritative 3-database (`Applications`, `Daily Runs`, `Weekly & Monthly Insights`) sync planning, 2-layer fail-closed privacy scanning, plan-hash-bound approval, single-writer sync-state locking, structured receipt verification, and safe reconciliation behind live guardrails kill-switches (`storage_adapters.notion_mcp: true` and `dry_run: false`).
- **Offline ATS & Regional Job Board Regression Fixtures (`evals/`):** Added offline Workday 4-step wizard & ARIA combobox fixture (`#11`), Bayt & GulfTalent MENA fixtures (`#12`), StepStone DACH fixture (`#13`), Naukri India fixture (`#14`), and unconditional `APPROVE` gate policy tests (`#15`, `evals/approval-gate.test.mjs`).
- **Machine-Readable CLI Diagnostics (`bin/cli.mjs`):** Added `--json` output support for `veycraft doctor --json`, `veycraft status --json`, and `veycraft --version --json` for deterministic AI coding agent discovery.
- **Cross-Platform Data Home & Installer Modes (`bin/cli.mjs`, `scripts/install.sh`, `scripts/install.ps1`):** Added `VEYCRAFT_HOME` and Linux `XDG_DATA_HOME/veycraft` resolution (while preserving existing `~/.veycraft` and legacy `~/.job-hunter-os`), plus `--dry-run` / `-DryRun`, non-destructive `--uninstall` / `-Uninstall`, and Node `>= 18` checks.
- **npm Package Readiness & CI Tarball Guard (`package.json`, `.github/workflows/publish-npm.yml`, `.github/workflows/validate-repo.yml`):** Added `.github/copilot-instructions.md`, `.github/prompts/`, and `.github/CODEOWNERS` to the npm `files` allowlist, added `author`, `bugs`, `keywords`, `publishConfig`, `test`, `doctor`, `pack:check`, and `prepublishOnly` scripts, and added Test 8 in `evals/journeys/run-journeys.test.mjs`.

### Security
- **SEC-02 — Third-Party CV & Application Isolation (`bin/career-intelligence.mjs`, `bin/notion-sync.mjs`, `bin/cli.mjs`):** Centralized owner vs. third-party CV and application classification (`classifyCvRegistryEntryOwnership`, `classifyApplicationOwnership`), canonicalized `isThirdPartyCvPath()` against `./`, `//`, and `..` path variants, enforced fail-closed exclusion when `logs/cv-versions.json` is absent for CV-attributed records, and aligned lifecycle writers and Notion sync eligibility across masked child CVs, reverse links (`application_ids`, `target_job_id`), and artifact paths (`screenshot`, `draft_rel`, `dossier_rel`, `blueprint_rel`).
- **SEC-04 — Path Traversal, Workspace Containment & Symlink Refusal (`bin/cli.mjs`, `bin/career-intelligence.mjs`, `bin/fs-safety.mjs`):** Enforced workspace containment and symlink/junction refusal across CLI readers (`audit`, `verify`, `verify --facts`, `pre-submit --draft`, `eval --file`), removed arbitrary external `evals/fixtures/` path whitelisting, validated `local_ref_rel` in `validateCvVersionsRegistry()`, rejected Windows Alternate Data Stream (`:stream`) path segments, and preserved macOS `/private/var` and Windows 8.3 short-path (`RUNNER~1`) compatibility without weakening symlink checks.
- **SEC-01 — SSRF Guard, DNS Resolution & Pinned-IP Defense (`bin/fs-safety.mjs`, `bin/cli.mjs`):** Hardened `isBlockedSsrfUrl()` across IPv4/IPv6 private, loopback, link-local, CGNAT, NAT64, 6to4, Teredo (`2001:0000::/32`), discard (`100::/64`), TEST-NET, and multi-trailing-dot hostnames; upgraded `fetchUrlWithSafeRedirects()` to resolve and validate all DNS records on every hop and connect via pinned-IP `node:http`/`node:https` sockets to defend against DNS-based SSRF and DNS rebinding.
- **SEC-03 — Hardened OOXML `.docx` Parser & Pre-Read Size Cap (`bin/fs-safety.mjs`, `bin/cli.mjs`):** Added `readFileBoundedSync()` to enforce `DOCX_LIMITS.MAX_INPUT_BYTES` before full file reads in `audit`/`verify`, enforced Central Directory bounds (including padding-gap overlap rejection), entry/XML/compressed/uncompressed/cumulative decompression caps, and fixed zero-byte deflated XML handling at exact budget exhaustion.

### Changed
- **Unconditional Job-Specific `APPROVE` Gate (`skills/04-fill-and-apply.md`, `skills/18-condition-based-browser-waiting.md`):** Removed implicit auto-submit bypass wording and enforced unconditional human `APPROVE` gating with automated policy regression checks.
- **Clean Uninitialized `doctor` Behavior (`bin/cli.mjs`):** Updated `veycraft doctor` to verify bundled package provenance when run before `init` and emit clear `veycraft init --global` / `veycraft init` next steps instead of false provenance tamper failures.
- **Developer-First Bilingual READMEs (`README.md`, `README.ar.md`, `assets/proof-card.svg`):** Rebuilt screen 1 of both English and Arabic RTL READMEs with 3 installation paths (`npx`, `npm install -g`, source clone), Requirements, safe First Run, Universal AI Agent Onboarding prompt, Data Locations, and non-destructive Upgrade/Uninstall instructions, and regenerated `assets/proof-card.svg` for `v2.0.1`.

## [2.0.0] - 2026-11-21 — Veycraft Rebrand & Profile Intelligence Engine

### Added
- **Profile Intelligence Engine (`skills/profile-intelligence-engine.md`, `bin/profile-intelligence.mjs`, `schemas/profile-update-plan.schema.json`, `/profile-update`, PR #7):**
  - Added a zero-dependency cross-platform profile optimization engine (`linkedin`, `wellfound`, `ats`, `job_boards`, `portfolio`, plus a conservative read/draft-only `generic` fallback) with strict registry-based adapter capability enforcement.
  - Extended `schemas/resume-data.schema.json` with additive verified profile vault metadata (`fact_provenance`, `verification_status`, `profile_variants`, `platform_profiles`) while preserving full backwards compatibility.
  - Added consolidated `DRAFT_ONLY` field-level diffs (`add`/`replace` only; zero `remove`), honest post-save verification statuses (`verified`, `partially_applied`, `not_verified`, `blocked`, `needs_review`), CLI `verify <plan.json|vault.json>` integration, natural-language EN/AR routing in `bin/cli.mjs route`, and 10 comprehensive `node:test` suites in `evals/profile-intelligence.test.mjs`.
- **First-Class OpenAI Codex CLI, Google Gemini CLI & GitHub Copilot / VS Code Sync (`bin/cli.mjs`, `adapters/apps/openai-codex-cli.md`, `adapters/apps/gemini-and-copilot.md`):** Added non-destructive managed instruction injection (`$CODEX_HOME/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.copilot/copilot-instructions.md`), safe TOML `[mcp_servers.*]` syncing (`.codex/config.toml` / `$CODEX_HOME/config.toml`), Gemini CLI `settings.json`, VS Code `.vscode/mcp.json` (`"servers"`), expanded `--ide` targets (`codex`, `gemini`, `copilot`, `roo`, `kiro`, `junie`, `zed`, `goose`, `aider`), local scaffolding for all repo IDE adapters, and Test 7 in `evals/journeys/run-journeys.test.mjs`.

### Changed
- **Rebranded Repository & CLI to `Veycraft` (`redasalem/veycraft`):**
  - Renamed canonical GitHub repository from `redasalem/job-hunter-os` to `redasalem/veycraft` (GitHub preserves automatic HTTP 301 redirects from legacy URLs).
  - Added `veycraft` as the primary CLI binary and package name (`package.json`) while keeping `job-hunter` and `job-hunter-os` CLI aliases intact for backwards compatibility.
  - Defaulted new global installations to `~/.veycraft` while automatically detecting and preserving existing `~/.job-hunter-os` directories and seamlessly upgrading legacy `<!-- job-hunter-os:start -->` managed blocks in-place.
  - Updated provenance records (`PROVENANCE.json`, `NOTICE`, `AUTHORS.md`, `LICENSE`, `.github/CODEOWNERS`), CI checks, `README.md`, `README.ar.md`, `docs/`, `adapters/`, `templates/`, `schemas/`, `scripts/install.{sh,ps1}`, and regenerated `assets/proof-card.svg` for `v2.0.0`.
  - **Migration note for existing clones:** Run `git remote set-url origin https://github.com/redasalem/veycraft.git`. No local files, skills, workflows, or private `context/`/`logs/` data need to be recreated.

## [1.5.0] - 2026-11-19 — Universal Guided AI Workflow Engine & Release Hardening

### Added
- **Universal Natural-Language Task Router & Task-Specific Readiness (`AGENTS.md`, `skills/REGISTRY.md`, `bin/cli.mjs route`):** Added a 10-intent task router covering natural-language requests (`route "<request>" [--json]`) and decoupled standalone CV, LinkedIn, JD comparison, interview prep, and record-tracking workflows from mandatory `/setup` onboarding.
- **Built-In Format-Honest CV Reader & Deliverable Verifier (`bin/cli.mjs audit`, `bin/cli.mjs verify`, `skills/01-resume-ingestion.md`):** Added zero-dependency `.docx` ZIP/XML text extraction (`extractDocxText`), sanitized `.html` / Word-compatible `.doc` parsing, strict rejection of scanned PDFs or disguised HTML `.docx`, guided CV creation from scratch, surgical CV editing preserving originals, and post-write placeholder/em-dash/fact verification (`verify <dir|file> [--facts <json|md>]`).
- **Synthetic Task-Journey Test Matrix (`evals/journeys/journey-matrix.json`, `evals/journeys/run-journeys.test.mjs`, `bin/cli.mjs eval --journeys`):** Added 6 `node:test` integration suites validating 26 user prompts (14 core + 8 LinkedIn/platform + 4 extended variants) and 5 tool-availability fallback scenarios.
- **Primary Output-Focused CV Tailoring Demo (`docs/index.html`):** Added a standalone, zero-external-request GitHub Pages demo illustrating 3 synthetic scenarios (`Strong Match`, `Stretch Match`, and `Prompt-Injection Trap`) with Before/After diffs, Evidence Maps, ATS keyword coverage comparisons, isolated **True Gaps**, and explicit `APPROVE` status.
- **Privacy-Safe CV Hygiene Share Cards (`bin/cli.mjs audit --share`):** Generates local `logs/exports/cv-hygiene-card.svg` and `logs/exports/cv-hygiene-card.md` artifacts with raw CV text, personal names, emails, phones, URLs, and filenames excluded.
- **Universal `/quick-tailor` Discovery (`commands/quick-tailor.md`, `.agents/skills/quick-tailor/SKILL.md`):** Added Claude Code command and `agentskills.io` wrapper entrypoints (enforced in `.github/workflows/validate-repo.yml`) so `/quick-tailor` is discoverable after local and global `init`.
- **CI Hardening & Automated Security Configuration (`.github/dependabot.yml`, `.github/workflows/*.yml`):** Added weekly Dependabot `github-actions` updates, upgraded workflows to Node 24 actions (`checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`), enforced the `0/0` npm dependencies invariant, and added cross-OS CI runs for `eval --journeys`, `route`, and `verify`.

### Changed
- **LinkedIn 3-Mode Guard & Multi-Source Discovery (`skills/linkedin-growth.md`, `skills/platforms/linkedin.md`, `skills/02-discover-and-triage.md`):** Enforced strict boundaries separating Read-Only Profile Inspection, `DRAFT_ONLY` improvement preparation, and `APPROVE`-gated live mutations verified post-save via `browser_snapshot`; enabled multi-source JD analysis with source URLs, verification dates, and explicit separation of verified matches vs. unknown requirements.
- **Capability Classification (`A–E`) & Offline Metadata Parity (`skills/skills-manifest.json`, `skills/19-on-demand-mcp-routing.md`, `skills/fallback-no-mcp.md`):** Reclassified 9 offline-capable skills to `requires_mcp: []` with `optional_mcp`, preserving fallback execution across Playwright/LinkedIn/PDF/Notion unavailability.
- **Unified Product Positioning & Output-First Landing Pages (`README.md`, `README.ar.md`, `package.json`, `assets/demo-preview.png`, `assets/social-preview.png`, `assets/proof-card.svg`):** Positioned `job-hunter-os` consistently around *"Truthful CV Tailoring for the AI Agent You Already Use"*, rebuilt the README hero, architecture diagram, and refreshed [`assets/proof-card.svg`](assets/proof-card.svg) for `v1.5.0`.
- **Fast-Start `init` Onboarding Sequence (`bin/cli.mjs`, `scripts/install.{sh,ps1}`):** Updated post-init guidance to recommend `/demo` (no CV, no browser login) -> `/quick-tailor` (1 real CV + 1 JD, no browser login) -> optional `login` + `/setup`.
- **Unconditional Job-Specific Human `APPROVE` Gate (`skills/04-fill-and-apply.md`, `skills/skills-manifest.json`, `skills/meta-structured-debugging.md`, `skills/13-company-due-diligence.md`, `adapters/apps/hermes-pi-factory-openclaw.md`, `config/guardrails.yaml`):** Removed conflicting `auto_high_confidence` bypass phrasing so every live submission requires explicit job-specific `APPROVE` after a fresh Live DOM Read-Back Table, and any later modification invalidates approval.
- **Honest Enforcement & Audit Terminology (`docs/execution-safety.md`, `bin/cli.mjs`, `CONTRIBUTING.md`, `docs/repository-audit.md`, `roadmap.md`, IDE rules):** Explicitly distinguished **Deterministic CLI Enforcement** (`bin/cli.mjs`) from **Agent Workflow Requirements** (`AGENTS.md`, `skills/*.md`), replaced misleading `"verified numeric metrics"` audit wording with `"Detected Numeric Metrics"` + heuristic disclaimer, and updated `CONTRIBUTING.md` with three concrete contribution paths.
- **Secondary Application Tracker Clarity (`docs/demo-dashboard.html`, `templates/analytics-dashboard.html`):** Positioned the Kanban dashboard as a secondary capability with explicit synthetic-sample vs. local-user-data banners, `Sample` card tags, `example.invalid` sample URLs, inline JSON error alerts, `Clear` / `Reset` controls, URL scheme sanitization against `javascript:` links, and responsive mobile/tablet grids.

### Fixed
- **CV Audit Bullet-Count Regex Bug (`bin/cli.mjs`):** Eliminated stateful `/g` regex matching across bullets (`metricSingleRe` vs. `metricGlobalRe`) so bullets containing numeric metrics are counted accurately.
- **Dynamic Proof & CLI Metadata (`bin/cli.mjs`):** Removed hardcoded `v1.4.1` and ATS fixture labels from `eval`/`proof`/`--help`, added `devDependencies` count (`0 / 0`) to `proof`, and flagged detected secret tokens accurately in the `audit` hygiene table.

## [1.4.1] - 2026-11-19 — Instant Local CV Audit CLI, Runtime Clarity & Above-the-Fold Diff

### Added
- **Zero-Setup Offline CV Audit CLI (`node ./bin/cli.mjs audit <file> [--share]`):**
  - Accepts any local `.md` or `.txt` CV path resolved from `process.cwd()` (no `ROOT` restriction) and deterministically scores AI-slop clichés & prose em-dashes, quantified metric density, 1-page A4 fit, and data/URL hygiene (with SSRF & token-leak checks).
  - Supports `--share` to print a clean, PII-stripped terminal scorecard ready for sharing on HN, X, Reddit, or LinkedIn.
  - Added cross-OS CI smoke coverage in [`.github/workflows/validate-repo.yml`](.github/workflows/validate-repo.yml).

### Changed
- **Runtime Clarity & Real `APPROVE`-Gate Diff Above the Fold (`README.md` & `README.ar.md`):**
  - Added an explicit top-of-page runtime callout stating that `job-hunter-os` runs inside the user's existing AI IDE (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Codex) using their active subscription with zero external API keys required.
  - Added a 4-line unified `diff` right below the hero showing verified fact grounding and blocked unverified claims before `APPROVE`, and refreshed [`assets/proof-card.svg`](assets/proof-card.svg) to `v1.4.1`.

## [1.4.0] - 2026-11-19 — First-Time User Conversion & Reproducible Proof Edition

### Added
- **Fast-Start `/quick-tailor` Workflow (`.agent/workflows/quick-tailor.md`):**
  - Lets first-time users generate a fact-checked, tailored single-column HTML + TXT resume with an Evidence Map, ATS Keyword Comparison, and excluded True Gaps from one CV and one job description in under 2 minutes — without requiring browser login, Playwright MCP, or full 5-gate platform onboarding.
- **Reproducible Proof Card CLI (`node ./bin/cli.mjs proof`):**
  - Added zero-dependency `proof` command reading live `package.json`, `skills/skills-manifest.json`, `eval --baseline`, and `evals/fixtures/forms/*.html` to generate reproducible `logs/exports/proof-card.svg` and `logs/exports/proof-card.md` (with explicit scope disclosure distinguishing deterministic fixture validation from an AI accuracy benchmark). Committed rendered preview at [`assets/proof-card.svg`](assets/proof-card.svg) and added cross-OS CI smoke verification.
- **Effortless Community Outcome Submission (`.github/ISSUE_TEMPLATE/share-success.yml`):**
  - Added a 30-second GitHub Issue Form (`interview` / `contract` / `offer`, anonymous welcome, strict PII prohibition) so users can share outcomes without forking or opening a PR.

### Changed
- **Outcome-First `README.md` & `README.ar.md` + Dynamically Synced Visual Assets (`v1.4.0`, `48` Skills):**
  - Rebuilt both landing pages around a 15-second value proposition (*"Your AI Career Operating System. Tailor Every CV. Verify Every Claim. Stay in Control."*), trimmed top badges to 3, added an explicit `Input → Job Hunter OS → Output` overview, clarified zero-dependency core CLI vs. optional Playwright MCP, and moved deep evaluation tables below the product demo.
  - Regenerated [`assets/demo-preview.png`](assets/demo-preview.png) (`1280x720`) and [`assets/social-preview.png`](assets/social-preview.png) (`1280x640`) dynamically from `package.json` (`v1.4.0`) and `skills/skills-manifest.json` (`48` skills).
- **Automatic First-Wow `/demo` (`.agent/workflows/demo.md` & `.agents/skills/demo/SKILL.md`):**
  - Updated `/demo` to immediately render one complete synthetic tailored preview for Job #1 (original summary, JD requirements, tailored CV, verified facts used, excluded True Gaps, ATS keyword lift, and `<= 75`-word outreach) directly after the Mission Control table without waiting for a follow-up command.
- **Honest Separation in `HIRED.md`:**
  - Separated Maintainer Project Origin from Independent Community Outcomes (starting cleanly at Community Outcome #1).

## [1.3.0] - 2026-11-19 — Token-Slim LinkedIn Extraction & Grounded Recruiter-SEO Optimizer

### Added
- **Token-Slim Structured Extraction for LinkedIn (`skills/platforms/linkedin.md` & `skills/02-discover-and-triage.md`):**
  - Added a deterministic, read-only Playwright `browser_evaluate` extraction pattern returning compact `<2 KB` JSON (`job_id`, `canonical_url`, `title`, `company`, `location`, `workplace_type`, `jd_text`, `required_skills`, `hiring_team`, `already_applied`, `closed_banner`) instead of dumping raw 25k-token accessibility trees into LLM context.
  - Preserves `3–9 s` human pacing jitter, `>= 10 s` reading dwell time, `UNTRUSTED_EXTERNAL_DATA` prompt-injection quarantine, and immediate 24-hour circuit-breaker stops.
- **Grounded Recruiter-SEO LinkedIn Profile Optimizer (`skills/linkedin-growth.md` — 48 Consolidated Skills):**
  - Added a dedicated `/linkedin-growth` skill scoring LinkedIn sections on a transparent `0–100` rubric (`Headline` 25, `About Hook & Keywords` 25, `Experience Bullets` 30, `Featured & Skills Alignment` 20) against 3–5 target JDs.
  - Generates side-by-side Before/After rewrites strictly grounded in `context/profile.md` & `context/cv.md` (zero invented metrics, zero unverified skills, zero AI-slop clichés/em-dashes), saved as `DRAFT_ONLY` and gated behind explicit human `APPROVE`.
- **Optional External MCP Plugin Guide (`docs/OPTIONAL_MCP_PLUGINS.md`):**
  - Documented `stickerdaniel/linkedin-mcp-server` as an opt-in external MCP plugin with clear LinkedIn ToS, `li_at` credential hygiene, and rate-limit warnings alongside our zero-dependency native Playwright MCP default.

## [1.2.3] - 2026-11-19 — Security & Cross-Platform Hardening

### Security
- **Stored XSS & `$`-Substitution Fix in `cmdDashboard`:** Replaced raw `String.prototype.replace` injection in [`bin/cli.mjs`](bin/cli.mjs) with a replacer function that Unicode-escapes HTML/script-unsafe characters (`<`, `>`, `&`, `\u2028`, `\u2029`) before embedding `logs/applications-log.json` into `dashboard.html`.
- **Immutable Eval Trust Boundary (`evals/fixtures/ground-truth.json`):** Hardened `cmdEval` to load `ground_truth_metrics`, `forbidden_skills` (including aliases `K8s`, `Rustacean`, `SwiftUI`, `iOS`, `C++`, `.NET`), and `banned_ai_cliches` strictly from immutable [`evals/fixtures/ground-truth.json`](evals/fixtures/ground-truth.json) rather than the untrusted `--file` payload, fixed metric regex extraction & exact-token matching, and escaped regex metacharacters.
- **Cryptographic `cmdUpdate` Verification & Strict Provenance Enforcement:** Embedded the pinned `@redasalem` Ed25519 signing public key inside [`bin/cli.mjs`](bin/cli.mjs) and required `git verify-commit HEAD` to pass before `update` overwrites local `bin/` or `skills/`. Upgraded `doctor` / `doctor --strict` to enforce exact canonical fields in `PROVENANCE.json`, `NOTICE`, and `AUTHORS.md` and fail non-zero on tampering.
- **CI Invisible-Unicode & BiDi Injection Scanner:** Added a security scan in [`.github/workflows/validate-repo.yml`](.github/workflows/validate-repo.yml) that fails CI if any skill under `skills/` or `.agents/skills/` contains invisible Unicode Tag characters (`U+E0000–U+E007F`) or BiDi override/isolate control characters (`U+202A–U+202E`, `U+2066–U+2069`).

### Added
- **Executable `pre-submit` Gate & Micro-Invariants (`config/invariants.txt`):** Added a `<500`-byte [`config/invariants.txt`](config/invariants.txt) file and `node ./bin/cli.mjs pre-submit [--draft <file> | --text "<msg>"]` to deterministically enforce the `<= 75`-word outreach cap and daily/warm-up application cap against `logs/applications-log.json` so hard rules survive IDE context compaction.

### Fixed
- **Cross-Platform CLI & Windows Hardening (`bin/cli.mjs`):**
  - Scoped `refuseSymlink` strictly within `ROOT` (and inside `HOME` for external IDE configs) to eliminate false positives on Windows NTFS junctions/OneDrive and Fedora Silverblue/NixOS.
  - Added 3-attempt retry backoff (`50ms`, `150ms`, `300ms`) on `EPERM`/`EBUSY` in `writeAtomic`.
  - Hardened `cmdUnlock` to verify POSIX `SingletonLock` PIDs via `process.kill(pid, 0)` before deleting and report active Windows lock errors cleanly; added Windows `lockfile` detection to `cmdLogin`.
  - Replaced Windows `cmd /c start` in `openFileInBrowser` with shell-metacharacter-safe `powershell.exe` `Start-Process -LiteralPath $env:JHO_OPEN_PATH`.
- **Pinned Playwright MCP & Stdio Noise Suppression:** Pinned `@playwright/mcp@0.0.86` and `@notionhq/notion-mcp-server@2.6.1` with `NPM_CONFIG_UPDATE_NOTIFIER=false`, `NPM_CONFIG_FUND=false`, `NPM_CONFIG_AUDIT=false`, and `NPM_CONFIG_LOGLEVEL=error` across [`mcp/mcp.template.json`](mcp/mcp.template.json), [`mcp/claude_desktop_config.example.json`](mcp/claude_desktop_config.example.json), and [`opencode.json`](opencode.json), and emitted Windows-safe `cmd /c npx` server entries in `sync-mcp`.

## [1.2.2] - 2026-11-18 — Safe Wedge Positioning & Trust Boundaries

### Changed
- **Safe-Wedge Product Positioning & Documentation Consistency (`47` Consolidated Skills):**
  - Refactored [`README.md`](README.md) and [`README.ar.md`](README.ar.md) to lead with the **Safe Wedge** (fact-checked AI CV tailoring, ATS keyword heatmap, and interview dossier co-pilot with explicit "What it will NEVER do" boundaries), placed `/demo` and the live [`GitHub Pages Kanban Dashboard`](https://redasalem.github.io/job-hunter-os/demo-dashboard.html) preview directly under the hero, and synchronized all skill counts consistently (`47` consolidated skills: `29` core + `4` meta + `7` platforms + `7` ATS).
- **Truthful Eval Disclaimers & Hard Approval/Pacing Boundaries:**
  - Created [`evals/README.md`](evals/README.md) and updated [`README.md`](README.md) to state plainly that `bin/cli.mjs eval` (`--baseline`) is a **deterministic CI schema & fixture validator**, not a live multi-model benchmark score.
  - Strengthened [`skills/04-fill-and-apply.md`](skills/04-fill-and-apply.md) and [`docs/execution-safety.md`](docs/execution-safety.md) so the Live DOM Read-Back Table, explicit `APPROVE` gate, and `3–9 s` human pacing jitter are documented as non-negotiable operational trust boundaries.

## [1.2.1] - 2026-11-18 — Pre-Launch DX, Context & Honest Eval Hotfix

### Fixed
- **Quick Start Command & Legacy Header Cleanup:**
  - Replaced un-published `npx job-hunter-os` references across `README.md`, `README.ar.md`, `llms.txt`, and `docs/` with `npx github:redasalem/job-hunter-os` so new users never hit an npm `404` before npm publishing is live.
  - Removed the legacy `<!-- LOVABLE:BEGIN --> ... <!-- LOVABLE:END -->` block (`supabase/migrations/`, `drizzle/`, `LOVABLE_API_KEY`) from `AGENTS.md`.
- **Playwright MCP `stdio` Hang & PDF Capability:**
  - Added `"-y"` and `"--caps=pdf"` to Playwright MCP configurations in `mcp/mcp.template.json`, `mcp/claude_desktop_config.example.json`, and `opencode.json`.
  - Added explicit `#grnhse_iframe` embed switching and click-to-mount portal `listbox` instructions to [`skills/04-fill-and-apply.md`](skills/04-fill-and-apply.md) and [`skills/platforms/ats-engines.md`](skills/platforms/ats-engines.md).
- **Context Footprint (~86% Smaller `REGISTRY.md` & Focused `.agents/skills/`) & Unified Timing:**
  - Compacted `skills/REGISTRY.md` from ~27 KB to ~4.6 KB while keeping all 47 skills indexed.
  - Trimmed `.agents/skills/` from 40 wrappers to the 12 primary user-facing entrypoints (`demo`, `setup`, `daily-run`, `apply-url`, `tailor-cv`, `weekly-report`, `linkedin-growth`, `offer-negotiator`, `recruiter-inbox-triage`, `rejection-pattern-analyzer`, `score-calibration`, `contract-and-nda-auditor`), enforced in CI.
  - Unified timing rules across [`skills/04-fill-and-apply.md`](skills/04-fill-and-apply.md), [`skills/18-condition-based-browser-waiting.md`](skills/18-condition-based-browser-waiting.md), and [`docs/execution-safety.md`](docs/execution-safety.md) (condition-based snapshot checks first + single 3–9 s human pacing jitter between page submissions).
- **Honest External Model Eval Grader & Auto-Deployed Pages:**
  - Added [`evals/PROMPT.md`](evals/PROMPT.md) and `eval --file <json>` / `--baseline` flags to [`bin/cli.mjs`](bin/cli.mjs), clearly labeling `--baseline` as **"Harness Reference Baseline (CI Self-Test)"**.
  - Updated [`.github/workflows/pages.yml`](.github/workflows/pages.yml) to auto-deploy `docs/` on `main` pushes and updated preview links to `https://redasalem.github.io/job-hunter-os/demo-dashboard.html`.

## [1.2.0] - 2026-11-18 — The Verified & Consolidated Edition

### Added
- **Deterministic Skill Evaluation Harness (`evals/` & `npx job-hunter-os eval`):**
  - 20 automated assertions (`EVAL-01`..`EVAL-20`) grading [`evals/results/baseline-verified-run.json`](evals/results/baseline-verified-run.json) against ground-truth [`evals/fixtures/candidate-profile.md`](evals/fixtures/candidate-profile.md), 5 edge-case job descriptions (`01-strong-match.md`, `02-prompt-injection-trap.md`, `03-ghost-expired-job.md`, `04-blacklist-duplicate.md`, `05-stretch-mismatch.md`), and 3 self-contained local HTML ATS form mocks (`greenhouse-mock.html`, `lever-mock.html`, `ashby-mock.html`).
  - Executed on every commit in GitHub Actions across Linux, macOS, and Windows (`20/20` assertions passing).
- **Platform Playbook 60-Day Freshness Audit (`last_verified` & `npx job-hunter-os doctor`):**
  - Added `last_verified: "2026-11-18"` frontmatter to all platform playbooks in `skills/platforms/` and upgraded `doctor` to warn automatically when any playbook exceeds 60 days without verification.
  - Added [`.github/ISSUE_TEMPLATE/playbook-broke.md`](.github/ISSUE_TEMPLATE/playbook-broke.md) so contributors can report DOM changes with a redacted `browser_snapshot`.
- **Arabic RTL Translation (`README.ar.md`), Trimmed `README.md` & Interactive Dashboard Preview (`docs/demo-dashboard.html`):**
  - Created [`README.ar.md`](README.ar.md) (full RTL Arabic documentation).
  - Extracted deep reference tables into [`docs/SKILL_CATALOG.md`](docs/SKILL_CATALOG.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
  - Added pre-loaded interactive preview [`docs/demo-dashboard.html`](docs/demo-dashboard.html) and [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

### Changed
- **Consolidated & Deduplicated Skill Catalog (57 -> 47 High-Signal Skills, 41 -> 40 `.agents/skills/` Wrappers):**
  - Merged 10 duplicate single-board boilerplate files (`indeed.md`, `glassdoor.md`, `dice.md`, `ziprecruiter.md`, `weworkremotely.md`, `remoteok.md`, `welcometothejungle.md`, `builtin.md`, `wuzzuf.md`, `bayt.md`) into their canonical category playbooks ([`global-boards.md`](skills/platforms/global-boards.md), [`remote-boards.md`](skills/platforms/remote-boards.md), [`mena-boards.md`](skills/platforms/mena-boards.md)) and removed duplicate `.agents/skills/portfolio-auditor` in favor of `.agents/skills/portfolio-and-github-auditor`.
- **Upgraded GitHub Actions to Node 24 Native (`@v5`):**
  - Upgraded `actions/checkout` and `actions/setup-node` to `@v5` across `.github/workflows/validate-repo.yml` and `.github/workflows/publish-npm.yml`.

## [1.1.0] - 2026-11-18 — Resilience, Security & Chaos Shield Edition

### Added
- **3 New Security, Anti-Ban & Chaos-Resilience Skills (`57` Total Skills in `skills/REGISTRY.md` & `skills/skills-manifest.json`):**
  - [`skills/24-circuit-breaker-and-antiban.md`](skills/24-circuit-breaker-and-antiban.md): Defines immediate trip conditions (CAPTCHA, Cloudflare/DataDome/Arkose frames, HTTP 429/403 rate limits, unusual-activity banners, or forced login redirects) and persists a 24-hour platform lock in `logs/circuit-breaker.json`.
  - [`skills/25-prompt-injection-defense.md`](skills/25-prompt-injection-defense.md): Treats all scraped JDs and form labels inside `browser_snapshot` as `UNTRUSTED_EXTERNAL_DATA`, blocks indirect prompt injections and honeypot trap fields, and distinguishes benign recruiter Easter-egg attention checks (`"Include PINEAPPLE in cover letter"`) in the Mission Control Table.
  - [`skills/26-deduplication-and-blacklist-guard.md`](skills/26-deduplication-and-blacklist-guard.md): Enforces `blacklisted_companies` and `blacklisted_domains` in `context/preferences.yaml` plus cross-channel canonical job fingerprinting (`normalize(company)::normalize(role_title)`) against `logs/applications-log.json`.
- **Pre-Submit Final DOM Read-Back & PDF Page-Overflow Gate:**
  - Updated [`skills/04-fill-and-apply.md`](skills/04-fill-and-apply.md) to require a **Live DOM Read-Back Table** from a fresh `browser_snapshot` before requesting `APPROVE`, verifying attached `resume.pdf` filename, phone country code, dropdown values, and empty honeypot fields.
  - Updated [`skills/03-tailor-resume-and-verify.md`](skills/03-tailor-resume-and-verify.md) and [`templates/ats-resume-template.html`](templates/ats-resume-template.html) with character/bullet budgets and `@media print` `orphans`/`widows`/`break-inside` rules to prevent 2-page orphan spills.
- **CLI Crash Recovery (`unlock`), JSON Integrity Backup (`backup`) & Git Pre-Commit PII Shield (`bin/cli.mjs`):**
  - `npx job-hunter-os unlock`: Safely removes stale Chromium lock files (`SingletonLock`, `SingletonCookie`, `SingletonSocket`, `lockfile`, `DevToolsActivePort`) from `browser-profile/` after a browser crash across Windows, macOS, and Linux.
  - `npx job-hunter-os backup`: Verifies JSON parse integrity of `logs/applications-log.json`, `logs/skipped-jobs.json`, and `logs/circuit-breaker.json` and snapshots `context/` + `logs/` into timestamped `logs/backups/backup-<timestamp>/` directories.
  - Automatic `.git/hooks/pre-commit` PII & secret shield installed during `init` and `doctor` to block accidental commits of private `context/*`, `*.pdf`, `browser-profile/`, `logs/`, or API tokens (`ntn_`, `sk-`, `ghp_`).

## [1.0.0] - 2026-11-18

### Added
- **54-Skill Progressive Disclosure Catalog (`skills/REGISTRY.md` & `skills/skills-manifest.json`):**
  - **25 Core & Career-Ops Playbooks (`00`–`23` + `fallback-no-mcp`):** Readiness Gatekeeper with live URL reachability verification (`00`), Daily Run Orchestrator (`00`), Pure-AI CV Ingestion (`01`), Batch Discovery, Ghost-Job Filter & Mission Control (`02`), Anti-Hallucination HTML/PDF Tailoring & Humanizer (`03`), Upload-First ATS Form Filling & `APPROVE` Gate (`04`), Interview Dossier & `<= 75`-Word Outreach (`05`), Local JSON + Optional Notion Sync & Weekly Reports (`06`), Multi-Persona Career Switcher (`07`), 7-Day Follow-Up Radar (`08`), Salary & B2B Rate Negotiator (`09`), Scheduled `/loop` Runner (`10`), GitHub & Portfolio Auditor (`11`), Recruiter Inbox Triage (`12`), Company Due Diligence & Health Badges (`13`), Privacy & PII Redaction Shield (`14`), Multilingual & RTL Adaptation (`15`), Rejection Pattern Analyzer (`16`), Score Calibration & Weight Tuner (`17`), Condition-Based Browser Waiting (`18`), On-Demand MCP Tool Routing (`19`), Skill Authoring Standard (`20`), ATS Keyword Heatmap (`21`), Technical Assessment Architect (`22`), and Employment Contract & B2B NDA Auditor (`23`).
  - **4 Reliability Meta-Skills:** `meta-self-verification`, `meta-dom-recovery`, `meta-context-compaction`, and `meta-structured-debugging`.
  - **18 Job-Board & Regional Playbooks (`skills/platforms/`):** LinkedIn, Wellfound, Indeed, Glassdoor, WeWorkRemotely, RemoteOK, Welcome to the Jungle (Otta), BuiltIn, Dice, ZipRecruiter, Wuzzuf, Bayt, B2B Contract Networks (`Toptal`, `Braintrust`, `Lemon.io`, `Gun.io`, `Contra`, `Arc.dev`, `Turing`), plus regional/category routers (`global-boards`, `remote-boards`, `mena-boards`, `ats-engines`).
  - **7 Employer ATS Engine Playbooks (`skills/ats/`):** Greenhouse, Lever, Ashby, SmartRecruiters, BreezyHR, Workday, and Taleo.
- **Complete `agentskills.io` Auto-Discovery (`.agents/skills/*/SKILL.md`):**
  - Synchronized `SKILL.md` wrappers for all primary workflows (`00`–`23`), meta-skills, and slash-command entrypoints so `/skills` auto-discovers immediately in VS Code Copilot, Cursor, OpenAI Codex CLI, OpenCode, Goose, Amp, and Zed.
- **Zero-Dependency Cross-Platform Node.js CLI (`bin/cli.mjs`) & OS One-Liners (`scripts/install.sh`, `scripts/install.ps1`):**
  - Built strictly on Node.js 18+ built-in modules (`dependencies: {}`, `devDependencies: {}`).
  - Commands: `init [--global] [--ide <name>]`, `update`, `doctor` (with live profile/portfolio URL verifier), `status` (gates, warm-up cap & funnel summary), `bundle` (single-file web-chat master prompt exporter to `logs/exports/web-chat-master-prompt.md`), `dashboard` (local Kanban & analytics generator at `logs/exports/dashboard.html`), `login`, and `sync-mcp`.
- **Zero-Server Local HTML Kanban & Analytics Dashboard (`templates/analytics-dashboard.html`):**
  - Single-file HTML/CSS/JS dashboard displaying KPI cards, 5-column lifecycle Kanban board (`Applied`, `Interviewing`, `Technical Assessment`, `Offer`, `Rejected / Ghosted`), platform yield breakdown, instant JSON file loader, and synthetic demo mode.
- **15-Second Sandbox `/demo` Mode & Real Output Showcase (`examples/`):**
  - Fictional profile, 3 sample JDs, and expected Mission Control output in `examples/sandbox-demo/`.
  - Sample interview dossier, `<= 75`-word hiring manager outreach, and onboarding transcript in `examples/outputs/`.
- **25+ AI IDE Entrypoints & 6 Model-Specific Tuning Guides (`adapters/`):**
  - Native rules/workflows for Antigravity, Cursor, Claude Code, Claude Desktop, Gemini CLI, OpenAI Codex CLI, Devin Desktop / Windsurf, OpenCode, Kilo Code, Cline, Roo Code, JetBrains Junie, AWS Kiro, Trae, Zed, Goose, Aider, OpenHands, Warp, Augment, Crush, and GitHub Copilot.
- **Ecosystem & Governance Standards:**
  - `PLATFORMS.md` compatibility matrix, `llms.txt` (`llmstxt.org` discovery), `HIRED.md` community success ledger, MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, cross-OS GitHub Actions CI (`.github/workflows/validate-repo.yml`), and automated npm release workflow (`.github/workflows/publish-npm.yml`).
