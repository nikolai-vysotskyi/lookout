// ---------- thresholds (for the "over threshold" marks) ----------
async function thresholdList() { try { return (await api('/settings')).thresholds || []; } catch (e) { return []; } }
function thrFor(list, type, ...targets) {
  const t = targets.filter(Boolean); const sp = list.find(x => x.type === type && x.target && t.includes(x.target));
  if (sp) return sp.duration_ms; const g = list.find(x => x.type === type && !x.target); return g ? g.duration_ms : null;
}
const routeTargets = r => [r.threshold_target, r.path];

// ---------- dashboard ----------
async function vDashboard() {
  const [o, top, hit] = await Promise.all([api('/overview', wp()), api('/users', { ...wp(), limit: 6 }), api('/users', { ...wp(), sort: 'exceptions', limit: 6 })]);
  WIN = o.window; ENVS = o.environments || ENVS;
  const t = o.totals, sr = o.series;
  const exBars = barCard({ label: '', value: '', ts: tsOf(sr.exceptions), legend: false, h: 120, stacks: [{ l: 'Handled', c: COL.grey, data: sr.exceptions.map(b => b.handled) }, { l: 'Unhandled', c: COL.red, data: sr.exceptions.map(b => b.unhandled) }] });
  const exCard = exBars.replace(/<div class="cc-top">[\s\S]*?<\/div><\/div><div class="plot"/, `<div><span class="badge-s">Exceptions</span><div class="lead">${fmtInt(t.exceptions.total)} exception${t.exceptions.total === 1 ? '' : 's'} reported ${esc(periodTxt())}. ${t.exceptions.users_impacted ? `Errors have impacted ${fmtInt(t.exceptions.users_impacted)} user${t.exceptions.users_impacted === 1 ? '' : 's'}.` : 'No signed-in users were impacted.'}</div><div style="display:flex;gap:22px"><div class="lg" style="text-align:left"><div class="lab" style="justify-content:flex-start"><i class="mk" style="background:var(--bar)"></i>Handled</div><div class="big" style="font-size:18px">${fmtN(t.exceptions.handled)}</div></div><div class="lg" style="text-align:left"><div class="lab" style="justify-content:flex-start"><i class="mk" style="background:var(--red)"></i>Unhandled</div><div class="big" style="font-size:18px">${fmtN(t.exceptions.unhandled)}</div></div></div></div><div class="plot"`);
  const tb = o.threshold_breaches;
  const thrCard = `<div class="cc"><div class="lab">Thresholds</div>${tb.thresholds_configured === 0 ? `<div class="lead">No thresholds are set up yet.</div><p class="mut" style="margin:0 0 18px;font-size:13.5px">Set a P95 limit for a route, job or query and a Performance issue opens when it is crossed.</p><button class="btn sm primary" data-go="settings">${ic('sliders', 14)}Setup thresholds</button>` : `<div class="lead">${tb.count ? `${tb.count} ${tb.count === 1 ? 'target is' : 'targets are'} slower than ${tb.count === 1 ? 'its' : 'their'} threshold.` : 'Everything is within its threshold.'}</div>${tb.items.map(x => `<div class="kv" style="cursor:pointer" data-go="issues/${x.issue_id}"><span class="badge-s" style="margin-right:4px">${esc(x.subtype || 'perf')}</span><span class="mono ell" style="font-size:13px">${pathHtml(x.title || '')}</span><span class="f"></span><span class="v over" title="Threshold ${x.threshold_ms}ms">${fmtD(x.triggered_duration_ms)}</span></div>`).join('')}<div style="margin-top:18px"><button class="btn sm" data-go="settings">${ic('sliders', 14)}Manage thresholds</button></div>`}</div>`;
  const ulist = (arr, f, empty) => arr.length ? arr.map(u => `<div class="kv" style="cursor:pointer;height:38px" data-go="users/${encodeURIComponent(u.user_id)}">${avatar({ id: u.user_id, name: u.name, email: u.email }, 'sm')}<span class="ell" style="font-size:13.5px">${esc(userName(u))}</span><span class="f"></span><span class="v">${f(u)}</span></div>`).join('') : `<div class="mut" style="font-size:13.5px;padding:10px 0">${empty}</div>`;
  const impacted = hit.users.filter(u => u.exceptions > 0);
  const jobs = sr.jobs;
  return pageHead('Dashboard') + `
  <section class="block"><div class="block-h"><span class="bi">${ic('panel', 15)}</span><h2>Activity</h2><button class="btn" data-go="requests">Requests ${ic('aur', 14)}</button></div>
    <div class="grid2">${statusBars(sr.requests)}${durCard(sr.requests, t.requests.avg_ms, t.requests.p95_ms, 'Duration', [t.requests.min_ms, t.requests.max_ms])}</div></section>
  <section class="block"><div class="block-h"><span class="bi">${ic('app', 15)}</span><h2>Application</h2><button class="btn" data-go="exceptions">View ${ic('aur', 14)}</button></div>
    <div class="grid3">${exCard}${thrCard}<div style="display:flex;flex-direction:column;gap:10px;min-width:0">${stackBars(jobs, [['processed', 'Processed', COL.grey], ['released', 'Released', COL.orange], ['failed', 'Failed', COL.red]], 'Jobs', 110)}${durCard(jobs, t.jobs.avg_ms, t.jobs.p95_ms, 'Job duration', null, 90)}</div></div></section>
  <section class="block"><div class="block-h"><span class="bi">${ic('user', 15)}</span><h2>Users</h2><button class="btn" data-go="users">View ${ic('aur', 14)}</button></div>
    <div class="grid3"><div class="cc"><span class="badge-s">Most requests</span><div style="margin-top:14px">${ulist(top.users, u => fmtN(u.requests), 'No signed-in requests in this period.')}</div></div><div class="cc"><span class="badge-s">Impacted by exceptions</span><div style="margin-top:14px">${ulist(impacted, u => `<span style="color:var(--red)">${fmtN(u.exceptions)}</span>`, 'No user hit an exception in this period.')}</div></div>${simpleBars(sr.users, 'users', 'Authenticated users', null, 190, fmtN(t.users.authenticated))}</div></section>`;
}

