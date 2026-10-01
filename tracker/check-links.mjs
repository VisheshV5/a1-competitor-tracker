// Verifies every Internet Archive link the dashboard renders resolves to the exact capture.
//   node tracker/check-links.mjs
import path from 'node:path';
import { readJSON, writeJSON, ROOT, DATA } from './lib/store.mjs';
import { pool } from './lib/fetch.mjs';
import { archiveLinks } from '../public/links.js';

const data = readJSON(path.join(ROOT, 'public', 'data.json'));
const links = new Map();
for (const e of data.events) for (const l of archiveLinks(e)) links.set(l.href, { ...l, event: e });

console.log(`Checking ${links.size} unique archive links…`);
const results = await pool([...links.values()], 1, async (l) => {
  await new Promise((r) => setTimeout(r, 1500)); // stay under the archive's rate limit
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(l.href, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      res.body?.cancel();
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const finalTs = res.url.match(/\/web\/(\d{14})/)?.[1];
      const exact = finalTs === l.ts;
      return { href: l.href, status: res.status, finalUrl: res.url, exact, ok: res.status === 200 };
    } catch (e) {
      if (attempt === 3) return { href: l.href, status: 0, error: String(e.message), ok: false };
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
});

const bad = results.filter((r) => !r.ok);
const drift = results.filter((r) => r.ok && !r.exact);
writeJSON(path.join(DATA, 'link-check.json'), { checkedAt: new Date().toISOString(), total: results.length, bad, drift });
console.log(`${results.length - bad.length}/${results.length} load (HTTP 200). ${drift.length} redirected to a different capture than linked. ${bad.length} failed.`);
for (const r of bad.slice(0, 20)) console.log('  ✕', r.status, r.error ?? '', r.href);
for (const r of drift.slice(0, 20)) console.log('  ~', r.href, '→', r.finalUrl);
