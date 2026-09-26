/**
 * Sample designs for File → Open sample…. Each one validates and solves at
 * full resolution without diagnostics and without plausibility warnings
 * (tests/unit/samples.test.js). The limb values of every sample are
 * assumptions: none is checked against a measured limb. SI units
 * throughout.
 * @module state/samples
 */

import { drawRange, generateCurve } from '../core/curve.js';
import { FREEFORM_POINTS, applyModifier, sampleTrack } from '../core/freeform.js';
import { INCH } from '../core/units.js';
import { defaultState } from './presets.js';

/** @typedef {import('./schema.js').ProjectState} ProjectState */

const DEG = Math.PI / 180;

/**
 * @typedef {object} Sample
 * @property {string} id
 * @property {string} name menu label
 * @property {string} description one sentence
 * @property {() => ProjectState} state a new object on every call
 */

/**
 * Regenerate the parametric curve of a state after its geometry or
 * parameters changed.
 * @param {ProjectState} s
 * @returns {ProjectState}
 */
function withCurve(s) {
  s.curve.points = generateCurve({ ...drawRange(s.geometry.braceHeight, s.geometry.drawLength), ...s.curve.params });
  return s;
}

/**
 * Hunting compound bow: 311 N (70 lbf) at 80 % let-off on an elliptical
 * string track. Solves to a 132 mm cam storing 107 J, peak 315.0 N,
 * let-off 79.5 %, largest force difference 5.5 N against 9.3 N.
 * @returns {ProjectState}
 */
function hunting() {
  const s = defaultState();
  s.geometry.ata = 31 * INCH;
  s.geometry.braceHeight = 6.25 * INCH;
  s.curve.params = { ...s.curve.params, peak: 311, letOff: 0.8, riseFraction: 0.48 };
  s.limb = { ...s.limb, stiffness: 2.6e3, preloadTravel: 0.15, travel: 0.102 };
  s.stringTrack = { ...s.stringTrack, shape: 'ellipse', offset: 0.025, phase: -114 * DEG, semiMajor: 0.045, semiMinor: 0.042 };
  return withCurve(s);
}

/**
 * The default target bow with a free-form string track from Optimise
 * (goal "Smallest cam, force curve no worse than now", 178 solves): 12
 * groove radii from 22.4 mm to 66.4 mm. Solves to a 93.9 mm cam (default:
 * 98.2 mm), largest force difference 3.56 N against 8.0 N (default:
 * 3.71 N), let-off 74.6 %, sharpest string bend 43.2 mm.
 * @returns {ProjectState}
 */
function targetOptimised() {
  const s = defaultState();
  const values = [0.0327793, 0.0252277, 0.0224468, 0.0255695, 0.0341132, 0.0454121, 0.0560957, 0.0636555, 0.06642, 0.0633055, 0.05477, 0.0434547];
  s.stringTrack = { ...s.stringTrack, shape: 'freeform', freeform: { values } };
  return withCurve(s);
}

/**
 * Light hunting compound bow: 222 N (50 lbf) at 80 % let-off, 27 in draw,
 * 30 in axle to axle, 7 in brace height, soft limb (1.4 N/mm, 250 mm
 * preload travel, 350 N at the axle at brace) and a string track of radius
 * 40 mm, offset 18 mm. Solves to an 88 mm cam storing 64.9 J, peak
 * 226.6 N, let-off 79.1 %, largest force difference 5.5 N against 6.7 N.
 * @returns {ProjectState}
 */
function lightHunting() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 30 * INCH, braceHeight: 7 * INCH, drawLength: 27 * INCH };
  s.curve.params = { ...s.curve.params, peak: 222, letOff: 0.8, riseFraction: 0.52 };
  s.limb = { ...s.limb, stiffness: 1.4e3, preloadTravel: 0.25, travel: 0.08 };
  s.stringTrack = { ...s.stringTrack, radius: 0.04, offset: 0.018 };
  return withCurve(s);
}

/**
 * Hunting compound bow with a 6 in brace height and a free-form string
 * track: 311 N (70 lbf) at 80 % let-off, 30 in draw, 31 in axle to axle,
 * 2.4 N/mm limb with 180 mm preload travel (432 N at the axle at brace).
 * The track is an eccentric circle (radius 50 mm, offset 22 mm towards
 * −122°) sampled at 12 points, plus the Rounded triangle shape preset of
 * 2 mm at 45°. Solves to a 110 mm cam storing 113 J, peak 313.2 N, let-off
 * 79.5 %, largest force difference 6.2 N against 9.3 N.
 * @returns {ProjectState}
 */
