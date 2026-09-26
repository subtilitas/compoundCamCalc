/**
 * Optimise: a search for a free-form string track that improves one goal of
 * a design while it keeps every check and the other goal.
 *
 * - Goals: 'cam' makes the largest cam dimension smaller and keeps the
 *   largest force difference no worse than now; 'force' makes the largest
 *   force difference smaller and keeps the cam no larger than now.
 * - Search space: Fourier modes of the N track values (constant, cos kψ and
 *   sin kψ). Single values stall: on a round track p(ψ) + p(ψ + π) is the
 *   same in every direction, so moving one value makes the track larger on
 *   one side only.
 * - Method: compass search. A poll tries each mode with + then −, low modes
 *   first, the last successful direction first; the first candidate that is
 *   better by more than IMPROVEMENT is accepted. A poll without success
 *   halves the step; the search ends below STEP_MIN.
 * - Each candidate passes a prescreen on the spline first (value range,
 *   pitch-line radius of curvature with its margin, bore clearance), which
 *   takes microseconds and does not count as a solve. Solves are cached on
 *   the values rounded to VALUE_RESOLUTION.
 * - The cam goal solves candidates coarse (on the sample designs the cam
 *   size agrees with the full solve to within 0.003 mm) and confirms each
 *   improvement with a full solve; the force goal solves full throughout,
 *   since the coarse force difference reads 0.01 N to 0.62 N low.
 * - The current design may carry plausibility warnings (a cam-size warning
 *   is what the cam goal is for); a candidate must not add a warning the
 *   current design does not have, and may clear one.
 *
 * The solve function is a parameter, so the search runs with the real
 * solver in a worker and with a synthetic objective in tests.
 * Lengths in m, forces in N, angles in rad.
 * @module core/optimise
 */

import { VALUE_RESOLUTION, clearsBore, knotAngles, sampleAnalytic, withinLimit } from './freeform.js';
import { FIT_FORCE_FLOOR, FIT_FORCE_TOLERANCE } from './solve.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('./solve.js').SolveResult} SolveResult */
/** @typedef {'cam' | 'force'} OptimiseGoal */
/** @typedef {(state: ProjectState, options: { resolution: 'coarse' | 'full' }) => SolveResult} SolveFn */

/** Goals of Optimise with their labels, in menu order. */
export const GOALS = Object.freeze(/** @type {const} */ ({
  cam: 'Smallest cam, force curve no worse than now',
  force: 'Closest force curve, cam no larger than now',
}));

/** Largest number of solves of one run, not counting the solves of the current design. */
export const OPTIMISE_BUDGET = 600;

/** Safety stop of one run: 120 s (ms). Runs on the sample designs measured 2 s to 43 s in Node.js. */
export const OPTIMISE_TIME_LIMIT = 120_000;

/** First step: this fraction of the mean track value (0.6 mm on a 12 mm track). */
export const STEP_START = 0.05;

/** The search ends when the step falls below 0.05 mm (m). */
export const STEP_MIN = 0.05e-3;

/** Below this step, 0.2 mm, the search adds the modes above MODES_START up to N/2 (m). */
export const STEP_ALL_MODES = 0.2e-3;

/** Highest harmonic of the first polls. */
export const MODES_START = 4;

/** Smallest improvement of the objective that counts (m or N). */
export const IMPROVEMENT = 1e-9;

/**
 * Margin of the pitch-line radius of curvature over its limit: 1 mm, and
 * at least 10 % of the limit (m, fraction).
 */
export const RHO_MARGIN = Object.freeze({ min: 1e-3, share: 0.1 });

/** Largest string or cable wrap of a candidate: 350°, 10° under a full turn (rad). */
export const WRAP_LIMIT = (350 * Math.PI) / 180;

/**
 * Figures of one solve, the ones the goals and the result table use.
 * @typedef {object} Evaluation
 * @property {boolean} ok status ok and no diagnostic
 * @property {string[]} warnings codes of the plausibility warnings
 * @property {number} camSize largest cam dimension (m), NaN without metrics
 * @property {number} forceDifference largest difference between the
 *   achieved and the target force (N)
 * @property {number} tolerance force tolerance of the fit (N)
 * @property {number} letOff achieved let-off (fraction)
 * @property {number} stringMinRho smallest radius of curvature of the string pitch line (m)
 * @property {number} stringRhoLimit its limit (m)
 * @property {number} stringWrap (rad)
 * @property {number} cableWrap (rad)
 */

