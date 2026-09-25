/**
 * Bow layout and loads at any draw position of a solved cam, from the
 * forward-model samples of a {@link import('./solve.js').SolveResult}.
 *
 * World frame as in core/geometry: origin at the grip pivot point, x towards
 * the archer, y up; the bottom half mirrors the top half about y = 0. The
 * cam turns by θ clockwise in the world frame, so a cam-frame vector v is
 * R(−θ)·v in the world frame.
 *
 * Between two samples the angles, tensions, lever arms and spans are
 * interpolated linearly in x; points follow from them, so the limb stays
 * rigid and every contact point lies on its pitch line.
 *
 * Loads on the top limb tip (the axle O): the string pulls with T_s along
 * u_s, the own power cable with T_c along u_c and the cable of the bottom
 * cam, anchored at O, with T_c along (−u_c,x, u_c,y). The x parts of the two
 * cables cancel:
 *
 *   tip = (T_s·sin φ, −T_s·cos φ + 2·T_c·u_c,y)
 *
 * Lengths in m, angles in rad, forces in N.
 * @module core/layout
 */

import { describeError } from './errors.js';
import { bowGeometry } from './geometry.js';
import { createSupport } from './support.js';

/** @typedef {import('./solve.js').SolveResult} SolveResult */
/** @typedef {import('./support.js').Support} Support */
/** @typedef {import('../state/schema.js').Geometry} Geometry */

/** Fields interpolated between samples. */
const FIELDS = /** @type {const} */ (['F', 'theta', 'alpha', 'Ts', 'Tc', 'phi', 'psiS', 'psiC', 'pS', 'pC', 'spanS', 'spanC']);
/** Fields that must be finite for a sample to count as solved. */
const REQUIRED = /** @type {const} */ ([...FIELDS, 'axleX', 'axleY']);

/**
 * @typedef {object} Peak
 * @property {number} value (N)
 * @property {number} x nock position (m)
 */

/**
 * Loads at every sample; entries past the solved samples are NaN.
 * @typedef {object} LoadSeries
 * @property {Float64Array} x nock position (m)
 * @property {Float64Array} F draw force (N)
 * @property {Float64Array} Ts string tension (N)
 * @property {Float64Array} Tc cable tension, each cable (N)
 * @property {Float64Array} axleLoad load on each limb tip (N)
 * @property {Peak} maxTs
 * @property {Peak} maxTc
 * @property {Peak} maxAxle
 * @property {number} min smallest value of the three load series (N; negative
 *   on a slack cord)
 * @property {number} braceAxle limb tip load at brace (N)
 */

/**
 * Lengths of the braced bow.
 * @typedef {object} BuildLengths
 * @property {number} string pitch-line length of the string between its two
 *   termination points (m)
 * @property {number} cable pitch-line length of one power cable from its
 *   termination point to the centre of the opposite axle (m)
 * @property {number} ataBrace axle-to-axle length at brace (m)
 * @property {number} ataFull axle-to-axle length at full draw, NaN when the
 *   solve stopped before full draw (m)
 */

/**
 * @typedef {object} LayoutContext
 * @property {number} n samples
 * @property {number} valid leading samples with every field finite (≥ 2)
 * @property {number} xBrace x of the first sample (m)
 * @property {number} xLast x of the last solved sample (m)
 * @property {number} xFull x of the last sample (m)
 * @property {number} limbLength R_L (m)
 * @property {number} betaBrace β_b (rad)
 * @property {number} pivotX limb pivot Q (m)
 * @property {number} pivotY
 * @property {Record<string, Float64Array>} a the samples of the forward model
 * @property {Support | null} stringSupport string pitch line
 * @property {Support | null} cableSupport cable pitch line
 * @property {LoadSeries} loads
 * @property {BuildLengths} lengths
 * @property {'coarse' | 'full'} resolution
 */

