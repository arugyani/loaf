---
id: dual-binary-layout
title: Why there are two bin entries sharing one compiled tree
cited_files:
  - src/cli.ts
  - src/mcp.ts
  - package.json
  - tsconfig.json
last_baked_commit: afc58c7e8549da0a5ece78de3f508b1d042213a2
created_by: model
tags: [packaging, cli, mcp]
---

`package.json` publishes two bin names from one build: `loaf` → `dist/cli.js`, `loaf-mcp` → `dist/mcp.js`. They're separate entrypoints, not a wrapper over a common main, because the MCP server must claim stdio immediately on process start — any early stdout from CLI argument parsing or commander help text would corrupt the JSON-RPC stream.

The CLI exposes a `loaf mcp` subcommand that dynamically `await import("./mcp.js")`. That's convenience only: `npx loaf mcp` and `npx loaf-mcp` are functionally identical once the module loads. Direct `loaf-mcp` is preferred in MCP client config because it avoids commander's overhead and matches the binary name clients typically expect.

Both entry files start with `#!/usr/bin/env node` and are marked executable by npm at pack time via `bin` declarations — you don't need to `chmod +x` manually. `"type": "module"` + `NodeNext` means every intra-package import uses explicit `.js` suffixes even in `.ts` source. Forgetting this breaks `tsc --build` output at runtime.

`tsconfig.json` excludes `src/**/*.test.ts` from the build. Tests run through `tsx` via the `node --test` loader, not through compiled output. Don't add test files to the published `dist/` tree by loosening the exclude.
