// Zero-dependency Veycraft Read-Only Local UI client.
// Strictly uses document.createElement / textContent / replaceChildren only.

const state = {
  activeTab: 'overview',
  studioSubtab: 'route',
  overview: null,
  applications: null,
  analytics: null,
  analyticsPeriod: 'all',
  skillsManifest: null,
  selectedSkillName: null,
  skillCache: new Map(),
  kanbanQuery: '',
  kanbanPlatform: 'all',
  kanbanCv: 'all',
  skillsQuery: '',
  skillsCategory: 'all',
  skillsMcp: 'all',
};

const SAFE_ATTRS = new Set([
  'id', 'type', 'role', 'value', 'max', 'min', 'placeholder',
  'aria-label', 'aria-selected', 'aria-live', 'for', 'name',
  'rows', 'cols', 'disabled', 'selected', 'checked', 'title',
]);

function h(tag, props = null, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'className') {
        node.className = String(v);
      } else if (k === 'text') {
        node.textContent = String(v);
      } else if (k === 'onClick') {
        node.addEventListener('click', v);
      } else if (k === 'onInput') {
        node.addEventListener('input', v);
      } else if (k === 'onChange') {
        node.addEventListener('change', v);
      } else if (k === 'href') {
        const str = String(v).trim();
        if (/^https?:\/\//i.test(str)) {
          node.setAttribute('href', str);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v)) {
          node.dataset[dk] = String(dv);
        }
      } else if (SAFE_ATTRS.has(k)) {
        if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(parent, items) {
  for (const item of items) {
    if (item === null || item === undefined || item === false) continue;
    if (Array.isArray(item)) {
      appendChildren(parent, item);
    } else if (item instanceof Node) {
      parent.appendChild(item);
    } else {
      parent.appendChild(document.createTextNode(String(item)));
    }
  }
}

function renderInlineCodeSegments(text) {
  const str = String(text || '');
  const parts = str.split(/(`[^`]+`)/g);
  const frag = document.createDocumentFragment();
  for (const part of parts) {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      frag.appendChild(h('code', { className: 'md-inline-code', text: part.slice(1, -1) }));
    } else if (part) {
      frag.appendChild(document.createTextNode(part));
    }
  }
  return frag;
}

function renderMarkdownSafe(markdownText) {
  const container = h('div', { className: 'md-body' });
  const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  // Skip optional YAML frontmatter block cleanly into a compact metadata pre
  if (lines[0] === '---') {
    const endIdx = lines.indexOf('---', 1);
    if (endIdx > 0) {
      i = endIdx + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      container.appendChild(h('pre', { className: 'code-snippet', text: codeLines.join('\n') }));
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1].length);
      container.appendChild(h(`h${level}`, null, renderInlineCodeSegments(headingMatch[2])));
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      container.appendChild(h('blockquote', null, renderInlineCodeSegments(quoteLines.join(' '))));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = h('ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        ul.appendChild(h('li', null, renderInlineCodeSegments(lines[i].replace(/^\s*[-*]\s+/, ''))));
        i++;
      }
      container.appendChild(ul);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = h('ol');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        ol.appendChild(h('li', null, renderInlineCodeSegments(lines[i].replace(/^\s*\d+\.\s+/, ''))));
        i++;
      }
      container.appendChild(ol);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const parseCells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const headers = parseCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseCells(lines[i]));
        i++;
      }
      const table = h('table', { className: 'data-table' },
        h('thead', null, h('tr', null, headers.map((hd) => h('th', { text: hd })))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((cell) => h('td', null, renderInlineCodeSegments(cell)))))),
      );
      container.appendChild(h('div', { className: 'table-wrap' }, table));
      continue;
    }
    container.appendChild(h('p', null, renderInlineCodeSegments(line)));
    i++;
  }
  return container;
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function copyText(str, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(str);
    showToast(`${label}`);
  } catch {
    showToast(`Copy value: ${str}`);
  }
}

async function apiGet(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return data;
}

async function apiPost(url, bodyObj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(bodyObj),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return data;
}

function statusPillClass(levelOrStatus) {
  const s = String(levelOrStatus || '').toLowerCase();
  if (s === 'ok' || s === 'applied' || s === 'offer' || s === 'pass') return 'pill pill-emerald';
  if (s === 'interview' || s === 'assessment' || s === 'info' || s === 'prepared') return 'pill pill-blue';
  if (s === 'warn' || s === 'needs_review' || s === 'dry_run' || s === 'discovered') return 'pill pill-amber';
  if (s === 'fail' || s === 'failed' || s === 'aborted' || s === 'rejected') return 'pill pill-rose';
  return 'pill pill-slate';
}

function switchTab(tabName) {
  state.activeTab = tabName;
  for (const btn of document.querySelectorAll('.tab-btn')) {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const name of ['overview', 'kanban', 'analytics', 'studio', 'skills']) {
    const panel = document.getElementById(`view-${name}`);
    if (panel) panel.classList.toggle('hidden', name !== tabName);
  }
  if (tabName === 'kanban' && !state.applications) loadKanban();
  if (tabName === 'analytics' && !state.analytics) loadAnalytics(state.analyticsPeriod);
  if (tabName === 'studio') renderStudio();
  if (tabName === 'skills' && !state.skillsManifest) loadSkills();
}

// ---------------- VIEW 1: OVERVIEW ----------------
function renderOverview() {
  const panel = document.getElementById('view-overview');
  if (!panel || !state.overview) return;

  const { meta, doctor, summary, next, ledger_health: ledgerHealth } = state.overview;
  const docPayload = doctor.payload;
  const gates = docPayload.gates || { passed: 0, total: 4 };
  const funnel = summary?.funnel || { total_tracked: 0, submitted_count: 0 };

  document.getElementById('version-badge').textContent = `v${meta.version}`;
  document.getElementById('workspace-subtitle').textContent = `${meta.workspace_root} (${meta.scope} workspace · ${meta.zero_dependencies.runtime}/${meta.zero_dependencies.dev} npm deps)`;

  const nodes = [];

  if (!docPayload.initialized) {
    nodes.push(
      h('div', { className: 'banner banner-onboarding' },
        h('div', { className: 'card-header' },
          h('strong', { text: 'Workspace Not Initialized Yet — Start Safely in 15 Seconds' }),
          h('span', { className: 'pill pill-blue', text: 'ZERO LOGIN NEEDED' }),
        ),
        h('p', { className: 'muted-text', text: 'Standalone tasks (/demo, /quick-tailor, CV hygiene audit, routing, and skill browsing) work right now with zero setup. Initialize ~/.veycraft whenever you want persistent tracking.' }),
        h('div', { className: 'filter-bar' },
          h('button', { className: 'btn btn-primary btn-sm', text: 'Copy: npx veycraft init --global', onClick: () => copyText('npx veycraft init --global', 'Copied init --global command') }),
          h('button', { className: 'btn btn-sm', text: 'Try Verification Studio', onClick: () => switchTab('studio') }),
          h('button', { className: 'btn btn-sm', text: 'Browse 53 Skills', onClick: () => switchTab('skills') }),
        ),
      ),
    );
  }

  if (ledgerHealth?.error) {
    nodes.push(h('div', { className: 'banner banner-error', text: `Ledger Notice: ${ledgerHealth.error}` }));
  }

  nodes.push(
    h('div', { className: 'kpi-grid' },
      h('div', { className: 'kpi-card' },
        h('div', { className: 'kpi-value', text: `${gates.passed}/${gates.total}` }),
        h('div', { className: 'kpi-label', text: 'Readiness Gates' }),
        h('div', { className: 'kpi-sub', text: docPayload.initialized ? 'Initialized workspace' : 'Standalone mode ready' }),
      ),
      h('div', { className: 'kpi-card' },
        h('div', { className: 'kpi-value', text: String(funnel.total_tracked || 0) }),
        h('div', { className: 'kpi-label', text: 'Owner Apps Tracked' }),
        h('div', { className: 'kpi-sub', text: `${funnel.submitted_count || 0} submitted` }),
      ),
      h('div', { className: 'kpi-card' },
        h('div', { className: 'kpi-value', text: String((summary?.active_interviews || 0) + (summary?.active_assessments || 0)) }),
        h('div', { className: 'kpi-label', text: 'Active Interviews / Tests' }),
        h('div', { className: 'kpi-sub', text: `${summary?.active_interviews || 0} interviews · ${summary?.active_assessments || 0} assessments` }),
      ),
      h('div', { className: 'kpi-card' },
        h('div', { className: 'kpi-value', text: String(summary?.overdue_follow_ups_count || 0) }),
        h('div', { className: 'kpi-label', text: 'Overdue Follow-Ups' }),
        h('div', { className: 'kpi-sub', text: `${docPayload.skills_count || 53} Markdown skills loaded` }),
      ),
    ),
  );

  const gateItems = [
    ['Gate 1 · CV & Profile', gates.cv_and_profile],
    ['Gate 2 · Target Preferences', gates.target_preferences],
    ['Gate 3/4 · Legal, Comp & Skills', gates.legal_comp_skills],
    ['Gate 5 · Enabled Job Targets', gates.enabled_targets],
    ['Browser Profile Directory', docPayload.browser_profile_present],
    ['Provenance & Attribution', docPayload.provenance_verified],
  ];

  const gatesCard = h('div', { className: 'card' },
    h('div', { className: 'card-header' },
      h('h2', { className: 'card-title', text: 'Readiness & Safety Gates' }),
      h('span', { className: docPayload.ok ? 'pill pill-emerald' : 'pill pill-amber', text: docPayload.ok ? 'DOCTOR OK' : `${docPayload.readiness_pending} PENDING` }),
    ),
    h('div', { className: 'list-stack' },
      gateItems.map(([label, ok]) =>
        h('div', { className: 'list-row' },
          h('span', { text: label }),
          h('span', { className: ok ? 'pill pill-emerald' : 'pill pill-amber', text: ok ? 'READY' : 'PENDING' }),
        ),
      ),
    ),
  );

  const actions = Array.isArray(next?.prioritized_actions) ? next.prioritized_actions.slice(0, 6) : [];
  const nextCard = h('div', { className: 'card' },
    h('div', { className: 'card-header' },
      h('h2', { className: 'card-title', text: 'Prioritized Next Actions' }),
      h('span', { className: 'pill pill-blue', text: `${actions.length} QUEUED` }),
    ),
    actions.length === 0
      ? h('p', { className: 'muted-text', text: 'No urgent blockers or overdue follow-ups. Start with /demo, /quick-tailor, or Verification Studio.' })
      : h('div', { className: 'list-stack' },
          actions.map((act) =>
            h('div', { className: 'list-row' },
              h('div', null,
                h('div', { text: act.title || act.summary || act.kind || 'Recommended Action' }),
                act.recommended_command ? h('div', { className: 'subtitle', text: act.recommended_command }) : null,
              ),
              act.recommended_command
                ? h('button', {
                    className: 'btn btn-sm',
                    text: 'Copy Cmd',
                    onClick: () => copyText(act.recommended_command, 'Copied recommended command'),
                  })
                : null,
            ),
          ),
        ),
  );

  nodes.push(h('div', { className: 'two-col' }, gatesCard, nextCard));

  const mcpSnippet = JSON.stringify({
    mcpServers: {
      veycraft: {
        command: 'npx',
        args: ['-y', 'veycraft', 'mcp'],
      },
    },
  }, null, 2);

  nodes.push(
    h('div', { className: 'card' },
      h('div', { className: 'card-header' },
        h('div', null,
          h('h2', { className: 'card-title', text: 'Connect Your IDE (Native MCP Server)' }),
          h('p', { className: 'muted-text', text: 'Expose 8 read-only offline tools and allowlisted veycraft:// skill resources over stdio.' }),
        ),
        h('div', { className: 'filter-bar' },
          h('button', {
            className: 'btn btn-primary btn-sm',
            text: 'Copy mcpServers JSON',
            onClick: () => copyText(mcpSnippet, 'Copied mcpServers JSON snippet'),
          }),
          h('button', {
            className: 'btn btn-sm',
            text: 'Copy: veycraft sync-mcp --with-veycraft',
            onClick: () => copyText('npx veycraft sync-mcp --with-veycraft', 'Copied sync-mcp --with-veycraft command'),
          }),
        ),
      ),
      h('pre', { className: 'code-snippet', text: mcpSnippet }),
    ),
  );

  nodes.push(
    h('div', { className: 'card' },
      h('div', { className: 'card-header' },
        h('h2', { className: 'card-title', text: 'Offline Doctor Diagnostic Events' }),
        h('span', { className: 'pill pill-slate', text: 'offline: true · readOnly: true' }),
      ),
      h('div', { className: 'list-stack' },
        (doctor.events || []).map((ev) =>
          h('div', { className: 'list-row' },
            h('span', { text: ev.message }),
            h('span', { className: statusPillClass(ev.level), text: String(ev.level).toUpperCase() }),
          ),
        ),
      ),
    ),
  );

  panel.replaceChildren(...nodes);
}

// ---------------- VIEW 2: KANBAN ----------------
async function loadKanban() {
  const panel = document.getElementById('view-kanban');
  if (!panel) return;
  panel.replaceChildren(h('div', { className: 'card', text: 'Loading read-only application ledger...' }));
  try {
    state.applications = await apiGet('/api/applications');
    renderKanban();
  } catch (err) {
    panel.replaceChildren(h('div', { className: 'banner banner-error', text: `Failed loading applications: ${err.message}` }));
  }
}

function openApplicationDrawer(card) {
  const drawer = document.getElementById('detail-drawer');
  if (!drawer) return;
  drawer.classList.remove('hidden');
  drawer.replaceChildren(
    h('div', { className: 'card-header' },
      h('h2', { className: 'card-title', text: `${card.company} — ${card.role_title}` }),
      h('button', { className: 'btn btn-sm', text: 'Close', onClick: () => drawer.classList.add('hidden') }),
    ),
    h('div', { className: 'filter-bar' },
      h('span', { className: statusPillClass(card.status), text: card.status }),
      card.match_score !== null ? h('span', { className: 'pill pill-emerald', text: `Score: ${card.match_score}/10` }) : null,
      card.has_verified_receipt ? h('span', { className: 'pill pill-blue', text: 'Receipt Verified' }) : null,
      card.submission_uncertain ? h('span', { className: 'pill pill-amber', text: 'Submission Uncertain' }) : null,
    ),
    h('div', { className: 'list-stack' },
      h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'Application ID' }), h('code', { className: 'md-inline-code', text: card.application_id })),
      card.job_id ? h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'Job ID' }), h('code', { className: 'md-inline-code', text: card.job_id })) : null,
      h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'Platform / Channel' }), h('span', { text: `${card.platform} (${card.source_channel})` })),
      card.cv_version_id ? h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'CV Version' }), h('code', { className: 'md-inline-code', text: card.cv_version_id })) : null,
      card.applied_at ? h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'Applied At' }), h('span', { text: card.applied_at })) : null,
      card.url ? h('div', { className: 'list-row' }, h('span', { className: 'muted-text', text: 'Posting URL' }), h('a', { className: 'btn btn-sm', href: card.url, text: 'Open Posting' })) : null,
    ),
    card.matched_skills.length > 0
      ? h('div', { className: 'card', text: '' },
          h('h3', { className: 'card-title', text: 'Matched Skills' }),
          h('div', { className: 'filter-bar' }, card.matched_skills.map((s) => h('span', { className: 'pill pill-emerald', text: s }))),
        )
      : null,
    card.true_gaps.length > 0
      ? h('div', { className: 'card' },
          h('h3', { className: 'card-title', text: 'Isolated True Gaps' }),
          h('div', { className: 'filter-bar' }, card.true_gaps.map((s) => h('span', { className: 'pill pill-amber', text: s }))),
        )
      : null,
    card.notes
      ? h('div', { className: 'card' },
          h('h3', { className: 'card-title', text: 'Ledger Notes' }),
          h('pre', { className: 'code-snippet', text: card.notes }),
        )
      : null,
  );
}

function renderKanban() {
  const panel = document.getElementById('view-kanban');
  if (!panel || !state.applications) return;

  const { kanban, cv_versions: cvVersions, lock, transaction } = state.applications;
  const allItems = kanban.items || [];
  const platforms = [...new Set(allItems.map((i) => i.platform))].sort();
  const cvs = (cvVersions?.versions || []).map((v) => v.cv_version_id);

  const q = state.kanbanQuery.trim().toLowerCase();
  const matchesFilter = (item) => {
    if (state.kanbanPlatform !== 'all' && item.platform !== state.kanbanPlatform) return false;
    if (state.kanbanCv !== 'all' && item.cv_version_id !== state.kanbanCv) return false;
    if (!q) return true;
    return (
      item.company.toLowerCase().includes(q) ||
      item.role_title.toLowerCase().includes(q) ||
      (item.job_id || '').toLowerCase().includes(q) ||
      item.matched_skills.some((s) => s.toLowerCase().includes(q))
    );
  };

  const filterBar = h('div', { className: 'filter-bar' },
    h('input', {
      className: 'input',
      type: 'text',
      placeholder: 'Search company, role, job_id, skill...',
      value: state.kanbanQuery,
      onInput: (e) => {
        state.kanbanQuery = e.target.value;
        renderKanbanBoardOnly();
      },
    }),
    h('select', {
      className: 'select',
      onChange: (e) => {
        state.kanbanPlatform = e.target.value;
        renderKanbanBoardOnly();
      },
    },
      h('option', { value: 'all', text: 'All Platforms', selected: state.kanbanPlatform === 'all' }),
      platforms.map((p) => h('option', { value: p, text: p, selected: state.kanbanPlatform === p })),
    ),
    h('select', {
      className: 'select',
      onChange: (e) => {
        state.kanbanCv = e.target.value;
        renderKanbanBoardOnly();
      },
    },
      h('option', { value: 'all', text: 'All Owner CV Versions', selected: state.kanbanCv === 'all' }),
      cvs.map((id) => h('option', { value: id, text: id, selected: state.kanbanCv === id })),
    ),
    kanban.third_party_excluded > 0
      ? h('span', { className: 'pill pill-blue', text: `Isolated ${kanban.third_party_excluded} third-party record(s)` })
      : null,
    lock?.locked ? h('span', { className: 'pill pill-amber', text: 'Ledger Lock Active' }) : h('span', { className: 'pill pill-emerald', text: 'Ledger Lock Clear' }),
    transaction?.pending ? h('span', { className: 'pill pill-rose', text: 'Pending Journal Tx' }) : null,
  );

  const boardMount = h('div', { id: 'kanban-board-mount' });
  panel.replaceChildren(filterBar, boardMount);

  function renderKanbanBoardOnly() {
    const mount = document.getElementById('kanban-board-mount');
    if (!mount) return;
    if (allItems.length === 0) {
      mount.replaceChildren(
        h('div', { className: 'card' },
          h('h2', { className: 'card-title', text: 'No Owner Applications Logged Yet' }),
          h('p', { className: 'muted-text', text: 'logs/applications-log.json has 0 owner records in this workspace. Run /demo, /apply-url, or veycraft career record to populate your pipeline.' }),
        ),
      );
      return;
    }

    const cols = kanban.column_definitions.map((colDef) => {
      const colCards = (kanban.columns[colDef.id] || []).filter(matchesFilter);
      return h('div', { className: 'kanban-col' },
        h('div', { className: 'kanban-col-header' },
          h('span', { text: colDef.label }),
          h('span', { className: 'pill pill-slate', text: String(colCards.length) }),
        ),
        h('div', { className: 'kanban-cards' },
          colCards.map((card) =>
            h('button', { className: 'app-card', type: 'button', onClick: () => openApplicationDrawer(card) },
              h('div', { className: 'app-card-company', text: card.company }),
              h('div', { className: 'app-card-role', text: card.role_title }),
              h('div', { className: 'app-card-meta' },
                h('span', { className: statusPillClass(card.status), text: card.status }),
                h('span', { className: 'pill pill-slate', text: card.platform }),
                card.match_score !== null ? h('span', { className: 'pill pill-emerald', text: `${card.match_score}` }) : null,
                card.has_verified_receipt ? h('span', { className: 'pill pill-blue', text: 'Receipt' }) : null,
              ),
            ),
          ),
        ),
      );
    });

    mount.replaceChildren(h('div', { className: 'kanban-board' }, cols));
  }

  renderKanbanBoardOnly();
}

// ---------------- VIEW 3: ANALYTICS ----------------
async function loadAnalytics(period = 'all') {
  const panel = document.getElementById('view-analytics');
  if (!panel) return;
  state.analyticsPeriod = period;
  panel.replaceChildren(h('div', { className: 'card', text: `Computing deterministic analytics (${period})...` }));
  try {
    const res = await apiGet(`/api/analytics?period=${encodeURIComponent(period)}`);
    state.analytics = res.analytics;
    renderAnalytics();
  } catch (err) {
    panel.replaceChildren(h('div', { className: 'banner banner-error', text: `Analytics error: ${err.message}` }));
  }
}

function formatRateCell(rateObj) {
  if (!rateObj || !rateObj.sample_sufficient || rateObj.rate_pct === null) {
    return `n=${rateObj?.denominator ?? 0} (< MIN_N)`;
  }
  return `${rateObj.rate_pct}% (${rateObj.numerator}/${rateObj.denominator})`;
}

function renderAnalytics() {
  const panel = document.getElementById('view-analytics');
  if (!panel || !state.analytics) return;

  const a = state.analytics;
  const f = a.funnel;
  const suff = a.sample_sufficiency;
  const monthlyPeriods = (a.timing?.activity?.monthly || []).map((m) => m.period).reverse();

  const periodBar = h('div', { className: 'filter-bar' },
    h('span', { className: 'field-label', text: 'Period:' }),
    h('button', {
      className: `subtab-btn ${state.analyticsPeriod === 'all' ? 'active' : ''}`,
      text: 'All-Time',
      onClick: () => loadAnalytics('all'),
    }),
    monthlyPeriods.slice(0, 6).map((p) =>
      h('button', {
        className: `subtab-btn ${state.analyticsPeriod === p ? 'active' : ''}`,
        text: p,
        onClick: () => loadAnalytics(p),
      }),
    ),
  );

  const sufficiencyBanner = h('div', { className: suff.sufficient ? 'banner' : 'banner banner-warn' },
    h('strong', {
      text: suff.sufficient
        ? `Sample Sufficiency Met: n=${suff.submitted_n} submitted applications (MIN_N = ${suff.min_threshold}).`
        : `Honest Sample Guard (MIN_N = ${suff.min_threshold}): Only ${suff.submitted_n} submitted application(s) in "${a.period}" — conversion percentages are suppressed until n >= ${suff.min_threshold}.`,
    }),
  );

  const kpis = h('div', { className: 'kpi-grid' },
    h('div', { className: 'kpi-card' },
      h('div', { className: 'kpi-value', text: String(f.total_tracked) }),
      h('div', { className: 'kpi-label', text: 'Tracked Roles' }),
      h('div', { className: 'kpi-sub', text: `${f.prepared_only_count} prepared/dry-run` }),
    ),
    h('div', { className: 'kpi-card' },
      h('div', { className: 'kpi-value', text: String(f.submitted_count) }),
      h('div', { className: 'kpi-label', text: 'Submitted' }),
      h('div', { className: 'kpi-sub', text: `${f.pending_active_count} active · ${f.silent_14d_count} silent >=14d (not counted as rejected)` }),
    ),
    h('div', { className: 'kpi-card' },
      h('div', { className: 'kpi-value', text: formatRateCell(f.rates.callback_rate) }),
      h('div', { className: 'kpi-label', text: 'Positive Callback Rate' }),
      h('div', { className: 'kpi-sub', text: `${f.ever_interviewed_count} interviews · ${f.offer_count} offers` }),
    ),
    h('div', { className: 'kpi-card' },
      h('div', { className: 'kpi-value', text: f.avg_match_score !== null ? `${f.avg_match_score}/10` : 'N/A' }),
      h('div', { className: 'kpi-label', text: 'Average Match Score' }),
      h('div', { className: 'kpi-sub', text: a.timing.response_time.sample_sufficient ? `Median reply: ${a.timing.response_time.median_days}d` : 'Median reply: n < 5' }),
    ),
  );

  const platformCard = h('div', { className: 'card' },
    h('div', { className: 'card-header' },
      h('h2', { className: 'card-title', text: 'Source Platform Breakdown' }),
    ),
    h('p', { className: 'muted-text', text: a.source_performance.causal_humility_note }),
    (a.source_performance.by_platform || []).length === 0
      ? h('p', { className: 'muted-text', text: 'No submitted platform records in this period.' })
      : h('div', { className: 'table-wrap' },
          h('table', { className: 'data-table' },
            h('thead', null, h('tr', null,
              h('th', { text: 'Platform' }),
              h('th', { text: 'Submitted' }),
              h('th', { text: 'Callbacks' }),
              h('th', { text: 'Callback Rate' }),
              h('th', { text: 'Avg Score' }),
            )),
            h('tbody', null, a.source_performance.by_platform.map((row) =>
              h('tr', null,
                h('td', { text: row.platform }),
                h('td', { text: String(row.submitted) }),
                h('td', { text: String(row.callbacks) }),
                h('td', { text: formatRateCell(row.callback_rate) }),
                h('td', { text: row.avg_match_score !== null ? String(row.avg_match_score) : '-' }),
              ),
            )),
          ),
        ),
  );

  const maxSkillCount = Math.max(1, ...(a.skills_summary.top_skills || []).map((s) => s.count), ...(a.skills_summary.skill_gaps || []).map((s) => s.count));
  const skillsCard = h('div', { className: 'two-col' },
    h('div', { className: 'card' },
      h('h2', { className: 'card-title', text: 'Top Matched Skills' }),
      (a.skills_summary.top_skills || []).length === 0
        ? h('p', { className: 'muted-text', text: 'No skill tags recorded yet.' })
        : (a.skills_summary.top_skills || []).map((s) =>
            h('div', { className: 'meter-row' },
              h('span', { className: 'meter-label', text: s.skill }),
              h('progress', { className: 'meter', max: String(maxSkillCount), value: String(s.count) }),
              h('span', { className: 'pill pill-emerald', text: String(s.count) }),
            ),
          ),
    ),
    h('div', { className: 'card' },
      h('h2', { className: 'card-title', text: 'Recurring True Skill Gaps' }),
      (a.skills_summary.skill_gaps || []).length === 0
        ? h('p', { className: 'muted-text', text: 'No recurring skill gaps recorded yet.' })
        : (a.skills_summary.skill_gaps || []).map((s) =>
            h('div', { className: 'meter-row' },
              h('span', { className: 'meter-label', text: s.skill }),
              h('progress', { className: 'meter', max: String(maxSkillCount), value: String(s.count) }),
              h('span', { className: 'pill pill-amber', text: String(s.count) }),
            ),
          ),
    ),
  );

  panel.replaceChildren(periodBar, sufficiencyBanner, kpis, platformCard, skillsCard);
}

// ---------------- VIEW 4: STUDIO (IN-MEMORY) ----------------
function renderStudio() {
  const panel = document.getElementById('view-studio');
  if (!panel) return;

  const subtabs = [
    ['route', 'Intent Router'],
    ['audit', 'CV Hygiene Audit'],
    ['verify', 'Artifact Fact-Check'],
    ['presubmit', 'Pre-Submit Gate'],
  ];

  const subtabBar = h('div', { className: 'filter-bar' },
    subtabs.map(([id, label]) =>
      h('button', {
        className: `subtab-btn ${state.studioSubtab === id ? 'active' : ''}`,
        text: label,
        onClick: () => {
          state.studioSubtab = id;
          renderStudio();
        },
      }),
    ),
    h('span', { className: 'pill pill-slate', text: '100% In-Memory · Zero Disk Writes' }),
  );

  const bodyMount = h('div');
  const resultMount = h('div');
  const workspaceFiles = state.overview?.workspace_files || [];

  if (state.studioSubtab === 'route') {
    const queryInput = h('input', {
      className: 'input',
      type: 'text',
      value: 'Tailor my CV for this Senior Backend Engineer JD without inventing metrics',
      placeholder: 'Describe any career task in natural language...',
    });
    const runRoute = async () => {
      resultMount.replaceChildren(h('div', { className: 'card', text: 'Routing...' }));
      try {
        const { route } = await apiPost('/api/route', { query: queryInput.value });
        resultMount.replaceChildren(
          h('div', { className: 'card' },
            h('div', { className: 'card-header' },
              h('h3', { className: 'card-title', text: `Matched Intent: ${route.intent}` }),
              route.workflow ? h('code', { className: 'md-inline-code', text: route.workflow }) : null,
            ),
            h('p', { className: 'muted-text', text: `Readiness: ${route.readiness}` }),
            h('p', { className: 'muted-text', text: `Offline Fallback: ${route.fallback}` }),
            h('div', { className: 'filter-bar' },
              (route.skills || []).map((sk) =>
                h('button', {
                  className: 'btn btn-sm',
                  text: `Skill: ${sk}`,
                  onClick: () => {
                    state.selectedSkillName = sk;
                    switchTab('skills');
                    if (state.skillsManifest) selectAndLoadSkill(sk);
                  },
                }),
              ),
            ),
          ),
        );
      } catch (err) {
        resultMount.replaceChildren(h('div', { className: 'banner banner-error', text: err.message }));
      }
    };
    bodyMount.replaceChildren(
      h('div', { className: 'card' },
        h('h2', { className: 'card-title', text: 'Deterministic Natural-Language Task Router' }),
        h('div', { className: 'field-group' },
          h('label', { className: 'field-label', text: 'Task Request' }),
          queryInput,
        ),
        h('div', { className: 'filter-bar' },
          h('button', { className: 'btn btn-primary', text: 'Route Request', onClick: runRoute }),
        ),
      ),
      resultMount,
    );
  } else if (state.studioSubtab === 'audit') {
    const cvTextarea = h('textarea', {
      className: 'textarea',
      placeholder: 'Paste Markdown, HTML, or plain-text CV here...',
      text: '# Backend Engineer\n\n- Built idempotent Node.js payment services handling 120k requests/day with 99.95% uptime.\n- Reduced PostgreSQL query p95 latency by 38% across 14 production services.\n- Automated CI validation pipelines saving 6 hours/week across 12 engineers.\n',
    });
    const fileSelect = h('select', { className: 'select' },
      h('option', { value: '', text: '-- Or audit an existing workspace file --' }),
      workspaceFiles.filter((f) => ['md', 'txt', 'html', 'doc', 'docx'].includes(f.ext)).map((f) =>
        h('option', { value: f.rel_path, text: f.rel_path }),
      ),
    );
    const runAudit = async () => {
      resultMount.replaceChildren(h('div', { className: 'card', text: 'Auditing CV hygiene...' }));
      try {
        const payload = fileSelect.value ? { path: fileSelect.value } : { text: cvTextarea.value, format: 'md' };
        const { audit } = await apiPost('/api/audit', payload);
        resultMount.replaceChildren(
          h('div', { className: 'card' },
            h('div', { className: 'card-header' },
              h('h3', { className: 'card-title', text: `CV Hygiene Score: ${audit.total_score}/100` }),
              h('span', { className: audit.total_score >= 75 ? 'pill pill-emerald' : 'pill pill-amber', text: audit.length_status }),
            ),
            h('div', { className: 'kpi-grid' },
              h('div', { className: 'kpi-card' }, h('div', { className: 'kpi-value', text: `${audit.tone_score}/25` }), h('div', { className: 'kpi-label', text: 'Tone & Anti-Slop' }), h('div', { className: 'kpi-sub', text: `${audit.cliches_found.length} cliches · ${audit.em_dash_count} em-dashes` })),
              h('div', { className: 'kpi-card' }, h('div', { className: 'kpi-value', text: `${audit.impact_score}/30` }), h('div', { className: 'kpi-label', text: 'Quantified Impact' }), h('div', { className: 'kpi-sub', text: `${audit.quantified_bullets}/${audit.bullet_count} bullets · ${audit.total_metrics} metrics` })),
              h('div', { className: 'kpi-card' }, h('div', { className: 'kpi-value', text: `${audit.length_score}/25` }), h('div', { className: 'kpi-label', text: '1-Page Fit' }), h('div', { className: 'kpi-sub', text: `${audit.word_count} words · ${audit.line_count} lines` })),
              h('div', { className: 'kpi-card' }, h('div', { className: 'kpi-value', text: `${audit.hygiene_score}/20` }), h('div', { className: 'kpi-label', text: 'Link & PII Hygiene' }), h('div', { className: 'kpi-sub', text: `Status: ${audit.hygiene_label}` })),
            ),
            audit.cliches_found.length > 0
              ? h('p', { className: 'muted-text', text: `Flagged AI Cliches: ${audit.cliches_found.join(', ')}` })
              : null,
          ),
        );
      } catch (err) {
        resultMount.replaceChildren(h('div', { className: 'banner banner-error', text: err.message }));
      }
    };
    bodyMount.replaceChildren(
      h('div', { className: 'card' },
        h('h2', { className: 'card-title', text: 'Offline CV Hygiene Audit' }),
        h('div', { className: 'filter-bar' }, fileSelect),
        cvTextarea,
        h('div', { className: 'filter-bar' },
          h('button', { className: 'btn btn-primary', text: 'Run CV Audit', onClick: runAudit }),
        ),
      ),
      resultMount,
    );
  } else if (state.studioSubtab === 'verify') {
    const artifactArea = h('textarea', {
      className: 'textarea',
      placeholder: 'Paste tailored HTML, Markdown, or TXT artifact...',
      text: '<!doctype html><html><body><h1>Resume</h1><p>Reduced payment webhook p95 latency by 38% across 3 regions.</p></body></html>',
    });
    const metricsInput = h('input', { className: 'input', type: 'text', value: '38%, 3', placeholder: 'Comma-separated allowed metrics (e.g. 38%, $4.2M)' });
    const forbiddenInput = h('input', { className: 'input', type: 'text', value: 'Kubernetes, Rust', placeholder: 'Comma-separated forbidden skills' });

    const runVerify = async () => {
      resultMount.replaceChildren(h('div', { className: 'card', text: 'Verifying artifact...' }));
      try {
        const allowed = metricsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        const forbidden = forbiddenInput.value.split(',').map((s) => s.trim()).filter(Boolean);
        const { verification } = await apiPost('/api/verify', {
          text: artifactArea.value,
          format: 'html',
          facts_json: { ground_truth_metrics: allowed, forbidden_skills: forbidden },
        });
        const first = verification.results[0];
        resultMount.replaceChildren(
          h('div', { className: 'card' },
            h('div', { className: 'card-header' },
              h('h3', { className: 'card-title', text: verification.ok ? 'Artifact Verification PASSED' : 'Artifact Verification BLOCKED' }),
              h('span', { className: verification.ok ? 'pill pill-emerald' : 'pill pill-rose', text: `${verification.error_count} error(s)` }),
            ),
            first.errors.length === 0
              ? h('p', { className: 'muted-text', text: '0 unresolved placeholders, 0 banned cliches, 0 prose em-dashes, and 0 unverified metrics or forbidden skills.' })
              : h('div', { className: 'list-stack' }, first.errors.map((e) => h('div', { className: 'banner banner-error', text: e }))),
          ),
        );
      } catch (err) {
        resultMount.replaceChildren(h('div', { className: 'banner banner-error', text: err.message }));
      }
    };
    bodyMount.replaceChildren(
      h('div', { className: 'card' },
        h('h2', { className: 'card-title', text: 'Anti-Hallucination & Placeholder Verifier' }),
        h('div', { className: 'form-grid' },
          h('div', { className: 'field-group' }, h('label', { className: 'field-label', text: 'Verified Metrics Allowlist' }), metricsInput),
          h('div', { className: 'field-group' }, h('label', { className: 'field-label', text: 'Forbidden / Unclaimed Skills' }), forbiddenInput),
        ),
        artifactArea,
        h('div', { className: 'filter-bar' },
          h('button', { className: 'btn btn-primary', text: 'Verify Artifact', onClick: runVerify }),
        ),
      ),
      resultMount,
    );
  } else {
    const companyIn = h('input', { className: 'input', type: 'text', placeholder: 'Company (e.g. Acme Payments)' });
    const titleIn = h('input', { className: 'input', type: 'text', placeholder: 'Role Title (e.g. Senior Backend Engineer)' });
    const platformIn = h('input', { className: 'input', type: 'text', value: 'greenhouse', placeholder: 'Platform (e.g. greenhouse, linkedin)' });
    const draftArea = h('textarea', {
      className: 'textarea',
      text: 'Hi hiring team, sharing my backend engineering application highlighting 38% webhook latency improvements on Node.js and PostgreSQL.',
    });
    const runPreSubmit = async () => {
      resultMount.replaceChildren(h('div', { className: 'card', text: 'Evaluating pre-submit guardrails...' }));
      try {
        const { evaluation } = await apiPost('/api/pre-submit', {
          company: companyIn.value,
          title: titleIn.value,
          platform: platformIn.value,
          text: draftArea.value,
          max_words: 75,
        });
        resultMount.replaceChildren(
          h('div', { className: 'card' },
            h('div', { className: 'card-header' },
              h('h3', { className: 'card-title', text: evaluation.allowed ? 'Pre-Submit Gate PASSED (Requires Human APPROVE)' : 'Pre-Submit Gate BLOCKED' }),
              h('span', { className: evaluation.allowed ? 'pill pill-emerald' : 'pill pill-rose', text: `dry_run: ${evaluation.dry_run}` }),
            ),
            evaluation.violations.length === 0
              ? h('p', { className: 'muted-text', text: `Daily cap OK (${evaluation.checks.daily_cap.today_counted}/${evaluation.checks.daily_cap.effective_cap}), deduplication OK, blacklist OK, draft ${evaluation.checks.draft?.word_count || 0}/75 words OK.` })
              : h('div', { className: 'list-stack' }, evaluation.violations.map((v) => h('div', { className: 'banner banner-error', text: `${v.code}: ${v.message}` }))),
          ),
        );
      } catch (err) {
        resultMount.replaceChildren(h('div', { className: 'banner banner-error', text: err.message }));
      }
    };
    bodyMount.replaceChildren(
      h('div', { className: 'card' },
        h('h2', { className: 'card-title', text: 'Pre-Submit Cap, Dedup & <= 75-Word Outreach Gate' }),
        h('div', { className: 'form-grid' },
          h('div', { className: 'field-group' }, h('label', { className: 'field-label', text: 'Company' }), companyIn),
          h('div', { className: 'field-group' }, h('label', { className: 'field-label', text: 'Role Title' }), titleIn),
          h('div', { className: 'field-group' }, h('label', { className: 'field-label', text: 'Platform' }), platformIn),
        ),
        draftArea,
        h('div', { className: 'filter-bar' },
          h('button', { className: 'btn btn-primary', text: 'Evaluate Pre-Submit Gate', onClick: runPreSubmit }),
        ),
      ),
      resultMount,
    );
  }

  panel.replaceChildren(subtabBar, bodyMount);
}

// ---------------- VIEW 5: SKILLS & GUARDRAILS ----------------
async function loadSkills() {
  const panel = document.getElementById('view-skills');
  if (!panel) return;
  panel.replaceChildren(h('div', { className: 'card', text: 'Loading 53 Markdown skill playbooks...' }));
  try {
    state.skillsManifest = await apiGet('/api/skills');
    const initialSkill = state.selectedSkillName || state.skillsManifest.skills[0]?.name;
    renderSkillsShell();
    if (initialSkill) await selectAndLoadSkill(initialSkill);
  } catch (err) {
    panel.replaceChildren(h('div', { className: 'banner banner-error', text: `Failed loading skills: ${err.message}` }));
  }
}

async function selectAndLoadSkill(name) {
  state.selectedSkillName = name;
  for (const btn of document.querySelectorAll('.skill-item-btn')) {
    btn.classList.toggle('active', btn.dataset.skill === name);
  }
  const reader = document.getElementById('skill-reader-pane');
  if (!reader) return;
  reader.replaceChildren(h('p', { className: 'muted-text', text: `Loading veycraft://skill/${name}...` }));

  try {
    let payload = state.skillCache.get(name);
    if (!payload) {
      payload = await apiGet(`/api/skills/${encodeURIComponent(name)}`);
      state.skillCache.set(name, payload);
    }
    const sk = payload.skill;
    reader.replaceChildren(
      h('div', { className: 'card-header' },
        h('div', null,
          h('h2', { className: 'card-title', text: `${sk.name} (v${sk.version})` }),
          h('div', { className: 'subtitle', text: `${payload.uri} · ${sk.path}` }),
        ),
        h('button', { className: 'btn btn-sm', text: 'Copy URI', onClick: () => copyText(payload.uri, `Copied ${payload.uri}`) }),
      ),
      h('p', { className: 'muted-text', text: sk.description }),
      h('div', { className: 'filter-bar' },
        h('span', { className: 'pill pill-emerald', text: `category: ${sk.category || 'core'}` }),
        ...(sk.requires_mcp || []).map((m) => h('span', { className: 'pill pill-blue', text: `mcp: ${m}` })),
      ),
      renderMarkdownSafe(payload.content),
    );
  } catch (err) {
    reader.replaceChildren(h('div', { className: 'banner banner-error', text: err.message }));
  }
}

function renderSkillsShell() {
  const panel = document.getElementById('view-skills');
  if (!panel || !state.skillsManifest) return;

  const allSkills = state.skillsManifest.skills || [];
  const categories = [...new Set(allSkills.map((s) => s.category || 'core'))].sort();

  const filterBar = h('div', { className: 'filter-bar' },
    h('input', {
      className: 'input',
      type: 'text',
      placeholder: 'Search 53 skills by name, trigger, or keyword...',
      value: state.skillsQuery,
      onInput: (e) => {
        state.skillsQuery = e.target.value;
        renderSkillListItems();
      },
    }),
    h('select', {
      className: 'select',
      onChange: (e) => {
        state.skillsCategory = e.target.value;
        renderSkillListItems();
      },
    },
      h('option', { value: 'all', text: 'All Categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: state.skillsCategory === c })),
    ),
    h('select', {
      className: 'select',
      onChange: (e) => {
        state.skillsMcp = e.target.value;
        renderSkillListItems();
      },
    },
      h('option', { value: 'all', text: 'Any MCP Requirement' }),
      h('option', { value: 'none', text: 'Offline Only (mcp: none)' }),
      h('option', { value: 'playwright', text: 'Uses Playwright MCP' }),
    ),
  );

  const listPane = h('div', { id: 'skills-list-pane', className: 'skills-list-pane' });
  const readerPane = h('div', { id: 'skill-reader-pane', className: 'card' });

  const invariantsCard = state.skillsManifest.invariants_text
    ? h('div', { className: 'card' },
        h('div', { className: 'card-header' },
          h('h2', { className: 'card-title', text: 'Non-Negotiable Safety Invariants (config/invariants.txt)' }),
          h('span', { className: 'pill pill-emerald', text: 'veycraft://invariants' }),
        ),
        h('pre', { className: 'code-snippet', text: state.skillsManifest.invariants_text }),
      )
    : null;

  panel.replaceChildren(filterBar, h('div', { className: 'skills-layout' }, listPane, readerPane), invariantsCard);

  function renderSkillListItems() {
    const q = state.skillsQuery.trim().toLowerCase();
    const filtered = allSkills.filter((s) => {
      if (state.skillsCategory !== 'all' && (s.category || 'core') !== state.skillsCategory) return false;
      if (state.skillsMcp !== 'all' && !(s.requires_mcp || []).includes(state.skillsMcp)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.triggers || []).some((t) => t.toLowerCase().includes(q))
      );
    });

    listPane.replaceChildren(
      ...filtered.map((s) =>
        h('button', {
          className: `skill-item-btn ${state.selectedSkillName === s.name ? 'active' : ''}`,
          type: 'button',
          dataset: { skill: s.name },
          onClick: () => selectAndLoadSkill(s.name),
        },
          h('div', { className: 'app-card-role', text: s.name }),
          h('div', { className: 'muted-text', text: (s.triggers || []).slice(0, 2).join(' · ') || s.path }),
        ),
      ),
    );
  }

  renderSkillListItems();
}

// ---------------- BOOTSTRAP ----------------
async function refreshAll() {
  try {
    state.overview = await apiGet('/api/overview');
    renderOverview();
    if (state.activeTab === 'kanban') await loadKanban();
    if (state.activeTab === 'analytics') await loadAnalytics(state.analyticsPeriod);
    if (state.activeTab === 'skills') await loadSkills();
  } catch (err) {
    const panel = document.getElementById('view-overview');
    if (panel) {
      panel.replaceChildren(h('div', { className: 'banner banner-error', text: `Failed loading overview: ${err.message}` }));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await refreshAll();
      showToast('Refreshed local workspace snapshot');
    });
  }
  refreshAll();
});
