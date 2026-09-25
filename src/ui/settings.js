/**
 * Settings panel: bow geometry, draw force parameters, limbs, string track,
 * cords, cam body and display units.
 * Text fields validate on Enter, blur and the stepper buttons; sliders apply
 * live, and one slider gesture is one undo entry. A note under a field says
 * when the curve cannot follow its value. Fields that do not apply to the
 * selected limb mode or track shape are hidden and keep their values.
 * @module ui/settings
 */

import { AMO_OFFSET, INCH, fromSI, parseNumber, parseQuantity, toSI } from '../core/units.js';
import { FIELDS, MIN_POWER_STROKE } from '../state/schema.js';
import { DEGREE, DIMS_DECIMALS, FORCE_DECIMALS, dimsText, fixed, forceText, inward, lengthLabel, metricsOf, plain } from './display.js';
import { h } from './dom.js';
import { infoButton } from './glossary.js';

/** @typedef {import('../state/schema.js').ProjectState} ProjectState */
/** @typedef {import('../state/schema.js').Units} Units */
/** @typedef {import('../state/schema.js').LimbState} LimbState */
/** @typedef {import('../state/schema.js').LimbRow} LimbRow */
/** @typedef {import('../state/schema.js').StringTrack} StringTrack */
/** @typedef {import('../state/store.js').Store} Store */
/** @typedef {import('../state/store.js').Action} Action */
/** @typedef {import('../core/interp.js').CurvePoint} CurvePoint */
/** @typedef {keyof typeof import('./glossary.js').GLOSSARY} GlossaryKey */

/**
 * Kind of a field: selects the quantity and the display unit.
 * - draw: length in units.draw
 * - dims: length in units.dims
 * - force: force in units.force
 * - percent: ratio shown in %
 * - angle: angle shown in degrees (°)
 * - stiffness: stiffness in units.stiffness
 * @typedef {'draw' | 'dims' | 'force' | 'percent' | 'angle' | 'stiffness'} FieldKind
 */

/**
 * @typedef {object} FieldDef
 * @property {string} id
 * @property {string} label
 * @property {GlossaryKey} [glossary]
 * @property {string} path key of the range in FIELDS
 * @property {FieldKind} kind
 * @property {(s: ProjectState) => number} get SI value
 * @property {(v: number, basePoints?: CurvePoint[]) => Action} action
 *   basePoints: custom points at the start of a slider gesture
 * @property {Record<string, number>} step per display unit
 * @property {Record<string, number>} decimals per display unit
 * @property {Record<string, number>} [sliderStep] per display unit; adds a slider
 * @property {(v: number, s: ProjectState) => string | null} [extra] cross-field check
 * @property {(s: ProjectState, def: FieldDef) => string} [note] information
 *   about the curve and this field, '' for none
 * @property {(s: ProjectState) => boolean} [visible] false hides the field;
 *   default: always shown
 */

/**
 * Quantity of a field kind as used by core/units, or 'ratio' for percent.
 * @param {FieldKind} kind
 * @returns {'length' | 'force' | 'angle' | 'stiffness' | 'ratio'}
 */
export function quantityOf(kind) {
  switch (kind) {
    case 'draw':
    case 'dims':
      return 'length';
    case 'force':
      return 'force';
    case 'angle':
      return 'angle';
    case 'stiffness':
      return 'stiffness';
    default:
      return 'ratio';
  }
}

/**
 * Display unit of a field.
 * @param {{ kind: FieldKind }} def
 * @param {Units} units
 * @returns {string} for example 'in', 'mm', 'N', '%', '°', 'N/mm'
 */
export function unitOf(def, units) {
  switch (def.kind) {
    case 'draw':
      return units.draw;
    case 'dims':
      return units.dims;
    case 'force':
      return units.force;
    case 'angle':
      return DEGREE;
    case 'stiffness':
      return units.stiffness;
    default:
      return '%';
  }
}

/**
 * Unit key of core/units for a field: the display unit, except 'deg' for
 * the degree symbol.
 * @param {{ kind: FieldKind }} def
 * @param {Units} units
 */
function convUnitOf(def, units) {
  return def.kind === 'angle' ? 'deg' : unitOf(def, units);
}

/**
 * A value with its unit: '12.5 mm', '75 %', but '30°' without a space.
 * @param {string} text
 * @param {string} unit
 */
export function withUnit(text, unit) {
  return unit === DEGREE ? `${text}${unit}` : `${text} ${unit}`;
}

/**
 * SI value of a field in its display unit.
 * @param {{ kind: FieldKind }} def
 * @param {number} v SI value
 * @param {Units} units
 * @returns {number}
 */
export function toDisplay(def, v, units) {
  const q = quantityOf(def.kind);
  if (q === 'ratio') return v * 100;
  return fromSI(v, q, convUnitOf(def, units));
}

/**
 * Display value of a field in SI.
 * @param {{ kind: FieldKind }} def
 * @param {number} v display value
 * @param {Units} units
 * @returns {number}
 */
export function fromDisplay(def, v, units) {
  const q = quantityOf(def.kind);
  if (q === 'ratio') return v / 100;
  return toSI(v, q, convUnitOf(def, units));
}

/**
 * Parse the text of a field. A unit suffix of the same quantity is
 * accepted, for example "0.1 in" in a millimetre field; an angle takes
 * '°', 'deg' or 'rad'.
 * @param {{ kind: FieldKind }} def
 * @param {string} text
 * @param {Units} units
 * @returns {number} SI value, NaN when the text is not a number
 */
export function parseField(def, text, units) {
  const q = quantityOf(def.kind);
  if (q === 'ratio') return parseNumber(text.replace(/\s*%\s*$/, '')) / 100;
  if (q === 'angle') return parseQuantity(text.replace(/\s*°\s*$/, ''), q, 'deg');
  return parseQuantity(text, q, unitOf(def, units));
}

/**
 * Range bounds of a field in the display unit, rounded inwards at the
 * field's decimals so that typing a printed bound is accepted.
 * @param {FieldDef} def
 * @param {Units} units
 */
function boundsText(def, units) {
  const spec = FIELDS[def.path];
  const d = def.decimals[unitOf(def, units)];
  return {
    lo: plain(Number(inward(toDisplay(def, spec.min, units), d, 1))),
    hi: plain(Number(inward(toDisplay(def, spec.max, units), d, -1))),
  };
}

/**
 * Note for a custom curve whose measured value lies outside the range of
 * the field, so the parameter shows the nearest bound.
 * @param {FieldDef} def
 * @param {ProjectState} s
 * @param {number} measured SI value of the custom curve
 * @param {string} what "peaks at" or "has a let-off of"
 * @param {string} shown measured value as text with unit
 */
