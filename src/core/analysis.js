/**
 * Asymmetric analysis of the twin-cam bow: cam timing, nock travel and the
 * order of the draw stops for a designed cam with cords of changed length.
 * Rigid cords; the design path (core/forward, core/inverse) stays
 * symmetric.
 *
 * Each half keeps its own mirror frame, M = diag(1, −1). The top half is
 * the world frame of core/geometry; the bottom half is its mirror image, so
 * both cams share the track shapes, the limb and the bow geometry. The nock
 * is N = (x, y) in the top frame and (x, −y) in the bottom frame. The top
 * cable ends at A_t = M·O_b(α_b), the bottom cable at A_b = M·O_t(α_t).
 *
 * Coordinates q = (θ_t, α_t, θ_b, α_b). Four closures on the reduced cord
 * lengths of core/contact:
 *
 *   g_s,t(x, y, θ_t, α_t)   = L_s/2 + ΔL_s/2 − h
 *   g_c,t(θ_t, α_t, α_b)    = L_c + ΔL_c,t
 *   g_s,b(x, −y, θ_b, α_b)  = L_s/2 + ΔL_s/2 + h
 *   g_c,b(θ_b, α_b, α_t)    = L_c + ΔL_c,b
 *
 * with h the nocking point above the string centre, along the string.
 * Jacobian at a fixed nock, rows (s,t | c,t | s,b | c,b), columns
 * (θ_t, α_t, θ_b, α_b):
 *
 *   [ −p_s,t  −s_a,t    0       0    ]
 *   [  p_c,t  −c_o,t    0      a_t   ]
 *   [   0       0     −p_s,b  −s_a,b ]
 *   [   0      a_b     p_c,b  −c_o,b ]
 *
 * s_a = u_s·O_α and c_o = u_c·O_α of the own limb, a = u_c·A_α of the
 * anchor on the other limb (a = −c_x; c_o + c_x = c_a in a symmetric pose).
 * Tensions from Jᵀ·T = −∇E, E = E1(α_t) + E1(α_b); draw force
 * F = Σ T_k ∂g_k/∂x and vertical nock force F_y = Σ T_k ∂g_k/∂y.
 *
 * Nock modes: free (F_y = 0 by a secant on y at each x; the result y(x) is
 * the static nock travel) and draw board (y = 0, F_y reported).
 *
 * Draw stops: the peg at C (cam frame) touches the free cable span of its
 * half when gap = p_c(ψ_c) − C·n(ψ_c) − (r_peg + d_c/2) reaches 0 while the
 * foot of C lies on the span (+∞ otherwise). With rigid
 * cords the first stop x₁ is the wall: past it the closures and the stop
 * leave only a rigid rotation of the cords about the nock height, which
 * changes x at second order, so the draw folds within about 1 µm. The grid
 * ends at x₁ and reports both gaps there.
 *
 * Elastic cords (input `stiffness`): each cord part k has the compliance
 * C_k = ℓ_k / EA_k, ℓ the pitch-line length of the design at brace (half
 * the string for each string part). The closures become
 * g_k(q) − C_k·T_k = L0_k with the free lengths L0_k = L_k − C_k·T_k,0 from
 * the tensions T_k,0 of the design at brace, so unchanged cords brace at
 * the design brace. The tensions still follow from the equilibrium
 * Jᵀ·T = −∇E − Σ λ_i·∇gap_i. A cam on its stop adds the closure gap_i = 0
 * with the stop force λ_i; the draw then continues past x₁ to the second
 * stop x₂, and the wall stiffness dF/dx with both cams on their stops is
 * reported there. Newton runs on (q, λ) with the Jacobian J_rigid(q) + D:
 * the rigid closure Jacobian, exact at every evaluation, plus a correction
 * D for the stretch and the stops. D comes from forward differences, is
 * carried from pose to pose and follows Broyden updates; it is formed again
 * when an iteration reduces the residual by less than JAC_REFRESH.
 *
 * Lengths in m, angles in rad, forces in N.
 * @module core/analysis
 */

import { CABLE_SIDE, STRING_SIDE, createContact, solveContact, terminationConstant } from './contact.js';
import { runs } from './diagnostics.js';
import { ANGLE_MAX, LENGTH_MAX, inRange } from './domain.js';
import { describeError } from './errors.js';
import { CLOSURE_TOLERANCE, MAX_ITERATIONS, MAX_ITERATION_LIMIT, MAX_SAMPLES, drawGrid } from './forward.js';
import { bowGeometry, createPose, evaluatePose } from './geometry.js';
import { createLimb } from './limb.js';
import { determinant, solveLinear } from './linalg.js';
import { createSupport } from './support.js';

/** Samples from brace to full draw. */
export const ANALYSIS_SAMPLES = 300;
/** Largest |offset| of a cord length or of the nocking point (m). */
export const OFFSET_MAX = 0.1;
/** The stop search runs this fraction of the design draw beyond full draw. */
export const EXTENSION = 0.1;

/** Closure residual at which Newton stops early (m). */
const STOP_TOLERANCE = 1e-15;
/** Largest Newton step in θ and α (rad). */
const MAX_THETA_STEP = 0.5;
const MAX_ALPHA_STEP = 0.1;
/** Largest step of the nock search (m) and of the brace search (m). */
const MAX_Y_STEP = 0.01;
const MAX_X_STEP = 0.02;
/** Largest |F_y| of a free nock and |F| at brace, relative to the largest tension. */
const FORCE_TOLERANCE = 1e-11;
/** Iteration limit of the secants on y and on the brace x. */
const SECANT_ITERATIONS = 40;
/** Nock step of the difference quotient k_y (m); a secant step shorter than KY_MIN_STEP (m) is too short for k_y. */
const KY_STEP = 1e-6;
const KY_MIN_STEP = 1e-10;
/** A stop is located when its gap is below GAP_TOLERANCE (m) or its bracket is shorter than EVENT_WIDTH (m). */
const GAP_TOLERANCE = 1e-12;
const EVENT_WIDTH = 1e-11;
/** The other cam counts as stopped at x₁ when its gap is at most this (m), or its own x₁ lies this close (m). */
const SIMULTANEOUS = 1e-9;
/** A failure counts as a fold when the determinant extrapolates to zero within this many steps. */
const FOLD_STEPS = 3;
/** Length step of the timing sensitivity at the end of the draw (m). */
const SENSITIVITY_STEP = 1e-6;
/** Fewest steps of the stop search beyond full draw. */
const MIN_EXTENSION_STEPS = 10;
/** Iteration limit of the stop search. */
const EVENT_ITERATIONS = 100;
/** Closure residual at which the elastic Newton stops early (m): its Broyden steps converge superlinearly, not quadratically. */
const ELASTIC_TOLERANCE = 1e-14;
/** Step of the forward differences of the elastic Jacobian (rad) and of the stop gap gradient (rad). */
const FD_STEP = 1e-7;
/** The elastic Jacobian is formed again when an iteration reduces the residual by less than this factor. */
const JAC_REFRESH = 0.25;
/** Draw step of the wall stiffness (m). */
const WALL_STEP = 1e-5;
/** The search for the second stop ends when the draw force exceeds this multiple of the peak before the first stop. */
const FORCE_CAP = 5;
/** Range of the axial stiffness EA of a cord (N). */
export const STIFFNESS_MIN = 1e3;
export const STIFFNESS_MAX = 1e18;

/**
 * @typedef {'analysis-invalid-input' | 'analysis-brace' | 'analysis-no-convergence' | 'analysis-slack'
 *   | 'analysis-fold' | 'analysis-wrap' | 'analysis-unstable' | 'analysis-no-stop'
 *   | 'analysis-no-second-stop'} AnalysisCode
 */

/** Every analysis code with its message (the table of docs/model.md). */
export const ANALYSIS_CODES = /** @type {Record<AnalysisCode, string>} */ ({
  'analysis-invalid-input': 'The analysis input is not valid',
  'analysis-brace': 'The brace of the changed bow cannot be solved',
  'analysis-no-convergence': 'The closures of the changed bow did not converge',
  'analysis-slack': 'A cord goes slack: its tension is zero or negative',
  'analysis-fold': 'The pose folds: the closure Jacobian reaches zero, so the draw passes a turning point',
  'analysis-wrap': 'A cord runs off its track: a contact leaves the wrapped or defined part of the track',
  'analysis-unstable': 'The free nock is unstable: k_y = dF_y/dy is zero or negative',
  'analysis-no-stop': 'No cam reaches its draw stop within the search range beyond full draw',
  'analysis-no-second-stop': 'The second cam does not reach its draw stop',
});

