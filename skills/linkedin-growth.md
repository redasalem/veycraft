---
name: linkedin-growth
version: "3.1.0"
description: Load when the owner runs /linkedin-growth or asks (in English or Arabic) to audit or optimize a LinkedIn profile for Recruiter search ranking and credibility signals, align LinkedIn with a CV, diagnose funnel or analytics bottlenecks, build a LinkedIn content/carousel/comment-first strategy, set up a LinkedIn Services Page and inbound freelance client funnel, or draft posts, concise proposals, and <=75-word outreach; defaults to DRAFT_ONLY and permits live updates or publishing only with verified signed-in Playwright auth, explicit APPROVE, and post-action snapshot verification.
triggers:
  - /linkedin-growth
  - review or audit my LinkedIn profile
  - improve my LinkedIn headline or About section
  - make my LinkedIn profile consistent with my CV
  - optimize my LinkedIn profile for target roles
  - check my LinkedIn rank, analytics, or profile errors
  - LinkedIn algorithm, reach, dwell time, or topical authority strategy
  - LinkedIn comment-first strategy, content pillars, or native PDF carousel
  - set up or optimize my LinkedIn Services page and inbound freelance client funnel
  - write or publish a LinkedIn post, concise client proposal, or personal-brand copy
  - add open-source projects or optimize LinkedIn skills, credibility signals, and Featured section
  - ظبط لينكد إن / عدل لينكد إن / تحسين بروفايل وصفحة خدمات لينكد إن للفريلانس
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - verified candidate facts available (context/profile.md + context/cv.md OR session-confirmed CV)
  - accessible LinkedIn profile data (pasted text, LinkedIn Save-to-PDF, screenshot, or read-only signed-in Playwright inspection) and optional target role(s)/JDs or service offering
  - DRAFT_ONLY by default; explicit owner APPROVE required before any live LinkedIn Save, Post, Comment, Proposal, or Send
requires_skills:
  - tailor-resume-and-verify
  - outreach-and-interview-prep
  - recruiter-brand-and-domain-intelligence
  - circuit-breaker-and-antiban
  - meta-self-verification
verification:
  - Confirmed Platform Mechanics are separated explicitly from Observed Distribution Heuristics with 0 fabricated algorithm multipliers or fake reach percentages
  - 0-100 Recruiter-SEO scorecard, credibility signals, Services Page taxonomy (<= 10 verified services), and CV-consistency gap table trace strictly to inspected profile sections and verified candidate facts (0 hallucinations, 0 of the 19 canonical banned AI cliches, 0 prose em-dashes)
  - Anti-Pod, Anti-Automation, and genuine-account review ToS guardrails enforced; <=75-word outreach and initial client proposals verified via node ./bin/cli.mjs pre-submit; full audit and drafts saved as DRAFT_ONLY to logs/insights/linkedin-seo-audit-YYYY-MM-DD.md
  - any user-approved live LinkedIn Save, Post, Comment, Proposal, or Send occurred only with verified signed-in auth, explicit APPROVE on exact copy, 3-9s pacing, and fresh post-action browser_snapshot verification
---
# Dual-Engine LinkedIn Growth, Recruiter Search, Feed Algorithm & Services Funnel Strategist (`/linkedin-growth`)

## When to Use & Preconditions

Use when the owner invokes `/linkedin-growth` or naturally asks (in English or Arabic, such as `"optimize linkedin"`, `"LinkedIn Services"`, `"ظبط لينكد إن"`, `"عدل لينكد إن"`) to audit or optimize their LinkedIn profile for inbound Recruiter discovery and trust signals (Engine A), build organic feed authority via posts, carousels, or Comment-First engagement (Engine B), enforce LinkedIn ToS and anti-slop guardrails (Engine C), set up and operate a LinkedIn Services Page inbound freelance client funnel (Engine D), align LinkedIn with their CV, or draft `<= 75`-word outreach and initial proposals. Never edit LinkedIn profiles as a side effect of `/daily-run`.

