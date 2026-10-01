// Where a change card's "See the change" link points. Shared by the dashboard and the site
// builder so the pages that get published are exactly the ones that get linked.
export const stamp = (iso) => iso.replace(/[-:T]/g, '').slice(0, 14);

// One page per page-version pair: served by tracker/serve.mjs locally, pre-rendered on GitHub Pages.
export const changeHref = (e, isStatic = false) =>
  `${isStatic ? '' : '/'}change/${e.competitor}/${e.pageId}/${stamp(e.at)}${isStatic ? '.html' : ''}`;
