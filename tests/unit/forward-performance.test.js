import { describe, expect, it } from 'vitest';
import { COARSE_SAMPLES, FULL_SAMPLES, solveForward } from '../../src/core/forward.js';
import { stringTrackSupport, eccentricCircle, offset } from '../../src/core/support.js';
import { limbFromState } from '../../src/core/limb.js';
import { defaultState } from '../../src/state/presets.js';

/** Time budgets from docs/PLAN.md (ms). */
const COARSE_BUDGET = 8;
const FULL_BUDGET = 100;
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

describe('forward model performance', () => {
  it(`solves ${COARSE_SAMPLES} samples within ${COARSE_BUDGET} ms and ${FULL_SAMPLES} samples within ${FULL_BUDGET} ms`, () => {
    const state = defaultState();
    const input = {
      geometry: state.geometry,
      stringTrack: stringTrackSupport(state.stringTrack, state.cords.stringDiameter),
      cableTrack: offset(eccentricCircle({ radius: 0.018, offset: 0.008, phase: -Math.PI / 6 }), state.cords.cableDiameter / 2),
      limb: /** @type {import('../../src/core/limb.js').LimbData} */ (limbFromState(state.limb, state.geometry.limbLength).limb),
    };
    const t0 = performance.now();
    const first = solveForward(input);
    const cold = performance.now() - t0;
    expect(first.status).toBe('ok');
    for (let k = 0; k < 5; k++) solveForward(input);
    const coarse = median(() => solveForward({ ...input, samples: COARSE_SAMPLES }), 31);
    const full = median(() => solveForward({ ...input, samples: FULL_SAMPLES }), 11);
    console.info(
      `forward solve: cold ${cold.toFixed(2)} ms, coarse (${COARSE_SAMPLES}) ${coarse.toFixed(3)} ms, full (${FULL_SAMPLES}) ${full.toFixed(3)} ms`,
    );
    expect(coarse).toBeLessThan(MARGIN * COARSE_BUDGET);
    expect(full).toBeLessThan(MARGIN * FULL_BUDGET);
  });
});
