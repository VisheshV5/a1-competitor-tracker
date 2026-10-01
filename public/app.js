import { archiveLinks, localSnapshotHref } from './links.js';

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtMonth = (ym) => new Date(`${ym}-15`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shortMonth = (ym) => new Date(`${ym}-15`).toLocaleDateString('en-US', { month: 'short' }) + (ym.endsWith('-01') ? ` ’${ym.slice(2, 4)}` : '');
const daysAgo = (iso) => (Date.now() - new Date(iso)) / 864e5;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const CATS = ['Pricing', 'Feature', 'Integration', 'Industry', 'Positioning', 'Docs', 'Messaging'];
const PAGE_LABEL = { homepage: 'Homepage', pricing: 'Pricing', product: 'Product', integrations: 'Integrations', docs: 'Docs', changelog: 'Changelog' };

let data;
let byId = {};
const SERVED = location.protocol.startsWith('http') && !window.__DATA__;
let LIVE = false;   // local server: push over Server-Sent Events
let PAGES = false;  // GitHub Pages: poll data.json for new publishes
const freshIds = new Set();                       // arrived over the live stream this session
const lastVisit = store.get('last-visit') ?? '';  // anything detected after this is “new since last visit”
const isNew = (e) => freshIds.has(e.id) || (lastVisit && e.at > lastVisit);
const state = { q: '', comp: '', range: 0, a1: false, minor: false, cats: new Set(), month: '', limit: 60 };

async function load() {
  // dashboard.html has the data inlined; index.html (served) fetches it fresh.
  data = window.__DATA__ && !location.protocol.startsWith('http') ? window.__DATA__ : await fetch('data.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => window.__DATA__);
  byId = Object.fromEntries(data.profiles.map((p) => [p.id, p]));
  PAGES = SERVED && data.hosting === 'github';
  LIVE = SERVED && !PAGES;
  // Local server: scan in place. Pages: open the workflow to run a check. Standalone file: nothing to run.
  $('#scan-btn').hidden = !SERVED || (PAGES && !data.repoUrl);
  if (PAGES) { $('#scan-btn').textContent = 'Run a check ↗'; $('#scan-btn').title = 'Opens the GitHub Actions workflow — click “Run workflow”'; }
  renderChrome();
  renderHeat();
  renderFilters();
  renderFeed();
  renderCompetitors();
  renderMatrix();
  renderSources();
}

/* ---------- live updates ---------- */
const live = { checks: 0, lastCheckAt: null, interval: null, pages: 0 };
function connectLive() {
  if (PAGES) return pollPages();
  if (!LIVE || !window.EventSource) return;
  const es = new EventSource('/api/stream');
  es.addEventListener('hello', (m) => { Object.assign(live, JSON.parse(m.data)); renderLive(); });
  es.addEventListener('checked', (m) => { live.lastCheckAt = JSON.parse(m.data).at; live.checks++; renderLive(); });
  es.addEventListener('refresh', () => load());
  es.addEventListener('changes', async (m) => {
    const { ids } = JSON.parse(m.data);
    ids.forEach((id) => freshIds.add(id));
    await load();
    const evs = data.events.filter((e) => ids.includes(e.id));
    toast(evs);
    document.title = `(${freshIds.size}) Competitor Tracker — a1mobile`;
  });
  es.onerror = () => { live.down = true; renderLive(); };
  es.onopen = () => { live.down = false; renderLive(); };
}

// GitHub Pages has no server to push from, so check for a newer data.json every minute.
function pollPages() {
  const tick = async () => {
    let next;
    try { next = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()); } catch { return; }
    if (next.generatedAt === data.generatedAt) return;
    const before = new Set(data.events.map((e) => e.id));
    let ids = next.events.filter((e) => !before.has(e.id)).map((e) => e.id);
    if (ids.length > 25) ids = []; // history was re-scored after a rules update, not new competitor activity
    ids.forEach((id) => freshIds.add(id));
    await load();
    if (ids.length) {
      toast(data.events.filter((e) => ids.includes(e.id)));
      document.title = `(${freshIds.size}) Competitor Tracker — a1mobile`;
    }
  };
  renderLive();
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

function renderLive() {
  const el = $('#live');
  if (!el) return;
  if (PAGES) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(data.generatedAt)) / 60000));
    el.innerHTML = `<span class="live__dot"></span>Auto-updating · every page checked every ~${data.checkEveryMin} min · data published ${mins < 1 ? 'just now' : `${mins} min ago`}`;
    return;
  }
  if (!LIVE || !live.pages) { el.innerHTML = ''; return; }
  if (live.down) { el.innerHTML = '<span class="live__dot is-off"></span>Reconnecting…'; return; }
  const ago = live.lastCheckAt ? Math.max(0, Math.round((Date.now() - new Date(live.lastCheckAt)) / 1000)) : null;
  el.innerHTML = `<span class="live__dot"></span>Live · ${live.pages} pages, each every ~${Math.round(live.interval / 60)} min${ago !== null ? ` · last check ${ago}s ago` : ''}`;
}
setInterval(renderLive, 5000);

