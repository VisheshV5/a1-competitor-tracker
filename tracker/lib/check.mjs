// Checks one tracked page and stores a new snapshot when its content really changed.
import { get } from './fetch.mjs';
import { extract } from './extract.mjs';
import { saveSnapshot, listSnapshots } from './store.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latestHash = new Map();

async function fetchSnapshot(p) {
  const res = await get(p.url, { retries: 1 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const snap = extract(res.body, p.url);
  if (snap.blocks.length < 5) throw new Error(`only ${snap.blocks.length} text blocks — page may be JS-rendered or blocked`);
  return snap;
}

// `confirmMs` re-fetches before committing a change, so rotating testimonials and A/B tests
// that flip on every request don't show up as competitor changes.
export async function checkPage(c, p, { confirmMs = 0 } = {}) {
  const key = `${c.id}/${p.id}`;
  if (!latestHash.has(key)) latestHash.set(key, listSnapshots(c.id, p.id).at(-1)?.hash);
  let snap = await fetchSnapshot(p);
  if (snap.hash === latestHash.get(key)) return { key, changed: false, blocks: snap.blocks.length };
  if (confirmMs && latestHash.get(key)) {
    await sleep(confirmMs);
    const again = await fetchSnapshot(p);
    if (again.hash !== snap.hash) return { key, changed: false, flapping: true, blocks: snap.blocks.length };
    snap = again;
  }
  const changed = saveSnapshot(c.id, p.id, { ...snap, capturedAt: new Date().toISOString(), source: 'live' });
  latestHash.set(key, snap.hash);
  return { key, changed, blocks: snap.blocks.length };
}
