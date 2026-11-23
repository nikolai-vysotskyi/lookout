// ---------- exceptions ----------
async function vExceptions() {
  const cols = [{ k: 'class', label: 'Exception', w: 'minmax(300px,1fr)', r: x => `<div class="cell2"><b>${esc(x.class || 'Exception ' + x.fingerprint.slice(0, 8))}</b><small>${esc(x.message || (x.issue_id ? '' : 'Not grouped into an issue yet'))}</small></div>` },
    { k: 'type', label: 'Type', w: '110px', v: x => x.unhandled, r: x => x.unhandled ? '<span class="badge-s redo">Unhandled</span>' : '<span class="badge-s">Handled</span>' },
    cNum('count', 'Count', '80px', fmtN, 'count'), cNum('users', 'Users', '70px', fmtN, 'users'), agoCell('last_seen_at', 'Last seen', '100px', 'last_seen_at')];
  const [o, d] = await Promise.all([api('/overview', wp()), api('/exceptions', { ...wp(), limit: 100, ...listParams('excs', cols, { k: 'count', d: -1 }) })]); WIN = o.window; const s = o.series.exceptions;
  return pageHead('Exceptions') + `<div class="charts grid2">${stackBars(s, [['handled', 'Handled', COL.grey], ['unhandled', 'Unhandled', COL.red]], 'Exceptions')}${simpleBars(s, 'users', 'Users impacted', null, 200, fmtN(o.totals.exceptions.users_impacted))}</div>`
    + listHeader({ icon: 'alert', title: `${d.exceptions.length} exceptions`, tableId: 'excs', errLabel: 'Unhandled', placeholder: 'Search class or message' })
    + table('excs', cols, d.exceptions, { go: x => 'exceptions/' + x.fingerprint, serverQ: 1, serverErr: 1, rowCls: x => x.unhandled && x.issue_status !== 'resolved' && x.issue_status !== 'ignored' ? 'err' : '' });
}
function occCols() {
  return [dateCell(), { k: 'source', label: 'Source', w: 'minmax(220px,1fr)', v: x => x.execution_preview || '', r: x => `<span class="ell" style="display:flex;gap:8px;align-items:center">${srcBadge(x.source)}<span class="mono ell" style="font-size:13px">${esc(x.execution_preview || x.message || '—')}</span></span>` }, userCell('user_id', 'User', '160px')];
}
async function vException(fp) {
  const d = await api('/exceptions/' + fp, wp()); WIN = d.window; const i = d.issue; const lo = d.latest_occurrence; const c = d.counts;
  const title = (i && i.title) || (lo && lo.class) || 'Exception';
  return crumbs([['Exceptions', 'exceptions'], [title]]) + `<div class="dhead" style="flex-wrap:wrap"><h1 style="font-size:22px;word-break:break-word">${esc(title)}</h1><div style="flex:1"></div>${i ? `<button class="btn" data-go="issues/${i.id}">Issue ${iid(i.id)} ${ic('aur', 14)}</button>` : ''}${periodSeg()}</div>`
    + `<div class="panel"><div class="kv2"><div>${kv('First seen', i ? fmtTU(i.first_seen_at) : '—')}${kv('Last seen', i ? ago(i.last_seen_at) : '—')}${kv('Users', i ? fmtInt(i.users_affected) : '—')}${kv('Status', i ? esc(i.status) : 'no issue')}</div><div>${kv('Last 24 hours', fmtInt(c.count_24h))}${kv('Last 7 days', fmtInt(c.count_7d))}${kv('Last 30 days', fmtInt(c.count_30d))}</div></div></div>`
    + (d.buckets ? `<div class="charts" style="margin-bottom:24px">${barCard({ label: 'Occurrences', value: fmtN(sum(d.buckets, b => b.count)), ts: tsOf(d.buckets), stacks: [{ l: 'Occurrences', c: lo && lo.handled ? COL.grey : COL.red, data: d.buckets.map(b => b.count) }], legend: false, h: 140 })}</div>` : '')
    + (lo ? excBlock(lo, { key: fp }) : '<div class="empty" style="margin-bottom:24px">The stack trace is gone with the raw events (kept about 14 days).</div>')
    + listHeader({ icon: 'alert', title: 'Occurrences', tableId: 'occ', viewToggle: false })
    + table('occ', occCols(), d.recent_occurrences || [], { sort: { k: 'created_at', d: -1 }, go: x => execLink(x.source, x.execution_id), text: x => [x.execution_preview, x.message].join(' '), emptyText: 'No occurrences in the raw window.' })
    + ((d.affected_users || []).length ? `<div style="height:28px"></div>` + listHeader({ icon: 'user', title: 'Affected users', tableId: 'aff', viewToggle: false }) + table('aff', [{ k: 'name', label: 'User', w: 'minmax(220px,1fr)', v: x => userName(x), r: x => `<span style="display:flex;gap:10px;align-items:center">${avatar({ id: x.user_id, name: x.name, email: x.email }, 'sm')}<span class="ell">${esc(userName(x))}</span></span>` }, cNum('occurrences', 'Occurrences', '120px'), agoCell('last_seen_at', 'Last seen', '110px')], d.affected_users, { sort: { k: 'occurrences', d: -1 }, go: x => 'users/' + encodeURIComponent(x.user_id) }) : '');
}

