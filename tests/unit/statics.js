/**
 * Bow layout and free-body statics for the verification tests, built from
 * positions without core/geometry, core/contact, core/forward and
 * core/inverse. Only the track shapes (core/support) and the limb moment
 * are taken from the model code.
 */

import { solveDense } from './numeric.js';

/** @typedef {import('../../src/core/support.js').Support} Support */
/** @typedef {import('../../src/state/schema.js').Geometry} Geometry */
/** @typedef {{ x: number, y: number }} Vec */

/**
 * Bow layout from its definition: axle at brace O_b = (x_b − p_s(0), ATA/2),
 * limb pivot Q = O_b − R_L·(cos β_b, sin β_b), axle
 * O(α) = Q + R_L·(cos(β_b − α), sin(β_b − α)).
 * @param {Geometry} geometry
 * @param {Support} s string pitch line
 */
export function layout(geometry, s) {
  const { braceHeight, ata, limbLength: R, limbAngleBrace: beta } = geometry;
  const q = { x: braceHeight - s.p(0) - R * Math.cos(beta), y: ata / 2 - R * Math.sin(beta) };
  return {
    q,
    /** @param {number} alpha @returns {Vec} */
    axleAt: (alpha) => ({ x: q.x + R * Math.cos(beta - alpha), y: q.y + R * Math.sin(beta - alpha) }),
  };
}

/**
 * Point of the cam frame (cam turned by θ about the axle O) in the world
 * frame: O + R(−θ)·P.
 * @param {Vec} O
 * @param {number} theta
 * @param {Vec} P
 * @returns {Vec}
 */
export function camToWorld(O, theta, P) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: O.x + c * P.x + s * P.y, y: O.y - s * P.x + c * P.y };
}

/**
 * Cam-frame angle of the tangent point of the line from the world point B
 * to a track: bisection of f(ψ) = (B_cam − X(ψ))·n(ψ) on the nearest cell
 * around the guess where f changes sign in the right direction. The string
 * leaves along −t, where f falls through zero; the cable leaves along +t,
 * where f rises.
 * @param {Support} support
 * @param {Vec} O axle
 * @param {number} theta cam rotation
 * @param {Vec} B world point
 * @param {boolean} rising true for the cable
 * @param {number} guess (rad)
 */
export function tangentAngle(support, O, theta, B, rising, guess) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const bx = c * (B.x - O.x) - s * (B.y - O.y);
  const by = s * (B.x - O.x) + c * (B.y - O.y);
  const f = (/** @type {number} */ psi) => {
    const X = support.point(psi);
    return (bx - X.x) * Math.cos(psi) + (by - X.y) * Math.sin(psi);
  };
  const step = 0.02;
  for (let k = 0; k < 160; k++) {
    for (let lo of [guess + k * step, guess - (k + 1) * step]) {
      let hi = lo + step;
      const [fl, fh] = [f(lo), f(hi)];
      if (rising ? !(fl < 0 && fh >= 0) : !(fl > 0 && fh <= 0)) continue;
      for (let it = 0; it < 200; it++) {
        const mid = 0.5 * (lo + hi);
        if (mid <= lo || mid >= hi) break;
        if ((f(mid) < 0) === rising) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    }
  }
  return NaN;
}

/**
 * Statics of sample i from a free-body balance in the world frame, without
 * the lever arms and projections of the solver. Contact points come from
 * the track shapes at the tangent angles found by bisection; the cord
 * directions come from the positions of contact, nock and anchor. Cam: the
 * moments of string and cable about the axle cancel. Limb: the moment of the
 * cord forces on the axle about the pivot balances the limb moment E1'(α).
 * The axle carries the string and the top cable, T_s·u_s + T_c·u_c, and the
 * yoke of the bottom cable, which pulls towards the mirror image of the
 * cable contact, T_c·(−u_c,x, u_c,y).
 * @param {{ x: ArrayLike<number>, theta: ArrayLike<number>, alpha: ArrayLike<number>, psiS: ArrayLike<number>,
 *   psiC: ArrayLike<number> }} pose nock position, cam and limb rotation, and contact angles as start
 *   values of the tangent search, per sample
 * @param {number} i sample
 * @param {Support} s string pitch line
 * @param {Support} c cable pitch line
 * @param {Geometry} geometry
 * @param {{ moment: (alpha: number) => number }} limb
 */
export function freeBody(pose, i, s, c, geometry, limb) {
  const lay = layout(geometry, s);
  const theta = pose.theta[i];
  const alpha = pose.alpha[i];
  const O = lay.axleAt(alpha);
  const N = { x: pose.x[i], y: 0 };
  const A = { x: O.x, y: -O.y };
  const Xs = camToWorld(O, theta, s.point(tangentAngle(s, O, theta, N, false, pose.psiS[i])));
  const Xc = camToWorld(O, theta, c.point(tangentAngle(c, O, theta, A, true, pose.psiC[i])));
  const ls = Math.hypot(N.x - Xs.x, N.y - Xs.y);
  const lc = Math.hypot(A.x - Xc.x, A.y - Xc.y);
  const us = { x: (N.x - Xs.x) / ls, y: (N.y - Xs.y) / ls };
  const uc = { x: (A.x - Xc.x) / lc, y: (A.y - Xc.y) / lc };
  const cross = (/** @type {Vec} */ a, /** @type {Vec} */ b) => a.x * b.y - a.y * b.x;
  const armS = cross({ x: Xs.x - O.x, y: Xs.y - O.y }, us);
  const armC = cross({ x: Xc.x - O.x, y: Xc.y - O.y }, uc);
  // α turns the lever clockwise: the limb moment is −(O − Q) × force.
  const lever = { x: O.x - lay.q.x, y: O.y - lay.q.y };
  const limbS = -cross(lever, us);
  const limbC = -cross(lever, { x: 0, y: 2 * uc.y });
  const [Ts, Tc] = solveDense([[armS, armC], [limbS, limbC]], [0, limb.moment(alpha)]);
  return { Ts, Tc, F: 2 * Ts * us.x, span: ls };
}
