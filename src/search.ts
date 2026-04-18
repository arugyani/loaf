import { listSlices } from "./slices.js";
import type { Slice } from "./types.js";

export type SearchHit = {
  slice: Slice;
  score: number;
  matches: string[];
};

/**
 * Tiny, dependency-free fuzzy search over title, tags, cited_files, and body.
 * Score is a weighted sum of token hits. Good enough for a few hundred slices.
 */
export async function searchSlices(
  repoRoot: string,
  query: string,
  limit = 10,
): Promise<SearchHit[]> {
  const slices = await listSlices(repoRoot);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const slice of slices) {
    const title = slice.frontmatter.title.toLowerCase();
    const tags = (slice.frontmatter.tags ?? []).join(" ").toLowerCase();
    const cited = slice.frontmatter.cited_files.join(" ").toLowerCase();
    const body = slice.body.toLowerCase();
    const id = slice.frontmatter.id.toLowerCase();

    let score = 0;
    const matches: string[] = [];
    for (const t of tokens) {
      let local = 0;
      if (id.includes(t)) local += 6;
      if (title.includes(t)) local += 5;
      if (tags.includes(t)) local += 3;
      if (cited.includes(t)) local += 2;
      if (body.includes(t)) local += 1;
      if (local > 0) matches.push(t);
      score += local;
    }
    if (score > 0) hits.push({ slice, score, matches });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}
