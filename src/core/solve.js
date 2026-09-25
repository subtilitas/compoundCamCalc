/**
 * Top-level solve: project state → cable track, closed cam outline, achieved
 * force curve, metrics and diagnostics. Pure and synchronous; the result
 * holds plain objects and Float64Arrays only, so it survives structured
 * cloning to and from a worker. Never throws.
 *
 * Steps:
 * 1. Validate the state and place the first and last curve point exactly at
 *    brace and full draw; build the string pitch line, the bow geometry and
 *    the limb ('travel' mode: stiffness from the draw energy of the target).
 * 2. Brace conditions from the natural end slope F'(x_b) of the target;
 *    rebuild the target with the brace second derivative F''(x_b).
 * 3. Inverse model on a draw grid (x − x_b = s², plus the first curve point
 *    x_1), checks of the ideal state.
 * 4. Ideal cable track: exact samples near a uniform ψ grid from x_1 to x_f,
 *    fitted by an interpolating C2 spline, and the brace blend on
 *    [ψ_c0, ψ(x_1)] (core/inverse).
 * 5. Radius of curvature and clearance of the ideal track; when violated,
 *    the constrained fit (core/fit) replaces it.
 * 6. Closed outline from the brace contact of the track, offsets, posts and
 *    marks (core/outline).
 * 7. Forward model of the final cam: achieved curve, loads and metrics.
 * 8. In a full solve, for a closing blend that no lead-in wrap closes:
 *    coarse trial solves with a larger string track or half the minimum
 *    bend radius choose the suggestion (at most five, 107 ms to 112 ms
 *    median on 76 edits of point 2); a coarse solve names the force curve.
 * @module core/solve
 */

import { MIN_FORCE, curveMetrics, drawRange } from './curve.js';
import { CODES, diagnostic, formatter, runs } from './diagnostics.js';
import { fitCableTrack } from './fit.js';
import { COARSE_SAMPLES, FULL_SAMPLES, MAX_ITERATION_LIMIT, drawGrid, solveForward } from './forward.js';
import { createCurve } from './interp.js';
import {
  braceBlend, braceConditions, cableSpline, createInverse, resampleCable, sampleInverse,
} from './inverse.js';
import { limbFromState } from './limb.js';
import {
  CLOSED_TOLERANCE, cableStopPost, closeCableTrack, createPiecewise, maxDimension, minimumOn, sampleOutline, terminationPost,
  trackMark, trackOffsets,
} from './outline.js';
import { createSupport, stringTrackSupport, toSupportData } from './support.js';
import { FIELDS, validate } from '../state/schema.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('./diagnostics.js').SolveDiagnostic} SolveDiagnostic */
/** @typedef {import('./support.js').SupportData} SupportData */
/** @typedef {import('./support.js').Support} Support */
/** @typedef {import('./outline.js').Post} Post */
/** @typedef {import('./outline.js').Mark} Mark */

const DEG = Math.PI / 180;
/** Margin of the groove bottom radius of curvature over d/2 (m). */
export const GROOVE_MARGIN = 0.2e-3;

/**
 * Smallest allowed radius of curvature of a pitch line, ρ_lim: the minimum
 * bend radius, and at least the cord radius plus GROOVE_MARGIN, so the
 * groove bottom stays convex.
 * @param {{ minBendRadius: number }} body
 * @param {number} d cord diameter (m)
 * @returns {number} (m)
 */
function rhoLimitFor(body, d) {
  return Math.max(body.minBendRadius, d / 2 + GROOVE_MARGIN);
}

/**
 * Largest force difference between the achieved curve of a fitted cable
 * track and the target that still counts as meeting the target: this
 * fraction of the peak (8.0 N at 267 N), at least FIT_FORCE_FLOOR. The draw
 * energy must agree within FIT_ENERGY_TOLERANCE. The ideal track bends the
 * wrong way at the corners of the target (peak start and end, let-off
 * transition), and a convex cam rounds them: on the default preset the
 * difference stays at 3.7 N to 3.9 N for 22 to 90 spline intervals.
 */
export const FIT_FORCE_TOLERANCE = 0.03;
/** Smallest force tolerance of a fitted cam (N). */
export const FIT_FORCE_FLOOR = 2;
/** Relative draw energy tolerance of a fitted cam. */
export const FIT_ENERGY_TOLERANCE = 0.005;
/** Largest number of passes that settle the travel-mode stiffness. */
export const ENERGY_PASSES = 50;
/** Relative change of the draw energy below which the travel-mode stiffness has settled. */
export const ENERGY_SETTLED = 1e-9;
/**
 * Distance of the brace contact of a cable track after ψ_c0 above which the
 * lead-in starts at that contact (rad). A track with p(ψ_c0) = p_c0 has its
 * contact within 1e-15 rad of ψ_c0.
 */
const BRACE_CONTACT_TOLERANCE = 1e-9;

/**
 * Difference between the achieved and the ideal full-draw string contact
 * above which the string termination moves to the achieved contact (rad).
 */
const TERMINATION_TOLERANCE = 1e-9;

/**
 * Codes of the ideal-track checks that the checks of the final cam replace
 * once it is built.
 */
const FINAL_CAM_CODES = new Set(['string-wrap', 'limb-rotation']);

/**
 * Sample counts and spacings per resolution.
 * - forward: draw samples of the achieved curve
 * - inverse: draw samples of the ideal state
 * - step: ψ spacing of the ideal cable samples and of the closed spline (rad)
 * - outline: points per sampled closed outline
 */
export const RESOLUTIONS = Object.freeze({
  coarse: Object.freeze({ forward: COARSE_SAMPLES, inverse: 100, step: 0.5 * DEG, outline: 360 }),
  full: Object.freeze({ forward: FULL_SAMPLES, inverse: 600, step: 0.25 * DEG, outline: 720 }),
});

/**
 * @typedef {object} Outline
 * @property {Float64Array} x cam frame (m); last point = first point
 * @property {Float64Array} y
 */

/**
 * Sampled closed outlines. A result without a cable track (for example
 * brace-tension, cable-lever, cable-wrap, limb-energy, or no track that the
 * fit and the closing blend can build) has the three string outlines only;
 * an invalid-input result has none.
 * @typedef {object} SolveOutlines
 * @property {Outline} [stringPitch]
 * @property {Outline} [stringGroove]
 * @property {Outline} [stringFlange]
 * @property {Outline} [cablePitch]
 * @property {Outline} [cableGroove]
 * @property {Outline} [cableFlange]
 */

/**
 * Values of the solve beside the brace conditions of the target.
 * @typedef {object} SolveBraceExtra
 * @property {boolean} shapePreserved the target rebuilt with F''(x_b) is
 *   monotone between its points
 * @property {number} naturalSecond F''(x_b) of the curve without the brace
 *   correction (N/m²)
 * @property {number} [blendStartPsi] ψ_c0, start of the brace blend (rad)
 * @property {number} [blendEndPsi] ψ_1, cable contact angle at point 2, end
 *   of the brace blend (rad)
 * @property {number} [blendEndX] x_1, nock position of point 2 (m)
 */

/**
 * Brace conditions of the target; the blend fields exist when the ideal
 * cable track was built.
 * @typedef {import('./inverse.js').BraceConditions & SolveBraceExtra} SolveBrace
 */

/**
 * @typedef {object} SolveMetrics
 * @property {number} peak achieved peak draw force (N)
 * @property {number} holding holding weight: smallest force after the peak (N)
 * @property {number} letOff (peak − holding)/peak
 * @property {number} drawEnergy (J)
 * @property {number} limbEnergy both limbs at full draw, including preload (J)
 * @property {number} axleTravel arc travel of the axle R_L·α_f (m)
 * @property {number} rotation cam rotation at full draw θ_f (rad)
 * @property {number} limbRotation α_f (rad)
 * @property {number} stringLength (m)
 * @property {number} cableLength (m)
 * @property {number} camMaxDimension largest distance across the flange outlines (m)
 * @property {number} stringMinRho smallest radius of curvature of the string pitch line (m)
 * @property {number} stringRhoLimit smallest allowed radius of curvature of the string track (m)
 * @property {number} cableMinRho smallest radius of curvature of the cable pitch line (m)
 * @property {number} cableRhoLimit smallest allowed radius of curvature of the cable track (m)
 * @property {number} stringWrap string wrap at brace, including the residual wrap (rad)
 * @property {number} cableWrap cable wrap at full draw, including the lead-in wrap (rad)
 */

/**
 * @typedef {object} SolveResult
 * @property {'ok' | 'infeasible' | 'no-convergence'} status
 * @property {SolveDiagnostic[]} diagnostics
 * @property {'coarse' | 'full'} resolution
 * @property {{ x: Float64Array, F: Float64Array } | null} target target force
 *   curve after the brace correction, on the forward grid
 * @property {{ x: Float64Array, F: Float64Array, theta: Float64Array, alpha: Float64Array, Ts: Float64Array,
 *   Tc: Float64Array, phi: Float64Array, psiS: Float64Array, psiC: Float64Array, pS: Float64Array,
 *   pC: Float64Array, axleX: Float64Array, axleY: Float64Array, spanS: Float64Array, spanC: Float64Array } | null} achieved
 *   forward model of the final cam
 * @property {{ x: Float64Array, F: Float64Array, theta: Float64Array, alpha: Float64Array, Ts: Float64Array,
 *   Tc: Float64Array, pC: Float64Array, psiC: Float64Array } | null} ideal inverse model samples
 * @property {SolveBrace | null} brace brace conditions and the brace blend
 * @property {{ stringPitch: SupportData | null, cablePitch: SupportData | null,
 *   grooves: { string: SupportData | null, cable: SupportData | null },
 *   flanges: { string: SupportData | null, cable: SupportData | null },
 *   cable: { psiStart: number, psiBrace: number, psiFull: number, activeEnd: number, blendLength: number,
 *     leadInRho: number, blendMinRho: number } | null,
 *   string: { psiFull: number, psiEnd: number } | null }} tracks pitch lines
 *   as support data; cable: termination (brace contact − lead-in), brace
 *   contact of the built cam (ψ_c0 when the track keeps p(ψ_c0) = p_c0),
 *   full-draw contact angle of the forward model of the built cam, end of the
 *   active track where the closing blend starts, arc of the closing blend
 *   (rad), radius of curvature
 *   ρ_0 the lead-in settles to and smallest ρ of the closing blend (m);
 *   string: full-draw contact angle and termination (rad)
 * @property {SolveOutlines} outlines
 * @property {Post[]} posts
 * @property {Mark[]} marks
 * @property {{ used: boolean, reason: string, rms: number, maxDeviation: number, peakDifference: number,
 *   letOffDifference: number, energyDifference: number, maxForceDifference: number, withinTolerance: boolean,
 *   idealIssues: string[], pointsMatched: number }} fit constrained fit of the cable track: used when the ideal
 *   track violates the radius or lever-arm limits; deviations of the fitted
 *   track from the ideal samples (m) and of the achieved curve from the
 *   target (N, ratio, J); within the tolerance the violations of the ideal
 *   track are listed in idealIssues instead of the diagnostics
 * @property {SolveMetrics | null} metrics
 * @property {{ minRho: number, minP: number, maxP: number, rhoShortfall: number, start: number, end: number } | null} idealTrack
 *   ideal cable track on its angle range: smallest ρ and p, largest p (m),
 *   ∫ max(0, ρ_lim − ρ) dψ (m·rad), start and end angle (rad)
 * @property {{ total: number, inverse: number, fit: number, outline: number, forward: number, trials: number }} timings
 *   (ms); trials: the trial solves of a closing-blend suggestion, which
 *   run in a full solve only (0 in a coarse solve)
 */

