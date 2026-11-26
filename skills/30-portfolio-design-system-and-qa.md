---
name: portfolio-design-system-and-qa
version: "1.0.0"
description: Load before coding or previewing any portfolio website, or when the user asks to author a portfolio blueprint, select or customize a WCAG-compliant color palette and typography system, run stack-aware unit/component tests or multi-viewport responsive QA at 375px/768px/1440px, or self-heal portfolio layout and console errors.
triggers:
  - /portfolio-design
  - portfolio design system
  - redesign my portfolio colors
  - choose portfolio palette
  - unit test my portfolio
  - visual qa on my portfolio
  - fix portfolio layout errors
requires_mcp:
  - none
optional_mcp:
  - playwright
preconditions:
  - verified candidate facts and target Domain Archetype available in context/ or confirmed in the active session
  - isolated target directory under logs/portfolio/<site-slug>/ (or logs/portfolio/third-party-<slug>/ or user-selected external directory) is writable
requires_skills:
  - recruiter-brand-and-domain-intelligence
  - tailor-resume-and-verify
  - multilingual-adaptation
  - privacy-pii-shield
  - meta-self-verification
verification:
  - DESIGN_PLAN.md, separated portfolio-data module, design-tokens.json, and tokens.css were authored and owner-approved inside <portfolio-dir>/ before writing UI components
  - selected or custom palette passed WCAG 2.1 AA contrast checks (>= 4.5:1 normal text, >= 3.0:1 large text and UI controls) across active color modes with 0 hardcoded hex colors in components
  - all 3 QA layers passed strictly inside <portfolio-dir>/ (static/type/build/PII gate, node --test or isolated Vitest unit tests, and 375px/768px/1440px viewport/overflow/console QA) and wrote qa-report.md while root package.json stayed at 0/0 dependencies
  - any failure triggered at most 3 targeted Self-Healing cycles without weakening assertions, or halted before localhost sign-off and deployment with the exact failing error log
---
# Agency-Grade Portfolio Design System Studio, Automated Testing & Self-Healing QA

## When to Use & Preconditions

Enforces pre-code information architecture, separated verified data modules, WCAG-validated design tokens, stack-aware unit/component tests, multi-viewport visual/overflow QA (`375px` / `768px` / `1440px`), and a bounded 3-cycle self-healing loop inside `<portfolio-dir>/` before any portfolio site reaches user sign-off or live deployment.

- **Load when:** `/portfolio-design`; `portfolio design system`; `redesign my portfolio colors`; `choose portfolio palette`; `unit test my portfolio`; `visual qa on my portfolio`; `fix portfolio layout errors`; or automatically before coding and before previewing any portfolio website.
- **Preconditions (stop if any is false):**
  - verified candidate facts and target Domain Archetype exist in `context/` or are confirmed in the active chat session (never force full 5-gate `/setup`)
  - isolated target directory under `workspace/portfolio/` or `logs/portfolio/<site-slug>/` (or `logs/portfolio/third-party-<slug>/` or user-chosen external directory) is writable
- **Requires skills:** `recruiter-brand-and-domain-intelligence`, `tailor-resume-and-verify`, `multilingual-adaptation`, `privacy-pii-shield`, `meta-self-verification`. **MCP:** none (`playwright` optional for live `375px`/`768px`/`1440px` browser viewport, overflow, and console inspection).

## Deterministic Step-by-Step Execution

