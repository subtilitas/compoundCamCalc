/**
 * Target force curve interpolant: C2 piecewise quintic Hermite spline with
 * shape-preserving first and second derivatives at the knots.
 *
 * Construction:
 * 1. Slopes d_i by the Fritsch–Butland weighted harmonic mean (as SciPy
 *    `PchipInterpolator`), zero where adjacent secants change sign or one is
 *    zero, three-point shape-preserving end formula.
 * 2. Second derivatives s_i: mean of the end second derivatives of the two
 *    adjacent cubic Hermite pieces, one-sided at the ends.
 * 3. On every interval the quintic must be monotone in the direction of its
 *    data (constant on flat data). Where it is not, s at both knots of that
 *    interval shrinks towards 0; if s = 0 is not enough, the slopes shrink.
 *    Neighbours are re-checked. d = s = 0 at both knots gives the monotone
 *    quintic smoothstep, so the process terminates.
 * 4. A prescribed start slope or second derivative can rule out d = s = 0 at
 *    knot 0. When step 3 then fails on the first interval, a search finds
 *    monotone target values for the free values at knots 0 and 1, with the
 *    later knots at d = s = 0, and step 3 runs again with the values
 *    shrinking towards these targets instead of towards 0.
 *
 * Because d and s are shared per knot the result stays C2. Each interval is
 * monotone between its end values, so the curve never leaves the range of
 * the two end values of an interval and local extrema sit at the knots.
 * @module core/interp
 */

/** Tolerance for evaluation outside the knot range, in metres. */
export const RANGE_TOLERANCE = 1e-12;

/** Relative tolerance of the monotonicity check on one interval. */
const MONOTONE_TOLERANCE = 1e-12;
/** Bisection steps when searching the largest admissible shrink factor. */
const SHRINK_STEPS = 40;
/** Iteration limit of the target search for prescribed start values. */
const ANCHOR_STEPS = 1000;

/**
 * @typedef {object} CurvePoint
 * @property {number} x position (m)
 * @property {number} F force (N)
 */

/**
 * @typedef {object} CurveOptions
 * @property {number} [startSlope] prescribed F'(x_0) in N/m
 * @property {number} [startSecondDerivative] prescribed F''(x_0) in N/m²
 */

/**
 * Interpolant data. Plain object of typed arrays, so it is structured-cloneable.
 * @typedef {object} CurveData
 * @property {Float64Array} knots x_i (m)
 * @property {Float64Array} values F(x_i) (N)
 * @property {Float64Array} slopes F'(x_i) (N/m)
 * @property {Float64Array} second F''(x_i) (N/m²)
 * @property {Float64Array} coeffs six coefficients per interval, lowest order
 *   first, of q(t) = F(x_i + t·h_i) with t in [0, 1] and h_i = x_(i+1) − x_i
 * @property {Float64Array} cumulative integral of F from x_0 to x_i (J)
 * @property {boolean} shapePreserved false only when prescribed start
 *   conditions leave the first interval non-monotone: no monotone setting
 *   of the free values at knots 0 and 1 exists with d = s = 0 at the later
 *   knots. The search for that setting holds the later knots at 0, so a
 *   monotone curve that needs other values there is not found.
 */

/**
 * @typedef {object} CurveMethods
 * @property {(x: number) => number} evaluate F(x) in N
 * @property {(x: number, order?: 1 | 2) => number} derivative F'(x) in N/m or F''(x) in N/m²
 * @property {(x0: number, x1: number) => number} integral exact integral of F from x0 to x1 (J)
 * @property {(n: number) => { x: Float64Array, F: Float64Array }} sample n points uniform in x
 */

/** @typedef {CurveData & CurveMethods} Curve */

/**
 * Knot slopes by the Fritsch–Butland weighted harmonic mean with the
 * shape-preserving three-point end formula (same result as SciPy
 * `PchipInterpolator`).
 * @param {ArrayLike<number>} x strictly increasing
 * @param {ArrayLike<number>} y
 * @returns {Float64Array}
 */
