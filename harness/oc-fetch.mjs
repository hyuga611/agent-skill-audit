// Fetch OpenClaw's own first-party bundled skills (.agents/skills/**) as a census.
// Uses the git trees API once, then raw.githubusercontent for each SKILL.md.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = 'openclaw/openclaw';
const ROOT = '.agents/skills';

const sh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });

const head = JSON.parse(sh(['api', `repos/${REPO}/commits/main`, '--jq', '{sha:.sha,date:.commit.committer.date}']));
process.stderr.write(`HEAD ${head.sha.slice(0, 8)} (${head.date})\n`);

const tree = JSON.parse(sh(['api', `repos/${REPO}/git/trees/${head.sha}?recursive=1`]));
if (tree.truncated) process.stderr.write('WARNING: tree truncated\n');

// Save the WHOLE repo tree. These skills run inside the openclaw monorepo, so a
// reference to packages/… or docs/… is legitimate; resolving only against the
// skill's own folder would manufacture false positives.
writeFileSync(
  'oc-repotree.json',
  JSON.stringify({ commit: head.sha, truncated: !!tree.truncated, paths: tree.tree.filter((n) => n.type === 'blob').map((n) => n.path) }, null, 0),
);
process.stderr.write(`repo tree: ${tree.tree.length} nodes (truncated=${!!tree.truncated})\n`);

const under = tree.tree.filter((n) => n.path.startsWith(ROOT + '/'));
const skills = new Map();
for (const n of under) {
  const rest = n.path.slice(ROOT.length + 1);
  const name = rest.split('/')[0];
  if (!name) continue;
  if (!skills.has(name)) skills.set(name, { name, files: [] });
  if (n.type === 'blob') skills.get(name).files.push(rest.slice(name.length + 1));
}
process.stderr.write(`${skills.size} first-party skills, ${under.length} tree nodes\n`);

const out = [];
for (const [name, s] of skills) {
  const skillFile = s.files.find((f) => f.toLowerCase() === 'skill.md');
  let body = null;
  if (skillFile) {
    const url = `https://raw.githubusercontent.com/${REPO}/${head.sha}/${ROOT}/${name}/${skillFile}`;
    const res = await fetch(url);
    if (res.ok) body = await res.text();
  }
  out.push({ slug: name, source: 'openclaw-first-party', commit: head.sha, skillmd: body, files: s.files });
  process.stderr.write(`  ${name}: ${s.files.length} files, SKILL.md ${body ? body.length + 'B' : 'MISSING'}\n`);
}

writeFileSync('oc-corpus.json', JSON.stringify({ repo: REPO, commit: head.sha, date: head.date, skills: out }, null, 0));
process.stderr.write(`\nDONE: ${out.length} skills -> oc-corpus.json\n`);
