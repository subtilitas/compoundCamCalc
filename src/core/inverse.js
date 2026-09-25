/**
 * Inverse model: target force curve, string track and limb → cable track.
 *
 * Explicit per nock position x, no marching:
 *
 *   W(x)  = ∫ F dx from x_b                       exact integral of the target
 *   α(x)  = E1⁻¹(E1(0) + W/2)                     energy balance of both limbs
 *   θ(x)  from g_s(x, θ, α) = L_s/2               1D Newton, ∂g_s/∂θ = −p_s
 *   T_s   = F / (2·sin φ),  T_s0 = F'(x_b)·l_0/2  at brace
 *   p_c   = p_s·c_a·T_s / (E1'(α) − T_s·s_a)      limb and cam balance
 *
 * The anchor A lies straight below the axle O at the distance D = 2·O_y, so
 * the cable line through A at the distance p_c from O has the world normal
 * angle π + asin(p_c/D) (tangent on the −x side of the axle) and
 * c_a = V·√(1 − (p_c/D)²) with V = 2·R_L·cos β. With
 * K = p_s·T_s·V / (E1' − T_s·s_a) the lever arm follows in closed form,
 *
 *   p_c = K·D / √(D² + K²),   ψ_c = π + asin(p_c/D) + θ   (cam frame),
 *
 * which is the limit of the fixed-point iteration on the cable direction.
 * T_c = (E1' − T_s·s_a) / c_a = T_s·p_s / p_c. The kinematic identity
 * p_c = c_a·dα/dθ holds for the result (checked in the tests).
 *
 * Brace conditions: F(x_b) = 0, F'(x_b) = 2·T_s0/l_0 and
 *
 *   F''(x_b) = −(2·T_s0 / l_0²)·(3·K_1 + ρ_s0/l_0),
 *   K_1 = (p_s'(0)·c_a0 + R_L·sin β_b·p_c0) / (p_s0·c_a0 + s_a0·p_c0),
 *
 * from the second-order expansion of the string closure and of
 * α' = p_c·sin φ / det at brace (derivation in docs/model.md). It depends on
 * p_c0 but not on p_c'. A target whose F''(x_b) differs gives a cable lever
 * arm with a term in √(ψ − ψ_c0), so the solver rebuilds the target with
 * this F''(x_b).
 *
 * Lengths in m, angles in rad, forces in N, energies in J.
 * @module core/inverse
 */

import { STRING_SIDE, createContact, solveContact } from './contact.js';
import { bowGeometry } from './geometry.js';
import { createLimb } from './limb.js';
import { solveLinear } from './linalg.js';
import { createSupport, splineSupport } from './support.js';

/** Largest accepted string closure residual (m). */
export const CLOSURE_TOLERANCE = 1e-10;
/** Closure residual at which Newton stops early (m). */
const STOP_TOLERANCE = 1e-15;
/** Newton iteration limit of the string closure. */
export const MAX_ITERATIONS = 30;
/** Largest Newton step in θ (rad). */
const MAX_THETA_STEP = 0.5;
/** Largest deviation of the brace string contact from ψ = 0 (rad). */
const BRACE_ANGLE_TOLERANCE = 1e-9;
/**
 * Largest distance of a nock position from x_b that counts as brace (m):
 * the tolerance of the brace point in project validation.
 */
export const BRACE_POSITION_TOLERANCE = 1e-9;
/** Deviation of a resampled cable angle from its uniform target, relative to the step. */
const RESAMPLE_TOLERANCE = 1e-3;
/** Iteration limit of the resampling root search. */
const RESAMPLE_ITERATIONS = 60;

/** @typedef {import('./support.js').Support} Support */
/** @typedef {import('./support.js').SupportData} SupportData */
/** @typedef {import('./support.js').SplineData} SplineData */
/** @typedef {import('./limb.js').Limb} Limb */
/** @typedef {import('./geometry.js').BowGeometry} BowGeometry */

/**
 * Target force curve for the inverse model.
 * @typedef {object} InverseTarget
 * @property {(x: number) => number} force F(x) (N)
 * @property {(x: number) => number} work W(x), integral of F from x_b to x (J)
 * @property {number} slope F'(x_b) (N/m)
 */

/**
 * @typedef {object} InverseInput
 * @property {import('../state/schema.js').Geometry} geometry
 * @property {SupportData} stringTrack pitch line of the string track
 * @property {import('./limb.js').LimbData} limb
 * @property {number} [maxIterations] Newton iteration limit of the string
 *   closure (default {@link MAX_ITERATIONS})
 */

