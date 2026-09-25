/**
 * Diagnostics of the solver: codes, the shape of a diagnostic, run
 * detection over samples and number formatting in the display units of the
 * project. Messages state what is wrong in plain words with numbers and
 * units; suggestions name the input to change and the direction.
 * @module core/diagnostics
 */

import { AMO_OFFSET, formatQuantity, fromSI, toSI } from './units.js';

/**
 * @typedef {'invalid-input' | 'brace-tension' | 'slack-cable' | 'nonpositive-force' | 'cable-fold'
 *   | 'cable-lever' | 'string-radius' | 'cable-radius' | 'string-clearance' | 'cable-clearance'
 *   | 'string-wrap' | 'cable-wrap' | 'closing-blend' | 'limb-rotation' | 'limb-energy'
 *   | 'target-shape' | 'no-convergence' | 'slack-string' | 'wrap-exhausted'} SolveCode
 */

/**
 * @typedef {object} SolveDiagnostic
 * @property {SolveCode} code
 * @property {[number, number] | null} xRange first and last affected nock
 *   position (m), null when not tied to the draw
 * @property {[number, number] | null} psiRange first and last affected track
 *   angle, cam frame (rad), null when not tied to a track angle
 * @property {string} message what is wrong, with numbers and units
 * @property {string} suggestion which input to change and in which direction
 */

/** Every code with the condition it reports (the table of docs/model.md). */
export const CODES = /** @type {const} */ ({
  'invalid-input': 'the project data fails validation or the model cannot be built from it',
  'brace-tension': 'the brace string tension T_s0 = F\'(x_b)·l_0/2 lies outside (0, M_b/s_a0)',
  'slack-cable': 'the cable tension of the target is zero or negative: E1\'(α) ≤ s_a·T_s, so dθ/dx ≤ 0',
  'nonpositive-force': 'the target force is zero or negative after brace',
  'cable-fold': 'the ideal cable contact angle does not increase with the draw',
  'cable-lever': 'c_a ≤ 0: the limb lever points at or past the vertical, limb rotation does not take up cable',
  'string-radius': 'the string pitch line has ρ below max(minimum bend radius, d/2 + 0.2 mm)',
  'cable-radius': 'the ideal cable pitch line has ρ below max(minimum bend radius, d/2 + 0.2 mm)',
  'string-clearance': 'the string groove bottom comes closer to the axle than bore radius plus wall',
  'cable-clearance': 'the cable groove bottom comes closer to the axle than bore radius plus wall',
  'string-wrap': 'the string wraps a full turn or more at brace, including the residual wrap',
  'cable-wrap': 'the cable wraps a full turn or more at full draw, including the lead-in wrap',
  'closing-blend': 'the quintic that closes the cable track has ρ below the limit',
  'limb-rotation': 'the limb rotation at full draw exceeds the maximum limb rotation',
  'limb-energy': 'the tabulated limb cannot store the draw energy of the target',
  'target-shape': 'the target curve with the brace second derivative is not monotone between its points',
  'no-convergence': 'a closure, root search or the constrained fit did not converge',
  'slack-string': 'the string tension of the achieved cam is zero or negative',
  'wrap-exhausted': 'a contact of the achieved cam passes the end of its wrapped track',
});

/**
 * Runs of consecutive flagged indices.
 * @param {number} n
 * @param {(i: number) => boolean} flagged
 * @returns {[number, number][]} first and last index of each run
 */
export function runs(n, flagged) {
  /** @type {[number, number][]} */
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && flagged(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/**
 * Number formatting in the display units of the project.
 * @param {import('../state/schema.js').Units} units
 */
export function formatter(units) {
  const drawUnit = toSI(1, 'length', units.draw);
  /**
   * Upper limit rounded down to the shown decimals, so the shown value keeps
   * the limit.
   * @param {number} v SI value
   * @param {'force' | 'length'} quantity
   * @param {string} unit
   * @param {number} decimals
   */
  const atMost = (v, quantity, unit, decimals) => {
    const scale = 10 ** decimals;
    const shown = Math.floor(fromSI(v, quantity, unit) * scale + 1e-9) / scale;
    return formatQuantity(toSI(shown, quantity, unit), quantity, unit, decimals);
  };
  return {
    /** Nock position x as AMO draw length. @param {number} x (m) */
    draw: (/** @type {number} */ x) => formatQuantity(x + AMO_OFFSET, 'length', units.draw, units.draw === 'mm' ? 0 : 1),
    /** Part dimension. @param {number} v (m) */
    size: (/** @type {number} */ v) => formatQuantity(v, 'length', units.dims, units.dims === 'in' ? 3 : 1),
    /** @param {number} v (N) */
    force: (/** @type {number} */ v) => formatQuantity(v, 'force', units.force, 0),
    /** Upper force limit, rounded down. @param {number} v (N) */
    forceAtMost: (/** @type {number} */ v) => atMost(v, 'force', units.force, 0),
    /** Upper size limit, rounded down. @param {number} v (m) */
    sizeAtMost: (/** @type {number} */ v) => atMost(v, 'length', units.dims, units.dims === 'in' ? 3 : 1),
    /** Force with one decimal, for differences and tolerances. @param {number} v (N) */
    forceFine: (/** @type {number} */ v) => formatQuantity(v, 'force', units.force, 1),
    /** @param {number} v (J) */
    energy: (/** @type {number} */ v) => formatQuantity(v, 'energy', units.energy, 1),
    /** @param {number} v (rad) */
    angle: (/** @type {number} */ v) => `${((v * 180) / Math.PI).toFixed(1)}°`,
    /** @param {number} v (ratio) */
    percent: (/** @type {number} */ v) => `${(v * 100).toFixed(0)} %`,
    /** @param {number} v (N/m) */
    stiffness: (/** @type {number} */ v) => formatQuantity(v, 'stiffness', units.stiffness, 1),
    /** Slope of the force curve per draw unit. @param {number} v (N/m) */
    slope: (/** @type {number} */ v) => `${formatQuantity(v * drawUnit, 'force', units.force, 1)}/${units.draw}`,
    /** Second derivative of the force curve per draw unit squared. @param {number} v (N/m²) */
    curvature: (/** @type {number} */ v) => `${formatQuantity(v * drawUnit * drawUnit, 'force', units.force, 2)}/${units.draw}²`,
    /** Range of nock positions as draw lengths. @param {[number, number]} r */
    drawRange: (/** @type {[number, number]} */ r) => {
      const f = (/** @type {number} */ x) => formatQuantity(x + AMO_OFFSET, 'length', units.draw, units.draw === 'mm' ? 0 : 1);
      return r[0] === r[1] ? `at ${f(r[0])}` : `between ${f(r[0])} and ${f(r[1])}`;
    },
  };
}

/**
 * @param {SolveCode} code
 * @param {string} message
 * @param {string} suggestion
 * @param {{ xRange?: [number, number] | null, psiRange?: [number, number] | null }} [where]
 * @returns {SolveDiagnostic}
 */
export function diagnostic(code, message, suggestion, where = {}) {
  return { code, xRange: where.xRange ?? null, psiRange: where.psiRange ?? null, message, suggestion };
}
