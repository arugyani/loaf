#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { spawn } from "node:child_process";

import { findRepoRoot, resolveLoafPaths } from "./paths.js";
import { initLoaf } from "./init.js";
import {
  listSlices,
  getSliceById,
  writeSlice,
  updateSliceFrontmatter,
  deleteSlice,
} from "./slices.js";
import { checkStaleness } from "./staleness.js";
import { currentHead, shortHead, fileExistsInWorkingTree } from "./git.js";
import { writeIndex } from "./indexer.js";

const program = new Command();
program
  .name("loaf")
  .description("Git-native staleness layer for LLM coding context.")
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold .loaf/ in the current git repo and write AGENTS.md entry.")
  .action(async () => {
    const repoRoot = findRepoRoot();
    await initLoaf(repoRoot);
    console.log(`loaf initialized at ${path.join(repoRoot, ".loaf")}`);
    console.log("next: add to your MCP config:");
    console.log(`  command: npx loaf-mcp`);
    console.log(`  cwd: ${repoRoot}`);
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