/**
 * Pose of the top half at one draw position. Every point is in the world
 * frame unless its name ends in Cam (cam frame, axle at the origin).
 * @typedef {object} BowPose
 * @property {number} x nock position (m)
 * @property {'before' | 'after' | null} clamped the requested x lay outside
 *   the solved samples and was moved to the nearest one
 * @property {boolean} beyondSolution the requested x lies past the last
 *   solved sample of a solve that stopped before full draw
 * @property {boolean} atSample x equals a sample (no interpolation)
 * @property {number} F draw force (N)
 * @property {number} theta cam rotation (rad)
 * @property {number} alpha limb rotation (rad)
 * @property {number} beta limb angle β_b − α (rad)
 * @property {number} Ts string tension (N)
 * @property {number} Tc cable tension (N)
 * @property {number} phi string angle against the vertical (rad)
 * @property {number} psiS string contact angle, cam frame (rad)
 * @property {number} psiC cable contact angle, cam frame (rad)
 * @property {number} pS string lever arm (m)
 * @property {number} pC cable lever arm (m)
 * @property {number} spanS free string length from contact to nock (m)
 * @property {number} spanC free cable length from contact to anchor (m)
 * @property {number} axleX top axle O (m)
 * @property {number} axleY
 * @property {number} anchorX bottom axle A = (O_x, −O_y) (m)
 * @property {number} anchorY
 * @property {number} pivotX limb pivot Q (m)
 * @property {number} pivotY
 * @property {number} usx unit vector from the string contact to the nock
 * @property {number} usy
 * @property {number} ucx unit vector from the cable contact to the anchor
 * @property {number} ucy
 * @property {number} stringX string contact point (m)
 * @property {number} stringY
 * @property {number} cableX cable contact point (m)
 * @property {number} cableY
 * @property {number} stringCamX string contact point, cam frame (m)
 * @property {number} stringCamY
 * @property {number} cableCamX cable contact point, cam frame (m)
 * @property {number} cableCamY
 * @property {number} tipX load on the top limb tip (N)
 * @property {number} tipY
 * @property {number} axleLoad |tip| (N)
 * @property {number} camLoad load on the cam bearing, |T_s·u_s + T_c·u_c| (N)
 */

/**
 * A pose with every field NaN.
 * @returns {BowPose}
 */
export function createBowPose() {
  return {
    x: NaN, clamped: null, beyondSolution: false, atSample: false,
    F: NaN, theta: NaN, alpha: NaN, beta: NaN, Ts: NaN, Tc: NaN, phi: NaN, psiS: NaN, psiC: NaN,
    pS: NaN, pC: NaN, spanS: NaN, spanC: NaN, axleX: NaN, axleY: NaN, anchorX: NaN, anchorY: NaN,
    pivotX: NaN, pivotY: NaN, usx: NaN, usy: NaN, ucx: NaN, ucy: NaN,
    stringX: NaN, stringY: NaN, cableX: NaN, cableY: NaN,
    stringCamX: NaN, stringCamY: NaN, cableCamX: NaN, cableCamY: NaN,
    tipX: NaN, tipY: NaN, axleLoad: NaN, camLoad: NaN,
  };
}

/**
 * Index i and weight t with xs[i] ≤ x ≤ xs[i+1] and x = xs[i] + t·(xs[i+1] − xs[i])
 * on the first `count` ascending samples; x is clamped to them.
 * @param {ArrayLike<number>} xs
 * @param {number} count ≥ 1
 * @param {number} x
 * @returns {{ i: number, t: number }}
 */
export function bracket(xs, count, x) {
  if (count < 2 || !(x > xs[0])) return { i: 0, t: 0 };
  if (x >= xs[count - 1]) return { i: count - 1, t: 0 };
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  return { i: lo, t: span > 0 ? (x - xs[lo]) / span : 0 };
}

/**
 * Load on the top limb tip and on the cam bearing.
 * @param {number} Ts string tension (N)
 * @param {number} Tc cable tension (N)
 * @param {number} phi string angle (rad)
 * @param {number} ucx unit vector from the cable contact to the anchor
 * @param {number} ucy
 * @returns {{ tipX: number, tipY: number, camX: number, camY: number }}
 */
export function loadAt(Ts, Tc, phi, ucx, ucy) {
  const usx = Math.sin(phi);
  const usy = -Math.cos(phi);
  return {
    tipX: Ts * usx,
    tipY: Ts * usy + 2 * Tc * ucy,
    camX: Ts * usx + Tc * ucx,
    camY: Ts * usy + Tc * ucy,
  };
}

/**
 * Layout context of a solve result, built once per result. Never throws.
 * @param {SolveResult} result
 * @param {Geometry} geometry the geometry the result was solved for
 * @returns {{ layout: LayoutContext | null, error: string | null }}
 */
export function createLayout(result, geometry) {
  try {
    return createLayoutChecked(result, geometry);
  } catch (err) {
    // Any exception while reading malformed input.
    return { layout: null, error: describeError(err) };
  }
}

