---
description: Tailor an ATS resume for one job URL or pasted JD with fact-check and humanizer guards (never applies)
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. **Inspect JD with practical fallback:** If a URL is supplied and Playwright MCP is connected, inspect it read-only; if Playwright MCP is unavailable or the URL hits a login wall, ask the owner to paste the job description text and proceed immediately without blocking.
3. **Ensure verified CV facts exist (ask instead of refusing):** Load `context/profile.md`, `context/cv.md`, and `context/resume-data.json`. If missing or still `.example` placeholders, ask the owner to share or paste their CV right in chat (`skills/01-resume-ingestion.md`), confirm extracted facts, and continue tailoring immediately.
4. Run `skills/03-tailor-resume-and-verify.md` and `skills/21-ats-keyword-heatmap.md` (Anti-Hallucination Fact-Check Guard, Anti-AI Slop filter, Evidence Map, and **True Gaps**), save role-named deliverables `<Candidate-Name>-<Target-Role>.html`, `.doc`, `.txt`, auto-generated `<Candidate-Name>-<Target-Role>.pdf` (rendered via local Chrome/Edge Headless `--headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=...` or Playwright PDF), and `tailoring-notes.md` under `logs/resumes/<company>-<role>-<job-id>/`, and create `interview-dossier.md` (`skills/05-outreach-and-interview-prep.md`). Accept owner revisions (`EDIT ...`), re-verify facts, and never click Apply or Submit.
