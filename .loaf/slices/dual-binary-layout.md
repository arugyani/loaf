---
id: dual-binary-layout
title: Why there are two bin entries sharing one compiled tree
cited_files:
  - src/cli.ts
  - src/mcp.ts
  - package.json
  - tsconfig.json
last_baked_commit: 59c0c114a023d43f89bd7f7370426ec81954de05
created_by: model
tags:
  - packaging
  - cli
  - mcp
---
`package.json` publishes two bin names from one build: `loaf` → `dist/cli.js`, `loaf-mcp` → `dist/mcp.js`. They're separate entrypoints, not a wrapper over a common main, because the MCP server must claim stdio immediately on process start — any early stdout from CLI argument parsing or commander help text would corrupt the JSON-RPC stream.

Package name vs binary name is intentionally asymmetric: the npm package is `loafmd` (because the `loaf` slot on the registry was taken), but the bins, MCP tool names (`loaf.status`, `loaf.get`, …), and the on-disk `.loaf/` directory all use the short form. Only the npm package name carries the suffix.

This asymmetry propagates to the MCP config: `npx -y -p loafmd loaf-mcp --repo <path>`. The `-p loafmd` tells npx which npm package to resolve; `loaf-mcp` is the bin name inside it. Using `npx loaf-mcp` alone would fail — npx would look up `loaf-mcp` as a package, not find it, and error. If you rename either side, update `mcpConfigBlock` in `src/cli.ts` accordingly.

The CLI exposes a `loaf mcp` subcommand that dynamically `await import("./mcp.js")`. That's convenience only: `loaf mcp` and `loaf-mcp` are functionally identical once the module loads. Direct `loaf-mcp` is preferred in MCP client config because it avoids commander's overhead.

The MCP entrypoint resolves its target repo with this precedence: `--repo <path>` (or `-C <path>`), then `$LOAF_REPO`, then walking up from `cwd` looking for `.git/`. `loaf init` prints a ready-to-paste config that always passes `--repo` explicitly, because clients differ on whether they honor `cwd` in server config.

Both entry files start with `#!/usr/bin/env node` and are marked executable by npm at pack time via `bin` declarations — you don't need to `chmod +x` manually. `"type": "module"` + `NodeNext` means every intra-package import uses explicit `.js` suffixes even in `.ts` source. Forgetting this breaks `tsc --build` output at runtime.

`tsconfig.json` excludes `src/**/*.test.ts` from the build. Tests run through `tsx` via the `node --test` loader, not through compiled output. Don't add test files to the published `dist/` tree by loosening the exclude.
