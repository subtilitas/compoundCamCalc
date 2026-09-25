/**
 * Constrained least-squares fit of a cable track: a clamped C2 cubic spline
 * p(ψ) on uniform knots over [ψ_0, ψ_1] (values at the knots and the two end
 * slopes are the unknowns, 20 to 40 of them) fitted to samples (ψ_i, p_i)
 * of the ideal track, subject to the linear constraints
 *
 *   p + p'' ≥ ρ_min   and   p ≥ p_min   on a dense grid of ψ,
 *
 * and optionally the linear equalities p(ψ_0) = p_0 (keeps the brace
 * tension) and, at the angles ψ_k of the curve points,
 *
 *   p(ψ_k) = p_k,   ∫ p dψ from ψ_0 to ψ_k = I_k,
 *
 * with which the cam reaches the target state of point k exactly: the
 * cable line at ψ_k passes through the anchor at the lever arm p_k, and the
 * integral closes the cable length (see core/inverse). The achieved force
 * then equals the target force and the draw energy at every such point.
 * A small penalty on the second differences of the knot values keeps the
 * problem strictly convex where samples are sparse. The quadratic programme
 * is solved by the dual active-set method of core/qp. Internally in mm.
 * @module core/fit
 */

import { ANGLE_MAX, KNOT_SPACING_MIN } from './domain.js';
import { solveQP } from './qp.js';
import { createSupport, cubicMin, splineSupport } from './support.js';

/** @typedef {import('./support.js').SplineData} SplineData */

/** Scale of the internal unit (1 mm). */
const MM = 1e-3;


/**
 * Largest number of exchange rounds: after each solve the exact minima of
 * ρ and p that fall below their limits between the grid points become
 * constraints, and the programme is solved again.
 */
const EXCHANGE_ROUNDS = 10;
/** Shortfall below a limit that the fitted track may keep: rounding (m). */
const LIMIT_TOLERANCE = 1e-9;

/** Largest difference between startValue and ends.start[0] that counts as one value (m). */
const START_TOLERANCE = 1e-12;

/** Largest number of knot intervals and of constraint points per interval. */
const MAX_INTERVALS = 200;
const MAX_GRID = 50;

/**
 * @typedef {object} FitInput
 * @property {ArrayLike<number>} psi sample angles (rad), any order
 * @property {ArrayLike<number>} p sample lever arms (m)
 * @property {number} start ψ_0 (rad)
 * @property {number} end ψ_1 (rad), larger than start
 * @property {number} rhoMin smallest radius of curvature (m)
 * @property {number} pMin smallest lever arm (m)
 * @property {number} [intervals] knot intervals, 1 to 200 (default: about one per 10°, 17 to 37)
 * @property {number} [startValue] prescribed p(ψ_0) (m); with `ends`, the
 *   two values of p(ψ_0) must agree to 1e-12 m, otherwise the fit is
 *   infeasible
 * @property {{ psi: number, p: number, integral: number }[]} [through] points
 *   the track passes through: angle (rad) in (start, end], lever arm (m)
 *   and ∫ p dψ from ψ_0 (m·rad)
 * @property {{ start: ArrayLike<number>, end: ArrayLike<number> }} [ends] p, p'
 *   and p'' prescribed at both ends (m, m/rad, m/rad²), for a C2 join
 * @property {number} [gridPerInterval] constraint points per knot interval, 1 to 50 (default 8)
 * @property {number} [margin] added to both limits in the constraints
 *   (m, default 5e-6): the spline between two constraint points stays above
 *   the limits, so the exchange rounds are rarely needed
 */

/**
 * @typedef {object} FitResult
 * @property {'optimal' | 'infeasible' | 'max-iterations' | 'not-convex' | 'invalid' | 'out-of-domain'} status
 * @property {SplineData | null} spline clamped spline over [start, end]
 * @property {number} rms root mean square deviation from the samples (m)
 * @property {number} maxDeviation largest deviation from the samples (m)
 * @property {number} unknowns number of spline coefficients
 * @property {number} active number of active constraints
 * @property {number} minRho smallest ρ on a grid 4 times denser than the constraints (m)
 * @property {number} minP smallest p on that grid (m)
 */

