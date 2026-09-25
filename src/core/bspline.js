/**
 * Clamped cubic non-rational B-splines of cam tracks, the curve form of the
 * export. Knots: the first 4 equal, the last 4 equal, knot count = control
 * point count + 4. The parameter u is the track angle ψ measured from the
 * start of the curve (rad), so u ≈ ψ − ψ_start; a closed curve spans
 * [ψ_0, ψ_0 + 2π], its last control point is a copy of the first and its
 * end tangent equals its start tangent.
 *
 * A track is the envelope of the lines X·n(ψ) = p(ψ) with n = (cos ψ, sin ψ),
 * t = (−sin ψ, cos ψ): X = p·n + p'·t, dX/dψ = ρ·t with ρ = p + p''.
 * {@link fitSupport} fits a track by
 * - Hermite cubic pieces with the exact end tangents on the knots of a
 *   spline track (Bézier form, triple interior knots, C1 in u): the radius
 *   of curvature of such a track is only C0 at its knots, where a C2 fit
 *   would add inflections;
 * - a C2 cubic interpolant with exact end tangents on uniform knots for the
 *   other tracks, refined until it is convex and within tolerance.
 * Lengths in m, angles in rad.
 * @module core/bspline
 */

import { describeError } from './errors.js';
import { createSupport } from './support.js';

/** @typedef {import('./support.js').SupportData} SupportData */
/** @typedef {import('./support.js').Support} Support */

/**
 * @typedef {object} BSpline
 * @property {3} degree
 * @property {Float64Array} knots clamped, non-decreasing (rad)
 * @property {Float64Array} points control points, x and y interleaved (m)
 * @property {boolean} closed last control point equals the first
 * @property {number} maxDeviation largest normal distance from the track
 *   found at the check points (m)
 */

/** Tolerance of the export along the track normal: 0.01 mm (m, PLAN § Numerics). */
export const EXPORT_TOLERANCE = 1e-5;

/** One turn (rad). */
const TURN = 2 * Math.PI;
/** Largest difference between ψ_end − ψ_start and 2π for a closed curve (rad). */
const CLOSED_TOLERANCE = 1e-9;
/** Shortfall of the radius of curvature below the smallest ρ of the track that a fit may keep (m). */
const RHO_SHORTFALL = 1e-6;
/** Check points per knot interval, both ends included, minus 1. */
const CHECKS = 8;
/** Uniform interval counts of the C2 interpolant. */
const INTERVALS_START = 16;
const INTERVALS_MAX = 4096;
/** Halvings of a Hermite piece that fails the checks. */
const SPLIT_ROUNDS = 12;
/** Track knots closer than this to an end of the range are skipped (rad). */
const KNOT_MARGIN = 1e-9;
/** Iterations of the foot-point search. */
const FOOT_ITERATIONS = 200;

// Scratch arrays of the basis computation: nonzero basis functions of
// degree 1, 2 and 3 on the current span.
const LEFT = new Float64Array(4);
const RIGHT = new Float64Array(4);
const N1 = new Float64Array(2);
const N2 = new Float64Array(3);
const N3 = new Float64Array(4);

/**
 * Index `span` of the knot interval [knots[span], knots[span + 1]) that
 * contains u, with 3 ≤ span ≤ count − 1 (count = knots.length − 4 control
 * points); u at or beyond the last knot gives the last non-empty span, u
 * before the first knot the first.
 * @param {ArrayLike<number>} knots clamped knot vector of a cubic spline
 * @param {number} u
 * @returns {number}
 */
