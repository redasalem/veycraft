---
name: universal-cv-builder
version: "1.2.0"
description: Load whenever building, rebuilding, auditing, or iteratively updating a professional ATS-ready CV for ANY person (repo owner or third party, tech or non-tech, fresh graduate or senior, with or without an existing CV); enforces fixed step-by-step SOPs, fact-confirmation gates, field/seniority adaptation, persistent revision state, and multi-format verified output.
triggers:
  - create a CV for someone or from scratch
  - build a professional CV with or without an existing resume
  - rebuild, upgrade, or iteratively revise a saved CV
  - non-tech, fresh-graduate, or third-party CV creation
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - user requested creating, rebuilding, or revising a CV for themselves or another person
requires_skills:
  - resume-ingestion
  - tailor-resume-and-verify
  - recruiter-brand-and-domain-intelligence
  - meta-self-verification
verification:
  - third-party CVs are strictly isolated under logs/resumes/cv-<person-slug>/ without modifying owner context/ files
  - Fact Table was explicitly confirmed before final rendering with 0 fabricated metrics, dates, titles, degrees, or tools
  - section order, headings, bullet quality, Anti-AI Slop filter, and A4 page-budget rules passed
  - cv-profile.json, cv-changelog.md, resume.html, Word-compatible resume.doc (never fake .docx), and resume.txt were written and re-read with 0 remaining placeholders
---
# Universal Professional CV Builder & Iterative Revision Standard

## When to Use & Preconditions

Use as the canonical, fixed rulebook whenever creating a professional ATS-compliant CV from scratch (no prior CV), rebuilding an existing CV, or making ongoing iterative revisions—for **any person** (owner or third party), **any field** (tech or non-tech), **any seniority** (student/fresh grad to executive), and **any language** (English LTR, Arabic RTL, or bilingual). No `/setup` or browser login is required.

- **Load when:** `create a CV for someone or from scratch`; `build a professional CV with or without an existing resume`; `rebuild, upgrade, or iteratively revise a saved CV`; `non-tech, fresh-graduate, or third-party CV creation`.
- **Preconditions (stop if any is false):**
  - user requested creating, rebuilding, or revising a CV for themselves or another person
- **Requires skills:** `resume-ingestion`, `tailor-resume-and-verify`, `recruiter-brand-and-domain-intelligence`, `meta-self-verification` (plus `multilingual-adaptation` if Arabic/bilingual/EU). **MCP:** none (`playwright` optional for PDF reading/export).

## Deterministic Step-by-Step Execution

### 1. Workspace Isolation & Mode Detection
- **Determine Subject:** Ask or confirm whether the CV is for **(a) the repo owner** or **(b) another person (third party)**.
  - **Third-Party Isolation Rule:** If building for another person, **NEVER** read from, mix with, or overwrite `context/profile.md`, `context/cv.md`, or `context/resume-data.json`. Save all files strictly inside `logs/resumes/cv-<person-slug>/`. If tracked in `logs/cv-versions.json`, mark `owner_scope: "third_party"` so third-party CVs (and any linked records via transitive CV ancestry) stay strictly excluded from owner analytics (`veycraft career analytics`) and Notion sync (`veycraft career sync`).
  - **Revision Check First:** If `logs/resumes/cv-<person-slug>/cv-profile.json` already exists, load it immediately and jump to **Step 5 (Iterative Revision Mode)**—never restart from scratch or re-ask confirmed facts.

### 2. Fixed Intake Path (Path A: No CV vs. Path B: Existing CV)
- **Path A — No Existing CV (Guided Interview in Batches of 3–4 Questions):**
  - **Batch 1 (Target & Identity):** Target job title(s), CV language (`EN` / `AR` / both), career stage (student/fresh grad, mid-level, senior, career switcher), full name, city/country, email, phone, and relevant links (LinkedIn/Portfolio/GitHub if applicable).
  - **Batch 2 (Experience / Internships / Volunteering):** For each role: organization, title, location, `YYYY-MM` start/end dates, core responsibilities, and any real numbers/outcomes (team size, volume, revenue, speed, customers—never guess).
  - **Batch 3 (Education, Projects & Skills):** Degree, university, graduation year, notable projects/courses/certifications, hard skills/tools, and spoken languages.
