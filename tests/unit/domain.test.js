import { describe, expect, it } from 'vitest';
import { LENGTH_MAX, ROTATION_MAX, inRange } from '../../src/core/domain.js';

describe('inRange', () => {
  it('accepts finite numbers inside the closed range only', () => {
    expect(inRange(0, 0, LENGTH_MAX)).toBe(true);
    expect(inRange(LENGTH_MAX, 0, LENGTH_MAX)).toBe(true);
    expect(inRange(ROTATION_MAX, 0, ROTATION_MAX)).toBe(true);
    expect(inRange(-1e-300, 0, LENGTH_MAX)).toBe(false);
    expect(inRange(LENGTH_MAX * (1 + Number.EPSILON), 0, LENGTH_MAX)).toBe(false);
    for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, 1n]) expect(inRange(v, -Infinity, Infinity)).toBe(false);
  });
});
