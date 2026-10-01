// Builds the static site published to GitHub Pages: the dashboard, its data, and a readable
// page for every stored version a change card links to.
//   node tracker/site.mjs [outDir=_site]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './lib/store.mjs';
import { findSnapshot, snapshotPage } from './lib/snapshot-page.mjs';
import { localSnapshotHref } from '../public/links.js';

const OUT = path.resolve(ROOT, process.argv[2] ?? '_site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of ['index.html', 'styles.css', 'app.js', 'links.js', 'data.json'])
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const data = readJSON(path.join(OUT, 'data.json'));
const names = Object.fromEntries(data.profiles.map((p) => [p.id, p.name]));
// Every Before/After link on the dashboard must have a page. If any is missing, fail the build
// so the previous (working) site stays live instead of publishing broken links.
const wanted = new Set(data.events.flatMap((e) => ['before', 'after'].map((w) => localSnapshotHref(e, w, true))));
const missing = [];
for (const href of wanted) {
  const [, cid, pid, file] = href.split('/');
  const snap = findSnapshot(cid, pid, file.replace('.html', ''));
  if (!snap) { missing.push(href); continue; }
  fs.mkdirSync(path.join(OUT, 'snapshot', cid, pid), { recursive: true });
  fs.writeFileSync(path.join(OUT, href), snapshotPage(snap, names[cid] ?? cid));
}
fs.writeFileSync(path.join(OUT, 'links.txt'), [...wanted].join('\n') + '\n');
if (missing.length) {
  console.error(`✕ ${missing.length} Before/After link(s) have no stored version:\n  ${missing.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
console.log(`Site built in ${path.relative(ROOT, OUT)}/ — all ${wanted.size} Before/After links have pages.`);