// ---------- requests ----------
const ROUTE_COLS = thr => [
  { k: 'method', label: 'Method', w: '96px', r: x => `<span class="method ${esc(methodOf(x.method))}">${esc(x.method || 'ANY')}</span>` },
  { k: 'path', label: 'Path', w: 'minmax(260px,1fr)', r: x => `<span class="path">${ic(x.path ? 'globe' : 'folder', 15)}<span class="ell">${x.path ? pathHtml(x.path) : 'Unmatched routes'}</span></span>` },
  { k: 'ok', label: '1/2/3XX', w: '90px', num: 1, v: x => x.calls - x.status_4xx - x.status_5xx, r: x => fmtN(x.calls - x.status_4xx - x.status_5xx) }, c4(), c5(),
  cNum('calls', 'Total', '90px', fmtN, 'calls'), cDur('avg_ms', 'AVG', '96px', null, 'avg_ms'),
  cDur('p95_ms', 'P95', '100px', x => thr(x), 'p95_ms'),
];
async function vRequests() {
  const thrs = await thresholdList(); const thr = x => thrFor(thrs, 'route', ...routeTargets(x)); const cols = ROUTE_COLS(thr);
  const [o, d] = await Promise.all([api('/overview', wp()), api('/routes', { ...wp(), limit: 100, ...listParams('routes', cols, { k: 'calls', d: -1 }) })]);
  WIN = o.window; const t = o.totals.requests;
  return pageHead('Requests') + `<div class="charts grid2">${statusBars(o.series.requests)}${durCard(o.series.requests, t.avg_ms, t.p95_ms, 'Duration', [t.min_ms, t.max_ms])}</div>`
    + listHeader({ icon: 'globe', title: `${d.routes.length}${d.routes.length === 100 ? '+' : ''} routes`, tableId: 'routes', placeholder: 'Search paths' })
    + table('routes', cols, d.routes, { go: x => 'requests/routes/' + x.group_hash, serverQ: 1, serverErr: 1, rowCls: x => x.status_5xx > 0 && x.status_5xx / Math.max(1, x.calls) > .005 ? 'err' : '' });
}
async function vRoute(hash) {
  const [d, thrs] = await Promise.all([api('/routes/' + hash, wp()), thresholdList()]); WIN = d.window; const r = d.route;
  const t = thrFor(thrs, 'route', ...routeTargets(r));
  return crumbs([['Requests', 'requests'], [r.path || 'Unmatched routes']]) + `<div class="ph"><h1 style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-width:0"><span class="method ${esc(methodOf(r.method))}" style="font-size:16px">${esc(r.method || 'ANY')}</span><span class="mono" style="font-size:21px;word-break:break-all">${pathHtml(r.path || 'Unmatched routes')}</span></h1><div class="grow"></div>${t ? `<span class="badge-s ${r.p95_ms > t ? 'oo' : ''}">Threshold ${fmtD(t)}</span>` : ''}${periodSeg()}</div>`
    + `<div class="charts grid2">${statusBars(d.series)}${durCard(d.series, r.avg_ms, r.p95_ms)}</div>`
    + listHeader({ icon: 'globe', title: `${fmtInt(r.calls)} requests`, tableId: 'reqs', errLabel: 'Errors' })
    + `<p class="mut hint">The latest ${d.recent_requests.length} requests of this route (raw events are kept about 14 days).</p>`
    + table('reqs', [dateCell(), { k: 'url', label: 'URL', w: 'minmax(200px,1fr)', r: x => `<span class="mono ell" style="font-size:13px;display:block">${esc(x.url)}</span>` }, statusCell(), userCell('user_id', 'User', '150px'),
      cNum('queries', 'Queries', '80px'), cDur('duration_ms', 'Duration', '110px', () => t)],
      d.recent_requests, { sort: { k: 'created_at', d: -1 }, go: x => 'requests/' + x.id, err: x => x.status_code >= 400, text: x => x.url + ' ' + x.status_code, rowCls: x => x.status_code >= 500 ? 'err' : '', emptyText: 'No raw requests of this route in the window.' });
}
// The stack frames of an exception event come from its fingerprint's latest occurrence.
async function excForEvents(events) {
  const ex = events.find(e => e.type === 'exception' && !e.handled) || events.find(e => e.type === 'exception'); if (!ex) return null;
  let latest = null; if (ex.fingerprint) { try { latest = (await api('/exceptions/' + ex.fingerprint, wp())).latest_occurrence; } catch (e) { latest = null; } }
  return { ev: ex, block: { class: ex.class, message: ex.message, file: ex.file, line: ex.line, handled: ex.handled, trace: latest ? latest.trace : [], php_version: latest && latest.php_version, laravel_version: latest && latest.laravel_version } };
}
function captured(v) { if (v == null || v === '') return '<span class="dim">Not captured for this request.</span>'; if (typeof v === 'object') return `<div class="json">${jsonHtml(v)}</div>`; return `<pre class="box">${esc(v)}</pre>`; }
async function vRequest(id) {
  const d = await api('/requests/' + id); const q = d.request; const ev = d.events || []; const exc = await excForEvents(ev);
  const spans = traceRequest(q, ev); const qs = ev.filter(e => e.type === 'query'); const st = `<span class="badge-s ${q.status_code >= 500 ? 'red' : q.status_code >= 400 ? 'oo' : ''}">${q.status_code ?? '—'}</span>`;
  const m = methodOf(q.method); const c = q.counts || {}; const tab = VS.hp || 'headers';
  const rh = q.route && q.route.group_hash;
  return crumbs([['Requests', 'requests'], [q.route && q.route.path ? q.route.path : 'Unmatched routes', rh ? 'requests/routes/' + rh : null], [fmtT(q.created_at)]]) + `<div class="dhead"><h1><span class="method ${esc(m)}" style="font-size:16px">${esc(m)}</span><span class="mono" style="font-size:20px;word-break:break-all">${esc(q.url)}</span>${st}</h1><div class="grow" style="flex:1"></div><button class="btn" data-act="share">${ic('share', 14)}Share</button></div>`
    + (exc ? excBlock(exc.block, { status: q.status_code >= 500 ? q.status_code : '', key: 'req', link: exc.ev.fingerprint ? 'exceptions/' + exc.ev.fingerprint : null }) : (q.exception_preview ? `<div class="note" style="margin-bottom:24px">${ic('ac', 16)}<span>${esc(q.exception_preview)}</span></div>` : ''))
    + kvPanel([['Date', fmtTU(q.created_at)], ['Method', esc(q.method)], ['URL', `<span title="${esc(q.url)}">${esc(q.url)}</span>`], ['Route name', esc(q.route && q.route.name || '—')], ['Action', `<span title="${esc(q.route && q.route.action || '')}">${esc(shortCls(q.route && q.route.action) || '—')}</span>`], ['Status code', `<span class="st ${q.status_code >= 500 ? 's5' : q.status_code >= 400 ? 's4' : ''}">${q.status_code ?? '—'}</span>`], ['Duration', fmtD(q.duration_ms)], ['IP address', esc(q.ip || '—')], ['User', q.user_id ? `<a data-go="users/${encodeURIComponent(q.user_id)}">${esc(userLabel(q.user_id, q.user_name))}</a>` : 'Guest']],
      [['Queries', fmtInt(c.queries)], ['Query duration', fmtD(sum(qs, e => e.duration_ms))], ['Outgoing requests', fmtInt(c.outgoing_requests)], ['Jobs queued', fmtInt(c.jobs_queued)], ['Cache events', fmtInt(c.cache_events)], ['Logs', fmtInt(c.logs)], ['Exceptions', c.exceptions && exc && exc.ev.fingerprint ? `<a data-go="exceptions/${exc.ev.fingerprint}" style="color:var(--red)">${c.exceptions}</a>` : fmtInt(c.exceptions)], ['Peak memory', fmtBytes(q.peak_memory_bytes)], ['Request / response', `${fmtBytes(q.request_size)} / ${fmtBytes(q.response_size)}`], ['Server', esc(q.server || '—')], ['Environment', esc(q.environment || '—')]])
    + timeline(spans)
    + `<div class="panel"><div class="panel-h"><div class="seg sans">${[['headers', 'Headers'], ['payload', 'Payload'], ['response', 'Response']].map(x => `<button class="${tab === x[0] ? 'on' : ''}" data-act="hp" data-arg="${x[0]}">${x[1]}</button>`).join('')}</div></div><div style="padding:16px 20px">${captured(tab === 'payload' ? q.payload : tab === 'response' ? q.response_body : q.headers)}</div></div>`;
}

