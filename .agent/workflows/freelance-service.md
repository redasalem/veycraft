---
description: Audit a freelance marketplace profile, craft a grounded SEO gig/service listing with custom cover image, fill platform fields cleanly via low-token browser fast-path, and pause before final publishing until explicit APPROVE PUBLISH
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/55-freelance-profile-and-service-publisher.md` (`requires_mcp: none`, optional `playwright`) with `skills/14-privacy-pii-shield.md`, `skills/18-condition-based-browser-waiting.md`, `skills/24-circuit-breaker-and-antiban.md`, and `skills/meta-self-verification.md`.
3. **Low-Token Fast-Path & Safety Gates:** Run `veycraft brief --json` first for grounded facts (`context/brief.json`), use `veycraft browser-script distill-form --json` + `batch-fill --json` (passing `fieldMap` as a separate serialized argument; never clicking Publish/Save inside the script), pause for manual login/OAuth/2FA if signed out, display the **Live DOM Read-Back Table**, and never click Publish/Save without explicit fresh owner **`APPROVE PUBLISH`** (and `dry_run: false`) followed by a post-publish `browser_snapshot` verification.