/**
 * @typedef {object} InverseContext
 * @property {BowGeometry} bow
 * @property {Support} stringSupport
 * @property {Limb} limb
 * @property {number} reduced reduced string half-length at brace (m); the
 *   closure holds contact.reduced at this value
 * @property {number} energy0 E1(0) (J)
 * @property {number} moment0 E1'(0) (N·m)
 * @property {number} span free string span at brace l_0 (m)
 * @property {number} pS0 string lever arm at brace (m)
 * @property {number} dpS0 p_s'(0) (m/rad)
 * @property {number} rhoS0 string track radius of curvature at ψ = 0 (m)
 * @property {number} maxIterations Newton iteration limit of the string closure
 */

/**
 * @typedef {object} BraceConditions
 * @property {boolean} ok 0 < T_s0 < M_b/s_a0 and a finite state
 * @property {number} slope F'(x_b) (N/m)
 * @property {number} second F''(x_b) implied by p_c0 (N/m²)
 * @property {number} stringTension T_s0 (N)
 * @property {number} maxStringTension M_b/s_a0 (N); Infinity when s_a0 ≤ 0
 * @property {number} cableTension T_c0 (N)
 * @property {number} pC p_c0 (m)
 * @property {number} psiC ψ_c0, cam frame (rad)
 * @property {number} cA c_a0 (m)
 * @property {number} sA s_a0 (m)
 * @property {number} span l_0 (m)
 * @property {number} moment M_b = E1'(0) (N·m)
 * @property {number} maxSlope largest feasible F'(x_b) = 2·M_b/(s_a0·l_0) (N/m)
 */

/**
 * One sample of the inverse model.
 * @typedef {object} InverseSample
 * @property {boolean} ok the string closure converged and every value is finite
 * @property {number} x (m)
 * @property {number} F (N)
 * @property {number} W (J)
 * @property {number} theta (rad)
 * @property {number} alpha (rad)
 * @property {number} phi string angle against the y axis (rad)
 * @property {number} psiS string contact angle, cam frame (rad)
 * @property {number} pS (m)
 * @property {number} sA (m)
 * @property {number} Ts (N)
 * @property {number} Tc (N)
 * @property {number} moment E1'(α) (N·m)
 * @property {number} pC (m)
 * @property {number} cA (m)
 * @property {number} psiC cable contact angle, cam frame (rad)
 * @property {number} dThetaDx (rad/m)
 * @property {number} dAlphaDx (rad/m)
 * @property {number} axleX (m)
 * @property {number} axleY (m)
 * @property {number} anchorReach B·t = √(D² − p_c²), the distance along the
 *   cable line from the foot of the perpendicular from the axle to the anchor
 *   (m); the reduced cable length is B·t + P(ψ_c), and the free span is
 *   B·t − p_c'(ψ_c) once the cable track exists
 * @property {number} closure string closure residual (m)
 */

/**
 * Inverse model context from the geometry, the string track and the limb.
 * Never throws.
 * @param {InverseInput} input
 * @returns {{ context: InverseContext | null, error: string | null }}
 */
export function createInverse(input) {
  let stringSupport;
  let limb;
  try {
    stringSupport = createSupport(input.stringTrack);
    limb = createLimb(input.limb);
  } catch (err) {
    return { context: null, error: err instanceof Error ? err.message : String(err) };
  }
  const { bow, error } = bowGeometry(input.geometry, stringSupport);
  if (!bow) return { context: null, error };
  const moment0 = limb.moment(0);
  const energy0 = limb.energy(0);
  if (!Number.isFinite(moment0) || !Number.isFinite(energy0)) {
    return { context: null, error: 'The limb moment at brace is not finite' };
  }
  const contact = solveContact(stringSupport, bow.xBrace - bow.braceAxleX, -bow.braceAxleY, STRING_SIDE, 0);
  if (contact.status !== 'ok' || !(Math.abs(contact.psi) < BRACE_ANGLE_TOLERANCE)) {
    return { context: null, error: 'The string cannot leave the string track at ψ = 0 towards the nock' };
  }
  return {
    context: {
      bow,
      stringSupport,
      limb,
      reduced: contact.reduced,
      maxIterations: input.maxIterations ?? MAX_ITERATIONS,
      energy0,
      moment0,
      span: contact.span,
      pS0: contact.p,
      dpS0: contact.dp,
      rhoS0: stringSupport.rho(0),
    },
    error: null,
  };
}