const now = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * @param {'coarse' | 'full'} resolution
 * @returns {SolveResult}
 */
function emptyResult(resolution) {
  return {
    status: 'infeasible',
    diagnostics: [],
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
 * Solve a project state. Never throws: invalid input, infeasible targets and
 * numerical failures come back as diagnostics.
 * @param {ProjectState} state
 * @param {{ resolution?: 'coarse' | 'full', maxIterations?: number }} [options] resolution
 *   (default 'full') and the Newton iteration limit of the string closure
 *   and of the forward model (default 30; an integer from 1 to 200, anything
 *   else but undefined gives invalid-input)
 * @returns {SolveResult}
 */
export function solve(state, options = {}) {
  // Options from untyped or deserialized data: a missing or non-object
  // container means the defaults.
  const o = options !== null && typeof options === 'object' ? options : {};
  return guardedSolve(state, o.resolution === 'coarse' ? 'coarse' : 'full', o.maxIterations, true);
}

/**
 * Trial solve of a suggestion: a coarse solve without trials of its own
 * that stops at the first stage with a diagnostic. True when it reports
 * none, as a coarse solve of the state does.
 * @param {ProjectState} state
 * @param {number} [maxIterations]
 * @returns {boolean}
 */
export function trialPasses(state, maxIterations) {
  return guardedSolve(state, 'coarse', maxIterations, false).status === 'ok';
}

/**
 * solveState with internal errors as a no-convergence diagnostic, and the
 * status and total time set.
 * @param {ProjectState} state
 * @param {'coarse' | 'full'} resolution
 * @param {number | undefined} maxIterations
 * @param {boolean} trials run the trial solves of the closing-blend
 *   suggestion (false inside a trial solve)
 * @returns {SolveResult}
 */
function guardedSolve(state, resolution, maxIterations, trials) {
  const t0 = now();
  let result;
  try {
    result = solveState(state, resolution, maxIterations, trials);
  } catch (err) {
    result = emptyResult(resolution);
    result.diagnostics.push(
      diagnostic(
        'no-convergence',
        `The solver stopped with an internal error: ${err instanceof Error ? err.message : String(err)}`,
        'Change the last edited input; if the error stays, report it with the project file',
      ),
    );
  }
  const codes = result.diagnostics.map((d) => d.code);
  result.status = codes.includes('no-convergence') ? 'no-convergence' : codes.length > 0 ? 'infeasible' : 'ok';
  result.timings.total = now() - t0;
  return result;
}

/**
 * @param {ProjectState} state
 * @param {'coarse' | 'full'} resolution
 * @param {number | undefined} maxIterations
 * @param {boolean} trials run the trial solves of the closing-blend
 *   suggestion (false inside a trial solve)
 * @returns {SolveResult}
 */
function solveState(state, resolution, maxIterations, trials) {
  const res = emptyResult(resolution);
  const settings = RESOLUTIONS[resolution];
  const diags = res.diagnostics;
  // A trial solve only asks whether any diagnostic is reported. It stops
  // after the first stage that adds one, except for the string wrap and
  // the limb rotation of the ideal track, which the final cam's checks
  // replace.
  const trialFails = () => !trials && diags.some((d) => !FINAL_CAM_CODES.has(d.code));
  const errors = validate(state);
  if (errors.length > 0) {
    diags.push(
      diagnostic(
        'invalid-input',
        `The project data is not valid: ${errors.map((e) => e.message).join('; ')}`,
        'Correct the marked input fields',
      ),
    );
    return res;
  }
  if (maxIterations !== undefined && !(Number.isInteger(maxIterations) && maxIterations >= 1 && maxIterations <= MAX_ITERATION_LIMIT)) {
    diags.push(
      diagnostic(
        'invalid-input',
        `The iteration limit ${String(maxIterations)} is not an integer from 1 to ${MAX_ITERATION_LIMIT}`,
        `Leave the iteration limit out, or give an integer from 1 to ${MAX_ITERATION_LIMIT}`,
      ),
    );
    return res;
  }
  const fmt = formatter(state.units);
  const { geometry, cords, body } = state;
  // Validation accepts the first and last curve point within 1e-9 m of brace
  // and full draw; the solver places them exactly there, so the first grid
  // sample is the brace sample of the inverse model.
  const range = drawRange(geometry.braceHeight, geometry.drawLength);
  const last = state.curve.points.length - 1;
  const points = state.curve.points.map((q, i) => ({ x: i === 0 ? range.xBrace : i === last ? range.xFull : q.x, F: q.F }));
  const tInverse = now();

  // String track and target.
  const stringPitch = stringTrackSupport(state.stringTrack, cords.stringDiameter);
  const stringSupport = createSupport(stringPitch);
  res.tracks.stringPitch = stringPitch;
  const stringOffsets = trackOffsets(stringPitch, cords.stringDiameter, cords.stringGrooveDepth);
  res.tracks.grooves.string = stringOffsets.groove;
  res.tracks.flanges.string = stringOffsets.flange;
  const xBrace = points[0].x;
  const xFull = points[points.length - 1].x;
  const natural = createCurve(points);
  const slope = natural.derivative(xBrace, 1);

  // Limb, inverse context and brace conditions. In the travel mode the
  // stiffness depends on the energy of the rebuilt target, which depends on
  // the brace conditions of that stiffness: repeat until the energy the limb
  // was built from and the energy of the target agree.
  const travelMode = state.limb.mode === 'travel';
  let energy = natural.integral(xBrace, xFull);
  let limbData = null;
  let ctx = null;
  let brace = null;
  let curve = natural;
  let settled = !travelMode;
  let change = 0;
  for (let pass = 0; pass < (travelMode ? ENERGY_PASSES : 1); pass++) {
    const used = energy;
    const limbResult = limbFromState(state.limb, geometry.limbLength, { drawEnergy: used });
    if (!limbResult.limb) {
      diags.push(diagnostic('invalid-input', `The limb cannot be built: ${limbResult.error}`, 'Check the limb settings'));
      return res;
    }
    limbData = limbResult.limb;
    const created = createInverse({ geometry, stringTrack: stringPitch, limb: limbData, maxIterations });
    if (!created.context) {
      diags.push(
        diagnostic(
          'invalid-input',
          `The bow cannot be built at brace: ${created.error}`,
          'Increase the string track radius or reduce its offset',
        ),
      );
      return res;
    }
    ctx = created.context;
    brace = braceConditions(ctx, slope);
    curve = brace.ok ? createCurve(points, { startSlope: slope, startSecondDerivative: brace.second }) : natural;
    energy = curve.integral(xBrace, xFull);
    change = Math.abs(energy - used);
    if (travelMode && change <= ENERGY_SETTLED * Math.abs(used)) {
      settled = true;
      break;
    }
  }
  if (!settled) {
    diags.push(
      diagnostic(
        'no-convergence',
        `The limb stiffness of the travel mode does not settle: after ${ENERGY_PASSES} passes the draw energy still changes by ${fmt.energy(change)}`,
        'Use the stiffness mode, or change the limb travel',
      ),
    );
    return res;
  }
  if (!ctx || !brace || !limbData) return res;
  const limb = ctx.limb;
  const targetMetrics = curveMetrics(curve);
  const forwardGrid = drawGrid(xBrace, xFull, settings.forward);
  res.target = { x: forwardGrid, F: Float64Array.from(forwardGrid, (x) => curve.evaluate(x)) };
  /** @type {SolveBrace} */
  const solveBrace = { ...brace, shapePreserved: curve.shapePreserved, naturalSecond: natural.derivative(xBrace, 2) };
  res.brace = solveBrace;
  if (!braceOk(brace, state, ctx, limbData, points, fmt, diags)) {
    finishStringOnly(res, stringSupport, state, settings);
    return res;
  }
  if (!curve.shapePreserved) {
    diags.push(
      diagnostic(
        'target-shape',
        `With the curvature the cam needs at brace (${fmt.curvature(brace.second)} instead of ${fmt.curvature(natural.derivative(xBrace, 2))}), ` +
          'the force curve overshoots between brace and point 2',
        'Move point 2 closer to brace, or change its force towards the straight line from brace',
        { xRange: [points[0].x, points[1].x] },
      ),
    );
  }
  const target = { force: (/** @type {number} */ x) => curve.evaluate(x), work: (/** @type {number} */ x) => curve.integral(xBrace, x), slope };

  // Inverse model on the draw grid plus the curve points.
  const x1 = points[1].x;
  const grid = mergeGrid(drawGrid(xBrace, xFull, settings.inverse), points.map((q) => q.x));
  const samples = sampleInverse(ctx, brace, target, grid);
  const i1 = grid.indexOf(x1);
  res.ideal = {
    x: samples.x, F: samples.F, theta: samples.theta, alpha: samples.alpha, Ts: samples.Ts, Tc: samples.Tc,
    pC: samples.pC, psiC: samples.psiC,
  };
  if (samples.solved < samples.n) {
    const at = samples.x[samples.solved];
    const W = target.work(at);
    const energyFails = !Number.isFinite(limb.inverse(ctx.energy0 + W / 2));
    diags.push(
      energyFails
        ? diagnostic(
          'limb-energy',
          `The limbs cannot store the energy of the force curve beyond ${fmt.draw(at)}: the limb table ends its rise before ${fmt.energy(W)} of draw energy`,
          'Extend the limb table to more axle travel, or reduce the peak draw force',
          { xRange: [at, xFull] },
        )
        : diagnostic(
          'no-convergence',
          `The string closure of the inverse model did not converge at ${fmt.draw(at)}`,
          'Increase the string track radius or reduce its offset, then solve again',
          { xRange: [at, xFull] },
        ),
    );
    finishStringOnly(res, stringSupport, state, settings);
    return res;
  }
  const n = samples.n;
  const psiSFull = samples.psiS[n - 1];
  checkIdeal(samples, i1, state, ctx, limbData, targetMetrics, fmt, diags);

  // Ideal cable track: blend on [ψ_c0, ψ_1] and spline on [ψ_1, ψ_cf].
  const rhoLimitCable = rhoLimitFor(body, cords.cableDiameter);
  const pMin = body.boreDiameter / 2 + body.minWall + cords.cableDiameter / 2;
  const monotone = !diags.some((d) => d.code === 'cable-fold' || d.code === 'slack-cable');
  /** @type {import('./outline.js').Piecewise | null} */
  let ideal = null;
  /** @type {{ psi: Float64Array, x: Float64Array } | null} */
  let psiToX = null;
  let blendEnd = samples.psiC[0];
  if (monotone) {
    const resampled = resampleCable(ctx, brace, target, samples, settings.step, i1);
    if (resampled) {
      const spline = cableSpline(resampled.psi, resampled.p);
      const s = createSupport(spline);
      const psi1 = resampled.psi[0];
      const blend = braceBlend({
        psi0: samples.psiC[0],
        p0: samples.pC[0],
        psi1,
        p1: resampled.p[0],
        d1: s.dp(psi1),
        s1: s.d2p(psi1),
        integral: samples.anchorReach[0] - samples.anchorReach[i1],
      });
      if (blend) {
        blendEnd = psi1;
        ideal = createPiecewise([
          { ...blend, end: psi1 },
          { kind: 'spline', start: psi1, end: resampled.psi[resampled.psi.length - 1], data: spline },
        ]);
        psiToX = {
          psi: Float64Array.from([samples.psiC[0], ...resampled.psi]),
          x: Float64Array.from([xBrace, ...resampled.x]),
        };
        res.brace = { ...solveBrace, blendStartPsi: samples.psiC[0], blendEndPsi: psi1, blendEndX: x1 };
      }
    }
    if (!ideal) {
      diags.push(
        diagnostic(
          'no-convergence',
          'The ideal cable track could not be sampled at uniform cam angles',
          'Change the force curve slightly, then solve again',
          { xRange: [x1, xFull] },
        ),
      );
    }
  }
  res.timings.inverse = now() - tInverse;
  if (trialFails()) return res;

  // Radius of curvature and clearance of the ideal cable track; the
  // constrained fit replaces a track that violates them.
  const tFit = now();
  const psiC0 = samples.psiC[0];
  const psiCF = samples.psiC[n - 1];
  const checked = ideal ? checkCableTrack(ideal, psiToX, blendEnd, rhoLimitCable, pMin, state, samples, fmt) : null;
  const violations = checked ? checked.violations : [];
  res.idealTrack = checked ? checked.summary : null;
  /** @type {{ active: import('./outline.js').Piecewise, pointsMatched: number, rms: number, maxDeviation: number }[]} */
  const candidates = [];
  if (ideal && violations.length === 0) {
    candidates.push({ active: ideal, pointsMatched: 0, rms: 0, maxDeviation: 0 });
  } else {
    const data = fitData(ideal, samples, i1);
    const end = Math.max(psiCF, psiC0 + 10 * DEG);
    const startValue = samples.pC[0] >= pMin ? samples.pC[0] : undefined;
    const through = startValue === undefined ? [] : points.slice(1).flatMap((q) => {
      const i = grid.indexOf(q.x);
      const p = samples.pC[i];
      const integral = samples.anchorReach[0] - samples.anchorReach[i];
      const ok = p >= pMin && Number.isFinite(p) && Number.isFinite(integral) && samples.Tc[i] > 0 &&
        samples.psiC[i] > psiC0 && samples.psiC[i] <= end;
      return ok ? [{ psi: samples.psiC[i], p, integral }] : [];
    });
    const base = { psi: data.psi, p: data.p, start: psiC0, end, rhoMin: rhoLimitCable, pMin };
    /** @param {import('./fit.js').FitResult} f @param {number} matched */
    const add = (f, matched) => {
      if (f.spline) {
        const active = createPiecewise([{ kind: 'spline', start: psiC0, end, data: f.spline }]);
        candidates.push({ active, pointsMatched: matched, rms: f.rms, maxDeviation: f.maxDeviation });
      }
    };
    // Candidate 1: through the target state of the curve points. Points
    // close to brace lie in the brace region, where the target often needs a
    // lever arm that bends the wrong way: drop points from the brace end
    // until the conditions can be met.
    let skipped = 0;
    let fit = fitCableTrack({ ...base, startValue, through });
    while (fit.status !== 'optimal' && skipped < through.length) {
      skipped++;
      fit = fitCableTrack({ ...base, startValue, through: through.slice(skipped) });
    }
    if (skipped < through.length) add(fit, through.length - skipped);
    // Candidate 2: least squares with the brace lever arm only.
    let plain = fitCableTrack({ ...base, startValue });
    if (plain.status !== 'optimal') plain = fitCableTrack(base);
    add(plain, 0);
    res.fit.used = true;
    res.fit.reason = violations.length > 0 ? violations.map((v) => v.code).join(', ') : 'no ideal track';
    if (candidates.length === 0) {
      diags.push(
        diagnostic(
          'no-convergence',
          `No cable track meets the radius limit of ${fmt.size(rhoLimitCable)} and the lever arm limit of ${fmt.size(pMin)} (fit status: ${plain.status})`,
          'Reduce let-off or the peak draw force, or increase the string track radius',
        ),
      );
    }
  }
  res.timings.fit = now() - tFit;

  // The termination leaves the residual wrap at the ideal full-draw
  // contact; once the final cam is chosen it moves to the achieved one.
  let stringEnd = psiSFull + body.residualWrap;
  res.tracks.string = { psiFull: psiSFull, psiEnd: stringEnd };
  const minRhoString = checkStringTrack(stringSupport, state, psiSFull, fmt, diags);
  if (trialFails()) return res;

  // Closed outline and forward model of each candidate; the candidate whose
  // achieved curve is closest to the target (largest force difference) wins,
  // a closable one before one whose closing blend fails.
  /**
   * @type {{ candidate: (typeof candidates)[number], active: import('./outline.js').Piecewise,
   *   closed: import('./outline.js').ClosedCable, forward: import('./forward.js').ForwardResult, maxDiff: number,
   *   maxAt: number } | null}
   */
  let best = null;
  // The first active track whose closed track leaves the input domain of
  // support.js: reported when no candidate closes and no cable-wrap
  // diagnostic explains it.
  /** @type {import('./outline.js').Piecewise | null} */
  let unclosed = null;
  const D0 = 2 * ctx.bow.braceAxleY;
  for (const candidate of candidates) {
    const tOutline = now();
    // A fit without the brace value p(ψ_c0) = p_c0 has its brace contact
    // after ψ_c0; the lead-in then starts at that contact.
    const psiBrace = braceContact(candidate.active, D0);
    const active = psiBrace > candidate.active.start + BRACE_CONTACT_TOLERANCE && psiBrace < candidate.active.end
      ? trimTrack(candidate.active, psiBrace)
      : candidate.active;
    const wrap = active.end - active.start + body.leadInWrap;
    if (wrap >= 2 * Math.PI) {
      const reduce = wrap - 2 * Math.PI + 5 * DEG;
      diags.push(
        diagnostic(
          'cable-wrap',
          `The power cable wraps ${fmt.angle(wrap)} on its track at full draw, including the ${fmt.angle(body.leadInWrap)} lead-in wrap; a groove holds less than one turn`,
          body.leadInWrap > reduce
            ? `Reduce the lead-in wrap to at most ${fmt.angle(body.leadInWrap - reduce)}`
            : 'Increase the string track radius, so the cam turns less over the draw',
          { psiRange: [active.start - body.leadInWrap, active.end] },
        ),
      );
      unclosed = null;
      break;
    }
    const closed = closeCableTrack(active, { leadIn: body.leadInWrap, rhoMin: rhoLimitCable, pMin, step: settings.step });
    res.timings.outline += now() - tOutline;
    if (!closed) {
      unclosed ??= active;
      continue;
    }
    const tForward = now();
    const forward = solveForward({
      geometry,
      stringTrack: stringPitch,
      cableTrack: closed.support,
      limb: limbData,
      samples: settings.forward,
      maxIterations,
      stringTermination: stringEnd,
      cableTermination: closed.psiStart,
    });
    res.timings.forward += now() - tForward;
    let maxDiff = 0;
    let maxAt = -1;
    for (let i = 0; i < forward.n; i++) {
      const d = Math.abs(forward.F[i] - res.target.F[i]);
      if (!Number.isFinite(d)) {
        maxDiff = Infinity;
        maxAt = -1;
        break;
      }
      if (d > maxDiff) {
        maxDiff = d;
        maxAt = i;
      }
    }
    if (!best || (closed.ok && !best.closed.ok) || (closed.ok === best.closed.ok && maxDiff < best.maxDiff)) {
      best = { candidate, active, closed, forward, maxDiff, maxAt };
    }
  }
  /**
   * A closing blend that no lead-in wrap closes: in a full solve, trial
   * solves (coarse, without trials of their own) look for a change that
   * passes every check. A coarse solve runs while an input is dragged and
   * keeps the plain suggestion.
   * @param {ReturnType<typeof closingDiagnostic> | null} closing
   */
  const suggestChange = (closing) => {
    if (!trials || resolution !== 'full' || !closing || closing.closedByLeadIn) return;
    const tTrials = now();
    closing.diagnostic.suggestion = changeSuggestion(
      state, closing.tooSharp, fmt, (s) => trialPasses(s, maxIterations),
    );
    res.timings.trials = now() - tTrials;
  };
  if (!best) {
    if (unclosed) {
      const closing = closingDiagnostic(null, unclosed, state, rhoLimitCable, pMin, settings.step, fmt, trials);
      diags.push(closing.diagnostic);
      suggestChange(closing);
    }
    finishStringOnly(res, stringSupport, state, settings);
    return res;
  }
  const { closed } = best;
  let { forward } = best;
  // A fitted cam reaches a different string contact at full draw than the
  // ideal track: the termination follows it, so the residual wrap holds at
  // the achieved full draw. The contact angles do not depend on the
  // termination; the second forward solve gives the string length and the
  // wrap checks for the moved termination.
  const psiSFAchieved = forward.psiS[forward.n - 1];
  if (Number.isFinite(psiSFAchieved) && Math.abs(psiSFAchieved - psiSFull) > TERMINATION_TOLERANCE) {
    stringEnd = psiSFAchieved + body.residualWrap;
    res.tracks.string = { psiFull: psiSFAchieved, psiEnd: stringEnd };
    const tForward = now();
    forward = solveForward({
      geometry,
      stringTrack: stringPitch,
      cableTrack: closed.support,
      limb: limbData,
      samples: settings.forward,
      maxIterations,
      stringTermination: stringEnd,
      cableTermination: closed.psiStart,
    });
    res.timings.forward += now() - tForward;
  }
  // The string wrap and the limb rotation of the final cam replace those of
  // the ideal track, which differ for a fitted cam (by 0.005° and 0.008° on
  // the default preset and its edits); a trial solve has already stopped at
  // the ideal ones.
  for (const code of FINAL_CAM_CODES) {
    const k = diags.findIndex((d) => d.code === code);
    if (k >= 0) diags.splice(k, 1);
  }
  checkStringWrap(stringSupport, state, Number.isFinite(psiSFAchieved) ? psiSFAchieved : psiSFull, fmt, diags);
  const rotation = limbRotationDiagnostic(
    forward.alpha[forward.n - 1], forward.x[forward.n - 1], forward.drawEnergy, state, ctx, limbData, fmt,
  );
  if (rotation) diags.push(rotation);
  const closing = closed.ok ? null : closingDiagnostic(closed, best.active, state, rhoLimitCable, pMin, settings.step, fmt, trials);
  if (closing) diags.push(closing.diagnostic);
  if (trialFails()) return res;
  if (res.fit.used) {
    res.fit.pointsMatched = best.candidate.pointsMatched;
    res.fit.rms = best.candidate.rms;
    res.fit.maxDeviation = best.candidate.maxDeviation;
  }
  const cablePitch = closed.support;
  const cableSupport = createSupport(cablePitch);
  const cableOffsets = trackOffsets(cablePitch, cords.cableDiameter, cords.cableGrooveDepth);
  res.tracks.cablePitch = cablePitch;
  res.tracks.grooves.cable = cableOffsets.groove;
  res.tracks.flanges.cable = cableOffsets.flange;
  // The achieved full-draw contact of a fitted cam differs from the end of
  // the active track by up to about 0.1°; the closing blend starts at the
  // latter.
  const psiCFull = forward.psiC[forward.n - 1];
  res.tracks.cable = {
    psiStart: closed.psiStart, psiBrace: closed.psiBrace,
    psiFull: Number.isFinite(psiCFull) ? psiCFull : closed.psiFull, activeEnd: closed.psiFull,
    blendLength: closed.blendLength, leadInRho: closed.leadInRho, blendMinRho: closed.blendMinRho,
  };
  checkCableClearance(cableSupport, closed, state, fmt, diags);
  res.achieved = {
    x: forward.x, F: forward.F, theta: forward.theta, alpha: forward.alpha, Ts: forward.Ts, Tc: forward.Tc,
    phi: forward.phi, psiS: forward.psiS, psiC: forward.psiC, pS: forward.pS, pC: forward.pC,
    axleX: forward.axleX, axleY: forward.axleY, spanS: forward.spanS, spanC: forward.spanC,
  };
  forwardDiagnostics(forward, diags, fmt);

  // Outlines, posts, marks.
  const tOutline2 = now();
  const cableGroove = createSupport(cableOffsets.groove);
  const cableFlange = createSupport(cableOffsets.flange);
  const stringGroove = createSupport(stringOffsets.groove);
  const stringFlange = createSupport(stringOffsets.flange);
  const count = settings.outline;
  res.outlines = {
    stringPitch: sampleOutline(stringSupport, 0, count),
    stringGroove: sampleOutline(stringGroove, 0, count),
    stringFlange: sampleOutline(stringFlange, 0, count),
    cablePitch: sampleOutline(cableSupport, closed.psiStart, count),
    cableGroove: sampleOutline(cableGroove, closed.psiStart, count),
    cableFlange: sampleOutline(cableFlange, closed.psiStart, count),
  };
  const postRadius = body.postDiameter / 2;
  const thetaFull = forward.theta[forward.n - 1];
  const psiCFAchieved = Number.isFinite(forward.psiC[forward.n - 1]) ? forward.psiC[forward.n - 1] : closed.psiFull;
  const psiSFMark = Number.isFinite(forward.psiS[forward.n - 1]) ? forward.psiS[forward.n - 1] : psiSFull;
  const psiCBAchieved = Number.isFinite(forward.psiC[0]) ? forward.psiC[0] : closed.psiBrace;
  res.posts = [
    terminationPost(stringSupport, stringEnd, postRadius, cords.stringDiameter, 'string-post'),
    terminationPost(cableSupport, closed.psiStart, postRadius, cords.cableDiameter, 'cable-post'),
    cableStopPost(cableSupport, psiCFAchieved, postRadius, cords.cableDiameter),
  ];
  res.marks = [
    trackMark(stringSupport, 0, 'string-brace'),
    trackMark(cableSupport, psiCBAchieved, 'cable-brace'),
    trackMark(stringSupport, psiSFMark, 'full-draw'),
  ];
  res.timings.outline += now() - tOutline2;

  // Metrics.
  const achievedMetrics = sampleMetrics(forward.x, forward.F);
  const minRhoCable = minimumOn((psi) => cableSupport.rho(psi), closed.psiStart, closed.psiStart + 2 * Math.PI, 1440).value;
  res.metrics = {
    peak: achievedMetrics.peak,
    holding: achievedMetrics.hold,
    letOff: achievedMetrics.letOff,
    drawEnergy: forward.drawEnergy,
    limbEnergy: forward.limbEnergy,
    axleTravel: forward.alpha[forward.n - 1] * geometry.limbLength,
    rotation: thetaFull,
    limbRotation: forward.alpha[forward.n - 1],
    stringLength: forward.stringLength,
    cableLength: forward.cableLength,
    camMaxDimension: maxDimension([stringFlange, cableFlange]),
    stringMinRho: minRhoString,
    stringRhoLimit: rhoLimitFor(body, cords.stringDiameter),
    cableMinRho: minRhoCable,
    cableRhoLimit: rhoLimitCable,
    stringWrap: stringEnd - forward.psiS[0],
    cableWrap: forward.psiC[forward.n - 1] - closed.psiStart,
  };
  if (res.fit.used) {
    const maxDiff = best.maxDiff;
    res.fit.peakDifference = achievedMetrics.peak - targetMetrics.peak;
    res.fit.letOffDifference = achievedMetrics.letOff - targetMetrics.letOff;
    res.fit.energyDifference = forward.drawEnergy - targetMetrics.energy;
    res.fit.maxForceDifference = maxDiff;
    const tolerance = Math.max(FIT_FORCE_TOLERANCE * targetMetrics.peak, FIT_FORCE_FLOOR);
    const energyTolerance = FIT_ENERGY_TOLERANCE * targetMetrics.energy;
    const forceOk = maxDiff <= tolerance;
    const energyOk = Math.abs(res.fit.energyDifference) <= energyTolerance;
    res.fit.withinTolerance = forceOk && energyOk;
    const verdict = `${forceOk ? 'within' : 'more than'} the ${fmt.forceFine(tolerance)} tolerance` +
      (energyOk ? '' : `, and a draw energy difference above the ${fmt.energy(energyTolerance)} tolerance`);
    const miss = best.maxAt >= 0
      ? largestDifference(
        points, forward.x[best.maxAt], forward.F[best.maxAt] - res.target.F[best.maxAt], targetMetrics.xPeak,
        state.curve.mode === 'parametric', fmt,
      )
      : null;
    for (const d of violations) {
      d.message += `. The fitted cam meets the limits; its force curve differs from the target by up to ${fmt.forceFine(maxDiff)}, ` +
        `${verdict} (peak ${signed(fmt.forceFine(res.fit.peakDifference), res.fit.peakDifference)}, ` +
        `let-off ${signedPoints(res.fit.letOffDifference)}, draw energy ${signed(fmt.energy(res.fit.energyDifference), res.fit.energyDifference)})` +
        (miss ? miss.text : '');
      // The fitted cam is the built result, so the suggestion addresses the
      // part of the curve where its force misses the target.
      if (d.code === 'cable-radius' && miss) d.suggestion = miss.suggestion;
    }
    // A fitted cam that follows the target within the tolerance meets it:
    // the ideal track's violations stay in the fit record only.
    if (res.fit.withinTolerance) {
      res.fit.idealIssues = violations.map((d) => d.message);
      violations.length = 0;
    }
  }
  diags.push(...violations);
  suggestChange(closing);
  return res;
}

/**
 * Contact angle of the power cable on a cable track at brace: the tangent
 * from the anchor, which lies at (0, −D) in the cam frame at θ = 0, so the
 * root of f(ψ) = −D·sin ψ − p(ψ) with f' = −D·cos ψ − p'(ψ). Newton from
 * the start of the track; NaN when it does not converge.
 * @param {import('./outline.js').Piecewise} track
 * @param {number} D axle distance at brace 2·O_y (m)
 * @returns {number} (rad)
 */
function braceContact(track, D) {
  const buf = new Float64Array(3);
  let psi = track.start;
  for (let it = 0; it < 30; it++) {
    track.evaluate(psi, buf);
    const step = (-D * Math.sin(psi) - buf[0]) / (-D * Math.cos(psi) - buf[1]);
    if (!Number.isFinite(step)) return NaN;
    psi -= step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(psi))) return psi;
  }
  return NaN;
}

