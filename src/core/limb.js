/**
 * Limb model: energy E1(α) of one limb against its rotation α from brace.
 * The limb is a rigid lever of length R_L; α_0 > 0 is the rotation from the
 * unstrung limb to brace, so the limb rotation from unstrung is q = α + α_0
 * and E1 = ∫₀^q M dq with the limb moment M(q).
 *
 * - linear: M = k_t·q, E1 = ½·k_t·(α + α_0)², k_t = k·R_L² with the
 *   stiffness k at the axle perpendicular to the lever (N/m), and
 *   α_0 = preload travel / R_L.
 * - table: measured moments M(q_i) fitted by the C2 shape-preserving quintic
 *   of core/interp; E1 is its exact integral. Outside the table the moment
 *   continues linearly with the end slope. A falling end slope makes E1
 *   peak where that line reaches M = 0; larger energies have no inverse.
 *
 * Draw energy W = 2·(E1(α_f) − E1(0)); the limbs store 2·E1(0) at brace
 * (preload) and 2·E1(α_f) at full draw. Units: rad, N·m, J.
 * @module core/limb
 */

import {
  ENERGY_MAX,
  LENGTH_MAX,
  LENGTH_MIN,
  MOMENT_MAX,
  ROTATION_MAX,
  ROTATION_SPACING_MIN,
  TABLE_ROWS_MAX,
  TORSIONAL_STIFFNESS_MAX,
  TORSIONAL_STIFFNESS_MIN,
  inRange,
} from './domain.js';
import { describeError } from './errors.js';
import { buildCurveData, fromCurveData } from './interp.js';

/** Residual of the inverse E1⁻¹ (J). */
export const INVERSE_TOLERANCE = 1e-9;

/**
 * @typedef {object} LinearLimbData
 * @property {'linear'} kind
 * @property {number} torsionalStiffness k_t (N·m/rad)
 * @property {number} alpha0 rotation from unstrung to brace (rad)
 */

/**
 * @typedef {object} TableLimbData
 * @property {'table'} kind
 * @property {import('./interp.js').CurveData} curve limb moment M(q) in N·m
 *   against the rotation q from unstrung in rad (the x values of the curve)
 * @property {number} alpha0 rotation from unstrung to brace (rad)
 */

/** @typedef {LinearLimbData | TableLimbData} LimbData */

/**
 * Every method returns NaN for a NaN argument and never throws.
 * @typedef {object} LimbMethods
 * @property {(alpha: number) => number} energy E1(α) (J)
 * @property {(alpha: number) => number} energyChange E1(α) − E1(0), computed
 *   without subtracting the preload-scale totals (J)
 * @property {(alpha: number) => number} moment E1'(α) = M(α + α_0) (N·m)
 * @property {(alpha: number) => number} stiffness E1''(α) (N·m/rad)
 * @property {(energy: number) => number} inverse α with E1(α) = energy on the
 *   rising part of E1 (α ≥ −α_0), NaN when the energy is negative, not
 *   finite or above the largest E1 of a table limb
 */

/** @typedef {LimbData & LimbMethods} Limb */

/**
 * Linear limb from the stiffness at the axle.
 * @param {{ stiffness: number, preloadTravel: number, limbLength: number }} params
 *   stiffness k (N/m), preload travel from unstrung to brace (m), R_L (m)
 * @returns {LinearLimbData}
 */
export function linearLimb({ stiffness, preloadTravel, limbLength }) {
  return { kind: 'linear', torsionalStiffness: stiffness * limbLength * limbLength, alpha0: preloadTravel / limbLength };
}

/**
 * Stiffness k at the axle (N/m) that stores the draw energy W over the axle
 * travel s_f from brace to full draw, with preload travel s_0:
 * W = k·((s_f + s_0)² − s_0²) = k·s_f·(s_f + 2·s_0). NaN unless
 * 0 < W ≤ ENERGY_MAX, LENGTH_MIN ≤ s_f ≤ LENGTH_MAX and 0 ≤ s_0 ≤ LENGTH_MAX
 * (see core/domain.js).
 * @param {{ drawEnergy: number, travel: number, preloadTravel: number }} params (J, m, m)
 * @returns {number}
 */
