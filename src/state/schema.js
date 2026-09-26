/**
 * Project state: types, field ranges, validation, migration and JSON codec.
 * All values are in SI units (m, N, rad, N/m); units only select the display.
 * @module state/schema
 */

import { MAX_FORCE, MAX_POINTS, MIN_FORCE, MIN_GAP, drawRange, generateCurve } from '../core/curve.js';
import { CORD_MATERIALS, CUSTOM_MATERIAL } from '../core/cords.js';
import { FREEFORM_POINTS, FREEFORM_RANGE } from '../core/freeform.js';
import { INCH, fromSI } from '../core/units.js';
import { defaultState } from './presets.js';

/** Current schema version of saved projects. */
export const SCHEMA_VERSION = 1;

/**
 * Where to open data from a newer version of the app: the hosted site
 * serves the newest version as "main, newest" in the Version select.
 */
export const NEWER_HINT = 'Open it with the newest version: choose "main, newest" in the Version select, or reload the page.';

/**
 * Top-level sections that change the analysis of a designed cam but not
 * the cam. Export file names ignore them, so the files of one cam keep
 * their names when only these change.
 */
export const ANALYSIS_ONLY = Object.freeze(['tuning']);

/** @typedef {import('../core/interp.js').CurvePoint} CurvePoint */

/**
 * @typedef {object} Units
 * @property {'in' | 'mm' | 'cm'} draw draw length, brace height and ATA
 * @property {'N' | 'lbf'} force
 * @property {'mm' | 'in'} dims cam part dimensions
 * @property {'J' | 'ft·lbf'} energy
 * @property {'N/mm' | 'lbf/in'} stiffness
 */

/**
 * @typedef {object} Geometry
 * @property {number} ata axle-to-axle length (m)
 * @property {number} braceHeight grip pivot point to string at brace (m)
 * @property {number} drawLength AMO draw length (m)
 * @property {number} limbLength limb lever length, pivot to axle (m)
 * @property {number} limbAngleBrace angle of the limb lever against the x
 *   axis at brace (rad)
 */

/**
 * @typedef {object} CurveParams
 * @property {number} peak (N)
 * @property {number} letOff 0 to 0.95
 * @property {number} riseFraction rise from brace to peak as a fraction of the power stroke
 * @property {number} valleyWidth (m)
 */

/**
 * @typedef {object} CurveState
 * @property {'parametric' | 'custom'} mode
 * @property {CurveParams} params
 * @property {CurvePoint[]} points x is the nock position from the grip pivot
 *   point (AMO draw length − 1.75 in)
 */

/**
 * @typedef {object} LimbRow
 * @property {number} travel axle travel from brace (m)
 * @property {number} force force at the axle (N)
 */

/**
 * @typedef {object} LimbState
 * @property {'stiffness' | 'travel' | 'table'} mode
 * @property {number} stiffness at the axle, perpendicular to the lever (N/m)
 * @property {number} preloadTravel axle travel from unstrung to brace (m)
 * @property {number} travel axle travel from brace to full draw (m)
 * @property {number} maxRotation allowed limb rotation from brace (rad)
 * @property {LimbRow[]} table measured force-deflection rows
 */

/**
 * Free-form string track: N groove-bottom support values p_i at
 * ψ_i = 2π·i/N (N from 8 to 16), joined by a periodic cubic spline
 * (core/freeform).
 * @typedef {object} FreeformTrack
 * @property {number[]} values p_i (m)
 */

/**
 * String track. The fields of the shapes that are not selected keep their
 * values.
 * @typedef {object} StringTrack
 * @property {'eccentric' | 'ellipse' | 'freeform'} shape
 * @property {number} radius eccentric circle radius (m)
 * @property {number} offset centre offset from the axle (m)
 * @property {number} phase (rad)
 * @property {number} semiMajor ellipse semi-major axis (m)
 * @property {number} semiMinor ellipse semi-minor axis (m)
 * @property {FreeformTrack} freeform
 */

/**
 * @typedef {object} Cords
 * @property {number} stringDiameter (m)
 * @property {number} cableDiameter (m)
 * @property {number} stringGrooveDepth (m)
 * @property {number} cableGrooveDepth (m)
 */

