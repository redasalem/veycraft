---
name: tailor-resume-and-verify
version: "2.2.0"
description: Load when tailoring or revising a CV or cover letter (/quick-tailor, /tailor-cv, Tier A pre-generation, or standalone format conversion/edits); renders verified facts into templates/ats-resume-template.html using role-specific filenames (<Candidate-Name>-<Target-Role>.pdf/.html/.txt/.doc), runs Fact-Check Guard and Anti-AI Slop filter, auto-generates clean ATS-safe PDF via local Chrome/Edge Headless (or Playwright MCP), and re-reads every deliverable.
triggers:
  - /tailor-cv <url>
  - /quick-tailor
  - Tier A pre-generation
  - eligible job before form upload
  - revise tailored CV or convert CV to PDF / Word
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - owner-verified context/profile.md, context/cv.md, and context/resume-data.json loaded OR verified candidate facts confirmed in the current session
  - full expanded job description captured (or standalone CV revision/format conversion requested)
requires_skills:
  - resume-ingestion
  - ats-keyword-heatmap
  - recruiter-brand-and-domain-intelligence
verification:
  - evidence map links every tailored bullet and summary claim to an exact verified fact from confirmed candidate data
  - fact-check audit confirmed 0 unverified percentages, currency amounts, multipliers, years, dates, employers, degrees, or tools
  - humanized prose contains 0 banned AI-slop clichés and no em-dash overuse
  - page-overflow & character budget gate checked (clean 1-page A4 fit or balanced 2-page layout with zero <10-line orphan spill)
  - saved role-named deliverables (<Candidate-Name>-<Target-Role>.html, .txt, Word-compatible .doc, auto-generated .pdf <= 200 KB via local Chrome/Edge Headless or Playwright, and tailoring-notes.md) in logs/resumes/<folder>/ were re-read to verify 0 placeholders and factual parity
---
# Pure AI Tailoring, Fact-Check Guard & Anti-AI Slop

## When to Use & Preconditions

Use for job-specific tailoring (`/quick-tailor`, `/tailor-cv`, Tier A pre-generation) and standalone CV improvements or format conversions (never submits applications). Works directly from `context/` or verified session facts without browser login.

- **Load when:** `/tailor-cv <url>`; `/quick-tailor`; Tier A pre-generation; eligible job before form upload; revise tailored CV or convert CV to PDF/Word.
- **Tailoring Mode Choice:** Offer the user a choice between **(A) Local AI Tailoring** (this playbook: `HTML`/`TXT`/Word-compatible `.doc` + Print-to-PDF) or **(B) External Web Tailoring** via `https://www.resume-tailor-ai.tech/` (when `tailoring_tool_url` is set in `context/preferences.yaml` or requested by the user). If the user chooses **(B)**, advise them that it is faster to upload and tailor their CV directly on `https://www.resume-tailor-ai.tech/`, download the tailored PDF/DOCX, and place it in `assets/` or `logs/resumes/<folder>/` so the AI can use it for the application.
- **Print-to-PDF Tip:** Whenever guiding the user to export `resume.html` to PDF via browser Print (`Ctrl+P` -> `Save as PDF`), remind them to open **More settings** and uncheck **Headers and footers** so the browser does not print the date or `file:///...` path on the CV.
- **Preconditions (stop if any is false):**
  - verified candidate facts loaded from `context/` OR confirmed directly in the active session (`skills/01-resume-ingestion.md`)
  - full expanded job description captured (or standalone CV edit/conversion requested)
- **Requires skills:** `resume-ingestion`, `ats-keyword-heatmap`, `recruiter-brand-and-domain-intelligence`. **MCP:** none (`playwright` optional for PDF export).

## Deterministic Step-by-Step Execution

### 0. No-Nagging Silent Resolution Order (Before Asking the User for Any Fact)
Before pausing to ask the user for a project detail, link, stack item, date, or credential while tailoring, ALWAYS silently check all **4 verified sources in strict order**:
1. `context/form-answers.yaml` & `context/preferences.yaml` (plus `context/resume-data.json` / `context/brief.json`).
2. `context/cv.md` & `context/profile.md` (plus `context/github-projects.md` if present).
3. **GitHub profile & repositories via `gh` CLI** (if authenticated, read-only `gh api user` / `gh repo list` — never prompt the user for facts already verified on GitHub).
4. **LinkedIn profile data** (if cached locally or already open/accessible in the active browser session — read-only inspection only).
- Only ask the user if a mandatory fact or metric is genuinely missing from **all 4 sources** (never fabricate missing metrics or tools). When the user confirms a missing fact, persist it cleanly to `context/` so future tailoring runs resolve it silently on step 1.

