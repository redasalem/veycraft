---
name: score-calibration
version: "1.0.0"
description: Load when checking whether the 1-10 match score accurately predicts real recruiter callbacks, comparing scored bands against interview/offer outcomes in logs/applications-log.json and recalibrating scoring weights or min_match_score in context/preferences.yaml with explicit owner approval.
triggers:
  - calibrate match scoring
  - check if match scores predict interviews
  - recalibrate scoring weights
  - score calibration report
requires_mcp:
  - none
preconditions:
  - logs/applications-log.json is readable and contains recorded match scores alongside decided or >=14-day outcomes
  - context/preferences.yaml is readable for current min_match_score and weighting rules
requires_skills:
  - discover-and-triage
  - rejection-pattern-analyzer
  - log-and-insights
verification:
  - pending in-flight applications (< 14 days old with no reply) are excluded from outcome rates and reported separately as in_flight_count
  - score-band table shows exact counts per band and marks bands below n = 5 as (n too small)
  - verdict (separating, flat, inverted, or insufficient) and any proposed weight/threshold recalibration are confirmed by the owner before editing context/preferences.yaml
---
# Score Calibration & Weight Tuner (Adapted from `career-ops` `calibrate`)

## When to Use & Preconditions

Closes the feedback loop between initial `1–10` AI job scores (`skills/02-discover-and-triage.md`) and real-world callbacks so `min_match_score` and rubric weights reflect actual hiring signal.

- **Load when:** `calibrate match scoring`; `check if match scores predict interviews`; `recalibrate scoring weights`; `score calibration report`.
- **Preconditions (stop if any is false):**
  - `logs/applications-log.json` is readable and contains decided outcomes (or `applied >= 14 days`) with numeric `match_score`.
  - `context/preferences.yaml` is readable.
- **Requires skills:** `discover-and-triage`, `rejection-pattern-analyzer`, `log-and-insights`. **MCP:** none.

## Deterministic Step-by-Step Execution

1. **Partition Decided vs. In-Flight Entries (`MIN_N = 5`):**
   - Read `logs/applications-log.json` directly (pure local read—or `veycraft career analytics --json`—zero MCP).
   - Separate `in_flight` rows (`status == "applied"` with age `< 14 days`), `silent_14d` rows (`status == "applied"` with age `>= 14 days`, tracked separately—never mislabeled as confirmed `rejected`), and confirmed `decided` outcomes (`interview`, `assessment`, `offer`, `rejected`). Exclude `dry_run`, `skipped`, `aborted`, and isolated third-party subjects.
   - If `decided` (or `decided + silent_14d` when explicitly requested by owner) count `< 5`, classify verdict immediately as **`insufficient`** (`N/5 decided outcomes logged`), print how many are `in_flight` and `silent_14d`, and stop cleanly without guessing weights.
2. **Build Score-Band Yield Table:**
   - Group `decided` rows into 4 score bands: `9.0–10.0`, `8.0–8.9`, `7.0–7.9`, and `< 7.0`.
   - For each band report: `n`, `callbacks` (`interview` / `assessment` / `offer`), `offers`, and exact percentage **only** when `n >= 5` (otherwise print `(n too small)`).
3. **Assign Calibration Verdict:**
   - **`separating`:** Higher score bands (`>= 8.0`) convert noticeably higher than `7.0–7.9` or `< 7.0` — rubric works well.
   - **`flat`:** Callback rate is virtually identical across `7.0–7.9` and `8.0–10.0` — rubric over-weights secondary keywords.
   - **`inverted`:** Lower-scored roles (`7.0–7.9`) outperform `8.0–10.0` — inspect high-score rejections using `skills/16-rejection-pattern-analyzer.md` to uncover hidden dealbreakers (e.g., over-strict title matching or hidden domain mismatch).
   - **`insufficient`:** Fewer than 5 decided rows or concentrated in a single band.
4. **Compute & Propose Weight Recalibration:**
   - Compare callback predictors vs. non-predictors across decided rows (e.g., core stack overlap vs. seniority match vs. remote/timezone alignment vs. domain match).
   - Draft explicit proposed updates to `context/preferences.yaml` (`min_match_score` and explicit `scoring_weights:` overrides such as reducing domain weight and boosting core-stack/recency weight).
5. **Confirm Before Saving:**
   - Display the Calibration Table, Verdict, In-Flight Excluded Count, and exact proposed `context/preferences.yaml` diff. Apply changes only after explicit owner confirmation (`approve` / `yes`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** treat 2-of-3 outcomes as a statistical rule — always label `n < 5` bands as `(n too small)`.
- **NEVER** include `< 14 day` pending `applied` rows in callback-rate denominators without labeling them excluded as `in_flight`.
- **NEVER** silently modify `min_match_score` or `scoring_weights` in `context/preferences.yaml` without showing the verdict table and getting owner approval.
- **Self-Verification Check:** Confirm every band sum equals `decided` count, `in_flight` count is printed separately, `(n too small)` holds where `n < 5`, and any edited YAML keys in `context/preferences.yaml` remain valid YAML.
