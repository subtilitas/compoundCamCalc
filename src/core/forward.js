/**
 * Forward model: string track, cable track and limb → draw force curve.
 *
 * Unknowns per nock position x: cam rotation θ and limb rotation α. At
 * brace θ = 0 and α = 0 by definition, and the string half-length L_s/2 and
 * the cable length L_c are measured there and held constant. Closure:
 *
 *   g_s(x, θ, α) = L_s/2,   g_c(θ, α) = L_c
 *
 * Newton on (θ, α) with the projection partials
 * J = [[−p_s, −s_a], [p_c, −c_a]], warm started from the previous sample
 * plus the tangent step. The path tangent solves J·[θ', α'] = [−sin φ, 0]:
 *
 *   det = p_s·c_a + s_a·p_c
 *   θ' = c_a·sin φ / det,   α' = p_c·sin φ / det
 *   F   = 2·E1'(α)·α'                     virtual work
 *   T_s = E1'(α)·p_c / det = F / (2·sin φ)
 *   T_c = E1'(α)·p_s / det = T_s·p_s / p_c
 *
 * The tension formulas hold at brace too (sin φ = 0), where they give the
 * brace equilibrium T_s0·p_s = T_c0·p_c, E1'(0) = T_s0·s_a + T_c0·c_a.
 * Lengths in m, angles in rad, forces in N.
 * @module core/forward
 */

import { CABLE_SIDE, STRING_SIDE, terminationConstant } from './contact.js';
import { bowGeometry, createPose, evaluatePose } from './geometry.js';
import { createLimb, limbEnergies } from './limb.js';
import { createSupport } from './support.js';

/** Samples of a full solve. */
export const FULL_SAMPLES = 1500;
/** Samples of a coarse solve while dragging. */
export const COARSE_SAMPLES = 100;
/** Largest accepted closure residual (m). */
export const CLOSURE_TOLERANCE = 1e-10;
/** Default Newton iteration limit per sample. */
export const MAX_ITERATIONS = 30;
/** Largest accepted Newton iteration limit per sample. */
export const MAX_ITERATION_LIMIT = 200;
/** Largest accepted number of samples. */
export const MAX_SAMPLES = 20000;
/** Default wrap beyond the extreme contacts: cable lead-in and string residual wrap (rad). */
export const DEFAULT_WRAP = Math.PI / 6;

/** Largest distance of the last explicit sample from full draw that still counts as full draw (m). */
const FULL_DRAW_TOLERANCE = 1e-12;
/** Largest deviation of the brace string contact from ψ = 0 (rad). */
const BRACE_ANGLE_TOLERANCE = 1e-9;
/** Closure residual at which Newton stops early (m). */
const STOP_TOLERANCE = 1e-15;
/** Largest Newton step in θ and α (rad). */
const MAX_THETA_STEP = 0.5;
const MAX_ALPHA_STEP = 0.1;

/**
 * @typedef {'invalid-input' | 'brace' | 'no-convergence' | 'slack-string' | 'slack-cable'
 *   | 'wrap-exhausted' | 'wrap-overlap' | 'cable-lever' | 'cam-reversal' | 'non-finite'
 *   | 'concave-track'} DiagnosticCode
 */

/**
 * @typedef {object} Diagnostic
 * @property {DiagnosticCode} code
 * @property {[number, number] | null} xRange first and last nock position of
 *   the affected samples (m); null when the input or the brace state fails
 * @property {string} message
 */

/**
 * @typedef {object} ForwardInput
 * @property {import('../state/schema.js').Geometry} geometry
 * @property {import('./support.js').SupportData} stringTrack pitch line of the string track
 * @property {import('./support.js').SupportData} cableTrack pitch line of the cable track
 * @property {import('./limb.js').LimbData} limb
 * @property {number} [stringTermination] string termination ψ_e,s in the cam
 *   frame (rad); default: largest string contact angle + {@link DEFAULT_WRAP}
 * @property {number} [cableTermination] cable termination ψ_e,c (rad);
 *   default: smallest cable contact angle − {@link DEFAULT_WRAP}
 * @property {number} [samples] number of samples of the default grid
 *   (default {@link FULL_SAMPLES}, at least 2)
 * @property {ArrayLike<number>} [x] explicit nock positions instead of the
 *   default grid: increasing, none before brace and none after full draw
 * @property {number} [maxIterations] Newton iteration limit per sample
 */