/**
 * Evaluation of a solve result. Without a fit the force difference is the
 * largest difference between the achieved and the target samples.
 * @param {SolveResult} result
 * @returns {Evaluation}
 */
export function evaluate(result) {
  const m = result.metrics;
  const target = result.target;
  let peak = 0;
  if (target) for (const f of target.F) peak = Math.max(peak, f);
  let difference = NaN;
  if (result.fit.used) difference = result.fit.maxForceDifference;
  else if (target && result.achieved && result.achieved.F.length === target.F.length) {
    difference = 0;
    for (let i = 0; i < target.F.length; i++) difference = Math.max(difference, Math.abs(result.achieved.F[i] - target.F[i]));
  }
  return {
    ok: result.status === 'ok' && result.diagnostics.length === 0 && m !== null,
    warnings: result.warnings.map((w) => w.code),
    camSize: m?.camMaxDimension ?? NaN,
    forceDifference: difference,
    tolerance: Math.max(FIT_FORCE_TOLERANCE * peak, FIT_FORCE_FLOOR),
    letOff: m?.letOff ?? NaN,
    stringMinRho: m?.stringMinRho ?? NaN,
    stringRhoLimit: m?.stringRhoLimit ?? NaN,
    stringWrap: m?.stringWrap ?? NaN,
    cableWrap: m?.cableWrap ?? NaN,
  };
}

/**
 * Objective of a goal: the cam size or the force difference.
 * @param {OptimiseGoal} goal
 * @param {Evaluation} e
 */
export function objectiveOf(goal, e) {
  return goal === 'cam' ? e.camSize : e.forceDifference;
}

/**
 * Limits a candidate must keep, from the evaluation of the current design.
 * @typedef {object} Limits
 * @property {number} rho smallest pitch-line radius of curvature, the limit plus RHO_MARGIN (m)
 * @property {number} force largest force difference (N); Infinity for the force goal
 * @property {number} cam largest cam size (m); Infinity for the cam goal
 * @property {readonly string[]} warnings codes of the warnings a candidate
 *   may have: those of the current design
 */

/**
 * Limits of a goal from the evaluation of the current design at the
 * resolution the candidates are compared at.
 * @param {OptimiseGoal} goal
 * @param {Evaluation} start
 * @returns {Limits}
 */
export function limitsFor(goal, start) {
  const lim = start.stringRhoLimit;
  return {
    // A design that starts inside the margin keeps at least its own bend,
    // so the search is not stuck on a margin the start does not meet.
    rho: Math.min(lim + Math.max(RHO_MARGIN.min, RHO_MARGIN.share * lim), Math.max(lim, start.stringMinRho)),
    // "Force curve no worse than now".
    force: goal === 'cam' ? start.forceDifference : Infinity,
    cam: goal === 'force' ? start.camSize : Infinity,
    warnings: start.warnings,
  };
}

/**
 * True when an evaluation meets every check and the limits: status ok
 * without diagnostics, no warning outside limits.warnings, the pitch line
 * at least limits.rho, both wraps at most WRAP_LIMIT, and the force
 * difference and cam size within their limits.
 * @param {Evaluation} e
 * @param {Limits} limits
 */
export function meetsLimits(e, limits) {
  return e.ok
    && e.warnings.every((code) => limits.warnings.includes(code))
    && e.stringMinRho >= limits.rho
    && e.stringWrap <= WRAP_LIMIT
    && e.cableWrap <= WRAP_LIMIT
    && e.forceDifference <= limits.force
    && e.camSize <= limits.cam;
}

/**
 * Checks on the spline alone, without a solve: every value in
 * FREEFORM_RANGE, the pitch line at least rho, and the groove bottom at
 * least bore radius plus wall from the axle.
 * @param {readonly number[]} values
 * @param {{ rho: number, d: number, wall: number }} spec rho: smallest
 *   pitch-line radius of curvature; d: string diameter; wall: bore radius
 *   plus minimum wall (m)
 */
export function prescreen(values, spec) {
  return withinLimit(values, { rho: spec.rho, d: spec.d, margin: 0 }) && clearsBore(values, spec.wall);
}

/**
 * One search direction: a Fourier mode of the values, scaled so that a step
 * of the same size changes the radius of curvature about equally in every
 * mode (mode k of amplitude δ changes ρ by (1 − k²)·δ).
 * @typedef {object} Mode
 * @property {string} id 'c0', 'c1', 's1', …
 * @property {number} k harmonic
 * @property {Float64Array} vector the mode at the knots, divided by max(1, k² − 1)
 */