/**
 * Cable lever arm from the lever-arm numerator N = p_s·T_s·V and the
 * denominator E1' − T_s·s_a at the axle distance D:
 * p_c = sign(den)·N·D / √((D·den)² + N²), c_a = V·√(1 − (p_c/D)²).
 * @param {number} numerator p_s·T_s·V (N·m²)
 * @param {number} denominator E1' − T_s·s_a (N·m)
 * @param {number} D axle distance 2·O_y (m)
 * @param {number} V 2·R_L·cos β (m)
 * @returns {{ pC: number, cA: number }}
 */
function cableLever(numerator, denominator, D, V) {
  const root = Math.hypot(D * denominator, numerator);
  const sign = denominator < 0 ? -1 : 1;
  return { pC: (sign * numerator * D) / root, cA: (V * Math.abs(denominator) * D) / root };
}

/**
 * Brace conditions for a target slope F'(x_b).
 * @param {InverseContext} ctx
 * @param {number} slope F'(x_b) (N/m)
 * @returns {BraceConditions}
 */
export function braceConditions(ctx, slope) {
  const { bow, moment0, span, pS0, dpS0, rhoS0 } = ctx;
  const beta = bow.betaBrace;
  const sA = bow.limbLength * Math.cos(beta);
  const V = 2 * sA;
  const D = 2 * bow.braceAxleY;
  const Ts0 = (slope * span) / 2;
  const maxTs = sA > 0 ? moment0 / sA : Infinity;
  const den = moment0 - Ts0 * sA;
  const { pC, cA } = cableLever(pS0 * Ts0 * V, den, D, V);
  const det = pS0 * cA + sA * pC;
  const k1 = (dpS0 * cA + bow.limbLength * Math.sin(beta) * pC) / det;
  const second = ((-2 * Ts0) / (span * span)) * (3 * k1 + rhoS0 / span);
  const ok = Ts0 > 0 && Ts0 < maxTs && Number.isFinite(second) && pC > 0 && cA > 0;
  return {
    ok,
    slope,
    second,
    stringTension: Ts0,
    maxStringTension: maxTs,
    cableTension: cA > 0 ? den / cA : NaN,
    pC,
    psiC: Math.PI + Math.asin(Math.max(-1, Math.min(1, pC / D))),
    cA,
    sA,
    span,
    moment: moment0,
    maxSlope: sA > 0 ? (2 * moment0) / (sA * span) : Infinity,
  };
}

/**
 * @returns {InverseSample}
 */
function emptySample() {
  return {
    ok: false, x: NaN, F: NaN, W: NaN, theta: NaN, alpha: NaN, phi: NaN, psiS: NaN, pS: NaN, sA: NaN, Ts: NaN,
    Tc: NaN, moment: NaN, pC: NaN, cA: NaN, psiC: NaN, dThetaDx: NaN, dAlphaDx: NaN, axleX: NaN, axleY: NaN,
    anchorReach: NaN, closure: NaN,
  };
}

/**
 * Inverse model at one nock position. θ comes from the string closure by
 * Newton from the warm start (thetaGuess, psiGuess). Within
 * BRACE_POSITION_TOLERANCE of x_b the brace values apply (T_s = T_s0,
 * θ = α = 0). Never throws; out.ok is false when the closure fails.
 * @param {InverseContext} ctx
 * @param {BraceConditions} brace
 * @param {number} x nock position (m)
 * @param {number} F target force (N)
 * @param {number} W target work from brace (J)
 * @param {number} thetaGuess warm start of θ (rad)
 * @param {number} psiGuess warm start of the string contact angle (rad)
 * @param {InverseSample} [out]
 * @returns {InverseSample}
 */