// ---------- queries ----------
function serviceColumn(catalog) {
  const projectLabels = new Map(catalog.projects.map(project => [project.slug, project.label]));
  return {
    k: 'service_label', label: 'Service', w: 'minmax(115px,150px)',
    r: row => {
      const service = esc(row.service_label || '—');
      const project = !S.project && projectLabels.size > 1 && projectLabels.get(row.project || row.service?.split('/')[0]);
      return project
        ? `<div class="cell2"><span class="ell" title="${service}">${service}</span><small title="${esc(project)}">${esc(project)}</small></div>`
        : `<span class="ell" title="${service}">${service}</span>`;
    },
  };
}
const connectionCol = { k: 'connection', label: 'Connection', w: '120px', r: x => `<span class="mono" style="font-size:13px">${esc(x.connection || '—')}</span>` };
const queryPath = x => x.source_id != null ? `queries/otlp/${x.source_id}/${x.group_hash}` : 'queries/' + x.group_hash;
async function vQueries() {
  const catalog = await sources();
  const params = scopedWp();
  const includesNightOwl = !BOOT.sources_enabled || catalog.services.some(service =>
    service.connector === 'nightowl' && (!params.project || service.project === params.project)
    && (!params.service || service.key === params.service)
    && (!params.environment || !service.environment || params.environment === service.environment));
  const conn = includesNightOwl ? VS.conn || null : null;
  const id = 'queries' + (conn || '');
  const cols = [
    { k: 'sql', label: 'Query', w: 'minmax(360px,1fr)', r: x => `<span class="path" style="font-size:13px">${ic('db', 15)}<span class="ell" title="${esc(x.sql)}">${sqlHi(x.sql || '')}</span></span>` },
    ...(BOOT.sources_enabled ? [serviceColumn(catalog)] : []),
    ...(includesNightOwl ? [connectionCol] : []),
    cNum('calls', 'Calls', '80px', fmtN, 'calls'),
    { k: 'total_ms', label: 'Total', w: '96px', num: 1, api: 'total_ms', r: x => fmtD(x.total_ms) },
    cDur('avg_ms', 'AVG', '90px', null, 'avg_ms'),
    { k: 'p95_ms', label: 'P95', w: '96px', num: 1, api: 'p95_ms', r: x => `<span class="${x.p95_ms > 200 ? 'over' : ''}">${fmtD(x.p95_ms)}</span>` },
  ];
  const d = await api('/queries', { ...params, limit: 100, connection: conn, ...listParams(id, cols, { k: 'total_ms', d: -1 }) });
  WIN = d.window;
  const s = d.series;
  const incompleteP95 = s.some(bucket => bucket.calls > 0 && bucket.p95_ms == null);
  const connections = d.connections || [];
  const pill = (conn || connections.length)
    ? `<button class="pill ${conn ? 'active' : ''}" data-act="connFilter" data-arg="${esc(connections.join('|'))}">${ic('db', 15)}${esc(conn || 'All connections')}${ic(conn ? 'x' : 'cd', 13)}</button>` : '';
  return pageHead('Queries', pill) + scopeControls(catalog)
    + (s.length ? `<div class="charts grid2">${simpleBars(s, 'calls', 'Calls')}${durCard(s, avgOf(s), incompleteP95 ? null : p95Max(s), 'Duration', incompleteP95 ? [null, null] : null)}</div>` : '')
    + listHeader({ icon: 'db', title: `${d.queries.length}${d.queries.length === 100 ? '+' : ''} queries`, tableId: id, viewToggle: false, placeholder: 'Search queries' })
    + table(id, cols, d.queries, { go: queryPath, serverQ: 1 })
    + (d.n_plus_one ? possibleRepeatedQueries(d.n_plus_one.suspects) : '');
}
function possibleRepeatedQueries(suspects) {
  return `<div style="height:36px"></div><div class="lh"><span class="li">${ic('alert', 20)}</span><h3>Possible N+1 queries</h3><span class="mut" style="font-size:13px">Same query 5+ times in one execution, last 24 hours at most</span></div>`
    + table('np1', [{ k: 'sql', label: 'Query', w: 'minmax(300px,1fr)', r: x => `<div class="cell2"><b class="mono" style="font-size:13px" title="${esc(x.sql)}">${sqlHi(x.sql || '')}</b><small>${esc(x.file ? x.file + (x.line ? ':' + x.line : '') : 'no source')}</small></div>` }, cNum('executions', 'Executions', '100px'), cNum('queries', 'Queries', '90px'), cNum('max_per_execution', 'Max / exec', '100px'), { k: 'total_ms', label: 'Total', w: '96px', num: 1, r: x => fmtD(x.total_ms) }], suspects,
      { sort: { k: 'queries', d: -1 }, go: x => x.sample_execution_id ? 'requests/' + x.sample_execution_id : null, emptyText: 'No repeated queries found.' });
}
async function vQuery(hash, sourceId = null) {
  const path = sourceId === null ? '/queries/' + hash : `/queries/otlp/${sourceId}/${hash}`;
  const d = await api(path, scopedWp());
  WIN = d.window;
  const g = d.group;
  const origin = sourceId === null
    ? { k: 'source', label: 'Source', w: 'minmax(240px,1fr)', v: x => x.execution_preview || '', r: x => `<span class="ell" style="display:flex;gap:8px;align-items:center">${srcBadge(x.source)}<span class="mono ell" style="font-size:13px">${esc(x.execution_preview || '—')}</span></span>` }
    : { k: 'execution_preview', label: 'Service', w: 'minmax(240px,1fr)', r: x => `<div class="cell2"><b>${esc(g.service_label || '—')}</b><small class="mono">${esc(x.execution_preview || '')}</small></div>` };
  return crumbs([['Queries', 'queries'], [(g.sql || '').slice(0, 60) + ((g.sql || '').length > 60 ? '…' : '')]]) + pageHead('Query') + `<div class="panel" style="padding:16px"><pre class="box" style="border:0;background:none;padding:4px">${sqlHi(g.sql || '')}</pre><div style="display:flex;gap:10px;padding:8px 4px 0;flex-wrap:wrap"><span class="badge-s">${esc(g.service_label || g.connection || '—')}</span><span class="badge-s">max ${fmtD(g.max_ms)}</span><button class="btn sm" data-act="copyText" data-arg="${esc(g.sql || '')}">${ic('copy', 13)}Copy</button></div></div>`
    + `<div class="charts grid2">${simpleBars(d.series, 'calls', 'Calls')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>`
    + listHeader({ icon: 'db', title: `${fmtInt(g.calls)} calls`, tableId: 'qcalls', viewToggle: false })
    + table('qcalls', [dateCell(), origin, cDur('duration_ms', 'Duration', '110px')], d.instances, {
      sort: { k: 'created_at', d: -1 },
      go: sourceId === null ? x => execLink(x.source, x.execution_id) : null,
      text: x => x.execution_preview || '',
      emptyText: sourceId === null ? 'No executions in the raw window (about 14 days).' : 'No telemetry in this period.',
    });
}

