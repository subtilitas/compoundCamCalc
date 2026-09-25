/**
 * Plausibility checks of a solved cam: designs that meet every solver check
 * but cannot be built or used as drawn. The checks give warnings; they do
 * not change the result status and do not block the exports.
 *
 * - cam-size: the cam maximum dimension exceeds CAM_SIZE_SHARE of the
 *   axle-to-axle length at brace. The sample designs lie between 10 % and
 *   21 %.
 * - cam-overlap: the two cams overlap at a draw position. The twin cams are
 *   mirror images about the line through the grip pivot perpendicular to
 *   the axles, and their outlines are convex, so they overlap exactly when
 *   the top cam reaches that line: its lowest point, over the flange
 *   outlines, lies at or below y = 0.
 * @module core/plausibility
 */

/** @typedef {import('./diagnostics.js').SolveDiagnostic} SolveDiagnostic */
/** @typedef {ReturnType<typeof import('./diagnostics.js').formatter>} Formatter */

/** Largest cam maximum dimension without a warning, as a share of the axle-to-axle length. */
export const CAM_SIZE_SHARE = 0.35;

/**
 * @typedef {object} Warning
 * @property {'cam-size' | 'cam-overlap'} code
 * @property {[number, number] | null} xRange first and last affected nock
 *   position (m), null when not tied to the draw
 * @property {string} message what is implausible, with numbers and units
 * @property {string} suggestion which input to change and in which direction
 */

/**
 * @typedef {object} PlausibilityInput
 * @property {number} ata axle-to-axle length at brace (m)
 * @property {number} camMaxDimension (m)
 * @property {{ x: Float64Array, y: Float64Array }[]} outlines flange
 *   outlines in the cam frame (m)
 * @property {{ x: Float64Array, theta: Float64Array, axleY: Float64Array, n?: number }} achieved
 *   forward samples: nock position, cam rotation and axle height (m, rad, m)
 */

/**
 * Lowest point of the top cam at every draw sample: the axle height minus
 * the extent of the outlines towards −y. A cam point (u, v) lies at
 * y = O_y − sin θ·u + cos θ·v in the bow frame.
 * @param {PlausibilityInput} input
 * @returns {Float64Array} (m), NaN at unsolved samples
 */
export function lowestCamPoint(input) {
  const { theta, axleY } = input.achieved;
  const n = input.achieved.n ?? theta.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // A sample the forward model did not solve has no pose.
    if (!(Number.isFinite(theta[i]) && Number.isFinite(axleY[i]))) {
      out[i] = NaN;
      continue;
    }
    const s = Math.sin(theta[i]);
    const c = Math.cos(theta[i]);
    let extent = -Infinity;
    for (const o of input.outlines) {
      for (let k = 0; k < o.x.length; k++) {
        const e = s * o.x[k] - c * o.y[k];
        if (e > extent) extent = e;
      }
    }
    out[i] = axleY[i] - extent;
  }
  return out;
}

/**
 * Warnings for a solved cam.
 * @param {PlausibilityInput} input
 * @param {Formatter} fmt
 * @returns {Warning[]}
 */
export function plausibility(input, fmt) {
  /** @type {Warning[]} */
  const warnings = [];
  const { ata, camMaxDimension } = input;
  if (Number.isFinite(camMaxDimension) && ata > 0 && camMaxDimension > CAM_SIZE_SHARE * ata) {
    warnings.push({
      code: 'cam-size',
      xRange: null,
      message: `The cam measures ${fmt.size(camMaxDimension)} across, ${fmt.percent(camMaxDimension / ata)} of the ` +
        `${fmt.size(ata)} axle-to-axle length; this app warns above ${fmt.percent(CAM_SIZE_SHARE)}`,
      suggestion: 'The cable track takes up the limb travel while the cam turns: less limb travel at full draw ' +
        '(a stiffer limb or a lower limb travel) makes it smaller, and a smaller string track radius makes the cam turn ' +
        'further for the same power stroke, which also makes the cable track smaller',
    });
  }
  const low = lowestCamPoint(input);
  const x = input.achieved.x;
  let first = -1;
  let last = -1;
  let min = Infinity;
  for (let i = 0; i < low.length; i++) {
    if (low[i] < min) min = low[i];
    if (low[i] <= 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first >= 0) {
    /** @type {[number, number]} */
    const xRange = [x[first], x[last]];
    warnings.push({
      code: 'cam-overlap',
      xRange,
      message: `The two cams overlap ${fmt.drawRange(xRange)}, by up to ${fmt.size(-2 * min)}`,
      suggestion: 'Raise the axle-to-axle length or make the cam smaller (see the cam size)',
    });
  }
  return warnings;
}