/**
 * Cord length changes of the analysis. Positive values lengthen the cord or
 * raise the nocking point.
 * @typedef {object} TimingOffsets
 * @property {number} [topCable] ΔL_c,t (m)
 * @property {number} [bottomCable] ΔL_c,b (m)
 * @property {number} [string] ΔL_s of the whole string (m)
 * @property {number} [nockHeight] h, nocking point above the string centre, along the string (m)
 */

/**
 * @typedef {object} AnalysisInput
 * @property {import('../state/schema.js').Geometry} geometry
 * @property {import('./support.js').SupportData} stringTrack pitch line
 * @property {import('./support.js').SupportData} cableTrack pitch line
 * @property {import('./limb.js').LimbData} limb
 * @property {number} stringTermination ψ_e,s (rad)
 * @property {number} cableTermination ψ_e,c (rad)
 * @property {{ x: number, y: number, radius: number } | null} [stop] cable
 *   stop peg, cam frame (m); null or missing: no stops, the grid ends at
 *   full draw
 * @property {number} [cableDiameter] d_c (m), required with a stop
 * @property {TimingOffsets} [offsets] default all 0
 * @property {{ string: number, topCable: number, bottomCable: number } | null} [stiffness]
 *   axial stiffness EA of each cord (N), from STIFFNESS_MIN to
 *   STIFFNESS_MAX; null or missing: rigid cords
 * @property {'free' | 'board'} [nock] default 'free'
 * @property {number} [samples] from brace to full draw, default {@link ANALYSIS_SAMPLES}
 * @property {number} [maxIterations] Newton iteration limit per closure, default 30
 * @property {boolean} [rates] default true; false leaves dThetaDL and
 *   sensitivity at NaN, for a run that needs only the draw
 */

/**
 * @typedef {object} AnalysisDiagnostic
 * @property {AnalysisCode} code
 * @property {[number, number] | null} xRange first and last affected nock position (m)
 * @property {string} message
 */

/**
 * Samples are Float64Arrays of length n.
 * @typedef {object} AnalysisResult
 * @property {'ok' | 'infeasible' | 'no-convergence'} status
 * @property {AnalysisDiagnostic[]} diagnostics
 * @property {'free' | 'board'} nock
 * @property {number} n
 * @property {Float64Array} x nock position (m)
 * @property {Float64Array} y nock height (m)
 * @property {Float64Array} thetaTop θ_t (rad)
 * @property {Float64Array} thetaBottom θ_b (rad)
 * @property {Float64Array} dTheta Δθ = θ_t − θ_b (rad)
 * @property {Float64Array} alphaTop α_t (rad)
 * @property {Float64Array} alphaBottom α_b (rad)
 * @property {Float64Array} F draw force (N)
 * @property {Float64Array} Fy vertical nock force (N); 0 with a free nock
 * @property {Float64Array} stringTop tension of the top string part (N)
 * @property {Float64Array} stringBottom (N)
 * @property {Float64Array} cableTop (N)
 * @property {Float64Array} cableBottom (N)
 * @property {Float64Array} gapTop stop gap of the top cam (m); NaN without a stop
 * @property {Float64Array} gapBottom (m)
 * @property {Float64Array} psiStringTop string contact angle of the top cam, cam frame (rad)
 * @property {Float64Array} psiStringBottom (rad)
 * @property {Float64Array} psiCableTop cable contact angle of the top cam, cam frame (rad)
 * @property {Float64Array} psiCableBottom (rad)
 * @property {Float64Array} ky dF_y/dy (N/m); NaN with a draw board
 * @property {Float64Array} dThetaDL dΔθ/dL_c,t at a fixed nock (rad/m)
 * @property {{ x: number, y: number, thetaTop: number, thetaBottom: number, alphaTop: number,
 *   alphaBottom: number, Fy: number } | null} brace
 * @property {{ first: 'top' | 'bottom' | 'both' | null, x: number, gapTop: number, gapBottom: number,
 *   second: 'top' | 'bottom' | 'both' | null, x2: number, wallStiffness: number }} stops
 *   first stop and its nock position x₁; both gaps there (m); first null
 *   and x NaN when no stop is reached. Elastic cords only: the cam that
 *   reaches its stop second ('both' when both stop at x₁), its nock
 *   position x₂, the last sample, and the wall stiffness dF/dx there with
 *   both cams on their stops (N/m); null and NaN otherwise
 * @property {boolean} elastic the cords stretch
 * @property {number} fullDraw design full draw x_f (m)
 * @property {number} end index of the last sample of the draw: the first
 *   stop, or without a stop the last sample at or before full draw (the
 *   samples of the stop search beyond it are not part of the draw); -1
 *   without samples
 * @property {number} sensitivity dΔθ/dL_c,t at the first stop, or at the end
 *   of the draw without a stop, in the nock mode of the analysis (rad/m):
 *   with a free nock the nock height follows the length change; central
 *   difference over ±1 µm, no cam held by its stop
 * @property {number} iterations Newton iterations over all closures
 */

/**
 * State of one half at a pose, in its own frame.
 * @typedef {object} Half
 * @property {import('./contact.js').Contact} string
 * @property {import('./contact.js').Contact} cable
 * @property {number} theta angle of the last evaluation (rad)
 * @property {number} usx unit vector from string contact to nock, own frame
 * @property {number} usy
 * @property {number} sa u_s·O_α (m)
 * @property {number} co u_c·O_α (m)
 * @property {number} ao u_c·A_α, A_α of the other limb (m)
 */

/** @returns {Half} */
function createHalf() {
  return { string: createContact(), cable: createContact(), theta: NaN, usx: NaN, usy: NaN, sa: NaN, co: NaN, ao: NaN };
}

/**
 * @typedef {object} Context
 * @property {boolean} elastic the cords stretch
 * @property {Float64Array} compliance C_k of (s,t | c,t | s,b | c,b) (m/N); zeros for rigid cords
 * @property {import('./geometry.js').BowGeometry} bow
 * @property {import('./support.js').Support} stringSupport
 * @property {import('./support.js').Support} cableSupport
 * @property {import('./limb.js').Limb} limb
 * @property {number[]} lengths targets of the reduced lengths (s,t | c,t | s,b | c,b) (m); with
 *   elastic cords the free lengths L0
 * @property {{ x: number, y: number, k: number } | null} stop peg centre and r_peg + d_c/2 (m)
 * @property {boolean} free free nock
 * @property {number} maxIterations
 * @property {number} iterations
 */

/**
 * @typedef {object} Pose
 * @property {Float64Array} q (θ_t, α_t, θ_b, α_b)
 * @property {number} y
 * @property {Half} top
 * @property {Half} bottom
 * @property {number} ky dF_y/dy of the last nock search (N/m), NaN when unknown
 * @property {Float64Array | null} T tensions of the last elastic evaluation (N)
 * @property {Float64Array} lambda stop forces of the top and bottom cam (N)
 * @property {Uint8Array} active 1 for a cam on its stop (top, bottom)
 * @property {{ size: number, m: Float64Array } | null} jac correction D of the elastic Jacobian to reuse
 */

/** @returns {Pose} */
function createAnalysisPose() {
  return {
    q: new Float64Array(4), y: 0, top: createHalf(), bottom: createHalf(), ky: NaN,
    T: null, lambda: new Float64Array(2), active: new Uint8Array(2), jac: null,
  };
}

/**
 * Evaluate one half at (x, y_h, θ, α, α_other) in its own frame. The
 * contact warm starts come from the previous state, shifted by the change
 * of θ. Returns false when a contact fails.
 * @param {Pick<Context, 'bow' | 'stringSupport' | 'cableSupport'>} ctx
 * @param {number} x
 * @param {number} yh nock height in this frame (m)
 * @param {number} theta
 * @param {number} alpha
 * @param {number} alphaOther
 * @param {Half} h
 * @returns {boolean}
 */
