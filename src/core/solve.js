/**
 * Top-level solve: project state → cable track, closed cam outline, achieved
 * force curve, metrics and diagnostics. Pure and synchronous; the result
 * holds plain objects and Float64Arrays only, so it survives structured
 * cloning to and from a worker. Never throws.
 *
 * Steps:
 * 1. Validate the state; build the string pitch line, the bow geometry and
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
 * 6. Closed outline, offsets, posts and marks (core/outline).
 * 7. Forward model of the final cam: achieved curve, loads and metrics.
 * @module core/solve
 */

import { curveMetrics } from './curve.js';
import { CODES, diagnostic, formatter, runs } from './diagnostics.js';
import { fitCableTrack } from './fit.js';
import { COARSE_SAMPLES, FULL_SAMPLES, drawGrid, solveForward } from './forward.js';
import { createCurve } from './interp.js';
import {
  braceBlend, braceConditions, cableSpline, createInverse, resampleCable, sampleInverse,
} from './inverse.js';
import { limbFromState } from './limb.js';
import {
  cableStopPost, closeCableTrack, createPiecewise, maxDimension, minimumOn, sampleOutline, terminationPost,
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
 * Largest force difference between the achieved curve of a fitted cable
 * track and the target that still counts as meeting the target: this
 * fraction of the peak, at least FIT_FORCE_FLOOR. The draw energy must agree
 * within FIT_ENERGY_TOLERANCE.
 */
export const FIT_FORCE_TOLERANCE = 0.015;
/** Smallest force tolerance of a fitted cam (N). */
export const FIT_FORCE_FLOOR = 2;
/** Relative draw energy tolerance of a fitted cam. */
export const FIT_ENERGY_TOLERANCE = 0.005;

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
 * @property {number} minRho smallest radius of curvature of both pitch lines (m)
 * @property {number} rhoLimit smallest allowed radius of curvature (m)
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
 * @property {object | null} brace brace conditions and the brace blend
 * @property {{ stringPitch: SupportData | null, cablePitch: SupportData | null,
 *   grooves: { string: SupportData | null, cable: SupportData | null },
 *   flanges: { string: SupportData | null, cable: SupportData | null },
 *   cable: { psiStart: number, psiBrace: number, psiFull: number, blendLength: number, leadInRho: number,
 *     blendMinRho: number } | null,
 *   string: { psiFull: number, psiEnd: number } | null }} tracks pitch lines
 *   as support data; cable: termination ψ_c0 − lead-in, brace and full-draw
 *   contact angles, arc of the closing blend (rad), ρ of the lead-in arc and
 *   smallest ρ of the closing blend (m); string: full-draw contact angle and
 *   termination (rad)
 * @property {Record<string, Outline>} outlines sampled closed outlines
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
 * @property {{ total: number, inverse: number, fit: number, outline: number, forward: number }} timings (ms)
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
    timings: { total: 0, inverse: 0, fit: 0, outline: 0, forward: 0 },
  };
}

/**
 * Solve a project state. Never throws: invalid input, infeasible targets and
 * numerical failures come back as diagnostics.
 * @param {ProjectState} state
 * @param {{ resolution?: 'coarse' | 'full', maxIterations?: number }} [options] resolution
 *   (default 'full') and the Newton iteration limit of the string closure
 *   and of the forward model (default 30)
 * @returns {SolveResult}
 */
