// Derives the dashboard dataset from stored snapshots. Changes are always recomputed from
// the snapshot history, so improving the diff rules re-scores the whole timeline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, allTargets, listSnapshots, readJSON, writeJSON, DATA, ROOT } from './lib/store.mjs';
import { diffSnapshots } from './lib/diff.mjs';
import { CAPABILITIES } from './lib/vocab.mjs';
import { extractFacts } from './lib/extract.mjs';

const CAP_NAMES = new Set(Object.keys(CAPABILITIES));

export function build() {
  const cfg = loadConfig();
  const status = readJSON(path.join(DATA, 'status.json'), {});
  const selfCaps = new Set(cfg.self.capabilities);
  const events = [];
  const profiles = [];

  for (const c of allTargets(cfg)) {
    const facts = { prices: new Set(), integrations: new Set(), industries: new Set(), capabilities: new Set(), languages: new Set() };
    const pages = [];
    for (const p of c.pages) {
      // Facts are re-derived from stored text so vocabulary edits re-score all history.
      const snaps = listSnapshots(c.id, p.id).map((s) => ({ ...s, facts: extractFacts([s.title, s.description, ...s.blocks].join('\n'), p.url) }));
      const latest = snaps.at(-1);
      pages.push({ ...p, versions: snaps.length, firstSeen: snaps[0]?.capturedAt, lastChanged: latest?.capturedAt,
        lastChecked: status[`${c.id}/${p.id}`]?.checkedAt ?? latest?.lastChecked ?? latest?.capturedAt, status: status[`${c.id}/${p.id}`] ?? null });
      if (latest) for (const k of Object.keys(facts)) latest.facts[k].forEach((v) => facts[k].add(v));
      if (latest && p.type === 'homepage') Object.assign(c, { headline: latest.h1?.[0] ?? '', title: latest.title, description: latest.description });
      if (c.isSelf) continue;
      for (let i = 1; i < snaps.length; i++) {
        if (snaps[i].hash === snaps[i - 1].hash) continue;
        for (const e of diffSnapshots(snaps[i - 1], snaps[i], p)) {
          e.competitor = c.id;
          e.id = crypto.createHash('sha1').update(`${c.id}|${p.id}|${e.at}|${e.title}`).digest('hex').slice(0, 10);
          e.a1 = relevance(e, selfCaps);
          events.push(e);
        }
      }
    }
    const asArr = Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, [...v].sort()]));
    const monthly = asArr.prices.filter((x) => x.endsWith('/mo')).map((x) => parseFloat(x.slice(1))).filter((n) => n >= 10);
    profiles.push({
      id: c.id, name: c.name, group: c.group, url: c.url, focus: c.focus ?? '', isSelf: !!c.isSelf,
      headline: c.headline ?? '', title: c.title ?? '', description: c.description ?? '',
      startingPrice: c.startingPrice ?? (monthly.length ? `$${Math.min(...monthly)}/mo` : null),
      facts: asArr, pages,
      gaps: c.isSelf ? [] : asArr.capabilities.filter((x) => !selfCaps.has(x)),
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at) || rank(a) - rank(b));
  const out = { generatedAt: new Date().toISOString(), hosting: process.env.TRACKER_HOSTING ?? 'local', checkEveryMin: Number(process.env.TRACKER_CHECK_EVERY_MIN ?? 2),
    repoUrl: process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}` : null, groups: cfg.groups, selfCapabilities: [...selfCaps], profiles, events };
  writeJSON(path.join(ROOT, 'public', 'data.json'), out);
  writeStandalone(out);
  return { events: events.length, list: events };
}

// One self-contained file (styles, script and data inlined) that opens straight from Finder.
function writeStandalone(out) {
  const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const json = JSON.stringify(out).replace(/</g, '\\u003c');
  const html = pub('index.html')
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${pub('styles.css')}</style>`)
    .replace('<script src="app.js" type="module"></script>', () => `<script>window.__DATA__ = ${json};</script>\n<script type="module">${
      pub('app.js').replace(/^import .* from '\.\/links\.js';$/m, pub('links.js').replace(/^export /gm, ''))}</script>`);
  fs.writeFileSync(path.join(ROOT, 'dashboard.html'), html);
}

const rank = (e) => ({ high: 0, medium: 1, low: 2 })[e.significance];

// Why a change matters to a1mobile, if it does.
function relevance(e, selfCaps) {
  const notes = [];
  const gaps = (e.added ?? []).filter((x) => CAP_NAMES.has(x) && !selfCaps.has(x));
  if (gaps.length) notes.push(`A1 gap: ${gaps.join(', ')}`);
  if (e.category === 'Pricing') {
    const cheap = (e.added ?? []).filter((x) => x.endsWith('/mo') && parseFloat(x.slice(1)) < 99);
    if (cheap.length) notes.push(`Undercuts $99: ${cheap.join(', ')}`);
  }
  if (e.category === 'Industry' && (e.added ?? []).some((x) => ['Restaurants', 'Cafes', 'Salons', 'Hotels', 'Fitness', 'Home services'].includes(x)))
    notes.push('Moving into an A1 vertical');
  if (e.category === 'Positioning' && /carrier|phone (line|system|number)|one bill|ai-native/i.test(`${e.after ?? ''}`))
    notes.push('Positioning overlaps A1 (“AI-native line”)');
  return notes;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { events } = build();
  console.log(`Built public/data.json with ${events} change events.`);
}