export function evaluateHalf(ctx, x, yh, theta, alpha, alphaOther, h) {
  const { bow } = ctx;
  const r = bow.limbLength;
  const beta = bow.betaBrace - alpha;
  const ox = bow.pivotX + r * Math.cos(beta);
  const oy = bow.pivotY + r * Math.sin(beta);
  const odx = r * Math.sin(beta);
  const ody = -r * Math.cos(beta);
  const betaOther = bow.betaBrace - alphaOther;
  const oox = bow.pivotX + r * Math.cos(betaOther);
  const ooy = bow.pivotY + r * Math.sin(betaOther);
  // A = M·O_other, so A_α = (O_other,α,x, −O_other,α,y).
  const adx = r * Math.sin(betaOther);
  const ady = r * Math.cos(betaOther);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const shift = Number.isFinite(h.theta) ? theta - h.theta : theta;
  const psiS = Number.isFinite(h.string.psi) ? h.string.psi + shift : theta;
  const psiC = Number.isFinite(h.cable.psi) ? h.cable.psi + shift : Math.PI + theta;
  const bx = x - ox;
  const by = yh - oy;
  solveContact(ctx.stringSupport, c * bx - s * by, s * bx + c * by, STRING_SIDE, psiS, h.string);
  const ax = oox - ox;
  const ay = -ooy - oy;
  solveContact(ctx.cableSupport, c * ax - s * ay, s * ax + c * ay, CABLE_SIDE, psiC, h.cable);
  h.theta = theta;
  const us = h.string;
  const uc = h.cable;
  h.usx = c * us.ux + s * us.uy;
  h.usy = -s * us.ux + c * us.uy;
  const ucx = c * uc.ux + s * uc.uy;
  const ucy = -s * uc.ux + c * uc.uy;
  h.sa = h.usx * odx + h.usy * ody;
  h.co = ucx * odx + ucy * ody;
  h.ao = ucx * adx + ucy * ady;
  return us.status === 'ok' && uc.status === 'ok';
}

/**
 * Stop gap of a half: distance of the peg centre from the free cable span on
 * the cam side, minus r_peg + d_c/2 (m). A peg whose foot on the cable line
 * lies outside the free span, from the contact to the anchor, does not face
 * the span and cannot touch it: +Infinity.
 * @param {{ x: number, y: number, k: number }} stop
 * @param {Half} h
 * @returns {number}
 */
export function stopGap(stop, h) {
  const { psi, p, dp, ux, uy, span } = h.cable;
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  // Contact point X = p·n + p'·t, t = (−sin ψ, cos ψ).
  const along = (stop.x - (p * c - dp * s)) * ux + (stop.y - (p * s + dp * c)) * uy;
  if (!(along >= 0 && along <= span)) return Infinity;
  return p - (stop.x * c + stop.y * s) - stop.k;
}

/**
 * Both halves at (x, y, q).
 * @param {Context} ctx
 * @param {number} x
 * @param {Pose} pose
 */
function evaluateBoth(ctx, x, pose) {
  const { q } = pose;
  const a = evaluateHalf(ctx, x, pose.y, q[0], q[1], q[3], pose.top);
  const b = evaluateHalf(ctx, x, -pose.y, q[2], q[3], q[1], pose.bottom);
  return a && b;
}

/**
 * Closure Jacobian at a fixed nock, row-major 4×4.
 * @param {Half} t
 * @param {Half} b
 * @returns {Float64Array}
 */
function jacobian(t, b) {
  return Float64Array.of(
    -t.string.p, -t.sa, 0, 0,
    t.cable.p, -t.co, 0, t.ao,
    0, 0, -b.string.p, -b.sa,
    0, b.ao, b.cable.p, -b.co,
  );
}

/**
 * Newton on the closures at fixed (x, y). q is updated in place; on
 * success the halves hold the converged pose.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @returns {string} empty on success, else the reason
 */
function close(ctx, pose, x) {
  if (ctx.elastic) return closeElastic(ctx, pose, x);
  const { q, top, bottom } = pose;
  const L = ctx.lengths;
  const qEval = new Float64Array(4);
  let residual = Infinity;
  let previous = Infinity;
  for (let it = 0; it < ctx.maxIterations; it++) {
    ctx.iterations++;
    qEval.set(q);
    if (!evaluateBoth(ctx, x, pose)) return 'a cord has no tangent from its track';
    const r = [top.string.reduced - L[0], top.cable.reduced - L[1], bottom.string.reduced - L[2], bottom.cable.reduced - L[3]];
    residual = Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2]), Math.abs(r[3]));
    if (residual <= STOP_TOLERANCE || (it > 0 && residual >= 0.5 * previous && residual <= CLOSURE_TOLERANCE)) return '';
    previous = residual;
    const step = solveLinear(jacobian(top, bottom), r, 4);
    if (!step) return 'the closure Jacobian is singular';
    const scale = Math.min(
      1,
      MAX_THETA_STEP / Math.abs(step[0]), MAX_ALPHA_STEP / Math.abs(step[1]),
      MAX_THETA_STEP / Math.abs(step[2]), MAX_ALPHA_STEP / Math.abs(step[3]),
    );
    for (let i = 0; i < 4; i++) q[i] -= scale * step[i];
  }
  // Iteration limit with an accepted residual: keep the evaluated pose,
  // not the last Newton update.
  if (residual <= CLOSURE_TOLERANCE) {
    q.set(qEval);
    return '';
  }
  return `the residual stayed at ${residual.toExponential(2)} m after ${ctx.maxIterations} iterations`;
}

/**
 * Gradient of the stop gap of one cam over q, by central differences (m/rad).
 * @param {Context} ctx
 * @param {Pose} pose evaluated pose
 * @param {0 | 1} which 0 top, 1 bottom
 * @returns {Float64Array | null}
 */
function gapGradient(ctx, pose, which) {
  const stop = /** @type {NonNullable<Context['stop']>} */ (ctx.stop);
  const h = which === 0 ? pose.top : pose.bottom;
  const [it, ia, io] = which === 0 ? [0, 1, 3] : [2, 3, 1];
  const q = pose.q;
  const g = new Float64Array(4);
  const bow = ctx.bow;
  const r = bow.limbLength;
  const cable = { ...h, cable: createContact() };
  for (const j of [it, ia, io]) {
    /** @param {number} d */
    const at = (d) => {
      const v = Float64Array.from(q);
      v[j] += d;
      // The cable contact alone, as in evaluateHalf.
      const theta = v[it];
      const beta = bow.betaBrace - v[ia];
      const betaOther = bow.betaBrace - v[io];
      const ox = bow.pivotX + r * Math.cos(beta);
      const oy = bow.pivotY + r * Math.sin(beta);
      const ax = bow.pivotX + r * Math.cos(betaOther) - ox;
      const ay = -(bow.pivotY + r * Math.sin(betaOther)) - oy;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      solveContact(ctx.cableSupport, c * ax - s * ay, s * ax + c * ay, CABLE_SIDE, h.cable.psi + theta - h.theta, cable.cable);
      return cable.cable.status === 'ok' ? stopGap(stop, cable) : NaN;
    };
    g[j] = (at(FD_STEP) - at(-FD_STEP)) / (2 * FD_STEP);
    if (!Number.isFinite(g[j])) return null;
  }
  return g;
}

/**
 * Residual of the elastic closures and of the active stops at (x, y, q, λ);
 * leaves the tensions in pose.T. False when a contact fails, the
 * equilibrium is singular or a stop gap cannot be measured.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @param {Float64Array} r length 4 plus the number of active stops
 */
