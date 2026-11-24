# 25+ Supported AI Apps, Harnesses & Models Compatibility Guide

Every major AI IDE, CLI harness, desktop client, and LLM family works out of the box against [`AGENTS.md`](../AGENTS.md), [`skills/REGISTRY.md`](../skills/REGISTRY.md), and [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md).

---

## 1. Native AI Apps, IDEs & CLI Harnesses (25+)

| Client / Harness | Type | Native Entrypoint | Auto-Discovery / MCP Guide |
|---|---|---|---|
| **Antigravity** | AI IDE | [`AGENTS.md`](../AGENTS.md) + [`.agent/workflows/`](../.agent/workflows/daily-run.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Google Gemini CLI** | Terminal CLI | [`GEMINI.md`](../GEMINI.md) + `~/.gemini/GEMINI.md` | [`adapters/apps/gemini-and-copilot.md`](../adapters/apps/gemini-and-copilot.md) (`settings.json`) |
| **Claude Code** | Terminal CLI | [`CLAUDE.md`](../CLAUDE.md) + [`commands/`](../commands/daily-run.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Claude Desktop** | Desktop App | [`CLAUDE.md`](../CLAUDE.md) | [`mcp/claude_desktop_config.example.json`](../mcp/claude_desktop_config.example.json) |
| **OpenAI Codex CLI** | Terminal CLI | [`AGENTS.md`](../AGENTS.md) + `$CODEX_HOME/AGENTS.md` + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`adapters/apps/openai-codex-cli.md`](../adapters/apps/openai-codex-cli.md) (`config.toml`) |
| **ChatGPT / Claude / Gemini Web** | Desktop / Web Chat | [`adapters/apps/chatgpt-and-web-chats.md`](../adapters/apps/chatgpt-and-web-chats.md) | [`skills/fallback-no-mcp.md`](../skills/fallback-no-mcp.md) |
| **Cursor** | AI IDE | [`.cursor/rules/job-hunter.mdc`](../.cursor/rules/job-hunter.mdc) + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Devin Desktop / Windsurf** | AI IDE | [`.windsurfrules`](../.windsurfrules) + [`adapters/apps/devin-desktop.md`](../adapters/apps/devin-desktop.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **OpenCode v2** | Terminal CLI | [`opencode.json`](../opencode.json) + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`adapters/apps/opencode-and-kilocode.md`](../adapters/apps/opencode-and-kilocode.md) |
| **Kilo Code** | IDE Agent | [`AGENTS.md`](../AGENTS.md) + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`adapters/apps/opencode-and-kilocode.md`](../adapters/apps/opencode-and-kilocode.md) |
| **JetBrains Junie & AI Assistant** | JetBrains IDEs | [`.junie/guidelines.md`](../.junie/guidelines.md) + [`.aiassistant/rules/AGENTS.md`](../.aiassistant/rules/AGENTS.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **AWS Kiro & Amazon Q CLI** | IDE / CLI | [`.kiro/steering/job-hunter.md`](../.kiro/steering/job-hunter.md) + [`.amazonq/rules/job-hunter.md`](../.amazonq/rules/job-hunter.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Trae** | AI IDE | [`.trae/rules/project_rules.md`](../.trae/rules/project_rules.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Zed** | Code Editor AI | [`.rules`](../.rules) + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **GitHub Copilot & VS Code** | IDE / CLI | [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) + [`.github/prompts/daily-run.prompt.md`](../.github/prompts/daily-run.prompt.md) | [`adapters/apps/gemini-and-copilot.md`](../adapters/apps/gemini-and-copilot.md) (`.vscode/mcp.json`) |
| **Cline & Roo Code** | VS Code Agents | [`.clinerules`](../.clinerules) + [`.roo/rules/job-hunter.md`](../.roo/rules/job-hunter.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Block Goose & Amp** | Terminal Agents | [`.goosehints`](../.goosehints) + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Aider** | Terminal CLI | [`.aider.conf.yml`](../.aider.conf.yml) (`read: [AGENTS.md, skills/REGISTRY.md]`) | Text / file edits |
| **Continue.dev** | IDE Agent | [`.continue/rules/job-hunter.md`](../.continue/rules/job-hunter.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **OpenHands** | Autonomous Agent | [`.openhands/microagents/repo.md`](../.openhands/microagents/repo.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Warp Terminal Agent** | Terminal AI | [`WARP.md`](../WARP.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Augment Code & Charm Crush** | IDE / CLI | [`.augment/rules/job-hunter.md`](../.augment/rules/job-hunter.md) + [`CRUSH.md`](../CRUSH.md) | [`mcp/mcp.template.json`](../mcp/mcp.template.json) |
| **Qwen Code / Mistral Vibe 3 / Kimi / DeepSeek / Grok Build** | Frontier Harnesses | `AGENTS.md` + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`adapters/apps/qwen-mistral-kimi-deepseek.md`](../adapters/apps/qwen-mistral-kimi-deepseek.md) |
| **Hermes / Pi / Factory Droid / OpenClaw** | Loop & CLI Agents | `AGENTS.md` + [`.agents/skills/`](../.agents/skills/daily-run/SKILL.md) | [`adapters/apps/hermes-pi-factory-openclaw.md`](../adapters/apps/hermes-pi-factory-openclaw.md) |

### Native MCP Server (`npx -y veycraft mcp`)

In addition to reading `AGENTS.md` and `.agents/skills/`, any MCP client can attach Veycraft's built-in, zero-dependency `stdio` server (8 read-only offline tools + allowlisted `veycraft://` resources — full reference in [`mcp/README.md`](../mcp/README.md)):

- **Claude Desktop / Cursor / Windsurf / Antigravity / Gemini CLI (`mcpServers` JSON):** Add `"veycraft": { "command": "npx", "args": ["-y", "veycraft", "mcp"] }` to `claude_desktop_config.json`, `.cursor/mcp.json`, `mcp_config.json`, or `~/.gemini/settings.json` (on Windows, use `"command": "cmd", "args": ["/c", "npx", "-y", "veycraft", "mcp"]` if required by the host).
- **Claude Code CLI:** `claude mcp add veycraft -- npx -y veycraft mcp`
- **VS Code / GitHub Copilot (`.vscode/mcp.json`):** Add `"veycraft": { "type": "stdio", "command": "npx", "args": ["-y", "veycraft", "mcp"] }` under `"servers"`.
- **OpenAI Codex CLI (`~/.codex/config.toml` or `.codex/config.toml`):**
  ```toml
  [mcp_servers.veycraft]
  command = "npx"
  args = ["-y", "veycraft", "mcp"]
  ```

---

## 2. Model-Specific Execution Tuning Guides (`adapters/models/`)

| Model Family | Tuning Guide | Key Optimization |
|---|---|---|
| **Anthropic Claude** (Sonnet / Opus) | [`adapters/models/claude.md`](../adapters/models/claude.md) | Strict YAML skill routing + XML `<pre_submit_check>` scratchpad |
| **Google Gemini** (Pro / Flash) | [`adapters/models/gemini.md`](../adapters/models/gemini.md) | Multimodal screenshot cross-check + native PDF inspection |
| **OpenAI** (GPT / o-series / Codex) | [`adapters/models/openai.md`](../adapters/models/openai.md) | Deterministic JSON/YAML log contracts + sequential paced actions |
| **xAI Grok & Moonshot Kimi** (K2 / Thinking) | [`adapters/models/grok-and-kimi.md`](../adapters/models/grok-and-kimi.md) | Long-context multi-tab ATS comparison + strict evidence mapping |
| **Mistral** (Large / Codestral / Vibe) & **Meta Llama 4** | [`adapters/models/mistral-and-llama.md`](../adapters/models/mistral-and-llama.md) | Strict JSON log extraction + single-step snapshot verification |
| **DeepSeek / Qwen / Local Ollama** | [`adapters/models/deepseek-qwen-local.md`](../adapters/models/deepseek-qwen-local.md) | Ultra-lean 3-file context budget + explicit `ref` ID quoting |

---

## 3. Manual Copy Installation (Optional Zero-CLI Fallback)

**macOS / Linux / Git Bash:**
```bash
# Antigravity global workflows + skills
mkdir -p ~/.antigravity/workflows ~/.antigravity/skills
cp -r .agent/workflows/* ~/.antigravity/workflows/
cp -r skills/* ~/.antigravity/skills/

# Claude Code global commands + skills
mkdir -p ~/.claude/commands ~/.claude/skills
cp -r commands/* ~/.claude/commands/
cp -r .agents/skills/* ~/.claude/skills/

# Cursor global rules
mkdir -p ~/.cursor/rules
cp .cursor/rules/job-hunter.mdc ~/.cursor/rules/
```

**Windows (CMD / PowerShell):**
```powershell
xcopy /E /I /Y .agent\workflows %USERPROFILE%\.antigravity\workflows
xcopy /E /I /Y skills %USERPROFILE%\.antigravity\skills
xcopy /E /I /Y commands %USERPROFILE%\.claude\commands
xcopy /E /I /Y .agents\skills %USERPROFILE%\.claude\skills
mkdir %USERPROFILE%\.cursor\rules 2>nul
copy /Y .cursor\rules\job-hunter.mdc %USERPROFILE%\.cursor\rules\job-hunter.mdc
```
