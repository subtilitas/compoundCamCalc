/**
 * Project state: types, field ranges, validation, migration and JSON codec.
 * All values are in SI units (m, N, rad, N/m); units only select the display.
 * @module state/schema
 */

import { MAX_FORCE, MAX_POINTS, MIN_FORCE, drawRange } from '../core/curve.js';
import { INCH, fromSI } from '../core/units.js';
import { defaultState } from './presets.js';

/** Current schema version of saved projects. */
export const SCHEMA_VERSION = 1;

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
 * @typedef {object} StringTrack
 * @property {'eccentric' | 'ellipse'} shape
 * @property {number} radius eccentric circle radius (m)
 * @property {number} offset centre offset from the axle (m)
 * @property {number} phase (rad)
 * @property {number} semiMajor ellipse semi-major axis (m)
 * @property {number} semiMinor ellipse semi-minor axis (m)
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
 */

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
 */

/**
 * @typedef {object} ValidationError
 * @property {string} path dotted path of the field, for example "geometry.braceHeight"
 * @property {string} message plain-language message with units
 */

/**
 * @typedef {object} FieldSpec
 * @property {string} label name used at the start of messages
 * @property {'length' | 'force' | 'angle' | 'stiffness' | 'ratio'} quantity
 * @property {string} unit unit of the message; '%' for ratios
 * @property {number} min SI value (ratio for '%')
 * @property {number} max SI value (ratio for '%')
 */

const DEG = Math.PI / 180;
const MM = 1e-3;

/**
 * Ranges of the numeric fields, keyed by path.
 * @type {Readonly<Record<string, FieldSpec>>}
 */
export const FIELDS = Object.freeze({
  'geometry.ata': { label: 'Axle-to-axle length', quantity: 'length', unit: 'in', min: 26 * INCH, max: 42 * INCH },
  'geometry.braceHeight': { label: 'Brace height', quantity: 'length', unit: 'in', min: 4 * INCH, max: 10 * INCH },
  'geometry.drawLength': { label: 'Draw length', quantity: 'length', unit: 'in', min: 20 * INCH, max: 34 * INCH },
  'geometry.limbLength': { label: 'Limb lever length', quantity: 'length', unit: 'in', min: 4 * INCH, max: 20 * INCH },
  'geometry.limbAngleBrace': { label: 'Limb lever angle at brace', quantity: 'angle', unit: 'deg', min: 0, max: 90 * DEG },
  'curve.params.peak': { label: 'Peak draw force', quantity: 'force', unit: 'N', min: 50, max: 900 },
  'curve.params.letOff': { label: 'Let-off', quantity: 'ratio', unit: '%', min: 0, max: 0.95 },
  'curve.params.riseFraction': { label: 'Rise to peak', quantity: 'ratio', unit: '%', min: 0.1, max: 0.6 },
  'curve.params.valleyWidth': { label: 'Valley width', quantity: 'length', unit: 'in', min: 0.1 * INCH, max: 6 * INCH },
  'limb.stiffness': { label: 'Limb stiffness', quantity: 'stiffness', unit: 'N/mm', min: 1e3, max: 1e6 },
  'limb.preloadTravel': { label: 'Limb preload travel', quantity: 'length', unit: 'mm', min: 0, max: 200 * MM },
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
  'stringTrack.shape': { label: 'String track shape', values: ['eccentric', 'ellipse'] },
});

/** Minimum power stroke x_f − x_b required by validation: 5 in. */
export const MIN_POWER_STROKE = 5 * INCH;
/** Tolerance for the brace and full-draw point positions, in m. */
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
  return `Draw length must be more than ${plain(min)} in: brace height + 1.75 in + 5 in of power stroke`;
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
    if (!(points[i].x > points[i - 1].x)) {
      errors.push({ path: `${path}[${i}].x`, message: `Point ${i + 1} must be at a longer draw length than point ${i}` });
    }
  }
  const { xBrace, xFull } = drawRange(geometry.braceHeight, geometry.drawLength);
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
  for (const section of ['units', 'geometry', 'curve', 'limb', 'stringTrack', 'cords', 'body']) {
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
  const track = state.stringTrack;
  if (track.shape === 'eccentric' && track.offset >= track.radius) {
    errors.push({ path: 'stringTrack.offset', message: 'String track offset must be smaller than the radius' });
  }
  if (track.shape === 'ellipse' && track.offset >= track.semiMinor) {
    errors.push({ path: 'stringTrack.offset', message: 'String track offset must be smaller than the semi-minor axis' });
  }
  if (track.semiMinor > track.semiMajor) {
    errors.push({ path: 'stringTrack.semiMinor', message: 'String track semi-minor axis must not exceed the semi-major axis' });
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
 * Bring parsed project data to the current schema. Version 1 is the only
 * version so far: missing fields take default values. Newer and unknown
 * versions are rejected.
 * @param {unknown} data
 * @returns {{ state: ProjectState | null, errors: ValidationError[] }}
 */
export function migrate(data) {
  const fail = (/** @type {string} */ message) => ({ state: null, errors: [{ path: 'schemaVersion', message }] });
  if (!isObject(data)) return { state: null, errors: [{ path: '', message: 'The project data is not an object' }] };
  const version = data.schemaVersion;
  if (version === undefined) return fail('The project data has no schema version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail(`The schema version ${JSON.stringify(version)} is unknown`);
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      `The project was saved by a newer version of the app (schema version ${version}); this version reads schema version ${SCHEMA_VERSION}`,
    );
  }
  const state = fillDefaults(defaultState(), data);
  if (Array.isArray(state.curve?.points)) {
    state.curve.points = state.curve.points.map((/** @type {any} */ p) => (isObject(p) ? { x: p.x, F: p.F } : p));
  }
  return { state, errors: [] };
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
 * input returns the default preset and the reasons.
 * @param {string} text
 * @returns {{ state: ProjectState, errors: ValidationError[] }}
 */
export function fromJSON(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { state: defaultState(), errors: [{ path: '', message: 'The project data is not valid JSON' }] };
  }
  const migrated = migrate(data);
  if (!migrated.state) return { state: defaultState(), errors: migrated.errors };
  const errors = validate(migrated.state);
  if (errors.length > 0) return { state: defaultState(), errors };
  return { state: migrated.state, errors: [] };
}