### 1. Phase 1 - Upfront Design Blueprint (Mode A Scratch / Mode B Import) & Separated Data Layer
Before writing or refactoring any HTML template, JSX/TSX component, or stylesheet inside `<portfolio-dir>/` (`workspace/portfolio/` or `logs/portfolio/<site-slug>/`):
0. **Present & Confirm the 3-Part Upfront Design Spec:** Tailored to the user's verified profile and selected mode (**Mode A: Build from Scratch** or **Mode B: Import & Upgrade Existing** in `workspace/portfolio/`), display a compact spec covering **(1) Color Palette** (curated WCAG 2.1 AA palette or `Custom` hex), **(2) Design System / Layout** (typography pairing, responsive grid, section flow, LTR/RTL rules), and **(3) Tech Stack** (Tier 1–4 or preserved existing stack). Close with a compact **Next-Step Handoff** (rendered in the user's active conversation language) and obtain owner confirmation before writing code.
1. **Author `<portfolio-dir>/DESIGN_PLAN.md` with 5 Locked Blueprint Sections:**
   - **Goal & Archetype Narrative Order (`skills/28-recruiter-brand-and-domain-intelligence.md`):** Sequence sections around the owner's Primary Goal (6-10s Recruiter Scan, Freelance/Client Conversion, or Executive Brand) and Domain Archetype (`Engineering/Data/AI`, `Product/Design`, `Sales/Marketing/Growth`, `Finance/Legal/Risk`, `Healthcare/Clinical`, `Operations/Supply Chain/HR`, or `Executive/Generalist`).
   - **Above-the-Fold 6-10s Visual Wireframe:** Define exact hero hierarchy: role/buyer-outcome headline, quantified proof hook, single primary CTA, secondary proof link, and `0` decorative stock clutter.
   - **Component Tree & Responsive Grid Spec:** Map every section component and explicit column rules across `375px` (mobile 1-col, `16px-20px` gutter), `768px` (tablet 2-col, `24px-32px` gutter), and `1440px` (desktop `1120px-1280px` max-width / asymmetric bento grid).
   - **Bidirectional `LTR` / `RTL` Mirror Map (`skills/15-multilingual-adaptation.md`):** Specify directional alignment, navigation order, icon mirroring, and Latin technical-term preservation whenever Arabic or bilingual (`AR`/`EN`) switching is enabled.
   - **Grounded Case Study Schema (`skills/03-tailor-resume-and-verify.md`):** Structure every featured project card as `Context/Problem -> Architecture/Decision -> Verified Outcome` ordered by Proof Density Hierarchy using `100%` verified `context/` facts (`0` unconfirmed metrics).
2. **Author Separated Data Module (`<portfolio-dir>/portfolio-data.json` or `src/data/portfolio-data.ts`):**
   - Store `100%` of verified candidate copy under structured keys so UI components import strictly from `portfolio-data` with `0` hardcoded resume prose inside HTML/JSX:
     ```json
     {
       "meta": { "siteSlug": "<slug>", "archetype": "<domain>", "locales": ["en"], "defaultLocale": "en" },
       "hero": { "headline": "<verified role/outcome hook>", "proofHook": "<verified metric/scope>", "primaryCta": { "label": "View Selected Work", "href": "#work" } },
       "featuredWork": [{ "id": "<slug>", "title": "<project>", "problem": "<context>", "decision": "<architecture/approach>", "verifiedOutcome": "<confirmed fact>", "links": [] }],
       "experience": [], "credentials": [], "publicContacts": { "email": null, "linkedin": null, "github": null }
     }
     ```

