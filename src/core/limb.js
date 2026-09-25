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
 * W = k·((s_f + s_0)² − s_0²). NaN unless W > 0, s_f > 0 and s_0 ≥ 0 are
 * finite.
 * @param {{ drawEnergy: number, travel: number, preloadTravel: number }} params (J, m, m)
 * @returns {number}
 */
export function stiffnessForTravel({ drawEnergy, travel, preloadTravel }) {
  const valid = drawEnergy > 0 && Number.isFinite(drawEnergy) && travel > 0 && Number.isFinite(travel) && preloadTravel >= 0 && Number.isFinite(preloadTravel);
  if (!valid) return NaN;
  const k = drawEnergy / ((travel + preloadTravel) ** 2 - preloadTravel ** 2);
  return Number.isFinite(k) && k > 0 ? k : NaN;
}

/**
 * Tabulated limb. Rows give the rotation q from unstrung (rad, strictly
 * increasing, ≥ 0) and the limb moment M (N·m, ≥ 0). A table that starts
 * after q = 0 gets the unloaded point (0, 0) added. Never throws.
 * @param {{ rotation: ArrayLike<number>, moment: ArrayLike<number>, alpha0: number }} params
 * @returns {{ limb: TableLimbData | null, error: string | null }}
 */
export function tableLimb({ rotation, moment, alpha0 }) {
  const n = rotation?.length ?? 0;
  if (n < 2 || moment?.length !== n) return { limb: null, error: 'The limb table needs at least 2 rows' };
  /** @type {{ x: number, F: number }[]} */
  const points = [];
  for (let i = 0; i < n; i++) {
    const q = rotation[i];
    const m = moment[i];
    if (!Number.isFinite(q) || !Number.isFinite(m) || q < 0 || m < 0) {
      return { limb: null, error: `Limb table row ${i + 1} must have a rotation and a moment of at least 0` };
    }
    if (i > 0 && !(q > rotation[i - 1])) {
      return { limb: null, error: `Limb table row ${i + 1} must have a larger rotation than row ${i}` };
    }
    points.push({ x: q, F: m });
  }
  if (points[0].x > 0) points.unshift({ x: 0, F: 0 });
  if (!Number.isFinite(alpha0)) return { limb: null, error: 'The limb preload must be a finite number' };
  return { limb: { kind: 'table', curve: buildCurveData(points), alpha0 }, error: null };
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
  if (!(limbLength > 0)) return { limb: null, error: 'The limb lever length must be positive' };
  const preloadTravel = limb.preloadTravel;
  if (!(preloadTravel >= 0 && Number.isFinite(preloadTravel))) {
    return { limb: null, error: 'The limb preload travel must be at least 0' };
  }
  if (limb.mode === 'table') {
    const rows = Array.isArray(limb.table) ? limb.table : [];
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
  if (!(stiffness > 0 && preloadTravel >= 0)) {
    return { limb: null, error: 'Limb stiffness must be positive and the preload travel at least 0' };
  }
  return { limb: linearLimb({ stiffness, preloadTravel, limbLength }), error: null };
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
    moment: (alpha) => kt * (alpha + a0),
    stiffness: (alpha) => (Number.isNaN(alpha) ? NaN : kt),
    inverse: (energy) => (energy >= 0 && Number.isFinite(energy) ? Math.sqrt((2 * energy) / kt) - a0 : NaN),
  };
}

/**
 * @param {TableLimbData} d
 * @returns {LimbMethods}
 */
function tableMethods(d) {
  const curve = fromCurveData(d.curve);
  const { knots, values, slopes } = d.curve;
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
  return {
    energy: (alpha) => W(alpha + a0),
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
  if (kind === 'table') return { ...data, ...tableMethods(/** @type {TableLimbData} */ (data)) };
  if (kind === 'linear') return { ...data, ...linearMethods(/** @type {LinearLimbData} */ (data)) };
  throw new RangeError(`Unknown limb kind "${String(kind)}"`);
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
  const full = limb.energy(alphaFull);
  const brace = limb.energy(0);
  return { drawEnergy: 2 * (full - brace), limbEnergy: 2 * full, preloadEnergy: 2 * brace };
}