export function stiffnessForTravel({ drawEnergy, travel, preloadTravel }) {
  const valid = drawEnergy > 0 && inRange(drawEnergy, 0, ENERGY_MAX) && inRange(travel, LENGTH_MIN, LENGTH_MAX) && inRange(preloadTravel, 0, LENGTH_MAX);
  if (!valid) return NaN;
  // s_f·(s_f + 2·s_0) instead of the difference of two squares, which
  // cancels when the preload is much larger than the travel.
  return drawEnergy / (travel * (travel + 2 * preloadTravel));
}

/**
 * Tabulated limb. Rows give the rotation q from unstrung (rad, strictly
 * increasing, 0 to ROTATION_MAX) and the limb moment M (N·m, 0 to
 * MOMENT_MAX); the preload rotation α_0 is 0 to ROTATION_MAX. A table that
 * starts after q = 0 gets the unloaded point (0, 0) added. Never throws.
 * @param {{ rotation: ArrayLike<number>, moment: ArrayLike<number>, alpha0: number }} params
 * @returns {{ limb: TableLimbData | null, error: string | null }}
 */
export function tableLimb({ rotation, moment, alpha0 }) {
  const n = rotation?.length ?? 0;
  if (!(n >= 2 && n <= TABLE_ROWS_MAX) || moment?.length !== n) {
    return { limb: null, error: `The limb table needs at least 2 rows and at most ${TABLE_ROWS_MAX} rows` };
  }
  /** @type {{ x: number, F: number }[]} */
  const points = [];
  for (let i = 0; i < n; i++) {
    const q = rotation[i];
    const m = moment[i];
    if (!inRange(q, 0, ROTATION_MAX) || !inRange(m, 0, MOMENT_MAX)) {
      return {
        limb: null,
        error: `Limb table row ${i + 1} must have a rotation from 0 to one turn and a moment from 0 to ${MOMENT_MAX} N·m`,
      };
    }
    if (i > 0 && !(q - rotation[i - 1] >= ROTATION_SPACING_MIN)) {
      return { limb: null, error: `Limb table row ${i + 1} must have a rotation at least ${ROTATION_SPACING_MIN} rad larger than row ${i}` };
    }
    points.push({ x: q, F: m });
  }
  // q = 0 is the unstrung limb, which carries no moment.
  if (points[0].x === 0 && points[0].F !== 0) {
    return { limb: null, error: 'The limb moment at zero rotation (unstrung) must be 0' };
  }
  if (points[0].x > 0 && points[0].x < ROTATION_SPACING_MIN) {
    return { limb: null, error: `The first limb table row must be at rotation 0 or at least ${ROTATION_SPACING_MIN} rad` };
  }
  if (points[0].x > 0) points.unshift({ x: 0, F: 0 });
  if (!inRange(alpha0, 0, ROTATION_MAX)) return { limb: null, error: 'The limb preload rotation must be from 0 to one turn' };
  const curve = buildCurveData(points);
  // Inside the domain the interpolant stays finite; this guards the rest.
  const finite = (/** @type {ArrayLike<number>} */ a) => Array.prototype.every.call(a, Number.isFinite);
  if (![curve.slopes, curve.second, curve.coeffs, curve.cumulative].every(finite)) {
    return { limb: null, error: 'The limb table gives a moment curve outside the numeric range' };
  }
  return { limb: { kind: 'table', curve, alpha0 }, error: null };
}

/**
 * Limb data from the project limb settings. The 'travel' mode needs the
 * draw energy of the target curve; the table rows give the axle travel from
 * brace and the force at the axle, converted to q = (travel + preload)/R_L
 * and M = force·R_L. Never throws.
 * @param {import('../state/schema.js').LimbState} limb
 * @param {number} limbLength R_L (m)
 * @param {{ drawEnergy?: number }} [options]
 * @returns {{ limb: LimbData | null, error: string | null }}
 */
