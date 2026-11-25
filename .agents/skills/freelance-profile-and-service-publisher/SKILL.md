---
name: freelance-profile-and-service-publisher
description: Load when auditing/updating a freelance marketplace profile or publishing an SEO-optimized freelance service/gig listing with a custom cover image via Playwright MCP/browser automation and strict APPROVE PUBLISH gating (/freelance-service).
---

# Freelance Profile & Service Publisher

1. Read `AGENTS.md` and `skills/REGISTRY.md` first (Progressive Disclosure).
2. Follow `skills/55-freelance-profile-and-service-publisher.md` to ground service copy in verified `context/cv.md` & `context/github-projects.md`, generate a custom cover image, fill platform fields cleanly (`skills/18-condition-based-browser-waiting.md`, `skills/24-circuit-breaker-and-antiban.md`), and present the Live DOM Read-Back Table before any Publish/Save action.
3. Enforce `skills/14-privacy-pii-shield.md` and `skills/meta-self-verification.md`: pause for manual login/OAuth/2FA if signed out, never click Publish/Save without explicit fresh `APPROVE PUBLISH` (and `dry_run: false`), and verify persisted status via fresh `browser_snapshot`.
