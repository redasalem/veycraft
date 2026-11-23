---
name: linkedin-growth
version: "2.1.0"
description: Load when the owner runs /linkedin-growth or asks to review/optimize their LinkedIn profile, diagnose ranking & SEO errors, improve headline/About/experience/projects/skills, align LinkedIn with their CV, craft personal-brand marketing copy, or draft/publish LinkedIn posts & <=75-word outreach; defaults to DRAFT_ONLY and permits live updates/publishing only with legitimate browser auth plus explicit APPROVE and post-save snapshot verification.
triggers:
  - /linkedin-growth
  - review or audit my LinkedIn profile
  - improve my LinkedIn headline or About section
  - make my LinkedIn profile consistent with my CV
  - optimize my LinkedIn profile for target roles
  - check my LinkedIn rank, analytics, or profile errors
  - write or publish a LinkedIn post or personal-brand marketing copy
  - add open-source projects or optimize LinkedIn skills and Featured section
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - verified candidate facts available (context/profile.md + context/cv.md OR session-confirmed CV)
  - accessible LinkedIn profile data (pasted text, LinkedIn Save-to-PDF, screenshot, or read-only signed-in Playwright inspection) and optional target role(s)/JDs
  - DRAFT_ONLY by default; explicit owner APPROVE required before any live LinkedIn Save, Post, or Send
requires_skills:
  - tailor-resume-and-verify
  - outreach-and-interview-prep
  - recruiter-brand-and-domain-intelligence
  - meta-self-verification
verification:
  - 0-100 Recruiter-SEO scorecard (or CV-consistency gap table) grounded solely in inspected profile sections and verified CV facts
  - every metric, skill, title, and date in proposed rewrites matches verified candidate facts (zero hallucinations, zero AI-slop clichés, zero prose em-dashes)
  - audit and proposed copy saved as DRAFT_ONLY to logs/insights/linkedin-seo-audit-YYYY-MM-DD.md; any user-approved live edit occurred only after explicit APPROVE and passed post-save browser_snapshot verification
---
# Grounded Recruiter-SEO LinkedIn Profile Optimizer (`/linkedin-growth`)

## When to Use & Preconditions

Use when the owner invokes `/linkedin-growth` or naturally asks to review their LinkedIn profile, improve headline/About/experience, make LinkedIn consistent with their CV, optimize for target roles in any industry, or draft posts/`<= 75`-word outreach. Never edit LinkedIn profiles as a side effect of `/daily-run`.

- **Load when:** `/linkedin-growth`; `"review my LinkedIn profile"`; `"improve my LinkedIn headline and About section"`; `"make my profile consistent with my CV"`; `"optimize my profile for ... roles"`.
- **Preconditions (stop if any is false):**
  - verified candidate facts available (`context/profile.md` + `context/cv.md` OR session-confirmed CV)
  - accessible LinkedIn profile data (pasted text, LinkedIn `Save to PDF`, screenshot, or signed-in Playwright read-only inspection)
  - `DRAFT_ONLY` by default; explicit owner `APPROVE` required before any live LinkedIn Save, Post, or Send
- **Requires skills:** `tailor-resume-and-verify`, `outreach-and-interview-prep`, `recruiter-brand-and-domain-intelligence`, `meta-self-verification`. **MCP:** none (`playwright` optional; never equate Playwright availability with LinkedIn authentication or permission).

## Deterministic Step-by-Step Execution

