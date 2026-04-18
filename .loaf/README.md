# .loaf/

Atomic knowledge slices and per-file crumbs used by the Loaf MCP server.

- `slices/` — one concept per markdown file, frontmatter-anchored to a git commit.
- `crumbs/` — localized warnings about specific files.
- `index.json` — auto-generated lookup cache. Do not edit by hand.
- `config.json` — project-level Loaf configuration.

Slices and crumbs are meant to be committed alongside code. Staleness is computed at read time by diffing against `last_baked_commit`.
