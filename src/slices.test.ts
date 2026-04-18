import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { initLoaf } from "./init.js";
import { writeSlice, readSlice, updateSliceFrontmatter } from "./slices.js";

const execFileP = promisify(execFile);

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loaf-slices-test-"));
  await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "T"], { cwd: dir });
  await execFileP("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await fs.writeFile(path.join(dir, "x.ts"), "x\n");
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

test("updateSliceFrontmatter on a slice without last_accessed does not throw", async () => {
  const dir = await makeRepo();
  await initLoaf(dir);
  // Hand-write a slice that omits last_accessed entirely — this is what happens
  // when a slice is committed by a human.
  const slicePath = path.join(dir, ".loaf/slices/manual.md");
  await fs.writeFile(
    slicePath,
    [
      "---",
      "id: manual",
      "title: Manual",
      "cited_files:",
      "  - x.ts",
      "last_baked_commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "created_by: human",
      "tags: []",
      "---",
      "body.",
      "",
    ].join("\n"),
    "utf8",
  );
  const slice = await readSlice(slicePath);
  // Before the fix, this threw: "unacceptable kind of an object to dump [object Undefined]"
  const updated = await updateSliceFrontmatter(slice, {
    last_baked_commit: "cafef00dcafef00dcafef00dcafef00dcafef00d",
  });
  assert.equal(updated.frontmatter.last_baked_commit, "cafef00dcafef00dcafef00dcafef00dcafef00d");
  const reread = await readSlice(slicePath);
  assert.equal(reread.frontmatter.last_baked_commit, "cafef00dcafef00dcafef00dcafef00dcafef00d");
});

test("writeSlice followed by updateSliceFrontmatter round-trips cleanly", async () => {
  const dir = await makeRepo();
  await initLoaf(dir);
  const slice = await writeSlice({
    repoRoot: dir,
    title: "Round trip",
    body: "b",
    cited_files: ["x.ts"],
    last_baked_commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    created_by: "human",
  });
  const updated = await updateSliceFrontmatter(slice, {
    last_baked_commit: "cafef00dcafef00dcafef00dcafef00dcafef00d",
  });
  assert.equal(updated.frontmatter.title, "Round trip");
});