- **Load when:** `/linkedin-growth`; `"review my LinkedIn profile"`; `"optimize linkedin"`; `"improve my LinkedIn headline and About section"`; `"make my profile consistent with my CV"`; `"LinkedIn Services page / freelance clients"`; `"LinkedIn algorithm / dwell time / comment strategy / carousel / topical authority"`; `"ظبط لينكد إن"`; `"عدل لينكد إن"`; `"تجهيز صفحة خدمات لينكد إن"`.
- **Preconditions (stop if any is false):**
  - verified candidate facts exist (`context/profile.md` + `context/cv.md` OR session-confirmed CV; never force full 5-gate `/setup`)
  - accessible LinkedIn profile data exists (pasted text, LinkedIn `Save to PDF`, screenshot, or verified signed-in Playwright read-only session)
  - `DRAFT_ONLY` is active by default; explicit owner `APPROVE` is required before any live Save, Post, Comment, Proposal, or Send
- **Requires skills:** `tailor-resume-and-verify`, `outreach-and-interview-prep`, `recruiter-brand-and-domain-intelligence`, `circuit-breaker-and-antiban`, `meta-self-verification`. **MCP:** none (`playwright` optional; never equate Playwright availability with LinkedIn authentication or permission).

## Deterministic Step-by-Step Execution

### 1. Epistemic Discipline - Confirmed Platform Mechanics vs. Observed Heuristics
Always label recommendations honestly across two categories so the owner receives real signal rather than growth-hacker folklore:

| Category | What Belongs Here | Guidance Rule |
|---|---|---|
| **Confirmed Platform Mechanics** | LinkedIn Recruiter indexed fields (`Headline <= 220` chars, `Experience` titles, `Skills` 50-skill cap & Experience-linked skill tags), mobile `About` fold truncation (`~140-210` chars), `Open to Work (Recruiters only)`, location/geo-radius & work-mode filters, and LinkedIn ToS bans on automation/pods | Enforce deterministically as hard structural hygiene and compliance constraints |
| **Observed Distribution Heuristics** | Topical authority (profile-to-post semantic alignment), dwell time & hook expansion, substantive multi-sentence comment velocity, author reply loops, native format tradeoffs, and external link placement choices | Frame transparently as goal-dependent best practices observed in the wild, never as guaranteed secret formulas |

- **Hard Anti-Myth Rule:** **NEVER** fabricate secret algorithm multipliers or fake precision percentages (for example, never claim `"comments = 15x likes"`, `"external links cut reach by 60%"`, or `"post at 8:03 AM Tuesday for 3x reach"`).

