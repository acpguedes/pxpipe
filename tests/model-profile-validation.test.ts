import { describe, expect, it } from 'vitest';
import { validateGptModelProfile } from '../src/core/gpt-model-profiles.js';

describe('model profile validation', () => {
  it('accepts known profiles without generic-fallback warnings', () => {
    const result = validateGptModelProfile('gpt-5.5');
    expect(result.known).toBe(true);
    expect(result.warnings).not.toContain('generic fallback profile: keep passthrough unless explicitly enabled');
    expect(result.profile.maxHeightPx).toBeGreaterThan(0);
  });

  it('warns for unknown models that use the generic fallback profile', () => {
    const result = validateGptModelProfile('gpt-future-unknown');
    expect(result.known).toBe(false);
    expect(result.warnings).toContain('generic fallback profile: keep passthrough unless explicitly enabled');
  });
});
