#!/usr/bin/env node
// Zero-dependency Native MCP Server (stdio, newline-delimited JSON-RPC 2.0) for Veycraft.
// Uses Node.js built-in modules only. Strictly read-only & offline by default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import {
  resolveGlobalRoot,
  isGlobalRoot,
  readPackageMeta,
  loadSkillManifest,
  readSkillByName,
  evaluateDoctorSnapshot,
  auditCvFile,
  matchNaturalLanguageRoute,
  verifyArtifactTarget,
  evaluatePreSubmitWithDraft,
} from './core-ops.mjs';
import {
  summarizeCareerWorkspace,
  runCareerAnalyticsForWorkspace,
  computeCareerWorkflowQueue,
} from './career-intelligence.mjs';
import { isObj } from './fs-safety.mjs';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const MAX_LINE_BYTES = 2 * 1024 * 1024; // 2 MB per JSON-RPC frame

const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const RESOURCE_LIST = Object.freeze([
  {
    uri: 'veycraft://manifest',
    name: 'skills-manifest',
    title: 'Veycraft Skills Manifest',
    description: 'Machine-readable index of all Veycraft workflow skills and triggers.',
    mimeType: 'application/json',
  },
  {
    uri: 'veycraft://registry',
    name: 'skills-registry',
    title: 'Veycraft Skills Registry',
    description: 'Natural-language intent router and skill discovery index.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'veycraft://invariants',
    name: 'guardrail-invariants',
    title: 'Veycraft Safety Invariants',
    description: 'Canonical non-negotiable local safety and approval guardrails.',
    mimeType: 'text/plain',
  },
]);

