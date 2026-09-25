/**
 * Display rules per unit: decimals, keyboard steps, axis labels.
 * @module ui/display
 */

import { AMO_OFFSET, fromSI } from '../core/units.js';

/** @typedef {import('../state/schema.js').Units} Units */

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
