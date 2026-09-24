/**
 * Unit conversion. All model code works in SI units (m, N, J, rad).
 * Conversion to display units happens only at the user interface boundary.
 * @module core/units
 */

/** 1 in in metres (exact). */
export const INCH = 0.0254;
/** 1 lbf in newtons (exact, standard gravity 9.80665 m/s²). */
export const LBF = 4.4482216152605;
/** 1 ft·lbf in joules (exact). */
export const FT_LBF = 0.3048 * LBF;
/** Offset between AMO draw length and nock-to-grip-pivot distance, in metres. */
export const AMO_OFFSET = 1.75 * INCH;

/**
 * Factors from each display unit to the SI unit of its quantity.
 * @type {Readonly<Record<string, Readonly<Record<string, number>>>>}
 */
export const UNITS = Object.freeze({
  length: Object.freeze({ m: 1, cm: 1e-2, mm: 1e-3, in: INCH }),
  force: Object.freeze({ N: 1, lbf: LBF }),
  energy: Object.freeze({ J: 1, 'ft·lbf': FT_LBF }),
  angle: Object.freeze({ rad: 1, deg: Math.PI / 180 }),
  stiffness: Object.freeze({ 'N/m': 1, 'N/mm': 1e3, 'lbf/in': LBF / INCH }),
});

/**
 * @param {string} quantity
 * @param {string} unit
 * @returns {number}
 */
function factor(quantity, unit) {
  const table = UNITS[quantity];
  if (!table) throw new Error(`Unknown quantity "${quantity}"`);
  const f = table[unit];
  if (f === undefined) throw new Error(`Unknown unit "${unit}" for ${quantity}`);
  return f;
}

/**
 * Convert a value in a display unit to SI.
 * @param {number} value
 * @param {string} quantity
 * @param {string} unit
 * @returns {number}
 */
export function toSI(value, quantity, unit) {
  return value * factor(quantity, unit);
}

/**
 * Convert an SI value to a display unit.
 * @param {number} value
 * @param {string} quantity
 * @param {string} unit
 * @returns {number}
 */
export function fromSI(value, quantity, unit) {
  return value / factor(quantity, unit);
}

/**
 * Parse a number typed by a user. Accepts a decimal point or a decimal comma
 * and surrounding white space. Returns NaN for anything else.
 * @param {string} text
 * @returns {number}
 */
export function parseNumber(text) {
  const s = String(text).trim().replace(/\s+/g, '');
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}

/**
 * Parse a quantity with an optional unit suffix, for example "750 mm" or
 * "29,5". Without a suffix the default unit applies.
 * @param {string} text
 * @param {string} quantity
 * @param {string} defaultUnit
 * @returns {number} value in SI units, or NaN when the text is not valid
 */
export function parseQuantity(text, quantity, defaultUnit) {
  const s = String(text).trim();
  const table = UNITS[quantity];
  if (!table) throw new Error(`Unknown quantity "${quantity}"`);
  const units = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const unit of units) {
    if (s.endsWith(unit)) {
      const head = s.slice(0, s.length - unit.length);
      const value = parseNumber(head);
      if (!Number.isNaN(value)) return toSI(value, quantity, unit);
    }
  }
  const value = parseNumber(s);
  return Number.isNaN(value) ? NaN : toSI(value, quantity, defaultUnit);
}

/**
 * Format an SI value in a display unit with a fixed number of decimals.
 * @param {number} value SI value
 * @param {string} quantity
 * @param {string} unit
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatQuantity(value, quantity, unit, decimals = 1) {
  if (!Number.isFinite(value)) return '–';
  const v = fromSI(value, quantity, unit);
  const text = v.toFixed(decimals);
  return `${Object.is(Number(text), -0) ? text.replace('-', '') : text} ${unit}`;
}
