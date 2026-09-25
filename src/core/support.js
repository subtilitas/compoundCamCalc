/**
 * Support functions of convex cam tracks. A track is the envelope of the
 * lines X·n(ψ) = p(ψ) in the cam frame, with n = (cos ψ, sin ψ),
 * t = (−sin ψ, cos ψ) and ψ unwrapped (rad). Contact point
 * X = p·n + p'·t, radius of curvature ρ = p + p'', and dX/dψ = ρ·t.
 * P is the integral of p from the reference angle of the shape, so the
 * arc length between two angles is [P + p'] between them.
 *
 * Track data are plain objects of numbers and Float64Array, so they can be
 * sent to a worker; {@link createSupport} attaches the evaluation methods.
 * Lengths in m, angles in rad.
 * @module core/support
 */

import { ellipticE } from './elliptic.js';

/**
 * Circle of radius r whose centre sits at distance e from the axle in the
 * direction `phase`: p = r + e·cos(ψ − phase), ρ = r. Reference angle 0.
 * @typedef {object} EccentricData
 * @property {'eccentric'} kind
 * @property {number} radius r (m)
 * @property {number} offset e (m)
 * @property {number} phase direction of the centre in the cam frame (rad)
 */

/**
 * Ellipse with semi-axis a along `axisAngle`, semi-axis b across it and its
 * centre at distance e from the axle in the direction `offsetAngle`:
 * p = √(a²·cos²(ψ − axisAngle) + b²·sin²(ψ − axisAngle)) + e·cos(ψ − offsetAngle).
 * Stored with a ≥ b (the constructor swaps the axes and turns axisAngle by
 * 90° when needed). Reference angle 0.
 * @typedef {object} EllipseData
 * @property {'ellipse'} kind
 * @property {number} a semi-axis along axisAngle (m)
 * @property {number} b semi-axis across axisAngle (m)
 * @property {number} axisAngle (rad)
 * @property {number} offset e (m)
 * @property {number} offsetAngle (rad)
 */

/**
 * Parallel track at normal distance delta: p + delta, ρ + delta. The pitch
 * line of a cord of diameter d is the groove bottom offset by d/2. Same
 * reference angle as the base track.
 * @typedef {object} OffsetData
 * @property {'offset'} kind
 * @property {SupportData} base
 * @property {number} delta (m)
 */

/**
 * C2 cubic spline p(ψ) through (knots, values). On [ψ_i, ψ_(i+1)] with
 * t = ψ − ψ_i: p = c0 + c1·t + c2·t² + c3·t³. A periodic spline repeats with
 * period ψ_n − ψ_0; an open spline continues its end pieces outside the
 * knot range, which is its defined range. Reference angle ψ_0.
 * @typedef {object} SplineData
 * @property {'spline'} kind
 * @property {Float64Array} knots ψ_0 < … < ψ_n (rad)
 * @property {Float64Array} coeffs four per interval, lowest order first
 * @property {Float64Array} cumulative integral of p from ψ_0 to ψ_i (m·rad)
 * @property {boolean} periodic
 */

/** @typedef {EccentricData | EllipseData | OffsetData | SplineData} SupportData */

/**
 * @typedef {object} SupportMethods
 * @property {(psi: number, out: Float64Array) => Float64Array} evaluate writes
 *   p, p', p'' to out[0], out[1], out[2] and returns out
 * @property {(psi: number) => number} p support value (m)
 * @property {(psi: number) => number} dp p' (m/rad)
 * @property {(psi: number) => number} d2p p'' (m/rad²)
 * @property {(psi: number) => number} P integral of p from the reference angle
 * @property {(psi: number) => number} rho radius of curvature p + p'' (m)
 * @property {(psi: number) => { x: number, y: number }} point contact point X (m)
 * @property {(psi: number) => number} distance |X|, distance of the contact point from the axle (m)
 * @property {number} reference angle where P = 0 (rad)
 * @property {number} min start of the defined range (rad, −Infinity when unbounded)
 * @property {number} max end of the defined range (rad, Infinity when unbounded)
 */

/** @typedef {SupportData & SupportMethods} Support */

/**
 * Eccentric circle data; offset and phase default to 0 (a circle about the axle).
 * @param {{ radius: number, offset?: number, phase?: number }} params (m, m, rad)
 * @returns {EccentricData}
 */
export function eccentricCircle({ radius, offset = 0, phase = 0 }) {
  return { kind: 'eccentric', radius, offset, phase };
}

