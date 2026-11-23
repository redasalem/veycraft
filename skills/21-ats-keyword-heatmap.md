---
name: ats-keyword-heatmap
version: "1.1.0"
description: Load before exporting any tailored resume PDF to compute and display a deterministic Before vs. After ATS Keyword Match % table across domain-adaptive buckets (Core Domain Skills & Methodologies; Tools, Platforms & Systems; Credentials, Licensure & Compliance; Business Outcomes & Scope Signals) using only verified facts from context/cv.md.
triggers:
  - ATS keyword heatmap
  - before vs after keyword match percentage
  - check resume keyword coverage before PDF export
  - compare JD keywords against tailored CV
requires_mcp:
  - none
preconditions:
  - full expanded job description text is captured
  - base CV (context/cv.md) and draft tailored HTML/bullets are available for comparison
requires_skills:
  - tailor-resume-and-verify
  - discover-and-triage
  - recruiter-brand-and-domain-intelligence
verification:
  - deterministic 4-row domain-adaptive heatmap table (Core Domain Skills & Methodologies; Tools, Platforms & Systems; Credentials, Licensure & Compliance; Business Outcomes & Scope Signals) shows exact matched/total counts and Before % vs. After %
  - every newly surfaced keyword in the After column maps to a real verified fact in context/cv.md or context/profile.md
  - missing keywords that the owner does not possess are listed transparently under True Gaps rather than hallucinated into the CV
---
# ATS Keyword Heatmap & Coverage Verifier

## When to Use & Preconditions

Quantifies exactly how much a tailored resume improves ATS keyword coverage over the base CV before printing the final PDF across any target industry—while proving zero unverified keywords were injected.

- **Load when:** `ATS keyword heatmap`; `before vs after keyword match percentage`; `check resume keyword coverage before PDF export`; `compare JD keywords against tailored CV`.
- **Preconditions (stop if any is false):**
  - full expanded job description text is captured
  - base CV (`context/cv.md`) and draft tailored resume HTML/text are available
- **Requires skills:** `tailor-resume-and-verify`, `discover-and-triage`, `recruiter-brand-and-domain-intelligence`. **MCP:** none.

## Deterministic Step-by-Step Execution

1. **Extract Canonical Domain-Adaptive JD Keyword Inventory (4 Buckets):**
   - Identify the target **Domain Archetype** via `skills/28-recruiter-brand-and-domain-intelligence.md` (Step 1), then parse the captured job description into four deterministic domain-adaptive buckets:
     1. **Core Domain Skills & Methodologies:** e.g., Tech: `TypeScript`, `System Design`, `CI/CD`; Commercial: `Enterprise Sales`, `Demand Generation`, `Account-Based Marketing`; Finance/Healthcare: `Financial Modeling`, `GAAP`, `Clinical Trials`, `Patient Triage`.
     2. **Tools, Platforms & Systems:** e.g., Tech: `React`, `PostgreSQL`, `AWS`, `Kubernetes`; Commercial/Ops: `Salesforce`, `HubSpot`, `SAP`, `Tableau`; Healthcare/Legal: `Epic EHR`, `Veeva`, `Relativity`.
     3. **Credentials, Licensure & Compliance:** e.g., `GDPR`, `SOC 2`, `ISO 27001`, `HIPAA`, `FDA 21 CFR`, `CPA`, `CFA`, `RN`, `PMP`, `Bar Admission`, `Security Clearance`.
     4. **Business Outcomes & Scope Signals:** e.g., `Architecture`, `SLAs`, `ARR / Quota Attainment`, `EBITDA`, `P&L Ownership`, `Cross-Functional Leadership`, `Mentoring`, `Process Optimization`.
2. **Score Base CV (`Before %`) vs. Tailored CV (`After %`):**
   - Count exact or canonical-synonym matches present in `context/cv.md` (`Before`) versus the tailored `templates/ats-resume-template.html` draft (`After`).
   - Compute `Matched / Total` and percentage for each bucket and overall weighted coverage.
3. **Verify Every Added Keyword Against the Evidence Map:**
   - For every keyword gained between `Before` and `After` (e.g., surfacing `PostgreSQL`, `Salesforce`, or `HIPAA Compliance` from an older role in `context/cv.md` that was buried below the fold), cite the exact source employer/project in `context/cv.md`.
   - Separate keywords that do **not** exist in `context/cv.md` or `context/form-answers.yaml` into a **True Unclaimed Gaps** list (distinguishing mandatory knock-out gaps from wishlist items per `skills/28`).
4. **Render the Heatmap Table Before Printing PDF:**
   - Present the concise Markdown table in chat (and optionally inside `interview-dossier.md`):
     `| Category | JD Keywords | Base CV (Before) | Tailored CV (After) | Newly Surfaced (Verified) | True Unclaimed Gaps |`
   - Proceed to PDF export (`skills/03-tailor-resume-and-verify.md`) only when `Unverified Injected Keywords == 0`.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** inflate `After %` by stuffing unclaimed JD keywords into invisible text, white-on-white fonts, or fabricated bullet points.
- **NEVER** count vague buzzwords (`"team player"`, `"fast-paced"`) as domain ATS keywords or force non-tech JDs into software-only examples.
- **NEVER** hide missing required skills or mandatory credentials; surface them under **True Unclaimed Gaps** so the owner can confirm if they actually have that experience.
- **Self-Verification Check:** Confirm all 4 domain-adaptive category rows (`Core Domain Skills & Methodologies`, `Tools, Platforms & Systems`, `Credentials, Licensure & Compliance`, `Business Outcomes & Scope Signals`) show exact `n/N (%)` math, every newly surfaced term traces to `context/cv.md`, and zero unverified keywords appear in the tailored resume.
