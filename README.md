# agent-skill-audit

What happens when you run a reference-integrity and portability check over the agent skills people
actually publish, instead of over fixtures.

Two corpora, August 2026:

- **2,465 skills** drawn at random from **[ClawHub](https://clawhub.ai)**, the OpenClaw skill registry
- **all 46 skills** bundled in **[openclaw/openclaw](https://github.com/openclaw/openclaw)** itself

The harness is here. The seed is fixed. Re-run it and you should get the same draw.

---

## The ClawHub sample

2,465 skills, uniform random from 69,265 enumerated, seed `20260804`. Percentages are the share of
sampled skills with at least one finding of that kind — not the share of findings.

| | skills | of sample |
|---|---:|---:|
| frontmatter `name` differs from the registry slug | 720 | **29.2%** |
| a back-quoted path or link that does not resolve in the package | 445 | **18.1%** |
| **ships with no YAML frontmatter at all** | 192 | **7.8%** |
| an absolute path that resolves only on the author's machine | 94 | **3.8%** |
| malformed `allowed-tools` | 58 | 2.4% |
| a provider API key read straight from the environment | 52 | 2.1% |
| an external CLI the skill never declares | 31 | 1.3% |

**1,424 of 2,465 skills (57.8%) have at least one error-level finding.**

The 7.8% is the one worth sitting with. A `SKILL.md` with no frontmatter has no `name` and no
`description`, and `description` is the string the agent matches on to decide whether to fire the
skill. Those skills are published, downloadable, and cannot be triggered the way skills are meant
to be triggered.

The 29.2% is not all breakage: ClawHub deliberately keeps the routable slug separate from the
stored display name, so a share of those are intentional. It is still worth knowing that on nearly
a third of published skills, the name the agent registers is not the name the registry shows.

## The openclaw census

All 46 first-party skills bundled in a repository with 385,000 stars, at commit `3ac7083`.

Two confirmed defects, [reported upstream](https://github.com/openclaw/openclaw/issues/119393) with
a [fix](https://github.com/openclaw/openclaw/pull/119394):

- `openclaw-refactor-docs` opens with *"Read `../openclaw-docs/SKILL.md` first"*. That skill was
  deleted in `0dabb70` and replaced by `technical-documentation`. Three references were never
  updated, so the read returns nothing and the docs refactor proceeds without the rules it was
  supposed to apply. Nothing errors.
- `openclaw-test-heap-leaks` points at three fixture and script paths that exist nowhere in the
  tree. No replacement was proposed here, because those names appear nowhere else either — only a
  maintainer knows the intent.

OpenClaw's review bot confirmed reproducibility against current `main` and the latest release,
rated the issue `diamond lobster`, and made it the canonical report for stale bundled-skill
references.

### The one that looks like a defect and is not

`openclaw-live-updater` hardcodes `/Users/steipete/openclaw` — the maintainer's own home directory,
in a skill shipped to everybody. It is the textbook portability finding and it is **not a bug**:
that skill is an explicit single-machine runbook for one canonical live checkout, so the path is
correct there. It was deliberately left out of the upstream report.

This is the part a percentage cannot carry. A linter produces candidates. Whether a candidate is a
defect depends on what the document is *for*, and that decision did not survive automation.

## The audit's own error rate

The interesting number is not what the tools found. It is what they got wrong.

On the openclaw corpus the linters first reported **219 findings**. After six precision fixes the
same corpus reports **59**, and every defect above still appears in both runs. The 160 that
disappeared were all false positives:

1. references resolved against the skill's folder instead of the repository it lives in — **139 of 197**
2. `openai/gpt-5.4` read as a file path, because `.4` looks like an extension
3. an artifact excused only on the line that says it is written, not where it is read back — **16 of 80**
4. `/home/YOUR_USER/…` read as an author's real path
5. indented frontmatter parsing to nothing, so a skill with both keys was reported as having neither
6. sample output inside a fenced code block checked as if it were a reference — **10.8%** of path findings

Full detail in [`results/fixes.json`](results/fixes.json). Every one is pinned by a regression test.

Fix 6 was found by dogfooding: a skill written to *document* these linters could not pass them,
because it quoted its own example output. Fix 2's guard already had a comment saying it existed to
stop model identifiers being read as paths — the example in that comment ended in a letter, so a
version number sailed straight through.

A linter that cries wolf gets uninstalled, so the false positives were treated as the bugs. **Any
number published before that work would have been wrong by a factor of three.**

## Reproducing

```bash
node harness/ch-index.mjs                       # enumerate the registry -> ch-index.json
node harness/ch-fetch.mjs                       # draw the seeded sample -> ch-corpus.jsonl
node harness/ch-scan.mjs ch-corpus.jsonl out.json

node harness/oc-fetch.mjs                       # openclaw skills + repo tree
node harness/materialize-oc.mjs                 # rebuild the repo as a file skeleton
cd oc-tree && npx @hyuga/tenken --json .agents/skills
```

`SAMPLE_N`, `CONC` and `INDEX` are environment overrides. The scan shells out to
[`@hyuga/tenken`](https://github.com/hyuga611/tenken), which runs
[reflint](https://github.com/hyuga611/reflint),
[skills-lint](https://github.com/hyuga611/skills-lint) and
[carrylint](https://github.com/hyuga611/carrylint) in one pass.

Versions used: tenken 0.2.0, skills-lint 0.7.1, carrylint 0.2.2, reflint 0.8.3.

## What is not here, and why

- **The corpus itself.** 2,465 third-party `SKILL.md` bodies are other people's work; re-fetch them
  with the harness instead.
- **Author paths.** Example messages in `results/` have every home-directory segment redacted. The
  94 skills leaking an author path are reported as a count, never as a list. They were not
  contacted; mass-filing issues against individuals over a rule with a known false-positive history
  would be the wrong move.
- **A verdict on any individual community skill.** Only the openclaw corpus was checked case by
  case. Everything about ClawHub here is aggregate.

## Method, stated plainly

Enumeration paged `GET /api/v1/skills` ordered by most-recently-updated and stopped at 69,265 while
the registry was still returning pages. **So this is the most-recently-updated slice of ClawHub, not
all of it**, and recently-updated skills are if anything in better shape than abandoned ones.

Each ClawHub skill was rebuilt as a standalone package — file manifest from the registry, real
`SKILL.md` body — and scanned in its own root, because a published package is the unit of
distribution. The openclaw skills were resolved against the entire 30,814-blob repository tree
instead, because a skill living in a repository may legitimately reference anything in it. Using
the wrong one of those two rules is fix 1 above.

### The resolution rule is a choice, and it makes these numbers a floor

Neither rule is what the runtime does. OpenClaw tells the model, in the same prompt that lists the
available skills:

> When a skill file references a relative path, resolve it against the skill directory (parent of
> `SKILL.md` / dirname of the path) and use that absolute path in tool commands.
> — [`src/skills/loading/skill-contract.ts`](https://github.com/openclaw/openclaw/blob/main/src/skills/loading/skill-contract.ts)

Strictly applied, that would resolve `scripts/build.mjs` inside a repo-hosted skill to
`.agents/skills/<skill>/scripts/build.mjs` — which is not what an author writing about the
repository's own `scripts/` means. In practice the model has both the instruction and the context to
tell those apart, so the true behaviour sits between "skill folder only" and "anywhere in the repo".

This audit picked the permissive end. **That direction trades false positives for false negatives, so
the openclaw census is a floor, not a ceiling.** The size of the disagreement is measurable: 139
references resolve somewhere in the repository but not under their own skill folder. Some of those
are repo-root references a model would read correctly; some would fail. Splitting them needs a
judgement per reference, which is exactly the thing this harness cannot do.

Worth stating plainly because it cost something: an upstream report built on the strict reading
([#119534](https://github.com/openclaw/openclaw/issues/119534)) was closed `not planned`, correctly —
the contract above is the answer and I had reasoned from the raw read tool instead. A linter that
picks a resolution rule is picking a definition of "broken", and that definition has to match the
runtime, not the filesystem.

## Files

| | |
|---|---|
| [`results/clawhub-sample.json`](results/clawhub-sample.json) | aggregate counts, method, caveats |
| [`results/clawhub-example-messages.json`](results/clawhub-example-messages.json) | redacted example findings per rule |
| [`results/openclaw-census.json`](results/openclaw-census.json) | all 59 findings, plus what was and was not reported |
| [`results/fixes.json`](results/fixes.json) | the six precision bugs, with measurements |
| [`harness/`](harness/) | everything needed to re-run it |

Data under CC0. Harness under MIT. Corrections welcome as issues — including to the numbers.