/**
 * Ellipse data; the angles and the offset default to 0. The semi-axes must
 * be finite and positive ({@link createSupport} rejects others), so the
 * elliptic parameter m = 1 − b²/a² stays below 1.
 * @param {{ a: number, b: number, axisAngle?: number, offset?: number, offsetAngle?: number }} params
 *   semi-axes (m), axis direction (rad), centre offset (m) and its direction (rad)
 * @returns {EllipseData}
 */
export function ellipse({ a, b, axisAngle = 0, offset = 0, offsetAngle = 0 }) {
  if (b > a) return { kind: 'ellipse', a: b, b: a, axisAngle: axisAngle + Math.PI / 2, offset, offsetAngle };
  return { kind: 'ellipse', a, b, axisAngle, offset, offsetAngle };
}

/**
 * Parallel track: p + delta. A positive delta moves the track outwards.
 * @param {SupportData} base
 * @param {number} delta (m)
 * @returns {OffsetData}
 */
export function offset(base, delta) {
  return { kind: 'offset', base, delta };
}

/**
 * Solve a tridiagonal system in place (Thomas algorithm). a: sub-diagonal
 * (a[0] unused), b: diagonal, c: super-diagonal (c[n−1] unused).
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @param {Float64Array} c
 * @param {Float64Array} r right-hand side, overwritten with the solution
 */
function solveTridiagonal(a, b, c, r) {
  const n = b.length;
  const cp = new Float64Array(n);
  let beta = b[0];
  r[0] /= beta;
  for (let i = 1; i < n; i++) {
    cp[i - 1] = c[i - 1] / beta;
    beta = b[i] - a[i] * cp[i - 1];
    r[i] = (r[i] - a[i] * r[i - 1]) / beta;
  }
  for (let i = n - 2; i >= 0; i--) r[i] -= cp[i] * r[i + 1];
}

/**
 * Solve a cyclic tridiagonal system by the Sherman–Morrison formula.
 * corner: coefficient of x[n−1] in row 0 and of x[0] in row n−1.
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @param {Float64Array} c
 * @param {number} corner
 * @param {Float64Array} r right-hand side, overwritten with the solution
 */
function solveCyclic(a, b, c, corner, r) {
  const n = b.length;
  const gamma = -b[0];
  const bb = Float64Array.from(b);
  bb[0] = b[0] - gamma;
  bb[n - 1] = b[n - 1] - (corner * corner) / gamma;
  solveTridiagonal(a, bb, c, r);
  const u = new Float64Array(n);
  u[0] = gamma;
  u[n - 1] = corner;
  solveTridiagonal(a, bb, c, u);
  const f = (r[0] + (corner * r[n - 1]) / gamma) / (1 + u[0] + (corner * u[n - 1]) / gamma);
  for (let i = 0; i < n; i++) r[i] -= f * u[i];
}

/**
 * C2 cubic spline support through the points (knots[i], values[i]).
 * - periodic: the period is knots[n] − knots[0]; values[n] is ignored and
 *   taken equal to values[0]. Needs at least 3 intervals.
 * - open with endSlopes [p'(ψ_0), p'(ψ_n)]: clamped spline.
 * - open without endSlopes: natural spline (p'' = 0 at both ends).
 * Throws RangeError for malformed arrays (a programming error: the solver
 * builds these arrays itself).
 * @param {ArrayLike<number>} knots strictly increasing (rad)
 * @param {ArrayLike<number>} values (m)
 * @param {{ periodic?: boolean, endSlopes?: [number, number] }} [options]
 * @returns {SplineData}
 */
