# loafmd

A git-native staleness layer for LLM coding context. Atomic markdown nodes that live in the repo, track freshness against git commits, and expose themselves via MCP.

Bread goes stale. You can always bake more.

> The npm package is named `loafmd` because `loaf` was taken on the registry. The command you actually type is `loaf`.

## What it is

Loaf solves three failure modes in LLM coding workflows:

1. **Context starvation** — model doesn't know the codebase, makes wrong assumptions.
2. **Context overload** — dump everything, burn tokens, degrade reasoning.
3. **Silent staleness** — rule files drift from the code, the model trusts them anyway, loops ensue.

It does this by:

- Storing **atomic markdown slices** — one concept per file — under `.loaf/slices/`.
- Anchoring each slice to a **git commit**. A `git log <baked>..HEAD -- <cited>` that returns anything means the slice is stale.
- Exposing an **MCP server** so the model pulls exactly what it needs, when it needs it.
- Letting the **model itself** record learnings at the moment of mistake recovery.

Not a "second brain." Not auto-capture. A pull-based, git-native, model-curated knowledge layer.

## Install

```
npm install -g loafmd     # installs the `loaf` and `loaf-mcp` binaries globally
loaf --version
```

If `npm install -g loafmd` fails with `EEXIST` because a stale `loaf` binary is already on your PATH from a prior install, free the slot first:

```
npm uninstall -g loaf
npm install -g loafmd
```

One-off without installing:

```
npx -y -p loafmd loaf init
```

## Quick start

```
cd your-repo
loaf init                     # scaffolds .loaf/, writes AGENTS.md, prints an MCP config block
loaf status                   # shows what's there
loaf add --title "Auth token refresh flow" --file src/auth/token.ts --file src/auth/middleware.ts
loaf bake auth-token-refresh  # mark fresh at HEAD after editing
loaf doctor                   # verify git, .loaf/ shape, print MCP invocation
```

`loaf init` prints a ready-to-paste MCP client config. It looks like this:

```jsonc
{
  "mcpServers": {
    "loaf": {
      "command": "npx",
      "args": ["-y", "-p", "loafmd", "loaf-mcp", "--repo", "/absolute/path/to/your/repo"]
    }
  }
}
```

The `-p loafmd` tells npx which npm package to fetch; `loaf-mcp` is the binary inside it. `--repo` is optional — the server also honors `$LOAF_REPO` and falls back to walking up from `cwd` — but passing it explicitly avoids surprises when clients don't set `cwd` the way you expect.

## Shape on disk

```
.loaf/
  slices/                   # one concept per markdown file
    auth-token-refresh.md
  crumbs/                   # per-file localized warnings
    src-state-user-context.md
  index.json                # auto-generated lookup cache
  config.json               # project config
```

A slice:

```markdown
---
id: auth-token-refresh
title: Auth token refresh flow
cited_files:
  - src/auth/token.ts
  - src/auth/middleware.ts
last_baked_commit: a1b2c3d
created_by: model
tags: [auth, middleware]
---

Dense markdown prose. One concept. Written for a model.
```

A crumb:

```markdown
---
target: src/state/UserContext.tsx
severity: warning
last_baked_commit: a1b2c3d
---

This context mutates external state through `useEffect` on mount. Do not refactor
into a pure provider without updating [auth-token-refresh].
```

## MCP tools

| Tool                   | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `loaf.status`          | High-level picture. Call at session start.                                  |
| `loaf.list`            | Lightweight listing. Optionally filter by tag or staleness.                 |
| `loaf.search`          | Fuzzy search over titles, tags, cited files, bodies.                        |
| `loaf.get`             | Fetch one slice. Returns a staleness banner if any cited file has changed.  |
| `loaf.record_learning` | Save a new slice — model-invoked on mistake recovery.                       |
| `loaf.add_crumb`       | Attach a localized warning to a specific file.                              |
| `loaf.bake`            | Re-anchor a slice to HEAD after validating against current code.            |

## CLI

| Command        | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `loaf init`    | Scaffold `.loaf/`, write `AGENTS.md`, print MCP config.                     |
| `loaf status`  | Stale/fresh counts, recent slices.                                          |
| `loaf add`     | Scaffold a new slice (opens `$EDITOR`).                                     |
| `loaf bake`    | Re-anchor a slice to HEAD.                                                  |
| `loaf prune`   | Remove slices whose cited files no longer exist.                            |
| `loaf reindex` | Rebuild `index.json`.                                                       |
| `loaf doctor`  | Verify environment and print the MCP invocation.                            |
| `loaf mcp`     | Start the MCP server on stdio (same binary as `loaf-mcp`).                  |

## How staleness works

For each slice, on read:

```
git log <last_baked_commit>..HEAD -- <cited_file>
```

Any commits? The slice is stale. We return the body with a banner listing the
changed files and the commits that changed them, and we recommend `loaf.bake`
(if the slice is still correct) or `loaf.record_learning` (if it isn't).

No timestamps. No AST. No magic. Git is the source of truth.

Edge cases handled:

- **Unknown commit** (shallow clone, amended history) → stale.
- **Not an ancestor of HEAD** (force push, rebase) → stale.

No hard blocks — hard blocks create workarounds. Soft signals create the right friction.

## Development

```
npm install
npm run build
npm test
npm link                   # makes `loaf` and `loaf-mcp` resolve to this checkout
```

## Status

v1.0 scope. File-level citations only. TypeScript. Filesystem only, no DB.
Published as `loafmd` on npm; installs the `loaf` and `loaf-mcp` binaries.
See [`bench/`](./bench/) for the benchmark harness.

## License

MIT.
