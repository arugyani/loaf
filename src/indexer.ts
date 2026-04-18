import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { LoafIndex } from "./types.js";
import { resolveLoafPaths } from "./paths.js";
import { listSlices, listCrumbs, sliceSummary } from "./slices.js";

export async function buildIndex(repoRoot: string): Promise<LoafIndex> {
  const slices = await listSlices(repoRoot);
  const crumbs = await listCrumbs(repoRoot);
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    slices: slices.map(sliceSummary),
    crumbs: crumbs.map((c) => ({
      target: c.frontmatter.target,
      path: c.path,
      severity: c.frontmatter.severity,
      last_baked_commit: c.frontmatter.last_baked_commit,
    })),
  };
}

export async function writeIndex(repoRoot: string): Promise<LoafIndex> {
  const { loaf, index } = resolveLoafPaths(repoRoot);
  await fs.mkdir(loaf, { recursive: true });
  const idx = await buildIndex(repoRoot);
  // Strip absolute paths to repo-relative for portability.
  const rel = {
    ...idx,
    slices: idx.slices.map((s) => ({ ...s, path: path.relative(repoRoot, s.path) })),
    crumbs: idx.crumbs.map((c) => ({ ...c, path: path.relative(repoRoot, c.path) })),
  };
  await fs.writeFile(index, JSON.stringify(rel, null, 2) + "\n", "utf8");
  return idx;
}

export async function readIndex(repoRoot: string): Promise<LoafIndex | null> {
  const { index } = resolveLoafPaths(repoRoot);
  if (!fsSync.existsSync(index)) return null;
  const raw = await fs.readFile(index, "utf8");
  return JSON.parse(raw) as LoafIndex;
}