export function findSpan(knots, u) {
  const n = knots.length - 5;
  if (u >= knots[n + 1]) return n;
  if (u <= knots[3]) return 3;
  let lo = 3;
  let hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

/**
 * Cox–de Boor triangle on a non-empty span: fills N1, N2 and N3 with the
 * nonzero basis functions of degree 1, 2 and 3 at u.
 * @param {ArrayLike<number>} knots
 * @param {number} span
 * @param {number} u
 */
function basisLevels(knots, span, u) {
  N3[0] = 1;
  for (let j = 1; j <= 3; j++) {
    LEFT[j] = u - knots[span + 1 - j];
    RIGHT[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N3[r] / (RIGHT[r + 1] + LEFT[j - r]);
      N3[r] = saved + RIGHT[r + 1] * temp;
      saved = LEFT[j - r] * temp;
    }
    N3[j] = saved;
    if (j === 1) N1.set(N3.subarray(0, 2));
    else if (j === 2) N2.set(N3.subarray(0, 3));
  }
}

/**
 * The four nonzero cubic basis functions N_(span−3) … N_span at u
 * (Cox–de Boor), written to out[0 … 3]. The span must be non-empty, as
 * {@link findSpan} returns it.
 * @param {ArrayLike<number>} knots
 * @param {number} span
 * @param {number} u
 * @param {Float64Array} out length at least 4
 * @returns {Float64Array} out
 */
export function basisFunctions(knots, span, u, out) {
  basisLevels(knots, span, u);
  out.set(N3);
  return out;
}

/**
 * Point and derivatives of the spline on a given non-empty span; u may lie
 * at either end of it, so the left and right limits at a knot are both
 * available.
 * @param {BSpline} spline
 * @param {number} span
 * @param {number} u
 * @param {Float64Array} out x, y, dx/du, dy/du, d²x/du², d²y/du²
 */
function evaluateOnSpan(spline, span, u, out) {
  const { knots, points: P } = spline;
  basisLevels(knots, span, u);
  let x = 0;
  let y = 0;
  for (let r = 0; r < 4; r++) {
    const j = span - 3 + r;
    x += N3[r] * P[2 * j];
    y += N3[r] * P[2 * j + 1];
  }
  // First differences Q_j = 3·(P_j − P_(j−1))/(u_(j+3) − u_j), j = span−2 … span.
  let qx0 = 0;
  let qy0 = 0;
  let dx = 0;
  let dy = 0;
  let ddx = 0;
  let ddy = 0;
  for (let r = 0; r < 3; r++) {
    const j = span - 2 + r;
    const w = 3 / (knots[j + 3] - knots[j]);
    const qx = w * (P[2 * j] - P[2 * j - 2]);
    const qy = w * (P[2 * j + 1] - P[2 * j - 1]);
    dx += N2[r] * qx;
    dy += N2[r] * qy;
    if (r > 0) {
      // R_j = 2·(Q_j − Q_(j−1))/(u_(j+2) − u_j), j = span−1 … span.
      const v = 2 / (knots[j + 2] - knots[j]);
      ddx += N1[r - 1] * v * (qx - qx0);
      ddy += N1[r - 1] * v * (qy - qy0);
    }
    qx0 = qx;
    qy0 = qy;
  }
  out[0] = x;
  out[1] = y;
  out[2] = dx;
  out[3] = dy;
  if (out.length >= 6) {
    out[4] = ddx;
    out[5] = ddy;
  }
  return out;
}

/**
 * Point and first derivative of the spline at u, clamped to the knot range:
 * x, y (m) and dx/du, dy/du (m/rad) to out[0 … 3]; when out has room, also
 * d²x/du², d²y/du² to out[4], out[5]. At a knot the span to the right is
 * used (the left one at the last knot).
 * @param {BSpline} spline
 * @param {number} u (rad)
 * @param {Float64Array} out length at least 4
 * @returns {Float64Array} out
 */
export function evaluate(spline, u, out) {
  const { knots } = spline;
  const v = Math.min(Math.max(u, knots[0]), knots[knots.length - 1]);
  return evaluateOnSpan(spline, findSpan(knots, v), v, out);
}

/**
 * Largest singular value of the matrix [[a, b], [c, d]], the largest factor
 * by which the linear map stretches a length.
 * @param {number} a @param {number} b @param {number} c @param {number} d
 */
function stretch(a, b, c, d) {
  const t = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  return Math.sqrt((t + Math.sqrt(Math.max(t * t - 4 * det * det, 0))) / 2);
}

/**
 * Image of the spline under the affine map (x, y) → (a·x + b·y + e,
 * c·x + d·y + f), exact because B-splines are affine invariant: same knots,
 * mapped control points. A closed spline stays closed exactly. maxDeviation
 * is scaled by the largest stretch of the map (unchanged for rotations and
 * mirrors).
 * @param {BSpline} spline
 * @param {number} a @param {number} b @param {number} c @param {number} d linear part
 * @param {number} e @param {number} f translation (m)
 * @returns {BSpline}
 */
export function transform(spline, a, b, c, d, e, f) {
  const src = spline.points;
  const points = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 2) {
    const x = src[i];
    const y = src[i + 1];
    points[i] = a * x + b * y + e;
    points[i + 1] = c * x + d * y + f;
  }
  return {
    degree: 3,
    knots: Float64Array.from(spline.knots),
    points,
    closed: spline.closed,
    maxDeviation: spline.maxDeviation * stretch(a, b, c, d),
  };
}

/**
 * Open splines joined end to start into one open spline. Each join is a
 * triple knot (C0); the knots of each piece are shifted so that the
 * parameter continues where the previous piece ends. The join takes the
 * end point of the earlier piece and drops the start point of the later
 * one. maxDeviation is the largest of the pieces. Throws RangeError for an
 * empty list or a closed or malformed piece (a programming error).
 * @param {BSpline[]} pieces
 * @returns {BSpline}
 */