### 2. Phase 2 - Anti-AI-Slop Design System Studio & Token Lock (Approval Before Code)
1. **Hard-Ban Generic AI Visual Slop:** Reject default purple-blue gradients (`#6366F1 -> #A855F7`), neon cyberpunk glows, unreadable glassmorphic blur soup, floating decorative blobs, and muddy low-contrast dark grays.
2. **Present 7 Curated Agency-Grade Palettes + Full `Custom` Option:**

   | # | Palette Name | Surface & Ink Anchors | Accent Anchor | Best-Fit Archetypes |
   |---|---|---|---|---|
   | **1** | **Editorial Ivory & Ink** | `#FAF8F5` paper / `#18181B` charcoal ink | `#1D4ED8` cobalt or `#166534` forest | Executives, writers, consultants, policy |
   | **2** | **Obsidian Carbon & Warm Brass** | `#0F1115` matte carbon / `#F4F4F6` alabaster | `#D4A359` warm brass | Senior engineers, systems & AI architects |
   | **3** | **Nordic Slate & Emerald** | `#F8FAFC` cool slate / `#0F172A` deep ink | `#047857` emerald | Fintech, data science, product leaders |
   | **4** | **Warm Sand & Terracotta** | `#F6F1EA` warm stone / `#231B16` espresso | `#B84A27` clay terracotta | Product designers, creative directors |
   | **5** | **Deep Navy & Copper** | `#0B162C` midnight navy / `#F8FAFC` ivory | `#D97742` burnished copper | Leadership, legal, corporate finance |
   | **6** | **Swiss Monochrome & Signal Vermilion** | `#FFFFFF` / `#0A0A0A` stark architectural grid | `#D92D20` surgical vermilion | Minimalist builders, architecture, studios |
   | **7** | **Studio Charcoal & Sage** | `#161918` calm charcoal / `#EEF2F0` soft white | `#7CA982` muted sage | Healthcare, clinical, operations, calm tech |
   | **Custom** | **Owner Brand / Custom Hex** | Auto-derived light/dark semantic scale | User hex / brand pair | Any user brand hex or reference aesthetic |

   - **`Custom` Derivation Rule:** Accept a single brand hex, foreground/background hex pair, or reference aesthetic from the user and deterministically derive all 8 semantic color tokens (`--bg`, `--surface`, `--surface-elevated`, `--text-primary`, `--text-muted`, `--accent`, `--accent-contrast`, `--border`).
3. **Deterministic WCAG 2.1 AA Contrast Validation:**
   - Compute relative luminance contrast ratios for BOTH light and dark modes (when toggled) before writing CSS:
     - Normal body text and `--text-muted` on `--bg`, `--surface`, and `--surface-elevated`: strictly `>= 4.5:1` (and `--accent-contrast` on `--accent` buttons `>= 4.5:1`).
     - Large display headings (`>= 18pt` or `>= 14pt` bold), interactive UI controls, focus-visible rings, and active borders: strictly `>= 3.0:1`.
   - If any user-supplied or muted shade fails AA thresholds, automatically adjust lightness while preserving hue and show the corrected hex pair.
4. **Intentional Typography, Spacing & Reduced-Motion Tokens:**
   - **Font Pairings (`Display + Body + Mono`):** Pair intentional editorial, geometric, or humanist webfonts matched to the Domain Archetype (never fall back to unstyled generic system-only stacks unless requested).
   - **Arabic & Bilingual RTL Fidelity (`skills/15-multilingual-adaptation.md`):** Load genuine Arabic webfonts (`IBM Plex Sans Arabic`, `Cairo`, or `Noto Sans Arabic`), bind `dir="rtl"` + `lang="ar"` at the document root, and enforce CSS logical properties (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline-start`, `text-align: start`).
   - **Canonical Token Lock (`<portfolio-dir>/design-tokens.json` + `<portfolio-dir>/tokens.css`):**
     ```json
     {
       "paletteId": "editorial-ivory-ink",
       "modes": { "light": { "bg": "#FAF8F5", "surface": "#FFFFFF", "textPrimary": "#18181B", "textMuted": "#52525B", "accent": "#1D4ED8", "accentContrast": "#FFFFFF", "border": "#D4D4D8" } },
       "contrastVerified": { "bodyRatio": 15.4, "mutedRatio": 6.7, "accentButtonRatio": 6.7, "wcagLevel": "AA" },
       "typography": { "display": "Instrument Serif", "body": "Plus Jakarta Sans", "mono": "JetBrains Mono", "arabic": "IBM Plex Sans Arabic" }
     }
     ```
     ```css
     :root {
       --bg: #FAF8F5; --surface: #FFFFFF; --surface-elevated: #F3EFEA;
       --text-primary: #18181B; --text-muted: #52525B;
       --accent: #1D4ED8; --accent-contrast: #FFFFFF; --border: #D4D4D8;
       --space-unit: 0.25rem; --radius-card: 0.75rem; --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
     }
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
     }
     ```
   - Obtain quick owner sign-off on `DESIGN_PLAN.md` + palette/tokens before writing component code, and enforce `0` hardcoded hex colors inside components.

### 3. Phase 3 - Multi-Layer Automated Testing & Multi-Viewport QA (`375px` / `768px` / `1440px`)
Run all 3 verification layers strictly inside `<portfolio-dir>` (keeping Veycraft root `package.json` untouched at `0/0` dependencies):
1. **Layer 1 - Static, Type & Build Gate:**
   - Execute `npx tsc --noEmit` (for TypeScript stacks) and production build (`npm run build` for Tiers 2-4), requiring exit code `0`.
   - Scan source and built output (`index.html`, `dist/`, `out/`, `.next/`) to confirm:
     - `0` broken local asset paths or unresolved `#anchor` targets, and `0` `<img>` tags missing descriptive `alt` attributes.
     - `0` `{{...}}` or `example.invalid` placeholders, `0` of the 19 banned AI cliches, and `0` prose em-dashes.
     - `0` unconsented PII strings (phone, address, salary, NDA client names) and `0` exposed client-bundle secrets (`skills/14-privacy-pii-shield.md`).
