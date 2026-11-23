# Tailoring Notes (Sample Output - Synthetic)

> Synthetic only. Uses sandbox fixtures (`examples/sandbox-demo/demo-profile.md`, `examples/sandbox-demo/sample-jds.md`).
> No real candidate PII. Copy this shape into `logs/resumes/<slug>/tailoring-notes.md`.

- **Candidate:** Samira Haddad (Synthetic Sandbox Profile)
- **Company:** CloudScale Payments
- **Role:** Senior Full-Stack & AI Engineer
- **job_id:** `greenhouse:cloudscale-4012`
- **Domain Archetype:** Software, Data, Cloud & AI Engineering (`skills/28-recruiter-brand-and-domain-intelligence.md`)
- **Mode:** `dry_run` (no Submit)
- **Match score:** `9.2 / 10` (`92%`) · **Tier:** A

## JD Asked (Top Requirements)

- TypeScript and Node.js backend services (4+ years required)
- PostgreSQL and reliable webhook/event processing
- Automated testing with Playwright and CI/CD ownership
- React developer consoles
- Browser automation or LLM/MCP tool-calling pipelines

## What Changed on the CV

- Rewrote Summary to answer the Buyer Pain Point directly using verified TypeScript, Node.js, PostgreSQL, React, and Playwright experience.
- Reordered NilePay Sandbox bullets using the Proof Density Hierarchy: checkout p95 latency reduction (`420ms` to `165ms`) and `180k` daily webhook settlement events first.
- Surfaced the verified `AgentEval MCP` open-source project and `45` Playwright merchant onboarding flows in GitHub Actions; did **not** claim Kubernetes or Terraform.

## Evidence Map

| CV Claim | Verified Source |
|----------|-----------------|
| Reduced checkout API p95 latency from `420ms` to `165ms` | `examples/sandbox-demo/demo-profile.md` · NilePay Sandbox (`2023-02` to `Present`) |
| Built TypeScript and Node.js webhook settlement services processing `180k` daily events with PostgreSQL idempotency keys | `examples/sandbox-demo/demo-profile.md` · NilePay Sandbox (`2023-02` to `Present`) |
| Designed Playwright end-to-end test suite covering `45` merchant onboarding flows in GitHub Actions | `examples/sandbox-demo/demo-profile.md` · NilePay Sandbox (`2023-02` to `Present`) |
| Shipped React and TypeScript analytics dashboards and RBAC for `120` B2B tenant workspaces | `examples/sandbox-demo/demo-profile.md` · DeltaCloud Sandbox (`2020-06` to `2023-01`) |
| Built `AgentEval MCP` Markdown evaluation harness for testing MCP tool-calling accuracy across Playwright browser flows | `examples/sandbox-demo/demo-profile.md` · Verified Projects |

## ATS Keyword Heatmap (Before -> After)

| Category | JD Keywords | Base CV (Before) | Tailored CV (After) | Newly Surfaced (Verified) | True Unclaimed Gaps |
|----------|-------------|------------------|---------------------|---------------------------|---------------------|
| Core Domain Skills & Methodologies | 5 | 3/5 (60%) | 5/5 (100%) | webhook idempotency, MCP tool-calling | None |
| Tools, Platforms & Systems | 6 | 4/6 (67%) | 5/6 (83%) | Playwright, GitHub Actions | Kubernetes (0 verified years) |
| Credentials, Licensure & Compliance | 1 | 1/1 (100%) | 1/1 (100%) | RBAC access controls | None |
| Business Outcomes & Scope Signals | 3 | 2/3 (67%) | 3/3 (100%) | p95 latency reduction, CI ownership | None |
| **Overall** | **15** | **10/15 (67%)** | **14/15 (93%)*** | *verified facts only* | **Kubernetes** |

\*After count includes only verified candidate facts. Unverified terms remain isolated below.

## True Gaps (Not Claimed in CV)

- **Kubernetes / EKS:** Absent from `examples/sandbox-demo/demo-profile.md` (0 verified years); excluded from CV and reserved for honest interview discussion if asked.
- **Terraform:** Not verified in candidate profile; excluded from CV.

## Same-Family Synonym Decisions

| JD Term | Listed As | Verified Base Fact | Interview Risk |
|---------|-----------|--------------------|----------------|
| CI/CD ownership | GitHub Actions CI | 4 verified years + 45 automated Playwright onboarding flows in GitHub Actions | Low: review pipeline YAML structure before interview |

## Hiring-Manager Outreach DM (`<= 75` Words) - DRAFT_ONLY

```text
Hi Tariq, I applied for the Senior Full-Stack & AI Engineer role at CloudScale Payments.
At NilePay, I built TypeScript and PostgreSQL webhook services handling 180k daily events,
cut checkout API p95 latency from 420ms to 165ms, and automated 45 merchant flows with
Playwright in GitHub Actions. Happy to share how my AgentEval MCP work maps to your stack.
```

Word count: 60 words (`<= 75` cap). Clichés: 0. Prose em-dashes: 0. Status: `DRAFT_ONLY` (requires explicit owner `APPROVE` before Send).
