---
name: github-cli-remote-manager
version: "1.0.0"
description: Load when any AI agent needs to inspect, audit, edit files, configure metadata/topics/licenses/visibility, or run PR/issue/CI/GraphQL workflows on GitHub repositories remotely via gh CLI and REST/GraphQL APIs without cloning locally (/github-remote).
triggers:
  - /github-remote
  - edit or manage remote GitHub files without cloning
  - commit or update LICENSE or config files via gh api
  - manage remote GitHub PRs, issues, workflows, visibility, or topics via gh CLI
requires_mcp:
  - none
requires:
  - gh
tags:
  - github
  - gh-cli
  - remote-git
  - no-clone
  - cross-agent
preconditions:
  - authenticated gh CLI session (`gh auth status`) with required scopes (`repo`, plus `workflow` or `user` only when updating Actions or `/user`)
  - target `<owner>/<repo>` explicitly identified and verified before any write operation
requires_skills:
  - privacy-pii-shield
  - meta-self-verification
verification:
  - zero tokens, cookies, or `.env` secrets were read aloud or printed in logs/output
  - any `README.md` edit preserved existing HTML/Markdown layout, colors, badges, and icons verbatim with surgical diff verification
  - zero repositories were deleted without explicit per-repo typed `DELETE <owner>/<repo>` confirmation, and all public/visibility mutations received explicit user approval
  - every write was confirmed via fresh remote `gh repo view`, `gh api`, or `gh pr/run` read-back without modifying unrelated local workspaces
---
# Universal No-Clone GitHub CLI Remote Manager

## When to Use & Preconditions

Use this model-agnostic playbook whenever an agent (Claude Code, Gemini CLI, OpenAI Codex CLI, Cursor, Windsurf, GitHub Copilot, Cline, or Antigravity) needs to inspect, configure, or commit updates to GitHub repositories cleanly over `gh` CLI and the GitHub REST/GraphQL APIs **without running slow or stall-prone local `git clone` commands**, keeping unrelated local workspaces 100% clean.

- **Load when:** `/github-remote`; updating remote files (`LICENSE`, configs, CI workflows, surgical `README.md` text) without cloning; managing repository visibility, topics, PRs, issues, or GitHub Actions runs via `gh` CLI.
- **Career/CV Audits Note:** For recruiter README marketing copy, CV project extraction (`context/github-projects.md`), and live portfolio link audits, pair with `skills/11-portfolio-and-github-auditor.md` (`/github-audit`).
- **Preconditions (stop if any is false):**
  - `gh auth status` succeeds with required token scope (`repo`; prompt the user to run `gh auth login` or `gh auth refresh -h github.com -s <scope>` directly if missing).
  - Target `<owner>/<repo>` and desired action are confirmed.
- **Requires skills:** `privacy-pii-shield`, `meta-self-verification`. **External CLI:** `gh` (`requires_mcp: none`).

## Deterministic Step-by-Step Execution

### 1. Pre-Flight Auth & Zero-Clone Inspection
- Verify authentication and active scopes without exposing secrets:
  ```bash
  gh auth status
  ```
  **NEVER** run `gh auth token` and **NEVER** print `.env`, tokens, or private keys (`skills/14-privacy-pii-shield.md`).
- Inspect repository inventory, metadata, licenses, or timestamps without cloning:
  ```bash
  gh repo list <owner> --limit 200 --json name,visibility,isArchived,isFork,licenseInfo,pushedAt,repositoryTopics,defaultBranchRef
  ```
- Inspect full remote file trees or decode specific text files (such as `package.json`, `.github/workflows/*.yml`, or source configs) cleanly via REST API:
  ```bash
  # List repository file paths at HEAD (add ?recursive=1 for full tree)
  gh api "repos/<owner>/<repo>/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.type=="blob") | .path'

  # Read and decode a file without cloning
  gh api "repos/<owner>/<repo>/contents/<path>" --jq '.content' | node -e "const fs=require('fs'); console.log(Buffer.from(fs.readFileSync(0,'utf8'),'base64').toString('utf8'));"
  ```
- Before making any repo public, scan tree paths for accidentally committed secrets (`.env`, `.env.local`, `.claude/settings.local.json`, `*.pem`, `*secret*.json`). Stop and alert the owner if any sensitive path is found.

### 2. Remote Single-File Create/Update (Contents API)
- Always fetch existing `sha` before updating an existing file (omit `sha` only when creating a brand-new file such as `LICENSE`):
  ```bash
  # 1) Resolve default branch and existing blob SHA (empty if file does not exist)
  BRANCH=$(gh repo view <owner>/<repo> --json defaultBranchRef --jq '.defaultBranchRef.name')
  SHA=$(gh api "repos/<owner>/<repo>/contents/<path>?ref=$BRANCH" --jq '.sha' 2>/dev/null || true)
  ```
