---
name: recruiter-brand-and-domain-intelligence
version: "1.0.0"
description: Load whenever decoding or scoring job descriptions, tailoring or building CVs across any industry, switching career personas, or optimizing LinkedIn and cross-platform profiles with senior recruiter, hiring manager, personal-branding, and domain-adaptive lenses.
triggers:
  - decode job description with HR recruiter and hiring manager lens
  - adapt CV, persona, or profile to target domain or industry
  - optimize CV positioning or truthful red-flag framing for 6-10 second scan
  - optimize LinkedIn Recruiter SEO, Boolean alignment, and personal branding
requires_mcp:
  - none
preconditions:
  - verified candidate facts available in context/ or confirmed in the active session
  - target role, job description, CV, persona, or profile text supplied
requires_skills:
  - meta-self-verification
verification:
  - Domain Archetype detected dynamically from JD and context without assuming Software Engineering
  - JD True Knock-Out Screeners separated from HR Wishlist Inflation, organizational signals flagged, and Buyer Pain Point extracted
  - CV positioning enforces 6-10s scan hierarchy, Proof Density Hierarchy, and 100% truthful risk framing with zero fabricated facts
  - LinkedIn and profile positioning aligns canonical Experience titles, Recruiter Boolean keywords, 50-skill tagging, and authority surfaces using verified facts only
---
# Recruiter, Personal Brand & Domain-Agnostic Market Intelligence

## When to Use & Preconditions

Cross-cutting intelligence layer giving JD discovery, CV tailoring/building, persona switching, and LinkedIn/profile optimization the judgment of a Senior TA Recruiter, Hiring Manager, and Personal Brand Strategist—dynamically adapted to any industry.

- **Load when:** scoring or decoding JDs; tailoring or creating CVs (`03-tailor-resume-and-verify`, `27-universal-cv-builder`); computing ATS heatmaps (`21-ats-keyword-heatmap`); switching personas (`07-persona-switcher`); or auditing LinkedIn and job-board profiles (`linkedin-growth`, `profile-intelligence-engine`).
- **Preconditions (stop if any is false):**
  - verified candidate facts exist in `context/` or active session confirmations
  - target role, JD, CV, persona, or profile text is supplied
- **Requires skills:** `meta-self-verification`. **MCP:** none.

## Deterministic Step-by-Step Execution

### 1. Step 1 — Dynamic Domain Archetype Detection & Market Adapter
1. **Infer Target Domain Archetype (Never Default to Software Engineering):** Inspect target role title, JD language, and `context/` to select the primary archetype (or hybrid):
   - `Engineering/Data/AI` · `Product/Design` · `Sales/Marketing/Growth` · `Finance/Accounting/Legal/Risk` · `Healthcare/Clinical/Pharma` · `Operations/Supply Chain/HR` · `Executive/Generalist`.
2. **Bind Domain Adapter Rules Dynamically:**

| Archetype | Peer Tone & Vocabulary | Mandatory Compliance / Credential Gates | Native KPI Proof Types | Adaptive Headings & LinkedIn Authority Surfaces |
|---|---|---|---|---|
| **Engineering/Data/AI** | Direct technical peer; systems, architecture, tradeoffs | Security clearance, SOC 2/ISO/GDPR when specified | Uptime/SLAs, p95 latency, throughput, cost savings, ship velocity | `Technical Skills`, `Projects`; LinkedIn `Featured`, `Projects`, `Skills` |
| **Product/Design** | Outcome-first strategist; user research, discovery, prioritization | Accessibility (WCAG), regulated product domain rules | Activation, retention, conversion, NPS, adoption, revenue lift | `Product & Research Competencies`; LinkedIn `Featured` (case studies), `Projects` |
| **Sales/Marketing/Growth** | Commercial operator; pipeline, ICP, unit economics | Regional/industry ad or financial promotion rules | ARR/MRR, quota attainment %, win rate, CAC/LTV, ROAS, pipeline | `Commercial Competencies & Tools`; LinkedIn `Featured`, `Services`, `Honors` |
| **Finance/Accounting/Legal/Risk** | Precise, conservative fiduciary; controls, auditability | CPA, CFA, Bar Admission, FINRA, IFRS/GAAP, SOX | Audit findings (`0`), close cycle reduction, EBITDA, AUM, risk mitigation | `Credentials, Licensure & Systems`; LinkedIn `Licenses & Certifications`, `Publications` |
| **Healthcare/Clinical/Pharma** | Clinical & regulatory rigor; patient safety, protocols | Active RN/MD/PharmD license, HIPAA, GCP, FDA 21 CFR | Patient outcomes, safety compliance, trial milestones, throughput | `Clinical Licensure & Competencies`; LinkedIn `Licenses & Certifications`, `Publications` |
| **Operations/Supply Chain/HR** | Execution-focused; SLAs, capacity, compliance, talent | PMP, Six Sigma, OSHA, ISO 9001, labor compliance | OTIF, unit cost, cycle time, retention %, time-to-fill, safety rate | `Operational Competencies & Systems`; LinkedIn `Licenses & Certifications`, `Featured` |
| **Executive/Generalist** | Board/P&L operator; capital allocation, org scale | Fiduciary governance, board/regulatory filings | P&L ownership, EBITDA, multi-site headcount, M&A integration | `Executive Scope & Competencies`; LinkedIn `Publications`, `Featured`, `Honors` |

