# Contributing to Veycraft

`veycraft` uses a **Markdown-first architecture with a supported, zero-dependency Node.js CLI (`bin/cli.mjs`)**.

Before opening a PR, review the contributor acceptance contract in [`ACCEPTANCE.md`](ACCEPTANCE.md) (which maps non-negotiables to CI/CLI checks) and complete the professionalism, risk, and test-plan sections in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).

Every contribution must preserve the foundational constraints:

- **Zero npm dependencies in the core:** `package.json` must remain strictly `"dependencies": {}` and `"devDependencies": {}`. Use Node.js built-ins, pure Markdown, HTML, CSS, JavaScript, and SVG only.
- **No backends, databases, SaaS wrappers, or telemetry:** Optional MCP integrations (`Playwright MCP`, `Notion MCP`) remain strictly opt-in and separate from the core.
- **Safe Wedge & Truthfulness:** Never introduce fabricated CV facts, CAPTCHA/ToS bypasses, stealth browser plugins, or any bypass around the explicit job-specific human `APPROVE` gate.
- **Local-first privacy:** Never commit real CVs, personal `context/*` files (except `*.example`), `logs/`, `browser-profile/`, `*.pdf`, cookies, tokens, or `.env`.

### When Contributions May Modify `bin/cli.mjs`

Changes to `bin/cli.mjs` (and `scripts/install.{sh,ps1}`) are welcome when they improve:
- Cross-OS reliability (macOS, Linux, Windows path/lock/atomic-write handling).
- Deterministic safety or hygiene validators (`eval`, `proof`, `pre-submit`, `audit`, `doctor`, `backup`, `unlock`).
- IDE skill/command discovery (`installIdeSkills`) or safe MCP config merging (`sync-mcp`).

Never add npm dependencies, network telemetry, or custom headless scraping backends to `bin/cli.mjs`.

---

## Three High-Impact Contribution Paths

### Path 1: Add or Improve an ATS Synthetic Fixture

Help strengthen deterministic form-handling coverage for employer ATS portals (e.g., SmartRecruiters, BreezyHR, BambooHR, Recruitee, or deeper edge cases in Greenhouse/Lever/Ashby).

- **What to do:** Create or expand a self-contained static HTML form fixture replicating real ATS form patterns (file upload input, split phone/name fields, custom combobox/listbox, EEO dropdowns, GDPR vs. marketing checkboxes, hidden honeypot field) using 100% synthetic employer/role copy.
- **Files to modify:**
  - `evals/fixtures/forms/<ats>-mock.html`
  - `evals/RUBRIC.md` (document any new assertion)
  - `bin/cli.mjs` (only if adding a deterministic check in `evaluateEvalSuite`)
  - `README.md` (if moving an ATS engine into the Fixture-Verified tier)
- **Required evidence:** Fixture HTML loads cleanly offline with zero external scripts/assets; no real employer tokens or candidate PII.
- **Validation instructions:**
  ```bash
  node --check bin/cli.mjs
  node ./bin/cli.mjs eval --baseline
  node ./bin/cli.mjs proof
  ```
- **Acceptance criteria:** `eval --baseline` passes 100%, `proof` automatically picks up the new HTML fixture count/name, and `package.json` stays `dependencies: {}` / `devDependencies: {}`.

---

### Path 2: Verify or Improve a Regional Job-Board Playbook

Expand truthful, accessibility-first coverage for regional job boards marked **Help Wanted** in [`PLATFORMS.md`](PLATFORMS.md) (e.g., GulfTalent, Bayt, Naukri, StepStone, TokyoDev, LATAM portals).

