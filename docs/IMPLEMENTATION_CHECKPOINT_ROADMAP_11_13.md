# Implementation checkpoint — roadmap sections 11–13

Date: 2026-07-08

Implemented the remaining roadmap items for worker debug sidecars, audit-mode metadata, and CLI maintenance commands.

## Worker debug sidecars

- Cloudflare Worker deployments can opt into R2-backed debug sidecars with `PXPIPE_DEBUG_SIDECARS=1` and a `PXPIPE_DEBUG_R2_BUCKET` binding.
- Sidecars are written only for captured 4xx transformed request samples, are redacted before storage, and leave only a bounded pointer in the JSONL/Logpush event via `debug_sidecar`.
- `PXPIPE_DEBUG_SAMPLE_RATE` can reduce capture volume. Default behavior is unchanged and writes no R2 sidecars.

## Audit mode

- `PXPIPE_AUDIT_MODE=1` marks events with `audit_sample: true` so operators can separate controlled samples in offline analysis.
- Audit mode does not duplicate live user requests upstream; it records only existing outcome/cost metadata such as estimated compression cost, baseline tokens, stop reason, output character counts, and latency.

## CLI maintenance commands

Added read-only operational commands:

```sh
pxpipe doctor
pxpipe audit-log <events.jsonl>
pxpipe calibrate <events.jsonl>
pxpipe explain <request.json>
```

- `doctor` validates local runtime, dashboard exposure, upstream configuration, and log writability.
- `audit-log` summarizes unknown/churning tags, dropped glyphs, truncation, and other suspicious rows from an event log.
- `calibrate` reports per-bucket chars-per-token estimates from baseline-probed rows.
- `explain` transforms a local request JSON and reports what would be compressed and why without sending it upstream.
