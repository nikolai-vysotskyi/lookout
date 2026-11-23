// ---------- charts ----------
// Every chart takes a series from the API (one row per bucket, t = bucket start). CH keeps what the hover tooltip needs.
const CH = {}; let chSeq = 0; let WIN = null;
const COL = { grey: 'var(--bar)', orange: 'var(--orange)', red: 'var(--red)', line: 'var(--mut)' };
function tsRow(win = WIN) { if (!win) return ''; return `<div class="ts"><span>${fmtTU(win.from)}</span><span>${fmtTU(win.to)}</span></div>`; }
function gl() { return [0, 33, 66].map(t => `<div class="gl" style="top:${t}%"></div>`).join(''); }
function legendHtml(items) { return `<div class="legend">${items.map(x => `<div class="lg"><div class="lab"><i class="mk" style="background:${x.c}"></i>${x.l}</div><div class="big">${x.v}</div></div>`).join('')}</div>`; }
const tsOf = series => series.map(b => tms(b.t));
// stacked bars: stacks = [{l, c, data[]}]
function barCard({ label, value, stacks, ts, legend = true, h = 200, legendVals = null, extra = '' }) {
  const id = 'c' + (++chSeq); const n = stacks[0].data.length;
  const sums = Array.from({ length: n }, (_, i) => stacks.reduce((a, s) => a + (s.data[i] || 0), 0)); const mx = Math.max(...sums, 0) || 1;
  CH[id] = { kind: 'bars', stacks, ts: ts || [], win: WIN };
  const bars = Array.from({ length: n }, (_, i) => `<div class="b">${stacks.map(s => s.data[i] > 0 ? `<i style="height:${Math.max(.6, s.data[i] / mx * 100)}%;background:${s.c}"></i>` : '').join('')}</div>`).join('');
  const lg = legend ? legendHtml(stacks.map((s, i) => ({ c: s.c, l: s.l, v: legendVals ? legendVals[i] : fmtN(sum(s.data)) }))) : '';
  return `<div class="cc"><div class="cc-top"><div><div class="lab">${label}</div><div class="big">${value}</div></div>${lg}${extra}</div><div class="plot" data-chart="${id}" style="height:${h}px">${gl()}<div class="bars">${bars}</div><div class="hline"></div></div>${tsRow()}</div>`;
}
// lines: null values are gaps (no data in that bucket)
function lineCard({ label, value, series, ts, h = 200, legendVals }) {
  const id = 'c' + (++chSeq); const n = series[0].data.length; const vals = series.flatMap(s => s.data).filter(v => v != null);
  const mx = (vals.length ? Math.max(...vals) : 0) * 1.08 || 1;
  CH[id] = { kind: 'line', stacks: series, ts: ts || [], win: WIN };
  const W = 1000, H = 200; const x = i => n > 1 ? (i / (n - 1) * W).toFixed(1) : W / 2; const y = v => (H - v / mx * H).toFixed(1);
  const paths = series.map((s, si) => {
    let d = '', pen = false; const runs = []; let cur = [];
    s.data.forEach((v, i) => { if (v == null) { pen = false; if (cur.length) runs.push(cur); cur = []; return; } d += (pen ? 'L' : 'M') + x(i) + ',' + y(v); pen = true; cur.push(i); });
    if (cur.length) runs.push(cur);
    const dots = runs.filter(r => r.length === 1).map(r => `<circle cx="${x(r[0])}" cy="${y(s.data[r[0]])}" r="2" fill="${s.c}" vector-effect="non-scaling-stroke"/>`).join('');
    const area = s.area && runs.length ? runs.filter(r => r.length > 1).map(r => `<path d="M${x(r[0])},${H}${r.map(i => 'L' + x(i) + ',' + y(s.data[i])).join('')}L${x(r[r.length - 1])},${H}Z" fill="url(#g${id}${si})" stroke="none"/>`).join('') + `<defs><linearGradient id="g${id}${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.c}" stop-opacity=".18"/><stop offset="1" stop-color="${s.c}" stop-opacity="0"/></linearGradient></defs>` : '';
    return `${area}<path d="${d}" fill="none" stroke="${s.c}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${dots}`;
  }).join('');
  const lg = legendHtml(series.map((s, i) => ({ c: s.c, l: s.l, v: legendVals ? legendVals[i] : '—' })));
  return `<div class="cc"><div class="cc-top"><div><div class="lab">${label}</div><div class="big">${value}</div></div>${lg}</div><div class="plot" data-chart="${id}" style="height:${h}px">${gl()}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${paths}</svg><div class="hline"></div></div>${tsRow()}</div>`;
}
// Requests by status class: calls minus 4xx/5xx is the "1/2/3XX" stack.
function statusBars(series, label = 'Requests', h = 200) {
  const e4 = series.map(b => b.status_4xx || 0), e5 = series.map(b => b.status_5xx || 0);
  const ok = series.map((b, i) => Math.max(0, (b.calls ?? b.requests ?? 0) - e4[i] - e5[i]));
  return barCard({ label, value: fmtN(sum(ok) + sum(e4) + sum(e5)), ts: tsOf(series), h, stacks: [{ l: '1/2/3XX', c: COL.grey, data: ok }, { l: '4XX', c: COL.orange, data: e4 }, { l: '5XX', c: COL.red, data: e5 }] });
}
function durCard(series, avg, p95, label = 'Duration', range = null, h = 200) {
  const a = series.map(b => b.avg_ms ?? null), p = series.map(b => b.p95_ms ?? null);
  const lo = range ? range[0] : Math.min(...a.filter(v => v != null)), hi = range ? range[1] : Math.max(...p.filter(v => v != null));
  const value = isFinite(lo) && isFinite(hi) && lo != null && hi != null ? `${fmtD(lo)} – ${fmtD(hi)}` : '—';
  return lineCard({ label, value, ts: tsOf(series), h, series: [{ l: 'AVG', c: COL.line, data: a }, { l: 'P95', c: COL.orange, data: p, area: true }], legendVals: [fmtD(avg), fmtD(p95)] });
}
function simpleBars(series, key, label, legendLabel = null, h = 200, value = null) {
  const d = series.map(b => b[key] || 0);
  return barCard({ label, value: value ?? fmtN(sum(d)), ts: tsOf(series), h, stacks: [{ l: legendLabel || label, c: COL.grey, data: d }], legend: !!legendLabel });
}
// stacks of [key, label, color] over a series
function stackBars(series, defs, label, h = 200, value = null) {
  const stacks = defs.map(([k, l, c]) => ({ l, c, data: series.map(b => typeof k === 'function' ? Math.max(0, k(b)) : (b[k] || 0)) }));
  return barCard({ label, value: value ?? fmtN(sum(stacks, s => sum(s.data))), ts: tsOf(series), h, stacks });
}