export function solve(state, options = {}) {
  const resolution = options.resolution === 'coarse' ? 'coarse' : 'full';
  const t0 = now();
  let result;
  try {
    result = solveState(state, resolution, options.maxIterations);
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
 * @returns {SolveResult}
 */
function solveState(state, resolution, maxIterations) {
  const res = emptyResult(resolution);
  const settings = RESOLUTIONS[resolution];
  const diags = res.diagnostics;
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
  const fmt = formatter(state.units);
  const { geometry, cords, body } = state;
  const points = state.curve.points;
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

  // Limb, inverse context and brace conditions; the travel mode depends on
  // the energy of the rebuilt target, so iterate twice.
  let energy = natural.integral(xBrace, xFull);
  let limbData = null;
  let ctx = null;
  let brace = null;
  let curve = natural;
  for (let pass = 0; pass < (state.limb.mode === 'travel' ? 3 : 1); pass++) {
    const limbResult = limbFromState(state.limb, geometry.limbLength, { drawEnergy: energy });
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
  }
  if (!ctx || !brace || !limbData) return res;
  const limb = ctx.limb;
  const targetMetrics = curveMetrics(curve);
  const forwardGrid = drawGrid(xBrace, xFull, settings.forward);
  res.target = { x: forwardGrid, F: Float64Array.from(forwardGrid, (x) => curve.evaluate(x)) };
  res.brace = { ...brace, shapePreserved: curve.shapePreserved, naturalSecond: natural.derivative(xBrace, 2) };
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
  const alphaFull = samples.alpha[n - 1];
  checkIdeal(samples, i1, state, ctx, limbData, targetMetrics, fmt, diags);

  // Ideal cable track: blend on [ψ_c0, ψ_1] and spline on [ψ_1, ψ_cf].
  const rhoLimitCable = Math.max(body.minBendRadius, cords.cableDiameter / 2 + GROOVE_MARGIN);
  const pMin = body.boreDiameter / 2 + body.minWall + cords.cableDiameter / 2;
  const monotone = !diags.some((d) => d.code === 'cable-fold' || d.code === 'slack-cable');
  /** @type {import('./outline.js').Piecewise | null} */
  let ideal = null;
  /** @type {{ psi: Float64Array, x: Float64Array } | null} */
  let psiToX = null;
  if (monotone) {
    const resampled = resampleCable(ctx, brace, target, samples, settings.step, i1);
    if (resampled) {
      const spline = cableSpline(resampled.psi, resampled.p);
      const s = createSupport(spline);
      const psi1 = resampled.psi[0];
      const p1 = resampled.p[0];
      const D0 = 2 * ctx.bow.braceAxleY;
      const D1 = 2 * samples.axleY[i1];
      const blend = braceBlend({
        psi0: samples.psiC[0],
        p0: samples.pC[0],
        psi1,
        p1,
        d1: s.dp(psi1),
        s1: s.d2p(psi1),
        integral: Math.sqrt(D0 * D0 - samples.pC[0] ** 2) - Math.sqrt(D1 * D1 - p1 * p1),
      });
      if (blend) {
        ideal = createPiecewise([
          { ...blend, end: psi1 },
          { kind: 'spline', start: psi1, end: resampled.psi[resampled.psi.length - 1], data: spline },
        ]);
        psiToX = {
          psi: Float64Array.from([samples.psiC[0], ...resampled.psi]),
          x: Float64Array.from([xBrace, ...resampled.x]),
        };
        res.brace = { ...res.brace, blendEnd: x1, blendStart: samples.psiC[0], blendAngle: psi1 };
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

  // Radius of curvature and clearance of the ideal cable track; the
  // constrained fit replaces a track that violates them.
  const tFit = now();
  const psiC0 = samples.psiC[0];
  const psiCF = samples.psiC[n - 1];
  const violations = ideal ? checkCableTrack(ideal, psiToX, rhoLimitCable, pMin, state, samples, x1, fmt) : [];
  if (ideal) res.idealTrack = trackSummary(ideal, rhoLimitCable);
  /** @type {{ active: import('./outline.js').Piecewise, pointsMatched: number, rms: number, maxDeviation: number }[]} */
  const candidates = [];
  if (ideal && violations.length === 0) {
    candidates.push({ active: ideal, pointsMatched: 0, rms: 0, maxDeviation: 0 });
  } else {
    const data = fitData(ideal, samples, i1);
    const end = Math.max(psiCF, psiC0 + 10 * DEG);
    const D0 = 2 * ctx.bow.braceAxleY;
    const startValue = samples.pC[0] >= pMin ? samples.pC[0] : undefined;
    const through = startValue === undefined ? [] : points.slice(1).flatMap((q) => {
      const i = grid.indexOf(q.x);
      const p = samples.pC[i];
      const D = 2 * samples.axleY[i];
      const ok = p >= pMin && samples.Tc[i] > 0 && samples.psiC[i] > psiC0 && samples.psiC[i] <= end;
      return ok ? [{ psi: samples.psiC[i], p, integral: Math.sqrt(D0 * D0 - samples.pC[0] ** 2) - Math.sqrt(D * D - p * p) }] : [];
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

  const stringEnd = psiSFull + body.residualWrap;
  res.tracks.string = { psiFull: psiSFull, psiEnd: stringEnd };
  checkStringTrack(stringSupport, state, psiSFull, fmt, diags);

  // Closed outline and forward model of each candidate; the candidate whose
  // achieved curve is closest to the target (largest force difference) wins,
  // a closable one before one whose closing blend fails.
  /** @type {{ candidate: (typeof candidates)[number], closed: import('./outline.js').ClosedCable, forward: import('./forward.js').ForwardResult, maxDiff: number } | null} */
  let best = null;
  for (const candidate of candidates) {
    const tOutline = now();
    const { active } = candidate;
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
      break;
    }
    const closed = closeCableTrack(active, { leadIn: body.leadInWrap, rhoMin: rhoLimitCable, pMin, step: settings.step });
    res.timings.outline += now() - tOutline;
    if (!closed) continue;
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
    for (let i = 0; i < forward.n; i++) {
      const d = Math.abs(forward.F[i] - res.target.F[i]);
      maxDiff = Number.isFinite(d) ? Math.max(maxDiff, d) : Infinity;
    }
    if (!best || (closed.ok && !best.closed.ok) || (closed.ok === best.closed.ok && maxDiff < best.maxDiff)) {
      best = { candidate, closed, forward, maxDiff };
    }
  }
  if (!best) {
    finishStringOnly(res, stringSupport, state, settings);
    return res;
  }
  const { closed, forward } = best;
  if (!closed.ok) diags.push(closingDiagnostic(closed, best.candidate.active, state, rhoLimitCable, pMin, settings.step, fmt));
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
  res.tracks.cable = {
    psiStart: closed.psiStart, psiBrace: closed.psiBrace, psiFull: closed.psiFull, blendLength: closed.blendLength,
    leadInRho: closed.leadInRho, blendMinRho: closed.blendMinRho,
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
  const psiSFAchieved = Number.isFinite(forward.psiS[forward.n - 1]) ? forward.psiS[forward.n - 1] : psiSFull;
  res.posts = [
    terminationPost(stringSupport, stringEnd, postRadius, cords.stringDiameter, 'string-post'),
    terminationPost(cableSupport, closed.psiStart, postRadius, cords.cableDiameter, 'cable-post'),
    cableStopPost(cableSupport, psiCFAchieved, postRadius, cords.cableDiameter),
  ];
  res.marks = [
    trackMark(stringSupport, 0, 'string-brace'),
    trackMark(cableSupport, closed.psiBrace, 'cable-brace'),
    trackMark(stringSupport, psiSFAchieved, 'full-draw'),
  ];
  res.timings.outline += now() - tOutline2;

  // Metrics.
  const rhoLimitString = Math.max(body.minBendRadius, cords.stringDiameter / 2 + GROOVE_MARGIN);
  const achievedMetrics = sampleMetrics(forward.x, forward.F);
  const minRhoString = minimumOn((psi) => stringSupport.rho(psi), 0, 2 * Math.PI, 720).value;
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
    minRho: Math.min(minRhoString, minRhoCable),
    rhoLimit: Math.min(rhoLimitString, rhoLimitCable),
    stringWrap: stringEnd - forward.psiS[0],
    cableWrap: forward.psiC[forward.n - 1] - closed.psiStart,
  };
  if (!Number.isFinite(alphaFull)) res.metrics.limbRotation = NaN;
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
    for (const d of violations) {
      d.message += `. The fitted cam meets the limits; its force curve differs from the target by up to ${fmt.forceFine(maxDiff)}, ` +
        `${verdict} (peak ${signed(fmt.forceFine(res.fit.peakDifference), res.fit.peakDifference)}, ` +
        `let-off ${signedPoints(res.fit.letOffDifference)}, draw energy ${signed(fmt.energy(res.fit.energyDifference), res.fit.energyDifference)})`;
    }
    // A fitted cam that follows the target within the tolerance meets it:
    // the ideal track's violations stay in the fit record only.
    if (res.fit.withinTolerance) {
      res.fit.idealIssues = violations.map((d) => d.message);
      violations.length = 0;
    }
  }
  diags.push(...violations);
  return res;
}

/**
 * Smallest ρ and p, largest p and the shortfall ∫ max(0, ρ_lim − ρ) dψ of
 * a cable track on a 0.1° grid.
 * @param {import('./outline.js').Piecewise} track
 * @param {number} rhoLimit (m)
 * @returns {{ minRho: number, minP: number, maxP: number, rhoShortfall: number, start: number, end: number }}
 */
function trackSummary(track, rhoLimit) {
  const count = Math.max(200, Math.ceil((track.end - track.start) / (0.1 * DEG)));
  const h = (track.end - track.start) / count;
  const buf = new Float64Array(3);
  let minRho = Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  let rhoShortfall = 0;
  for (let k = 0; k <= count; k++) {
    track.evaluate(track.start + k * h, buf);
    const rho = buf[0] + buf[2];
    minRho = Math.min(minRho, rho);
    minP = Math.min(minP, buf[0]);
    maxP = Math.max(maxP, buf[0]);
    rhoShortfall += Math.max(0, rhoLimit - rho) * h;
  }
  return { minRho, minP, maxP, rhoShortfall, start: track.start, end: track.end };
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
  // T_s0 ≥ M_b/s_a0: suggest a first point with 80 % of the limit slope, or
  // the preload travel whose brace moment makes T_s0 80 % of the limit.
  const factor = (0.8 * brace.maxStringTension) / Ts0;
  const preload = state.limb.preloadTravel;
  // In the stiffness mode the brace moment k·R_L·s_0 grows in proportion to
  // the preload travel s_0; suggest it only within the allowed range.
  const needed = preload / factor;
  const preloadText = state.limb.mode === 'stiffness' && limbData.kind === 'linear' && preload > 0 && needed <= FIELDS['limb.preloadTravel'].max
    ? `, or increase the limb preload travel to at least ${fmt.size(needed)}`
    : '';
  diags.push(
    diagnostic(
      'brace-tension',
      `The force curve rises too steeply at brace: its slope of ${fmt.slope(brace.slope)} needs a string tension of ${fmt.force(Ts0)} ` +
        `at brace, but the limb moment holds at most ${fmt.force(brace.maxStringTension)} (slope ${fmt.slope(brace.maxSlope)})`,
      `Reduce the force of point 2 to at most ${fmt.force(points[1].F * factor)}${preloadText}`,
      { xRange: [xb, points[1].x] },
    ),
  );
  return false;
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
  const folds = runs(n, (i) => i > i1 && s.Tc[i] > 0 && !(s.psiC[i] > s.psiC[i - 1]));
  for (const [a, b] of folds) {
    diags.push(
      diagnostic(
        'cable-fold',
        `The cable contact would move backwards on the cam ${fmt.drawRange([s.x[a], s.x[b]])}: the force changes faster than any convex cable track can follow`,
        'Spread the force change in this range over a longer draw (move the points apart), or reduce the let-off',
        { xRange: [s.x[a], s.x[b]], psiRange: [s.psiC[b], s.psiC[a - 1]] },
      ),
    );
  }
  const alphaFull = s.alpha[n - 1];
  const maxRotation = state.limb.maxRotation;
  if (alphaFull > maxRotation) {
    const R = state.geometry.limbLength;
    const a0 = ctx.limb.alpha0;
    let suggestion;
    if (state.limb.mode === 'stiffness' && limbData.kind === 'linear') {
      // W/2 = ½·k_t·((α_max + α_0)² − α_0²).
      const W = targetMetrics.energy;
      const kt = W / ((maxRotation + a0) ** 2 - a0 ** 2);
      suggestion = `Increase the limb stiffness to at least ${fmt.stiffness((1.02 * kt) / (R * R))}, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
    } else if (state.limb.mode === 'travel') {
      suggestion = `Reduce the limb travel to at most ${fmt.size(0.98 * maxRotation * R)}, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
    } else {
      suggestion = `Use a stiffer limb table, or raise the maximum limb rotation to ${fmt.angle(alphaFull + 0.5 * DEG)}`;
    }
    diags.push(
      diagnostic(
        'limb-rotation',
        `The limbs turn ${fmt.angle(alphaFull)} from brace to full draw; the maximum limb rotation is ${fmt.angle(maxRotation)}`,
        suggestion,
        { xRange: [s.x[n - 1], s.x[n - 1]] },
      ),
    );
  }
}

/**
 * Radius of curvature and lever arm of the ideal cable track: at most one
 * diagnostic per code, naming the worst range. Returns the diagnostics
 * without adding them (the result of the fit is appended later).
 * @param {import('./outline.js').Piecewise} track
 * @param {{ psi: Float64Array, x: Float64Array } | null} psiToX
 * @param {number} rhoLimit (m)
 * @param {number} pMin (m)
 * @param {ProjectState} state
 * @param {import('./inverse.js').InverseSamples} samples
 * @param {number} x1 nock position of point 2 (m)
 * @param {ReturnType<typeof formatter>} fmt
 * @returns {SolveDiagnostic[]}
 */
function checkCableTrack(track, psiToX, rhoLimit, pMin, state, samples, x1, fmt) {
  const count = Math.max(200, Math.ceil((track.end - track.start) / (0.1 * DEG)));
  const psi = new Float64Array(count + 1);
  const rho = new Float64Array(count + 1);
  const p = new Float64Array(count + 1);
  const buf = new Float64Array(3);
  for (let k = 0; k <= count; k++) {
    psi[k] = track.start + ((track.end - track.start) * k) / count;
    track.evaluate(psi[k], buf);
    p[k] = buf[0];
    rho[k] = buf[0] + buf[2];
  }
  /** @param {number} v */
  const xAt = (v) => (psiToX ? interpolate(psiToX.psi, psiToX.x, v) : NaN);
  /**
   * Runs of flagged grid points, the overall range and the run with the
   * smallest value.
   * @param {Float64Array} values
   * @param {number} limit
   */
  const worstRun = (values, limit) => {
    const all = runs(count + 1, (k) => !(values[k] >= limit));
    if (all.length === 0) return null;
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
    return {
      count: all.length,
      low,
      at,
      xRange: /** @type {[number, number]} */ ([xAt(psi[all[0][0]]), xAt(psi[all[all.length - 1][1]])]),
      psiRange: /** @type {[number, number]} */ ([psi[all[0][0]], psi[all[all.length - 1][1]]]),
      worst: /** @type {[number, number]} */ ([xAt(psi[worst[0]]), xAt(psi[worst[1]])]),
    };
  };
  /** @type {SolveDiagnostic[]} */
  const out = [];
  const { body, cords } = state;
  const bend = worstRun(rho, rhoLimit);
  if (bend) {
    const where = bend.count > 1 ? `in ${bend.count} ranges of the draw, lowest ${fmt.drawRange(bend.worst)}` : fmt.drawRange(bend.worst);
    const wrongWay = bend.low < 0 ? ' (it would bend the wrong way)' : '';
    const nearBrace = bend.worst[1] <= x1 + 1e-9;
    out.push(
      diagnostic(
        'cable-radius',
        `The ideal cable track reaches a radius of curvature of ${fmt.size(bend.low)}${wrongWay} ${where}; ` +
          `the limit is ${fmt.size(rhoLimit)}, the larger of the minimum bend radius and the ${fmt.size(cords.cableDiameter / 2)} cable radius plus ${fmt.size(GROOVE_MARGIN)}`,
        nearBrace
          ? 'Move point 2 so that the force rises more evenly from brace to point 3'
          : `Make the force curve change more gradually ${fmt.drawRange(bend.worst)}: move the points there apart or reduce the force change between them`,
        { xRange: bend.xRange, psiRange: bend.psiRange },
      ),
    );
  }
  const near = worstRun(p, pMin);
  if (near) {
    // The lever arm grows about in proportion to the string tension, so to
    // the force at a fixed draw position, and to the string lever arm there.
    const xLow = xAt(psi[near.at]);
    const F = Number.isFinite(xLow) ? interpolate(samples.x, samples.F, xLow) : NaN;
    const need = (1.03 * pMin) / near.low;
    const pS = Number.isFinite(xLow) ? interpolate(samples.x, samples.pS, xLow) : NaN;
    let peak = 0;
    for (const v of samples.F) if (v > peak) peak = v;
    const atFull = Number.isFinite(xLow) && xLow >= samples.x[samples.n - 1] - 0.02;
    const options = [];
    if (near.low > 0 && atFull && Number.isFinite(F)) {
      const letOff = 1 - (F * need) / peak;
      options.push(letOff > 0 ? `Reduce let-off below ${fmt.percent(Math.floor(letOff * 100) / 100)}` : 'Reduce let-off');
    } else if (near.low > 0 && Number.isFinite(F)) {
      options.push(`Raise the force ${fmt.drawRange([xLow, xLow])} to at least ${fmt.force(F * need)}`);
    }
    const radius = state.stringTrack.radius + pS * (need - 1);
    if (near.low > 0 && state.stringTrack.shape === 'eccentric' && radius <= FIELDS['stringTrack.radius'].max) {
      options.push(`increase the string track radius by at least ${fmt.size(pS * (need - 1))}`);
    }
    options.push(`reduce the axle bore or the minimum wall (together ${fmt.size(body.boreDiameter / 2 + body.minWall)})`);
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
  return out;
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
 * Diagnostic of a closing blend that bends too sharply or comes too close
 * to the axle, with the largest lead-in wrap (in 5° steps) that closes the
 * track.
 * @param {import('./outline.js').ClosedCable} closed
 * @param {import('./outline.js').Piecewise} active
 * @param {ProjectState} state
 * @param {number} rhoLimit (m)
 * @param {number} pMin smallest lever arm (m)
 * @param {number} step (rad)
 * @param {ReturnType<typeof formatter>} fmt
 */
function closingDiagnostic(closed, active, state, rhoLimit, pMin, step, fmt) {
  let suggestion = 'Reduce let-off, or make the force curve end with a longer valley';
  for (let lead = state.body.leadInWrap - 5 * DEG; lead >= 0; lead -= 5 * DEG) {
    const trial = closeCableTrack(active, { leadIn: lead, rhoMin: rhoLimit, pMin, step });
    if (trial?.ok) {
      suggestion = `Reduce the lead-in wrap to at most ${fmt.angle(lead)}`;
      break;
    }
  }
  const tooSharp = closed.blendMinRho < rhoLimit - 1e-5;
  const message = tooSharp
    ? `The cable track cannot be closed over the remaining ${fmt.angle(closed.blendLength)} with a radius of curvature of at least ${fmt.size(rhoLimit)}: ` +
      `the closing curve reaches ${fmt.size(closed.blendMinRho)}`
    : `The curve that closes the cable track over the remaining ${fmt.angle(closed.blendLength)} comes to a lever arm of ${fmt.size(closed.blendMinP)}; ` +
      `the axle bore, the wall and the cable radius need at least ${fmt.size(pMin)}`;
  return diagnostic('closing-blend', message, suggestion, { psiRange: [closed.psiFull, closed.psiFull + closed.blendLength] });
}

/**
 * Radius of curvature, clearance and wrap of the string track.
 * @param {Support} s string pitch line
 * @param {ProjectState} state
 * @param {number} psiFull string contact angle at full draw (rad)
 * @param {ReturnType<typeof formatter>} fmt
 * @param {SolveDiagnostic[]} diags
 */
function checkStringTrack(s, state, psiFull, fmt, diags) {
  const { body, cords, stringTrack: track } = state;
  const d = cords.stringDiameter;
  const rhoLimit = Math.max(body.minBendRadius, d / 2 + GROOVE_MARGIN);
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
        `The string wraps ${fmt.angle(wrap)} on its track at brace, including the ${fmt.angle(body.residualWrap)} residual wrap; a groove holds less than one turn`,
        text.charAt(0).toUpperCase() + text.slice(1),
        { psiRange: [0, wrap] },
      ),
    );
  }
}

/**
 * Clearance of the cable groove from the bore on the lead-in arc (the
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
        const last = Math.max(0, forward.n - 1);
        const string = forward.stringTermination - forward.psiS[0] >= 2 * Math.PI;
        const code = string || !(forward.psiC[last] - forward.cableTermination >= 2 * Math.PI) ? 'string-wrap' : 'cable-wrap';
        add(diagnostic(code, `The ${code === 'string-wrap' ? 'string' : 'power cable'} of the final cam wraps a full turn or more${range}`, 'Increase the string track radius', where));
        break;
      }
      case 'cable-lever':
        add(diagnostic('cable-lever', `Limb rotation takes up no power cable${range}`, 'Reduce the limb lever angle at brace', where));
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