export function pchipSlopes(x, y) {
  const n = x.length;
  const d = new Float64Array(n);
  const h = new Float64Array(n - 1);
  const m = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    h[k] = x[k + 1] - x[k];
    m[k] = (y[k + 1] - y[k]) / h[k];
  }
  if (n === 2) {
    d[0] = m[0];
    d[1] = m[0];
    return d;
  }
  for (let k = 1; k < n - 1; k++) {
    const m0 = m[k - 1];
    const m1 = m[k];
    if (m0 === 0 || m1 === 0 || Math.sign(m0) !== Math.sign(m1)) {
      d[k] = 0;
    } else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      d[k] = (w1 + w2) / (w1 / m0 + w2 / m1);
    }
  }
  d[0] = endSlope(h[0], h[1], m[0], m[1]);
  d[n - 1] = endSlope(h[n - 2], h[n - 3], m[n - 2], m[n - 3]);
  return d;
}

/**
 * @param {number} h0
 * @param {number} h1
 * @param {number} m0
 * @param {number} m1
 */
function endSlope(h0, h1, m0, m1) {
  const d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
  if (Math.sign(d) !== Math.sign(m0)) return 0;
  if (Math.sign(m0) !== Math.sign(m1) && Math.abs(d) > 3 * Math.abs(m0)) return 3 * m0;
  return d;
}

/**
 * Coefficients of q(t) = F(x_i + t·h) on [0, 1] from end values, slopes and
 * second derivatives.
 * @param {number} h
 * @param {number} y0
 * @param {number} y1
 * @param {number} d0
 * @param {number} d1
 * @param {number} s0
 * @param {number} s1
 * @param {Float64Array} out
 * @param {number} [offset=0]
 */
function quinticCoeffs(h, y0, y1, d0, d1, s0, s1, out, offset = 0) {
  const c1 = h * d0;
  const c2 = 0.5 * h * h * s0;
  const D = y1 - y0 - c1 - c2;
  const E = h * d1 - c1 - 2 * c2;
  const G = h * h * s1 - 2 * c2;
  out[offset] = y0;
  out[offset + 1] = c1;
  out[offset + 2] = c2;
  out[offset + 3] = 10 * D - 4 * E + 0.5 * G;
  out[offset + 4] = -15 * D + 7 * E - G;
  out[offset + 5] = 6 * D - 3 * E + 0.5 * G;
}

/**
 * @param {number} t
 * @param {number} a0
 * @param {number} a1
 * @param {number} a2
 * @param {number} a3
 * @param {number} a4
 */
function quartic(t, a0, a1, a2, a3, a4) {
  return a0 + t * (a1 + t * (a2 + t * (a3 + t * a4)));
}

/**
 * Real roots of a + b·t + c·t² in (0, 1).
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number[]}
 */
function quadraticRootsInUnit(a, b, c) {
  /** @type {number[]} */
  const roots = [];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return roots;
  if (Math.abs(c) <= 1e-14 * scale) {
    if (b !== 0) roots.push(-a / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
      roots.push(q / c);
      if (q !== 0) roots.push(a / q);
    }
  }
  return roots.filter((t) => t > 0 && t < 1).sort((u, v) => u - v);
}

/**
 * Minimum and maximum of a quartic on [0, 1] and where they occur.
 * Candidates: the ends, the roots of the cubic derivative (isolated on
 * intervals where the cubic is monotone and refined by bisection), and 16
 * uniform samples as a safeguard.
 * @param {number} a0
 * @param {number} a1
 * @param {number} a2
 * @param {number} a3
 * @param {number} a4
 * @returns {{ min: number, tMin: number, max: number, tMax: number }}
 */
