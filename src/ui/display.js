/**
 * Display rules per unit: decimals, keyboard steps, axis labels.
 * @module ui/display
 */

import { pointMetrics } from '../core/curve.js';
import { AMO_OFFSET, fromSI } from '../core/units.js';

/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../core/curve.js').CurveMetrics} CurveMetrics */
/** @typedef {import('../core/interp.js').CurvePoint} CurvePoint */

/** Decimals of draw lengths in tables and fields, per unit. */
export const DRAW_DECIMALS = Object.freeze({ in: 2, mm: 1, cm: 2 });
/** Decimals of draw lengths in short labels, per unit. */
export const DRAW_DECIMALS_SHORT = Object.freeze({ in: 1, mm: 0, cm: 1 });
/** Decimals of forces in tables and fields, per unit. */
export const FORCE_DECIMALS = Object.freeze({ N: 1, lbf: 1 });
/** Decimals of forces in short labels, per unit. */
export const FORCE_DECIMALS_SHORT = Object.freeze({ N: 0, lbf: 1 });
/** Arrow-key step of a point along the draw, in display units (Shift: ×10). */
export const DRAW_STEP = Object.freeze({ in: 0.1, mm: 2.5, cm: 0.25 });
/** Arrow-key step of a point force, in display units (Shift: ×10). */
export const FORCE_STEP = Object.freeze({ N: 1, lbf: 0.2 });

/**
 * AMO draw length of a nock position, in the draw unit.
 * @param {number} x nock position from the grip pivot point (m)
 * @param {Units} units
 */
export function amo(x, units) {
  return fromSI(x + AMO_OFFSET, 'length', units.draw);
}

/**
 * @param {number} value
 * @param {number} decimals
 */
export function fixed(value, decimals) {
  const text = value.toFixed(decimals);
  return Object.is(Number(text), -0) ? text.replace('-', '') : text;
}

/**
 * Draw length (AMO) of a nock position as text without unit.
 * @param {number} x (m)
 * @param {Units} units
 * @param {boolean} [short]
 */
export function drawText(x, units, short = false) {
  return fixed(amo(x, units), (short ? DRAW_DECIMALS_SHORT : DRAW_DECIMALS)[units.draw]);
}

/**
 * Force as text without unit.
 * @param {number} F (N)
 * @param {Units} units
 * @param {boolean} [short]
 */
export function forceText(F, units, short = false) {
  return fixed(fromSI(F, 'force', units.force), (short ? FORCE_DECIMALS_SHORT : FORCE_DECIMALS)[units.force]);
}

/**
 * Length (not AMO-shifted) as text with unit.
 * @param {number} value (m)
 * @param {Units} units
 */
export function lengthLabel(value, units) {
  return `${fixed(fromSI(value, 'length', units.draw), DRAW_DECIMALS_SHORT[units.draw] + 1)} ${units.draw}`;
}

/**
 * Point position as "24.0 in, 251 N".
 * @param {{ x: number, F: number }} p
 * @param {Units} units
 */
export function pointLabel(p, units) {
  return `${drawText(p.x, units, true)} ${units.draw}, ${forceText(p.F, units, true)} ${units.force}`;
}

/**
 * A range bound rounded towards the inside of its range, so the printed
 * value is itself inside the range.
 * @param {number} value
 * @param {number} decimals
 * @param {1 | -1} direction 1 rounds up (lower bound), −1 rounds down
 */
export function inward(value, decimals, direction) {
  const f = 10 ** decimals;
  const r = direction > 0 ? Math.ceil(value * f - 1e-9) / f : Math.floor(value * f + 1e-9) / f;
  return fixed(r, decimals);
}

/**
 * A number with at most `digits` significant digits and no trailing zeros.
 * @param {number} v
 * @param {number} [digits]
 */
export function plain(v, digits = 6) {
  return String(Number(v.toPrecision(digits)));
}

/** @type {WeakMap<ReadonlyArray<CurvePoint>, CurveMetrics>} */
const metricsCache = new WeakMap();

/**
 * Metrics of the curve through the points, computed once per points array.
 * State arrays are never modified, so the array identifies its curve.
 * @param {ReadonlyArray<CurvePoint>} points
 * @returns {CurveMetrics}
 */
export function metricsOf(points) {
  let m = metricsCache.get(points);
  if (!m) {
    m = pointMetrics(points);
    metricsCache.set(points, m);
  }
  return m;
}
