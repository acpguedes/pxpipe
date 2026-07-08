# pxpipe implementation roadmap

Status: **proposal / implementation plan**. This document collects the next
implementation work for pxpipe after the current text-to-image proxy design:
adaptive compression decisions, richer telemetry, dashboard improvements, and
maintenance tooling.

The guiding rule for every item below is: preserve the existing cache and
request-shape invariants first, then improve savings, debuggability, and
operator experience.

## 1. Dashboard request metadata and controls

### Goal

Show the exact date/time and model effort for each proxied request in the
dashboard recent-request lists and detail views, and provide an operator control
to clear dashboard history and reset live monitoring counters.

### Current gap

Operators can inspect recent requests and aggregate metrics, but the request UI
should make time ordering, log correlation, and request configuration obvious
without needing to infer them from surrounding rows. The dashboard also needs a
clear/reset action for demos, debugging sessions, and after configuration
changes so old traffic does not pollute the live monitor.

### Implementation plan

1. Audit the existing `TrackEvent` and dashboard row models for the canonical
   timestamp field already emitted by the proxy/tracker.
2. If a timestamp already exists, surface it directly in the dashboard table and
   request detail panel.
3. If a timestamp is missing from a dashboard API shape, add a stable field such
   as `ts` or `timestamp_ms` at event creation time and thread it through:
   `ProxyEvent` → `toTrackEvent` → dashboard API → UI render.
4. Capture and persist the effort/reasoning-effort value used by the request
   when the upstream request shape exposes one. Thread it through the same
   tracker/API/UI path as timestamp metadata.
5. Render both timestamp forms:
   - local date/time for quick human use;
   - ISO-8601 UTC in a tooltip or detail row for exact log correlation.
6. Add an authenticated/local-only dashboard action to clear recent request
   history and reset in-memory monitoring counters. The action should not delete
   persisted JSONL logs unless a separate explicit destructive option is added.
7. Add tests that assert the dashboard JSON endpoint includes the timestamp and
   effort fields, the rendered row contains date/time and effort, and the clear
   action empties recent rows plus resets aggregate live counters.

### Acceptance criteria

- Every recent request row shows date/time and the effort used, when available.
- Detail view exposes exact UTC timestamp and raw effort value.
- Sorting remains based on the underlying numeric timestamp, not a formatted
  string.
- A clear/reset control empties dashboard recent history and zeroes live
  monitoring counters without deleting persisted logs by default.
- Tests cover missing/legacy timestamps or effort values gracefully if old log
  rows are loaded.

## 2. Adaptive chars-per-token compression gates

### Goal

Replace broad fixed chars-per-token assumptions with per-content-bucket values
learned from real telemetry.

### Motivation

The compression gate decides whether text should stay as text or be rendered to
image. A single chars-per-token assumption cannot accurately represent all
content shapes: static system slabs, reminders, JSON tool output, logs, prose,
and collapsed history have different token densities.

### Implementation plan

1. Define compression buckets:
   - `static_slab`
   - `reminder`
   - `tool_result_json`
   - `tool_result_log`
   - `tool_result_prose`
   - `history`
2. Record pre-compression character counts per bucket on every request,
   including passthrough requests.
3. Persist bucket counts in `TrackEvent` as `bucket_chars`.
4. Extend `pxpipe stats` to aggregate bucket counts with baseline token probes.
5. Fit conservative per-bucket chars-per-token values from real events.
6. Feed those values back into gate decisions via config or learned defaults.
7. Keep conservative fallback constants for low-sample or unknown buckets.

### Acceptance criteria

- The transform emits bucket attribution for every gate call site.
- Stats can report per-bucket sample counts and estimated chars-per-token.
- Gate decisions use bucket-specific values when confidence is sufficient.
- Existing tests for no-overclaim savings continue to pass.

## 3. Telemetry and dashboard decision explanations

### Goal

Make every compression/pass-through decision explainable from one request row.

### Implementation plan

1. Extend request telemetry with a compact decision summary:
   - site: slab, reminder, tool_result, history;
   - text chars;
   - estimated text tokens;
   - estimated image tokens;
   - decision: compressed, below threshold, not profitable, kept sharp,
     unsupported model, or disabled;
   - bucket name where applicable.