function quarticExtrema(a0, a1, a2, a3, a4) {
  const b0 = a1;
  const b1 = 2 * a2;
  const b2 = 3 * a3;
  const b3 = 4 * a4;
  /** @param {number} t */
  const cubic = (t) => b0 + t * (b1 + t * (b2 + t * b3));
  const breaks = [0, ...quadraticRootsInUnit(b1, 2 * b2, 3 * b3), 1];
  const candidates = [...breaks];
  for (let k = 0; k < breaks.length - 1; k++) {
    let lo = breaks[k];
    let hi = breaks[k + 1];
    let flo = cubic(lo);
    const fhi = cubic(hi);
    if (flo === 0 || fhi === 0 || Math.sign(flo) === Math.sign(fhi)) continue;
    for (let it = 0; it < 80 && hi - lo > 1e-15; it++) {
      const mid = 0.5 * (lo + hi);
      const fm = cubic(mid);
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = mid;
        flo = fm;
      } else {
        hi = mid;
      }
    }
    candidates.push(0.5 * (lo + hi));
  }
  for (let k = 1; k < 16; k++) candidates.push(k / 16);
  let min = Infinity;
  let max = -Infinity;
  let tMin = 0;
  let tMax = 0;
  for (const t of candidates) {
    const v = quartic(t, a0, a1, a2, a3, a4);
    if (v < min) {
      min = v;
      tMin = t;
    }
    if (v > max) {
      max = v;
      tMax = t;
    }
  }
  return { min, tMin, max, tMax };
}

/**
 * Minimum and maximum of a quartic on [0, 1], see {@link quarticExtrema}.
 * @param {number} a0
 * @param {number} a1
 * @param {number} a2
 * @param {number} a3
 * @param {number} a4
 * @returns {{ min: number, max: number }}
 */
export function quarticRangeOnUnit(a0, a1, a2, a3, a4) {
  const r = quarticExtrema(a0, a1, a2, a3, a4);
  return { min: r.min, max: r.max };
}

/**
 * True when the quintic on one interval is monotone in the direction of its
 * data (y1 − y0), or constant when y1 = y0. False for non-finite
 * coefficients.
 * @param {number} h
 * @param {number} y0
 * @param {number} y1
 * @param {number} d0
 * @param {number} d1
 * @param {number} s0
 * @param {number} s1
 * @param {number} scale force scale for the tolerance on flat intervals
 * @param {Float64Array} work six-element scratch array
 */
function isMonotone(h, y0, y1, d0, d1, s0, s1, scale, work) {
  quinticCoeffs(h, y0, y1, d0, d1, s0, s1, work);
  for (let i = 0; i < 6; i++) if (!Number.isFinite(work[i])) return false;
  const delta = y1 - y0;
  const tol = MONOTONE_TOLERANCE * (delta !== 0 ? Math.abs(delta) : scale);
  const r = quarticExtrema(work[1], 2 * work[2], 3 * work[3], 4 * work[4], 5 * work[5]);
  if (delta > 0) return r.min >= -tol;
  if (delta < 0) return r.max <= tol;
  return r.min >= -tol && r.max <= tol;
}

/**
 * @param {ReadonlyArray<CurvePoint>} points
 */
function checkPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new RangeError('A curve needs at least 2 points');
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.F)) {
      throw new RangeError(`Point ${i} has a non-finite coordinate`);
    }
    if (i > 0 && !(p.x > points[i - 1].x)) {
      throw new RangeError(`Point ${i} does not have a larger x than point ${i - 1}`);
    }
  }
}

/**
 * @param {CurveOptions} options
 */
function checkOptions(options) {
  for (const key of /** @type {const} */ (['startSlope', 'startSecondDerivative'])) {
    const v = options[key];
    if (v !== undefined && !Number.isFinite(v)) {
      throw new RangeError(`${key} must be a finite number`);
    }
  }
}

/**
 * Build the interpolant data for a set of points.
 * @param {ReadonlyArray<CurvePoint>} points strictly increasing x
 * @param {CurveOptions} [options]
 * @returns {CurveData}
 */