// ---------- worker progress ----------
async function vWorkerProgress() {
  const [catalog, d] = await Promise.all([sources(), api('/worker-progress', scopedWp())]);
  WIN = d.window;
  const header = pageHead('Worker progress') + scopeControls(catalog);
  if (!d.available) {
    return header + `<div class="empty">${S.service ? 'Worker progress is unavailable for this service.' : 'No successful runs in this period.'}</div>`;
  }

  const service = serviceColumn(catalog);
  const operation = { k: 'operation', label: 'Operation', w: 'minmax(160px,1fr)' };
  const progress = table('worker-progress', [service, operation, dateCell('last_success_at', '195px', 'Last successful run')], d.progress,
    { minw: 500, sort: { k: 'last_success_at', d: -1 }, emptyText: 'No successful runs in this period.' });
  const errors = d.errors.length ? `<section class="worker-errors"><div class="lh"><h3>Errors</h3></div>
    ${table('worker-errors', [service, operation, cNum('count', 'Count'), dateCell('last_seen_at', '195px', 'Last seen')], d.errors,
      { minw: 600, sort: { k: 'last_seen_at', d: -1 } })}</section>` : '';

  return header + progress + errors;
}

// ---------- notifications & mail ----------
const sendCols = (nameKey, label, extra = []) => [{ k: nameKey, label, w: 'minmax(260px,1fr)', r: x => `<span class="mono ell" style="font-size:13.5px;display:block" title="${esc(x[nameKey] || '')}">${esc(x[nameKey] || '(unnamed)')}</span>` }, ...extra, cNum('calls', 'Total', '90px', fmtN, 'calls'), cNum('queued', 'Queued', '90px', fmtN, 'queued'), cFail('failed', 'Failed', '80px', 'failed'), cDur('avg_ms', 'AVG', '96px', null, 'avg_ms'), cDur('p95_ms', 'P95', '96px', null, 'p95_ms')];
async function vNotifications() {
  const cols = sendCols('notification', 'Notification', [{ k: 'channel', label: 'Channel', w: '130px', r: x => `<span class="badge-s">${esc(x.channel || '—')}</span>` }]);
  const d = await api('/mail', { ...wp(), limit: 100, ...listParams('nts', cols, { k: 'calls', d: -1 }) }); WIN = d.window; const s = d.notifications_series;
  return pageHead('Notifications') + `<div class="charts grid2">${stackBars(s, [[b => b.calls - b.failed, 'Sent', COL.grey], ['failed', 'Failed', COL.red]], 'Notifications')}${durCard(s, avgOf(s), p95Max(s))}</div>`
    + listHeader({ icon: 'bell', title: `${d.notifications.length} notifications`, tableId: 'nts', placeholder: 'Search notifications' })
    + table('nts', cols, d.notifications, { go: x => 'notifications/' + x.group_hash, serverQ: 1, serverErr: 1 });
}
const sentBadge = x => x.failed ? '<span class="badge-s red">failed</span>' : x.queued ? '<span class="badge-s">queued</span>' : '<span class="badge-s">sent</span>';
const execCol = () => ({ k: 'source', label: 'Sent from', w: 'minmax(180px,1fr)', v: x => x.execution_preview || '', r: x => `<span class="ell" style="display:flex;gap:8px;align-items:center">${srcBadge(x.source)}<span class="mono ell dim" style="font-size:13px">${esc(x.execution_preview || '—')}</span></span>` });
async function vNotification(hash) {
  const d = await api('/notifications/' + hash, wp()); WIN = d.window; const g = d.group;
  return crumbs([['Notifications', 'notifications'], [g.notification]]) + pageHead(`<span class="mono" style="font-size:21px;word-break:break-all">${esc(g.notification || '(unnamed)')}</span>`) + `<div class="charts grid2">${stackBars(d.series, [[b => b.calls - b.failed, 'Sent', COL.grey], ['failed', 'Failed', COL.red]], 'Sent')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>`
    + listHeader({ icon: 'bell', title: 'Recent notifications', tableId: 'ntr', viewToggle: false })
    + table('ntr', [dateCell('created_at', '220px'), { k: 'channel', label: 'Channel', w: '120px', r: x => `<span class="badge-s">${esc(x.channel || '—')}</span>` }, { k: 'notifiable_type', label: 'Notifiable', w: 'minmax(160px,1fr)', r: x => `<span class="mono ell" style="font-size:13px;display:block">${esc(shortCls(x.notifiable_type))}${x.notifiable_id ? ' #' + esc(x.notifiable_id) : ''}</span>` }, execCol(), { k: 'failed', label: 'State', w: '90px', r: sentBadge }, cDur('duration_ms', 'Duration', '100px')],
      d.instances, { sort: { k: 'created_at', d: -1 }, go: x => execLink(x.source, x.execution_id), rowCls: x => x.failed ? 'err' : '', minw: 980, emptyText: 'No sends in the raw window (about 14 days).' });
}
async function vMail() {
  const cols = sendCols('mailable', 'Mailable');
  const d = await api('/mail', { ...wp(), limit: 100, ...listParams('mails', cols, { k: 'calls', d: -1 }) }); WIN = d.window; const s = d.mail_series;
  return pageHead('Mail') + `<div class="charts grid2">${stackBars(s, [[b => b.calls - b.failed, 'Sent', COL.grey], ['failed', 'Failed', COL.red]], 'Mail')}${durCard(s, avgOf(s), p95Max(s))}</div>`
    + listHeader({ icon: 'mail', title: `${d.mail.length} mailables`, tableId: 'mails', placeholder: 'Search mailables' })
    + table('mails', cols, d.mail, { go: x => 'mail/' + x.group_hash, serverQ: 1, serverErr: 1 });
}
async function vMailable(hash) {
  const d = await api('/mail/' + hash, wp()); WIN = d.window; const g = d.group;
  return crumbs([['Mail', 'mail'], [g.mailable || '(unnamed)']]) + pageHead(`<span class="mono" style="font-size:21px;word-break:break-all">${esc(g.mailable || '(unnamed mailable)')}</span>`) + `<div class="charts grid2">${stackBars(d.series, [[b => b.calls - b.failed, 'Sent', COL.grey], ['failed', 'Failed', COL.red]], 'Sent')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>`
    + listHeader({ icon: 'mail', title: 'Recent mail', tableId: 'mlr', viewToggle: false })
    + table('mlr', [dateCell('created_at', '220px'), { k: 'subject', label: 'Subject', w: 'minmax(180px,1fr)', r: x => `<span class="ell" style="display:block">${esc(x.subject || '—')}</span>` }, { k: 'to', label: 'To', w: '200px', r: x => `<span class="mono ell" style="font-size:12.5px;display:block" title="cc ${x.cc} · bcc ${x.bcc}">${esc(x.to || '—')}</span>` }, { k: 'driver', label: 'Driver', w: '80px', r: x => `<span class="mono">${esc(x.driver || '—')}</span>` }, cNum('attachments', 'Attachments', '110px'), { k: 'failed', label: 'State', w: '90px', r: sentBadge }, cDur('duration_ms', 'Duration', '100px')],
      d.instances, { sort: { k: 'created_at', d: -1 }, go: x => execLink(x.source, x.execution_id), rowCls: x => x.failed ? 'err' : '', minw: 1040, emptyText: 'No mail in the raw window (about 14 days).' });
}