function elasticResidual(ctx, pose, x, r) {
  if (!evaluateBoth(ctx, x, pose)) return false;
  const { top: t, bottom: b, q, lambda, active } = pose;
  const J = jacobian(t, b);
  const JT = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) JT[j * 4 + i] = J[i * 4 + j];
  const rhs = [0, -ctx.limb.moment(q[1]), 0, -ctx.limb.moment(q[3])];
  let k = 4;
  for (const which of /** @type {const} */ ([0, 1])) {
    if (!active[which]) continue;
    const g = gapGradient(ctx, pose, which);
    const gap = stopGap(/** @type {NonNullable<Context['stop']>} */ (ctx.stop), which === 0 ? t : b);
    if (!g || !Number.isFinite(gap)) return false;
    for (let j = 0; j < 4; j++) rhs[j] -= lambda[which] * g[j];
    r[k++] = gap;
  }
  const T = solveLinear(JT, rhs, 4);
  if (!T) return false;
  pose.T = T;
  const C = ctx.compliance;
  const L = ctx.lengths;
  r[0] = t.string.reduced - C[0] * T[0] - L[0];
  r[1] = t.cable.reduced - C[1] * T[1] - L[1];
  r[2] = b.string.reduced - C[2] * T[2] - L[2];
  r[3] = b.cable.reduced - C[3] * T[3] - L[3];
  return true;
}

/**
 * Newton on the elastic closures and the active stops at fixed (x, y), in
 * the unknowns z = (q, λ of the active stops). q and λ are updated in
 * place; on success the halves and pose.T hold the converged pose.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @returns {string} empty on success, else the reason
 */
function closeElastic(ctx, pose, x) {
  const { q, lambda, active } = pose;
  /** @type {(0 | 1)[]} */
  const stops = [];
  if (active[0]) stops.push(0);
  if (active[1]) stops.push(1);
  const size = 4 + stops.length;
  const z = new Float64Array(size);
  z.set(q);
  stops.forEach((w, j) => { z[4 + j] = lambda[w]; });
  /** @param {Float64Array} v */
  const setZ = (v) => {
    for (let i = 0; i < 4; i++) q[i] = v[i];
    stops.forEach((w, j) => { lambda[w] = v[4 + j]; });
  };
  let D = pose.jac && pose.jac.size === size ? pose.jac.m : null;
  let fresh = false;
  // The correction may be shared with other poses: copy it before an update.
  let own = false;
  const jac = new Float64Array(size * size);
  /** Jacobian of the evaluated pose: J_rigid in the top left block plus D. */
  const assemble = () => {
    const J = jacobian(pose.top, pose.bottom);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) jac[i * size + j] = (i < 4 && j < 4 ? J[i * 4 + j] : 0) + /** @type {Float64Array} */ (D)[i * size + j];
    }
  };
  const r = new Float64Array(size);
  const rPrev = new Float64Array(size);
  const dz = new Float64Array(size);
  let updatable = false;
  const zEval = new Float64Array(size);
  let residual = Infinity;
  let previous = Infinity;
  for (let it = 0; it < ctx.maxIterations; it++) {
    ctx.iterations++;
    setZ(z);
    zEval.set(z);
    if (!elasticResidual(ctx, pose, x, r)) return 'a cord has no tangent from its track';
    residual = 0;
    for (let i = 0; i < size; i++) residual = Math.max(residual, Math.abs(r[i]));
    if (residual <= ELASTIC_TOLERANCE || (it > 0 && residual >= 0.5 * previous && residual <= CLOSURE_TOLERANCE)) {
      pose.jac = D ? { size, m: D } : null;
      return '';
    }
    if (!D || (it > 0 && residual > JAC_REFRESH * previous && !fresh)) {
      const J = jacobian(pose.top, pose.bottom);
      const full = elasticJacobian(ctx, pose, x, z, r, setZ);
      if (!full) return 'the closures cannot be differentiated here';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) full[i * size + j] -= J[i * 4 + j];
      D = full;
      fresh = true;
      own = true;
      // The differences leave the halves perturbed: evaluate z again.
      if (!elasticResidual(ctx, pose, x, r)) return 'a cord has no tangent from its track';
      assemble();
    } else {
      fresh = false;
      assemble();
      if (updatable) {
        // Broyden on D: J_new·Δz = Δr with J_new = J_rigid + D_new.
        if (!own) {
          D = Float64Array.from(D);
          own = true;
        }
        let dd = 0;
        for (let i = 0; i < size; i++) dd += dz[i] * dz[i];
        if (dd > 0) {
          for (let i = 0; i < size; i++) {
            let jdz = 0;
            for (let j = 0; j < size; j++) jdz += jac[i * size + j] * dz[j];
            const u = (r[i] - rPrev[i] - jdz) / dd;
            for (let j = 0; j < size; j++) {
              D[i * size + j] += u * dz[j];
              jac[i * size + j] += u * dz[j];
            }
          }
        }
      }
    }
    previous = residual;
    const step = solveLinear(jac, Array.from(r), size);
    if (!step) return 'the closure Jacobian is singular';
    const scale = Math.min(
      1,
      MAX_THETA_STEP / Math.abs(step[0]), MAX_ALPHA_STEP / Math.abs(step[1]),
      MAX_THETA_STEP / Math.abs(step[2]), MAX_ALPHA_STEP / Math.abs(step[3]),
    );
    for (let i = 0; i < size; i++) {
      dz[i] = -scale * step[i];
      z[i] += dz[i];
    }
    rPrev.set(r);
    updatable = true;
  }
  // Iteration limit with an accepted residual: restore the evaluated pose.
  if (residual <= CLOSURE_TOLERANCE) {
    setZ(zEval);
    if (!elasticResidual(ctx, pose, x, r)) return 'a cord has no tangent from its track';
    pose.jac = D ? { size, m: D } : null;
    return '';
  }
  return `the residual stayed at ${residual.toExponential(2)} m after ${ctx.maxIterations} iterations`;
}

/**
 * Jacobian of the elastic residual over z by forward differences,
 * row-major. Leaves the pose at a perturbed point; the caller evaluates it
 * again.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @param {Float64Array} z
 * @param {Float64Array} r residual at z
 * @param {(v: Float64Array) => void} setZ
 * @returns {Float64Array | null}
 */
function elasticJacobian(ctx, pose, x, z, r, setZ) {
  const size = z.length;
  const m = new Float64Array(size * size);
  const rp = new Float64Array(size);
  for (let c = 0; c < size; c++) {
    const v = Float64Array.from(z);
    // λ enters linearly; a step of 1 N keeps its column exact.
    const h = c < 4 ? FD_STEP : 1;
    v[c] += h;
    setZ(v);
    if (!elasticResidual(ctx, pose, x, rp)) return null;
    for (let i = 0; i < size; i++) m[i * size + c] = (rp[i] - r[i]) / h;
  }
  setZ(z);
  return m;
}

/**
 * @param {Pose} p
 * @returns {Pose}
 */
function copyPose(p) {
  const half = (/** @type {Half} */ h) => ({ ...h, string: { ...h.string }, cable: { ...h.cable } });
  return {
    q: Float64Array.from(p.q), y: p.y, top: half(p.top), bottom: half(p.bottom), ky: p.ky,
    T: p.T ? Float64Array.from(p.T) : null, lambda: Float64Array.from(p.lambda), active: Uint8Array.from(p.active), jac: p.jac,
  };
}

/**
 * Tensions, draw force and vertical nock force of a converged pose.
 * @param {Context} ctx
 * @param {Pose} pose
 * @returns {{ T: Float64Array, F: number, Fy: number, scale: number } | null}
 *   scale: largest |tension|, at least 1 N
 */
function statics(ctx, pose) {
  const { top: t, bottom: b, q } = pose;
  /** @type {Float64Array | null} */
  let T;
  if (ctx.elastic) {
    // Tensions of the converged elastic pose, stop forces included.
    T = pose.T;
  } else {
    const J = jacobian(t, b);
    const JT = new Float64Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) JT[c * 4 + r] = J[r * 4 + c];
    T = solveLinear(JT, [0, -ctx.limb.moment(q[1]), 0, -ctx.limb.moment(q[3])], 4);
  }
  if (!T) return null;
  return {
    T,
    F: T[0] * t.usx + T[2] * b.usx,
    Fy: T[0] * t.usy - T[2] * b.usy,
    scale: Math.max(1, Math.abs(T[0]), Math.abs(T[1]), Math.abs(T[2]), Math.abs(T[3])),
  };
}

/**
 * Close at (x, y) and return the statics, or null on failure.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @param {number} y
 */
function forceAt(ctx, pose, x, y) {
  pose.y = y;
  return close(ctx, pose, x) ? null : statics(ctx, pose);
}