### 0.5. Mandatory Zero-Question CV Decision Policy & Auto-Cached Baseline PDF
After reading the full expanded JD, **NEVER** ask the user whether to reuse the baseline CV or generate a tailored PDF — decide and execute deterministically using `context/brief.json` `autopilot` thresholds (`reuse_cv_threshold: 8.5`, `tailor_cv_threshold: 6.5`):
- **Direct Strong Match (`score >= 8.5/10` AND core stack/role already covered by baseline CV):** Immediately call `node ./bin/cli.mjs brief --ensure-baseline-pdf --json` to retrieve (or generate once and cache by `context/cv.md` SHA-256) `logs/resumes/_baseline/baseline-cv.pdf` (falling back to `assets/resume.pdf` if present) and attach it via `node ./bin/cli.mjs cdp upload <selector> <abs_pdf_path>` with zero extra tailoring work.
- **Tailor Needed (qualified job `6.5–8.4/10` OR specific JD emphasis/keywords not prominent in baseline CV):** Immediately execute Steps 1–4 below to generate the role-named tailored PDF (`logs/resumes/<folder>/<Candidate-Name>-<Target-Role>.pdf`), verify it against `context/`, and attach it via `node ./bin/cli.mjs cdp upload <selector> <abs_pdf_path>` — zero user prompts.

