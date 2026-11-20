// ---------- router ----------
// Paths under BASE; every view is async and returns HTML. Window params ride along in the query string so a link
// (Share) opens the same period, environment, project and service on supported views.
const H = '([0-9a-f]{32})', U = '([0-9a-f-]{36})';
const ROUTER = [
  [/^$/, () => vDashboard(), 'dashboard'], [/^issues$/, () => vIssues(), 'issues'], [/^issues\/(\d+)$/, m => vIssue(m[1]), 'issues'],
  [/^requests$/, () => vRequests(), 'requests'], [new RegExp('^requests/routes/' + H + '$'), m => vRoute(m[1]), 'requests'], [/^requests\/([0-9]+|[0-9a-f-]{36})$/, m => vRequest(m[1]), 'requests'],
  [/^jobs$/, () => vJobs(), 'jobs'], [new RegExp('^jobs/attempts/' + U + '$'), m => vJobAttempt(m[1]), 'jobs'], [new RegExp('^jobs/' + H + '$'), m => vJob(m[1]), 'jobs'],
  [/^commands$/, () => vCommands(), 'commands'], [/^commands\/runs\/([0-9]+|[0-9a-f-]{36})$/, m => vRun(m[1], 'command'), 'commands'], [new RegExp('^commands/' + H + '$'), m => vCommand(m[1]), 'commands'],
  [/^scheduled-tasks$/, () => vScheduled(), 'scheduled-tasks'], [/^scheduled-tasks\/runs\/([0-9]+|[0-9a-f-]{36})$/, m => vRun(m[1], 'task'), 'scheduled-tasks'], [new RegExp('^scheduled-tasks/' + H + '$'), m => vTask(m[1]), 'scheduled-tasks'],
  [/^exceptions$/, () => vExceptions(), 'exceptions'], [new RegExp('^exceptions/' + H + '$'), m => vException(m[1]), 'exceptions'],
  [/^queries$/, () => vQueries(), 'queries'], [new RegExp('^queries/' + H + '$'), m => vQuery(m[1]), 'queries'],
  ...(BOOT.sources_enabled ? [
    [/^queries\/otlp\/(\d+)\/([0-9a-f]{32,64})$/, m => vQuery(m[2], m[1]), 'queries'],
    [/^worker-progress$/, () => vWorkerProgress(), 'worker-progress'],
  ] : []),
  [/^notifications$/, () => vNotifications(), 'notifications'], [new RegExp('^notifications/' + H + '$'), m => vNotification(m[1]), 'notifications'],
  [/^mail$/, () => vMail(), 'mail'], [new RegExp('^mail/' + H + '$'), m => vMailable(m[1]), 'mail'],
  [/^cache$/, () => vCache(), 'cache'], [/^outgoing$/, () => vOutgoing(), 'outgoing'], [new RegExp('^outgoing/' + H + '$'), m => vDomain(m[1]), 'outgoing'],
  [/^users$/, () => vUsers(), 'users'], [/^users\/([^/]+)$/, m => vUser(decodeURIComponent(m[1])), 'users'], [/^logs$/, () => vLogs(), 'logs'],
  [/^settings$/, () => vSettings(), 'settings'], [/^mcp$/, () => vMcp(), 'mcp'],
];
const TITLES = { dashboard: 'Dashboard', issues: 'Issues', requests: 'Requests', jobs: 'Jobs', commands: 'Commands', 'scheduled-tasks': 'Scheduled Tasks', exceptions: 'Exceptions', queries: 'Queries', 'worker-progress': 'Worker progress', notifications: 'Notifications', mail: 'Mail', cache: 'Cache', outgoing: 'Outgoing Requests', users: 'Users', logs: 'Logs', settings: 'Settings', mcp: 'MCP' };
const curRel = () => { const p = decodeURIComponent(location.pathname); return (p.startsWith(BASE) ? p.slice(BASE.length) : p).replace(/^\/+|\/+$/g, ''); };
function query(rel) {
  const scoped = BOOT.sources_enabled && (rel === 'worker-progress' || /^queries(?:\/|$)/.test(rel));
  const q = new URLSearchParams();
  if (S.period === 'custom') {
    q.set('from', S.from);
    q.set('to', S.to);
  } else if (scoped || S.period !== '24h') {
    q.set('period', S.period);
  }
  if (scoped || S.env) q.set('env', S.env || '');
  if (scoped && S.project) q.set('project', S.project);
  if (scoped && S.service) q.set('service', S.service);
  const params = q.toString();
  return params ? '?' + params : '';
}
const urlFor = rel => BASE + (rel ? '/' + rel : '') + query(rel);
let PENDING = null; // VS seeded for the next page (e.g. a search from a trace span)
function go(rel, seed = null) { closeDrawer(); closePop(); PENDING = seed; history.pushState(null, '', urlFor(rel)); render(); }
let curPath = null, seq = 0;
async function render(keepScroll) {
  const my = ++seq; const path = curRel();
  if (path !== curPath) { const keep = { conn: VS.conn }; VS = PENDING || {}; PENDING = null; if (path === 'queries') VS.conn = VS.conn || keep.conn; curPath = path; TL = null; keepScroll = false; SEL.clear(); closeDrawer(); closePop(); $('#page').innerHTML = loadingHtml(); }
  let route = null, m = null; for (const r of ROUTER) { m = path.match(r[0]); if (m) { route = r; break; } }
  sidebar(route ? route[2] : ''); document.title = `${TITLES[route ? route[2] : ''] || 'Not found'} · ${BOOT.title || 'Lookout'}`;
  const main = $('#main'); const st = main.scrollTop; const bar = $('#busy'); bar.classList.add('on');
  let html;
  try { html = route ? await route[1](m) : errorHtml({ status: 404, message: 'This page does not exist.' }); }
  catch (e) { if (!(e instanceof ApiError)) console.error(e); html = errorHtml(e); }
  if (my !== seq) return; bar.classList.remove('on');
  const active = document.activeElement;
  const filter = active?.dataset.scopeField;
  const input = active?.matches('input[data-search],input[data-isearch],input[data-logsearch]');
  const focus = filter ? '[data-scope-field="' + filter + '"]'
    : input ? (active.dataset.search ? '[data-search="' + active.dataset.search + '"]' : active.dataset.isearch ? '[data-isearch]' : '#logq') : null;
  const selection = input ? active.selectionStart : null;
  for (const k in CH) if (!html.includes(`data-chart="${k}"`)) delete CH[k];
  $('#page').innerHTML = html;
  if (TL) renderTL();
  main.scrollTop = keepScroll ? st : 0;
  if (focus && $(focus)) {
    const next = $(focus);
    next.focus({ preventScroll: true });
    if (selection !== null) next.setSelectionRange(selection, selection);
  }
  $('#current-environment').textContent = S.env || 'All environments';
  document.body.classList.remove('nav-open');
  if (OPEN_ISSUES == null) refreshBadge();
}
function applyTheme() { const t = S.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.theme; document.documentElement.setAttribute('data-theme', t); }
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const rerenderSoon = debounce(() => render(true), 320);
