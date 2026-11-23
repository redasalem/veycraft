---
name: meta-self-verification
version: "1.0.0"
description: Load when the agent is about to report any outcome as done (application submitted, file created/edited/uploaded, profile updated, post published, record logged or synced); forbids claiming success without concrete post-action evidence (file re-read, command output, or fresh browser_snapshot) and logs that proof.
triggers:
  - verify-before-complete
  - right after writing or editing a deliverable file
  - right after a Submit / Save / Post / Send click
  - before writing status applied or reporting success in chat
requires_mcp:
  - none
optional_mcp:
  - playwright
  - notion
preconditions:
  - the action being verified has actually been attempted in this session
  - a fresh file re-read, command output, or browser_snapshot can be taken now
requires_skills:
  - log-and-insights
verification:
  - created or modified files were re-read to confirm existence, formatting, and zero remaining placeholders
  - a quoted confirmation string or state observed AFTER any live browser/Notion action is stored in logs/applications-log.json notes (naming the same company/role or profile section)
  - claims without post-action evidence were reported as unverified/needs_review, not as done
---
# Verify before complete

## When to Use & Preconditions

Use every time you are about to say, write or log that something succeeded ("created", "edited", "applied", "uploaded", "updated", "logged"). `"I wrote the file"` or `"I clicked Submit"` is an action; reporting completion requires post-action proof. Do not use it to decide WHETHER to submit — that is `skills/04-fill-and-apply.md`.

- **Load when:** verify-before-complete; right after writing/editing a deliverable file; right after a Submit / Save / Post / Send click; before writing status applied or reporting success in chat.
- **Preconditions (stop if any is false):**
  - the action being verified has actually been attempted in this session
  - a fresh file re-read, command output, or `browser_snapshot` can be taken now
- **Requires skills:** `log-and-insights`. **MCP:** none (`playwright` and `notion` optional when verifying browser or Notion actions).

## Deterministic Step-by-Step Execution

1. **Observe fresh AFTER the action.** For local files, re-read the saved file (or run `node ./bin/cli.mjs verify <path>`) after writing. For browser actions, wait 3–9 s after the click and take a NEW `browser_snapshot`. Never reuse a pre-action snapshot or assume a write succeeded.
2. **Match the claim to its required evidence.** Only the evidence in this table counts:

| Claim | Required evidence (observed after the action) | Not evidence |
|---|---|---|
| File created / CV edited | Re-reading the target file confirms existence, non-empty content, `0` `{{...}}` placeholders, intact formatting, and verified facts (valid `%PDF-` if `.pdf`; never renamed fake `.docx`) | Calling write/edit without re-reading output |
| Application submitted | Confirmation text such as "Application submitted", "Thank you for applying", "We received your application", an "Applied" badge/state on this job, or a confirmation URL — on a page that still identifies this company/role | The Submit button disappeared; the modal closed; a spinner stopped; no error shown |
| File uploaded | The form shows the exact expected filename in the correct slot (resume vs cover letter) | The file chooser closed; "upload complete" without a filename |
| Profile section updated | Re-opened/reloaded public/profile view in a fresh `browser_snapshot` shows text identical to the `APPROVE`-approved text | Text inside the edit modal; a "Saved" toast alone |
| Post published | Post visible on the feed/profile with identical text, plus its URL | The editor closed |
| Message sent | Message bubble in the thread with identical text and the right recipient | The Send button greyed out |
| Record logged | Re-reading `logs/applications-log.json` shows valid JSON with the new status and unique `job_id` | Intending to write it later |
| Notion synced | Structured receipt applied via `veycraft career sync apply-receipt` (operation-bound `mcp_evidence` + validated read-back matching key/database/properties) recorded as `synced` in `logs/sync-state.json` (structured evidence, not cryptographic proof) | No error printed, unverified MCP response, or local edit without verified `logs/sync-state.json` state |

3. **Check identity.** The evidence must name the same company and role (or same profile section/post text). A generic "Thanks!" page on a different employer domain is not proof.
4. **Record the proof.** Append to the SAME entry's `notes` in `logs/applications-log.json`: `receipt: "<quoted text, max 160 chars>" | url: <final URL> | observed_at: <ISO time>`. Save a screenshot to `logs/screenshots/<safe-job-id>-receipt.png` when one can be taken without personal data in view.
5. **Decide the status from the evidence only.**
   - Evidence found → `applied`, `applied_at` set, `submission_uncertain: false`.
   - No evidence, or ambiguous (timeout, blank page, network error) → keep `needs_review` with `submission_uncertain: true`; never click Submit again; tell the owner exactly what was and was not seen.
   - Validation errors visible instead → nothing was submitted; go to `skills/meta-structured-debugging.md`.
6. **Report in chat with the same words as the evidence:** "Submitted — the page showed 'Thank you for applying to Acme' (screenshot saved)", or "Clicked Submit, but no confirmation appeared; marked for your review".

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ "The modal closed, so it was submitted" → ✅ a closed modal is not a receipt; look for confirmation text or the Applied state.
- ❌ Checking the snapshot taken just before clicking Submit → ✅ always a new snapshot after the wait.
- ❌ Clicking Submit again because no confirmation appeared → ✅ keep submission_uncertain and ask the owner; a second click can create a duplicate application.
- ❌ Writing "Profile updated" after typing into the edit field → ✅ re-open the profile and compare the persisted text.
- ❌ Logging `applied` and planning to "verify later" → ✅ the status is decided only after the evidence is observed.

### Self-verification check (before reporting this step complete)
- [ ] a quoted confirmation string or state observed AFTER the action is stored in the journal notes
- [ ] the evidence names the same company/role (or profile section/post text) as the action
- [ ] claims without evidence were reported as unverified/needs_review, not as done

If any box cannot be ticked, the outcome is "unverified" — say so plainly.
