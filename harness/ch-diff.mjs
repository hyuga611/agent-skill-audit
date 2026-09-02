// Compare two ch-index snapshots. Answers one question:
// is `installs` a live counter, or a value that was written once and froze?
//
// The registry publishes no history API, so a panel can only be built by
// taking two snapshots yourself. Everything here is descriptive — no model,
// no smoothing, so the numbers can be checked by hand.
import { readFileSync } from 'node:fs';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('usage: node ch-diff.mjs <old.json> <new.json>');
  process.exit(2);
}

const load = (p) => {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const m = new Map();
  // Two skills can share a slug (GET /skills/<slug> answers 409
  // AMBIGUOUS_SKILL_SLUG), so key on slug+createdAt where we have it.
  for (const it of j.items) m.set(it.createdAt ? `${it.slug}|${it.createdAt}` : it.slug, it);
  return { j, m };
};

const A = load(aPath);
const B = load(bPath);

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '-');
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * p)] : 0);

console.log(`旧 ${aPath}: ${A.j.items.length} 件  (received ${A.j.received ?? '不明'})`);
console.log(`新 ${bPath}: ${B.j.items.length} 件  (received ${B.j.received ?? '不明'})`);
if (B.j.received) {
  console.log(`  → dedup で落ちた件数: ${B.j.received - B.j.items.length}`);
}

// The old snapshot has no createdAt, so it can only be joined on slug.
const aBySlug = new Map();
for (const it of A.j.items) if (!aBySlug.has(it.slug)) aBySlug.set(it.slug, it);

const paired = [];
for (const it of B.j.items) {
  const prev = aBySlug.get(it.slug);
  if (prev) paired.push({ now: it, prev });
}
console.log(`\n■ 突合できた件数: ${paired.length}`);
console.log(`  新規に現れた slug: ${B.j.items.length - paired.length}`);
console.log(`  消えた slug      : ${A.j.items.length - paired.length}`);

const dIns = paired.map((p) => (p.now.installs ?? 0) - (p.prev.installs ?? 0));
const dDl = paired.map((p) => (p.now.downloads ?? 0) - (p.prev.downloads ?? 0));
const dSt = paired.map((p) => (p.now.stars ?? 0) - (p.prev.stars ?? 0));

const report = (name, d) => {
  const zero = d.filter((x) => x === 0).length;
  const up = d.filter((x) => x > 0).length;
  const down = d.filter((x) => x < 0).length;
  console.log(`\n■ Δ${name}`);
  console.log(`  不変 ${zero} (${pct(zero, d.length)}) / 増加 ${up} (${pct(up, d.length)}) / 減少 ${down}`);
  console.log(`  中央値 ${med(d)}  p25 ${q(d, 0.25)}  p75 ${q(d, 0.75)}  p90 ${q(d, 0.9)}  max ${Math.max(...d)}`);
  console.log(`  総増分 ${d.reduce((a, b) => a + b, 0).toLocaleString()}`);
};
report('installs', dIns);
report('downloads', dDl);
report('stars', dSt);

// The claim under test: installs was backfilled as round(downloads * rate)
// and then stopped moving, while downloads kept climbing on its own.
console.log('\n■ 判定');
const insFrozen = dIns.filter((x) => x === 0).length / dIns.length;
const dlMoving = dDl.filter((x) => x > 0).length / dDl.length;
console.log(`  installs が不変の割合 : ${pct(dIns.filter((x) => x === 0).length, dIns.length)}`);
console.log(`  downloads が増えた割合: ${pct(dDl.filter((x) => x > 0).length, dDl.length)}`);
if (insFrozen > 0.85 && dlMoving > 0.85) {
  console.log('  → installs は凍結、downloads は独立に増加。バックフィル説を支持する。');
} else if (insFrozen < 0.5) {
  console.log('  → installs は動いている。バックフィル説は成立しない（実測カウンタの可能性）。');
} else {
  console.log('  → どちらとも言えない。判定保留。');
}

// If installs really is round(downloads * rate) frozen at backfill time,
// the ratio has to fall as downloads keeps climbing under it.
const ratios = paired
  .filter((p) => (p.prev.installs ?? 0) > 0 && (p.now.installs ?? 0) > 0)
  .map((p) => ({
    before: (p.prev.downloads ?? 0) / p.prev.installs,
    after: (p.now.downloads ?? 0) / p.now.installs,
  }));
if (ratios.length) {
  console.log(`\n■ downloads/installs 比のドリフト (n=${ratios.length})`);
  console.log(`  旧スナップショット 中央 ${med(ratios.map((r) => r.before)).toFixed(1)}`);
  console.log(`  新スナップショット 中央 ${med(ratios.map((r) => r.after)).toFixed(1)}`);
  const rose = ratios.filter((r) => r.after > r.before).length;
  console.log(`  比が上がった件: ${pct(rose, ratios.length)}  ← 凍結なら大多数で上がる`);
}

// createdAt only exists in the new snapshot. The backfill covered everything
// that predated 2026-06-12, so skills created after that date carry no floor.
const CUT = Date.UTC(2026, 5, 12);
const withCA = B.j.items.filter((x) => x.createdAt);
if (withCA.length) {
  console.log(`\n■ createdAt が取れた件数: ${withCA.length}`);
  const days = withCA.map((x) => x.createdAt).sort((a, b) => a - b);
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  console.log(`  最古 ${d(days[0])} / p25 ${d(q(days, 0.25))} / 中央 ${d(med(days))} / 最新 ${d(days[days.length - 1])}`);

  const before = withCA.filter((x) => x.createdAt < CUT);
  const after = withCA.filter((x) => x.createdAt >= CUT);
  const shape = (name, arr) => {
    const ins = arr.map((x) => x.installs ?? 0).sort((a, b) => b - a);
    const tot = ins.reduce((a, b) => a + b, 0);
    const top = ins.slice(0, 100).reduce((a, b) => a + b, 0);
    console.log(`  ${name} n=${arr.length}`);
    console.log(`     installs=0 の割合 ${pct(ins.filter((x) => x === 0).length, ins.length)}`);
    console.log(`     p50 ${med(ins)}  p90 ${q(ins, 0.9)}  p99 ${q(ins, 0.99)}  max ${ins[0] ?? 0}`);
    console.log(`     上位100件の占有 ${pct(top, tot)}`);
  };
  console.log(`\n■ バックフィル境界 (2026-06-12) で切ったときの installs の形`);
  shape('06-12 より前（下駄あり）', before);
  shape('06-12 以降（下駄なし）', after);
  console.log('  → 「以降」に重い裾（ゼロ率が高い・上位100占有が高い）が出れば、平坦さは計測の artifact。');
}