function outsideNote(def, s, measured, what, shown) {
  const spec = FIELDS[def.path];
  // Tolerance: the measured value of a curve set to a bound differs from it by rounding.
  const tol = 1e-6 * Math.max(Math.abs(spec.min), Math.abs(spec.max));
  if (s.curve.mode !== 'custom' || (measured >= spec.min - tol && measured <= spec.max + tol)) return '';
  const u = unitOf(def, s.units);
  const used = plain(toDisplay(def, measured < spec.min ? spec.min : spec.max, s.units));
  return `The custom curve ${what} ${shown}, outside this range; Reset curve uses ${withUnit(used, u)}`;
}

/**
 * Cross-field message of a string track, the rules of schema.validate:
 * eccentric circle offset smaller than the radius, ellipse offset smaller
 * than the semi-minor axis, semi-minor axis not larger than the semi-major
 * axis. Returns the first rule the track breaks, or null.
 * @param {StringTrack} track
 * @param {Units} units
 * @returns {string | null}
 */
export function stringTrackMessage(track, units) {
  const { shape, offset, radius, semiMajor, semiMinor } = track;
  if (shape === 'eccentric' && offset >= radius) {
    return `String track offset must be smaller than the radius (${dimsText(radius, units)})`;
  }
  if (shape === 'ellipse' && offset >= semiMinor) {
    return `String track offset must be smaller than the semi-minor axis (${dimsText(semiMinor, units)})`;
  }
  if (semiMinor > semiMajor) {
    return `String track semi-minor axis must not exceed the semi-major axis (${dimsText(semiMajor, units)})`;
  }
  return null;
}

/**
 * Cross-field check of one string track field against the current state.
 * @param {'radius' | 'offset' | 'semiMajor' | 'semiMinor' | 'shape'} key
 * @param {number | StringTrack['shape']} value SI value, or the shape
 * @param {ProjectState} s
 * @returns {string | null}
 */
export function stringTrackExtra(key, value, s) {
  return stringTrackMessage({ ...s.stringTrack, [key]: value }, s.units);
}

/** Limits of the measured limb table. The schema needs 3 rows in table mode. */
export const LIMB_TABLE = Object.freeze({
  /** Fewest rows. */
  minRows: 3,
  /** Most rows. */
  maxRows: 50,
  /** Largest travel from brace (m). */
  travelMax: 0.4,
  /** Largest force at the axle (N). */
  forceMax: 10000,
  /**
   * Smallest travel step between rows (m): 0.01 mm. The solver needs rows
   * at least 1e-6 rad of limb rotation apart, 0.5 µm on a 0.508 m lever.
   */
  travelGapMin: 1e-5,
});

/**
 * @typedef {object} LimbRowText
 * @property {string} travel travel from brace in the dimension unit
 * @property {string} force force at the axle in the force unit
 */

/**
 * @typedef {object} LimbRowError
 * @property {number} row 0-based row index, -1 for the whole table
 * @property {'travel' | 'force' | 'table'} column
 * @property {string} message
 */

/**
 * Decimals of limb-table travel per dimension unit: fine enough to show the
 * smallest gap between rows, LIMB_TABLE.travelGapMin (0.01 mm, 0.0004 in).
 */
export const LIMB_TRAVEL_DECIMALS = Object.freeze({ mm: 2, in: 4 });

/**
 * Limb table rows as display text.
 * @param {LimbRow[]} rows SI values
 * @param {Units} units
 * @returns {LimbRowText[]}
 */
export function formatLimbRows(rows, units) {
  return rows.map((r) => ({
    travel: fixed(fromSI(r.travel, 'length', units.dims), LIMB_TRAVEL_DECIMALS[units.dims]),
    force: fixed(fromSI(r.force, 'force', units.force), FORCE_DECIMALS[units.force]),
  }));
}

/**
 * Check limb table rows: row count, numbers inside the ranges of LIMB_TABLE
 * and travel increasing by at least LIMB_TABLE.travelGapMin.
 * @param {LimbRow[]} rows SI values
 * @param {Units} units unit of the messages
 * @returns {LimbRowError[]} empty when valid
 */
export function validateLimbRows(rows, units) {
  /** @type {LimbRowError[]} */
  const errors = [];
  if (rows.length < LIMB_TABLE.minRows || rows.length > LIMB_TABLE.maxRows) {
    errors.push({
      row: -1,
      column: 'table',
      message: `The limb table needs ${LIMB_TABLE.minRows} to ${LIMB_TABLE.maxRows} rows`,
    });
  }
  const { travelHi, forceHi } = limbBoundsText(units);
  const gap = plain(fromSI(LIMB_TABLE.travelGapMin, 'length', units.dims));
  for (let i = 0; i < rows.length; i++) {
    const { travel, force } = rows[i];
    if (!Number.isFinite(travel)) {
      errors.push({ row: i, column: 'travel', message: `Row ${i + 1}: travel must be a number` });
    } else if (travel < 0 || travel > LIMB_TABLE.travelMax) {
      errors.push({ row: i, column: 'travel', message: `Row ${i + 1}: travel must be between 0 and ${travelHi} ${units.dims}` });
    } else if (i > 0 && Number.isFinite(rows[i - 1].travel) && !(travel > rows[i - 1].travel)) {
      errors.push({ row: i, column: 'travel', message: `Row ${i + 1}: travel must be larger than in row ${i}` });
    } else if (i > 0 && Number.isFinite(rows[i - 1].travel) && travel - rows[i - 1].travel < LIMB_TABLE.travelGapMin * (1 - 1e-9)) {
      errors.push({ row: i, column: 'travel', message: `Row ${i + 1}: travel must be at least ${gap} ${units.dims} larger than in row ${i}` });
    }
    if (!Number.isFinite(force)) {
      errors.push({ row: i, column: 'force', message: `Row ${i + 1}: force must be a number` });
    } else if (force < 0 || force > LIMB_TABLE.forceMax) {
      errors.push({ row: i, column: 'force', message: `Row ${i + 1}: force must be between 0 and ${forceHi} ${units.force}` });
    }
  }
  return errors;
}

/**
 * Upper bounds of the limb table in the display units, rounded down at the
 * decimals of the cells so that typing a printed bound is accepted.
 * @param {Units} units
 */
function limbBoundsText(units) {
  return {
    travelHi: plain(Number(inward(fromSI(LIMB_TABLE.travelMax, 'length', units.dims), DIMS_DECIMALS[units.dims], -1))),
    forceHi: plain(Number(inward(fromSI(LIMB_TABLE.forceMax, 'force', units.force), FORCE_DECIMALS[units.force], -1))),
  };
}

/**
 * A typed value within 1e-9 relative of a bound of 0 to max, moved onto
 * that bound; the display unit round trip leaves such a difference.
 * @param {number} v
 * @param {number} max
 */
function snapToBounds(v, max) {
  const tol = 1e-9 * max;
  if (v < 0 && v >= -tol) return 0;
  if (v > max && v <= max + tol) return max;
  return v;
}