/**
 * @typedef {object} Body
 * @property {number} boreDiameter axle bore (m)
 * @property {number} minWall minimum wall between groove bottom and bore (m)
 * @property {number} postDiameter (m)
 * @property {number} leadInWrap cable wrap before the active track at brace (rad)
 * @property {number} residualWrap string wrap left at full draw (rad)
 * @property {number} minBendRadius smallest allowed track radius of curvature (m)
 * @property {number} flangeThickness thickness of the flange plates 1, 3 and 5 (m)
 * @property {number} grooveClearance groove plates 2 and 4 are the cord
 *   diameter plus this clearance thick (m)
 */

/**
 * Cord length changes and cord stiffness of the timing analysis: they
 * change the analysis of the cam, never the cam. Positive values lengthen
 * the cord or raise the nocking point. With elastic cords each cord takes
 * its EA from a measured material and a strand count, or from the entered
 * EA for a custom material (core/cords).
 * @typedef {object} Tuning
 * @property {number} topCable top cable length change (m)
 * @property {number} bottomCable bottom cable length change (m)
 * @property {number} string string length change, whole string (m)
 * @property {number} nockHeight nocking point above the string centre, along the string (m)
 * @property {'rigid' | 'elastic'} cordModel
 * @property {CordMaterial} stringMaterial
 * @property {number} stringStrands
 * @property {number} stringEA EA of a custom string (N)
 * @property {CordMaterial} topCableMaterial
 * @property {number} topCableStrands
 * @property {number} topCableEA (N)
 * @property {CordMaterial} bottomCableMaterial
 * @property {number} bottomCableStrands
 * @property {number} bottomCableEA (N)
 */

/** @typedef {'452x' | 'fastflight-plus' | 'dacron-b50' | 'custom'} CordMaterial */

/**
 * @typedef {object} ProjectState
 * @property {number} schemaVersion
 * @property {Units} units
 * @property {Geometry} geometry
 * @property {CurveState} curve
 * @property {LimbState} limb
 * @property {StringTrack} stringTrack
 * @property {Cords} cords
 * @property {Body} body
 * @property {Tuning} tuning analysis only, see ANALYSIS_ONLY
 */

/**
 * @typedef {object} ValidationError
 * @property {string} path dotted path of the field, for example "geometry.braceHeight"
 * @property {string} message plain-language message with units
 */

/**
 * @typedef {object} FieldSpec
 * @property {string} label name used at the start of messages
 * @property {'length' | 'force' | 'angle' | 'stiffness' | 'ratio' | 'count'} quantity
 * @property {string} unit unit of the message; '%' for ratios
 * @property {number} min SI value (ratio for '%')
 * @property {number} max SI value (ratio for '%')
 * @property {boolean} [integer] whole numbers only
 */

const DEG = Math.PI / 180;
const MM = 1e-3;
/** Values of a cord material select: the measured materials, then custom. */
const CORD_MATERIAL_VALUES = Object.freeze([...CORD_MATERIALS.map((m) => m.id), CUSTOM_MATERIAL]);

/**
 * Ranges of the numeric fields, keyed by path.
 * @type {Readonly<Record<string, FieldSpec>>}
 */
