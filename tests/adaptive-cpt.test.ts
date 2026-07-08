import { describe, it, expect } from 'vitest';
import { transformRequest, DEFAULT_BUCKET_CHARS_PER_TOKEN } from '../src/core/transform.js';
import type { MessagesRequest } from '../src/core/types.js';

function enc(req: MessagesRequest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(req));
}

describe('adaptive chars-per-token buckets', () => {
  it('attributes static slab chars even when the slab passes through below threshold', async () => {
    const req: MessagesRequest = {
      model: 'claude-test',
      system: 'short stable slab',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const { info } = await transformRequest(enc(req), { minCompressChars: 10_000 });

    expect(info.compressed).toBe(false);
    expect(info.bucketChars?.static_slab).toBe('short stable slab'.length);
  });

  it('allows bucket-specific cpt overrides to flip a borderline slab gate', async () => {
    const req: MessagesRequest = {
      model: 'claude-test',
      system: 'x'.repeat(5_000),
      messages: [{ role: 'user', content: 'hello' }],
    };

    const conservative = await transformRequest(enc(req), {
      minCompressChars: 1,
      bucketCharsPerToken: { static_slab: 100 },
    });
    const aggressive = await transformRequest(enc(req), {
      minCompressChars: 1,
      bucketCharsPerToken: { static_slab: DEFAULT_BUCKET_CHARS_PER_TOKEN.static_slab },
    });

    expect(conservative.info.compressed).toBe(false);
    expect(conservative.info.gateEval?.profitable).toBe(false);
    expect(aggressive.info.gateEval?.textTokens).toBeGreaterThan(conservative.info.gateEval?.textTokens ?? 0);
  });
});