/**
 * Parse the text of limb table rows and check them. A cell whose text
 * equals the formatted previous value keeps the previous SI value, so
 * editing one cell does not round the others. A typed value within 1e-9
 * relative of a bound is clamped to it.
 * @param {LimbRowText[]} texts
 * @param {Units} units
 * @param {LimbRow[]} [previous] SI rows the texts were formatted from
 * @returns {{ rows: LimbRow[], errors: LimbRowError[] }}
 */
export function parseLimbRows(texts, units, previous = []) {
  const shown = formatLimbRows(previous, units);
  const rows = texts.map((t, i) => ({
    travel:
      shown[i] && t.travel.trim() === shown[i].travel
        ? previous[i].travel
        : snapToBounds(parseQuantity(t.travel, 'length', units.dims), LIMB_TABLE.travelMax),
    force:
      shown[i] && t.force.trim() === shown[i].force
        ? previous[i].force
        : snapToBounds(parseQuantity(t.force, 'force', units.force), LIMB_TABLE.forceMax),
  }));
  return { rows, errors: validateLimbRows(rows, units) };
}

/**
 * Starting table for the measured table mode: five rows over the axle
 * travel of the limb, with the forces of the linear limb (stiffness times
 * preload plus travel).
 * @param {LimbState} limb
 * @returns {LimbRow[]}
 */
export function seedLimbTable(limb) {
  const travel = Math.min(limb.travel, LIMB_TABLE.travelMax);
  /** @type {LimbRow[]} */
  const rows = [];
  for (let i = 0; i <= 4; i++) {
    const t = (travel * i) / 4;
    rows.push({ travel: t, force: Math.min(limb.stiffness * (limb.preloadTravel + t), LIMB_TABLE.forceMax) });
  }
  return rows;
}

/**
 * Row to add after the last one: continues the last interval (10 mm of
 * travel when there is none), limited to the ranges of LIMB_TABLE. Null
 * when the table is full or the last travel is less than
 * LIMB_TABLE.travelGapMin below its maximum.
 * @param {LimbRow[]} rows
 * @returns {LimbRow | null}
 */
export function nextLimbRow(rows) {
  if (rows.length >= LIMB_TABLE.maxRows) return null;
  const last = rows.at(-1);
  if (!last) return { travel: 0, force: 0 };
  const prev = rows.at(-2);
  const dt = prev && last.travel > prev.travel ? last.travel - prev.travel : 0.01;
  const dF = prev ? last.force - prev.force : 0;
  if (!(LIMB_TABLE.travelMax - last.travel >= LIMB_TABLE.travelGapMin)) return null;
  return {
    travel: Math.min(last.travel + dt, LIMB_TABLE.travelMax),
    force: Math.min(Math.max(last.force + dF, 0), LIMB_TABLE.forceMax),
  };
}