export const FIELDS = Object.freeze({
  'geometry.ata': { label: 'Axle-to-axle length', quantity: 'length', unit: 'in', min: 8 * INCH, max: 48 * INCH },
  'geometry.braceHeight': { label: 'Brace height', quantity: 'length', unit: 'in', min: 1.5 * INCH, max: 10 * INCH },
  'geometry.drawLength': { label: 'Draw length', quantity: 'length', unit: 'in', min: 6 * INCH, max: 34 * INCH },
  'geometry.limbLength': { label: 'Limb lever length', quantity: 'length', unit: 'in', min: 2 * INCH, max: 20 * INCH },
  'geometry.limbAngleBrace': { label: 'Limb lever angle at brace', quantity: 'angle', unit: 'deg', min: 0, max: 90 * DEG },
  'curve.params.peak': { label: 'Peak draw force', quantity: 'force', unit: 'N', min: 5, max: 900 },
  'curve.params.letOff': { label: 'Let-off', quantity: 'ratio', unit: '%', min: 0, max: 0.95 },
  'curve.params.riseFraction': { label: 'Rise to peak', quantity: 'ratio', unit: '%', min: 0.1, max: 0.6 },
  'curve.params.valleyWidth': { label: 'Valley width', quantity: 'length', unit: 'in', min: 0.1 * INCH, max: 6 * INCH },
  'limb.stiffness': { label: 'Limb stiffness', quantity: 'stiffness', unit: 'N/mm', min: 100, max: 1e6 },
  'limb.preloadTravel': { label: 'Limb preload travel', quantity: 'length', unit: 'mm', min: 0, max: 400 * MM },
  'limb.travel': { label: 'Limb travel', quantity: 'length', unit: 'mm', min: 1 * MM, max: 200 * MM },
  'limb.maxRotation': { label: 'Maximum limb rotation', quantity: 'angle', unit: 'deg', min: 1 * DEG, max: 60 * DEG },
  'stringTrack.radius': { label: 'String track radius', quantity: 'length', unit: 'mm', min: 5 * MM, max: 100 * MM },
  'stringTrack.offset': { label: 'String track offset', quantity: 'length', unit: 'mm', min: 0, max: 50 * MM },
  'stringTrack.phase': { label: 'String track phase', quantity: 'angle', unit: 'deg', min: -360 * DEG, max: 360 * DEG },
  'stringTrack.semiMajor': { label: 'String track semi-major axis', quantity: 'length', unit: 'mm', min: 5 * MM, max: 100 * MM },
  'stringTrack.semiMinor': { label: 'String track semi-minor axis', quantity: 'length', unit: 'mm', min: 5 * MM, max: 100 * MM },
  'cords.stringDiameter': { label: 'String diameter', quantity: 'length', unit: 'mm', min: 0.5 * MM, max: 6 * MM },
  'cords.cableDiameter': { label: 'Cable diameter', quantity: 'length', unit: 'mm', min: 0.5 * MM, max: 6 * MM },
  'cords.stringGrooveDepth': { label: 'String groove depth', quantity: 'length', unit: 'mm', min: 0, max: 10 * MM },
  'cords.cableGrooveDepth': { label: 'Cable groove depth', quantity: 'length', unit: 'mm', min: 0, max: 10 * MM },
  'body.boreDiameter': { label: 'Axle bore diameter', quantity: 'length', unit: 'mm', min: 2 * MM, max: 30 * MM },
  'body.minWall': { label: 'Minimum wall', quantity: 'length', unit: 'mm', min: 0.5 * MM, max: 20 * MM },
  'body.postDiameter': { label: 'Post diameter', quantity: 'length', unit: 'mm', min: 1 * MM, max: 20 * MM },
  'body.leadInWrap': { label: 'Lead-in wrap', quantity: 'angle', unit: 'deg', min: 0, max: 180 * DEG },
  'body.residualWrap': { label: 'Residual wrap', quantity: 'angle', unit: 'deg', min: 0, max: 180 * DEG },
  'body.minBendRadius': { label: 'Minimum bend radius', quantity: 'length', unit: 'mm', min: 0.5 * MM, max: 50 * MM },
  'body.flangeThickness': { label: 'Flange plate thickness', quantity: 'length', unit: 'mm', min: 0.5 * MM, max: 20 * MM },
  'body.grooveClearance': { label: 'Groove clearance', quantity: 'length', unit: 'mm', min: 0, max: 5 * MM },
  'tuning.topCable': { label: 'Top cable length change', quantity: 'length', unit: 'mm', min: -20 * MM, max: 20 * MM },
  'tuning.bottomCable': { label: 'Bottom cable length change', quantity: 'length', unit: 'mm', min: -20 * MM, max: 20 * MM },
  'tuning.string': { label: 'String length change', quantity: 'length', unit: 'mm', min: -50 * MM, max: 50 * MM },
  'tuning.nockHeight': { label: 'Nocking point above centre', quantity: 'length', unit: 'mm', min: -50 * MM, max: 50 * MM },
  'tuning.stringStrands': { label: 'String strands', quantity: 'count', unit: 'strands', min: 5, max: 200, integer: true },
  'tuning.topCableStrands': { label: 'Top cable strands', quantity: 'count', unit: 'strands', min: 5, max: 200, integer: true },
  'tuning.bottomCableStrands': { label: 'Bottom cable strands', quantity: 'count', unit: 'strands', min: 5, max: 200, integer: true },
  'tuning.stringEA': { label: 'String stiffness EA', quantity: 'force', unit: 'N', min: 1e4, max: 1e8 },
  'tuning.topCableEA': { label: 'Top cable stiffness EA', quantity: 'force', unit: 'N', min: 1e4, max: 1e8 },
  'tuning.bottomCableEA': { label: 'Bottom cable stiffness EA', quantity: 'force', unit: 'N', min: 1e4, max: 1e8 },
});

