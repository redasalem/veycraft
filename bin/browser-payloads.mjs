// Zero-dependency Safe DOM Distiller & Single-Shot Non-Submitting Batch Form Fill payloads for Veycraft.
// Pure JS (0 runtime/dev deps, 0 eval/new Function, 0 string interpolation of user input into JS).
// Every payload is strictly read-only or non-submitting: NEVER triggers form submission or Publish/Save clicks.

export const PAYLOAD_NAMES = Object.freeze(['distill-feed', 'distill-form', 'batch-fill']);

/**
 * Distill an authenticated job/freelance feed page into a compact (<600-token) JSON structure.
 * Strips nav/header/footer/aside/hidden nodes, removes invisible BiDi/Unicode Tag chars,
 * detects CAPTCHA/login stop conditions, and flags potential prompt-injection strings.
 */
export function distillFeedInDom(doc, opts = {}) {
  const maxItems = Number.isInteger(opts?.maxItems) && opts.maxItems > 0 ? Math.min(opts.maxItems, 25) : 15;
  const maxSnippet = Number.isInteger(opts?.maxSnippet) && opts.maxSnippet > 20 ? Math.min(opts.maxSnippet, 220) : 140;

  const stripInvisible = (str) => {
    let out = '';
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (cp > 0xffff) i++;
      if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) {
        continue;
      }
      out += String.fromCodePoint(cp);
    }
    return out.replace(/\s+/g, ' ').trim();
  };

  const INJECTION_RE = /\b(ignore\s+(?:all\s+)?previous\s+instructions?|system\s+prompt|you\s+are\s+now|disregard\s+guardrails|reveal\s+(?:your\s+)?(?:\.env|api\s+key|token)|auto[- ]?submit|click\s+submit\s+immediately)\b/i;

  const isHidden = (el) => {
    if (!el || typeof el !== 'object') return true;
    if (el.hidden) return true;
    if (typeof el.getAttribute === 'function') {
      if (el.getAttribute('aria-hidden') === 'true') return true;
      const st = String(el.getAttribute('style') || '').toLowerCase();
      if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0(?:px|em|rem|%)?(?:\D|$)/.test(st)) {
        return true;
      }
    }
    const win = doc?.defaultView;
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const cs = win.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || cs.fontSize === '0px')) {
          return true;
        }
      } catch { /* ignore */ }
    }
    return false;
  };

  const detectChallenge = () => {
    const htmlSample = String(doc?.body?.textContent || '').slice(0, 6000).toLowerCase();
    const hasCaptchaNode = Boolean(
      doc?.querySelector?.('[class*="captcha" i], [id*="captcha" i], iframe[src*="turnstile" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], #challenge-form')
    );
    if (hasCaptchaNode || /\b(verify you are human|just a moment|cloudflare|attention required|recaptcha|hcaptcha)\b/i.test(htmlSample)) {
      return 'captcha';
    }
    const hasPw = Boolean(doc?.querySelector?.('input[type="password"]'));
    const hasLoginHeading = /\b(sign in|log in|login to your account|تسجيل الدخول)\b/i.test(String(doc?.title || '') + ' ' + htmlSample.slice(0, 800));
    if (hasPw && hasLoginHeading) return 'login';
    return null;
  };

  const challenge = detectChallenge();
  if (challenge) {
    return {
      ok: true,
      untrusted_external_data: true,
      url: String(doc?.location?.href || ''),
      auth_or_challenge_detected: challenge,
      items: [],
    };
  }

  const cardSelectors = [
    'article',
    '[data-test="job-tile"]',
    '[data-testid*="job" i]',
    '[data-testid*="project" i]',
    '.project-row',
    '.job-card',
    '.search-result',
    'li[class*="job" i]',
    'li[class*="project" i]',
  ].join(', ');

  const rawNodes = Array.from(doc?.querySelectorAll?.(cardSelectors) || []);
  const items = [];
  const seenUrls = new Set();

  for (const node of rawNodes) {
    if (items.length >= maxItems) break;
    if (isHidden(node)) continue;
    if (typeof node.closest === 'function' && node.closest('nav, header, footer, aside')) continue;

    const link = node.querySelector?.('a[href]');
    const titleNode = node.querySelector?.('h1, h2, h3, h4, [class*="title" i]') || link;
    const title = stripInvisible(titleNode?.textContent || '').slice(0, 90);
    if (!title || title.length < 4) continue;

    let href = String(link?.getAttribute?.('href') || link?.href || '').trim();
    if (href && doc?.location?.href && !/^https?:\/\//i.test(href)) {
      try { href = new URL(href, doc.location.href).href; } catch { /* keep relative */ }
    }
    if (href && seenUrls.has(href)) continue;
    if (href) seenUrls.add(href);

    const rawText = stripInvisible(node.textContent || '');
    const budgetMatch = rawText.match(/(?:\$|€|£|USD|EUR|SAR|AED)\s?\d[\d,]*(?:\s*[-–]\s*(?:\$|€|£|USD|EUR|SAR|AED)?\s?\d[\d,]*)?/i);
    const postedMatch = rawText.match(/\b(?:\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s+ago|just\s+now|today|yesterday|منذ\s+\S+(?:\s+\S+)?)\b/i);
    const bidsMatch = rawText.match(/\b(?:\d+\+?\s*(?:proposals?|bids?|applicants?|عروض|عرض))\b/i);
    const snippet = rawText.slice(0, maxSnippet);
    const flags = [];
    if (INJECTION_RE.test(rawText)) flags.push('prompt_injection_pattern');

    items.push({
      idx: items.length + 1,
      title,
      url: href || null,
      budget: budgetMatch ? budgetMatch[0] : null,
      posted: postedMatch ? postedMatch[0] : null,
      bids: bidsMatch ? bidsMatch[0] : null,
      snippet,
      injection_flags: flags,
    });
  }

  return {
    ok: true,
    untrusted_external_data: true,
    url: String(doc?.location?.href || ''),
    auth_or_challenge_detected: null,
    total_found: items.length,
    items,
  };
}

