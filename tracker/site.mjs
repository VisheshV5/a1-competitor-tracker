// Builds the static site published to GitHub Pages: the dashboard, its data, and a readable
// page for every stored version a change card links to.
//   node tracker/site.mjs [outDir=_site]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, toStamp } from './lib/store.mjs';
import { findSnapshot, snapshotPage } from './lib/snapshot-page.mjs';

const OUT = path.resolve(ROOT, process.argv[2] ?? '_site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of ['index.html', 'styles.css', 'app.js', 'links.js', 'data.json'])
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const data = readJSON(path.join(OUT, 'data.json'));
const names = Object.fromEntries(data.profiles.map((p) => [p.id, p.name]));
const wanted = new Set();
for (const e of data.events) {
  wanted.add(`${e.competitor}/${e.pageId}/${toStamp(e.prevAt)}`);
  wanted.add(`${e.competitor}/${e.pageId}/${toStamp(e.at)}`);
}
let n = 0;
for (const key of wanted) {
  const [cid, pid, stamp] = key.split('/');
  const snap = findSnapshot(cid, pid, stamp);
  if (!snap) continue;
  const file = path.join(OUT, 'snapshot', cid, pid, `${stamp}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, snapshotPage(snap, names[cid] ?? cid));
  n++;
}
console.log(`Site built in ${path.relative(ROOT, OUT)}/ with ${n} snapshot pages.`);
