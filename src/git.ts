import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit } from "./types.js";

const execFileP = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git ${args.join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

export async function currentHead(cwd: string): Promise<string> {
  const out = await git(["rev-parse", "HEAD"], cwd);
  return out.trim();
}

export async function shortHead(cwd: string): Promise<string> {
  const out = await git(["rev-parse", "--short", "HEAD"], cwd);
  return out.trim();
}

export async function commitExists(cwd: string, sha: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function commitsSince(
  cwd: string,
  baseCommit: string,
  file: string,
): Promise<GitCommit[]> {
  const out = await git(
    ["log", `${baseCommit}..HEAD`, "--pretty=format:%H%x1f%s", "--", file],
    cwd,
  );
  const lines = out.split("\n").filter(Boolean);
  return lines.map((line) => {
    const [sha, subject] = line.split("\x1f");
    return { sha, subject: subject ?? "", file };
  });
}

export async function fileExistsInWorkingTree(cwd: string, file: string): Promise<boolean> {
  try {
    const out = await git(["ls-files", "--error-unmatch", "--", file], cwd);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
