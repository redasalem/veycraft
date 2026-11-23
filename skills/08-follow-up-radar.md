---
name: follow-up-radar
version: "1.0.0"
description: Load when the owner asks to check pending applications, run a 7-day follow-up radar, or draft follow-up messages for applications sent >= 7 days ago; inspects logs/applications-log.json and saves <=75-word draft-only follow-ups without ever auto-sending.
triggers:
  - check follow-ups
  - 7-day follow-up radar
  - draft follow-ups for applied jobs
requires_mcp:
  - none
preconditions:
  - logs/applications-log.json exists and is readable
  - today's UTC date is known to compute days since applied_at
requires_skills:
  - log-and-insights
  - outreach-and-interview-prep
verification:
  - every candidate listed has status "applied" with applied_at >= 7 days ago and no prior follow-up logged
  - every drafted message is strictly <= 75 words, humanized, and saved to logs/resumes/<folder>/followup-draft.md
  - zero emails or LinkedIn messages were sent without explicit owner approve in chat
---
# 7-Day Follow-Up Radar

## When to Use & Preconditions

Most interviews come from timely, polite follow-ups after an application sits in the ATS queue for a week. This skill surfaces stale `applied` jobs (`>= 7 days` since `applied_at`) and prepares crisp, draft-only follow-up notes.

- **Load when:** `check follow-ups`; `7-day follow-up radar`; `draft follow-ups for applied jobs`.
- **Preconditions (stop if any is false):**
  - `logs/applications-log.json` exists and is readable
  - today's UTC date is known to compute days since `applied_at`
- **Requires skills:** `log-and-insights`, `outreach-and-interview-prep`. **MCP:** none (optional Playwright only if owner approves checking an existing thread).

## Deterministic Step-by-Step Execution

1. **Scan `logs/applications-log.json`:**
   - Filter entries where `status === "applied"` AND `applied_at` is at least **7 calendar days** before today (`>= 7` days, typically `7–21` days).
   - Exclude entries whose `notes` already record `followup_sent:` or `outcome: rejected|interview|offer`.
2. **Present the Follow-Up Radar table in chat:**
   - Show `# | Company & Role | Applied Date | Days Elapsed | Contact / Draft Folder` sorted oldest-first (up to 10 per batch).
3. **Draft personalized `<= 75`-word follow-ups (Draft-Only):**
   - For each selected (or top Tier A) entry, read its `logs/resumes/<folder>/interview-dossier.md` and `outreach-draft.md` (if present) so the message references the exact role, application date, and 1–2 concrete verified strengths.
   - Apply the **Fact-Check Guard** and **Anti-AI Slop filter** (`skills/03-tailor-resume-and-verify.md`: zero clichés, zero em-dashes).
   - Enforce **strict `<= 75` words** per message.
   - Save each draft to `logs/resumes/<folder>/followup-draft.md` marked `DRAFT_ONLY` (listing recipient from `outreach-draft.md` or `"Hiring Team / Recruiter"` if unresolved).
4. **Never auto-send:**
   - Present the drafts in chat. If the owner explicitly wants to send one via Playwright MCP, require exact `approve` on the exact recipient and text (`skills/05-outreach-and-interview-prep.md`) and record the sent follow-up atomically via `node ./bin/cli.mjs career transition --job-id "<job_id>" --to applied --source follow_up_radar --follow-up-status sent --draft-rel "logs/resumes/<folder>/followup-draft.md"` (or `--follow-up-status drafted` when saving draft-only) after `skills/meta-self-verification.md`.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Sending follow-ups automatically after 7 days without owner approval → ✅ strictly draft-only in `followup-draft.md`.
- ❌ Drafting a generic 120-word `"I am thrilled to follow up — moreover..."` template → ✅ <= 75 words, plain peer tone, zero AI slop.
- ❌ Following up twice on an application already marked `followup_sent` or `rejected` → ✅ check `notes` first.

### Self-verification check (before reporting this step complete)
- [ ] every candidate listed has `status: "applied"` with `applied_at >= 7` days ago and no prior follow-up logged
- [ ] every drafted message is strictly `<= 75` words, humanized, and saved to `logs/resumes/<folder>/followup-draft.md`
- [ ] zero emails or LinkedIn messages were sent without explicit owner `approve` in chat