/**
 * Distill all visible editable form controls (+ open Shadow DOM) into a compact schema (<600 tokens).
 * Segregates honeypot/hidden controls and reports cross-origin iframes and submit button labels as metadata only.
 */
export function distillFormInDom(doc, opts = {}) {
  const maxFields = Number.isInteger(opts?.maxFields) && opts.maxFields > 0 ? Math.min(opts.maxFields, 50) : 35;

  const stripInvisible = (str) => {
    let out = '';
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (cp > 0xffff) i++;
      if ((cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) {
        continue;
      }
      out += String.fromCodePoint(cp);
    }
    return out.replace(/\s+/g, ' ').trim();
  };

  const HONEYPOT_RE = /honeypot|trap|bot[_-]?check|website_url_honeypot|hp[_-]?field/i;

  const isHiddenOrHoneypot = (el) => {
    const type = String(el?.type || el?.getAttribute?.('type') || '').toLowerCase();
    const name = String(el?.name || el?.getAttribute?.('name') || '');
    const id = String(el?.id || el?.getAttribute?.('id') || '');
    const tabIdx = String(el?.getAttribute?.('tabindex') || '');
    const ariaHidden = String(el?.getAttribute?.('aria-hidden') || '');
    const style = String(el?.getAttribute?.('style') || '').toLowerCase();
    const hiddenAttr = Boolean(el?.hidden) || type === 'hidden';
    const cssHidden = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|left\s*:\s*-\d{3,}px/.test(style);
    if (HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id)) return 'honeypot_name';
    if (hiddenAttr) return 'hidden_input';
    if (cssHidden || ariaHidden === 'true' || tabIdx === '-1') return 'hidden_or_trap';
    return null;
  };

  const resolveLabel = (el, rootNode) => {
    const ariaLabel = el.getAttribute?.('aria-label');
    if (ariaLabel) return stripInvisible(ariaLabel).slice(0, 80);
    const id = el.id || el.getAttribute?.('id');
    if (id && rootNode?.querySelector) {
      const lbl = rootNode.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (lbl?.textContent) return stripInvisible(lbl.textContent).slice(0, 80);
    }
    const parentLabel = el.closest?.('label');
    if (parentLabel?.textContent) return stripInvisible(parentLabel.textContent).slice(0, 80);
    const ph = el.getAttribute?.('placeholder') || el.placeholder || '';
    if (ph) return stripInvisible(ph).slice(0, 80);
    return stripInvisible(el.name || el.getAttribute?.('name') || id || '').slice(0, 80);
  };

  const fields = [];
  const honeypotsDetected = [];
  const submitButtons = [];
  const iframeSrcs = [];
  let shadowHostsCount = 0;

  const walkRoot = (rootNode) => {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;
    const frames = Array.from(rootNode.querySelectorAll('iframe') || []);
    for (const fr of frames) {
      const src = String(fr.getAttribute?.('src') || fr.src || '').trim();
      if (src && !iframeSrcs.includes(src)) iframeSrcs.push(src);
    }

    const controls = Array.from(
      rootNode.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"], button, input[type="submit"]') || []
    );

    for (const el of controls) {
      const tag = String(el.tagName || '').toLowerCase();
      const type = String(el.type || el.getAttribute?.('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : '')).toLowerCase();
      const role = String(el.getAttribute?.('role') || '').toLowerCase();

      if (tag === 'button' || type === 'submit' || type === 'button') {
        const btnText = stripInvisible(el.textContent || el.value || el.getAttribute?.('aria-label') || '').slice(0, 60);
        if (type === 'submit' || /\b(submit|publish|save|send|apply|post|إرسال|نشر|حفظ|أضف عرض)\b/i.test(btnText)) {
          submitButtons.push({ text: btnText || 'Submit', disabled: Boolean(el.disabled) });
        }
        continue;
      }

      const trapReason = isHiddenOrHoneypot(el);
      if (trapReason) {
        if (trapReason !== 'hidden_input' || HONEYPOT_RE.test(String(el.name || el.id || ''))) {
          honeypotsDetected.push({
            name: String(el.name || el.getAttribute?.('name') || el.id || ''),
            reason: trapReason,
          });
        }
        continue;
      }

      if (fields.length >= maxFields) continue;
      const name = String(el.name || el.getAttribute?.('name') || '');
      const id = String(el.id || el.getAttribute?.('id') || '');
      const label = resolveLabel(el, rootNode);
      const key = name || id || label || `field_${fields.length + 1}`;
      const optionsSample = tag === 'select'
        ? Array.from(el.options || []).slice(0, 8).map((o) => stripInvisible(o.text || o.value || '').slice(0, 40))
        : undefined;

      fields.push({
        key,
        label,
        name: name || null,
        id: id || null,
        type: role === 'combobox' ? 'combobox' : (el.getAttribute?.('contenteditable') === 'true' ? 'contenteditable' : (type || tag)),
        required: Boolean(el.required || el.getAttribute?.('aria-required') === 'true'),
        current_value: type === 'password' ? '[REDACTED]' : stripInvisible(el.value || '').slice(0, 60),
        ...(optionsSample ? { options_sample: optionsSample } : {}),
      });
    }

    const allEls = Array.from(rootNode.querySelectorAll('*') || []);
    for (const el of allEls) {
      if (el && el.shadowRoot) {
        shadowHostsCount++;
        walkRoot(el.shadowRoot);
      }
    }
  };

  walkRoot(doc);

  const hasCaptcha = Boolean(
    doc?.querySelector?.('[class*="captcha" i], [id*="captcha" i], iframe[src*="turnstile" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]')
  );
  const hasPassword = fields.some((f) => f.type === 'password');

  return {
    ok: true,
    untrusted_external_data: true,
    url: String(doc?.location?.href || ''),
    auth_or_challenge_detected: hasCaptcha ? 'captcha' : (hasPassword && fields.length <= 3 ? 'login' : null),
    shadow_hosts_count: shadowHostsCount,
    iframe_srcs: iframeSrcs,
    fields_count: fields.length,
    fields,
    honeypots_detected: honeypotsDetected,
    submit_buttons: submitButtons,
  };
}

/**
 * Single-Shot Non-Submitting Batch Form Fill.
 * Accepts `fieldMap` strictly as a serialized object argument (NEVER interpolated into JS source).
 * HARD SAFETY INVARIANT: Never clicks submit/publish/save/send buttons and never calls form submission APIs.
 */
export function batchFillFormInDom(doc, fieldMap) {
  if (!fieldMap || typeof fieldMap !== 'object' || Array.isArray(fieldMap)) {
    return {
      ok: false,
      never_submitted: true,
      ready_for_approval_gate: false,
      error: 'fieldMap must be a plain key-value JSON object.',
    };
  }

  const HONEYPOT_RE = /honeypot|trap|bot[_-]?check|website_url_honeypot|hp[_-]?field/i;
  const normalizeKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const isBlockedControl = (el) => {
    const tag = String(el?.tagName || '').toLowerCase();
    const type = String(el?.type || el?.getAttribute?.('type') || '').toLowerCase();
    const name = String(el?.name || el?.getAttribute?.('name') || '');
    const id = String(el?.id || el?.getAttribute?.('id') || '');
    const style = String(el?.getAttribute?.('style') || '').toLowerCase();
    if (tag === 'button' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'non_editable_button';
    if (type === 'hidden' || Boolean(el?.hidden)) return 'hidden_field';
    if (HONEYPOT_RE.test(name) || HONEYPOT_RE.test(id)) return 'honeypot';
    if (el?.getAttribute?.('aria-hidden') === 'true' || String(el?.getAttribute?.('tabindex') || '') === '-1') return 'honeypot';
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/.test(style)) return 'honeypot';
    return null;
  };

  const setNativeValue = (el, val) => {
    const strVal = String(val);
    const tag = String(el.tagName || '').toLowerCase();
    const win = doc?.defaultView;
    const proto =
      tag === 'textarea' ? win?.HTMLTextAreaElement?.prototype :
      tag === 'select' ? win?.HTMLSelectElement?.prototype :
      win?.HTMLInputElement?.prototype;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (typeof setter === 'function') {
      setter.call(el, strVal);
    } else {
      el.value = strVal;
    }
    const EventCtor = win?.Event || globalThis.Event;
    if (typeof el.dispatchEvent === 'function' && typeof EventCtor === 'function') {
      el.dispatchEvent(new EventCtor('input', { bubbles: true }));
      el.dispatchEvent(new EventCtor('change', { bubbles: true }));
      el.dispatchEvent(new EventCtor('blur', { bubbles: true }));
    }
  };

  const allControls = [];
  const collectControls = (rootNode) => {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;
    for (const el of Array.from(rootNode.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"]') || [])) {
      allControls.push({ el, rootNode });
    }
    for (const host of Array.from(rootNode.querySelectorAll('*') || [])) {
      if (host && host.shadowRoot) collectControls(host.shadowRoot);
    }
  };
  collectControls(doc);

  const labelFor = (el, rootNode) => {
    const aria = el.getAttribute?.('aria-label');
    if (aria) return aria;
    const id = el.id || el.getAttribute?.('id');
    if (id && rootNode?.querySelector) {
      const lbl = rootNode.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (lbl?.textContent) return lbl.textContent;
    }
    return el.closest?.('label')?.textContent || el.getAttribute?.('placeholder') || '';
  };

  const filled = [];
  const skipped = [];
  const unmatched = [];
  const honeypotsIgnored = [];
  const requiresNativeUpload = [];
  const requiresInteractiveSelect = [];
  const validationErrors = [];

  for (const [rawKey, rawVal] of Object.entries(fieldMap)) {
    if (rawVal === undefined || rawVal === null) {
      skipped.push({ key: rawKey, reason: 'null_or_undefined' });
      continue;
    }
    const targetNorm = normalizeKey(rawKey);
    const match = allControls.find(({ el, rootNode }) => {
      const candidates = [
        el.name || el.getAttribute?.('name') || '',
        el.id || el.getAttribute?.('id') || '',
        labelFor(el, rootNode),
      ].map(normalizeKey).filter(Boolean);
      return candidates.includes(targetNorm);
    });

    if (!match) {
      unmatched.push(rawKey);
      continue;
    }

    const { el } = match;
    const blocked = isBlockedControl(el);
    if (blocked === 'honeypot') {
      honeypotsIgnored.push(rawKey);
      continue;
    }
    if (blocked) {
      skipped.push({ key: rawKey, reason: blocked });
      continue;
    }

    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.type || el.getAttribute?.('type') || '').toLowerCase();
    const role = String(el.getAttribute?.('role') || '').toLowerCase();

    if (type === 'file') {
      requiresNativeUpload.push({ key: rawKey, name: el.name || el.id || rawKey });
      continue;
    }
    if (role === 'combobox') {
      requiresInteractiveSelect.push({ key: rawKey, value: String(rawVal) });
      continue;
    }
    if (type === 'checkbox' || type === 'radio') {
      const desired = Boolean(rawVal) && String(rawVal).toLowerCase() !== 'false';
      el.checked = desired;
      const EventCtor = doc?.defaultView?.Event || globalThis.Event;
      if (typeof el.dispatchEvent === 'function' && typeof EventCtor === 'function') {
        el.dispatchEvent(new EventCtor('change', { bubbles: true }));
      }
      filled.push({ key: rawKey, type, read_back: Boolean(el.checked) });
      continue;
    }
    if (el.getAttribute?.('contenteditable') === 'true') {
      el.textContent = String(rawVal);
      const EventCtor = doc?.defaultView?.Event || globalThis.Event;
      if (typeof el.dispatchEvent === 'function' && typeof EventCtor === 'function') {
        el.dispatchEvent(new EventCtor('input', { bubbles: true }));
      }
      filled.push({ key: rawKey, type: 'contenteditable', read_back: String(el.textContent).slice(0, 120) });
      continue;
    }
    if (tag === 'select') {
      const strVal = String(rawVal);
      const opts = Array.from(el.options || []);
      const optMatch = opts.find((o) => normalizeKey(o.value) === normalizeKey(strVal) || normalizeKey(o.text) === normalizeKey(strVal));
      if (!optMatch) {
        requiresInteractiveSelect.push({ key: rawKey, value: strVal, reason: 'option_not_found' });
        continue;
      }
      setNativeValue(el, optMatch.value);
      filled.push({ key: rawKey, type: 'select', read_back: String(el.value) });
      continue;
    }

    setNativeValue(el, rawVal);
    const readBack = type === 'password' ? '[REDACTED]' : String(el.value || '').slice(0, 120);
    if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
      validationErrors.push({ key: rawKey, message: String(el.validationMessage || 'Invalid value') });
    }
    filled.push({ key: rawKey, type: type || tag, read_back: readBack });
  }

  return {
    ok: true,
    never_submitted: true,
    ready_for_approval_gate: true,
    filled_count: filled.length,
    filled,
    skipped,
    unmatched,
    honeypots_ignored: honeypotsIgnored,
    requires_native_upload: requiresNativeUpload,
    requires_interactive_select: requiresInteractiveSelect,
    validation_errors: validationErrors,
  };
}