// ---------- cache ----------
async function vCache() {
  const cols = [{ k: 'key', label: 'Key', w: 'minmax(260px,1fr)', r: x => `<div class="cell2"><b class="mono" style="font-size:13px" title="${esc(x.key)}">${esc(x.key)}</b><small>${esc(x.store || '')}</small></div>` }, cNum('calls', 'Calls', '90px', fmtN, 'calls'), cNum('hits', 'Hits', '90px', fmtN, 'hits'), { ...cNum('misses', 'Misses', '90px', fmtN, 'misses'), r: x => x.misses ? `<span class="over">${fmtN(x.misses)}</span>` : '<span class="zero">0</span>' }, { k: 'hit_rate', label: 'Hit rate', w: '90px', num: 1, api: 'hit_rate', r: x => x.hits + x.misses ? fmtPct(x.hit_rate) : '<span class="zero">—</span>' }, cNum('writes', 'Writes', '90px', fmtN, 'writes'), cNum('deletes', 'Deletes', '90px', fmtN, 'deletes'), cFail('failures', 'Failures', '90px', 'failures')];
  const d = await api('/cache', { ...wp(), limit: 100, ...listParams('cache', cols, { k: 'calls', d: -1 }) }); WIN = d.window; const s = d.series; const t = d.totals;
  return pageHead('Cache') + `<div class="charts grid2">${barCard({ label: 'Cache events', value: fmtN(t.hits + t.misses), ts: tsOf(s), stacks: [{ l: 'Hits', c: COL.grey, data: s.map(b => b.hits) }, { l: 'Misses', c: COL.orange, data: s.map(b => b.misses) }], extra: `<div class="lg" style="margin-left:18px"><div class="lab">Hit rate</div><div class="big">${t.hits + t.misses ? fmtPct(t.hit_rate) : '—'}</div></div>` })}${stackBars(s, [['writes', 'Writes', COL.grey], ['deletes', 'Deletes', COL.orange], ['failures', 'Failures', COL.red]], 'Writes', 200, fmtN(t.writes))}</div>`
    + listHeader({ icon: 'cache', title: 'Top 100 keys', tableId: 'cache', viewToggle: false, placeholder: 'Search keys' })
    + table('cache', cols, d.keys, { serverQ: 1, minw: 980 });
}