/**
 * The part of a track from `psi` on. The first piece keeps its data (a
 * spline piece takes `psi` as its start, a polynomial piece keeps its
 * parameter origin), so p, p' and p'' are unchanged.
 * @param {import('./outline.js').Piecewise} track
 * @param {number} psi inside (track.start, track.end) (rad)
 * @returns {import('./outline.js').Piecewise}
 */
function trimTrack(track, psi) {
  const pieces = track.pieces.filter((q) => q.end > psi).map((q, k) => (k === 0 && q.kind === 'spline' ? { ...q, start: psi } : q));
  return { ...createPiecewise(pieces), start: psi };
}

/**
 * @param {string} text formatted magnitude
 * @param {number} value
 */
function signed(text, value) {
  return value > 0 ? `+${text}` : text;
}

/**
 * @param {number} value ratio difference
 */
function signedPoints(value) {
  const points = (value * 100).toFixed(1);
  return `${value > 0 ? '+' : ''}${points} percentage points`;
}

/**
 * Increasing grid with the positions `extra` inserted; grid points within
 * 1e-9 m of an inserted position are dropped.
 * @param {Float64Array} grid
 * @param {number[]} extra
 * @returns {Float64Array}
 */
function mergeGrid(grid, extra) {
  const list = Array.from(grid).filter((x) => extra.every((e) => Math.abs(x - e) > 1e-9));
  list.push(...extra);
  list.sort((a, b) => a - b);
  return Float64Array.from(list);
}

