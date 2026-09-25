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
 * peak 267 N (60 lbf), let-off 75 %, string diameter 2.5 mm, parametric
 * curve. The solver builds its cam without diagnostics: a soft, heavily
 * preloaded limb (2.6 N/mm, 192 mm preload travel) keeps the limb moment
 * nearly constant, so the string tension can stay high up to the peak while
 * the cable lever arm at full draw stays above the bore and its wall; the
 * string groove (radius 45 mm, offset 22 mm towards −122°) has a small lever
 * arm around the peak and a large one at full draw. With 80 % let-off the
 * draw energy stays below 90 J and the fitted cam misses the target by more
 * than the tolerance (docs/PLAN.md). Returns a new object on every call.
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
    letOff: 0.75,
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
      stiffness: 2.6e3,
      preloadTravel: 0.192,
      travel: 0.078,
      maxRotation: 30 * DEG,
      table: [],
    },
    stringTrack: {
      shape: 'eccentric',
      radius: 0.045,
      offset: 0.022,
      phase: -122 * DEG,
      semiMajor: 0.05,
      semiMinor: 0.04,
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
