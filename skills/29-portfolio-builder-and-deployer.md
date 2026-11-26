---
name: portfolio-builder-and-deployer
version: "1.1.0"
description: Load when the user asks to design, build, customize, preview, update, or deploy a personal or third-party portfolio website (/build-portfolio) using static HTML/CSS/JS or modern frontend frameworks and hosting CLIs or manual hosting providers.
triggers:
  - /build-portfolio
  - build my portfolio
  - create a portfolio website
  - deploy my portfolio
  - update my portfolio site
  - build a portfolio for someone
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - verified candidate facts available in context/ or supplied in the active session
  - isolated target directory under logs/portfolio/<site-slug>/ (or user-selected external directory) is writable
requires_skills:
  - resume-ingestion
  - tailor-resume-and-verify
  - portfolio-and-github-auditor
  - portfolio-design-system-and-qa
  - privacy-pii-shield
  - recruiter-brand-and-domain-intelligence
  - meta-self-verification
verification:
  - portfolio files and dependencies stay strictly isolated inside logs/portfolio/<site-slug>/ (or logs/portfolio/third-party-<slug>/ or external folder) with root package.json at 0/0 dependencies and Veycraft git remote untouched
  - every project, metric, title, and credential on the site maps to verified candidate data with 0 banned AI cliches, 0 prose em-dashes, and 0 unconfirmed metrics
  - pre-publish privacy and secret audit confirmed 0 private phone/address/salary/NDA leaks and 0 exposed API tokens or client-bundle secrets
  - DESIGN_PLAN.md, tokens.css, and 3-layer QA (qa-report.md within <= 3 self-healing cycles) passed before localhost preview, Deploy Confirmation Table received explicit APPROVE, and live HTTPS URL returned 200 with intact assets before reporting deployed
---
# Personalized Portfolio Builder, Privacy Gate & Multi-Host Deployer

## When to Use & Preconditions

Builds a domain-adaptive, recruiter-ready or client-converting portfolio website grounded strictly in verified candidate evidence, previews it locally inside an isolated workspace, and optionally deploys it through modern hosting CLIs or step-by-step hosting guides without risking PII leaks or repository contamination.

- **Load when:** `/build-portfolio`; `build my portfolio`; `create a portfolio website`; `deploy my portfolio`; `update my portfolio site`; `build a portfolio for someone`.
- **Preconditions (stop if any is false):**
  - verified candidate facts exist in `context/` or are confirmed in the active chat session (never force full 5-gate `/setup`)
  - isolated output directory under `logs/portfolio/<site-slug>/` (or user-chosen external directory) is writable
- **Requires skills:** `resume-ingestion`, `tailor-resume-and-verify`, `portfolio-and-github-auditor`, `portfolio-design-system-and-qa`, `privacy-pii-shield`, `recruiter-brand-and-domain-intelligence`, `meta-self-verification`. **MCP:** none (`playwright` optional for local/live visual preview and link checks).

## Deterministic Step-by-Step Execution

### 1. Phase 1 - 2-Mode Entry, Context Ingestion & Strict Workspace Isolation
- **Explicit 2-Mode Portfolio Workflow (Tell the User the Exact Isolated Path First):**
  Before touching files, confirm which mode the user wants and state the exact gitignored isolated folder path **`workspace/portfolio/`** (while keeping `logs/portfolio/<site-slug>/` supported for multi-site or third-party isolation):
  - **Mode A — Build from Scratch:** Generate a brand-new portfolio project inside isolated `workspace/portfolio/` (or `logs/portfolio/<site-slug>/`).
  - **Mode B — Import & Upgrade Existing:** Instruct the user to clone or drop their existing portfolio repository/files into **`workspace/portfolio/`**, inspect its current stack, structure, and assets in place, and upgrade its design system, verified copy, accessibility, and QA without altering the Veycraft repository root.