function shortBrace() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 31 * INCH, braceHeight: 6 * INCH, drawLength: 30 * INCH };
  s.curve.params = { ...s.curve.params, peak: 311, letOff: 0.8, riseFraction: 0.5 };
  s.limb = { ...s.limb, stiffness: 2.4e3, preloadTravel: 0.18, travel: 0.102 };
  s.stringTrack = { ...s.stringTrack, radius: 0.05, offset: 0.022 };
  const circle = sampleTrack(s.stringTrack, FREEFORM_POINTS.default);
  // Rounded to 0.1 µm, as sampleTrack, which keeps the share link short.
  const values = applyModifier(circle, 'triangle', 2e-3, 45 * DEG).map((v) => Number(v.toFixed(7)));
  s.stringTrack = { ...s.stringTrack, shape: 'freeform', freeform: { values } };
  return withCurve(s);
}

/**
 * Compound bow for a long draw: 356 N (80 lbf) at 80 % let-off, 31 in
 * draw, 35 in axle to axle, 7 in brace height, 2.6 N/mm limb with 200 mm
 * preload travel (520 N at the axle at brace) and a string track of radius
 * 50 mm, offset 26 mm. Solves to a 120 mm cam storing 128 J, peak 360.4 N, let-off
 * 80.5 %, largest force difference 6.6 N against 10.7 N.
 * @returns {ProjectState}
 */
function longDraw() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 35 * INCH, braceHeight: 7 * INCH, drawLength: 31 * INCH };
  s.curve.params = { ...s.curve.params, peak: 356, letOff: 0.8, riseFraction: 0.52 };
  s.limb = { ...s.limb, stiffness: 2.6e3, preloadTravel: 0.2, travel: 0.099 };
  s.stringTrack = { ...s.stringTrack, radius: 0.05, offset: 0.026 };
  return withCurve(s);
}

/**
 * Youth compound bow: 89 N (20 lbf) at 70 % let-off, 24 in draw, 27 in
 * axle to axle, 6.5 in brace height, soft limb (0.9 N/mm, 200 mm preload
 * travel, 180 N at the axle at brace) and a small string track (radius
 * 35 mm, offset 15 mm). Solves to a 76 mm cam storing 23.3 J, peak 90.7 N,
 * let-off 70.7 %, largest force difference 2.0 N against 2.7 N.
 * @returns {ProjectState}
 */
function youth() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 27 * INCH, braceHeight: 6.5 * INCH, drawLength: 24 * INCH };
  s.curve.params = { ...s.curve.params, peak: 89, letOff: 0.7, riseFraction: 0.48 };
  s.limb = { ...s.limb, stiffness: 0.9e3, preloadTravel: 0.2, travel: 0.057 };
  s.stringTrack = { ...s.stringTrack, radius: 0.035, offset: 0.015 };
  return withCurve(s);
}

/**
 * Forward-draw compound crossbow, drawn with a cocking device and held by
 * a latch (neither is modelled): 750 N (169 lbf) peak, 50 % let-off,
 * 13.25 in power stroke, stiff 6.5 in limb levers (20 N/mm, 1250 N at the
 * axle at brace). Solves to an 86 mm cam storing 175 J, peak 757.4 N,
 * let-off 51.0 %, largest force difference 11.9 N against 22.5 N.
 * @returns {ProjectState}
 */
function crossbow() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 16 * INCH, braceHeight: 4 * INCH, drawLength: 19 * INCH, limbLength: 6.5 * INCH };
  s.curve.params = { ...s.curve.params, peak: 750, letOff: 0.5 };
  s.limb = { ...s.limb, stiffness: 20e3, preloadTravel: 0.0625, travel: 0.05 };
  s.stringTrack = { ...s.stringTrack, radius: 0.04, offset: 0.02 };
  s.cords = { stringDiameter: 0.003, cableDiameter: 0.003, stringGrooveDepth: 0.003, cableGrooveDepth: 0.003 };
  s.body = { ...s.body, flangeThickness: 0.003 };
  return withCurve(s);
}