/** @type {FieldDef[]} */
const GEOMETRY_FIELDS = [
  {
    id: 'ata',
    label: 'Axle-to-axle length (ATA)',
    glossary: 'ata',
    path: 'geometry.ata',
    kind: 'draw',
    get: (s) => s.geometry.ata,
    action: (v) => ({ type: 'setGeometry', geometry: { ata: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
  },
  {
    id: 'brace',
    label: 'Brace height',
    glossary: 'braceHeight',
    path: 'geometry.braceHeight',
    kind: 'draw',
    get: (s) => s.geometry.braceHeight,
    action: (v) => ({ type: 'setGeometry', geometry: { braceHeight: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
    extra: (v, s) => {
      const max = s.geometry.drawLength - AMO_OFFSET - MIN_POWER_STROKE;
      if (v < max) return null;
      const u = s.units.draw;
      return `Brace height must be less than ${plain(fromSI(max, 'length', u))} ${u} for this draw length (at least ${plain(MIN_POWER_STROKE / INCH)} in of power stroke)`;
    },
  },
  {
    id: 'draw',
    label: 'Draw length (AMO)',
    glossary: 'drawLength',
    path: 'geometry.drawLength',
    kind: 'draw',
    get: (s) => s.geometry.drawLength,
    action: (v) => ({ type: 'setGeometry', geometry: { drawLength: v } }),
    step: { in: 0.25, mm: 5, cm: 0.5 },
    decimals: { in: 2, mm: 1, cm: 2 },
    extra: (v, s) => {
      const min = s.geometry.braceHeight + AMO_OFFSET + MIN_POWER_STROKE;
      if (v > min) return null;
      const u = s.units.draw;
      return `Draw length must be more than ${plain(fromSI(min, 'length', u))} ${u}: brace height + 1.75 in + ${plain(MIN_POWER_STROKE / INCH)} in of power stroke`;
    },
  },
  {
    id: 'limb-length',
    label: 'Limb lever length, pivot to axle',
    path: 'geometry.limbLength',
    kind: 'dims',
    get: (s) => s.geometry.limbLength,
    action: (v) => ({ type: 'setGeometry', geometry: { limbLength: v } }),
    step: { mm: 5, in: 0.25 },
    decimals: DIMS_DECIMALS,
  },
  {
    id: 'limb-angle',
    label: 'Limb lever angle at brace',
    path: 'geometry.limbAngleBrace',
    kind: 'angle',
    get: (s) => s.geometry.limbAngleBrace,
    action: (v) => ({ type: 'setGeometry', geometry: { limbAngleBrace: v } }),
    step: { [DEGREE]: 1 },
    decimals: { [DEGREE]: 1 },
  },
];

/** @type {FieldDef[]} */
const FORCE_FIELDS = [
  {
    id: 'peak',
    label: 'Peak draw force',
    glossary: 'peak',
    path: 'curve.params.peak',
    kind: 'force',
    get: (s) => s.curve.params.peak,
    action: (v, basePoints) => ({ type: 'setCurveParams', params: { peak: v }, basePoints }),
    step: { N: 1, lbf: 0.5 },
    decimals: { N: 1, lbf: 1 },
    sliderStep: { N: 1, lbf: 0.5 },
    note: (s, def) => {
      const peak = metricsOf(s.curve.points).peak;
      return outsideNote(def, s, peak, 'peaks at', `${forceText(peak, s.units, true)} ${s.units.force}`);
    },
  },
  {
    id: 'letoff',
    label: 'Let-off',
    glossary: 'letOff',
    path: 'curve.params.letOff',
    kind: 'percent',
    get: (s) => s.curve.params.letOff,
    action: (v, basePoints) => ({ type: 'setCurveParams', params: { letOff: v }, basePoints }),
    step: { '%': 1 },
    decimals: { '%': 1 },
    sliderStep: { '%': 1 },
    note: (s, def) => {
      const letOff = metricsOf(s.curve.points).letOff;
      return outsideNote(def, s, letOff, 'has a let-off of', `${fixed(letOff * 100, 1)} %`);
    },
  },
  {
    id: 'rise',
    label: 'Rise to peak, share of power stroke',
    path: 'curve.params.riseFraction',
    kind: 'percent',
    get: (s) => s.curve.params.riseFraction,
    action: (v) => ({ type: 'setCurveParams', params: { riseFraction: v } }),
    step: { '%': 1 },
    decimals: { '%': 0 },
  },
  {
    id: 'valley',
    label: 'Valley width',
    glossary: 'valley',
    path: 'curve.params.valleyWidth',
    kind: 'draw',
    get: (s) => s.curve.params.valleyWidth,
    action: (v) => ({ type: 'setCurveParams', params: { valleyWidth: v } }),
    step: { in: 0.1, mm: 2.5, cm: 0.25 },
    decimals: { in: 2, mm: 1, cm: 2 },
    note: (s) => {
      if (s.curve.mode !== 'parametric') return '';
      const target = s.curve.params.valleyWidth;
      const width = metricsOf(s.curve.points).valleyWidth;
      if (Math.abs(width - target) <= 0.01 * target) return '';
      return `Valley width is limited to ${lengthLabel(width, s.units)} by the let-off, rise and power stroke`;
    },
  },
];

/**
 * Slider step that divides a range into count steps with both ends
 * reachable. The browser divides the range by the decimal step string: a
 * step even 1e-16 too long leaves the last step out (201.8 instead of
 * 202.3 lbf). The step keeps 12 significant digits, rounded down unless
 * the division is exact, so count steps always fit.
 * @param {number} range max − min
 * @param {number} count
 */
export function sliderStep(range, count) {
  const exact = range / count;
  const p = Number(exact.toPrecision(12));
  if (p <= exact) return p;
  const ulp = 10 ** (Math.floor(Math.log10(exact)) - 11);
  return Number((p - ulp).toPrecision(12));
}

/**
 * Steps and decimals of dimension and angle fields. Travel and track fields
 * show the decimals of DIMS_DECIMALS; the fine fields (cords, body) show
 * one more millimetre decimal for their 0.1 mm step.
 */
const TRAVEL = { step: { mm: 1, in: 0.05 }, decimals: DIMS_DECIMALS };
const TRACK = { step: { mm: 0.5, in: 0.02 }, decimals: DIMS_DECIMALS };
const FINE = { step: { mm: 0.1, in: 0.005 }, decimals: { mm: 2, in: 3 } };
const ANGLE = { step: { [DEGREE]: 1 }, decimals: { [DEGREE]: 1 } };

/** @type {FieldDef[]} */
const LIMB_FIELDS = [
  {
    id: 'limb-stiffness',
    label: 'Limb stiffness at the axle',
    path: 'limb.stiffness',
    kind: 'stiffness',
    get: (s) => s.limb.stiffness,
    action: (v) => ({ type: 'setLimb', limb: { stiffness: v } }),
    step: { 'N/mm': 0.1, 'lbf/in': 1 },
    decimals: { 'N/mm': 2, 'lbf/in': 1 },
    visible: (s) => s.limb.mode === 'stiffness',
  },
  {
    id: 'limb-travel',
    label: 'Axle travel, brace to full draw',
    path: 'limb.travel',
    kind: 'dims',
    get: (s) => s.limb.travel,
    action: (v) => ({ type: 'setLimb', limb: { travel: v } }),
    ...TRAVEL,
    visible: (s) => s.limb.mode === 'travel',
  },
  {
    id: 'limb-preload',
    label: 'Preload travel, unstrung to brace',
    path: 'limb.preloadTravel',
    kind: 'dims',
    get: (s) => s.limb.preloadTravel,
    action: (v) => ({ type: 'setLimb', limb: { preloadTravel: v } }),
    ...TRAVEL,
  },
  {
    id: 'limb-rotation',
    label: 'Maximum limb rotation from brace',
    path: 'limb.maxRotation',
    kind: 'angle',
    get: (s) => s.limb.maxRotation,
    action: (v) => ({ type: 'setLimb', limb: { maxRotation: v } }),
    ...ANGLE,
  },
];

/**
 * @param {'radius' | 'offset' | 'semiMajor' | 'semiMinor'} key
 * @returns {(v: number, s: ProjectState) => string | null}
 */
const trackExtra = (key) => (v, s) => stringTrackExtra(key, v, s);

/** @type {FieldDef[]} */
const TRACK_FIELDS = [
  {
    id: 'track-radius',
    label: 'Radius',
    path: 'stringTrack.radius',
    kind: 'dims',
    get: (s) => s.stringTrack.radius,
    action: (v) => ({ type: 'setStringTrack', stringTrack: { radius: v } }),
    ...TRACK,
    extra: trackExtra('radius'),
    visible: (s) => s.stringTrack.shape === 'eccentric',
  },
  {
    id: 'track-semi-major',
    label: 'Semi-major axis',
    path: 'stringTrack.semiMajor',
    kind: 'dims',
    get: (s) => s.stringTrack.semiMajor,
    action: (v) => ({ type: 'setStringTrack', stringTrack: { semiMajor: v } }),
    ...TRACK,
    extra: trackExtra('semiMajor'),
    visible: (s) => s.stringTrack.shape === 'ellipse',
  },
  {
    id: 'track-semi-minor',
    label: 'Semi-minor axis',
    path: 'stringTrack.semiMinor',
    kind: 'dims',
    get: (s) => s.stringTrack.semiMinor,
    action: (v) => ({ type: 'setStringTrack', stringTrack: { semiMinor: v } }),
    ...TRACK,
    extra: trackExtra('semiMinor'),
    visible: (s) => s.stringTrack.shape === 'ellipse',
  },
  {
    id: 'track-offset',
    label: 'Centre offset from the axle',
    path: 'stringTrack.offset',
    kind: 'dims',
    get: (s) => s.stringTrack.offset,
    action: (v) => ({ type: 'setStringTrack', stringTrack: { offset: v } }),
    ...TRACK,
    extra: trackExtra('offset'),
  },
  {
    id: 'track-phase',
    label: 'Phase',
    path: 'stringTrack.phase',
    kind: 'angle',
    get: (s) => s.stringTrack.phase,
    action: (v) => ({ type: 'setStringTrack', stringTrack: { phase: v } }),
    ...ANGLE,
  },
];

/** @type {FieldDef[]} */
const CORD_FIELDS = [
  {
    id: 'string-diameter',
    label: 'String diameter',
    path: 'cords.stringDiameter',
    kind: 'dims',
    get: (s) => s.cords.stringDiameter,
    action: (v) => ({ type: 'setCords', cords: { stringDiameter: v } }),
    ...FINE,
  },
  {
    id: 'cable-diameter',
    label: 'Cable diameter',
    path: 'cords.cableDiameter',
    kind: 'dims',
    get: (s) => s.cords.cableDiameter,
    action: (v) => ({ type: 'setCords', cords: { cableDiameter: v } }),
    ...FINE,
  },
  {
    id: 'string-groove',
    label: 'String groove depth',
    path: 'cords.stringGrooveDepth',
    kind: 'dims',
    get: (s) => s.cords.stringGrooveDepth,
    action: (v) => ({ type: 'setCords', cords: { stringGrooveDepth: v } }),
    ...FINE,
  },
  {
    id: 'cable-groove',
    label: 'Cable groove depth',
    path: 'cords.cableGrooveDepth',
    kind: 'dims',
    get: (s) => s.cords.cableGrooveDepth,
    action: (v) => ({ type: 'setCords', cords: { cableGrooveDepth: v } }),
    ...FINE,
  },
];

/** @type {FieldDef[]} */
const BODY_FIELDS = [
  {
    id: 'bore',
    label: 'Axle bore diameter',
    path: 'body.boreDiameter',
    kind: 'dims',
    get: (s) => s.body.boreDiameter,
    action: (v) => ({ type: 'setBody', body: { boreDiameter: v } }),
    ...FINE,
  },
  {
    id: 'wall',
    label: 'Minimum wall, groove bottom to bore',
    path: 'body.minWall',
    kind: 'dims',
    get: (s) => s.body.minWall,
    action: (v) => ({ type: 'setBody', body: { minWall: v } }),
    ...FINE,
  },
  {
    id: 'post',
    label: 'Post diameter',
    path: 'body.postDiameter',
    kind: 'dims',
    get: (s) => s.body.postDiameter,
    action: (v) => ({ type: 'setBody', body: { postDiameter: v } }),
    ...FINE,
  },
  {
    id: 'bend-radius',
    label: 'Minimum bend radius of a track',
    path: 'body.minBendRadius',
    kind: 'dims',
    get: (s) => s.body.minBendRadius,
    action: (v) => ({ type: 'setBody', body: { minBendRadius: v } }),
    ...FINE,
  },
  {
    id: 'flange-thickness',
    label: 'Flange plate thickness (plates 1, 3, 5)',
    path: 'body.flangeThickness',
    kind: 'dims',
    get: (s) => s.body.flangeThickness,
    action: (v) => ({ type: 'setBody', body: { flangeThickness: v } }),
    ...FINE,
  },
  {
    id: 'groove-clearance',
    label: 'Groove clearance (plates 2, 4)',
    path: 'body.grooveClearance',
    kind: 'dims',
    get: (s) => s.body.grooveClearance,
    action: (v) => ({ type: 'setBody', body: { grooveClearance: v } }),
    ...FINE,
    note: (s) => {
      const c = s.body.grooveClearance;
      return `Groove plates are the cord diameter plus the clearance thick: string ${dimsText(s.cords.stringDiameter + c, s.units)}, `
        + `cable ${dimsText(s.cords.cableDiameter + c, s.units)}. Used by the STEP export only.`;
    },
  },
  {
    id: 'lead-in',
    label: 'Lead-in wrap of the cable at brace',
    path: 'body.leadInWrap',
    kind: 'angle',
    get: (s) => s.body.leadInWrap,
    action: (v) => ({ type: 'setBody', body: { leadInWrap: v } }),
    ...ANGLE,
  },
  {
    id: 'residual',
    label: 'Residual wrap of the string at full draw',
    path: 'body.residualWrap',
    kind: 'angle',
    get: (s) => s.body.residualWrap,
    action: (v) => ({ type: 'setBody', body: { residualWrap: v } }),
    ...ANGLE,
  },
];

/** One-line hint under the limb input select, per limb mode. */
export const LIMB_MODE_HINTS = Object.freeze({
  stiffness: 'The limb stiffness and the preload travel set the limb; Results show the axle travel to full draw.',
  travel: 'The axle travel from brace to full draw and the preload travel set the limb stiffness for the draw energy of the curve.',
  table: 'Measured force at the axle against axle travel from brace; the preload travel places brace on the travel from the unstrung limb.',
});

/** Options of the limb input select. */
const LIMB_MODES = Object.freeze([
  { value: 'stiffness', label: 'Stiffness and preload' },
  { value: 'travel', label: 'Axle travel and preload' },
  { value: 'table', label: 'Measured table' },
]);

/** Options of the string track shape select. */
const TRACK_SHAPES = Object.freeze([
  { value: 'eccentric', label: 'Eccentric circle' },
  { value: 'ellipse', label: 'Ellipse' },
]);

/**
 * @typedef {object} InputGroup
 * @property {string} title group title as in the panel
 * @property {{ label: string, text: string }[]} rows value with unit, in the
 *   display units of the state
 */

/**
 * Inputs of a state as label and text, grouped and labelled as in the
 * panel. Fields hidden in the panel for the selected limb mode or track
 * shape are left out; a measured limb lists its rows.
 * @param {ProjectState} s
 * @returns {InputGroup[]}
 */
export function inputGroups(s) {
  /** @param {FieldDef[]} defs */
  const rows = (defs) => defs.filter((def) => !def.visible || def.visible(s)).map((def) => {
    const u = unitOf(def, s.units);
    return { label: def.label, text: withUnit(fixed(toDisplay(def, def.get(s), s.units), def.decimals[u]), u) };
  });
  /**
   * @param {readonly { value: string, label: string }[]} options
   * @param {string} value
   */
  const option = (options, value) => options.find((o) => o.value === value)?.label ?? value;
  const table = s.limb.mode === 'table'
    ? formatLimbRows(s.limb.table, s.units).map((r, i) => ({
        label: `Row ${i + 1}: travel from brace, force at the axle`,
        text: `${r.travel} ${s.units.dims}, ${r.force} ${s.units.force}`,
      }))
    : [];
  return [
    { title: 'Bow geometry', rows: rows(GEOMETRY_FIELDS) },
    {
      title: 'Draw force',
      rows: [{ label: 'Curve', text: s.curve.mode === 'custom' ? 'Custom' : 'Parametric' }, ...rows(FORCE_FIELDS)],
    },
    { title: 'Limbs', rows: [{ label: 'Limb input', text: option(LIMB_MODES, s.limb.mode) }, ...rows(LIMB_FIELDS), ...table] },
    { title: 'String track', rows: [{ label: 'Shape', text: option(TRACK_SHAPES, s.stringTrack.shape) }, ...rows(TRACK_FIELDS)] },
    { title: 'Cords', rows: rows(CORD_FIELDS) },
    { title: 'Cam body', rows: rows(BODY_FIELDS) },
  ];
}

const UNIT_SELECTS = /** @type {const} */ ([
  { id: 'draw', label: 'Draw length unit', key: 'draw', options: ['in', 'mm', 'cm'] },
  { id: 'force', label: 'Force unit', key: 'force', options: ['N', 'lbf'] },
  { id: 'dims', label: 'Dimension unit', key: 'dims', options: ['mm', 'in'] },
  { id: 'energy', label: 'Energy unit', key: 'energy', options: ['J', 'ft·lbf'] },
  { id: 'stiffness', label: 'Stiffness unit', key: 'stiffness', options: ['N/mm', 'lbf/in'] },
]);

/**
 * Settings panel. Groups: fieldsets "Bow geometry" (data-testid
 * settings-geometry), "Draw force" (settings-force) and "Units"
 * (settings-units); open details elements "Limbs" (settings-limbs),
 * "String track" (settings-string-track), "Cords" (settings-cords) and "Cam body"
 * (settings-cam-body).
 * @param {HTMLElement} panel element to fill
 * @param {Store} store
 * @returns {{ render: (state: ProjectState) => void }}
 */
export function createSettings(panel, store) {
  /** @type {((s: ProjectState) => void)[]} */
  const renderers = [];

  /** @param {FieldDef} def */
  function field(def) {
    const inputId = `f-${def.id}`;
    const msg = h('p', { class: 'field-msg', id: `${inputId}-msg`, 'data-testid': `field-${def.id}-msg`, 'aria-live': 'polite' });
    const range = h('p', { class: 'field-range', id: `${inputId}-range` });
    const input = h('input', {
      id: inputId,
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'spinbutton',
      'aria-describedby': `${inputId}-range ${inputId}-msg`,
      'data-testid': `field-${def.id}`,
    });
    const unit = h('span', { class: 'unit', 'aria-hidden': 'true' });
    const dec = h('button', { type: 'button', class: 'stepper', 'aria-label': `Decrease ${def.label.toLowerCase()}` }, '−');
    const inc = h('button', { type: 'button', class: 'stepper', 'aria-label': `Increase ${def.label.toLowerCase()}` }, '+');
    const labelRow = h('div', { class: 'field-label-row' }, h('label', { for: inputId }, def.label));
    if (def.glossary) labelRow.append(infoButton(def.glossary));
    const row = h('div', { class: 'field-input-row' }, dec, input, inc, unit);
    /** @type {HTMLInputElement | null} */
    let slider = null;
    if (def.sliderStep) {
      slider = h('input', {
        type: 'range',
        class: 'slider',
        'aria-label': `${def.label} slider`,
        'data-testid': `slider-${def.id}`,
      });
    }
    const wrap = h('div', { class: 'field', 'data-field': def.id }, labelRow);
    if (slider) wrap.append(slider);
    wrap.append(row, range, msg);
    let rendered = '';
    let renderedUnit = '';
    // Message of the last input (an error, or a limit of the applied value);
    // it stays until the value changes. The note describes the state and
    // shows when there is no such message.
    let said = '';
    let invalid = false;
    let note = '';

    function showMessage() {
      msg.textContent = said || note;
      input.setAttribute('aria-invalid', String(invalid));
    }

    /**
     * @param {string} text
     * @param {boolean} [isError] marks the field invalid; default: text is not empty
     */
    const say = (text, isError = text !== '') => {
      said = text;
      invalid = isError && text !== '';
      showMessage();
    };

    /**
     * Validate and apply an SI value. Returns true when applied.
     * @param {number} value
     * @param {CurvePoint[]} [basePoints] custom points at the start of a slider gesture
     */
    function apply(value, basePoints) {
      const s = store.getState();
      const spec = FIELDS[def.path];
      const u = unitOf(def, s.units);
      if (!Number.isFinite(value)) {
        say(`${def.label} must be a number`);
        return false;
      }
      // A typed bound round-trips through the display unit: allow rounding,
      // then clamp so the store accepts it.
      const tol = 1e-9 * Math.max(Math.abs(spec.min), Math.abs(spec.max));
      if (value < spec.min - tol || value > spec.max + tol) {
        const { lo, hi } = boundsText(def, s.units);
        say(`${def.label} must be between ${lo} and ${withUnit(hi, u)}`);
        return false;
      }
      const v = Math.min(Math.max(value, spec.min), spec.max);
      const extra = def.extra?.(v, s);
      if (extra) {
        say(extra);
        return false;
      }
      const errors = store.dispatch(def.action(v, basePoints));
      if (errors.length > 0) {
        say(errors[0].message);
        return false;
      }
      say('');
      if (def.id === 'letoff') {
        const achieved = store.getState().curve.params.letOff;
        if (Math.abs(achieved - v) > 0.001) {
          say(`Let-off is limited to ${fixed(achieved * 100, 1)} % by the points after the peak`, false);
        }
      }
      return true;
    }

    function commitText() {
      if (input.value === rendered) {
        say('');
        return;
      }
      apply(parseField(def, input.value, store.getState().units));
      renderField(store.getState(), true);
    }

    /** @param {number} direction */
    function step(direction) {
      const s = store.getState();
      const u = unitOf(def, s.units);
      const current = toDisplay(def, def.get(s), s.units);
      const size = def.step[u];
      const next = (Math.round(current / size + 1e-9) + direction) * size;
      apply(fromDisplay(def, next, s.units));
      renderField(store.getState(), true);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitText();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.key === 'Escape') {
        input.value = rendered;
        say('');
      }
    });
    input.addEventListener('blur', commitText);
    dec.addEventListener('click', () => step(-1));
    inc.addEventListener('click', () => step(1));

    if (slider) {
      const s0 = slider;
      /**
       * Points at the start of the gesture: every value of the gesture
       * applies to them, so moving back restores the curve.
       * @type {CurvePoint[] | undefined}
       */
      let base;
      s0.addEventListener('input', () => {
        if (!store.inTransaction()) {
          store.beginTransaction();
          base = store.getState().curve.points;
        }
        apply(fromDisplay(def, Number(s0.value), store.getState().units), base);
      });
      const end = () => {
        base = undefined;
        if (store.inTransaction()) store.commitTransaction();
      };
      s0.addEventListener('change', end);
      s0.addEventListener('pointerup', end);
      // A gesture taken over by the browser or the system ends without
      // pointerup or change.
      s0.addEventListener('pointercancel', end);
      s0.addEventListener('lostpointercapture', end);
      s0.addEventListener('blur', end);
    }

    /**
     * @param {ProjectState} s
     * @param {boolean} [force] update the text field even when focused
     */
    function renderField(s, force = false) {
      const spec = FIELDS[def.path];
      const u = unitOf(def, s.units);
      const d = def.decimals[u];
      const value = toDisplay(def, def.get(s), s.units);
      const text = fixed(value, d);
      wrap.hidden = def.visible ? !def.visible(s) : false;
      unit.textContent = u;
      const lo = toDisplay(def, spec.min, s.units);
      const hi = toDisplay(def, spec.max, s.units);
      const bounds = boundsText(def, s.units);
      range.textContent = `${bounds.lo} to ${withUnit(bounds.hi, u)}, step ${withUnit(plain(def.step[u]), u)}`;
      setAria(input, lo, hi, value, withUnit(text, u));
      // Only a focused field keeps its text; a failed input was already
      // reverted by the forced render after it.
      if (force || document.activeElement !== input) {
        if (!force && (text !== rendered || u !== renderedUnit)) {
          // Changed elsewhere (undo, units, slider): the old message no longer applies.
          said = '';
          invalid = false;
        }
        input.value = text;
        rendered = text;
        renderedUnit = u;
      }
      note = def.note?.(s, def) ?? '';
      showMessage();
      if (slider && def.sliderStep) {
        // The slider spans the same bounds as the field. The step is the
        // nominal step adjusted so that it divides the range, which keeps
        // both bounds reachable (Home, End, and the ends of a drag).
        const min = Number(bounds.lo);
        const max = Number(bounds.hi);
        const count = Math.max(1, Math.round((max - min) / def.sliderStep[u]));
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(sliderStep(max - min, count));
        slider.value = String(value);
        slider.setAttribute('aria-valuetext', withUnit(text, u));
      }
    }
    renderers.push(renderField);
    return wrap;
  }

  /**
   * @param {HTMLInputElement} input
   * @param {number} lo
   * @param {number} hi
   * @param {number} now
   * @param {string} text
   */
  function setAria(input, lo, hi, now, text) {
    input.setAttribute('aria-valuemin', plain(lo));
    input.setAttribute('aria-valuemax', plain(hi));
    input.setAttribute('aria-valuenow', plain(now));
    input.setAttribute('aria-valuetext', text);
  }

  /**
   * Select bound to an enumerated state value. A value the store refuses
   * shows the reason under the select and reverts it.
   * @param {{ id: string, label: string, options: readonly { value: string, label: string }[],
   *   get: (s: ProjectState) => string, action: (value: string, s: ProjectState) => Action,
   *   extra?: (value: string, s: ProjectState) => string | null }} def
   */
  function choice(def) {
    const selectId = `c-${def.id}`;
    const msg = h('p', { class: 'field-msg', id: `${selectId}-msg`, 'data-testid': `choice-${def.id}-msg`, 'aria-live': 'polite' });
    const select = h('select', { id: selectId, 'aria-describedby': `${selectId}-msg`, 'data-testid': `choice-${def.id}` });
    for (const option of def.options) select.append(h('option', { value: option.value }, option.label));
    let shown = '';
    select.addEventListener('change', () => {
      const s = store.getState();
      const message = def.extra?.(select.value, s) ?? null;
      const errors = message ? [{ message }] : store.dispatch(def.action(select.value, s));
      msg.textContent = errors.length > 0 ? errors[0].message : '';
      select.setAttribute('aria-invalid', String(errors.length > 0));
      if (errors.length > 0) select.value = def.get(store.getState());
    });
    renderers.push((s) => {
      const value = def.get(s);
      if (value !== shown) {
        // Changed elsewhere (undo, load): the old message no longer applies.
        msg.textContent = '';
        select.setAttribute('aria-invalid', 'false');
      }
      select.value = value;
      shown = value;
    });
    return h('div', { class: 'field unit-field', 'data-field': def.id }, h('label', { for: selectId }, def.label), select, msg);
  }

  /**
   * Editable table of the measured limb: travel from brace and force at
   * the axle. A cell edit applies on Enter or blur when every row is valid.
   */
  function limbTable() {
    const msg = h('p', { class: 'field-msg', id: 'limb-table-msg', 'data-testid': 'limb-table-msg', 'aria-live': 'polite' });
    const travelHead = h('th', { scope: 'col' });
    const forceHead = h('th', { scope: 'col' });
    const body = h('tbody');
    const table = h('table', { 'aria-describedby': 'limb-table-msg' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Row'), travelHead, forceHead, h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Remove')))),
      body);
    const add = h('button', { type: 'button', class: 'limb-add', 'data-testid': 'limb-row-add' }, 'Add row');
    const wrap = h('div', { class: 'point-table limb-table', 'data-testid': 'limb-table' },
      h('p', { class: 'field-range' }, `Measured limb: ${LIMB_TABLE.minRows} to ${LIMB_TABLE.maxRows} rows with increasing travel.`),
      h('div', { class: 'table-scroll' }, table), add, msg);

    /** @type {{ travel: HTMLInputElement, force: HTMLInputElement, travelErr: HTMLSpanElement, forceErr: HTMLSpanElement, remove: HTMLButtonElement }[]} */
    const cells = [];
    /** SI rows and text the inputs were last filled from. */
    /** @type {LimbRow[]} */
    let shownRows = [];
    let shownKey = '';

    /** @returns {LimbRowText[]} */
    const texts = () => cells.map((c) => ({ travel: c.travel.value, force: c.force.value }));

    /** @param {LimbRowError[]} errors */
    function showErrors(errors) {
      cells.forEach((c, i) => {
        const t = errors.find((e) => e.row === i && e.column === 'travel');
        const f = errors.find((e) => e.row === i && e.column === 'force');
        c.travelErr.textContent = t?.message ?? '';
        c.forceErr.textContent = f?.message ?? '';
        c.travel.setAttribute('aria-invalid', String(Boolean(t)));
        c.force.setAttribute('aria-invalid', String(Boolean(f)));
      });
      // Messages of single cells show in their cells.
      msg.textContent = errors.find((e) => e.row === -1)?.message ?? '';
    }

    /**
     * Validate rows and dispatch them. Returns true when applied.
     * @param {LimbRow[]} rows
     * @param {LimbRowError[]} errors
     */
    function commitRows(rows, errors) {
      if (errors.length > 0) {
        showErrors(errors);
        return false;
      }
      const storeErrors = store.dispatch({ type: 'setLimb', limb: { table: rows } });
      if (storeErrors.length > 0) {
        showErrors([{ row: -1, column: 'table', message: storeErrors[0].message }]);
        return false;
      }
      showErrors([]);
      return true;
    }

    function commitCells() {
      const units = store.getState().units;
      const now = texts();
      const before = formatLimbRows(shownRows, units);
      if (now.length === before.length && now.every((t, i) => t.travel === before[i].travel && t.force === before[i].force)) {
        showErrors([]);
        return;
      }
      const { rows, errors } = parseLimbRows(now, units, shownRows);
      commitRows(rows, errors);
    }

    /**
     * Remove a row. Focus moves to the remove button now at that index, or
     * of the previous row, or to Add row when the table is at its fewest rows.
     * @param {number} index
     */
    function removeRow(index) {
      const units = store.getState().units;
      const { rows } = parseLimbRows(texts(), units, shownRows);
      rows.splice(index, 1);
      if (!commitRows(rows, validateLimbRows(rows, units))) return;
      if (rows.length <= LIMB_TABLE.minRows) add.focus();
      else cells[Math.min(index, rows.length - 1)]?.remove.focus();
    }

    add.addEventListener('click', () => {
      const units = store.getState().units;
      const { rows, errors } = parseLimbRows(texts(), units, shownRows);
      if (errors.some((e) => e.row >= 0)) {
        showErrors(errors);
        return;
      }
      const next = nextLimbRow(rows);
      if (!next) {
        showErrors([{ row: -1, column: 'table', message: `The limb table has ${LIMB_TABLE.maxRows} rows or its last travel is at the maximum` }]);
        return;
      }
      rows.push(next);
      commitRows(rows, validateLimbRows(rows, units));
    });

    /** @param {number} i */
    function makeRow(i) {
      /** @param {'travel' | 'force'} column */
      const cell = (column) => {
        const input = h('input', {
          type: 'text',
          inputmode: 'decimal',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-describedby': `limb-row-${i}-${column}-msg`,
          'data-testid': `limb-row-${i}-${column}`,
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitCells();
          } else if (e.key === 'Escape') {
            // Back to the applied value of this cell.
            const shown = formatLimbRows(shownRows, store.getState().units)[i];
            if (shown) input.value = shown[column];
            commitCells();
          }
        });
        input.addEventListener('blur', commitCells);
        return input;
      };
      const travel = cell('travel');
      const force = cell('force');
      const travelErr = h('span', { class: 'cell-error', id: `limb-row-${i}-travel-msg`, 'data-testid': `limb-row-${i}-travel-msg` });
      const forceErr = h('span', { class: 'cell-error', id: `limb-row-${i}-force-msg`, 'data-testid': `limb-row-${i}-force-msg` });
      const remove = h('button', { type: 'button', class: 'limb-remove', 'aria-label': `Remove row ${i + 1}`, 'data-testid': `limb-row-${i}-remove` }, '×');
      remove.addEventListener('click', () => removeRow(i));
      const tr = h('tr', {},
        h('th', { scope: 'row' }, String(i + 1)),
        h('td', {}, travel, travelErr),
        h('td', {}, force, forceErr),
        h('td', {}, remove));
      body.append(tr);
      cells.push({ travel, force, travelErr, forceErr, remove });
    }

    renderers.push((s) => {
      wrap.hidden = s.limb.mode !== 'table';
      const u = s.units;
      travelHead.textContent = `Travel from brace (${u.dims})`;
      forceHead.textContent = `Force at the axle (${u.force})`;
      const rows = s.limb.table;
      // The mode is part of the key: text left unapplied when the table was
      // hidden is replaced by the store rows when it shows again.
      const key = JSON.stringify([rows, u.dims, u.force, s.limb.mode]);
      if (key === shownKey) return;
      // Rows, units or mode changed: show the store rows.
      while (cells.length < rows.length) makeRow(cells.length);
      while (cells.length > rows.length) {
        cells.pop();
        body.lastElementChild?.remove();
      }
      const text = formatLimbRows(rows, u);
      cells.forEach((c, i) => {
        c.travel.value = text[i].travel;
        c.force.value = text[i].force;
        c.travel.setAttribute('aria-label', `Row ${i + 1} travel from brace in ${u.dims}`);
        c.force.setAttribute('aria-label', `Row ${i + 1} force at the axle in ${u.force}`);
        c.remove.disabled = rows.length <= LIMB_TABLE.minRows;
      });
      add.disabled = rows.length >= LIMB_TABLE.maxRows;
      showErrors([]);
      shownRows = rows;
      shownKey = key;
    });
    return wrap;
  }

  const customHint = h('p', { class: 'hint', 'data-testid': 'custom-hint' },
    'The curve is custom: rise and valley width apply after Reset curve. Peak and let-off rescale the points.');

  const units = h('fieldset', { class: 'group', 'data-testid': 'settings-units' }, h('legend', {}, 'Units'));
  const unitRow = h('div', { class: 'unit-row' });
  for (const def of UNIT_SELECTS) {
    const select = h('select', { id: `u-${def.id}`, 'data-testid': `unit-${def.id}` });
    for (const option of def.options) select.append(h('option', { value: option }, option));
    select.addEventListener('change', () => {
      store.dispatch({ type: 'setUnits', units: { [def.key]: select.value } });
    });
    renderers.push((s) => {
      select.value = s.units[def.key];
    });
    unitRow.append(h('div', { class: 'unit-field' }, h('label', { for: `u-${def.id}` }, def.label), select));
  }
  units.append(unitRow);

  const limbMode = choice({
    id: 'limb-mode',
    label: 'Limb input',
    options: LIMB_MODES,
    get: (s) => s.limb.mode,
    action: (value, s) => {
      const mode = /** @type {LimbState['mode']} */ (value);
      // The table mode needs rows: start from the linear limb when there are too few.
      if (mode === 'table' && s.limb.table.length < LIMB_TABLE.minRows) {
        return { type: 'setLimb', limb: { mode, table: seedLimbTable(s.limb) } };
      }
      return { type: 'setLimb', limb: { mode } };
    },
  });

  // The hint says which inputs set the limb in the selected mode, since the
  // fields of the other modes are hidden.
  const limbModeHint = h('p', { class: 'hint', id: 'limb-mode-hint', 'data-testid': 'limb-mode-hint' });
  limbMode.querySelector('select')?.setAttribute('aria-describedby', 'c-limb-mode-msg limb-mode-hint');
  renderers.push((s) => {
    limbModeHint.textContent = LIMB_MODE_HINTS[s.limb.mode] ?? '';
  });

  const trackShape = choice({
    id: 'track-shape',
    label: 'Shape',
    options: TRACK_SHAPES,
    get: (s) => s.stringTrack.shape,
    action: (value) => ({ type: 'setStringTrack', stringTrack: { shape: /** @type {StringTrack['shape']} */ (value) } }),
    extra: (value, s) => stringTrackExtra('shape', /** @type {StringTrack['shape']} */ (value), s),
  });

  /**
   * @param {string} id
   * @param {string} title
   * @param {...Node} children
   */
  const group = (id, title, ...children) =>
    h('details', { class: 'group settings-group', open: true, 'data-testid': `settings-${id}` },
      h('summary', {}, title), ...children);

  panel.append(
    h('fieldset', { class: 'group', 'data-testid': 'settings-geometry' }, h('legend', {}, 'Bow geometry'), ...GEOMETRY_FIELDS.map(field)),
    h('fieldset', { class: 'group', 'data-testid': 'settings-force' }, h('legend', {}, 'Draw force'), ...FORCE_FIELDS.map(field), customHint),
    group('limbs', 'Limbs', limbMode, limbModeHint, ...LIMB_FIELDS.map(field), limbTable()),
    group('string-track', 'String track', trackShape, ...TRACK_FIELDS.map(field)),
    group('cords', 'Cords', ...CORD_FIELDS.map(field)),
    group('cam-body', 'Cam body', ...BODY_FIELDS.map(field)),
    units,
  );

  return {
    render(s) {
      for (const r of renderers) r(s);
      customHint.hidden = s.curve.mode !== 'custom';
    },
  };
}
