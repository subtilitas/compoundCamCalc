/**
 * STEP AP214 writer (ISO 10303-21 text, automotive_design schema) for
 * prismatic plates: each solid is a closed profile (a CIRCLE or a closed
 * cubic B-spline) extruded along +Z, with round through holes, written as
 * a MANIFOLD_SOLID_BREP without Boolean operations. Curves in a
 * GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION carry the pitch
 * lines. Input in metres, output in millimetres. Deterministic: entity ids
 * are sequential and the time stamp comes from the caller.
 *
 * Topology of one solid with n profiles (outline and holes): each profile
 * has two vertices at its start point (bottom and top), three edges
 * (bottom curve, top curve, a vertical seam line) and one side face; the
 * top and bottom planes carry the outline as FACE_OUTER_BOUND and each hole
 * as FACE_BOUND. V = 2n, E = 3n, F = n + 2, loops L = 3n, so
 * V − E + 2F − L = 2(1 − G) with G = n − 1 holes. Outlines and holes run
 * counter-clockwise seen from +Z; face orientation follows the rules in
 * docs/model.md, "STEP solids".
 * @module export/step
 */

import { describeError } from '../core/errors.js';

/** @typedef {import('../core/bspline.js').BSpline} BSpline */

/**
 * @typedef {object} StepCircle
 * @property {number} cx centre (m)
 * @property {number} cy
 * @property {number} r radius (m)
 */

/**
 * @typedef {object} StepProfile closed curve in the XY plane
 * @property {StepCircle | null} circle
 * @property {BSpline | null} spline closed, counter-clockwise
 */

/**
 * @typedef {object} StepSolid
 * @property {string} name
 * @property {StepProfile} outline
 * @property {StepCircle[]} holes
 * @property {number} z0 bottom (m)
 * @property {number} z1 top (m), above z0
 */

/**
 * @typedef {object} StepCurve wireframe curve at a height
 * @property {string} name
 * @property {StepCircle | null} circle
 * @property {BSpline | null} spline
 * @property {number} z (m)
 */

/**
 * @typedef {object} StepDocument
 * @property {string} product product name, e.g. 'Cam 187dd8'
 * @property {string} fileName
 * @property {string} description
 * @property {string} timestamp 'YYYY-MM-DDThh:mm:ss'
 * @property {string} system program name and version
 * @property {StepSolid[]} solids
 * @property {StepCurve[]} [curves]
 */

/** Model units per metre: the file is in millimetres. */
const MM = 1000;
/** Significant digits of coordinates and lengths. */
const COORD_DIGITS = 12;
/** Significant digits of knots and parameters. */
const KNOT_DIGITS = 15;
/** Largest control point shift that still removes a C1 knot (m). */
const KNOT_REMOVAL_TOLERANCE = 1e-12;

/**
 * STEP REAL token: a decimal point always, an upper-case exponent when
 * needed ('0.', '1.5', '-2.5E-7'). Throws for a non-finite number.
 * @param {number} v
 * @param {number} [digits] significant digits
 * @returns {string}
 */
export function real(v, digits = COORD_DIGITS) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`STEP: number expected, got ${String(v)}`);
  if (v === 0) return '0.';
  const [mantissa, exponent] = v.toExponential(digits - 1).split('e');
  const e = Number(exponent);
  let m = mantissa.replace(/0+$/, '');
  if (m.endsWith('.')) m = m.slice(0, -1);
  // Plain notation for moderate exponents, as most writers do.
  if (e >= -4 && e < digits) {
    const [whole, frac = ''] = m.replace('-', '').split('.');
    const digitsAll = whole + frac;
    const sign = m.startsWith('-') ? '-' : '';
    if (e >= 0) {
      const intPart = digitsAll.slice(0, e + 1).padEnd(e + 1, '0');
      const fracPart = digitsAll.slice(e + 1);
      return `${sign}${intPart}.${fracPart}`;
    }
    return `${sign}0.${'0'.repeat(-e - 1)}${digitsAll}`;
  }
  return `${m.includes('.') ? m : `${m}.`}E${e}`;
}

