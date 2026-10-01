// Renders "what changed" for one page between two versions: a plain-English summary on top,
// then the small wording swaps, new sentences and removed sentences, skipping fragments.
import { listSnapshots, toStamp } from './store.mjs';
import { decode } from './extract.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const PAGE_NAME = { homepage: 'homepage', pricing: 'pricing page', product: 'product page', integrations: 'integrations page', docs: 'docs', changelog: 'changelog' };

export function findSnapshot(cid, pid, stamp) {
  return listSnapshots(cid, pid).find((s) => toStamp(s.capturedAt) === stamp) ?? null;
}

// Longest-common-subsequence diff over two arrays, compared with `key`.
function lcsDiff(a, b, key = (x) => x) {
  const n = a.length, m = b.length;
  const ka = a.map(key), kb = b.map(key);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { ops.push({ t: 'same', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: 'del', a: a[i++] });
    else ops.push({ t: 'add', b: b[j++] });
  }
  while (i < n) ops.push({ t: 'del', a: a[i++] });
  while (j < m) ops.push({ t: 'add', b: b[j++] });
  return ops;
}

const words = (s) => new Set(norm(s).split(/\W+/).filter(Boolean));
const similarity = (x, y) => {
  const a = words(x), b = words(y);
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(1, Math.min(a.size, b.size));
};

// Inline word diff for a small edit. Neighbouring changed words (and the spaces between them)
// merge into one highlight, so "Native integrations" → "Custom integrations" reads as one swap.
function wordDiff(before, after) {
  const tok = (x) => x.split(/(\s+)/).filter((t) => t !== '');
  const ops = lcsDiff(tok(before), tok(after), (t) => t.toLowerCase());
  const runs = [];
  for (const o of ops) {
    const text = o.t === 'del' ? o.a : o.b;
    const t = /^\s+$/.test(text) && runs.at(-1)?.t !== 'same' ? runs.at(-1).t : o.t;
    if (runs.at(-1)?.t === t) runs.at(-1).text += text;
    else runs.push({ t, text });
  }
  return runs.map((r) => {
    const lead = r.text.match(/^\s*/)[0], trail = r.text.match(/\s*$/)[0], core = r.text.trim();
    if (r.t === 'same' || !core) return esc(r.text);
    return `${lead}<${r.t === 'del' ? 'del' : 'ins'}>${esc(core)}</${r.t === 'del' ? 'del' : 'ins'}>${trail}`;
  }).join('');
}

// A real wording swap changes a few words and keeps the rest; anything bigger is a rewrite.
function isSmallEdit(before, after) {
  const tok = (x) => x.split(/\s+/).filter(Boolean);
  const changed = lcsDiff(tok(before), tok(after), (t) => t.toLowerCase()).filter((o) => o.t !== 'same').length;
  return changed <= 4 && changed <= tok(after).length / 2 && tok(after).length >= 2;
}

const wordCount = (x) => x.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Full sentences and headings only; menu labels, table cells and lone prices are noise here.
const meaningful = (x) => wordCount(x) >= 4;

// Groups the page diff into what a reader cares about: small wording swaps, new text, removed text.
function sections(prev, next) {
  const ops = lcsDiff(prev, next, norm);
  const edits = [], added = [], removed = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k].t === 'same') { k++; continue; }
    const dels = [], adds = [];
    while (k < ops.length && ops[k].t !== 'same') (ops[k].t === 'del' ? dels : adds).push(ops[k++]);
    const used = new Set();
    for (const d of dels) {
      // Only call it an edit when most of the line survived; otherwise it's new text plus old text.
      let best = -1, score = 0.6;
      adds.forEach((x, n) => { if (!used.has(n)) { const sc = similarity(d.a, x.b); if (sc >= score) { score = sc; best = n; } } });
      if (best >= 0 && isSmallEdit(d.a, adds[best].b)) {
        used.add(best); edits.push({ before: d.a, after: adds[best].b });
      } else removed.push(d.a);
    }
    adds.forEach((x, n) => { if (!used.has(n)) added.push(x.b); });
  }
  const keepAdded = added.filter(meaningful), keepRemoved = removed.filter(meaningful);
  return { edits, added: keepAdded, removed: keepRemoved, hidden: added.length - keepAdded.length + removed.length - keepRemoved.length };
}