export function splineSupport(knots, values, options = {}) {
  const periodic = options.periodic === true;
  const n = knots.length - 1;
  const slopes = options.endSlopes;
  if (slopes !== undefined && !(Array.isArray(slopes) && slopes.length === 2 && slopes.every(Number.isFinite))) {
    throw new RangeError('Spline end slopes must be two finite numbers');
  }
  if (n < (periodic ? 3 : 1) || values.length !== knots.length) {
    throw new RangeError('A spline support needs matching knots and values and enough intervals');
  }
  const x = Float64Array.from(knots);
  const y = Float64Array.from(values);
  if (periodic) y[n] = y[0];
  const h = new Float64Array(n);
  const delta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    h[i] = x[i + 1] - x[i];
    if (!(h[i] > 0) || !Number.isFinite(h[i]) || !Number.isFinite(x[i]) || !Number.isFinite(y[i]) || !Number.isFinite(y[i + 1])) {
      throw new RangeError(`Spline knots must increase and values must be finite (interval ${i})`);
    }
    delta[i] = (y[i + 1] - y[i]) / h[i];
  }
  const M = new Float64Array(n + 1);
  if (periodic) {
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    const c = new Float64Array(n);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const hp = h[(i + n - 1) % n];
      a[i] = hp;
      b[i] = 2 * (hp + h[i]);
      c[i] = h[i];
      r[i] = 6 * (delta[i] - delta[(i + n - 1) % n]);
    }
    solveCyclic(a, b, c, h[n - 1], r);
    M.set(r);
    M[n] = r[0];
  } else {
    const a = new Float64Array(n + 1);
    const b = new Float64Array(n + 1);
    const c = new Float64Array(n + 1);
    const r = new Float64Array(n + 1);
    for (let i = 1; i < n; i++) {
      a[i] = h[i - 1];
      b[i] = 2 * (h[i - 1] + h[i]);
      c[i] = h[i];
      r[i] = 6 * (delta[i] - delta[i - 1]);
    }
    if (slopes) {
      b[0] = 2 * h[0];
      c[0] = h[0];
      r[0] = 6 * (delta[0] - slopes[0]);
      a[n] = h[n - 1];
      b[n] = 2 * h[n - 1];
      r[n] = 6 * (slopes[1] - delta[n - 1]);
    } else {
      b[0] = 1;
      b[n] = 1;
    }
    solveTridiagonal(a, b, c, r);
    M.set(r);
  }
  const coeffs = new Float64Array(4 * n);
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const c1 = delta[i] - (h[i] * (2 * M[i] + M[i + 1])) / 6;
    const c2 = M[i] / 2;
    const c3 = (M[i + 1] - M[i]) / (6 * h[i]);
    coeffs.set([y[i], c1, c2, c3], 4 * i);
    const hi = h[i];
    cumulative[i + 1] = cumulative[i] + hi * (y[i] + hi * (c1 / 2 + hi * (c2 / 3 + (hi * c3) / 4)));
  }
  return { kind: 'spline', knots: x, coeffs, cumulative, periodic };
}

/**
 * Index i of the interval [x_i, x_(i+1)] that contains v; the end intervals
 * extend to infinity.
 * @param {Float64Array} x
 * @param {number} v
 */