/**
 * Pose at nock position x: free nock by a secant on y from pose.y, which
 * also leaves k_y in pose.ky; draw board at y = 0.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x
 * @returns {string} empty on success, else the reason
 */
function solveAt(ctx, pose, x) {
  if (!ctx.free) {
    pose.y = 0;
    return close(ctx, pose, x);
  }
  let y0 = pose.y;
  const s0 = forceAt(ctx, pose, x, y0);
  if (!s0) return 'the closures did not converge at the start of the nock search';
  let f0 = s0.Fy;
  let k = pose.ky;
  if (Math.abs(f0) <= FORCE_TOLERANCE * s0.scale || !(Number.isFinite(k) && k !== 0)) {
    // k_y from a probe beside the pose.
    const probe = forceAt(ctx, copyPose(pose), x, y0 + KY_STEP);
    if (!probe) return 'the closures did not converge near the nock';
    k = (probe.Fy - f0) / KY_STEP;
    pose.ky = k;
    if (Math.abs(f0) <= FORCE_TOLERANCE * s0.scale) return '';
    if (!(Number.isFinite(k) && k !== 0)) return 'F_y does not change with the nock height';
  }
  for (let it = 0; it < SECANT_ITERATIONS; it++) {
    const dy = Math.max(-MAX_Y_STEP, Math.min(MAX_Y_STEP, -f0 / k));
    if (!Number.isFinite(dy)) return 'the nock search stalled';
    const y1 = y0 + dy;
    const s1 = forceAt(ctx, pose, x, y1);
    if (!s1) return 'the closures did not converge during the nock search';
    const kNew = (s1.Fy - f0) / dy;
    if (Math.abs(dy) >= KY_MIN_STEP && Number.isFinite(kNew) && kNew !== 0) k = kNew;
    pose.ky = k;
    if (Math.abs(s1.Fy) <= FORCE_TOLERANCE * s1.scale) return '';
    y0 = y1;
    f0 = s1.Fy;
  }
  return 'the vertical nock force did not reach zero';
}

/**
 * Validated offsets.
 * @param {unknown} offsets
 * @returns {Required<TimingOffsets> | string}
 */
function readOffsets(offsets) {
  if (offsets === undefined || offsets === null) return { topCable: 0, bottomCable: 0, string: 0, nockHeight: 0 };
  if (typeof offsets !== 'object') return 'the offsets must be an object';
  const o = /** @type {TimingOffsets} */ (offsets);
  /** @type {Required<TimingOffsets>} */
  const out = { topCable: 0, bottomCable: 0, string: 0, nockHeight: 0 };
  for (const key of /** @type {const} */ (['topCable', 'bottomCable', 'string', 'nockHeight'])) {
    const v = o[key] ?? 0;
    if (!inRange(v, -OFFSET_MAX, OFFSET_MAX)) return `the offset ${key} must be a finite length of at most ${OFFSET_MAX} m`;
    out[key] = v;
  }
  return out;
}

/**
 * @param {AnalysisCode} code
 * @param {string} detail
 * @param {number} [iterations]
 * @returns {AnalysisResult}
 */
function failed(code, detail, iterations = 0) {
  const e = () => new Float64Array(0);
  return {
    status: code === 'analysis-no-convergence' ? 'no-convergence' : 'infeasible',
    diagnostics: [{ code, xRange: null, message: `${ANALYSIS_CODES[code]}: ${detail}` }],
    nock: 'free',
    n: 0,
    x: e(), y: e(), thetaTop: e(), thetaBottom: e(), dTheta: e(), alphaTop: e(), alphaBottom: e(), F: e(), Fy: e(),
    stringTop: e(), stringBottom: e(), cableTop: e(), cableBottom: e(), gapTop: e(), gapBottom: e(),
    psiStringTop: e(), psiStringBottom: e(), psiCableTop: e(), psiCableBottom: e(), ky: e(), dThetaDL: e(),
    brace: null,
    stops: { first: null, x: NaN, gapTop: NaN, gapBottom: NaN, second: null, x2: NaN, wallStiffness: NaN },
    elastic: false,
    fullDraw: NaN,
    end: -1,
    sensitivity: NaN,
    iterations,
  };
}

/**
 * Run the analysis. Never throws; problems come back as diagnostics.
 * @param {AnalysisInput} input
 * @returns {AnalysisResult}
 */
export function analyseTiming(input) {
  try {
    return analyseChecked(input);
  } catch (err) {
    return failed('analysis-invalid-input', describeError(err));
  }
}

/**
 * Body of {@link analyseTiming}, which guards it.
 * @param {AnalysisInput} input
 * @returns {AnalysisResult}
 */
function analyseChecked(input) {
  if (typeof input !== 'object' || input === null) return failed('analysis-invalid-input', 'the input is not an object');
  let stringSupport;
  let cableSupport;
  let limb;
  try {
    stringSupport = createSupport(input.stringTrack);
    cableSupport = createSupport(input.cableTrack);
    limb = createLimb(input.limb);
  } catch (err) {
    return failed('analysis-invalid-input', describeError(err));
  }
  const { bow, error } = bowGeometry(input.geometry, stringSupport);
  if (!bow) return failed('analysis-invalid-input', /** @type {string} */ (error));
  for (const key of /** @type {const} */ (['stringTermination', 'cableTermination'])) {
    if (!inRange(input[key], -ANGLE_MAX, ANGLE_MAX)) {
      return failed('analysis-invalid-input', `${key} must be a finite angle of at most ${ANGLE_MAX} rad`);
    }
  }
  const offsets = readOffsets(input.offsets);
  if (typeof offsets === 'string') return failed('analysis-invalid-input', offsets);
  const nock = input.nock ?? 'free';
  if (nock !== 'free' && nock !== 'board') return failed('analysis-invalid-input', 'the nock mode must be "free" or "board"');
  const samples = input.samples ?? ANALYSIS_SAMPLES;
  if (!Number.isInteger(samples) || samples < 2 || samples > MAX_SAMPLES) {
    return failed('analysis-invalid-input', `the sample count must be an integer from 2 to ${MAX_SAMPLES}`);
  }
  if (input.rates !== undefined && typeof input.rates !== 'boolean') return failed('analysis-invalid-input', 'rates must be true or false');
  const maxIterations = input.maxIterations ?? MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATION_LIMIT) {
    return failed('analysis-invalid-input', `the iteration limit must be an integer from 1 to ${MAX_ITERATION_LIMIT}`);
  }
  /** @type {Context['stop']} */
  let stop = null;
  if (input.stop !== undefined && input.stop !== null) {
    if (typeof input.stop !== 'object') return failed('analysis-invalid-input', 'the stop peg must be an object or null');
    const { x, y, radius } = input.stop;
    const d = input.cableDiameter;
    const lengthsOk = [x, y].every((v) => inRange(v, -LENGTH_MAX, LENGTH_MAX)) && inRange(radius, 0, LENGTH_MAX) && inRange(d, 0, LENGTH_MAX);
    if (!lengthsOk) return failed('analysis-invalid-input', 'the stop peg needs a finite centre, radius and cable diameter');
    stop = { x, y, k: radius + /** @type {number} */ (d) / 2 };
  }
  /** @type {[number, number, number] | null} */
  let ea = null;
  if (input.stiffness !== undefined && input.stiffness !== null) {
    if (typeof input.stiffness !== 'object') return failed('analysis-invalid-input', 'the stiffness must be an object or null');
    const { string, topCable, bottomCable } = input.stiffness;
    if (![string, topCable, bottomCable].every((v) => inRange(v, STIFFNESS_MIN, STIFFNESS_MAX))) {
      return failed('analysis-invalid-input', `the stiffness EA of each cord must be from ${STIFFNESS_MIN} N to ${STIFFNESS_MAX} N`);
    }
    ea = [string, topCable, bottomCable];
  }

  // Reduced lengths of the design at brace (θ = 0, α = 0).
  const design = createPose();
  if (!evaluatePose(bow, stringSupport, cableSupport, bow.xBrace, 0, 0, design)) {
    return failed('analysis-brace', 'the design has no cord tangents at brace');
  }
  const gs0 = design.string.reduced;
  const gc0 = design.cable.reduced;
  /** @type {Context} */
  const ctx = {
    elastic: false, compliance: new Float64Array(4),
    bow, stringSupport, cableSupport, limb, stop, free: nock === 'free', maxIterations, iterations: 0,
    lengths: [
      gs0 + offsets.string / 2 - offsets.nockHeight,
      gc0 + offsets.topCable,
      gs0 + offsets.string / 2 + offsets.nockHeight,
      gc0 + offsets.bottomCable,
    ],
  };
  // Brace slope of the design, F'(x_b) = 2·T_s0 / l_0: start of the brace search.
  const det0 = design.string.p * design.ca + design.sa * design.cable.p;
  const slope = (2 * limb.moment(0) * design.cable.p) / det0 / design.string.span;

  if (ea) {
    // Compliances from the pitch-line lengths of the design; free lengths
    // from the tensions of the design at brace.
    const designBrace = createAnalysisPose();
    const t0 = evaluateBoth(ctx, bow.xBrace, designBrace) ? statics(ctx, designBrace) : null;
    if (!t0) return failed('analysis-brace', 'the tensions of the design at brace cannot be solved');
    const half = gs0 + terminationConstant(stringSupport, STRING_SIDE, input.stringTermination);
    const cable = gc0 + terminationConstant(cableSupport, CABLE_SIDE, input.cableTermination);
    const C = ctx.compliance;
    C[0] = half / ea[0];
    C[1] = cable / ea[1];
    C[2] = half / ea[0];
    C[3] = cable / ea[2];
    for (let k = 0; k < 4; k++) ctx.lengths[k] -= C[k] * t0.T[k];
    ctx.elastic = true;
  }

  const pose = createAnalysisPose();
  const braced = solveBrace(ctx, pose, bow.xBrace, slope);
  if (typeof braced === 'string') return failed('analysis-brace', braced, ctx.iterations);
  const xBrace = braced;
  if (!(bow.xFull > xBrace)) return failed('analysis-brace', 'the changed bow braces at or behind full draw', ctx.iterations);
  if (stop && (stopGap(stop, pose.top) <= 0 || stopGap(stop, pose.bottom) <= 0)) {
    return failed('analysis-brace', 'a cam rests on its draw stop at brace', ctx.iterations);
  }
  const braceFy = /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, pose)).Fy;
  const brace = {
    x: xBrace, y: pose.y, thetaTop: pose.q[0], thetaBottom: pose.q[2], alphaTop: pose.q[1], alphaBottom: pose.q[3],
    Fy: braceFy,
  };
  const grid = drawGrid(xBrace, bow.xFull, samples);
  // The longest internal step: the largest spacing of the default grid.
  const maxStep = (2 * (bow.xFull - xBrace)) / (ANALYSIS_SAMPLES - 1);
  const march = marchDraw(ctx, pose, grid, bow.xFull + EXTENSION * (bow.xFull - bow.xBrace), maxStep);
  return finish(ctx, march, brace, nock, bow.xFull, input);
}

