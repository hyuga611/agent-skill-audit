// Materialize the openclaw repo as a skeleton (empty files at every blob path)
// plus the real SKILL.md bodies, so tenken's real CLI resolves references exactly
// as it would in a genuine checkout — without cloning 2.3GB.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = 'oc-tree';
if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });

const repo = JSON.parse(readFileSync('oc-repotree.json', 'utf8'));
const corpus = JSON.parse(readFileSync('oc-corpus.json', 'utf8'));

const dirs = new Set();
let n = 0;
for (const p of repo.paths) {
  const abs = join(ROOT, p);
  const d = dirname(abs);
  if (!dirs.has(d)) { mkdirSync(d, { recursive: true }); dirs.add(d); }
  writeFileSync(abs, '');
  n++;
}
process.stderr.write(`skeleton: ${n} files, ${dirs.size} dirs\n`);

// real SKILL.md content for the 46 first-party skills
let w = 0;
for (const s of corpus.skills) {
  if (!s.skillmd) continue;
  const abs = join(ROOT, '.agents', 'skills', s.slug, 'SKILL.md');
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, s.skillmd);
  w++;
}
// a package.json at root so reflint can resolve `npm run <script>` claims
process.stderr.write(`wrote ${w} real SKILL.md files\ncommit ${corpus.commit}\n`);