/**
 * Peak, holding weight and let-off of sampled forces.
 * @param {Float64Array} x
 * @param {Float64Array} F
 */
function sampleMetrics(x, F) {
  let peak = -Infinity;
  let at = 0;
  for (let i = 0; i < F.length; i++) {
    if (F[i] > peak) {
      peak = F[i];
      at = i;
    }
  }
  let hold = Infinity;
  for (let i = at; i < F.length; i++) hold = Math.min(hold, F[i]);
  return { peak, hold, letOff: peak > 0 ? (peak - hold) / peak : NaN, xPeak: x[at] };
}

/**
 * Brace diagnostics. Returns false when no cam can be built.
 * @param {import('./inverse.js').BraceConditions} brace
 * @param {ProjectState} state
 * @param {import('./inverse.js').InverseContext} ctx
 * @param {import('./limb.js').LimbData} limbData
 * @param {ReadonlyArray<{ x: number, F: number }>} points
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 */
function braceOk(brace, state, ctx, limbData, points, fmt, diags) {
  if (!(ctx.bow.limbLength * Math.cos(ctx.bow.betaBrace) > 1e-9)) {
    diags.push(
      diagnostic(
        'cable-lever',
        `The limb lever stands at ${fmt.angle(ctx.bow.betaBrace)} at brace: limb rotation moves the axle across the bow and takes up no power cable`,
        'Reduce the limb lever angle at brace below 90°',
        { xRange: [points[0].x, points[0].x] },
      ),
    );
    return false;
  }
  if (brace.ok) return true;
  const Ts0 = brace.stringTension;
  const xb = points[0].x;
  if (!(brace.moment > 0)) {
    diags.push(
      diagnostic(
        'brace-tension',
        'The limbs carry no load at brace, so the string has no tension and the force cannot rise from brace',
        'Increase the limb preload travel above 0 mm',
        { xRange: [xb, xb] },
      ),
    );
    return false;
  }
  if (!(Ts0 > 0)) {
    diags.push(
      diagnostic(
        'brace-tension',
        `The force curve does not rise at brace (slope ${fmt.slope(brace.slope)}), so the string would carry no tension at brace`,
        `Raise the force of point 2 (now ${fmt.force(points[1].F)}) or move it closer to brace`,
        { xRange: [xb, points[1].x] },
      ),
    );
    return false;
  }
  // T_s0 ≥ M_b/s_a0: suggest the force of point 2 that gives 80 % of the
  // limit slope, or the limb whose brace moment makes T_s0 80 % of the limit.
  const factor = (0.8 * brace.maxStringTension) / Ts0;
  const preload = state.limb.preloadTravel;
  // In the stiffness mode the brace moment k·R_L·s_0 grows in proportion to
  // the preload travel s_0 and to the stiffness k, and T_s0 does not depend
  // on the limb: name the preload travel within its range, else the stiffness.
  let limbText = '';
  if (state.limb.mode === 'stiffness' && limbData.kind === 'linear' && preload > 0) {
    const neededPreload = preload / factor;
    const neededStiffness = state.limb.stiffness / factor;
    if (neededPreload <= FIELDS['limb.preloadTravel'].max) {
      limbText = `, or increase the limb preload travel to at least ${fmt.size(neededPreload)}`;
    } else if (neededStiffness <= FIELDS['limb.stiffness'].max) {
      limbText = `, or increase the limb stiffness to at least ${fmt.stiffness(neededStiffness)}`;
    }
  }
  const F2 = pointTwoForSlope(points, 0.8 * brace.maxSlope);
  const pointText = F2 >= MIN_FORCE
    ? `Reduce the force of point 2 to at most ${fmt.forceAtMost(F2)}`
    : 'Move point 2 further from brace';
  diags.push(
    diagnostic(
      'brace-tension',
      `The force curve rises too steeply at brace: its slope of ${fmt.slope(brace.slope)} needs a string tension of ${fmt.force(Ts0)} ` +
        `at brace, but the limb moment holds at most ${fmt.force(brace.maxStringTension)} (slope ${fmt.slope(brace.maxSlope)})`,
      `${pointText}${limbText}`,
      { xRange: [xb, points[1].x] },
    ),
  );
  return false;
}

