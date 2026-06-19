import { describe, it, expect } from 'vitest';
import { renderSessionSummaryFragment } from '../src/dashboard/fragments.js';
import type { CurrentSessionPayload } from '../src/dashboard/types.js';

/**
 * The hero must read the SAME cache-weighted pair as the Details panel + Saved
 * column. The old bug divided raw count_tokens (cache-blind) by sent tokens and
 * could claim a big "fewer tokens" win on a session the Saved column showed as a
 * net loss. These pin direction to `baselineInputWeighted` vs `actualInputWeighted`.
 */
function payload(p: Partial<CurrentSessionPayload>): CurrentSessionPayload {
  return { sessionId: 's', baselineMeasuredCount: 1, rawOutputTokens: 139, ...p };
}

describe('renderSessionSummaryFragment hero', () => {
  it('shows "fewer tokens" when the weighted image beat weighted text', () => {
    const html = renderSessionSummaryFragment(
      payload({ baselineInputWeighted: 7000, actualInputWeighted: 1800 }),
    );
    expect(html).toContain('fewer tokens');
    expect(html).not.toContain('more tokens');
    expect(html).toContain('74%'); // 1 - 1800/7000
  });

  it('flips to "more tokens" on a warm net-loss session (matches Saved "-")', () => {
    // The exact trap: raw text (e.g. 7.2k) would look like a huge win, but the
    // cache-weighted text baseline (1,546) is below what imaging actually sent (1,863).
    const html = renderSessionSummaryFragment(
      payload({ baselineInputWeighted: 1546, actualInputWeighted: 1863 }),
    );
    expect(html).toContain('more tokens');
    expect(html).not.toContain('fewer tokens');
    expect(html).toContain('hero-neg'); // red styling on a loss
  });

  it('never lumps output into the headline ratio', () => {
    // Same input pair, wildly different output — headline % must not move.
    const a = renderSessionSummaryFragment(
      payload({ baselineInputWeighted: 2000, actualInputWeighted: 1000, rawOutputTokens: 10 }),
    );
    const b = renderSessionSummaryFragment(
      payload({ baselineInputWeighted: 2000, actualInputWeighted: 1000, rawOutputTokens: 9000 }),
    );
    expect(a).toContain('50%');
    expect(b).toContain('50%');
  });

  it('renders the warming-up state with no measured requests', () => {
    const html = renderSessionSummaryFragment(payload({ baselineMeasuredCount: 0 }));
    expect(html).toContain('Warming up');
    expect(html).not.toContain('fewer tokens');
  });
});