export function concat(pieces) {
  if (!Array.isArray(pieces) || pieces.length === 0) throw new RangeError('concat needs at least one spline');
  let pointCount = 0;
  for (const s of pieces) {
    const n = s.points.length / 2;
    if (s.closed || !Number.isInteger(n) || n < 4 || s.knots.length !== n + 4) {
      throw new RangeError('concat joins open cubic splines with knot count = control point count + 4');
    }
    pointCount += n;
  }
  pointCount -= pieces.length - 1;
  const points = new Float64Array(2 * pointCount);
  const knots = new Float64Array(pointCount + 4);
  let p = 0;
  let k = 0;
  let shift = 0;
  let maxDeviation = 0;
  pieces.forEach((s, index) => {
    const first = index === 0;
    const last = index === pieces.length - 1;
    const n = s.points.length / 2;
    const src = s.knots;
    shift = first ? 0 : shift - src[0];
    // Knots: all of the first piece's leading four, then the interior, then
    // three copies of the end (four for the last piece).
    const from = first ? 0 : 4;
    const to = last ? n + 4 : n + 3;
    for (let i = from; i < to; i++) knots[k++] = src[i] + shift;
    points.set(s.points.subarray(first ? 0 : 2), p);
    p += first ? 2 * n : 2 * n - 2;
    shift += src[n + 3];
    maxDeviation = Math.max(maxDeviation, s.maxDeviation);
  });
  return { degree: 3, knots, points, closed: false, maxDeviation };
}

/**
 * Signed normal distance d = S·n(ψ*) − p(ψ*) of the point S = (x, y) from a
 * convex track, positive outside. ψ* solves g(ψ) = S·t(ψ) − p'(ψ) = 0 (the
 * foot of the normal through S); g' = −(S·n + p''), about −ρ near the
 * track. Safeguarded Newton iteration inside [psiGuess − h, psiGuess + h],
 * falling back to bisection; without a sign change of g in that bracket the
 * end with the smaller |g| is used. Returns NaN for non-finite input.
 * @param {Support} support
 * @param {number} x (m)
 * @param {number} y (m)
 * @param {number} psiGuess (rad)
 * @param {number} h half width of the bracket (rad), positive
 * @returns {number} (m)
 */
export function normalDistance(support, x, y, psiGuess, h) {
  if (![x, y, psiGuess, h].every(Number.isFinite) || !(h > 0)) return NaN;
  const buf = new Float64Array(3);
  /** @param {number} psi */
  const g = (psi) => {
    support.evaluate(psi, buf);
    return -x * Math.sin(psi) + y * Math.cos(psi) - buf[1];
  };
  let a = psiGuess - h;
  let b = psiGuess + h;
  const ga = g(a);
  const gb = g(b);
  /** @type {number} */
  let psi;
  if (ga === 0) psi = a;
  else if (gb === 0) psi = b;
  else if (Math.sign(ga) === Math.sign(gb) || !Number.isFinite(ga) || !Number.isFinite(gb)) {
    psi = Math.abs(ga) <= Math.abs(gb) ? a : b;
  } else {
    // Keep g(a) and g(b) of opposite signs.
    const signA = Math.sign(ga);
    psi = psiGuess;
    let step = b - a;
    for (let i = 0; i < FOOT_ITERATIONS; i++) {
      const gv = g(psi);
      if (gv === 0) break;
      if (Math.sign(gv) === signA) a = psi;
      else b = psi;
      const c = Math.cos(psi);
      const s = Math.sin(psi);
      const slope = -(x * c + y * s + buf[2]);
      let next = psi - gv / slope;
      const newton = next > a && next < b && Math.abs(next - psi) <= step / 2;
      if (!newton) next = (a + b) / 2;
      step = Math.abs(next - psi);
      psi = next;
      if (step <= 1e-15 * (1 + Math.abs(psi)) || b - a <= 1e-15 * (1 + Math.abs(psi))) break;
    }
  }
  support.evaluate(psi, buf);
  return x * Math.cos(psi) + y * Math.sin(psi) - buf[0];
}

/**
 * Support data under any 'offset' wrappers, with the sum of their deltas.
 * @param {SupportData} data
 * @returns {{ root: SupportData, delta: number }}
 */
function rootOf(data) {
  let delta = 0;
  let d = data;
  while (d.kind === 'offset') {
    delta += d.delta;
    d = d.base;
  }
  return { root: d, delta };
}

/**
 * Circle of a track whose root kind is 'eccentric' (possibly under
 * offsets, which add to the radius): p = r + e·cos(ψ − φ) is the circle of
 * radius r centred at e·(cos φ, sin φ). null for other kinds and for
 * malformed data. Never throws.
 * @param {SupportData} supportData
 * @returns {{ cx: number, cy: number, r: number } | null} (m)
 */
export function supportCircle(supportData) {
  try {
    const { root, delta } = rootOf(supportData);
    if (root.kind !== 'eccentric') return null;
    const circle = { cx: root.offset * Math.cos(root.phase), cy: root.offset * Math.sin(root.phase), r: root.radius + delta };
    return [circle.cx, circle.cy, circle.r].every(Number.isFinite) ? circle : null;
  } catch {
    // Unreadable data has no circle.
    return null;
  }
}