// ---------- outgoing ----------
async function vOutgoing() {
  const cols = [{ k: 'host', label: 'Domain', w: 'minmax(260px,1fr)', r: x => `<span class="path">${ic('globe', 15)}<span class="ell">${esc(x.host || '—')}</span></span>` }, { k: 'ok', label: '1/2/3XX', w: '90px', num: 1, v: x => x.calls - x.status_4xx - x.status_5xx, r: x => fmtN(x.calls - x.status_4xx - x.status_5xx) }, c4(), c5(), cNum('calls', 'Total', '90px', fmtN, 'calls'), cDur('avg_ms', 'AVG', '96px', null, 'avg_ms'), { k: 'p95_ms', label: 'P95', w: '96px', num: 1, api: 'p95_ms', r: x => `<span class="${x.p95_ms > 5000 ? 'over' : ''}">${fmtD(x.p95_ms)}</span>` }];
  const d = await api('/outgoing', { ...wp(), limit: 100, ...listParams('domains', cols, { k: 'calls', d: -1 }) }); WIN = d.window; const s = d.series;
  return pageHead('Outgoing Requests') + `<div class="charts grid2">${statusBars(s, 'Outgoing requests')}${durCard(s, avgOf(s), p95Max(s))}</div>`
    + listHeader({ icon: 'out', title: `${d.outgoing.length} domains`, tableId: 'domains', placeholder: 'Search hosts' })
    + table('domains', cols, d.outgoing, { go: x => 'outgoing/' + x.group_hash, serverQ: 1, serverErr: 1, rowCls: x => x.status_5xx / Math.max(1, x.calls) > .01 ? 'err' : '' });
}
async function vDomain(hash) {
  const d = await api('/outgoing/' + hash, wp()); WIN = d.window; const g = d.group;
  return crumbs([['Outgoing Requests', 'outgoing'], [g.host || '—']]) + pageHead(`<span class="mono" style="font-size:21px;word-break:break-all">${esc(g.host || '—')}</span>`) + `<div class="charts grid2">${statusBars(d.series, 'Requests')}${durCard(d.series, g.avg_ms, g.p95_ms)}</div>`
    + listHeader({ icon: 'out', title: `${fmtInt(g.calls)} requests`, tableId: 'dr' })
    + table('dr', [dateCell(), { k: 'url', label: 'Request', w: 'minmax(240px,1fr)', r: x => `<span class="mono ell" style="font-size:13px;display:block" title="${esc(x.url)}"><span class="method ${esc(x.method)}">${esc(x.method || '')}</span> ${esc(x.url)}</span>` }, { k: 'status_code', label: 'Status', w: '90px', r: x => `<span class="st ${!x.status_code || x.status_code >= 500 ? 's5' : x.status_code >= 400 ? 's4' : ''}">${x.status_code || 'no reply'}</span>` }, execCol(), cDur('duration_ms', 'Duration', '110px')],
      d.instances, { sort: { k: 'created_at', d: -1 }, go: x => execLink(x.source, x.execution_id), err: x => !x.status_code || x.status_code >= 400, text: x => x.url + ' ' + x.status_code, rowCls: x => !x.status_code || x.status_code >= 500 ? 'err' : '', minw: 1000, emptyText: 'No requests in the raw window (about 14 days).' });
}

