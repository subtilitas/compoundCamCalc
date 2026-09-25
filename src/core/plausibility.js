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
 *   position (m), null when not tied to the draw; the message lists each
 *   separate range
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
      suggestion: 'Less axle travel at full draw makes the cable track smaller: reduce "Axle travel, brace to full draw" ' +
        'or raise "Limb stiffness at the axle". A smaller string track ("Radius", or "Semi-major axis" for an ellipse) ' +
        'makes the cam turn further for the same power stroke, which also makes the cable track smaller',
    });
  }
  const low = lowestCamPoint(input);
  const x = input.achieved.x;
  // Each run of overlapping samples; an unsolved sample ends a run.
  /** @type {[number, number][]} */
  const runs = [];
  let min = Infinity;
  let start = -1;
  for (let i = 0; i <= low.length; i++) {
    const over = i < low.length && low[i] <= 0;
    if (over) {
      if (start < 0) start = i;
      if (low[i] < min) min = low[i];
    } else if (start >= 0) {
      runs.push([x[start], x[i - 1]]);
      start = -1;
    }
  }
  if (runs.length > 0) {
    warnings.push({
      code: 'cam-overlap',
      xRange: [runs[0][0], runs[runs.length - 1][1]],
      message: `The two cams overlap ${runs.map((r) => fmt.drawRange(r)).join(' and ')}, by up to ${fmt.size(-2 * min)}`,
      suggestion: 'Raise the axle-to-axle length or make the cam smaller (see the cam size)',
    });
  }
  return warnings;
}
