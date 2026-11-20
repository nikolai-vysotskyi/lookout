// ---------- shell ----------
function periodSeg() {
  return `<div class="seg" role="group" aria-label="Period">${PERIODS.map(p => `<button class="${S.period === p ? 'on' : ''}" data-act="period" data-arg="${p}" aria-pressed="${S.period === p}">${p.toUpperCase()}</button>`).join('')}<button class="cal ${S.period === 'custom' ? 'on' : ''}" data-act="calendar" aria-label="Custom range" title="${S.period === 'custom' ? esc(periodTxt()) : 'Custom range'}">${ic('calendar', 15)}${ic('cd', 12)}</button></div>`;
}
function pageHead(title, right = '') { return `<div class="ph"><h1>${title}</h1><div class="grow"></div>${right}${periodSeg()}</div>`; }
const sources = () => BOOT.sources_enabled ? api('/sources') : Promise.resolve({ projects: [], services: [] });
function scopeControls({ projects, services }) {
  if (!BOOT.sources_enabled) return '';

  const option = (value, label, selected) => `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`;
  const select = (field, label, all, options) => `<div class="scope-filter"><label for="scope-${field}">${label}</label><select id="scope-${field}" class="inp" data-scope-field="${field}">${option('', all, S[field] || '')}${options}</select></div>`;
  const list = services.filter(service => !S.project || service.project === S.project);
  const projectOptions = projects.map(project => option(project.slug, project.label, S.project)).join('');
  const optionsFor = items => items.map(service => option(service.key, service.label, S.service)).join('');
  const serviceOptions = S.project || projects.length <= 1 ? optionsFor(list) : projects.map(project => {
    const items = list.filter(service => service.project === project.slug);
    return items.length ? `<optgroup label="${esc(project.label)}">${optionsFor(items)}</optgroup>` : '';
  }).join('');
  const missingProject = S.project && !projects.some(project => project.slug === S.project)
    ? option(S.project, S.project, S.project) : '';
  const missingService = S.service && !list.some(service => service.key === S.service)
    ? option(S.service, S.service, S.service) : '';

  return `<div class="scope-filters">${select('project', 'Project', 'All projects', projectOptions + missingProject)}${select('service', 'Service', 'All services', serviceOptions + missingService)}</div>`;
}
function crumbs(items) { return `<div class="crumbs">${items.map((c, i) => (i ? ic('cr', 13) : '') + (c[1] != null ? `<a data-go="${esc(c[1])}">${esc(c[0])}</a>` : `<span class="ell" style="max-width:min(60vw,520px)">${esc(c[0])}</span>`)).join('')}</div>`; }
const ACT = [['requests', 'Requests', 'globe'], ['jobs', 'Jobs', 'jobs'], ['commands', 'Commands', 'braces'], ['scheduled-tasks', 'Scheduled Tasks', 'calendar'], ['exceptions', 'Exceptions', 'alert'], ['queries', 'Queries', 'db'], ...(BOOT.sources_enabled ? [['worker-progress', 'Worker progress', 'clock']] : []), ['notifications', 'Notifications', 'bell'], ['mail', 'Mail', 'mail'], ['cache', 'Cache', 'cache'], ['outgoing', 'Outgoing Requests', 'out']];
let OPEN_ISSUES = null; let ENVS = null;
function sidebar(section) {
  const nv = (id, label, icon, extra = '') => `<a class="nv ${section === id ? 'on' : ''}" href="${BASE}/${id === 'dashboard' ? '' : id}" data-go="${id === 'dashboard' ? '' : id}">${ic(icon, 16)}<span>${label}</span>${extra}</a>`;
  $('#side').innerHTML = `
  <button class="brand" data-act="env" aria-label="Environment"><div class="logo">${ic('activity', 17, 2.2)}</div><div style="text-align:left;min-width:0"><b class="ell">${esc(BOOT.app_name || 'Lookout')}</b><small class="ell">${esc(S.env || 'All environments')}</small></div><span class="ud">${ic('ud', 15)}</span></button>
  <nav class="nav" aria-label="Monitoring">
    ${nv('dashboard', 'Dashboard', 'grid')}
    ${nv('issues', 'Issues', 'inbox', OPEN_ISSUES != null ? `<span class="badge">${fmtN(OPEN_ISSUES)}</span>` : '')}
    <div class="nv ${S.activityOpen ? 'open' : ''}" data-act="toggleActivity" role="button" tabindex="0" aria-expanded="${S.activityOpen}">${ic('activity', 16)}<span>Activity</span><span class="chev">${ic('cr', 15)}</span></div>
    ${S.activityOpen ? `<div class="sub">${ACT.map(a => `<a class="nv ${section === a[0] ? 'on' : ''}" href="${esc(urlFor(a[0]))}" data-go="${a[0]}">${a[1]}</a>`).join('')}</div>` : ''}
    <div class="navlabel">Monitoring</div>
    ${nv('users', 'Users', 'user')}
    ${nv('logs', 'Logs', 'logs')}
  </nav>
  <div class="nav-bottom">${nv('settings', 'Settings', 'sliders')}${nv('mcp', 'MCP', 'plug')}</div>
  <div class="me">${avatar(ME, '')}<span class="ell">${esc(ME.name || ME.email)}</span><button class="more" data-act="userMenu" aria-label="Account menu">${ic('more', 16)}</button></div>`;
}
async function refreshBadge() {
  try { const d = await api('/issues', { status: 'open', limit: 1, environment: S.env || '', period: '30d' }); if (OPEN_ISSUES !== d.total) { OPEN_ISSUES = d.total; const b = $('#side .nv[data-go="issues"]'); if (b) { const old = b.querySelector('.badge'); if (old) old.textContent = fmtN(OPEN_ISSUES); else b.insertAdjacentHTML('beforeend', `<span class="badge">${fmtN(OPEN_ISSUES)}</span>`); } } } catch (e) { /* the badge is optional */ }
}

