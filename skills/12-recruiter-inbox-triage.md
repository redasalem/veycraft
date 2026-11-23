---
name: recruiter-inbox-triage
version: "1.0.0"
description: Load when the owner pastes or shares incoming recruiter emails or LinkedIn messages (interview invites, technical assessments, follow-up questions, or rejections); classifies each message, updates logs/applications-log.json and optional Notion, and drafts polite humanized replies with interview slots without auto-sending.
triggers:
  - triage recruiter message / email
  - recruiter replied with interview invite
  - draft reply to recruiter inbox
requires_mcp:
  - none
optional_mcp:
  - notion
preconditions:
  - incoming recruiter message(s) provided by the owner in chat (or read from an owner-approved view)
  - logs/applications-log.json readable to match the corresponding job_id/company
requires_skills:
  - log-and-insights
  - tailor-resume-and-verify
  - offer-negotiator
verification:
  - message classified accurately (interview_invite, assessment, info_request, offer, rejection, or spam)
  - matching entry in logs/applications-log.json updated (and Notion synced if enabled) without overwriting applied_at receipts
  - drafted reply is humanized, uses verified owner availability/timezone, and is marked DRAFT_ONLY
---
# Recruiter Inbox Triage & Reply Drafter

## When to Use & Preconditions

Turns messy recruiter emails and LinkedIn InMails into structured status updates and crisp, ready-to-send replies. Strictly draft-only—never sends emails or messages automatically.

- **Load when:** `triage recruiter message / email`; `recruiter replied with interview invite`; `draft reply to recruiter inbox`.
- **Preconditions (stop if any is false):**
  - incoming recruiter message(s) provided by the owner in chat
  - `logs/applications-log.json` readable to match the corresponding `job_id`/company
- **Requires skills:** `log-and-insights`, `tailor-resume-and-verify`, `offer-negotiator`. **MCP:** notion (optional).

## Deterministic Step-by-Step Execution

1. **Classify Each Incoming Message:**
   - Categorize as one of:
     - `interview_invite` (recruiter call, technical screen, panel)
     - `assessment` (take-home assignment, coding test + deadline)
     - `info_request` (notice period, visa, rate/salary expectation, updated CV)
     - `offer` -> also route to `skills/09-offer-negotiator.md`
     - `rejection` -> note feedback if any
     - `spam` / `unrelated`
2. **Match & Update Local Tracking (`logs/applications-log.json` & Dossier):**
   - Match the sender's company/role to `logs/applications-log.json` (and read `logs/resumes/<folder>/interview-dossier.md` if present so you have the archived JD context).
   - Record the verified outcome atomically via `node ./bin/cli.mjs career transition --job-id "<job_id>" --to <interview|assessment|offer|rejected|withdrawn> --source recruiter_inbox_triage [--stage <iv_stage>] [--assessment-type <type>] --notes "<concise summary>"` so `stage_history[]` and structured interview/assessment metadata update without erasing the original `applied_at` or receipt quote.
   - Never silently write to Notion; if the owner wants to reflect local updates in Notion, use the one-way approval-gated `veycraft career sync` workflow in `skills/06-log-and-insights.md` (`logs/sync-state.json` authoritative).
3. **Draft a Crisp, Humanized Reply (`DRAFT_ONLY`):**
   - **For `interview_invite`:** Thank the interviewer briefly, confirm the exact role, and propose 2–3 clear time windows in **both the owner's verified timezone (`config/guardrails.yaml -> active_hours.timezone`) and the recruiter's timezone** (ask the owner for exact free slots if not already provided in chat).
   - **For `assessment`:** Confirm receipt, note the stated deadline, and clarify any missing scope/repo instructions.
   - **For `info_request`:** Answer ONLY using verified facts in `context/form-answers.yaml` / `context/profile.md` (and route salary/rate prompts through `skills/09-offer-negotiator.md`). Flag any unverified question for the owner first.
   - **For `rejection`:** Optionally draft a 2-sentence gracious thank-you / keep-in-touch note.
   - Pass every draft through the **Anti-AI Slop filter** (`skills/03-tailor-resume-and-verify.md`: zero clichés, zero em-dashes).
   - Save the reply under `logs/resumes/<folder>/inbox-reply-draft.md` (when a job folder exists) marked `DRAFT_ONLY`.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Auto-sending email or LinkedIn replies without owner review → ✅ strictly `DRAFT_ONLY` until the owner edits or explicitly approves sending.
- ❌ Promising interview slots without checking the owner's timezone or asking their availability → ✅ confirm timezone and ask/verify free slots.
- ❌ Overwriting `applied_at` or deleting the original submission receipt in `logs/applications-log.json` → ✅ append outcome to `notes`.

### Self-verification check (before reporting this step complete)
- [ ] message classified accurately (`interview_invite`, `assessment`, `info_request`, `offer`, `rejection`, or `spam`)
- [ ] matching entry in `logs/applications-log.json` updated (and Notion synced if enabled) without overwriting `applied_at` receipts
- [ ] drafted reply is humanized, uses verified owner availability/timezone, and is marked `DRAFT_ONLY`
