/**
 * Project presets. SI units throughout.
 * @module state/presets
 */

import { GENERATOR_DEFAULTS, drawRange, generateCurve } from '../core/curve.js';
import { INCH } from '../core/units.js';

/** @typedef {import('./schema.js').ProjectState} ProjectState */

const DEG = Math.PI / 180;

/**
 * Default project: ATA 33 in, brace height 6.5 in, draw length 29 in (AMO),
 * peak 267 N (60 lbf), let-off 80 %, string diameter 2.5 mm, parametric
 * curve. Limb, track and body values are starting points for the solver.
 * Returns a new object on every call.
 * @returns {ProjectState}
 */
export function defaultState() {
  const geometry = {
    ata: 33 * INCH,
    braceHeight: 6.5 * INCH,
    drawLength: 29 * INCH,
    limbLength: 11 * INCH,
    limbAngleBrace: 25 * DEG,
  };
  const params = {
    peak: 267,
    letOff: 0.8,
    riseFraction: GENERATOR_DEFAULTS.riseFraction,
    valleyWidth: GENERATOR_DEFAULTS.valleyWidth,
  };
  const points = generateCurve({ ...drawRange(geometry.braceHeight, geometry.drawLength), ...params });
  return {
    schemaVersion: 1,
    units: { draw: 'in', force: 'N', dims: 'mm', energy: 'J', stiffness: 'N/mm' },
    geometry,
    curve: { mode: 'parametric', params, points },
    limb: {
      mode: 'stiffness',
      stiffness: 27e3,
      preloadTravel: 0.03,
      travel: 0.038,
      maxRotation: 30 * DEG,
      table: [],
    },
    stringTrack: {
      shape: 'eccentric',
      radius: 0.036,
      offset: 0.006,
      phase: 0,
      semiMajor: 0.04,
      semiMinor: 0.032,
    },
    cords: {
      stringDiameter: 0.0025,
      cableDiameter: 0.0025,
      stringGrooveDepth: 0.0025,
      cableGrooveDepth: 0.0025,
    },
    body: {
      boreDiameter: 0.008,
      minWall: 0.003,
      postDiameter: 0.005,
      leadInWrap: 30 * DEG,
      residualWrap: 30 * DEG,
      minBendRadius: 0.005,
    },
  };
}
