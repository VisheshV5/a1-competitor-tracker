// Renders one stored snapshot as a readable page: the exact text a change was computed from.
import { listSnapshots, toStamp } from './store.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function findSnapshot(cid, pid, stamp) {
  return listSnapshots(cid, pid).find((s) => toStamp(s.capturedAt) === stamp) ?? null;
}

export function snapshotPage(snap, competitorName) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(competitorName)} · ${esc(snap.capturedAt.slice(0, 10))}</title>
<style>body{margin:0;background:#f8f7f3;color:#1c1c1e;font:15px/24px -apple-system,system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:40px 16px}
.k{font:12px/16px ui-monospace,Menlo,monospace;letter-spacing:.076em;text-transform:uppercase;color:#7c7a73}h1{font-weight:500;letter-spacing:-.02em;margin:8px 0}
.card{background:#fff;border-radius:22px;padding:24px;margin-top:24px}p{margin:0 0 10px;overflow-wrap:anywhere}a{color:#468bf1}</style>
<main><p class="k">${esc(competitorName)} · stored snapshot · ${esc(new Date(snap.capturedAt).toUTCString())}</p><h1>${esc(snap.title)}</h1>
<p><a href="${esc(snap.url)}" target="_blank" rel="noopener">Live page ↗</a>${snap.source === 'wayback' ? ` · <a href="https://web.archive.org/web/${esc(toStamp(snap.capturedAt))}/${esc(snap.url)}" target="_blank" rel="noopener">How it looked (Internet Archive) ↗</a>` : ''}</p>${snap.description ? `<p>${esc(snap.description)}</p>` : ''}
<div class="card">${snap.blocks.map((b) => `<p>${esc(b)}</p>`).join('')}</div></main>`;
}
