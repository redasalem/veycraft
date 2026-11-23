---
name: portfolio-and-github-auditor
version: "1.0.0"
description: Load when the owner asks to audit their GitHub profile, pinned repositories, or portfolio website before applying; checks live links, README quality, and bio alignment against target roles in context/preferences.yaml without inventing claims.
triggers:
  - audit my GitHub or portfolio
  - check portfolio links before applying
  - portfolio-auditor
requires_mcp:
  - playwright
preconditions:
  - verified GitHub and/or portfolio URLs exist in context/profile.md or context/resume-data.json
  - target roles loaded from context/preferences.yaml
requires_skills:
  - resume-ingestion
verification:
  - every link on the portfolio and GitHub profile was checked live (broken 404/error links flagged)
  - pinned repositories were audited for README clarity, live demo/screenshots, and stack alignment with target roles
  - concrete prioritized fixes were presented in chat without inventing project metrics or modifying remote repos unapproved
---
# GitHub & Portfolio Pre-Application Auditor

## When to Use & Preconditions

Recruiters and Engineering Managers click your GitHub and portfolio links within 10 seconds of opening your resume. Run this audit before starting a major application wave to catch broken demos, stale bios, or missing READMEs.

- **Load when:** `audit my GitHub or portfolio`; `check portfolio links before applying`; `portfolio-auditor`.
- **Preconditions (stop if any is false):**
  - verified GitHub and/or portfolio URLs exist in `context/profile.md` or `context/resume-data.json`
  - target roles loaded from `context/preferences.yaml`
- **Requires skills:** `resume-ingestion`. **MCP:** playwright.

## Deterministic Step-by-Step Execution

1. **Inspect GitHub Profile & Pinned Repositories (Playwright MCP or `gh` CLI, read-only):**
   - **Fast `gh` CLI Path (when `gh` is authenticated):** Run `gh repo list <user>` and inspect key `package.json` / `README.md` files (`gh api repos/<user>/<repo>/contents/package.json`) to surface real production projects and dependencies missing from `context/cv.md` (keeping private repo details local). Note: updating `<user>/<user>/README.md` uses `repo` scope (`gh api -X PUT ... -f` flags cleanly on Windows), whereas `PATCH /user` metadata requires `user` scope (`gh auth refresh -h github.com -s user`).
   - **Browser Path:** Navigate to the owner's verified `github_url` with 3–9 s pacing and take a `browser_snapshot`.
   - Audit:
     - **Bio & Headline:** Does the bio clearly match the target roles in `context/preferences.yaml` (or active persona in `context/personas/`)?
     - **Pinned Repositories (up to 6):** Open each pinned repo and check:
       - Clear one-line description and relevant GitHub Topics
       - Clean `README.md` (what it does, tech stack, architecture/screenshots, setup steps)
       - Working live demo link (no 404s, parked domains, or localhost URLs)
       - Consistency between repo facts and `context/profile.md` / `context/cv.md`
2. **Inspect Live Portfolio Website (if `portfolio_url` is set):**
   - Navigate to `portfolio_url`, snapshot, and test primary navigation/project/resume links.
   - Flag any HTTP 4xx/5xx pages, broken images, outdated job titles, or mismatch with `context/profile.md` contact details.
3. **Cross-Check Against Target Job Requirements:**
   - Highlight which 2–3 pinned projects best support the owner's target roles and flag any stack gaps or missing project case studies.
4. **Deliver Actionable Audit Scorecard in Chat:**
   - Present a crisp table: `Asset | Status (✅/⚠️/❌) | Issue Found | Exact Fix Recommended`.
   - Write proposed README/bio copy filtered through the Anti-AI Slop & Fact-Check rules (`skills/03-tailor-resume-and-verify.md`) so the owner can review and apply edits (never push to external repos without explicit approval).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Claiming a portfolio link works without opening it in Playwright MCP → ✅ verify every URL with a fresh snapshot.
- ❌ Suggesting fake star counts, user numbers, or fabricated project benchmarks for a README → ✅ use only verified facts.
- ❌ Pushing changes to the owner's GitHub profile or repos silently → ✅ present audit findings and draft copy in chat first.

### Self-verification check (before reporting this step complete)
- [ ] every link on the portfolio and GitHub profile was checked live (broken 404/error links flagged)
- [ ] pinned repositories were audited for README clarity, live demo/screenshots, and stack alignment with target roles
- [ ] concrete prioritized fixes were presented in chat without inventing project metrics or modifying remote repos unapproved