3. **Bind Downstream Controls Dynamically:** Pass the selected archetype's (a) **peer tone**, (b) **mandatory credential/compliance gates**, (c) **KPI proof order**, and (d) **section/bucket taxonomy** into `skills/02-discover-and-triage.md`, `skills/03-tailor-resume-and-verify.md`, `skills/21-ats-keyword-heatmap.md`, `skills/27-universal-cv-builder.md`, `skills/linkedin-growth.md`, and `skills/profile-intelligence-engine.md`. Never inject SWE defaults when the archetype is non-tech.

### 2. Step 2 — Senior HR Recruiter & Hiring Manager JD Decoder ("Reading Between the Lines")
1. **Separate True Knock-Out Screeners from HR Wishlist Inflation:**
   - **True Knock-Outs:** Legal work authorization/visa, mandatory licensure/board credentials, core domain execution, and non-negotiable seniority floor. Missing a knock-out triggers `True Gap` / `Tier C` escalation rather than wishful tailoring.
   - **HR Wishlist Inflation:** "Kitchen-sink" 15+ secondary tools, impossible years-per-newly-released-tool, or copy-pasted `"nice-to-have"` paragraphs. Treat as secondary differentiators, never as blockers when core competencies match.
2. **Detect Scope & Organizational Signals:**
   - **Title-vs-Scope Mismatch:** Flag under-titled roles carrying director/P&L/on-call scope or inflated titles masking junior execution.
   - **"One-Person Department" Burnout JDs:** Flag roles combining unrelated functions (e.g., strategy + full-cycle execution + compliance + support) with no team backing.
   - **Channel & Company-Stage Signals:** Distinguish **agency/staffing/consulting** vs. **in-house** postings, and calibrate expectations for **startup generalists** (0-to-1 ambiguity, broad ownership) vs. **enterprise specialists** (cross-functional governance, compliance, scale).
3. **Extract the Buyer Pain Point & Emit JD Decode Brief:**
   - Identify the top **2–3 business problems** the hiring manager was approved budget to solve in the first 90 days (e.g., stalled enterprise pipeline, audit readiness, legacy migration, clinic throughput bottleneck).
   - Output compact internal context: `Domain Archetype` -> `Knock-Outs (Pass/Gap)` -> `Wishlist Non-Blockers` -> `Scope/Stage Flags` -> `Top 2-3 Buyer Pain Points`.

### 3. Step 3 — 6–10 Second Recruiter Scan & Truthful Risk Framing (for CVs)
1. **Enforce the 6–10 Second Visual Scan Hierarchy:**
   - **(1) Canonical Title, Progression & Tenure Stability:** Target role alignment visible in header/latest role; clean `YYYY-MM` timelines and scannable organization-scope lines (size, regulated sector, revenue/scale if verified).
   - **(2) Top-Third Value Proposition:** First 3 lines of Summary + top 4–6 core competencies explicitly answer the Buyer Pain Point using verified facts.
   - **(3) Proof Density Hierarchy (Rank Bullets & Evidence Strictly in This Order):**
     `Quantified Business Outcome` > `Verified Operational Scope (budget, headcount, volume, territory)` > `Shipped Artifact / Deliverable` > `Credential / Tool`.
   - Never drop older high-proof experience below low-signal tool lists if it directly answers the Buyer Pain Point.
