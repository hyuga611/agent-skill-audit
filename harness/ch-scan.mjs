// Materialize each ClawHub skill as a standalone package (file skeleton + real SKILL.md)
// and run tenken's real CLI over it. For a published package the package IS the unit of
// distribution, so root === skill dir and package-local resolution is the correct semantics.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const TREE = 'ch-tree';
const IN = process.argv[2] || 'ch-corpus.jsonl';
const OUT = process.argv[3] || 'ch-findings.json';

// Resolve the checker instead of hardcoding where it lives on the author's disk.
// (An earlier revision of this file hardcoded one — in the harness for an audit about
// hardcoded author paths. Caught by grepping this repository against its own subject.)
const TENKEN = (() => {
  if (process.env.TENKEN_BIN) return process.env.TENKEN_BIN;
  const require = createRequire(import.meta.url);
  for (const id of ['@hyuga/tenken/src/check.mjs', '@hyuga/tenken']) {
    try {
      return require.resolve(id);
    } catch {}
  }
  const sibling = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tenken', 'src', 'check.mjs');
  if (existsSync(sibling)) return sibling;
  throw new Error(
    'Cannot find tenken. Run `npm i @hyuga/tenken`, or set TENKEN_BIN to its check.mjs.',
  );
})();

if (existsSync(TREE)) rmSync(TREE, { recursive: true, force: true });
mkdirSync(TREE, { recursive: true });

const recs = [];
const seen = new Set();
{
  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    recs.push(r);
  }
}

const usable = recs.filter((r) => r.skillmd && r.files && r.files.length);
process.stderr.write(`records=${recs.length} usable=${usable.length}\n`);

// safe directory name — slugs come from a public registry, never trust them as paths
const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
const dirFor = new Map();

// Layout: ch-tree/<i>/<slug>/…  — one isolated root per package, and the skill's own
// folder is named exactly its registry slug, so skills-lint's "name matches its directory"
// check compares the declared name against the slug the registry publishes it under.
for (const [i, r] of usable.entries()) {
  const box = join(TREE, String(i).padStart(5, '0'));
  const name = safe(r.slug);
  const base = join(box, name);
  dirFor.set(box, { name, slug: r.slug });
  for (const f of r.files) {
    if (typeof f !== 'string' || f.includes('..') || f.startsWith('/')) continue;
    const abs = join(base, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '');
  }
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'SKILL.md'), r.skillmd);
}
process.stderr.write(`materialized ${dirFor.size} skill packages\n`);

// tenken per package, so each package is its own root (standalone semantics)
const all = [];
const errors = [];
let done = 0;
for (const [box, { name, slug }] of dirFor) {
  let out = '';
  try {
    // Target the package's own SKILL.md, not the directory. 48 of 2,500 packages are
    // bundles shipping many nested SKILL.md files (one ships 181); only the top-level one
    // has real content here, so scanning the directory would report every empty placeholder
    // as "missing frontmatter". Nested bundle members are out of scope for this pass.
    out = execFileSync(process.execPath, [TENKEN, '--json', `${name}/SKILL.md`], {
      cwd: box, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64,
    });
  } catch (e) {
    out = e.stdout || ''; // tenken exits 1 when it finds something
    if (!out) { errors.push({ slug, error: String(e.message).slice(0, 120) }); continue; }
  }
  let j;
  try { j = JSON.parse(out); } catch { errors.push({ slug, error: 'unparseable json' }); continue; }
  for (const f of j.findings || []) all.push({ slug, ...f });
  if (++done % 100 === 0) process.stderr.write(`  scanned ${done}/${dirFor.size}\n`);
}

const scanned = dirFor.size;
const withFindings = new Set(all.map((f) => f.slug));
const withErrors = new Set(all.filter((f) => f.severity === 'error').map((f) => f.slug));
const byKind = {}, skillsByKind = {};
for (const f of all) {
  const k = `${f.engine}:${f.kind}`;
  byKind[k] = (byKind[k] || 0) + 1;
  (skillsByKind[k] ||= new Set()).add(f.slug);
}
for (const k of Object.keys(skillsByKind)) skillsByKind[k] = skillsByKind[k].size;

const summary = {
  scanned,
  findings: all.length,
  skillsWithAnyFinding: withFindings.size,
  skillsWithError: withErrors.size,
  pctWithError: +((withErrors.size / scanned) * 100).toFixed(1),
  byKind, skillsByKind,
  scanErrors: errors.length,
};
writeFileSync(OUT, JSON.stringify({ summary, findings: all, errors }, null, 0));
console.log(JSON.stringify(summary, null, 2));
