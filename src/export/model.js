/**
 * Export model of a solved cam: the curves of both tracks, the cut contours
 * and holes of the five cam plates, the timing marks and the warnings, in
 * the cam frame at brace (m). The writers convert to millimetres.
 *
 * Plates, from the string side (+Z towards the viewer) to the cable side:
 *   1 string flange, 2 string groove, 3 middle flange, 4 cable groove,
 *   5 cable flange.
 * The middle flange is the convex hull of both flanges: its support is
 * h = max(p_string flange, p_cable flange), and where the two cross the
 * outline runs along their common tangent.
 *
 * A cut contour lies on the track offset outwards by the export tolerance
 * tol, sampled at a constant angle step Δψ with
 * 1 − cos(Δψ/2) = 2·tol/(ρ_max + tol); every chord then stays within
 * [−tol, +tol] of the track. Eccentric-circle tracks are cut as circles.
 *
 * Post holes go only into the flange plates next to the groove of their
 * cord: the string post into plates 1 and 3, the cable post and the cable
 * stop into plates 3 and 5. A hole that does not fit inside a plate is
 * left out with a warning.
 * @module export/model
 */

import { EXPORT_TOLERANCE, fitSupport, supportCircle } from '../core/bspline.js';
import { describeError } from '../core/errors.js';
import { createSupport } from '../core/support.js';

/** @typedef {import('../core/solve.js').SolveResult} SolveResult */
/** @typedef {import('../core/support.js').SupportData} SupportData */
/** @typedef {import('../core/support.js').Support} Support */
/** @typedef {Pick<Support, 'p' | 'rho' | 'point'>} HullSupport a track or a disc */
/** @typedef {import('../core/bspline.js').BSpline} BSpline */
/** @typedef {import('../state/schema.js').ProjectState} ProjectState */

/** One turn (rad). */
const TURN = 2 * Math.PI;
/** Angle step of the grid that finds ρ_max and the flange crossings (rad). */
const GRID = (0.25 * Math.PI) / 180;
/** Margin on ρ_max between grid points. */
const RHO_MARGIN = 1.1;
/** Largest angle step of a cut contour (rad). */
const STEP_MAX = (2 * Math.PI) / 90;
/** Clearance below which a hole counts as touching the outline (m). */
const CONTACT = 1e-9;

/**
 * @typedef {object} Circle
 * @property {number} cx centre (m)
 * @property {number} cy
 * @property {number} r radius (m)
 */

/**
 * A curve of the export: a circle for an eccentric-circle track, else a
 * B-spline.
 * @typedef {object} ExportCurve
 * @property {string} id
 * @property {'pitch' | 'groove' | 'flange'} kind
 * @property {BSpline | null} spline
 * @property {Circle | null} circle
 */

/**
 * @typedef {object} Plate
 * @property {number} number 1 to 5, from the string side
 * @property {string} id file name part, e.g. 'plate1-string-flange'
 * @property {string} name e.g. '1 Flange, string side'
 * @property {number[] | null} contour closed polygon, x and y interleaved (m)
 * @property {Circle | null} outlineCircle outline of a circular plate
 * @property {Circle[]} holes bore first, then posts
 * @property {string[]} holeIds 'bore' or the post id, per hole
 * @property {Circle[]} bosses discs added to the outline around a post
 */

/**
 * @typedef {object} ExportMark
 * @property {string} id
 * @property {number} x (m)
 * @property {number} y
 * @property {number} nx outward normal
 * @property {number} ny
 */

/**
 * @typedef {object} ExportModel
 * @property {ExportCurve[]} curves pitch, groove and flange of both tracks
 * @property {Plate[]} plates
 * @property {ExportMark[]} marks
 * @property {number} tolerance (m)
 * @property {string[]} warnings
 */

/** Names of the post holes in warnings. */
const POST_NAMES = Object.freeze({ 'string-post': 'string post', 'cable-post': 'cable post', 'cable-stop': 'cable stop' });

