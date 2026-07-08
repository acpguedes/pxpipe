# Implementation checkpoint — roadmap sections 3–5

Date: 2026-07-08

Implemented telemetry explanations, real-shape fixture extraction tooling, and dynamic-tag canary improvements.

## Refresh real-shape fixtures

Dry run:

```sh
pnpm exec tsx scripts/extract-real-shapes.ts --log path/to/events.jsonl
```

Write generated representatives:

```sh
pnpm exec tsx scripts/extract-real-shapes.ts --log path/to/events.jsonl --out tests/fixtures/real-shapes.generated.ts --write
```

The script prints the source path, date range, parsed event count, group count, and refuses to write unless `--write` is present.

## Dynamic tag classification

Unknown tags in `unknown_static_tags` need classification in `src/core/transform.ts`:

- add per-turn or machine-changing tags to `DYNAMIC_BLOCK_TAGS` so they stay out of cacheable slab images;
- add stable first-party tags to `KNOWN_STATIC_TAGS` to suppress canary noise.

Optional fail-safe mode: set `PXPIPE_FAILSAFE_DYNAMIC_TAGS=1` to skip slab compression when an unknown tag is observed churning in a session; emitted reason is `dynamic_tag_uncertain`.
