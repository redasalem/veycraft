---
description: Design, build, preview locally inside isolated logs/portfolio/<site-slug>/, and optionally deploy a personalized domain-adaptive portfolio website via Vercel, Cloudflare Pages, Netlify, dedicated-repo GitHub Pages, Firebase, Surge, or Smart Fallback (LOCAL_PREVIEW_ONLY default; APPROVE + HTTP 200 verification for live deploy)
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/29-portfolio-builder-and-deployer.md` (`v1.0.0`, `requires_mcp: none`, optional `playwright`) with `skills/01-resume-ingestion.md`, `skills/03-tailor-resume-and-verify.md`, `skills/11-portfolio-and-github-auditor.md`, `skills/14-privacy-pii-shield.md`, `skills/28-recruiter-brand-and-domain-intelligence.md`, and `skills/meta-self-verification.md`.
3. **Isolation, Privacy & Deploy Gates:** Keep all files and sub-project dependencies isolated inside `logs/portfolio/<site-slug>/` (or `logs/portfolio/third-party-<slug>/` / external folder; never modify root `package.json` or push to `redasalem/veycraft`), run the Phase 4 PII/secret scan, verify local build and preview first (`LOCAL_PREVIEW_ONLY`), present the **Deploy Confirmation Table** and wait for explicit `APPROVE` before running any live hosting CLI, and verify HTTP `200` on the live `https://` URL before reporting deployed.