// ---------- users ----------
async function vUsers() {
  const cols = [{ k: 'name', label: 'User', w: 'minmax(260px,1fr)', v: x => userName(x), r: x => `<span style="display:flex;gap:10px;align-items:center;min-width:0">${avatar({ id: x.user_id, name: x.name, email: x.email })}<span class="cell2" style="min-width:0"><b>${esc(userName(x))}</b><small>${esc(x.email || '')}</small></span></span>` }, { k: 'user_id', label: 'ID', w: '80px', num: 1, v: x => +x.user_id || x.user_id }, cNum('requests', 'Requests', '100px', fmtN, 'requests'), c4('status_4xx', '80px'), c5('status_5xx', '80px'), cFail('exceptions', 'Exceptions', '100px', 'exceptions'), { ...cNum('slow_requests', 'Slow', '80px', fmtN, 'slow_requests'), r: x => x.slow_requests ? `<span class="over" title="Requests over 1s">${fmtN(x.slow_requests)}</span>` : '<span class="zero">0</span>' }];
  const [o, d] = await Promise.all([api('/overview', wp()), api('/users', { ...wp(), limit: 100, ...sortParams('users', cols) })]); WIN = o.window; ts_('users', { sort: { k: 'requests', d: -1 } });
  const su = o.series.users, sr = o.series.requests; const guests = sr.map((b, i) => Math.max(0, b.calls - (su[i] ? su[i].requests : 0)));
  return pageHead('Users') + `<div class="charts grid2">${simpleBars(su, 'users', 'Authenticated users', null, 200, fmtN(o.totals.users.authenticated))}${barCard({ label: 'Requests', value: fmtN(o.totals.requests.calls), ts: tsOf(sr), stacks: [{ l: 'Authenticated', c: COL.grey, data: su.map(b => b.requests) }, { l: 'Guests', c: COL.orange, data: guests }] })}</div>`
    + listHeader({ icon: 'user', title: `${fmtInt(o.totals.users.authenticated)} users`, tableId: 'users', viewToggle: false, placeholder: 'Search by name, email or ID' })
    + table('users', cols, d.users, { go: x => 'users/' + encodeURIComponent(x.user_id), text: x => [x.name, x.email, x.user_id].join(' ') });
}
async function vUser(id) {
  const d = await api('/users/' + encodeURIComponent(id), wp()); WIN = d.window; const u = d.user; const t = d.totals; const tab = VS.utab || 'requests';
  const tabs = [['requests', 'Requests', 'globe', t.requests], ['jobs', 'Jobs', 'jobs', t.job_attempts], ['exceptions', 'Exceptions', 'alert', t.exceptions], ['logs', 'Logs', 'logs', null]];
  let list = '';
  if (tab === 'requests') list = table('ur', [dateCell(), { k: 'url', label: 'Request', w: 'minmax(240px,1fr)', r: x => `<span class="mono ell" style="font-size:13px;display:block"><span class="method ${esc(methodOf(x.method))}">${esc(x.method || '')}</span> ${esc(x.url)}</span>` }, statusCell(), cDur('duration_ms', 'Duration', '110px')], d.requests, { sort: { k: 'created_at', d: -1 }, go: x => 'requests/' + x.id, rowCls: x => x.status_code >= 500 ? 'err' : '', emptyText: 'No requests from this user in the raw window.' });
  else if (tab === 'jobs') list = table('uj', [dateCell(), { k: 'job', label: 'Job', w: 'minmax(240px,1fr)', r: x => `<span class="mono ell" style="font-size:13px;display:block">${esc(x.job)}</span>` }, { k: 'status', label: 'Status', w: '120px', r: x => jobStatus(x.status) }, cDur('duration_ms', 'Duration', '110px')], d.jobs, { sort: { k: 'created_at', d: -1 }, go: x => x.attempt_id ? 'jobs/attempts/' + x.attempt_id : null, emptyText: 'No job attempts for this user in the raw window.' });
  else if (tab === 'exceptions') list = table('ue', [dateCell(), { k: 'class', label: 'Exception', w: 'minmax(240px,1fr)', r: x => `<div class="cell2"><b>${esc(x.class)}</b><small>${esc(x.message || '')}</small></div>` }, { k: 'handled', label: 'Type', w: '110px', r: x => x.handled ? '<span class="badge-s">Handled</span>' : '<span class="badge-s redo">Unhandled</span>' }], d.exceptions, { sort: { k: 'created_at', d: -1 }, go: x => x.fingerprint ? 'exceptions/' + x.fingerprint : null, emptyText: 'No exceptions for this user in the raw window.' });
  else list = logRows(d.logs, 'No logs for this user in the raw window.') + `<div style="margin-top:12px"><button class="btn sm" data-act="userLogs" data-arg="${esc(u.user_id)}">${ic('logs', 14)}All logs of this user</button></div>`;
  return crumbs([['Users', 'users'], [userName(u)]]) + `<div class="dhead" style="align-items:center;flex-wrap:wrap">${avatar({ id: u.user_id, name: u.name, email: u.email }, 'lg')}<div style="min-width:0"><h1>${esc(userName(u))}</h1><div class="mono mut" style="font-size:13px;margin-top:4px">${esc(u.email || '')}${u.email ? ' · ' : ''}ID ${esc(u.user_id)}</div></div><div style="flex:1"></div>${periodSeg()}</div>`
    + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">${tabs.map(x => `<button class="btn ${tab === x[0] ? 'primary' : ''}" data-act="utab" data-arg="${x[0]}">${ic(x[2], 14)}${x[1]}${x[3] != null ? ` <span class="cnt">${fmtN(x[3])}</span>` : ''}</button>`).join('')}</div>`
    + `<div class="charts grid2">${statusBars(d.series, 'Requests')}<div class="cc"><div class="lab">In this period</div><div style="margin-top:14px">${kv('Requests', fmtInt(t.requests))}${kv('4XX', fmtInt(t.status_4xx))}${kv('5XX', fmtInt(t.status_5xx))}${kv('Exceptions', fmtInt(t.exceptions))}${kv('Job attempts', fmtInt(t.job_attempts))}</div></div></div>`
    + `<div class="lh"><span class="li">${ic(tabs.find(x => x[0] === tab)[2], 20)}</span><h3>Latest ${tab}</h3></div>` + list;
}

