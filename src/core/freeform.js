/**
 * Free-form string track: N groove-bottom support values p_i at
 * ψ_i = 2π·i/N, joined by the periodic C2 cubic spline of core/support
 * (period 2π). The pitch line is the groove bottom offset by d/2. The
 * radius of curvature ρ = p + p'' is linear in the values, so along any
 * direction of change the values that keep ρ above a limit form one
 * interval; bisection finds its ends.
 *
 * - sampleTrack and resample turn a track into values at N points.
 * - Shape modifiers add a term a·cos k(ψ − φ) to the values: k = 0 is a
 *   uniform offset (ρ + a), k = 1 a translation (ρ unchanged), k = 2, 3, 4
 *   an oval, a rounded triangle and a rounded square (ρ − (k² − 1)·a·cos …).
 *   A harmonic k needs N ≥ 4k points, so the spline follows it.
 * - dragBump moves a raised-cosine bump over ±2 points; dragLimit finds the
 *   largest move that keeps the track inside its limits.
 *
 * Lengths in m, angles in rad.
 * @module core/freeform
 */

import { createSupport, freeformSupport, rhoLimitFor, stringTrackGroove } from './support.js';

/** @typedef {import('../state/schema.js').StringTrack} StringTrack */

/**
 * Number of values of a free-form track: 8 to 16, 12 by default. More
 * points make one value move the radius of curvature at its knot faster
 * (−15 mm per mm at 12 points, −63 mm per mm at 24).
 */
export const FREEFORM_POINTS = Object.freeze({ min: 8, max: 16, default: 12 });

/** Range of every free-form track value, 2 mm to 150 mm (m). */
export const FREEFORM_RANGE = Object.freeze({ min: 2e-3, max: 150e-3 });

/** Bisection tolerance of largestAmount and dragLimit: 1 µm (m). */
export const LIMIT_TOLERANCE = 1e-6;

/** Largest amount of a shape modifier that largestAmount searches: 30 mm (m). */
export const MODIFIER_MAX_AMOUNT = 30e-3;

/** Largest move of a drag that dragLimit searches (m): the value range. */
const DRAG_MAX = FREEFORM_RANGE.max;

/** Weight of the rounded triangle in the egg modifier, per unit of oval. */
export const EGG_RATIO = 0.5;

/**
 * @typedef {'size' | 'shift' | 'oval' | 'triangle' | 'square' | 'egg'} ModifierId
 */

/**
 * @typedef {object} Modifier
 * @property {string} label
 * @property {readonly (readonly [number, number])[]} terms harmonic k and
 *   weight w: the modifier adds amount·Σ w·cos k(ψ − angle)
 * @property {number} amount default amount (m), before clamping
 */

/**
 * Shape modifiers, in menu order. Size and Shift do not change the shape:
 * Size offsets the track (ρ + a), Shift moves it (ρ unchanged).
 * @type {Readonly<Record<ModifierId, Modifier>>}
 */
export const MODIFIERS = Object.freeze({
  size: { label: 'Size', terms: [[0, 1]], amount: 1e-3 },
  shift: { label: 'Shift', terms: [[1, 1]], amount: 1e-3 },
  oval: { label: 'Oval', terms: [[2, 1]], amount: 1e-3 },
  triangle: { label: 'Rounded triangle', terms: [[3, 1]], amount: 1e-3 },
  square: { label: 'Rounded square', terms: [[4, 1]], amount: 0.5e-3 },
  egg: { label: 'Egg', terms: [[2, 1], [3, EGG_RATIO]], amount: 1e-3 },
});

/**
 * Limits of a free-form track for the editor and the modifiers: the pitch
 * line ρ must reach rho + margin, every value must stay in FREEFORM_RANGE.
 * @typedef {object} FreeformLimit
 * @property {number} rho pitch-line limit ρ_lim, as rhoLimitFor (m)
 * @property {number} d string diameter (m)
 * @property {number} margin extra radius of curvature over rho (m)
 */

/**
 * Limit of the string pitch line of a design, the rule of the solver
 * diagnostic string-radius, plus a margin.
 * @param {{ minBendRadius: number }} body
 * @param {number} d string diameter (m)
 * @param {number} [margin] (m), default 0
 * @returns {FreeformLimit}
 */
export function freeformLimit(body, d, margin = 0) {
  return { rho: rhoLimitFor(body, d), d, margin };
}

/** Resolution of sampled values: 0.1 µm (7 decimals of a metre), which keeps saved designs short (m). */
export const VALUE_RESOLUTION = 1e-7;