/**
 * Contact point X and its derivative X' = ρ·t of the track at ψ.
 * @param {Support} support
 * @param {number} psi
 * @param {Float64Array} buf scratch of length 3
 * @returns {[number, number, number, number]} x, y, dx/dψ, dy/dψ
 */
function trackPoint(support, psi, buf) {
  support.evaluate(psi, buf);
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const rho = buf[0] + buf[2];
  return [buf[0] * c - buf[1] * s, buf[0] * s + buf[1] * c, -rho * s, rho * c];
}

/**
 * Sets the end of a closed spline: last control point a copy of the first,
 * end tangent equal to the start tangent.
 * @param {Float64Array} P control points
 * @param {Float64Array} knots
 */
function closeEnds(P, knots) {
  const m = P.length / 2 - 1;
  const hFirst = knots[4] - knots[3];
  const hLast = knots[m + 1] - knots[m];
  P[2 * m] = P[0];
  P[2 * m + 1] = P[1];
  const ratio = hLast / hFirst;
  const tx = ratio === 1 ? P[2] - P[0] : ratio * (P[2] - P[0]);
  const ty = ratio === 1 ? P[3] - P[1] : ratio * (P[3] - P[1]);
  P[2 * m - 2] = P[0] - tx;
  P[2 * m - 1] = P[1] - ty;
}

/**
 * Checks each non-empty knot interval at CHECKS + 1 points, both ends
 * included: normal distance within tol/2, cross(S', S'') > 0 and radius of
 * curvature at least rhoMin − RHO_SHORTFALL.
 * @param {BSpline} spline
 * @param {Support} support
 * @param {number} psiStart
 * @param {number} rhoMin
 * @param {number} tol
 * @returns {{ spans: number[], failed: boolean[], maxDeviation: number }}
 */
function checkSpline(spline, support, psiStart, rhoMin, tol) {
  const { knots } = spline;
  const count = knots.length - 4;
  const out = new Float64Array(6);
  const spans = [];
  const failed = [];
  let maxDeviation = 0;
  for (let span = 3; span < count; span++) {
    const ua = knots[span];
    const ub = knots[span + 1];
    if (!(ub > ua)) continue;
    const h = ub - ua;
    const bracket = Math.min(Math.max(2 * h, 1e-3), 0.5);
    let bad = false;
    for (let k = 0; k <= CHECKS; k++) {
      const u = k === CHECKS ? ub : ua + (h * k) / CHECKS;
      evaluateOnSpan(spline, span, u, out);
      const d = Math.abs(normalDistance(support, out[0], out[1], psiStart + u, bracket));
      const cross = out[2] * out[5] - out[3] * out[4];
      const speed = Math.hypot(out[2], out[3]);
      const radius = (speed * speed * speed) / cross;
      if (!(d <= maxDeviation)) maxDeviation = Number.isFinite(d) ? d : Infinity;
      if (!(d <= tol / 2 && cross > 0 && radius >= rhoMin - RHO_SHORTFALL)) bad = true;
    }
    spans.push(span);
    failed.push(bad);
  }
  return { spans, failed, maxDeviation };
}

/**
 * Bézier-form spline of Hermite pieces through the track points at the
 * breakpoints, with the exact tangents X' there.
 * @param {Support} support
 * @param {number[]} psi breakpoints, increasing
 * @param {boolean} closed
 * @returns {BSpline}
 */
function hermiteSpline(support, psi, closed) {
  const M = psi.length - 1;
  const knots = new Float64Array(3 * M + 5);
  const P = new Float64Array(2 * (3 * M + 1));
  const buf = new Float64Array(3);
  const u0 = psi[0];
  let prev = trackPoint(support, psi[0], buf);
  P[0] = prev[0];
  P[1] = prev[1];
  knots.fill(0, 0, 4);
  for (let i = 0; i < M; i++) {
    const h = psi[i + 1] - psi[i];
    const next = trackPoint(support, psi[i + 1], buf);
    const o = 6 * i;
    P[o + 2] = prev[0] + (h / 3) * prev[2];
    P[o + 3] = prev[1] + (h / 3) * prev[3];
    P[o + 4] = next[0] - (h / 3) * next[2];
    P[o + 5] = next[1] - (h / 3) * next[3];
    P[o + 6] = next[0];
    P[o + 7] = next[1];
    const u = psi[i + 1] - u0;
    const copies = i === M - 1 ? 4 : 3;
    knots.fill(u, 4 + 3 * i, 4 + 3 * i + copies);
    prev = next;
  }
  if (closed) closeEnds(P, knots);
  return { degree: 3, knots, points: P, closed, maxDeviation: 0 };
}