- Pass Base64 content cleanly (avoiding shell multiline/quote corruption across PowerShell, CMD, and Bash) by writing a temporary JSON payload file or using Node `execFileSync('gh', ...)` with `--input <tmp.json>`:
  ```json
  {
    "message": "chore: add repository file",
    "content": "<base64-encoded-utf8>",
    "branch": "main",
    "sha": "<existing-sha-if-updating>"
  }
  ```
  ```bash
  gh api -X PUT "repos/<owner>/<repo>/contents/<path>" --input payload.json --jq '.commit.sha'
  ```
- **Strict `README.md` Styling Preservation Rule:** When editing `README.md`, inspect the exact existing layout, badges, HTML blocks, colors, and custom icons first, and apply **only surgical word or URL updates in-place** unless the owner explicitly requests a redesign.

### 3. Atomic Multi-File Commits Without `git clone` (Git Data API)
When updating multiple files in one commit (or when `git clone` stalls on large binary histories), commit atomically via Git Data API:
1. `GET repos/<owner>/<repo>/git/ref/heads/<branch>` -> `headSha` (`object.sha`).
2. `GET repos/<owner>/<repo>/git/commits/<headSha>` -> `baseTree` (`tree.sha`).
3. For each changed file, `POST repos/<owner>/<repo>/git/blobs` with `{"content":"<base64>","encoding":"base64"}` -> `blobSha`.
4. `POST repos/<owner>/<repo>/git/trees` with `{"base_tree":"<baseTree>","tree":[{"path":"...","mode":"100644","type":"blob","sha":"<blobSha>"}]}` -> `newTreeSha`.
5. `POST repos/<owner>/<repo>/git/commits` with `{"message":"...","tree":"<newTreeSha>","parents":["<headSha>"]}` -> `newCommitSha`.
6. `PATCH repos/<owner>/<repo>/git/refs/heads/<branch>` with `{"sha":"<newCommitSha>","force":false}`.

*(Note: Adding `LICENSE` or committing via API updates `pushedAt`. If chronological ordering across repos matters, either avoid unnecessary commits or sync commits intentionally in chronological order from oldest to newest.)*

### 4. Remote Metadata, SEO Topics, Wiki & Visibility Control
- Update description, homepage, topics (up to `20`), and disable unused wikis remotely:
  ```bash
  gh repo edit <owner>/<repo> \
    --description "<concise technical summary <= 160 chars>" \
    --homepage "<https://live-demo-url>" \
    --enable-wiki=false \
    --add-topic topic-1 --add-topic topic-2 --add-topic topic-3
  ```
- Toggle visibility (`private` or `public`) **only after explicit user confirmation** on exact repo names:
  ```bash
  # Standard CLI flag (works for most repos)
  gh repo edit <owner>/<repo> --visibility private --accept-visibility-change-consequences

  # Reliable REST fallback (especially for starred repos or names starting with "-")
  gh api -X PATCH "repos/<owner>/<repo>" -F private=true --jq '{name, private, visibility}'
  ```
- Prefer `private` or `gh repo archive <owner>/<repo> --yes` before deletion; **never** run `gh repo delete` without per-repo typed `DELETE <owner>/<repo>` confirmation.

### 5. Remote PRs, Issues, Workflows & GraphQL Operations
- **Pull Requests & Issues:**
  ```bash
  gh pr list --repo <owner>/<repo> --state open --json number,title,headRefName,url
  gh pr create --repo <owner>/<repo> --base main --head <branch> --title "<title>" --body "<summary>"
  gh issue list --repo <owner>/<repo> --state open --json number,title,labels,url
  ```
- **GitHub Actions Workflows:**
  ```bash
  gh workflow list --repo <owner>/<repo>
  gh workflow run <workflow.yml> --repo <owner>/<repo> --ref main
  gh run list --repo <owner>/<repo> --limit 5 --json databaseId,workflowName,status,conclusion,headSha
  ```
- **GraphQL Queries:** Use `gh api graphql` with variable bindings rather than raw inline string interpolation so quotes never break across shells:
  ```bash
  gh api graphql -f query='query($login:String!){ user(login:$login){ pinnedItems(first:6, types:REPOSITORY){ nodes{ ... on Repository { name } } } } }' -F login=<owner>
  ```

### 6. Mandatory Read-Back Verification
After every write, re-query GitHub directly (`gh repo view`, `gh api repos/<owner>/<repo>/contents/<path>`, `gh run list`, or `gh pr view`) and report exact verified commit SHAs, counts, and read-back states (`skills/meta-self-verification.md`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** delete a repository, batch-flip private repos to `public` without scanning for committed secrets/`.env`, or mutate visibility without explicit owner confirmation.
- **NEVER** overwrite `README.md` custom styling/icons/badges or `git push --force` without explicit owner authorization.
- **NEVER** print `gh auth token`, API keys, `.env` contents, or write `.vercel` / temp clones inside tracked local repositories.
- **Self-Verification Check:** Confirm zero leaked secrets, exact `gh` read-back verification after every mutation, clean `git status` in local repos, and concise summary of changed SHAs/settings.
