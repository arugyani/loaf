#!/usr/bin/env node
/**
 * Minimal benchmark harness. Reads bench/tasks.json, records per-task
 * metadata for each of the four approaches, and emits a CSV.
 *
 * This file intentionally does NOT call an LLM. The harness is deliberately
 * thin so that model invocation stays pluggable — swap in any runner that can
 * take a prompt + context strategy and return { answer, input_tokens,
 * clarification_turns, stale_context_failure }.
 *
 * The goal is a repeatable experiment, not a polished product.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Task = {
  id: string;
  category: string;
  prompt: string;
  golden_files: string[];
  notes?: string;
};

type Approach = "baseline" | "full-context" | "claude-md" | "loaf";

type Result = {
  task_id: string;
  approach: Approach;
  correctness: number; // 0..1, human-scored
  input_tokens: number;
  clarification_turns: number;
  stale_context_failure: boolean;
  notes: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const tasksPath = path.join(here, "tasks.json");

function loadTasks(): Task[] {
  const raw = fs.readFileSync(tasksPath, "utf8");
  const parsed = JSON.parse(raw) as { tasks: Task[] };
  return parsed.tasks;
}

function emptyResult(task: Task, approach: Approach): Result {
  return {
    task_id: task.id,
    approach,
    correctness: 0,
    input_tokens: 0,
    clarification_turns: 0,
    stale_context_failure: false,
    notes: "pending — plug in a runner",
  };
}

function toCsv(rows: Result[]): string {
  const header = [
    "task_id",
    "approach",
    "correctness",
    "input_tokens",
    "clarification_turns",
    "stale_context_failure",
    "notes",
  ].join(",");
  const body = rows.map((r) =>
    [
      r.task_id,
      r.approach,
      r.correctness.toFixed(2),
      r.input_tokens,
      r.clarification_turns,
      r.stale_context_failure ? "1" : "0",
      JSON.stringify(r.notes),
    ].join(","),
  );
  return [header, ...body].join("\n") + "\n";
}

function main(): void {
  const tasks = loadTasks();
  const approaches: Approach[] = ["baseline", "full-context", "claude-md", "loaf"];
  const rows: Result[] = [];
  for (const task of tasks) {
    for (const approach of approaches) {
      rows.push(emptyResult(task, approach));
    }
  }
  const out = path.join(here, "results.csv");
  fs.writeFileSync(out, toCsv(rows), "utf8");
  console.log(`wrote ${out}  (${rows.length} rows: ${tasks.length} tasks × ${approaches.length} approaches)`);
  console.log("Fill in correctness + token counts by running each (task, approach) pair through your model runner.");
}

main();
