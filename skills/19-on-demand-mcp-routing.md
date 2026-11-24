---
name: on-demand-mcp-routing
version: "1.1.2"
description: Load at phase boundaries to minimize context bloat by routing MCP tool usage strictly on demand — using zero MCP tools for local JSON/Markdown phases (/weekly-report, rejection patterns, score calibration, PII audit) and invoking Playwright MCP or Notion MCP only in the exact browser or sync phases that require them.
triggers:
  - route MCP tools on demand
  - reduce context token bloat in long session
  - phase boundary MCP check
requires_mcp:
  - none
preconditions:
  - active task or /daily-run phase is identified (local file ops, browser automation, or optional Notion sync)
  - config/guardrails.yaml storage_adapters.notion_mcp flag is known
requires_skills:
  - meta-context-compaction
  - daily-run
verification:
  - pure local phases (interrogation gates, CV writing, pattern/calibration analysis, weekly report) executed using IDE file tools with zero unnecessary Playwright/Notion MCP calls
  - Notion MCP calls were skipped cleanly whenever storage_adapters.notion_mcp is false in config/guardrails.yaml
  - Playwright MCP snapshot payloads were pruned/summarized immediately at phase end before checkpointing via meta-context-compaction
---
# On-Demand MCP Tool Routing (Adapted from `obra/superpowers-lab` `mcp-cli` Pattern)

## When to Use & Preconditions

Prevents accessibility-tree snapshots and optional integration schemas from exhausting model context during multi-application runs, keeping latency low and reasoning crisp across every model family.

- **Load when:** `route MCP tools on demand`; `reduce context token bloat in long session`; `phase boundary MCP check`.
- **Preconditions (stop if any is false):**
  - current workflow phase is known
  - `config/guardrails.yaml` is readable
- **Requires skills:** `meta-context-compaction`, `daily-run`. **MCP:** none (routing controller).

## Deterministic Step-by-Step Execution

1. **Classify the Current Phase & Capability Category (`A–E`) Before Touching Any MCP Tool:**
   - **Local-Only & Optional-CLI Phases (`requires_mcp: none`):**
     - Gatekeeper audit (`00-interrogate-and-onboard`), CV ingestion/creation/editing (`01`), HTML/TXT/Word-compatible `.doc` tailoring & fact-checking (`03`), standalone interview dossier & `<= 75`-word drafts (`05`), local JSON writes, tracking updates & `/weekly-report` (`06`), persona switching (`07`), follow-up radar (`08`), offer negotiation (`09`), GitHub CLI account audit, marketing polish, safe cleanup & `context/github-projects.md` extraction (`11-portfolio-and-github-auditor`, using `gh` CLI with optional Playwright for live portfolio rendering), recruiter inbox triage (`12`), PII audit (`14`), multilingual adaptation (`15`), rejection patterns (`16`), score calibration (`17`), isolated portfolio website building & CLI deployment (`29-portfolio-builder-and-deployer`, using local build/deploy CLIs with optional Playwright for visual preview), portfolio architectural blueprint, WCAG token lock, `node --test`/isolated `vitest` unit QA & `375px`/`768px`/`1440px` self-healing loop (`30-portfolio-design-system-and-qa`, using optional Playwright for live responsive/console inspection or offline DOM verification fallback), and offline LinkedIn audit from pasted/PDF/screenshot profile (`linkedin-growth`).
     - Execute these strictly with built-in file tools, `bin/cli.mjs` (`audit`, `verify`, `pre-submit`, `career summary|analytics|dashboard|migrate|cv-versions`, and offline `career sync preview|status|verify-schema|apply-receipt|record-failure|expire-stale|reconcile|reset-permanent|release-stale-lock`), and authenticated `gh` / hosting CLIs or `<portfolio-dir>` local test runners (for Skills 11, 29, & 30) without spinning up Playwright MCP unnecessarily.
   - **Playwright-Required / Optional Phases (`playwright`):**
     - **Required:** live board auth checks, search page inspection, live ATS form upload/fill (`04`, `platforms/*`, `ats/*`).
     - **Optional:** PDF rendering (`page.pdf`), reading `.pdf` without native PDF support, live URL inspection, read-only LinkedIn profile/JD reads, and `APPROVE`-gated live LinkedIn profile edits.
   - **Notion-Optional Phases (`notion`):**
     - Check current `config/guardrails.yaml` (`storage_adapters.notion_mcp` and `dry_run`). Live Notion sync (`preview --live`, `approve`, `mark-in-flight`, and external MCP writes) requires BOTH `storage_adapters.notion_mcp: true` AND `dry_run: false`, plus explicit owner approval and receipt recording in `logs/sync-state.json` (`skills/06-log-and-insights.md`). When disabled or in dry-run mode, keep local JSON under `logs/` authoritative and use offline `career sync` preview/status/recovery commands locally without invoking Notion MCP.
