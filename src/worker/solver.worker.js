/**
 * Solver worker: answers {id, state, resolution} with {id, resolution,
 * result}. solve never throws; an error that escapes it anyway comes back as
 * a result with a no-convergence diagnostic, so the page always gets an
 * answer for a request.
 * @module worker/solver.worker
 */

import { diagnostic } from '../core/diagnostics.js';
import { solve } from '../core/solve.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/**
 * @typedef {object} SolveRequest
 * @property {number} id request number, echoed in the answer
 * @property {ProjectState} state
 * @property {'coarse' | 'full'} resolution
 */

/**
 * @typedef {object} SolveAnswer
 * @property {number} id
 * @property {'coarse' | 'full'} resolution
 * @property {SolveResult} result
 */

/**
 * Result of a solve that threw: status no-convergence, no curves, no cam and
 * one no-convergence diagnostic that names the error. Same shape as every
 * other SolveResult.
 * @param {'coarse' | 'full'} resolution
 * @param {unknown} error
 * @returns {SolveResult}
 */
export function failedResult(resolution, error) {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = raw.trim().replace(/\.+$/, '') || 'no details';
  return {
    status: 'no-convergence',
    diagnostics: [
      diagnostic(
        'no-convergence',
        `The solver stopped with an internal error: ${detail}.`,
        'Change any input to solve again, or reload the page if the error repeats',
      ),
    ],
    warnings: [],
    resolution,
    target: null,
    achieved: null,
    ideal: null,
    brace: null,
    tracks: {
      stringPitch: null,
      cablePitch: null,
      grooves: { string: null, cable: null },
      flanges: { string: null, cable: null },
      cable: null,
      string: null,
    },
    outlines: {},
    posts: [],
    marks: [],
    fit: {
      used: false, reason: '', rms: NaN, maxDeviation: NaN, peakDifference: NaN, letOffDifference: NaN,
      energyDifference: NaN, maxForceDifference: NaN, withinTolerance: false, idealIssues: [], pointsMatched: 0,
    },
    metrics: null,
    idealTrack: null,
    timings: { total: 0, inverse: 0, fit: 0, outline: 0, forward: 0, trials: 0 },
  };
}

/**
 * Answer one request. Any resolution other than 'coarse' means 'full'.
 * @param {SolveRequest} request
 * @param {typeof solve} [solveFn] the solver (tests pass a stand-in)
 * @returns {SolveAnswer}
 */
export function answer(request, solveFn = solve) {
  const resolution = request.resolution === 'coarse' ? 'coarse' : 'full';
  /** @type {SolveResult} */
  let result;
  try {
    result = solveFn(request.state, { resolution });
  } catch (error) {
    result = failedResult(resolution, error);
  }
  return { id: request.id, resolution, result };
}

// Register the handler only inside a worker, so the main thread can import
// answer for its fallback without listening to its own messages.
const WorkerScope = /** @type {{ WorkerGlobalScope?: Function }} */ (/** @type {unknown} */ (globalThis)).WorkerGlobalScope;
if (typeof WorkerScope === 'function' && globalThis instanceof WorkerScope) {
  const scope = /** @type {{ addEventListener: (type: 'message', fn: (e: MessageEvent) => void) => void, postMessage: (data: unknown) => void }} */ (
    /** @type {unknown} */ (globalThis)
  );
  scope.addEventListener('message', (event) => {
    scope.postMessage(answer(/** @type {SolveRequest} */ (event.data)));
  });
}