/**
 * Brace: the nock position where F = 0, by a secant on x from the design
 * brace. On success the pose holds the brace.
 * @param {Context} ctx
 * @param {Pose} pose
 * @param {number} x0 design brace (m)
 * @param {number} slope F'(x_b) of the design (N/m)
 * @returns {number | string} brace position (m), or the reason of a failure
 */
function solveBrace(ctx, pose, x0, slope) {
  /** @param {number} x */
  const force = (x) => {
    const reason = solveAt(ctx, pose, x);
    return reason || /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, pose));
  };
  let xa = x0;
  let a = force(xa);
  let k = slope;
  for (let it = 0; it < SECANT_ITERATIONS; it++) {
    if (typeof a === 'string') return a;
    if (Math.abs(a.F) <= FORCE_TOLERANCE * a.scale) return xa;
    if (!(Number.isFinite(k) && k !== 0)) return 'the draw force does not change with the nock position';
    const xb = xa + Math.max(-MAX_X_STEP, Math.min(MAX_X_STEP, -a.F / k));
    const b = force(xb);
    if (typeof b === 'string') return b;
    const kNew = (b.F - a.F) / (xb - xa);
    if (Number.isFinite(kNew) && kNew !== 0) k = kNew;
    xa = xb;
    a = b;
  }
  return 'the draw force at brace did not reach zero';
}

/**
 * @typedef {object} March
 * @property {{ x: number, pose: Pose }[]} samples
 * @property {string} failure empty on success
 * @property {number} failedAt nock position of the failure (m)
 * @property {boolean} noStop the search beyond full draw found no stop
 * @property {boolean} fold the failure follows a closure determinant that
 *   falls towards zero: the draw reaches a turning point
 * @property {'top' | 'bottom' | 'both' | null} first
 * @property {number} firstIndex sample of the first stop, -1 without one
 * @property {'top' | 'bottom' | 'both' | null} second elastic cords: the cam
 *   that reaches its stop second, 'both' when both stop at x₁
 * @property {boolean} noSecond elastic cords: the first stop is reached,
 *   the second is not
 * @property {boolean} capped the second-stop search ended at FORCE_CAP
 * @property {number} wallStiffness dF/dx with both cams on their stops (N/m)
 * @property {string} wallFailure why the wall stiffness could not be solved, '' otherwise
 */

/**
 * March from brace over the grid, then beyond full draw up to xLimit, until
 * the first stop; with elastic cords on with that cam on its stop until
 * the second stop. Internal steps split every grid interval longer than
 * `maxStep`, so the stop search does not depend on the sample count; only
 * grid points and the stop become samples. Beyond full draw the steps are
 * equal, at least MIN_EXTENSION_STEPS, and no longer than the last grid
 * spacing or `maxStep`.
 * @param {Context} ctx
 * @param {Pose} pose brace pose
 * @param {Float64Array} grid
 * @param {number} xLimit last nock position of the stop search (m)
 * @param {number} maxStep longest internal step (m)
 * @returns {March}
 */