2. Surface decision summaries in the dashboard detail panel.
3. Add aggregate cards for:
   - passthrough reasons;
   - truncation count;
   - dropped codepoints;
   - unknown/churning static tags;
   - image vs text estimated token delta.
4. Keep the persisted event compact; if full details are large, store only top
   decisions and aggregate counters.

### Acceptance criteria

- A user can answer “why was this request not compressed?” from the dashboard.
- Dashboard rows remain fast to render with large logs.
- Worker logs do not grow unbounded.

## 4. Real traffic fixture refresh tooling

### Goal

Create tooling to refresh real-shape fixtures from recent `events.jsonl` logs.

### Implementation plan

1. Add `scripts/extract-real-shapes.ts`.
2. Parse recent events and group by:
   - model;
   - provider path;
   - `system_sha8`;
   - major compression bucket mix.
3. Emit fixture constants for representative sessions.
4. Generate a drift report showing current fixture values vs observed values.
5. Document the refresh workflow in the test fixture file or a dedicated docs
   section.

### Acceptance criteria

- A maintainer can refresh fixtures with one command.
- The script never writes over fixtures without an explicit flag.
- The output includes date range, event count, and source log path.

## 5. Dynamic-tag canary workflow

### Goal

Make unknown or churning prompt tags actionable before they silently destroy
cache hit rate.

### Implementation plan

1. Keep the existing static/dynamic tag detection.
2. Add dashboard warnings for `unknown_static_tags` and `churning_static_tags`.
3. Aggregate tag frequency in stats output.
4. Add an optional fail-safe mode:
   - if a tag is unknown and changes across turns, skip slab compression;
   - emit an explicit reason such as `dynamic_tag_uncertain`.
5. Document how to classify a new tag into `DYNAMIC_BLOCK_TAGS` or
   `KNOWN_STATIC_TAGS`.

### Acceptance criteria

- Unknown/churning tags are visible in live dashboard and offline stats.
- Operators get a clear remediation message.
- Fail-safe mode is opt-in and covered by tests.

## 6. Glyph atlas and dropped-codepoint workflow

### Goal

Turn dropped glyph telemetry into a maintainable process for expanding glyph
coverage.

### Implementation plan

1. Aggregate `dropped_codepoints_top` in `pxpipe stats`.
2. Add a dashboard warning when a request drops codepoints.
3. Add a script/report that suggests new codepoints for atlas inclusion.
4. Extend renderer tests with newly covered glyphs.
5. Document how to regenerate the atlas and validate image output.

### Acceptance criteria

- Operators can see when rendered images lost glyphs.
- Maintainers can identify and add high-frequency missing glyphs.
- Tests prevent regressions for newly supported glyphs.

## 7. Smarter tool-result budget handling

### Goal

Reduce information loss when large `tool_result` content exceeds the image
budget.

### Implementation plan

1. Keep the current hard image cap for safety.
2. Classify oversized tool results as JSON, logs, diffs, stack traces, or prose.
3. Apply content-aware retention:
   - JSON: preserve top-level keys, error fields, and representative array
     samples;
   - logs: preserve errors, warnings, stack traces, first lines, and last lines;
   - diffs: preserve file headers and hunks near errors;
   - prose: preserve beginning, headings, and ending.
4. Emit a small textual manifest indicating omitted sections.
5. Record retained/omitted counts in telemetry.

### Acceptance criteria

- Oversized tool results still respect image limits.
- Important identifiers and errors are less likely to be omitted.
- Tests cover JSON, log, diff, and prose truncation behavior.

## 8. Factsheet and exact-identifier preservation

### Goal

Improve exact recall for identifiers that models may misread from dense images.

### Implementation plan

1. Expand factsheet extraction for:
   - file paths;
   - function/class names;
   - hashes;
   - UUIDs;
   - error codes;
   - command names;
   - package names;
   - URLs.
2. Deduplicate and rank entries by usefulness.
3. Include page references where practical.
4. Keep the factsheet compact and bounded.
5. Add tests where dense image text contains identifiers that must remain
   available as text.

### Acceptance criteria

- Critical identifiers survive as text even when source content is imaged.
- Factsheets remain small enough not to erase token savings.
- Tests cover multi-page source text.

## 9. Model profile validation

### Goal

Make support for new Anthropic/OpenAI models safer and easier to validate.

### Implementation plan