/**
 * Force of point 2 at which the natural end slope F'(x_b) of the curve
 * equals `slope`, by bisection between 0 N and the present force. The end
 * slope is the three-point end formula of the interpolant, affine in the
 * force of point 2 with a positive factor and clamped at 0, so it rises
 * with that force. Returns 0 when no force below the present one gives a
 * slope above 0 that is at most `slope`.
 * @param {ReadonlyArray<{ x: number, F: number }>} points
 * @param {number} slope target F'(x_b), below the present end slope (N/m)
 * @returns {number} (N)
 */
function pointTwoForSlope(points, slope) {
  const xb = points[0].x;
  const at = (/** @type {number} */ F) => createCurve(points.map((q, i) => (i === 1 ? { x: q.x, F } : q))).derivative(xb, 1);
  let lo = 0;
  let hi = points[1].F;
  for (let it = 0; it < 60 && hi - lo > 1e-6 * Math.max(1, hi); it++) {
    const mid = 0.5 * (lo + hi);
    if (at(mid) > slope) hi = mid;
    else lo = mid;
  }
  return at(lo) > 0 ? lo : 0;
}

/**
 * Checks of the ideal (inverse) samples: force, cable tension, contact
 * order, limb rotation.
 * @param {import('./inverse.js').InverseSamples} s
 * @param {number} i1 index of the first curve point
 * @param {ProjectState} state
 * @param {import('./inverse.js').InverseContext} ctx
 * @param {import('./limb.js').LimbData} limbData
 * @param {import('./curve.js').CurveMetrics} targetMetrics
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 */
function checkIdeal(s, i1, state, ctx, limbData, targetMetrics, fmt, diags) {
  const n = s.n;
  for (const [a, b] of runs(n, (i) => i > 0 && !(s.F[i] > 0))) {
    diags.push(
      diagnostic(
        'nonpositive-force',
        `The force curve drops to 0 N or below ${fmt.drawRange([s.x[a], s.x[b]])}`,
        a <= i1 ? 'Raise the force of point 2 or move it further from brace' : 'Raise the forces of the points in this range above 0 N',
        { xRange: [s.x[a], s.x[b]] },
      ),
    );
  }
  for (const [a, b] of runs(n, (i) => i >= i1 && !(s.Tc[i] > 0))) {
    // Extra limb moment that makes E1' exceed s_a·T_s by 25 %.
    let need = 0;
    let maxTs = 0;
    for (let i = a; i <= b; i++) {
      need = Math.max(need, 1.25 * s.sA[i] * s.Ts[i] - s.moment[i]);
      maxTs = Math.max(maxTs, s.Ts[i]);
    }
    // For a linear limb E1' = k·R_L·(s + s_0): the extra moment comes from
    // more preload travel (within its range) or a stiffer limb.
    const preload = state.limb.preloadTravel;
    const R = state.geometry.limbLength;
    const k = limbData.kind === 'linear' ? limbData.torsionalStiffness / (R * R) : NaN;
    const extra = need / (k * R);
    let suggestion = 'Increase the limb preload or stiffness, or move the peak later in the draw';
    if (state.limb.mode === 'stiffness' && Number.isFinite(extra) && extra > 0) {
      let factor = 1;
      for (let i = a; i <= b; i++) factor = Math.max(factor, (1.25 * s.sA[i] * s.Ts[i]) / s.moment[i]);
      suggestion = preload + extra <= FIELDS['limb.preloadTravel'].max
        ? `Increase the limb preload travel to at least ${fmt.size(preload + extra)}, or move the peak later in the draw`
        : `Increase the limb stiffness to at least ${fmt.stiffness(k * factor)}, or move the peak later in the draw`;
    }
    diags.push(
      diagnostic(
        'slack-cable',
        `The string tension of up to ${fmt.force(maxTs)} ${fmt.drawRange([s.x[a], s.x[b]])} needs more limb moment than the limbs provide: the power cable would have to push`,
        suggestion,
        { xRange: [s.x[a], s.x[b]] },
      ),
    );
  }
  // The brace blend joins ψ_c0 to the contact at point 2 and needs
  // ψ_c(x_1) > ψ_c0; backward motion inside [x_b, x_1] is replaced by it.
  const evenRise = 'Lower the force of point 2 or move it later, so that the force rises more evenly from brace to point 3';
  if (i1 > 0 && !(s.psiC[i1] > s.psiC[0])) {
    diags.push(
      diagnostic(
        'cable-fold',
        `The cable contact would move backwards on the cam between brace and point 2: at point 2 (${fmt.draw(s.x[i1])}) ` +
          `it lies ${fmt.angle(s.psiC[0] - s.psiC[i1])} behind its brace position, so no convex cable track joins the two`,
        evenRise,
        { xRange: [s.x[0], s.x[i1]], psiRange: [s.psiC[i1], s.psiC[0]] },
      ),
    );
  }
  // The inverse model at x uses the target up to x only, so the let-off
  // changes a fold only where the force falls after the peak.
  const folds = runs(n, (i) => i > i1 && s.Tc[i] > 0 && !(s.psiC[i] > s.psiC[i - 1]));
  for (const [a, b] of folds) {
    let suggestion = 'Spread the force change in this range over a longer draw (move the points apart)';
    if (s.x[b] > targetMetrics.xPeak && s.F[b] < s.F[a - 1]) {
      suggestion = 'Spread the force drop in this range over a longer draw (move the points apart), or reduce the let-off';
    } else if (a === i1 + 1 && s.x[b] < targetMetrics.xPeak) {
      suggestion = evenRise;
    }
    diags.push(
      diagnostic(
        'cable-fold',
        `The cable contact would move backwards on the cam ${fmt.drawRange([s.x[a], s.x[b]])}: the force changes faster than any convex cable track can follow`,
        suggestion,
        { xRange: [s.x[a], s.x[b]], psiRange: [s.psiC[b], s.psiC[a - 1]] },
      ),
    );
  }
  const rotation = limbRotationDiagnostic(s.alpha[n - 1], s.x[n - 1], targetMetrics.energy, state, ctx, limbData, fmt);
  if (rotation) diags.push(rotation);
}