function locate(x, v) {
  let lo = 0;
  let hi = x.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (x[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * @param {EccentricData} d
 * @returns {Pick<SupportMethods, 'evaluate' | 'P' | 'reference' | 'min' | 'max'>}
 */
function eccentricMethods(d) {
  const { radius: r, offset: e, phase } = d;
  const sinPhase = Math.sin(phase);
  return {
    evaluate(psi, out) {
      const c = Math.cos(psi - phase);
      const s = Math.sin(psi - phase);
      out[0] = r + e * c;
      out[1] = -e * s;
      out[2] = -e * c;
      return out;
    },
    P: (psi) => r * psi + e * (Math.sin(psi - phase) + sinPhase),
    reference: 0,
    min: -Infinity,
    max: Infinity,
  };
}

/**
 * @param {EllipseData} d
 * @returns {Pick<SupportMethods, 'evaluate' | 'P' | 'reference' | 'min' | 'max'>}
 */
function ellipseMethods(d) {
  const { a, b, axisAngle, offset: e, offsetAngle } = d;
  // A zero semi-axis makes the track a segment: p' jumps and ρ = 0 at its ends.
  if (!(a > 0 && b > 0 && a < Infinity && b < Infinity)) {
    throw new RangeError('An ellipse track needs finite, positive semi-axes');
  }
  const k = b * b - a * a;
  // √(a²cos²u + b²sin²u) = a·√(1 − m·sin²u) with m = 1 − b²/a² < 1.
  const m = 1 - (b * b) / (a * a);
  const base = ellipticE(-axisAngle, m);
  const sinOffset = Math.sin(offsetAngle);
  return {
    evaluate(psi, out) {
      const u = psi - axisAngle;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const hv = Math.sqrt(a * a * cu * cu + b * b * su * su);
      const h1 = (k * su * cu) / hv;
      const h2 = (k * (cu * cu - su * su) - h1 * h1) / hv;
      const c = Math.cos(psi - offsetAngle);
      const s = Math.sin(psi - offsetAngle);
      out[0] = hv + e * c;
      out[1] = h1 - e * s;
      out[2] = h2 - e * c;
      return out;
    },
    P: (psi) => a * (ellipticE(psi - axisAngle, m) - base) + e * (Math.sin(psi - offsetAngle) + sinOffset),
    reference: 0,
    min: -Infinity,
    max: Infinity,
  };
}

/**
 * @param {SplineData} d
 * @returns {Pick<SupportMethods, 'evaluate' | 'P' | 'reference' | 'min' | 'max'>}
 */
function splineMethods(d) {
  const { knots, coeffs, cumulative, periodic } = d;
  const n = knots.length - 1;
  const x0 = knots[0];
  const period = knots[n] - x0;
  const periodIntegral = cumulative[n];
  /** @param {number} psi */
  const wraps = (psi) => (periodic ? Math.floor((psi - x0) / period) : 0);
  return {
    evaluate(psi, out) {
      const v = psi - wraps(psi) * period;
      const i = locate(knots, v);
      const t = v - knots[i];
      const o = 4 * i;
      const c1 = coeffs[o + 1];
      const c2 = coeffs[o + 2];
      const c3 = coeffs[o + 3];
      out[0] = coeffs[o] + t * (c1 + t * (c2 + t * c3));
      out[1] = c1 + t * (2 * c2 + 3 * t * c3);
      out[2] = 2 * c2 + 6 * t * c3;
      return out;
    },
    P(psi) {
      const w = wraps(psi);
      const v = psi - w * period;
      const i = locate(knots, v);
      const t = v - knots[i];
      const o = 4 * i;
      const piece = t * (coeffs[o] + t * (coeffs[o + 1] / 2 + t * (coeffs[o + 2] / 3 + (t * coeffs[o + 3]) / 4)));
      return w * periodIntegral + cumulative[i] + piece;
    },
    reference: x0,
    min: periodic ? -Infinity : x0,
    max: periodic ? Infinity : knots[n],
  };
}

/**
 * @param {SupportData} data
 * @returns {Pick<SupportMethods, 'evaluate' | 'P' | 'reference' | 'min' | 'max'>}
 */
function coreMethods(data) {
  switch (data.kind) {
    case 'eccentric':
      return eccentricMethods(data);
    case 'ellipse':
      return ellipseMethods(data);
    case 'spline':
      return splineMethods(data);
    case 'offset': {
      const base = coreMethods(data.base);
      const delta = data.delta;
      const ref = base.reference;
      return {
        evaluate(psi, out) {
          base.evaluate(psi, out);
          out[0] += delta;
          return out;
        },
        P: (psi) => base.P(psi) + delta * (psi - ref),
        reference: ref,
        min: base.min,
        max: base.max,
      };
    }
    default:
      throw new RangeError(`Unknown support kind ${JSON.stringify(/** @type {any} */ (data).kind)}`);
  }
}

/**
 * Attach evaluation methods to support data. Throws RangeError for an
 * unknown kind and for an ellipse without finite, positive semi-axes.
 * @param {SupportData} data
 * @returns {Support}
 */
export function createSupport(data) {
  const core = coreMethods(data);
  const buf = new Float64Array(3);
  const { evaluate } = core;
  return {
    ...data,
    ...core,
    p: (psi) => evaluate(psi, buf)[0],
    dp: (psi) => evaluate(psi, buf)[1],
    d2p: (psi) => evaluate(psi, buf)[2],
    rho(psi) {
      evaluate(psi, buf);
      return buf[0] + buf[2];
    },
    point(psi) {
      evaluate(psi, buf);
      const c = Math.cos(psi);
      const s = Math.sin(psi);
      return { x: buf[0] * c - buf[1] * s, y: buf[0] * s + buf[1] * c };
    },
    distance(psi) {
      evaluate(psi, buf);
      return Math.hypot(buf[0], buf[1]);
    },
  };
}

/**
 * Plain data of a support, without methods, for transfer to a worker.
 * @param {Support | SupportData} support
 * @returns {SupportData}
 */
export function toSupportData(support) {
  switch (support.kind) {
    case 'eccentric':
      return eccentricCircle(support);
    case 'ellipse':
      return { kind: 'ellipse', a: support.a, b: support.b, axisAngle: support.axisAngle, offset: support.offset, offsetAngle: support.offsetAngle };
    case 'offset':
      return offset(toSupportData(support.base), support.delta);
    default:
      return { kind: 'spline', knots: support.knots, coeffs: support.coeffs, cumulative: support.cumulative, periodic: support.periodic };
  }
}

/**
 * Pitch-line support of the string track from the project state. The state
 * describes the groove bottom as the user measures it, so the pitch line is
 * the groove bottom offset by half the string diameter. The ellipse centre
 * is offset along its major axis (direction `phase`).
 * @param {import('../state/schema.js').StringTrack} track
 * @param {number} stringDiameter (m)
 * @returns {SupportData}
 */
export function stringTrackSupport(track, stringDiameter) {
  const groove =
    track.shape === 'ellipse'
      ? ellipse({ a: track.semiMajor, b: track.semiMinor, axisAngle: track.phase, offset: track.offset, offsetAngle: track.phase })
      : eccentricCircle({ radius: track.radius, offset: track.offset, phase: track.phase });
  return offset(groove, stringDiameter / 2);
}