// Shows the first few items; the rest sit behind a "show more" toggle.
function list(items, render, cls, first = 6) {
  const li = (x) => `<li class="${cls}">${render(x)}</li>`;
  const head = items.slice(0, first).map(li).join('');
  const rest = items.slice(first);
  return `<ul class="lines">${head}</ul>${rest.length ? `<details class="more"><summary>Show ${rest.length} more</summary><ul class="lines">${rest.map(li).join('')}</ul></details>` : ''}`;
}

const isChip = (x) => typeof x === 'string' && x.length <= 40;

function summaryItem(e) {
  let body = '';
  if (e.before !== undefined) {
    body = `<div class="ba"><div class="ba__col"><span class="ba__label">Before</span><p>${esc(e.before) || '<em>empty</em>'}</p></div>
      <div class="ba__arrow" aria-hidden="true">→</div>
      <div class="ba__col ba__col--after"><span class="ba__label">After</span><p>${esc(e.after)}</p></div></div>`;
  } else if ([...(e.added ?? []), ...(e.removed ?? [])].every(isChip) && (e.added?.length || e.removed?.length)) {
    body = `<div class="chips">${(e.added ?? []).map((x) => `<span class="chip chip--add">+ ${esc(x)}</span>`).join('')}${(e.removed ?? []).map((x) => `<span class="chip chip--del">− ${esc(x)}</span>`).join('')}</div>`;
  }
  return `<li class="item item--${e.significance}">
    <div class="item__head"><span class="cat">${esc(e.category)}</span><h3>${esc(e.title)}</h3></div>
    ${(e.a1 ?? []).length ? `<div class="why">${e.a1.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
    ${body}</li>`;
}

// `events` are every change detected between the same two versions of one page.
export function changePage({ events, prev, next, competitor, homeHref }) {
  const e0 = events[0];
  // Older snapshots kept a few HTML entities (&times;) as text; show them as characters and
  // drop lines that are only a symbol, like a close button.
  const readable = (blocks) => blocks.map(decode).filter((b) => /[\p{L}\p{N}]/u.test(b));
  const { edits, added, removed, hidden } = sections(readable(prev.blocks), readable(next.blocks));
  const where = PAGE_NAME[e0.pageType] ?? 'page';
  const stat = (n, label, cls) => (n ? `<span class="stat ${cls}"><b>${n}</b> ${label}</span>` : '');
  const ordered = [...events].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.significance] - ({ high: 0, medium: 1, low: 2 })[b.significance]);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(competitor)} ${esc(where)} · what changed</title>
<style>
:root{--ink:#1c1c1e;--muted:#6e6d73;--ground:#f8f7f3;--surface:#fff;--hairline:#e7e6e1;--accent:#468bf1;--add:#e6f4ea;--add-ink:#16672e;--del:#fbe9e7;--del-ink:#a1271b;--font:"KMR Apparat",-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;--body:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:15px/24px var(--body);-webkit-font-smoothing:antialiased}
main{max-width:860px;margin:0 auto;padding:28px 16px 80px}
a{color:inherit}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;margin-bottom:28px}
.top a{text-decoration:none;color:var(--muted)}.top a:hover{color:var(--ink)}
.who{display:flex;align-items:center;gap:12px;margin-bottom:10px}.avatar{width:40px;height:40px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700}
.who__name{font-weight:700}.who__meta{color:var(--muted);font-size:14px}
h1{font-family:var(--font);font-weight:500;font-size:clamp(28px,4vw,40px);line-height:1.1;letter-spacing:-.025em;margin:6px 0 10px}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 28px}.stat{font-size:13px;border-radius:999px;padding:4px 12px;background:var(--surface);border:1px solid var(--hairline)}
.stat--add{background:var(--add);color:var(--add-ink);border-color:transparent}.stat--del{background:var(--del);color:var(--del-ink);border-color:transparent}.stat--mod{background:#eaf1fe;color:#2f5fb3;border-color:transparent}
.card{background:var(--surface);border-radius:22px;padding:8px 24px;margin-bottom:16px}
.card h2{font-family:var(--font);font-weight:500;font-size:20px;letter-spacing:-.015em;margin:18px 0 6px}
.items{list-style:none;margin:0;padding:0}.item{padding:16px 0;border-top:1px solid var(--hairline)}.item:first-child{border-top:0}
.item__head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.item h3{font-family:var(--font);font-weight:500;font-size:17px;line-height:24px;margin:0;letter-spacing:-.01em}
.cat{font:11px/18px var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);background:var(--ground);border-radius:999px;padding:0 8px}
.item--low h3{color:var(--muted);font-size:15px}
.why{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.why span{font-size:13px;font-weight:500;color:#2f6fd0;background:#468bf114;border-radius:999px;padding:2px 10px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chip{font-size:13px;border-radius:999px;padding:3px 10px;font-weight:500}
.chip--add{background:var(--add);color:var(--add-ink)}.chip--del{background:var(--del);color:var(--del-ink);text-decoration:line-through}
.ba{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch;margin-top:12px}
.ba__col{background:var(--del);border-radius:14px;padding:12px 14px}.ba__col--after{background:var(--add)}
.ba__col p{margin:4px 0 0;font-family:var(--font);font-size:16px;line-height:22px}.ba__label{font:11px/16px var(--mono);letter-spacing:.07em;text-transform:uppercase;opacity:.7}
.ba__arrow{align-self:center;color:var(--muted);font-size:18px}
@media(max-width:600px){.ba{grid-template-columns:1fr}.ba__arrow{transform:rotate(90deg);justify-self:center}}
.lines{list-style:none;margin:6px 0 16px;padding:0}.lines li{padding:10px 14px;margin:6px 0;border-radius:12px;line-height:23px;overflow-wrap:anywhere}
.edit{background:var(--ground)}.new{background:var(--add);color:#123d22;border-left:3px solid #2e9d52}.gone{background:var(--del);color:#5c1f19;border-left:3px solid #d0533f}
del{background:var(--del);color:var(--del-ink);text-decoration:line-through;border-radius:4px;padding:1px 3px}ins{background:var(--add);color:var(--add-ink);text-decoration:none;border-radius:4px;padding:1px 3px;font-weight:600}
.more summary{cursor:pointer;color:var(--muted);font-size:14px;padding:4px 0 14px}.more summary:hover{color:var(--ink)}
.note{color:var(--muted);font-size:14px;text-align:center;margin:8px 0 0}
</style></head><body><main>
<div class="top"><a href="${esc(homeHref)}">← All changes</a><a href="${esc(e0.url)}" target="_blank" rel="noopener">Open the live page ↗</a></div>
<div class="who"><span class="avatar">${esc(competitor.trim()[0] ?? '?')}</span><div><div class="who__name">${esc(competitor)}</div><div class="who__meta">${esc(where[0].toUpperCase() + where.slice(1))} · ${fmt(prev.capturedAt) === fmt(next.capturedAt) ? `changed on ${fmt(next.capturedAt)}` : `changed between ${fmt(prev.capturedAt)} and ${fmt(next.capturedAt)}`}</div></div></div>
<h1>What changed on ${esc(competitor)}'s ${esc(where)}</h1>
<div class="stats">${stat(edits.length, edits.length === 1 ? 'wording change' : 'wording changes', 'stat--mod')}${stat(added.length, 'new', 'stat--add')}${stat(removed.length, 'removed', 'stat--del')}</div>
<section class="card"><h2>In short</h2><ul class="items">${ordered.map(summaryItem).join('')}</ul></section>
${edits.length ? `<section class="card"><h2>Wording changes</h2>${list(edits, (x) => wordDiff(x.before, x.after), 'edit')}</section>` : ''}
${added.length ? `<section class="card"><h2>New on the page</h2>${list(added, esc, 'new')}</section>` : ''}
${removed.length ? `<section class="card"><h2>Removed from the page</h2>${list(removed, esc, 'gone')}</section>` : ''}
${!edits.length && !added.length && !removed.length ? '<p class="note">Only short labels or layout changed on this page.</p>' : hidden ? `<p class="note">${hidden} short fragments, like menu labels and table cells, aren't shown.</p>` : ''}
</main></body></html>`;
}