/**
 * Two angles in degrees with 1 to 4 decimals, the fewest that tell them
 * apart.
 * @param {number} a (rad)
 * @param {number} b (rad)
 * @returns {[string, string]}
 */
function distinctAngles(a, b) {
  const deg = (/** @type {number} */ v, /** @type {number} */ d) => `${(v / DEG).toFixed(d)}°`;
  let digits = 1;
  while (digits < 4 && deg(a, digits) === deg(b, digits)) digits++;
  return [deg(a, digits), deg(b, digits)];
}

/**
 * Diagnostic of a limb rotation from brace to full draw above the maximum
 * limb rotation, or null.
 * @param {number} alphaFull limb rotation at full draw α_f (rad)
 * @param {number} xFull full-draw nock position (m)
 * @param {number} energy draw energy the limbs store (J)
 * @param {ProjectState} state
 * @param {import('./inverse.js').InverseContext} ctx
 * @param {import('./limb.js').LimbData} limbData
 * @param {ReturnType<typeof formatter>} fmt
 * @returns {SolveDiagnostic | null}
 */
function limbRotationDiagnostic(alphaFull, xFull, energy, state, ctx, limbData, fmt) {
  const maxRotation = state.limb.maxRotation;
  if (!(alphaFull > maxRotation)) return null;
  const R = state.geometry.limbLength;
  const a0 = ctx.limb.alpha0;
  let suggestion;
  if (state.limb.mode === 'stiffness' && limbData.kind === 'linear') {
    // W/2 = ½·k_t·((α_max + α_0)² − α_0²).
    const kt = energy / ((maxRotation + a0) ** 2 - a0 ** 2);
    suggestion = `Increase the limb stiffness to at least ${fmt.stiffness((1.02 * kt) / (R * R))}, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
  } else if (state.limb.mode === 'travel') {
    suggestion = `Reduce the limb travel to at most ${fmt.size(0.98 * maxRotation * R)}, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
  } else {
    suggestion = `Use a stiffer limb table, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
  }
  const [turn, limit] = distinctAngles(alphaFull, maxRotation);
  return diagnostic(
    'limb-rotation',
    `The limbs turn ${turn} from brace to full draw; the maximum limb rotation is ${limit}`,
    suggestion,
    { xRange: [xFull, xFull] },
  );
}

/** Suggestion of a cable track problem between brace and point 3. */
const EVEN_RISE = 'Move point 2 so that the force rises more evenly from brace to point 3';

/**
 * Suggestion of a fitted cam that misses the target between points 2 and
 * 3, where the force rises steeply towards the peak: a later point 3
 * spreads the rise. A custom curve moves the point, a parametric curve
 * the rise to peak, which places point 3 at the peak start.
 */
const LATER_PEAK = {
  custom: 'Move point 3 later, so that the force rises more evenly from point 2 to point 3',
  parametric: 'Increase the rise to peak, so that point 3 (the peak start) comes later and the force rises more evenly from point 2 to point 3',
};

/**
 * Radius of curvature and lever arm of the ideal cable track on a 0.1°
 * grid (at least 200 intervals): at most one diagnostic per code, naming the
 * worst range. Returns the diagnostics without adding them (the result of
 * the fit is appended later) and the summary of the track: smallest ρ and
 * p, largest p and the shortfall ∫ max(0, ρ_lim − ρ) dψ as a sum over the
 * grid points.
 *
 * The brace blend on [ψ_c0, ψ_1] often bends the wrong way (ρ down to
 * −503 mm on the default preset), and the fit replaces it; its runs of ρ
 * below the limit are named only when no other run exists. They still count
 * as violations, so the fit runs.
 * @param {import('./outline.js').Piecewise} track
 * @param {{ psi: Float64Array, x: Float64Array } | null} psiToX
 * @param {number} blendEnd ψ_1, end of the brace blend (rad)
 * @param {number} rhoLimit (m)
 * @param {number} pMin (m)
 * @param {ProjectState} state
 * @param {import('./inverse.js').InverseSamples} samples
 * @param {ReturnType<typeof formatter>} fmt
 * @returns {{ violations: SolveDiagnostic[], summary: NonNullable<SolveResult['idealTrack']> }}
 */
function checkCableTrack(track, psiToX, blendEnd, rhoLimit, pMin, state, samples, fmt) {
  const count = Math.max(200, Math.ceil((track.end - track.start) / (0.1 * DEG)));
  const h = (track.end - track.start) / count;
  const psi = new Float64Array(count + 1);
  const rho = new Float64Array(count + 1);
  const p = new Float64Array(count + 1);
  const buf = new Float64Array(3);
  let minRho = Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  let rhoShortfall = 0;
  for (let k = 0; k <= count; k++) {
    psi[k] = track.start + ((track.end - track.start) * k) / count;
    track.evaluate(psi[k], buf);
    p[k] = buf[0];
    rho[k] = buf[0] + buf[2];
    minRho = Math.min(minRho, rho[k]);
    minP = Math.min(minP, p[k]);
    maxP = Math.max(maxP, p[k]);
    rhoShortfall += Math.max(0, rhoLimit - rho[k]) * h;
  }
  const summary = { minRho, minP, maxP, rhoShortfall, start: track.start, end: track.end };
  /** @param {number} v */
  const xAt = (v) => (psiToX ? interpolate(psiToX.psi, psiToX.x, v) : NaN);
  /**
   * Runs of flagged grid points, the overall range, the run with the
   * smallest value and the angle over which that run is below 0. Runs that
   * end at or before `from` count only when no other run exists.
   * @param {Float64Array} values
   * @param {number} limit
   * @param {number} from (rad)
   */
  const worstRun = (values, limit, from) => {
    const flagged = runs(count + 1, (k) => !(values[k] >= limit));
    if (flagged.length === 0) return null;
    const later = flagged.filter((r) => psi[r[1]] > from);
    const all = later.length > 0 ? later : flagged;
    let low = Infinity;
    let at = 0;
    let worst = all[0];
    for (const r of all) {
      for (let k = r[0]; k <= r[1]; k++) {
        if (values[k] < low) {
          low = values[k];
          at = k;
          worst = r;
        }
      }
    }
    let negative = 0;
    for (let k = worst[0]; k <= worst[1]; k++) if (values[k] < 0) negative++;
    return {
      count: all.length,
      low,
      at,
      negativeAngle: negative * h,
      xRange: /** @type {[number, number]} */ ([xAt(psi[all[0][0]]), xAt(psi[all[all.length - 1][1]])]),
      psiRange: /** @type {[number, number]} */ ([psi[all[0][0]], psi[all[all.length - 1][1]]]),
      worst: /** @type {[number, number]} */ ([xAt(psi[worst[0]]), xAt(psi[worst[1]])]),
      inBlend: !(psi[worst[1]] > from),
    };
  };
  /** @type {SolveDiagnostic[]} */
  const out = [];
  const { body, cords } = state;
  const bend = worstRun(rho, rhoLimit, blendEnd);
  if (bend) {
    // A negative ρ has no size to fix; the angle over which the track bends
    // the wrong way says how far it is from convex.
    const worst = bend.low < 0
      ? `bends the wrong way over ${fmt.angle(bend.negativeAngle)} ${fmt.drawRange(bend.worst)}`
      : `reaches a radius of curvature of ${fmt.size(bend.low)} ${fmt.drawRange(bend.worst)}`;
    const lead = bend.count > 1
      ? `The ideal cable track falls below the radius limit in ${bend.count} ranges of the draw; at worst it ${worst}`
      : `The ideal cable track ${worst}`;
    out.push(
      diagnostic(
        'cable-radius',
        `${lead}; the radius limit is ${fmt.size(rhoLimit)}, the larger of the minimum bend radius and the ` +
          `${fmt.size(cords.cableDiameter / 2)} cable radius plus ${fmt.size(GROOVE_MARGIN)}`,
        bend.inBlend
          ? EVEN_RISE
          : `Make the force curve change more gradually ${fmt.drawRange(bend.worst)}: move the points there apart or reduce the force change between them`,
        { xRange: bend.xRange, psiRange: bend.psiRange },
      ),
    );
  }
  const near = worstRun(p, pMin, -Infinity);
  if (near) {
    // The lever arm grows about in proportion to the string tension, so to
    // the force at a fixed draw position. A hub (bore radius plus wall) of
    // at most the lowest lever arm minus the cable radius clears it; both
    // keep a 3 % margin.
    const xLow = xAt(psi[near.at]);
    const F = Number.isFinite(xLow) ? interpolate(samples.x, samples.F, xLow) : NaN;
    const need = (1.03 * pMin) / near.low;
    let peak = 0;
    for (const v of samples.F) if (v > peak) peak = v;
    const atFull = Number.isFinite(xLow) && xLow >= samples.x[samples.n - 1] - 0.02;
    const options = [];
    if (atFull) {
      const letOff = near.low > 0 && Number.isFinite(F) ? 1 - (F * need) / peak : NaN;
      options.push(letOff > 0 ? `Reduce let-off below ${fmt.percent(Math.floor(letOff * 100) / 100)}` : 'Reduce let-off');
    } else {
      options.push(near.low > 0 && Number.isFinite(F)
        ? `Raise the force ${fmt.drawRange([xLow, xLow])} to at least ${fmt.force(F * need)}`
        : `Raise the force ${fmt.drawRange(near.worst)}`);
    }
    const hub = near.low / 1.03 - cords.cableDiameter / 2;
    const smallestHub = FIELDS['body.boreDiameter'].min / 2 + FIELDS['body.minWall'].min;
    if (hub >= smallestHub) {
      options.push(`reduce the axle bore radius plus the minimum wall to at most ${fmt.sizeAtMost(hub)} (now ${fmt.size(body.boreDiameter / 2 + body.minWall)})`);
    }
    const text = options.join(', or ');
    out.push(
      diagnostic(
        'cable-clearance',
        `The ideal cable track needs a lever arm of ${fmt.size(near.low)} ${fmt.drawRange(near.worst)}; the axle bore, the wall and the cable radius need at least ${fmt.size(pMin)}`,
        text.charAt(0).toUpperCase() + text.slice(1),
        { xRange: near.xRange, psiRange: near.psiRange },
      ),
    );
  }
  return { violations: out, summary };
}

/**
 * Where the achieved force of a fitted cam differs most from the target:
 * the draw position, the side of the target and the curve points on either
 * side, and the suggestion for a cable track that bends too sharply there.
 * Before point 2 the force rise from brace sets the track, between points
 * 2 and 3 the rise towards the peak; after the peak the drop towards the
 * holding weight, and with it the let-off, does.
 * @param {ReadonlyArray<{ x: number, F: number }>} points
 * @param {number} x draw position of the largest difference (m)
 * @param {number} difference achieved minus target force there (N)
 * @param {number} xPeak peak position of the target (m)
 * @param {boolean} parametric the curve follows the parametric generator
 * @param {ReturnType<typeof formatter>} fmt
 * @returns {{ text: string, suggestion: string }}
 */
function largestDifference(points, x, difference, xPeak, parametric, fmt) {
  const last = points.length - 1;
  let k = 0;
  while (k < last - 1 && points[k + 1].x <= x) k++;
  const on = points.findIndex((q) => Math.abs(q.x - x) <= 1e-9);
  const where = on >= 0 ? `at point ${on + 1} (${fmt.draw(x)})` : `at ${fmt.draw(x)}, between points ${k + 1} and ${k + 2}`;
  const text = `; the largest difference, ${difference > 0 ? 'above' : 'below'} the target, lies ${where}`;
  // The nearest interval at or before x, after the peak, where the force
  // falls: the drop towards the holding weight.
  let drop = -1;
  for (let j = k; j >= 0 && points[j + 1].x > xPeak; j--) {
    if (points[j + 1].F < points[j].F) {
      drop = j;
      break;
    }
  }
  let suggestion;
  if (x < points[Math.min(1, last)].x) {
    suggestion = EVEN_RISE;
  } else if (x < points[Math.min(2, last)].x && x < xPeak && last > 2 && points[2].F > points[1].F) {
    // A miss on the rise to the peak, with a point 3 that can move (not the
    // full-draw point): a later point 3 spreads the rise.
    suggestion = parametric ? LATER_PEAK.parametric : LATER_PEAK.custom;
  } else if (drop >= 0) {
    suggestion = `Make the force drop between points ${drop + 1} and ${drop + 2} more gradual: move them apart, or reduce the let-off`;
  } else {
    suggestion = `Make the force change between points ${k + 1} and ${k + 2} more gradual: move them apart or reduce the force change between them`;
  }
  return { text, suggestion };
}

/**
 * Linear interpolation of y(x) on increasing x.
 * @param {Float64Array} x
 * @param {Float64Array} y
 * @param {number} v
 */
function interpolate(x, y, v) {
  let j = 0;
  while (j < x.length - 2 && x[j + 1] < v) j++;
  const t = (v - x[j]) / (x[j + 1] - x[j]);
  return y[j] + Math.min(1, Math.max(0, t)) * (y[j + 1] - y[j]);
}

/**
 * Samples for the constrained fit: the ideal track on a 0.5° grid when it
 * exists, else the finite inverse samples from the first curve point on.
 * @param {import('./outline.js').Piecewise | null} ideal
 * @param {import('./inverse.js').InverseSamples} samples
 * @param {number} i1
 */
function fitData(ideal, samples, i1) {
  if (ideal) {
    const count = Math.max(20, Math.ceil((ideal.end - ideal.start) / (0.5 * DEG)));
    const psi = new Float64Array(count + 1);
    const p = new Float64Array(count + 1);
    const buf = new Float64Array(3);
    for (let k = 0; k <= count; k++) {
      psi[k] = ideal.start + ((ideal.end - ideal.start) * k) / count;
      p[k] = ideal.evaluate(psi[k], buf)[0];
    }
    return { psi, p };
  }
  const psi = [samples.psiC[0]];
  const p = [samples.pC[0]];
  for (let i = i1; i < samples.n; i++) {
    if (Number.isFinite(samples.psiC[i]) && Number.isFinite(samples.pC[i]) && samples.Tc[i] > 0) {
      psi.push(samples.psiC[i]);
      p.push(samples.pC[i]);
    }
  }
  return { psi: Float64Array.from(psi), p: Float64Array.from(p) };
}

/**
 * Lead-in wraps the closing-blend diagnostic tries: the whole multiples k·5°
 * below the given wrap, largest first, down to exactly 0.
 * @param {number} wrap lead-in wrap (rad)
 * @returns {number[]} (rad)
 */
export function leadInTrials(wrap) {
  const out = [];
  for (let k = Math.ceil(wrap / (5 * DEG) - 1e-9) - 1; k >= 0; k--) out.push(k * 5 * DEG);
  return out;
}

/**
 * Increases of the string track radius, or of both semi-axes of an
 * elliptical string track, that the closing-blend diagnostic tries, smallest
 * first (m).
 */
export const STRING_TRACK_TRIALS = Object.freeze([5e-3, 10e-3, 15e-3, 20e-3]);

/**
 * The project state with the string track radius, or both semi-axes of an
 * elliptical string track, larger by dr (a new state that shares the
 * unchanged sections); null when that exceeds the field range.
 * @param {ProjectState} state
 * @param {number} dr (m)
 * @returns {ProjectState | null}
 */
export function largerStringTrack(state, dr) {
  const t = state.stringTrack;
  const track = t.shape === 'ellipse'
    ? { ...t, semiMajor: t.semiMajor + dr, semiMinor: t.semiMinor + dr }
    : { ...t, radius: t.radius + dr };
  const fits = t.shape === 'ellipse'
    ? track.semiMajor <= FIELDS['stringTrack.semiMajor'].max
    : track.radius <= FIELDS['stringTrack.radius'].max;
  return fits ? { ...state, stringTrack: track } : null;
}

/**
 * Diagnostic of a closing blend that bends too sharply or comes too close
 * to the axle, or of an arc too short for any closing curve: closeCableTrack
 * returns null when the closed track leaves the input domain of support.js.
 * The suggestion names the largest lead-in wrap (in 5° steps, down to 0°)
 * that closes the track: the lead-in does not change the active track, so
 * closing it is the whole check. Otherwise solveState replaces the
 * suggestion by changeSuggestion once the other checks have run.
 * @param {import('./outline.js').ClosedCable | null} closed null for an
 *   arc that no closing curve fits
 * @param {import('./outline.js').Piecewise} active
 * @param {ProjectState} state
 * @param {number} rhoLimit (m)
 * @param {number} pMin smallest lever arm (m)
 * @param {number} step (rad)
 * @param {ReturnType<typeof formatter>} fmt
 * @param {boolean} tryLeadIn false inside a trial solve, which needs the
 *   code only
 * @returns {{ diagnostic: SolveDiagnostic, tooSharp: boolean, closedByLeadIn: boolean }}
 */
function closingDiagnostic(closed, active, state, rhoLimit, pMin, step, fmt, tryLeadIn) {
  const blendLength = active.start - state.body.leadInWrap + 2 * Math.PI - active.end;
  // The returned closed track decides, which re-interpolates the blend:
  // its exact minima of ρ and p, not those of the blend piece alone.
  const tooSharp = closed !== null && !(closed.minRho >= rhoLimit - CLOSED_TOLERANCE);
  const message = !closed
    ? `The lead-in wrap of ${fmt.angle(state.body.leadInWrap)} and the active cable track leave ${fmt.angle(blendLength)} of the turn to close the cable track; ` +
      'no closing curve fits into so short an arc'
    : tooSharp
      ? `The cable track cannot be closed over the remaining ${fmt.angle(blendLength)} with a radius of curvature of at least ${fmt.size(rhoLimit)}: ` +
        (closed.minRho > 0
          ? `the closed track reaches ${fmt.size(closed.minRho)}`
          : `the closed track bends the wrong way, to a radius of curvature of ${fmt.size(closed.minRho)}`)
      : `The closed cable track, closed over the remaining ${fmt.angle(blendLength)}, comes to a lever arm of ${fmt.size(closed.minP)}; ` +
        `the axle bore, the wall and the cable radius need at least ${fmt.size(pMin)}`;
  /** @param {string} suggestion @param {boolean} closedByLeadIn */
  const result = (suggestion, closedByLeadIn) => ({
    diagnostic: diagnostic('closing-blend', message, suggestion, { psiRange: [active.end, active.end + blendLength] }),
    tooSharp,
    closedByLeadIn,
  });
  for (const lead of tryLeadIn ? leadInTrials(state.body.leadInWrap) : []) {
    const trial = closeCableTrack(active, { leadIn: lead, rhoMin: rhoLimit, pMin, step });
    if (trial?.ok) return result(`Reduce the lead-in wrap to ${lead > 0 ? 'at most ' : ''}${fmt.angle(lead)}`, true);
  }
  return result('Change the force curve', false);
}

/**
 * Suggestion for a closing blend that no lead-in wrap closes: the first
 * change for which a trial solve returns no diagnostic at all. It tries the
 * string track increases STRING_TRACK_TRIALS, smallest first, then half the
 * minimum bend radius when that radius sets the limit of a blend that bends
 * too sharply. A larger string track turns the cam less over the draw and
 * leaves a longer arc for the blend, but it also changes the ideal cable
 * track and with it the force curve of the fitted cam, so only a trial
 * shows whether it helps. When no change passes, the suggestion lists what
 * was tried and names the force curve.
 * @param {ProjectState} state
 * @param {boolean} tooSharp the blend bends below the radius limit
 * @param {ReturnType<typeof formatter>} fmt
 * @param {(s: ProjectState) => boolean} passes true when a trial solve of
 *   the state returns no diagnostic
 * @returns {string}
 */
export function changeSuggestion(state, tooSharp, fmt, passes) {
  const { body, cords } = state;
  const ellipse = state.stringTrack.shape === 'ellipse';
  const tried = body.leadInWrap > 0 ? ['a lead-in wrap down to 0°'] : [];
  let largest = 0;
  for (const dr of STRING_TRACK_TRIALS) {
    const larger = largerStringTrack(state, dr);
    if (!larger) break;
    largest = dr;
    if (passes(larger)) {
      const t = larger.stringTrack;
      return (ellipse
        ? `Increase both semi-axes of the string track by ${fmt.size(dr)}, to ${fmt.size(t.semiMajor)} and ${fmt.size(t.semiMinor)}`
        : `Increase the string track radius to ${fmt.size(t.radius)}`) + '; the cam then closes the track and passes every check';
    }
  }
  if (largest > 0) tried.push(`${ellipse ? 'string track semi-axes' : 'a string track radius'} up to ${fmt.size(largest)} larger`);
  const groove = cords.cableDiameter / 2 + GROOVE_MARGIN;
  if (tooSharp && body.minBendRadius > groove) {
    const bend = Math.max(body.minBendRadius / 2, groove, FIELDS['body.minBendRadius'].min);
    if (passes({ ...state, body: { ...body, minBendRadius: bend } })) {
      return `Reduce the minimum bend radius to ${fmt.size(bend)}; the cam then closes the track and passes every check`;
    }
    tried.push(`a minimum bend radius of ${fmt.size(bend)}`);
  }
  if (tried.length === 0) return 'Change the force curve';
  const list = tried.length > 1 ? `${tried.slice(0, -1).join(', ')} and ${tried[tried.length - 1]}` : tried[0];
  return `Change the force curve: ${list} ${tried.length > 1 ? 'do' : 'does'} not give a closed track that passes every check`;
}

/**
 * Radius of curvature, clearance and wrap of the string track. Returns the
 * smallest radius of curvature over one turn (m).
 * @param {Support} s string pitch line
 * @param {ProjectState} state
 * @param {number} psiFull string contact angle at full draw (rad)
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 * @returns {number}
 */
function checkStringTrack(s, state, psiFull, fmt, diags) {
  const { body, cords, stringTrack: track } = state;
  const d = cords.stringDiameter;
  const rhoLimit = rhoLimitFor(body, d);
  const low = minimumOn((psi) => s.rho(psi), 0, 2 * Math.PI, 720);
  if (!(low.value >= rhoLimit)) {
    const need = rhoLimit - low.value;
    diags.push(
      diagnostic(
        'string-radius',
        `The string track has a radius of curvature of ${fmt.size(low.value)} at ${fmt.angle(low.at)}; the limit is ${fmt.size(rhoLimit)}`,
        track.shape === 'ellipse'
          ? `Increase the semi-minor axis or reduce the semi-major axis, so b²/a grows by at least ${fmt.size(need)}`
          : `Increase the string track radius by at least ${fmt.size(need)}`,
        { psiRange: [low.at, low.at] },
      ),
    );
  }
  const wall = body.boreDiameter / 2 + body.minWall;
  const groove = (/** @type {number} */ psi) => Math.hypot(s.p(psi) - d / 2, s.dp(psi));
  const near = minimumOn(groove, 0, 2 * Math.PI, 720);
  if (!(near.value >= wall)) {
    diags.push(
      diagnostic(
        'string-clearance',
        `The string groove comes within ${fmt.size(near.value)} of the axle at ${fmt.angle(near.at)}; the bore and the wall need ${fmt.size(wall)}`,
        `Increase the string track radius or reduce its offset by at least ${fmt.size(wall - near.value)}`,
        { psiRange: [near.at, near.at] },
      ),
    );
  }
  checkStringWrap(s, state, psiFull, fmt, diags);
  return low.value;
}

/**
 * String wrap at brace: the full-draw contact angle plus the residual wrap
 * must stay below one turn.
 * @param {Support} s string pitch line
 * @param {ProjectState} state
 * @param {number} psiFull string contact angle at full draw (rad)
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 */
function checkStringWrap(s, state, psiFull, fmt, diags) {
  const { body } = state;
  const wrap = psiFull + body.residualWrap;
  if (wrap >= 2 * Math.PI) {
    const excess = wrap - 2 * Math.PI + 5 * DEG;
    const mean = (s.P(psiFull) - s.P(0)) / psiFull;
    const radius = mean * (psiFull / (psiFull - excess) - 1);
    const options = [];
    if (psiFull > excess) options.push(`Increase the string track radius by at least ${fmt.size(radius)}`);
    if (body.residualWrap > excess) options.push(`reduce the residual wrap to at most ${fmt.angle(body.residualWrap - excess)}`);
    const text = options.length > 0 ? options.join(', or ') : 'Increase the string track radius';
    diags.push(
      diagnostic(
        'string-wrap',
        `The string wraps ${distinctAngles(wrap, 2 * Math.PI)[0]} on its track at brace, including the ${fmt.angle(body.residualWrap)} residual wrap; a groove holds less than one turn`,
        text.charAt(0).toUpperCase() + text.slice(1),
        { psiRange: [0, wrap] },
      ),
    );
  }
}

/**
 * Clearance of the cable groove from the bore on the lead-in (the
 * active range is checked on the ideal track, the closing blend by its
 * construction).
 * @param {Support} cable closed cable pitch line
 * @param {import('./outline.js').ClosedCable} closed
 * @param {ProjectState} state
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 */
function checkCableClearance(cable, closed, state, fmt, diags) {
  const { body, cords } = state;
  if (!(closed.psiBrace > closed.psiStart)) return;
  const d = cords.cableDiameter;
  const wall = body.boreDiameter / 2 + body.minWall;
  const groove = (/** @type {number} */ psi) => Math.hypot(cable.p(psi) - d / 2, cable.dp(psi));
  const near = minimumOn(groove, closed.psiStart, closed.psiBrace, 90);
  if (!(near.value >= wall - 1e-6)) {
    diags.push(
      diagnostic(
        'cable-clearance',
        `The lead-in part of the cable groove comes within ${fmt.size(near.value)} of the axle; the bore and the wall need ${fmt.size(wall)}`,
        `Reduce the lead-in wrap to at most ${fmt.angle(Math.max(0, closed.psiBrace - near.at - 5 * DEG))}`,
        { psiRange: [near.at, near.at] },
      ),
    );
  }
}

/**
 * Diagnostics of the forward model of the final cam that the checks of the
 * target and of the tracks do not cover, as solver diagnostics. Codes that
 * are already present are not repeated.
 * @param {import('./forward.js').ForwardResult} forward
 * @param {SolveDiagnostic[]} diags receives the new diagnostics
 * @param {ReturnType<typeof formatter>} fmt
 */
export function forwardDiagnostics(forward, diags, fmt) {
  const have = new Set(diags.map((d) => d.code));
  /** @param {SolveDiagnostic} d */
  const add = (d) => {
    if (have.has(d.code) && d.code !== 'no-convergence') return;
    have.add(d.code);
    diags.push(d);
  };
  for (const d of forward.diagnostics) {
    const where = { xRange: d.xRange };
    const range = d.xRange ? ` ${fmt.drawRange(d.xRange)}` : '';
    switch (d.code) {
      case 'no-convergence':
      case 'brace':
      case 'invalid-input':
        add(diagnostic('no-convergence', `The force curve of the final cam cannot be computed${range}: ${d.message}`, 'Change the last edited input slightly, then solve again', where));
        break;
      case 'slack-string':
        add(diagnostic('slack-string', `The string of the final cam goes slack${range}`, 'Raise the force curve in this range, or reduce the let-off', where));
        break;
      case 'slack-cable':
      case 'cam-reversal':
        add(diagnostic('slack-cable', `The power cable of the final cam goes slack${range}`, 'Increase the limb preload travel, or move the peak later in the draw', where));
        break;
      case 'wrap-exhausted':
        add(diagnostic('wrap-exhausted', `A cord of the final cam runs off the end of its wrapped track${range}`, 'Increase the residual wrap or the lead-in wrap', where));
        break;
      case 'wrap-overlap': {
        // The cord that wraps a full turn on the samples of the range; a
        // solve that stops early leaves NaN in the later samples.
        let string = false;
        let cable = false;
        for (let i = 0; i < forward.n; i++) {
          if (d.xRange && !(forward.x[i] >= d.xRange[0] && forward.x[i] <= d.xRange[1])) continue;
          if (forward.stringTermination - forward.psiS[i] >= 2 * Math.PI) string = true;
          if (forward.psiC[i] - forward.cableTermination >= 2 * Math.PI) cable = true;
        }
        const code = cable && !string ? 'cable-wrap' : 'string-wrap';
        add(diagnostic(code, `The ${code === 'string-wrap' ? 'string' : 'power cable'} of the final cam wraps a full turn or more${range}`, 'Increase the string track radius', where));
        break;
      }
      case 'cable-lever':
        add(diagnostic('cable-lever', `Limb rotation takes up no power cable${range}`, 'Reduce the limb lever angle at brace', where));
        break;
      // non-finite, concave-track and any code without its own entry: the
      // final cam has no usable force curve.
      default:
        add(diagnostic('no-convergence', `The force curve of the final cam cannot be computed${range}: ${d.message}`, 'Change the last edited input slightly, then solve again', where));
        break;
    }
  }
}

/**
 * Outlines of the string track alone, for results without a cable track.
 * @param {SolveResult} res
 * @param {Support} stringSupport
 * @param {ProjectState} state
 * @param {{ outline: number }} settings
 */
function finishStringOnly(res, stringSupport, state, settings) {
  const { cords } = state;
  const offsets = trackOffsets(toSupportData(stringSupport), cords.stringDiameter, cords.stringGrooveDepth);
  res.outlines = {
    stringPitch: sampleOutline(stringSupport, 0, settings.outline),
    stringGroove: sampleOutline(createSupport(offsets.groove), 0, settings.outline),
    stringFlange: sampleOutline(createSupport(offsets.flange), 0, settings.outline),
  };
  res.marks = [trackMark(stringSupport, 0, 'string-brace')];
}

export { CODES };
