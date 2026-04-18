---
id: slice-frontmatter-contract
title: Slice frontmatter contract and id uniqueness rules
cited_files:
  - src/slices.ts
  - src/types.ts
  - src/paths.ts
last_baked_commit: afc58c7e8549da0a5ece78de3f508b1d042213a2
created_by: model
tags: [slices, format, design]
---

A slice on disk is a markdown file with YAML frontmatter parsed by `gray-matter`. `readSlice` validates four required fields — `id`, `title`, `cited_files`, `last_baked_commit` — and throws on anything missing. `created_by` defaults to `"human"` if absent; `tags` defaults to `[]`; `last_accessed` is optional and only used for the "recent" list in `loaf.status`.

`cited_files` is a source of subtle bugs. Paths are stored **repo-relative, forward-slash**. The staleness check passes them verbatim into `git log -- <path>`, which means:
- Absolute paths will silently match nothing.
- Backslashes won't work on Windows without normalization.
- Globs are not supported — the spec is file-level citation for v1.

If you're accepting `cited_files` from a model or user, normalize before writing: `path.relative(repoRoot, path.resolve(repoRoot, input))` and reject anything that escapes the repo.

Id uniqueness is enforced by `uniqueSliceId`: slugify the title, check for collisions against `listSlices`, append `-2`, `-3`, … if needed. This is the v1.0 spec rule. `writeSlice` accepts an explicit `id` override (used by callers that already know the id they want), but does NOT re-check uniqueness — overwrites are a feature, not a bug, so `loaf.record_learning` can replace a corrected slice by passing the existing id. Keep this behavior when refactoring.

Crumbs use a different naming scheme: `fileSlug(target)` produces a deterministic filename (slashes and dots → dashes), and multiple crumbs on the same file get numeric suffixes. The per-file cap from `config.json` (`crumb_cap_per_file`, default 5) is documented but not yet enforced — enforcement was deferred to v1.1 per the spec's open questions.
