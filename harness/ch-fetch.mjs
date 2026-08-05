// Fetch a reproducible random sample of ClawHub skills.
// For each skill: SKILL.md body (detail endpoint) + file manifest (version endpoint).
// Appends JSONL to ch-corpus.jsonl; resumable.
import { readFileSync, existsSync, appendFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const BASE = 'https://clawhub.ai';
const OUT = process.env.OUT || 'ch-corpus.jsonl';
const N = Number(process.env.SAMPLE_N || 2500);
const CONC = Number(process.env.CONC || 4);
const SEED = 20260804;
const UA = 'skill-portability-audit (research; contact: github.com/hyuga611)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// deterministic PRNG (mulberry32) so the sample is reproducible by anyone
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const index = JSON.parse(readFileSync(process.env.INDEX||'ch-index.json', 'utf8'));
const all = index.items.filter((s) => s.slug && s.version);
// stable sort by slug so the shuffle is deterministic regardless of crawl order
all.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

const rnd = mulberry32(SEED);
const shuffled = all.slice();
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const sample = shuffled.slice(0, Math.min(N, shuffled.length));

// resume: skip anything already written
const done = new Set();
if (existsSync(OUT)) {
  const rl = createInterface({ input: createReadStream(OUT), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).slug); } catch {}
  }
}
const todo = sample.filter((s) => !done.has(s.slug));
process.stderr.write(
  `population=${all.length} sample=${sample.length} already=${done.size} todo=${todo.length}\n`,
);

async function get(url, attempt = 0) {
  let res, text;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA } });
    text = await res.text();
  } catch (e) {
    if (attempt >= 5) return { error: `network: ${e.message}` };
    await sleep(1500 * 2 ** attempt);
    return get(url, attempt + 1);
  }
  if (res.status === 429 || text.startsWith('Rate limit')) {
    if (attempt >= 7) return { error: 'rate-limited' };
    await sleep(Math.min(45000, 1500 * 2 ** attempt));
    return get(url, attempt + 1);
  }
  if (res.status === 404) return { error: 'not-found' };
  if (!res.ok) return { error: `http-${res.status}` };
  try { return { json: JSON.parse(text) }; } catch { return { error: 'non-json' }; }
}

let n = 0, ok = 0, failed = 0;
const queue = todo.slice();

async function worker(id) {
  while (queue.length) {
    const s = queue.shift();
    if (!s) break;
    const slug = encodeURIComponent(s.slug);

    const detail = await get(`${BASE}/api/v1/skills/${slug}`);
    await sleep(120);
    const ver = await get(
      `${BASE}/api/v1/skills/${slug}/versions/${encodeURIComponent(s.version)}`,
    );

    n++;
    const rec = {
      slug: s.slug,
      owner: detail.json?.owner?.handle ?? null,
      version: s.version,
      downloads: s.downloads,
      installs: s.installs,
      stars: s.stars,
      skillmd: detail.json?.skill?.description ?? null,
      files: (ver.json?.version?.files ?? []).map((f) => f.path),
      error: detail.error || ver.error || null,
    };
    if (rec.skillmd && rec.files.length) ok++; else failed++;
    appendFileSync(OUT, JSON.stringify(rec) + '\n');

    if (n % 50 === 0) {
      process.stderr.write(`  fetched ${n}/${todo.length} (ok=${ok} failed=${failed})\n`);
    }
    await sleep(200);
  }
}

await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
process.stderr.write(`\nDONE: ${n} fetched, ok=${ok}, failed=${failed}\n`);
