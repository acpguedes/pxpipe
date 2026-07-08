# Implementation checkpoint — adaptive chars-per-token compression gates

Date: 2026-07-08
Roadmap item: `docs/IMPLEMENTATION_ROADMAP.md` section 2, “Adaptive chars-per-token compression gates”.

## What changed

- Added the canonical compression buckets used by gate telemetry:
  - `static_slab`
  - `reminder`
  - `tool_result_json`
  - `tool_result_log`
  - `tool_result_prose`
  - `history`
- Added conservative built-in bucket chars/token priors and a `bucketCharsPerToken` transform option so operators can feed learned values back into gate decisions without replacing the global fallback.
- Changed transform attribution so gate call sites record pre-compression bucket characters even when the block passes through because it is below threshold, kept sharp, or not profitable.
- Updated persisted tracker typing to use the roadmap bucket names, especially `tool_result_json` instead of the older structured-bucket name.
- Extended stats aggregation and text reports with per-bucket sample counts, character totals, and estimated chars/token values from baseline token probes when available.
- Added regression coverage for passthrough bucket attribution, bucket cpt overrides, and stats aggregation/reporting.

## Current behavior

- If `bucketCharsPerToken[bucket]` is set to a positive finite value, that value is used for that bucket’s gate.
- If a caller sets the legacy global `charsPerToken`, it remains the fallback for all buckets without explicit bucket overrides.
- Without caller overrides, the transform uses conservative defaults:
  - static slab and history: dense-production priors;
  - tool JSON/log/prose and reminders: conservative values intended not to overclaim savings.
- `pxpipe stats` can now reveal which buckets have enough samples to promote into configuration.

## Follow-up work

- Wire `bucketCharsPerToken` into a documented runtime config/env surface if operators should set it outside programmatic callers.
- Add dashboard cards for bucket telemetry if section 3 dashboard work wants live visibility.
- Once real logs have enough baseline-probed rows, replace the initial priors with values learned from production events.
- Consider reporting confidence thresholds (minimum samples / token-probed samples) directly in stats JSON before auto-applying learned values.

## Verification performed

- `pnpm exec vitest run tests/adaptive-cpt.test.ts tests/stats.test.ts`
- `pnpm run typecheck`