export function limbFromState(limb, limbLength, options = {}) {
  const result = limbDataFromState(limb, limbLength, options);
  if (!result.limb) return result;
  /** @type {Limb} */
  let made;
  try {
    made = createLimb(result.limb);
  } catch (err) {
    return { limb: null, error: describeError(err) };
  }
  // The brace moment and energy must stay inside the floating-point range.
  const moment = made.moment(0);
  const energy = made.energy(0);
  if (!(Number.isFinite(moment) && moment >= 0 && Number.isFinite(energy) && energy >= 0)) {
    return { limb: null, error: 'The limb values give a brace moment or energy outside the numeric range' };
  }
  return result;
}

/**
 * limbFromState without the numeric-range check of the brace state.
 * @param {import('../state/schema.js').LimbState} limb
 * @param {number} limbLength
 * @param {{ drawEnergy?: number }} options
 * @returns {{ limb: LimbData | null, error: string | null }}
 */
function limbDataFromState(limb, limbLength, options) {
  if (!inRange(limbLength, LENGTH_MIN, LENGTH_MAX)) {
    return { limb: null, error: `The limb lever length must be from ${LENGTH_MIN} m to ${LENGTH_MAX} m` };
  }
  const preloadTravel = limb.preloadTravel;
  if (!inRange(preloadTravel, 0, LENGTH_MAX)) {
    return { limb: null, error: `The limb preload travel must be from 0 to ${LENGTH_MAX} m` };
  }
  if (limb.mode === 'table') {
    const rows = Array.isArray(limb.table) ? limb.table : [];
    if (rows.length > TABLE_ROWS_MAX) return { limb: null, error: `The limb table needs at least 2 rows and at most ${TABLE_ROWS_MAX} rows` };
    // Rows give travel from brace and force at the axle; both are at least 0.
    for (let i = 0; i < rows.length; i++) {
      const { travel, force } = rows[i] ?? {};
      if (!(inRange(travel, 0, LENGTH_MAX) && Number.isFinite(force) && force >= 0)) {
        return { limb: null, error: `Limb table row ${i + 1} must have a travel from brace of 0 to ${LENGTH_MAX} m and a force of at least 0` };
      }
    }
    return tableLimb({
      rotation: rows.map((r) => (r.travel + preloadTravel) / limbLength),
      moment: rows.map((r) => r.force * limbLength),
      alpha0: preloadTravel / limbLength,
    });
  }
  let stiffness = limb.stiffness;
  if (limb.mode === 'travel') {
    stiffness = stiffnessForTravel({ drawEnergy: options.drawEnergy ?? NaN, travel: limb.travel, preloadTravel });
    if (!Number.isFinite(stiffness)) {
      return { limb: null, error: 'The limb travel mode needs a positive draw energy and limb travel' };
    }
  }
  if (!(stiffness > 0 && Number.isFinite(stiffness))) {
    return { limb: null, error: 'Limb stiffness must be a finite positive number' };
  }
  const data = linearLimb({ stiffness, preloadTravel, limbLength });
  if (!inRange(data.torsionalStiffness, TORSIONAL_STIFFNESS_MIN, TORSIONAL_STIFFNESS_MAX)) {
    return {
      limb: null,
      error: `The limb stiffness and lever length give a torsional stiffness outside ${TORSIONAL_STIFFNESS_MIN} to ${TORSIONAL_STIFFNESS_MAX} N·m/rad`,
    };
  }
  if (!inRange(data.alpha0, 0, ROTATION_MAX)) {
    return { limb: null, error: 'The limb preload travel and lever length give a preload rotation of more than one turn' };
  }
  return { limb: data, error: null };
}

/**
 * @param {LinearLimbData} d
 * @returns {LimbMethods}
 */
function linearMethods(d) {
  const kt = d.torsionalStiffness;
  const a0 = d.alpha0;
  return {
    energy: (alpha) => 0.5 * kt * (alpha + a0) ** 2,
    energyChange: (alpha) => 0.5 * kt * alpha * (alpha + 2 * a0),
    moment: (alpha) => kt * (alpha + a0),
    stiffness: (alpha) => (Number.isNaN(alpha) ? NaN : kt),
    // √2·√E/√k_t: each root stays in range, so 2·E cannot overflow first.
    inverse: (energy) => (energy >= 0 && Number.isFinite(energy) ? Math.SQRT2 * (Math.sqrt(energy) / Math.sqrt(kt)) - a0 : NaN),
  };
}

