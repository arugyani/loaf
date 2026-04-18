#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRepoRoot } from "./paths.js";

function packageVersion(): string {
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
import {
  listSlices,
  getSliceById,
  writeSlice,
  writeCrumb,
  updateSliceFrontmatter,
  sliceSummary,
  readSlice,
} from "./slices.js";
import { checkStaleness, stalenessBanner } from "./staleness.js";
import { searchSlices } from "./search.js";
import { writeIndex } from "./indexer.js";
import { currentHead, shortHead } from "./git.js";
import type { Slice } from "./types.js";

function resolveRepoRoot(): string {
  // Precedence: --repo flag, $LOAF_REPO env, walk up from cwd.
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--repo" || a === "-C");
  if (idx !== -1 && args[idx + 1]) return path.resolve(args[idx + 1]!);
  const eq = args.find((a) => a.startsWith("--repo="));
  if (eq) return path.resolve(eq.slice("--repo=".length));
  if (process.env.LOAF_REPO) return path.resolve(process.env.LOAF_REPO);
  return findRepoRoot();
}

const repoRoot = resolveRepoRoot();

let sessionInitialized = false;

function sessionHint(): string {
  if (sessionInitialized) return "";
  sessionInitialized = true;
  return [
    "",
    "---",
    "[loaf: session hint] This repo has a Loaf knowledge layer. Start with `loaf.status` or `loaf.list`",
    "to see what slices exist. Prefer `loaf.search` / `loaf.get` over reading source files for",
    "architectural or \"why does this work this way\" questions.",
  ].join("\n");
}

const tools: Tool[] = [
  {
    name: "loaf.status",
    description:
      "High-level picture of the Loaf knowledge layer for this repo: total slices, stale count, and the most recently baked slices. Call this at the start of a session to know what exists.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "loaf.list",
    description:
      "List slice summaries (id, title, tags, cited_files). Lightweight — does not load slice bodies. Use this to survey what knowledge exists before deciding what to read in full.",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by a tag." },
        stale: {
          type: "boolean",
          description: "If true, return only stale slices. If false, only fresh.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "loaf.search",
    description:
      "Fuzzy search across slice titles, tags, cited files, and bodies. Prefer this over reading source files when answering architectural or conceptual questions about this codebase. Returns top matches with freshness status.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "loaf.get",
    description:
      "Fetch a specific slice by id. Returns the body, plus a staleness banner if any cited file has changed since the slice was last baked. Updates last_accessed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "loaf.record_learning",
    description:
      "Save a new slice at the moment you recognize a non-obvious pattern worth remembering. Call this after recovering from a mistake or discovering a gotcha. Creates a slice anchored to the current HEAD commit.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: {
          type: "string",
          description:
            "Dense markdown prose. One concept. Written for a future model session. Include the why, not just the what.",
        },
        cited_files: {
          type: "array",
          items: { type: "string" },
          description: "Repo-relative paths this knowledge depends on.",
        },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body", "cited_files"],
      additionalProperties: false,
    },
  },
  {
    name: "loaf.add_crumb",
    description:
      "Attach a localized warning to a specific file. Use when a file has a subtle gotcha that any future session touching it should know about.",
    inputSchema: {
      type: "object",
      properties: {
        target_file: { type: "string" },
        body: { type: "string" },
        severity: {
          type: "string",
          enum: ["info", "warning", "critical"],
          default: "warning",
        },
      },
      required: ["target_file", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "loaf.bake",
    description:
      "Mark a stale slice fresh at the current HEAD commit. Call this only after validating the slice's content against current code. If the slice is wrong, use loaf.record_learning to overwrite it instead.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: "loaf", version: packageVersion() },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    const text = await dispatch(name, args);
    return { content: [{ type: "text", text: text + sessionHint() }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `loaf error: ${message}` }],
    };
  }
});

