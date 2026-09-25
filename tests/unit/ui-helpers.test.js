import { describe, expect, it } from 'vitest';
import { INCH } from '../../src/core/units.js';
import { niceStep, ticks } from '../../src/ui/chart.js';
import { amo, drawText, fixed, forceText, lengthLabel, pointLabel } from '../../src/ui/display.js';

/** @type {import('../../src/state/schema.js').Units} */
const inches = { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' };
/** @type {import('../../src/state/schema.js').Units} */
const metric = { ...inches, draw: 'mm', force: 'lbf' };

describe('chart ticks', () => {
  it('picks the nearest round step', () => {
    expect(niceStep(1.02)).toBe(1);
    expect(niceStep(2.4)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(8)).toBe(10);
    expect(niceStep(102)).toBe(100);
    expect(niceStep(0.3)).toBeCloseTo(0.2, 15);
  });

  it('lists round values inside the range with matching decimals', () => {
    expect(ticks(8.25, 29, 4)).toEqual({ values: [10, 15, 20, 25], step: 5, decimals: 0 });
    const t = ticks(0, 1.1, 4);
    expect(t.step).toBeCloseTo(0.2, 15);
    expect(t.decimals).toBe(1);
    expect(t.values).toHaveLength(6);
  });
});

describe('display', () => {
  it('shows AMO draw length of a nock position', () => {
    expect(amo(27.25 * INCH, inches)).toBeCloseTo(29, 12);
    expect(drawText(27.25 * INCH, inches)).toBe('29.00');
    expect(drawText(27.25 * INCH, metric)).toBe('736.6');
  });

  it('formats forces, lengths and point labels', () => {
    expect(forceText(267, inches)).toBe('267.0');
    expect(forceText(267, metric)).toBe('60.0');
    expect(lengthLabel(1.25 * INCH, inches)).toBe('1.25 in');
    expect(pointLabel({ x: 22.25 * INCH, F: 251.2 }, inches)).toBe('24.0 in, 251 N');
    expect(fixed(-0.001, 1)).toBe('0.0');
  });
});