### 1. Build the Evidence Map & Tailor `templates/ats-resume-template.html`
- Create folder `logs/resumes/<company-slug>-<role-slug>-<job-id-slug>/` (or `logs/resumes/quick-tailor-<slug>/` / `logs/resumes/cv-<slug>/`).
- Compute the **Role-Specific CV Base Slug**: `<Candidate-Name>-<Exact-Target-Role-Title>` (Title-Case hyphen-slugified, stripping filesystem-unsafe punctuation, e.g., `Reda-Salem-Full-Stack-Engineer`). Use this exact slug for all matching deliverables in the folder (`<Slug>.html`, `<Slug>.txt`, `<Slug>.doc`, `<Slug>.pdf`).
- Apply `skills/28-recruiter-brand-and-domain-intelligence.md` (Steps 1–3): identify the target **Domain Archetype**, extract the **Buyer Pain Point** (top 2–3 business problems to solve in 90 days), separate true knock-out screeners/credentials from HR wishlist fluff, and determine domain-appropriate section headings and KPI proof order (for standalone general improvements, optimize structure, clarity, and impact using only verified facts).
- Copy `templates/ats-resume-template.html` to `logs/resumes/<folder>/<Candidate-Name>-<Target-Role>.html`.
- Populate ONLY verified owner facts from `context/` or confirmed session facts:
  - If `context/github-projects.md` exists (owner CVs only), inspect it alongside `context/cv.md` and `context/resume-data.json` to select the strongest JD-matching, code-verified repositories — strictly excluding any `requires_user_confirmation` impact metrics until explicitly confirmed by the owner, and respecting private/NDA confidentiality flags.
  - Tailor the 2–3 sentence **Professional Summary** to answer the Buyer Pain Point using only verified roles, domain credentials, years, and outcomes relevant to the target role.
  - Reorder the skills section (using the domain-adaptive heading from `skills/28`, e.g., `Technical Skills`, `Core Competencies & Tools`, `Clinical Licensure & Competencies`, or `Credentials, Licensure & Systems`) so JD-matched verified competencies appear first (never add unverified JD items—record missing ones in `tailoring-notes.md`).
  - Reorder and lightly rephrase **Experience / Project** bullets using the **Proof Density Hierarchy** (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact/Deliverable > Credential/Tool`) while keeping exact employers, titles, `YYYY-MM` dates, and verified metrics intact, and applying truthful red-flag mitigation (for gaps, contract sprints, or pivots) without hiding dates.
  - Escape HTML special chars (`&`, `<`, `>`, `"`, `'`), keep single-column layout, remove empty sections, and NEVER add `<script>`, remote images/fonts, or hidden white text.
- Write `logs/resumes/<folder>/tailoring-notes.md` with: **What JD asked** -> **What changed** -> **Evidence Map** -> **True Gaps (not claimed in CV)**.
- **Cover Letter (ONLY if requested or required by the portal):** Copy `templates/ats-cover-letter-template.html` to `cover-letter.html` (~150–220 words, grounded facts only), show the exact text in chat, and wait for owner approval before final export/use.

### 2. Anti-Hallucination Fact-Check Guard (Mandatory Before Printing)
Compare EVERY claim in `resume.html` (and `cover-letter.html`) line-by-line against `context/profile.md`, `context/resume-data.json`, and (when present for owner CVs) code-verified entries in `context/github-projects.md`:
- **Numbers & Metrics:** Check every percentage (`%`), currency figure (`$`, `€`, `£`), multiplier (`3x`, `10x`), user/team headcount, and years-of-experience number. If ANY number does not exist in `context/profile.md` or `context/resume-data.json`, **BLOCK that unverified number**, revert to truthful qualitative phrasing, and **ask the owner in the same reply** whether they want to supply and confirm the real number (or accept an `EDIT` revision).
- **Entities & Dates:** Check every employer name, job title, start/end date, university, degree, project name, and listed skill. Zero fabricated tools, inflated titles, or stretched dates. If the owner confirms a new real fact in chat, save it back to `context/profile.md` / `context/cv.md` before regenerating.

### 3. Anti-AI Slop & Humanizer Filter (Mandatory Before Printing)
Scan every summary sentence, bullet, and cover-letter paragraph and rewrite if ANY of these appear:
- **Banned AI clichés (case-insensitive; keep in sync with `bin/career-intelligence.mjs` `BANNED_AI_CLICHES` and `evals/fixtures/ground-truth.json`):** `delve`, `testament`, `tapestry`, `spearheaded`, `synergy`, `thrilled to apply`, `fast-paced environment`, `moreover`, `furthermore`, `leveraged`, `orchestrated`, `passionate about`, `dynamic environment`, `proven track record`, `hit the ground running`, `deeply excited`, `results-driven`, `seasoned professional`, `dynamic team player`.
- **Banned em-dash overuse (`—`):** Use **0 em-dashes** inside prose sentences (use periods, commas, or parentheses; structural `Title — Employer` headings are fine).
- **Tone rule:** Write in the authentic peer voice of the detected **Domain Archetype** (`skills/28-recruiter-brand-and-domain-intelligence.md` Step 1) using plain, concrete domain nouns and active verbs (`built`, `shipped`, `closed`, `audited`, `coordinated`, `reduced`, `delivered`).

### 4. Character/Bullet Budget & PDF Page-Overflow Gate (Print via Playwright MCP)
- **Strict Character & Bullet Budgets (Prevent Awkward 2-Page Orphan Spills):**
  - **Professional Summary:** Max `3` lines (`<= 320` characters total).
  - **Skills / Core Competencies:** Group into `3–4` compact category lines (`<= 95` characters per line).
  - **Experience & Projects:** Max `4–5` bullets for the two most recent relevant roles, `2–3` bullets for older roles; each bullet `<= 160` characters (`1–2` printed lines).
  - **Page-Count Gate:** Target a crisp **1-page A4 PDF** (`<= 38` rendered content lines) for `< 8` years of experience, or a well-balanced **2-page A4 PDF** (`>= 70%` fill on page 2) for senior/staff profiles. **Never allow an awkward 2-page overflow where page 2 contains only 1–8 orphan lines**—if overflow occurs, tighten bullet phrasing or trim the lowest-relevance older project bullet and re-render before saving!
- **Export, Format Honesty & Mandatory Auto-PDF Generation (Local Chrome/Edge Headless First):**
  1. Always write `<Candidate-Name>-<Target-Role>.html` (e.g., `Reda-Salem-Full-Stack-Engineer.html`), `<Candidate-Name>-<Target-Role>.doc` (Word-compatible HTML with `urn:schemas-microsoft-com:office:word` headers — explicitly labeled as **Word-compatible HTML `.doc`**, never fake `.docx`), `<Candidate-Name>-<Target-Role>.txt` (clean plain text), and `tailoring-notes.md` inside `logs/resumes/<folder>/` first using file tools.
  2. **Format Honesty (`DOCX` vs. `.doc`):** **NEVER** rename HTML to `.docx` or claim an HTML file is a native `.docx` document. Only produce `.docx` if an actual validated converter (`pandoc`, LibreOffice) is available and verified; otherwise explain clearly that true `.docx` generation is unavailable and provide Word-compatible `.doc` + `.html` + `.txt`.
  3. **Automatic ATS-Safe PDF Export (Always Auto-Generate When Local Chrome/Edge or Playwright PDF Exists):** Immediately render `<Candidate-Name>-<Target-Role>.pdf` inside `logs/resumes/<folder>/` so it is ready for upload with zero manual steps:
     - **Windows (Chrome / Edge Headless — preferred local path):** Detect `C:\Program Files\Google\Chrome\Application\chrome.exe` (fallback: `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, or `C:\Program Files\Microsoft\Edge\Application\msedge.exe`) and run synchronously with `-Wait` so the PDF finishes writing before verification:
       `Start-Process -FilePath "<browser_exe>" -ArgumentList "--headless=new","--disable-gpu","--no-pdf-header-footer","--print-to-pdf=<ABS_PDF_PATH>","file:///<ABS_HTML_PATH_FORWARD_SLASHES>" -Wait -NoNewWindow`
     - **macOS / Linux (Chrome / Chromium Headless):** Run `"<chrome|chromium>" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="<ABS_PDF_PATH>" "file://<ABS_HTML_PATH>"`.
     - **Playwright MCP Fallback:** If Playwright MCP (`--caps=pdf`) is active and no local Chrome/Edge binary is found, open `file:///<ABS_HTML_PATH>` and save `<Candidate-Name>-<Target-Role>.pdf`.
     - **Verify Rendered PDF:** Confirm `<Candidate-Name>-<Target-Role>.pdf` exists inside `logs/resumes/<folder>/`, begins with `%PDF-`, is non-empty and `<= 200 KB`, single-column, text-selectable, zero `{{...}}` placeholders, and zero orphan spills. Always keep generated HTML/PDF artifacts inside `logs/resumes/<folder>/` (never in the repository root) so `git status` stays clean. Only fall back to browser `Print -> Save as PDF` (A4, headers/footers OFF) instructions if no headless Chrome/Edge or Playwright PDF engine exists on the machine.
  4. **Mandatory Post-Write Verification (`skills/meta-self-verification.md`):** Before reporting completion, confirm file existence, re-read every generated file (`<Slug>.html`, `<Slug>.doc`, `<Slug>.txt`, `tailoring-notes.md`, and verify `<Slug>.pdf` `%PDF-` header & byte size; or run `node ./bin/cli.mjs verify <folder>`), verify zero remaining `{{...}}` placeholders, zero banned AI clichés/em-dashes, and 100% factual match, and report exact paths + material changes. When preparing an application tracked in `logs/applications-log.json`, run `node ./bin/cli.mjs career prepare --job-id "<job_id>" [--cv-version-id <id>] [--ats-before <pct>] [--ats-after <pct>] [--json]` to deterministically verify the job folder deliverables, link `cv_version_id` and `cv_tailoring` metadata (strictly excluding third-party CVs), and transition the record to `status: "prepared"`.
- **Role-Title & Fit Gate (Never Tailor Blindly):** Only tailor a CV after confirming the full JD is a genuine fit (no hidden country lock, non-matching primary stack, or seniority dealbreaker). Align the CV headline, summary, and skills ordering to the target **job title** and verified JD keywords without exaggerating seniority or claiming unverified tools.
- **Role-Specific Filename Standard (Mandatory):** Inside `logs/resumes/<folder>/`, ALWAYS name the tailored files using `<Candidate-Name>-<Exact-Target-Role-Title>` (hyphen-slugified, e.g., `Reda-Salem-Full-Stack-Engineer.pdf`, `Reda-Salem-Full-Stack-Engineer.html`, `Reda-Salem-Full-Stack-Engineer.txt`, `Reda-Salem-Full-Stack-Engineer.doc`) — never upload a generic `resume.pdf` to an employer ATS.
- **Iterative Revisions Without Restarting:** If the owner asks to change a section (e.g., `"I don't like the summary"` or `"tighten bullet 2"`), modify ONLY that requested section using verified facts, keep all previously approved facts/sections intact without re-asking unchanged inputs, re-run headless PDF generation and verification, and regenerate the deliverables in place.
- Saved artifacts inside `logs/resumes/<folder>/`:
  - `<Candidate-Name>-<Target-Role>.pdf` — auto-generated ATS-safe PDF via local Chrome/Edge Headless (or Playwright PDF), upload-ready
  - `<Candidate-Name>-<Target-Role>.html` — source single-column ATS template
  - `<Candidate-Name>-<Target-Role>.doc` — Word-compatible HTML copy (explicitly labeled as Word-compatible HTML `.doc`, not native `.docx`)
  - `<Candidate-Name>-<Target-Role>.txt` — clean plain-text copy for portals with `"Paste your plain-text resume"` boxes
  - `tailoring-notes.md` — JD asked -> what changed -> Evidence Map -> True Gaps + `skills/21-ats-keyword-heatmap.md` summary.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Inventing `"improved performance by 40%"` or adding `"Kubernetes"` to match the JD → ✅ keep only verified facts and list missing skills under Gaps.
- ❌ Leaving `"spearheaded synergy in a fast-paced environment — moreover..."` in the summary → ✅ rewrite in crisp plain engineering prose.
- ❌ Renaming HTML to `.docx` or claiming a write succeeded without re-reading output files → ✅ be honest about Word-compatible `.doc` and re-read every deliverable.
- ❌ Uploading a base CV silently when tailoring failed → ✅ fix or pause and inform the owner.

### Self-verification check (before reporting this step complete)
- [ ] evidence map links every tailored bullet and summary claim to an exact verified fact from confirmed candidate data
- [ ] fact-check audit confirmed 0 unverified percentages, currency amounts, multipliers, years, dates, employers, degrees, or tools
- [ ] humanized prose contains 0 banned AI-slop clichés and no em-dash overuse
- [ ] generated files (`resume.html`, Word-compatible `resume.doc`, `resume.txt`, `tailoring-notes.md`, plus `resume.pdf` if available) were re-read to verify existence, 0 placeholders, and factual consistency

### Modern ATS Design & Typography Standard
When generating local HTML/PDF resumes, enforce these ATS + visual polish rules:
- **Layout:** Clean single-column structure, zero tables, zero multi-column sidebars, zero skill progress bars or icons.
- **Typography & Spacing:** Use clean sans-serif fonts (`Inter`, `Segoe UI`, `Arial`, `Helvetica`), `10–10.5pt` body text, `1.4–1.45` line-height, `18–22pt` candidate name, and `@page { size: A4; margin: 12mm 14mm; }` for crisp print-to-PDF output.
- **ATS Headings:** Stick to domain-appropriate standard section titles per `skills/28-recruiter-brand-and-domain-intelligence.md` Step 1 (`Summary`, domain skills heading such as `Technical Skills` or `Core Competencies & Tools`, `Professional Experience`, optional `Selected Projects`/`Licenses & Certifications`, `Education`, `Languages`).
- **Bullet Quality:** Lead every bullet with a strong action verb, mirror exact verified JD keywords naturally, follow the Proof Density Hierarchy, and keep each bullet concise (1–2 lines) with zero AI-slop clichés.

### Smart JD-to-CV Comparison & Top-Third Priority
Before generating the final tailored CV:
1. **Comparison Summary:** Present a concise 3-part breakdown: **Matched Keywords**, **Verified Gaps** (never fabricated), and **Highlighted Strengths & Buyer Pain Alignment**.
2. **Top-Third Priority Re-ordering:** Apply the **6–10 Second Recruiter Scan Hierarchy** (`skills/28` Step 3): ensure canonical target title alignment, Buyer Pain Point value proposition, and highest-proof domain competencies/deliverables sit in the top third of Page 1.

### Stage-to-Stage Handoff After Tailoring
Once `<Candidate-Name>-<Target-Role>.pdf` (and matching `.html`, `.txt`, `.doc`, `tailoring-notes.md`) passes post-write verification:
1. **If the owner already selected this job to prepare (`APPLY <n>` or equivalent in their language):** Proceed directly into non-submitting form preparation in `skills/04-fill-and-apply.md` (open form, upload the verified role-named PDF, fill verified fields, and stop before final Submit for the Live DOM Read-Back Table and explicit `APPROVE`).
2. **If standalone tailoring (`/tailor-cv` or `/quick-tailor`):** Close with a compact **Next-Step Handoff** rendered in the **user's active conversation language**:
   - **Completed (1–2 bullets):** Report exact generated file paths (`logs/resumes/<folder>/<Candidate-Name>-<Target-Role>.pdf`, `.html`, `.txt`, `.doc`, `tailoring-notes.md`) and verification pass (0 placeholders, 0 unverified metrics, 0 AI clichés).
   - **Next Action (1 clear choice or command):** Ask whether the owner wants to start non-submitting application form preparation now (stopping before final Submit for Live DOM Read-Back and `APPROVE`) or request an edit to any CV section first.
