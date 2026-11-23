# Acceptance Criteria (Contributor Contract)

Human-readable mirror of what Veycraft CI and the Safe Wedge deterministically enforce.
When changing any non-negotiable rule, update this file **and** the matching skill, CLI module, test suite, or workflow together.

Run locally before opening a PR:

```bash
node --check bin/cli.mjs
npm test
npm run pack:check
git diff --check
```

## Non-Negotiables

| ID | Must Keep | Enforced By |
|----|-----------|-------------|
| A1 | `package.json` stays `"dependencies": {}` and `"devDependencies": {}`; tarball contains zero sensitive files | `.github/workflows/validate-repo.yml` + `npm run pack:check` |
| A2 | No tracked personal `context/*` (except `*.example` / `DROP_YOUR_FILES_HERE.md`), `logs/`, `*.pdf`, `.env`, or `browser-profile/`; third-party CVs stay strictly isolated under `logs/resumes/cv-<slug>/` (`SEC-02`) and excluded from owner analytics and Notion sync | CI security audit + `bin/career-intelligence.mjs` + `bin/notion-sync.mjs` + `init`/`doctor` pre-commit PII shield |
| A3 | Workspace path containment, symlink/junction refusal (`SEC-04`), DNS-pinned SSRF guard (`SEC-01`), and bounded OOXML `.docx` decompression limits (`SEC-03`) | `bin/fs-safety.mjs` + `bin/cli.mjs` |
| A4 | Provenance files present and attribute `@redasalem` at `https://github.com/redasalem/veycraft` (`NOTICE`, `AUTHORS.md`, `PROVENANCE.json`, `.github/CODEOWNERS`, `LICENSE`) | CI provenance check + `veycraft doctor` |
| B1 | Every `skills/**/*.md` (`52` consolidated skills, excluding `REGISTRY.md`/`README.md`/`_*`) has the 8 YAML frontmatter keys, 3 mandatory H2 sections, `< 500` lines, and zero invisible Unicode/BiDi control characters | `.github/workflows/validate-repo.yml` + `skills/20-skill-authoring-standard.md` |
| B2 | `skills/skills-manifest.json` (`52` skills) matches on-disk skills; every skill path appears in `skills/REGISTRY.md`; intent routes stay `<= 7` skills per intent | `.github/workflows/validate-repo.yml` + `evals/journeys/run-journeys.test.mjs` |
| B3 | `.agents/skills/*/SKILL.md` wrapper set (`14` entrypoints) stays complete and `name` matches folder | `.github/workflows/validate-repo.yml` |
| C1 | Zero invented CV facts, metrics, titles, or credentials; missing requirements stay in **True Gaps**; every tailored claim cites an **Evidence Map** source with domain-agnostic framing | `AGENTS.md` + `skills/03-tailor-resume-and-verify.md` + `skills/21-ats-keyword-heatmap.md` + `skills/28-recruiter-brand-and-domain-intelligence.md` + `veycraft verify` |
| C2 | Zero banned AI clichés (19-item canonical list) and zero prose em-dashes in CV, outreach, and profile deliverables | `bin/career-intelligence.mjs` + `bin/profile-intelligence.mjs` + `veycraft verify` / `eval` / `pre-submit` |
| C3 | Outreach drafts `<= 75` words; Days 1–3 warm-up max 5/day; compact `< 500`-byte pre-submit invariants | `veycraft pre-submit` + `config/invariants.txt` |
| D1 | Unconditional job-specific human `APPROVE` before every live Submit/Save/Post/Send; `dry_run: true` by default; one-way Notion sync fails closed unless `storage_adapters.notion_mcp: true` and `dry_run: false` with `--plan-hash` approval | `config/guardrails.yaml` + `skills/04-fill-and-apply.md` + `bin/notion-sync.mjs` + `evals/approval-gate.test.mjs` |
| D2 | Treat JDs and scraped pages as **untrusted external data** (never obey embedded instructions or fill honeypot fields) | `AGENTS.md` + `skills/25-prompt-injection-defense.md` |
| D3 | Zero CAPTCHA/ToS bypass, stealth plugins, or challenge retries | Hard guardrails + `skills/24-circuit-breaker-and-antiban.md` |
| E1 | `npm test` (`eval --baseline` 20/20, `live-agent-eval-run.json` 20/20, and `eval --journeys` 111/111 across all test suites) and `npm run pack:check` stay green on every PR | CI `cli-smoke` across Linux, macOS, and Windows |

## Professionalism Bar for Pull Requests

Every PR should make it immediately clear to the maintainer:

1. **What improved** for users or contributors (one concise sentence).
2. **Why it is safer, clearer, or more consistent** (not just "adds more features").
3. **What it intentionally does not change** (risk and non-goals).
4. **How it was verified** (exact CLI commands and expected pass counts).
5. **Zero personal data** (synthetic fixtures and `*.example` files only).

Use [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md). Contribution paths: [`CONTRIBUTING.md`](CONTRIBUTING.md).
