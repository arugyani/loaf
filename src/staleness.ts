import type { Slice, StalenessResult, GitCommit } from "./types.js";
import * as git from "./git.js";

/**
 * Checks whether a slice is stale relative to its cited files.
 *
 * Rules:
 *  - If `last_baked_commit` is unknown to the repo, treat as stale (commit-missing).
 *  - If `last_baked_commit` is not an ancestor of HEAD (force push / rebase), stale (not-ancestor).
 *  - Otherwise, for each cited file, check `git log <baked>..HEAD -- <file>`.
 *    If any commits exist, the slice is stale and we return the changed files + commits.
 */
export async function checkStaleness(slice: Slice, cwd: string): Promise<StalenessResult> {
  const baked = slice.frontmatter.last_baked_commit;
  const empty: StalenessResult = { stale: false, changed_files: [], commits: [] };

  if (!baked) {
    return { stale: true, changed_files: [], commits: [], reason: "commit-missing" };
  }

  if (!(await git.commitExists(cwd, baked))) {
    return { stale: true, changed_files: [], commits: [], reason: "commit-missing" };
  }

  const head = await git.currentHead(cwd);
  if (!(await git.isAncestor(cwd, baked, head))) {
    return { stale: true, changed_files: [], commits: [], reason: "not-ancestor" };
  }

  const changed: string[] = [];
  const commits: GitCommit[] = [];
  for (const file of slice.frontmatter.cited_files) {
    const cs = await git.commitsSince(cwd, baked, file);
    if (cs.length > 0) {
      changed.push(file);
      commits.push(...cs);
    }
  }

  if (changed.length > 0) {
    return { stale: true, changed_files: changed, commits, reason: "file-changed" };
  }
  return empty;
}

export function stalenessBanner(result: StalenessResult): string {
  if (!result.stale) return "";
  if (result.reason === "commit-missing") {
    return [
      "> [loaf: STALE] The baked commit is unknown to this repo (shallow clone or amended history).",
      "> Validate this slice against current code, then call `loaf.bake` or overwrite with `loaf.record_learning`.",
      "",
    ].join("\n");
  }
  if (result.reason === "not-ancestor") {
    return [
      "> [loaf: STALE] History diverged from the baked commit (force push / rebase).",
      "> Validate this slice, then call `loaf.bake` to re-anchor, or `loaf.record_learning` to rewrite.",
      "",
    ].join("\n");
  }
  const lines = ["> [loaf: STALE] Cited files changed since this slice was baked:", ">"];
  for (const f of result.changed_files) {
    const fileCommits = result.commits.filter((c) => c.file === f);
    lines.push(`> - \`${f}\``);
    for (const c of fileCommits.slice(0, 5)) {
      lines.push(`>   - ${c.sha.slice(0, 7)} ${c.subject}`);
    }
    if (fileCommits.length > 5) lines.push(`>   - …and ${fileCommits.length - 5} more`);
  }
  lines.push(
    ">",
    "> After validating against current code, call `loaf.bake` to mark fresh,",
    "> or `loaf.record_learning` to replace with a corrected slice.",
    "",
  );
  return lines.join("\n");
}