/**
 * Knots uniform over [start, end].
 * @param {number} start
 * @param {number} end
 * @param {number} intervals
 */
function uniformKnots(start, end, intervals) {
  return Float64Array.from({ length: intervals + 1 }, (_, k) => (k === intervals ? end : start + ((end - start) * k) / intervals));
}

/**
 * True when every entry of the list is undefined or a finite number.
 * @param {(number | undefined)[]} values
 */
const finiteOrUndefined = (values) => values.every((v) => v === undefined || Number.isFinite(v));

/**
 * Fit the cable track. Never throws. The status is 'invalid' unless
 * start < end with |start| and |end| at most 1e4 rad, psi and p have the
 * same length of at least 2 with at least one finite pair, rhoMin, pMin and
 * the optional numbers are finite, intervals is an integer from 1 to 200,
 * gridPerInterval an integer from 1 to 50, each end holds three finite
 * numbers, each through point has its angle in (start, end] and a finite
 * lever arm and integral, and the knot spacing is at least 1e-6 rad (the
 * input domain of core/domain.js). The status is 'out-of-domain' when the
 * optimum leaves that domain. Non-finite samples are left out.
 * @param {FitInput} input
 * @returns {FitResult}
 */
export function fitCableTrack(input) {
  try {
    return fitChecked(input);
  } catch {
    // Input whose reading throws (a getter, a malformed nested value).
    return failedFit('invalid');
  }
}

/**
 * @param {FitResult['status']} status
 * @returns {FitResult}
 */
function failedFit(status) {
  return { status, spline: null, rms: NaN, maxDeviation: NaN, unknowns: 0, active: 0, minRho: NaN, minP: NaN };
}

/**
 * Body of {@link fitCableTrack}, which guards it.
 * @param {FitInput} input
 * @returns {FitResult}
 */