1. Create a model-profile validation command or test harness.
2. Verify for each model profile:
   - image input support;
   - max image dimensions;
   - image token cost assumptions;
   - OCR/readability behavior on representative rendered pages.
3. Emit warnings when a model is supported only by a generic fallback profile.
4. Keep unknown models in passthrough unless explicitly enabled.

### Acceptance criteria

- Adding a new model requires updating a profile and running validation.
- Unsupported models remain safe passthrough.
- Cost assumptions are documented per profile.

## 10. Cache invariant test expansion

### Goal

Prevent accidental changes that break image byte stability or cache placement.

### Implementation plan

1. Add tests for byte-identical static slab PNGs across dynamic env changes.
2. Add tests that volatile tags remain outside cached images.
3. Add tests for unknown tag warnings.
4. Add Node-vs-Worker transform parity tests where feasible.
5. Add tests that formatted dashboard timestamps/effort labels do not affect
   persisted event ordering or cache keys.
6. Add tests that clearing dashboard history only resets monitor state and never
   enters rendered request content.

### Acceptance criteria

- Static image bytes remain deterministic for equivalent static input.
- Dynamic text changes do not invalidate the static image cache anchor.
- Timestamp and effort display are purely UI/API metadata and never enter
  rendered slabs.
- Clearing dashboard history resets monitor state only; it does not affect proxy
  transforms or cache anchors.

## 11. Worker debug sidecars

### Goal

Improve production debugging for Cloudflare Worker deployments without bloating
normal logs.

### Implementation plan

1. Add optional R2-backed debug sidecars for large request/error samples.
2. Store only pointers in `TrackEvent`.
3. Redact secrets before writing sidecars.
4. Add retention controls and sampling rates.
5. Keep the default behavior unchanged unless configured.

### Acceptance criteria

- Worker deployments can preserve large debug bodies when explicitly enabled.
- Secrets are not persisted in sidecars.
- JSONL/Logpush event size stays bounded.

## 12. Audit mode for compressed vs text behavior

### Goal

Provide an operator tool to compare transformed and untransformed behavior on a
controlled sample.

### Implementation plan

1. Add an opt-in audit mode that records enough metadata to replay selected
   requests safely.
2. Compare:
   - compressed estimated cost;
   - text baseline estimated cost;
   - stop reason;
   - refusal/content-filter rate;
   - output character counts;
   - latency.
3. Generate an offline report from captured events.
4. Never duplicate live user requests to upstream without explicit opt-in.

### Acceptance criteria

- Audit mode is disabled by default.
- Reports quantify savings and quality risk.
- Refusals/content filters are highlighted as failures, not wins.

## 13. CLI maintenance commands

### Goal

Make common operational and maintenance tasks discoverable.

### Proposed commands

- `pxpipe doctor`: validate environment, upstreams, writable logs, model support,
  and dashboard configuration.
- `pxpipe audit-log <events.jsonl>`: summarize unknown tags, dropped glyphs,
  truncation, refusals, and suspicious savings rows.
- `pxpipe calibrate <events.jsonl>`: estimate per-bucket chars-per-token values.
- `pxpipe explain <request.json>`: show what would be compressed and why without
  sending the request upstream.

### Acceptance criteria

- Commands are read-only by default.
- Output includes actionable remediation steps.
- Commands are covered by CLI tests or core unit tests.

## Suggested implementation order

1. Dashboard request date/time, effort display, and clear/reset control.
2. Bucket telemetry (`bucket_chars`) and dashboard decision explanations.
3. Adaptive chars-per-token calibration/reporting.
4. Real traffic fixture refresh script.
5. Dynamic-tag dashboard warnings and optional fail-safe.
6. Dropped-codepoint aggregation and atlas workflow.
7. Smarter tool-result retention.
8. Expanded factsheet extraction.
9. Model profile validation.
10. Cache invariant test expansion.
11. Worker debug sidecars.
12. Audit mode.
13. CLI maintenance commands.

## Non-goals for this roadmap

The following ideas should remain out of scope unless new data justifies
reopening them:

- compressing ordinary user message text;
- adding a second per-conversation render cache inside the proxy;
- replacing predictable gates with opaque heuristics;
- streaming request bodies into the renderer.

These non-goals protect the current design's debuggability and cache behavior.