/**
 * Allowed values of the enumerated fields, keyed by path.
 * @type {Readonly<Record<string, { label: string, values: readonly string[] }>>}
 */
export const ENUMS = Object.freeze({
  'units.draw': { label: 'Draw length unit', values: ['in', 'mm', 'cm'] },
  'units.force': { label: 'Force unit', values: ['N', 'lbf'] },
  'units.dims': { label: 'Dimension unit', values: ['mm', 'in'] },
  'units.energy': { label: 'Energy unit', values: ['J', 'ft·lbf'] },
  'units.stiffness': { label: 'Stiffness unit', values: ['N/mm', 'lbf/in'] },
  'curve.mode': { label: 'Curve mode', values: ['parametric', 'custom'] },
  'limb.mode': { label: 'Limb input mode', values: ['stiffness', 'travel', 'table'] },
  'stringTrack.shape': { label: 'String track shape', values: ['eccentric', 'ellipse', 'freeform'] },
  'tuning.cordModel': { label: 'Cord model', values: ['rigid', 'elastic'] },
  'tuning.stringMaterial': { label: 'String material', values: CORD_MATERIAL_VALUES },
  'tuning.topCableMaterial': { label: 'Top cable material', values: CORD_MATERIAL_VALUES },
  'tuning.bottomCableMaterial': { label: 'Bottom cable material', values: CORD_MATERIAL_VALUES },
});

/**
 * Range of every free-form track value (FREEFORM_RANGE of core/freeform).
 * Not in FIELDS, which holds single numbers: validate checks the values
 * with {@link freeformErrors}.
 * @type {Readonly<FieldSpec>}
 */
export const FREEFORM_VALUE = Object.freeze({
  label: 'Free-form track value', quantity: 'length', unit: 'mm', min: FREEFORM_RANGE.min, max: FREEFORM_RANGE.max,
});

export { FREEFORM_POINTS };

/** Minimum power stroke x_f − x_b required by validation: 2 in. */
export const MIN_POWER_STROKE = 2 * INCH;
/** Tolerance for the brace and full-draw point positions and the minimum gap, in m. */
const POSITION_TOLERANCE = 1e-9;

/**
 * Display a number without trailing zeros, at most 6 significant digits.
 * @param {number} v
 */
function plain(v) {
  return String(Number(v.toPrecision(6)));
}

/**
 * SI value of a field in the unit of its message.
 * @param {FieldSpec} spec
 * @param {number} value
 */
export function specValue(spec, value) {
  if (spec.quantity === 'ratio') return value * 100;
  if (spec.quantity === 'count') return value;
  return fromSI(value, spec.quantity, spec.unit);
}

/**
 * Message for a value outside its range.
 * @param {FieldSpec} spec
 */
export function rangeMessage(spec) {
  return `${spec.label} must be between ${plain(specValue(spec, spec.min))} and ${plain(specValue(spec, spec.max))} ${spec.unit}`;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} root
 * @param {string} path
 */
function get(root, path) {
  /** @type {any} */
  let v = root;
  for (const key of path.split('.')) {
    if (!isObject(v)) return undefined;
    v = v[key];
  }
  return v;
}

/**
 * Check one numeric field against its range.
 * @param {string} path
 * @param {unknown} value
 * @returns {ValidationError | null}
 */
