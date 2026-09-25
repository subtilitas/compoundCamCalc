/**
 * Times the solve of the default preset in a worker thread and posts the
 * result to the parent: status, cold call and medians of the coarse and full
 * solve (ms), and the timings of one full solve. Used by
 * solve-performance.test.js.
 */

import { parentPort } from 'node:worker_threads';
import { solve } from '../../src/core/solve.js';
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
parentPort?.postMessage({ status: first.status, cold, coarse, full, timings: solve(state).timings });