export function inverseAt(ctx, brace, x, F, W, thetaGuess, psiGuess, out = emptySample()) {
  const { bow, stringSupport, limb } = ctx;
  const atBrace = Math.abs(x - bow.xBrace) <= BRACE_POSITION_TOLERANCE;
  Object.assign(out, emptySample());
  out.x = x;
  out.F = F;
  out.W = W;
  const alpha = atBrace ? 0 : limb.inverse(ctx.energy0 + W / 2);
  if (!Number.isFinite(alpha)) return out;
  const beta = bow.betaBrace - alpha;
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const R = bow.limbLength;
  const ox = bow.pivotX + R * cb;
  const oy = bow.pivotY + R * sb;
  const odx = R * sb;
  const ody = -R * cb;
  const contact = scratchContact;
  let th = atBrace ? 0 : thetaGuess;
  let psiWarm = atBrace ? 0 : psiGuess;
  let residual = Infinity;
  let previous = Infinity;
  let converged = false;
  let evaluated = NaN;
  for (let it = 0; it < ctx.maxIterations; it++) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const bx = x - ox;
    const by = -oy;
    solveContact(stringSupport, c * bx - s * by, s * bx + c * by, STRING_SIDE, psiWarm, contact);
    if (contact.status !== 'ok') break;
    evaluated = th;
    const r = contact.reduced - ctx.reduced;
    residual = Math.abs(r);
    if (atBrace || residual <= STOP_TOLERANCE || (it > 0 && residual >= 0.5 * previous && residual <= CLOSURE_TOLERANCE)) {
      converged = true;
      break;
    }
    previous = residual;
    let step = r / contact.p;
    if (!Number.isFinite(step)) break;
    if (Math.abs(step) > MAX_THETA_STEP) step = Math.sign(step) * MAX_THETA_STEP;
    th += step;
    psiWarm = contact.psi + step;
  }
  if (!converged && residual <= CLOSURE_TOLERANCE) {
    // Iteration limit with an accepted residual: keep the evaluated state.
    th = evaluated;
    converged = true;
  }
  if (!converged) return out;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const usx = c * contact.ux + s * contact.uy;
  const usy = -s * contact.ux + c * contact.uy;
  const sinPhi = usx;
  const sA = usx * odx + usy * ody;
  const pS = contact.p;
  const moment = limb.moment(alpha);
  const Ts = atBrace ? brace.stringTension : F / (2 * sinPhi);
  const D = 2 * oy;
  const V = -2 * ody;
  const den = moment - Ts * sA;
  const { pC, cA } = cableLever(pS * Ts * V, den, D, V);
  const dAlpha = F / (2 * moment);
  out.theta = th;
  out.alpha = alpha;
  out.phi = Math.atan2(usx, -usy);
  out.psiS = contact.psi;
  out.pS = pS;
  out.sA = sA;
  out.Ts = Ts;
  out.Tc = den / cA;
  out.moment = moment;
  out.pC = pC;
  out.cA = cA;
  out.psiC = Math.PI + Math.asin(Math.max(-1, Math.min(1, pC / D))) + th;
  out.dAlphaDx = dAlpha;
  out.dThetaDx = (sinPhi - sA * dAlpha) / pS;
  out.axleX = ox;
  out.axleY = oy;
  out.anchorReach = Math.sqrt(Math.max(0, D * D - pC * pC));
  out.closure = residual;
  out.ok = [th, Ts, pC, cA, out.Tc, out.psiC, out.dThetaDx].every(Number.isFinite);
  return out;
}

const scratchContact = createContact();

/** Names of the per-sample arrays of {@link InverseSamples}. */
export const SAMPLE_FIELDS = /** @type {const} */ ([
  'x', 'F', 'W', 'theta', 'alpha', 'phi', 'psiS', 'pS', 'sA', 'Ts', 'Tc', 'moment', 'pC', 'cA', 'psiC',
  'dThetaDx', 'dAlphaDx', 'axleX', 'axleY', 'anchorReach', 'closure',
]);

/**
 * Inverse model on a grid of nock positions; arrays of length n. Samples
 * after the first failure are NaN.
 * @typedef {{ [K in (typeof SAMPLE_FIELDS)[number]]: Float64Array } & { n: number, solved: number }} InverseSamples
 */

/**
 * Inverse model on an increasing grid of nock positions starting at x_b.
 * Each sample is explicit; the previous sample only supplies the warm start.
 * @param {InverseContext} ctx
 * @param {BraceConditions} brace
 * @param {InverseTarget} target
 * @param {ArrayLike<number>} xs increasing, xs[0] = x_b
 * @returns {InverseSamples}
 */