// chart hover tooltip
document.addEventListener('mousemove', e => {
  const plot = e.target.closest && e.target.closest('.plot[data-chart]'); const tip = $('#tip'); if (!tip) return;
  $$('.plot .hline').forEach(h => { if (!plot || h.parentNode !== plot) h.style.display = 'none'; });
  $$('.bars .b.hl').forEach(b => b.classList.remove('hl'));
  if (!plot) { tip.style.display = 'none'; return; }
  const c = CH[plot.dataset.chart]; if (!c) return; const r = plot.getBoundingClientRect(); const n = c.stacks[0].data.length; if (!n) return;
  const i = Math.max(0, Math.min(n - 1, c.kind === 'line' ? Math.round((e.clientX - r.left) / r.width * (n - 1)) : Math.floor((e.clientX - r.left) / r.width * n)));
  const hl = plot.querySelector('.hline'); hl.style.display = 'block'; hl.style.left = (c.kind === 'line' ? (n > 1 ? i / (n - 1) : .5) : (i + .5) / n) * 100 + '%';
  if (c.kind === 'bars') { const b = plot.querySelectorAll('.b')[i]; if (b) b.classList.add('hl'); }
  const tot = c.stacks.reduce((a, s) => a + (s.data[i] || 0), 0);
  tip.innerHTML = `<div class="tt">${c.ts[i] != null ? fmtT(c.ts[i], false) + ' UTC' : ''}</div>` + c.stacks.map(s => `<div class="tr2"><i class="mk" style="background:${s.c}"></i>${s.l}<b>${c.kind === 'bars' ? fmtInt(s.data[i] || 0) : fmtD(s.data[i])}</b></div>`).join('') + (c.kind === 'bars' && c.stacks.length > 1 ? `<div class="tr2 mut">Total<b>${fmtInt(tot)}</b></div>` : '');
  tip.style.display = 'block'; const tw = tip.offsetWidth; let x = e.clientX + 16; if (x + tw > innerWidth - 8) x = e.clientX - tw - 16; tip.style.left = Math.max(8, x) + 'px'; tip.style.top = (e.clientY - 20) + 'px';
});