2. **Layer 2 - Real Stack-Aware Unit & Component Testing (`cwd = <portfolio-dir>`):**

   | Stack Tier | Isolated Test Runner (`<portfolio-dir>`) | Test File Pattern | Root `package.json` Impact |
   |---|---|---|---|
   | **Tier 1 (Vanilla HTML/CSS/JS)** | `node --test tests/portfolio.test.mjs` (built-in, `0` npm deps) | `tests/*.test.mjs` | `0/0` untouched |
   | **Tiers 2-4 (Astro / Vite+React / Next.js)** | `npx vitest run` (`vitest` + `@testing-library/react` / `jsdom` in `<portfolio-dir>/package.json`) | `tests/*.test.{ts,tsx,mjs}` | `0/0` untouched |

   - **4 Mandatory Behavioral Test Suites:**
     1. *Data Fidelity:* Verified candidate name, headline, flagship case studies, and canonical links from `portfolio-data` render accurately.
     2. *Privacy Guard:* Rendered DOM/HTML contains `0` unconsented PII fields or secret token prefixes.
     3. *Interactive Controls:* Project/category filters, light/dark theme toggle, and `AR`/`EN` locale switcher (`dir="rtl"`/`dir="ltr"`) update state cleanly.
     4. *Form Resilience:* Contact form validation rejects empty fields and malformed email inputs cleanly with accessible error feedback.
3. **Layer 3 - Visual, Responsive & Console QA (`375px`, `768px`, `1440px`):**
   - Serve the production build locally and inspect `375x812` (mobile), `768x1024` (tablet), and `1440x900` (desktop):
     - **With Playwright MCP (`optional_mcp: ["playwright"]`):** Run `browser_resize` across all 3 viewports, check `browser_snapshot` and `browser_console_messages` (`0` uncaught `console.error` or `pageerror`), assert `document.documentElement.scrollWidth <= window.innerWidth` (`0` horizontal overflow), verify `img.complete && img.naturalWidth > 0` on visible images, and verify `dir="rtl"` layout when Arabic is active.
     - **Without Playwright MCP (Offline Fallback):** Execute an automated local Node DOM/CSS verification script inside `<portfolio-dir>` checking semantic landmarks, responsive media/grid breakpoints, logical CSS rules, built asset existence/non-zero byte size, and CSS custom property bindings, recording in `qa-report.md` that offline DOM verification was used.
   - Write `<portfolio-dir>/qa-report.md` summarizing observed evidence across all 3 layers:
     ```markdown
     ### Portfolio QA Verification Report
     - **Layer 1 (Static, Type & Build):** PASS (`exit 0`, `0` broken links/missing alts, `0` placeholders/cliches/em-dashes, `0` PII/secret leaks)
     - **Layer 2 (Unit & Component Tests):** PASS (`<passed>/<total>` suites via `node --test` or isolated `vitest`; root `package.json` `0/0` intact)
     - **Layer 3 (Multi-Viewport QA):** `375px` PASS (`0` overflow) | `768px` PASS (`0` overflow) | `1440px` PASS (`0` overflow) | Console Errors: `0` | Mode: `<playwright | offline-dom>`
     - **Self-Healing Cycles Used:** `<0..3> / 3`
     ```