- **Read Verified Sources First (`skills/01-resume-ingestion.md`, `skills/11-portfolio-and-github-auditor.md`):** Inspect `context/profile.md`, `context/cv.md`, `context/resume-data.json`, `context/github-projects.md` (if present), and `context/preferences.yaml` before asking any questions. Reuse every confirmed role, project, skill, and link without re-asking.
- **Dynamic Domain Archetype (`skills/28-recruiter-brand-and-domain-intelligence.md`):** Infer the candidate's target archetype (`Engineering/Data/AI`, `Product/Design`, `Sales/Marketing/Growth`, `Finance/Accounting/Legal/Risk`, `Healthcare/Clinical/Pharma`, `Operations/Supply Chain/HR`, or `Executive/Generalist`). Never default to software-only layouts or terminology for non-tech candidates.
- **Workspace Isolation & Root Protection Lock:**
  - **Owner Default Paths:** `workspace/portfolio/` (primary 2-mode isolated workspace) or `logs/portfolio/<site-slug>/` (both gitignored in `.gitignore`, hard-blocked from commits by `.git/hooks/pre-commit` and CI security checks, excluded from npm tarballs, and skipped by `veycraft backup`).
  - **Third-Party Subject Isolation (`SEC-02`):** When building a site for another person, write strictly under `logs/portfolio/third-party-<slug>/` and **NEVER** read from or write to owner `context/` files.
  - **Optional Standalone External Path:** Offer `~/projects/<slug>-portfolio` (or another user-chosen folder outside the Veycraft clone) when scaffolding a Git-backed framework repository (`Astro`, `Vite`, `Next.js`) so nested `.git` metadata and `node_modules/` stay completely outside Veycraft.
  - **Symlink & Root Guard (`SEC-04`):** Refuse symlinked parent paths. **NEVER** run `npm install`, `npm create`, `npx create-*`, `git init`, or deploy CLIs in the Veycraft root, and **NEVER** modify Veycraft's root `package.json` (`dependencies: {}`, `devDependencies: {}`).
  - **Iterative Update Persistence:** Save `<portfolio-dir>/portfolio-manifest.json` (`site_slug`, `mode`, `owner_scope`, `archetype`, `stack_tier`, `style_preset`, `locale`, `public_contacts`, `deploy_target`, `live_url`) so follow-up `"update my portfolio"` requests edit in place without re-interviewing.

### 2. Phase 2 - Smart Batched Portfolio Interview (3-4 Questions/Batch, Max 2 Batches)
Ask only what is missing after Phase 1 inspection:
- **Batch 1 - Positioning, Visual Direction & Domain Modules:**
  1. **Primary Goal & Audience (`skills/28`):** Recruiter-first (6-10s hiring scan), Freelance/Client Conversion, or Executive/Thought-Leadership Brand.
  2. **Visual Preset, Palette & Locale:** Style (`Minimalist Editorial`, `Dark Bento Tech`, `Clean Executive`, `Creative Showcase`), color palette (7 curated WCAG-AA agency palettes or `Custom` brand hex + Light/Dark toggle via `skills/30-portfolio-design-system-and-qa.md`), and locale (`LTR English`, `RTL Arabic` via `skills/15-multilingual-adaptation.md`, or bilingual switcher).
  3. **Modular Sections:** Core (`Hero + Buyer Pain Point Hook`, `About`, `Featured Work / Case Studies`, `Experience Timeline`, `CV Download`, `Contact/CTA`) plus optional domain modules (`Services & Process`, `Testimonials`, `Licenses & Certifications`, `Publications/Writing`, `Open-Source Highlights`).
- **Batch 2 - Tech Stack, Hosting Target & Public Privacy Filter:**
  1. **Tech Stack Selection:** Present the 4-tier stack matrix in Phase 3 (plus custom stack support).
  2. **Hosting Platform & Custom Domain:** Present the CLI-Native matrix + Smart Fallback in Phase 5.
  3. **Public Privacy Filter (`skills/14-privacy-pii-shield.md`):** Because a live website is indexed publicly by search engines, ask explicitly which contact channels to publish (`public email`, `LinkedIn`, `GitHub`, `Calendly`/booking link, or static contact form) and exclude private phone numbers, home street addresses, DOB, salary floors, and unapproved private/NDA client repositories by default.
