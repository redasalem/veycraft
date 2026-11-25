<div dir="rtl" align="right">

# Veycraft

**عمليات مهنية أصيلة لوكلاء الذكاء الاصطناعي، تفصيل سيرة ذاتية موثّق بالحقائق، ومحرك ذكاء البروفايل داخل محرّر البرمجة الذي تستخدمه بالفعل.**

[![Zero Core Dependencies](https://img.shields.io/badge/Core_CLI-0_NPM_Dependencies-2ea44f)](package.json)
[![Node >= 18](https://img.shields.io/badge/Node-%3E%3D18-339933)](package.json)
[![56 Markdown Skills](https://img.shields.io/badge/Skills-56_Markdown_Skills-167d60)](skills/REGISTRY.md)
[![Cross-Platform](https://img.shields.io/badge/OS-Windows_%7C_macOS_%7C_Linux-0969da)](.github/workflows/validate-repo.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-2ea44f)](LICENSE)
[![Veycraft MCP server](https://glama.ai/mcp/servers/redasalem/veycraft/badges/score.svg)](https://glama.ai/mcp/servers/redasalem/veycraft)

**[معاينة تفاعلية ↗](https://redasalem.github.io/veycraft/)** · **[البداية السريعة](#البداية-السريعة)** · **[توجيه وكلاء الذكاء الاصطناعي](#تثبيت-وتشغيل-Veycraft-عبر-وكلاء-الذكاء-الاصطناعي)** · **[مرجع CLI](#أوامر-cli)** · **[التحديث والإزالة](#التحديث-والإزالة)** · **[English](README.md)**

> *(سابقًا `job-hunter-os` — تحويلات GitHub التلقائية ومجلدات `~/.job-hunter-os` السابقة وأوامر `job-hunter` و`job-hunter-os` ما زالت مدعومة بالكامل دون فقدان أي بيانات.)*

- **صفر خبرات مختلقة:** كل رقم ومهارة وشركة وتاريخ يرتبط بحقائق مؤكدة من ملفك المحلي فقط، مع عزل المتطلبات غير المؤكدة في **الفجوات الحقيقية (`True Gaps`)**.
- **صفر إرسال أعمى:** وضع `dry_run: true` مفعّل افتراضيًا، وأي تقديم حي أو حفظ بروفايل أو نشر منشور أو بورتفوليو يتطلب موافقة بشرية صريحة (`APPROVE`).
- **صفر تبعيات npm:** أداة CLI مبنية بـ Node.js القياسي فقط (`>= 18.0.0`، `dependencies: {}`, `devDependencies: {}`) مع **56 مهارة Markdown محمولة (`agentskills.io`)** دون مفاتيح API خارجية أو خوادم سحابية.

جميع الأسماء والشركات والأرقام في المعاينة أدناه هي بيانات عرض اصطناعية من [`evals/fixtures/`](evals/fixtures/candidate-profile.md):

![عرض طرفية متحرك لمدة 10 ثوانٍ لأداة Veycraft v2.6.0: فحص doctor وتوجيه route وبوابة الأمان pre-submit](assets/demo.svg)

<div dir="ltr" align="left">

```diff
- Built backend APIs for an e-commerce and payments app using Node.js.
+ Built idempotent Node.js and TypeScript webhook processors backed by PostgreSQL and AWS SQS,
+ reducing payment webhook p95 latency by 38% across $4.2M daily settlement volume [verified: candidate-profile.md].
! Blocked claim: "Managed multi-cluster Kubernetes" (0 verified years — isolated under True Gaps)
[ATS Keyword Coverage: 71.4% -> 92.8% (heuristic comparison, not an ATS guarantee)]
[Status: dry_run: true · Awaiting explicit job-specific human APPROVE]
```

</div>

---

## البداية السريعة

يتطلب **Node.js `>= 18.0.0`** (Windows PowerShell/CMD وmacOS وLinux؛ **0 تبعيات تشغيل / 0 تبعيات تطوير**؛ Playwright وNotion MCP اختياريان تمامًا).

<div dir="ltr" align="left">

```bash
# الخطوة 1 — تشغيل فوري أو تثبيت عالمي عبر npm
npx --yes veycraft doctor        # أو: npm install -g veycraft

# الخطوة 2 — ربط محرّر الذكاء الاصطناعي بأمان دون حذف قواعدك (~/.veycraft)
veycraft init --global

# الخطوة 3 — شغّل الواجهة المحلية للقراءة فقط (127.0.0.1) أو افحص سيرتك محليًا
npx --yes veycraft ui            # واجهة ويب محلية من 5 تبويبات (Kanban، التحليلات، الاستوديو، 56 مهارة)
veycraft audit ./resume.docx --share
```

</div>

داخل محرّر الذكاء الاصطناعي، ابدأ فورًا بـ:
- **`/demo`** — محاكاة اصطناعية في 15 ثانية ([`examples/sandbox-demo/`](examples/sandbox-demo/sample-jds.md)) دون أي بيانات شخصية أو تسجيل دخول.
- **`/quick-tailor`** — تفصيل سيرتك لوظيفة واحدة (`HTML / TXT / .doc` متوافق مع Word + `True Gaps`) بدون متصفح.
- **`/profile-update`** · **`/github-audit`** · **`/build-portfolio`** · **`/portfolio-design`** · **`/linkedin-growth`** — مسارات مستقلة للبروفايل وGitHub وبناء/تصميم البورتفوليو ونمو لينكدإن.
- **`/setup` ← `/daily-run`** — النظام الكامل الاختياري عند الحاجة لأتمتة المتصفح وتجهيز التقديمات.

<details>
<summary>خيارات التثبيت البديلة (أحدث نسخة من GitHub، الاستنساخ المصدري، سكربتات التثبيت، ومسارات البيانات)</summary>

<div dir="ltr" align="left">

```bash
# أحدث نسخة من فرع main مباشرة عبر GitHub
npx --yes github:redasalem/veycraft doctor
npm install -g github:redasalem/veycraft

# للمطورين والمساهمين (تشغيل مباشر من المصدر بلا خطوة build)
git clone https://github.com/redasalem/veycraft.git && cd veycraft
node bin/cli.mjs doctor
npm link   # اختياري لربط الأمر محليًا
```

</div>

تتوفر سكربتات تثبيت قابلة للفحص (`--dry-run` / `--uninstall`) في [`scripts/install.sh`](scripts/install.sh) لأنظمة macOS/Linux و[`scripts/install.ps1`](scripts/install.ps1) لـ Windows PowerShell — افحص السكربت دائمًا قبل تشغيله.

| البيئة | المسار الافتراضي لبيانات المستخدم (محفوظة عند التحديث) |
|---|---|
| **Windows (PowerShell / CMD)** | `%USERPROFILE%\.veycraft` (يحتفظ تلقائيًا بأي مجلد سابق في `%USERPROFILE%\.job-hunter-os`) |
| **macOS** | `~/.veycraft` (يحتفظ تلقائيًا بأي مجلد سابق في `~/.job-hunter-os`) |
| **Linux** | `~/.veycraft`، أو `$XDG_DATA_HOME/veycraft` عند ضبط `XDG_DATA_HOME` |
| **مسار مخصص / الوضع المحلي** | `VEYCRAFT_HOME=/custom/path` أو المجلد الحالي عبر `veycraft init` (`.veycraft-install.json`) |

</details>

---

## تثبيت وتشغيل Veycraft عبر وكلاء الذكاء الاصطناعي

يدعم Veycraft بشكل أصيل **OpenAI Codex CLI** و**Claude Code** و**Gemini CLI** و**GitHub Copilot / VS Code** و**Cursor** و**Windsurf** و**Antigravity** و**Devin Desktop** و**Cline** و**Roo Code** و**OpenCode** و**AWS Kiro** و**JetBrains Junie** و**Zed** و**Goose** و**Aider** (راجع [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) و[`docs/chat-commands.md`](docs/chat-commands.md)).

<div dir="ltr" align="left">

```text
Install Veycraft, verify it with `veycraft doctor --json`, explain available capabilities,
and prepare it for this workspace. Do not modify personal data or perform live external
actions without explicit approval.
```

</div>

**اكتشاف برمجي منظم للوكلاء (`JSON`):** الأوامر `veycraft --version --json` و`veycraft doctor --json` و`veycraft status --json` و`veycraft route "<request>" --json` تعيد JSON منظمًا دون تعديل ملفات شخصية أو تنفيذ أي إجراءات خارجية. كما يوفّر `npx -y veycraft mcp` خادم MCP محليًا أصيلًا عبر `stdio` بصفر تبعيات يضم 8 أدوات قراءة فقط بلا شبكة وموارد `veycraft://` المسموحة ([`mcp/README.md`](mcp/README.md))، ويمكن معاينة ربطه أو تفعيله بأمر واحد عبر `veycraft sync-mcp --with-veycraft --dry-run` (مع نسخ احتياطية `.veycraft.bak` تلقائية عند التطبيق).

<details>
<summary>ربط أداة ذكاء اصطناعي محددة فقط (خيارات <code>--ide</code>)</summary>

<div dir="ltr" align="left">

```bash
veycraft init --global --ide codex       # ~/.codex/AGENTS.md + config.toml + ~/.agents/skills
veycraft init --global --ide claude      # ~/.claude/commands + ~/.claude/skills + ~/.claude.json
veycraft init --global --ide gemini      # ~/.gemini/GEMINI.md + settings.json + ~/.gemini/skills
veycraft init --global --ide copilot     # ~/.copilot/copilot-instructions.md + mcp-config.json
veycraft init --global --ide cursor      # ~/.cursor/rules/job-hunter.mdc + ~/.cursor/mcp.json
veycraft init --global --ide windsurf    # ~/.windsurf/rules/ + workflows + mcp_config.json
veycraft init --global --ide antigravity # ~/.gemini/antigravity/global_workflows + mcp_config.json
```

</div>

</details>

---

## القدرات الأساسية

| القدرة | الأمر / التفعيل | أبرز المزايا |
|---|---|---|
| **تفصيل سيرة ذاتية موثّق** | `/quick-tailor` أو `/tailor-cv` أو طلب طبيعي | `HTML + TXT + .doc` متوافق مع Word (بدون تزوير `.docx`)، خريطة أدلة، مقارنة كلمات ATS، عزل `True Gaps`، والحفاظ على الملف الأصلي |
| **محرك ذكاء البروفايل** | `/profile-update` أو *"حسّن ملفي المهني"* | تدقيق من 7 معايير عبر `linkedin` و`wellfound` و`ats` و`job_boards` و`portfolio` ووضع `generic` الاحتياطي، وخطة `DRAFT_ONLY` (`add`/`replace` فقط) والتحقق بالقراءة بعد الحفظ |
| **تدقيق GitHub واستخراج مشاريع CV** | `/github-audit` أو *"دقّق مستودعات GitHub"* | فحص شامل عبر `gh` CLI، واستخراج مشاريع موثّقة إلى `context/github-projects.md`، وتحسين الـ README بوضع `DRAFT_ONLY`، وتنظيف متدرّج (`private`/`archive` ثم بوابة `DELETE <owner>/<repo>`) |
| **بناء ونشر موقع البورتفوليو** | `/build-portfolio` أو *"ابنِ موقع بورتفوليو لي"* | بناء معزول داخل `logs/portfolio/<slug>/` (`HTML/CSS/JS` أو `Astro` أو `Vite+React` أو `Next.js`)، فحص الخصوصية والأسرار، معاينة `LOCAL_PREVIEW_ONLY`، ونشر مشروط بـ `APPROVE` عبر `vercel`/`wrangler`/`netlify`/`gh`/`firebase`/`surge` أو البديل الذكي |
| **استوديو تصميم واختبار البورتفوليو** | `/portfolio-design` أو *"صمّم ألوان واختبر البورتفوليو"* | مخطط `DESIGN_PLAN.md` + فصل `portfolio-data`، 7 لوحات ألوان احترافية + `Custom` بمعيار `WCAG 2.1 AA` (`tokens.css` وخطوط عربية RTL)، 3 طبقات QA (`node --test`/`vitest` معزول + `375px`/`768px`/`1440px` ← `qa-report.md`)، وإصلاح ذاتي حتى 3 دورات |
| **نمو وSEO لينكدإن** | `/linkedin-growth` | محرك مزدوج لبروز البحث أمام مسؤولي التوظيف (`0–100`، ربط المهارات بالأدوار، قمع التحويل) وخوارزمية الخلاصة (المرجعية الموضوعية، `Comment-First`، مصفوفة الصيغ، منع الخرافات والـ Pods) بوضع `DRAFT_ONLY` ثم `APPROVE` وتواصل `<= 75` كلمة |
| **اكتشاف متعدد المصادر وتجهيز ATS** | `/daily-run` أو `/apply-url <url>` | LinkedIn وWellfound وIndeed وGlassdoor وGreenhouse وLever وAshby وWorkday وSmartRecruiters وبوابات الشرق الأوسط وشبكات B2B ([`skills/platforms/b2b-contract-networks.md`](skills/platforms/b2b-contract-networks.md)) أو أي رابط وظيفة HTTPS |
| **المقابلات والعروض والعقود** | طلب باللغة الطبيعية | `interview-dossier.md`، خطط اختبارات تقنية، مسودات تفاوض راتب، وتدقيق بنود عقود وNDA من 6 فئات |
| **وضع العمل المحلي الكامل** | `veycraft bundle` / مصفوفة البدائل `A–E` | يعمل 100% محليًا بدون Playwright أو Notion مع بدائل جاهزة للنسخ وسجلات JSON محلية |

---

## أوامر CLI

الأسماء البديلة القديمة `job-hunter` و`job-hunter-os` تشير لنفس الملف التنفيذي `bin/cli.mjs` حفاظًا على التوافق العكسي.

| الأمر | الوظيفة |
|---|---|
| `veycraft --help` / `--version [--json]` | عرض دليل الاستخدام (قراءة فقط) أو الإصدار وبيانات الأصل |
| `veycraft doctor [--global] [--strict] [--json]` | فحص Node والأصل والـ 56 مهارة والبوابات الـ 5 وحداثة الكتيبات وخطاف الخصوصية وإعدادات MCP |
| `veycraft init [--global] [--force] [--ide <name>]` | تهيئة `~/.veycraft` (أو المجلد الحالي) وربط مهارات المحررات ومزامنة MCP دون حذف القواعد القائمة |
| `veycraft route "<request>" [--json]` | توجيه أي طلب طبيعي (عربي أو إنجليزي) لأقل مجموعة مهارات مناسبة مع البديل الآمن |
| `veycraft audit <cv.md\|txt\|docx\|html\|doc> [--share]` | فحص محلي للسيرة الذاتية وكشف `.docx` المزيف والـ PDF المصوّر وروابط SSRF وإنتاج بطاقة خالية من PII |
| `veycraft verify <dir\|file> [--facts <json\|md>]` | التحقق بعد الكتابة من المخرجات وسجلات التقديم ونقاط حفظ الجلسة وإصدارات الـ CV وخطط Notion و`Profile Update Plan` |
| `veycraft career summary\|analytics\|dashboard\|next [--json]` | ملخص التقديمات، تحليلات حتمية (`MIN_N = 5`)، لوحة Kanban HTML محلية للقراءة فقط، وقائمة الأولويات |
| `veycraft ui [--port <n>] [--no-open] [--workspace <dir> \| -g]` | واجهة ويب محلية للقراءة فقط على `127.0.0.1` بلا شبكة (الجاهزية، Kanban، التحليلات، استوديو الفحص بالذاكرة، و56 مهارة) |
| `veycraft mcp [--global]` | خادم MCP محلي أصيل عبر `stdio` بصفر تبعيات (8 أدوات قراءة فقط بلا شبكة + موارد `veycraft://` — [`mcp/README.md`](mcp/README.md)) |
| `veycraft pre-submit` / `veycraft eval` | فرض الحدود اليومية وحد الإحماء وقواطع الحماية ومنع التكرار والكليشيهات وحد `<= 75` كلمة؛ تشغيل اختبارات `20/20` و`124/124` |

<details>
<summary>مرجع CLI المتقدم (محرك الجلسات، السجل الذرّي المحمي بقفل، مزامنة Notion، والصيانة)</summary>

| الأمر | الوظيفة |
|---|---|
| `veycraft career run-start\|run-triage\|run-enqueue\|prepare\|run-checkpoint\|run-resume\|run-finish [--help]` | محرك الجلسة اليومية ونقاط الحفظ وفرز `Tier A/B/C` وطابور الموافقة المرحلية (`submission_authorized: false`) والتحقق من حزمة التقديم |
| `veycraft career record\|reserve\|confirm-submit\|transition\|skip\|cv-register [--help]` | كتابة ذرّية محمية بقفل (`logs/.ledger.lock`) لسجل التقديمات والمستبعدات وإصدارات الـ CV (+ `lock-status` و`release-stale-lock` و`recover-tx`) |
| `veycraft career migrate [--dry-run \| --apply]` / `cv-versions [--json]` | ترقية آمنة مع نسخة احتياطية إلى مخطط `v2.0` (`--dry-run` افتراضيًا) وسجل إصدارات السيرة للمالك (مع عزل ملفات الغير) |
| `veycraft career sync <subcommand> [--help]` | محرك مزامنة أحادي الاتجاه إلى Notion (`preview`، `status`، `verify-schema`، `approve`، `mark-in-flight`، `apply-receipt`، `record-failure`، `expire-stale`، `reconcile`، `reset-permanent`، `release-stale-lock`) بلا كتابة خارجية من الـ CLI |
| `veycraft status [--global] [--json]` | عرض حالة البوابات والحد اليومي وملخص التقديمات |
| `veycraft proof` / `dashboard [--global] [--no-open]` / `bundle` | توليد بطاقة الإثبات، فتح لوحة Kanban الكلاسيكية، أو تصدير برومبت ويب شات موحد |
| `veycraft sync-mcp [--with-veycraft] [--dry-run]` / `login` / `unlock` / `backup` / `update` | مزامنة MCP (مع نسخ `.veycraft.bak` احتياطية)، فتح متصفح دائم، إزالة الأقفال العالقة، النسخ الاحتياطي الشامل، أو التحديث الموقّع بـ SSH |

*(ملاحظة: عند تمرير `--global` أو `-g` مع أوامر `career` مثل `career sync` أو `career record` أو `career next`، ضعه قبل `career`، مثلًا: `veycraft --global career sync status`.)*

</details>

---

## الخصوصية والأمان وبوابات الموافقة

يفصل Veycraft بوضوح بين **الفحوصات الحتمية في الكود** و**قواعد عمل الوكيل** ([`docs/execution-safety.md`](docs/execution-safety.md) · [`ACCEPTANCE.md`](ACCEPTANCE.md)):

- **ضوابط CLI الحتمية:** فرض صلاحيات المنصات، التحقق من الحقائق والكليشيهات والمخططات (`verify`، `audit`، `pre-submit`)، كتابة ذرّية محمية بقفل، مزامنة Notion أحادية الاتجاه بقاطع أمان حي وتوقيع `--plan-hash` وصلاحية 24 ساعة، خطاف `.git/hooks/pre-commit` لمنع تسريب PII، والتحديث الموقّع بـ SSH.
- **بوابات الوكيل:** الحماية من حقن الأوامر في صفحات الويب، قاعدة رفع الـ CV أولًا، جدول قراءة DOM الحي، وضع `DRAFT_ONLY` افتراضيًا، قاطع الحماية 24 ساعة، وموافقة بشرية صريحة (`APPROVE`) قبل أي إرسال أو حفظ.
- **صفر تسريب للبيانات الخاصة:** مجلدات `context/*` (عدا `*.example`) و`logs/` و`*.pdf` و`browser-profile/` و`.env` محجوبة عن Git ومستبعدة تمامًا من حزمة npm (`npm run pack:check`).

![بطاقة الإثبات القابلة لإعادة الإنتاج لمشروع Veycraft](assets/proof-card.svg)

---

## التحديث والإزالة

التحديث أو إزالة أداة CLI **لا يحذف ولا يستبدل أبدًا** ملفاتك الخاصة في `context/` أو `logs/` أو `config/guardrails.yaml` أو `browser-profile/`.

<div dir="ltr" align="left">

```bash
# تحديث الأداة عالميًا وتحديث المهارات وروابط المحررات بأمان
npm update -g veycraft && veycraft update --global

# إزالة الأمر العالمي فقط (تبقى بياناتك في ~/.veycraft سليمة)
npm uninstall -g veycraft
# اختياري لمسح البيانات نهائيًا: rm -rf ~/.veycraft  (Windows: Remove-Item -Recurse -Force "$HOME\.veycraft")
```

</div>

---

## التطوير والاختبار والمساهمة

<div dir="ltr" align="left">

```bash
git clone https://github.com/redasalem/veycraft.git && cd veycraft
npm test             # eval --baseline (20/20) و live-agent-eval-run (20/20) و eval --journeys (116/116)
npm run pack:check   # التحقق من محتويات حزمة npm وخلوها من أي ملفات خاصة
node bin/cli.mjs doctor
```

</div>

- **فهرس الوثائق:** [`AGENTS.md`](AGENTS.md) · [`skills/REGISTRY.md`](skills/REGISTRY.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SKILL_CATALOG.md`](docs/SKILL_CATALOG.md) · [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) · [`docs/chat-commands.md`](docs/chat-commands.md) · [`docs/execution-safety.md`](docs/execution-safety.md) · [`ACCEPTANCE.md`](ACCEPTANCE.md) · [`examples/outputs/sample-tailoring-notes.md`](examples/outputs/sample-tailoring-notes.md) · [`PLATFORMS.md`](PLATFORMS.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)
- **المساهمة:** راجع [`CONTRIBUTING.md`](CONTRIBUTING.md) و[`ACCEPTANCE.md`](ACCEPTANCE.md) و[`HIRED.md`](HIRED.md)، أو شارك نتيجة توظيف عبر [Share Outcome Issue](https://github.com/redasalem/veycraft/issues/new?template=share-success.yml).

## الرخصة والأصل

مرخص تحت رخصة [MIT](LICENSE) — Copyright (c) 2026 Reda Salem (`@redasalem`). راجع [`NOTICE`](NOTICE) و[`AUTHORS.md`](AUTHORS.md) و[`PROVENANCE.json`](PROVENANCE.json).

</div>
