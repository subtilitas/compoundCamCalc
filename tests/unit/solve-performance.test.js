import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

/** Time budgets of the solve for the default preset, docs/PLAN.md (ms). */
const COARSE_BUDGET = 30;
const FULL_BUDGET = 200;
/** Allowance for slow and shared CI machines. */
const MARGIN = 5;

/**
 * @typedef {object} SolveTiming
 * @property {import('../../src/core/solve.js').SolveResult['status']} status of the first solve
 * @property {number} cold first full solve, before the engine optimises the code (ms)
 * @property {number} coarse median coarse solve (ms)
 * @property {number} full median full solve (ms)
 * @property {import('../../src/core/solve.js').SolveResult['timings']} timings of one full solve (ms)
 * @property {{ codes: string[], trials: number, coarse: number }} open coarse solve of a state whose closing
 *   blend no lead-in wrap closes: diagnostic codes, time of its trial solves and median time (ms)
 */

/**
 * Times the solve in a worker thread. The coverage run
 * (`npm run test:coverage`, as in CI) adds V8 block counters to the code of
 * the test process, which slow the solve about 4 times, and unevenly across
 * its parts (the fit about 5 times, the forward model about 3 times). A
 * worker thread has its own V8 isolate without them, so it times the code as
 * the app runs it, while the rest of the suite runs in parallel.
 * @returns {Promise<SolveTiming>}
 */
function timeInWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./solve-performance.worker.js', import.meta.url));
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`the timing worker exited with code ${code} before it reported`)));
  });
}

/** @type {Promise<SolveTiming> | undefined} */
let timing;
/** One timing run shared by the tests. */
const timed = () => (timing ??= timeInWorker());

describe('solve performance', () => {
  it(`solves the default preset coarsely within ${COARSE_BUDGET} ms and fully within ${FULL_BUDGET} ms`, async () => {
    const { status, cold, coarse, full, timings: t } = await timed();
    console.info(
      `solve: cold ${cold.toFixed(1)} ms, coarse ${coarse.toFixed(1)} ms, full ${full.toFixed(1)} ms ` +
        `(inverse ${t.inverse.toFixed(1)}, fit ${t.fit.toFixed(1)}, outline ${t.outline.toFixed(1)}, forward ${t.forward.toFixed(1)} ms)`,
    );
    expect(status).toBe('ok');
    expect(coarse).toBeLessThan(MARGIN * COARSE_BUDGET);
    expect(full).toBeLessThan(MARGIN * FULL_BUDGET);
  }, 30_000);

  it(`runs no closing-blend trials in a coarse solve and stays within 10 times the ${COARSE_BUDGET} ms coarse budget`, async () => {
    // Point 2 at 10 in and 50 N: no lead-in wrap closes the track. The full
    // solve runs five trial solves (about 350 ms); the coarse solve, which
    // runs while an input is dragged, runs none and takes about 80 ms.
    const { open } = await timed();
    console.info(`solve with an open closing blend: coarse ${open.coarse.toFixed(1)} ms, trials ${open.trials.toFixed(1)} ms`);
    expect(open.codes).toContain('closing-blend');
    expect(open.trials).toBe(0);
    expect(open.coarse).toBeLessThan(10 * COARSE_BUDGET);
  }, 30_000);
});