// ---------- jobs ----------
const JOB_COLS = thr => [{ k: 'job', label: 'Job', w: 'minmax(260px,1fr)', r: x => `<div class="cell2"><b class="mono" style="font-size:13.5px">${esc(x.job)}</b><small>queue: ${esc(x.queue || 'default')}</small></div>` },
  cNum('queued', 'Queued', '90px'), cNum('processed', 'Processed', '100px', fmtN, 'processed'), { ...cNum('released', 'Released', '96px', fmtN, 'released'), r: x => x.released ? `<span class="warn">${fmtN(x.released)}</span>` : '<span class="zero">0</span>' },
  cFail('failed', 'Failed', '90px', 'failed'), cDur('avg_ms', 'AVG', '96px', null, 'avg_ms'), cDur('p95_ms', 'P95', '100px', x => thr(x), 'p95_ms')];
async function vJobs() {
  const thrs = await thresholdList(); const cols = JOB_COLS(x => thrFor(thrs, 'job', x.job));
  const [o, d] = await Promise.all([api('/overview', wp()), api('/jobs', { ...wp(), limit: 100, ...listParams('jobs', cols, { k: 'processed', d: -1 }) })]); WIN = o.window; const t = o.totals.jobs;
  return pageHead('Jobs') + `<div class="charts grid2">${stackBars(o.series.jobs, [['processed', 'Processed', COL.grey], ['released', 'Released', COL.orange], ['failed', 'Failed', COL.red]], 'Jobs')}${durCard(o.series.jobs, t.avg_ms, t.p95_ms)}</div>`
    + listHeader({ icon: 'jobs', title: `${d.jobs.length} jobs`, tableId: 'jobs', placeholder: 'Search job classes' })
    + table('jobs', cols, d.jobs, { go: x => 'jobs/' + x.group_hash, serverQ: 1, serverErr: 1, rowCls: x => x.failure_rate > .5 ? 'err' : '' });
}
const jobStatus = s => `<span class="badge-s ${s === 'failed' ? 'red' : s === 'released' ? 'orange' : ''}">${esc(s || '—')}</span>`;
async function vJob(hash) {
  const [d, thrs] = await Promise.all([api('/jobs/' + hash, wp()), thresholdList()]); WIN = d.window; const g = d.group; const t = thrFor(thrs, 'job', g.job);
  return crumbs([['Jobs', 'jobs'], [g.job]]) + `<div class="ph"><h1 class="mono" style="font-size:21px;word-break:break-all">${esc(g.job)}</h1><div class="grow"></div>${t ? `<span class="badge-s ${g.p95_ms > t ? 'oo' : ''}">Threshold ${fmtD(t)}</span>` : ''}${periodSeg()}</div>`
    + `<div class="charts grid2">${stackBars(d.series, [['processed', 'Processed', COL.grey], ['released', 'Released', COL.orange], ['failed', 'Failed', COL.red]], 'Attempts')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>`
    + listHeader({ icon: 'jobs', title: `${fmtInt(g.attempts)} attempts`, tableId: 'runs' })
    + table('runs', [dateCell(), { k: 'status', label: 'Status', w: '120px', r: x => jobStatus(x.status) }, { k: 'attempt', label: 'Attempt', w: '90px', num: 1, r: x => '#' + (x.attempt ?? 1) },
      { k: 'source', label: 'Dispatched by', w: 'minmax(200px,1fr)', v: x => x.execution_preview || '', r: x => `<span class="ell" style="display:flex;gap:8px;align-items:center">${srcBadge(x.source)}<span class="mono dim ell" style="font-size:13px">${esc(x.execution_preview || '—')}</span></span>` },
      cDur('duration_ms', 'Duration', '110px', () => t)],
      d.instances, { sort: { k: 'created_at', d: -1 }, go: x => x.attempt_id ? 'jobs/attempts/' + x.attempt_id : null, err: x => x.status !== 'processed', text: x => [x.status, x.execution_preview, x.exception_preview].join(' '), rowCls: x => x.status === 'failed' ? 'err' : '', emptyText: 'No attempts in the raw window (about 14 days).' });
}
async function vJobAttempt(id) {
  const d = await api('/job-attempts/' + id); const a = d.attempt; const ev = d.events || []; const exc = await excForEvents(ev); const spans = traceAttempt(a, ev); const c = a.counts || {};
  const parent = a.parent || {}; const pl = execLink(parent.source, parent.execution_id);
  return crumbs([['Jobs', 'jobs'], [a.job, a.group_hash ? 'jobs/' + a.group_hash : null], [fmtT(a.created_at)]]) + `<div class="dhead"><h1><span class="mono" style="font-size:21px;word-break:break-all">${esc(a.job)}</span>${jobStatus(a.status)}</h1><div style="flex:1"></div><button class="btn" data-act="share">${ic('share', 14)}Share</button></div>`
    + (exc ? excBlock(exc.block, { key: 'job', link: exc.ev.fingerprint ? 'exceptions/' + exc.ev.fingerprint : null }) : (a.exception_preview ? `<div class="note" style="margin-bottom:24px">${ic('ac', 16)}<span>${esc(a.exception_preview)}</span></div>` : ''))
    + kvPanel([['Started', fmtTU(a.created_at)], ['Status', esc(a.status)], ['Attempt', '#' + esc(a.attempt ?? 1)], ['Duration', fmtD(a.duration_ms)], ['Queue', esc(a.queue || '—')], ['Connection', esc(a.connection || '—')], ['Dispatched by', pl ? `<a data-go="${esc(pl)}">${esc(parent.preview || parent.source)}</a>` : esc(parent.preview || parent.source || '—')], ['User', a.user_id ? `<a data-go="users/${encodeURIComponent(a.user_id)}">${esc(userLabel(a.user_id, a.user_name))}</a>` : '—']],
      [['Queries', fmtInt(c.queries)], ['Outgoing requests', fmtInt(c.outgoing_requests)], ['Mail', fmtInt(c.mail)], ['Notifications', fmtInt(c.notifications)], ['Cache events', fmtInt(c.cache_events)], ['Jobs queued', fmtInt(c.jobs_queued)], ['Exceptions', fmtInt(c.exceptions)], ['Peak memory', fmtBytes(a.peak_memory_bytes)], ['Server', esc(a.server || '—')]])
    + (d.attempts.length > 1 ? `<div class="lh"><span class="li">${ic('jobs', 20)}</span><h3>All attempts of this job</h3></div>` + table('atts', [{ k: 'attempt', label: 'Attempt', w: '100px', r: x => '#' + x.attempt + (x.attempt_id === a.attempt_id ? ' <span class="dim">(this)</span>' : '') }, dateCell(), { k: 'status', label: 'Status', w: '120px', r: x => jobStatus(x.status) }, cDur('duration_ms', 'Duration', '110px')], d.attempts, { go: x => x.attempt_id !== a.attempt_id ? 'jobs/attempts/' + x.attempt_id : null }) + '<div style="height:24px"></div>' : '')
    + timeline(spans);
}

