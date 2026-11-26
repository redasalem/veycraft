---
description: Run model-agnostic no-clone remote GitHub CLI operations (file edits via Contents/Git Data API, LICENSE/topics/visibility updates, PRs, issues, Actions workflows, and parameterized GraphQL queries) with fresh read-back verification
---

1. Read `AGENTS.md` and `skills/REGISTRY.md` first.
2. Follow `skills/54-github-cli-remote-manager.md` (`requires: [gh]`, `requires_mcp: [none]`) with `skills/14-privacy-pii-shield.md` and `skills/meta-self-verification.md`.
3. **Safety & Approval Gates:** Verify `gh auth status` without ever printing tokens or `.env` contents, preserve existing `README.md` custom styling/badges/icons verbatim on surgical text edits, require explicit owner approval before public/visibility mutations, never delete a repository without explicit per-repo typed `DELETE <owner>/<repo>` confirmation, and verify every mutation via fresh `gh` read-back.