### 2. Mode 1 - Read-Only Profile Inspection & CV-Consistency Gap Check
1. Read verified candidate facts from `context/profile.md`, `context/cv.md`, `context/resume-data.json`, and `context/github-projects.md` if present (or ask naturally for the owner's CV if absent). This is the **only** permitted source of employers, dates, titles, credentials, tools, and numeric outcomes.
2. Collect current LinkedIn sections (`Headline`, `About`, `Experience`, `Featured`, `Skills`, `Open to Work`, plus `Licenses & Certifications`, `Projects`, `Publications`, `Services`) through the cleanest accessible path:
   - Offline: pasted profile text, LinkedIn `Save to PDF`, or screenshots (works 100% without Playwright).
   - Optional Playwright: ONLY when a named signed-in LinkedIn account indicator is confirmed, extract compact section text read-only via `browser_evaluate` (`3-9 s` pacing; trip `skills/24-circuit-breaker-and-antiban.md` immediately on any authwall, CAPTCHA, 2FA, or rate-limit banner and fall back to offline input).
3. Detect target **Domain Archetype**, **Buyer Pain Points**, and **Recruiter Boolean** targets via `skills/28-recruiter-brand-and-domain-intelligence.md` (Steps 1, 2, and 4). Flag CV-to-LinkedIn date/title/skill contradictions and partition target keywords from `1-5` target JDs into: **Present on LinkedIn**, **Verified-but-Missing (Safe to Surface)**, and **True Gaps (NEVER Claim)**.

### 3. Engine A - LinkedIn Recruiter & Search Ranking Optimization (Inbound Discovery)
1. **Score Current Profile on the Transparent `0-100` Recruiter-SEO Rubric:**

   | Section | Max Score | Grounded Scoring Breakdown |
   |---|---:|---|
   | **1. Headline (`<= 220` chars)** | **25** | Canonical target role match (`0-10`) + core Recruiter-filter keywords/credentials (`0-10`) + verified concrete impact hook (`0-5`) |
   | **2. About Mobile Fold & Clarity** | **25** | Above-the-fold first `~140-210` chars on mobile / `<= 220` chars desktop hook (`0-8`) + natural verified keyword coverage (`0-10`) + domain clarity & direct CTA (`0-7`) |
   | **3. Experience Bullets & Titles** | **30** | Concrete action + verified numeric/operational outcome (`0-15`) + searchable canonical title & CV parity (`0-10`) + plain human prose with `0` banned cliches/em-dashes (`0-5`) |
   | **4. Featured & Multi-Role Skills** | **20** | Top 3-5 skills linked across multiple Experience roles/Projects within 50-skill cap (`0-10`) + focused `1-3` Featured proof assets (`0-10`) |
   | **Total Recruiter-SEO Score** | **100** | `<60` Needs Rebuild · `60-79` Solid Base · `80-100` Recruiter-Ready |

2. **Multi-Role Skills-to-Experience Depth & 50-Skill Cap:**
   - Fix spelling, spacing, and casing bugs across all industries (`Java Script` -> `JavaScript`, `Sales Force` -> `Salesforce`, `Financial Modelling` -> `Financial Modeling`, `HIPPA` -> `HIPAA`) that break Recruiter Boolean queries.
   - Map the candidate's **top 3-5 priority domain skills** across **multiple** verified Experience roles plus Projects and Certifications so LinkedIn Recruiter's `"Years of Experience per Skill"` filter calculates full verified tenure accurately. Curate pinned top skills to match the primary target role.
3. **Experience Title Weighting & Recruiter Boolean Alignment:**
   - Standard searchable role titles inside **Experience** carry higher Recruiter search weight than About prose. Align quirky internal titles only via truthful confirmed equivalents (`Growth Lead (Performance Marketing)`), never inventing seniority.
   - Mirror `(Primary Title OR Adjacent Title) AND (Core Skill 1 OR Core Skill 2)` consistently across Headline, Current Experience Title, Top Skills, and About fold.
4. **Activity, Freshness, Responsiveness & Geo-Radius Signals:**
   - Optimize for LinkedIn Recruiter `"Likely to Respond"` and Active Talent spotlights via prompt, polite InMail replies (even when declining), periodic verified profile freshness, following target employers, and accurate **Location + Remote/Hybrid geo-radius** settings alongside `Open to Work (Recruiters only; never force public green banner unless requested)`.
5. **Mobile Fold, Featured Curation (`1-3` Assets) & 3-Stage Funnel Diagnostics:**
   - Verify the first `~140-210` characters of `About` communicate the Buyer Pain Point + top proof before mobile `"See more"` truncation.
   - Cap `Featured` strictly to **`1-3` high-proof assets** (such as a verified portfolio from `skills/29-portfolio-builder-and-deployer.md`, flagship repository from `skills/11-portfolio-and-github-auditor.md`, or verified case study/publication) to prevent choice paralysis.
   - Diagnose private analytics across the 3-stage inbound funnel (`Search Appearances -> Profile Views -> Inbound Replies`) and emit a **Top-3 Immediate Fix Plan**:
     - Low `Search Appearances` -> fix Headline, Experience titles, multi-role Experience-linked Skills, location/geo-radius, and `Open to Work (Recruiters only)` titles.
     - Good `Search Appearances` but low `Profile Views` -> sharpen Headline differentiator, profile photo/banner clarity, and role relevance.
     - Good `Profile Views` but low `Inbound Replies` -> strengthen mobile About fold (`~140-210` chars), `1-3` Featured proof assets, and Proof Density Hierarchy outcomes in Experience.
6. **Personal-Brand & Positioning Copywriting (`Buyer Pain Point -> Proof -> Outcome -> Soft CTA`):**
   - Reframe independent, freelance, or solo consulting work as specialist delivery with verified client outcomes, scope, and compliance rigor tailored to the Domain Archetype (`skills/28-recruiter-brand-and-domain-intelligence.md`).
   - Rank bullets strictly by Proof Density Hierarchy (`Quantified Business Outcome > Verified Operational Scope > Shipped Artifact/Deliverable > Credential/Tool`).
7. **Credibility & Trust Signals Audit (Recruiter & Client Conversion Hygiene):**
   - **Visual First Impression:** Check profile photo clarity (sharp, well-lit, approachable professional framing) and cover banner positioning (clear value proposition or clean domain visual, zero cluttered text).
   - **Custom URL & Identity Verification:** Flag messy numeric LinkedIn URLs (`linkedin.com/in/name-948271a`) for cleanup to a clean custom slug (`/in/your-name`), and recommend enabling LinkedIn's free Identity/Workplace Verification badge when eligible.
   - **Social Proof & Active Credibility:** Audit for `>= 2` concrete, role- or client-specific **Recommendations**, genuine ongoing profile activity (real posts/comments and organic connections so recruiters and clients see an active account), and exact parity across **Licenses & Certifications** and **Projects** against the verified CV.

### 4. Engine B - LinkedIn Feed & Distribution Algorithm (Organic Authority & Reach)
1. **Topical Authority & Profile-to-Post Semantic Alignment:**
   - Lock **`2-3` core domain content pillars** tightly aligned with the author's Headline, About, Experience, and Top Skills so LinkedIn's semantic topic classifier consistently routes posts to target hiring managers, buyers, and peers (avoiding random off-topic dilution).
2. **Dwell Time & Mobile Hook Mechanics (Observed Heuristic):**
   - Open with a **2-line scroll-stopping hook** above mobile `"See more"` grounded in real tension, concrete numbers, or an operator lesson (zero cheap clickbait).
   - Use crisp 1-2 sentence paragraphs, clean whitespace, and concrete visual/structural anchors so readers spend real time absorbing the post instead of bouncing.
3. **Comment-First Strategy (`DRAFT_ONLY` Low-Friction Growth Playbook):**
   - Before or alongside publishing original posts, draft **`3-5` substantive, value-adding comments** targeting hiring managers, recruiters, and respected operators in the user's exact niche.
   - Each comment must add multi-sentence domain perspective, a grounded counter-angle, or a verified operational example (never shallow `"Great post!"`, `"Thanks for sharing!"`, or `"CFBR"` filler).
4. **Meaningful Comment Velocity & Author Reply Loop:**
   - Optimize posts to invite thoughtful practitioner responses rather than passive reactions, and coach the owner to reply substantively to early commenters with clarifying details or follow-up questions that extend the discussion organically.
5. **Native Format Tradeoffs Matrix (Goal-Driven Heuristic, Never Dogma):**

   | Format | Best Goal & Use Case | Distribution & Conversion Tradeoff (Heuristic) |
   |---|---|---|
   | **Text-Only** | Sharp operator insights, contrarian field lessons, hiring-manager narratives | Fast to produce; relies heavily on a strong 2-line hook and scannable pacing for dwell time |
   | **Text + Original Visual / Diagram** | Architecture diagrams, before/after benchmarks, workflow visuals, proof charts | Stops feed scroll and anchors credibility when the visual carries real information (avoid stock filler) |
   | **Native PDF Document / Carousel** | Step-by-step frameworks, multi-slide case studies, teardown checklists (`5-10` crisp slides) | Strong dwell time as readers swipe natively inside the feed; keep slides clean and readable on mobile |
   | **Native Video (Short)** | Product/portfolio walkthroughs, concise 45-90s domain explainers with captions | High trust and personality signal; always include burned-in or SRT captions for muted mobile viewing |
   | **External Links** | Driving traffic to portfolio, live repo, application page, or long-form article | Goal-dependent tradeoff: place the link **in-body** when direct click-through conversion matters most, or keep the post native and reference the link via **Featured** or a follow-up comment when prioritizing in-feed reading |

6. **4 Domain-Adaptive Authority Post Templates (English, Arabic, or Bilingual):**
   1. **Shipped Work / Initiative Launch:** Buyer problem solved -> execution/architecture highlight -> verified outcome -> link via chosen goal-driven placement.
   2. **Field Problem & Operator Breakdown:** Real bottleneck, audit trap, compliance lesson, or customer friction -> exact resolution -> concrete takeaway.
   3. **Before/After Verified Case Study:** Real verified revenue, retention, turnaround, safety, reliability, or workflow delta from confirmed work.
   4. **Practical Modern Workflow:** Concrete tooling, QA, or AI-assisted workflow lesson grounded in actual practice (zero hype).
   - Keep `0-3` targeted domain hashtags max (only when helpful for searchability; never hashtag spam).

### 5. Engine C - Anti-Pod, Anti-Automation, ToS Safety & Anti-AI-Slop Guardrails
1. **Hard ToS & Anti-Ban Rules (`skills/24-circuit-breaker-and-antiban.md`):**
   - **STRICTLY PROHIBITED:** Engagement pods, comment-exchange groups, mass connection-request blasts, automated DM/commenting bots, browser scraping plugins, and manipulative `"Comment X to get this PDF"` engagement bait.
   - Abort browser automation immediately on any CAPTCHA, 2FA challenge, `/checkpoint/challenge`, `/authwall`, or unusual-activity banner and trip the 24-hour circuit breaker in `logs/circuit-breaker.json`.
2. **Full 19-Cliche & Anti-Slop Parity (`skills/03-tailor-resume-and-verify.md`):**
   - Enforce `0` occurrences of the **canonical 19-item banned AI-cliche list** (`skills/03-tailor-resume-and-verify.md`) and `0` prose em-dashes (`U+2014`) across all profile rewrites, posts, comments, and DMs.
   - Ban broetry one-line-per-sentence drama, fake humility (`"Humbled and thrilled to announce"`), hollow `"Agree? Thoughts?"` closers, and fabricated viral anecdotes.
3. **Outreach Word & Invariant Gate (`skills/05-outreach-and-interview-prep.md`):**
   - Cap every LinkedIn DM or connection note strictly at `<= 75` words, re-read `config/invariants.txt`, and validate via `node ./bin/cli.mjs pre-submit --draft <file>` (or `--text "<msg>"`).

### 6. Engine D - LinkedIn Services Page & Inbound Freelance Client Funnel
Use this engine whenever the owner wants inbound freelance, consulting, or B2B project leads through LinkedIn's native **Services Page** (`Providing services` section on profile). Treat all Services edits, proposals, and client messages as `DRAFT_ONLY` by default until explicit `APPROVE`.

1. **10-Service Taxonomy Selection (Confirmed Platform Mechanic):**
   - LinkedIn allows selecting up to **`10` Services** from its built-in category taxonomy. Pick strictly grounded services matching verified skills and past deliverables (prioritizing buyer search terms clients type into LinkedIn Services search over generic vanity tags).
   - **Never** add unverified categories just to fill all 10 slots; if only 5-7 categories are verified, keep 5-7 crisp categories and list missing adjacent services transparently under `True Gaps`.
2. **Services Page Setup (`DRAFT_ONLY` -> `APPROVE`):**
   - **Services `About` (`<= 500` chars):** Concise 3-part structure: (a) specific buyer problem solved, (b) concrete deliverables and verified stack/domain scope, and (c) clear low-friction CTA (`Message me with your scope for a quick fit check`). Zero of the 19 banned AI cliches and zero prose em-dashes.
   - **Work Location & Mode:** Configure accurate `Remote` (`Available to work remotely`) and/or `In-person` city/region scope so local and global buyers match accurately.
   - **Pricing Transparency:** Choose either a truthful verified starting **Hourly rate** or **Contact for pricing** based on the owner's confirmed rate floor (`context/preferences.yaml` or chat confirmation; never invent rates).
   - **Work Samples & Free Incoming Messaging:** Attach only verified, non-NDA work samples/images (from portfolio or public GitHub repos) and enable **`Allow LinkedIn members you aren't connected with to message you for free`** so non-connections can send project briefs without InMail friction.
3. **Inbound Request Triage (`Direct Requests` vs. `Premium / Marketplace Requests`):**
   - Separate incoming client leads into two queues:
     - **Direct Requests (Priority 1 - Free to Reply):** Buyers who found the owner's profile or Services Page directly and requested a proposal. Respond promptly (ideally within hours) to protect `"Likely to Respond"` and Services ranking visibility.
     - **Premium / Marketplace Broadcast Requests (Priority 2):** Generic multi-provider marketplace blasts or Premium-gated leads. Screen strictly for clear scope, realistic timeline, and verified fit before investing time (never chase low-intent or scam requests).
4. **Concise Initial Proposal Templates (EN + AR, `<= 75` Words):**
   - Keep the **initial proposal reply** crisp (`<= 75` words, validated via `node ./bin/cli.mjs pre-submit --text "<msg>"`), focused strictly on core technical/domain capabilities and direct fit to the client's brief.
   - **Progressive Scoping Rule:** Reserve detailed project plans, full architecture breakdowns, milestone estimates, and portfolio/work-sample walkthroughs for the **chat/scoping stage after the client accepts or replies** to the initial proposal (avoid dumping walls of text or free consulting upfront).
   - **English Initial Proposal Skeleton (`<= 75` words):**
     `Hi [Name], I saw your request for [specific deliverable]. I specialize in [2-3 verified core capabilities] and recently delivered [1 verified relevant outcome/system]. I can scope the milestones and share relevant work samples once we connect in chat. Would a brief 15-minute call or 3 quick scope questions work to confirm timeline and budget?`
   - **Arabic Initial Proposal Skeleton (`<= 75` words):**
     `أهلاً [الاسم]، اطلعت على طلبك بخصوص [الخدمة/المشروع]. أتخصص في [2-3 مهارات أساسية موثقة] ونفذت مؤخراً [إنجاز أو نظام موثق مرتبط]. بمجرد قبول العرض، نناقش خطة التنفيذ التفصيلية وأشاركك نماذج أعمال مشابهة في المحادثة. هل يناسبك تحديد 3 أسئلة سريعة حول النطاق والجدول الزمني؟`
5. **Verified Post-Delivery Review Workflow & Ethical Upsell:**
   - **Post-Delivery Review Integrity (ToS Rule):** Request a LinkedIn Service Review **only after real, completed, client-accepted delivery** via LinkedIn's native `Invite to review` link.
   - **Genuine Account Requirement:** Both provider and client accounts must be authentic, active LinkedIn profiles (real profile photo, real connections, real platform activity). **STRICTLY PROHIBITED:** fake client accounts, review-exchange rings, paid/incentivized reviews, or mass review spam.
   - **Ethical Follow-On Upsell:** Only after a smooth, accepted milestone delivery, offer one concise, genuinely helpful next step (such as a monthly maintenance retainer, QA/performance audit phase 2, handover documentation, or optional profile/workflow optimization) framed transparently with zero pressure.

### 7. Mode 2 (`DRAFT_ONLY` Default) & Mode 3 (`APPROVE`-Gated Live Mutations & Surface Navigation)
1. **Mode 2 - `DRAFT_ONLY` Artifact Output:** Present the `0-100` scorecard, Credibility & Trust Signals checklist, CV-consistency gaps, Top-3 Immediate Fix Plan, Before/After section diffs, Services Page setup copy (`<= 10` services + `<= 500`-char Services About + EN/AR initial proposals), post/carousel/Comment-First drafts, and outreach notes in chat; save the complete artifact to `logs/insights/linkedin-seo-audit-YYYY-MM-DD.md` and re-read to confirm formatting and zero placeholders (`skills/meta-self-verification.md`). Support iterative section edits (`EDIT <section>`).
2. **Mode 3 - User-Approved Live Mutations (Optional):** Execute a live LinkedIn Save, Post, Comment, Proposal, or Send **ONLY** when: (a) the owner explicitly asks for that live action, (b) Playwright MCP is connected with a verified signed-in session for the owner's account, and (c) the owner inspects the exact final copy and replies **`APPROVE`** (`"انشر"` or `"اعتمد"` for Arabic actions). Wait `3-9 s`, reload/re-open the target surface, and verify persisted state via a fresh `browser_snapshot` before reporting done.
3. **Full LinkedIn Surface Coverage (`Role -> Label -> Text` selectors, `3-9 s` pacing):** Intro/Headline, About, Experience (`details/experience/`), Skills (`details/skills/` + multi-role skill tags), Featured, Open to Work (`Recruiters only`), `Licenses & Certifications`, `Projects` (`details/projects/`), `Publications`, `Services` (`Providing services` page & `Direct Requests` inbox), `Honors`, Recommendations, Post Composer, Strategic Commenting, and `<= 75`-word Outreach DMs.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Claiming fake algorithm multipliers (`"comments = 15x likes"`, `"links lose 60% reach"`) or presenting observed heuristics as confirmed platform laws -> ✅ label **Confirmed Platform Mechanics** vs. **Observed Distribution Heuristics** transparently.
- ❌ Recommending engagement pods, comment-exchange groups, fake/exchanged Service Reviews, mass DM/comment bots, `"CFBR"` spam, or manipulative `"Comment X for PDF"` bait -> ✅ enforce ToS safety (`skills/24-circuit-breaker-and-antiban.md`), authentic Comment-First engagement, and verified Post-Delivery Review requests between genuine active accounts.
- ❌ Selecting unverified LinkedIn Services categories to fill all 10 slots, or dumping huge unpaid project plans in the initial proposal -> ✅ ground all `<= 10` services in verified work and keep initial proposals `<= 75` words, moving detailed plans and samples to post-acceptance chat.
- ❌ Clicking LinkedIn `"Edit"`, `"Save"`, `"Post"`, `"Comment"`, `"Submit proposal"`, or `"Send"` without explicit `APPROVE` on exact final copy, or assuming Playwright availability equals LinkedIn auth -> ✅ default to `DRAFT_ONLY`, verify signed-in auth, and confirm persisted text via fresh `browser_snapshot`.
- ❌ Stuffing unverified JD keywords, unearned titles, broetry fluff, any of the 19 canonical banned AI cliches, or prose em-dashes (`U+2014`) -> ✅ isolate unverified skills under `True Gaps` and write plain, verifiable domain-native prose.

### Self-verification check (before reporting this step complete)
- [ ] Confirmed Platform Mechanics vs. Observed Distribution Heuristics separated explicitly with `0` fabricated algorithm multipliers or fake percentages
- [ ] `0-100` Recruiter-SEO scorecard, Credibility & Trust Signals check, multi-role skills check, and CV-consistency gaps grounded strictly in inspected LinkedIn data and verified CV facts (`0` hallucinations, `0` of the 19 canonical banned AI cliches, `0` prose em-dashes)
- [ ] When Services Page / freelance funnel is in scope: `<= 10` verified Services selected, `<= 500`-char Services About + free-messaging toggle + Direct Requests triage drafted, initial proposal `<= 75` words verified via `node ./bin/cli.mjs pre-submit`, and verified Post-Delivery Review integrity enforced
- [ ] Anti-Pod/Anti-Automation ToS guardrails enforced; any outreach note `<= 75` words verified via `node ./bin/cli.mjs pre-submit`; full output saved as `DRAFT_ONLY` in `logs/insights/linkedin-seo-audit-YYYY-MM-DD.md` and re-read
- [ ] any user-approved live Save, Post, Comment, Proposal, or Send executed only with verified signed-in auth, explicit `APPROVE`, `3-9 s` pacing, and fresh post-action `browser_snapshot` verification