/** Plates that take each post. */
const POST_PLATES = Object.freeze({ 'string-post': [1, 3], 'cable-post': [3, 5], 'cable-stop': [3, 5] });

/**
 * Posts that get a boss on a flange plate that cannot hold them. The cable
 * stop peg clears the groove bottom by its radius, so it reaches past the
 * cable flange whenever the groove depth is less than the peg diameter.
 */
const BOSS_POSTS = Object.freeze(['cable-stop']);

/**
 * Support of a disc, in the form the hull functions use.
 * @param {Circle} c
 * @returns {Pick<Support, 'p' | 'rho' | 'point'>}
 */
export function discSupport(c) {
  return {
    p: (psi) => c.cx * Math.cos(psi) + c.cy * Math.sin(psi) + c.r,
    rho: () => c.r,
    point: (psi) => ({ x: c.cx + c.r * Math.cos(psi), y: c.cy + c.r * Math.sin(psi) }),
  };
}

/**
 * Export model of a solved cam. Never throws.
 * @param {SolveResult} result a full solve with status ok
 * @param {ProjectState} state the state the result was solved for
 * @param {{ tolerance?: number }} [options]
 * @returns {{ model: ExportModel | null, error: string | null }}
 */
export function buildExportModel(result, state, options = {}) {
  try {
    return buildChecked(result, state, options);
  } catch (err) {
    // Any exception while reading malformed input.
    return { model: null, error: describeError(err) };
  }
}

/**
 * Track data of the result; throws when one is missing.
 * @param {SupportData | null | undefined} data
 * @param {string} name
 * @returns {SupportData}
 */
function required(data, name) {
  if (!data) throw new Error(`The result has no ${name}`);
  return data;
}

/**
 * Body of {@link buildExportModel}, which guards it.
 * @param {SolveResult} result
 * @param {ProjectState} state
 * @param {{ tolerance?: number }} options
 * @returns {{ model: ExportModel | null, error: string | null }}
 */