// ---------- logs ----------
let LOGS = [];
function logRows(rows, empty) {
  const base = LOGS.length; LOGS = LOGS.concat(rows);
  return `<div class="logs">${rows.map((l, i) => `<div class="logrow" data-log="${base + i}" role="button" tabindex="0"><span class="lt">${fmtIso(l.created_at)} <span class="dim">UTC</span></span><span class="ls ell">${srcBadge(l.source)}<span class="dim ell">${esc(l.execution_preview || '')}</span></span><span>${lvlHtml(l.level)}</span><span class="lm ell">${esc(l.message)}</span></div>`).join('') || `<div class="empty" style="border:0">${empty}</div>`}</div>`;
}
async function vLogs() {
  const lv = VS.logLevel || null; const uf = VS.userFilter || null; const page = VS.logPage || 1;
  const d = await api('/logs', { ...wp(), level: lv || '', q: VS.logQ || '', user: uf || '', page, limit: 50 }); WIN = d.window; LOGS = [];
  VS.levels = d.levels;
  const pager = (page > 1 || d.has_more) ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn sm" data-act="logPage" data-arg="${page - 1}" ${page > 1 ? '' : 'disabled'}>${ic('cl', 14)}Newer</button><span class="mut mono" style="align-self:center;font-size:13px">page ${page}</span><button class="btn sm" data-act="logPage" data-arg="${page + 1}" ${d.has_more ? '' : 'disabled'}>Older${ic('cr', 14)}</button></div>` : '';
  return `<div class="ph"><h1>Logs</h1><div class="grow"></div><label class="search">${ic('search', 15)}<input id="logq" data-logsearch="1" placeholder="Search messages" value="${esc(VS.logQ || '')}" aria-label="Search logs"></label><button class="pill ${lv ? 'active' : ''}" data-act="logLevel">${esc(lv ? lv.toUpperCase() : 'Level')}${ic(lv ? 'x' : 'cd', 13)}</button><button class="pill ${uf ? 'active' : ''}" data-act="userFilter">${ic('user', 15)}${uf ? 'User #' + esc(uf) : 'All users'}${ic(uf ? 'x' : 'cd', 13)}</button>${periodSeg()}</div>`
    + (S.period !== '1h' && S.period !== '24h' ? `<p class="mut hint">Logs are raw events: the list covers the last 14 days at most.</p>` : '')
    + logRows(d.logs, 'No log entries match these filters.') + pager;
}
function logDrawer(k) {
  const l = LOGS[k]; if (!l) return; const go = execLink(l.source, l.execution_id);
  const card = (t, obj) => { const v = parseJson(obj); if (v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length)) return ''; const n = typeof v === 'object' ? Object.keys(v).length : 1; return `<div class="dcard"><div class="dcard-h" data-act="dcard">${t}<span class="r">${n} item${n === 1 ? '' : 's'} ${ic('cu', 15)}</span></div><div class="dcard-b">${typeof v === 'object' ? `<div class="json">${jsonHtml(v)}</div>` : `<pre class="box">${esc(v)}</pre>`}</div></div>`; };
  openDrawer(`${fmtT(l.created_at)} <span class="dim">UTC</span>`, `<div style="font-family:var(--mono);font-size:15px;margin:0 0 20px;display:flex;gap:12px;align-items:flex-start;word-break:break-word">${lvlHtml(l.level)}<span>${esc(l.message)}</span></div>`
    + `<div class="dcard"><div class="dcard-h">Source<span class="r">${go ? `<a class="btn sm" data-go="${esc(go)}">${esc(l.source || 'Open')} ${ic('aur', 13)}</a>` : ''}</span></div><div class="dcard-b">${esc(l.execution_preview || l.source || '—')}${l.channel ? `<div class="dim" style="margin-top:6px">channel: ${esc(l.channel)}</div>` : ''}${l.user_id ? `<div style="margin-top:6px"><a data-go="users/${encodeURIComponent(l.user_id)}" style="text-decoration:underline;cursor:pointer">${esc(userLabel(l.user_id, l.user_name))}</a></div>` : ''}</div></div>`
    + card('Context', l.context) + card('Extra', l.extra));
}
