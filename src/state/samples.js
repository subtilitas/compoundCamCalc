/**
 * Sample designs for File → Open sample…. Each one validates and solves at
 * full resolution without diagnostics (tests/unit/samples.test.js). The
 * limb values of every sample are assumptions: none is checked against a
 * measured limb. SI units throughout.
 * @module state/samples
 */

import { drawRange, generateCurve } from '../core/curve.js';
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
    id: 'hunting',
    name: 'Compound bow, hunting (70 lbf)',
    description: '31 in axle to axle, 29 in draw, 311 N (70 lbf) peak, 80 % let-off, elliptical string track, 132 mm cam.',
    state: hunting,
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