### 4. Phase 4 - Bounded Self-Healing Loop (Max 3 Cycles Before User Preview)
Whenever ANY check across Layers 1-3 fails (TypeScript/build failure, red unit test, console/runtime error, horizontal overflow at `375px`, WCAG contrast violation, or broken asset/link):
1. **Diagnose Root Cause:** Read the exact compiler, `node --test`/`vitest`, or viewport/console error output directly (never delete tests, skip suites, or weaken assertions to force a pass).
2. **Apply Surgical Fix:** Patch the offending token in `design-tokens.json`/`tokens.css`, responsive grid/logical CSS rule, `portfolio-data` field, or component logic inside `<portfolio-dir>`.
3. **Re-Verify End-to-End:** Re-run the full Layer 1-3 QA suite and overwrite `<portfolio-dir>/qa-report.md` with fresh observed evidence (`skills/meta-self-verification.md`).
4. **Hard 3-Cycle Ceiling:** Cap automated self-healing strictly at **3 cycles**. If any check remains red after Cycle 3, **STOP immediately**, surface the exact failing layer and raw error log to the owner, and **BLOCK** `localhost` preview sign-off and live deployment until resolved.

## Anti-Patterns (What NEVER To Do) & Self-Verification Check

### Anti-patterns
- ❌ Coding UI components before locking `DESIGN_PLAN.md`, separated `portfolio-data`, `design-tokens.json`, and `tokens.css`, or hardcoding hex colors and resume prose inside HTML/JSX -> ✅ lock blueprint + separated data + CSS custom properties first.
- ❌ Emitting purple-blue AI gradients, low-contrast muted text (`< 4.5:1`), or physical left/right CSS (`margin-left`, `text-align: left`) on Arabic/bilingual sites -> ✅ enforce WCAG 2.1 AA validated tokens, real Arabic webfonts, and CSS logical properties.
- ❌ Installing `vitest` or frontend packages in the Veycraft root -> ✅ execute every `npm`/`npx` command with `cwd` locked to `<portfolio-dir>` so root `package.json` stays `0/0`.
- ❌ Silencing failing unit tests, ignoring `375px` horizontal scrollbars, or looping past 3 self-healing attempts -> ✅ run real behavioral assertions and escalate cleanly if Cycle 3 still fails.

### Self-verification check (before reporting this step complete)
- [ ] `<portfolio-dir>/DESIGN_PLAN.md`, separated `portfolio-data.json`/`.ts`, `design-tokens.json`, and `tokens.css` exist, were confirmed before coding, and components contain `0` hardcoded hex colors or hardcoded resume prose
- [ ] active palette(s) pass WCAG 2.1 AA contrast (`>= 4.5:1` normal text, `>= 3.0:1` large text/UI), `prefers-reduced-motion` is respected, and Arabic/RTL mode (if enabled) uses real Arabic webfonts + CSS logical properties
- [ ] Layer 1 (type/build/links/alts/PII/anti-slop), Layer 2 (`node --test` or isolated `<portfolio-dir>` `vitest` behavioral suites), and Layer 3 (`375px`/`768px`/`1440px` viewport/overflow/console QA) all passed and wrote `<portfolio-dir>/qa-report.md`
- [ ] Veycraft root `package.json` stays at `0/0` dependencies, and any failed QA check either healed cleanly within `<= 3` cycles or halted `localhost` sign-off and deployment with the exact error log
