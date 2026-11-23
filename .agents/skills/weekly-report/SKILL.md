---
name: weekly-report
description: Load when the owner asks for a weekly or monthly career analytics and skill-gap report (/weekly-report) from local logs (MIN_N = 5) and optional one-way approval-gated Notion sync.
---

# Veycraft Weekly Report

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/06-log-and-insights.md` (`veycraft career summary`, `veycraft career analytics [--period <all|YYYY-Www|YYYY-MM>] [--write]`) to aggregate `logs/applications-log.json` and `logs/skipped-jobs.json` into `logs/insights/` with `MIN_N = 5` sample sufficiency and silence-not-rejection honesty.
3. For optional Notion export, use the one-way approval-gated `veycraft career sync` workflow (`logs/sync-state.json`) rather than direct writes.
