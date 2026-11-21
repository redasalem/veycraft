---
name: workday
version: "1.1.0"
description: Load when an application lands on Workday (myworkdayjobs.com / myworkdaysite.com); these account-gated portals are always manual_apply + needs_review.
triggers:
  - Workday hostname detected
requires_mcp:
  - playwright
preconditions:
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
requires_skills:
  - log-and-insights
verification:
  - apply_type manual_apply and status needs_review logged with the canonical posting ID
  - no account created, no terms accepted, no Submit clicked
---
# Workday — manual only

## When to Use & Preconditions

Use to hand Workday jobs to the owner.

- **Load when:** Workday hostname detected.
- **Preconditions (stop if any is false):**
  - readiness gates passed, auth verified via Playwright MCP, and context loaded
- **Requires skills:** `log-and-insights`. **MCP:** playwright.

## Deterministic Step-by-Step Execution

Detect `myworkdayjobs.com` / `myworkdaysite.com` or `taleo.net` / `oraclecloud.com` respectively. Snapshot posting and preserve canonical ID. Always set `apply_type: manual_apply`, `status: needs_review`, reason: `complex/account-gated portal`. Do not create accounts, sign in automatically, accept new legal terms, or click Submit automatically. CAPTCHA/2FA/login walls abort the whole run. Log locally and sync to Notion.

### Account-Gate Detection & Read-Only / Pre-Handoff Snapshot Rules
The rules below apply strictly to **read-only inspection, pre-handoff verification, and offline synthetic regression testing** (`evals/fixtures/forms/workday-mock.html`) — they **never** override the mandatory `manual_apply` + `needs_review` handoff policy:
1. **Account Gate First (Immediate Handoff):** If `browser_snapshot` shows a `Sign In` / `Create Account` gate or candidate account terms checkbox, stop automation immediately, log `apply_type: manual_apply` + `status: needs_review`, keep the tab open, and deliver the tailored resume path plus copy-paste answers to the owner.
2. **ARIA Combobox & Detached Portal Listbox Verification (`skills/18-condition-based-browser-waiting.md`):** On React-Select / Workday custom dropdowns, verify `role="combobox"` carries `aria-expanded="true"` after activation and wait for the detached `role="listbox"` portal (mounted outside `<form>` at document root) and its `role="option"` entries to render in a fresh `browser_snapshot` before resolving any option ref.
3. **Wizard Step Validation & Error Recovery:** Across multi-step Workday wizards (`My Information` -> `My Experience` -> `Voluntary Disclosures` -> `Review`), verify `aria-current="step"` advances cleanly and inspect any `role="alert"` step-validation error banner before retrying or escalating to `needs_review`. Never touch hidden honeypot inputs (`website_url_honeypot`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Creating a portal account to continue → ✅ never.
- ❌ Accepting new legal terms → ✅ owner only.
- ❌ Retrying through another login path → ✅ hand off.

### Self-verification check (before reporting this step complete)
- [ ] apply_type manual_apply and status needs_review logged with the canonical posting ID
- [ ] no account created, no terms accepted, no Submit clicked

Evidence comes from a fresh snapshot, a file read or a command exit code observed after the action (skills/meta-self-verification.md). If any box cannot be ticked, report the step as unverified or needs_review — never as done.
