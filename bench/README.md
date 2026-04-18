# bench/

Minimal, repeatable harness for the Loaf v1 benchmark.

## The claim being tested

1. **Loaf matches full-context accuracy at a fraction of the tokens.**
2. **Loaf matches `CLAUDE.md` + pre-commit-hook accuracy with a materially lower stale-context failure rate.**

## What's here

- `tasks.json` — task suite. Fill in 20–30 realistic tasks against the dogfood repo.
- `run.ts` — stub harness. Emits `results.csv` with one row per `(task, approach)` pair.

## What's not here

Any actual model invocation. The harness is intentionally thin so you can swap in any runner — raw Anthropic SDK calls, Claude Code in a subprocess, whatever. The runner contract per `(task, approach)` is:

```
input: { prompt: string, context: string[] }
output: { answer: string, input_tokens: number, clarification_turns: number, stale_context_failure: boolean }
```

Correctness is scored by human review after the fact.

## The four approaches

| Approach       | Context strategy                                                                 |
| -------------- | -------------------------------------------------------------------------------- |
| `baseline`     | Bare prompt + file paths, no source                                              |
| `full-context` | All `golden_files` dumped into the prompt                                        |
| `claude-md`    | Repo's `CLAUDE.md` (or equivalent) loaded in full, no per-file source            |
| `loaf`         | MCP tools exposed, no pre-loaded context — the model pulls what it wants         |

## Running

```
npx tsx bench/run.ts
```

## Stale-context protocol

To measure stale-context failure rate honestly:

1. Bake a slice (or commit a `CLAUDE.md`) at commit A.
2. Evolve the cited file so the knowledge is now wrong at commit B.
3. Run the task at commit B.
4. Score `stale_context_failure = true` if the model trusted the outdated context and produced a wrong answer.

Loaf should surface a staleness banner; `CLAUDE.md` will not.
