# Implementation checkpoint — roadmap part 1

Date: 2026-07-08

## Scope completed

Implemented the first roadmap section, **Dashboard request metadata and controls**:

- Request effort metadata is extracted from supported upstream request shapes and carried through `ProxyEvent`, persisted `TrackEvent`, dashboard JSON rows, and the recent-request HTML table.
- Dashboard recent rows now expose both a sortable numeric `ts` and a stable UTC `ts_iso`; the HTML renders local time with the exact UTC timestamp in the tooltip.
- Recent-request rows include an `Effort` column, gracefully showing `—` when legacy rows lack effort metadata.
- Added an in-memory dashboard clear/reset action that empties recent rows, image/context preview state, per-session live state, cache-warmth memory, and aggregate live counters without deleting JSONL logs.
- Added tests for metadata propagation, rendered recent rows, and clear/reset behavior.

## Not intentionally changed

- Persisted `events.jsonl` history is not deleted by the clear/reset action.
- Full-history `/api/stats.json` and session aggregation from disk still reflect persisted logs.
- The clear action resets only live dashboard process memory; a restart plus replay can still load recent rows from the JSONL log.

## Follow-up notes

- If future providers expose a different effort field, add it to `readEffortField()` in `src/core/proxy.ts`.
- If a destructive log-delete action is needed later, keep it separate from `/api/dashboard/clear` and require explicit confirmation/copy that persisted logs will be deleted.
- Roadmap part 2 can start from `bucket_chars`, which already exists in `TrackEvent`; the next step is aligning bucket names with the proposed `tool_result_json`/`tool_result_log`/`tool_result_prose` names and fitting learned chars-per-token values.
