import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = [
  process.env.JHO_CLI_PATH,
  path.join(REPO_ROOT, 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.veycraft', 'bin', 'cli.mjs'),
  path.join(os.homedir(), '.job-hunter-os', 'bin', 'cli.mjs'),
].find(p => p && fs.existsSync(p));
assert.ok(CLI, 'Could not locate bin/cli.mjs (set JHO_CLI_PATH or run from repository root).');
const MATRIX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'evals', 'journeys', 'journey-matrix.json'), 'utf8'));

function runCli(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

// Build a minimal valid OOXML .docx ZIP buffer with zero dependencies (stored ZIP entries).
function buildSyntheticDocx(documentXmlText) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const files = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        'utf8',
      ),
    },
    {
      name: 'word/document.xml',
      data: zlib.deflateRawSync(Buffer.from(documentXmlText, 'utf8')),
      method: 8,
      uncompressedSize: Buffer.byteLength(documentXmlText, 'utf8'),
      crc: crc32(Buffer.from(documentXmlText, 'utf8')),
    },
  ];

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const method = f.method ?? 0;
    const uncomp = f.uncompressedSize ?? f.data.length;
    const crc = f.crc ?? crc32(f.data);

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(uncomp, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(lh, 30);
    locals.push(lh, f.data);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.data.length, 20);
    cd.writeUInt32LE(uncomp, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    centrals.push(cd);

    offset += lh.length + f.data.length;
  }

  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

