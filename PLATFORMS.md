# Global Platforms, Regional Portals & ATS Compatibility Matrix

`veycraft` connects your AI agent to global job boards, remote-first portals, curated B2B contract networks, regional boards, and employer Applicant Tracking Systems (ATS) through **Playwright MCP** playbooks—zero brittle scrapers or custom API keys required.

> Want to add a new job board or regional portal? Pick an entry marked **Help Wanted** below and submit a PR using our [New Platform Request template](.github/ISSUE_TEMPLATE/new-platform-request.md) + [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Summary Legend

| Badge | Meaning |
|---|---|
| **Live Playbook** | Dedicated skill under `skills/platforms/` + default entry in `context/targets.yaml.example` |
| **Core / Router** | Handled via category playbook (`ats-engines.md`, `b2b-contract-networks.md`, `global-boards.md`, `remote-boards.md`, `mena-boards.md`) |
| **Help Wanted** | Supported via `/apply-url <url>` generically, open for a dedicated contributor regional/board playbook |

---

## 1. Global & North America Job Boards

| Platform | Category | Auth Required | Status | Playbook |
|---|---|---|---|---|
| **LinkedIn Jobs** | Global Professional Network & Easy Apply | Yes (`linkedin_cookie`) | Live Playbook | [`skills/platforms/linkedin.md`](skills/platforms/linkedin.md) |
| **Indeed** | Global Aggregator | Yes (varies by region) | Core / Router | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **Glassdoor** | Jobs + Company Health Signals | Yes | Core / Router | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **Dice** | US Tech & Contract Roles | Yes | Core / Router | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **ZipRecruiter** | North America High-Volume Jobs | Yes | Core / Router | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **BuiltIn** | US & Remote Tech Hubs | Optional | Core / Router | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **Wellfound (AngelList Talent)** | Startups & Equity Roles | Yes | Live Playbook | [`skills/platforms/wellfound.md`](skills/platforms/wellfound.md) |
| **Y Combinator (Work at a Startup)** | YC Startup Roles | Optional / YC Login | Help Wanted | [`skills/platforms/wellfound.md`](skills/platforms/wellfound.md) |
| **Seek** | Australia & New Zealand | Yes | Help Wanted | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |

---

## 2. Global Remote-First Boards

| Platform | Category | Auth Required | Status | Playbook |
|---|---|---|---|---|
| **WeWorkRemotely** | Global Remote Engineering & Product | Usually redirects to ATS | Core / Router | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **RemoteOK** | Async / Global Remote Tech | Usually redirects to ATS | Core / Router | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **Welcome to the Jungle (Otta)** | Curated Tech & Europe/US Remote | Yes | Core / Router | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **Himalayas / Remotive** | Remote Tech Aggregators | Redirects to ATS | Help Wanted | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |

---

## 3. Curated B2B & Remote Contract Networks

| Network | Focus | Vetting Gate | Status | Playbook |
|---|---|---|---|---|
| **Toptal** | Vetted Senior Freelance Engineering | Screening & Live Tech Interview | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Braintrust** | Zero-Fee Talent Network & Enterprise B2B | Profile & Domain Review | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Lemon.io** | Pre-Vetted Startup Contract Engineers | English + Technical Screening | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Gun.io** | Senior Fractional & Direct Contract | Peer Review + Vetting | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Contra** | Commission-Free Independent Contracts | Open Portfolio + Proposals | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Arc.dev** | Remote Full-Time & Contract Tech | Profile + AI/Tech Screening | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |
| **Turing** | Long-Term Remote Engineering Contracts | Automated Stack Challenges | Core / Router | [`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md) |

---

## 4. Regional Boards (Europe, MENA, APAC, LATAM)

| Region | Platform | Languages | Status | Playbook / Route |
|---|---|---|---|---|
| **MENA** | **Wuzzuf** | English / Arabic | Core / Router | [`skills/platforms/mena-boards.md`](skills/platforms/mena-boards.md) |
| **MENA** | **Bayt** | English / Arabic | Core / Router | [`skills/platforms/mena-boards.md`](skills/platforms/mena-boards.md) |
| **MENA / Gulf** | **GulfTalent** | English / Arabic | Core / Router | [`skills/platforms/mena-boards.md`](skills/platforms/mena-boards.md) |
| **MENA / Gulf** | **Naukrigulf** | English / Arabic | Help Wanted | [`skills/platforms/mena-boards.md`](skills/platforms/mena-boards.md) |
| **Europe (DACH / FR / UK)** | **Welcome to the Jungle** | EN / FR | Core / Router | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **Europe (DACH)** | **StepStone (`.de` / `.at` / `.ch`)** | DE / EN | Core / Router | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **Europe (DACH)** | **Xing / SwissDevJobs** | DE / EN | Help Wanted | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **Europe (Nordics / NL / UK)** | **Otta / Cord / Honeypot** | EN | Help Wanted | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |
| **APAC (IN / SG / JP)** | **Instahyre / NodeFlair / TokyoDev / JapanDev** | EN / JP | Help Wanted | [`skills/platforms/global-boards.md`](skills/platforms/global-boards.md) |
| **LATAM** | **Get on Board / Torrey / Revelo** | ES / PT / EN | Help Wanted | [`skills/platforms/remote-boards.md`](skills/platforms/remote-boards.md) |

---

## 5. Employer Applicant Tracking Systems (ATS)

All recognized direct employer application links (`/apply-url <url>` or board redirects) route through dedicated ATS playbooks:

| ATS Engine | Upload-First & Form Automation | Status | Playbook |
|---|---|---|---|
| **Greenhouse** | Yes (`boards.greenhouse.io` / `job-boards.greenhouse.io`) | Live Playbook | [`skills/ats/greenhouse.md`](skills/ats/greenhouse.md) |
| **Lever** | Yes (`jobs.lever.co`) | Live Playbook | [`skills/ats/lever.md`](skills/ats/lever.md) |
| **Ashby** | Yes (`jobs.ashbyhq.com`) | Live Playbook | [`skills/ats/ashby.md`](skills/ats/ashby.md) |
| **Workday** | Account-gated manual fallback (`myworkdayjobs.com`) | Live Playbook | [`skills/ats/workday.md`](skills/ats/workday.md) |
| **SmartRecruiters** | Yes (`jobs.smartrecruiters.com`) | Live Playbook | [`skills/ats/smartrecruiters.md`](skills/ats/smartrecruiters.md) |
| **BreezyHR** | Yes (`*.breezy.hr`) | Live Playbook | [`skills/ats/breezyhr.md`](skills/ats/breezyhr.md) |
| **Taleo** | Account-gated manual fallback (`taleo.net` / Oracle) | Live Playbook | [`skills/ats/taleo.md`](skills/ats/taleo.md) |
| **BambooHR / Recruitee / Rippling / iCIMS / JazzHR / Pinpoint** | Supported via unified ATS router | Core / Router | [`skills/platforms/ats-engines.md`](skills/platforms/ats-engines.md) |

> Every target listed in `context/targets.yaml.example` ships with `enabled: false` by default so `/setup` only verifies and runs on the exact boards you explicitly opt into.
