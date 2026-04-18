---
id: staleness-contract
title: Staleness check contract and why it doesn't hard-block
cited_files:
  - src/staleness.ts
  - src/git.ts
last_baked_commit: afc58c7e8549da0a5ece78de3f508b1d042213a2
created_by: model
tags: [staleness, design, git]
---

`checkStaleness` has four terminal states, encoded in `StalenessResult.reason`:

- `undefined` + `stale: false` — fresh. `git log <baked>..HEAD -- <file>` was empty for every cited file.
- `file-changed` — at least one cited file has commits since `last_baked_commit`. `changed_files` and `commits` are populated. This is the common case.
- `commit-missing` — `last_baked_commit` is not a commit this clone knows about. Shallow clones and amended/rewritten history produce this. The slice may still be correct, but we can't prove it's fresh, so we err stale.
- `not-ancestor` — the baked commit exists but isn't an ancestor of HEAD. Force pushes and rebases land here. Again, we can't reason about the diff cleanly, so we return stale.

Order matters: commit-existence is checked before ancestry, and ancestry before the per-file log, because the later steps assume their precondition. Don't reorder without understanding the failure modes.

The check never hard-blocks or mutates files. It reports. `stalenessBanner` turns a result into a markdown block that gets prepended to slice bodies at read time in `handleGet` (see `src/mcp.ts`). We picked soft signals because hard blocks create workarounds in model behavior — the model just stops calling the tool. A banner creates the right friction: the model sees "this is stale" and usually does the right thing.

Staleness is computed on read, never cached. The implementation is `O(cited_files)` git calls per slice per check. If this ever becomes a hotspot, batch by piping multiple `-- file` args into a single `git log`, but don't pre-emptively optimize; most slices cite 1–3 files.
