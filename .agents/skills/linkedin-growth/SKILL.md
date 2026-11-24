---
name: linkedin-growth
description: Load when the owner asks to review/audit their LinkedIn profile, optimize for LinkedIn Recruiter search ranking or feed distribution (topical authority, dwell time, comment-first strategy, native PDF carousels), sync LinkedIn with their CV, or draft posts/<=75-word outreach (/linkedin-growth); defaults to DRAFT_ONLY with Anti-Myth/Anti-Pod guardrails and APPROVE-gated live edits when authenticated Playwright exists.
---

# Veycraft LinkedIn Growth (`v3.0.0`)

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `.agent/workflows/linkedin-growth.md` and `skills/linkedin-growth.md` (`v3.0.0`, plus `skills/28-recruiter-brand-and-domain-intelligence.md`, `skills/05-outreach-and-interview-prep.md`, `skills/03-tailor-resume-and-verify.md`, and `skills/24-circuit-breaker-and-antiban.md`).
3. Enforce **Epistemic Discipline** (separate Confirmed Platform Mechanics from Observed Distribution Heuristics; zero fake multipliers), **Engine A** (`0-100` Recruiter-SEO rubric, multi-role Skills-to-Experience depth, Likely-to-Respond & 3-stage funnel diagnostics), **Engine B** (Topical Authority, Dwell Time hooks, Comment-First `DRAFT_ONLY` strategy, Native Format Tradeoffs Matrix), and **Engine C** (Anti-Pod/Anti-Automation ToS guardrails, canonical 19-item banned cliché parity, zero prose em-dashes). Default strictly to `DRAFT_ONLY` output in chat and `logs/insights/linkedin-seo-audit-YYYY-MM-DD.md`; execute live Save/Post/Comment/Send only with verified signed-in Playwright access, explicit `APPROVE`, and post-action `browser_snapshot` verification. Verify `<= 75`-word outreach via `node ./bin/cli.mjs pre-submit`.