/**
 * @typedef {object} BraceState
 * @property {number} psiS string contact angle (rad)
 * @property {number} psiC cable contact angle (rad)
 * @property {number} pS string lever arm (m)
 * @property {number} pC cable lever arm (m)
 * @property {number} sA (m)
 * @property {number} cA (m)
 * @property {number} span free string length l_0 from contact to nock (m)
 * @property {number} moment limb moment E1'(0) (N·m)
 * @property {number} stringTension T_s0 (N)
 * @property {number} cableTension T_c0 (N)
 * @property {number} slope F'(x_b) = 2·T_s0 / l_0 (N/m)
 * @property {number} axleX top axle at brace (m)
 * @property {number} axleY
 * @property {number} pivotX limb pivot Q (m)
 * @property {number} pivotY
 */

/**
 * Samples are Float64Arrays of length n; samples after a failure are NaN.
 * @typedef {object} ForwardResult
 * @property {'ok' | 'infeasible' | 'no-convergence'} status
 * @property {Diagnostic[]} diagnostics
 * @property {number} n number of samples
 * @property {Float64Array} x nock position (m)
 * @property {Float64Array} F draw force (N)
 * @property {Float64Array} theta cam rotation (rad)
 * @property {Float64Array} alpha limb rotation from brace (rad)
 * @property {Float64Array} Ts string tension (N)
 * @property {Float64Array} Tc cable tension (N)
 * @property {Float64Array} phi string angle against the y axis (rad)
 * @property {Float64Array} psiS string contact angle, cam frame (rad)
 * @property {Float64Array} psiC cable contact angle, cam frame (rad)
 * @property {Float64Array} pS string lever arm (m)
 * @property {Float64Array} pC cable lever arm (m)
 * @property {Float64Array} sA s_a (m)
 * @property {Float64Array} cA c_a (m)
 * @property {Float64Array} spanS free string length (m)
 * @property {Float64Array} spanC free cable length (m)
 * @property {Float64Array} axleX top axle O (m)
 * @property {Float64Array} axleY
 * @property {Float64Array} dThetaDx dθ/dx (rad/m)
 * @property {Float64Array} dAlphaDx dα/dx (rad/m)
 * @property {Float64Array} closure closure residual max(|r_s|, |r_c|) (m)
 * @property {BraceState | null} brace
 * @property {number} stringLength full string length L_s = 2·g_s (m)
 * @property {number} cableLength L_c (m)
 * @property {number} stringTermination (rad); the default comes from the
 *   largest string contact angle over the solved samples
 * @property {number} cableTermination (rad); the default comes from the
 *   smallest cable contact angle over the solved samples
 * @property {number} drawEnergy 2·(E1(α_f) − E1(0)) (J); NaN when the solve
 *   fails or the grid does not end at full draw
 * @property {number} limbEnergy 2·E1(α_f), including the preload (J); NaN
 *   like drawEnergy
 * @property {number} preloadEnergy 2·E1(0) (J)
 * @property {number} iterations Newton iterations over all samples
 */

/**
 * Default grid: x − x_b = s² with s uniform, so samples cluster near brace.
 * @param {number} xBrace (m)
 * @param {number} xFull (m)
 * @param {number} samples at least 2
 * @returns {Float64Array}
 */
export function drawGrid(xBrace, xFull, samples) {
  const x = new Float64Array(samples);
  const sMax = Math.sqrt(xFull - xBrace);
  for (let j = 0; j < samples; j++) {
    const s = (sMax * j) / (samples - 1);
    x[j] = xBrace + s * s;
  }
  x[samples - 1] = xFull;
  return x;
}