export function buildCurveData(points, options = {}) {
  checkPoints(points);
  checkOptions(options);
  const n = points.length;
  const x = Float64Array.from(points, (p) => p.x);
  const y = Float64Array.from(points, (p) => p.F);
  const d = pchipSlopes(x, y);
  const fixedStart = { slope: options.startSlope !== undefined, second: options.startSecondDerivative !== undefined };
  if (options.startSlope !== undefined) d[0] = options.startSlope;

  const s = new Float64Array(n);
  for (let k = 0; k < n - 1; k++) {
    const h = x[k + 1] - x[k];
    const m = (y[k + 1] - y[k]) / h;
    const left = (6 * m - 4 * d[k] - 2 * d[k + 1]) / h;
    const right = (-6 * m + 2 * d[k] + 4 * d[k + 1]) / h;
    s[k] = k === 0 ? left : 0.5 * (s[k] + left);
    s[k + 1] = right;
  }
  if (options.startSecondDerivative !== undefined) s[0] = options.startSecondDerivative;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of y) {
    yMin = Math.min(yMin, v);
    yMax = Math.max(yMax, v);
  }
  const prescribed = fixedStart.slope || fixedStart.second;
  const dStart = prescribed ? Float64Array.from(d) : d;
  const sStart = prescribed ? Float64Array.from(s) : s;
  let shapePreserved = enforceShape(x, y, d, s, fixedStart, yMax - yMin, null);
  if (!shapePreserved && prescribed) {
    const anchor = findAnchor(x, y, dStart, sStart, fixedStart, yMax - yMin);
    if (anchor) {
      d.set(dStart);
      s.set(sStart);
      shapePreserved = enforceShape(x, y, d, s, fixedStart, yMax - yMin, anchor);
    }
  }

  const coeffs = new Float64Array(6 * (n - 1));
  const cumulative = new Float64Array(n);
  for (let k = 0; k < n - 1; k++) {
    const h = x[k + 1] - x[k];
    quinticCoeffs(h, y[k], y[k + 1], d[k], d[k + 1], s[k], s[k + 1], coeffs, 6 * k);
    cumulative[k + 1] = cumulative[k] + h * antiderivative(coeffs, 6 * k, 1);
  }
  return { knots: x, values: y, slopes: d, second: s, coeffs, cumulative, shapePreserved };
}

/**
 * @typedef {object} Targets
 * @property {Float64Array} d slope per knot
 * @property {Float64Array} s second derivative per knot
 */

/**
 * Shrink s, then d, per interval towards the targets until every interval
 * is monotone. The targets are 0 unless a search for prescribed start
 * values supplies them; they must be monotone on every interval.
 * Modifies d and s in place.
 * @param {Float64Array} x
 * @param {Float64Array} y
 * @param {Float64Array} d
 * @param {Float64Array} s
 * @param {{ slope: boolean, second: boolean }} fixedStart prescribed values at knot 0
 * @param {number} range max(y) − min(y)
 * @param {Targets | null} targets null for d = s = 0 at every knot
 * @returns {boolean} true when every interval is monotone
 */
