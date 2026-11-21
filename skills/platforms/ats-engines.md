---
name: ats-engines
version: "1.2.0"
last_verified: "2026-11-18"
description: Load when an application lands on a recognized employer ATS and routing, exact snapshot-driven filling, uploads, review and receipt checks are needed across engines.
triggers:
  - ATS hostname recognized
  - fill-and-apply routing
requires_mcp:
  - playwright
preconditions:
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
requires_skills:
  - fill-and-apply
verification:
  - hostname matched to a supported engine or routed to manual review
  - upload verified by filename
  - receipt verified after submit
---
# ATS engines: form-by-form playbook

## When to Use & Preconditions

Use as the cross-ATS reference; engine-specific files live in skills/ats/.

- **Load when:** ATS hostname recognized; fill-and-apply routing.
- **Preconditions (stop if any is false):**
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
- **Requires skills:** `fill-and-apply`. **MCP:** playwright.

## Deterministic Step-by-Step Execution

Live-unverified; labels are illustrative, current snapshots authoritative. Readiness/auth/context, owner authorization, permitted automation, score, duplicates, caps, active hours and pacing still apply. Preserve original discovery job_id and record canonical ATS URL in notes; check both before filling. Custom/lookalike or employer-mismatched hosts require manual review.

| Engine / recognized host | Identity and form sequence | Special cases / confirmation |
|---|---|---|
| Greenhouse: boards.greenhouse.io, job-boards.greenhouse.io (or `#grnhse_iframe` embed) | Verify employer + URL job ID/gh_jid (switch into `#grnhse_iframe` when embedded on corporate career pages); snapshot Apply → contact fields → Resume chooser → employer questions → consent → review | Click-to-mount custom dropdowns/location portals, wait for `listbox` options in `browser_snapshot`, select exact owner location. Voluntary EEO uses explicit neutral defaults. Never touch hidden anti-bot fields. See ../ats/greenhouse.md. |
| Lever: jobs.lever.co | Capture `/employer/<uuid>`; Apply for this job → name/email/phone → resume → links → custom questions → Submit Application | Distinguish optional Additional information/cover letter; do not invent links. Verify upload and employer after auto-extraction. Receipt must identify submitted application, not merely form disappearance. See ../ats/lever.md. |
| Ashby: jobs.ashbyhq.com | Verify organization/job UUID; Job/Application tab or Apply → snapshot steps and progress → upload → contact → questions → review | Resume parsing may overwrite fields: recheck after upload. Conditional questions appear only after selections; snapshot again. Keep uncertainty reserved if network/status ambiguous. See ../ats/ashby.md. |
| SmartRecruiters: jobs.smartrecruiters.com; other explicit linked employer domains require review | Verify company + numeric role ID; I am interested → guest path ONLY if offered → upload/contact → work/education questions → privacy consent → review | Never grant social OAuth or create an account automatically. Resume extraction may change fields. Required experience dates need exact facts; receipt page/text must match employer/role. See ../ats/smartrecruiters.md. |
| Workable: apply.workable.com | Verify linked employer and posting shortcode; Apply → resume/contact/location → required screening → consent/review | Documentation/manual-only via other cap 0; no automated submission until an adapter is reviewed. Snapshot review and record manual_apply/needs_review. Redirect/OAuth/account requirement remains manual. |
| BreezyHR: verified employer subdomain of breezy.hr | Capture `/p/<id>`; Apply To Position → contact/resume → questions/optional cover letter → review | Don't confuse optional portfolio/cover letter with resume. Verify attachment and exact employer after redirects. No blind retry after ambiguous send. See ../ats/breezyhr.md. |
| Workday: myworkdayjobs.com / myworkdaysite.com; Taleo: taleo.net | Identify role and external URL; detect Sign In / Create Account gates (`manual_apply` immediately); read-only/pre-handoff snapshot verification for `aria-expanded="true"` + detached portal `listbox` + `role="alert"` step-validation errors (`evals/fixtures/forms/workday-mock.html`) | Always `apply_type: manual_apply` + `status: needs_review`. Complex account/work-history/assessment steps are owner-controlled; no new accounts, no terms acceptance, and no auto-submit. See ../ats/workday.md. |

### Exact shared field loop
1. Before clicking Apply inspect accessible name/description and any irreversible wording. If uncertain it may submit, treat as final action, not a harmless form-open.
2. Snapshot active form and build a checklist of label/type/required/options/current value. Resolve confirmed contact facts and exact question mappings; skill-specific years before generic years. Never populate a fact solely because resume parsing guessed it.
3. Use roles/labels/current refs (`skills/18-condition-based-browser-waiting.md`); no CSS selectors/DOM injection. For custom React-Select/Ashby/Greenhouse portal dropdowns, run a click-to-mount cycle (click trigger -> snapshot portal `listbox` at root -> click matching `option`). Wait via condition checks first, followed by a single random 3–9 s human pacing jitter between page submissions. Missing/ambiguous controls → review rather than repeated clicks.
4. Upload the exact per-job PDF through accessible chooser/MCP upload; snapshot filename and successful attachment. Required unknown facts/legal/consents → open_questions + screenshot, leave tab open and ask. Grounded motivation drafting follows 04-fill-and-apply.md only.
5. At final review verify identity, dates, location, exact resume, approved answers, consent and no unwanted subscriptions. Dry run stops before irreversible action; log dry_run, no reservation.
6. Real submission: run skills/04-fill-and-apply.md; reload logs/applications-log.json and caps, apply all gates, reserve needs_review/submission_uncertain:true, and submit once. Do not call duplicate gating on the newly created self-reservation as a new job; recheck limits excluding only your own reservation while retaining other pending entries.
7. Verify explicit receipt and job identity. Update same record applied/applied_at/uncertainty false. Timeout or vague confirmation → keep uncertain, do not retry. CAPTCHA/2FA/unexpected login/warning/rate limit aborts the whole run; unknown questions alone block this job.
8. Journal locally first, optional Notion query-before-create afterward. Never claim applied from an HTTP 200, disabled button, or form disappearance alone.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Treating a lookalike domain as the real ATS → ✅ mismatches go to review.
- ❌ Creating an ATS account → ✅ manual_apply.
- ❌ Retrying an ambiguous submit → ✅ never.

### Self-verification check (before reporting this step complete)
- [ ] hostname matched to a supported engine or routed to manual review
- [ ] upload verified by filename
- [ ] receipt verified after submit

Evidence comes from a fresh snapshot, a file read or a command exit code observed after the action (skills/meta-self-verification.md). If any box cannot be ticked, report the step as unverified or needs_review — never as done.