/**
 * STEP string token: apostrophes doubled, backslashes doubled, characters
 * outside printable ASCII as \X2\hhhh\X0\, and above U+FFFF as
 * \X4\hhhhhhhh\X0\.
 * @param {string} s
 * @returns {string}
 */
export function str(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (code > 0xffff) out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
    else out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

/**
 * Knots of a clamped cubic B-spline as distinct values with multiplicities,
 * each interior triple knot reduced to a double one where the curve is C1
 * in u there (exact knot removal: the joint point lies on the line of its
 * neighbours at the ratio of the knot intervals).
 * @param {BSpline} spline
 * @returns {{ points: number[], values: number[], mults: number[] }}
 */
export function reducedKnots(spline) {
  const { knots } = spline;
  const n = spline.points.length / 2;
  /** @type {number[]} */
  const values = [];
  /** @type {number[]} */
  const mults = [];
  for (let i = 0; i < knots.length; i++) {
    if (i > 0 && knots[i] === knots[i - 1]) mults[mults.length - 1]++;
    else {
      values.push(knots[i]);
      mults.push(1);
    }
  }
  const drop = new Set();
  let index = 0;
  for (let k = 0; k < values.length; k++) {
    const start = index;
    index += mults[k];
    if (k === 0 || k === values.length - 1 || mults[k] !== 3) continue;
    const j = start - 1;
    if (j < 1 || j + 1 >= n) continue;
    const hl = values[k] - values[k - 1];
    const hr = values[k + 1] - values[k];
    const P = spline.points;
    const ex = (hr * P[2 * j - 2] + hl * P[2 * j + 2]) / (hl + hr);
    const ey = (hr * P[2 * j - 1] + hl * P[2 * j + 3]) / (hl + hr);
    if (Math.hypot(P[2 * j] - ex, P[2 * j + 1] - ey) <= KNOT_REMOVAL_TOLERANCE) {
      drop.add(j);
      mults[k] = 2;
    }
  }
  /** @type {number[]} */
  const points = [];
  for (let i = 0; i < n; i++) if (!drop.has(i)) points.push(spline.points[2 * i], spline.points[2 * i + 1]);
  return { points, values, mults };
}

/** Part 21 DATA section with sequential entity ids. */
class Writer {
  constructor() {
    /** @type {string[]} */
    this.lines = [];
    /** @type {Map<string, string>} */
    this.shared = new Map();
  }

  /**
   * @param {string} text entity after '='
   * @returns {string} '#id'
   */
  add(text) {
    const id = `#${this.lines.length + 1}`;
    this.lines.push(`${id}=${text};`);
    return id;
  }

  /**
   * An entity written once and reused (directions, placements).
   * @param {string} text
   */
  once(text) {
    const known = this.shared.get(text);
    if (known) return known;
    const id = this.add(text);
    this.shared.set(text, id);
    return id;
  }

  /**
   * Point in millimetres.
   * @param {number} x (m)
   * @param {number} y
   * @param {number} z
   */
  point(x, y, z) {
    return this.add(`CARTESIAN_POINT('',(${real(x * MM)},${real(y * MM)},${real(z * MM)}))`);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  direction(x, y, z) {
    return this.once(`DIRECTION('',(${real(x)},${real(y)},${real(z)}))`);
  }

  /**
   * Placement at a point, axis +Z, reference direction +X.
   * @param {number} x (m)
   * @param {number} y
   * @param {number} z
   */
  placement(x, y, z) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.point(x, y, z)},${this.direction(0, 0, 1)},${this.direction(1, 0, 0)})`);
  }
}

/**
 * Curve of a closed profile at a height; returns its id and start point.
 * @param {Writer} w
 * @param {StepProfile} profile
 * @param {number} z (m)
 * @returns {{ id: string, x: number, y: number }}
 */
function profileCurve(w, profile, z) {
  if (profile.circle) {
    const { cx, cy, r } = profile.circle;
    if (!(r > 0)) throw new Error(`STEP: circle radius must be positive, got ${String(r)}`);
    return { id: w.add(`CIRCLE('',${w.placement(cx, cy, z)},${real(r * MM)})`), x: cx + r, y: cy };
  }
  const spline = profile.spline;
  if (!spline || spline.degree !== 3) throw new Error('STEP: a profile needs a circle or a cubic B-spline');
  return { id: bsplineCurve(w, spline, z, spline.closed), x: spline.points[0], y: spline.points[1] };
}

/**
 * B_SPLINE_CURVE_WITH_KNOTS at a height, with C1 triple knots reduced.
 * @param {Writer} w
 * @param {BSpline} spline
 * @param {number} z (m)
 * @param {boolean} closed
 * @param {string} [name] entity name, empty for edge curves
 */
function bsplineCurve(w, spline, z, closed, name = '') {
  const { points, values, mults } = reducedKnots(spline);
  const ids = [];
  for (let i = 0; i < points.length; i += 2) ids.push(w.point(points[i], points[i + 1], z));
  if (mults.reduce((a, b) => a + b, 0) !== ids.length + 4) throw new Error('STEP: knot multiplicities do not match the control points');
  return w.add(`B_SPLINE_CURVE_WITH_KNOTS(${str(name)},3,(${ids.join(',')}),.UNSPECIFIED.,${closed ? '.T.' : '.F.'},.F.,`
    + `(${mults.join(',')}),(${values.map((v) => real(v, KNOT_DIGITS)).join(',')}),.UNSPECIFIED.)`);
}

/**
 * @param {string} edge
 * @param {boolean} sense
 */
function oriented(edge, sense) {
  return `ORIENTED_EDGE('',*,*,${edge},${sense ? '.T.' : '.F.'})`;
}

/**
 * One prismatic solid; returns the MANIFOLD_SOLID_BREP id.
 * @param {Writer} w
 * @param {StepSolid} solid
 */
function writeSolid(w, solid) {
  const { z0, z1 } = solid;
  if (!(Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0)) throw new Error(`STEP: solid "${solid.name}" needs z1 above z0`);
  const up = w.direction(0, 0, 1);
  /**
   * @param {StepProfile} profile
   * @param {boolean} hole
   */
  const profileTopology = (profile, hole) => {
    const bottom = profileCurve(w, profile, z0);
    const top = profileCurve(w, profile, z1);
    const v0 = w.add(`VERTEX_POINT('',${w.point(bottom.x, bottom.y, z0)})`);
    const v1 = w.add(`VERTEX_POINT('',${w.point(bottom.x, bottom.y, z1)})`);
    const eb = w.add(`EDGE_CURVE('',${v0},${v0},${bottom.id},.T.)`);
    const et = w.add(`EDGE_CURVE('',${v1},${v1},${top.id},.T.)`);
    const seamLine = w.add(`LINE('',${w.point(bottom.x, bottom.y, z0)},${w.add(`VECTOR('',${up},1.)`)})`);
    const es = w.add(`EDGE_CURVE('',${v0},${v1},${seamLine},.T.)`);
    const surface = profile.circle
      ? w.add(`CYLINDRICAL_SURFACE('',${w.placement(profile.circle.cx, profile.circle.cy, z0)},${real(profile.circle.r * MM)})`)
      : w.add(`SURFACE_OF_LINEAR_EXTRUSION('',${bottom.id},${w.add(`VECTOR('',${up},${real((z1 - z0) * MM)})`)})`);
    // Outline: normal away from the material outside; hole: the surface
    // normal points into the material, so the face uses it reversed.
    const loop = hole
      ? w.add(`EDGE_LOOP('',(${[oriented(eb, false), oriented(es, true), oriented(et, true), oriented(es, false)].map((e) => w.add(e)).join(',')}))`)
      : w.add(`EDGE_LOOP('',(${[oriented(eb, true), oriented(es, true), oriented(et, false), oriented(es, false)].map((e) => w.add(e)).join(',')}))`);
    const face = w.add(`ADVANCED_FACE('',(${w.add(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${surface},${hole ? '.F.' : '.T.'})`);
    return { eb, et, face };
  };
  const outer = profileTopology(solid.outline, false);
  const holes = solid.holes.map((c) => profileTopology({ circle: c, spline: null }, true));
  /**
   * @param {string} edge
   * @param {boolean} sense
   */
  const bound = (edge, sense, outerBound = false) => w.add(`${outerBound ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${w.add(`EDGE_LOOP('',(${w.add(oriented(edge, sense))}))`)},.T.)`);
  const topPlane = w.add(`PLANE('',${w.placement(0, 0, z1)})`);
  const top = w.add(`ADVANCED_FACE('',(${[bound(outer.et, true, true), ...holes.map((h) => bound(h.et, false))].join(',')}),${topPlane},.T.)`);
  const bottomPlane = w.add(`PLANE('',${w.placement(0, 0, z0)})`);
  const bottom = w.add(`ADVANCED_FACE('',(${[bound(outer.eb, false, true), ...holes.map((h) => bound(h.eb, true))].join(',')}),${bottomPlane},.F.)`);
  const shell = w.add(`CLOSED_SHELL('',(${[bottom, top, outer.face, ...holes.map((h) => h.face)].join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(solid.name)},${shell})`);
}

/**
 * Wireframe curve: a B-spline, or a circle trimmed over its full turn
 * (a bounded curve, as the wireframe representation requires).
 * @param {Writer} w
 * @param {StepCurve} curve
 */
function writeWire(w, curve) {
  if (curve.circle) {
    const { cx, cy, r } = curve.circle;
    const circle = w.add(`CIRCLE('',${w.placement(cx, cy, curve.z)},${real(r * MM)})`);
    return w.add(`TRIMMED_CURVE(${str(curve.name)},${circle},(PARAMETER_VALUE(0.)),(PARAMETER_VALUE(${real(2 * Math.PI, KNOT_DIGITS)})),.T.,.PARAMETER.)`);
  }
  if (!curve.spline) throw new Error(`STEP: curve "${curve.name}" has no geometry`);
  return bsplineCurve(w, curve.spline, curve.z, curve.spline.closed, curve.name);
}

/**
 * Write a STEP file. Never throws: invalid input gives { text: null, error }.
 * @param {StepDocument} doc
 * @returns {{ text: string | null, error: string | null }}
 */
export function writeStep(doc) {
  try {
    return { text: writeChecked(doc), error: null };
  } catch (err) {
    // Any exception while writing malformed input.
    return { text: null, error: describeError(err) };
  }
}

/**
 * @param {StepDocument} doc
 * @returns {string}
 */
function writeChecked(doc) {
  if (!Array.isArray(doc?.solids) || doc.solids.length === 0) throw new Error('STEP: at least one solid is needed');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(doc.timestamp)) throw new Error(`STEP: time stamp must read YYYY-MM-DDThh:mm:ss, got ${String(doc.timestamp)}`);
  const w = new Writer();
  const appContext = w.add("APPLICATION_CONTEXT('automotive_design')");
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2001,${appContext})`);
  const productContext = w.add(`PRODUCT_CONTEXT('',${appContext},'mechanical')`);
  const product = w.add(`PRODUCT(${str(doc.product)},${str(doc.product)},'',(${productContext}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const formation = w.add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const defContext = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appContext},'design')`);
  const definition = w.add(`PRODUCT_DEFINITION('design','',${formation},${defContext})`);
  const shape = w.add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = w.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const rad = w.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sr = w.add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const uncertainty = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mm},'distance_accuracy_value','confusion accuracy')`);
  const context = w.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty}))`
    + `GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`);
  const origin = w.placement(0, 0, 0);
  const solids = doc.solids.map((s) => writeSolid(w, s));
  const brep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(doc.product)},(${[origin, ...solids].join(',')}),${context})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${brep})`);
  if (doc.curves && doc.curves.length > 0) {
    const wires = doc.curves.map((c) => writeWire(w, c));
    const set = w.add(`GEOMETRIC_CURVE_SET('pitch lines',(${wires.join(',')}))`);
    const wire = w.add(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('pitch lines',(${origin},${set}),${context})`);
    w.add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${brep},${wire})`);
  }
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${str(doc.description)}),'2;1');`,
    `FILE_NAME(${str(doc.fileName)},${str(doc.timestamp)},(''),(''),${str(doc.system)},${str(doc.system)},'');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ];
  return [...header, ...w.lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