export function sampleInverse(ctx, brace, target, xs) {
  const n = xs.length;
  const out = /** @type {InverseSamples} */ (/** @type {unknown} */ ({ n, solved: 0 }));
  for (const key of SAMPLE_FIELDS) out[key] = new Float64Array(n).fill(NaN);
  const sample = emptySample();
  let theta = 0;
  let psi = 0;
  let dTheta = 0;
  let xPrev = ctx.bow.xBrace;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    out.x[i] = x;
    const guess = theta + dTheta * (x - xPrev);
    inverseAt(ctx, brace, x, target.force(x), target.work(x), guess, psi + guess - theta, sample);
    if (!sample.ok) break;
    for (const key of SAMPLE_FIELDS) out[key][i] = sample[key];
    out.solved = i + 1;
    theta = sample.theta;
    psi = sample.psiS;
    dTheta = sample.dThetaDx;
    xPrev = x;
  }
  for (let i = out.solved; i < n; i++) out.x[i] = xs[i];
  return out;
}

/**
 * Cable track samples at angles close to a uniform grid of step `step` over
 * [ψ_c0, ψ_cf]. The nock position of each angle is found by the Illinois
 * variant of regula falsi inside the bracket of the given samples, which
 * must have strictly increasing ψ_c. The returned angles are the exact
 * contact angles at those positions (within RESAMPLE_TOLERANCE·step of the
 * uniform grid), so every (ψ, p) pair is an exact point of the ideal track.
 * @param {InverseContext} ctx
 * @param {BraceConditions} brace
 * @param {InverseTarget} target
 * @param {InverseSamples} samples
 * @param {number} step target spacing (rad)
 * @param {number} [from] first sample of the range (default 0)
 * @returns {{ psi: Float64Array, p: Float64Array, x: Float64Array, evaluations: number } | null}
 *   null when a root search fails
 */
export function resampleCable(ctx, brace, target, samples, step, from = 0) {
  const n = samples.solved;
  const psiC = samples.psiC;
  const psi0 = psiC[from];
  const psiF = psiC[n - 1];
  const count = Math.max(2, Math.ceil((psiF - psi0) / step));
  const h = (psiF - psi0) / count;
  const psi = new Float64Array(count + 1);
  const p = new Float64Array(count + 1);
  const xs = new Float64Array(count + 1);
  psi[0] = psi0;
  p[0] = samples.pC[from];
  xs[0] = samples.x[from];
  psi[count] = psiF;
  p[count] = samples.pC[n - 1];
  xs[count] = samples.x[n - 1];
  const sample = emptySample();
  let evaluations = 0;
  let j = from;
  for (let k = 1; k < count; k++) {
    const goal = psi0 + k * h;
    while (j < n - 2 && psiC[j + 1] <= goal) j++;
    // Bracket [a, b] with g(a) ≤ 0 < g(b), g = ψ_c − goal.
    let a = samples.x[j];
    let b = samples.x[j + 1];
    let ga = psiC[j] - goal;
    let gb = psiC[j + 1] - goal;
    let thetaA = samples.theta[j];
    let psiSA = samples.psiS[j];
    let side = 0;
    let found = false;
    for (let it = 0; it < RESAMPLE_ITERATIONS; it++) {
      const x = gb - ga > 0 ? a - (ga * (b - a)) / (gb - ga) : 0.5 * (a + b);
      const t = (x - samples.x[j]) / (samples.x[j + 1] - samples.x[j]);
      const guess = samples.theta[j] + t * (samples.theta[j + 1] - samples.theta[j]);
      inverseAt(ctx, brace, x, target.force(x), target.work(x), guess, psiSA + guess - thetaA, sample);
      evaluations++;
      if (!sample.ok) return null;
      const g = sample.psiC - goal;
      if (Math.abs(g) <= RESAMPLE_TOLERANCE * h) {
        found = true;
        break;
      }
      if (g < 0) {
        a = x;
        ga = g;
        thetaA = sample.theta;
        psiSA = sample.psiS;
        if (side === -1) gb /= 2;
        side = -1;
      } else {
        b = x;
        gb = g;
        if (side === 1) ga /= 2;
        side = 1;
      }
    }
    if (!found) return null;
    psi[k] = sample.psiC;
    p[k] = sample.pC;
    xs[k] = sample.x;
  }
  return { psi, p, x: xs, evaluations };
}

/**
 * Derivative at xs[0] of the polynomial through the points (xs[k], ys[k]),
 * any spacing: Σ y_j·L_j'(x_0).
 * @param {number[]} xs distinct
 * @param {number[]} ys
 */
export function lagrangeSlope(xs, ys) {
  const x0 = xs[0];
  let d = 0;
  let w0 = 0;
  for (let m = 1; m < xs.length; m++) w0 += 1 / (x0 - xs[m]);
  d += ys[0] * w0;
  for (let j = 1; j < xs.length; j++) {
    let num = 1;
    let den = 1;
    for (let m = 0; m < xs.length; m++) {
      if (m === j) continue;
      den *= xs[j] - xs[m];
      if (m !== 0) num *= x0 - xs[m];
    }
    d += (ys[j] * num) / den;
  }
  return d;
}