/**
 * Desk-size bow whose cams print on an FDM (fused deposition modelling)
 * printer with a 0.4 mm nozzle and 0.2 mm layers: 30 N peak, 60 % let-off,
 * 1 mm braided line, M3 bore, walls of at least 1.2 mm (3 perimeters),
 * 1.4 mm plates (7 layers). Solves to a 26.4 mm cam storing 2.3 J, peak
 * 30.9 N, let-off 62.1 %, largest force difference 1.3 N against 2.0 N.
 * Printed parts hold about ±0.1 to 0.2 mm, coarser than the 0.01 mm of
 * the export.
 * @returns {ProjectState}
 */
function mini() {
  const s = defaultState();
  s.geometry = { ...s.geometry, ata: 10 * INCH, braceHeight: 2 * INCH, drawLength: 8.5 * INCH, limbLength: 3 * INCH };
  s.curve.params = { peak: 30, letOff: 0.6, riseFraction: 0.57, valleyWidth: 0.5 * INCH };
  s.limb = { ...s.limb, stiffness: 1.4e3, preloadTravel: 0.04, travel: 0.017 };
  s.stringTrack = { ...s.stringTrack, radius: 0.012, offset: 0.005 };
  s.cords = { stringDiameter: 0.001, cableDiameter: 0.001, stringGrooveDepth: 0.0012, cableGrooveDepth: 0.0012 };
  s.body = {
    ...s.body,
    boreDiameter: 0.003,
    minWall: 0.0012,
    postDiameter: 0.002,
    minBendRadius: 0.002,
    flangeThickness: 0.0014,
    grooveClearance: 0.0004,
  };
  return withCurve(s);
}

/** Sample designs, in menu order. */
export const SAMPLES = Object.freeze(/** @type {Sample[]} */ ([
  {
    id: 'target',
    name: 'Compound bow, target (60 lbf)',
    description: 'The default design: 33 in axle to axle, 29 in draw, 267 N (60 lbf) peak, 75 % let-off, 98 mm cam.',
    state: defaultState,
  },
  {
    id: 'target-optimised',
    name: 'Compound bow, target, optimised track (60 lbf)',
    description: 'The target design with a free-form string track from Optimise (smallest cam, force curve no worse): 93.9 mm cam instead of 98.2 mm.',
    state: targetOptimised,
  },
  {
    id: 'hunting',
    name: 'Compound bow, hunting (70 lbf)',
    description: '31 in axle to axle, 29 in draw, 311 N (70 lbf) peak, 80 % let-off, elliptical string track, 132 mm cam.',
    state: hunting,
  },
  {
    id: 'light-hunting',
    name: 'Compound bow, light hunting (50 lbf)',
    description: '30 in axle to axle, 27 in draw, 7 in brace height, 222 N (50 lbf) peak, 80 % let-off, 88 mm cam.',
    state: lightHunting,
  },
  {
    id: 'short-brace',
    name: 'Compound bow, short-brace hunting (70 lbf)',
    description: '31 in axle to axle, 30 in draw, 6 in brace height, 311 N (70 lbf) peak, 80 % let-off, free-form string track with a 2 mm rounded triangle, 110 mm cam.',
    state: shortBrace,
  },
  {
    id: 'long-draw',
    name: 'Compound bow, long draw (80 lbf)',
    description: '35 in axle to axle, 31 in draw, 7 in brace height, 356 N (80 lbf) peak, 80 % let-off, 120 mm cam.',
    state: longDraw,
  },
  {
    id: 'youth',
    name: 'Compound bow, youth (20 lbf)',
    description: '27 in axle to axle, 24 in draw, 6.5 in brace height, 89 N (20 lbf) peak, 70 % let-off, 76 mm cam.',
    state: youth,
  },
  {
    id: 'crossbow',
    name: 'Crossbow (169 lbf)',
    description: 'Forward-draw compound crossbow: 16 in axle to axle, 13.25 in power stroke, 750 N (169 lbf) peak, 50 % let-off, 86 mm cam.',
    state: crossbow,
  },
  {
    id: 'mini',
    name: 'Mini bow for FDM printing',
    description: '10 in axle to axle, 8.5 in draw, 30 N peak, 60 % let-off, 1 mm braided line, 26 mm cam on an M3 bore, 1.4 mm plates.',
    state: mini,
  },
]));

/**
 * A new state of the sample with the given id.
 * @param {string} id
 * @returns {ProjectState}
 * @throws {Error} for an unknown id
 */
export function sampleState(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`unknown sample "${id}"`);
  return sample.state();
}
