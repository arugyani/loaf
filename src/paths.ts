import path from "node:path";
import fs from "node:fs";

export const LOAF_DIR = ".loaf";
export const SLICES_DIR = "slices";
export const CRUMBS_DIR = "crumbs";
export const INDEX_FILE = "index.json";
export const CONFIG_FILE = "config.json";

export type LoafPaths = {
  root: string;
  loaf: string;
  slices: string;
  crumbs: string;
  index: string;
  config: string;
};

export function resolveLoafPaths(repoRoot: string): LoafPaths {
  const loaf = path.join(repoRoot, LOAF_DIR);
  return {
    root: repoRoot,
    loaf,
    slices: path.join(loaf, SLICES_DIR),
    crumbs: path.join(loaf, CRUMBS_DIR),
    index: path.join(loaf, INDEX_FILE),
    config: path.join(loaf, CONFIG_FILE),
  };
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find a git repo from ${startDir}. Loaf needs to live inside a git repository.`,
      );
    }
    dir = parent;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "slice";
}

export function fileSlug(filePath: string): string {
  return filePath.replace(/^\.?\//, "").replace(/[\\/]/g, "-").replace(/\./g, "-");
}
