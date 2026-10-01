// Dashboard server + live watcher.
//   node tracker/serve.mjs [port=4321]
//
// Every tracked page is re-checked on a rolling schedule (WATCH_INTERVAL seconds, default 120).
// When a page changes, the snapshot is stored, change events are recomputed, and every open
// dashboard receives them instantly over Server-Sent Events. Optional alerts:
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/...   post high-signal changes to Slack
//   NOTIFY=1                                        macOS desktop notification
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA, loadConfig, allTargets, readJSON, writeJSON } from './lib/store.mjs';
import { checkPage } from './lib/check.mjs';
import { build } from './build.mjs';
import { alert } from './lib/alert.mjs';
import { findSnapshot, snapshotPage } from './lib/snapshot-page.mjs';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4321);
const INTERVAL = Number(process.env.WATCH_INTERVAL ?? 120) * 1000;
const CONFIRM_MS = 20000;
process.env.TRACKER_CHECK_EVERY_MIN ??= String(INTERVAL / 60000);
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const STATUS_FILE = path.join(DATA, 'status.json');

/* ---------- live clients (Server-Sent Events) ---------- */
const clients = new Set();
const broadcast = (type, payload) => {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
};
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

/* ---------- watcher ---------- */
const status = readJSON(STATUS_FILE, {});
const watch = { interval: INTERVAL / 1000, pages: 0, startedAt: new Date().toISOString(), lastCycleAt: null, checks: 0 };
let knownIds = new Set(build().list.map((e) => e.id));
let rebuildQueued = null;

function rebuild(reason) {
  const { list } = build();
  const fresh = list.filter((e) => !knownIds.has(e.id));
  knownIds = new Set(list.map((e) => e.id));
  if (fresh.length) {
    console.log(`▲ ${fresh.length} new change event(s) — ${reason}`);
    broadcast('changes', { ids: fresh.map((e) => e.id), reason });
    alert(fresh);
  } else {
    broadcast('refresh', { reason });
  }
}

// Coalesce several page changes landing together into one rebuild.
const queueRebuild = (reason) => { clearTimeout(rebuildQueued); rebuildQueued = setTimeout(() => rebuild(reason), 1500); };

async function checkOne(c, p) {
  const key = `${c.id}/${p.id}`;
  const now = new Date().toISOString();
  try {
    const r = await checkPage(c, p, { confirmMs: CONFIRM_MS });
    status[key] = { ok: true, checkedAt: now, blocks: r.blocks, changed: r.changed, flapping: r.flapping || undefined };
    if (r.changed) { console.log(`● ${key} changed`); queueRebuild(`${c.name} ${p.type} page changed`); }
  } catch (e) {
    status[key] = { ...status[key], ok: false, checkedAt: now, error: String(e.message ?? e) };
  }
  watch.checks++;
  writeJSON(STATUS_FILE, status);
  broadcast('checked', { key, at: now, ok: status[key].ok });
}

// Each page gets its own loop, staggered across the interval so requests are spread out
// (46 pages at 120s ≈ one request every 2.6s overall; each site sees one every couple of minutes).
function startWatcher() {
  const jobs = allTargets(loadConfig()).flatMap((c) => c.pages.map((p) => ({ c, p })));
  watch.pages = jobs.length;
  jobs.forEach(({ c, p }, i) => {
    const loop = async () => {
      await checkOne(c, p);
      setTimeout(loop, INTERVAL * (0.9 + Math.random() * 0.2));
    };
    setTimeout(loop, (INTERVAL / jobs.length) * i);
  });
  console.log(`Watching ${jobs.length} pages, each re-checked every ~${INTERVAL / 1000}s.`);
}

const competitorName = Object.fromEntries(allTargets(loadConfig()).map((c) => [c.id, c.name]));

/* ---------- manual full scan ---------- */
let scan = { running: false };
async function runScan() {
  scan = { running: true, startedAt: new Date().toISOString() };
  const jobs = allTargets(loadConfig()).flatMap((c) => c.pages.map((p) => ({ c, p })));
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) { const j = jobs[i++]; await checkOne(j.c, j.p); } }));
  clearTimeout(rebuildQueued);
  rebuild('manual scan');
  scan = { running: false, finishedAt: new Date().toISOString() };
}

/* ---------- http ---------- */
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: hello\ndata: ${JSON.stringify(watch)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/scan') {
    if (req.method === 'POST' && !scan.running) runScan();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(scan));
  }
  const snap = url.pathname.match(/^\/snapshot\/([\w-]+)\/([\w-]+)\/(\d{14})$/);
  if (snap) {
    const found = findSnapshot(...snap.slice(1));
    const html = found && snapshotPage(found, competitorName[snap[1]] ?? snap[1]);
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html ?? 'Snapshot not found');
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Competitor tracker → http://localhost:${PORT}`);
  if (process.env.WATCH !== '0') startWatcher();
});
