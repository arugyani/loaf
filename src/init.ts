import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { resolveLoafPaths } from "./paths.js";
import { writeIndex } from "./indexer.js";
import type { LoafConfig } from "./types.js";

const AGENTS_SECTION = `\n## Loaf knowledge layer\n\nThis repo uses [loafmd](https://github.com/arugyani/loaf) to track atomic, model-curated knowledge slices under \`.loaf/\`, exposed via the MCP tools \`loaf.*\`.\n\n- Prefer \`loaf.search\` and \`loaf.get\` over reading raw source files when answering architectural or \"why is this done this way\" questions.\n- Call \`loaf.status\` at the start of a session to see what exists and what is stale.\n- When you recover from a mistake or learn a non-obvious pattern, call \`loaf.record_learning\` to save it.\n- Validate stale slices against current code, then call \`loaf.bake\` to mark them fresh.\n`;

const GITKEEP = "";

const README_BLURB = `# .loaf/\n\nAtomic knowledge slices and per-file crumbs used by the Loaf MCP server.\n\n- \`slices/\` — one concept per markdown file, frontmatter-anchored to a git commit.\n- \`crumbs/\` — localized warnings about specific files.\n- \`index.json\` — auto-generated lookup cache. Do not edit by hand.\n- \`config.json\` — project-level Loaf configuration.\n\nSlices and crumbs are meant to be committed alongside code. Staleness is computed at read time by diffing against \`last_baked_commit\`.\n`;

export async function initLoaf(repoRoot: string, opts: { version?: string } = {}): Promise<void> {
  const paths = resolveLoafPaths(repoRoot);
  await fs.mkdir(paths.loaf, { recursive: true });
  await fs.mkdir(paths.slices, { recursive: true });
  await fs.mkdir(paths.crumbs, { recursive: true });

  await fs.writeFile(path.join(paths.slices, ".gitkeep"), GITKEEP);
  await fs.writeFile(path.join(paths.crumbs, ".gitkeep"), GITKEEP);

  const readmePath = path.join(paths.loaf, "README.md");
  if (!fsSync.existsSync(readmePath)) {
    await fs.writeFile(readmePath, README_BLURB, "utf8");
  }

  const config: LoafConfig = {
    version: opts.version ?? "0.1.0",
    crumb_cap_per_file: 5,
  };
  if (!fsSync.existsSync(paths.config)) {
    await fs.writeFile(paths.config, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  await writeIndex(repoRoot);
  await ensureAgentsEntry(repoRoot);
}

async function ensureAgentsEntry(repoRoot: string): Promise<void> {
  const agents = path.join(repoRoot, "AGENTS.md");
  if (fsSync.existsSync(agents)) {
    const current = await fs.readFile(agents, "utf8");
    if (current.includes("Loaf knowledge layer")) return;
    await fs.writeFile(agents, current.trimEnd() + "\n" + AGENTS_SECTION, "utf8");
    return;
  }
  const content = `# Agents\n${AGENTS_SECTION}`;
  await fs.writeFile(agents, content, "utf8");
}
