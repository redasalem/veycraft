---
name: freelance-profile-and-service-publisher
version: "1.0.0"
description: Load when the owner wants to audit/update a freelance marketplace profile or publish an SEO-optimized freelance service/gig listing with a custom cover image on any platform (Upwork, Fiverr, Freelancer, Malt, Mostaql, Khamsat, or any custom URL) with human-in-the-loop APPROVE PUBLISH gating (/freelance-service).
triggers:
  - /freelance-service
  - publish a freelance service or gig listing
  - create a Fiverr Khamsat Mostaql or Upwork service package
  - optimize freelance marketplace profile and service copy
requires_mcp:
  - none
optional_mcp:
  - playwright
tags:
  - freelance
  - service-publisher
  - gig-seo
  - browser-automation
  - cross-agent
preconditions:
  - plain-language service description plus target freelance platform URL or marketplace name
  - verified candidate experience, stack, and outcomes in `context/cv.md` and `context/github-projects.md` (or confirmed in chat)
  - authenticated browser session when performing live profile edits or form filling (pause for manual login, OAuth, or 2FA when signed out)
requires_skills:
  - privacy-pii-shield
  - condition-based-browser-waiting
  - circuit-breaker-and-antiban
  - meta-self-verification
verification:
  - zero unverified metrics, fake testimonials, or unconfirmed credentials added to profile or service copy
  - custom cover image generated via native image tool or exact-dimension HTML/Canvas/visual-prompt fallback with zero PII or counterfeit logos
  - Live DOM Read-Back Table presented with uploaded cover image verified in a fresh `browser_snapshot` before any final Publish/Save click
  - zero Publish/Save clicks executed while `dry_run` is active or without explicit fresh owner `APPROVE PUBLISH`
  - post-publish listing URL or confirmation status verified via fresh `browser_snapshot` and logged locally
---
# Universal Freelance Profile & Service Publisher

## When to Use & Preconditions

Use this model-agnostic playbook to audit a freelance marketplace profile, craft an SEO-optimized service/gig listing grounded in real work, generate a custom cover image, fill platform fields cleanly in the real browser, and stop before final publishing until explicit human `APPROVE PUBLISH`.

- **Load when:** `/freelance-service`; creating or optimizing a gig, project catalog package, or freelance profile on Upwork, Fiverr, Freelancer, Malt, Mostaql, Khamsat, or any custom freelance URL.
- **Standalone Readiness:** Works immediately from a service description + target URL (`no /setup required`). When Playwright/browser automation is absent, generates complete copy-paste listing blueprints + visual cover assets (`DRAFT_ONLY` fallback).
- **Requires skills:** `privacy-pii-shield`, `condition-based-browser-waiting`, `circuit-breaker-and-antiban`, `meta-self-verification`. **MCP:** `none` (optional `playwright` for live browser filling).

## Deterministic Step-by-Step Execution

### 1. Grounded Fact & Anti-Slop Extraction
- Read `context/cv.md`, `context/github-projects.md` (if present), and the owner's service prompt.
- Extract strictly verified deliverables, tech stacks, project outcomes, and turnaround bounds. Flag any unverified metric or tool before drafting.
- Keep copy direct, buyer-focused, and free of banned AI clichés and prose em-dashes (`0` fabricated reviews, fake enterprise logos, or guaranteed rankings).

### 2. Marketplace Auth, Circuit Breaker & Profile Audit
- Inspect `logs/circuit-breaker.json` first (`skills/24-circuit-breaker-and-antiban.md`).
- When browser automation is available, open the target marketplace URL using semantic accessibility locators (`Role -> Label -> Placeholder -> Text`, `skills/18-condition-based-browser-waiting.md`) and `3-9 s` pacing delays between page navigations.
- **Auth & Security Boundary:** If a login screen, OAuth prompt, or 2FA check appears, **pause immediately and ask the user to sign in manually** in the browser profile. If CAPTCHA, Cloudflare block, account warning, or `429` rate limit appears, stop and log a 24-hour cooldown (`skills/24-circuit-breaker-and-antiban.md`).
- Audit the live (or pasted) profile headline, bio, skills, and portfolio section for alignment with the new service. Propose any profile updates as a **Before/After `DRAFT_ONLY` diff** (`APPROVE`-gated before saving).