function fitChecked(input) {
  const { psi, p, start, end, rhoMin, pMin } = input;
  const failed = failedFit;
  const m = psi.length;
  const span = end - start;
  // Only undefined means an absent option: null, false, 0 or "" given for
  // an option is malformed input.
  const intervals = input.intervals === undefined ? Math.min(37, Math.max(17, Math.round(span / (10 * (Math.PI / 180))))) : input.intervals;
  const perInterval = input.gridPerInterval === undefined ? 8 : input.gridPerInterval;
  const given = input.ends;
  const hasEnds = given !== undefined;
  const endsObject = given !== undefined && given !== null && typeof given === 'object';
  const ends = endsObject ? [given.start, given.end] : [];
  const through = input.through === undefined ? [] : input.through;
  let finitePairs = 0;
  if (p.length === m) for (let i = 0; i < m; i++) if (Number.isFinite(psi[i]) && Number.isFinite(p[i])) finitePairs++;
  const valid =
    Math.abs(start) <= ANGLE_MAX &&
    Math.abs(end) <= ANGLE_MAX &&
    end > start &&
    m >= 2 &&
    p.length === m &&
    finitePairs > 0 &&
    Number.isFinite(rhoMin) &&
    Number.isFinite(pMin) &&
    finiteOrUndefined([input.startValue, input.margin]) &&
    Number.isInteger(intervals) &&
    intervals >= 1 &&
    intervals <= MAX_INTERVALS &&
    Number.isInteger(perInterval) &&
    perInterval >= 1 &&
    perInterval <= MAX_GRID &&
    span / intervals >= KNOT_SPACING_MIN &&
    hasEnds === endsObject &&
    ends.every((v) => v !== null && v !== undefined && v.length === 3 && Array.from(v).every(Number.isFinite)) &&
    Array.isArray(through) &&
    through.every((q) => q !== null && q !== undefined && q.psi > start && q.psi <= end && Number.isFinite(q.p) && Number.isFinite(q.integral));
  if (!valid) return failed('invalid');
  // Two prescribed values of p(ψ_0) that differ cannot both hold.
  if (input.startValue !== undefined && input.ends !== undefined && Math.abs(input.startValue - input.ends.start[0]) > START_TOLERANCE) {
    return failed('infeasible');
  }
  const knots = uniformKnots(start, end, intervals);
  const nv = intervals + 1;
  const n = nv + 2;
  // Basis: spline of A in each unknown (values, then end slopes), read back
  // per mm, the unit of the unknowns. A = min(1 mm, h²) with h the knot
  // spacing keeps |p'| ≈ A/h and |p''| ≈ A/h² inside the input domain of
  // support.js; the splines are linear in A, so the rows do not depend on it.
  const unit = Math.min(MM, ((end - start) / intervals) ** 2);
  /** @type {import('./support.js').Support[]} */
  const basis = [];
  for (let j = 0; j < n; j++) {
    const values = new Float64Array(nv);
    /** @type {[number, number]} */
    const slopes = [0, 0];
    if (j < nv) values[j] = unit;
    else slopes[j - nv] = unit;
    basis.push(createSupport(splineSupport(knots, values, { endSlopes: slopes })));
  }
  const buf = new Float64Array(3);
  /**
   * Row of p and p'' at ψ.
   * @param {number} at
   */
  const rows = (at) => {
    const rp = new Float64Array(n);
    const r1 = new Float64Array(n);
    const r2 = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      basis[j].evaluate(at, buf);
      rp[j] = buf[0] / unit;
      r1[j] = buf[1] / unit;
      r2[j] = buf[2] / unit;
    }
    return { rp, r1, r2 };
  };

  // Least squares in mm: G = BᵀB + μ·DᵀD, a = −Bᵀ·p.
  const G = new Float64Array(n * n);
  const a = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(psi[i]) || !Number.isFinite(p[i])) continue;
    const { rp } = rows(Math.min(end, Math.max(start, psi[i])));
    const pi = p[i] / MM;
    for (let r = 0; r < n; r++) {
      if (rp[r] === 0) continue;
      a[r] -= rp[r] * pi;
      for (let c = 0; c < n; c++) G[r * n + c] += rp[r] * rp[c];
    }
  }
  let trace = 0;
  for (let r = 0; r < n; r++) trace += G[r * n + r];
  const mu = 1e-8 * Math.max(trace, 1);
  for (let k = 1; k < nv - 1; k++) {
    const idx = [k - 1, k, k + 1];
    const w = [1, -2, 1];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) G[idx[r] * n + idx[c]] += mu * w[r] * w[c];
  }
  for (let r = 0; r < n; r++) G[r * n + r] += mu * 1e-6;

  // Constraints: equalities (start value, points passed through), then ρ
  // and p on the grid.
  const gridCount = intervals * perInterval;
  const margin = (input.margin ?? 5e-6) / MM;
  /** @type {{ row: Float64Array, value: number }[]} */
  const equalities = [];
  if (input.startValue !== undefined) equalities.push({ row: rows(start).rp, value: input.startValue / MM });
  for (const q of through) {
    equalities.push({ row: rows(q.psi).rp, value: q.p / MM });
    equalities.push({ row: Float64Array.from(basis, (s) => s.P(q.psi) / unit), value: q.integral / MM });
  }
  if (input.ends !== undefined) {
    for (const [at, values] of /** @type {[number, ArrayLike<number>][]} */ ([[start, input.ends.start], [end, input.ends.end]])) {
      const r = rows(at);
      if (!(at === start && input.startValue !== undefined)) equalities.push({ row: r.rp, value: values[0] / MM });
      equalities.push({ row: r.r1, value: values[1] / MM });
      equalities.push({ row: r.r2, value: values[2] / MM });
    }
  }
  const meq = equalities.length;
  /** Constraint angles: the grid, then the exchange points. */
  const at = Array.from({ length: gridCount + 1 }, (_, k) => start + (span * k) / gridCount);
  /** @type {ReturnType<typeof solveQP>} */
  let result;
  /** @type {import('./support.js').SplineData} */
  let spline;
  /** @type {import('./support.js').Support} */
  let s;
  /** @type {{ minRho: number, minP: number, low: number[] }} */
  let limits;
  for (let round = 0; ; round++) {
    const mc = meq + 2 * at.length;
    const C = new Float64Array(mc * n);
    const b = new Float64Array(mc);
    equalities.forEach((e, i) => {
      C.set(e.row, i * n);
      b[i] = e.value;
    });
    at.forEach((psiK, k) => {
      const { rp, r2 } = rows(psiK);
      const i = meq + 2 * k;
      for (let j = 0; j < n; j++) {
        C[i * n + j] = rp[j] + r2[j];
        C[(i + 1) * n + j] = rp[j];
      }
      b[i] = rhoMin / MM + margin;
      b[i + 1] = pMin / MM + margin;
    });
    result = solveQP({ n, G, a, C, b, meq });
    if (result.status !== 'optimal') return { ...failed(result.status), unknowns: n };
    const x = result.x;
    const values = Float64Array.from(x.subarray(0, nv), (v) => v * MM);
    spline = splineSupport(knots, values, { endSlopes: [x[nv] * MM, x[nv + 1] * MM] });
    try {
      s = createSupport(spline);
    } catch {
      // The optimum leaves the input domain of support.js (|p| or |p'| above
      // 10 m): no track of the size of a cam meets the conditions.
      return { ...failed('out-of-domain'), unknowns: n };
    }
    limits = splineLimits(spline, rhoMin, pMin);
    if (limits.low.length === 0) break;
    // The limits hold on the grid but not between its points.
    if (round === EXCHANGE_ROUNDS) return { ...failed('max-iterations'), unknowns: n };
    at.push(...limits.low);
  }
  let sum = 0;
  let count = 0;
  let maxDeviation = 0;
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(psi[i]) || !Number.isFinite(p[i])) continue;
    const d = s.p(Math.min(end, Math.max(start, psi[i]))) - p[i];
    sum += d * d;
    count++;
    maxDeviation = Math.max(maxDeviation, Math.abs(d));
  }
  return {
    status: 'optimal',
    spline,
    rms: Math.sqrt(sum / Math.max(count, 1)),
    maxDeviation,
    unknowns: n,
    active: result.active.length,
    minRho: limits.minRho,
    minP: limits.minP,
  };
}

