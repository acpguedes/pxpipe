import { describe, expect, it } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

const FORCE = { charsPerToken: 1, minCompressChars: 1 } as const;
const enc = new TextEncoder();

function b64(s: string): string {
  let binary = '';
  for (const b of enc.encode(s)) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('hook transform-only control plane', () => {
  it('serves a no-body health check for opportunistic Claude hooks', async () => {
    const proxy = createProxy();
    const res = await proxy(new Request('http://localhost/healthz'));
    expect(res.status).toBe(204);
    expect(res.headers.get('x-pxpipe-protocol')).toBe('pxpipe-transform-v1');
  });

  it('transforms Anthropic messages without forwarding to upstream', async () => {
    const realFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('transform-only must not call upstream');
    }) as typeof fetch;

    const events: ProxyEvent[] = [];
    const proxy = createProxy({
      transform: FORCE,
      onRequest: (e) => events.push(e),
    });
    const original = JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 1,
      system: 'HOOK_SECRET_' + 'x'.repeat(80_000),
      messages: [{ role: 'user', content: 'LIVE_QUESTION' }],
    });

    const res = await proxy(new Request('http://localhost/api/transform', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 'pxpipe-transform-v1',
        provider: 'anthropic',
        path: '/v1/messages',
        model: 'claude-fable-5',
        bodyBase64: b64(original),
      }),
    }));
    globalThis.fetch = realFetch;

    expect(res.status).toBe(200);
    const out = await res.json() as any;
    expect(out.protocol).toBe('pxpipe-transform-v1');
    expect(out.applied).toBe(true);
    expect(out.bodyBase64).toBeTypeOf('string');
    expect(JSON.stringify(out.body)).not.toContain('HOOK_SECRET_');
    expect(JSON.stringify(out.body)).toContain('LIVE_QUESTION');
    expect(fetched).toBe(false);
    expect(events[0]?.path).toBe('/api/transform');
    expect(events[0]?.info?.compressed).toBe(true);
  });

  it('fails open for unsupported models by returning the original body', async () => {
    const proxy = createProxy({ transform: FORCE });
    const original = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      system: 'short',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const res = await proxy(new Request('http://localhost/api/transform', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/v1/messages', body: JSON.parse(original) }),
    }));
    expect(res.status).toBe(200);
    const out = await res.json() as any;
    expect(out.applied).toBe(false);
    expect(out.reason).toBe('unsupported_model');
    expect(out.body).toEqual(JSON.parse(original));
  });


  it('transforms OpenAI chat completions from a path with query string', async () => {
    const realFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('transform-only must not call upstream');
    }) as typeof fetch;

    const proxy = createProxy({ transform: FORCE });
    const original = {
      model: 'gpt-5.6',
      messages: [
        { role: 'developer', content: 'OPENAI_CHAT_SECRET_' + 'x'.repeat(80_000) },
        { role: 'user', content: 'LIVE_OPENAI_CHAT' },
      ],
    };
    const res = await proxy(new Request('http://localhost/api/transform', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '/v1/chat/completions?beta=true',
        body: original,
      }),
    }));
    globalThis.fetch = realFetch;

    expect(res.status).toBe(200);
    const out = await res.json() as any;
    expect(out.applied).toBe(true);
    expect(out.reason).toBe('applied');
    expect(JSON.stringify(out.body)).not.toContain('OPENAI_CHAT_SECRET_');
    expect(JSON.stringify(out.body)).toContain('LIVE_OPENAI_CHAT');
    expect(fetched).toBe(false);
  });

  it('transforms OpenAI Responses requests from a full URL path hint', async () => {
    const proxy = createProxy({ transform: FORCE });
    const original = {
      model: 'gpt-5.6',
      instructions: 'OPENAI_RESPONSES_SECRET_' + 'x'.repeat(80_000),
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'LIVE_OPENAI_RESPONSES' }] }],
    };
    const res = await proxy(new Request('http://localhost/api/transform', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'https://api.openai.com/v1/responses',
        body: original,
      }),
    }));

    expect(res.status).toBe(200);
    const out = await res.json() as any;
    expect(out.applied).toBe(true);
    expect(JSON.stringify(out.body)).not.toContain('OPENAI_RESPONSES_SECRET_');
    expect(JSON.stringify(out.body)).toContain('LIVE_OPENAI_RESPONSES');
  });

  it('accepts optional post-response usage telemetry from a hook', async () => {
    const events: ProxyEvent[] = [];
    const proxy = createProxy({ onRequest: (e) => events.push(e) });
    const res = await proxy(new Request('http://localhost/api/hook/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-fable-5',
        status: 200,
        usage: { input_tokens: 10, output_tokens: 2 },
        stopReason: 'end_turn',
      }),
    }));
    expect(res.status).toBe(204);
    expect(events[0]?.path).toBe('/api/hook/usage');
    expect(events[0]?.usage?.input_tokens).toBe(10);
    expect(events[0]?.stopReason).toBe('end_turn');
  });
});