// ---------- tables ----------
// A column with `api` sorts on the server (the view refetches with sort/direction); other columns sort the rows on hand.
const T = {}; let VS = {};
function ts_(id, def = {}) { if (!VS[id]) VS[id] = { sort: def.sort || null, q: def.q || '', mode: 'all' }; return VS[id]; }
function sortParams(id, cols) { const st = VS[id]; if (!st || !st.sort) return {}; const c = cols.find(c => c.k === st.sort.k); return c && c.api ? { sort: c.api, direction: st.sort.d > 0 ? 'asc' : 'desc' } : {}; }
function sortIcon(on, d) { return `<span class="si">${on ? (d > 0 ? '▲' : '▼') : '⇅'}</span>`; }
function table(id, cols, rows, opt = {}) {
  T[id] = { cols, rows, opt }; ts_(id, { sort: opt.sort });
  return `<div class="tblwrap"><div class="tbl" id="tbl-${id}" style="${opt.minw ? 'min-width:' + opt.minw + 'px' : ''}">${tableInner(id)}</div></div>`;
}
function tableInner(id) {
  const { cols, rows, opt } = T[id]; const st = VS[id]; let r = rows;
  if (st.q && !opt.serverQ) { const q = st.q.toLowerCase(); r = r.filter(x => (opt.text ? opt.text(x) : JSON.stringify(x)).toLowerCase().includes(q)); }
  if (st.mode === 'err' && opt.err && !opt.serverErr) r = r.filter(opt.err);
  if (st.sort) { const c = cols.find(c => c.k === st.sort.k); if (c && !c.api) { const get = c.v || (x => x[c.k]); r = [...r].sort((a, b) => { let A = get(a), B = get(b); A = A ?? -Infinity; B = B ?? -Infinity; return (A > B ? 1 : A < B ? -1 : 0) * st.sort.d; }); } }
  const tmpl = cols.map(c => c.w || '1fr').join(' ') + (opt.go ? ' 34px' : '');
  const head = `<div class="tr th" style="grid-template-columns:${tmpl}">${cols.map(c => { const on = st.sort && st.sort.k === c.k; return `<div class="${c.num ? 'num' : ''} ${on ? 'on' : ''}" ${c.nosort ? '' : `data-sort="${id}|${c.k}" role="button" tabindex="0"`}>${c.h ?? c.label}${c.nosort ? '' : sortIcon(on, on ? st.sort.d : 0)}</div>`; }).join('')}${opt.go ? '<div></div>' : ''}</div>`;
  const body = r.slice(0, opt.limit || 500).map(x => { const go = opt.go ? opt.go(x) : null; return `<div class="tr ${opt.rowCls ? opt.rowCls(x) : ''}" style="grid-template-columns:${tmpl}" ${go ? `data-go="${esc(go)}"` : ''}>${cols.map(c => `<div class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.r ? c.r(x) : esc(x[c.k])}</div>`).join('')}${opt.go ? `<div class="go">${go ? ic('aur', 14) : ''}</div>` : ''}</div>`; }).join('');
  return head + (body || `<div class="empty">${opt.emptyText || 'Nothing matches this filter.'}</div>`);
}
function rerenderTable(id) { const el = $('#tbl-' + id); if (el) el.innerHTML = tableInner(id); }
function listHeader({ icon, title, tableId, viewToggle = true, placeholder = 'Search', extra = '', errLabel = 'Errors' }) {
  const st = ts_(tableId);
  return `<div class="lh"><span class="li">${ic(icon, 20)}</span><h3>${title}</h3>${extra}<label class="search">${ic('search', 15)}<input data-search="${tableId}" placeholder="${esc(placeholder)}" value="${esc(st.q)}" aria-label="${esc(placeholder)}"><kbd>⌘F</kbd></label>${viewToggle ? `<div class="seg sans"><button class="${st.mode !== 'err' ? 'on' : ''}" data-act="mode" data-arg="${tableId}|all">View all</button><button class="${st.mode === 'err' ? 'on' : ''}" data-act="mode" data-arg="${tableId}|err">${errLabel}</button></div>` : ''}</div>`;
}
// params of a server-backed list: sort/direction of an api column, q and the errors filter
function listParams(id, cols, def) { const st = ts_(id, { sort: def }); return { ...sortParams(id, cols), q: st.q || '', filter: st.mode === 'err' ? 'errors' : '' }; }
// common cell renderers
const cNum = (k, label, w = '90px', f = fmtN, api = null) => ({ k, label, w, num: 1, api, r: x => x[k] ? f(x[k]) : `<span class="zero">0</span>` });
const cDur = (k, label, w = '96px', thr = null, api = null) => ({ k, label, w, num: 1, api, r: x => { const t = thr && thr(x); return t && x[k] > t ? `<span class="warn" title="Over the ${t}ms threshold">${ic('alert', 13)}${fmtD(x[k])}</span>` : fmtD(x[k]); } });
const c4 = (k = 'status_4xx', w = '90px', api = 'status_4xx') => ({ k, label: '4XX', w, num: 1, api, r: x => x[k] ? `<span class="warn">${ic('alert', 13)}${fmtN(x[k])}</span>` : '<span class="zero">0</span>' });
const c5 = (k = 'status_5xx', w = '90px', api = 'status_5xx') => ({ k, label: '5XX', w, num: 1, api, r: x => x[k] ? `<span class="epill">${ic('ac', 12, 2)}${fmtN(x[k])}</span>` : '<span class="zero">0</span>' });
const cFail = (k = 'failed', label = 'Failed', w = '90px', api = null) => ({ k, label, w, num: 1, api, r: x => x[k] ? `<span class="epill">${ic('ac', 12, 2)}${fmtN(x[k])}</span>` : '<span class="zero">0</span>' });
const dateCell = (k = 'created_at', w = '230px', label = 'Date') => ({ k, label, w, v: x => tms(x[k]), r: x => `<span class="mono" style="font-size:13px">${fmtTU(x[k])}</span>` });
const agoCell = (k, label, w = '100px', api = null) => ({ k, label, w, num: 1, api, v: x => tms(x[k]), r: x => `<span class="mono" title="${esc(fmtT(x[k]))} UTC">${ago(x[k])}</span>` });
const pathHtml = p => esc(p).replace(/\{(\w+\??)\}/g, '<em>{$1}</em>');
const statusCell = (k = 'status_code', w = '80px') => ({ k, label: 'Status', w, r: x => `<span class="st ${x[k] >= 500 ? 's5' : x[k] >= 400 ? 's4' : ''}">${x[k] ?? '—'}</span>` });
const methodOf = m => String(m || '').split('|')[0] || 'GET';
function userCell(k = 'user_id', label = 'User', w = '190px') {
  return { k, label, w, v: x => x[k] || '', r: x => x[k] ? `<a class="ucell" data-go="users/${encodeURIComponent(x[k])}">${avatar({ id: x[k], name: x.user_name || null }, 'sm')}<span class="ell">${esc(userLabel(x[k], x.user_name))}</span></a>` : '<span class="dim">Guest</span>' };
}