/**
 * @param {TableLimbData} d
 * @returns {LimbMethods}
 */
function tableMethods(d) {
  const curve = fromCurveData(d.curve);
  const { knots, values, slopes, coeffs } = d.curve;
  const n = knots.length - 1;
  const [q0, qn] = [knots[0], knots[n]];
  const total = curve.integral(q0, qn);
  const a0 = d.alpha0;
  // NaN fails both range tests, so it is caught first: the curve
  // evaluation would throw on it.
  /** @param {number} q */
  const M = (q) => {
    if (Number.isNaN(q)) return NaN;
    if (q < q0) return values[0] + slopes[0] * (q - q0);
    if (q > qn) return values[n] + slopes[n] * (q - qn);
    return curve.evaluate(q);
  };
  /** @param {number} q */
  const W = (q) => {
    if (Number.isNaN(q)) return NaN;
    if (q < q0) return (q - q0) * (values[0] + 0.5 * slopes[0] * (q - q0));
    if (q > qn) return total + (q - qn) * (values[n] + 0.5 * slopes[n] * (q - qn));
    return curve.integral(q0, q);
  };
  /**
   * Integral of an end line of the moment from s to s + len; the line
   * passes through (knot, value) with the given slope.
   * @param {number} value
   * @param {number} slope
   * @param {number} knot
   * @param {number} s
   * @param {number} len
   */
  const line = (value, slope, knot, s, len) => len * (value + slope * (s - knot + 0.5 * len));
  /**
   * Integral of M from q to qn for q < qn.
   * @param {number} q
   */
  const toEnd = (q) => (q >= q0 ? curve.integral(q, qn) : line(values[0], slopes[0], q0, q, q0 - q) + total);
  /**
   * Index i of the table interval [q_i, q_(i+1)] that holds q, q0 ≤ q < qn.
   * @param {number} q
   */
  const intervalOf = (q) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (knots[mid] <= q) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  /**
   * Integral of M over [s, s + len] inside interval i, from the Taylor
   * expansion of the quintic about s. The length enters by itself, so a
   * length below the floating-point spacing at s keeps its integral.
   * @param {number} i
   * @param {number} s
   * @param {number} len
   */
  const within = (i, s, len) => {
    const h = knots[i + 1] - knots[i];
    const t = (s - knots[i]) / h;
    const tau = len / h;
    // Coefficients of q(t + u) in u, by repeated synthetic division.
    const m = Array.from(coeffs.subarray(6 * i, 6 * i + 6));
    for (let j = 0; j < 5; j++) for (let k = 4; k >= j; k--) m[k] += t * m[k + 1];
    let sum = 0;
    for (let j = 5; j >= 0; j--) sum = sum * tau + m[j] / (j + 1);
    return len * sum;
  };
  return {
    energy: (alpha) => W(alpha + a0),
    // E1(α) − E1(0) as the integral of M from brace, piece by piece; no piece
    // subtracts two totals, and the piece that starts at brace takes α (or
    // its own length) directly, so a preload far larger than α keeps its
    // draw energy. a0 ≥ q0 = 0 always.
    energyChange(alpha) {
      const q = alpha + a0;
      if (Number.isNaN(q)) return NaN;
      if (a0 >= qn) {
        if (q >= qn) return line(values[n], slopes[n], qn, a0, alpha);
        return -(toEnd(q) + line(values[n], slopes[n], qn, qn, a0 - qn));
      }
      // Brace inside the table, in interval i.
      const i = intervalOf(a0);
      const [lo, hi] = [knots[i], knots[i + 1]];
      if (q >= lo && q <= hi) return within(i, a0, alpha);
      if (q > hi) {
        const rest = q > qn ? curve.integral(hi, qn) + line(values[n], slopes[n], qn, qn, q - qn) : curve.integral(hi, q);
        return within(i, a0, hi - a0) + rest;
      }
      const rest = q >= q0 ? curve.integral(q, lo) : curve.integral(q0, lo) + line(values[0], slopes[0], q0, q, q0 - q);
      return -(within(i, lo, a0 - lo) + rest);
    },
    moment: (alpha) => M(alpha + a0),
    stiffness(alpha) {
      const q = alpha + a0;
      if (Number.isNaN(q)) return NaN;
      if (q < q0) return slopes[0];
      if (q > qn) return slopes[n];
      return curve.derivative(q);
    },
    inverse(energy) {
      if (!(energy >= 0 && Number.isFinite(energy))) return NaN;
      // W is increasing where M > 0; bracket [q0, hi] and refine by
      // Newton steps kept inside the bracket. With a falling end slope the
      // extended moment reaches 0 at the peak of W, which caps the bracket.
      const peak = slopes[n] < 0 ? qn + values[n] / -slopes[n] : Infinity;
      let lo = q0;
      let hi = Math.max(qn, q0 + 1e-6);
      for (let k = 0; k < 200 && W(hi) < energy && hi < peak; k++) hi = Math.min(peak, q0 + 2 * (hi - q0));
      if (!(W(hi) >= energy)) return NaN;
      let q = 0.5 * (lo + hi);
      for (let it = 0; it < 200; it++) {
        const r = W(q) - energy;
        if (Math.abs(r) <= INVERSE_TOLERANCE * 1e-3 || hi - lo <= 1e-15 * Math.max(1, Math.abs(q))) break;
        if (r > 0) hi = q;
        else lo = q;
        const m = M(q);
        const next = m > 0 ? q - r / m : NaN;
        q = next > lo && next < hi ? next : 0.5 * (lo + hi);
      }
      return q - a0;
    },
  };
}