2. **Keep Snapshot Surface Lean Across Phases:**
   - Once a JD is captured via `browser_snapshot`, distill its key facts into the working Mission Control entry or `interview-dossier.md` and discard raw HTML/navigation boilerplate from working memory.
   - Every **3–5 applications**, execute `skills/meta-context-compaction.md` to checkpoint progress and drop stale tab trees.
3. **Alternative Resolution & Recovery (`skills/fallback-no-mcp.md`):**
   - Classify missing tools cleanly: **(A)** run now, **(B)** ask user input, **(C)** optional tool missing, **(D)** supported alternative available, **(E)** unsupported/prohibited.
   - If `playwright` or `notion` is disconnected or fails mid-task: isolate the exact blocked step, complete all independent local work, switch to the closest safe fallback (user-supplied JD/URL/screenshot, `HTML`/Word-compatible `.doc`/`TXT` + browser `Print -> Save as PDF`, local JSON logging), and resume from the last valid checkpoint without repeating destructive actions or fabricating results.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** open Playwright MCP just to read a Markdown CV file (`context/cv.md`) or count rows in `logs/applications-log.json`.
- **NEVER** attempt Notion MCP calls when `storage_adapters.notion_mcp: false`.
- **NEVER** keep 10 full raw `browser_snapshot` trees verbatim in active conversation reasoning when summarizing past jobs.
- **Self-Verification Check:** Confirm pure local phases used zero MCP calls, Notion MCP was skipped when disabled, and any MCP error triggers clean routing (`fallback-no-mcp` or `meta-dom-recovery`) within the 3-error limit.

### High-Speed Model & Parallel Tooling Rules
1. **Parallel Local I/O:** Execute independent file reads, edits, and writes in parallel within the same turn instead of sequentially.
2. **Zero Redundant Context Reloads:** Never re-read unchanged `context/` files or skill bodies already verified in the active session; load only the 1–3 skills required for the current step.
3. **Smart Model Tiering:** When delegating routine browser scraping, list extraction, or repetitive form filling to a subagent, prefer fast low-latency models (e.g., Flash / Haiku / Mini) and reserve heavier reasoning models for CV tailoring, gap analysis, and complex debugging.

### High-Signal Token-Efficient Intelligence Rules
Maximize reasoning quality while cutting token burn by 40–70%:
1. **Prefer Compact Fact Sheet First:** Read `context/resume-facts.json` (~250 tokens) instead of full prose `cv.md` + `profile.md` during fast discovery, scoring, and form filling; load full `context/cv.md` only when writing tailored resumes or cover letters.
2. **Reuse `winning_answers` Bank:** Pull pre-verified, high-signal answers directly from `context/form-answers.yaml` (`winning_answers.*`) for recurring ATS prompts (AI workflow, hardest project, why remote, availability) instead of re-deriving them from scratch.
3. **Rubrics & 1-Shot Anchors Over Long Prose:** Score and evaluate with compact numeric rubrics and 1-shot examples to avoid "Lost in the Middle" degradation.
4. **Proactive Compaction:** Checkpoint progress every 3–5 applications (`skills/meta-context-compaction.md`) and suggest `/compact` on long sessions to keep model reasoning sharp.
