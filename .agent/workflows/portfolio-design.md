---
description: Author a pre-code portfolio DESIGN_PLAN.md and separated data layer, lock a WCAG 2.1 AA Anti-AI-Slop design system (7 curated palettes or Custom hex, LTR/Arabic RTL typography, tokens.css), run 3-layer automated testing (node --test or isolated Vitest + 375px/768px/1440px QA), and execute a bounded 3-cycle self-healing loop inside logs/portfolio/<site-slug>/.
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/30-portfolio-design-system-and-qa.md` (`v1.0.0`, `requires_mcp: none`, optional `playwright`) with `skills/28-recruiter-brand-and-domain-intelligence.md`, `skills/03-tailor-resume-and-verify.md`, `skills/15-multilingual-adaptation.md`, `skills/14-privacy-pii-shield.md`, and `skills/meta-self-verification.md`.
3. **Blueprint, Token Lock & Bounded Self-Healing:** Lock `<portfolio-dir>/DESIGN_PLAN.md`, separated `portfolio-data`, `design-tokens.json`, and `tokens.css` before writing UI components (`0` hardcoded hex colors or prose, `>= 4.5:1` / `>= 3.0:1` WCAG AA contrast, real Arabic webfonts + logical CSS if bilingual/RTL), keep all dependencies strictly inside `<portfolio-dir>` (`0/0` root `package.json`), run all 3 QA layers (`375px`/`768px`/`1440px`) writing `qa-report.md`, and cap Self-Healing strictly at `3` cycles before user preview or deployment.
