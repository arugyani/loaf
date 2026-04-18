---
id: dual-binary-layout
title: Why there are two bin entries sharing one compiled tree
cited_files:
  - src/cli.ts
  - src/mcp.ts
  - package.json
  - tsconfig.json
last_baked_commit: 57d8a2f74b0b339faacdf8d2abe98718118e9d48
created_by: model
tags:
  - packaging
  - cli
  - mcp
---
`package.json` publishes two bin names from one build: `loafmd` → `dist/cli.js`, `loafmd-mcp` → `dist/mcp.js`. They're separate entrypoints, not a wrapper over a common main, because the MCP server must claim stdio immediately on process start — any early stdout from CLI argument parsing or commander help text would corrupt the JSON-RPC stream.

The package is named `loafmd` (not `loaf`) because the `loaf` slot on npm was taken. Internal module names, MCP tool names (`loaf.status`, `loaf.get`, …), and the `.loaf/` directory all keep the short form. Only the npm package and the CLI binary are suffixed.

The CLI exposes a `loafmd mcp` subcommand that dynamically `await import("./mcp.js")`. That's convenience only: `npx loafmd mcp` and `npx -y loafmd-mcp` are functionally identical once the module loads. Direct `loafmd-mcp` is preferred in MCP client config because it avoids commander's overhead and matches the binary name clients typically expect.

The MCP entrypoint resolves its target repo with this precedence: `--repo <path>` (or `-C <path>`), then `$LOAF_REPO`, then walking up from `cwd` looking for `.git/`. `loafmd init` prints a ready-to-paste config that always passes `--repo` explicitly, because clients differ on whether they honor `cwd` in server config.

Both entry files start with `#!/usr/bin/env node` and are marked executable by npm at pack time via `bin` declarations — you don't need to `chmod +x` manually. `"type": "module"` + `NodeNext` means every intra-package import uses explicit `.js` suffixes even in `.ts` source. Forgetting this breaks `tsc --build` output at runtime.

`tsconfig.json` excludes `src/**/*.test.ts` from the build. Tests run through `tsx` via the `node --test` loader, not through compiled output. Don't add test files to the published `dist/` tree by loosening the exclude.