2. **Apply 100% Truthful Red-Flag Mitigation (Never Fabricate or Hide Dates):**
   - **Employment Gaps:** Keep exact dates intact; add a brief factual line (`Career break`, `Caregiving`, or verified study/consulting) if confirmed by the candidate.
   - **Short Tenures / Contract Sprints:** Label confirmed contract, fixed-term, acquisition, or layoff roles accurately (`Contract`, `Fixed-Term`, `Company Acquired`) so rapid transitions read as structural rather than performance issues.
   - **Career Pivots:** Lead the top third with transferable KPI proof, relevant credentials, and verified cross-domain projects matching the new archetype rather than chronological legacy duties.
   - **Over-/Under-Qualification:** Calibrate summary and bullet emphasis toward the JD's actual operating scope (hands-on execution vs. leadership) using only real verified responsibilities—never delete degrees or alter dates silently.

### 4. Step 4 — Personal Branding, Positioning & LinkedIn Recruiter SEO Mechanics
1. **Conversion Positioning Formula:** Frame clear differentiation vs. peers sharing the exact same job title:
   - `[Buyer Pain Point Solved] -> [Verified Differentiator] -> [Top-Ranked Proof] -> [Clear Role/Collaboration CTA]`, keeping zero hype and zero AI-slop clichés.
2. **High-Weight LinkedIn Recruiter Indexing Signals:**
   - **Experience Job-Title Weighting:** Canonical target role titles inside **Experience** entries carry higher Recruiter search weight than About prose. Align overly quirky internal titles only through truthful canonical equivalents when accurate and candidate-confirmed (e.g., `Growth Lead (Performance Marketing)`, `Staff RN (ICU Charge)`), never inventing unearned seniority.
   - **Recruiter Boolean Alignment:** Mirror exact Boolean pairs `(Primary Title OR Adjacent Title) AND (Core Skill 1 OR Core Skill 2)` consistently across Headline (`<= 220` chars), Current Experience Title, Top Skills, and first-fold About hook (`<= 220` chars).
   - **50-Skill Cap & Experience-Linked Skill Tagging:** Audit skills within LinkedIn's 50-skill cap for exact industry spelling/casing (`HIPAA`, `Salesforce`, `Financial Modeling`, `TypeScript`) and verify high-priority skills are attached to specific Experience roles so Recruiter "Years of Experience per Skill" filters register them.
   - **Recruiter Spotlight & Authority Surfaces:** Check `Open to Work (Recruiters only)`, recent domain activity, target-company follows, and domain-appropriate proof sections (`Licenses & Certifications`, `Publications`, `Services`, `Featured`, `Projects`, `Honors`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Defaulting to Software Engineering terminology, `Technical Skills` headings, or engineering KPIs for non-tech candidates/JDs → ✅ detect Domain Archetype first and bind domain-native tone, KPIs, and headings.
- ❌ Inventing credentials, licenses, inflated titles, hidden date adjustments, or unverified metrics to neutralize a recruiter red flag or match a Boolean query → ✅ reframe only confirmed facts (`skills/03-tailor-resume-and-verify.md`).
- ❌ Mistaking HR "kitchen-sink" wishlist items for true knock-outs, or ignoring burnout/title-scope contradictions in a JD → ✅ separate Knock-Outs vs. Wishlist and flag organizational risks upfront.
- ❌ Letting About prose carry keywords missing from Experience titles, Headlines, or Top 50 Skills → ✅ align Recruiter Boolean terms across all four indexed surfaces truthfully.

### Self-Verification Check
- [ ] Domain Archetype identified explicitly from JD/`context/` and mapped to matching tone, credentials, KPI proof types, and headings
- [ ] JD decoded into True Knock-Outs vs. HR Wishlist Inflation, organizational signals, and top 2–3 Buyer Pain Points
- [ ] CV/profile recommendations follow the 6–10s scan hierarchy, Proof Density Hierarchy, truthful red-flag framing, and Recruiter Boolean/title/50-skill mechanics (`skills/meta-self-verification.md`)
