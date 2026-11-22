---
name: tailor-resume-and-verify
version: "2.0.0"
description: Load when tailoring or revising a CV or cover letter (/quick-tailor, /tailor-cv, Tier A pre-generation, or standalone format conversion/edits); renders verified facts into templates/ats-resume-template.html, runs the Fact-Check Guard and Anti-AI Slop filter, writes and re-reads HTML/TXT/Word-compatible .doc (never fake .docx), and exports PDF optionally via Playwright MCP.
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
verification:
  - evidence map links every tailored bullet and summary claim to an exact verified fact from confirmed candidate data
  - fact-check audit confirmed 0 unverified percentages, currency amounts, multipliers, years, dates, employers, degrees, or tools
  - humanized prose contains 0 banned AI-slop clichés and no em-dash overuse
  - page-overflow & character budget gate checked (clean 1-page A4 fit or balanced 2-page layout with zero <10-line orphan spill)
  - saved HTML, TXT, Word-compatible .doc (never renamed .docx), and tailoring-notes.md in logs/resumes/<folder>/ were re-read to verify 0 placeholders and factual parity (plus resume.pdf <= 200 KB when PDF export is available, or Print-to-PDF guidance)
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
- **Requires skills:** `resume-ingestion`, `ats-keyword-heatmap`. **MCP:** none (`playwright` optional for PDF export).

## Deterministic Step-by-Step Execution

### 1. Build the Evidence Map & Tailor `templates/ats-resume-template.html`
- Create folder `logs/resumes/<company-slug>-<role-slug>-<job-id-slug>/` (or `logs/resumes/quick-tailor-<slug>/` / `logs/resumes/cv-<slug>/`).
- Extract JD requirements, preferred skills, and location/seniority notes (for standalone general improvements, optimize structure, clarity, and impact using only verified facts).
- Copy `templates/ats-resume-template.html` to `logs/resumes/<folder>/resume.html`.
- Populate ONLY verified owner facts from `context/` or confirmed session facts:
  - Tailor the 2–3 sentence **Professional Summary** using only verified roles, years, and stacks relevant to the target role.
  - Reorder **Technical Skills** so JD-matched verified skills appear first (never add unverified JD tools—record missing skills in `tailoring-notes.md`).
  - Reorder and lightly rephrase **Experience / Project** bullets to highlight relevant work while keeping exact employers, titles, `YYYY-MM` dates, and verified metrics intact.
  - Escape HTML special chars (`&`, `<`, `>`, `"`, `'`), keep single-column layout, remove empty sections, and NEVER add `<script>`, remote images/fonts, or hidden white text.
- Write `logs/resumes/<folder>/tailoring-notes.md` with: **What JD asked** -> **What changed** -> **Evidence Map** -> **True Gaps (not claimed in CV)**.
- **Cover Letter (ONLY if requested or required by the portal):** Copy `templates/ats-cover-letter-template.html` to `cover-letter.html` (~150–220 words, grounded facts only), show the exact text in chat, and wait for owner approval before final export/use.

### 2. Anti-Hallucination Fact-Check Guard (Mandatory Before Printing)
Compare EVERY claim in `resume.html` (and `cover-letter.html`) line-by-line against `context/profile.md` and `context/resume-data.json`:
- **Numbers & Metrics:** Check every percentage (`%`), currency figure (`$`, `€`, `£`), multiplier (`3x`, `10x`), user/team headcount, and years-of-experience number. If ANY number does not exist in `context/profile.md` or `context/resume-data.json`, **BLOCK that unverified number**, revert to truthful qualitative phrasing, and **ask the owner in the same reply** whether they want to supply and confirm the real number (or accept an `EDIT` revision).
- **Entities & Dates:** Check every employer name, job title, start/end date, university, degree, project name, and listed skill. Zero fabricated tools, inflated titles, or stretched dates. If the owner confirms a new real fact in chat, save it back to `context/profile.md` / `context/cv.md` before regenerating.

### 3. Anti-AI Slop & Humanizer Filter (Mandatory Before Printing)
Scan every summary sentence, bullet, and cover-letter paragraph and rewrite if ANY of these appear:
- **Banned AI clichés (case-insensitive):** `delve`, `testament`, `tapestry`, `spearheaded`, `synergy`, `thrilled to apply`, `fast-paced environment`, `moreover`, `furthermore`, `leveraged`, `orchestrated`, `passionate about`, `dynamic environment`, `proven track record`, `hit the ground running`, `deeply excited`.
- **Banned em-dash overuse (`—`):** Use **0 em-dashes** inside prose sentences (use periods, commas, or parentheses; structural `Title — Employer` headings are fine).
- **Tone rule:** Write like a direct, practical peer engineer using concrete technical nouns and active plain verbs (`built`, `shipped`, `cut`, `migrated`, `tested`, `debugged`).

