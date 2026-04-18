---
id: mcp-session-hint
title: How the MCP server injects a session hint on first tool call
cited_files:
  - src/mcp.ts
last_baked_commit: 57d8a2f74b0b339faacdf8d2abe98718118e9d48
created_by: model
tags:
  - mcp
  - discovery
  - design
---
The MCP server appends a one-shot "session hint" to the first tool response of each process lifetime. Implementation is a module-local mutable `sessionInitialized: boolean` flipped by `sessionHint()` on first call.

Why not infer this from protocol state (client info, initialize params, etc.)? Because clients differ — some reconnect mid-session, some don't send identifying metadata — and the guarantee we want is "the model sees the hint once early, not zero times and not on every call." Module-local state satisfies that exactly, at the cost of being reset per process. That's fine: MCP servers are per-repo per-session anyway.

The hint is appended, not prepended, so the tool's actual response stays scannable. It only fires on success responses (errors take the `isError` branch and skip it).

If you add a new tool, you get the session hint behavior for free because `sessionHint()` is called in the shared response path inside the `CallToolRequestSchema` handler, not per-handler. Don't duplicate the call into individual `handle*` functions.

Tool descriptions are the primary discovery channel. The hint is a backstop. The `AGENTS.md` entry written by `loaf init` is the tertiary layer. All three are intentional — models miss individual signals under pressure, so we repeat ourselves.
