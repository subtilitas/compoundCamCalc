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
 * curve. The solver builds its cam without diagnostics: 93.0 J of draw
 * energy, 77.5 mm of axle travel, a 98 mm cam and a largest force
 * difference of 3.7 N against the 8.0 N fit tolerance.
 *
 * The let-off is bounded at full draw: the cable lever arm must stay at or
 * above p_min = bore/2 + wall + cable radius (8.25 mm), which caps the limb
 * force at the axle at full draw, k·(s_0 + s_f) = W·(s_0 + s_f)/(s_f·(s_f +
 * 2·s_0)) at draw energy W. p_min (bore and wall) and the string lever arm
 * at full draw (63.6 mm here) are the main levers. At a fixed draw energy a
 * softer, more preloaded limb with more axle travel raises the let-off and
 * a stiffer one lowers it: 10 N/mm with 60 mm preload reaches 61.5 % for a
 * 75 % target. The limb here is soft and heavily preloaded (2.6 N/mm,
 * 192 mm preload travel, 499 N at the axle at brace and 701 N at full draw)
 * and is not checked against measured limbs. The string groove (radius
 * 45 mm, offset 22 mm towards −122°) has a small lever arm around the peak
 * and a large one at full draw. Let-off 80 % builds with a softer limb
 * (2.1 N/mm, 91 mm axle travel) and a 122 mm cam, but fewer edits around it
 * meet the fit tolerance (docs/PLAN.md). Returns a new object on every call.
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