### 3. SEO Service Listing Blueprint (`DRAFT_ONLY`)
Draft a marketplace-native package matching the target platform's schema and language (English or Arabic RTL):
1. **SEO Service Title:** Clear primary keyword + concrete outcome within platform character limits.
2. **Category / Subcategory & Tags:** Search-aligned marketplace taxonomy plus max allowed keyword tags.
3. **Structured Description:** Buyer pain hook, exact included deliverables, step-by-step workflow, required client inputs, and explicit out-of-scope boundaries.
4. **Pricing Tiers & Delivery Days:** Realistic `Basic / Standard / Premium` packages (or single base price + paid add-ons on Khamsat/Mostaql) and turnaround days honoring owner rate floors.
5. **FAQ Pairs (`3-5` Q&As):** Pre-empt scope creep, revision limits, source-code handoff, and post-delivery support questions.

Present the complete blueprint to the owner for edits or confirmation before creating the cover and filling forms.

### 4. Custom Cover Image Generation (3-Tier Fallback)
- **Tier 1 (Native Image Tool Available):** Generate a clean, high-contrast cover matching platform dimensions (e.g., `1280x769` for Fiverr, `800x470` for Khamsat, or `16:9` `1200x675` default) reflecting the verified service deliverables, with legible focal hierarchy, zero watermarks, zero private PII, and zero unauthorized brand trademarks. Save under `logs/freelance/assets/<slug>-cover.png`.
- **Tier 2 (Local HTML/Canvas/SVG Render via Browser):** Generate a self-contained static HTML/SVG cover at exact target pixel dimensions inside `logs/freelance/assets/<slug>-cover.html` and capture a clean element PNG screenshot.
- **Tier 3 (Offline Manual Fallback):** If neither image generation nor browser export is available, provide exact layout dimensions, color palette, typography hierarchy, and a ready-to-paste image prompt for manual export.

### 5. Non-Submitting Browser Form Fill & Hard Stop (`APPROVE PUBLISH`)
- Navigate to the platform's New Service / Create Gig form with `3-9 s` human pacing between multi-page steps.
- Fill text fields, dropdowns/comboboxes, tags, pricing tiers, FAQs, and upload the cover image **without triggering final Publish**.
- Wait via fresh `browser_snapshot` until the uploaded cover image filename/thumbnail renders cleanly.
- **Mandatory Hard Stop Before Final Publish/Save:** Present the **Live DOM Read-Back Table** showing exact platform name, URL, profile changes (if any), final service title, pricing/delivery summary, uploaded cover filename verified in snapshot, `dry_run` status, and exact target button label (`Publish` / `Save & Publish` / `إضافة الخدمة`).
- **Execution Gate:** Never click Publish/Save while `dry_run: true`, and never treat earlier draft edits or open tabs as authorization. Click Publish/Save **once** only in a subsequent turn after the user explicitly replies **`APPROVE PUBLISH`**.

### 6. Post-Publish Verification & Local Logging
- After explicit `APPROVE PUBLISH` and clicking Publish/Save once, capture a fresh `browser_snapshot` confirming live listing creation (`Pending Review` / `Active` / listing URL, per `skills/meta-self-verification.md`).
- Save a sanitized record (platform, title, URL, pricing, delivery days, date, status) under `logs/freelance/services/` (`skills/14-privacy-pii-shield.md`).

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

- **NEVER** publish a gig, save live profile changes, or submit a marketplace listing without an explicit fresh **`APPROVE PUBLISH`** after displaying the Live DOM Read-Back Table.
- **NEVER** fabricate client counts, ratings, earnings, badges, or third-party logos in copy or generated cover images.
- **NEVER** bypass login walls, OAuth prompts, 2FA, CAPTCHA, or anti-bot rate limits, and never save or log secrets/cookies.
- **Self-Verification Check:** Confirm zero unverified claims, verified cover upload in `browser_snapshot`, clean Live DOM Read-Back Table before pause, post-publish confirmation snapshot after `APPROVE PUBLISH`, and zero tracked secrets/PII.