/**
 * Attach the energy methods to limb data.
 * @param {LimbData} data
 * @returns {Limb}
 */
export function createLimb(data) {
  const kind = /** @type {{ kind?: unknown } | null | undefined} */ (data)?.kind;
  if (kind !== 'table' && kind !== 'linear') throw new RangeError(`Unknown limb kind "${String(kind)}"`);
  const { alpha0 } = data;
  if (!inRange(alpha0, 0, ROTATION_MAX)) {
    throw new RangeError('The limb preload rotation alpha0 must be from 0 to one turn (2π rad)');
  }
  if (kind === 'table') {
    // Serialized table data: rebuild the curve from its knots and values so
    // that the invariants of tableLimb hold (unstrung moment 0, rotations
    // increasing, moments at least 0) and the coefficients match them.
    const curve = /** @type {TableLimbData} */ (data).curve;
    const rebuilt = tableLimb({ rotation: curve?.knots ?? [], moment: curve?.values ?? [], alpha0 });
    if (!rebuilt.limb) throw new RangeError(rebuilt.error ?? 'Invalid limb table');
    if (rebuilt.limb.curve.knots.length !== curve.knots.length) {
      throw new RangeError('A limb table curve must start at zero rotation (unstrung)');
    }
    return { ...rebuilt.limb, ...tableMethods(rebuilt.limb) };
  }
  const k = /** @type {LinearLimbData} */ (data).torsionalStiffness;
  if (!inRange(k, TORSIONAL_STIFFNESS_MIN, TORSIONAL_STIFFNESS_MAX)) {
    throw new RangeError(`The limb torsional stiffness must be from ${TORSIONAL_STIFFNESS_MIN} to ${TORSIONAL_STIFFNESS_MAX} N·m/rad`);
  }
  return { ...data, ...linearMethods(/** @type {LinearLimbData} */ (data)) };
}

/**
 * Energies of both limbs at the full-draw rotation α_f.
 * @param {Limb} limb
 * @param {number} alphaFull α_f (rad)
 * @returns {{ drawEnergy: number, limbEnergy: number, preloadEnergy: number }}
 *   draw energy 2·(E1(α_f) − E1(0)), total limb energy at full draw
 *   2·E1(α_f) including the preload, and the preload energy 2·E1(0) (J)
 */
export function limbEnergies(limb, alphaFull) {
  return {
    drawEnergy: 2 * limb.energyChange(alphaFull),
    limbEnergy: 2 * limb.energy(alphaFull),
    preloadEnergy: 2 * limb.energy(0),
  };
}