export function getBrowserPayload(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!PAYLOAD_NAMES.includes(normalized)) {
    throw new Error(`Unknown browser payload "${name}". Valid payloads: ${PAYLOAD_NAMES.join(', ')}`);
  }
  if (normalized === 'distill-feed') {
    const fnSource = `(opts) => (${distillFeedInDom.toString()})(document, opts)`;
    return {
      name: 'distill-feed',
      read_only: true,
      never_submits: true,
      untrusted_data_wrapped: true,
      usage: 'Pass `fn_source` to Playwright browser_evaluate with optional `{ maxItems: 15, maxSnippet: 140 }` argument.',
      fn_source: fnSource,
    };
  }
  if (normalized === 'distill-form') {
    const fnSource = `(opts) => (${distillFormInDom.toString()})(document, opts)`;
    return {
      name: 'distill-form',
      read_only: true,
      never_submits: true,
      untrusted_data_wrapped: true,
      usage: 'Pass `fn_source` to Playwright browser_evaluate with optional `{ maxFields: 35 }` argument.',
      fn_source: fnSource,
    };
  }
  const fnSource = `(fieldMap) => (${batchFillFormInDom.toString()})(document, fieldMap)`;
  return {
    name: 'batch-fill',
    read_only: false,
    never_submits: true,
    untrusted_data_wrapped: true,
    usage: 'Pass `fn_source` to Playwright browser_evaluate with `fieldMap` as a separate serialized JSON object argument (NEVER interpolate user strings into JS). Always pause for explicit human APPROVE after reading the returned Live DOM Read-Back JSON.',
    fn_source: fnSource,
  };
}