const RESOURCE_TEMPLATES = Object.freeze([
  {
    uriTemplate: 'veycraft://skill/{name}',
    name: 'skill-playbook',
    title: 'Veycraft Skill Playbook',
    description: 'Load a specific allowlisted Veycraft skill Markdown playbook by manifest name.',
    mimeType: 'text/markdown',
  },
]);

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'veycraft_doctor',
    title: 'Veycraft Workspace Doctor (Offline)',
    description: 'Inspect local Veycraft workspace readiness, config integrity, and link syntax/SSRF hygiene strictly offline without writing hooks or making network calls.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        strict: { type: 'boolean', description: 'Treat readiness or link warnings as strict checks.' },
        global: { type: 'boolean', description: 'Inspect the global ~/.veycraft root instead of the workspace root.' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_route',
    title: 'Veycraft Natural-Language Intent Router',
    description: 'Route a natural-language career task to the smallest set of Veycraft workflow skills, readiness rules, required inputs, and offline fallbacks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000, description: 'Natural-language request or task description to route.' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_audit',
    title: 'Veycraft CV Hygiene Audit',
    description: 'Audit a local CV file (.md, .txt, .html, .htm, .docx) inside the workspace for AI cliches, em-dashes, quantified impact metrics, length, placeholders, and PII/secret leaks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1, description: 'Workspace-relative or in-workspace path to the CV file to audit.' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_verify',
    title: 'Veycraft Tailored Artifact Verifier',
    description: 'Verify tailored CV/application artifacts (.html, .txt, .md, .docx) inside the workspace against unrendered placeholders, banned cliches, and optional verified facts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1, description: 'Workspace-relative or in-workspace file or directory to verify.' },
        facts_path: { type: 'string', minLength: 1, description: 'Optional path to a verified facts JSON/YAML file inside the workspace.' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_pre_submit',
    title: 'Veycraft Pre-Submit Guardrail Evaluator',
    description: 'Evaluate non-negotiable pre-submit gates (dry_run, deduplication, blacklist, daily/platform/warm-up caps, active hours, and optional draft hygiene) before any application action.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        platform: { type: 'string', description: 'Target platform name (e.g., linkedin, greenhouse, workable).' },
        company: { type: 'string', description: 'Target employer name.' },
        title: { type: 'string', description: 'Target role title.' },
        url: { type: 'string', description: 'Canonical job posting URL.' },
        job_id: { type: 'string', description: 'Canonical job identifier.' },
        draft: { type: 'string', description: 'Optional workspace path to a draft outreach/cover-letter file.' },
        text: { type: 'string', description: 'Optional inline draft text to check for length, cliches, and placeholders.' },
        max_words: { type: 'integer', minimum: 1, maximum: 5000, description: 'Maximum allowed word count for draft/text (defaults to 75 when provided).' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_career_summary',
    title: 'Veycraft Career Ledger Summary',
    description: 'Read local v2 career ledger metrics (applications, funnel status counts, CV versions, and optional offline analytics with MIN_N=5 guardrails).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        period: { type: 'string', minLength: 3, maxLength: 16, description: 'Optional analytics period filter: "all", ISO week "YYYY-Www", or month "YYYY-MM".' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_career_next',
    title: 'Veycraft Next Workflow Action Queue',
    description: 'Compute deterministic next-step recommendations across active runs, needs_review, follow-ups, and setup readiness from local workspace logs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        job_id: { type: 'string', description: 'Optional job ID to scope next-action recommendations.' },
        persona_id: { type: 'string', description: 'Optional persona ID filter.' },
        language: { type: 'string', description: 'Optional language code (defaults to en).' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'veycraft_get_skill',
    title: 'Veycraft Skill Playbook Reader',
    description: 'Read the full Markdown playbook for an allowlisted Veycraft skill registered in skills/skills-manifest.json.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, description: 'Exact skill name from skills/skills-manifest.json.' },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
]);

class JsonRpcError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

function validateArgsAgainstSchema(args, schema) {
  if (!isObj(args)) {
    throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Tool arguments must be a JSON object.');
  }
  const properties = schema.properties || {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool argument: "${key}".`);
      }
    }
  }
  if (Array.isArray(schema.required)) {
    for (const reqKey of schema.required) {
      if (args[reqKey] === undefined || args[reqKey] === null) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Missing required argument: "${reqKey}".`);
      }
    }
  }
  for (const [key, spec] of Object.entries(properties)) {
    const val = args[key];
    if (val === undefined) continue;
    if (spec.type === 'string') {
      if (typeof val !== 'string') {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be a string.`);
      }
      if (spec.minLength !== undefined && val.length < spec.minLength) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must have length >= ${spec.minLength}.`);
      }
      if (spec.maxLength !== undefined && val.length > spec.maxLength) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must have length <= ${spec.maxLength}.`);
      }
      if (Array.isArray(spec.enum) && !spec.enum.includes(val)) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be one of: ${spec.enum.join(', ')}.`);
      }
    } else if (spec.type === 'boolean') {
      if (typeof val !== 'boolean') {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be a boolean.`);
      }
    } else if (spec.type === 'integer') {
      if (typeof val !== 'number' || !Number.isInteger(val)) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be an integer.`);
      }
      if (spec.minimum !== undefined && val < spec.minimum) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be >= ${spec.minimum}.`);
      }
      if (spec.maximum !== undefined && val > spec.maximum) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Argument "${key}" must be <= ${spec.maximum}.`);
      }
    }
  }
}

function resolveStaticRepoFile(relPath, { root, source }) {
  const roots = [];
  if (root) roots.push(path.resolve(root));
  if (source && path.resolve(source) !== path.resolve(root || '')) roots.push(path.resolve(source));
  for (const base of roots) {
    const candidate = path.join(base, relPath);
    if (fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INTERNAL_ERROR, `Refusing non-regular file for ${relPath}.`);
      }
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  throw new JsonRpcError(JSON_RPC_ERRORS.INTERNAL_ERROR, `Resource file missing: ${relPath}`);
}