const MESSAGES = /** @type {Record<DiagnosticCode, string>} */ ({
  'invalid-input': 'The solver input is not valid',
  brace: 'The brace state cannot be built',
  'no-convergence': 'The string and cable closure did not converge',
  'slack-string': 'The string goes slack: its tension is zero or negative',
  'slack-cable': 'The power cable goes slack: its tension is zero or negative',
  'wrap-exhausted': 'A cord runs off its track: the contact leaves the wrapped or defined part of the track',
  'wrap-overlap': 'A cord wraps a full turn or more on its track and would overlap itself in the groove',
  'cable-lever': 'The limbs do not pull the cable: c_a, the cable length change per limb rotation, is zero or negative',
  'cam-reversal': 'The cam turns backwards while the string is drawn (dθ/dx ≤ 0)',
  'non-finite': 'The solution contains values outside the floating-point range; the input magnitudes are too large',
  'concave-track': 'A cord wraps or touches a concave part of its track (radius of curvature p + p″ < 0), which a cord bridges instead of following',
});

/**
 * @param {number} n
 */
function emptyResult(n) {
  const arr = () => new Float64Array(n).fill(NaN);
  return {
    x: arr(), F: arr(), theta: arr(), alpha: arr(), Ts: arr(), Tc: arr(), phi: arr(), psiS: arr(), psiC: arr(),
    pS: arr(), pC: arr(), sA: arr(), cA: arr(), spanS: arr(), spanC: arr(), axleX: arr(), axleY: arr(),
    dThetaDx: arr(), dAlphaDx: arr(), closure: arr(),
  };
}

/**
 * @param {DiagnosticCode} code
 * @param {string} detail
 * @returns {ForwardResult}
 */
function failed(code, detail) {
  return {
    status: 'infeasible',
    diagnostics: [{ code, xRange: null, message: `${MESSAGES[code]}: ${detail}` }],
    n: 0,
    ...emptyResult(0),
    brace: null,
    stringLength: NaN,
    cableLength: NaN,
    stringTermination: NaN,
    cableTermination: NaN,
    drawEnergy: NaN,
    limbEnergy: NaN,
    preloadEnergy: NaN,
    iterations: 0,
  };
}

/**
 * Nock positions of the solve, or an error message. The solve always starts
 * at brace: an explicit grid that starts later gets x_b prepended, so every
 * check also covers the brace state.
 * @param {ForwardInput} input
 * @param {number} xBrace
 * @param {number} xFull
 * @returns {Float64Array | string}
 */
function gridFor(input, xBrace, xFull) {
  if (input.x !== undefined) {
    const source = input.x;
    const length = source === null || typeof source !== 'object' ? NaN : Number(source.length);
    if (!Number.isInteger(length) || length < 1) return 'the x grid must be a non-empty array of numbers';
    if (length > MAX_SAMPLES) return `the x grid has more than ${MAX_SAMPLES} samples`;
    // Copy exactly the validated number of indexed entries; an iterator on
    // the source is ignored.
    const given = new Float64Array(length);
    for (let i = 0; i < length; i++) given[i] = Number(source[i]);
    for (let i = 0; i < given.length; i++) {
      const outside = given[i] < xBrace - FULL_DRAW_TOLERANCE || given[i] > xFull + FULL_DRAW_TOLERANCE;
      if (!Number.isFinite(given[i]) || outside || (i > 0 && !(given[i] > given[i - 1]))) {
        return 'the x grid must be finite, increasing and lie between brace and full draw';
      }
    }
    if (given[0] <= xBrace + FULL_DRAW_TOLERANCE) return given;
    const x = new Float64Array(given.length + 1);
    x[0] = xBrace;
    x.set(given, 1);
    return x;
  }
  const samples = input.samples ?? FULL_SAMPLES;
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_SAMPLES) {
    return `the sample count must be an integer from 2 to ${MAX_SAMPLES}`;
  }
  return drawGrid(xBrace, xFull, samples);
}

/**
 * Run the forward model. Never throws; problems come back as diagnostics.
 * Any exception while reading the input (for example a grid value that does
 * not convert to a number) becomes an invalid-input diagnostic.
 * @param {ForwardInput} input
 * @returns {ForwardResult}
 */
