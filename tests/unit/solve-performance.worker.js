/**
 * Times the solve of the default preset in a worker thread and posts the
 * result to the parent: status, cold call and medians of the coarse and full
 * solve (ms), and the timings of one full solve. It also times the coarse
 * solve of a state whose closing blend no lead-in wrap closes (point 2 at
 * 10 in and 50 N), where a full solve runs trial solves. Used by
 * solve-performance.test.js.
 */

import { parentPort } from 'node:worker_threads';
import { solve } from '../../src/core/solve.js';
import { AMO_OFFSET, INCH } from '../../src/core/units.js';
import { defaultState } from '../../src/state/presets.js';

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

const state = defaultState();
const t0 = performance.now();
const first = solve(state);
const cold = performance.now() - t0;
for (let k = 0; k < 3; k++) solve(state, { resolution: 'coarse' });
const coarse = median(() => solve(state, { resolution: 'coarse' }), 15);
const full = median(() => solve(state), 7);
const open = defaultState();
open.curve.mode = 'custom';
open.curve.points[1] = { x: 10 * INCH - AMO_OFFSET, F: 50 };
const openResult = solve(open, { resolution: 'coarse' });
const openCoarse = median(() => solve(open, { resolution: 'coarse' }), 5);
parentPort?.postMessage({
  status: first.status,
  cold,
  coarse,
  full,
  timings: solve(state).timings,
  open: { codes: openResult.diagnostics.map((d) => d.code), trials: openResult.timings.trials, coarse: openCoarse },
});
