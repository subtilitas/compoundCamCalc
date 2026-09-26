/**
 * Optimise worker: runs one search of core/optimise with the real solver
 * and posts its course. A second worker next to the solver worker, since
 * the latest-request-wins scheduler of the solver client would drop the
 * solves of a search. The page stops a run with terminate(), which ends it
 * at once; the improvements posted so far stay with the page.
 *
 * Messages to the page, in order:
 * - { type: 'start', start } full solve of the current design
 * - { type: 'progress', progress } after each solve and each halving
 * - { type: 'improved', improvement } after each confirmed improvement
 * - { type: 'done', outcome } at the end of the run
 * - { type: 'error', message } when the search throws
 * @module worker/optimise.worker
 */

import { OPTIMISE_BUDGET, optimise } from '../core/optimise.js';
import { solve } from '../core/solve.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../core/optimise.js').OptimiseGoal} OptimiseGoal */
/** @typedef {import('../core/optimise.js').SolveFn} SolveFn */

/**
 * @typedef {object} OptimiseRequest
 * @property {ProjectState} state current design
 * @property {OptimiseGoal} goal
 * @property {number} [budget] largest number of solves (default OPTIMISE_BUDGET)
 */

/**
 * @typedef {{ type: 'start', start: import('../core/optimise.js').Evaluation }
 *   | { type: 'progress', progress: import('../core/optimise.js').Progress }
 *   | { type: 'improved', improvement: import('../core/optimise.js').Improvement }
 *   | { type: 'done', outcome: import('../core/optimise.js').Outcome }
 *   | { type: 'error', message: string }} OptimiseMessage
 */

/**
 * Run one request and post its messages. An error thrown by the search
 * ends the run with an error message; the solver itself never throws.
 * @param {OptimiseRequest} request
 * @param {(message: OptimiseMessage) => void} post
 * @param {SolveFn} [solveFn] the solver (tests pass a stand-in)
 */
export function run(request, post, solveFn = solve) {
  try {
    const budget = Number.isInteger(request.budget) && /** @type {number} */ (request.budget) > 0
      ? Math.min(/** @type {number} */ (request.budget), OPTIMISE_BUDGET)
      : OPTIMISE_BUDGET;
    const outcome = optimise({
      state: request.state,
      goal: request.goal === 'force' ? 'force' : 'cam',
      solve: solveFn,
      budget,
      onStart: (start) => post({ type: 'start', start }),
      onProgress: (progress) => post({ type: 'progress', progress }),
      onImprove: (improvement) => post({ type: 'improved', improvement }),
    });
    post({ type: 'done', outcome });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    post({ type: 'error', message: raw.trim().replace(/\.+$/, '') || 'no details' });
  }
}

// Register the handler only inside a worker, so tests can import run.
const WorkerScope = /** @type {{ WorkerGlobalScope?: Function }} */ (/** @type {unknown} */ (globalThis)).WorkerGlobalScope;
if (typeof WorkerScope === 'function' && globalThis instanceof WorkerScope) {
  const scope = /** @type {{ addEventListener: (type: 'message', fn: (e: MessageEvent) => void) => void, postMessage: (data: unknown) => void }} */ (
    /** @type {unknown} */ (globalThis)
  );
  scope.addEventListener('message', (event) => {
    run(/** @type {OptimiseRequest} */ (event.data), (message) => scope.postMessage(message));
  });
}