### 4. Character/Bullet Budget & PDF Page-Overflow Gate (Print via Playwright MCP)
- **Strict Character & Bullet Budgets (Prevent Awkward 2-Page Orphan Spills):**
  - **Professional Summary:** Max `3` lines (`<= 320` characters total).
  - **Technical Skills:** Group into `3–4` compact category lines (`<= 95` characters per line).
  - **Experience & Projects:** Max `4–5` bullets for the two most recent relevant roles, `2–3` bullets for older roles; each bullet `<= 160` characters (`1–2` printed lines).
  - **Page-Count Gate:** Target a crisp **1-page A4 PDF** (`<= 38` rendered content lines) for `< 8` years of experience, or a well-balanced **2-page A4 PDF** (`>= 70%` fill on page 2) for senior/staff profiles. **Never allow an awkward 2-page overflow where page 2 contains only 1–8 orphan lines**—if overflow occurs, tighten bullet phrasing or trim the lowest-relevance older project bullet and re-render before saving!
- **Export, Format Honesty & Post-Write Validation (Never Fail Silent on Missing PDF/DOCX Tools):**
  1. Always write `resume.html`, `resume.doc` (Word-compatible HTML with `urn:schemas-microsoft-com:office:word` headers — explicitly labeled as **Word-compatible HTML `.doc`**, never fake `.docx`), `resume.txt` (clean plain text), and `tailoring-notes.md` inside `logs/resumes/<folder>/` first using file tools.
  2. **Format Honesty (`DOCX` vs. `.doc`):** **NEVER** rename HTML to `.docx` or claim an HTML file is a native `.docx` document. Only produce `.docx` if an actual validated converter (`pandoc`, LibreOffice) is available and verified; otherwise explain clearly that true `.docx` generation is unavailable and provide Word-compatible `.doc` + `.html` + `.txt`.
  3. **Optional PDF Export (Playwright MCP or Local Headless Chrome/Edge):** If Playwright MCP (`--caps=pdf`) is available, open `file:///<absolute-path-to>/logs/resumes/<folder>/resume.html` and save `resume.pdf` (`<= 200 KB`, single-column, text-selectable, zero `{{...}}` placeholders, zero orphan spills). When Playwright PDF is unavailable locally on Windows/macOS/Linux, you may render `logs/resumes/<folder>/resume.pdf` via local headless Chrome/Edge with `--headless --disable-gpu --no-pdf-header-footer --print-to-pdf=...` using a synchronous wait (`Start-Process ... -Wait` on Windows so the HTML is not deleted before Chrome finishes writing). Always keep generated HTML/PDF artifacts inside `logs/resumes/<folder>/` (never in the repository root) so `git status` stays clean; if no PDF binary is available, deliver `resume.html`, `resume.doc`, and `resume.txt` with one-line browser `Print -> Save as PDF` (A4, headers/footers OFF) instructions.
  4. **Mandatory Post-Write Verification (`skills/meta-self-verification.md`):** Before reporting completion, confirm file existence, re-read every generated file (`resume.html`, `resume.doc`, `resume.txt`, `tailoring-notes.md`, and `resume.pdf` header if created; or run `node ./bin/cli.mjs verify <folder>`), verify zero remaining `{{...}}` placeholders, zero banned AI clichés/em-dashes, and 100% factual match, and report exact paths + material changes.
- **Iterative Revisions Without Restarting:** If the owner asks to change a section (e.g., `"I don't like the summary"` or `"tighten bullet 2"`), modify ONLY that requested section using verified facts, keep all previously approved facts/sections intact without re-asking unchanged inputs, re-run verification, and regenerate the deliverables in place.
- Saved artifacts inside `logs/resumes/<folder>/`:
  - `resume.pdf` (when Playwright PDF or real PDF export is available)
  - `resume.html` — source single-column ATS template
  - `resume.doc` — Word-compatible HTML copy (explicitly labeled as Word-compatible HTML `.doc`, not native `.docx`)
  - `resume.txt` — clean plain-text copy for portals with `"Paste your plain-text resume"` boxes
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
- **ATS Headings:** Stick to standard section titles (`Summary`, `Technical Skills`, `Professional Experience`, `Projects`, `Education`, `Certifications`, `Languages`).
- **Bullet Quality:** Lead every bullet with a strong action verb, mirror exact verified JD keywords naturally, and keep each bullet concise (1–2 lines) with zero AI-slop clichés.

### Smart JD-to-CV Comparison & Top-Third Priority
Before generating the final tailored CV:
1. **Comparison Summary:** Present a concise 3-part breakdown: **Matched Keywords**, **Verified Gaps** (never fabricated), and **Highlighted Strengths**.
2. **Top-Third Priority Re-ordering:** Re-order skills and selected projects so the most relevant stack and projects for the target JD appear in the top third of Page 1 (optimizing for the 6-second recruiter scan).
