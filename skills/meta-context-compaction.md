---
name: meta-context-compaction
version: "1.0.0"
description: Load when a long run has processed 3-5 applications since the last checkpoint, the conversation is getting long, or a new session must resume an interrupted run; writes and re-reads logs/runs/current-session-checkpoint.json so rules and progress survive context loss.
triggers:
  - long-run-memory-compaction
  - every 3-5 applications or 15 jobs processed
  - resuming a run in a new chat/session
requires_mcp:
  - none
preconditions:
  - an active daily run in progress (or a checkpoint file to resume from)
requires_skills:
  - log-and-insights
verification:
  - logs/runs/current-session-checkpoint.json is valid JSON matching the checkpoint structure
  - checkpoint counts agree with logs/applications-log.json for this run_id
  - after compaction AGENTS.md hard guardrails and only the next phase's skill were re-read
---
# Long-run memory compaction

## When to Use & Preconditions

Use during long daily runs so the agent does not forget caps, approvals or which jobs are done, and when a run must resume after the chat was reset. The journal (`logs/applications-log.json`) is always the source of truth; the checkpoint is a compact cache and never authorizes anything.

- **Load when:** long-run-memory-compaction; every 3–5 applications or 15 jobs processed; resuming a run in a new chat/session.
- **Preconditions (stop if any is false):**
  - an active daily run in progress (or a checkpoint file to resume from)
- **Requires skills:** `log-and-insights`. **MCP:** none.

## Deterministic Step-by-Step Execution

### A. Write a checkpoint
1. Finish the current atomic step first (never checkpoint between a reservation and its receipt check).
2. Run `node ./bin/cli.mjs career run-checkpoint [--run-id <YYYY-MM-DD>] [--phase <phase>] [--next-action "<txt>"] [--awaiting-job-id <id> --awaiting-question "<q>"] [--clear-awaiting-job-id <id>] [--consecutive-errors <n>] [--notes "<txt>"] [--json]` (which acquires `logs/.ledger.lock`, derives authoritative counts and caps from `logs/applications-log.json` and `logs/skipped-jobs.json`, reconciles `queue` and `processed_job_ids`, enforces `submission_authorized: false`, auto-aborts on `consecutive_errors >= 3`, and atomically writes `logs/runs/current-session-checkpoint.json` + `logs/runs/YYYY-MM-DD.json`):

```json
{
  "kind": "session_checkpoint",
  "version": 1,
  "run_id": "2026-11-18",
  "updated_at": "2026-11-18T10:42:00Z",
  "phase": "applying",
  "workflow_mode": "batch_review_first",
  "dry_run": true,
  "approval_mode": "approve_before_submit",
  "submission_authorized": false,
  "approval_expired_on_resume": false,
  "caps": { "effective_daily_cap": 5, "applied_today": 2, "reserved_unresolved": 0, "per_platform_applied": { "linkedin": 2 } },
  "processed_job_ids": ["linkedin:4012", "linkedin:4013"],
  "queue": ["greenhouse:acme-77"],
  "awaiting_owner": [{ "job_id": "linkedin:4015", "question": "Notice period in weeks?" }],
  "batch_selection": "APPLY 1,3",
  "consecutive_errors": 0,
  "next_action": "Open greenhouse:acme-77 from its folder logs/resumes/acme-backend-greenhouse-acme-77/",
  "notes": ""
}
```

   - `phase`: one of `readiness`, `discovery`, `triage`, `awaiting_owner`, `applying`, `logging`, `reporting`, `finished`, `aborted`.
   - Never store tokens, cookies, passwords, form answers, salary or contact data.
3. Verify `logs/runs/current-session-checkpoint.json` via `node ./bin/cli.mjs verify logs/runs/current-session-checkpoint.json` (or re-read it to confirm valid JSON).
4. **Compact:** in your own working memory keep only: the checkpoint, `config/invariants.txt` (`<500` bytes), `AGENTS.md` hard guardrails, and the `skills/REGISTRY.md` row for the next phase. Re-read `config/invariants.txt`, `AGENTS.md` "Hard guardrails", and the single skill needed next (progressive disclosure). Drop earlier job descriptions and snapshots from consideration.

### B. Resume from a checkpoint (new session or after memory loss)
1. Read `AGENTS.md`, `skills/REGISTRY.md`, then run `node ./bin/cli.mjs career run-resume [--run-id <YYYY-MM-DD>] [--json]` (or inspect `logs/runs/current-session-checkpoint.json`).
2. If `phase` is `finished` or `aborted`, `career run-resume` refuses to reopen the closed run; start a new run normally via `veycraft career run-start`.
3. `career run-resume` re-derives counts, caps, and queue state from `logs/applications-log.json` and `logs/skipped-jobs.json` (the ledger always wins and moves any already-handled job out of `queue` into `processed_job_ids`).
4. Re-verify auth (`skills/00-daily-run.md` step 1) and recompute the effective cap; time may have passed.
5. Any approval given before the interruption is EXPIRED (`approval_expired_on_resume: true`, `submission_authorized: false`, `skills/04-fill-and-apply.md`). `batch_selection` survives only within the same `run_id` and only for jobs still in `queue`; re-check each `job_id` in the journal before opening it.
6. Continue from `next_action` (or inspect `node ./bin/cli.mjs career next [--json]`).

### C. End of run
Run `node ./bin/cli.mjs career run-finish [--run-id <YYYY-MM-DD>] --status <completed|aborted>` to set `phase` to `finished` (or `aborted`) and clear `queue: []`. Do not delete the file; the next run overwrites it.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Trusting the checkpoint's `applied_today` over `logs/applications-log.json` → ✅ the journal always wins.
- ❌ Saving session cookies or form answers in the checkpoint → ✅ store IDs, counts, and `next_action` only.
- ❌ Resuming and submitting with an `APPROVE` given before the reset → ✅ show the summary again and wait.
- ❌ Checkpointing right after the Submit click, before checking the receipt → ✅ finish `skills/meta-self-verification.md` first.
- ❌ Reloading every playbook after compaction → ✅ `AGENTS.md` guardrails + the one skill for the next phase.

### Self-verification check (before reporting this step complete)
- [ ] `logs/runs/current-session-checkpoint.json` is valid JSON matching the checkpoint structure
- [ ] checkpoint counts agree with `logs/applications-log.json` for this `run_id`
- [ ] after compaction `AGENTS.md` hard guardrails and only the next phase's skill were re-read