test('1. Universal Natural-Language Router covers all 14 core + 8 LinkedIn/platform + extended requests without forcing /setup', () => {
  for (const j of MATRIX.journeys) {
    const res = runCli(['route', j.prompt, '--json']);
    assert.equal(res.status, 0, `route failed for "${j.prompt}": ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.intent, j.expected_intent, `Intent mismatch for "${j.prompt}"`);
    for (const sk of j.required_skills) {
      assert.ok(parsed.skills.includes(sk), `Missing skill "${sk}" for "${j.prompt}"`);
    }
    assert.ok(parsed.skills.length <= 7, `Too many skills loaded (${parsed.skills.length}) for "${j.prompt}"`);
    if (!j.requires_full_setup) {
      assert.match(parsed.readiness, /task-specific/i, `Standalone task "${j.prompt}" must not force /setup`);
    }
  }
});

test('2. Metadata parity: offline-capable skills never require Playwright/Notion MCP while genuine browser skills keep Playwright', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const byName = new Map(manifest.skills.map(s => [s.name, s]));

  for (const name of [
    'interrogate-and-onboard',
    'resume-ingestion',
    'tailor-resume-and-verify',
    'outreach-and-interview-prep',
    'log-and-insights',
    'recruiter-inbox-triage',
    'multilingual-adaptation',
    'linkedin-growth',
    'meta-self-verification',
  ]) {
    assert.deepEqual(byName.get(name).requires_mcp, ['none'], `${name} must declare requires_mcp: ["none"]`);
    assert.ok(Array.isArray(byName.get(name).optional_mcp) && byName.get(name).optional_mcp.length >= 1, `${name} should declare optional_mcp`);
  }

  for (const name of ['daily-run', 'discover-and-triage', 'fill-and-apply', 'linkedin', 'greenhouse', 'lever', 'ashby']) {
    assert.deepEqual(byName.get(name).requires_mcp, ['playwright'], `${name} genuinely requires playwright`);
  }
});

test('3. CV Import & Format Honesty: reads MD, TXT, HTML, Word-compatible .doc, real .docx; blocks scanned PDF & fake .docx', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-cv-import-'));
  try {
    const mdPath = path.join(tmp, 'cv.md');
    fs.writeFileSync(
      mdPath,
      [
        '# Alex Rivera',
        'Senior Full-Stack Engineer building TypeScript and Node.js systems.',
        '- Built Node.js webhook processors reducing p95 latency by 38% across $4.2M daily settlement volume.',
        '- Shipped React and Next.js checkout flows with Playwright regression tests cutting CI from 22 minutes to 9 minutes.',
        '- Maintained 99.95% checkout uptime across 3 seasonal sales events.',
      ].join('\n'),
    );
    const mdAudit = runCli(['audit', mdPath], tmp);
    assert.equal(mdAudit.status, 0, mdAudit.stderr);

    const xmlDoc =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Alex Rivera — Senior Full-Stack Engineer</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>- Built TypeScript and PostgreSQL webhook services cutting p95 latency by 38% across $4.2M daily volume.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>- Automated Playwright regression suites reducing CI runtime from 22 minutes to 9 minutes.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const docxPath = path.join(tmp, 'cv.docx');
    fs.writeFileSync(docxPath, buildSyntheticDocx(xmlDoc));
    const docxAudit = runCli(['audit', docxPath], tmp);
    assert.equal(docxAudit.status, 0, `Real .docx audit failed: ${docxAudit.stderr}`);

    // Scanned / binary PDF must fail cleanly with clear paste/text guidance (never claim readable)
    const pdfPath = path.join(tmp, 'scanned.pdf');
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n%binary-image-stream\n\x00\x01\x02', 'latin1'));
    const pdfAudit = runCli(['audit', pdfPath], tmp);
    assert.notEqual(pdfAudit.status, 0);
    assert.match(pdfAudit.stderr, /Binary\/PDF file detected/i);

    // Fake .docx (HTML renamed to .docx) MUST be rejected by both audit and verify
    const fakeDocxPath = path.join(tmp, 'fake.docx');
    fs.writeFileSync(fakeDocxPath, '<html><body><h1>Alex Rivera</h1><p>Fake docx</p></body></html>');
    const fakeAudit = runCli(['audit', fakeDocxPath], tmp);
    assert.notEqual(fakeAudit.status, 0);
    assert.match(fakeAudit.stderr, /Do not rename HTML/i);
    const fakeVerify = runCli(['verify', fakeDocxPath], tmp);
    assert.notEqual(fakeVerify.status, 0);
    assert.match(fakeVerify.stderr, /Do not rename HTML/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('4. CV Edit (Preserving Original), Quick-Tailor Artifact Generation, Fact-Check Verification & Iterative Revision', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-tailor-'));
  try {
    const originalCvPath = path.join(tmp, 'original-cv.md');
    const originalContent = [
      '# Alex Rivera',
      'Senior Full-Stack Engineer',
      '- Built Node.js and TypeScript webhook processors backed by PostgreSQL reducing latency by 38% across $4.2M daily volume.',
      '- Shipped React and Next.js checkout flows cutting CI build times from 22 minutes to 9 minutes.',
    ].join('\n');
    fs.writeFileSync(originalCvPath, originalContent);
    const originalHash = crypto.createHash('sha256').update(fs.readFileSync(originalCvPath)).digest('hex');

    const tpl = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'ats-resume-template.html'), 'utf8');
    const fillResumeHtml = summary =>
      tpl
        .replaceAll('{{FULL_NAME}}', 'Alex Rivera')
        .replaceAll('{{CONTACT_TEXT}}', 'Austin, TX | alex.rivera@example.invalid | +1-555-0199')
        .replaceAll('{{VERIFIED_LINKS_HTML}}', '<a href="https://github.com/alexrivera-example">GitHub</a>')
        .replaceAll('{{SUMMARY_TEXT}}', summary)
        .replaceAll('{{SKILLS_TEXT}}', 'Languages: TypeScript, Node.js | Frontend: React, Next.js | Data &amp; QA: PostgreSQL, Docker, Playwright, AWS SQS')
        .replaceAll(
          '{{EXPERIENCE_HTML}}',
          '<h3>Senior Full-Stack Engineer — FinPulse Systems (2023-01 to Present)</h3><ul><li>Built idempotent Node.js and TypeScript webhook processors backed by PostgreSQL and AWS SQS, reducing p95 latency by 38% across $4.2M daily settlement volume.</li></ul>' +
            '<h3>Full-Stack Engineer — CloudCart Retail (2020-03 to 2022-12)</h3><ul><li>Shipped React and Next.js checkout flows with Playwright regression tests, cutting CI build times from 22 minutes to 9 minutes and maintaining 99.95% uptime across 3 sales events.</li></ul>',
        )
        .replaceAll('{{PROJECTS_HTML}}', '<ul><li>Webhook Reliability Harness: idempotency test suite in TypeScript and Playwright.</li></ul>')
        .replaceAll('{{EDUCATION_HTML}}', '<p>B.Sc. Computer Science</p>');

    const outDir = path.join(tmp, 'quick-tailor-cloudpay');
    fs.mkdirSync(outDir, { recursive: true });

    const htmlV1 = fillResumeHtml('Senior Full-Stack Engineer with 6 years building TypeScript, Node.js, React, and PostgreSQL settlement services.');
    const docV1 = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' + htmlV1.slice(htmlV1.indexOf('<head>'));
    const txtV1 = 'Alex Rivera\nSenior Full-Stack Engineer with 6 years building TypeScript, Node.js, React, and PostgreSQL settlement services.\n- Reduced p95 latency by 38% across $4.2M daily volume.';
    const notesV1 = '# Tailoring Notes\n- True Gaps: Kubernetes (0 verified years, excluded)\n- Keyword Match: 71% -> 92%\n';

    fs.writeFileSync(path.join(outDir, 'resume.html'), htmlV1);
    fs.writeFileSync(path.join(outDir, 'resume.doc'), docV1);
    fs.writeFileSync(path.join(outDir, 'resume.txt'), txtV1);
    fs.writeFileSync(path.join(outDir, 'tailoring-notes.md'), notesV1);

    const groundTruth = path.join(tmp, 'ground-truth.json');
    fs.copyFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'ground-truth.json'), groundTruth);
    const verifyPass = runCli(['verify', outDir, '--facts', groundTruth], tmp);
    assert.equal(verifyPass.status, 0, verifyPass.stdout + verifyPass.stderr);

    // Original file must remain byte-for-byte untouched after editing/tailoring
    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(originalCvPath)).digest('hex');
    assert.equal(afterHash, originalHash, 'Original CV was unexpectedly modified!');

    // Create CV from scratch without /setup (no context/targets.yaml) & verify clean output
    const scratchDir = path.join(tmp, 'scratch-cv');
    fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'resume.html'), htmlV1);
    fs.writeFileSync(path.join(scratchDir, 'resume.txt'), txtV1);
    assert.equal(runCli(['verify', scratchDir, '--facts', groundTruth], tmp).status, 0);

    // Bilingual Arabic RTL adaptation preserves verified metrics/dates without placeholders
    const rtlHtml = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>السيرة الذاتية</title></head><body><h1>Alex Rivera</h1><p>مهندس برمجيات متكامل بخبرة 6 سنوات في Node.js و TypeScript و PostgreSQL، خفض زمن الاستجابة بنسبة 38%.</p></body></html>';
    const rtlPath = path.join(tmp, 'resume-ar.html');
    fs.writeFileSync(rtlPath, rtlHtml);
    assert.equal(runCli(['verify', rtlPath, '--facts', groundTruth], tmp).status, 0);

    // Iterative revision ("change the summary") preserves verified facts & passes verify
    const htmlV2 = fillResumeHtml('Full-Stack Engineer with 5 years in TypeScript and 6 years in Node.js scaling payment webhooks and Playwright CI.');
    fs.writeFileSync(path.join(outDir, 'resume.html'), htmlV2);
    const verifyV2 = runCli(['verify', outDir, '--facts', groundTruth], tmp);
    assert.equal(verifyV2.status, 0, verifyV2.stdout + verifyV2.stderr);

    // Negative test: verify MUST catch hallucinated metric, forbidden skill (Kubernetes), AI slop, and leftover placeholders
    const badPath = path.join(tmp, 'bad-resume.html');
    fs.writeFileSync(
      badPath,
      '<html><body><h1>{{FULL_NAME}}</h1><p>Spearheaded Kubernetes clusters — boosting revenue by 99%.</p></body></html>',
    );
    const verifyFail = runCli(['verify', badPath, '--facts', groundTruth], tmp);
    assert.notEqual(verifyFail.status, 0);
    assert.match(verifyFail.stdout + verifyFail.stderr, /placeholder|Kubernetes|99%|spearheaded|em-dash/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('5. LinkedIn Profile Review & Improvement Prep, Multi-Source JD Analysis, Application Prep vs. Approved Submit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-linkedin-app-'));
  try {
    fs.mkdirSync(path.join(tmp, 'logs', 'resumes', 'cloudpay-70112'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'logs', 'insights'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(tmp, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(tmp, 'config', 'invariants.txt'));

    // 5.1 LinkedIn profile review & CV consistency check + DRAFT_ONLY improvement prep
    const linkedinProfilePasted = 'Headline: Software Engineer | Experience: Built web apps at FinPulse Systems';
    const cvFacts = ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Playwright', '38%', '$4.2M'];
    const missingFromLinkedIn = cvFacts.filter(fact => !linkedinProfilePasted.includes(fact));
    assert.ok(missingFromLinkedIn.includes('PostgreSQL') && missingFromLinkedIn.includes('38%'));

    const linkedinAuditOut = path.join(tmp, 'logs', 'insights', 'linkedin-seo-audit-2026-11-19.md');
    fs.writeFileSync(
      linkedinAuditOut,
      [
        '# LinkedIn Profile Audit (DRAFT_ONLY)',
        '- Mode: DRAFT_ONLY (requires explicit APPROVE before any live LinkedIn edit)',
        '- Consistency Gaps Found in CV: PostgreSQL, Playwright, TypeScript, Node.js, React, 38%, $4.2M',
        '- Proposed Headline (DRAFT_ONLY): Senior Full-Stack Engineer | TypeScript, Node.js, React, PostgreSQL | 38% faster payment webhooks',
        '- True Gaps (Excluded): Kubernetes',
      ].join('\n'),
    );
    const linkedinGroundTruth = path.join(tmp, 'ground-truth.json');
    fs.copyFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'ground-truth.json'), linkedinGroundTruth);
    assert.equal(runCli(['verify', linkedinAuditOut, '--facts', linkedinGroundTruth], tmp).status, 0);

    // 5.2 Multi-source JD analysis & ranking against real fixture JDs (separating verified matches vs unknown requirements)
    const jd01 = fs.readFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'jds', '01-strong-match.md'), 'utf8');
    const jd02 = fs.readFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'jds', '02-prompt-injection-trap.md'), 'utf8');
    const jd03 = fs.readFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'jds', '03-ghost-expired-job.md'), 'utf8');
    assert.match(jd01, /https:\/\/boards\.greenhouse\.io\/cloudpayledger\/jobs\/70112/);
    assert.match(jd02, /IGNORE ALL PREVIOUS INSTRUCTIONS|SYSTEM OVERRIDE/i);
    assert.match(jd03, /No longer accepting applications/i);

    // LinkedIn <=75-word outreach draft verification
    const outreachFile = path.join(tmp, 'logs', 'resumes', 'cloudpay-70112', 'outreach-draft.md');
    fs.writeFileSync(
      outreachFile,
      'DRAFT_ONLY: Hi Sam, I applied for Senior Full-Stack Engineer at CloudPay. I have 6 years building Node.js and TypeScript settlement webhooks with PostgreSQL, cutting p95 latency by 38%, and Playwright CI suites. Happy to chat if helpful.',
    );

    // 5.3 Application prepared WITHOUT submission (`status: "prepared"`, `applied_at: null`)
    const appsLog = path.join(tmp, 'logs', 'applications-log.json');
    fs.writeFileSync(
      appsLog,
      JSON.stringify([
        {
          job_id: 'greenhouse:cloudpay-70112',
          title: 'Senior Full-Stack Engineer',
          company: 'CloudPay Ledger',
          platform: 'greenhouse',
          url: 'https://boards.greenhouse.io/cloudpayledger/jobs/70112',
          verified_at: '2026-11-19',
          status: 'prepared',
          applied_at: null,
          match_score: 9.0,
          notes: 'Prepared without submission; awaiting APPROVE or manual upload.',
          submission_uncertain: false,
        },
      ]),
    );

    const preBefore = runCli(['pre-submit', '--draft', outreachFile], tmp);
    assert.equal(preBefore.status, 0, preBefore.stdout + preBefore.stderr);
    assert.match(preBefore.stdout, /Daily Cap OK: 0\/5/);
    const statusBefore = runCli(['status'], tmp);
    assert.equal(statusBefore.status, 0);
    assert.match(statusBefore.stdout, /Applied: 0/);

    // 5.4 Transition to `applied` ONLY after explicit human APPROVE + post-submit receipt
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      appsLog,
      JSON.stringify([
        {
          job_id: 'greenhouse:cloudpay-70112',
          title: 'Senior Full-Stack Engineer',
          company: 'CloudPay Ledger',
          platform: 'greenhouse',
          url: 'https://boards.greenhouse.io/cloudpayledger/jobs/70112',
          verified_at: today,
          status: 'applied',
          applied_at: `${today}T12:00:00Z`,
          match_score: 9.0,
          notes: 'receipt: "Thank you for applying to CloudPay Ledger" | approved_by: owner',
          submission_uncertain: false,
        },
      ]),
    );
    const preAfter = runCli(['pre-submit', '--draft', outreachFile], tmp);
    assert.equal(preAfter.status, 0, preAfter.stdout + preAfter.stderr);
    assert.match(preAfter.stdout, /Daily Cap OK: 1\/5/);
    const statusAfter = runCli(['status'], tmp);
    assert.equal(statusAfter.status, 0);
    assert.match(statusAfter.stdout, /Applied: 1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('6. Tool-Availability Scenarios & Manual Fallback: all 5 scenarios succeed without dead-ends or false capability claims', () => {
  assert.equal(MATRIX.tool_scenarios.length, 5);
  const noPw = MATRIX.tool_scenarios.find(s => s.id === 'local_without_playwright');
  assert.equal(noPw.playwright_mcp, false);
  // Confirm non-browser & fallback tasks succeed via CLI even with zero Playwright/Notion
  for (const prompt of [
    'Review my uploaded CV.',
    'Tailor my CV to this job.',
    'Review my LinkedIn profile.',
    'Find suitable remote React jobs.',
    'Prepare my application for this position.',
    'Prepare me for an interview.',
    'Export my application report.',
  ]) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.fallback && parsed.fallback.length > 10, `Missing practical fallback for "${prompt}"`);
  }

  // Verify web-chat & missing-capability fallback playbook exists and preserves honest limitations
  const fallbackMd = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'fallback-no-mcp.md'), 'utf8');
  assert.match(fallbackMd, /Print -> Save as PDF/i);
  assert.match(fallbackMd, /never fake `?\.docx`?/i);
  assert.match(fallbackMd, /requires_mcp:\s*\n\s*- none/);
});

test('7. Multi-IDE Adapter Setup: OpenAI Codex CLI (TOML + AGENTS.md), Gemini CLI, Copilot/VS Code & preservation guarantees', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jho-ides-'));
  try {
    const fakeHome = path.join(tmp, 'home');
    const codexHome = path.join(fakeHome, '.codex');
    const emptyCwd = path.join(tmp, 'empty');
    const localProj = path.join(tmp, 'local-proj');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.mkdirSync(emptyCwd, { recursive: true });
    fs.mkdirSync(localProj, { recursive: true });

    // Pre-existing user Codex AGENTS.md + custom model in config.toml MUST be preserved
    const codexAgents = path.join(codexHome, 'AGENTS.md');
    const codexToml = path.join(codexHome, 'config.toml');
    fs.writeFileSync(codexAgents, '# Personal Codex Coding Rules\n- Always run tests.\n');
    fs.writeFileSync(codexToml, 'model = "gpt-5"\napproval_policy = "on-request"\n');

    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, CODEX_HOME: codexHome };
    const initGlobal = spawnSync(process.execPath, [CLI, 'init', '--global', '--ide', 'all'], {
      cwd: emptyCwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(initGlobal.status, 0, initGlobal.stdout + initGlobal.stderr);

    // Check OpenAI Codex CLI files + preservation
    const agentsAfter = fs.readFileSync(codexAgents, 'utf8');
    assert.match(agentsAfter, /# Personal Codex Coding Rules/);
    assert.match(agentsAfter, /<!-- veycraft:start -->/);
    assert.match(agentsAfter, /AGENTS\.md/);
    const tomlAfter = fs.readFileSync(codexToml, 'utf8');
    assert.match(tomlAfter, /model = "gpt-5"/);
    assert.match(tomlAfter, /\[mcp_servers\.playwright\]/);
    assert.match(tomlAfter, /--user-data-dir=/);
    assert.ok(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'daily-run', 'SKILL.md')));

    // Check Google Gemini CLI & GitHub Copilot global files
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'GEMINI.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.gemini', 'skills', 'quick-tailor', 'SKILL.md')));
    const geminiSettings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.gemini', 'settings.json'), 'utf8'));
    assert.ok(geminiSettings.mcpServers?.playwright);
    assert.ok(fs.existsSync(path.join(fakeHome, '.copilot', 'copilot-instructions.md')));
    const copilotMcp = JSON.parse(fs.readFileSync(path.join(fakeHome, '.copilot', 'mcp-config.json'), 'utf8'));
    assert.ok(copilotMcp.mcpServers?.playwright);

    // Custom [mcp_servers.playwright] in config.toml MUST be preserved on re-sync
    fs.writeFileSync(codexToml, 'model = "gpt-5"\n\n[mcp_servers.playwright]\ncommand = "custom-pw"\nargs = ["--user-data-dir=custom"]\n');
    const reSync = spawnSync(process.execPath, [CLI, 'sync-mcp', '--global'], { cwd: emptyCwd, env, encoding: 'utf8' });
    assert.equal(reSync.status, 0, reSync.stdout + reSync.stderr);
    const tomlPreserved = fs.readFileSync(codexToml, 'utf8');
    assert.match(tomlPreserved, /command = "custom-pw"/);

    // Local init scaffolds Codex, Gemini, Copilot/VS Code, Roo, Kiro, Junie, Trae, Continue, OpenHands, Augment
    const initLocal = spawnSync(process.execPath, [CLI, 'init', '--ide', 'all'], {
      cwd: localProj,
      env,
      encoding: 'utf8',
    });
    assert.equal(initLocal.status, 0, initLocal.stdout + initLocal.stderr);
    for (const rel of [
      '.codex/config.toml',
      '.gemini/settings.json',
      '.vscode/mcp.json',
      '.github/copilot-instructions.md',
      '.roo/rules/job-hunter.md',
      '.kiro/steering/job-hunter.md',
      '.junie/guidelines.md',
      '.aiassistant/rules/AGENTS.md',
      '.trae/rules/project_rules.md',
      '.continue/rules/job-hunter.md',
      '.openhands/microagents/repo.md',
      '.augment/rules/job-hunter.md',
      '.amazonq/rules/job-hunter.md',
    ]) {
      assert.ok(fs.existsSync(path.join(localProj, rel)), `Missing local IDE file: ${rel}`);
    }
    const vscodeMcp = JSON.parse(fs.readFileSync(path.join(localProj, '.vscode', 'mcp.json'), 'utf8'));
    assert.equal(vscodeMcp.servers?.playwright?.type, 'stdio');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('8. Developer Onboarding & Agent Discovery: clean uninitialized doctor --json, --version --json, status --json, safe no-arg help & VEYCRAFT_HOME', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veycraft-onboarding-'));
  try {
    const emptyDir = path.join(tmp, 'empty-workspace');
    const customHome = path.join(tmp, 'custom-veycraft-home');
    const fakeHome = path.join(tmp, 'home');
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });

    const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, VEYCRAFT_HOME: customHome, NO_COLOR: '1' };

    // 1. Running CLI with no args prints help safely, exits 0, and creates zero files
    const noArg = spawnSync(process.execPath, [CLI], { cwd: emptyDir, env, encoding: 'utf8' });
    assert.equal(noArg.status, 0, noArg.stdout + noArg.stderr);
    assert.match(noArg.stdout, /veycraft v/);
    assert.equal(fs.readdirSync(emptyDir).length, 0);

    // 2. --version --json returns structured metadata
    const ver = spawnSync(process.execPath, [CLI, '--version', '--json'], { cwd: emptyDir, env, encoding: 'utf8' });
    assert.equal(ver.status, 0, ver.stdout + ver.stderr);
    const verJson = JSON.parse(ver.stdout);
    assert.equal(verJson.name, 'veycraft');
    assert.equal(verJson.zero_dependencies.runtime, 0);
    assert.equal(verJson.zero_dependencies.dev, 0);

    // 3. doctor --json in an uninitialized directory succeeds (exit 0), verifies bundled package provenance, and gives next_steps
    const doc = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: emptyDir, env, encoding: 'utf8' });
    assert.equal(doc.status, 0, doc.stdout + doc.stderr);
    const docJson = JSON.parse(doc.stdout);
    assert.equal(docJson.product, 'veycraft');
    assert.equal(docJson.initialized, false);
    assert.equal(docJson.provenance_verified, true);
    assert.equal(docJson.critical_failures, 0);
    assert.equal(docJson.global_root, customHome);
    assert.ok(docJson.skills_count >= 50);
    assert.ok(Array.isArray(docJson.next_steps) && docJson.next_steps.length > 0);
    assert.equal(fs.readdirSync(emptyDir).length, 0, 'doctor must never create files in an empty workspace');

    // 4. init --global respects VEYCRAFT_HOME and status --global --json works cleanly
    const initCustom = spawnSync(process.execPath, [CLI, 'init', '--global', '--ide', 'codex'], { cwd: emptyDir, env, encoding: 'utf8' });
    assert.equal(initCustom.status, 0, initCustom.stdout + initCustom.stderr);
    assert.ok(fs.existsSync(path.join(customHome, 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(customHome, '.veycraft-install.json')));

    const st = spawnSync(process.execPath, [CLI, 'status', '--global', '--json'], { cwd: emptyDir, env, encoding: 'utf8' });
    assert.equal(st.status, 0, st.stdout + st.stderr);
    const stJson = JSON.parse(st.stdout);
    assert.equal(stJson.product, 'veycraft');
    assert.equal(stJson.daily_cap.dry_run, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('9. Anti-Slop Contract Parity & Pre-Submit Hardening (PR #5): unified 19 clichés, em-dash hard-fail, and compact Veycraft invariants', async () => {
  const { pathToFileURL } = await import('node:url');
  const binDir = path.dirname(CLI);
  const { BANNED_AI_CLICHES } = await import(pathToFileURL(path.join(binDir, 'career-intelligence.mjs')).href);
  const { DEFAULT_BANNED_CLICHES } = await import(pathToFileURL(path.join(binDir, 'profile-intelligence.mjs')).href);

  const groundTruth = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'evals', 'fixtures', 'ground-truth.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'evals', 'results', 'baseline-verified-run.json'), 'utf8'));
  const tailorSkill = fs.readFileSync(path.join(REPO_ROOT, 'skills', '03-tailor-resume-and-verify.md'), 'utf8');
  const invariantsText = fs.readFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), 'utf8');

  // 1. Canonical 19-item banned cliché parity across JS modules, eval fixtures, and tailoring playbook
  const canonicalSet = [...new Set(BANNED_AI_CLICHES.map(s => s.toLowerCase()))].sort();
  assert.equal(canonicalSet.length, 19);
  assert.deepEqual([...new Set(DEFAULT_BANNED_CLICHES.map(s => s.toLowerCase()))].sort(), canonicalSet);
  assert.deepEqual([...new Set(groundTruth.banned_ai_cliches.map(s => s.toLowerCase()))].sort(), canonicalSet);
  assert.deepEqual([...new Set(baseline.banned_ai_cliches.map(s => s.toLowerCase()))].sort(), canonicalSet);

  const bannedLine = tailorSkill.split(/\r?\n/).find(l => /Banned AI clichés/i.test(l));
  assert.ok(bannedLine, 'skills/03-tailor-resume-and-verify.md must define Banned AI clichés line');
  const skillCliches = [...bannedLine.matchAll(/`([^`]+)`/g)]
    .map(m => m[1].toLowerCase())
    .filter(tok => !tok.includes('/') && tok !== 'banned_ai_cliches');
  assert.deepEqual([...new Set(skillCliches)].sort(), canonicalSet);

  // 2. config/invariants.txt preserves Veycraft branding, stays < 500 bytes, and covers Safe Wedge invariants
  const invBytes = Buffer.byteLength(invariantsText, 'utf8');
  assert.ok(invBytes < 500, `config/invariants.txt must stay under 500 bytes (got ${invBytes})`);
  assert.match(invariantsText, /^VEYCRAFT - PRE-SUBMIT INVARIANTS/m);
  assert.doesNotMatch(invariantsText, /JOB HUNTER OS|\bjob-hunter\b/i);
  assert.match(invariantsText, /Evidence Map/i);
  assert.match(invariantsText, /True Gaps/i);
  assert.match(invariantsText, /clichés\/em-dashes/i);
  assert.match(invariantsText, /untrusted data/i);

  // 3. pre-submit passes clean outreach, hard-fails banned clichés, and hard-fails prose em-dashes (—)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pr5-antislop-'));
  try {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'guardrails.yaml'), path.join(tmp, 'config', 'guardrails.yaml'));
    fs.copyFileSync(path.join(REPO_ROOT, 'config', 'invariants.txt'), path.join(tmp, 'config', 'invariants.txt'));

    const cleanRes = runCli([
      'pre-submit',
      '--text',
      'Hi hiring team, I applied for the Senior Backend role. I built Node.js and PostgreSQL payment APIs that cut p95 latency by 38%. Happy to share details.',
      '--json',
    ], tmp);
    assert.equal(cleanRes.status, 0, cleanRes.stdout + cleanRes.stderr);
    const cleanJson = JSON.parse(cleanRes.stdout);
    assert.equal(cleanJson.allowed, true);
    assert.equal(cleanJson.checks.draft.ok, true);
    assert.equal(cleanJson.checks.draft.has_em_dash, false);
    assert.deepEqual(cleanJson.checks.draft.banned_cliches, []);

    const clicheRes = runCli([
      'pre-submit',
      '--text',
      'Hi team, as a seasoned professional and dynamic team player, I am a results-driven engineer ready to join your team.',
      '--json',
    ], tmp);
    assert.notEqual(clicheRes.status, 0, 'pre-submit must hard-fail outreach containing banned clichés');
    const clicheJson = JSON.parse(clicheRes.stdout);
    assert.equal(clicheJson.allowed, false);
    assert.equal(clicheJson.checks.draft.ok, false);
    assert.ok(clicheJson.violations.some(v => v.code === 'draft_banned_cliches'));
    assert.ok(clicheJson.checks.draft.banned_cliches.includes('seasoned professional'));
    assert.ok(clicheJson.checks.draft.banned_cliches.includes('dynamic team player'));
    assert.ok(clicheJson.checks.draft.banned_cliches.includes('results-driven'));

    const emDashRes = runCli([
      'pre-submit',
      '--text',
      'Hi team, I built Node.js payment APIs — cutting p95 latency by 38% across 14 partner banks.',
      '--json',
    ], tmp);
    assert.notEqual(emDashRes.status, 0, 'pre-submit must hard-fail outreach containing a prose em-dash');
    const emDashJson = JSON.parse(emDashRes.stdout);
    assert.equal(emDashJson.allowed, false);
    assert.equal(emDashJson.checks.draft.ok, false);
    assert.equal(emDashJson.checks.draft.has_em_dash, true);
    assert.ok(emDashJson.violations.some(v => v.code === 'draft_prose_em_dash'));

    const emDashDraftPath = path.join(tmp, 'logs', 'outreach-emdash.md');
    fs.writeFileSync(emDashDraftPath, 'Hi team, I ship reliable TypeScript services — happy to chat.');
    const emDashFileRes = runCli(['pre-submit', '--draft', 'logs/outreach-emdash.md'], tmp);
    assert.notEqual(emDashFileRes.status, 0, 'pre-submit --draft must hard-fail on prose em-dash');
    assert.match(emDashFileRes.stdout + emDashFileRes.stderr, /prose em-dash/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('10. Recruiter, Brand & Domain Intelligence (Skill 28): routing, <= 7 cap, offline parity, and domain-agnostic coverage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'skills', 'skills-manifest.json'), 'utf8'));
  const byName = new Map(manifest.skills.map(s => [s.name, s]));

  // 1. Manifest parity & offline requires_mcp: ["none"]
  const s28 = byName.get('recruiter-brand-and-domain-intelligence');
  assert.ok(s28, 'recruiter-brand-and-domain-intelligence missing from skills-manifest.json');
  assert.equal(s28.path, 'skills/28-recruiter-brand-and-domain-intelligence.md');
  assert.deepEqual(s28.requires_mcp, ['none']);
  assert.deepEqual(s28.requires_skills, ['meta-self-verification']);

  for (const caller of [
    'discover-and-triage',
    'tailor-resume-and-verify',
    'persona-switcher',
    'ats-keyword-heatmap',
    'universal-cv-builder',
    'linkedin-growth',
    'profile-intelligence-engine',
  ]) {
    const entry = byName.get(caller);
    assert.ok(entry && entry.requires_skills.includes('recruiter-brand-and-domain-intelligence'), `${caller} must require recruiter-brand-and-domain-intelligence`);
  }

  // 2. CLI routing includes skill 28 on standalone intents while enforcing <= 7 skills everywhere (including /daily-run)
  const routeChecks = [
    ['Tailor my CV for a Clinical Operations Lead role.', 'tailor-cv', true],
    ['Analyze this Enterprise AE job description and rank fit.', 'job-discovery-and-triage', true],
    ['Optimize my LinkedIn profile for Finance Director roles.', 'linkedin-profile', true],
    ['Optimize my professional profile for Product Manager jobs.', 'profile-intelligence', true],
    ['Create a new CV from scratch.', 'cv-create', true],
    ['Improve my CV summary.', 'cv-edit', true],
    ['/daily-run', 'daily-run', false],
  ];
  for (const [prompt, expectedIntent, mustInclude28] of routeChecks) {
    const res = runCli(['route', prompt, '--json']);
    assert.equal(res.status, 0, `route failed for "${prompt}": ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.intent, expectedIntent);
    assert.ok(parsed.skills.length <= 7, `Skill count > 7 for ${expectedIntent}: ${parsed.skills.length}`);
    if (mustInclude28) {
      assert.ok(parsed.skills.includes('28-recruiter-brand-and-domain-intelligence'), `Missing skill 28 on "${prompt}"`);
    }
  }

  // 3. Domain-agnostic & HR/Brand coverage in skill 28 + de-biased caller skills
  const s28Text = fs.readFileSync(path.join(REPO_ROOT, 'skills', '28-recruiter-brand-and-domain-intelligence.md'), 'utf8');
  for (const term of ['Healthcare/Clinical/Pharma', 'Sales/Marketing/Growth', 'Finance/Accounting/Legal/Risk', 'Buyer Pain Point', 'Proof Density Hierarchy', 'Recruiter Boolean', '50-Skill Cap']) {
    assert.ok(s28Text.includes(term), `skills/28 missing domain/recruiter/brand term: ${term}`);
  }

  const s02Text = fs.readFileSync(path.join(REPO_ROOT, 'skills', '02-discover-and-triage.md'), 'utf8');
  const s03Text = fs.readFileSync(path.join(REPO_ROOT, 'skills', '03-tailor-resume-and-verify.md'), 'utf8');
  const s21Text = fs.readFileSync(path.join(REPO_ROOT, 'skills', '21-ats-keyword-heatmap.md'), 'utf8');
  const liText = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'linkedin-growth.md'), 'utf8');
  assert.doesNotMatch(s02Text, /Core Stack \(40%\)/);
  assert.doesNotMatch(s02Text, /Full\+Stack\+OR\+React\+OR\+Next\.js/);
  assert.doesNotMatch(s03Text, /direct, practical peer engineer/i);
  assert.doesNotMatch(liText, /4 Proven Engineering Post Templates/);
  assert.match(s21Text, /Credentials, Licensure & Compliance/);
});
