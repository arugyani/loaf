#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";

import { findRepoRoot, resolveLoafPaths } from "./paths.js";
import { initLoaf } from "./init.js";
import {
  listSlices,
  listCrumbs,
  getSliceById,
  writeSlice,
  updateSliceFrontmatter,
  deleteSlice,
} from "./slices.js";
import { checkStaleness } from "./staleness.js";
import { currentHead, shortHead, fileExistsInWorkingTree } from "./git.js";
import { writeIndex } from "./indexer.js";

function mcpConfigBlock(repoRoot: string): string {
  // `npx -y -p loafmd loaf-mcp` tells npx: install the package `loafmd`
  // (not `loaf-mcp`, which is the bin name), then run its `loaf-mcp` bin.
  return JSON.stringify(
    {
      mcpServers: {
        loaf: {
          command: "npx",
          args: ["-y", "-p", "loafmd", "loaf-mcp", "--repo", repoRoot],
        },
      },
    },
    null,
    2,
  );
}

function packageVersion(): string {
  // Read from the installed package.json so `loaf --version` never drifts
  // from whatever npm thinks this install is. Walk up from this file —
  // works both in `dist/` (sibling of package.json) and in local dev.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, "utf8")).version ?? "unknown";
      } catch {
        return "unknown";
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

const program = new Command();
program
  .name("loaf")
  .description("Git-native staleness layer for LLM coding context. (npm package: loafmd)")
  .version(packageVersion());

program
  .command("init")
  .description("Scaffold .loaf/ in the current git repo and write AGENTS.md entry.")
  .action(async () => {
    const repoRoot = findRepoRoot();
    await initLoaf(repoRoot);
    console.log(`loaf initialized at ${path.join(repoRoot, ".loaf")}`);
    console.log("");
    console.log("Add this to your MCP client config (Claude Desktop, Cursor, etc.):");
    console.log("");
    console.log(mcpConfigBlock(repoRoot));
    console.log("");
    console.log("Then restart your agent. Run `loaf doctor` to verify the setup.");
  });

program
  .command("doctor")
  .description("Verify git, .loaf/ shape, and print the MCP invocation.")
  .action(async () => {
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    let repoRoot: string | null = null;
    try {
      repoRoot = findRepoRoot();
      checks.push({ name: "git repo", ok: true, detail: repoRoot });
    } catch (e) {
      checks.push({ name: "git repo", ok: false, detail: (e as Error).message });
    }
    try {
      const out = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
      checks.push({ name: "git binary", ok: true, detail: out });
    } catch {
      checks.push({ name: "git binary", ok: false, detail: "git not found on PATH" });
    }
    if (repoRoot) {
      const paths = resolveLoafPaths(repoRoot);
      for (const [label, p] of [
        [".loaf/", paths.loaf],
        [".loaf/slices/", paths.slices],
        [".loaf/crumbs/", paths.crumbs],
        [".loaf/config.json", paths.config],
        [".loaf/index.json", paths.index],
      ] as const) {
        checks.push({ name: label, ok: fs.existsSync(p), detail: p });
      }
      const slices = await listSlices(repoRoot);
      const crumbs = await listCrumbs(repoRoot);
      checks.push({
        name: "slice/crumb count",
        ok: true,
        detail: `${slices.length} slice(s), ${crumbs.length} crumb(s)`,
      });
    }
    for (const c of checks) {
      console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (repoRoot) {
      console.log("");
      console.log("MCP config block:");
      console.log(mcpConfigBlock(repoRoot));
    }
    if (checks.some((c) => !c.ok)) process.exit(1);
  });

program
  .command("status")
  .description("Show stale/fresh counts and recent slices.")
  .action(async () => {
    const repoRoot = findRepoRoot();
    const slices = await listSlices(repoRoot);
    let stale = 0;
    const rows: string[] = [];
    for (const s of slices) {
      const r = await checkStaleness(s, repoRoot);
      if (r.stale) stale++;
      const tag = r.stale ? "STALE" : "fresh";
      rows.push(`  [${tag}] ${s.frontmatter.id} — ${s.frontmatter.title}`);
    }
    const head = await shortHead(repoRoot);
    console.log(`loaf @ ${head}`);
    console.log(`  total: ${slices.length}  stale: ${stale}  fresh: ${slices.length - stale}`);
    if (rows.length) {
      console.log("");
      for (const r of rows) console.log(r);
    }
  });

program
  .command("bake <id>")
  .description("Mark a slice fresh at current HEAD.")
  .action(async (id: string) => {
    const repoRoot = findRepoRoot();
    const slice = await getSliceById(repoRoot, id);
    if (!slice) {
      console.error(`slice not found: ${id}`);
      process.exit(1);
    }
    const head = await currentHead(repoRoot);
    await updateSliceFrontmatter(slice, { last_baked_commit: head });
    await writeIndex(repoRoot);
    console.log(`baked ${id} at ${head.slice(0, 7)}`);
  });

program
  .command("add")
  .description("Scaffold a new slice and open it in $EDITOR.")
  .option("-t, --title <title>", "slice title")
  .option("-f, --file <path...>", "cited file(s)")
  .option("--tag <tag...>", "tags")
  .option("--no-edit", "do not launch $EDITOR")
  .action(async (opts: { title?: string; file?: string[]; tag?: string[]; edit: boolean }) => {
    const repoRoot = findRepoRoot();
    const title = opts.title ?? "New slice";
    const cited = opts.file ?? [];
    if (cited.length === 0) {
      console.error("at least one --file is required");
      process.exit(1);
    }
    const head = await currentHead(repoRoot);
    const slice = await writeSlice({
      repoRoot,
      title,
      body: "Replace this with dense markdown prose. One concept. Written for a model.",
      cited_files: cited,
      tags: opts.tag ?? [],
      last_baked_commit: head,
      created_by: "human",
    });
    await writeIndex(repoRoot);
    console.log(`created ${slice.path}`);
    if (opts.edit !== false) {
      const editor = process.env.EDITOR || process.env.VISUAL;
      if (editor) {
        await new Promise<void>((resolve) => {
          const child = spawn(editor, [slice.path], { stdio: "inherit" });
          child.on("close", () => resolve());
        });
      } else {
        console.log("(set $EDITOR to open automatically)");
      }
    }
  });

program
  .command("prune")
  .description("Remove slices whose cited_files no longer exist in the working tree.")
  .option("--dry-run", "show what would be removed without deleting")
  .action(async (opts: { dryRun?: boolean }) => {
    const repoRoot = findRepoRoot();
    const slices = await listSlices(repoRoot);
    let removed = 0;
    for (const s of slices) {
      const checks = await Promise.all(
        s.frontmatter.cited_files.map((f) =>
          fileExistsInWorkingTree(repoRoot, f).then((exists) => ({ f, exists })),
        ),
      );
      const allGone = checks.every((c) => !c.exists);
      if (!allGone) continue;
      const missing = checks.map((c) => c.f).join(", ");
      if (opts.dryRun) {
        console.log(`would remove ${s.frontmatter.id} (no cited files: ${missing})`);
      } else {
        await deleteSlice(s);
        console.log(`removed ${s.frontmatter.id} (no cited files: ${missing})`);
      }
      removed++;
    }
    if (!opts.dryRun) await writeIndex(repoRoot);
    console.log(`pruned ${removed} slice(s)`);
  });

program
  .command("reindex")
  .description("Rebuild .loaf/index.json from slices and crumbs on disk.")
  .action(async () => {
    const repoRoot = findRepoRoot();
    const idx = await writeIndex(repoRoot);
    console.log(`wrote ${resolveLoafPaths(repoRoot).index}`);
    console.log(`  slices: ${idx.slices.length}  crumbs: ${idx.crumbs.length}`);
  });

program
  .command("mcp")
  .description("Start the Loaf MCP server over stdio.")
  .action(async () => {
    // Delegate to the MCP entrypoint in-process.
    await import("./mcp.js");
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
