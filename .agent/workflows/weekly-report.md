---
description: Generate a local weekly or monthly career analytics & skill-gap report (MIN_N = 5) and optional approval-gated Notion sync
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/06-log-and-insights.md` using `veycraft career summary`, `veycraft career analytics [--period <all|YYYY-Www|YYYY-MM>] [--write]`, `logs/applications-log.json`, and `logs/skipped-jobs.json`.
3. Enforce `MIN_N = 5` sample sufficiency and keep `>= 14d` silence distinct from confirmed rejections. Save insights to `logs/insights/` (and optional dashboard via `veycraft career dashboard --no-open`); use one-way approval-gated `veycraft career sync` (`logs/sync-state.json`) only when explicitly requested and live guardrails allow it.
