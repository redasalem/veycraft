---
name: github-cli-remote-manager
description: Load when any AI coding agent needs to inspect, edit files, configure metadata/topics/licenses/visibility, or manage PRs, issues, and Actions workflows remotely on GitHub via gh CLI and REST/GraphQL APIs without cloning (/github-remote).
---

# GitHub CLI Remote Manager (No-Clone Workflow)

1. Read `AGENTS.md` and `skills/REGISTRY.md` first (Progressive Disclosure).
2. Follow `skills/54-github-cli-remote-manager.md` for deterministic `gh` CLI, REST Contents/Git Data API, repo edit, Actions, and GraphQL workflows without local `git clone`.
3. Enforce `skills/14-privacy-pii-shield.md` (zero token/secret prints; pre-public secret path scan) and `skills/meta-self-verification.md` (fresh `gh` read-back after every write; never delete repos without per-repo `DELETE <owner>/<repo>` confirmation).
