// One-off live scan: check every tracked page now, store new versions, then rebuild.
//   node tracker/scan.mjs            all competitors
//   node tracker/scan.mjs hostie     one competitor
// For continuous monitoring use `npm run serve` (local) or the GitHub Actions workflow,
// which runs this every few minutes.
import path from 'node:path';
import { loadConfig, allTargets, writeJSON, readJSON, DATA, ROOT } from './lib/store.mjs';
import { pool } from './lib/fetch.mjs';
import { checkPage } from './lib/check.mjs';
import { build } from './build.mjs';
import { alert } from './lib/alert.mjs';

const only = process.argv[2];
const jobs = allTargets(loadConfig())
  .filter((c) => !only || c.id === only)
  .flatMap((c) => c.pages.map((p) => ({ c, p })));

const status = readJSON(path.join(DATA, 'status.json'), {});
const knownIds = new Set((readJSON(path.join(ROOT, 'public', 'data.json'), { events: [] }).events).map((e) => e.id));
let changed = 0;

await pool(jobs, 4, async ({ c, p }) => {
  const key = `${c.id}/${p.id}`;
  const now = new Date().toISOString();
  try {
    const r = await checkPage(c, p, { confirmMs: 20000 });
    if (r.changed) changed++;
    status[key] = { ok: true, checkedAt: now, blocks: r.blocks, changed: r.changed };
    console.log(`${r.changed ? '●' : '·'} ${key.padEnd(26)} ${r.blocks} blocks${r.changed ? '  (new version)' : ''}`);
  } catch (e) {
    status[key] = { ...status[key], ok: false, checkedAt: now, error: String(e.message ?? e) };
    console.log(`✕ ${key.padEnd(26)} ${e.message}`);
  }
});

writeJSON(path.join(DATA, 'status.json'), status);
const { events, list } = build();
const fresh = list.filter((e) => !knownIds.has(e.id));
// Dozens of "new" events at once means the diff rules changed and history was re-scored,
// not that competitors all moved in the last few minutes, so don't alert on it.
if (fresh.length && fresh.length <= 25) await alert(fresh);
console.log(`\n${jobs.length} pages checked, ${changed} new versions, ${fresh.length} new change events (${events} total).`);