/**
 * Search modes of a track of n values: the constant, cos kψ and sin kψ for
 * k = 1 … min(MODES_START, n/2), or up to n/2 with `all`. sin(n/2·ψ) is zero
 * at every knot and left out.
 * @param {number} n
 * @param {boolean} all
 * @returns {Mode[]}
 */
export function searchModes(n, all) {
  const psi = knotAngles(n);
  const top = all ? Math.floor(n / 2) : Math.min(MODES_START, Math.floor(n / 2));
  /** @type {Mode[]} */
  const modes = [{ id: 'c0', k: 0, vector: new Float64Array(n).fill(1) }];
  for (let k = 1; k <= top; k++) {
    const scale = 1 / Math.max(1, k * k - 1);
    modes.push({ id: `c${k}`, k, vector: Float64Array.from(psi, (x) => scale * Math.cos(k * x)) });
    if (2 * k !== n) modes.push({ id: `s${k}`, k, vector: Float64Array.from(psi, (x) => scale * Math.sin(k * x)) });
  }
  return modes;
}

/** A value rounded to VALUE_RESOLUTION, 0.1 µm, as the sampled values of core/freeform. @param {number} v */
const rounded = (v) => Number(v.toFixed(7));

/** @param {readonly number[]} values */
const keyOf = (values) => values.map((v) => Math.round(v / VALUE_RESOLUTION)).join(',');

/**
 * The state with a free-form string track of the given values.
 * @param {ProjectState} state
 * @param {number[]} values
 * @returns {ProjectState}
 */
export function withValues(state, values) {
  return { ...state, stringTrack: { ...state.stringTrack, shape: 'freeform', freeform: { values } } };
}

/**
 * Values the search starts from: the free-form values, or the eccentric or
 * elliptical track sampled by sampleAnalytic (12 to 16 points).
 * @param {ProjectState} state
 * @returns {number[]}
 */
export function startValues(state) {
  return sampleAnalytic(state.stringTrack).values;
}

/**
 * @typedef {object} Progress
 * @property {number} solves solves so far
 * @property {number} budget
 * @property {number} step current step (m)
 * @property {number} halvings log2 of the first step over the current step
 * @property {number} elapsed (ms)
 * @property {number} best objective of the best track so far (m or N)
 */

/**
 * @typedef {object} Improvement
 * @property {number[]} values
 * @property {number} objective (m or N)
 * @property {Evaluation} evaluation full solve
 * @property {number} solves
 * @property {number} step (m)
 */

/**
 * Why a run ended: converged (step below STEP_MIN), budget (solves used
 * up), time (OPTIMISE_TIME_LIMIT), start (the full solve of the current
 * design fails a check, so there is nothing to keep), start-coarse (the
 * cam goal only: the full solve passes but the coarse solve the candidates
 * are compared with fails a check).
 * @typedef {'converged' | 'budget' | 'time' | 'start' | 'start-coarse'} StopReason
 */

/**
 * @typedef {object} Outcome
 * @property {OptimiseGoal} goal
 * @property {Evaluation} start full solve of the current design
 * @property {import('./freeform.js').SampledTrack | null} sampled an
 *   eccentric or elliptical track sampled for the search; null for a
 *   free-form track
 * @property {Improvement | null} best null when no track was better
 * @property {number} solves
 * @property {StopReason} reason
 * @property {number} elapsed (ms)
 */

/**
 * @typedef {object} OptimiseOptions
 * @property {ProjectState} state current design, which meets every check
 *   (plausibility warnings allowed)
 * @property {OptimiseGoal} goal
 * @property {SolveFn} solve
 * @property {number} [budget] largest number of solves (default OPTIMISE_BUDGET)
 * @property {number} [timeLimit] (ms, default OPTIMISE_TIME_LIMIT)
 * @property {() => number} [now] clock (ms, default Date.now)
 * @property {(start: Evaluation) => void} [onStart] after the full solve of the current design
 * @property {(p: Progress) => void} [onProgress] after each solve and each halving
 * @property {(i: Improvement) => void} [onImprove] after each confirmed improvement
 */

/**
 * Run the search. The current design is solved first at full resolution
 * (and coarse for the cam goal); these solves do not count against the
 * budget, and the first of them warms up a fresh worker. The run is
 * deterministic for a deterministic solve function, unless the time limit
 * stops it.
 * @param {OptimiseOptions} options
 * @returns {Outcome}
 */
