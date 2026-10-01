// Where a change card's Before/After links point. Shared by the dashboard and the site
// builder so the pages that get published are exactly the ones that get linked.
export const stamp = (iso) => iso.replace(/[-:T]/g, '').slice(0, 14);

// Served by tracker/serve.mjs locally, or pre-rendered as .html files on GitHub Pages.
export const localSnapshotHref = (e, which, isStatic = false) =>
  `${isStatic ? '' : '/'}snapshot/${e.competitor}/${e.pageId}/${stamp(which === 'before' ? e.prevAt : e.at)}${isStatic ? '.html' : ''}`;