export function solveForward(input) {
  try {
    return solveForwardChecked(input);
  } catch (err) {
    return failed('invalid-input', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Forward model body; solveForward guards it.
 * @param {ForwardInput} input
 * @returns {ForwardResult}
 */
function solveForwardChecked(input) {
  if (typeof input !== 'object' || input === null) return failed('invalid-input', 'the input is not an object');
  let stringSupport;
  let cableSupport;
  let limb;
  let moment0;
  try {
    stringSupport = createSupport(input.stringTrack);
    cableSupport = createSupport(input.cableTrack);
    limb = createLimb(input.limb);
    moment0 = limb.moment(0);
  } catch (err) {
    return failed('invalid-input', err instanceof Error ? err.message : String(err));
  }
  if (!Number.isFinite(moment0)) return failed('invalid-input', 'the limb moment at brace is not finite');
  const { bow, error } = bowGeometry(input.geometry, stringSupport);
  if (!bow) return failed('invalid-input', /** @type {string} */ (error));
  const grid = gridFor(input, bow.xBrace, bow.xFull);
  if (typeof grid === 'string') return failed('invalid-input', grid);
  for (const key of /** @type {const} */ (['stringTermination', 'cableTermination'])) {
    if (input[key] !== undefined && !Number.isFinite(input[key])) {
      return failed('invalid-input', `${key} must be a finite angle`);
    }
  }
  const maxIterations = input.maxIterations ?? MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATION_LIMIT) {
    return failed('invalid-input', `the iteration limit must be an integer from 1 to ${MAX_ITERATION_LIMIT}`);
  }

  // Brace: θ = 0, α = 0.
  const pose = createPose();
  const braceOk = evaluatePose(bow, stringSupport, cableSupport, bow.xBrace, 0, 0, pose);
  // The geometry puts the brace string contact at ψ = 0; another tangent
  // means the string cannot leave the track there towards the nock.
  const stringOk = pose.string.status === 'ok' && Math.abs(pose.string.psi) < BRACE_ANGLE_TOLERANCE;
  if (!stringOk) return failed('brace', 'the string cannot leave the string track at ψ = 0 towards the nock');
  if (!braceOk) return failed('brace', 'the power cable has no tangent from the cable track to the bottom axle');
  const gs0 = pose.string.reduced;
  const gc0 = pose.cable.reduced;
  const det0 = pose.string.p * pose.ca + pose.sa * pose.cable.p;
  if (!(Math.abs(det0) > 0)) return failed('brace', 'the closure Jacobian is singular at brace (p_s·c_a + s_a·p_c = 0)');
  const Ts0 = (moment0 * pose.cable.p) / det0;
  /** @type {BraceState} */
  const brace = {
    psiS: pose.string.psi,
    psiC: pose.cable.psi,
    pS: pose.string.p,
    pC: pose.cable.p,
    sA: pose.sa,
    cA: pose.ca,
    span: pose.string.span,
    moment: moment0,
    stringTension: Ts0,
    cableTension: (moment0 * pose.string.p) / det0,
    slope: (2 * Ts0) / pose.string.span,
    axleX: bow.braceAxleX,
    axleY: bow.braceAxleY,
    pivotX: bow.pivotX,
    pivotY: bow.pivotY,
  };

  const n = grid.length;
  const out = emptyResult(n);
  let theta = 0;
  let alpha = 0;
  let dTheta = 0;
  let dAlpha = 0;
  let xPrev = bow.xBrace;
  let iterations = 0;
  let failedAt = -1;
  let failure = '';
  for (let i = 0; i < n; i++) {
    const x = grid[i];
    let th = theta + dTheta * (x - xPrev);
    let al = alpha + dAlpha * (x - xPrev);
    let residual = Infinity;
    let previous = Infinity;
    let converged = false;
    for (let it = 0; it < maxIterations; it++) {
      iterations++;
      if (!evaluatePose(bow, stringSupport, cableSupport, x, th, al, pose)) {
        failure = 'a cord has no tangent from its track';
        break;
      }
      const r1 = pose.string.reduced - gs0;
      const r2 = pose.cable.reduced - gc0;
      residual = Math.max(Math.abs(r1), Math.abs(r2));
      if (residual <= STOP_TOLERANCE || (it > 0 && residual >= 0.5 * previous && residual <= CLOSURE_TOLERANCE)) {
        converged = true;
        break;
      }
      previous = residual;
      const pS = pose.string.p;
      const pC = pose.cable.p;
      const det = pS * pose.ca + pose.sa * pC;
      let stepTheta = (pose.ca * r1 - pose.sa * r2) / det;
      let stepAlpha = (pC * r1 + pS * r2) / det;
      if (!Number.isFinite(stepTheta) || !Number.isFinite(stepAlpha)) {
        failure = 'the closure Jacobian is singular';
        break;
      }
      const scale = Math.min(1, MAX_THETA_STEP / Math.abs(stepTheta), MAX_ALPHA_STEP / Math.abs(stepAlpha));
      stepTheta *= scale;
      stepAlpha *= scale;
      th += stepTheta;
      al += stepAlpha;
    }
    if (!converged && !failure && residual <= CLOSURE_TOLERANCE) {
      // Iteration limit reached with an accepted residual: keep the
      // evaluated state, not the last Newton update.
      converged = true;
      th = pose.theta;
      al = pose.alpha;
    }
    if (!converged) {
      failedAt = i;
      if (!failure) failure = `the residual stayed at ${residual.toExponential(2)} m after ${maxIterations} iterations`;
      break;
    }
    const pS = pose.string.p;
    const pC = pose.cable.p;
    const det = pS * pose.ca + pose.sa * pC;
    const m = limb.moment(al);
    const sinPhi = pose.sinPhi;
    dTheta = (pose.ca * sinPhi) / det;
    dAlpha = (pC * sinPhi) / det;
    const Ts = (m * pC) / det;
    const Tc = (m * pS) / det;
    out.x[i] = x;
    out.theta[i] = th;
    out.alpha[i] = al;
    out.F[i] = 2 * (m * dAlpha);
    out.Ts[i] = Ts;
    out.Tc[i] = Tc;
    out.phi[i] = Math.atan2(pose.usx, -pose.usy);
    out.psiS[i] = pose.string.psi;
    out.psiC[i] = pose.cable.psi;
    out.pS[i] = pS;
    out.pC[i] = pC;
    out.sA[i] = pose.sa;
    out.cA[i] = pose.ca;
    out.spanS[i] = pose.string.span;
    out.spanC[i] = pose.cable.span;
    out.axleX[i] = pose.axleX;
    out.axleY[i] = pose.axleY;
    out.dThetaDx[i] = dTheta;
    out.dAlphaDx[i] = dAlpha;
    out.closure[i] = residual;
    theta = th;
    alpha = al;
    xPrev = x;
  }
  const solved = failedAt < 0 ? n : failedAt;
  for (let i = solved; i < n; i++) out.x[i] = grid[i];

  let maxPsiS = brace.psiS;
  let minPsiC = brace.psiC;
  for (let i = 0; i < solved; i++) {
    maxPsiS = Math.max(maxPsiS, out.psiS[i]);
    minPsiC = Math.min(minPsiC, out.psiC[i]);
  }
  const stringTermination = input.stringTermination ?? maxPsiS + DEFAULT_WRAP;
  const cableTermination = input.cableTermination ?? minPsiC - DEFAULT_WRAP;

  const diagnostics = collectDiagnostics(out, solved, bow.xBrace, stringTermination, cableTermination, stringSupport, cableSupport);
  // The terminations must lie on the defined part of an open track.
  const outside = (/** @type {number} */ psi, /** @type {import('./support.js').Support} */ s) => psi < s.min || psi > s.max;
  if (outside(stringTermination, stringSupport) || outside(cableTermination, cableSupport)) {
    diagnostics.push({
      code: 'wrap-exhausted',
      xRange: [grid[0], grid[n - 1]],
      message: `${MESSAGES['wrap-exhausted']}: a cord termination lies beyond the end of its track`,
    });
  }
  // The contact search and the length identity assume a convex track on the
  // wrapped range: string from its smallest contact angle to its
  // termination, cable from its termination to its largest contact angle.
  let minPsiS = brace.psiS;
  let maxPsiC = brace.psiC;
  for (let i = 0; i < solved; i++) {
    minPsiS = Math.min(minPsiS, out.psiS[i]);
    maxPsiC = Math.max(maxPsiC, out.psiC[i]);
  }
  for (const [support, a, b, name] of /** @type {const} */ ([
    [stringSupport, minPsiS, stringTermination, 'string'],
    [cableSupport, cableTermination, maxPsiC, 'cable'],
  ])) {
    const smallest = support.minRho(a, b);
    if (smallest.value < 0) {
      const deg = ((smallest.psi * 180) / Math.PI).toFixed(1);
      diagnostics.push({
        code: 'concave-track',
        xRange: [grid[0], grid[n - 1]],
        message: `${MESSAGES['concave-track']}: ${name} track, ρ = ${(smallest.value * 1000).toFixed(3)} mm at ψ = ${deg}°`,
      });
    }
  }
  if (failedAt >= 0) {
    diagnostics.unshift({
      code: 'no-convergence',
      xRange: [grid[failedAt], grid[n - 1]],
      message: `${MESSAGES['no-convergence']}: ${failure}`,
    });
  }
  // Draw and limb energy are full-draw values: only a solve that reaches x_f has them.
  const reachesFull = failedAt < 0 && Math.abs(grid[n - 1] - bow.xFull) <= FULL_DRAW_TOLERANCE;
  const energies = reachesFull
    ? limbEnergies(limb, out.alpha[n - 1])
    : { drawEnergy: NaN, limbEnergy: NaN, preloadEnergy: 2 * limb.energy(0) };
  const energyOk = Number.isFinite(energies.preloadEnergy) && (!reachesFull || (Number.isFinite(energies.drawEnergy) && Number.isFinite(energies.limbEnergy)));
  if (failedAt < 0 && !energyOk) {
    diagnostics.push({
      code: 'non-finite',
      xRange: [grid[n - 1], grid[n - 1]],
      message: `${MESSAGES['non-finite']}: the limb energy overflows`,
    });
  }
  return {
    status: failedAt >= 0 ? 'no-convergence' : diagnostics.length > 0 ? 'infeasible' : 'ok',
    diagnostics,
    n,
    ...out,
    brace,
    stringLength: 2 * (gs0 + terminationConstant(stringSupport, STRING_SIDE, stringTermination)),
    cableLength: gc0 + terminationConstant(cableSupport, CABLE_SIDE, cableTermination),
    stringTermination,
    cableTermination,
    ...energies,
    iterations,
  };
}

/**
 * Validity checks per sample, merged into runs of consecutive samples.
 * @param {ReturnType<typeof emptyResult>} out
 * @param {number} solved number of solved samples
 * @param {number} xBrace
 * @param {number} stringTermination
 * @param {number} cableTermination
 * @param {import('./support.js').Support} stringSupport
 * @param {import('./support.js').Support} cableSupport
 * @returns {Diagnostic[]}
 */
function collectDiagnostics(out, solved, xBrace, stringTermination, cableTermination, stringSupport, cableSupport) {
  /** @type {[DiagnosticCode, (i: number) => boolean][]} */
  const checks = [
    ['slack-string', (i) => !(out.Ts[i] > 0)],
    ['slack-cable', (i) => !(out.Tc[i] > 0)],
    [
      'wrap-exhausted',
      (i) => {
        const psiS = out.psiS[i];
        const psiC = out.psiC[i];
        return (
          psiS > stringTermination ||
          psiC < cableTermination ||
          psiS < stringSupport.min ||
          psiS > stringSupport.max ||
          psiC < cableSupport.min ||
          psiC > cableSupport.max
        );
      },
    ],
    // A planar groove holds less than one turn: the string wrap is largest
    // at brace, the cable wrap at full draw.
    ['wrap-overlap', (i) => stringTermination - out.psiS[i] >= 2 * Math.PI || out.psiC[i] - cableTermination >= 2 * Math.PI],
    ['cable-lever', (i) => !(out.cA[i] > 0)],
    ['cam-reversal', (i) => out.x[i] > xBrace && !(out.dThetaDx[i] > 0)],
    [
      'non-finite',
      (i) => !(Number.isFinite(out.F[i]) && Number.isFinite(out.Ts[i]) && Number.isFinite(out.Tc[i]) && Number.isFinite(out.theta[i]) && Number.isFinite(out.alpha[i])),
    ],
  ];
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  for (const [code, flagged] of checks) {
    let start = -1;
    for (let i = 0; i <= solved; i++) {
      const on = i < solved && flagged(i);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        diagnostics.push({ code, xRange: [out.x[start], out.x[i - 1]], message: MESSAGES[code] });
        start = -1;
      }
    }
  }
  return diagnostics;
}