- **GitHub Project Dossier Hook (When Available):** For repo-owner CVs where `context/github-projects.md` exists (never read owner `context/github-projects.md` for third-party CVs per Step 1 isolation; for isolated third-party GitHub audits, read only `logs/resumes/cv-<person-slug>/`), pull code-verified project dossiers to strengthen the Projects section — strictly holding back any `requires_user_confirmation` metrics and NDA/private repositories until explicitly confirmed by the user.
- **Path B — Has an Existing CV (Diagnostic Audit & Gap-Fill):**
  - Ingest via the best local path (`skills/01-resume-ingestion.md` Tiers 1–4). If a PDF is scanned/image-only or unreadable, warn clearly and request pasted text or `.docx`/`.md`/`.txt`. Always preserve the original file untouched.
  - Present a concise **5-Point Diagnostic Audit** before rewriting: (1) ATS readability, (2) section order & relevance, (3) bullet strength (passive duties vs. impact), (4) missing scope/dates/metrics, (5) length/bloat/clichés.
  - Ask ONLY 1–4 targeted gap-filling questions for missing or ambiguous items.

### 3. Fact-Confirmation Gate & Role/Field Adaptation
- **Mandatory Fact Table:** Present all structured facts (contact, titles, organizations, `YYYY-MM` dates, education, skills, metrics) and obtain explicit user confirmation before generating the final CV.
- **Adaptive Section Order (by Career Stage):**
  - **Student / Fresh Graduate (`0–1` yr):** Header -> 2-line Summary -> Education -> Projects / Internships -> Skills -> Certifications / Volunteering -> Languages.
  - **Experienced (`2+` yrs):** Header -> Professional Summary (2–3 lines) -> Professional Experience -> Skills / Core Competencies -> Selected Projects (if relevant) -> Education & Certifications -> Languages.
  - **Career Switcher:** Header -> Target-Aligned Summary -> Relevant Projects & Transferable Skills -> Experience (framed around transferable results) -> Education & Certifications.
- **Field-Aware Headings & Market Positioning:** Detect the candidate's **Domain Archetype** via `skills/28-recruiter-brand-and-domain-intelligence.md` (Steps 1 & 3) to bind domain-authentic peer tone, adaptive headings (`Technical Skills` for software/IT/data; `Core Competencies & Tools`, `Clinical Licensure & Competencies`, or `Key Skills` for business, marketing, sales, finance, HR, operations, healthcare, or legal roles), Buyer Pain Point summary positioning, 6–10 second visual scan ordering, and truthful risk framing (gaps, contract sprints, career pivots) without hiding dates.
- **Language & Direction:** For Arabic or bilingual CVs, apply `skills/15-multilingual-adaptation.md` (`dir="rtl"` for Arabic, `dir="ltr"` for English; keep brand/tool acronyms crisp).