/**
 * Knots of a spline track strictly inside (start, end), with the two ends,
 * repeating the knots of a periodic spline with its period.
 * @param {import('./support.js').SplineData} root
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function trackBreakpoints(root, start, end) {
  const { knots, periodic } = root;
  const n = knots.length - 1;
  const period = knots[n] - knots[0];
  const inside = (/** @type {number} */ v) => v > start + KNOT_MARGIN && v < end - KNOT_MARGIN;
  const result = [start];
  if (periodic) {
    const first = Math.floor((start - knots[0]) / period);
    const last = Math.ceil((end - knots[0]) / period);
    for (let m = first; m <= last; m++) {
      for (let i = 0; i < n; i++) {
        const v = knots[i] + m * period;
        if (inside(v)) result.push(v);
      }
    }
  } else {
    for (let i = 0; i <= n; i++) if (inside(knots[i])) result.push(knots[i]);
  }
  result.push(end);
  return result;
}

/**
 * Hermite fit on the knots of a spline track, halving pieces that fail the
 * checks.
 * @param {Support} support
 * @param {import('./support.js').SplineData} root
 * @param {number} start
 * @param {number} end
 * @param {boolean} closed
 * @param {number} rhoMin
 * @param {number} tol
 * @returns {{ spline: BSpline | null, error: string | null }}
 */
function fitHermite(support, root, start, end, closed, rhoMin, tol) {
  let psi = trackBreakpoints(root, start, end);
  for (let round = 0; round <= SPLIT_ROUNDS; round++) {
    const spline = hermiteSpline(support, psi, closed);
    const check = checkSpline(spline, support, start, rhoMin, tol);
    if (!check.failed.includes(true)) {
      spline.maxDeviation = check.maxDeviation;
      return { spline, error: null };
    }
    /** @type {number[]} */
    const refined = [];
    for (let i = 0; i < psi.length - 1; i++) {
      refined.push(psi[i]);
      if (check.failed[i]) refined.push((psi[i] + psi[i + 1]) / 2);
    }
    refined.push(psi[psi.length - 1]);
    psi = refined;
  }
  return { spline: null, error: `No convex B-spline within ${tol} m of the track after ${SPLIT_ROUNDS} halvings of its pieces` };
}

/**
 * Tridiagonal solve (Thomas algorithm) for two right-hand sides; a: sub-,
 * b: main, c: super-diagonal. rx and ry are overwritten with the solution.
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @param {Float64Array} c
 * @param {Float64Array} rx
 * @param {Float64Array} ry
 */
function thomas(a, b, c, rx, ry) {
  const n = b.length;
  const cp = new Float64Array(n);
  let beta = b[0];
  rx[0] /= beta;
  ry[0] /= beta;
  for (let i = 1; i < n; i++) {
    cp[i - 1] = c[i - 1] / beta;
    beta = b[i] - a[i] * cp[i - 1];
    rx[i] = (rx[i] - a[i] * rx[i - 1]) / beta;
    ry[i] = (ry[i] - a[i] * ry[i - 1]) / beta;
  }
  for (let i = n - 2; i >= 0; i--) {
    rx[i] -= cp[i] * rx[i + 1];
    ry[i] -= cp[i] * ry[i + 1];
  }
}

/**
 * C2 cubic interpolant of the track on N uniform intervals of [start, end]
 * with the exact end tangents ('complete' spline).
 * @param {Support} support
 * @param {number} start
 * @param {number} end
 * @param {number} N intervals, at least 2
 * @param {boolean} closed
 * @returns {BSpline}
 */
function completeSpline(support, start, end, N, closed) {
  const L = end - start;
  const h = L / N;
  const count = N + 3;
  const knots = new Float64Array(count + 4);
  for (let i = 0; i <= N; i++) knots[i + 3] = i === N ? L : (i * L) / N;
  knots.fill(L, N + 3);
  const P = new Float64Array(2 * count);
  const buf = new Float64Array(3);
  const first = trackPoint(support, start, buf);
  const last = trackPoint(support, end, buf);
  P[0] = first[0];
  P[1] = first[1];
  P[2] = first[0] + (h / 3) * first[2];
  P[3] = first[1] + (h / 3) * first[3];
  const m = count - 1;
  P[2 * m] = last[0];
  P[2 * m + 1] = last[1];
  P[2 * m - 2] = last[0] - (h / 3) * last[2];
  P[2 * m - 1] = last[1] - (h / 3) * last[3];
  if (closed) closeEnds(P, knots);
  // Rows i = 1 … N−1: N_i·P_i + N_(i+1)·P_(i+1) + N_(i+2)·P_(i+2) = X(ψ_i);
  // unknowns P_2 … P_N.
  const size = N - 1;
  const a = new Float64Array(size);
  const b = new Float64Array(size);
  const c = new Float64Array(size);
  const rx = new Float64Array(size);
  const ry = new Float64Array(size);
  const basis = new Float64Array(4);
  for (let i = 1; i < N; i++) {
    const u = knots[i + 3];
    basisFunctions(knots, i + 3, u, basis);
    const X = trackPoint(support, start + u, buf);
    const r = i - 1;
    a[r] = basis[0];
    b[r] = basis[1];
    c[r] = basis[2];
    rx[r] = X[0];
    ry[r] = X[1];
    if (i === 1) {
      rx[r] -= basis[0] * P[2];
      ry[r] -= basis[0] * P[3];
    }
    if (i === N - 1) {
      rx[r] -= basis[2] * P[2 * N + 2];
      ry[r] -= basis[2] * P[2 * N + 3];
    }
  }
  thomas(a, b, c, rx, ry);
  for (let r = 0; r < size; r++) {
    P[2 * (r + 2)] = rx[r];
    P[2 * (r + 2) + 1] = ry[r];
  }
  return { degree: 3, knots, points: P, closed, maxDeviation: 0 };
}