// ---------- popover / drawer / toast ----------
let popCb = null;
function openPop(anchor, html, cb, align = 'left') {
  const p = $('#pop'); p.innerHTML = html; p.style.display = 'block'; popCb = cb;
  const r = anchor.getBoundingClientRect(); const pw = p.offsetWidth, ph = p.offsetHeight;
  let x = align === 'right' ? r.right - pw : r.left; x = Math.max(8, Math.min(x, innerWidth - pw - 8));
  let y = r.bottom + 6; if (y + ph > innerHeight - 8) y = r.top - ph - 6;
  p.style.left = x + 'px'; p.style.top = Math.max(8, y) + 'px';
  const inp = p.querySelector('input'); if (inp) inp.focus();
}
function closePop() { const p = $('#pop'); if (p) p.style.display = 'none'; popCb = null; }
function menu(items, cur) { return items.map(it => it === '-' ? '<div class="psep"></div>' : it.label ? `<div class="plabel">${esc(it.label)}</div>` : `<div class="pi ${it.v === cur ? 'on' : ''}" data-pick="${esc(it.v)}" role="option" tabindex="0">${it.icon || ''}<span class="ell">${esc(it.t)}</span>${it.v === cur ? `<span class="ck">${ic('check', 15)}</span>` : ''}</div>`).join(''); }
function openDrawer(title, body, overlay = true) { $('#dr-t').innerHTML = title; $('#dr-b').innerHTML = body; $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#ov').style.display = overlay ? 'block' : 'none'; $('#dr-b').scrollTop = 0; }
function closeDrawer() { const d = $('#drawer'); if (!d) return; d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); $('#ov').style.display = 'none'; $$('.tl-row.sel').forEach(r => r.classList.remove('sel')); $$('.sp.on').forEach(r => r.classList.remove('on')); if (TL) TL.sel = null; }
let toastT; function toast(msg, bad = false) { const t = $('#toast'); t.innerHTML = ic(bad ? 'ac' : 'check', 15) + esc(msg); t.classList.toggle('bad', bad); t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), bad ? 4200 : 2200); }
function copy(text, msg = 'Copied') { try { navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Select the text and copy it')); } catch (e) { toast('Select the text and copy it'); } }
function kv(k, v) { return `<div class="kv"><span class="k">${k}</span><span class="f"></span><span class="v">${v}</span></div>`; }
function kvPanel(info, details) { return `<div class="panel"><div class="kv2"><div><h4>Info</h4>${info.filter(Boolean).map(x => kv(x[0], x[1])).join('')}</div><div><h4>Details</h4>${details.filter(Boolean).map(x => kv(x[0], x[1])).join('')}</div></div></div>`; }
function sqlHi(s) {
  return esc(s).replace(/(&quot;[^&]*?&quot;|`[^`]*?`)/g, '\u0001$1\u0002').replace(/\b(select|from|where|and|or|insert|into|values|update|set|delete|inner|left|right|outer|join|on|in|order|by|desc|asc|limit|offset|count|as|group|having|between|is|not|null|distinct|returning|union|all|exists|case|when|then|else|end|with|for|like|ilike)\b/gi, '<span class="s-kw">$1</span>').replace(/\u0001/g, '<span class="s-id">').replace(/\u0002/g, '</span>');
}
function jsonHtml(v) {
  if (Array.isArray(v)) return `<span class="jw">[${v.length ? '<span class="jt" data-jt="1">−</span><span class="jdots"> … ]</span>' : ''}<div class="jl">${v.map((x, i) => `<div>${jsonHtml(x)}${i < v.length - 1 ? ',' : ''}</div>`).join('')}</div><span class="jend">]</span></span>`;
  if (v && typeof v === 'object') { const ks = Object.keys(v); return `<span class="jw">{${ks.length ? '<span class="jt" data-jt="1">−</span><span class="jdots"> … }</span>' : ''}<div class="jl">${ks.map((k, i) => `<div><span class="k">"${esc(k)}"</span>: ${jsonHtml(v[k])}${i < ks.length - 1 ? ',' : ''}</div>`).join('')}</div><span class="jend">}</span></span>`; }
  if (typeof v === 'string') return `<span class="s">"${esc(v)}"</span>`; return `<span class="n">${esc(JSON.stringify(v))}</span>`;
}
const parseJson = s => { if (s == null || typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return s; } };
function lvlHtml(l) { const u = String(l || '').toUpperCase(); return ['ALERT', 'CRITICAL', 'EMERGENCY'].includes(u) ? `<span class="badge-s oo">${esc(u)}</span>` : u === 'ERROR' ? '<span class="badge-s redo">ERROR</span>' : `<span class="mono" style="font-size:13px;color:${u === 'INFO' || u === 'NOTICE' ? 'var(--info)' : u === 'WARNING' ? 'var(--orange)' : 'var(--dim)'}">[${esc(u)}]</span>`; }
function md(s) { return esc(s).replace(/^### (.*)$/gm, '<h4 style="margin:8px 0 4px">$1</h4>').replace(/^## (.*)$/gm, '<h3 style="margin:10px 0 4px;font-size:16px">$1</h3>').replace(/^# (.*)$/gm, '<h3 style="margin:10px 0 4px;font-size:17px">$1</h3>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^[-*] (.*)$/gm, '<div style="padding-left:14px">• $1</div>').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>'); }

// Where an execution's id leads: the request, job attempt or command run it belongs to.
function execLink(source, executionId) {
  if (!executionId) return null; const s = String(source || '').toLowerCase();
  if (s === 'request') return 'requests/' + executionId;
  if (s === 'job') return 'jobs/attempts/' + executionId;
  if (s === 'command') return 'commands/runs/' + executionId;
  if (s === 'schedule' || s === 'scheduled_task') return 'scheduled-tasks/runs/' + executionId;
  return null;
}
const srcBadge = s => s ? `<span class="badge-s">${esc(s)}</span>` : '';

// The exception card: class, message, file and the stack frames (app frames marked; leading vendor frames folded).
function excBlock(ex, opts = {}) {
  if (!ex) return '';
  const frames = (ex.trace || []).map(f => ({ file: f.file || '[internal function]', source: f.source || '', app: !!f.file && !f.file.startsWith('[') && !/^vendor\/|\/vendor\//.test(f.file) }));
  const firstApp = frames.findIndex(f => f.app); const key = 'fr' + (opts.key || ''); const expanded = VS[key];
  const fr = (f, n) => `<div class="fr ${f.app ? 'app' : ''}"><span class="n">${n}</span>${f.source ? `<span class="fn">${esc(f.source)}</span>` : ''}<span class="p">${esc(f.file)}</span>${f.app ? '<span class="tagapp">APP</span>' : ''}</div>`;
  let list = '';
  if (firstApp > 2 && !expanded) list = fr(frames[0], 1) + `<div class="fr hidden-row" data-act="expandFrames" data-arg="${esc(key)}"><span class="n">${ic('ud', 13)}</span>${firstApp - 1} vendor frames hidden</div>` + frames.slice(firstApp).map((f, k) => fr(f, firstApp + k + 1)).join('');
  else list = frames.map((f, k) => fr(f, k + 1)).join('');
  const ver = [ex.php_version && 'PHP ' + ex.php_version, ex.laravel_version && 'Laravel ' + ex.laravel_version].filter(Boolean).join(' · ');
  const file = ex.file ? ex.file + (ex.line ? ':' + ex.line : '') : '';
  return `<div class="exb"><div class="exb-top"><div class="exb-row">${ex.handled ? '<span class="badge-s">Handled</span>' : '<span class="badge-s red">Unhandled</span>'}${opts.status ? `<span style="color:var(--orange)">${esc(opts.status)}</span>` : ''}<span class="ell">${esc(ex.class)}</span>${opts.link ? `<a class="btn sm" data-go="${esc(opts.link)}">${esc(opts.linkText || 'Exception')} ${ic('aur', 13)}</a>` : ''}<span class="ver">${esc(ver)}</span></div><div class="exb-msg">${esc(ex.message || '')}</div>${file ? `<div class="exb-file">${ic('folder', 14)}<span class="ell">${esc(file)}</span></div>` : ''}</div>${frames.length ? `<div class="frames"><div class="frames-in">${list}</div></div>` : ''}</div>`;
}
const loadingHtml = () => `<div class="loading" role="status" aria-live="polite"><span class="spin"></span>Loading…</div>`;
function errorHtml(e) {
  const nf = e && e.status === 404;
  return `<div class="ph"><h1>${nf ? 'Not found' : 'Something went wrong'}</h1></div><div class="empty" style="text-align:left">${esc(e && e.message || 'Unknown error')}${nf ? '<br><span class="dim">Raw events are kept for about 14 days; older records only exist as rollups.</span>' : ''}<div style="margin-top:14px;display:flex;gap:8px"><button class="btn sm" data-act="retry">Retry</button><a class="btn sm" data-go="">Dashboard</a></div></div>`;
}