/**
 * Exact smallest ρ = p + p'' and p of a clamped spline over its knots, and
 * the angles, one per interval and quantity, where either falls more than
 * LIMIT_TOLERANCE below its limit. p and ρ are cubics on each interval.
 * @param {import('./support.js').SplineData} spline
 * @param {number} rhoMin (m)
 * @param {number} pMin (m)
 * @returns {{ minRho: number, minP: number, low: number[] }}
 */
export function splineLimits(spline, rhoMin, pMin) {
  const { knots, coeffs } = spline;
  let minRho = Infinity;
  let minP = Infinity;
  /** @type {number[]} */
  const low = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const h = knots[i + 1] - knots[i];
    const [c0, c1, c2, c3] = [coeffs[4 * i], coeffs[4 * i + 1], coeffs[4 * i + 2], coeffs[4 * i + 3]];
    const p = cubicMin(c0, c1, c2, c3, 0, h);
    const rho = cubicMin(c0 + 2 * c2, c1 + 6 * c3, c2, c3, 0, h);
    minP = Math.min(minP, p.value);
    minRho = Math.min(minRho, rho.value);
    if (p.value < pMin - LIMIT_TOLERANCE) low.push(knots[i] + p.t);
    if (rho.value < rhoMin - LIMIT_TOLERANCE && !(p.value < pMin - LIMIT_TOLERANCE && rho.t === p.t)) low.push(knots[i] + rho.t);
  }
  return { minRho, minP, low };
}