- **Pre-Code Hand-Off - Upfront Design Blueprint, Separated Data & Token Lock (`skills/30-portfolio-design-system-and-qa.md` Phases 1-2):**
  - Before writing or modifying any UI code in Phase 3 (for both Mode A and Mode B), present and confirm a crisp **Upfront Design Blueprint** tailored to the candidate's verified profile covering: **(1) Color Palette** (WCAG 2.1 AA light/dark tokens), **(2) Design System / Layout** (typography pairing, visual preset, responsive grid, narrative section order, LTR/RTL rules), and **(3) Tech Stack** (Tier 1–4 or preserved Mode B stack).
  - Execute `skills/30-portfolio-design-system-and-qa.md` Phases 1-2 inside `<portfolio-dir>` to author `DESIGN_PLAN.md`, extract verified copy into separated `portfolio-data.json` (or `src/data/portfolio-data.ts`), validate WCAG 2.1 AA contrast + RTL/LTR font pairings, lock `design-tokens.json` + `tokens.css`, and close with a compact **Next-Step Handoff** (in the user's active conversation language) requesting owner confirmation before coding.

### 3. Phase 3 - Curated Tech Stack Matrix & Isolated Local Build (`LOCAL_PREVIEW_ONLY`)
- **Select Stack Tier (or User-Requested Custom Stack such as Vue/Nuxt, SvelteKit, or Hugo under identical isolation):**

  | Tier | Stack | Best For | Build Output |
  |---|---|---|---|
  | **Tier 1 (Default)** | Vanilla HTML5 + Modern CSS (or Tailwind) + Vanilla JS | Instant build, zero `node_modules`, fastest universal hosting | `.` (`index.html`, `styles.css`, `main.js`) |
  | **Tier 2** | Astro + Tailwind CSS | Content-rich case studies, blog/writing, Lighthouse 100 SEO | `dist/` |
  | **Tier 3** | Vite + React (TypeScript) + Tailwind CSS | Interactive dashboards, filterable showcases, motion UI | `dist/` |
  | **Tier 4** | Next.js (App Router, `output: 'export'` or Vercel) + Tailwind CSS | React ecosystem portfolios and full-stack expansion | `out/` or `.next/` |

- **Domain-Adaptive Case Study & Section Mapping (`skills/28`):**

  | Domain Archetype | Featured Work Card Structure | Priority Optional Modules |
  |---|---|---|
  | **Engineering / Data / AI** | System Constraint -> Architecture -> Verified Latency/Scale/Tests + Repo/Demo Link | `Open-Source Highlights`, `Writing` |
  | **Product / Design** | User/Business Problem -> Discovery & Tradeoffs -> Verified Adoption/Conversion Lift | `Case Study Deep-Dives`, `Testimonials` |
  | **Sales / Marketing / Growth** | ICP & Funnel Bottleneck -> Campaign/Motion -> Verified Pipeline/ARR/ROAS Outcome | `Services & Process`, `Testimonials` |
  | **Finance / Legal / Healthcare** | Regulatory/Fiduciary Scope -> Controls/Protocols -> Verified Compliance/Audit/Clinical Proof | `Licenses & Certifications`, `Publications` |
  | **Operations / HR / Executive** | Org/SLA Challenge -> Operating Model -> Verified Cost/OTIF/Retention/P&L Impact | `Advisory / Services`, `Publications` |

- **Scaffold & Author Strictly Inside `<portfolio-dir>`:**
  - Execute every `npm`/`npx` command with working directory locked to `<portfolio-dir>`.
  - Consume locked `<portfolio-dir>/tokens.css` (`0` hardcoded hex colors) and separated `portfolio-data` (`0` hardcoded resume prose) while enforcing semantic HTML5 landmarks, mobile-first responsive grids (`320px` to `1440px+`), `WCAG AA` contrast, keyboard focus rings, `prefers-reduced-motion`, clean `dir="rtl"`/`dir="ltr"` logical CSS, OpenGraph/Twitter social cards, JSON-LD `Person` structured data, `robots.txt`, `sitemap.xml`, and SVG favicon.
  - **Fact & Anti-Slop Enforcement (`skills/03-tailor-resume-and-verify.md`, `skills/28-recruiter-brand-and-domain-intelligence.md`):** Order projects and achievements by the **Proof Density Hierarchy** (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact/Deliverable > Credential/Tool`). Exclude `requires_user_confirmation` metrics from `context/github-projects.md` until owner-confirmed. Enforce **0 banned AI cliches** (19-item list) and **0 prose em-dashes**.
  - If the owner opts into a downloadable CV button, copy only an owner-approved public CV version into `<portfolio-dir>/public/` after confirming public PII preferences.

### 4. Phase 4 - Pre-Publish Privacy, Automated QA & Local Preview Gate
1. **Pre-Publish Privacy & Secret Audit (`skills/14-privacy-pii-shield.md`):**
   - Scan source files and built artifacts (`index.html`, `dist/`, `out/`, `.next/`) to verify:
     - `0` unconsented phone numbers, street addresses, national IDs, salary figures, or NDA client names/code.
     - `0` `{{...}}` or `example.invalid` placeholder strings.
     - `0` secrets or tokens in source files, `.env*`, or client-exposed env prefixes (`VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`), and never print `VERCEL_TOKEN`, `NETLIFY_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `FIREBASE_TOKEN`, `SURGE_TOKEN`, `ghp_`, or `github_pat_`.
   - Verify Veycraft's root `package.json` still has `"dependencies": {}` and `"devDependencies": {}`.
2. **Multi-Layer Automated QA & Bounded Self-Healing Hand-Off (`skills/30-portfolio-design-system-and-qa.md` Phases 3-4):**
   - Before presenting `localhost` sign-off or entering Phase 5, run all 3 automated QA layers inside `<portfolio-dir>`: Layer 1 Static/Type/Build gate (`exit 0`), Layer 2 stack-aware Unit/Component tests (`node --test` for Tier 1 or isolated `<portfolio-dir>` `vitest` for Tiers 2-4), and Layer 3 multi-viewport Visual/Overflow/Console QA at `375px`, `768px`, and `1440px`, writing `<portfolio-dir>/qa-report.md`.
   - Trigger the **Bounded Self-Healing Loop (max 3 cycles)** on any failure; if any layer remains red after Cycle 3, stop and block `localhost` sign-off and Phase 5 deployment.
3. **Production Build & Local Preview (`LOCAL_PREVIEW_ONLY` Default):**
   - Once `<portfolio-dir>/qa-report.md` is green, launch a local preview server (`npx serve`, `npm run preview`, or `python3 -m http.server` on `localhost`), share the local preview URL + `qa-report.md` summary, and support iterative token or copy edits before deploying.

### 5. Phase 5 - Hosting CLI Matrix, Smart Fallback Engine & Approval-Gated Deployment
- **First-Class CLI-Native Hosting Matrix (Run Strictly Inside `<portfolio-dir>`):**
  1. **Vercel (`vercel`):** Pre-flight `vercel whoami` -> deploy draft preview (`vercel`) -> production (`vercel --prod`) only after `APPROVE`.
  2. **Cloudflare Pages (`wrangler`):** Pre-flight `wrangler whoami` -> deploy via `wrangler pages deploy <dist-dir> --project-name <slug>`.
  3. **Netlify (`netlify-cli`):** Pre-flight `netlify status` -> draft preview (`netlify deploy --dir=<dist-dir>`) -> production (`netlify deploy --prod --dir=<dist-dir>`); wire `data-netlify="true"` + honeypot attribute when static contact forms are requested.
  4. **GitHub Pages & Separate-Repo Enforcement (`gh` CLI on a Dedicated User Repo ONLY):**
     - **Hard Repo Isolation Rule:** Strictly forbid committing, staging, or pushing any user portfolio file into the `veycraft` repository (blocked by `.gitignore` and `.git/hooks/pre-commit`). Before any `git` or `gh` command, verify `pwd` is inside `<portfolio-dir>` (e.g., `workspace/portfolio/`) AND inspect `git rev-parse --show-toplevel` + `git remote -v`. **HARD-BLOCK immediately** if the git root resolves to the Veycraft workspace or if any remote matches `redasalem/veycraft` or `redasalem/job-hunter-os`.
     - **Independent Git Repo + Brand-New User Repository:** Initialize an independent `.git` repo strictly inside `workspace/portfolio/` (or `<portfolio-dir>`) and either:
       - **(a) Authenticated `gh` CLI path (following `skills/54-github-cli-remote-manager.md` after explicit `APPROVE`):** Create a brand-new repository on the user's own GitHub account via `gh repo create`:
         ```bash
         # Run ONLY inside workspace/portfolio/ (or <portfolio-dir>) after verifying pwd != Veycraft root:
         git init
         git rev-parse --show-toplevel   # Abort if this resolves to the Veycraft repository!
         git remote -v                   # Abort if redasalem/veycraft or job-hunter-os appears!
         gh repo create <user>/<slug>-portfolio --public --source=. --remote=portfolio-origin --push
         ```
       - **(b) No `gh` CLI / Unauthenticated Fallback:** Instruct the user to create a brand-new empty repository on their own GitHub account and paste its HTTPS/SSH URL, then configure `git remote add portfolio-origin <user-repo-url>` strictly inside `workspace/portfolio/` and push only after explicit `APPROVE`.
  5. **Firebase Hosting (`firebase-tools`) & Surge (`surge`):** Pre-flight `firebase projects:list` or `surge whoami`; keep `firebase.json`/`.firebaserc` strictly inside `<portfolio-dir>` -> `firebase deploy --only hosting` or `surge <dist-dir> <slug>.surge.sh`.
- **Canonical CLI Reference (Execute Only After `APPROVE` Inside `<portfolio-dir>`):**
  ```bash
  vercel whoami && vercel                          # Draft preview first -> `vercel --prod` after APPROVE
  wrangler whoami && wrangler pages deploy <dist> --project-name <slug>
  netlify status && netlify deploy --dir=<dist>    # Draft preview first -> `netlify deploy --prod --dir=<dist>`
  firebase projects:list && firebase deploy --only hosting
  surge whoami && surge <dist> <slug>.surge.sh
  ```
- **Smart Fallback Engine (Any Other Host: Hostinger, cPanel, Namecheap, AWS S3/CloudFront, Railway, Render, Fly.io, DigitalOcean, VPS):**
  - **CLI Available (`aws s3 sync`, `railway up`, `flyctl deploy`, `doctl`):** Check CLI presence + auth status; if missing, give exact install + interactive login commands (never ask the user to paste secret keys in chat) and gate live deploy behind `APPROVE`.
  - **No CLI (Shared Hosting / cPanel / Hostinger / SFTP):** Export a clean static `dist/` folder (and optional `<slug>-site.zip`) inside `<portfolio-dir>` and provide a concise checklist: upload to `public_html`, enable free Let's Encrypt HTTPS, and set `A` / `CNAME` DNS records for custom domains.
- **Unconditional Deploy Approval Gate:**
  - Respect `dry_run: true` in `config/guardrails.yaml` (stop at local preview unless the owner explicitly authorizes live deployment in chat).
  - Present a **Deploy Confirmation Table** (`Host | Account/Org | Project/Repo Name | Public URL & Visibility | Exact CLI Command`) and wait for explicit `APPROVE` before executing any live deploy command.
- **Post-Deploy Read-Back Verification (`skills/meta-self-verification.md`, `skills/11-portfolio-and-github-auditor.md` Phase 5):**
  - Capture the live `https://` URL returned by the CLI and verify HTTP `200`, rendered `<title>`/OpenGraph tags, and working primary links/assets via Playwright snapshot or SSRF-safe public HTTPS check (`SEC-01`) before reporting `"deployed"`.

### 6. Phase 6 - Closed-Loop Profile Sync (Optional, Approval-Gated)
- Once live verification succeeds, offer (never auto-apply) to sync the verified `https://` portfolio URL into:
  - `context/profile.md` and `context/resume-data.json` (`portfolio_url`)
  - Tailored CV headers (`skills/03-tailor-resume-and-verify.md`)
  - LinkedIn Contact Info / Featured section (`skills/linkedin-growth.md`)
  - GitHub profile `blog` field and flagship repo `homepageUrl` (`skills/11-portfolio-and-github-auditor.md` Phase 3), governed by each skill's `APPROVE` gate.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Running `npm install`, framework scaffolders, `git init`, or `gh repo create --push` in the Veycraft root or pushing to `redasalem/veycraft` -> ✅ lock `cwd` to `logs/portfolio/<site-slug>/` (or external folder), verify root `package.json` stays `0/0`, and hard-block Veycraft remotes.
- ❌ Publishing private phone numbers, street addresses, salary floors, NDA client repos, or embedding secrets in `VITE_*` / `NEXT_PUBLIC_*` / `PUBLIC_*` variables -> ✅ confirm public contact fields explicitly and run the Phase 4 PII/secret scan first.
- ❌ Inventing project metrics, fake client testimonials, fake company logos, or AI-slop buzzwords -> ✅ use only verified `context/` facts ranked by Proof Density Hierarchy with 0 banned cliches and 0 prose em-dashes.
- ❌ Deploying to production without local build preview, explicit `APPROVE` on the Deploy Confirmation Table, and fresh HTTPS `200` read-back -> ✅ preview locally first, gate on `APPROVE`, and verify live (`skills/meta-self-verification.md`).

### Self-verification check (before reporting this step complete)
- [ ] all generated files and dependencies live strictly inside `logs/portfolio/<site-slug>/` (or `logs/portfolio/third-party-<slug>/` / external folder); Veycraft root `package.json` (`0/0` deps) and `.git` remote are untouched
- [ ] all copy, projects, credentials, and metrics trace to verified candidate data with `0` banned AI cliches, `0` prose em-dashes, and `0` `{{...}}` placeholders
- [ ] Phase 4 privacy/secret scan confirmed `0` unconsented PII/NDA leaks and `0` exposed tokens or client-bundle secrets, and local build/preview succeeded
- [ ] if deployed: Deploy Confirmation Table received explicit `APPROVE` and live `https://` URL returned HTTP `200` with verified title and assets