async function dispatch(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "loaf.status":
      return await handleStatus();
    case "loaf.list":
      return await handleList(args.tag as string | undefined, args.stale as boolean | undefined);
    case "loaf.search":
      return await handleSearch(String(args.query), Number(args.limit ?? 10));
    case "loaf.get":
      return await handleGet(String(args.id));
    case "loaf.record_learning":
      return await handleRecord(
        String(args.title),
        String(args.body),
        (args.cited_files as string[]) ?? [],
        (args.tags as string[]) ?? [],
      );
    case "loaf.add_crumb":
      return await handleCrumb(
        String(args.target_file),
        String(args.body),
        (args.severity as "info" | "warning" | "critical") ?? "warning",
      );
    case "loaf.bake":
      return await handleBake(String(args.id));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function stalenessFor(slice: Slice) {
  return await checkStaleness(slice, repoRoot);
}

async function handleStatus(): Promise<string> {
  const slices = await listSlices(repoRoot);
  let stale = 0;
  for (const s of slices) {
    const r = await stalenessFor(s);
    if (r.stale) stale++;
  }
  const recent = [...slices]
    .sort((a, b) => (b.frontmatter.last_accessed ?? "").localeCompare(a.frontmatter.last_accessed ?? ""))
    .slice(0, 5)
    .map((s) => `- ${s.frontmatter.id} — ${s.frontmatter.title}`);
  const head = await shortHead(repoRoot);
  return [
    `Loaf status @ ${head}`,
    `total: ${slices.length}  stale: ${stale}  fresh: ${slices.length - stale}`,
    "",
    "recent slices:",
    ...(recent.length ? recent : ["(none yet — use loaf.record_learning to save a pattern)"]),
  ].join("\n");
}

async function handleList(tag?: string, staleFilter?: boolean): Promise<string> {
  const slices = await listSlices(repoRoot);
  const rows: string[] = [];
  for (const s of slices) {
    if (tag && !(s.frontmatter.tags ?? []).includes(tag)) continue;
    const r = await stalenessFor(s);
    if (staleFilter === true && !r.stale) continue;
    if (staleFilter === false && r.stale) continue;
    const status = r.stale ? "STALE" : "fresh";
    const tags = (s.frontmatter.tags ?? []).join(",");
    rows.push(
      `- [${status}] ${s.frontmatter.id} — ${s.frontmatter.title}` +
        (tags ? ` (tags: ${tags})` : "") +
        `  [cites: ${s.frontmatter.cited_files.join(", ")}]`,
    );
  }
  if (rows.length === 0) return "(no matching slices)";
  return rows.join("\n");
}

async function handleSearch(query: string, limit: number): Promise<string> {
  const hits = await searchSlices(repoRoot, query, limit);
  if (hits.length === 0) return `(no hits for "${query}")`;
  const lines: string[] = [`search "${query}" — ${hits.length} hit(s)`, ""];
  for (const h of hits) {
    const r = await stalenessFor(h.slice);
    const status = r.stale ? "STALE" : "fresh";
    lines.push(
      `- [${status}] ${h.slice.frontmatter.id} — ${h.slice.frontmatter.title} (score ${h.score})`,
    );
  }
  lines.push("", "Use loaf.get <id> to read a full slice.");
  return lines.join("\n");
}

async function handleGet(id: string): Promise<string> {
  const slice = await getSliceById(repoRoot, id);
  if (!slice) throw new Error(`slice not found: ${id}`);
  const fresh = await updateSliceFrontmatter(slice, {
    last_accessed: new Date().toISOString(),
  });
  // Re-read to compute staleness against persisted state.
  const result = await checkStaleness(await readSlice(fresh.path), repoRoot);
  const header = [
    `# ${fresh.frontmatter.title}`,
    `id: ${fresh.frontmatter.id}`,
    `cited_files: ${fresh.frontmatter.cited_files.join(", ")}`,
    `baked at: ${fresh.frontmatter.last_baked_commit.slice(0, 7)}  created_by: ${fresh.frontmatter.created_by}`,
    "",
  ].join("\n");
  const banner = stalenessBanner(result);
  return header + banner + fresh.body;
}

async function handleRecord(
  title: string,
  body: string,
  cited_files: string[],
  tags: string[],
): Promise<string> {
  if (!title.trim()) throw new Error("title required");
  if (!body.trim()) throw new Error("body required");
  if (!Array.isArray(cited_files) || cited_files.length === 0) {
    throw new Error("cited_files required — slices must be anchored to at least one file");
  }
  const head = await currentHead(repoRoot);
  const slice = await writeSlice({
    repoRoot,
    title,
    body,
    cited_files,
    tags,
    last_baked_commit: head,
    created_by: "model",
  });
  await writeIndex(repoRoot);
  return `recorded slice: ${slice.frontmatter.id}\n  at: ${slice.path}\n  baked: ${head.slice(0, 7)}`;
}

async function handleCrumb(
  target_file: string,
  body: string,
  severity: "info" | "warning" | "critical",
): Promise<string> {
  if (!target_file.trim()) throw new Error("target_file required");
  if (!body.trim()) throw new Error("body required");
  const head = await currentHead(repoRoot);
  const crumb = await writeCrumb({
    repoRoot,
    target: target_file,
    body,
    severity,
    last_baked_commit: head,
  });
  await writeIndex(repoRoot);
  return `crumb added on ${target_file}\n  at: ${crumb.path}\n  severity: ${severity}`;
}

async function handleBake(id: string): Promise<string> {
  const slice = await getSliceById(repoRoot, id);
  if (!slice) throw new Error(`slice not found: ${id}`);
  const head = await currentHead(repoRoot);
  await updateSliceFrontmatter(slice, { last_baked_commit: head });
  await writeIndex(repoRoot);
  return `baked ${id} at ${head.slice(0, 7)}`;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