function marchDraw(ctx, pose, grid, xLimit, maxStep) {
  const n = grid.length;
  const { stop } = ctx;
  /** @type {{ x: number, sample: boolean }[]} */
  const points = [];
  for (let i = 1; i < n; i++) {
    const m = Math.ceil((grid[i] - grid[i - 1]) / maxStep);
    for (let j = 1; j < m; j++) points.push({ x: grid[i - 1] + ((grid[i] - grid[i - 1]) * j) / m, sample: false });
    points.push({ x: grid[i], sample: true });
  }
  if (stop) {
    const extension = xLimit - grid[n - 1];
    const step = Math.min(grid[n - 1] - grid[n - 2], maxStep);
    const steps = Math.max(MIN_EXTENSION_STEPS, Math.ceil(extension / step));
    for (let k = 1; k <= steps; k++) points.push({ x: k === steps ? xLimit : grid[n - 1] + (k * extension) / steps, sample: true });
  }
  /** @type {March} */
  const march = {
    samples: [{ x: grid[0], pose: copyPose(pose) }], failure: '', failedAt: NaN, noStop: false, fold: false, first: null,
    firstIndex: -1, second: null, noSecond: false, capped: false, wallStiffness: NaN, wallFailure: '',
  };
  // Draw force limit of the second-stop search (N), from the peak over every
  // solved pose before the first stop, sampled or not.
  let cap = Infinity;
  let peak = ctx.elastic ? /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, pose)).F : 0;
  // The last two solved poses, sampled or not.
  let last = march.samples[0];
  /** @type {{ x: number, pose: Pose } | null} */
  let before = null;
  for (let k = 0; k < points.length; k++) {
    const { x, sample } = points[k];
    if (x <= last.x) continue;
    const trial = copyPose(last.pose);
    // Linear prediction from the last two poses.
    if (before) {
      const f = (x - last.x) / (last.x - before.x);
      for (let j = 0; j < 4; j++) trial.q[j] += f * (trial.q[j] - before.pose.q[j]);
      trial.y += f * (trial.y - before.pose.y);
    }
    const reason = solveAt(ctx, trial, x);
    if (reason) {
      march.failure = reason;
      march.failedAt = x;
      march.fold = before !== null && foldAhead(before, last, x);
      return march;
    }
    // A gap within GAP_TOLERANCE of zero is contact; a cam on its stop keeps it.
    const hitTop = stop !== null && !trial.active[0] && stopGap(stop, trial.top) <= GAP_TOLERANCE;
    const hitBottom = stop !== null && !trial.active[1] && stopGap(stop, trial.bottom) <= GAP_TOLERANCE;
    if (!hitTop && !hitBottom) {
      if (ctx.elastic && march.first === null) peak = Math.max(peak, /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, trial)).F);
      if (sample) march.samples.push({ x, pose: trial });
      before = last;
      last = { x, pose: trial };
      if (march.first !== null && /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, trial)).F > cap) {
        if (!sample) march.samples.push({ x, pose: trial });
        march.noSecond = true;
        march.capped = true;
        return march;
      }
      continue;
    }
    // A stop closes between last.x and x: locate each closing gap.
    /** @type {{ which: 'top' | 'bottom', x: number, pose: Pose }[]} */
    const events = [];
    for (const which of /** @type {const} */ (['top', 'bottom'])) {
      if (which === 'top' ? !hitTop : !hitBottom) continue;
      const ev = locateStop(ctx, last, x, which);
      if (typeof ev === 'string') {
        march.failure = ev;
        march.failedAt = x;
        return march;
      }
      events.push({ which, ...ev });
    }
    events.sort((a, b) => a.x - b.x);
    const e = events[0];
    const other = e.which === 'top' ? e.pose.bottom : e.pose.top;
    const second = march.first !== null;
    const both = !second && ((events.length === 2 && events[1].x - e.x <= SIMULTANEOUS) ||
      stopGap(/** @type {NonNullable<Context['stop']>} */ (stop), other) <= SIMULTANEOUS);
    // A stop on the last sample replaces it.
    const lastSample = march.samples[march.samples.length - 1];
    if (e.x - lastSample.x <= SIMULTANEOUS && march.samples.length > 1 && march.samples.length - 1 !== march.firstIndex) {
      march.samples.pop();
    }
    march.samples.push({ x: e.x, pose: e.pose });
    if (second) {
      march.second = e.which;
      setWall(march, wallStiffness(ctx, march.samples[march.samples.length - 1]));
      return march;
    }
    march.first = both ? 'both' : e.which;
    march.firstIndex = march.samples.length - 1;
    if (!ctx.elastic) return march;
    if (both) {
      march.second = 'both';
      setWall(march, wallStiffness(ctx, march.samples[march.samples.length - 1]));
      return march;
    }
    // Elastic cords: on with the stopped cam held by its stop.
    peak = Math.max(peak, /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, e.pose)).F);
    cap = FORCE_CAP * peak;
    const held = copyPose(e.pose);
    held.active[e.which === 'top' ? 0 : 1] = 1;
    held.jac = null;
    last = { x: e.x, pose: held };
    before = null;
    // The point past the stop again, now with the cam held.
    k--;
  }
  if (march.first === null) march.noStop = Boolean(stop);
  else if (ctx.elastic) march.noSecond = true;
  return march;
}

/**
 * @param {March} march
 * @param {number | string} wall the wall stiffness (N/m) or why it failed
 */
function setWall(march, wall) {
  if (typeof wall === 'string') march.wallFailure = wall;
  else march.wallStiffness = wall;
}

/**
 * Wall stiffness at the second stop: dF/dx with both cams on their stops,
 * by a forward difference over WALL_STEP (N/m); the reason when a solve
 * fails.
 * @param {Context} ctx
 * @param {{ x: number, pose: Pose }} sample
 * @returns {number | string}
 */
function wallStiffness(ctx, sample) {
  const p = copyPose(sample.pose);
  p.active[0] = 1;
  p.active[1] = 1;
  p.jac = null;
  const r0 = solveAt(ctx, p, sample.x);
  if (r0) return r0;
  const f0 = /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, p)).F;
  const r1 = solveAt(ctx, p, sample.x + WALL_STEP);
  if (r1) return r1;
  const f1 = /** @type {NonNullable<ReturnType<typeof statics>>} */ (statics(ctx, p)).F;
  return (f1 - f0) / WALL_STEP;
}

/**
 * dΔθ/dL_c,t of an elastic pose at a fixed nock: the Jacobian of the
 * elastic residual over (q, λ) by forward differences, the stops of the
 * pose held, solved for a unit change of the top cable length (rad/m).
 * NaN when the residual cannot be evaluated.
 * @param {Context} ctx
 * @param {{ x: number, pose: Pose }} sample
 */
function elasticTimingRate(ctx, sample) {
  const p = copyPose(sample.pose);
  /** @type {(0 | 1)[]} */
  const stops = [];
  if (p.active[0]) stops.push(0);
  if (p.active[1]) stops.push(1);
  const size = 4 + stops.length;
  const z = new Float64Array(size);
  z.set(p.q);
  stops.forEach((w, j) => { z[4 + j] = p.lambda[w]; });
  /** @param {Float64Array} v */
  const setZ = (v) => {
    for (let i = 0; i < 4; i++) p.q[i] = v[i];
    stops.forEach((w, j) => { p.lambda[w] = v[4 + j]; });
  };
  // The pose is converged: its residual is below ELASTIC_TOLERANCE, zero
  // within the accuracy of the forward differences.
  const r = new Float64Array(size);
  const J = elasticJacobian(ctx, p, sample.x, z, r, setZ);
  if (!J) return NaN;
  // R(z, L) = 0 with ∂R_1/∂L_c,t = −1: J·dz = e_1·dL.
  const e = new Array(size).fill(0);
  e[1] = 1;
  const dz = solveLinear(J, e, size);
  return dz ? dz[0] - dz[2] : NaN;
}

/**
 * True when the closure determinant of the last two samples falls towards
 * zero and its linear extrapolation reaches zero within FOLD_STEPS steps
 * beyond the failed position.
 * @param {{ x: number, pose: Pose }} a older sample
 * @param {{ x: number, pose: Pose }} b last sample
 * @param {number} x failed nock position (m)
 */
function foldAhead(a, b, x) {
  const da = determinant(jacobian(a.pose.top, a.pose.bottom), 4);
  const db = determinant(jacobian(b.pose.top, b.pose.bottom), 4);
  if (!(da * db > 0 && Math.abs(db) < Math.abs(da))) return false;
  const xZero = b.x + (db * (b.x - a.x)) / (da - db);
  return xZero <= x + FOLD_STEPS * (x - b.x);
}

/**
 * Nock position in (last.x, xb] where the gap of one cam reaches zero, by
 * the Illinois variant of regula falsi.
 * @param {Context} ctx
 * @param {{ x: number, pose: Pose }} last sample with both gaps open
 * @param {number} xb nock position with this gap closed (m)
 * @param {'top' | 'bottom'} which
 * @returns {{ x: number, pose: Pose } | string}
 */
function locateStop(ctx, last, xb, which) {
  const stop = /** @type {NonNullable<Context['stop']>} */ (ctx.stop);
  /** @param {Pose} p */
  const gap = (p) => stopGap(stop, which === 'top' ? p.top : p.bottom);
  /** @param {number} x */
  const at = (x) => {
    const p = copyPose(last.pose);
    return solveAt(ctx, p, x) ? null : p;
  };
  let a = last.x;
  let ga = gap(last.pose);
  let b = xb;
  const pb = at(b);
  if (!pb) return 'the closures did not converge at a draw stop';
  let gb = gap(pb);
  let best = { x: b, pose: pb, g: gb };
  let side = 0;
  for (let it = 0; it < EVENT_ITERATIONS && Math.abs(best.g) > GAP_TOLERANCE && b - a > EVENT_WIDTH; it++) {
    let m = (a * gb - b * ga) / (gb - ga);
    if (!(m > a && m < b)) m = 0.5 * (a + b);
    const pm = at(m);
    if (!pm) return 'the closures did not converge at a draw stop';
    const gm = gap(pm);
    if (Math.abs(gm) < Math.abs(best.g)) best = { x: m, pose: pm, g: gm };
    if (gm < 0) {
      b = m;
      gb = gm;
      if (side === -1) ga /= 2;
      side = -1;
    } else {
      a = m;
      ga = gm;
      if (side === 1) gb /= 2;
      side = 1;
    }
  }
  return { x: best.x, pose: best.pose };
}

