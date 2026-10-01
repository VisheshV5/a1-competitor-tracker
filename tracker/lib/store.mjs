// Snapshot storage: data/snapshots/<competitor>/<page>/<YYYYMMDDhhmmss>.json
// Only content-changing snapshots are written; when a page was last checked lives in data/status.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = path.join(ROOT, 'data');
const SNAP = path.join(DATA, 'snapshots');

export const loadConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'competitors.json'), 'utf8'));

// Competitors plus a1mobile itself, so the matrix can compare against our own site.
export const allTargets = (cfg) => [{ ...cfg.self, group: 'self', isSelf: true }, ...cfg.competitors];

export const toStamp = (d) => new Date(d).toISOString().replace(/[-:T]/g, '').slice(0, 14);
export const fromStamp = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`).toISOString();

const pageDir = (cid, pid) => path.join(SNAP, cid, pid);

export function listSnapshots(cid, pid) {
  const dir = pageDir(cid, pid);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{14}\.json$/.test(f)).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function hasSnapshot(cid, pid, stamp) {
  return fs.existsSync(path.join(pageDir(cid, pid), `${stamp}.json`));
}

// Writes the snapshot unless the most recent earlier snapshot has identical content.
export function saveSnapshot(cid, pid, snap) {
  const stamp = toStamp(snap.capturedAt);
  const dir = pageDir(cid, pid);
  fs.mkdirSync(dir, { recursive: true });
  const prior = listSnapshots(cid, pid).filter((s) => toStamp(s.capturedAt) < stamp).at(-1);
  if (prior && prior.hash === snap.hash) return false;
  fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(snap));
  return true;
}

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1));
}