/**
 * @param {import('./support.js').SupportData | null | undefined} data
 * @returns {Support | null}
 */
function supportOrNull(data) {
  if (!data) return null;
  try {
    return createSupport(data);
  } catch {
    // Unusable track data: the contact points fall back to the spans.
    return null;
  }
}

/**
 * Body of {@link createLayout}, which guards it.
 * @param {Parameters<typeof createLayout>[0]} result
 * @param {Parameters<typeof createLayout>[1]} geometry
 * @returns {ReturnType<typeof createLayout>}
 */
function createLayoutChecked(result, geometry) {
  const a = /** @type {Record<string, Float64Array> | null | undefined} */ (/** @type {unknown} */ (result?.achieved));
  if (!a) return { layout: null, error: 'The result has no forward-model samples' };
  const x = a.x;
  const n = x?.length ?? 0;
  if (n < 2) return { layout: null, error: 'The result has fewer than 2 samples' };
  for (const key of REQUIRED) {
    if (a[key]?.length !== n) return { layout: null, error: `The samples of ${key} do not match the draw positions` };
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || (i > 0 && !(x[i] > x[i - 1]))) {
      return { layout: null, error: 'The draw positions must be finite and ascending' };
    }
  }
  let valid = n;
  for (let i = 0; i < n && valid === n; i++) {
    for (const key of REQUIRED) {
      if (!Number.isFinite(a[key][i])) {
        valid = i;
        break;
      }
    }
  }
  if (valid < 2) return { layout: null, error: 'Fewer than 2 draw positions are solved' };
  const limbLength = geometry?.limbLength;
  const betaBrace = geometry?.limbAngleBrace;
  if (!(Number.isFinite(limbLength) && limbLength > 0 && Number.isFinite(betaBrace))) {
    return { layout: null, error: 'The limb lever length and angle must be finite, the length positive' };
  }
  const stringSupport = supportOrNull(result.tracks?.stringPitch);
  const cableSupport = supportOrNull(result.tracks?.cablePitch);
  // The pivot of the geometry the result was solved for; from the brace
  // sample when the string track is unusable.
  const bow = stringSupport ? bowGeometry(geometry, stringSupport).bow : null;
  const alpha0 = a.alpha[0];
  const pivotX = bow ? bow.pivotX : a.axleX[0] - limbLength * Math.cos(betaBrace - alpha0);
  const pivotY = bow ? bow.pivotY : a.axleY[0] - limbLength * Math.sin(betaBrace - alpha0);

  const loads = loadSeries(a, n, valid);
  const metrics = result.metrics;
  /** @type {BuildLengths} */
  const lengths = {
    string: metrics ? metrics.stringLength : NaN,
    cable: metrics ? metrics.cableLength : NaN,
    ataBrace: 2 * a.axleY[0],
    ataFull: valid === n ? 2 * a.axleY[n - 1] : NaN,
  };
  return {
    layout: {
      n, valid, xBrace: x[0], xLast: x[valid - 1], xFull: x[n - 1],
      limbLength, betaBrace, pivotX, pivotY, a, stringSupport, cableSupport, loads, lengths,
      resolution: result.resolution === 'coarse' ? 'coarse' : 'full',
    },
    error: null,
  };
}

/**
 * @param {Record<string, Float64Array>} a
 * @param {number} n
 * @param {number} valid
 * @returns {LoadSeries}
 */
function loadSeries(a, n, valid) {
  const Ts = new Float64Array(n).fill(NaN);
  const Tc = new Float64Array(n).fill(NaN);
  const F = new Float64Array(n).fill(NaN);
  const axleLoad = new Float64Array(n).fill(NaN);
  const maxTs = { value: -Infinity, x: NaN };
  const maxTc = { value: -Infinity, x: NaN };
  const maxAxle = { value: -Infinity, x: NaN };
  let min = Infinity;
  for (let i = 0; i < valid; i++) {
    const gamma = a.psiC[i] - a.theta[i];
    const load = loadAt(a.Ts[i], a.Tc[i], a.phi[i], -Math.sin(gamma), Math.cos(gamma));
    Ts[i] = a.Ts[i];
    Tc[i] = a.Tc[i];
    F[i] = a.F[i];
    axleLoad[i] = Math.hypot(load.tipX, load.tipY);
    for (const [peak, v] of /** @type {const} */ ([[maxTs, Ts[i]], [maxTc, Tc[i]], [maxAxle, axleLoad[i]]])) {
      if (v > peak.value) {
        peak.value = v;
        peak.x = a.x[i];
      }
      if (v < min) min = v;
    }
  }
  return { x: a.x, F, Ts, Tc, axleLoad, maxTs, maxTc, maxAxle, min, braceAxle: axleLoad[0] };
}