### 4. Fixed Quality Gates, Rendering & Verification
Apply all 4 non-negotiable gates from `skills/03-tailor-resume-and-verify.md` before delivering:
1. **Bullet Engineering (XYZ / STAR + Proof Density):** Start every bullet with a strong plain action verb appropriate to the candidate's domain (`Built`, `Managed`, `Reduced`, `Designed`, `Closed`, `Audited`, `Coordinated`) and rank content by `skills/28` Proof Density Hierarchy (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact/Deliverable > Credential/Tool`). Ban passive openers (`Responsible for`, `Duties included`, `Helped with`, `Worked on`). Keep every bullet `<= 160` characters (`1–2` printed lines).
2. **Zero Hallucination & Anti-AI Slop:** Zero unverified `%`, `$`, multipliers, dates, titles, or tools. Zero banned AI clichés (`spearheaded`, `synergy`, `delve`, `leveraged`, `orchestrated`, `proven track record`, `fast-paced environment`, `passionate about`) and zero prose em-dashes (`—`).
3. **ATS Layout & Page Budget:** Render single-column HTML from `templates/ats-resume-template.html` (zero tables, sidebars, icons, or progress bars; `@page { size: A4; margin: 12mm 14mm; }`). Enforce **1-page A4** (`<= 38` content lines) for `< 8` years of experience, or a **balanced 2-page A4** (`>= 70%` fill on page 2) for `>= 8` years. Never allow 1–8 orphan lines on page 2.
4. **Persistent Deliverables & Self-Verification (`skills/meta-self-verification.md`):**
   - Save inside `logs/resumes/cv-<person-slug>/`:
     - `cv-profile.json` — canonical verified facts, target role, language, layout settings, and `version` (`1`, `2`, ...)
     - `cv-changelog.md` — concise dated log of initial build and every revision
     - `resume.html` — single-column ATS HTML (include browser `Ctrl+P` -> `Save as PDF`, headers/footers OFF tip)
     - `resume.doc` — Word-compatible HTML `.doc` (explicitly labeled as Word-compatible HTML, never fake `.docx`)
     - `resume.txt` — clean plain-text version
     - `resume.pdf` — optional when Playwright MCP PDF export is available
   - Re-read every generated output file to confirm existence, 0 `{{...}}` placeholders, 0 banned clichés, and 100% factual match before reporting exact paths.

### 5. Iterative Revision Mode (Frequent Changes Without Restarting)
Whenever the user returns with edits (*"change the summary"*, *"add a course/project"*, *"rewrite bullet 2"*, *"shorten to 1 page"*, *"translate to Arabic"*, *"adapt for a new role"*):
1. Read `logs/resumes/cv-<person-slug>/cv-profile.json` (and `cv-changelog.md`) directly—never re-ask unchanged details.
2. Confirm any newly introduced factual claims (dates, metrics, titles) if ambiguous.
3. Apply **surgical edits** only to the requested section(s) in `cv-profile.json`, increment `version`, and append a 1-line summary to `cv-changelog.md`.
4. Regenerate `resume.html`, `resume.doc`, `resume.txt` (and `resume.pdf` if available), re-read outputs to verify 0 placeholders and page budget compliance, and report exact paths + what changed.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Overwriting or mixing a third-party candidate's data into the repo owner's `context/` files → ✅ isolate every external CV inside `logs/resumes/cv-<person-slug>/`.
- ❌ Inventing metrics (`"increased sales by 30%"`), inflating titles, or adding unverified tools to make a CV sound stronger → ✅ ask the user for real numbers or use truthful qualitative scope.
- ❌ Asking a returning user to re-enter their entire CV for a small edit → ✅ load `cv-profile.json`, apply surgical edits, bump `version`, and log to `cv-changelog.md`.
- ❌ Using multi-column tables, skill bars, passive `"Responsible for..."` bullets, or fake `.docx` renames → ✅ enforce single-column ATS HTML, XYZ bullets, and honest `.doc`/`.html`/`.txt` outputs.

### Self-verification check (before reporting this step complete)
- [ ] third-party CVs are strictly isolated under `logs/resumes/cv-<person-slug>/` without modifying owner `context/` files
- [ ] Fact Table was explicitly confirmed before final rendering with 0 fabricated metrics, dates, titles, degrees, or tools
- [ ] section order, headings, bullet quality, Anti-AI Slop filter, and A4 page-budget rules passed
- [ ] `cv-profile.json`, `cv-changelog.md`, `resume.html`, Word-compatible `resume.doc` (never fake `.docx`), and `resume.txt` were written and re-read with 0 remaining placeholders
