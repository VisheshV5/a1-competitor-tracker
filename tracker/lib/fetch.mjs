// HTTP helpers: polite live fetching and Internet Archive (Wayback Machine) history.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DATA } from './store.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36 a1-competitor-tracker';
const CACHE = path.join(DATA, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(url, { timeout = 30000, retries = 2, cache = false } = {}) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.html');
  if (cache && fs.existsSync(file)) return { status: 200, url, body: fs.readFileSync(file, 'utf8') };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
      const body = decodeBody(Buffer.from(await res.arrayBuffer()));
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (cache && res.ok) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, body); }
      return { status: res.status, url: res.url, body };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1) ** 2);
    }
  }
  throw lastErr;
}

// The Wayback Machine replays some captures with their original zstd/gzip bytes undecoded.
function decodeBody(buf) {
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf).toString('utf8');
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

// Distinct archived versions of a URL since `from` (YYYYMMDD), at most one per month,
// preferring the last capture of each month.
export async function waybackVersions(url, from) {
  const api = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,digest&filter=statuscode:200&from=${from}&collapse=digest`;
  const { body } = await get(api, { timeout: 60000 });
  let rows;
  try { rows = JSON.parse(body).slice(1); } catch { return []; }
  const byMonth = new Map();
  for (const [ts, digest] of rows) byMonth.set(ts.slice(0, 6), { ts, digest });
  return [...byMonth.values()];
}

// `id_` returns the original bytes without the Wayback toolbar or rewritten links.
export const waybackRaw = (url, ts) => `https://web.archive.org/web/${ts}id_/${url}`;

export async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}