/**
 * Fill the pose at nock position x, clamped to the solved samples. Never
 * throws; returns false, with every number NaN, when the pose cannot be
 * built.
 * @param {LayoutContext} ctx
 * @param {number} x (m)
 * @param {BowPose} pose filled in place
 * @returns {boolean}
 */
export function bowPoseAt(ctx, x, pose) {
  try {
    return bowPoseAtChecked(ctx, x, pose);
  } catch {
    // Malformed context: report the failure through the pose.
    try {
      Object.assign(pose, createBowPose());
    } catch {
      // The pose itself is not writable; nothing else to report.
    }
    return false;
  }
}

/**
 * Body of {@link bowPoseAt}, which guards it.
 * @param {LayoutContext} ctx
 * @param {number} x
 * @param {BowPose} pose
 */
function bowPoseAtChecked(ctx, x, pose) {
  if (!Number.isFinite(x)) {
    Object.assign(pose, createBowPose());
    return false;
  }
  const { a, valid } = ctx;
  const xs = a.x;
  const { i, t } = bracket(xs, valid, x);
  const j = t > 0 ? i + 1 : i;
  pose.clamped = x < xs[0] ? 'before' : x > xs[valid - 1] ? 'after' : null;
  pose.beyondSolution = x > xs[valid - 1] && valid < ctx.n;
  pose.atSample = t === 0;
  pose.x = pose.clamped ? xs[i] : x;
  for (const key of FIELDS) {
    const v0 = a[key][i];
    pose[key] = t === 0 ? v0 : v0 + t * (a[key][j] - v0);
  }
  const { theta, phi, psiS, psiC, spanS, spanC } = pose;
  pose.beta = ctx.betaBrace - pose.alpha;
  pose.pivotX = ctx.pivotX;
  pose.pivotY = ctx.pivotY;
  pose.axleX = ctx.pivotX + ctx.limbLength * Math.cos(pose.beta);
  pose.axleY = ctx.pivotY + ctx.limbLength * Math.sin(pose.beta);
  pose.anchorX = pose.axleX;
  pose.anchorY = -pose.axleY;
  pose.usx = Math.sin(phi);
  pose.usy = -Math.cos(phi);
  const gamma = psiC - theta;
  pose.ucx = -Math.sin(gamma);
  pose.ucy = Math.cos(gamma);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // String contact: on the pitch line when the track is known, else back
  // along the free span from the nock.
  if (ctx.stringSupport) {
    const p = ctx.stringSupport.point(psiS);
    pose.stringCamX = p.x;
    pose.stringCamY = p.y;
    pose.stringX = pose.axleX + c * p.x + s * p.y;
    pose.stringY = pose.axleY - s * p.x + c * p.y;
  } else {
    pose.stringX = pose.x - spanS * pose.usx;
    pose.stringY = -spanS * pose.usy;
    const vx = pose.stringX - pose.axleX;
    const vy = pose.stringY - pose.axleY;
    pose.stringCamX = c * vx - s * vy;
    pose.stringCamY = s * vx + c * vy;
  }
  if (ctx.cableSupport) {
    const p = ctx.cableSupport.point(psiC);
    pose.cableCamX = p.x;
    pose.cableCamY = p.y;
    pose.cableX = pose.axleX + c * p.x + s * p.y;
    pose.cableY = pose.axleY - s * p.x + c * p.y;
  } else {
    pose.cableX = pose.anchorX - spanC * pose.ucx;
    pose.cableY = pose.anchorY - spanC * pose.ucy;
    const vx = pose.cableX - pose.axleX;
    const vy = pose.cableY - pose.axleY;
    pose.cableCamX = c * vx - s * vy;
    pose.cableCamY = s * vx + c * vy;
  }
  const load = loadAt(pose.Ts, pose.Tc, phi, pose.ucx, pose.ucy);
  pose.tipX = load.tipX;
  pose.tipY = load.tipY;
  pose.axleLoad = Math.hypot(load.tipX, load.tipY);
  pose.camLoad = Math.hypot(load.camX, load.camY);
  return true;
}