/**
 * C2 interpolants on 16, 32, … 4096 uniform intervals until one passes the
 * checks.
 * @param {Support} support
 * @param {number} start
 * @param {number} end
 * @param {boolean} closed
 * @param {number} rhoMin
 * @param {number} tol
 * @returns {{ spline: BSpline | null, error: string | null }}
 */
function fitUniform(support, start, end, closed, rhoMin, tol) {
  for (let N = INTERVALS_START; N <= INTERVALS_MAX; N *= 2) {
    const spline = completeSpline(support, start, end, N, closed);
    const check = checkSpline(spline, support, start, rhoMin, tol);
    if (!check.failed.includes(true)) {
      spline.maxDeviation = check.maxDeviation;
      return { spline, error: null };
    }
  }
  return { spline: null, error: `No convex B-spline within ${tol} m of the track with ${INTERVALS_MAX} intervals` };
}

/**
 * Body of {@link fitSupport}, which guards it.
 * @param {SupportData} supportData
 * @param {number} psiStart
 * @param {number} psiEnd
 * @param {number} tol
 * @returns {{ spline: BSpline | null, error: string | null }}
 */
function fitSupportChecked(supportData, psiStart, psiEnd, tol) {
  if (!Number.isFinite(psiStart) || !Number.isFinite(psiEnd) || !(psiEnd > psiStart)) {
    return { spline: null, error: 'A track fit needs finite angles with psiEnd above psiStart' };
  }
  if (psiEnd - psiStart > TURN + CLOSED_TOLERANCE) return { spline: null, error: 'A track fit covers at most one turn' };
  if (!(Number.isFinite(tol) && tol > 0)) return { spline: null, error: 'A track fit needs a finite, positive tolerance' };
  const support = createSupport(supportData);
  if (psiStart < support.min || psiEnd > support.max) {
    return { spline: null, error: `The fit range [${psiStart}, ${psiEnd}] rad lies outside the track range [${support.min}, ${support.max}] rad` };
  }
  const { root } = rootOf(supportData);
  // Only a periodic track closes; an open spline track over one turn gives an open curve.
  const periodic = root.kind !== 'spline' || root.periodic;
  const closed = periodic && Math.abs(psiEnd - psiStart - TURN) <= CLOSED_TOLERANCE;
  const end = closed ? psiStart + TURN : psiEnd;
  const rhoMin = support.minRho(psiStart, end).value;
  if (!(rhoMin > 0)) return { spline: null, error: 'The track is not strictly convex on the fit range' };
  if (root.kind === 'spline') return fitHermite(support, root, psiStart, end, closed, rhoMin, tol);
  return fitUniform(support, psiStart, end, closed, rhoMin, tol);
}

/**
 * Clamped cubic B-spline of the track on [psiStart, psiEnd] whose normal
 * distance from the track is at most tol/2 and whose radius of curvature
 * is at least the smallest ρ of the track minus 1e-6 m at the check points
 * (9 per knot interval); a range of 2π (to 1e-9 rad) on a periodic track
 * (every kind but an open spline) gives a closed curve.
 * Never throws: invalid input and failed fits give { spline: null, error }.
 * @param {SupportData} supportData plain track data
 * @param {number} psiStart (rad)
 * @param {number} psiEnd (rad), above psiStart, at most one turn from it
 * @param {number} tol (m), finite and positive
 * @returns {{ spline: BSpline | null, error: string | null }}
 */
export function fitSupport(supportData, psiStart, psiEnd, tol) {
  try {
    return fitSupportChecked(supportData, psiStart, psiEnd, tol);
  } catch (err) {
    // Any exception while reading malformed input.
    return { spline: null, error: describeError(err) };
  }
}