export function validateField(path, value) {
  const spec = FIELDS[path];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { path, message: `${spec.label} must be a number` };
  }
  if (value < spec.min || value > spec.max) return { path, message: rangeMessage(spec) };
  if (spec.integer && !Number.isInteger(value)) return { path, message: `${spec.label} must be a whole number` };
  return null;
}

/**
 * Message when the draw length is too short for the brace height, or null.
 * @param {number} braceHeight (m)
 * @param {number} drawLength (m)
 * @returns {string | null}
 */
export function drawLengthMessage(braceHeight, drawLength) {
  const { xBrace, xFull } = drawRange(braceHeight, drawLength);
  if (xFull - xBrace > MIN_POWER_STROKE) return null;
  const min = braceHeight / INCH + 1.75 + MIN_POWER_STROKE / INCH;
  return `Draw length must be more than ${plain(min)} in: brace height + 1.75 in + ${plain(MIN_POWER_STROKE / INCH)} in of power stroke`;
}

/**
 * Validate the curve points against the geometry.
 * @param {unknown} points
 * @param {Geometry} geometry
 * @returns {ValidationError[]}
 */
export function validatePoints(points, geometry) {
  /** @type {ValidationError[]} */
  const errors = [];
  const path = 'curve.points';
  if (!Array.isArray(points)) return [{ path, message: 'The force curve points are missing' }];
  if (points.length < 3) return [{ path, message: 'The force curve needs at least 3 points' }];
  if (points.length > MAX_POINTS) return [{ path, message: `The force curve can have at most ${MAX_POINTS} points` }];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!isObject(p) || !Number.isFinite(p.x) || !Number.isFinite(p.F)) {
      return [{ path: `${path}[${i}]`, message: `Point ${i + 1} must have a numeric draw length and force` }];
    }
  }
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].x - points[i - 1].x;
    if (!(gap > 0)) {
      errors.push({ path: `${path}[${i}].x`, message: `Point ${i + 1} must be at a longer draw length than point ${i}` });
    } else if (gap < MIN_GAP - POSITION_TOLERANCE) {
      errors.push({ path: `${path}[${i}].x`, message: `Point ${i + 1} must be at least ${plain(MIN_GAP / INCH)} in from point ${i}` });
    }
  }
  const { xBrace, xFull } = isNumber(geometry.braceHeight) && isNumber(geometry.drawLength)
    ? drawRange(geometry.braceHeight, geometry.drawLength)
    : { xBrace: NaN, xFull: NaN };
  if (Number.isFinite(xBrace) && Math.abs(points[0].x - xBrace) > POSITION_TOLERANCE) {
    errors.push({ path: `${path}[0].x`, message: 'Point 1 must be at brace height' });
  }
  if (points[0].F !== 0) errors.push({ path: `${path}[0].F`, message: 'Point 1 must have a force of 0 N' });
  const last = points.length - 1;
  if (Number.isFinite(xFull) && Math.abs(points[last].x - xFull) > POSITION_TOLERANCE) {
    errors.push({ path: `${path}[${last}].x`, message: `Point ${last + 1} must be at full draw` });
  }
  for (let i = 1; i < points.length; i++) {
    const F = points[i].F;
    if (F < MIN_FORCE || F > MAX_FORCE) {
      errors.push({ path: `${path}[${i}].F`, message: `Point ${i + 1}: force must be between ${MIN_FORCE} and ${MAX_FORCE} N` });
    }
  }
  return errors;
}

/**
 * Structure of free-form track values: an array of FREEFORM_POINTS.min to
 * FREEFORM_POINTS.max finite numbers inside the range of FREEFORM_VALUE.
 * Convexity and bore clearance are solver diagnostics (string-radius,
 * string-clearance), not validation errors: their limits depend on other
 * fields, and a later edit of those must not make a saved design invalid.
 * @param {unknown} values
 * @returns {ValidationError[]}
 */
export function freeformErrors(values) {
  const path = 'stringTrack.freeform.values';
  const { min, max } = FREEFORM_POINTS;
  if (!Array.isArray(values)) return [{ path, message: 'The free-form track values are missing' }];
  if (values.length < min || values.length > max) {
    return [{ path, message: `A free-form track needs ${min} to ${max} values` }];
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNumber(v)) return [{ path: `${path}[${i}]`, message: `Free-form track value ${i + 1} must be a number` }];
    if (v < FREEFORM_VALUE.min || v > FREEFORM_VALUE.max) {
      return [{ path: `${path}[${i}]`, message: rangeMessage({ ...FREEFORM_VALUE, label: `Free-form track value ${i + 1}` }) }];
    }
  }
  return [];
}