- **What to do:** Copy [`skills/platforms/_template.md`](skills/platforms/_template.md) (or update an existing category playbook in `skills/platforms/`). Document exact HTTPS hostnames, auth indicators, stable posting ID extraction, accessibility-snapshot roles/labels/refs (never brittle CSS selectors), upload/consent behavior, and `last_verified` date.
- **Files to modify:**
  - `skills/platforms/<board>.md` (must include all 8 YAML frontmatter keys + `last_verified` and the 3 mandatory H2 headers per [`skills/20-skill-authoring-standard.md`](skills/20-skill-authoring-standard.md))
  - `skills/REGISTRY.md` and `skills/skills-manifest.json` (if adding a new skill file)
  - `context/targets.yaml.example` (add a disabled `enabled: false` synthetic example)
  - `PLATFORMS.md` and `docs/platform-registry.md`
- **Required evidence:** A redacted `browser_snapshot` excerpt (no real name, email, phone, or session cookies) from an owner-authorized session, OR explicitly keep `Live-tested: UNVERIFIED` until verified live.
- **Validation instructions:**
  ```bash
  node ./bin/cli.mjs doctor
  git diff --check
  ```
  Verify valid JSON/YAML, matching skill counts across `skills/REGISTRY.md` and `skills/skills-manifest.json`, and zero broken Markdown links.
- **Acceptance criteria:** Passes `.github/workflows/validate-repo.yml` frontmatter, section, link, Unicode/BiDi, and privacy checks; includes zero stealth/CAPTCHA bypass instructions and preserves explicit `APPROVE` gating.

---

### Path 3: Validate an AI IDE or CLI Harness Integration

Verify that first-time users on a specific AI IDE or CLI harness can discover `/demo`, `/quick-tailor`, and `/setup` cleanly after initialization.

- **What to do:** Test local (`init`) and/or global (`init --global`) installation inside an isolated temp directory with your IDE/harness (e.g., Cursor, Claude Code, Codex CLI, Windsurf, Cline, Zed, OpenCode, JetBrains Junie, Kiro, Continue). Fix broken discovery paths or rule instructions if `/demo` or `/quick-tailor` is not picked up cleanly.
- **Files to modify:**
  - The IDE entrypoint file (e.g., `.cursor/rules/job-hunter.mdc`, `CLAUDE.md`, `.windsurfrules`, `opencode.json`, etc.)
  - `bin/cli.mjs` (`installIdeSkills` / `mcpTargetFiles`) if global/local copy paths need correction
  - `docs/COMPATIBILITY.md` and `docs/chat-commands.md`
- **Required evidence:** Exact IDE/harness version tested, OS tested, and confirmation that `/demo` runs without requiring personal data or browser login.
- **Validation instructions:**
  ```bash
  node --check bin/cli.mjs
  node ./bin/cli.mjs init --global   # test in an isolated HOME/USERPROFILE first
  node ./bin/cli.mjs doctor --global
  ```
- **Acceptance criteria:** Existing IDE installations are not broken, existing user MCP/rule collisions are preserved unless `--force` is passed, and zero external dependencies are added.

---

## Skill Contract & Safety Standards

- **Skill Frontmatter & Sections:** Every skill in `skills/` must include the 8 YAML frontmatter keys (`name`, `version`, `description`, `triggers`, `requires_mcp`, `preconditions`, `requires_skills`, `verification`) and the 3 exact H2 headings (`## When to Use & Preconditions`, `## Deterministic Step-by-Step Execution`, `## Anti-Patterns (What NEVER To Do) & Self-Verification Check`).
- **Resume HTML Templates:** Single-column semantic HTML (`templates/ats-resume-template.html`, `templates/ats-cover-letter-template.html`), escaped source facts, zero `<script>` tags, zero remote assets, zero hidden text.
- **Acceptance & Synthetic Examples:** Keep [`ACCEPTANCE.md`](ACCEPTANCE.md) in sync when changing non-negotiable invariants. Use synthetic sample outputs under `examples/outputs/` (such as [`examples/outputs/sample-tailoring-notes.md`](examples/outputs/sample-tailoring-notes.md)) — never commit real CVs or personal candidate data.
- **Security & Conduct:** Report security issues privately per [SECURITY.md](SECURITY.md) and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