### 1. Mode 1 — Read-Only Profile Inspection & CV-Consistency Gap Check
1. Read verified candidate facts from `context/profile.md` and `context/cv.md` (or ask naturally for the owner's CV if absent). This is the **only** permitted source of claims (employers, dates, titles, tools, metrics).
2. Collect the owner's current LinkedIn sections (`Headline`, `About`, `Experience`, `Featured`, `Skills`, plus `Licenses & Certifications` / `Publications` / `Services` when relevant) through the cleanest accessible path:
   - Pasted LinkedIn text, `Save to PDF` export, or uploaded screenshots (works 100% offline).
   - OR, if Playwright MCP is connected **and** a named signed-in LinkedIn account indicator is verified, extract read-only via `browser_evaluate` (`3–9 s` pacing; abort immediately on any authwall/CAPTCHA/2FA via `skills/24-circuit-breaker-and-antiban.md` and fall back to pasted/PDF/screenshot input).
3. Detect the target **Domain Archetype** and extract **Buyer Pain Points** + **Recruiter Boolean** targets via `skills/28-recruiter-brand-and-domain-intelligence.md` (Steps 1, 2, and 4). Identify **Missing Information & CV Inconsistencies** (titles, tenure dates, licenses, skills, or projects present in CV vs. LinkedIn; missing headline/About clarity; outdated links) and collect optional target roles or `1–5` target JDs to extract exact verified target keywords.
4. Partition target keywords into: **Present on LinkedIn**, **Verified-but-Missing (Safe to Surface)**, and **True Gaps (NEVER Claim)**.

### 2. Score Current Profile on the Transparent `0–100` Recruiter-SEO Rubric

Compute and display an honest scorecard grounded in observable evidence:

| Section | Max Score | Scoring Breakdown |
|---|---:|---|
| **1. Headline (`<= 220` chars)** | **25** | Target role title match (`0–10`) + core recruiter-filter stack keywords (`0–10`) + verified concrete impact hook (`0–5`) |
| **2. About Hook & Keywords** | **25** | Above-the-fold first 220-character hook before `"See more"` (`0–8`) + natural verified keyword coverage (`0–10`) + domain clarity & direct CTA (`0–7`) |
| **3. Experience Bullets** | **30** | Concrete action + verified numeric/production outcome (`0–15`) + target seniority/CV parity (`0–10`) + clean human tone with zero AI-slop clichés or prose em-dashes (`0–5`) |
| **4. Featured & Skills Alignment** | **20** | Top skills aligned with CV/target roles (`0–10`) + Featured portfolio/GitHub/case-study links (`0–10`) |
| **Total Recruiter-SEO Score** | **100** | Sum of all 4 sections (`<60` Needs Rebuild · `60–79` Solid Base · `80–100` Recruiter-Ready) |

### 3. Mode 2 — Grounded Section-by-Section Improvements (`DRAFT_ONLY` Default)
1. Generate **Before vs. After** side-by-side copy for requested or low-scoring sections (`Headline <= 220 chars`, 3-part `About`, outcome-led `Experience Bullets`, `Featured & Skills` order, and `CV Consistency Fixes`).
2. Run every drafted line through the **Anti-Hallucination Fact-Check Guard** and **Anti-AI Slop Humanizer** (`skills/03-tailor-resume-and-verify.md`):
   - Zero invented `%`, `$`, team sizes, titles, or years.
   - Zero forbidden clichés (`delve`, `testament`, `tapestry`, `spearheaded`, `synergy`, `moreover`, `furthermore`, `orchestrated`, `hit the ground running`) and zero prose em-dashes (`—`).
3. For any outreach DM or connection note, enforce `<= 75` words and run `node ./bin/cli.mjs pre-submit --draft <file>` (or `--text "<msg>"`) after re-reading `config/invariants.txt`.
4. Save the full audit report and `DRAFT_ONLY` copy to `logs/insights/linkedin-seo-audit-YYYY-MM-DD.md` and re-read to verify existence and formatting (`skills/meta-self-verification.md`).

### 4. Mode 3 — Explicit `APPROVE`-Gated Live Profile Mutations (Optional) & Offline Fallback
1. **`DRAFT_ONLY` is always the default:** Present the scorecard, CV-consistency gaps, and exact Before -> After copy in chat so the owner can review, iterate (`EDIT <section>`), or copy-paste manually.
2. **User-Approved Live Edits (Only When Legitimate Browser Access + Explicit Approval Exist):**
   - Execute a live LinkedIn section edit **ONLY** if: (a) the owner explicitly asks to apply a specific section update in LinkedIn, (b) Playwright MCP is connected **and** a signed-in LinkedIn session for the owner's account is verified (never assume Playwright == auth), and (c) the owner inspects the exact final Before/After text and replies **`APPROVE`** for that specific section.
   - Edit only the approved section, click Save once, wait 3–9 s, reload/re-open the profile view, and verify via a fresh `browser_snapshot` (`skills/meta-self-verification.md`) that the persisted text matches verbatim before reporting `"updated"`.
   - Never bypass CAPTCHA, 2FA, or login walls (`skills/24-circuit-breaker-and-antiban.md`). If browser access or auth is unavailable, deliver the `DRAFT_ONLY` copy and clear manual paste steps cleanly without failing the task.

### 5. Deep Rank & Error Diagnostics (Recruiter Search & Algorithm Health)
When auditing any LinkedIn profile, apply `skills/28-recruiter-brand-and-domain-intelligence.md` (Step 4) to scan for high-impact ranking killers and report a **Top-3 Immediate Fix Plan**:
1. **Skill Spelling, 50-Skill Cap & Experience-Linked Tagging:** Detect typos, casing bugs, or stray spaces across all industries (e.g., `Java Script` vs `JavaScript`, `next.js` vs `Next.js`, `Sales Force` vs `Salesforce`, `Financial Modelling` vs `Financial Modeling`, `HIPPA` vs `HIPAA`) that break LinkedIn Recruiter Boolean filters. Audit top skills within the **50-skill cap** and verify core skills are linked to specific **Experience** entries so Recruiter "Years of Experience per Skill" filters match.
2. **Experience Job-Title Weighting & Recruiter Boolean Alignment:** Check whether **Experience** role titles use standard searchable titles (Experience titles outweigh About prose in Recruiter search; align quirky internal titles only via truthful confirmed equivalents, never inventing titles). Verify `(Title A OR Title B) AND (Core Skill 1 OR 2)` matches consistently across Headline, Current Role Title, Top Skills, and Experience bullets.
3. **Private Analytics Diagnosis:** Inspect `Profile views`, `Search appearances`, and `Post impressions` (last 7 days). Diagnose the bottleneck:
   - Low `Search appearances` → fix Headline keywords, Experience titles, Experience-linked Skills, and `Open to Work (Recruiters only)` job titles + locations.
   - Good `Search appearances` but low inbound messages → strengthen Above-the-Fold About hook (`<= 220` chars), Featured proof links/credentials, and Experience KPI outcomes.
   - `0 Post impressions` → activate a 1–2x/week domain-native authority cadence.
4. **Recruiter Spotlight & Completeness:** Check `Open to Work (Recruiters only — never force public green banner unless asked)`, active domain engagement, target-company follows, custom vanity URL, domain authority sections (`Licenses & Certifications`, `Publications`, `Services`, `Featured`, `Projects`), and CV-to-LinkedIn date/title parity.

### 6. Personal-Brand & Positioning Copywriting (Marketing Mastery)
Apply domain-adaptive positioning (`skills/28` Steps 1, 3, and 4) across every LinkedIn section (grounded strictly in verified facts):
- **Reframe Independent / Consulting / Solo Work:** Position freelance or consulting work as **outcome-driven specialist delivery & verifiable client impact** (metrics, operational scope, compliance rigor, deliverables) tailored to the candidate's Domain Archetype rather than generic "freelancer" filler.
- **Copywriting Formula (`Buyer Pain Point → Proof → Outcome → Soft CTA`):**
  - *Headline (`<= 220` chars):* `[Canonical Target Role] | [Top 3–5 Recruiter-Filter Keywords / Credentials] | [Verified Differentiator & Business Outcome]`.
  - *About First 220 Chars:* Lead with the buyer pain point you solve + highest verified proof before the `"See more"` fold, followed by scannable domain pillars and a clear contact CTA.
  - *Experience & Authority Sections:* Rank bullets by `skills/28` Proof Density Hierarchy (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact/Deliverable > Credential/Tool`)—e.g., ARR/quota/ROAS for Commercial; uptime/latency/CI-CD for Tech; audit/EBITDA/regulatory outcomes for Finance/Healthcare/Ops.

### 7. LinkedIn Content & Post Publishing Engine (Algorithm-Smart)
Draft high-signal, domain-native authority posts (English, Arabic, or bilingual as requested) tailored to recruiters and hiring managers in the user's target field:
- **4 Proven Domain-Adaptive Authority Templates:**
  1. **Shipped Work / Initiative Launch:** Problem solved → methodology/execution highlight → verifiable deliverable or outcome → portfolio/case-study link in the **first comment**.
  2. **Field Problem & Operator Breakdown:** Real bottleneck, audit trap, compliance lesson, or customer friction faced → how you resolved it → concrete takeaway.
  3. **Before/After Verified Case Study:** Measurable revenue, retention, turnaround, safety, reliability, or workflow improvement with real numbers from verified work.
  4. **Practical Modern Workflow:** Concrete workflow, tooling, or AI-assisted process lesson grounded in real practice (zero hype).
- **LinkedIn Algorithm & Formatting Rules:**
  - Strong **2-line scroll-stopping hook** above `"See more"` (no clickbait, no cringe).
  - Short 1–2 sentence paragraphs with clean whitespace for mobile readability.
  - **No external links in the main post body** (external links suppress reach) — place portfolio / article / GitHub / case-study URLs in the **first comment** (`First Comment Draft` always provided alongside the post).
  - `3–5` targeted domain hashtags max; zero banned AI-slop clichés (`delve`, `tapestry`, `spearheaded`, `synergy`, `game-changer`, `thrilled to announce`) and zero prose em-dashes.
- **Publishing Gate:** Always deliver the post + first-comment draft in `DRAFT_ONLY` first. Publish live via browser **only** after explicit owner approval (`APPROVE` / `"انشر"`), then add the first comment if requested and verify the live post URL via fresh snapshot.

### 8. Full LinkedIn Surface Coverage & Safe Navigation
Know and navigate every key LinkedIn surface cleanly (with `3–9 s` human pacing, `Role -> Label -> Text` selectors, and zero CAPTCHA/2FA bypasses):
- **Profile Surfaces:** Intro/Headline, About, Experience (`details/experience/`), Skills (`details/skills/` + per-role skill tags), Featured, Open to Work (`Recruiters only`), `Licenses & Certifications`, `Projects` (`details/projects/`), `Publications`, `Services`, `Honors`, and Recommendations.
- **Growth Surfaces:** Post composer (feed), strategic domain commenting on hiring-manager/leader posts (draft-first, insightful, never spammy `"Great post!"`), target-company follows, and `<= 75`-word recruiter/hiring-manager outreach DMs (`skills/05-outreach-and-interview-prep.md`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Clicking LinkedIn `"Edit"`, `"Save"`, `"Post"`, or `"Send"` without explicit `APPROVE` on exact Before/After copy, or assuming Playwright availability equals LinkedIn auth → ✅ default to `DRAFT_ONLY`, check auth explicitly, and re-verify persisted text via fresh `browser_snapshot` after any approved save.
- ❌ Stuffing unverified JD keywords or unearned titles (`VP`, `Kubernetes`, `CPA`, etc.) into Headline, Experience, or Skills → ✅ isolate unverified items under `True Gaps` and never claim them.
- ❌ Dumping 25k-token raw LinkedIn `browser_snapshot` trees into context to read profile sections → ✅ use compact read-only `browser_evaluate` extraction, pasted text, PDF, or screenshots.
- ❌ Writing generic AI-slop headlines (`"Passionate innovator spearheading synergistic solutions — delving into..."`) → ✅ write plain, concrete, verifiable domain-native prose.

### Self-verification check (before reporting this step complete)
- [ ] `0–100` scorecard (or CV-consistency gap table) grounded solely in inspected LinkedIn data and verified CV facts
- [ ] every metric, skill, title, and date in proposed rewrites verified against candidate CV/profile (`0` hallucinations, `0` AI-slop clichés, `0` prose em-dashes)
- [ ] audit saved as `DRAFT_ONLY` in `logs/insights/linkedin-seo-audit-YYYY-MM-DD.md` and re-read; any user-approved live edit occurred only after explicit `APPROVE` and passed post-save `browser_snapshot` verification