/**
 * Validate a project state. Checks structure, enumerations, numeric ranges,
 * the draw length against the brace height and the curve points.
 * @param {unknown} state
 * @returns {ValidationError[]} empty when valid
 */
export function validate(state) {
  if (!isObject(state)) return [{ path: '', message: 'The project data is not an object' }];
  /** @type {ValidationError[]} */
  const errors = [];
  if (state.schemaVersion !== SCHEMA_VERSION) {
    errors.push({ path: 'schemaVersion', message: `The schema version must be ${SCHEMA_VERSION}` });
  }
  for (const section of ['units', 'geometry', 'curve', 'limb', 'stringTrack', 'cords', 'body', 'tuning']) {
    if (!isObject(state[section])) errors.push({ path: section, message: `The project has no ${section} section` });
  }
  if (errors.length > 0) return errors;
  if (!isObject(state.curve.params)) return [{ path: 'curve.params', message: 'The project has no curve parameters' }];

  for (const [path, spec] of Object.entries(ENUMS)) {
    const value = get(state, path);
    if (!spec.values.includes(value)) {
      errors.push({ path, message: `${spec.label} must be one of ${spec.values.join(', ')}` });
    }
  }
  for (const path of Object.keys(FIELDS)) {
    const error = validateField(path, get(state, path));
    if (error) errors.push(error);
  }
  const g = state.geometry;
  if (Number.isFinite(g.braceHeight) && Number.isFinite(g.drawLength)) {
    const message = drawLengthMessage(g.braceHeight, g.drawLength);
    if (message) errors.push({ path: 'geometry.drawLength', message });
  }
  // Cross-field checks compare numbers only: validateField reports the
  // others, and comparing an object can call its (possibly invalid) toString.
  const track = state.stringTrack;
  const { offset, radius, semiMinor, semiMajor } = track;
  if (track.shape === 'eccentric' && isNumber(offset) && isNumber(radius) && offset >= radius) {
    errors.push({ path: 'stringTrack.offset', message: 'String track offset must be smaller than the radius' });
  }
  if (track.shape === 'ellipse' && isNumber(offset) && isNumber(semiMinor) && offset >= semiMinor) {
    errors.push({ path: 'stringTrack.offset', message: 'String track offset must be smaller than the semi-minor axis' });
  }
  if (isNumber(semiMinor) && isNumber(semiMajor) && semiMinor > semiMajor) {
    errors.push({ path: 'stringTrack.semiMinor', message: 'String track semi-minor axis must not exceed the semi-major axis' });
  }
  if (!isObject(track.freeform)) {
    errors.push({ path: 'stringTrack.freeform', message: 'The string track has no free-form values' });
  } else {
    errors.push(...freeformErrors(track.freeform.values));
  }
  const table = state.limb.table;
  if (!Array.isArray(table) || !table.every((r) => isObject(r) && Number.isFinite(r.travel) && Number.isFinite(r.force))) {
    errors.push({ path: 'limb.table', message: 'Every limb table row must have a numeric travel and force' });
  } else if (state.limb.mode === 'table' && table.length < 3) {
    errors.push({ path: 'limb.table', message: 'The limb table needs at least 3 rows' });
  }
  errors.push(...validatePoints(state.curve.points, g));
  return errors;
}

/**
 * Fill fields missing from saved data with default values. Values present
 * in the data are kept as they are, so validation sees them; keys unknown to
 * the schema are dropped.
 * @param {any} defaults
 * @param {any} data
 * @returns {any}
 */
function fillDefaults(defaults, data) {
  if (!isObject(defaults)) return data === undefined ? defaults : data;
  if (!isObject(data)) return data === undefined ? defaults : data;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(defaults)) out[key] = fillDefaults(defaults[key], data[key]);
  return out;
}

