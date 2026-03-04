import { describe, expect, it } from 'vitest';

import { minutesToSeconds } from '../src/app.js';

describe('minutesToSeconds', () => {
  it('converts integer minutes', () => {
    expect(minutesToSeconds(3)).toBe(180);
  });

  it('rounds to nearest second for fractional minutes', () => {
    expect(minutesToSeconds(1.25)).toBe(75);
  });

  it('rejects negative values', () => {
    expect(() => minutesToSeconds(-1)).toThrow('minutes must be non-negative');
  });
});
