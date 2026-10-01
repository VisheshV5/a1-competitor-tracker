// Compares two snapshots of the same page and emits typed, scored change events.

export const CATEGORIES = ['Pricing', 'Feature', 'Integration', 'Industry', 'Positioning', 'Docs', 'Messaging'];

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
// Blocks that differ only in volatile numbers ("12,481 calls answered") count as the same block.
const shape = (s) => norm(s).replace(/\d[\d,.]*/g, '#');

const setDiff = (a = [], b = []) => ({
  added: b.filter((x) => !a.includes(x)),
  removed: a.filter((x) => !b.includes(x)),
});

const list = (xs, n = 4) => xs.slice(0, n).join(', ') + (xs.length > n ? ` +${xs.length - n} more` : '');

// Which category a free-text block most likely belongs to.
const TOPIC = [
  ['Pricing', /\$\d|pric|per month|\/mo\b|plan|billing|annual|free trial|discount|per minute|overage/i],
  ['Integration', /integrat|connects? (?:with|to)|syncs? with|works with|plug(?:s)? into|pos\b/i],
  ['Feature', /\bnew\b|introduc|launch|now (?:you can|supports?|available)|beta|release|ship(?:ped)?|announc/i],
];
const topicOf = (blocks, fallback) => {
  const text = blocks.join(' ');
  return TOPIC.find(([, re]) => re.test(text))?.[0] ?? fallback;
};

export function diffSnapshots(prev, next, page) {
  const events = [];
  const at = next.capturedAt;
  const base = { pageId: page.id, pageType: page.type, url: page.url, at, prevAt: prev.capturedAt, source: next.source, prevSource: prev.source };
  const push = (category, significance, title, detail = {}) => events.push({ ...base, category, significance, title, ...detail });

  // A page that grew or shrank by more than half was rebuilt (or an archived copy was a JS shell);
  // fact-level diffs against it would be noise, so record one redesign event instead.
  const ratio = Math.min(prev.blocks.length, next.blocks.length) / Math.max(prev.blocks.length, next.blocks.length);
  if (ratio < 0.45) {
    push('Messaging', 'medium', `${labelFor(page)} redesigned — ${prev.blocks.length} → ${next.blocks.length} content blocks`, {
      added: next.blocks.filter((b) => b.length >= 18).slice(0, 12), removed: [], rebuilt: true });
    return events;
  }

  // 1. Positioning: the words a company chooses for its title, meta description and H1.
  if (page.type === 'homepage' || page.type === 'product') {
    if (norm(prev.title) !== norm(next.title) && prev.title && next.title)
      push('Positioning', 'high', `Page title changed to “${next.title}”`, { before: prev.title, after: next.title });
    const h1a = (prev.h1 ?? []).join(' / '), h1b = (next.h1 ?? []).join(' / ');
    if (shape(h1a) !== shape(h1b) && h1b)
      push('Positioning', 'high', `Headline changed to “${h1b}”`, { before: h1a, after: h1b });
    if (norm(prev.description) !== norm(next.description) && prev.description && next.description)
      push('Positioning', 'medium', 'Meta description rewritten', { before: prev.description, after: next.description });
  }

  // 2. Structured facts.
  const f0 = prev.facts, f1 = next.facts;
  const p = setDiff(f0.prices, f1.prices);
  if (p.added.length || p.removed.length) {
    const sig = page.type === 'pricing' ? 'high' : 'medium';
    const title = p.added.length && p.removed.length
      ? `Price points changed: ${list(p.removed)} → ${list(p.added)}`
      : p.added.length ? `New price points: ${list(p.added)}` : `Price points removed: ${list(p.removed)}`;
    push('Pricing', sig, title, { added: p.added, removed: p.removed });
  }
  const i = setDiff(f0.integrations, f1.integrations);
  if (i.added.length) push('Integration', i.added.length > 1 || page.type === 'integrations' ? 'high' : 'medium', `Now mentions ${list(i.added)}`, { added: i.added });
  if (i.removed.length) push('Integration', 'low', `No longer mentions ${list(i.removed)}`, { removed: i.removed });
  const ind = setDiff(f0.industries, f1.industries);
  if (ind.added.length) push('Industry', 'medium', `New verticals in copy: ${list(ind.added)}`, { added: ind.added });
  if (ind.removed.length) push('Industry', 'low', `Verticals dropped from copy: ${list(ind.removed)}`, { removed: ind.removed });
  const cap = setDiff(f0.capabilities, f1.capabilities);
  if (cap.added.length) push(page.type === 'docs' ? 'Docs' : 'Feature', 'high', `New capability mentioned: ${list(cap.added)}`, { added: cap.added });
  if (cap.removed.length) push('Feature', 'low', `Capability no longer mentioned: ${list(cap.removed)}`, { removed: cap.removed });
  const lang = setDiff(f0.languages, f1.languages);
  if (lang.added.length) push('Feature', 'medium', `New languages mentioned: ${list(lang.added)}`, { added: lang.added });

  // 3. Copy-level diff, with volatile numbers ignored.
  const prevShapes = new Set(prev.blocks.map(shape));
  const nextShapes = new Set(next.blocks.map(shape));
  const added = next.blocks.filter((b) => !prevShapes.has(shape(b)) && b.length >= 18);
  const removed = prev.blocks.filter((b) => !nextShapes.has(shape(b)) && b.length >= 18);
  const addedHeads = (next.headings ?? []).filter((h) => !(prev.headings ?? []).map(shape).includes(shape(h)));

  if (page.type === 'changelog') {
    // Every new heading on a changelog is a shipped item.
    for (const h of addedHeads.slice(0, 12))
      push('Feature', 'high', `Changelog: ${h}`, { added: added.filter((b) => b !== h).slice(0, 3) });
  } else if (added.length + removed.length) {
    const volume = [...added, ...removed].reduce((n, b) => n + b.length, 0);
    const sig = volume > 2500 || addedHeads.length >= 3 ? 'high' : volume > 600 ? 'medium' : 'low';
    const fallback = page.type === 'docs' ? 'Docs' : page.type === 'pricing' ? 'Pricing' : page.type === 'integrations' ? 'Integration' : 'Messaging';
    // Pages with a clear purpose keep their category; marketing pages are classified by what was added.
    const category = fallback !== 'Messaging' ? fallback : topicOf(addedHeads.length ? addedHeads : added, fallback);
    const what = addedHeads.length
      ? `New sections: ${list(addedHeads.map((h) => `“${h.slice(0, 60)}”`), 3)}`
      : volume > 2500 ? 'Major copy rewrite' : `${added.length} block${added.length === 1 ? '' : 's'} added, ${removed.length} removed`;
    push(category, sig, `${labelFor(page)} updated — ${what}`, { added: added.slice(0, 12), removed: removed.slice(0, 12), volume });
  }
  return events;
}

const labelFor = (page) => ({ homepage: 'Homepage', pricing: 'Pricing page', product: 'Product page', integrations: 'Integrations page', docs: 'Docs', changelog: 'Changelog' }[page.type] ?? 'Page');
