// Backfill history from the Internet Archive so the timeline starts with real past changes.
//   node tracker/backfill.mjs [months=12] [competitorId]
import { loadConfig, allTargets, saveSnapshot, hasSnapshot, toStamp, fromStamp } from './lib/store.mjs';
import { get, pool, waybackVersions, waybackRaw } from './lib/fetch.mjs';
import { extract } from './lib/extract.mjs';
import { build } from './build.mjs';

const isGarbled = (s) => (s.blocks.join('').match(/\uFFFD/g)?.length ?? 0) > 20;

const months = Number(process.argv[2] ?? 12);
const only = process.argv[3];
const from = toStamp(new Date(Date.now() - months * 30.4 * 864e5)).slice(0, 8);
const cfg = loadConfig();
const pages = allTargets(cfg).filter((c) => !c.isSelf && (!only || c.id === only))
  .flatMap((c) => c.pages.map((p) => ({ c, p })));

console.log(`Backfilling ${pages.length} pages from ${from}…`);
let saved = 0;

// One page at a time against the archive, two in flight — it rate-limits aggressively.
await pool(pages, 2, async ({ c, p }) => {
  const key = `${c.id}/${p.id}`;
  let versions;
  try { versions = await waybackVersions(p.url, from); } catch (e) { console.log(`✕ ${key} CDX: ${e.message}`); return; }
  let n = 0;
  for (const { ts } of versions) {
    if (hasSnapshot(c.id, p.id, ts)) continue;
    try {
      const res = await get(waybackRaw(p.url, ts), { cache: true, timeout: 60000 });
      if (res.status >= 400) continue;
      const snap = { ...extract(res.body, p.url), capturedAt: fromStamp(ts), source: 'wayback' };
      if (snap.blocks.length < 5 || isGarbled(snap)) continue;
      if (saveSnapshot(c.id, p.id, snap)) { n++; saved++; }
    } catch (e) { console.log(`  ${key} @${ts}: ${e.message}`); }
  }
  console.log(`${n ? '●' : '·'} ${key.padEnd(26)} ${versions.length} archived months, ${n} distinct versions saved`);
});

const { events } = build();
console.log(`\nSaved ${saved} historical snapshots. ${events} total change events.`);