/** Angle step of the grid that finds the arcs of a hull (rad). */
const HULL_GRID = (0.25 * Math.PI) / 180;
/** Hull arcs shorter than this are dropped (rad). */
const HULL_ARC_MIN = 1e-9;
/** Common tangents shorter than this are dropped (m). */
const HULL_LINE_MIN = 1e-9;
/** Angle step of the check that no hull arc was missed (rad). */
const HULL_CHECK_GRID = (0.005 * Math.PI) / 180;
/** Longest Hermite piece on a track without knots (rad). */
const HERMITE_STEP_MAX = Math.PI / 8;

/**
 * @typedef {object} HullArc
 * @property {number} index support that forms the hull on the arc
 * @property {number} start (rad)
 * @property {number} end (rad)
 */

/**
 * Index of the support with the largest p(ψ); the first on a tie.
 * @param {Support[]} supports
 * @param {number} psi
 */
function hullIndexAt(supports, psi) {
  let k = 0;
  let best = supports[0].p(psi);
  for (let i = 1; i < supports.length; i++) {
    const v = supports[i].p(psi);
    if (v > best) {
      best = v;
      k = i;
    }
  }
  return k;
}

/**
 * Arcs of the convex hull of several supports over [psi0, psi0 + 2π]: on
 * each arc one support gives h(ψ) = max p_k(ψ). Crossings come from a
 * 0.25° grid refined by bisection to rounding; arcs shorter than 1e-9 rad
 * are dropped.
 * @param {Support[]} supports
 * @param {number} psi0
 * @returns {HullArc[]}
 */
export function hullArcs(supports, psi0) {
  const n = Math.ceil(TURN / HULL_GRID);
  /** @type {HullArc[]} */
  const arcs = [];
  let index = hullIndexAt(supports, psi0);
  let start = psi0;
  /** @param {number} cross */
  const close = (cross) => {
    if (cross - start > HULL_ARC_MIN) arcs.push({ index, start, end: cross });
    else if (arcs.length > 0) arcs[arcs.length - 1].end = cross;
  };
  for (let i = 1; i <= n; i++) {
    const cellEnd = psi0 + (i * TURN) / n;
    const endIndex = hullIndexAt(supports, i === n ? psi0 : cellEnd);
    let a = psi0 + ((i - 1) * TURN) / n;
    // Every crossing inside the cell, in order: bisect to the first point
    // where the index changes, take the index just past it, go on.
    for (let guard = 0; index !== endIndex && guard < supports.length + 1; guard++) {
      let lo = a;
      let hi = cellEnd;
      for (let it = 0; it < 80 && hi - lo > 1e-15; it++) {
        const m = (lo + hi) / 2;
        if (hullIndexAt(supports, m) === index) lo = m;
        else hi = m;
      }
      const cross = (lo + hi) / 2;
      close(cross);
      index = hullIndexAt(supports, hi);
      start = cross;
      a = hi;
    }
  }
  const end = psi0 + TURN;
  if (end - start > HULL_ARC_MIN || arcs.length === 0) arcs.push({ index, start, end });
  else arcs[arcs.length - 1].end = end;
  return arcs;
}

/**
 * Largest amount by which any support exceeds the support assigned to the
 * arcs, on a 0.005° grid (m): an arc narrower than the search grid that
 * the scan missed shows here.
 * @param {Support[]} supports
 * @param {HullArc[]} arcs
 */
function hullMiss(supports, arcs) {
  const n = Math.ceil(TURN / HULL_CHECK_GRID);
  let worst = 0;
  let k = 0;
  const psi0 = arcs[0].start;
  for (let i = 0; i < n; i++) {
    const psi = psi0 + (i * TURN) / n;
    while (k < arcs.length - 1 && psi > arcs[k].end) k++;
    const own = supports[arcs[k].index].p(psi);
    for (const s of supports) worst = Math.max(worst, s.p(psi) - own);
  }
  return worst;
}

/**
 * Open Hermite fit of a track on [start, end]: breakpoints on the knots of
 * a spline track, else at most π/8 apart; pieces that fail the checks are
 * halved.
 * @param {Support} support
 * @param {SupportData} data
 * @param {number} start
 * @param {number} end
 * @param {number} tol
 * @returns {{ spline: BSpline | null, error: string | null }}
 */
function fitArc(support, data, start, end, tol) {
  const { root } = rootOf(data);
  /** @type {number[]} */
  let psi;
  if (root.kind === 'spline') psi = trackBreakpoints(root, start, end);
  else {
    const count = Math.max(1, Math.ceil((end - start) / HERMITE_STEP_MAX));
    psi = Array.from({ length: count + 1 }, (_, i) => (i === count ? end : start + ((end - start) * i) / count));
  }
  const rhoMin = support.minRho(start, end).value;
  if (!(rhoMin > 0)) return { spline: null, error: 'A hull arc is not strictly convex' };
  for (let round = 0; round <= SPLIT_ROUNDS; round++) {
    const spline = hermiteSpline(support, psi, false);
    const check = checkSpline(spline, support, start, rhoMin, tol);
    if (!check.failed.includes(true)) {
      spline.maxDeviation = check.maxDeviation;
      return { spline, error: null };
    }
    /** @type {number[]} */
    const refined = [];
    for (let i = 0; i < psi.length - 1; i++) {
      refined.push(psi[i]);
      if (check.failed[i]) refined.push((psi[i] + psi[i + 1]) / 2);
    }
    refined.push(psi[psi.length - 1]);
    psi = refined;
  }
  return { spline: null, error: `No convex B-spline within ${tol} m of a hull arc after ${SPLIT_ROUNDS} halvings` };
}