/** @param {number} v */
const rounded = (v) => Number(v.toFixed(7));

/**
 * Knot angles ψ_i = 2π·i/N, i = 0 … N − 1.
 * @param {number} n
 * @returns {number[]} (rad)
 */
export function knotAngles(n) {
  return Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);
}

/**
 * Groove-bottom values of a string track at n points: the support of an
 * eccentric or elliptical track, or the resampled spline of a free-form one,
 * rounded to VALUE_RESOLUTION.
 * @param {StringTrack} track
 * @param {number} n
 * @returns {number[]} (m)
 */
export function sampleTrack(track, n) {
  if (track.shape === 'freeform') return resample(track.freeform.values, n);
  const s = createSupport(stringTrackGroove(track));
  return knotAngles(n).map((psi) => rounded(s.p(psi)));
}

/**
 * Values of the spline through `values` at n points. The same n returns a
 * copy; another n changes the spline slightly (default track to 8 points:
 * p within 25 µm, ρ within 1.4 mm), so check it with {@link resampleChecked}.
 * New values are rounded to VALUE_RESOLUTION.
 * @param {readonly number[]} values
 * @param {number} n
 * @returns {number[]} (m)
 */
export function resample(values, n) {
  if (n === values.length) return [...values];
  const s = createSupport(freeformSupport(values));
  return knotAngles(n).map((psi) => rounded(s.p(psi)));
}

/**
 * Smallest radius of curvature of the groove bottom through the values over
 * one turn, exact (the spline is cubic between knots).
 * @param {readonly number[]} values
 * @returns {{ value: number, psi: number }} (m, rad)
 */
export function grooveMinRho(values) {
  return createSupport(freeformSupport(values)).minRho(0, 2 * Math.PI);
}

/**
 * Smallest radius of curvature of the pitch line, the groove bottom offset
 * by d/2: the quantity the solver checks against rhoLimitFor.
 * @param {readonly number[]} values
 * @param {number} d string diameter (m)
 * @returns {{ value: number, psi: number }} (m, rad)
 */
export function pitchMinRho(values, d) {
  const low = grooveMinRho(values);
  return { value: low.value + d / 2, psi: low.psi };
}

/**
 * True when every value lies in FREEFORM_RANGE and the pitch line reaches
 * limit.rho + limit.margin.
 * @param {readonly number[]} values
 * @param {FreeformLimit} limit
 */
export function withinLimit(values, limit) {
  if (!values.every((v) => v >= FREEFORM_RANGE.min && v <= FREEFORM_RANGE.max)) return false;
  return pitchMinRho(values, limit.d).value >= limit.rho + limit.margin;
}

/**
 * Resample to n points and check the result: the spline changes slightly,
 * and a track near the limit can fall below it (a triangle-egg track from 12
 * to 6 points went from +3.3 mm to −2.2 mm of radius of curvature).
 * @param {readonly number[]} values
 * @param {number} n
 * @param {FreeformLimit} limit
 * @returns {{ values: number[], minRho: number, below: boolean }} minRho of
 *   the pitch line (m); below: the resampled track misses the limit
 */
export function resampleChecked(values, n, limit) {
  const out = resample(values, n);
  const minRho = pitchMinRho(out, limit.d).value;
  return { values: out, minRho, below: !withinLimit(out, limit) };
}

/**
 * Every value moved outwards by delta: a parallel track, ρ + delta.
 * @param {readonly number[]} values
 * @param {number} delta (m)
 * @returns {number[]}
 */
export function offsetValues(values, delta) {
  return values.map((v) => v + delta);
}

/**
 * Highest harmonic of a modifier.
 * @param {ModifierId} id
 */
export function harmonicOf(id) {
  return Math.max(...MODIFIERS[id].terms.map(([k]) => k));
}

/**
 * Number of points a modifier needs: harmonic k needs N ≥ 4k, so a track
 * with fewer points is resampled first (Rounded square: 16, Rounded
 * triangle and Egg: 12).
 * @param {ModifierId} id
 * @param {number} n current number of points
 */
export function pointsFor(id, n) {
  return Math.min(FREEFORM_POINTS.max, Math.max(n, 4 * harmonicOf(id)));
}

/**
 * Values with a modifier added: resampled to pointsFor(id, N) first, then
 * p_i + amount·Σ w·cos k(ψ_i − angle).
 * @param {readonly number[]} values
 * @param {ModifierId} id
 * @param {number} amount (m)
 * @param {number} angle (rad)
 * @returns {number[]}
 */
