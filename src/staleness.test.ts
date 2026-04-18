import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { checkStaleness, stalenessBanner } from "./staleness.js";
import { writeSlice, readSlice } from "./slices.js";
import { currentHead } from "./git.js";
import { initLoaf } from "./init.js";

const execFileP = promisify(execFile);

async function sh(cwd: string, cmd: string, args: string[]): Promise<void> {
  await execFileP(cmd, args, { cwd });
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loaf-test-"));
  await sh(dir, "git", ["init", "-q", "-b", "main"]);
  await sh(dir, "git", ["config", "user.email", "t@t.test"]);
  await sh(dir, "git", ["config", "user.name", "T"]);
  await sh(dir, "git", ["config", "commit.gpgsign", "false"]);
  return dir;
}

async function commitFile(dir: string, rel: string, body: string, msg: string): Promise<void> {
  const full = path.join(dir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf8");
  await sh(dir, "git", ["add", rel]);
  await sh(dir, "git", ["commit", "-q", "-m", msg]);
}

test("fresh slice — no cited file changed since baked commit", async () => {
  const dir = await makeRepo();
  await commitFile(dir, "src/auth.ts", "export const x = 1;\n", "init");
  await initLoaf(dir);
  const baked = await currentHead(dir);
  const slice = await writeSlice({
    repoRoot: dir,
    title: "Auth",
    body: "The auth module.",
    cited_files: ["src/auth.ts"],
    last_baked_commit: baked,
    created_by: "human",
  });
  const result = await checkStaleness(await readSlice(slice.path), dir);
  assert.equal(result.stale, false);
  assert.deepEqual(result.changed_files, []);
});

test("stale slice — cited file changed after baked commit", async () => {
  const dir = await makeRepo();
  await commitFile(dir, "src/auth.ts", "export const x = 1;\n", "init");
  await initLoaf(dir);
  const baked = await currentHead(dir);
  const slice = await writeSlice({
    repoRoot: dir,
    title: "Auth",
    body: "The auth module.",
    cited_files: ["src/auth.ts"],
    last_baked_commit: baked,
    created_by: "human",
  });
  await commitFile(dir, "src/auth.ts", "export const x = 2;\n", "bump");
  const result = await checkStaleness(await readSlice(slice.path), dir);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "file-changed");
  assert.deepEqual(result.changed_files, ["src/auth.ts"]);
  assert.equal(result.commits.length, 1);
  assert.match(result.commits[0]!.subject, /bump/);
});

test("stale slice — multi-file, reports only files that actually changed", async () => {
  const dir = await makeRepo();
  await commitFile(dir, "src/a.ts", "a\n", "init a");
  await commitFile(dir, "src/b.ts", "b\n", "init b");
  await initLoaf(dir);
  const baked = await currentHead(dir);
  const slice = await writeSlice({
    repoRoot: dir,
    title: "Both",
    body: ".",
    cited_files: ["src/a.ts", "src/b.ts"],
    last_baked_commit: baked,
    created_by: "human",
  });
  await commitFile(dir, "src/b.ts", "b2\n", "b change");
  const result = await checkStaleness(await readSlice(slice.path), dir);
  assert.equal(result.stale, true);
  assert.deepEqual(result.changed_files, ["src/b.ts"]);
});

test("stale slice — baked commit unknown (commit-missing)", async () => {
  const dir = await makeRepo();
  await commitFile(dir, "src/a.ts", "a\n", "init");
  await initLoaf(dir);
  const slice = await writeSlice({
    repoRoot: dir,
    title: "A",
    body: ".",
    cited_files: ["src/a.ts"],
    last_baked_commit: "0000000000000000000000000000000000000000",
    created_by: "human",
  });
  const result = await checkStaleness(await readSlice(slice.path), dir);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "commit-missing");
});

test("stale slice — baked commit not an ancestor of HEAD (rebase / force push)", async () => {
  const dir = await makeRepo();
  await commitFile(dir, "src/a.ts", "a\n", "init");
  await sh(dir, "git", ["checkout", "-q", "-b", "feature"]);
  await commitFile(dir, "src/a.ts", "a2\n", "feature work");
  await initLoaf(dir);
  const orphan = await currentHead(dir);
  // Abandon the feature commit by resetting main to where it was.
  await sh(dir, "git", ["checkout", "-q", "main"]);
  await commitFile(dir, "src/a.ts", "a3\n", "main moves on");
  const slice = await writeSlice({
    repoRoot: dir,
    title: "A",
    body: ".",
    cited_files: ["src/a.ts"],
    last_baked_commit: orphan,
    created_by: "human",
  });
  const result = await checkStaleness(await readSlice(slice.path), dir);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "not-ancestor");
});

test("stalenessBanner produces a non-empty banner only for stale results", () => {
  assert.equal(stalenessBanner({ stale: false, changed_files: [], commits: [] }), "");
  const b = stalenessBanner({
    stale: true,
    changed_files: ["src/a.ts"],
    commits: [{ sha: "abcdef1234567890", subject: "change a", file: "src/a.ts" }],
    reason: "file-changed",
  });
  assert.match(b, /STALE/);
  assert.match(b, /src\/a\.ts/);
  assert.match(b, /change a/);
});
