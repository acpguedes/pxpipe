# Claude hook transform mode

This document is the implementation plan and operating contract for running
pxpipe as a local **transform-only daemon** instead of as the network proxy in
front of Anthropic/OpenAI.

## Goal

Keep Claude Code connected to its original service endpoint, but allow a local
hook to ask pxpipe to rewrite eligible request bodies before they leave the
machine:

1. The hook checks whether pxpipe is running.
2. If pxpipe is not running, the hook does nothing and Claude follows its normal
   path.
3. If pxpipe is running, the hook sends the original request body to pxpipe.
4. pxpipe returns a transformed body containing the same image-based compression
   it would have used in proxy mode.
5. The hook substitutes the transformed body and lets Claude send the request to
   the original upstream.

The daemon never calls the upstream in this flow. It only transforms bytes.

## Phase 1 — minimal transform daemon

Implemented endpoints:

### `GET /healthz`

Returns `204 No Content` when the local daemon is available. Hooks should use a
small timeout and fail open on any error.

Response headers include:

```http
x-pxpipe-protocol: pxpipe-transform-v1
cache-control: no-store
```

### `POST /api/transform`

Transforms one request body without forwarding it.

Request shape:

```json
{
  "protocol": "pxpipe-transform-v1",
  "provider": "anthropic",
  "path": "/v1/messages",
  "model": "claude-fable-5",
  "bodyBase64": "..."
}
```

Fields:

- `protocol` is optional but recommended for hook compatibility checks.
- `provider` may be `anthropic`, `openai-chat`, or `openai-responses`. If it is
  omitted, pxpipe infers the provider from `path`.
- `path` should be the original request path such as `/v1/messages`,
  `/v1/chat/completions`, or `/v1/responses`.
- `model` is optional; if omitted, pxpipe reads the top-level JSON `model` field.
- `bodyBase64` is preferred because it preserves exact bytes.
- `body` may be supplied instead of `bodyBase64` by simple clients/tests; pxpipe
  JSON-stringifies it before transformation.

Response shape:

```json
{
  "protocol": "pxpipe-transform-v1",
  "applied": true,
  "reason": "applied",
  "detail": "...",
  "model": "claude-fable-5",
  "bodyBase64": "...",
  "body": { "model": "claude-fable-5" },
  "info": { "compressed": true }
}
```

Hooks should use `bodyBase64` as the authoritative transformed body. The `body`
field is a convenience copy that is present only when the transformed bytes parse
as JSON.

Unsupported models fail open: pxpipe returns the original body, `applied:false`,
and `reason:"unsupported_model"`.

## Phase 2 — Claude hook UX contract

A Claude hook should be a thin fail-open wrapper. Pseudocode:

```js
const health = await fetch('http://127.0.0.1:47821/healthz', {
  signal: AbortSignal.timeout(100),
});
if (health.status !== 204) return originalRequest;

const transformed = await fetch('http://127.0.0.1:47821/api/transform', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    protocol: 'pxpipe-transform-v1',
    path: originalPath,
    model: originalJson.model,
    bodyBase64: base64(originalBytes),
  }),
  signal: AbortSignal.timeout(1000),
});
if (!transformed.ok) return originalRequest;

const result = await transformed.json();
if (result.protocol !== 'pxpipe-transform-v1' || !result.bodyBase64) {
  return originalRequest;
}

return { ...originalRequest, body: unbase64(result.bodyBase64) };
```

Required hook behavior:

- Any timeout, connection failure, non-2xx status, malformed JSON, unknown
  protocol, or missing `bodyBase64` must return the original request.
- The hook should not send API keys to `/api/transform`; the daemon does not need
  them for transformation.
- The hook should preserve the original upstream URL, method, and auth headers.
- The hook should only replace the body and any headers whose values depend on
  the body, such as `content-length` when the host requires it.

## Complete Claude request-hook example

Important: Claude Code's documented lifecycle hooks (`UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `Stop`, and friends) receive lifecycle JSON and can
return decisions/context, but they are not a provider HTTP request mutation API.
Use the script below with a Claude-compatible **transport/request hook** or
launcher shim that gives the hook the outgoing HTTP method/path/body and accepts a
replacement body. If your Claude environment only supports the documented
lifecycle hooks, it cannot perform this transform-only integration; use pxpipe's
normal proxy mode instead.

Expected hook input on stdin:

```json
{
  "path": "/v1/messages",
  "model": "claude-fable-5",
  "bodyBase64": "...base64 original JSON request bytes..."
}
```

Expected hook output on stdout:

```json
{
  "bodyBase64": "...base64 transformed JSON request bytes..."
}
```

`~/.claude/hooks/pxpipe-request-hook.mjs`:

```js
#!/usr/bin/env node
import { stdin, stdout, exit } from 'node:process';

const PXPIPE = process.env.PXPIPE_URL ?? 'http://127.0.0.1:47821';
const HEALTH_TIMEOUT_MS = Number(process.env.PXPIPE_HEALTH_TIMEOUT_MS ?? 100);
const TRANSFORM_TIMEOUT_MS = Number(process.env.PXPIPE_TRANSFORM_TIMEOUT_MS ?? 1000);

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function failOpen(original) {
  stdout.write(JSON.stringify({ bodyBase64: original?.bodyBase64 ?? '' }) + '\n');
  exit(0);
}

const original = JSON.parse(await readStdin());
if (!original?.bodyBase64) failOpen(original);

try {
  const health = await fetchWithTimeout(`${PXPIPE}/healthz`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
  if (health.status !== 204) {
    failOpen(original);
  } else {
    const transform = await fetchWithTimeout(`${PXPIPE}/api/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 'pxpipe-transform-v1',
        provider: 'anthropic',
        path: original.path ?? '/v1/messages',
        model: original.model,
        bodyBase64: original.bodyBase64,
      }),
    }, TRANSFORM_TIMEOUT_MS);

    if (!transform.ok) {
      failOpen(original);
    } else {
      const out = await transform.json();
      if (out.protocol !== 'pxpipe-transform-v1' || typeof out.bodyBase64 !== 'string') {
        failOpen(original);
      } else {
        stdout.write(JSON.stringify({ bodyBase64: out.bodyBase64 }) + '\n');
      }
    }
  }
} catch {
  failOpen(original);
}
```

The launcher/request-hook adapter is responsible for decoding the output and
replacing only the outgoing request body (plus any body-derived headers such as
`content-length`). It must keep the original upstream URL and authentication
headers.

## Complete OpenAI JavaScript SDK hook example

The OpenAI TypeScript/JavaScript SDK supports passing a custom `fetch` function
to the client. This is a real transform-only hook point for OpenAI clients: the
SDK still sends requests to OpenAI, but the custom fetch rewrites eligible JSON
bodies through pxpipe first.

`openai-with-pxpipe.mjs`:

```js
import OpenAI from 'openai';

const PXPIPE = process.env.PXPIPE_URL ?? 'http://127.0.0.1:47821';
const HEALTH_TIMEOUT_MS = Number(process.env.PXPIPE_HEALTH_TIMEOUT_MS ?? 100);
const TRANSFORM_TIMEOUT_MS = Number(process.env.PXPIPE_TRANSFORM_TIMEOUT_MS ?? 1000);
const realFetch = globalThis.fetch.bind(globalThis);

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64) {
  return Buffer.from(b64, 'base64');
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await realFetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function pxpipeFetch(input, init = {}) {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname;
  const eligible = req.method === 'POST' && (
    path === '/v1/responses' || path === '/v1/chat/completions'
  );
  if (!eligible) return realFetch(req);

  let bodyBytes;
  try {
    bodyBytes = new Uint8Array(await req.clone().arrayBuffer());
  } catch {
    return realFetch(req);
  }

  let originalJson;
  try {
    originalJson = JSON.parse(Buffer.from(bodyBytes).toString('utf8'));
  } catch {
    return realFetch(req);
  }

  try {
    const health = await fetchWithTimeout(`${PXPIPE}/healthz`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
    if (health.status !== 204) return realFetch(req);

    const transform = await fetchWithTimeout(`${PXPIPE}/api/transform`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 'pxpipe-transform-v1',
        path,
        model: originalJson.model,
        bodyBase64: bytesToBase64(bodyBytes),
      }),
    }, TRANSFORM_TIMEOUT_MS);
    if (!transform.ok) return realFetch(req);

    const out = await transform.json();
    if (out.protocol !== 'pxpipe-transform-v1' || typeof out.bodyBase64 !== 'string') {
      return realFetch(req);
    }

    const headers = new Headers(req.headers);
    headers.delete('content-length');
    return realFetch(new Request(req, {
      body: base64ToBytes(out.bodyBase64),
      headers,
    }));
  } catch {
    return realFetch(req);
  }
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: pxpipeFetch,
});

// Responses API example
const response = await openai.responses.create({
  model: 'gpt-5.6',
  instructions: 'Large static instructions here...',
  input: 'Use the previous context.',
});
console.log(response.output_text);

// Chat Completions example
const chat = await openai.chat.completions.create({
  model: 'gpt-5.6',
  messages: [
    { role: 'developer', content: 'Large developer context here...' },
    { role: 'user', content: 'Use the previous context.' },
  ],
});
console.log(chat.choices[0]?.message?.content);
```

## Phase 3 — optional post-response telemetry

Implemented endpoint:

### `POST /api/hook/usage`

A hook may report post-response metadata so pxpipe can keep dashboard/log rows
useful even when it is not the network proxy.

Request shape:

```json
{
  "model": "claude-fable-5",
  "status": 200,
  "usage": {
    "input_tokens": 120,
    "output_tokens": 7,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 100
  },
  "stopReason": "end_turn"
}
```

The endpoint returns `204 No Content`. It is intentionally optional; transform
mode remains useful without it, but real observed usage/cost data requires a
post-response callback from the hook environment.

## Security and operational notes

- Keep the daemon bound to `127.0.0.1` unless you explicitly accept exposing
  prompt/request context on the network.
- The health and transform endpoints are local control-plane APIs, not public
  APIs.
- Hooks should prefer short timeouts and fail open.
- If the hook cannot mutate request bodies, this integration is not possible in
  that hook environment; use proxy mode instead.

## Current limitations

- Transform-only mode cannot run Anthropic `count_tokens` baseline probes because
  it intentionally does not call upstream.
- Full dashboard accounting is only available when the hook posts response usage
  to `/api/hook/usage`.
- Exact-string risks are unchanged: rendered image content is lossy, so byte-exact
  identifiers should remain text via existing gates/options.