export function optimise({
  state, goal, solve, budget = OPTIMISE_BUDGET, timeLimit = OPTIMISE_TIME_LIMIT, now = Date.now,
  onStart = () => {}, onProgress = () => {}, onImprove = () => {},
}) {
  const t0 = now();
  const start = evaluate(solve(state, { resolution: 'full' }));
  onStart(start);
  const coarseStart = goal === 'cam' && start.ok ? evaluate(solve(state, { resolution: 'coarse' })) : start;
  const fullLimits = limitsFor(goal, start);
  const coarseLimits = limitsFor(goal, coarseStart);
  const spec = {
    rho: fullLimits.rho,
    d: state.cords.stringDiameter,
    wall: state.body.boreDiameter / 2 + state.body.minWall,
  };
  const sampled = state.stringTrack.shape === 'freeform' ? null : sampleAnalytic(state.stringTrack);
  let x = sampled ? sampled.values : startValues(state);
  const n = x.length;
  /** Objective of the incumbent at full resolution, and at the resolution candidates are compared at. */
  let bestFull = objectiveOf(goal, start);
  let bestCompare = objectiveOf(goal, coarseStart);
  /** @type {Improvement | null} */
  let best = null;
  let solves = 0;
  let step = (STEP_START * x.reduce((a, v) => a + v, 0)) / n;
  const step0 = step;
  /** @type {Map<string, Evaluation>} */
  const coarseCache = new Map();
  /** @type {Map<string, Evaluation>} */
  const fullCache = new Map();

  /** @param {StopReason} reason @returns {Outcome} */
  const finish = (reason) => ({ goal, start, sampled, best, solves, reason, elapsed: now() - t0 });
  const progress = () => onProgress({
    solves, budget, step, halvings: Math.log2(step0 / step), elapsed: now() - t0, best: bestFull,
  });

  if (!start.ok) return finish('start');
  if (!coarseStart.ok) return finish('start-coarse');

  /**
   * Evaluation of values at a resolution, through the cache; the stop
   * reason when the budget or the time is used up.
   * @param {number[]} values
   * @param {'coarse' | 'full'} resolution
   * @returns {Evaluation | StopReason}
   */
  const solved = (values, resolution) => {
    const cache = resolution === 'full' ? fullCache : coarseCache;
    const key = keyOf(values);
    const hit = cache.get(key);
    if (hit) return hit;
    if (solves >= budget) return 'budget';
    if (now() - t0 > timeLimit) return 'time';
    const e = evaluate(solve(withValues(state, values), { resolution }));
    solves++;
    cache.set(key, e);
    progress();
    return e;
  };

  /**
   * Try a candidate: 'better' when accepted, 'worse' when not, or the
   * reason to stop.
   * @param {number[]} values
   * @returns {'better' | 'worse' | StopReason}
   */
  const attempt = (values) => {
    if (!prescreen(values, spec)) return 'worse';
    const first = solved(values, goal === 'cam' ? 'coarse' : 'full');
    if (typeof first === 'string') return first;
    if (!meetsLimits(first, goal === 'cam' ? coarseLimits : fullLimits)) return 'worse';
    if (!(objectiveOf(goal, first) < bestCompare - IMPROVEMENT)) return 'worse';
    const full = goal === 'cam' ? solved(values, 'full') : first;
    if (typeof full === 'string') return full;
    if (!meetsLimits(full, fullLimits) || !(objectiveOf(goal, full) < bestFull - IMPROVEMENT)) return 'worse';
    x = values;
    bestCompare = objectiveOf(goal, first);
    bestFull = objectiveOf(goal, full);
    best = { values: [...values], objective: bestFull, evaluation: full, solves, step };
    onImprove(best);
    return 'better';
  };

  /** Last successful direction, as mode id and sign. */
  let last = '';
  while (step >= STEP_MIN) {
    const modes = searchModes(n, step < STEP_ALL_MODES);
    /** @type {{ mode: Mode, sign: 1 | -1, id: string }[]} */
    const directions = modes.flatMap((mode) => [
      { mode, sign: /** @type {1} */ (1), id: `+${mode.id}` },
      { mode, sign: /** @type {-1} */ (-1), id: `-${mode.id}` },
    ]);
    const first = directions.findIndex((d) => d.id === last);
    if (first > 0) directions.unshift(...directions.splice(first, 1));
    let moved = false;
    for (const d of directions) {
      const candidate = x.map((v, i) => rounded(v + d.sign * step * d.mode.vector[i]));
      const r = attempt(candidate);
      if (r === 'better') {
        last = d.id;
        moved = true;
        break;
      }
      if (r !== 'worse') return finish(r);
    }
    if (!moved) {
      step /= 2;
      progress();
    }
  }
  return finish('converged');
}