function buildChecked(result, state, options) {
  if (result?.status !== 'ok' || result.resolution !== 'full') {
    return { model: null, error: 'Only a full solve that meets every check can be exported' };
  }
  const tol = options?.tolerance ?? EXPORT_TOLERANCE;
  if (!(Number.isFinite(tol) && tol > 0)) return { model: null, error: 'The export tolerance must be a positive number' };
  const bore = state?.body?.boreDiameter / 2;
  if (!(Number.isFinite(bore) && bore > 0)) return { model: null, error: 'The axle bore diameter must be a positive number' };
  const t = result.tracks;
  const cableStart = t.cable ? t.cable.psiStart : NaN;
  if (!Number.isFinite(cableStart)) return { model: null, error: 'The result has no cable track start' };
  const data = {
    stringPitch: required(t.stringPitch, 'string pitch line'),
    stringGroove: required(t.grooves.string, 'string groove'),
    stringFlange: required(t.flanges.string, 'string flange'),
    cablePitch: required(t.cablePitch, 'cable pitch line'),
    cableGroove: required(t.grooves.cable, 'cable groove'),
    cableFlange: required(t.flanges.cable, 'cable flange'),
  };
  /** @type {string[]} */
  const warnings = [];

  /** @type {ExportCurve[]} */
  const curves = [];
  for (const [id, kind, d, start] of /** @type {const} */ ([
    ['string-pitch', 'pitch', data.stringPitch, 0],
    ['string-groove', 'groove', data.stringGroove, 0],
    ['string-flange', 'flange', data.stringFlange, 0],
    ['cable-pitch', 'pitch', data.cablePitch, cableStart],
    ['cable-groove', 'groove', data.cableGroove, cableStart],
    ['cable-flange', 'flange', data.cableFlange, cableStart],
  ])) {
    const circle = supportCircle(d);
    if (circle) {
      curves.push({ id, kind, spline: null, circle });
      continue;
    }
    const fit = fitSupport(d, start, start + TURN, tol);
    if (!fit.spline) return { model: null, error: `The ${id.replace('-', ' ')} could not be fitted: ${fit.error}` };
    curves.push({ id, kind, spline: fit.spline, circle: null });
  }

  const sf = createSupport(data.stringFlange);
  const sg = createSupport(data.stringGroove);
  const cf = createSupport(data.cableFlange);
  const cg = createSupport(data.cableGroove);
  /** @type {[number, string, string, Support[], SupportData | null][]} */
  const plateDefs = [
    [1, 'plate1-string-flange', '1 Flange, string side', [sf], data.stringFlange],
    [2, 'plate2-string-groove', '2 String groove', [sg], data.stringGroove],
    [3, 'plate3-middle-flange', '3 Middle flange', [sf, cf], null],
    [4, 'plate4-cable-groove', '4 Cable groove', [cg], data.cableGroove],
    [5, 'plate5-cable-flange', '5 Flange, cable side', [cf], data.cableFlange],
  ];
  const wall = state.body.minWall;
  /** @type {Plate[]} */
  const plates = [];
  /** @type {{ plate: string, id: keyof typeof POST_NAMES }[]} */
  const missed = [];
  for (const [number, id, name, flanges, single] of plateDefs) {
    /** @type {HullSupport[]} */
    const supports = [...flanges];
    /** @type {Circle[]} */
    const bosses = [];
    const posts = result.posts.filter((post) => POST_PLATES[post.id]?.includes(number)
      && [post.x, post.y, post.radius].every(Number.isFinite) && post.radius > 0);
    for (const post of posts) {
      if (!BOSS_POSTS.includes(post.id) || fits(supports, post.x, post.y, post.radius)) continue;
      if (!(Number.isFinite(wall) && wall > 0)) continue;
      const boss = { cx: post.x, cy: post.y, r: post.radius + wall };
      bosses.push(boss);
      supports.push(discSupport(boss));
    }
    const circle = single && bosses.length === 0 ? supportCircle(single) : null;
    const contour = circle ? null : hullContour(supports, tol);
    /** @type {Circle[]} */
    const holes = [{ cx: 0, cy: 0, r: bore }];
    /** @type {string[]} */
    const holeIds = ['bore'];
    const label = `Plate ${number} (${name.slice(2).toLowerCase()})`;
    if (circle ? circleClearance(circle, 0, 0, bore) < -CONTACT : !fits(supports, 0, 0, bore)) {
      warnings.push(`${label}: the axle bore does not fit inside the outline`);
    }
    for (const post of posts) {
      const inside = circle ? circleClearance(circle, post.x, post.y, post.radius) >= -CONTACT : fits(supports, post.x, post.y, post.radius);
      if (!inside) {
        missed.push({ plate: label, id: post.id });
        continue;
      }
      holes.push({ cx: post.x, cy: post.y, r: post.radius });
      holeIds.push(post.id);
    }
    plates.push({ number, id, name, contour, outlineCircle: circle, holes, holeIds, bosses });
  }
  for (const { plate, id } of missed) {
    const holders = plates.filter((p) => p.holeIds.includes(id)).map((p) => p.number);
    const still = holders.length === 0 ? ''
      : `; plate${holders.length > 1 ? 's' : ''} ${holders.join(' and ')} still hold${holders.length > 1 ? '' : 's'} it`;
    warnings.push(`${plate}: the ${POST_NAMES[id]} reaches past the outline, so this plate has no hole for it${still}`);
  }
  for (const id of /** @type {const} */ (['string-post', 'cable-post', 'cable-stop'])) {
    if (!result.posts.some((p) => p.id === id)) continue;
    const held = plates.filter((p) => p.holeIds.includes(id)).length;
    if (held === 0) warnings.push(`No plate holds the ${POST_NAMES[id]}: fix it to the cam another way`);
  }
  /** @type {ExportMark[]} */
  const marks = result.marks
    .filter((m) => [m.x, m.y, m.nx, m.ny].every(Number.isFinite))
    .map((m) => ({ id: m.id, x: m.x, y: m.y, nx: m.nx, ny: m.ny }));
  return { model: { curves, plates, marks, tolerance: tol, warnings }, error: null };
}

