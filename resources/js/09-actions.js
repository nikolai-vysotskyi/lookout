// ---------- actions ----------
const MENUS = {
  status: [{ t: 'Open', v: 'open' }, { t: 'Resolved', v: 'resolved' }, { t: 'Ignored', v: 'ignored' }],
  assign: () => [...(ASSIGNEES || []).map(a => ({ t: a.name + (a.id === ME.id ? ' (you)' : ''), v: String(a.id), icon: avatar(a, 'sm') })), '-', { t: 'Unassigned', v: '' }],
  priority: ['high', 'medium', 'low', 'none'].map(p => ({ t: p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1), v: p, icon: priBars(p === 'none' ? null : p) })),
};
const fail = e => toast(e && e.message ? e.message : 'Something went wrong', true);
function changesFor(kind, v) { return kind === 'status' ? { status: v } : kind === 'assign' ? { assigned_to: v ? +v : null } : { priority: v === 'none' ? null : v }; }
function windowChanged() { store.set('period', S.period === 'custom' ? null : S.period); history.replaceState(null, '', urlFor(curRel())); OPEN_ISSUES = null; if (VS.ipage) VS.ipage = 1; if (VS.logPage) VS.logPage = 1; render(true); }
const A = {
  period(p) { S.period = p; S.from = S.to = null; windowChanged(); },
  calendar(_, el) {
    const today = new Date().toISOString().slice(0, 10); const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); const min = new Date(Date.now() - 399 * 864e5).toISOString().slice(0, 10);
    openPop(el, `<div style="padding:8px;width:260px"><div class="plabel" style="padding-left:0">Custom range (UTC)</div><div class="field" style="margin-bottom:10px"><label for="cal-from">From</label><input id="cal-from" type="date" class="inp" min="${min}" max="${today}" value="${S.from ? S.from.slice(0, 10) : wk}"></div><div class="field" style="margin-bottom:12px"><label for="cal-to">To</label><input id="cal-to" type="date" class="inp" min="${min}" max="${today}" value="${S.to ? S.to.slice(0, 10) : today}"></div><button class="btn primary" style="width:100%;justify-content:center" data-act="applyRange">Apply</button></div>`, null, 'right');
  },
  applyRange() {
    const f = $('#cal-from').value, t = $('#cal-to').value; if (!f || !t || t < f) { toast('Pick an end date on or after the start date', true); return; }
    const end = Math.min(Date.parse(t + 'T00:00:00Z') + 864e5, Date.now()); S.from = f + 'T00:00:00Z'; S.to = new Date(end).toISOString().replace(/\.\d+Z$/, 'Z'); S.period = 'custom'; closePop(); windowChanged();
  },
  toggleActivity() { S.activityOpen = !S.activityOpen; render(true); },
  async env(_, el) {
    const [legacy, catalog] = await Promise.all([
      ENVS ? Promise.resolve(ENVS) : api('/overview', { period: '1h' }).then(d => d.environments || []).catch(() => []),
      sources().catch(() => ({ services: [] })),
    ]);
    if (!el.isConnected) return;
    const envs = [...new Set([...legacy, ...catalog.services.map(service => service.environment).filter(Boolean), ...(S.env ? [S.env] : [])])].sort();
    openPop(el, menu([{ label: 'Environment' }, { t: 'All environments', v: '' }, ...envs.map(e => ({ t: e, v: e }))], S.env || ''), v => {
      if (S.env !== (v || null)) VS.conn = null;
      S.env = v || null;
      store.set('env', S.env);
      windowChanged();
    });
  },
  userMenu(_, el) {
    openPop(el, menu([{ label: 'Theme' }, { t: 'Dark', v: 'dark', icon: ic('moon', 15) }, { t: 'Light', v: 'light', icon: ic('sun', 15) }, { t: 'System', v: 'system', icon: ic('app', 15) }, ...(HOME || LOGOUT ? ['-'] : []), ...(HOME ? [{ t: HOME.label, v: 'home', icon: ic('ext', 15) }] : []), ...(LOGOUT ? [{ t: 'Sign out', v: 'out', icon: ic('out2', 15) }] : [])], S.theme), async v => {
      if (v === 'home') { location.href = HOME.url; return; }
      if (v === 'out') { try { await fetch(LOGOUT, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-TOKEN': $('meta[name="csrf-token"]').content, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } }); } catch (e) { /* go to login anyway */ } location.href = LOGIN; return; }
      S.theme = v; store.set('theme', v); applyTheme();
    });
  },
  nav() { document.body.classList.toggle('nav-open'); },
  closeDrawer() { closeDrawer(); document.body.classList.remove('nav-open'); },
  retry() { CACHE.clear(); render(true); },
  mode(arg) { const [id, m] = arg.split('|'); ts_(id).mode = m; render(true); },
  hp(a) { VS.hp = a; render(true); },
  share() { copy(location.href, 'Link copied'); },
  expandFrames(key) { VS[key] = true; render(true); },
  tlZoom(a) { if (!TL) return; if (a === 'fit') { TL.v0 = 0; TL.v1 = TL.end * 1.02; renderTL(); } else { const s = TL.sel != null ? TL.spans[TL.sel] : null; tlZoom(a === 'in' ? .5 : 2, s ? s.s + s.d / 2 : (TL.v0 + TL.v1) / 2); } },
  tlFold() { if (!TL) return; const segs = TL.spans.filter(s => s.p >= 0 && hasKids(s.id)).map(s => s.id); if (TL.col.size) TL.col.clear(); else segs.forEach(id => TL.col.add(id)); renderTL(); },
  goSearch(arg) { const [path, id, q] = arg.split('|'); go(path, { [id]: { sort: null, q, mode: 'all' } }); },
  async userFilter(_, el) {
    if (VS.userFilter) { VS.userFilter = null; VS.logPage = 1; render(true); return; }
    let users = []; try { users = (await api('/users', { ...wp(), limit: 100 })).users; } catch (e) { /* empty list */ }
    openPop(el, `<div class="psearch">${ic('search', 14)}<input placeholder="Search users or type an ID" data-popsearch="1" aria-label="Search users"></div><div id="poplist">${menu(users.map(u => ({ t: `${userName(u)} · #${u.user_id}`, v: String(u.user_id), icon: avatar({ id: u.user_id, name: u.name, email: u.email }, 'sm') })))}</div>${users.length ? '' : '<div class="plabel">No signed-in users in this period. Type an ID and press Enter.</div>'}`, v => { VS.userFilter = v; VS.logPage = 1; render(true); }, 'right');
  },
  userLogs(id) { go('logs', { userFilter: id }); },
  connFilter(arg, el) {
    if (VS.conn) { VS.conn = null; render(true); return; }
    const conns = (arg || '').split('|').filter(Boolean);
    openPop(el, `<div class="psearch">${ic('search', 14)}<input placeholder="Search connections…" data-popsearch="1" aria-label="Search connections"></div><div id="poplist">${menu(conns.map(c => ({ t: c, v: c })), VS.conn)}</div>`, v => { VS.conn = v; render(true); }, 'right');
  },
  logLevel(_, el) { if (VS.logLevel) { VS.logLevel = null; VS.logPage = 1; render(true); return; } openPop(el, menu((VS.levels || []).map(l => ({ t: l.toUpperCase(), v: l }))), v => { VS.logLevel = v || null; VS.logPage = 1; render(true); }, 'right'); },
  logPage(p) { VS.logPage = Math.max(1, +p); render(); },
  utab(t) { VS.utab = t; render(true); },
  itab(t) { VS.itab = t; VS.ipage = 1; SEL.clear(); render(true); }, ist(s) { VS.ist = s; VS.ipage = 1; SEL.clear(); render(true); },
  ipage(p) { VS.ipage = Math.max(1, +p); SEL.clear(); render(); },
  clearSel() { SEL.clear(); render(true); },
  bulk(kind, el) {
    const items = typeof MENUS[kind] === 'function' ? MENUS[kind]() : MENUS[kind];
    openPop(el, menu(items), async v => {
      const ids = [...SEL];
      try { const r = await post('/issues/bulk', { ids, ...changesFor(kind, v) }); toast(`Updated ${r.updated.length} issue${r.updated.length === 1 ? '' : 's'}${r.unchanged.length ? `, ${r.unchanged.length} unchanged` : ''}`); SEL.clear(); OPEN_ISSUES = null; render(true); } catch (e) { fail(e); }
    });
  },
  issueMenu(arg, el) {
    const [id, kind, cur] = arg.split('|'); const items = typeof MENUS[kind] === 'function' ? MENUS[kind]() : MENUS[kind];
    openPop(el, menu(items, cur), async v => { try { await patch('/issues/' + id, changesFor(kind, v)); OPEN_ISSUES = null; render(true); } catch (e) { fail(e); } }, 'right');
  },
  async setStatus(arg) { const [id, s] = arg.split('|'); try { await post(`/issues/${id}/status`, { status: s }); toast(s === 'resolved' ? `${iid(id)} resolved` : s === 'ignored' ? `${iid(id)} ignored` : `${iid(id)} reopened`); OPEN_ISSUES = null; render(true); } catch (e) { fail(e); } },
  ed(m) { const d = $('#desc'); if (d) VS.desc = d.value; VS.ed = m; render(true); },
  async saveDesc(id) { const d = $('#desc'); if (d) VS.desc = d.value; try { await patch('/issues/' + id, { description: VS.desc.trim() === '' ? null : VS.desc }); toast('Description saved'); render(true); } catch (e) { fail(e); } },
  async comment(id) { const t = $('#cmt').value.trim(); if (!t) { toast('Write a comment first', true); return; } try { await post(`/issues/${id}/comments`, { body: t }); VS.cmt = ''; toast('Comment added'); render(true); } catch (e) { fail(e); } },
  stab(t) { VS.stab = t; render(true); },
  addThreshold() { thresholdDrawer(); },
  saveThreshold() {
    const type = $('#th-type').value, target = $('#th-target').value.trim() || null, ms = parseInt($('#th-ms').value, 10);
    if (!(ms >= 1 && ms <= 3600000)) { toast('Enter the threshold in milliseconds (1 to 3,600,000)', true); return; }
    if (VS.thrRows.some(t => t.type === type && (t.target || null) === target)) { toast('That threshold already exists; change its value in the list', true); return; }
    VS.thrRows.push({ type, target, duration_ms: ms }); closeDrawer(); A.thrSave();
  },
  thrDel(i) { VS.thrRows.splice(+i, 1); render(true); },
  thrReset() { VS.thrRows = SETTINGS.thresholds.map(t => ({ ...t })); render(true); },
  async thrSave() { const bad = VS.thrRows.findIndex(t => !(t.duration_ms >= 1 && t.duration_ms <= 3600000)); if (bad >= 0) { toast('Thresholds are 1 to 3,600,000 ms; fix row ' + (bad + 1), true); return; } try { const r = await put('/settings/thresholds', { thresholds: VS.thrRows }); toast('Thresholds saved; the agent applies them within 30 s'); VS.reload = true; SETTINGS = null; render(true); return r; } catch (e) { fail(e); } },
  chForm(id) { VS.chForm = id ? { edit: +id } : true; VS.chType = null; render(true); }, chCancel() { VS.chForm = false; VS.chType = null; render(true); },
  async chCreate() {
    const editId = VS.chForm && VS.chForm.edit; const type = editId ? 'telegram' : $('#ch-type').value, name = $('#ch-name').value.trim();
    const events = $$('[data-chev]').filter(c => c.checked).map(c => c.dataset.chev);
    const saved = () => { toast('Channel saved'); VS.chForm = false; VS.chType = null; VS.reload = true; render(true); };
    if (type === 'telegram') {
      const token = $('#ch-token').value.trim(), chat = $('#ch-chat').value.trim(), thread = $('#ch-thread').value.trim();
      if (!name || !chat || (!editId && !token)) { toast('Give the channel a name, a bot token and a chat ID', true); return; }
      const body = { name, chat_id: chat, message_thread_id: thread ? +thread : null, notify_events: events, ...(token ? { bot_token: token } : {}) };
      try { if (editId) await patch('/settings/telegram/' + editId, body); else await post('/settings/telegram', { ...body, enabled: true }); saved(); } catch (e) { fail(e); }
      return;
    }
    const url = $('#ch-url').value.trim(), secret = $('#ch-secret') ? $('#ch-secret').value.trim() : '';
    if (!name || !url) { toast('Give the channel a name and a URL', true); return; }
    const config = type === 'webhook' ? { url, ...(secret ? { secret } : {}), notify_events: events } : { webhook_url: url, notify_events: events };
    try { await post('/settings/channels', { name, type, enabled: true, config }); saved(); } catch (e) { fail(e); }
  },
  async chToggle(arg) { const [ref, on] = arg.split('|'); try { await patch(chUrl(ref), { enabled: on === '1' }); VS.reload = true; render(true); } catch (e) { fail(e); } },
  async chTest(ref) { try { await post(chUrl(ref) + '/test', {}); toast('Test message sent'); } catch (e) { fail(e); } },
  chDelAsk(ref) { VS.chDel = ref; render(true); },
  async chDelete(ref) { try { await del(chUrl(ref)); toast('Channel deleted'); VS.chDel = null; VS.reload = true; render(true); } catch (e) { fail(e); } },
  async autores(v) { try { await put('/settings/auto-resolve', { days: v ? +v : null }); toast(v ? `Issues resolve after ${v} quiet days` : 'Auto-resolve is off'); VS.reload = true; render(true); } catch (e) { fail(e); } },
  mtab(t) { VS.mtab = t; render(true); },
  tokForm() { VS.tokForm = true; render(true).then(() => { const n = $('#tk-name'); if (n) n.focus(); }); },
  tokCancel() { VS.tokForm = false; render(true); },
  async createTok() {
    const name = $('#tk-name').value.trim(); if (!name) { toast('Give the token a name', true); $('#tk-name').focus(); return; }
    try { const r = await post('/mcp/tokens', { name, can_write: $('#tk-write').checked }); NEWTOKEN = r.plain_token; VS.tokForm = false; render(true); } catch (e) { fail(e); }
  },
  hideTok() { NEWTOKEN = null; render(true); },
  async tokWrite(arg) { const [id, on] = arg.split('|'); try { await patch('/mcp/tokens/' + id, { can_write: on === '1' }); toast(on === '1' ? 'The token can read and write' : 'The token is read only'); render(true); } catch (e) { fail(e); } },
  revokeAsk(id) { VS.confirmRevoke = +id; render(true); },
  async revoke(id) { try { const r = await del('/mcp/tokens/' + id); VS.confirmRevoke = null; toast(`Revoked “${r.token.name}”`); render(true); } catch (e) { fail(e); } },
  toggleRevoked() { VS.showRevoked = !VS.showRevoked; render(true); },
  copyText(t) { copy(t); }, copySnip() { copy(snippet(VS.mtab || 'claude', VS.mcpUrl || '')); },
  dcard(_, el) { el.closest('.dcard').classList.toggle('closed'); },
};
const POP_OPENERS = '[data-act="calendar"],[data-act="userFilter"],[data-act="connFilter"],[data-act="logLevel"],[data-act="bulk"],[data-act="issueMenu"],[data-act="env"],[data-act="userMenu"]';
document.addEventListener('click', e => {
  const t = e.target;
  const pick = t.closest('[data-pick]'); if (pick && popCb) { const cb = popCb; closePop(); cb(pick.dataset.pick); return; }
  if (!t.closest('#pop') && !t.closest(POP_OPENERS)) closePop();
  const jt = t.closest('[data-jt]'); if (jt) { const w = jt.parentNode; w.classList.toggle('jcol'); jt.textContent = w.classList.contains('jcol') ? '+' : '−'; return; }
  const chk = t.closest('[data-check]'); if (chk) { const v = chk.dataset.check; if (v === 'all') { const all = ISSUE_ROWS.length && ISSUE_ROWS.every(r => SEL.has(r.id)); ISSUE_ROWS.forEach(r => all ? SEL.delete(r.id) : SEL.add(r.id)); } else { const id = +v; SEL.has(id) ? SEL.delete(id) : SEL.add(id); } render(true); return; }
  const fold = t.closest('[data-fold]'); if (fold && TL) { const id = +fold.dataset.fold; TL.col.has(id) ? TL.col.delete(id) : TL.col.add(id); renderTL(); return; }
  const sp = t.closest('[data-span]'); if (sp && TL) { spanDrawer(+sp.dataset.span); return; }
  const spg = t.closest('[data-spango]'); if (spg && TL) { spanDrawer(+spg.dataset.spango); return; }
  const lg = t.closest('[data-log]'); if (lg) { logDrawer(+lg.dataset.log); return; }
  const so = t.closest('[data-sort]'); if (so) { const [id, k] = so.dataset.sort.split('|'); const st = ts_(id); st.sort = st.sort && st.sort.k === k ? { k, d: -st.sort.d } : { k, d: -1 }; const c = T[id] && T[id].cols.find(c => c.k === k); if (c && c.api) render(true); else rerenderTable(id); return; }
  const act = t.closest('[data-act]'); if (act && A[act.dataset.act]) { if (act.matches('[disabled]')) return; e.preventDefault(); A[act.dataset.act](act.dataset.arg, act); return; }
  const g = t.closest('[data-go]'); if (g) {
    if (t.closest('input,select,textarea')) return;
    const rel = g.dataset.go; if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) { e.preventDefault(); window.open(urlFor(rel), '_blank', 'noopener'); return; }
    e.preventDefault(); go(rel);
  }
});
document.addEventListener('auxclick', e => { const g = e.target.closest && e.target.closest('[data-go]'); if (g && e.button === 1) { e.preventDefault(); window.open(urlFor(g.dataset.go), '_blank', 'noopener'); } });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search) { const id = t.dataset.search; ts_(id).q = t.value; if (T[id] && T[id].opt.serverQ) rerenderSoon(); else rerenderTable(id); }
  else if (t.dataset.isearch) { VS.iq = t.value; VS.ipage = 1; rerenderSoon(); }
  else if (t.dataset.logsearch) { VS.logQ = t.value; VS.logPage = 1; rerenderSoon(); }
  else if (t.dataset.desc) { const was = VS.desc !== null && VS.desc !== undefined; VS.desc = t.value; if (was && !$('[data-act="saveDesc"]')) { const g = $('.editor-h .gen'); const m = curRel().match(/^issues\/(\d+)$/); if (g && m) g.innerHTML = `<button class="btn sm primary" data-act="saveDesc" data-arg="${m[1]}">Save description</button>`; } }
  else if (t.id === 'cmt') VS.cmt = t.value;
  else if (t.dataset.popsearch) { const q = t.value.toLowerCase(); $$('#poplist .pi').forEach(p => p.hidden = !p.textContent.toLowerCase().includes(q)); }
  else if (t.dataset.thr) { const th = VS.thrRows[+t.dataset.thr]; const v = parseInt(t.value, 10); if (th && !isNaN(v)) { th.duration_ms = v; const dirty = JSON.stringify(VS.thrRows) !== JSON.stringify(SETTINGS.thresholds); $$('[data-act="thrSave"],[data-act="thrReset"]').forEach(b => { b.disabled = !dirty; }); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  const scope = t.dataset.scopeField;
  if (scope === 'project' || scope === 'service') {
    const value = t.value || null;
    if (S[scope] === value) return;
    S[scope] = value;
    if (scope === 'project' && (!value || !S.service?.startsWith(value + '/'))) S.service = null;
    VS.conn = null;
    history.pushState(null, '', urlFor(curRel()));
    render(true);
    return;
  }
  if (t.dataset.thtype) { fillTargets(t.value); $('#th-target').placeholder = THR_HINT[t.value] || ''; }
  if (t.dataset.chtype) { const v = t.value, tg = v === 'telegram'; VS.chType = v; $('#ch-secret-f').style.display = v === 'webhook' ? '' : 'none'; $('#ch-url-f').style.display = tg ? 'none' : ''; $('#ch-tg-f').style.display = tg ? '' : 'none'; $('#ch-help').textContent = CH_HELP[v] || CH_HELP.webhook; }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePop(); closeDrawer(); document.body.classList.remove('nav-open'); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { const s = $('.search input'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
  if (e.key === 'Enter' && e.target.matches('[data-popsearch]') && popCb) { const vis = $$('#poplist .pi').filter(p => !p.hidden); const cb = popCb; if (vis.length === 1) { closePop(); cb(vis[0].dataset.pick); } else if (!vis.length && /^[A-Za-z0-9_.@:-]+$/.test(e.target.value.trim())) { closePop(); cb(e.target.value.trim()); } }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][tabindex],[data-sort][tabindex],[data-log][tabindex],[data-pick][tabindex]')) { e.preventDefault(); e.target.click(); }
});
window.addEventListener('popstate', () => {
  const { project, service, env } = S;
  readWindowUrl();
  if (project !== S.project || service !== S.service || env !== S.env) VS.conn = null;
  if (env !== S.env) OPEN_ISSUES = null;
  render();
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.theme === 'system') applyTheme(); });

// ---------- boot ----------
(function boot() {
  const root = document.getElementById('lookout-app');
  root.innerHTML = `<div class="app"><aside class="side" id="side"></aside><main class="main" id="main"><div id="busy" aria-hidden="true"></div><div class="topbar"><button class="burger" data-act="nav" aria-label="Menu">${ic('menu', 18)}</button><b>${esc(BOOT.app_name || 'Lookout')}</b><span class="mut ell" id="current-environment">${esc(S.env || 'All environments')}</span></div><div class="page" id="page"></div></main></div><div id="ov" data-act="closeDrawer"></div><aside id="drawer" aria-hidden="true" aria-label="Details"><div class="dr-h"><button class="x" data-act="closeDrawer" aria-label="Close">${ic('x', 16)}</button><div id="dr-t" class="ell"></div></div><div class="dr-b" id="dr-b"></div></aside><div id="pop" role="listbox"></div><div id="tip" role="tooltip"></div><div id="toast" role="status" aria-live="polite"></div>`;
  applyTheme();
  history.replaceState(null, '', urlFor(curRel()));
  render();
})();