export function createMcpDispatcher({
  root = process.cwd(),
  source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
} = {}) {
  const workspaceRoot = path.resolve(root);
  const packageSource = path.resolve(source);
  const toolMap = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

  async function executeTool(name, args) {
    switch (name) {
      case 'veycraft_doctor': {
        const useGlobal = Boolean(args.global);
        const effRoot = useGlobal ? resolveGlobalRoot(home, env, platform) : workspaceRoot;
        const snap = await evaluateDoctorSnapshot({
          root: effRoot,
          source: packageSource,
          home,
          isGlobal: useGlobal || isGlobalRoot(effRoot, home, env, platform),
          strict: Boolean(args.strict),
          offline: true,
          readOnly: true,
          env,
          platform,
        });
        return snap.payload;
      }
      case 'veycraft_route':
        return matchNaturalLanguageRoute(args.query);
      case 'veycraft_audit':
        return auditCvFile(args.path, {
          root: workspaceRoot,
          source: packageSource,
          home,
          cwd: workspaceRoot,
        });
      case 'veycraft_verify':
        return verifyArtifactTarget(args.path, {
          factsPath: args.facts_path || null,
          root: workspaceRoot,
          source: packageSource,
          home,
          cwd: workspaceRoot,
        });
      case 'veycraft_pre_submit':
        return evaluatePreSubmitWithDraft(workspaceRoot, {
          platform: args.platform ?? null,
          company: args.company ?? null,
          title: args.title ?? null,
          url: args.url ?? null,
          jobId: args.job_id ?? null,
          draft: args.draft ?? null,
          text: args.text ?? null,
          maxWords: args.max_words ?? 75,
        }, {
          home,
          source: packageSource,
          cwd: workspaceRoot,
        });
      case 'veycraft_career_summary': {
        const summary = summarizeCareerWorkspace(workspaceRoot, { home });
        if (!args.period) return summary;
        const analytics = runCareerAnalyticsForWorkspace(workspaceRoot, {
          home,
          period: args.period,
          write: false,
        });
        return { summary, analytics };
      }
      case 'veycraft_career_next':
        return computeCareerWorkflowQueue(workspaceRoot, {
          home,
          sourceRoot: packageSource,
          jobId: args.job_id || null,
          personaId: args.persona_id || null,
          language: args.language || 'en',
        });
      case 'veycraft_get_skill':
        return readSkillByName(args.name, {
          root: workspaceRoot,
          source: packageSource,
          home,
        });
      default:
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  function readAllowlistedResource(uri) {
    if (uri === 'veycraft://manifest') {
      const { manifestPath } = loadSkillManifest(workspaceRoot, packageSource);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: fs.readFileSync(manifestPath, 'utf8'),
          },
        ],
      };
    }
    if (uri === 'veycraft://registry') {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: resolveStaticRepoFile(path.join('skills', 'REGISTRY.md'), {
              root: workspaceRoot,
              source: packageSource,
            }),
          },
        ],
      };
    }
    if (uri === 'veycraft://invariants') {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: resolveStaticRepoFile(path.join('config', 'invariants.txt'), {
              root: workspaceRoot,
              source: packageSource,
            }),
          },
        ],
      };
    }
    if (uri.startsWith('veycraft://skill/')) {
      const rawName = uri.slice('veycraft://skill/'.length);
      if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..') || rawName.includes('%')) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Invalid skill resource URI: "${uri}".`);
      }
      let skillPayload;
      try {
        skillPayload = readSkillByName(rawName, {
          root: workspaceRoot,
          source: packageSource,
          home,
        });
      } catch (err) {
        throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, err.message);
      }
      return {
        contents: [
          {
            uri: skillPayload.uri,
            mimeType: 'text/markdown',
            text: skillPayload.content,
          },
        ],
      };
    }
    throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Disallowed or unknown resource URI: "${uri}".`);
  }

  function formatErrorResponse(id, err) {
    const code = err instanceof JsonRpcError ? err.code : JSON_RPC_ERRORS.INTERNAL_ERROR;
    const message = err && err.message ? String(err.message) : 'Internal MCP server error.';
    const errorObj = { code, message };
    if (err instanceof JsonRpcError && err.data !== undefined) {
      errorObj.data = err.data;
    }
    return {
      jsonrpc: '2.0',
      id: id !== undefined ? id : null,
      error: errorObj,
    };
  }

  async function handleMessage(msg) {
    if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || msg.method.length === 0) {
      return formatErrorResponse(isObj(msg) && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null,
        new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request.'));
    }

    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== undefined;
    if (hasId && msg.id !== null && typeof msg.id !== 'string' && typeof msg.id !== 'number') {
      return formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC request id.'));
    }

    const isNotification = !hasId;

    try {
      if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
        return null;
      }
      if (isNotification) {
        return null;
      }

      switch (msg.method) {
        case 'initialize': {
          if (msg.params !== undefined && !isObj(msg.params)) {
            throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'initialize params must be an object.');
          }
          const requestedVersion = msg.params && typeof msg.params.protocolVersion === 'string'
            ? msg.params.protocolVersion
            : SUPPORTED_PROTOCOL_VERSIONS[0];
          const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
            ? requestedVersion
            : SUPPORTED_PROTOCOL_VERSIONS[0];
          const pkgMeta = readPackageMeta(workspaceRoot, packageSource);
          return {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: negotiatedVersion,
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
              },
              serverInfo: {
                name: 'veycraft',
                version: pkgMeta.version,
              },
              instructions: [
                'Veycraft local MCP server runs strictly offline and read-only.',
                'Never bypass dry_run: true or explicit human APPROVE gates.',
                'Only allowlisted public framework skills, manifest, registry, and safety invariants are exposed as resources; context/, logs/, .env, and browser-profile/ are never exposed via resources.',
              ].join(' '),
            },
          };
        }
        case 'ping':
          return { jsonrpc: '2.0', id: msg.id, result: {} };
        case 'tools/list':
          return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOL_DEFINITIONS } };
        case 'tools/call': {
          if (!isObj(msg.params) || typeof msg.params.name !== 'string' || msg.params.name.length === 0) {
            throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'tools/call requires params.name.');
          }
          const toolSpec = toolMap.get(msg.params.name);
          if (!toolSpec) {
            throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: "${msg.params.name}".`);
          }
          const toolArgs = msg.params.arguments === undefined ? {} : msg.params.arguments;
          validateArgsAgainstSchema(toolArgs, toolSpec.inputSchema);
          try {
            const data = await executeTool(msg.params.name, toolArgs);
            return {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(data, null, 2),
                  },
                ],
              },
            };
          } catch (toolErr) {
            if (toolErr instanceof JsonRpcError) throw toolErr;
            return {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      ok: false,
                      error: toolErr && toolErr.message ? String(toolErr.message) : 'Tool execution error.',
                    }, null, 2),
                  },
                ],
              },
            };
          }
        }
        case 'resources/list':
          return { jsonrpc: '2.0', id: msg.id, result: { resources: RESOURCE_LIST } };
        case 'resources/templates/list':
          return { jsonrpc: '2.0', id: msg.id, result: { resourceTemplates: RESOURCE_TEMPLATES } };
        case 'resources/read': {
          if (!isObj(msg.params) || typeof msg.params.uri !== 'string' || msg.params.uri.length === 0) {
            throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'resources/read requires params.uri.');
          }
          const resourceResult = readAllowlistedResource(msg.params.uri);
          return { jsonrpc: '2.0', id: msg.id, result: resourceResult };
        }
        default:
          throw new JsonRpcError(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: "${msg.method}".`);
      }
    } catch (err) {
      return formatErrorResponse(msg.id, err);
    }
  }

  return {
    handleMessage,
    formatErrorResponse,
  };
}

export function startMcpServer({
  root = process.cwd(),
  source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  interceptConsole = stdout === process.stdout,
} = {}) {
  // Bind raw stdout.write BEFORE intercepting console/stdout so only JSON-RPC frames hit stdout.
  const rawStdoutWrite = stdout.write.bind(stdout);
  const rawStderrWrite = stderr.write.bind(stderr);

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    debug: console.debug,
  };
  const originalProcessStdoutWrite = process.stdout.write;

  function writeStderrLine(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    try {
      rawStderrWrite(`${line}\n`);
    } catch {
      // Ignore stderr EPIPE during shutdown
    }
  }

  if (interceptConsole) {
    console.log = writeStderrLine;
    console.info = writeStderrLine;
    console.warn = writeStderrLine;
    console.debug = writeStderrLine;
    if (stdout === process.stdout) {
      process.stdout.write = (chunk, encoding, cb) => {
        if (typeof encoding === 'function') {
          return rawStderrWrite(chunk, encoding);
        }
        return rawStderrWrite(chunk, encoding, cb);
      };
    }
  }

  const dispatcher = createMcpDispatcher({ root, source, home, env, platform });
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let oversized = false;
  let closed = false;
  let queue = Promise.resolve();

  function emitFrame(obj) {
    if (!obj || closed) return;
    try {
      rawStdoutWrite(`${JSON.stringify(obj)}\n`, 'utf8');
    } catch {
      closed = true;
    }
  }

  function processRawLine(rawLine) {
    const line = (rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine).replace(/^\uFEFF/, '').trim();
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      emitFrame(dispatcher.formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error: invalid JSON.')));
      return;
    }
    queue = queue.then(async () => {
      if (closed) return;
      if (Array.isArray(parsed)) {
        emitFrame(dispatcher.formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, 'JSON-RPC batch requests are not supported.')));
        return;
      }
      const response = await dispatcher.handleMessage(parsed);
      if (response) emitFrame(response);
    }).catch((err) => {
      emitFrame(dispatcher.formatErrorResponse(null, err));
    });
  }

  return new Promise((resolve) => {
    function cleanup() {
      if (interceptConsole) {
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
        console.debug = originalConsole.debug;
        if (stdout === process.stdout) {
          process.stdout.write = originalProcessStdoutWrite;
        }
      }
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onEnd);
      stdout.removeListener('error', onStdoutError);
      if (interceptConsole) {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
      }
    }

    function finish() {
      if (closed) return;
      closed = true;
      queue.finally(() => {
        cleanup();
        resolve();
      });
    }

    function onStdoutError(err) {
      if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) {
        finish();
      }
    }

    function onSignal() {
      finish();
    }

    function onData(chunk) {
      if (closed) return;
      const str = typeof chunk === 'string' ? chunk : decoder.write(chunk);
      if (!str) return;
      buffer += str;

      if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES && !buffer.includes('\n')) {
        oversized = true;
        buffer = '';
        emitFrame(dispatcher.formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, `Request frame exceeds ${MAX_LINE_BYTES} bytes.`)));
        return;
      }

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (oversized) {
          oversized = false;
          continue;
        }
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
          emitFrame(dispatcher.formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, `Request frame exceeds ${MAX_LINE_BYTES} bytes.`)));
          continue;
        }
        processRawLine(line);
      }
    }

    function onEnd() {
      const tail = decoder.end();
      if (tail) buffer += tail;
      if (!oversized && buffer.trim()) {
        if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
          emitFrame(dispatcher.formatErrorResponse(null, new JsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, `Request frame exceeds ${MAX_LINE_BYTES} bytes.`)));
        } else {
          processRawLine(buffer);
        }
      }
      buffer = '';
      // Wait for queued handlers to finish emitting frames before closing.
      queue.finally(() => {
        if (!closed) {
          closed = true;
          cleanup();
          resolve();
        }
      });
    }

    stdout.on('error', onStdoutError);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onEnd);
    if (interceptConsole) {
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    }
    if (typeof stdin.resume === 'function') {
      stdin.resume();
    }
  });
}

function isDirectEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isDirectEntrypoint()) {
  const customHome = process.env.VEYCRAFT_HOME && process.env.VEYCRAFT_HOME.trim();
  const root = customHome ? path.resolve(customHome) : process.cwd();
  startMcpServer({ root }).catch((err) => {
    process.stderr.write(`veycraft mcp fatal: ${err?.message || err}\n`);
    process.exitCode = 1;
  });
}
