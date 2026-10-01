// Archive links shown on each change card. Shared by the dashboard and the link checker so
// what gets tested is exactly what gets rendered.
const stamp = (iso) => iso.replace(/[-:T]/g, '').slice(0, 14);

// Only link to the Internet Archive for versions that came from it; versions we captured
// ourselves are not in the archive under that timestamp, so they open from our local store.
export function archiveLinks(e) {
  const out = [];
  if (e.prevSource === 'wayback') out.push({ kind: 'before', ts: stamp(e.prevAt), href: `https://web.archive.org/web/${stamp(e.prevAt)}/${e.url}` });
  if (e.source === 'wayback') out.push({ kind: 'after', ts: stamp(e.at), href: `https://web.archive.org/web/${stamp(e.at)}/${e.url}` });
  return out;
}

// Served by tracker/serve.mjs locally, or pre-rendered as .html files on GitHub Pages.
export const localSnapshotHref = (e, which, isStatic = false) =>
  `${isStatic ? '' : '/'}snapshot/${e.competitor}/${e.pageId}/${stamp(which === 'before' ? e.prevAt : e.at)}${isStatic ? '.html' : ''}`;