/**
 * Key paths of the data that the schema does not know, in document order,
 * for example 'tuning' or 'limb.boltTurns'. Keys inside arrays are not
 * visited: array items take their shape from the defaults.
 * @param {any} defaults
 * @param {any} data
 * @param {string} [prefix]
 * @returns {string[]}
 */
function unknownKeys(defaults, data, prefix = '') {
  if (!isObject(defaults) || !isObject(data)) return [];
  /** @type {string[]} */
  const out = [];
  for (const key of Object.keys(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(defaults, key)) out.push(path);
    else out.push(...unknownKeys(defaults[key], data[key], path));
  }
  return out;
}

/**
 * Bring parsed project data to the current schema. Version 1 is the only
 * version so far: missing fields take default values, keys the schema does
 * not know are dropped and listed in `dropped`. Newer and unknown versions
 * are rejected.
 * @param {unknown} data
 * @returns {{ state: ProjectState | null, errors: ValidationError[], dropped: string[] }}
 */
export function migrate(data) {
  const fail = (/** @type {string} */ message) => ({ state: null, errors: [{ path: 'schemaVersion', message }], dropped: [] });
  if (!isObject(data)) return { state: null, errors: [{ path: '', message: 'The project data is not an object' }], dropped: [] };
  const version = data.schemaVersion;
  if (version === undefined) return fail('The project data has no schema version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail(`The schema version ${JSON.stringify(version)} is unknown`);
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      `The project was saved by a newer version of the app (schema version ${version}); this version reads schema version ${SCHEMA_VERSION}. ${NEWER_HINT}`,
    );
  }
  const defaults = defaultState();
  const dropped = unknownKeys(defaults, data);
  const state = fillDefaults(defaults, data);
  // Default points belong to the default geometry and parameters: without
  // points of its own, the curve follows the data's geometry and parameters.
  if (!(isObject(data.curve) && 'points' in data.curve) && isObject(state.geometry) && isObject(state.curve)) {
    try {
      const { xBrace, xFull } = drawRange(state.geometry.braceHeight, state.geometry.drawLength);
      state.curve.points = generateCurve({ xBrace, xFull, ...state.curve.params });
    } catch {
      // Invalid geometry or parameters: validation reports them.
    }
  }
  if (Array.isArray(state.curve?.points)) {
    state.curve.points = state.curve.points.map((/** @type {any} */ p) => (isObject(p) ? { x: p.x, F: p.F } : p));
  }
  if (Array.isArray(state.stringTrack?.freeform?.values)) {
    state.stringTrack.freeform.values = [...state.stringTrack.freeform.values];
  }
  if (Array.isArray(state.limb?.table)) {
    state.limb.table = state.limb.table.map((/** @type {any} */ r) => (isObject(r) ? { travel: r.travel, force: r.force } : r));
  }
  return { state, errors: [], dropped };
}

/**
 * Sentence that names the settings a file or link held that this version
 * does not know, or '' when there are none. At most five paths are named.
 * @param {readonly string[]} dropped key paths from migrate
 */
export function droppedText(dropped) {
  if (dropped.length === 0) return '';
  const shown = dropped.slice(0, 5).join(', ');
  const more = dropped.length > 5 ? ` and ${dropped.length - 5} more` : '';
  return `Settings this version does not know were left out: ${shown}${more}.`;
}

/**
 * Serialise a project state.
 * @param {ProjectState} state
 * @returns {string}
 */
export function toJSON(state) {
  return JSON.stringify(state);
}

/**
 * Parse, migrate and validate saved project text. Never throws: invalid
 * input returns the default preset and the reasons. `dropped` lists the
 * key paths the schema does not know (see migrate).
 * @param {string} text
 * @returns {{ state: ProjectState, errors: ValidationError[], dropped: string[] }}
 */
export function fromJSON(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { state: defaultState(), errors: [{ path: '', message: 'The project data is not valid JSON' }], dropped: [] };
  }
  const migrated = migrate(data);
  if (!migrated.state) return { state: defaultState(), errors: migrated.errors, dropped: [] };
  const errors = validate(migrated.state);
  if (errors.length > 0) return { state: defaultState(), errors, dropped: [] };
  return { state: migrated.state, errors: [], dropped: migrated.dropped };
}
