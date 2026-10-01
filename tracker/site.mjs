// Builds the static site published to GitHub Pages: the dashboard, its data, and one
// "what changed" page for every change a card links to.
//   node tracker/site.mjs [outDir=_site]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './lib/store.mjs';
import { findSnapshot, changePage } from './lib/change-page.mjs';
import { changeHref, stamp } from '../public/links.js';

const OUT = path.resolve(ROOT, process.argv[2] ?? '_site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of ['index.html', 'styles.css', 'app.js', 'links.js', 'data.json', 'hero.webp'])
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const data = readJSON(path.join(OUT, 'data.json'));
const names = Object.fromEntries(data.profiles.map((p) => [p.id, p.name]));

// Every card links to one of these. If a version is missing, fail the build so the previous
// (working) site stays live instead of publishing a broken link.
const groups = new Map();
for (const e of data.events) {
  const href = changeHref(e, true);
  if (!groups.has(href)) groups.set(href, []);
  groups.get(href).push(e);
}
const missing = [];
for (const [href, events] of groups) {
  const e = events[0];
  const prev = findSnapshot(e.competitor, e.pageId, stamp(e.prevAt));
  const next = findSnapshot(e.competitor, e.pageId, stamp(e.at));
  if (!prev || !next) { missing.push(href); continue; }
  fs.mkdirSync(path.dirname(path.join(OUT, href)), { recursive: true });
  fs.writeFileSync(path.join(OUT, href), changePage({ events, prev, next, competitor: names[e.competitor] ?? e.competitor, homeHref: '../../../' }));
}
fs.writeFileSync(path.join(OUT, 'links.txt'), [...groups.keys()].join('\n') + '\n');
if (missing.length) {
  console.error(`✕ ${missing.length} change page(s) are missing a stored version:\n  ${missing.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
console.log(`Site built in ${path.relative(ROOT, OUT)}/ with ${groups.size} change pages.`);
