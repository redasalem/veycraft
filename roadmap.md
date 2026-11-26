# Veycraft Architecture & Release Roadmap

## Completed Milestones (`v1.0` → `v2.8.5`)

- [x] **Zero-Dependency Node.js CLI & Tokenless OIDC Release Pipeline:** Strictly `"dependencies": {}` and `"devDependencies": {}` in [`package.json`](package.json), published on [`npmjs.com/package/veycraft`](https://www.npmjs.com/package/veycraft) via **npm OIDC Trusted Publishing** with Sigstore Provenance (`0` long-lived tokens).
- [x] **56 Portable Markdown Skills & 17 Auto-Discovered Wrappers:** Core career-ops playbooks (`00`–`30`, `54`–`56`, `linkedin-growth.md`, `profile-intelligence-engine.md`, `fallback-no-mcp.md`), `4` `meta-*` reliability playbooks, `7` job-board/contract playbooks, and `7` ATS engine playbooks indexed in [`skills/REGISTRY.md`](skills/REGISTRY.md) and [`skills/skills-manifest.json`](skills/skills-manifest.json) with Progressive Disclosure (`<= 7` skills loaded per turn).
- [x] **4-Pillar Token-Efficiency Fast-Path (`v2.7`–`v2.8`, Track A & Track B):**
  - `veycraft onboard` — 60-second onboarding wizard (interactive TTY, `--stdin`, and CI-safe `--non-interactive`).
  - `veycraft brief` — Zero-PII `< 400`-token candidate brief (`context/brief.json`) with `mtimeMs + sha256` invalidation.
  - `veycraft feed-scan --all` — Multi-source RSS/Atom/JSON opportunity radar (`max 4` bounded concurrency, `Promise.allSettled` fault isolation, **SEC-01** DNS-pinned SSRF guard, cross-feed dedup, and `logs/radar/YYYY-MM-DD.md` daily digest).
  - `veycraft browser-script` — Read-only DOM distiller (`distill-feed`, `distill-form`) and non-submitting single-shot `batch-fill` ahead of mandatory human `APPROVE` gates.
- [x] **Universal Freelance & No-Clone GitHub Skills (`v2.5`–`v2.6`):** `/github-remote` ([`skills/54-github-cli-remote-manager.md`](skills/54-github-cli-remote-manager.md)), `/freelance-service` ([`skills/55-freelance-profile-and-service-publisher.md`](skills/55-freelance-profile-and-service-publisher.md)), and `/freelance-bid` ([`skills/56-freelance-offer-radar-and-batch-bidder.md`](skills/56-freelance-offer-radar-and-batch-bidder.md)).
- [x] **Read-Only Local Web UI & Native 8-Tool MCP Server (`v2.3`–`v2.4`):** Loopback-only `127.0.0.1` dashboard (`npx veycraft ui`) with strict CSP/Host/Origin guards, plus a zero-dependency `stdio` MCP server (`npx veycraft mcp`) exposing `8` read-only offline tools and allowlisted `veycraft://` resources.
- [x] **Deterministic Multi-OS Evaluation & Security Suite:** `20/20` baseline & live-agent eval assertions, `132/132` synthetic task-journey tests, and `117+` unit/integration tests across Ubuntu, macOS, and Windows (`.github/workflows/validate-repo.yml`) with `0` open CodeQL alerts.

## Next Priorities (Post-Launch Roadmap)

- [ ] **Track C — Proposal & Resume Outcome Calibration:** Deterministic win-rate and callback cohort analytics across `tracker/freelance-proposals.md` and `logs/applications-log.json` (`MIN_N = 5` sample-size guardrails) to tune `Fit Score` weights from real outcomes.
- [ ] **Track D — Offline Marketplace & Regional ATS Fixture Packs:** Deterministic offline HTML fixtures (`evals/fixtures/`) for Upwork, Mostaql, Malt, and APAC/LATAM job boards so community contributors can test DOM extraction without live accounts.
- [ ] **Community Skill Contributions:** Domain-specific resume/portfolio archetypes and additional public RSS/JSON job-board presets via [`skills/20-skill-authoring-standard.md`](skills/20-skill-authoring-standard.md).