/**
 * Exact straight cubic from P to Q along the common tangent at the
 * crossing angle ψ: knot interval Δu = 2L/(ρa + ρb), inner control points
 * P + (Δu/3)·ρa·t and Q − (Δu/3)·ρb·t, so the derivative matches the arcs
 * on both sides (C1 in u).
 * @param {number[]} P end of the arc before (x, y)
 * @param {number[]} Q start of the arc after
 * @param {number} psi crossing angle (rad)
 * @param {number} rhoA radius of curvature at P
 * @param {number} rhoB radius of curvature at Q
 * @returns {BSpline}
 */
function tangentLine(P, Q, psi, rhoA, rhoB) {
  const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
  const du = (2 * L) / (rhoA + rhoB);
  const tx = -Math.sin(psi);
  const ty = Math.cos(psi);
  const points = Float64Array.from([
    P[0], P[1],
    P[0] + (du / 3) * rhoA * tx, P[1] + (du / 3) * rhoA * ty,
    Q[0] - (du / 3) * rhoB * tx, Q[1] - (du / 3) * rhoB * ty,
    Q[0], Q[1],
  ]);
  return { degree: 3, knots: Float64Array.from([0, 0, 0, 0, du, du, du, du]), points, closed: false, maxDeviation: 0 };
}

/**
 * Closed cubic B-spline of the convex hull of several tracks (flanges and
 * boss discs) within tol/2 of the hull, starting at psi0: Hermite pieces on
 * each hull arc and an exact straight cubic on each common tangent, joined
 * C1 in u (triple interior knots). A hull made by one track over the whole
 * turn gives { spline: null, single: its index }: the caller reuses that
 * track's own curve. Never throws.
 * @param {SupportData[]} dataList
 * @param {number} psi0 start angle (rad), inside an arc of the first track
 * @param {number} tol (m)
 * @returns {{ spline: BSpline | null, single: number | null, error: string | null }}
 */
export function fitHull(dataList, psi0, tol) {
  try {
    if (!Array.isArray(dataList) || dataList.length === 0) return { spline: null, single: null, error: 'A hull needs at least one track' };
    if (!Number.isFinite(psi0) || !(Number.isFinite(tol) && tol > 0)) {
      return { spline: null, single: null, error: 'A hull fit needs a finite start angle and a positive tolerance' };
    }
    const supports = dataList.map((d) => createSupport(d));
    const arcs = hullArcs(supports, psi0);
    const miss = hullMiss(supports, arcs);
    if (miss > tol / 2) return { spline: null, single: null, error: `A hull arc of ${miss} m escaped the search grid` };
    if (arcs.length === 1) return { spline: null, single: arcs[0].index, error: null };
    /** @type {BSpline[]} */
    const pieces = [];
    const buf = new Float64Array(3);
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i];
      const fit = fitArc(supports[arc.index], dataList[arc.index], arc.start, arc.end, tol);
      if (!fit.spline) return { spline: null, single: null, error: fit.error };
      pieces.push(fit.spline);
      // After the last arc: a crossing exactly at the start angle needs the
      // common tangent back to the first arc to close the curve.
      const next = i === arcs.length - 1 ? arcs[0] : arcs[i + 1];
      if (next.index === arc.index) continue;
      const P = trackPoint(supports[arc.index], arc.end, buf);
      const Q = trackPoint(supports[next.index], arc.end, buf);
      if (Math.hypot(Q[0] - P[0], Q[1] - P[1]) > HULL_LINE_MIN) {
        const rhoA = supports[arc.index].rho(arc.end);
        const rhoB = supports[next.index].rho(arc.end);
        pieces.push(tangentLine(P, Q, arc.end, rhoA, rhoB));
      }
    }
    const spline = concat(pieces);
    const m = spline.points.length / 2 - 1;
    const gap = Math.hypot(spline.points[2 * m] - spline.points[0], spline.points[2 * m + 1] - spline.points[1]);
    if (!(gap <= CLOSED_TOLERANCE)) return { spline: null, single: null, error: `The hull does not close: gap ${gap} m` };
    spline.points[2 * m] = spline.points[0];
    spline.points[2 * m + 1] = spline.points[1];
    spline.closed = true;
    return { spline, single: null, error: null };
  } catch (err) {
    // Any exception while reading malformed input.
    return { spline: null, single: null, error: describeError(err) };
  }
}
