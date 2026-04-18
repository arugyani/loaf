# Agents

## Loaf knowledge layer

This repo uses [Loaf](https://github.com/arugyani/loaf) to track atomic, model-curated knowledge slices under `.loaf/`.

- Prefer `loaf.search` and `loaf.get` over reading raw source files when answering architectural or "why is this done this way" questions.
- Call `loaf.status` at the start of a session to see what exists and what is stale.
- When you recover from a mistake or learn a non-obvious pattern, call `loaf.record_learning` to save it.
- Validate stale slices against current code, then call `loaf.bake` to mark them fresh.
