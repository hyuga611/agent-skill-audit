// Enumerate the ClawHub skill registry (anonymous, polite).
// Writes ch-index.json = [{slug, ownerHandle, version, stats, updatedAt, ...}]
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const BASE = 'https://clawhub.ai';
const OUT = 'ch-index.json';
const PAGE = 200;
const PAUSE_MS = 900;      // polite: ~1 req/s for listing
const MAX_RETRY = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'skill-portability-audit (research; contact: github.com/hyuga611)' },
  });
  const text = await res.text();
  if (res.status === 429 || text.startsWith('Rate limit')) {
    if (attempt >= MAX_RETRY) throw new Error(`rate limited after ${MAX_RETRY} retries: ${url}`);
    const wait = Math.min(60000, 2000 * 2 ** attempt);
    process.stderr.write(`  rate limited, backing off ${wait}ms\n`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

const items = [];
const seen = new Set();
let cursor = null;
let page = 0;

// resume support
if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  if (prev.cursor && Array.isArray(prev.items)) {
    items.push(...prev.items);
    for (const it of prev.items) seen.add(`${it.ownerHandle}/${it.slug}`);
    cursor = prev.cursor;
    page = prev.page || 0;
    process.stderr.write(`resuming from page ${page} with ${items.length} items\n`);
  }
}

while (true) {
  const url = new URL('/api/v1/skills', BASE);
  url.searchParams.set('limit', String(PAGE));
  if (cursor) url.searchParams.set('cursor', cursor);

  const j = await get(url.toString());
  page++;

  if (page === 1 && items.length === 0) {
    // dump the full shape of one item once, so we can confirm the owner field
    writeFileSync('ch-sample-item.json', JSON.stringify(j.items[0], null, 2));
  }

  let fresh = 0;
  for (const it of j.items ?? []) {
    const owner =
      it.ownerHandle ?? it.owner?.handle ?? it.publisher?.handle ?? it.publisher?.displayName ?? null;
    const key = `${owner}/${it.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh++;
    items.push({
      slug: it.slug,
      ownerHandle: owner,
      displayName: it.displayName ?? null,
      version: it.latestVersion?.version ?? it.tags?.latest ?? null,
      downloads: it.stats?.downloads ?? 0,
      installs: it.stats?.installs ?? 0,
      stars: it.stats?.stars ?? 0,
      updatedAt: it.updatedAt ?? null,
    });
  }

  process.stderr.write(`page ${page}: +${fresh} (total ${items.length})\n`);
  writeFileSync(OUT, JSON.stringify({ page, cursor: j.nextCursor ?? null, items }, null, 0));

  if (!j.nextCursor || (j.items ?? []).length === 0) break;
  cursor = j.nextCursor;
  await sleep(PAUSE_MS);
}

writeFileSync(OUT, JSON.stringify({ page, cursor: null, done: true, items }, null, 0));
process.stderr.write(`\nDONE: ${items.length} skills indexed across ${page} pages\n`);