/**
 * Open C2 cubic spline through resampled cable track points, clamped with
 * end slopes of the quartic through the five end points (error O(h⁴));
 * natural end conditions with fewer than 5 points.
 * @param {ArrayLike<number>} psi increasing (rad)
 * @param {ArrayLike<number>} p (m)
 * @returns {SplineData}
 */
export function cableSpline(psi, p) {
  const n = psi.length;
  if (n < 5) return splineSupport(psi, p);
  const head = [0, 1, 2, 3, 4];
  const tail = head.map((k) => n - 1 - k);
  const slope0 = lagrangeSlope(head.map((k) => psi[k]), head.map((k) => p[k]));
  const slope1 = lagrangeSlope(tail.map((k) => psi[k]), tail.map((k) => p[k]));
  return splineSupport(psi, p, { endSlopes: [slope0, slope1] });
}

/**
 * Quintic track piece p(ψ) = Σ a_k·u^k with u = (ψ − start)/length in [0, 1].
 * @typedef {object} PolyPiece
 * @property {'poly'} kind
 * @property {number} start (rad)
 * @property {number} length (rad), positive
 * @property {Float64Array} coeffs a_0 … a_5 (m)
 */

/**
 * p, p', p'' of a quintic piece at ψ (any ψ; the polynomial continues
 * outside its range).
 * @param {PolyPiece} piece
 * @param {number} psi
 * @param {Float64Array} out receives p, p', p''
 * @returns {Float64Array}
 */
export function evaluatePoly(piece, psi, out) {
  const c = piece.coeffs;
  const L = piece.length;
  const u = (psi - piece.start) / L;
  let p = 0;
  let d = 0;
  let s = 0;
  for (let k = c.length - 1; k >= 0; k--) {
    s = s * u + d * 2;
    d = d * u + p;
    p = p * u + c[k];
  }
  out[0] = p;
  out[1] = d / L;
  out[2] = s / (L * L);
  return out;
}

/**
 * Brace blend of the cable track on [ψ_c0, ψ_1]: the quintic with
 * p(ψ_c0) = p_c0 (brace tension), p, p', p'' of the ideal track at ψ_1 and
 * ∫ p dψ over the piece equal to √(D_0² − p_c0²) − √(D_1² − p_1²), which
 * makes the cable closure hold at the nock position of ψ_1. Among these it
 * minimises ∫ (p''')² dψ. Returns null when the system is singular.
 * @param {{ psi0: number, p0: number, psi1: number, p1: number, d1: number, s1: number, integral: number }} c
 *   angles (rad), lever arms (m), slope (m/rad), second derivative (m/rad²), integral (m·rad)
 * @returns {PolyPiece | null}
 */
export function braceBlend({ psi0, p0, psi1, p1, d1, s1, integral }) {
  const L = psi1 - psi0;
  if (!(L > 0)) return null;
  // Unknowns a_0 … a_5 and five multipliers.
  const n = 11;
  const K = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  // ∫_0^1 (p_uuu)² du with p_uuu = 6·a_3 + 24·a_4·u + 60·a_5·u².
  const g = [0, 0, 0, 6, 24, 60];
  const powers = [0, 0, 0, 0, 1, 2];
  for (let i = 3; i < 6; i++) {
    for (let j = 3; j < 6; j++) K[i * n + j] = (2 * g[i] * g[j]) / (powers[i] + powers[j] + 1);
  }
  /** @type {[number[], number][]} */
  const rows = [
    [[1, 0, 0, 0, 0, 0], p0],
    [[1, 1, 1, 1, 1, 1], p1],
    [[0, 1, 2, 3, 4, 5], L * d1],
    [[0, 0, 2, 6, 12, 20], L * L * s1],
    [[1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6], integral / L],
  ];
  rows.forEach(([row, value], r) => {
    const i = 6 + r;
    for (let j = 0; j < 6; j++) {
      K[i * n + j] = row[j];
      K[j * n + i] = row[j];
    }
    rhs[i] = value;
  });
  const sol = solveLinear(K, rhs, n);
  if (!sol) return null;
  return { kind: 'poly', start: psi0, length: L, coeffs: sol.slice(0, 6) };
}
