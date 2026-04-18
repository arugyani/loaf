import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type {
  Slice,
  SliceFrontmatter,
  SliceSummary,
  Crumb,
  CrumbFrontmatter,
} from "./types.js";
import { resolveLoafPaths, slugify, fileSlug } from "./paths.js";

function dump(fm: Record<string, unknown>, body: string): string {
  // js-yaml refuses to serialize `undefined`, so strip those keys before
  // stringify. Spread of a Partial<T> can leave `key: undefined` behind.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) if (v !== undefined) cleaned[k] = v;
  return matter.stringify(body.endsWith("\n") ? body : body + "\n", cleaned);
}

export async function readSlice(filePath: string): Promise<Slice> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Partial<SliceFrontmatter>;
  if (!fm.id || !fm.title || !Array.isArray(fm.cited_files) || !fm.last_baked_commit) {
    throw new Error(`Malformed slice frontmatter at ${filePath}`);
  }
  return {
    frontmatter: {
      id: fm.id,
      title: fm.title,
      cited_files: fm.cited_files,
      last_accessed: fm.last_accessed,
      last_baked_commit: fm.last_baked_commit,
      created_by: (fm.created_by as SliceFrontmatter["created_by"]) ?? "human",
      tags: fm.tags ?? [],
    },
    body: parsed.content.trim(),
    path: filePath,
  };
}

export async function listSliceFiles(repoRoot: string): Promise<string[]> {
  const { slices } = resolveLoafPaths(repoRoot);
  if (!fsSync.existsSync(slices)) return [];
  const entries = await fs.readdir(slices, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(slices, e.name))
    .sort();
}

export async function listSlices(repoRoot: string): Promise<Slice[]> {
  const files = await listSliceFiles(repoRoot);
  const out: Slice[] = [];
  for (const f of files) {
    try {
      out.push(await readSlice(f));
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function sliceSummary(slice: Slice): SliceSummary {
  return {
    id: slice.frontmatter.id,
    title: slice.frontmatter.title,
    tags: slice.frontmatter.tags ?? [],
    cited_files: slice.frontmatter.cited_files,
    last_baked_commit: slice.frontmatter.last_baked_commit,
    path: slice.path,
  };
}

export async function getSliceById(repoRoot: string, id: string): Promise<Slice | null> {
  const files = await listSliceFiles(repoRoot);
  for (const f of files) {
    try {
      const s = await readSlice(f);
      if (s.frontmatter.id === id) return s;
    } catch {}
  }
  return null;
}

export async function uniqueSliceId(repoRoot: string, base: string): Promise<string> {
  const slug = slugify(base);
  const existing = new Set((await listSlices(repoRoot)).map((s) => s.frontmatter.id));
  if (!existing.has(slug)) return slug;
  let i = 2;
  while (existing.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

export type WriteSliceInput = {
  repoRoot: string;
  id?: string;
  title: string;
  body: string;
  cited_files: string[];
  tags?: string[];
  last_baked_commit: string;
  created_by: "model" | "human";
};

export async function writeSlice(input: WriteSliceInput): Promise<Slice> {
  const { slices } = resolveLoafPaths(input.repoRoot);
  await fs.mkdir(slices, { recursive: true });
  const id = input.id ?? (await uniqueSliceId(input.repoRoot, input.title));
  const fm: SliceFrontmatter = {
    id,
    title: input.title,
    cited_files: input.cited_files,
    last_accessed: new Date().toISOString(),
    last_baked_commit: input.last_baked_commit,
    created_by: input.created_by,
    tags: input.tags ?? [],
  };
  const filePath = path.join(slices, `${id}.md`);
  await fs.writeFile(filePath, dump(fm, input.body), "utf8");
  return { frontmatter: fm, body: input.body.trim(), path: filePath };
}

export async function updateSliceFrontmatter(
  slice: Slice,
  patch: Partial<SliceFrontmatter>,
): Promise<Slice> {
  const fm: SliceFrontmatter = { ...slice.frontmatter, ...patch };
  await fs.writeFile(slice.path, dump(fm, slice.body), "utf8");
  return { ...slice, frontmatter: fm };
}

export async function deleteSlice(slice: Slice): Promise<void> {
  await fs.unlink(slice.path);
}

// ----- Crumbs -----

export async function readCrumb(filePath: string): Promise<Crumb> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Partial<CrumbFrontmatter>;
  if (!fm.target || !fm.last_baked_commit) {
    throw new Error(`Malformed crumb frontmatter at ${filePath}`);
  }
  return {
    frontmatter: {
      target: fm.target,
      severity: (fm.severity as CrumbFrontmatter["severity"]) ?? "warning",
      last_baked_commit: fm.last_baked_commit,
    },
    body: parsed.content.trim(),
    path: filePath,
  };
}

export async function listCrumbFiles(repoRoot: string): Promise<string[]> {
  const { crumbs } = resolveLoafPaths(repoRoot);
  if (!fsSync.existsSync(crumbs)) return [];
  const entries = await fs.readdir(crumbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(crumbs, e.name))
    .sort();
}

export async function listCrumbs(repoRoot: string): Promise<Crumb[]> {
  const files = await listCrumbFiles(repoRoot);
  const out: Crumb[] = [];
  for (const f of files) {
    try {
      out.push(await readCrumb(f));
    } catch {}
  }
  return out;
}

export type WriteCrumbInput = {
  repoRoot: string;
  target: string;
  body: string;
  severity?: CrumbFrontmatter["severity"];
  last_baked_commit: string;
};

export async function writeCrumb(input: WriteCrumbInput): Promise<Crumb> {
  const { crumbs } = resolveLoafPaths(input.repoRoot);
  await fs.mkdir(crumbs, { recursive: true });
  const base = fileSlug(input.target);
  const existingForTarget = (await listCrumbs(input.repoRoot)).filter(
    (c) => c.frontmatter.target === input.target,
  );
  const suffix = existingForTarget.length === 0 ? "" : `-${existingForTarget.length + 1}`;
  const filePath = path.join(crumbs, `${base}${suffix}.md`);
  const fm: CrumbFrontmatter = {
    target: input.target,
    severity: input.severity ?? "warning",
    last_baked_commit: input.last_baked_commit,
  };
  await fs.writeFile(filePath, dump(fm, input.body), "utf8");
  return { frontmatter: fm, body: input.body.trim(), path: filePath };
}