// ---------- commands & scheduled tasks ----------
const runStatus = x => x.exit_code == null ? '<span class="badge-s">—</span>' : x.exit_code === 0 ? '<span class="badge-s">success</span>' : '<span class="badge-s red">failed</span>';
async function vCommands() {
  const cols = [{ k: 'command', label: 'Command', w: 'minmax(260px,1fr)', r: x => `<span class="mono ell" style="font-size:13.5px;display:block" title="${esc(x.command)}">${esc(x.command)}</span>` }, cNum('successful', 'Successful', '110px'), cFail('failed', 'Failed', '90px', 'failed'), cNum('calls', 'Total', '90px', fmtN, 'calls'), cDur('avg_ms', 'AVG', '100px', null, 'avg_ms'), cDur('p95_ms', 'P95', '100px', null, 'p95_ms')];
  const d = await api('/commands', { ...wp(), limit: 100, ...listParams('cmds', cols, { k: 'calls', d: -1 }) }); WIN = d.window; const s = d.commands_series;
  return pageHead('Commands') + `<div class="charts grid2">${stackBars(s, [['successful', 'Successful', COL.grey], ['failed', 'Failed', COL.red]], 'Commands')}${durCard(s, avgOf(s), p95Max(s))}</div>`
    + listHeader({ icon: 'braces', title: `${d.commands.length} commands`, tableId: 'cmds', placeholder: 'Search commands' })
    + table('cmds', cols, d.commands, { go: x => 'commands/' + x.group_hash, serverQ: 1, serverErr: 1 });
}
// Weighted average of a series' avg_ms; the window's p95 is not derivable from buckets, so the legend shows the worst bucket.
function avgOf(s) { const c = sum(s, b => b.avg_ms != null ? b.calls : 0); return c ? sum(s, b => b.avg_ms != null ? b.avg_ms * b.calls : 0) / c : null; }
function p95Max(s) { const v = s.map(b => b.p95_ms).filter(v => v != null); return v.length ? Math.max(...v) : null; }
async function vCommand(hash) {
  const d = await api('/commands/' + hash, wp()); WIN = d.window; const g = d.group;
  return crumbs([['Commands', 'commands'], [g.command]]) + pageHead(`<span class="mono" style="font-size:21px;word-break:break-all">${esc(g.command)}</span>`)
    + `<div class="charts grid2">${stackBars(d.series, [['successful', 'Successful', COL.grey], ['failed', 'Failed', COL.red]], 'Runs')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>` + listHeader({ icon: 'braces', title: `${fmtInt(g.calls)} runs`, tableId: 'cr' })
    + table('cr', [dateCell('created_at', 'minmax(230px,1fr)'), { k: 'status', label: 'Status', w: '120px', v: x => x.exit_code, r: runStatus }, { k: 'exit_code', label: 'Exit code', w: '100px', num: 1 }, cDur('duration_ms', 'Duration', '120px')], d.instances,
      { sort: { k: 'created_at', d: -1 }, go: x => 'commands/runs/' + x.id, err: x => x.exit_code !== 0, rowCls: x => x.exit_code ? 'err' : '', text: x => [x.command, x.exception_preview].join(' '), emptyText: 'No runs in the raw window (about 14 days).' });
}
async function vRun(id, kind) {
  const isTask = kind === 'task'; const d = await api((isTask ? '/scheduled-tasks/runs/' : '/commands/runs/') + id); const r = d.run; const ev = d.events || []; const exc = await excForEvents(ev);
  const spans = traceRun(r, ev, isTask ? 'SCHEDULED TASK' : 'COMMAND'); const c = r.counts || {}; const sec = isTask ? 'scheduled-tasks' : 'commands';
  return crumbs([[isTask ? 'Scheduled Tasks' : 'Commands', sec], [r.command || r.name, r.group_hash ? sec + '/' + r.group_hash : null], [fmtT(r.created_at)]]) + `<div class="dhead"><h1><span class="mono" style="font-size:21px;word-break:break-all">${esc(r.command || r.name)}</span>${runStatus(r)}</h1><div style="flex:1"></div><button class="btn" data-act="share">${ic('share', 14)}Share</button></div>`
    + (exc ? excBlock(exc.block, { key: 'run', link: exc.ev.fingerprint ? 'exceptions/' + exc.ev.fingerprint : null }) : (r.exception_preview ? `<div class="note" style="margin-bottom:24px">${ic('ac', 16)}<span>${esc(r.exception_preview)}</span></div>` : ''))
    + kvPanel([['Started', fmtTU(r.created_at)], ['Duration', fmtD(r.duration_ms)], ['Exit code', esc(r.exit_code ?? '—')], ['Server', esc(r.server || '—')], ['Environment', esc(r.environment || '—')], isTask && r.expression ? ['Schedule', `<span class="mono">${esc(r.expression)}</span>`] : null],
      [['Queries', fmtInt(c.queries)], ['Outgoing requests', fmtInt(c.outgoing_requests)], ['Jobs queued', fmtInt(c.jobs_queued)], ['Cache events', fmtInt(c.cache_events)], ['Logs', fmtInt(c.logs)], ['Exceptions', fmtInt(c.exceptions)]])
    + timeline(spans);
}
function nextIn(t) { const ms = tms(t); if (ms == null) return '—'; const s = (ms - Date.now()) / 1000; return s <= 0 ? 'due' : 'in ' + inDur(s); }
async function vScheduled() {
  const cols = [{ k: 'command', label: 'Task', w: 'minmax(240px,1fr)', r: x => `<div class="cell2"><b class="mono" style="font-size:13.5px" title="${esc(x.command)}">${esc(x.command)}</b><small>${esc(cronHuman(x.expression, x.repeat_seconds))}</small></div>` }, { k: 'expression', label: 'Schedule', w: '130px', r: x => `<span class="mono" style="font-size:13px">${esc(x.expression || '—')}</span>` }, { k: 'next_run_at', label: 'Next run', w: '110px', v: x => tms(x.next_run_at), r: x => `<span class="mono" style="font-size:13px" title="${esc(fmtT(x.next_run_at))} UTC">${nextIn(x.next_run_at)}</span>` }, cNum('processed', 'Processed', '100px'), { ...cNum('skipped', 'Skipped', '90px'), r: x => x.skipped ? `<span class="warn">${fmtN(x.skipped)}</span>` : '<span class="zero">0</span>' }, cFail('failed', 'Failed', '80px', 'failed'), cDur('avg_ms', 'AVG', '96px', null, 'avg_ms'), cDur('p95_ms', 'P95', '96px', null, 'p95_ms')];
  const d = await api('/commands', { ...wp(), limit: 100, ...listParams('tasks', cols, { k: 'processed', d: -1 }) }); WIN = d.window; const s = d.scheduled_tasks_series;
  return pageHead('Scheduled Tasks') + `<div class="charts grid2">${stackBars(s, [['processed', 'Processed', COL.grey], ['skipped', 'Skipped', COL.orange], ['failed', 'Failed', COL.red]], 'Runs')}${durCard(s, avgOf(s), p95Max(s))}</div>`
    + listHeader({ icon: 'calendar', title: `${d.scheduled_tasks.length} tasks`, tableId: 'tasks', placeholder: 'Search tasks' })
    + table('tasks', cols, d.scheduled_tasks, { go: x => 'scheduled-tasks/' + x.group_hash, serverQ: 1, serverErr: 1, rowCls: x => x.failed ? 'err' : '' });
}
function cronHuman(e, rep) {
  if (rep) return rep < 60 ? `Every ${rep} seconds` : `Every ${Math.round(rep / 60)} minutes`;
  if (!e) return ''; const p = e.trim().split(/\s+/); if (p.length !== 5) return e; const [mi, h, dom, mo, dow] = p;
  if (e === '* * * * *') return 'Every minute';
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mo === '*' && dow === '*') return `Every ${mi.slice(2)} minutes`;
  if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mo === '*' && dow === '*') return mi === '0' ? 'Hourly' : `Hourly at :${p2(mi)}`;
  if (/^\d+$/.test(mi) && /^\*\/\d+$/.test(h) && dom === '*' && mo === '*' && dow === '*') return `Every ${h.slice(2)} hours at :${p2(mi)}`;
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mo === '*' && dow === '*') return `Daily at ${p2(h)}:${p2(mi)}`;
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mo === '*' && /^\d$/.test(dow)) return `Weekly on ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][+dow % 7]} at ${p2(h)}:${p2(mi)}`;
  return e;
}
async function vTask(hash) {
  const d = await api('/scheduled-tasks/' + hash, wp()); WIN = d.window; const g = d.group;
  return crumbs([['Scheduled Tasks', 'scheduled-tasks'], [g.command]]) + pageHead(`<span class="mono" style="font-size:21px;word-break:break-all">${esc(g.command)}</span> <span class="badge-s">${esc(g.expression || '')}</span>`)
    + `<div class="mut" style="margin:-12px 0 22px;font-size:13px">${esc(cronHuman(g.expression))}${g.next_run_at ? ` · next run ${nextIn(g.next_run_at)} (${esc(fmtT(g.next_run_at))} UTC)` : ''}</div>`
    + `<div class="charts grid2">${stackBars(d.series, [['successful', 'Processed', COL.grey], ['skipped', 'Skipped', COL.orange], ['failed', 'Failed', COL.red]], 'Runs')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>` + listHeader({ icon: 'calendar', title: 'Recent runs', tableId: 'trs' })
    + table('trs', [dateCell('created_at', 'minmax(230px,1fr)'), { k: 'status', label: 'Status', w: '120px', r: x => `<span class="badge-s ${x.status === 'failed' ? 'red' : x.status === 'skipped' ? 'oo' : ''}">${esc(x.status || '—')}</span>` }, { k: 'exit_code', label: 'Exit code', w: '100px', num: 1 }, cDur('duration_ms', 'Duration', '120px')], d.instances,
      { sort: { k: 'created_at', d: -1 }, go: x => 'scheduled-tasks/runs/' + x.id, err: x => x.status === 'failed', rowCls: x => x.status === 'failed' ? 'err' : '', text: x => [x.status, x.exception_preview].join(' '), emptyText: 'No runs in the raw window (about 14 days).' });
}