function enforceShape(x, y, d, s, fixedStart, range, targets) {
  const n = x.length;
  const td = targets ? targets.d : new Float64Array(n);
  const ts = targets ? targets.s : td;
  const work = new Float64Array(6);
  const scale = range;
  /**
   * @param {number} k
   * @param {number} dk
   * @param {number} dk1
   * @param {number} sk
   * @param {number} sk1
   */
  const ok = (k, dk, dk1, sk, sk1) =>
    isMonotone(x[k + 1] - x[k], y[k], y[k + 1], dk, dk1, sk, sk1, scale, work);

  const queue = [];
  const queued = new Uint8Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    queue.push(k);
    queued[k] = 1;
  }
  let fixes = 0;
  const fixLimit = 20 * n;

  while (queue.length > 0) {
    const k = /** @type {number} */ (queue.shift());
    queued[k] = 0;
    if (ok(k, d[k], d[k + 1], s[k], s[k + 1])) continue;
    const free = { d: !(k === 0 && fixedStart.slope), s: !(k === 0 && fixedStart.second) };
    fixes++;
    if (fixes > fixLimit) {
      // Fallback that always terminates: the targets at both knots are
      // monotone, and knots set to their targets stay there.
      if (free.d) d[k] = td[k];
      if (free.s) s[k] = ts[k];
      d[k + 1] = td[k + 1];
      s[k + 1] = ts[k + 1];
    } else if (!shrinkInterval(k, free, d, s, ok, y[k] === y[k + 1], td, ts)) {
      continue;
    }
    for (const j of [k - 1, k + 1]) {
      if (j >= 0 && j < n - 1 && !queued[j]) {
        queue.push(j);
        queued[j] = 1;
      }
    }
  }
  for (let k = 0; k < n - 1; k++) {
    if (!ok(k, d[k], d[k + 1], s[k], s[k + 1])) return false;
  }
  return true;
}

/**
 * Largest common shrink factor f for s at the free knots of interval k,
 * with s = target + f·(s − target); if even s = target is not monotone,
 * s = target and the largest shrink factor for d. A flat interval gets its
 * targets (d = s = 0) at its free knots, so it is exactly constant.
 * @param {number} k
 * @param {{ d: boolean, s: boolean }} free which values at knot k may change
 *   (false for prescribed start values)
 * @param {Float64Array} d
 * @param {Float64Array} s
 * @param {(k: number, dk: number, dk1: number, sk: number, sk1: number) => boolean} ok
 * @param {boolean} flat the interval has equal end values
 * @param {Float64Array} td target slopes
 * @param {Float64Array} ts target second derivatives
 * @returns {boolean} false when the targets are not monotone on this
 *   interval (prescribed knot without a found target)
 */
function shrinkInterval(k, free, d, s, ok, flat, td, ts) {
  const [d0, d1, s0, s1] = [d[k], d[k + 1], s[k], s[k + 1]];
  /** @param {number} f */
  const sAt0 = (f) => (free.s ? ts[k] + f * (s0 - ts[k]) : s0);
  /** @param {number} f */
  const dAt0 = (f) => (free.d ? td[k] + f * (d0 - td[k]) : d0);
  /** @param {number} f */
  const sAt1 = (f) => ts[k + 1] + f * (s1 - ts[k + 1]);
  /** @param {number} f */
  const dAt1 = (f) => td[k + 1] + f * (d1 - td[k + 1]);

  if (flat) {
    if (!ok(k, dAt0(0), dAt1(0), sAt0(0), sAt1(0))) return false;
    [d[k], d[k + 1], s[k], s[k + 1]] = [dAt0(0), dAt1(0), sAt0(0), sAt1(0)];
    return true;
  }
  if (ok(k, d0, d1, sAt0(0), sAt1(0))) {
    const lam = largestFactor((f) => ok(k, d0, d1, sAt0(f), sAt1(f)));
    s[k] = sAt0(lam);
    s[k + 1] = sAt1(lam);
    return true;
  }
  if (ok(k, dAt0(0), dAt1(0), sAt0(0), sAt1(0))) {
    const mu = largestFactor((f) => ok(k, dAt0(f), dAt1(f), sAt0(0), sAt1(0)));
    s[k] = sAt0(0);
    s[k + 1] = sAt1(0);
    d[k] = dAt0(mu);
    d[k + 1] = dAt1(mu);
    return true;
  }
  return false;
}

/**
 * Bisection for the largest f in [0, 1] with test(f) true, given test(0) true
 * and test(1) false. The admissible set is an interval [0, f*] because the
 * monotone parameter set is convex. Returns a verified admissible value.
 * @param {(f: number) => boolean} test
 */
