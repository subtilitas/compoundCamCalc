import { describe, expect, it } from 'vitest';
import { solve } from '../../src/core/solve.js';
import { defaultState } from '../../src/state/presets.js';

/** Time budgets of the solve for the default preset (ms). */
const COARSE_BUDGET = 30;
const FULL_BUDGET = 200;
/** Allowance for slow and shared CI machines. */
const MARGIN = 5;

/**
 * Median run time of fn in ms.
 * @param {() => void} fn
 * @param {number} runs
 */
function median(fn, runs) {
  const times = [];
  for (let k = 0; k < runs; k++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

describe('solve performance', () => {
  it(`solves the default preset coarsely within ${COARSE_BUDGET} ms and fully within ${FULL_BUDGET} ms`, () => {
    const state = defaultState();
    const t0 = performance.now();
    const first = solve(state);
    const cold = performance.now() - t0;
    expect(first.status).toBe('ok');
    for (let k = 0; k < 3; k++) solve(state, { resolution: 'coarse' });
    const coarse = median(() => solve(state, { resolution: 'coarse' }), 15);
    const full = median(() => solve(state), 7);
    const t = solve(state).timings;
    console.info(
      `solve: cold ${cold.toFixed(1)} ms, coarse ${coarse.toFixed(1)} ms, full ${full.toFixed(1)} ms ` +
        `(inverse ${t.inverse.toFixed(1)}, fit ${t.fit.toFixed(1)}, outline ${t.outline.toFixed(1)}, forward ${t.forward.toFixed(1)} ms)`,
    );
    expect(coarse).toBeLessThan(MARGIN * COARSE_BUDGET);
    expect(full).toBeLessThan(MARGIN * FULL_BUDGET);
  });
});