function toast(evs) {
  if (!evs.length) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<p class="t-mono-badge" style="color:#fcfcfc8c">Just detected · ${evs.length} change${evs.length === 1 ? '' : 's'}</p>${evs.slice(0, 3).map((e) => `<p class="toast__line"><b>${esc(byId[e.competitor]?.name)}</b> — ${esc(e.title)}</p>`).join('')}`;
  t.onclick = () => { showTab('changes'); $('#feed').scrollIntoView({ behavior: 'smooth' }); t.remove(); };
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 15000);
}

/* ---------- header ---------- */
function renderChrome() {
  const comps = data.profiles.filter((p) => !p.isSelf);
  const lastCheck = data.profiles.flatMap((p) => p.pages.map((pg) => pg.lastChecked)).filter(Boolean).sort().at(-1);
  const latest = data.events.find((e) => e.significance !== 'low') ?? data.events[0];
  const newCount = data.events.filter(isNew).length;
  $('#announce').innerHTML = newCount
    ? `<b>${newCount} new</b> since your last visit — latest: ${esc(byId[latest.competitor]?.name)}, ${esc(latest.title.slice(0, 60))}`
    : latest
    ? `Latest: <b>${esc(byId[latest.competitor]?.name)}</b> — ${esc(latest.title.slice(0, 80))}`
    : 'No changes detected yet — the next scan will compare against today’s baseline.';
  $('#kpis').innerHTML = [
    [comps.length, 'competitors watched'],
    [data.events.filter((e) => daysAgo(e.at) <= 7 && e.significance !== 'low').length, 'changes this week'],
    [data.events.filter((e) => daysAgo(e.at) <= 30 && e.significance === 'high').length, 'big changes this month'],
    [data.events.filter((e) => daysAgo(e.at) <= 30 && e.a1.length).length, 'relevant to a1mobile this month'],
  ].map(([v, l]) => `<div class="kpi"><span class="kpi__value">${v}</span><span class="kpi__label">${l}</span></div>`).join('');
  $('#generated').textContent = `Last scan ${lastCheck ? fmtDate(lastCheck) : '—'} · built ${fmtDate(data.generatedAt)}`;
}

/* ---------- activity grid ---------- */
function months(n = 12) {
  const out = [];
  const d = new Date(); d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

function renderHeat() {
  const ms = months(12);
  const comps = data.profiles.filter((p) => !p.isSelf);
  const counts = {};
  for (const e of data.events) counts[`${e.competitor}|${e.at.slice(0, 7)}`] = (counts[`${e.competitor}|${e.at.slice(0, 7)}`] ?? 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  const level = (n) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
  const rows = comps
    .map((c) => ({ c, total: ms.reduce((t, m) => t + (counts[`${c.id}|${m}`] ?? 0), 0) }))
    .sort((a, b) => b.total - a.total);
  $('#heat').innerHTML = `<table><thead><tr><th></th>${ms.map((m) => `<th>${shortMonth(m)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows.map(({ c, total }) =>
    `<tr><th>${esc(c.name)}</th>${ms.map((m) => {
      const n = counts[`${c.id}|${m}`] ?? 0;
      const sel = state.comp === c.id && state.month === m ? ' is-selected' : '';
      return `<td class="l${level(n)}${n ? '' : ' is-empty'}${sel}" data-c="${c.id}" data-m="${m}" data-n="${n}">${n || ''}</td>`;
    }).join('')}<td class="is-empty" style="color:var(--muted);background:none">${total}</td></tr>`).join('')}</tbody></table>`;

  const tip = $('#tooltip');
  $('#heat').onmousemove = (ev) => {
    const td = ev.target.closest('td[data-c]');
    if (!td) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${esc(byId[td.dataset.c].name)}</b> · ${fmtMonth(td.dataset.m)}<br>${td.dataset.n} change event${td.dataset.n === '1' ? '' : 's'}`;
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 290) + 'px';
    tip.style.top = ev.clientY + 14 + 'px';
  };
  $('#heat').onmouseleave = () => { tip.hidden = true; };
  $('#heat').onclick = (ev) => {
    const td = ev.target.closest('td[data-c]');
    if (!td || td.dataset.n === '0') return;
    const same = state.comp === td.dataset.c && state.month === td.dataset.m;
    state.comp = same ? '' : td.dataset.c;
    state.month = same ? '' : td.dataset.m;
    state.range = 0;
    $('#f-comp').value = state.comp; $('#f-range').value = '0';
    renderHeat(); renderFeed();
    showTab('changes');
    $('#filters').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/* ---------- filters ---------- */
function renderFilters() {
  const comps = data.profiles.filter((p) => !p.isSelf).sort((a, b) => a.name.localeCompare(b.name));
  $('#f-comp').innerHTML = `<option value="">All competitors</option>` + comps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const counts = Object.fromEntries(CATS.map((c) => [c, data.events.filter((e) => e.category === c).length]));
  $('#f-cats').innerHTML = CATS.filter((c) => counts[c]).map((c) => `<button class="chip" data-cat="${c}">${c}<span class="chip__n">${counts[c]}</span></button>`).join('');
  $('#f-cats').onclick = (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    state.cats.has(b.dataset.cat) ? state.cats.delete(b.dataset.cat) : state.cats.add(b.dataset.cat);
    b.classList.toggle('is-active');
    renderFeed();
  };
  $('#f-cats').querySelectorAll('.chip').forEach((b) => b.classList.toggle('is-active', state.cats.has(b.dataset.cat)));
  $('#f-comp').value = state.comp;
  if (renderFilters.bound) return;
  renderFilters.bound = true;
  const bind = (sel, key, read) => $(sel).addEventListener('input', (e) => { state[key] = read(e.target); if (key !== 'q') state.month = ''; state.limit = 60; renderFeed(); if (key === 'comp') renderHeat(); });
  bind('#q', 'q', (t) => t.value.trim().toLowerCase());
  bind('#f-comp', 'comp', (t) => t.value);
  bind('#f-range', 'range', (t) => Number(t.value));
  bind('#f-a1', 'a1', (t) => t.checked);
  bind('#f-minor', 'minor', (t) => t.checked);
}

function filtered() {
  return data.events.filter((e) =>
    (!state.comp || e.competitor === state.comp) &&
    (!state.month || e.at.startsWith(state.month)) &&
    (!state.range || daysAgo(e.at) <= state.range) &&
    (!state.a1 || e.a1.length) &&
    (state.minor || e.significance !== 'low') &&
    (!state.cats.size || state.cats.has(e.category)) &&
    (!state.q || [e.title, byId[e.competitor]?.name, e.category, ...(e.added ?? []), ...(e.a1 ?? [])].join(' ').toLowerCase().includes(state.q)));
}

/* ---------- feed ---------- */
const dayLabel = (iso) => {
  const d = new Date(iso), t = new Date();
  const days = Math.round((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: days < 7 ? 'long' : undefined, month: 'long', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
};
// "Pricing · Pricing page" says the same thing twice, so the page name is skipped when it matches.
const PAGE_NAME = { homepage: 'Homepage', pricing: 'Pricing page', product: 'Product page', integrations: 'Integrations page', docs: 'Docs', changelog: 'Changelog' };
const SAME = { pricing: 'Pricing', integrations: 'Integration', docs: 'Docs' };
const pageName = (e) => (SAME[e.pageType] === e.category ? '' : PAGE_NAME[e.pageType] ?? 'Page');
const initials = (name = '') => name.trim()[0]?.toUpperCase() ?? '?';

function renderFeed() {
  const list = filtered();
  const minorHidden = state.minor ? 0 : data.events.filter((e) => e.significance === 'low').length;
  $('#feed-summary').textContent = `${list.length} change${list.length === 1 ? '' : 's'}${minorHidden ? ` · ${minorHidden} minor edits hidden` : ''}`;
  if (!list.length) {
    $('#feed').innerHTML = `<div class="empty"><p class="t-row-title">No changes match.</p><p class="t-body" style="margin:8px auto 0">${data.events.length ? 'Try widening the time range or clearing filters.' : 'Run a scan or the Wayback backfill to start the timeline.'}</p></div>`;
    return;
  }
  let html = '';
  let day = '';
  for (const e of list.slice(0, state.limit)) {
    const d = dayLabel(e.at);
    if (d !== day) { html += `${day ? '</div>' : ''}<h3 class="feed__day">${d}</h3><div class="feed__group">`; day = d; }
    html += eventCard(e);
  }
  if (day) html += '</div>';
  if (list.length > state.limit) html += `<div class="more"><button class="btn" id="more">Show ${Math.min(60, list.length - state.limit)} more of ${list.length - state.limit}</button></div>`;
  $('#feed').innerHTML = html;
  $('#more')?.addEventListener('click', () => { state.limit += 60; renderFeed(); });
}

function eventCard(e) {
  const c = byId[e.competitor];
  const archive = Object.fromEntries(archiveLinks(e).map((l) => [l.kind, l.href]));
  const versionLink = (which, label) => archive[which]
    ? `<a href="${esc(archive[which])}" target="_blank" rel="noopener" title="Internet Archive capture">${label} ↗</a>`
    : SERVED ? `<a href="${localSnapshotHref(e, which, PAGES)}" target="_blank" rel="noopener" title="Our stored copy of this version">${label} ↗</a>` : '';
  const hasDiff = (e.added?.length || e.removed?.length || e.before);
  const diff = !hasDiff ? '' : `<div class="diff" hidden>${
    e.before !== undefined ? `<div class="diff__ba"><div class="diff__line diff__line--del"><span>Before</span>${esc(e.before)}</div><div class="diff__line diff__line--add"><span>After</span>${esc(e.after)}</div></div>` :
    [...(e.added ?? []).map((t) => `<div class="diff__line diff__line--add">${esc(t)}</div>`), ...(e.removed ?? []).map((t) => `<div class="diff__line diff__line--del">${esc(t)}</div>`)].join('')
  }</div>`;
  return `<article class="event event--${e.significance}${isNew(e) ? ' event--new' : ''}">
    <span class="avatar" aria-hidden="true">${esc(initials(c?.name))}</span>
    <div class="event__body">
      <div class="event__meta">
        <span class="event__comp">${esc(c?.name)}</span>
        <span class="dotsep">·</span><span>${e.category}</span>
        ${pageName(e) ? `<span class="dotsep">·</span><span>${pageName(e)}</span>` : ''}
        ${isNew(e) ? '<span class="pill pill--new">New</span>' : ''}
      </div>
      <h4 class="event__title">${esc(e.title)}</h4>
      ${e.a1.length ? `<div class="a1">${e.a1.map((n) => `<span class="a1__note">${esc(n)}</span>`).join('')}</div>` : ''}
      <div class="event__foot">
        ${hasDiff ? `<button class="linkbtn" data-toggle>What changed</button>` : ''}
        <a href="${esc(e.url)}" target="_blank" rel="noopener">Live page ↗</a>
        ${versionLink('before', `Before`)}
        ${versionLink('after', 'After')}
      </div>
      ${diff}
    </div>
  </article>`;
}

$('#feed').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-toggle]'); if (!b) return;
  const d = b.closest('.event').querySelector('.diff');
  d.hidden = !d.hidden;
  b.textContent = d.hidden ? 'What changed' : 'Hide details';
});

/* ---------- competitors ---------- */
function renderCompetitors() {
  const groups = { self: 'Us', ...data.groups };
  const lastEvent = (id) => data.events.find((e) => e.competitor === id);
  $('#competitors').innerHTML = Object.entries(groups).map(([g, label]) => {
    const items = data.profiles.filter((p) => (p.isSelf ? 'self' : p.group) === g);
    if (!items.length) return '';
    return `<div class="group">
      <div class="group__head"><h3 class="t-card-title">${esc(label)}</h3><span class="t-mono-caption">${items.length}</span></div>
      <div class="grid">${items.map((p) => {
        const le = lastEvent(p.id);
        const n90 = data.events.filter((e) => e.competitor === p.id && daysAgo(e.at) <= 90).length;
        const tags = p.isSelf ? p.facts.capabilities : p.gaps;
        return `<div class="card comp${p.isSelf ? ' comp--self' : ''}">
          <div class="comp__top">
            <div><p class="t-mono-badge">${esc(new URL(p.url).hostname.replace('www.', ''))}</p><h4 class="t-card-title" style="margin-top:6px">${esc(p.name)}</h4></div>
            <div class="comp__price">${esc(p.startingPrice ?? 'Quote')}<small>${p.startingPrice ? 'from' : 'pricing'}</small></div>
          </div>
          ${p.headline ? `<p class="comp__headline">“${esc(p.headline.slice(0, 140))}”</p>` : ''}
          ${p.focus ? `<p class="comp__focus">${esc(p.focus)}</p>` : ''}
          ${tags.length ? `<p class="comp__label">${p.isSelf ? 'Capabilities on our site' : 'Claims a1mobile lacks'}</p><div class="comp__tags">${tags.slice(0, 10).map((t) => `<span class="tag${p.isSelf ? '' : ' tag--gap'}">${esc(t)}</span>`).join('')}${tags.length > 10 ? `<span class="tag">+${tags.length - 10}</span>` : ''}</div>` : ''}
          ${p.facts.integrations.length ? `<p class="comp__label">Integrations mentioned · ${p.facts.integrations.length}</p><div class="comp__tags">${p.facts.integrations.slice(0, 8).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${p.facts.integrations.length > 8 ? `<span class="tag">+${p.facts.integrations.length - 8}</span>` : ''}</div>` : ''}
          <div class="comp__foot">
            <span class="t-mono-caption">${p.isSelf ? `${p.pages.length} page tracked` : `${n90} changes · 90d${le ? ` · last ${fmtDate(le.at)}` : ''}`}</span>
            ${p.isSelf ? '' : `<button class="linkbtn" data-comp="${p.id}">View changes →</button>`}
          </div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

$('#competitors').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-comp]'); if (!b) return;
  state.comp = b.dataset.comp; state.month = ''; $('#f-comp').value = state.comp;
  showTab('changes'); renderHeat(); renderFeed();
});

/* ---------- matrix ---------- */
const KINDS = { capabilities: 'Capabilities', integrations: 'Integrations', industries: 'Industries', languages: 'Languages' };
let kind = store.get('mx-kind') ?? 'capabilities';

function renderMatrix() {
  $('#m-kind').innerHTML = Object.entries(KINDS).map(([k, l]) => `<button class="chip${k === kind ? ' is-active' : ''}" data-kind="${k}">${l}</button>`).join('');
  const self = data.profiles.find((p) => p.isSelf);
  const comps = data.profiles.filter((p) => !p.isSelf);
  const selfHas = new Set(kind === 'capabilities' ? data.selfCapabilities : self.facts[kind]);
  const rows = [...new Set(data.profiles.flatMap((p) => p.facts[kind]).concat(kind === 'capabilities' ? data.selfCapabilities : []))]
    .map((name) => ({ name, n: comps.filter((c) => c.facts[kind].includes(name)).length, self: selfHas.has(name) }))
    .sort((a, b) => (a.self - b.self) || (b.n - a.n) || a.name.localeCompare(b.name));
  $('#matrix').innerHTML = `<table class="mx"><thead><tr><th class="mx__row">${KINDS[kind]}</th><th class="mx__self">a1mobile</th>${comps.map((c) => `<th>${esc(c.name)}</th>`).join('')}<th>Count</th></tr></thead><tbody>${rows.map((r) =>
    `<tr class="${!r.self && kind !== 'languages' ? 'is-gap' : ''}"><th class="mx__row">${esc(r.name)}</th><td class="mx__self ${r.self ? 'yes self-yes' : 'no'}"></td>${comps.map((c) => `<td class="${c.facts[kind].includes(r.name) ? 'yes' : 'no'}" title="${esc(c.name)} · ${esc(r.name)}"></td>`).join('')}<td class="count">${r.n}/${comps.length}</td></tr>`).join('')}</tbody></table>`;
}

$('#m-kind').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-kind]'); if (!b) return;
  kind = b.dataset.kind; store.set('mx-kind', kind); renderMatrix();
});

/* ---------- sources ---------- */
function renderSources() {
  const rows = data.profiles.flatMap((p) => p.pages.map((pg) => ({ p, pg })));
  $('#sources').innerHTML = `<table class="mx sources"><thead><tr><th class="mx__row">Competitor</th><th>Page</th><th>URL</th><th>Versions</th><th>Tracked since</th><th>Last changed</th><th>Last check</th></tr></thead><tbody>${rows.map(({ p, pg }) =>
    `<tr><th class="mx__row">${esc(p.name)}</th><td>${PAGE_LABEL[pg.type] ?? pg.type}</td><td><a href="${esc(pg.url)}" target="_blank" rel="noopener">${esc(pg.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></td><td>${pg.versions}</td><td>${pg.firstSeen ? fmtDate(pg.firstSeen) : '—'}</td><td>${pg.lastChanged ? fmtDate(pg.lastChanged) : '—'}</td><td class="${pg.status?.ok === false ? 'err' : 'ok'}" title="${esc(pg.status?.error ?? '')}">${pg.status?.ok === false ? 'Failed' : pg.lastChecked ? fmtDate(pg.lastChecked) : '—'}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------- tabs + scan ---------- */
function showTab(name) {
  document.querySelectorAll('.nav__link').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.id === `tab-${name}`));
  store.set('tab', name);
}
document.querySelectorAll('.nav__link').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab(store.get('tab') ?? 'changes');

$('#scan-btn').addEventListener('click', async () => {
  const btn = $('#scan-btn');
  if (PAGES) { window.open(`${data.repoUrl}/actions/workflows/watch.yml`, '_blank', 'noopener'); return; }
  let res;
  try { res = await fetch('/api/scan', { method: 'POST' }); } catch { res = null; }
  if (!res?.ok) { alert('Scanning needs the local server: run `npm run serve`.'); return; }
  btn.disabled = true; btn.textContent = 'Scanning…';
  const poll = setInterval(async () => {
    const s = await fetch('/api/scan').then((r) => r.json());
    if (s.running) return;
    clearInterval(poll);
    btn.disabled = false; btn.textContent = 'Scan now';
    await load();
  }, 2000);
});

load().then(() => { connectLive(); store.set('last-visit', new Date().toISOString()); });