/**
 * Clearance of a disc inside a circle (m); negative when it sticks out.
 * @param {Circle} c
 * @param {number} x
 * @param {number} y
 * @param {number} r
 */
function circleClearance(c, x, y, r) {
  return c.r - Math.hypot(x - c.cx, y - c.cy) - r;
}

/**
 * Whether the disc (x, y, r) lies inside the convex hull of the tracks:
 * x·n(ψ) + r ≤ max over the tracks of p(ψ) at every grid angle.
 * @param {HullSupport[]} supports
 * @param {number} x
 * @param {number} y
 * @param {number} r
 */
function fits(supports, x, y, r) {
  const n = Math.ceil(TURN / GRID);
  for (let i = 0; i < n; i++) {
    const psi = (i * TURN) / n;
    const h = hull(supports, psi);
    if (x * Math.cos(psi) + y * Math.sin(psi) + r > h + CONTACT) return false;
  }
  return true;
}

/**
 * Support of the convex hull of the tracks at ψ.
 * @param {HullSupport[]} supports
 * @param {number} psi
 */
function hull(supports, psi) {
  let best = -Infinity;
  for (const s of supports) best = Math.max(best, s.p(psi));
  return best;
}

/**
 * Index of the track that gives the hull at ψ.
 * @param {HullSupport[]} supports
 * @param {number} psi
 */
function hullIndex(supports, psi) {
  let k = 0;
  for (let i = 1; i < supports.length; i++) if (supports[i].p(psi) > supports[k].p(psi)) k = i;
  return k;
}

/**
 * Cut contour of the convex hull of the tracks: vertices on the tracks
 * offset outwards by tol, at a constant angle step, plus both ends of every
 * common tangent where the hull passes from one track to the other.
 * @param {HullSupport[]} supports
 * @param {number} tol (m)
 * @returns {number[]} closed polygon, x and y interleaved (m)
 */
export function hullContour(supports, tol) {
  const grid = Math.ceil(TURN / GRID);
  let rhoMax = 0;
  for (const s of supports) {
    for (let i = 0; i < grid; i++) rhoMax = Math.max(rhoMax, s.rho((i * TURN) / grid));
  }
  rhoMax *= RHO_MARGIN;
  const step = Math.min(STEP_MAX, 2 * Math.acos(1 - (2 * tol) / (rhoMax + tol)));
  const n = Math.ceil(TURN / step);
  /** @type {number[]} */
  const out = [];
  /**
   * @param {HullSupport} s
   * @param {number} psi
   */
  const vertex = (s, psi) => {
    const x = s.point(psi);
    out.push(x.x + tol * Math.cos(psi), x.y + tol * Math.sin(psi));
  };
  let prev = hullIndex(supports, 0);
  for (let i = 0; i < n; i++) {
    const psi = (i * TURN) / n;
    const k = hullIndex(supports, psi);
    if (k !== prev && i > 0) {
      // The hull passes to another track between the last two angles:
      // find the crossing and add both ends of the common tangent.
      let a = ((i - 1) * TURN) / n;
      let b = psi;
      for (let it = 0; it < 60; it++) {
        const m = (a + b) / 2;
        if (hullIndex(supports, m) === prev) a = m;
        else b = m;
      }
      const cross = (a + b) / 2;
      vertex(supports[prev], cross);
      vertex(supports[k], cross);
    }
    vertex(supports[k], psi);
    prev = k;
  }
  const first = hullIndex(supports, 0);
  if (prev !== first) {
    let a = ((n - 1) * TURN) / n;
    let b = TURN;
    for (let it = 0; it < 60; it++) {
      const m = (a + b) / 2;
      if (hullIndex(supports, m) === prev) a = m;
      else b = m;
    }
    const cross = (a + b) / 2;
    vertex(supports[prev], cross);
    vertex(supports[first], cross);
  }
  return out;
}
