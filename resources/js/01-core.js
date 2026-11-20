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
const iid = id => '#' + id;
