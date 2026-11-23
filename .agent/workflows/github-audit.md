---
description: Run a full gh-CLI GitHub account audit, recruiter marketing polish (descriptions/topics/READMEs/profile README), tiered safe repo cleanup (private/archive first; per-repo typed DELETE confirmation), and verified CV project extraction into context/github-projects.md
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/11-portfolio-and-github-auditor.md` (`v2.0.0`, `requires_mcp: none`, optional `playwright`) with `skills/28-recruiter-brand-and-domain-intelligence.md`, `skills/03-tailor-resume-and-verify.md`, `skills/14-privacy-pii-shield.md`, `skills/25-prompt-injection-defense.md`, and `skills/meta-self-verification.md`.
3. **Safety & Approval Gates:** Verify `gh auth status` without printing tokens, isolate third-party GitHub audits from owner `context/`, keep unobservable impact metrics under `requires_user_confirmation`, default all mutations to `DRAFT_ONLY` (`APPROVE` + fresh `gh` read-back required), recommend `private` or `archive` before deletion, and require a Blast-Radius Warning plus per-repo exact typed `DELETE <owner>/<repo>` before any `gh repo delete`.
