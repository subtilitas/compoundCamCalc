/**
 * Tiermas's static model of the round-wheel compound bow, written out from
 * the equations of the paper, independent of src/core: Tiermas, "An
 * advanced model of the round-wheel compound bow", Meccanica 51 (2016)
 * 1201–1207, Eqs. 1 to 17 (CC BY 4.0). Round string and cable wheels share
 * one eccentric offset d; each cable is anchored at the opposite axle; the
 * limb turns about a hinge at (1 − A)·L along the unstrung limb line with
 * the torsional stiffness k·A·L; cords are inextensible.
 *
 * SI units: lengths in m, angles in rad, k in N/rad.
 * @module tests/reference/tiermas-round-wheel
 */

/**
 * @typedef {object} TiermasParams
 * @property {number} e0 axle-to-axle distance at brace
 * @property {number} g riser length, limb base to limb base
 * @property {number} thetaU unstrung limb angle
 * @property {number} alpha0 initial wheel angle
 * @property {number} L limb length
 * @property {number} A lever fraction of the limb
 * @property {number} R string wheel radius
 * @property {number} r cable wheel radius
 * @property {number} d eccentric offset of both wheels
 * @property {number} k spring constant (N/rad)
 */

/**
 * @typedef {object} TiermasPose
 * @property {number} alpha wheel angle (rad)
 * @property {number} e axle-to-axle distance (m)
 * @property {number} theta limb angle (rad)
 * @property {number} D draw from the limb-base line (m)
 * @property {number} F draw force (N)
 * @property {number} V stored energy, Eq. 18 (J)
 */

/**
 * Root of f on [a, b] by bisection to an interval of `tol`; NaN without a
 * sign change.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} [tol]
 */
function bisect(f, a, b, tol = 1e-15) {
  let fa = f(a);
  if (fa * f(b) > 0) return NaN;
  for (let i = 0; i < 200 && (b - a) / 2 >= tol; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

/**
 * Brace angle θ0 of the limb (Eq. 12) and the draw D0 at brace.
 * @param {TiermasParams} p
 */
export function tiermasBrace(p) {
  const AL = p.A * p.L;
  const theta0 = Math.acos((p.e0 / 2 - p.g / 2 - (1 - p.A) * p.L * Math.cos(p.thetaU)) / AL);
  const D0 = (1 - p.A) * p.L * Math.sin(p.thetaU) + AL * Math.sin(theta0) - p.d * Math.cos(p.alpha0) + p.R;
  return { theta0, D0 };
}

/**
 * The model of one bow: its pose at a wheel angle, and the draw force at a
 * draw found by bisection on the wheel angle.
 * @param {TiermasParams} p
 */
export function tiermasModel(p) {
  const { e0, thetaU, alpha0, L, A, R, r, d, k } = p;
  const AL = A * L;
  const { theta0 } = tiermasBrace(p);
  const cosTheta0 = Math.cos(theta0);
  /**
   * Free cable length c and its direction δ at axle distance e, wheel angle a.
   * @param {number} e
   * @param {number} a
   */
  const cable = (e, a) => {
    const c = Math.sqrt(e * e - 2 * e * d * Math.sin(a) + d * d - r * r);
    return { c, delta: Math.atan2(d * Math.cos(a), e - d * Math.sin(a)) + Math.atan2(r, c) };
  };
  const c0 = cable(e0, alpha0);
  const s0 = e0 / 2 - d * Math.sin(alpha0);
  /**
   * Pose at wheel angle a ≤ α0.
   * @param {number} a (rad)
   * @returns {TiermasPose}
   */
  const pose = (a) => {
    // Cable closure: the cable wrapped onto its wheel shortens the free span.
    const e = a === alpha0 ? e0 : bisect((E) => {
      const q = cable(E, a);
      return c0.c - q.c - r * (alpha0 - a) + r * (c0.delta - q.delta);
    }, 0.3, e0 + 1e-9);
    const { delta } = cable(e, a);
    const theta = Math.acos(cosTheta0 - (e0 - e) / (2 * AL));
    // String closure: the angle u of the string against the axle line.
    const u = a === alpha0 ? 0 : bisect((w) => (s0 + R * (alpha0 - a + w)) * Math.cos(w) - e / 2 + d * Math.sin(a) - R * Math.sin(w), 0, Math.PI / 2 - 1e-12);
    const s = s0 + R * (alpha0 - a + u);
    const D = (1 - A) * L * Math.sin(thetaU) + AL * Math.sin(theta) - d * Math.cos(a) + R * Math.cos(u) + s * Math.sin(u);
    const ds = R - d * Math.cos(a - u);
    const dc = r + d * Math.cos(delta - a);
    const F = (2 * dc * k * (theta - thetaU) * Math.sin(u)) / (dc * Math.sin(theta + u) + 2 * ds * Math.sin(theta) * Math.cos(delta));
    const V = AL * k * ((theta - thetaU) ** 2 - (theta0 - thetaU) ** 2);
    return { alpha: a, e, theta, D, F, V };
  };
  return {
    pose,
    /**
     * Pose at draw D, the wheel angle in [alphaMin, α0] where the draw rises.
     * @param {number} D (m)
     * @param {number} [alphaMin] (rad)
     */
    at(D, alphaMin = (-200 * Math.PI) / 180) {
      return pose(bisect((a) => D - pose(a).D, alphaMin, alpha0));
    },
  };
}