function largestFactor(test) {
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < SHRINK_STEPS; it++) {
    const mid = 0.5 * (lo + hi);
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Coefficients of the quintic Hermite basis on [0, 1] for unit values of
 * d0, s0, d1 and s1 (six each, in that order), with zero end values.
 */
const BASIS = new Float64Array(24);
quinticCoeffs(1, 0, 0, 1, 0, 0, 0, BASIS, 0);
quinticCoeffs(1, 0, 0, 0, 0, 1, 0, BASIS, 6);
quinticCoeffs(1, 0, 0, 0, 1, 0, 0, BASIS, 12);
quinticCoeffs(1, 0, 0, 0, 0, 0, 1, BASIS, 18);

/**
 * Derivative at t of the quintic with coefficients c[o] … c[o + 5].
 * @param {Float64Array} c
 * @param {number} o
 * @param {number} t
 */
function quinticSlope(c, o, t) {
  return c[o + 1] + t * (2 * c[o + 2] + t * (3 * c[o + 3] + t * (4 * c[o + 4] + t * 5 * c[o + 5])));
}

/** Centre and half-width of the search box per normalised knot value. */
const ANCHOR_CENTRE = [12.5, 0, 12.5, 0];
const ANCHOR_HALF_WIDTH = [15, 1000, 15, 1000];

/**
 * Monotone targets for prescribed start values: the free values at knots 0
 * and 1 such that interval 0 is monotone and interval 1 is monotone with
 * d = s = 0 at knot 2; every later knot gets d = s = 0.
 *
 * In units of interval 0 (t in [0, 1], data from 0 to 1) the knot values are
 * u = (h·d0, h²·s0, h·d1, h²·s1) / Δy. The objective, the smallest scaled
 * slope q'(t)·h / Δy of both intervals, is concave in u (a minimum of
 * linear functions); with a second interval its maximum is at most 0,
 * because q' = 0 at knot 2, so an objective of 0 is the goal.
 * On a monotone interval 0, p(t) = q'(t)·h / Δy is a non-negative quartic
 * with unit integral, so 0 ≤ p ≤ 9 (Christoffel bound) and
 * |p'| ≤ 2·4²·9 = 288 (Markov): the box of ANCHOR_CENTRE and
 * ANCHOR_HALF_WIDTH holds every monotone setting. A deep-cut ellipsoid
 * method maximises the objective over the 0 to 3 free values; it stops at
 * 0, or when its upper bound shows that no monotone setting exists.
 * @param {Float64Array} x
 * @param {Float64Array} y
 * @param {Float64Array} d start values: the prescribed slope at knot 0
 * @param {Float64Array} s start values: the prescribed second derivative at knot 0
 * @param {{ slope: boolean, second: boolean }} fixedStart
 * @param {number} range max(y) − min(y)
 * @returns {Targets | null} null when no monotone setting was found
 */
function findAnchor(x, y, d, s, fixedStart, range) {
  const n = x.length;
  const h0 = x[1] - x[0];
  const delta0 = y[1] - y[0];
  if (delta0 === 0) return null;
  const second = n > 2;
  const h1 = second ? x[2] - x[1] : 1;
  const delta1 = second ? y[2] - y[1] : 1;
  // Knot 1 values in units of interval 1; a flat interval 1 needs d1 = s1 = 0.
  const kc = (h1 * delta0) / (h0 * delta1);
  const ke = (h1 * h1 * delta0) / (h0 * h0 * delta1);
  const u = [(h0 * d[0]) / delta0, (h0 * h0 * s[0]) / delta0, 0, 0];
  /** @type {number[]} */
  const free = [];
  if (!fixedStart.slope) free.push(0);
  if (!fixedStart.second) free.push(1);
  if (!second || delta1 !== 0) free.push(2, 3);
  for (const i of free) u[i] = ANCHOR_CENTRE[i];

  const work = new Float64Array(6);
  const grad = [0, 0, 0, 0];
  /** Objective at u; fills grad with a supergradient. */
  const objective = () => {
    quinticCoeffs(1, 0, 1, u[0], u[2], u[1], u[3], work);
    const r0 = quarticExtrema(work[1], 2 * work[2], 3 * work[3], 4 * work[4], 5 * work[5]);
    let f = r0.min;
    for (let j = 0; j < 4; j++) grad[j] = quinticSlope(BASIS, 6 * j, r0.tMin);
    if (second && delta1 !== 0) {
      quinticCoeffs(1, 0, 1, kc * u[2], 0, ke * u[3], 0, work);
      const r1 = quarticExtrema(work[1], 2 * work[2], 3 * work[3], 4 * work[4], 5 * work[5]);
      if (r1.min < f) {
        f = r1.min;
        grad[0] = 0;
        grad[1] = 0;
        grad[2] = kc * quinticSlope(BASIS, 0, r1.tMin);
        grad[3] = ke * quinticSlope(BASIS, 6, r1.tMin);
      }
    }
    return f;
  };

  const m = free.length;
  const P = new Float64Array(m * m);
  free.forEach((i, j) => {
    P[j * m + j] = m * ANCHOR_HALF_WIDTH[i] ** 2;
  });
  const g = new Float64Array(m);
  const Pg = new Float64Array(m);
  let best = -Infinity;
  const bestU = u.slice();
  for (let it = 0; it < ANCHOR_STEPS; it++) {
    const f = objective();
    if (f > best) {
      best = f;
      for (let j = 0; j < 4; j++) bestU[j] = u[j];
    }
    // An objective of 0 is monotone; stop there within rounding.
    if (best >= -1e-2 * MONOTONE_TOLERANCE || m === 0) break;
    let gPg = 0;
    for (let r = 0; r < m; r++) g[r] = grad[free[r]];
    for (let r = 0; r < m; r++) {
      let v = 0;
      for (let c = 0; c < m; c++) v += P[r * m + c] * g[c];
      Pg[r] = v;
      gPg += g[r] * v;
    }
    if (!(gPg > 0)) break;
    const gamma = Math.sqrt(gPg);
    // Upper bound of the objective in the ellipsoid: no monotone setting.
    if (f + gamma < -MONOTONE_TOLERANCE) break;
    // Deep cut: keep the part of the ellipsoid where the objective can reach best.
    const alpha = (best - f) / gamma;
    if (alpha >= 1) break;
    const step = (1 + m * alpha) / (m + 1);
    for (let r = 0; r < m; r++) u[free[r]] += (step * Pg[r]) / gamma;
    if (m === 1) {
      P[0] *= ((1 - alpha) / 2) ** 2;
    } else {
      const scale = (m * m * (1 - alpha * alpha)) / (m * m - 1);
      const w = (2 * (1 + m * alpha)) / ((m + 1) * (1 + alpha) * gPg);
      for (let r = 0; r < m; r++) {
        for (let c = 0; c <= r; c++) {
          const v = scale * (P[r * m + c] - w * Pg[r] * Pg[c]);
          P[r * m + c] = v;
          P[c * m + r] = v;
        }
      }
    }
  }
  if (!(best >= -MONOTONE_TOLERANCE)) return null;

  const td = new Float64Array(n);
  const ts = new Float64Array(n);
  td[0] = fixedStart.slope ? d[0] : (bestU[0] * delta0) / h0;
  ts[0] = fixedStart.second ? s[0] : (bestU[1] * delta0) / (h0 * h0);
  td[1] = (bestU[2] * delta0) / h0;
  ts[1] = (bestU[3] * delta0) / (h0 * h0);
  // Check in the units of the curve, with the tolerance of the shape check.
  if (!isMonotone(h0, y[0], y[1], td[0], td[1], ts[0], ts[1], range, work)) return null;
  if (second && !isMonotone(h1, y[1], y[2], td[1], 0, ts[1], 0, range, work)) return null;
  return { d: td, s: ts };
}

/**
 * Integral of q from 0 to t, in units of F·(fraction of the interval).
 * @param {Float64Array} c
 * @param {number} o offset of the interval coefficients
 * @param {number} t
 */
function antiderivative(c, o, t) {
  return t * (c[o] + t * (c[o + 1] / 2 + t * (c[o + 2] / 3 + t * (c[o + 3] / 4 + t * (c[o + 4] / 5 + t * (c[o + 5] / 6))))));
}

/**
 * Index i of the interval [x_i, x_(i+1)] that contains x.
 * @param {Float64Array} knots
 * @param {number} x
 */
function locate(knots, x) {
  let lo = 0;
  let hi = knots.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (knots[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Attach evaluation methods to interpolant data.
 * @param {CurveData} data
 * @returns {Curve}
 */
export function fromCurveData(data) {
  const { knots, coeffs, cumulative } = data;
  const x0 = knots[0];
  const xn = knots[knots.length - 1];

  /** @param {number} x */
  function clampToRange(x) {
    if (!(x >= x0 - RANGE_TOLERANCE && x <= xn + RANGE_TOLERANCE)) {
      throw new RangeError(`x = ${x} m is outside the curve range [${x0}, ${xn}] m`);
    }
    return Math.min(Math.max(x, x0), xn);
  }

  /** @param {number} xIn */
  function local(xIn) {
    const x = clampToRange(xIn);
    const i = locate(knots, x);
    const h = knots[i + 1] - knots[i];
    return { i, h, t: (x - knots[i]) / h, o: 6 * i };
  }

  /** @param {number} x */
  function evaluate(x) {
    const { t, o } = local(x);
    const c = coeffs;
    return c[o] + t * (c[o + 1] + t * (c[o + 2] + t * (c[o + 3] + t * (c[o + 4] + t * c[o + 5]))));
  }

  /**
   * @param {number} x
   * @param {1 | 2} [order=1]
   */
  function derivative(x, order = 1) {
    const { h, t, o } = local(x);
    const c = coeffs;
    if (order === 1) {
      return (c[o + 1] + t * (2 * c[o + 2] + t * (3 * c[o + 3] + t * (4 * c[o + 4] + t * 5 * c[o + 5])))) / h;
    }
    if (order === 2) {
      return (2 * c[o + 2] + t * (6 * c[o + 3] + t * (12 * c[o + 4] + t * 20 * c[o + 5]))) / (h * h);
    }
    throw new RangeError(`Derivative order must be 1 or 2, got ${order}`);
  }

  /** @param {number} x */
  function primitive(x) {
    const { i, h, t, o } = local(x);
    return cumulative[i] + h * antiderivative(coeffs, o, t);
  }

  /**
   * @param {number} a
   * @param {number} b
   */
  function integral(a, b) {
    return primitive(b) - primitive(a);
  }

  /** @param {number} count */
  function sample(count) {
    if (!Number.isInteger(count) || count < 2) throw new RangeError('sample needs an integer count of at least 2');
    const xs = new Float64Array(count);
    const fs = new Float64Array(count);
    for (let j = 0; j < count; j++) {
      xs[j] = j === count - 1 ? xn : x0 + ((xn - x0) * j) / (count - 1);
      fs[j] = evaluate(xs[j]);
    }
    return { x: xs, F: fs };
  }

  return { ...data, evaluate, derivative, integral, sample };
}

/**
 * Plain data of a curve, without methods, for transfer to a worker.
 * @param {CurveData} curve
 * @returns {CurveData}
 */
export function toCurveData(curve) {
  const { knots, values, slopes, second, coeffs, cumulative, shapePreserved } = curve;
  return { knots, values, slopes, second, coeffs, cumulative, shapePreserved };
}

/**
 * Create the C2 shape-preserving interpolant of a force curve.
 * @param {ReadonlyArray<CurvePoint>} points strictly increasing x, at least 2
 * @param {CurveOptions} [options] prescribed start slope and second
 *   derivative; they take precedence over shape preservation on the first
 *   interval
 * @returns {Curve}
 */
export function createCurve(points, options) {
  return fromCurveData(buildCurveData(points, options));
}