export function applyModifier(values, id, amount, angle) {
  const base = resample(values, pointsFor(id, values.length));
  const psi = knotAngles(base.length);
  const terms = MODIFIERS[id].terms;
  return base.map((p, i) => {
    let add = 0;
    for (const [k, w] of terms) add += w * Math.cos(k * (psi[i] - angle));
    return p + amount * add;
  });
}

/**
 * Largest t in [0, max] with ok(t), for a predicate true on one interval
 * that starts at 0; 0 when ok(0) fails. Bisection to LIMIT_TOLERANCE.
 * @param {(t: number) => boolean} ok
 * @param {number} max
 */
function largestTrue(ok, max) {
  if (!ok(0)) return 0;
  if (ok(max)) return max;
  let lo = 0;
  let hi = max;
  while (hi - lo > LIMIT_TOLERANCE) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Largest amount of a modifier that keeps the track within its limit,
 * found by bisection on the spline of the modified values (the analytic
 * formula can pass where the spline fails: an egg of cos 2ψ and cos 3ψ at
 * 5/3 mm keeps +6 mm exactly but −1.7 mm on the 12-point spline). ρ is
 * linear in the amount, so the amounts within the limit form one interval.
 * @param {readonly number[]} values
 * @param {ModifierId} id
 * @param {number} angle (rad)
 * @param {FreeformLimit} limit
 * @param {1 | -1} [sign] direction of the amount; default 1 (−1 shrinks
 *   the track with Size)
 * @returns {number} signed amount (m), 0 when the unmodified track misses
 *   the limit
 */
export function largestAmount(values, id, angle, limit, sign = 1) {
  const base = resample(values, pointsFor(id, values.length));
  const t = largestTrue((a) => withinLimit(applyModifier(base, id, sign * a, angle), limit), MODIFIER_MAX_AMOUNT);
  return sign * t;
}

/**
 * Mean groove radius at which a modifier takes its full nominal amount; a
 * smaller track takes a proportionally smaller amount (m).
 */
export const MODIFIER_REFERENCE = 40e-3;

/**
 * Default amount of a modifier: its nominal amount, scaled down for a track
 * whose mean groove radius is below MODIFIER_REFERENCE, clamped to
 * largestAmount.
 * @param {readonly number[]} values
 * @param {ModifierId} id
 * @param {number} angle (rad)
 * @param {FreeformLimit} limit
 * @returns {number} (m)
 */
export function defaultAmount(values, id, angle, limit) {
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const nominal = MODIFIERS[id].amount * Math.min(1, mean / MODIFIER_REFERENCE);
  return Math.min(nominal, largestAmount(values, id, angle, limit));
}

/** Weights of the drag bump at offsets 0, ±1, ±2: a raised cosine ½·(1 + cos(π·j/3)). */
export const BUMP = Object.freeze([1, 0.75, 0.25]);

/**
 * Values with a smooth bump of height delta at index: the point moves by
 * delta, its neighbours by 0.75·delta and 0.25·delta (periodic indices).
 * A single value would bend the track sharply at its knot.
 * @param {readonly number[]} values
 * @param {number} index
 * @param {number} delta (m), positive outwards
 * @returns {number[]}
 */
export function dragBump(values, index, delta) {
  const n = values.length;
  const out = [...values];
  for (let j = -2; j <= 2; j++) out[(((index + j) % n) + n) % n] += delta * BUMP[Math.abs(j)];
  return out;
}

/**
 * Largest move of a drag bump at index in a direction that keeps the track
 * within its limit: the end of the feasible interval along the bump, by
 * bisection to within LIMIT_TOLERANCE (1 µm).
 * @param {readonly number[]} values
 * @param {number} index
 * @param {1 | -1} direction 1 outwards, −1 inwards
 * @param {FreeformLimit} limit
 * @returns {number} signed move (m); 0 when the track misses the limit already
 */
export function dragLimit(values, index, direction, limit) {
  return direction * largestTrue((t) => withinLimit(dragBump(values, index, direction * t), limit), DRAG_MAX);
}

/**
 * Contact points X(ψ_i) = p·n + p'·t of the groove bottom at the knots:
 * the points of the track where the tangent line of value i touches. They
 * sit off the radial line by p' (up to about 22 mm on the default track).
 * @param {readonly number[]} values
 * @returns {{ x: number, y: number, psi: number }[]} (m, rad)
 */
export function contactPoints(values) {
  const s = createSupport(freeformSupport(values));
  return knotAngles(values.length).map((psi) => ({ ...s.point(psi), psi }));
}
