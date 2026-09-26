/**
 * Cord stiffness: measured materials, the axial stiffness EA of each cord
 * from the Timing settings, and the build lengths of elastic cords.
 *
 * The analysis (core/analysis) gives each cord part the compliance
 * C = ℓ / EA, ℓ its pitch-line length in the braced bow of the design. The
 * free length, at no tension, is L0 = L − C·T0 with T0 the tension at
 * brace; under a tension T the cord measures L0 + C·T.
 *
 * Forces in N, lengths in m.
 * @module core/cords
 */

import { toSI } from './units.js';

/**
 * Measured stiffness per strand: breaking force over elongation at break,
 * DITF tensile tests of July 2018 (docs/research.md, cord material).
 */
export const CORD_MATERIALS = Object.freeze([
  Object.freeze({ id: '452x', label: 'BCY 452X', strand: 12360 }),
  Object.freeze({ id: 'fastflight-plus', label: 'Fastflight Plus', strand: 10966 }),
  Object.freeze({ id: 'dacron-b50', label: 'Dacron B50', strand: 2118 }),
]);

/** Material value of a cord whose EA is entered directly. */
export const CUSTOM_MATERIAL = 'custom';

/** Tension of the loaded build length: 100 lbf (N). */
export const BUILD_TENSION = toSI(100, 'force', 'lbf');

/**
 * @typedef {object} CordStiffness EA of each cord (N)
 * @property {number} string
 * @property {number} topCable
 * @property {number} bottomCable
 */

/**
 * EA of one cord: strands times the stiffness per strand of its material,
 * or the entered EA for a custom material. NaN for an unknown material.
 * @param {string} material
 * @param {number} strands
 * @param {number} ea EA of a custom cord (N)
 */
export function cordEA(material, strands, ea) {
  if (material === CUSTOM_MATERIAL) return ea;
  const m = CORD_MATERIALS.find((c) => c.id === material);
  return m ? strands * m.strand : NaN;
}

/**
 * EA of the three cords of the Timing settings, or null for rigid cords.
 * @param {import('../state/schema.js').Tuning} tuning
 * @returns {CordStiffness | null}
 */
export function cordStiffness(tuning) {
  if (tuning.cordModel !== 'elastic') return null;
  return {
    string: cordEA(tuning.stringMaterial, tuning.stringStrands, tuning.stringEA),
    topCable: cordEA(tuning.topCableMaterial, tuning.topCableStrands, tuning.topCableEA),
    bottomCable: cordEA(tuning.bottomCableMaterial, tuning.bottomCableStrands, tuning.bottomCableEA),
  };
}

/**
 * @typedef {object} CordBuildLength
 * @property {number} free length at no tension (m)
 * @property {number} loaded length at BUILD_TENSION (m)
 */

/**
 * Build lengths of elastic cords from the pitch-line lengths and the
 * tensions of the braced design: the whole string with its tension, each
 * cable with its own.
 * @param {{ string: number, cable: number }} lengths pitch-line lengths at brace (m)
 * @param {{ string: number, cable: number }} tensions at brace (N)
 * @param {CordStiffness} stiffness
 * @returns {{ string: CordBuildLength, topCable: CordBuildLength, bottomCable: CordBuildLength }}
 */
export function buildLengths(lengths, tensions, stiffness) {
  /**
   * @param {number} L
   * @param {number} T0
   * @param {number} ea
   */
  const cord = (L, T0, ea) => {
    const C = L / ea;
    const free = L - C * T0;
    return { free, loaded: free + C * BUILD_TENSION };
  };
  return {
    string: cord(lengths.string, tensions.string, stiffness.string),
    topCable: cord(lengths.cable, tensions.cable, stiffness.topCable),
    bottomCable: cord(lengths.cable, tensions.cable, stiffness.bottomCable),
  };
}
