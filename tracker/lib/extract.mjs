// Turns raw HTML into a normalized, diffable snapshot: text blocks + structured facts.
import crypto from 'node:crypto';
import { INTEGRATIONS, INDUSTRIES, CAPABILITIES, LANGUAGES } from './vocab.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', trade: '™', reg: '®', copy: '©', times: '×', rarr: '→', larr: '←', check: '✓', shy: '' };

export function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const safeChar = (n) => { try { return String.fromCodePoint(n); } catch { return ''; } };

const meta = (html, name) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '').trim() : '';
};

const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Lines that change on every crawl or carry no product meaning.
const NOISE = [
  /^©|copyright|all rights reserved/i,
  /cookie|privacy policy|terms of (service|use)|accept all|do not sell/i,
  /^(log ?in|sign ?in|sign ?up|get started|book a demo|request a demo|learn more|read more|contact( us| sales)?|try (it )?(for )?free|start free trial|see pricing|menu|close|open menu|skip to content)$/i,
  /^\d+(\.\d+)?[kmb+%]*$/i,
  /web\.archive\.org|wayback machine/i,
];

export function extract(html, url) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = meta(html, 'description') || meta(html, 'og:description');
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).filter(Boolean);
  const headings = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => clean(m[1])).filter((h) => h.length > 2);

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  body = body.replace(/<\/?(p|div|section|article|header|main|aside|li|ul|ol|h[1-6]|tr|td|th|table|br|button|blockquote|figcaption|dt|dd|summary|details|label)\b[^>]*>/gi, '\n');

  const seen = new Set();
  const blocks = [];
  for (const raw of body.split('\n')) {
    const line = clean(raw);
    if (line.length < 3 || NOISE.some((re) => re.test(line))) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue; // marquees/carousels repeat the same copy
    seen.add(key);
    blocks.push(line);
  }

  const text = [title, description, ...blocks].join('\n');
  return {
    url,
    title,
    description,
    h1,
    headings: [...new Set(headings)].slice(0, 80),
    blocks,
    facts: extractFacts(text, url),
    hash: crypto.createHash('sha1').update(blocks.join('\n')).digest('hex'),
  };
}

const matchVocab = (text, vocab) =>
  Object.entries(vocab).filter(([, re]) => re.test(text)).map(([name]) => name).sort();

// Prices with a billing unit, e.g. "$99/mo", "$0.35 per minute", "$299 / month per location".
const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?\s*(?:\/|per|a)\s*(mo(?:nth)?|month|min(?:ute)?|call|caller|user|seat|location|line|number|yr|year|text|sms|conversation|agent)\b/gi;

export function extractFacts(text, url = '') {
  const prices = new Set();
  for (const m of text.matchAll(PRICE_RE)) {
    const unit = m[3].toLowerCase()
      .replace(/^mo(nth)?$|^month$/, 'mo').replace(/^min(ute)?$/, 'min').replace(/^(yr|year)$/, 'yr');
    const amount = m[1].replace(/,/g, '') + (m[2] && m[2] !== '00' ? '.' + m[2] : '');
    if (parseFloat(amount) <= 5000) prices.add(`$${amount}/${unit}`); // bigger figures are ROI claims, not list prices
  }
  return {
    prices: [...prices].sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1))),
    integrations: matchVocab(text, INTEGRATIONS),
    industries: matchVocab(text, INDUSTRIES),
    capabilities: matchVocab(text, CAPABILITIES),
    languages: matchVocab(text, LANGUAGES),
  };
}
