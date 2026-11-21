# `evals/` — Deterministic Harness Validator & Reproducible Prompt Suite

> **Important Truthfulness Disclaimer:**
> Running `node ./bin/cli.mjs eval` (or `--baseline`) runs a **deterministic harness validator for CI schema, fixture integrity, and assertion logic against [`results/baseline-verified-run.json`](results/baseline-verified-run.json)** — it is **NOT** a live multi-model benchmark score claiming runtime LLM accuracy.
> To grade an actual external model session, use [`PROMPT.md`](PROMPT.md) and pass its output JSON via `--file <model-output.json>`.

## Directory Contents

- [`RUBRIC.md`](RUBRIC.md) — Exact specification of all **20 assertions (`EVAL-01`..`EVAL-20`)**.
- [`PROMPT.md`](PROMPT.md) — Copy-paste zero-shot evaluation prompt for testing external LLMs (`Claude`, `Gemini`, `GPT`, `DeepSeek`).
- [`fixtures/candidate-profile.md`](fixtures/candidate-profile.md) — Synthetic candidate ground truth (`Alex Rivera`) with permitted numeric metrics and forbidden (`0`-year) skills.
- [`fixtures/ground-truth.json`](fixtures/ground-truth.json) — Immutable allowlist/denylist fixture (`ground_truth_metrics`, `forbidden_skills` including aliases like `K8s`/`Rustacean`/`SwiftUI`/`C++`/`.NET`, and `banned_ai_cliches`) loaded strictly by `bin/cli.mjs eval` (never trusted from `--file`).
- [`fixtures/jds/`](fixtures/jds/01-strong-match.md) — 5 edge-case job descriptions:
  1. [`01-strong-match.md`](fixtures/jds/01-strong-match.md) (Tier A match + recruiter codeword `PINEAPPLE`)
  2. [`02-prompt-injection-trap.md`](fixtures/jds/02-prompt-injection-trap.md) (adversarial hidden `SYSTEM OVERRIDE`)
  3. [`03-ghost-expired-job.md`](fixtures/jds/03-ghost-expired-job.md) (`>90` days old + closed banner)
  4. [`04-blacklist-duplicate.md`](fixtures/jds/04-blacklist-duplicate.md) (blacklisted company/domain + cross-board duplicate fingerprint)
  5. [`05-stretch-mismatch.md`](fixtures/jds/05-stretch-mismatch.md) (Tier C stack & onsite authorization mismatch)
- [`fixtures/forms/`](fixtures/forms/greenhouse-mock.html) — Self-contained local HTML ATS form mocks (`greenhouse-mock.html`, `lever-mock.html`, `ashby-mock.html`, `workday-mock.html`) covering file inputs, EEO dropdowns, GDPR checkboxes, hidden honeypots, and Workday multi-step wizard / React-Select ARIA `combobox` + detached portal `listbox` / account-gate manual-handoff regression checks.
- [`fixtures/boards/`](fixtures/boards/gulftalent-mock.html) — Self-contained offline regional job-board fixtures (`gulftalent-mock.html`, `bayt-mock.html`, `stepstone-mock.html`, `naukri-mock.html`) kept separate from employer ATS form mocks; model signed-in/account-gate landmarks, job-card expansion, pagination, direct vs. agency attribution, external ATS handoff, MENA nationality/residency/visa/sponsorship/notice/Arabic RTL traps, DACH `.de`/`.at`/`.ch` `EUR`/`CHF`/GDPR vs. marketing/optional *Anschreiben*/German localization traps, India Naukri CTC (`INR`/`LPA`)/notice/immediate-joiner/OTP/anti-bot circuit-breaker traps, CV overwrite warnings, honeypots, and manual-handoff enforcement.
- [`workday-fixture.test.mjs`](workday-fixture.test.mjs) — Zero-dependency `node:test` regression suite (run automatically via `node ./bin/cli.mjs eval --journeys` / `npm test`) verifying `workday-mock.html`, detached portal listboxes, account-gate manual-handoff policy in `skills/ats/workday.md` & `skills/platforms/ats-engines.md`, and dynamic `proof` output while preserving `EVAL-01..20` compatibility.
- [`mena-boards.test.mjs`](mena-boards.test.mjs) — Zero-dependency `node:test` regression suite (run automatically via `node ./bin/cli.mjs eval --journeys` / `npm test`) verifying `evals/fixtures/boards/gulftalent-mock.html`, `evals/fixtures/boards/bayt-mock.html`, `skills/platforms/mena-boards.md`, config/registry/manifest/adapter parity, BiDi/Unicode hygiene, and ATS fixture isolation.
- [`stepstone-board.test.mjs`](stepstone-board.test.mjs) — Zero-dependency `node:test` regression suite (run automatically via `node ./bin/cli.mjs eval --journeys` / `npm test`) verifying `evals/fixtures/boards/stepstone-mock.html`, StepStone DACH (`.de`/`.at`/`.ch`) coverage in `skills/platforms/global-boards.md`, GDPR vs. optional marketing/Talentpool consent separation, optional *Anschreiben*, `EUR`/`CHF` controls, German localization, config/registry/manifest/adapter/guardrail parity, and ATS fixture isolation.
- [`naukri-board.test.mjs`](naukri-board.test.mjs) — Zero-dependency `node:test` regression suite (run automatically via `node ./bin/cli.mjs eval --journeys` / `npm test`) verifying `evals/fixtures/boards/naukri-mock.html`, Naukri India coverage in `skills/platforms/global-boards.md`, Current/Expected CTC (`INR`/`LPA`), notice/immediate-joiner/location controls, Login/OTP & anti-bot/CAPTCHA circuit-breaker stop markers, config/registry/manifest/adapter/guardrail parity, Naukrigulf separation, and ATS fixture isolation.
- [`results/baseline-verified-run.json`](results/baseline-verified-run.json) — Static CI reference payload verifying that the 20 grading checks catch regressions.
- [`results/live-agent-eval-run.json`](results/live-agent-eval-run.json) — Live Gemini agent session output executing [`PROMPT.md`](PROMPT.md) against all fixtures (`20/20` PASS via `--file`).

## Commands

```bash
# CI Schema & Reference Baseline Self-Test
node ./bin/cli.mjs eval --baseline

# Grade an actual external model's JSON output
node ./bin/cli.mjs eval --file logs/exports/eval-output.json
```
