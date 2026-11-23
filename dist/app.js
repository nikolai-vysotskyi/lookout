// Built from resources/js by bin/build.sh. Do not edit.
// ---------- boot, state, API ----------
// Plain JS, no build step: bin/build.sh concatenates resources/js/*.js into dist/app.js (an ES module,
// so nothing leaks to window). The page shell is lookout::app; it passes window.LookoutBoot.
const BOOT = window.LookoutBoot || {};
const BASE = (BOOT.base_path || '/lookout').replace(/\/$/, '');
const API = (BOOT.api_base || BASE + '/api').replace(/\/$/, '');
const HOME = BOOT.home && BOOT.home.url ? BOOT.home : null; // the link back to the app (Nova with auth = nova)
const LOGOUT = BOOT.logout_url || null;
const LOGIN = BOOT.login_url || (HOME ? HOME.url : '/');
const PREFIX = BOOT.storage_prefix || 'lookout-';
const ME = BOOT.user || { id: null, name: 'You', email: '' };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function hsh(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const PERIODS = ['1h', '24h', '7d', '14d', '30d'];
const PERIOD_TXT = { '1h': 'in the last hour', '24h': 'in the last 24 hours', '7d': 'in the last 7 days', '14d': 'in the last 14 days', '30d': 'in the last 30 days' };
const S = { period: '24h', from: null, to: null, env: null, project: null, service: null, theme: 'dark', activityOpen: true };
const store = {
  get(k) { try { return localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(PREFIX + k) : localStorage.setItem(PREFIX + k, v); } catch (e) { /* private mode */ } },
};
function readWindowUrl(usePreferences = false) {
  const q = new URLSearchParams(location.search);
  const period = q.get('period') || (usePreferences ? store.get('period') : null);
  S.period = PERIODS.includes(period) ? period : '24h';
  S.from = S.to = null;
  if (Date.parse(q.get('to')) > Date.parse(q.get('from'))) {
    S.from = q.get('from');
    S.to = q.get('to');
    S.period = 'custom';
  }
  S.env = q.has('env') ? q.get('env') || null : (usePreferences ? store.get('env') : null);
  if (BOOT.sources_enabled) {
    const project = q.get('project');
    const service = q.get('service');
    const slug = '[a-z0-9][a-z0-9_-]{0,63}';
    S.project = project && new RegExp('^' + slug + '$').test(project) ? project : null;
    S.service = service && new RegExp('^' + slug + '/' + slug + '$').test(service)
      && (!S.project || service.startsWith(S.project + '/')) ? service : null;
  }
}
S.theme = store.get('theme') || S.theme;
readWindowUrl(true);
const periodTxt = () => S.period === 'custom' ? `between ${S.from.slice(0, 10)} and ${S.to.slice(0, 10)}` : PERIOD_TXT[S.period];
// Window params shared by every endpoint.
const wp = () => ({ ...(S.period === 'custom' ? { from: S.from, to: S.to } : { period: S.period }), environment: S.env || '' });
const scopeParams = () => BOOT.sources_enabled ? { project: S.project, service: S.service } : {};
const scopedWp = () => ({ ...wp(), ...scopeParams() });

function cookie(name) { const m = document.cookie.match('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
class ApiError extends Error { constructor(status, message, errors) { super(message); this.status = status; this.errors = errors || null; } }
const CACHE = new Map(); const TTL = 20000;
// GETs are cached for a few seconds so UI-only re-renders (toggles, menus) don't refetch; every write clears it.
async function api(path, params = {}, opt = {}) {
  const u = new URL(API + path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, v);
  const method = opt.method || 'GET'; const key = u.toString();
  if (method === 'GET' && !opt.fresh) { const c = CACHE.get(key); if (c && Date.now() - c.t < TTL) return c.data; }
  const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  const xsrf = cookie('XSRF-TOKEN'); if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
  const meta = $('meta[name="csrf-token"]'); if (meta && method !== 'GET') headers['X-CSRF-TOKEN'] = meta.content;
  if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(key, { method, headers, credentials: 'same-origin', body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined }); }
  catch (e) { throw new ApiError(0, 'The network request failed. Check the connection and try again.'); }
  if (res.status === 401 || res.status === 419) { location.href = LOGIN; throw new ApiError(res.status, 'Signed out'); }
  let data = null; try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const errs = data && data.errors; const first = errs && Object.values(errs)[0];
    throw new ApiError(res.status, (first && first[0]) || (data && data.message) || `Request failed (${res.status})`, errs);
  }
  if (method === 'GET') CACHE.set(key, { t: Date.now(), data }); else CACHE.clear();
  return data;
}
const post = (p, body) => api(p, {}, { method: 'POST', body });
const patch = (p, body) => api(p, {}, { method: 'PATCH', body });
const put = (p, body) => api(p, {}, { method: 'PUT', body });
const del = p => api(p, {}, { method: 'DELETE' });

// ---------- icons ----------
const IC = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  jobs: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  cache: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  out: '<path d="M15 3h6v6"/><path d="M21 3 12 12"/><path d="M4 10v10h10"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  logs: '<path d="M5 4v16M9 4v16M13 4l6 16"/>',
  sliders: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  ud: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  cr: '<path d="m9 18 6-6-6-6"/>', cd: '<path d="m6 9 6 6 6-6"/>', cu: '<path d="m18 15-6-6-6 6"/>', cl: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  zin: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>', zout: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  fold: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/>',
  app: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 9h20"/>',
  ac: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  cc: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  plus: '<path d="M5 12h14M12 5v14"/>', send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  aur: '<path d="M7 17 17 7M7 7h10v10"/>', back: '<path d="m12 19-7-7 7-7M19 12H5"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bars: '<path d="M6 20v-4M12 20v-9M18 20V4"/>', userc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  hook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  out2: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const ic = (n, s = 16, sw = 1.6) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

// ---------- formatting ----------
function fmtN(n) { if (n == null || isNaN(n)) return '—'; n = Math.round(n); const a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }
function fmtInt(n) { return n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'); }
function fmtD(ms) { if (ms == null || isNaN(ms)) return '—'; if (ms >= 3600000) { const h = Math.floor(ms / 3600000), m = Math.round(ms % 3600000 / 60000); return `${h}h ${m}m`; } if (ms >= 60000) { const m = Math.floor(ms / 60000), s = Math.round(ms % 60000 / 1000); return `${m}m ${s}s`; } if (ms >= 1000) return (ms / 1000).toFixed(2).replace(/0$/, '') + 's'; if (ms >= 100) return ms.toFixed(1).replace(/\.0$/, '') + 'ms'; return parseFloat(ms.toFixed(2)) + 'ms'; }
function fmtBytes(b) { if (b == null) return '—'; if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB'; if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'; return b + ' B'; }
const fmtPct = v => v == null ? '—' : (Math.round(v * 10) / 10) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const tms = v => v == null ? null : typeof v === 'number' ? v : Date.parse(v);
function fmtT(t, withYear = true) { t = tms(t); if (t == null) return '—'; const d = new Date(t); return `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; }
function fmtTU(t, y) { return `${fmtT(t, y)} <span class="dim">UTC</span>`; }
function fmtIso(t) { const d = new Date(tms(t)); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`; }
function ago(t) { t = tms(t); if (t == null) return '—'; const s = (Date.now() - t) / 1000; if (s < 0) return 'in ' + inDur(-s); if (s < 5) return 'just now'; if (s < 60) return Math.round(s) + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }
function inDur(s) { if (s < 60) return Math.max(1, Math.round(s)) + 's'; if (s < 3600) return Math.round(s / 60) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; }
const sum = (a, f = x => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const shortCls = c => String(c || '').split('\\').pop();

// ---------- people ----------
const avColor = id => `hsl(${hsh(id) % 360} 45% 42%)`;
function avatar(p, cls = '') {
  if (!p) return `<span class="av none ${cls}" title="Unassigned"></span>`;
  const label = p.name || p.email || ('User ' + (p.id ?? p.user_id ?? ''));
  return `<span class="av ${cls}" style="background:${avColor(p.id ?? p.user_id ?? label)}" title="${esc(label)}">${esc((label[0] || '?').toUpperCase())}</span>`;
}
const userName = u => u ? (u.name || u.email || `User #${u.user_id ?? u.id}`) : 'Guest';
// A user id with the name the API resolved for it, when it sent one (raw lists carry user_id and user_name apart).
const userLabel = (id, name) => name || `User #${id}`;
const iid = id => '#' + id;
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
// ---------- traces ----------
// A trace is a flat list of spans {id, p (parent id, -1 for roots), type, detail, s (start ms), d (duration ms), err, ev}.
// The API gives the stage timings of a request and the events of its execution; spans are nested under their stage.
const SEGS = new Set(['REQUEST', 'BOOTSTRAP', 'MIDDLEWARE', 'CONTROLLER', 'RENDER', 'SENDING', 'TERMINATING', 'JOB', 'ATTEMPT', 'COMMAND', 'SCHEDULED TASK']);
const STAGE_LABEL = { bootstrap: 'BOOTSTRAP', before_middleware: 'MIDDLEWARE', action: 'CONTROLLER', render: 'RENDER', after_middleware: 'MIDDLEWARE', sending: 'SENDING', terminating: 'TERMINATING' };
const EV_LABEL = { query: 'Query', cache: 'Cache', outgoing_request: 'Outgoing Request', log: 'Log', exception: 'Exception', job: 'Job', mail: 'Mail', notification: 'Notification' };
function evDetail(e) {
  switch (e.type) {
    case 'query': return e.sql || '';
    case 'cache': return `${e.event || ''} ${e.key || ''}`.trim();
    case 'outgoing_request': return `${e.method || ''} ${e.url || ''}`.trim();
    case 'log': return `${e.level || ''}: ${e.message || ''}`;
    case 'exception': return `${shortCls(e.class)}: ${e.message || ''}`;
    case 'job': return e.job || '';
    case 'mail': return e.mailable || e.subject || '';
    case 'notification': return e.notification || '';
    default: return '';
  }
}
function evErr(e) {
  return (e.type === 'exception' && !e.handled) || (e.type === 'outgoing_request' && (e.status_code == null || e.status_code >= 500))
    || (e.type === 'job' && String(e.status).toLowerCase() === 'failed') || ((e.type === 'mail' || e.type === 'notification') && e.failed)
    || (e.type === 'log' && ['error', 'critical', 'alert', 'emergency'].includes(String(e.level).toLowerCase()));
}
function mkTrace() {
  const sp = [];
  const add = (p, type, detail, s, d, meta = {}) => { sp.push({ id: sp.length, p, type, detail, s: Math.max(0, s || 0), d: Math.max(0, d || 0), err: !!meta.err, ev: meta.ev || null, meta }); return sp.length - 1; };
  // depth-first order (children by start time) so a parent is always followed by its own rows
  const done = () => {
    const kids = new Map(); sp.forEach(s => { if (!kids.has(s.p)) kids.set(s.p, []); kids.get(s.p).push(s); });
    const out = []; const walk = (p, np) => (kids.get(p) || []).sort((a, b) => a.s - b.s || a.id - b.id).forEach(s => { const n = { ...s, id: out.length, p: np }; out.push(n); walk(s.id, n.id); });
    walk(-1, -1); return out;
  };
  return { sp, add, done };
}
function addEvents(tr, events, parentFor) {
  for (const e of events) {
    const label = EV_LABEL[e.type] || e.type;
    tr.add(parentFor(e), label, evDetail(e), e.offset_ms, e.duration_ms || 0, { ev: e, err: evErr(e) });
  }
}
function traceRequest(req, events) {
  const tr = mkTrace(); const D = req.duration_ms || Math.max(1, ...events.map(e => (e.offset_ms || 0) + (e.duration_ms || 0)));
  const root = tr.add(-1, 'REQUEST', `${methodOf(req.method)} ${req.route && req.route.path ? req.route.path : req.url}`, 0, D, { err: req.status_code >= 500 });
  const stageSpan = {};
  for (const st of req.stages || []) if (st.duration_ms > 0) stageSpan[st.name] = tr.add(root, STAGE_LABEL[st.name] || st.name.toUpperCase(), '', st.offset_ms, st.duration_ms);
  const own = events.filter(e => e.same_execution !== false), linked = events.filter(e => e.same_execution === false);
  addEvents(tr, own, e => stageSpan[e.stage] ?? root);
  // executions linked by trace id (queued jobs that ran later): one JOB root per job event, their events under it
  const jobRoots = [];
  for (const e of linked.filter(e => e.type === 'job')) jobRoots.push({ id: tr.add(-1, 'JOB', e.job || 'Job', e.offset_ms, e.duration_ms || 0, { ev: e, err: evErr(e) }), s: e.offset_ms, e: e.offset_ms + (e.duration_ms || 0) });
  addEvents(tr, linked.filter(e => e.type !== 'job'), e => { const j = jobRoots.find(j => e.offset_ms >= j.s && e.offset_ms <= j.e + 1); return j ? j.id : root; });
  return tr.done();
}
function traceAttempt(at, events) {
  const tr = mkTrace(); const D = at.duration_ms || 1;
  const root = tr.add(-1, 'JOB', at.job || 'Job', 0, D, { err: String(at.status).toLowerCase() === 'failed' });
  const att = tr.add(root, 'ATTEMPT', '#' + (at.attempt || 1), 0, D, { err: String(at.status).toLowerCase() !== 'processed' });
  addEvents(tr, events, e => e.same_execution === false ? root : att);
  return tr.done();
}
function traceRun(run, events, kind) {
  const tr = mkTrace(); const D = run.duration_ms || 1;
  const root = tr.add(-1, kind, run.command || run.name || '', 0, D, { err: run.exit_code != null && run.exit_code !== 0 });
  addEvents(tr, events, () => root);
  return tr.done();
}

// ---------- timeline component ----------
let TL = null;
function timeline(spans, title = 'Timeline') {
  if (!spans.length) return '';
  const end = Math.max(1, ...spans.map(s => s.s + s.d));
  TL = { spans, end, v0: 0, v1: end * 1.02, col: new Set(), sel: null };
  return `<div class="tl" id="tl"><div class="tl-head"><div class="tl-l"><h3>${title}</h3><div class="tl-tools"><button data-act="tlZoom" data-arg="in" title="Zoom in" aria-label="Zoom in">${ic('zin', 16)}</button><button data-act="tlZoom" data-arg="out" title="Zoom out" aria-label="Zoom out">${ic('zout', 16)}</button><button data-act="tlZoom" data-arg="fit" title="Reset zoom" aria-label="Reset zoom">${ic('fit', 15)}</button><button data-act="tlFold" title="Collapse or expand all" aria-label="Collapse or expand all">${ic('fold', 16)}</button></div></div><div class="tl-axis" id="tl-axis"></div><div class="cursor-b" id="tl-cb"></div></div><div class="tl-body" id="tl-body"></div><div class="tl-hint"><span>${spans.length} spans</span><span>Drag across the waterfall to zoom</span><span>Ctrl + scroll to zoom at the cursor</span><span>Click a row or bar for details</span></div></div>`;
}
function tlNice(range) { const raw = range / 10; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function tlFmt(ms, step) { if (ms >= 1000 || step >= 1000) return (ms / 1000).toFixed(step >= 1000 ? 0 : step >= 100 ? 1 : 2) + 's'; return (step < 1 ? ms.toFixed(1) : Math.round(ms)) + 'ms'; }
function hasKids(id) { return TL.spans.some(s => s.p === id); }
function hiddenBy(s) { let p = s.p; while (p >= 0) { if (TL.col.has(p)) return true; p = TL.spans[p].p; } return false; }
function depth(s) { let d = 0, p = s.p; while (p >= 0) { d++; p = TL.spans[p].p; } return d; }
function renderTL() {
  if (!TL || !$('#tl')) return; const { v0, v1 } = TL; const rng_ = v1 - v0; const step = tlNice(rng_);
  let ax = ''; for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) { const x = (t - v0) / rng_ * 100; if (x > 1.5 && x < 98.5 || t === 0) ax += `<span style="left:${Math.max(2.2, x)}%">${tlFmt(t, step)}</span>`; }
  $('#tl-axis').innerHTML = ax;
  const rows = TL.spans.filter(s => !hiddenBy(s)).map(s => {
    const d = depth(s); const seg = SEGS.has(s.type); const kids = hasKids(s.id); const col = TL.col.has(s.id);
    const x0 = (s.s - v0) / rng_ * 100, x1 = (s.s + s.d - v0) / rng_ * 100;
    const isRoot = s.p < 0; const label = seg ? s.type : s.type.toUpperCase();
    let bar = '';
    if (x1 < 0) bar = `<span class="offarrow" style="left:8px">${ic('cl', 13)}</span>`;
    else if (x0 > 100) bar = `<span class="offarrow" style="right:8px">${ic('cr', 13)}</span>`;
    else { const L = Math.max(0, x0), W = Math.max(.25, Math.min(100, x1) - L); const right = L > 62; bar = `<div class="sp ${seg ? 'seg' : ''} ${s.err ? 'err' : ''} ${TL.sel === s.id ? 'on' : ''}" data-span="${s.id}" style="left:${L}%;width:${W}%"></div><div class="spl ${isRoot ? 'root' : ''} ${s.err ? 'err' : ''}" style="${right ? `right:${100 - L}%` : `left:${L}%`}"><b style="font-weight:500">${esc(label)}</b><span class="d">${fmtD(s.d)}</span><span class="x">${esc((s.detail || '').slice(0, 90))}${(s.detail || '').length > 90 ? '…' : ''}</span></div>`; }
    const inds = Array.from({ length: d }, () => '<span class="ind"></span>').join('');
    return `<div class="tl-row ${TL.sel === s.id ? 'sel' : ''}"><div class="tl-l ${s.err ? 'err' : ''}" data-span="${s.id}" title="${esc(s.type + ' ' + (s.detail || ''))}">${inds}<span class="tg" ${kids ? `data-fold="${s.id}"` : ''}>${kids ? (col ? '+' : '—') : ''}</span>${s.err && !seg ? `<span style="color:var(--red);margin-right:6px;display:inline-flex">${ic('ac', 14, 2)}</span>` : ''}<span class="ty ${seg ? '' : 'ev'}">${esc(s.type)}${s.type === 'ATTEMPT' ? ' ' + esc(s.detail) : ''}</span>${s.type !== 'ATTEMPT' && s.detail ? `<span class="de">${esc(s.detail)}</span>` : ''}</div><div class="tl-r">${bar}</div></div>`;
  }).join('');
  $('#tl-body').innerHTML = rows + '<div class="cursor" id="tl-cur"></div><div class="brush" id="tl-brush"></div>';
}
function tlXToMs(clientX) { const r = $('#tl-axis').getBoundingClientRect(); return TL.v0 + (clientX - r.left) / r.width * (TL.v1 - TL.v0); }
function tlZoom(f, at) { const c = at ?? (TL.v0 + TL.v1) / 2; let v0 = c - (c - TL.v0) * f, v1 = c + (TL.v1 - c) * f; const max = TL.end * 1.02; if (v1 - v0 >= max) { v0 = 0; v1 = max; } v0 = Math.max(0, v0); v1 = Math.min(max, v1); if (v1 - v0 < .05) return; TL.v0 = v0; TL.v1 = v1; renderTL(); }
let brush = null;
document.addEventListener('mousemove', e => {
  if (!TL || !$('#tl')) return; const ax = $('#tl-axis'); const r = ax.getBoundingClientRect(); const body = $('#tl-body'); const br = body.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= br.bottom;
  const cur = $('#tl-cur'), cb = $('#tl-cb'); if (!cur || !cb) return;
  if (inside) { const x = e.clientX - r.left; const lx = r.left - br.left + x; cur.style.display = 'block'; cur.style.left = lx + 'px'; cur.style.top = body.scrollTop + 'px'; cur.style.height = body.clientHeight + 'px'; cb.style.display = 'block'; cb.style.left = (r.left - $('#tl').getBoundingClientRect().left + x) + 'px'; cb.textContent = tlFmt(tlXToMs(e.clientX), (TL.v1 - TL.v0) < 20 ? .5 : 1); }
  else { cur.style.display = 'none'; cb.style.display = 'none'; }
  if (brush) { const b = $('#tl-brush'); const a = Math.min(brush.x, e.clientX), z = Math.max(brush.x, e.clientX); b.style.display = 'block'; b.style.left = (a - br.left) + 'px'; b.style.width = (z - a) + 'px'; b.style.top = body.scrollTop + 'px'; b.style.height = body.clientHeight + 'px'; brush.moved = Math.abs(e.clientX - brush.x) > 6; }
});
document.addEventListener('mousedown', e => { const r = e.target.closest && e.target.closest('.tl-r'); if (r && !e.target.closest('.sp') && e.button === 0) { brush = { x: e.clientX }; e.preventDefault(); } });
document.addEventListener('mouseup', e => {
  if (!brush) return; const b = brush; brush = null; const el = $('#tl-brush'); if (el) el.style.display = 'none';
  if (b.moved && TL) { const a = tlXToMs(Math.min(b.x, e.clientX)), z = tlXToMs(Math.max(b.x, e.clientX)); TL.v0 = Math.max(0, a); TL.v1 = Math.min(TL.end * 1.02, z); renderTL(); }
});
document.addEventListener('wheel', e => { if (!TL || !(e.ctrlKey || e.metaKey)) return; const r = e.target.closest && e.target.closest('.tl-r'); if (!r) return; e.preventDefault(); tlZoom(e.deltaY > 0 ? 1.25 : .8, tlXToMs(e.clientX)); }, { passive: false });

function spanDrawer(id) {
  const s = TL.spans[id]; TL.sel = id; renderTL(); const e = s.ev || {}; const seg = SEGS.has(s.type);
  const rows = [['Type', esc(s.type)], ['Started', '+' + fmtD(s.s)], ['Duration', fmtD(s.d)], ['Share of trace', (s.d / TL.end * 100).toFixed(1) + '%']];
  if (e.stage) rows.push(['Stage', esc(e.stage)]);
  let body = '';
  const card = (h, b, link) => `<div class="dcard"><div class="dcard-h">${h}<span class="r">${link || ''}</span></div><div class="dcard-b">${b}</div></div>`;
  const btn = (go, t) => `<a class="btn sm" data-go="${esc(go)}">${esc(t)} ${ic('aur', 13)}</a>`;
  if (e.type === 'query') { rows.push(['Connection', esc(e.connection || '—')]); if (e.file) rows.push(['Source', esc(e.file + (e.line ? ':' + e.line : ''))]); body = card('SQL', `<pre class="box">${sqlHi(e.sql || '')}</pre><div class="mut" style="margin-top:8px;font-size:12px;font-family:var(--sans)">Bindings are not recorded, so values show as ?</div>`, e.group_hash ? btn('queries/' + e.group_hash, 'Query') : ''); }
  else if (e.type === 'outgoing_request') { rows.push(['Method', esc(e.method || '—')], ['Status', e.status_code ? `<span class="st ${e.status_code >= 500 ? 's5' : e.status_code >= 400 ? 's4' : ''}">${e.status_code}</span>` : '<span class="st s5">no response</span>'], ['Host', esc(e.host || '—')]); body = card('URL', esc(e.url || ''), e.group_hash ? btn('outgoing/' + e.group_hash, 'Domain') : ''); }
  else if (e.type === 'cache') { rows.push(['Event', esc(e.event || '—')], ['Store', esc(e.store || '—')]); if (e.ttl != null) rows.push(['TTL', esc(e.ttl + 's')]); body = card('Key', esc(e.key || ''), `<a class="btn sm" data-act="goSearch" data-arg="cache|cache|${esc(e.key || '')}">Cache ${ic('aur', 13)}</a>`); }
  else if (e.type === 'exception') { rows.push(['Handled', e.handled ? 'yes' : 'no']); if (e.file) rows.push(['File', esc(e.file + (e.line ? ':' + e.line : ''))]); body = card(`<span style="color:var(--red)" class="ell">${esc(e.class || '')}</span>`, esc(e.message || ''), e.fingerprint ? btn('exceptions/' + e.fingerprint, 'Exception') : ''); }
  else if (e.type === 'log') { rows.push(['Level', lvlHtml(e.level)], ['Channel', esc(e.channel || '—')]); const ctx = parseJson(e.context); body = card('Message', esc(e.message || '')) + (ctx != null && ctx !== '' ? card('Context', typeof ctx === 'object' ? `<div class="json">${jsonHtml(ctx)}</div>` : esc(ctx)) : ''); }
  else if (e.type === 'job') { rows.push(['Queue', esc(e.queue || '—')], ['Status', esc(e.status || '—')], ['Attempt', esc(e.attempt ?? '—')]); body = card('Job', esc(e.job || ''), `<a class="btn sm" data-act="goSearch" data-arg="jobs|jobs|${esc(e.job || '')}">Jobs ${ic('aur', 13)}</a>`); }
  else if (e.type === 'mail') { rows.push(['Queued', e.queued ? 'yes' : 'no'], ['Failed', e.failed ? 'yes' : 'no']); body = card('Mailable', esc(e.mailable || '—')) + (e.subject ? card('Subject', esc(e.subject)) : ''); }
  else if (e.type === 'notification') { rows.push(['Channel', esc(e.channel || '—')], ['Notifiable', esc(e.notifiable_type || '—')], ['Queued', e.queued ? 'yes' : 'no'], ['Failed', e.failed ? 'yes' : 'no']); body = card('Notification', esc(e.notification || '')); }
  else if (s.detail) body = card('Detail', esc(s.detail));
  const kids = TL.spans.filter(x => x.p === s.id);
  if (kids.length) body += `<div class="dcard"><div class="dcard-h">Events<span class="r">${kids.length}</span></div><div class="dcard-b" style="padding:6px 16px">${kids.slice(0, 200).map(k => `<div class="kv" style="cursor:pointer" data-spango="${k.id}"><span class="k" style="${k.err ? 'color:var(--red)' : ''}">${esc(k.type)}</span><span class="f"></span><span class="v">${fmtD(k.d)}</span></div>`).join('')}</div></div>`;
  openDrawer(`<span style="${s.err ? 'color:var(--red)' : ''}">${esc(seg ? s.type : s.type.toUpperCase())}</span> <span class="mut">${fmtD(s.d)}</span>`, `<div class="dcard"><div class="dcard-b" style="padding:6px 16px">${rows.map(r => kv(r[0], r[1])).join('')}</div></div>${body}`, false);
}
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
// ---------- issues ----------
const SEL = new Set(); let ISSUE_ROWS = []; let ASSIGNEES = null;
const PRI = { null: 0, low: 1, medium: 2, high: 3 };
const priBars = p => `<span class="pri p${PRI[p] || 0}" title="${esc(p ? p[0].toUpperCase() + p.slice(1) : 'No priority')}"><i></i><i></i><i></i></span>`;
async function assignees() { if (!ASSIGNEES) { try { ASSIGNEES = (await api('/issues/assignees')).assignees; } catch (e) { ASSIGNEES = []; } } return ASSIGNEES; }
function issueTitle(x) {
  if (x.type === 'performance') return [x.title || 'Slow ' + (x.subtype || 'execution'), `${x.subtype ? x.subtype.replace('_', ' ') + ' · ' : ''}exceeded ${fmtD(x.threshold_ms)} (${fmtD(x.triggered_duration_ms)})`];
  return [x.title || 'Exception', x.message || ''];
}
const ISSUE_COLS = rows => [
  { k: 'sel', h: `<span class="cb ${rows.length && rows.every(r => SEL.has(r.id)) ? 'on' : ''}" data-check="all" role="checkbox" aria-checked="${rows.length && rows.every(r => SEL.has(r.id))}" aria-label="Select all">${rows.length && rows.every(r => SEL.has(r.id)) ? ic('check', 11, 3) : ''}</span>`, w: '28px', nosort: 1, r: x => `<span class="cb ${SEL.has(x.id) ? 'on' : ''}" data-check="${x.id}" role="checkbox" aria-checked="${SEL.has(x.id)}" aria-label="Select ${iid(x.id)}">${SEL.has(x.id) ? ic('check', 11, 3) : ''}</span>` },
  { k: 'id', label: 'ID', w: '74px', r: x => `<span class="mono">${x.id}</span>` },
  { k: 'priority', h: ic('bars', 14), w: '46px', v: x => PRI[x.priority] || 0, r: x => priBars(x.priority) },
  { k: 'title', label: 'Issue', w: 'minmax(300px,1fr)', r: x => { const [a, b] = issueTitle(x); return `<div class="cell2"><b>${esc(a)}</b><small>${esc(b)}</small></div>`; } },
  { k: 'spark', label: 'Trend', w: '96px', nosort: 1, r: x => spark(x.buckets) },
  cNum('occurrences', 'Count', '74px', fmtN, 'occurrences_count'), cNum('users_affected', 'Users', '64px', fmtN, 'users_count'),
  agoCell('first_seen_at', 'First seen', '100px', 'first_seen_at'), agoCell('last_seen_at', 'Last seen', '96px', 'last_seen_at'),
  { k: 'assigned_to', label: 'Assigned', w: '82px', v: x => x.assigned_to ? x.assigned_to.name : '', r: x => `<span style="display:flex;justify-content:center">${avatar(x.assigned_to && x.assigned_to.id ? x.assigned_to : null, 'sm')}</span>` },
];
function spark(b) {
  if (!b || !b.length) return '<span class="dim">—</span>'; const mx = Math.max(...b.map(x => x.count), 1);
  return `<span class="spark" aria-hidden="true">${b.map(x => `<i style="height:${x.count ? Math.max(12, x.count / mx * 100) : 4}%" class="${x.count ? 'on' : ''}"></i>`).join('')}</span>`;
}
async function vIssues() {
  const tab = VS.itab || 'exception', st = VS.ist || 'open', page = VS.ipage || 1; const cols = ISSUE_COLS([]);
  const [d] = await Promise.all([api('/issues', { ...wp(), type: tab, status: st, q: VS.iq || '', page, limit: 50, ...sortParams('issues', cols) }), assignees()]);
  ISSUE_ROWS = d.issues; OPEN_ISSUES = null; const rows = d.issues; const c = d.counts;
  const pages = Math.max(1, Math.ceil(d.total / d.limit));
  return `<div class="ph" style="flex-wrap:wrap"><div class="seg sans">${[['exception', 'Exceptions'], ['performance', 'Performance']].map(x => `<button class="${tab === x[0] ? 'on' : ''}" data-act="itab" data-arg="${x[0]}">${x[1]}<span class="cnt">${fmtN(c.types[x[0]])}</span></button>`).join('')}</div><div class="grow"></div>
  <label class="search">${ic('search', 15)}<input data-isearch="1" placeholder="Search issues" value="${esc(VS.iq || '')}" aria-label="Search issues"></label>
  <div class="seg sans">${[['open', 'Open'], ['unassigned', 'Unassigned'], ['mine', 'Mine'], ['resolved', 'Resolved'], ['ignored', 'Ignored']].map(s => `<button class="${st === s[0] ? 'on' : ''}" data-act="ist" data-arg="${s[0]}">${s[1]}${['open', 'unassigned', 'mine'].includes(s[0]) ? `<span class="cnt">${fmtN(c.statuses[s[0]])}</span>` : ''}</button>`).join('')}</div>${periodSeg()}</div>`
    + `<p class="mut hint">Issues seen ${esc(periodTxt())}${S.env ? ' in ' + esc(S.env) : ''}: ${fmtInt(d.total)}.</p>`
    + table('issues', ISSUE_COLS(rows), rows, { sort: { k: 'last_seen_at', d: -1 }, go: x => 'issues/' + x.id, rowCls: x => SEL.has(x.id) ? 'sel' : '', emptyText: st === 'open' ? 'No open issues in this period.' : 'No issues here.', minw: 1000 })
    + (pages > 1 ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn sm" data-act="ipage" data-arg="${page - 1}" ${page > 1 ? '' : 'disabled'}>${ic('cl', 14)}Previous</button><span class="mut mono" style="align-self:center;font-size:13px">${page} / ${pages}</span><button class="btn sm" data-act="ipage" data-arg="${page + 1}" ${page < pages ? '' : 'disabled'}>Next${ic('cr', 14)}</button></div>` : '')
    + (SEL.size ? `<div class="bulk" role="region" aria-label="Bulk actions"><button class="x" data-act="clearSel" aria-label="Clear selection">${ic('x', 14)}</button><div class="t"><b>${SEL.size}</b> of ${rows.length} selected</div><button class="bb" data-act="bulk" data-arg="status">${ic('cc', 15)}<span class="bl">Status</span></button><button class="bb" data-act="bulk" data-arg="assign">${ic('userc', 15)}<span class="bl">Assign</span></button><button class="bb" data-act="bulk" data-arg="priority">${ic('bars', 15)}<span class="bl">Priority</span></button></div>` : '');
}
const ACTION_TXT = { status_changed: 'set status to', priority_changed: 'set priority to', assigned: 'assigned', description_changed: 'edited the description', commented: 'commented' };
function feedHtml(d) {
  const names = Object.fromEntries((ASSIGNEES || []).map(a => [String(a.id), a.name]));
  const who = x => x.actor_type === 'agent' ? 'NightOwl' : esc(x.user_name || (x.actor_type === 'system' ? 'System' : 'Someone'));
  const items = [
    ...d.activity.filter(a => a.action !== 'commented').map(a => ({ t: tms(a.created_at), html: `<div class="fe"><span class="who">${who(a)}</span>${a.via === 'mcp' ? '<span class="mcpb">MCP</span>' : ''} ${a.action === 'assigned' ? (a.new_value ? `assigned <span class="who">${esc(names[a.new_value] || 'user #' + a.new_value)}</span>` : 'removed the assignee') : a.action === 'description_changed' ? 'edited the description' : `${esc(ACTION_TXT[a.action] || a.action.replace(/_/g, ' '))}${a.new_value ? ` <b>${esc(a.new_value)}</b>` : ''}`}<time>${ago(a.created_at)}</time></div>` })),
    ...d.comments.map(c => ({ t: tms(c.created_at), html: `<div class="fe cm"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${c.actor_type === 'mcp' || c.actor_type === 'agent' ? '<span class="av sm" style="background:#c96442">C</span>' : avatar({ id: c.user_id, name: c.user_name }, 'sm')}<span class="who">${esc(c.user_name || 'Agent')}</span>${c.actor_type === 'mcp' ? '<span class="mcpb">MCP</span>' : ''}<time>${ago(c.created_at)}</time></div><div style="color:var(--fg2);line-height:1.55;word-break:break-word">${md(c.body)}</div></div>` })),
  ].sort((a, b) => a.t - b.t);
  return `<div class="fe">Issue opened<time>${ago(d.issue.first_seen_at)}</time></div>` + items.map(x => x.html).join('');
}
async function vIssue(id) {
  const [d] = await Promise.all([api('/issues/' + id, wp()), assignees()]); WIN = d.window; const iss = d.issue; const isPerf = iss.type === 'performance';
  const mode = VS.ed || 'write'; if (VS.desc == null) VS.desc = iss.description || ''; const dirty = VS.desc !== (iss.description || '');
  const [title, sub] = issueTitle(iss); const lo = d.latest_occurrence;
  const perfLink = isPerf && iss.group_hash ? ({ route: 'requests/routes/', job: 'jobs/', command: 'commands/', scheduled_task: 'scheduled-tasks/', query: 'queries/', outgoing_request: 'outgoing/', mail: 'mail/', notification: 'notifications/' }[iss.subtype] || null) : null;
  const status = iss.status[0].toUpperCase() + iss.status.slice(1);
  const perfBlock = `<div class="panel"><div class="kv2"><div>${kv('Kind', esc(iss.subtype || '—'))}${kv('Threshold', fmtD(iss.threshold_ms))}${kv('Triggered at', `<span class="over">${fmtD(iss.triggered_duration_ms)}</span>`)}</div><div>${kv('Occurrences', fmtInt(iss.occurrences))}${kv('Environment', esc(iss.environment || '—'))}${perfLink && /^[0-9a-f]{32}$/.test(iss.group_hash) ? kv('Target', `<a data-go="${perfLink}${iss.group_hash}">Open ${esc(iss.subtype)}</a>`) : ''}</div></div></div><p class="mut hint">Performance issues have no per-occurrence rows: the agent opens them when the threshold is crossed and counts each breach.</p>`;
  return `<div class="iss"><div style="min-width:0">
    <div class="crumbs"><a data-go="issues">${esc(status)}</a><span>/</span><span>${iid(iss.id)}</span><span class="badge-s redo" style="margin-left:4px">${isPerf ? 'Performance' : 'Exception'}</span>${iss.environment ? `<span class="badge-s">${esc(iss.environment)}</span>` : ''}</div>
    <h1 class="ititle">${esc(isPerf ? title : shortCls(title) + (sub ? ': ' + (sub.length > 140 ? sub.slice(0, 140).replace(/\s\S*$/, '') + '…' : sub) : ''))}</h1>
    <div class="editor"><div class="editor-h"><button class="tb ${mode === 'write' ? 'on' : ''}" data-act="ed" data-arg="write">Write</button><button class="tb ${mode === 'preview' ? 'on' : ''}" data-act="ed" data-arg="preview">Preview</button><span class="gen">${dirty ? `<button class="btn sm primary" data-act="saveDesc" data-arg="${iss.id}">Save description</button>` : '<span class="dim">Markdown</span>'}</span></div>
    ${mode === 'write' ? `<textarea id="desc" data-desc="1" placeholder="Describe the cause and the fix. Agents with an MCP token can read and write this too." aria-label="Description">${esc(VS.desc)}</textarea>` : `<div class="pv">${VS.desc ? md(VS.desc) : '<span class="dim">Nothing to preview yet.</span>'}</div>`}</div>
    ${isPerf ? perfBlock : (lo ? excBlock(lo, { key: 'iss' + iss.id }) : '<div class="empty" style="margin-bottom:24px">The stack trace is gone with the raw events (kept about 14 days).</div>')}
    ${isPerf ? '' : (d.buckets ? `<div class="charts" style="margin-bottom:24px">${barCard({ label: 'Occurrences', value: fmtN(sum(d.buckets, b => b.count)), ts: tsOf(d.buckets), stacks: [{ l: 'Occurrences', c: lo && lo.handled ? COL.grey : COL.red, data: d.buckets.map(b => b.count) }], legend: false, h: 120 })}</div>` : '')
      + listHeader({ icon: 'alert', title: 'Latest occurrences', tableId: 'iocc', viewToggle: false }) + table('iocc', occCols(), d.recent_occurrences || [], { sort: { k: 'created_at', d: -1 }, go: x => execLink(x.source, x.execution_id), text: x => [x.execution_preview, x.message].join(' '), emptyText: 'No occurrences in the raw window.' })}
    <h3 style="font-size:18px;font-weight:500;margin:36px 0 12px">Activity</h3>
    <div class="feed" id="feed">${feedHtml(d)}</div>
    <div class="cbox"><textarea id="cmt" class="inp" placeholder="Leave a comment (Markdown)" aria-label="Comment">${esc(VS.cmt || '')}</textarea><div style="display:flex;justify-content:flex-end;padding:8px"><button class="btn primary sm" data-act="comment" data-arg="${iss.id}">Comment</button></div></div>
  </div>
  <aside class="meta">
    <div style="display:flex;gap:8px;margin-bottom:16px"><button class="btn primary" style="flex:1;justify-content:center" data-act="setStatus" data-arg="${iss.id}|${iss.status === 'resolved' ? 'open' : 'resolved'}">${ic('cc', 15)}${iss.status === 'resolved' ? 'Reopen' : 'Resolve'}</button><button class="btn" data-act="setStatus" data-arg="${iss.id}|${iss.status === 'ignored' ? 'open' : 'ignored'}">${iss.status === 'ignored' ? 'Unignore' : 'Ignore'}</button></div>
    <div class="kvb"><span class="k">Status</span><button class="pill" style="height:30px" data-act="issueMenu" data-arg="${iss.id}|status|${esc(iss.status)}">${esc(status)}${ic('cd', 13)}</button></div>
    <div class="kvb"><span class="k">Assignee</span><button class="pill" style="height:30px" data-act="issueMenu" data-arg="${iss.id}|assign|${iss.assigned_to && iss.assigned_to.id || ''}">${avatar(iss.assigned_to && iss.assigned_to.id ? iss.assigned_to : null, 'sm')}<span class="ell" style="max-width:130px">${esc(iss.assigned_to ? iss.assigned_to.name || 'User #' + (iss.assigned_to.raw || '') : 'Unassigned')}</span></button></div>
    <div class="kvb"><span class="k">Priority</span><button class="pill" style="height:30px" data-act="issueMenu" data-arg="${iss.id}|priority|${esc(iss.priority || 'none')}">${priBars(iss.priority)}${esc(iss.priority ? iss.priority[0].toUpperCase() + iss.priority.slice(1) : 'None')}</button></div>
    <div class="kvb"><span class="k">First seen</span><span class="mono" title="${esc(fmtT(iss.first_seen_at))} UTC">${ago(iss.first_seen_at)}</span></div>
    <div class="kvb"><span class="k">Last seen</span><span class="mono" title="${esc(fmtT(iss.last_seen_at))} UTC">${ago(iss.last_seen_at)}</span></div>
    <div class="kvb"><span class="k">Occurrences</span><span class="mono">${fmtInt(iss.occurrences)}</span></div>
    <div class="kvb"><span class="k">Users</span><span class="mono">${fmtInt(iss.users_affected)}</span></div>
    ${(d.affected_users || []).length ? `<div class="kvb" style="flex-wrap:wrap;gap:6px"><span class="k" style="width:100%">Affected users</span>${d.affected_users.slice(0, 12).map(u => `<a data-go="users/${encodeURIComponent(u.user_id)}" title="${esc(userName(u))} · ${u.occurrences}">${avatar({ id: u.user_id, name: u.name, email: u.email }, 'sm')}</a>`).join('')}</div>` : ''}
    ${!isPerf && iss.group_hash ? `<div class="kvb"><span class="k">Exception</span><a class="mono" style="cursor:pointer;text-decoration:underline;text-underline-offset:3px" data-go="exceptions/${esc(iss.group_hash)}">Open</a></div>` : ''}
  </aside></div>`;
}

// ---------- settings ----------
let SETTINGS = null;
const THR_LABEL = { route: 'Route', job: 'Job', command: 'Command', scheduled_task: 'Scheduled task', query: 'Query', cache: 'Cache', mail: 'Mail', notification: 'Notification', outgoing_request: 'Outgoing request' };
const CH_HELP = { webhook: 'HTTPS endpoint that receives the issue events.', slack: 'The Slack incoming webhook URL.', discord: 'The Discord incoming webhook URL.' };
const chRef = c => (c.type === 'telegram' ? 'tg' : '') + c.id;
const chUrl = ref => String(ref).startsWith('tg') ? '/settings/telegram/' + String(ref).slice(2) : '/settings/channels/' + ref;
const THR_HINT = { route: 'GET|HEAD /api/v1/home', job: 'App\\Jobs\\SyncPrices', command: 'posts:settle', scheduled_task: 'posts:settle', query: 'select * from "posts" where "id" = ?', cache: 'home:feed', mail: 'App\\Mail\\Digest', notification: 'App\\Notifications\\Alert', outgoing_request: 'api.example.com' };
async function vSettings() {
  const tab = VS.stab || 'thresholds';
  if (!SETTINGS || VS.reload) { SETTINGS = await api('/settings', {}, { fresh: true }); VS.reload = false; VS.thrRows = null; }
  // The router resets VS on every page change while SETTINGS stays cached, so the editable rows are rebuilt here; they
  // live apart from table('thr')'s own sort/search state (ts_ keeps that under VS.thr).
  if (!VS.thrRows) VS.thrRows = SETTINGS.thresholds.map(t => ({ ...t }));
  const s = SETTINGS; let body = '';
  if (tab === 'thresholds') {
    const dirty = JSON.stringify(VS.thrRows) !== JSON.stringify(s.thresholds);
    body = `<div class="lh"><span class="li">${ic('sliders', 20)}</span><h3>Performance thresholds</h3><button class="btn" data-act="thrReset" ${dirty ? '' : 'disabled'}>Discard</button><button class="btn" data-act="thrSave" ${dirty ? '' : 'disabled'}>Save changes</button><button class="btn primary" data-act="addThreshold">${ic('plus', 15)}Add threshold</button></div><p class="mut" style="margin:-4px 0 18px;max-width:760px">When an execution is slower than its threshold, the NightOwl agent opens a Performance issue and alerts the channels below. A rule without a target applies to every target of that type; a specific target wins. The agent picks changes up within about 30 seconds.</p>`
      + table('thr', [{ k: 'type', label: 'Type', w: '150px', r: x => `<span class="badge-s">${esc(THR_LABEL[x.type] || x.type)}</span>` }, { k: 'target', label: 'Target', w: 'minmax(260px,1fr)', r: x => x.target ? `<span class="mono ell" style="font-size:13.5px;display:block" title="${esc(x.target)}">${pathHtml(x.target)}</span>` : '<span class="dim">Every target (global rule)</span>' }, { k: 'duration_ms', label: 'Threshold', w: '170px', num: 1, r: x => `<span style="display:inline-flex;align-items:center;gap:6px"><input class="inp mono" type="number" min="1" max="3600000" style="width:110px;height:30px;text-align:right" data-thr="${VS.thrRows.indexOf(x)}" value="${x.duration_ms}" aria-label="Threshold in ms"><span class="dim">ms</span></span>` }, { k: 'del', h: '', w: '44px', nosort: 1, r: x => `<button class="btn sm" data-act="thrDel" data-arg="${VS.thrRows.indexOf(x)}" aria-label="Delete threshold">${ic('trash', 13)}</button>` }],
        VS.thrRows, { emptyText: 'No thresholds yet. Add one to get Performance issues.', minw: 640 });
  } else if (tab === 'notifications') {
    // Telegram channels are Lookout's own (settings/telegram/{id}); the rest are the agent's (settings/channels/{id}).
    const f = VS.chForm; const ed = f && f.edit ? s.alert_channels.find(c => c.type === 'telegram' && c.id === f.edit) : null;
    const tt = ed ? 'telegram' : (VS.chType || s.channel_types[0]);
    body = `<div class="lh"><span class="li">${ic('send', 20)}</span><h3>Alert channels</h3>${f ? '' : `<button class="btn primary" data-act="chForm">${ic('plus', 15)}Add channel</button>`}</div><p class="mut" style="margin:-4px 0 18px;max-width:760px">Every enabled channel hears when an issue opens or comes back. The NightOwl agent posts to webhook, Slack and Discord channels; a webhook gets a JSON body signed with HMAC-SHA256 in <span class="mono">X-NightOwl-Signature</span>. Lookout posts to Telegram itself, once a minute through the scheduler. Secrets, bot tokens and full URLs are never shown again after saving.</p>`
      + (f ? `<div class="panel"><div style="padding:20px;max-width:720px"><div class="field"><label for="ch-name">Name</label><input id="ch-name" class="inp" placeholder="For example: Ops chat" value="${esc(ed ? ed.name : '')}"></div><div class="field"><label for="ch-type">Type</label><select id="ch-type" class="inp" data-chtype="1" ${ed ? 'disabled' : ''}>${(ed ? ['telegram'] : s.channel_types).map(t => `<option value="${t}" ${t === tt ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>`
        + `<div class="field" id="ch-url-f" style="${tt === 'telegram' ? 'display:none' : ''}"><label for="ch-url">URL</label><input id="ch-url" class="inp mono" placeholder="https://…"><span class="help" id="ch-help">${esc(CH_HELP[tt] || CH_HELP.webhook)}</span></div><div class="field" id="ch-secret-f" style="${tt === 'webhook' ? '' : 'display:none'}"><label for="ch-secret">Signing secret (optional)</label><input id="ch-secret" class="inp mono" autocomplete="off"></div>`
        + `<div id="ch-tg-f" style="${tt === 'telegram' ? '' : 'display:none'}"><div class="field"><label for="ch-token">Bot token</label><input id="ch-token" class="inp mono" autocomplete="off" placeholder="${esc(ed ? `Saved (${ed.token_preview || '…'}); leave empty to keep it` : '123456789:AA…')}"><span class="help">The token @BotFather gave you for the bot.</span></div><div class="field"><label for="ch-chat">Chat ID</label><input id="ch-chat" class="inp mono" placeholder="-1001234567890 or @channelname" value="${esc(ed ? ed.chat_id : '')}"><span class="help">A group or channel id (negative for groups), or the @username of a public channel. Add the bot to the chat first.</span></div><div class="field"><label for="ch-thread">Topic ID (optional)</label><input id="ch-thread" class="inp mono" type="number" min="1" value="${ed && ed.message_thread_id ? ed.message_thread_id : ''}"><span class="help">In a group with topics: the topic's message_thread_id.</span></div></div>`
        + `<div class="field"><label>Send when</label>${s.events.map(e => `<label class="chk"><input type="checkbox" data-chev="${e}" ${!ed || !ed.notify_events || ed.notify_events.includes(e) ? 'checked' : ''}>${e === 'issue.new' ? 'A new issue opens' : e === 'issue.reopened' ? 'A resolved issue comes back' : esc(e)}</label>`).join('')}</div><div style="display:flex;gap:8px"><button class="btn primary" data-act="chCreate">Save channel</button><button class="btn" data-act="chCancel">Cancel</button></div></div></div>` : '')
      + (s.alert_channels.length ? `<div class="panel">${s.alert_channels.map(c => { const ref = chRef(c), tg = c.type === 'telegram'; return `<div class="srow"><span class="li mut">${ic(c.type === 'webhook' ? 'hook' : 'send', 18)}</span><div class="t"><b>${esc(c.name)} <span class="badge-s" style="margin-left:6px">${esc(c.type)}</span></b><small class="mono">${tg ? `chat ${esc(c.chat_id)}${c.message_thread_id ? ' · topic ' + c.message_thread_id : ''} · token ${esc(c.token_preview || '—')}` : `${esc(c.url_preview || 'no URL')}${c.has_secret ? ' · signed' : ''}`} · ${esc((c.notify_events || s.events).join(', ') || 'no events')}</small></div>${tg ? `<button class="btn sm" data-act="chTest" data-arg="${ref}">Send test</button><button class="btn sm" data-act="chForm" data-arg="${c.id}">Edit</button>` : ''}<span class="toggle ${c.enabled ? 'on' : ''}" data-act="chToggle" data-arg="${ref}|${c.enabled ? 0 : 1}" role="switch" aria-checked="${c.enabled}" aria-label="Enabled" tabindex="0"></span>${VS.chDel === ref ? `<button class="btn sm danger" data-act="chDelete" data-arg="${ref}">Confirm</button>` : `<button class="btn sm" data-act="chDelAsk" data-arg="${ref}" aria-label="Delete channel">${ic('trash', 13)}</button>`}</div>`; }).join('')}</div>` : (f ? '' : '<div class="empty">No alert channels yet. Issues still show here and in MCP.</div>'));
  } else {
    body = `<div class="panel"><div class="srow"><div class="t"><b>Auto-resolve</b><small>Resolve open issues that have had no new occurrences for this long. Runs daily at 03:40 UTC; a new occurrence reopens the issue.</small></div><div class="seg sans">${s.auto_resolve_options.map(o => `<button class="${s.auto_resolve_days === o ? 'on' : ''}" data-act="autores" data-arg="${o ?? ''}">${o ? o + ' days' : 'Never'}</button>`).join('')}</div></div></div>`;
  }
  return `<div class="ph"><h1>Settings</h1></div><div class="tabs" role="tablist">${[['thresholds', 'Thresholds'], ['notifications', 'Notifications'], ['issues', 'Issues']].map(t => `<button class="${tab === t[0] ? 'on' : ''}" data-act="stab" data-arg="${t[0]}" role="tab" aria-selected="${tab === t[0]}">${t[1]}</button>`).join('')}</div>${body}`;
}
function thresholdDrawer() {
  const types = (SETTINGS && SETTINGS.threshold_types) || Object.keys(THR_LABEL);
  openDrawer('New threshold', `<div class="field"><label for="th-type">Type</label><select id="th-type" class="inp" data-thtype="1">${types.map(t => `<option value="${t}">${esc(THR_LABEL[t] || t)}</option>`).join('')}</select></div><div class="field"><label for="th-target">Target</label><input id="th-target" class="inp mono" list="th-list" placeholder="${esc(THR_HINT.route)}"><datalist id="th-list"></datalist><span class="help">Leave empty for a global rule. Routes are written as <span class="mono">METHOD /path</span>, jobs and mail by class name, outgoing requests by host.</span></div><div class="field"><label for="th-ms">Slower than (ms)</label><input id="th-ms" class="inp mono" type="number" min="1" max="3600000" value="1000"></div><button class="btn primary" data-act="saveThreshold">Add threshold</button>`);
  fillTargets('route');
}
async function fillTargets(type) {
  const dl = $('#th-list'); if (!dl) return; const src = { route: ['/routes', 'routes', x => x.threshold_target], job: ['/jobs', 'jobs', x => x.job], outgoing_request: ['/outgoing', 'outgoing', x => x.host], query: ['/queries', 'queries', x => x.sql], command: ['/commands', 'commands', x => x.command], scheduled_task: ['/commands', 'scheduled_tasks', x => x.command], mail: ['/mail', 'mail', x => x.mailable], notification: ['/mail', 'notifications', x => x.notification] }[type];
  dl.innerHTML = ''; if (!src) return;
  try { const d = await api(src[0], { period: '7d', limit: 100 }); dl.innerHTML = (d[src[1]] || []).map(src[2]).filter(Boolean).map(v => `<option value="${esc(v)}">`).join(''); } catch (e) { /* suggestions are optional */ }
}

// ---------- MCP ----------
let NEWTOKEN = null;
const MCP_READ = ['list_issues', 'get_issue', 'slow_routes', 'slow_queries', 'failed_jobs', 'get_settings'];
const MCP_WRITE = ['resolve_issue', 'update_issue', 'comment_issue', 'set_threshold', 'delete_threshold', 'set_auto_resolve', 'create_alert_channel', 'update_alert_channel', 'delete_alert_channel'];
let MCPNAME = 'lookout'; // the server's name in MCP clients (mcp/config server_name)
function snippet(tab, url) {
  const tok = NEWTOKEN || '<YOUR_TOKEN>'; const n = MCPNAME; const env = n.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_TOKEN';
  if (tab === 'claude') return `claude mcp add --transport http ${n} \\\n  ${url} \\\n  --header "Authorization: Bearer ${tok}"`;
  if (tab === 'codex') return `# ~/.codex/config.toml\n[mcp_servers.${n}]\nurl = "${url}"\nbearer_token_env_var = "${env}"\n\n# then, in your shell profile:\nexport ${env}="${tok}"`;
  if (tab === 'cursor') return `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "${n}": {\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${tok}" }\n    }\n  }\n}`;
  if (tab === 'vscode') return `code --add-mcp '${JSON.stringify({ name: n, type: 'http', url, headers: { Authorization: 'Bearer ' + tok } })}'`;
  return JSON.stringify({ mcpServers: { [n]: { type: 'http', url, headers: { Authorization: 'Bearer ' + tok } } } }, null, 2);
}
async function vMcp() {
  const [cfg, tk] = await Promise.all([api('/mcp/config'), api('/mcp/tokens', {}, { fresh: true })]); const url = cfg.endpoint; VS.mcpUrl = url; if (cfg.server_name) MCPNAME = cfg.server_name;
  const tab = VS.mtab || 'claude'; const f = VS.tokForm; const toks = tk.tokens.filter(t => VS.showRevoked || !t.revoked_at);
  const vsLink = 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name: MCPNAME, type: 'http', url, headers: { Authorization: 'Bearer ' + (NEWTOKEN || '<YOUR_TOKEN>') } }));
  return `<div class="ph"><h1>MCP</h1></div><p class="mut" style="margin:-10px 0 24px;max-width:760px">Let coding agents read issues, traces, slow routes and logs from this monitoring. Tokens are read-only. With write access an agent can also change issues and the monitoring settings.</p>
  <div class="panel"><div class="panel-h">${ic('plug', 16)}<h3>Endpoint</h3><span class="badge-s green">Streamable HTTP</span></div><div style="padding:18px 20px"><div class="copyrow"><code>${esc(url)}</code><button class="btn" data-act="copyText" data-arg="${esc(url)}">${ic('copy', 14)}Copy</button></div><div class="note" style="margin-top:14px">${ic('ac', 16)}<span>Claude on the web and in the desktop app connects with OAuth. That comes in a later release; until then use a personal token with Claude Code or another client below.</span></div></div></div>
  <div class="panel"><div class="panel-h">${ic('key', 16)}<h3>Personal tokens</h3>${f ? '' : `<button class="btn primary sm" data-act="tokForm">${ic('plus', 14)}Create token</button>`}</div>
  <div style="padding:18px 20px">
  ${NEWTOKEN ? `<div class="once"><div style="font-weight:500;margin-bottom:4px">Copy your token now</div><div class="mut" style="font-size:13px;margin-bottom:10px">You won't be able to see it again. Paste it into one of the setups below.</div><div class="copyrow"><code id="newtok">${esc(NEWTOKEN)}</code><button class="btn" data-act="copyText" data-arg="${esc(NEWTOKEN)}">${ic('copy', 14)}Copy</button><button class="btn" data-act="hideTok">Done</button></div></div>` : ''}
  ${f ? `<div class="tokform"><div class="field"><label for="tk-name">Name</label><input id="tk-name" class="inp" maxlength="100" placeholder="For example: Laptop · Claude Code"></div><label class="chk" style="margin-bottom:6px"><input type="checkbox" id="tk-write">Write access</label><div class="help mut" style="font-size:12.5px;margin:0 0 16px 26px">Off: the agent can only read. On: it can also change issues (status, priority, assignee, comments) and settings (thresholds, alert channels, auto-resolve). Issue changes show in the issue's activity with an MCP badge.</div><div style="display:flex;gap:8px"><button class="btn primary" data-act="createTok">Create token</button><button class="btn" data-act="tokCancel">Cancel</button></div></div>` : ''}
  ${table('tokens', [{ k: 'name', label: 'Name', w: 'minmax(200px,1fr)', r: x => `<div class="cell2"><b>${esc(x.name)}${x.revoked_at ? ' <span class="badge-s">revoked</span>' : ''}</b><small>${esc(x.prefix)}… · ${x.can_write ? 'Read &amp; write' : 'Read'}</small></div>` }, { k: 'can_write', label: 'Write', w: '84px', r: x => x.revoked_at ? '<span class="dim">—</span>' : `<span class="toggle ${x.can_write ? 'on' : ''}" data-act="tokWrite" data-arg="${x.id}|${x.can_write ? 0 : 1}" role="switch" aria-checked="${x.can_write}" aria-label="Write access" tabindex="0"></span>` }, agoCell('created_at', 'Created', '110px'), { k: 'last_used_at', label: 'Last used', w: '110px', num: 1, v: x => tms(x.last_used_at), r: x => `<span class="mono">${x.last_used_at ? ago(x.last_used_at) : 'never'}</span>` }, { k: 'rv', h: '', w: '96px', nosort: 1, r: x => x.revoked_at ? '' : VS.confirmRevoke === x.id ? `<button class="btn sm danger" data-act="revoke" data-arg="${x.id}">Confirm</button>` : `<button class="btn sm" data-act="revokeAsk" data-arg="${x.id}">Revoke</button>` }], toks, { minw: 640, emptyText: 'No tokens yet.' })}
  ${tk.tokens.some(t => t.revoked_at) ? `<button class="btn sm" style="margin-top:10px" data-act="toggleRevoked">${VS.showRevoked ? 'Hide' : 'Show'} revoked tokens</button>` : ''}
  </div></div>
  <div class="panel"><div class="panel-h">${ic('braces', 16)}<h3>Connect a client</h3></div><div style="padding:6px 20px 20px"><div class="tabs" style="margin-bottom:16px;overflow-x:auto">${[['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'], ['vscode', 'VS Code'], ['other', 'Other (JSON)']].map(t => `<button class="${tab === t[0] ? 'on' : ''}" data-act="mtab" data-arg="${t[0]}">${t[1]}</button>`).join('')}</div>
  ${tab === 'vscode' ? `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap"><a class="btn primary" href="${esc(vsLink)}" style="text-decoration:none">Install in VS Code</a><span class="mut" style="font-size:13px">Opens VS Code through a <span class="mono">vscode:</span> link. If nothing happens, run the command below.</span></div>` : ''}
  <pre class="box" id="snip">${esc(snippet(tab, url))}</pre><div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-act="copySnip">${ic('copy', 13)}Copy</button>${NEWTOKEN ? '<span class="mut" style="font-size:13px">Your new token is already filled in.</span>' : '<span class="mut" style="font-size:13px">Replace &lt;YOUR_TOKEN&gt; with a token from above.</span>'}</div>
  <div class="mut" style="font-size:13px;margin-top:18px;line-height:1.7">Read tools, every token: ${MCP_READ.map(t => `<span class="mono">${t}</span>`).join(', ')}.<br>Write tools, only tokens with write access: ${MCP_WRITE.map(t => `<span class="mono">${t}</span>`).join(', ')}. A read-only token does not see them.</div></div></div>`;
}
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
