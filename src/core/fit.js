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

import { solveQP } from './qp.js';
import { createSupport, splineSupport } from './support.js';

/** @typedef {import('./support.js').SplineData} SplineData */

/** Scale of the internal unit (1 mm). */
const MM = 1e-3;

/** Smallest knot spacing relative to max(1, |start|, |end|). */
const MIN_SPACING = 1e-9;

/** Largest |start| and |end| (rad). */
const MAX_ANGLE = 1e6;

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
 * @property {number} [startValue] prescribed p(ψ_0) (m)
 * @property {{ psi: number, p: number, integral: number }[]} [through] points
 *   the track passes through: angle (rad), lever arm (m) and ∫ p dψ from
 *   ψ_0 (m·rad)
 * @property {{ start: ArrayLike<number>, end: ArrayLike<number> }} [ends] p, p'
 *   and p'' prescribed at both ends (m, m/rad, m/rad²), for a C2 join
 * @property {number} [gridPerInterval] constraint points per knot interval, 1 to 50 (default 8)
 * @property {number} [margin] added to both limits in the constraints (m, default 1e-6)
 */

/**
 * @typedef {object} FitResult
 * @property {'optimal' | 'infeasible' | 'max-iterations' | 'not-convex' | 'invalid'} status
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
 * start < end with |start| and |end| at most 1e6 rad, psi and p have the
 * same length of at least 2 with at least one finite pair, rhoMin, pMin and
 * the optional numbers are finite, intervals is an integer from 1 to 200,
 * gridPerInterval an integer from 1 to 50, each end holds three finite
 * numbers, and the knot spacing exceeds 1e-9·max(1, |start|, |end|).
 * @param {FitInput} input
 * @returns {FitResult}
 */
export function fitCableTrack(input) {
  const { psi, p, start, end, rhoMin, pMin } = input;
  const failed = (/** @type {FitResult['status']} */ status) => ({
    status, spline: null, rms: NaN, maxDeviation: NaN, unknowns: 0, active: 0, minRho: NaN, minP: NaN,
  });
  const m = psi.length;
  const span = end - start;
  const intervals = input.intervals ?? Math.min(37, Math.max(17, Math.round(span / (10 * (Math.PI / 180)))));
  const perInterval = input.gridPerInterval ?? 8;
  const ends = input.ends ? [input.ends.start, input.ends.end] : [];
  let finitePairs = 0;
  if (p.length === m) for (let i = 0; i < m; i++) if (Number.isFinite(psi[i]) && Number.isFinite(p[i])) finitePairs++;
  const valid =
    Math.abs(start) <= MAX_ANGLE &&
    Math.abs(end) <= MAX_ANGLE &&
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
    span / intervals > MIN_SPACING * Math.max(1, Math.abs(start), Math.abs(end)) &&
    ends.every((v) => v.length === 3 && Array.from(v).every(Number.isFinite));
  if (!valid) return failed('invalid');
  const knots = uniformKnots(start, end, intervals);
  const nv = intervals + 1;
  const n = nv + 2;
  // Basis: spline of the unit vector of each unknown (values, then end slopes).
  /** @type {import('./support.js').Support[]} */
  const basis = [];
  for (let j = 0; j < n; j++) {
    const values = new Float64Array(nv);
    /** @type {[number, number]} */
    const slopes = [0, 0];
    if (j < nv) values[j] = 1;
    else slopes[j - nv] = 1;
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
      rp[j] = buf[0];
      r1[j] = buf[1];
      r2[j] = buf[2];
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
  const margin = (input.margin ?? 1e-6) / MM;
  /** @type {{ row: Float64Array, value: number }[]} */
  const equalities = [];
  if (input.startValue !== undefined) equalities.push({ row: rows(start).rp, value: input.startValue / MM });
  for (const q of input.through ?? []) {
    if (!(q.psi > start && q.psi <= end)) continue;
    if (Number.isFinite(q.p)) equalities.push({ row: rows(q.psi).rp, value: q.p / MM });
    if (Number.isFinite(q.integral)) equalities.push({ row: Float64Array.from(basis, (s) => s.P(q.psi)), value: q.integral / MM });
  }
  if (input.ends) {
    for (const [at, values] of /** @type {[number, ArrayLike<number>][]} */ ([[start, input.ends.start], [end, input.ends.end]])) {
      const r = rows(at);
      if (!(at === start && input.startValue !== undefined)) equalities.push({ row: r.rp, value: values[0] / MM });
      equalities.push({ row: r.r1, value: values[1] / MM });
      equalities.push({ row: r.r2, value: values[2] / MM });
    }
  }
  const meq = equalities.length;
  const mc = meq + 2 * (gridCount + 1);
  const C = new Float64Array(mc * n);
  const b = new Float64Array(mc);
  equalities.forEach((e, i) => {
    C.set(e.row, i * n);
    b[i] = e.value;
  });
  for (let k = 0; k <= gridCount; k++) {
    const { rp, r2 } = rows(start + (span * k) / gridCount);
    const i = meq + 2 * k;
    for (let j = 0; j < n; j++) {
      C[i * n + j] = rp[j] + r2[j];
      C[(i + 1) * n + j] = rp[j];
    }
    b[i] = rhoMin / MM + margin;
    b[i + 1] = pMin / MM + margin;
  }
  const result = solveQP({ n, G, a, C, b, meq });
  if (result.status !== 'optimal') return { ...failed(result.status), unknowns: n };
  const x = result.x;
  const values = Float64Array.from(x.subarray(0, nv), (v) => v * MM);
  const spline = splineSupport(knots, values, { endSlopes: [x[nv] * MM, x[nv + 1] * MM] });
  const s = createSupport(spline);
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
  let minRho = Infinity;
  let minP = Infinity;
  const fine = 4 * gridCount;
  for (let k = 0; k <= fine; k++) {
    s.evaluate(start + (span * k) / fine, buf);
    minRho = Math.min(minRho, buf[0] + buf[2]);
    minP = Math.min(minP, buf[0]);
  }
  return {
    status: 'optimal',
    spline,
    rms: Math.sqrt(sum / Math.max(count, 1)),
    maxDeviation,
    unknowns: n,
    active: result.active.length,
    minRho,
    minP,
  };
}
