# Veycraft MCP Guide — Native Zero-Dependency Server & Optional External Adapters

## 1. Native Zero-Dependency Veycraft MCP Server (`npx -y veycraft mcp`)

Veycraft ships a built-in, zero-dependency **Model Context Protocol (`stdio`) server** ([`../bin/mcp-server.mjs`](../bin/mcp-server.mjs)) powered by Node.js (`>= 18`) built-in modules only. Any MCP-compatible AI desktop app, coding IDE, or CLI agent can call Veycraft's deterministic safety gates, skill router, CV hygiene auditor, artifact verifier, and local ledger summary directly over `stdio`.

### Quick Client Configuration (`mcpServers`)

```json
{
  "mcpServers": {
    "veycraft": {
      "command": "npx",
      "args": ["-y", "veycraft", "mcp"]
    }
  }
}
```

- **Windows desktop/IDE clients (`cmd /c` wrapper):** Where an MCP host on Windows does not resolve `npx.cmd` directly, use `"command": "cmd", "args": ["/c", "npx", "-y", "veycraft", "mcp"]` (or point straight to a local clone: `"command": "node", "args": ["C:/path/to/veycraft/bin/cli.mjs", "mcp"]`).
- **Workspace / home resolution:** Uses the current working directory (or `VEYCRAFT_HOME` / `veycraft mcp --global` for `~/.veycraft`).

### Exposed Read-Only Offline Tools (8)

All 8 tools advertise `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`, with `additionalProperties: false` input schemas:

| Tool | Purpose |
|---|---|
| `veycraft_doctor` | Inspect local workspace readiness, provenance, skill count, and URL syntax/SSRF hygiene strictly offline (`offline_mode: true`, zero hook writes, zero `fetch()` calls). |
| `veycraft_route` | Route a natural-language career request to the minimal Veycraft skill set, readiness rule, required inputs, and offline fallback. |
| `veycraft_audit` | Run heuristic CV hygiene scoring (`0–100`) on an in-workspace `.md`/`.txt`/`.html`/`.doc`/`.docx` CV (clichés, em-dashes, metrics, page fit, placeholders, SSRF/tokens) without writing `--share` files. |
| `veycraft_verify` | Verify tailored artifacts or workspace JSON files against unresolved `{{...}}` placeholders, banned AI clichés, and optional `facts_path` ground truth. |
| `veycraft_pre_submit` | Evaluate deterministic pre-submit guardrails (`dry_run`, daily/platform/warm-up caps, circuit breaker, blacklist, deduplication, and `<= 75`-word draft checks). |
| `veycraft_career_summary` | Read local `v2` application funnel counts and optional offline period analytics (`"all"`, `"YYYY-Www"`, `"YYYY-MM"`) with `MIN_N = 5` guardrails. |
| `veycraft_career_next` | Compute deterministic prioritized next-step actions across active runs, `needs_review` items, 7-day follow-ups, and setup blockers. |
| `veycraft_get_skill` | Read the Markdown playbook for an exact skill registered in [`../skills/skills-manifest.json`](../skills/skills-manifest.json). |

### Allowlisted `veycraft://` Resources (Zero PII)

| URI / Template | MIME Type | Source |
|---|---|---|
| `veycraft://manifest` | `application/json` | [`../skills/skills-manifest.json`](../skills/skills-manifest.json) |
| `veycraft://registry` | `text/markdown` | [`../skills/REGISTRY.md`](../skills/REGISTRY.md) |
| `veycraft://invariants` | `text/plain` | [`../config/invariants.txt`](../config/invariants.txt) |
| `veycraft://skill/{name}` | `text/markdown` | Exact skill playbook resolved via `skills-manifest.json` |

> **Offline & Privacy Guarantees:** `veycraft mcp` makes **zero outbound network calls**, performs **zero silent submissions or file mutations**, never exposes `context/`, `logs/`, `.env`, or `browser-profile/` as MCP resources, refuses symlinks/UNC/ADS/`..` traversal, and strictly preserves `dry_run: true` and unconditional human `APPROVE` boundaries.

---

## 2. Optional External MCP Tools (Playwright & Notion)

Fast-start CV tailoring workflows (`/demo` and `/quick-tailor`) and offline CLI tools (`audit`, `proof`, `eval`, `pre-submit`, `mcp`) work without any external MCP server. When you are ready for browser-assisted discovery, PDF export, or Notion sync, the canonical external MCP definition is [`mcp/mcp.template.json`](mcp.template.json) (synced automatically via `veycraft sync-mcp`; see also [`claude_desktop_config.example.json`](claude_desktop_config.example.json)). Paste it into your IDE's MCP configuration with `./browser-profile` pointing to your local clone (or agent folder):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@0.0.86", "--caps=pdf", "--user-data-dir=./browser-profile"]
    },
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server@2.6.1"],
      "env": {
        "NOTION_TOKEN": "${NOTION_TOKEN}"
      }
    }
  }
}
```

- **Playwright MCP (optional, required only for browser workflows):** Launches Chromium with persistent `./browser-profile` so you log in manually once and keep sessions private on disk. Never commit `browser-profile/`.
- **Notion MCP (optional):** Off by default (`storage_adapters.notion_mcp: false` in `config/guardrails.yaml`). If you want Notion tracking, set `NOTION_TOKEN` in your IDE's secret/env config, share a parent page with your Notion integration, and record your database IDs in `context/preferences.yaml`. Local JSON under `logs/` is always primary.

## Manual login once
1. Open your project folder in your AI IDE and ask `/setup` to open your chosen boards in headed Playwright MCP.
2. Enter passwords and complete any 2FA/CAPTCHA privately in the browser window—never share credentials in chat.
3. Confirm in chat once signed in; the agent snapshots an account indicator and proceeds without storing cookies or passwords.