/**
 * Sample arrays, diagnostics and result.
 * @param {Context} ctx
 * @param {March} march
 * @param {NonNullable<AnalysisResult['brace']>} brace
 * @param {'free' | 'board'} nock
 * @param {number} xFull
 * @param {AnalysisInput} input
 * @returns {AnalysisResult}
 */
function finish(ctx, march, brace, nock, xFull, input) {
  const list = march.samples;
  const rates = input.rates ?? true;
  const n = list.length;
  const arr = () => new Float64Array(n);
  const r = {
    x: arr(), y: arr(), thetaTop: arr(), thetaBottom: arr(), dTheta: arr(), alphaTop: arr(), alphaBottom: arr(),
    F: arr(), Fy: arr(), stringTop: arr(), stringBottom: arr(), cableTop: arr(), cableBottom: arr(),
    gapTop: arr(), gapBottom: arr(), psiStringTop: arr(), psiStringBottom: arr(), psiCableTop: arr(), psiCableBottom: arr(),
    ky: arr(), dThetaDL: arr(),
  };
  const det = arr();
  const offTrack = new Uint8Array(n);
  const psiEndS = input.stringTermination;
  const psiEndC = input.cableTermination;
  /** @param {Half} h */
  const leaves = (h) => {
    const ps = h.string.psi;
    const pc = h.cable.psi;
    return !(ps <= psiEndS && pc >= psiEndC && h.string.inRange && h.cable.inRange &&
      psiEndS - ps < 2 * Math.PI && pc - psiEndC < 2 * Math.PI);
  };
  for (let i = 0; i < n; i++) {
    const { x, pose } = list[i];
    const s = statics(ctx, pose);
    const J = jacobian(pose.top, pose.bottom);
    const d = solveLinear(J, [0, 1, 0, 0], 4);
    r.x[i] = x;
    r.y[i] = pose.y;
    r.thetaTop[i] = pose.q[0];
    r.alphaTop[i] = pose.q[1];
    r.thetaBottom[i] = pose.q[2];
    r.alphaBottom[i] = pose.q[3];
    r.dTheta[i] = pose.q[0] - pose.q[2];
    r.F[i] = s ? s.F : NaN;
    r.Fy[i] = s ? (ctx.free ? 0 : s.Fy) : NaN;
    r.stringTop[i] = s ? s.T[0] : NaN;
    r.cableTop[i] = s ? s.T[1] : NaN;
    r.stringBottom[i] = s ? s.T[2] : NaN;
    r.cableBottom[i] = s ? s.T[3] : NaN;
    r.gapTop[i] = ctx.stop ? stopGap(ctx.stop, pose.top) : NaN;
    r.gapBottom[i] = ctx.stop ? stopGap(ctx.stop, pose.bottom) : NaN;
    r.psiStringTop[i] = pose.top.string.psi;
    r.psiStringBottom[i] = pose.bottom.string.psi;
    r.psiCableTop[i] = pose.top.cable.psi;
    r.psiCableBottom[i] = pose.bottom.cable.psi;
    r.ky[i] = ctx.free ? pose.ky : NaN;
    r.dThetaDL[i] = !rates ? NaN : ctx.elastic ? elasticTimingRate(ctx, list[i]) : d ? d[0] - d[2] : NaN;
    det[i] = determinant(J, 4);
    offTrack[i] = leaves(pose.top) || leaves(pose.bottom) ? 1 : 0;
  }

  /** @type {AnalysisDiagnostic[]} */
  const diagnostics = [];
  /** @type {[AnalysisCode, (i: number) => boolean][]} */
  const checks = [
    ['analysis-slack', (i) => !(r.stringTop[i] > 0 && r.stringBottom[i] > 0 && r.cableTop[i] > 0 && r.cableBottom[i] > 0)],
    ['analysis-fold', (i) => i > 0 && det[i] * det[i - 1] < 0],
    ['analysis-wrap', (i) => offTrack[i] === 1],
    ['analysis-unstable', (i) => ctx.free && !(r.ky[i] > 0)],
  ];
  for (const [code, flagged] of checks) {
    for (const [a, b] of runs(n, flagged)) diagnostics.push({ code, xRange: [r.x[a], r.x[b]], message: ANALYSIS_CODES[code] });
  }
  if (march.noSecond) {
    diagnostics.push({
      code: 'analysis-no-second-stop',
      xRange: [r.x[march.firstIndex], r.x[n - 1]],
      message: `${ANALYSIS_CODES['analysis-no-second-stop']}: ${march.capped
        ? `the draw force reached ${FORCE_CAP} times its peak ${((r.x[n - 1] - r.x[march.firstIndex]) * 1000).toFixed(1)} mm past the first stop`
        : `searched to ${((r.x[n - 1] - xFull) * 1000).toFixed(1)} mm beyond full draw`}`,
    });
  }
  if (march.noStop) {
    diagnostics.push({
      code: 'analysis-no-stop',
      xRange: [xFull, r.x[n - 1]],
      message: `${ANALYSIS_CODES['analysis-no-stop']}: searched to ${((r.x[n - 1] - xFull) * 1000).toFixed(1)} mm beyond full draw`,
    });
  }
  if (march.fold) {
    diagnostics.unshift({
      code: 'analysis-fold',
      xRange: [r.x[n - 1], march.failedAt],
      message: `${ANALYSIS_CODES['analysis-fold']}: the draw ends at ${(r.x[n - 1] * 1000).toFixed(1)} mm`,
    });
  } else if (march.wallFailure) {
    diagnostics.unshift({
      code: 'analysis-no-convergence',
      xRange: [r.x[n - 1], r.x[n - 1]],
      message: `${ANALYSIS_CODES['analysis-no-convergence']}: the wall stiffness at the second stop: ${march.wallFailure}`,
    });
  } else if (march.failure) {
    diagnostics.unshift({
      code: 'analysis-no-convergence',
      xRange: [march.failedAt, march.failedAt],
      message: `${ANALYSIS_CODES['analysis-no-convergence']}: ${march.failure}`,
    });
  }
  const stopped = march.first !== null;
  const f = march.firstIndex;
  let end = n - 1;
  if (!stopped) while (end >= 0 && r.x[end] > xFull + 1e-12) end--;
  return {
    status: (march.failure && !march.fold) || march.wallFailure ? 'no-convergence' : diagnostics.length > 0 ? 'infeasible' : 'ok',
    diagnostics,
    nock,
    n,
    ...r,
    brace,
    stops: {
      first: march.first,
      x: stopped ? r.x[f] : NaN,
      gapTop: stopped ? r.gapTop[f] : NaN,
      gapBottom: stopped ? r.gapBottom[f] : NaN,
      second: march.second,
      x2: march.second ? r.x[n - 1] : NaN,
      wallStiffness: march.wallStiffness,
    },
    elastic: ctx.elastic,
    fullDraw: xFull,
    end,
    // At the first stop, before any cam rests on its stop; the end of the draw without one.
    sensitivity: !rates ? NaN : f >= 0 ? sensitivityAt(ctx, list[f]) : end >= 0 ? sensitivityAt(ctx, list[end]) : NaN,
    iterations: ctx.iterations,
  };
}

/**
 * dΔθ/dL_c,t at a sample in the nock mode of the analysis: the pose solved
 * again with the top cable 1 µm longer and shorter (rad/m); NaN when either
 * solve fails.
 * @param {Context} ctx
 * @param {{ x: number, pose: Pose }} sample
 */
function sensitivityAt(ctx, sample) {
  const base = ctx.lengths[1];
  /** @param {number} dL */
  const timing = (dL) => {
    ctx.lengths[1] = base + dL;
    const p = copyPose(sample.pose);
    p.active.fill(0);
    p.lambda.fill(0);
    p.jac = null;
    const reason = solveAt(ctx, p, sample.x);
    return reason ? NaN : p.q[0] - p.q[2];
  };
  const value = (timing(SENSITIVITY_STEP) - timing(-SENSITIVITY_STEP)) / (2 * SENSITIVITY_STEP);
  ctx.lengths[1] = base;
  return value;
}
